import { describe, expect, it } from "vitest";
import {
  PARTNER_ASSISTANT_ACTION_MESSAGES,
  PARTNER_COMMAND_KINDS,
  PARTNER_ERROR_MESSAGES,
  parsePartnerCommand,
  partnerActivityPayload,
  partnerCardPayload,
  partnerCommandOutcome,
  partnerCommandRejection,
  partnerContactPayload,
  partnerDoNotContactPayload,
  partnerMessagePayload,
  partnerStatePayload,
  type PartnerCardInput,
  type PartnerCommand,
} from "./commands";
import { partnerFixtureId } from "./fixtures";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Spec 02 §2.6 e §5.11: stesse regole dei comandi SQL, messaggi d'errore in italiano.
const NOW = new Date("2026-10-22T10:00:00Z");
const OP = partnerFixtureId(9000);
const PARTNER = partnerFixtureId(1);
const SHA = "a".repeat(64);
const command = (kind: string, payload: Record<string, unknown>, extra = {}) =>
  parsePartnerCommand(
    { kind, operationId: OP, payload: { schema_version: 1, ...payload }, ...extra },
    NOW,
  );
/**
 * SQL dei comandi del team: modulo Partner, assistente e invio dell'assistente (consegna 2a). Le
 * migrazioni del worker e dello scheduler (`_assistente_partner_worker.sql`,
 * `_assistente_partner_scheduler.sql`) restano fuori: i loro codici d'errore non arrivano mai alla
 * pagina. Della migrazione dell'invio contano i comandi del team (sezione 1); le RPC del worker
 * (sezione 2) alzano solo codici che la pagina conosce già o che non le arrivano mai.
 */
const teamSql = () => {
  const migrations = join(__dirname, "../../../supabase/migrations");
  return ["_partner_module.sql", "_assistente_partner.sql", "_assistente_partner_invio.sql"]
    .map((suffix) =>
      readFileSync(
        join(
          migrations,
          readdirSync(migrations).find((n) => n.endsWith(suffix))!,
        ),
        "utf8",
      ),
    )
    .join("\n");
};

const VALID: Record<string, Record<string, unknown>> = {
  set_partner_state: { partner_id: PARTNER, expected_version: 3, stage: "risposto" },
  save_partner: {
    partner_id: null,
    name: "Nuovo negozio",
    sections: ["vendita"],
    priority: "media",
    contact_month: "2026-11",
  },
  record_partner_activity: { partner_id: PARTNER, kind: "inviato", channel: "email" },
  save_partner_message: {
    partner_id: PARTNER,
    approach: "collab",
    expected_version: 2,
    subject: "Oggetto",
    body: "Testo",
    follow_up: "",
    confirm_email: "",
  },
  restore_partner_message: { variant_id: PARTNER, expected_version: 2 },
  save_partner_contact: {
    contact_id: null,
    partner_id: PARTNER,
    expected_version: null,
    kind: "email",
    value: "info@nuovo.example.test",
  },
  remove_partner_contact: { contact_id: PARTNER, expected_version: 1, erase: false },
  set_partner_do_not_contact: { partner_id: PARTNER, active: true, reason: "Ha chiesto così." },
  resolve_partner_difference: { difference_id: PARTNER, choice: "kept_team", expected_version: 4 },
  import_partner_device_file: {
    file_sha256: SHA,
    device: "telefono",
    exported_at: "2026-10-20T17:30:00.000Z",
    stages: { L001: "contattato" },
    texts: { "L001|collab|body": "Testo" },
    approaches: { L001: "collab" },
    names: { L001: "Garage Sintetico" },
  },
  set_partner_assistant_mode: { mode: "prepara", expected_version: 1, starting_credit_usd: 20 },
  set_partner_assistant_contact: {
    partner_id: PARTNER,
    active: false,
    reason: "Lo segue il team.",
  },
  save_partner_assistant_rules: { body: "# Regole\n\n- Tono cordiale.", expected_version: 1 },
  start_partner_assistant_test: { drafts: 2, recipients: 3 },
  confirm_partner_assistant_test: { expected_version: 4 },
  set_partner_assistant_send_priority: { partner_id: PARTNER, send_priority: 9 },
  resume_partner_assistant_send: {},
  set_partner_assistant_settings: { expected_version: 4, daily_first_limit: 8 },
};

