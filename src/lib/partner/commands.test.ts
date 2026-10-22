import { describe, expect, it } from "vitest";
import {
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
};

describe("controllo dei comandi sul server", () => {
  it("accetta un comando valido per ognuno dei dieci tipi", () => {
    expect(Object.keys(VALID)).toEqual([...PARTNER_COMMAND_KINDS]);
    for (const kind of PARTNER_COMMAND_KINDS)
      expect(command(kind, VALID[kind]), kind).toMatchObject({
        kind,
        operationId: OP,
        retry: false,
      });
  });

  it("le chiavi ammesse sono quelle delle funzioni SQL: mai created_by", () => {
    const migrations = join(__dirname, "../../../supabase/migrations");
    const sql = readFileSync(
      join(
        migrations,
        readdirSync(migrations).find((n) => n.endsWith("_partner_module.sql"))!,
      ),
      "utf8",
    );
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

  it("ogni codice d'errore della migrazione ha il suo messaggio", () => {
    const migrations = join(__dirname, "../../../supabase/migrations");
    const sql = readFileSync(
      join(
        migrations,
        readdirSync(migrations).find((n) => n.endsWith("_partner_module.sql"))!,
      ),
      "utf8",
    );
    const raised = new Set(
      [...sql.matchAll(/raise exception '([a-z_]+)' using errcode = '([0-9A-Z]{5})'/g)]
        .filter(
          (match) =>
            !match[1].includes("research") &&
            !match[1].startsWith("partner_batch") &&
            match[1] !== "partner_import_incomplete",
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