describe("controllo dei comandi sul server", () => {
  it("accetta un comando valido per ognuno dei diciotto tipi", () => {
    expect(PARTNER_COMMAND_KINDS).toHaveLength(18);
    expect(Object.keys(VALID)).toEqual([...PARTNER_COMMAND_KINDS]);
    for (const kind of PARTNER_COMMAND_KINDS)
      expect(command(kind, VALID[kind]), kind).toMatchObject({
        kind,
        operationId: OP,
        retry: false,
      });
  });

  it("le chiavi ammesse sono quelle delle funzioni SQL: mai created_by", () => {
    const sql = teamSql();
    for (const kind of PARTNER_COMMAND_KINDS) {
      expect(command(kind, { ...VALID[kind], created_by: partnerFixtureId(2) }), kind).toBeNull();
      expect(command(kind, { ...VALID[kind], actor_id: partnerFixtureId(2) }), kind).toBeNull();
      if (kind !== "import_partner_device_file")
        for (const key of Object.keys(VALID[kind])) expect(sql).toContain(`'${key}'`);
    }
  });

  it("rifiuta forma, operation_id, schema_version e chiavi in più", () => {
    const valid = VALID.set_partner_state;
    expect(parsePartnerCommand(null)).toBeNull();
    expect(parsePartnerCommand({ kind: "drop_table", operationId: OP, payload: {} })).toBeNull();
    expect(
      parsePartnerCommand({
        kind: "set_partner_state",
        operationId: "op-1",
        payload: { schema_version: 1, ...valid },
      }),
    ).toBeNull();
    expect(command("set_partner_state", valid, { extra: true })).toBeNull();
    expect(command("set_partner_state", valid, { retry: "sì" })).toBeNull();
    expect(
      parsePartnerCommand({
        kind: "set_partner_state",
        operationId: OP,
        payload: { ...valid, schema_version: 2 },
      }),
    ).toBeNull();
    expect(command("set_partner_state", valid, { retry: true })?.retry).toBe(true);
    expect(
      parsePartnerCommand({
        kind: "set_partner_state",
        operationId: OP.toUpperCase(),
        payload: { schema_version: 1, ...valid },
      })?.operationId,
    ).toBe(OP);
  });

  it("stato, responsabile e prossima azione come set_partner_state", () => {
    const base = { partner_id: PARTNER, expected_version: 1 };
    expect(command("set_partner_state", base)).toBeNull();
    expect(command("set_partner_state", { ...base, stage: "perso" })).toBeNull();
    expect(command("set_partner_state", { ...base, stage: null })).toBeNull();
    expect(command("set_partner_state", { ...base, owner_id: null })).not.toBeNull();
    expect(command("set_partner_state", { ...base, next_action: "sollecito" })).toBeNull();
    expect(
      command("set_partner_state", { ...base, next_action: "sollecito", next_action_on: null }),
    ).toBeNull();
    expect(
      command("set_partner_state", { ...base, next_action: "  ", next_action_on: "2026-10-29" }),
    ).toBeNull();
    expect(
      command("set_partner_state", { ...base, next_action: null, next_action_on: null }),
    ).not.toBeNull();
    expect(command("set_partner_state", { ...base, expected_version: 0, stage: "no" })).toBeNull();
    expect(
      command("set_partner_state", { ...base, expected_version: 1.5, stage: "no" }),
    ).toBeNull();
  });

  it("registro: giorno tra un anno fa e oggi a Roma, nota con testo, tipo del messaggio solo per «inviato»", () => {
    const base = { partner_id: PARTNER, kind: "risposta" };
    expect(
      command("record_partner_activity", { ...base, occurred_on: "2026-10-22" }),
    ).not.toBeNull();
    expect(command("record_partner_activity", { ...base, occurred_on: "2026-10-23" })).toBeNull();
    expect(
      command("record_partner_activity", { ...base, occurred_on: "2025-10-22" }),
    ).not.toBeNull();
    expect(command("record_partner_activity", { ...base, occurred_on: "2025-10-21" })).toBeNull();
    expect(command("record_partner_activity", { ...base, message_kind: "primo" })).toBeNull();
    expect(command("record_partner_activity", { ...base, kind: "nota" })).toBeNull();
    expect(
      command("record_partner_activity", { ...base, kind: "nota", body: "Richiamano." }),
    ).not.toBeNull();
    expect(command("record_partner_activity", { ...base, kind: "stato" })).toBeNull();
    expect(command("record_partner_activity", { ...base, channel: "ig" })).toBeNull();
    expect(command("record_partner_activity", { ...base, body: "a\u0000b" })).toBeNull();
  });

  it("messaggi, recapiti, blocchi e differenze come i loro comandi", () => {
    const message = VALID.save_partner_message;
    expect(command("save_partner_message", { ...message, body: "", subject: " " })).toBeNull();
    expect(command("save_partner_message", { ...message, channel: "email" })).toBeNull();
    expect(command("save_partner_message", { ...message, expected_version: null })).toBeNull();
    expect(
      command("save_partner_message", {
        ...message,
        expected_version: null,
        channel: "dm",
        language: "it",
      }),
    ).not.toBeNull();
    expect(command("save_partner_message", { ...message, body: "x".repeat(8001) })).toBeNull();
    expect(command("save_partner_message", { ...message, follow_up: null })).toBeNull();
    const contact = VALID.save_partner_contact;
    expect(command("save_partner_contact", { ...contact, expected_version: 1 })).toBeNull();
    expect(command("save_partner_contact", { ...contact, value: "  " })).toBeNull();
    expect(command("save_partner_contact", { ...contact, kind: "fax" })).toBeNull();
    expect(
      command("remove_partner_contact", { ...VALID.remove_partner_contact, erase: "no" }),
    ).toBeNull();
    expect(
      command("set_partner_do_not_contact", { partner_id: PARTNER, active: true, reason: "no" }),
    ).toBeNull();
    expect(
      command("set_partner_do_not_contact", { partner_id: PARTNER, active: false }),
    ).not.toBeNull();
    expect(
      command("resolve_partner_difference", {
        ...VALID.resolve_partner_difference,
        choice: "both",
      }),
    ).toBeNull();
    expect(command("restore_partner_message", { variant_id: PARTNER })).toBeNull();
  });

  it("comandi dell'invio: limiti delle chiavi come le funzioni SQL", () => {
    const test = (payload: Record<string, unknown>) =>
      command("start_partner_assistant_test", payload);
    expect(test({ drafts: 1, recipients: 1 })).not.toBeNull();
    expect(test({ drafts: 3, recipients: 5 })).not.toBeNull();
    for (const payload of [
      { drafts: 4, recipients: 1 },
      { drafts: 0, recipients: 1 },
      { drafts: 1, recipients: 0 },
      { drafts: 1, recipients: 6 },
      { drafts: 1.5, recipients: 2 },
      { drafts: "2", recipients: 2 },
      { drafts: 2 },
      { recipients: 2 },
      { drafts: null, recipients: 2 },
    ])
      expect(test(payload), JSON.stringify(payload)).toBeNull();
    const priority = (value: unknown) =>
      command("set_partner_assistant_send_priority", { partner_id: PARTNER, send_priority: value });
    expect(priority(0)).not.toBeNull();
    expect(priority(9)).not.toBeNull();
    for (const value of [10, -1, 2.5, "9", null]) expect(priority(value), String(value)).toBeNull();
    expect(
      command("set_partner_assistant_send_priority", { partner_id: "x", send_priority: 1 }),
    ).toBeNull();
    const limit = (value: unknown) =>
      command("set_partner_assistant_settings", { expected_version: 4, daily_first_limit: value });
    expect(limit(1)).not.toBeNull();
    expect(limit(15)).not.toBeNull();
    for (const value of [0, 16, 7.5, "8", null]) expect(limit(value), String(value)).toBeNull();
    expect(command("set_partner_assistant_settings", { daily_first_limit: 8 })).toBeNull();
    expect(
      command("set_partner_assistant_settings", { expected_version: 0, daily_first_limit: 8 }),
    ).toBeNull();
    expect(command("confirm_partner_assistant_test", {})).toBeNull();
    expect(command("confirm_partner_assistant_test", { expected_version: 0 })).toBeNull();
    expect(command("resume_partner_assistant_send", { reason: "ripresa" })).toBeNull();
  });

  it("scheda: creazione con i quattro campi richiesti, modifica con versione e almeno un campo", () => {
    const create = VALID.save_partner;
    expect(command("save_partner", { ...create, contact_month: "2026-11-15" })).toBeNull();
    expect(command("save_partner", { ...create, name: "Due\nrighe" })).toBeNull();
    expect(command("save_partner", { ...create, sections: ["vendita", "vendita"] })).toBeNull();
    expect(command("save_partner", { ...create, expected_version: 1 })).toBeNull();
    const { priority: _priority, ...missing } = create;
    expect(command("save_partner", missing)).toBeNull();
    expect(
      command("save_partner", {
        ...create,
        event_starts_on: "2026-11-03",
        event_ends_on: "2026-11-02",
      }),
    ).toBeNull();
    expect(command("save_partner", { partner_id: PARTNER, expected_version: 2 })).toBeNull();
    expect(
      command("save_partner", { partner_id: PARTNER, expected_version: 2, city: "Torino" }),
    ).not.toBeNull();
    expect(
      command("save_partner", {
        partner_id: PARTNER,
        expected_version: 2,
        application_deadline: null,
      }),
    ).not.toBeNull();
  });

  it("file del dispositivo: lo stesso controllo del database", () => {
    const file = VALID.import_partner_device_file;
    expect(command("import_partner_device_file", { ...file, device: "tablet" })).toBeNull();
    expect(
      command("import_partner_device_file", { ...file, stages: { L001: "perso" } }),
    ).toBeNull();
    expect(
      command("import_partner_device_file", { ...file, texts: { "L001|collab|titolo": "x" } }),
    ).toBeNull();
    expect(
      command("import_partner_device_file", { ...file, exported_at: "2026-10-24T10:00:00Z" }),
    ).toBeNull();
    const { names: _names, ...noNames } = file;
    expect(command("import_partner_device_file", noNames)).toBeNull();
  });

  it("modalità dell'assistente: le quattro modalità, versione e credito da 0 a 10.000", () => {
    const mode = VALID.set_partner_assistant_mode;
    // «prova» e «invio» passano il controllo: il database risponde con il codice giusto.
    for (const value of ["spento", "prepara", "prova", "invio"])
      expect(command("set_partner_assistant_mode", { ...mode, mode: value }), value).not.toBeNull();
    expect(command("set_partner_assistant_mode", { ...mode, mode: "acceso" })).toBeNull();
    expect(command("set_partner_assistant_mode", { ...mode, mode: null })).toBeNull();
    const { expected_version: _version, ...noVersion } = mode;
    expect(command("set_partner_assistant_mode", noVersion)).toBeNull();
    expect(command("set_partner_assistant_mode", { ...mode, expected_version: 0 })).toBeNull();
    const { starting_credit_usd: _credit, ...noCredit } = mode;
    expect(command("set_partner_assistant_mode", noCredit)).not.toBeNull();
    for (const credit of [null, 0, 12.34, 0.07, 10000])
      expect(
        command("set_partner_assistant_mode", { ...mode, starting_credit_usd: credit }),
        String(credit),
      ).not.toBeNull();
    for (const credit of [-1, 10000.01, 1.005, 1e-7, "20", true])
      expect(
        command("set_partner_assistant_mode", { ...mode, starting_credit_usd: credit }),
        String(credit),
      ).toBeNull();
  });

  it("interruttore per contatto: attivo o fermo, motivo facoltativo fino a 240 caratteri", () => {
    const base = { partner_id: PARTNER, active: true };
    expect(command("set_partner_assistant_contact", base)).not.toBeNull();
    expect(command("set_partner_assistant_contact", { ...base, reason: "" })).not.toBeNull();
    expect(command("set_partner_assistant_contact", { ...base, reason: null })).not.toBeNull();
    expect(
      command("set_partner_assistant_contact", { ...base, reason: "x".repeat(240) }),
    ).not.toBeNull();
    expect(
      command("set_partner_assistant_contact", { ...base, reason: "x".repeat(241) }),
    ).toBeNull();
    expect(command("set_partner_assistant_contact", { partner_id: PARTNER })).toBeNull();
    expect(command("set_partner_assistant_contact", { ...base, active: "no" })).toBeNull();
    expect(command("set_partner_assistant_contact", { ...base, partner_id: "x" })).toBeNull();
  });

  it("regole dell'assistente: testo da 1 a 100.000 caratteri e versione", () => {
    const rules = VALID.save_partner_assistant_rules;
    expect(
      command("save_partner_assistant_rules", { ...rules, body: "x".repeat(100000) }),
    ).not.toBeNull();
    expect(
      command("save_partner_assistant_rules", { ...rules, body: "x".repeat(100001) }),
    ).toBeNull();
    expect(command("save_partner_assistant_rules", { ...rules, body: "" })).toBeNull();
    expect(command("save_partner_assistant_rules", { ...rules, body: "   " })).toBeNull();
    expect(command("save_partner_assistant_rules", { ...rules, body: "a\u0000b" })).toBeNull();
    expect(
      command("save_partner_assistant_rules", { ...rules, expected_version: 2147483647 }),
    ).not.toBeNull();
    expect(
      command("save_partner_assistant_rules", { ...rules, expected_version: 2147483648 }),
    ).toBeNull();
    expect(command("save_partner_assistant_rules", { body: rules.body })).toBeNull();
  });
});

describe("parser dei moduli", () => {
  const card: PartnerCardInput = {
    name: "  Negozio Sintetico ",
    city: "Torino",
    country: "Italia",
    typeLabel: "Negozio",
    sections: ["collab", "vendita"],
    priority: "alta",
    contactMonth: "2026-11",
    eventStartsOn: "",
    eventEndsOn: "",
    applicationDeadline: "",
    preferredChannel: "email",
  };

  it("scheda nuova e modifica, con le sezioni nell'ordine canonico", () => {
    const created = partnerCardPayload(card, null);
    expect(created).toEqual({
      ok: true,
      payload: {
        schema_version: 1,
        partner_id: null,
        name: "Negozio Sintetico",
        city: "Torino",
        country: "Italia",
        type_label: "Negozio",
        sections: ["vendita", "collab"],
        priority: "alta",
        contact_month: "2026-11-01",
        event_starts_on: null,
        event_ends_on: null,
        application_deadline: null,
        preferred_channel: "email",
      },
    });
    expect(
      command("save_partner", (created as { payload: Record<string, unknown> }).payload),
    ).not.toBeNull();
    const edited = partnerCardPayload(card, { partnerId: PARTNER, expectedVersion: 4 });
    expect(edited.ok && edited.payload.expected_version).toBe(4);
    expect(edited.ok && command("save_partner", edited.payload)).not.toBeNull();
  });

  it("errori per campo, in italiano", () => {
    const result = partnerCardPayload(
      {
        ...card,
        name: " ",
        sections: [],
        priority: "urgente",
        contactMonth: "2026-13",
        eventEndsOn: "2026-11-02",
        preferredChannel: "fax",
        city: "x".repeat(241),
      },
      null,
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        name: "Scrivi il nome.",
        city: "Al massimo 240 caratteri.",
        sections: "Scegli almeno una sezione.",
        priority: "Scegli la priorità.",
        contactMonth: "Scegli il mese in cui contattarli.",
        eventStartsOn: "Scegli anche il primo giorno dell’evento.",
        preferredChannel: "Scegli il canale preferito.",
      },
    });
    const backwards = partnerCardPayload(
      { ...card, eventStartsOn: "2026-11-03", eventEndsOn: "2026-11-02" },
      null,
    );
    expect(backwards).toEqual({
      ok: false,
      errors: { eventEndsOn: "L’evento finisce prima di iniziare." },
    });
  });

  it("stato e prossima azione: testo e data insieme, oppure niente", () => {
    const target = { partnerId: PARTNER, expectedVersion: 2 };
    expect(partnerStatePayload({ ...target, stage: "risposto" })).toEqual({
      ok: true,
      payload: { schema_version: 1, partner_id: PARTNER, expected_version: 2, stage: "risposto" },
    });
    expect(partnerStatePayload({ ...target, nextAction: { text: "", on: "" } })).toMatchObject({
      ok: true,
      payload: { next_action: null, next_action_on: null },
    });
    expect(partnerStatePayload({ ...target, nextAction: { text: "sollecito", on: "" } })).toEqual({
      ok: false,
      errors: { nextActionOn: "Scegli il giorno, oppure togli il testo." },
    });
    expect(partnerStatePayload({ ...target, nextAction: { text: " ", on: "2026-10-29" } })).toEqual(
      {
        ok: false,
        errors: { nextAction: "Scrivi la prossima azione, oppure togli la data." },
      },
    );
    const ok = partnerStatePayload({
      ...target,
      ownerId: null,
      nextAction: { text: " sollecito ", on: "2026-10-29" },
    });
    expect(ok.ok && command("set_partner_state", ok.payload)).toBeTruthy();
  });

  it("registro: oggi di default, niente futuro, nota con testo", () => {
    const base = { partnerId: PARTNER, occurredOn: "", channel: "email" as const, body: "" };
    expect(
      partnerActivityPayload({ ...base, kind: "inviato", approach: "collab" }, "2026-10-22"),
    ).toEqual({
      ok: true,
      payload: {
        schema_version: 1,
        partner_id: PARTNER,
        kind: "inviato",
        message_kind: "primo",
        channel: "email",
        approach: "collab",
      },
    });
    expect(
      partnerActivityPayload({ ...base, kind: "risposta", occurredOn: "2026-10-23" }, "2026-10-22"),
    ).toEqual({
      ok: false,
      errors: { occurredOn: "Il giorno non può essere nel futuro." },
    });
    expect(partnerActivityPayload({ ...base, kind: "nota" }, "2026-10-22")).toEqual({
      ok: false,
      errors: { body: "Scrivi la nota." },
    });
    const past = partnerActivityPayload(
      { ...base, kind: "chiamata", occurredOn: "2026-10-20", channel: "phone" },
      "2026-10-22",
    );
    expect(past.ok && past.payload.occurred_on).toBe("2026-10-20");
  });

  it("messaggio: almeno un testo; variante nuova con canale e lingua", () => {
    const texts = { subject: "Oggetto", body: "Testo", follow_up: "", confirm_email: "" };
    const saved = partnerMessagePayload({
      partnerId: PARTNER,
      approach: "collab",
      texts,
      existing: { expectedVersion: 3 },
    });
    expect(saved.ok && command("save_partner_message", saved.payload)).toBeTruthy();
    expect(
      partnerMessagePayload({
        partnerId: PARTNER,
        approach: "collab",
        texts: { subject: "", body: " ", follow_up: "", confirm_email: "" },
        existing: { expectedVersion: 3 },
      }),
    ).toEqual({ ok: false, errors: { texts: "Scrivi almeno un testo." } });
    // Il testo parte com'è, spazi compresi: il limite vale sul testo intero, come nel database.
    expect(
      partnerMessagePayload({
        partnerId: PARTNER,
        approach: "collab",
        texts: { subject: "", body: `${"x".repeat(7999)}   `, follow_up: "", confirm_email: "" },
        existing: { expectedVersion: 3 },
      }),
    ).toEqual({ ok: false, errors: { body: "Al massimo 8000 caratteri." } });
    const fresh = partnerMessagePayload({
      partnerId: PARTNER,
      approach: "media",
      texts,
      existing: null,
      channel: "dm",
      language: "it",
    });
    expect(fresh.ok && fresh.payload).toMatchObject({
      expected_version: null,
      channel: "dm",
      language: "it",
    });
    expect(fresh.ok && command("save_partner_message", fresh.payload)).toBeTruthy();
  });

  it("recapito: deve dare un pulsante, con un messaggio per tipo", () => {
    const base = { partnerId: PARTNER, label: "", existing: null };
    expect(
      partnerContactPayload({ ...base, kind: "email", value: "scrivere al titolare" }),
    ).toEqual({
      ok: false,
      errors: { value: "Scrivi un indirizzo email valido, per esempio nome@dominio.it." },
    });
    expect(partnerContactPayload({ ...base, kind: "web", value: "garage.example.test" })).toEqual({
      ok: false,
      errors: { value: "Scrivi l’indirizzo del sito, che inizia con https://." },
    });
    const ok = partnerContactPayload({
      ...base,
      kind: "phone",
      value: " +39 000 000 0009 ",
      verified: true,
    });
    expect(ok).toEqual({
      ok: true,
      payload: {
        schema_version: 1,
        contact_id: null,
        partner_id: PARTNER,
        expected_version: null,
        kind: "phone",
        value: "+39 000 000 0009",
        label: "",
        verified: true,
      },
    });
    expect(ok.ok && command("save_partner_contact", ok.payload)).toBeTruthy();
  });

  it("«Non contattare»: motivo di almeno 3 caratteri per mettere, niente per togliere", () => {
    expect(
      partnerDoNotContactPayload({
        partnerId: PARTNER,
        active: true,
        reason: "no",
        includeDomain: false,
      }),
    ).toEqual({
      ok: false,
      errors: { reason: "Scrivi il motivo: almeno 3 caratteri." },
    });
    const on = partnerDoNotContactPayload({
      partnerId: PARTNER,
      active: true,
      reason: " Chiesto. ",
      includeDomain: true,
    });
    expect(on.ok && on.payload).toEqual({
      schema_version: 1,
      partner_id: PARTNER,
      active: true,
      reason: "Chiesto.",
      include_domain: true,
    });
    const off = partnerDoNotContactPayload({
      partnerId: PARTNER,
      active: false,
      reason: "",
      includeDomain: false,
    });
    expect(off.ok && command("set_partner_do_not_contact", off.payload)).toBeTruthy();
  });
});

describe("esiti dei comandi", () => {
  it("errori del database tradotti come spec 02 §5.11", () => {
    expect(partnerCommandRejection({ code: "40001", message: "partner_changed" }, false)).toEqual({
      status: "rejected",
      code: "partner_changed",
      message:
        "Un collega ha appena modificato questo contatto. Ricarico i dati: controlla e riprova.",
      refresh: true,
    });
    // Modalità e regole non sono un contatto: il conflitto dice che cosa è cambiato.
    const changed = { code: "40001", message: "partner_changed" };
    expect(partnerCommandRejection(changed, false, "set_partner_assistant_mode")).toEqual({
      status: "rejected",
      code: "partner_changed",
      message:
        "Un collega ha appena cambiato le impostazioni dell'assistente. Ricarico i dati: controlla e riprova.",
      refresh: true,
    });
    expect(partnerCommandRejection(changed, false, "save_partner_assistant_rules")?.message).toBe(
      "Un collega ha appena salvato una nuova versione delle regole. Ricarico i dati: controlla e riprova.",
    );
    expect(partnerCommandRejection(changed, false, "set_partner_state")?.message).toBe(
      "Un collega ha appena modificato questo contatto. Ricarico i dati: controlla e riprova.",
    );
    expect(
      partnerCommandRejection({ code: "42501", message: "partner_access_required" }, false)
        ?.message,
    ).toBe("I permessi del tuo account sono cambiati. Accedi di nuovo.");
    expect(
      partnerCommandRejection({ code: "23505", message: "partner_idempotency_conflict" }, false)
        ?.message,
    ).toBe("Operazione già usata con dati diversi. Ricarica la pagina.");
    expect(
      partnerCommandRejection({ code: "55000", message: "partner_do_not_contact" }, false)?.message,
    ).toBe("Questo contatto è nella lista «Non contattare».");
    expect(
      partnerCommandRejection({ code: "22023", message: "partner_owner_inactive" }, false)?.code,
    ).toBe("partner_owner_inactive");
  });

  it("errori dei comandi dell'assistente", () => {
    expect(
      partnerCommandRejection(
        { code: "42501", message: "partner_assistant_founder_required" },
        false,
      ),
    ).toEqual({
      status: "rejected",
      code: "partner_assistant_founder_required",
      message: "Solo Tommi può farlo.",
      refresh: false,
    });
    expect(
      partnerCommandRejection(
        { code: "22023", message: "partner_assistant_mode_unavailable" },
        false,
      )?.message,
    ).toBe("Prova e invio arrivano con la seconda consegna.");
    expect(
      partnerCommandRejection({ code: "55000", message: "partner_assistant_not_configured" }, false)
        ?.message,
    ).toBe("L'assistente non è ancora configurato: serve il passo di avvio con Tommi.");
    expect(
      partnerCommandRejection(
        { code: "22023", message: "partner_assistant_founder_required" },
        false,
      ),
    ).toBeNull();
  });

  it("errori dei comandi dell'invio", () => {
    const message = (code: string, message: string) =>
      partnerCommandRejection({ code, message }, false)?.message;
    expect(message("55000", "partner_assistant_test_required")).toBe(
      "Prima di «Invio» serve una prova confermata da Tommi.",
    );
    expect(message("55000", "partner_assistant_test_missing")).toBe(
      "Nessuna email dell'ultima prova è partita nelle ultime 24 ore: manda una prova nuova.",
    );
    expect(message("55000", "prova_in_corso")).toBe(
      "La prova di prima non è ancora finita: aspetta che partano le sue email.",
    );
    expect(message("22023", "prova_in_corso")).toBeUndefined();
    expect(message("55000", "partner_assistant_test_mode_required")).toBe(
      "La prova si manda con l'assistente in «Prova».",
    );
    expect(message("55000", "partner_assistant_test_empty")).toBe(
      "Non ci sono bozze pronte da mandare in prova.",
    );
    expect(message("22023", "partner_assistant_test_empty")).toBeUndefined();
    // Conferma della prova e limite: il conflitto è sulle impostazioni dell'assistente.
    const changed = { code: "40001", message: "partner_changed" };
    for (const kind of [
      "confirm_partner_assistant_test",
      "set_partner_assistant_settings",
    ] as const)
      expect(partnerCommandRejection(changed, false, kind)?.message, kind).toBe(
        "Un collega ha appena cambiato le impostazioni dell'assistente. Ricarico i dati: controlla e riprova.",
      );
  });

  it("i rifiuti dell'azione non sono codici del database", () => {
    expect(PARTNER_ASSISTANT_ACTION_MESSAGES).toEqual({
      partner_assistant_mail_not_configured:
        "La posta dell'assistente non è configurata: «Prova» e «Invio» non sono disponibili.",
      partner_assistant_test_to_changed:
        "Gli indirizzi di prova sono cambiati: ricarica la pagina e riprova.",
    });
    const sql = teamSql();
    for (const code of Object.keys(PARTNER_ASSISTANT_ACTION_MESSAGES)) {
      expect(Object.hasOwn(PARTNER_ERROR_MESSAGES, code), code).toBe(false);
      expect(sql, code).not.toContain(code);
      // Anche se il database lo scrivesse, non sarebbe un esito certo.
      expect(partnerCommandRejection({ code: "55000", message: code }, false), code).toBeNull();
    }
  });

  it("codice sconosciuto o SQLSTATE diverso: esito da verificare", () => {
    expect(
      partnerCommandRejection({ code: "23505", message: "duplicate key value" }, false),
    ).toBeNull();
    expect(
      partnerCommandRejection({ code: "XX000", message: "partner_changed" }, false),
    ).toBeNull();
    expect(partnerCommandRejection({}, false)).toBeNull();
  });

  it("in una ripetizione accesso e payload non validi non sono un esito certo", () => {
    expect(
      partnerCommandRejection({ code: "42501", message: "partner_access_required" }, true),
    ).toBeNull();
    expect(
      partnerCommandRejection({ code: "22023", message: "invalid_partner_payload" }, true),
    ).toBeNull();
    expect(
      partnerCommandRejection({ code: "40001", message: "partner_changed" }, true)?.status,
    ).toBe("rejected");
  });

  it("ogni codice d'errore delle migrazioni dei comandi ha il suo messaggio", () => {
    const sql = teamSql();
    const raised = new Set(
      [...sql.matchAll(/raise exception '([a-z_]+)' using errcode = '([0-9A-Z]{5})'/g)]
        .filter(
          (match) =>
            !match[1].includes("research") &&
            !match[1].startsWith("partner_batch") &&
            match[1] !== "partner_import_incomplete" &&
            // Solo il trigger dei messaggi, che nessun comando del team tocca.
            match[1] !== "partner_assistant_message_immutable" &&
            // Solo le RPC d'invio del worker (sezione 2): non arriva mai alla pagina.
            match[1] !== "partner_assistant_worker_access_required",
        )
        .map((match) => `${match[1]}:${match[2]}`),
    );
    expect([...raised].sort()).toEqual(
      Object.entries(PARTNER_ERROR_MESSAGES)
        .map(([code, { sqlstate }]) => `${code}:${sqlstate}`)
        .sort(),
    );
  });

  const parsed = (kind: string, payload = VALID[kind]) => command(kind, payload) as PartnerCommand;

  it("legge le risposte delle RPC e scrive la conferma", () => {
    const state = partnerCommandOutcome(parsed("record_partner_activity"), {
      id: PARTNER,
      version: 5,
      stage: "contattato",
      activity_id: partnerFixtureId(2),
      occurred_at: "2026-10-22T10:00:00+00:00",
      replayed: false,
    });
    expect(state).toMatchObject({
      status: "success",
      partnerId: PARTNER,
      version: 5,
      stage: "contattato",
      message: "Registrato. Stato: Contattato.",
      occurredAt: "2026-10-22T10:00:00+00:00",
    });
    const created = partnerCommandOutcome(parsed("save_partner"), {
      id: PARTNER,
      co: 208,
      version: 1,
      activity_id: partnerFixtureId(2),
      replayed: true,
    });
    expect(created?.message).toBe(
      "Contatto aggiunto: CO 208. Era già registrato: nessun doppione.",
    );
    const imported = partnerCommandOutcome(parsed("import_partner_device_file"), {
      id: partnerFixtureId(3),
      device: "telefono",
      exported_at: "2026-10-20T17:30:00+00:00",
      stages_applied: 10,
      texts_applied: 3,
      approaches_applied: 4,
      differences: 2,
      ignored: 1,
      unknown: 0,
      replayed: false,
    });
    expect(imported?.message).toBe(
      "File importato: 10 stati, 3 testi, 4 approcci. 2 differenze da controllare.",
    );
    const blocked = partnerCommandOutcome(parsed("set_partner_do_not_contact"), {
      id: PARTNER,
      block_id: partnerFixtureId(4),
      active: true,
      blocked: true,
      activity_id: null,
      replayed: false,
    });
    expect(blocked).toMatchObject({ blocked: true, message: "Messo tra i non contattare." });
    const erase = parsed("remove_partner_contact", {
      ...VALID.remove_partner_contact,
      erase: true,
    });
    const erased = (messagesCleaned: number) =>
      partnerCommandOutcome(erase, {
        id: partnerFixtureId(5),
        partner_id: PARTNER,
        version: 3,
        erased: true,
        messages_cleaned: messagesCleaned,
        activity_id: partnerFixtureId(6),
        replayed: false,
      })?.message;
    expect(erased(0)).toBe("Dato cancellato. Toglilo anche dalla ricerca.");
    expect(erased(2)).toBe(
      "Dato cancellato, anche dai destinatari dei messaggi. Toglilo anche dalla ricerca.",
    );
  });

  it("comandi dell'assistente: conferme, versione e contatto dal risultato", () => {
    const mode = partnerCommandOutcome(parsed("set_partner_assistant_mode"), {
      id: partnerFixtureId(7),
      version: 2,
      mode: "prepara",
      replayed: false,
    });
    expect(mode).toMatchObject({
      status: "success",
      kind: "set_partner_assistant_mode",
      id: partnerFixtureId(7),
      partnerId: null,
      version: 2,
      message: "Modalità dell'assistente salvata.",
    });
    const contact = partnerCommandOutcome(parsed("set_partner_assistant_contact"), {
      id: partnerFixtureId(8),
      partner_id: PARTNER,
      version: 3,
      replayed: false,
    });
    expect(contact).toMatchObject({
      partnerId: PARTNER,
      version: 3,
      message: "Assistente aggiornato su questo contatto.",
    });
    const rules = partnerCommandOutcome(parsed("save_partner_assistant_rules"), {
      id: partnerFixtureId(9),
      version: 2,
      requeued: 1,
      replayed: true,
    });
    expect(rules).toMatchObject({
      partnerId: null,
      version: 2,
      message: "Regole dell'assistente salvate. Era già registrato: nessun doppione.",
    });
    expect(
      partnerCommandOutcome(parsed("set_partner_assistant_contact"), {
        id: partnerFixtureId(8),
        version: 3,
        replayed: false,
      }),
    ).toBeNull();
    expect(
      partnerCommandOutcome(parsed("save_partner_assistant_rules"), {
        id: partnerFixtureId(9),
        requeued: 0,
        replayed: false,
      }),
    ).toBeNull();
  });

  it("comandi dell'invio: conferme dal risultato, anche senza versione", () => {
    // «Manda la prova» e «Riprendi l'invio» non hanno versione: senza, l'esito sarebbe null.
    const test = partnerCommandOutcome(parsed("start_partner_assistant_test"), {
      id: partnerFixtureId(10),
      test_run_id: partnerFixtureId(10),
      drafts: 2,
      recipients: 3,
      replayed: false,
    });
    expect(test).toMatchObject({
      status: "success",
      kind: "start_partner_assistant_test",
      id: partnerFixtureId(10),
      partnerId: null,
      version: null,
      message: "Prova avviata: partono 6 email di prova, una ogni 4-11 minuti.",
    });
    // Il numero viene dal risultato (le bozze trovate), non dalla richiesta.
    expect(
      partnerCommandOutcome(parsed("start_partner_assistant_test"), {
        id: partnerFixtureId(10),
        test_run_id: partnerFixtureId(10),
        drafts: 1,
        recipients: 3,
        replayed: true,
      })?.message,
    ).toBe(
      "Prova avviata: partono 3 email di prova, una ogni 4-11 minuti. Era già registrato: nessun doppione.",
    );
    const resumed = partnerCommandOutcome(parsed("resume_partner_assistant_send"), {
      id: partnerFixtureId(11),
      status: "ripreso",
      replayed: false,
    });
    expect(resumed).toMatchObject({ status: "success", version: null, message: "Invii ripresi." });
    const confirmed = partnerCommandOutcome(parsed("confirm_partner_assistant_test"), {
      id: partnerFixtureId(12),
      version: 5,
      test_confirmed_at: "2026-10-22T10:00:00+00:00",
      replayed: false,
    });
    expect(confirmed).toMatchObject({
      version: 5,
      message: "Prova confermata: ora si può scegliere «Invio».",
    });
    const priority = partnerCommandOutcome(parsed("set_partner_assistant_send_priority"), {
      id: partnerFixtureId(13),
      partner_id: PARTNER,
      send_priority: 9,
      version: 2,
      replayed: false,
    });
    expect(priority).toMatchObject({
      partnerId: PARTNER,
      version: 2,
      message: "Precedenza d'invio salvata.",
    });
    const settings = partnerCommandOutcome(parsed("set_partner_assistant_settings"), {
      id: partnerFixtureId(14),
      version: 6,
      daily_first_limit: 8,
      replayed: false,
    });
    expect(settings).toMatchObject({
      version: 6,
      message:
        "Limite salvato: dopo la prima settimana partono al massimo 8 prime email al giorno.",
    });
    // Forme che non tornano: esito da verificare.
    for (const [kind, value] of [
      ["start_partner_assistant_test", { id: PARTNER, test_run_id: PARTNER, replayed: false }],
      [
        "start_partner_assistant_test",
        { id: PARTNER, test_run_id: PARTNER, drafts: 4, recipients: 3, replayed: false },
      ],
      [
        "start_partner_assistant_test",
        { id: PARTNER, test_run_id: PARTNER, drafts: 2, recipients: 0, replayed: false },
      ],
      [
        "start_partner_assistant_test",
        {
          id: PARTNER,
          test_run_id: partnerFixtureId(3),
          drafts: 2,
          recipients: 3,
          replayed: false,
        },
      ],
      ["resume_partner_assistant_send", { id: PARTNER, status: "fermo", replayed: false }],
      ["set_partner_assistant_settings", { id: PARTNER, version: 6, replayed: false }],
      [
        "set_partner_assistant_settings",
        { id: PARTNER, version: 6, daily_first_limit: 16, replayed: false },
      ],
      ["confirm_partner_assistant_test", { id: PARTNER, replayed: false }],
      [
        "set_partner_assistant_send_priority",
        { id: PARTNER, send_priority: 9, version: 2, replayed: false },
      ],
    ] as const)
      expect(
        partnerCommandOutcome(parsed(kind), value),
        `${kind} ${JSON.stringify(value)}`,
      ).toBeNull();
  });

  it("risposte con forma sbagliata: esito da verificare", () => {
    const activity = parsed("record_partner_activity");
    expect(partnerCommandOutcome(activity, null)).toBeNull();
    expect(
      partnerCommandOutcome(activity, { id: PARTNER, version: 5, replayed: false }),
    ).toBeNull();
    expect(
      partnerCommandOutcome(activity, {
        id: "x",
        version: 5,
        stage: "contattato",
        replayed: false,
      }),
    ).toBeNull();
    expect(
      partnerCommandOutcome(parsed("save_partner"), { id: PARTNER, version: 1, replayed: false }),
    ).toBeNull();
    expect(
      partnerCommandOutcome(parsed("import_partner_device_file"), { id: PARTNER, replayed: false }),
    ).toBeNull();
  });
});
