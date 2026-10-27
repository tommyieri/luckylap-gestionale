import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { partnerAssistantSignature } from "../partner-assistant/checks";
import {
  PARTNER_ASSISTANT_MODE_LABELS,
  PARTNER_ASSISTANT_REASON_LABELS,
  PARTNER_ASSISTANT_REQUEST_LABELS,
  PARTNER_ASSISTANT_STATUS_LABELS,
  partnerAssistantContactFrom,
  partnerAssistantReasonLabel,
  partnerAssistantRulesFrom,
  partnerAssistantStatusFrom,
} from "./assistant";
import {
  partnerAssistantFixture,
  partnerAssistantFixtureRows,
  partnerFixtureId,
  partnerFixtureRows,
} from "./fixtures";
import { PartnerReadError, parsePartnerContact } from "./model";

// L'assistente visto dall'interfaccia: stato, blocco della scheda, regole ed etichette.
const TODAY = "2026-10-22";
const id = partnerFixtureId;
const ROOT = join(__dirname, "../../..");

/** La risposta di read_partner_assistant_status, con le chiavi della migrazione. */
const statusRow = (): Record<string, unknown> & {
  counts: Record<string, unknown>;
  to_review: Record<string, unknown>[];
  last_events: Record<string, unknown>[];
} => ({
  mode: "prepara",
  configured: true,
  paused_reason: null,
  backoff_until: null,
  last_tick_at: "2026-10-22T08:58:00.123456+00:00",
  version: 2,
  starting_credit_usd: 25,
  spent_usd: 1.372415,
  spent_today_usd: 0,
  counts: { in_coda: 3, attesa: 1, pronta: 2, serve_tommaso: 1, ferma: 0 },
  to_review: [
    {
      co: 951,
      name: "Club Sintetico",
      reason: "fatto_mancante",
      updated_at: "2026-10-21T10:00:00+00:00",
    },
  ],
  last_events: [
    {
      created_at: "2026-10-22T08:58:00+00:00",
      co: 951,
      step: "estrazione",
      outcome: "fatto_mancante",
    },
    { created_at: "2026-10-22T08:40:00+00:00", co: null, step: null, outcome: "pausa_credito" },
  ],
});
const broken = (change: (row: ReturnType<typeof statusRow>) => void) => {
  const row = statusRow();
  change(row);
  return () => partnerAssistantStatusFrom(row);
};

describe("stato dell'assistente (read_partner_assistant_status)", () => {
  it("riga valida: le chiavi della migrazione in camelCase", () => {
    expect(partnerAssistantStatusFrom(statusRow())).toEqual({
      mode: "prepara",
      configured: true,
      pausedReason: null,
      backoffUntil: null,
      lastTickAt: "2026-10-22T08:58:00.123456+00:00",
      version: 2,
      startingCreditUsd: 25,
      spentUsd: 1.372415,
      spentTodayUsd: 0,
      counts: { inCoda: 3, attesa: 1, pronta: 2, serveTommaso: 1, ferma: 0 },
      toReview: [
        {
          co: 951,
          name: "Club Sintetico",
          reason: "fatto_mancante",
          updatedAt: "2026-10-21T10:00:00+00:00",
        },
      ],
      lastEvents: [
        {
          createdAt: "2026-10-22T08:58:00+00:00",
          co: 951,
          step: "estrazione",
          outcome: "fatto_mancante",
        },
        { createdAt: "2026-10-22T08:40:00+00:00", co: null, step: null, outcome: "pausa_credito" },
      ],
    });
  });

  it("pausa per credito, attesa e credito non impostato", () => {
    const status = partnerAssistantStatusFrom({
      ...statusRow(),
      mode: "spento",
      configured: false,
      paused_reason: "credito",
      backoff_until: "2026-10-22T09:08:00Z",
      last_tick_at: null,
      starting_credit_usd: null,
      to_review: [],
      last_events: [],
    });
    expect(status).toMatchObject({
      mode: "spento",
      configured: false,
      pausedReason: "credito",
      backoffUntil: "2026-10-22T09:08:00Z",
      lastTickAt: null,
      startingCreditUsd: null,
      toReview: [],
      lastEvents: [],
    });
  });

  it("chiave in più o in meno, anche dentro conteggi, lavori da vedere ed eventi: errore", () => {
    expect(
      broken((row) => {
        row.extra = 1;
      }),
    ).toThrow(PartnerReadError);
    expect(
      broken((row) => {
        delete row.spent_today_usd;
      }),
    ).toThrow(PartnerReadError);
    expect(
      broken((row) => {
        row.counts.chiusa = 0;
      }),
    ).toThrow(PartnerReadError);
    expect(
      broken((row) => {
        delete row.counts.ferma;
      }),
    ).toThrow(PartnerReadError);
    expect(
      broken((row) => {
        row.to_review[0].email = "info@club.example.test";
      }),
    ).toThrow(PartnerReadError);
    expect(
      broken((row) => {
        delete row.last_events[0].step;
      }),
    ).toThrow(PartnerReadError);
    // Le chiavi in camelCase non sono quelle della RPC.
    expect(() => partnerAssistantStatusFrom(partnerAssistantStatusFrom(statusRow()))).toThrow(
      PartnerReadError,
    );
    for (const value of [null, [], "stato", 1])
      expect(() => partnerAssistantStatusFrom(value)).toThrow(PartnerReadError);
  });

  it("numero negativo o non intero: errore", () => {
    const changes: ((row: ReturnType<typeof statusRow>) => void)[] = [
      (row) => (row.spent_usd = -0.01),
      (row) => (row.spent_today_usd = -1),
      (row) => (row.starting_credit_usd = -5),
      (row) => (row.spent_usd = Number.POSITIVE_INFINITY),
      (row) => (row.spent_usd = "1.37"),
      (row) => (row.counts.pronta = -1),
      (row) => (row.counts.attesa = 1.5),
      (row) => (row.version = 0),
      (row) => (row.to_review[0].co = -951),
      (row) => (row.last_events[0].co = 0),
    ];
    for (const change of changes) expect(broken(change)).toThrow(PartnerReadError);
  });

  it("data non valida: errore", () => {
    const changes: ((row: ReturnType<typeof statusRow>) => void)[] = [
      (row) => (row.last_tick_at = "2026-13-01T08:00:00Z"),
      (row) => (row.backoff_until = "2026-02-30T10:00:00Z"),
      (row) => (row.last_tick_at = "ieri"),
      (row) => (row.last_tick_at = "2026-10-22"),
      (row) => (row.to_review[0].updated_at = ""),
      (row) => (row.last_events[0].created_at = null),
    ];
    for (const change of changes) expect(broken(change)).toThrow(PartnerReadError);
  });

  it("valori fuori elenco: errore", () => {
    const changes: ((row: ReturnType<typeof statusRow>) => void)[] = [
      (row) => (row.mode = "acceso"),
      (row) => (row.paused_reason = "rete"),
      (row) => (row.configured = "sì"),
      (row) => (row.last_events[0].step = "invio"),
      (row) => (row.last_events[0].outcome = "Fatto!"),
      (row) => (row.to_review[0].reason = ""),
      (row) => (row.to_review[0].name = ""),
    ];
    for (const change of changes) expect(broken(change)).toThrow(PartnerReadError);
  });
});

/** Righe del blocco per un contatto della fixture, con i recapiti già letti. */
function contactRows(co: number, today = TODAY) {
  const assistant = partnerAssistantFixtureRows(today);
  const partnerId = id(co);
  return {
    partnerId,
    contacts: partnerFixtureRows(today)
      .contacts.filter((contact) => contact.partner_id === partnerId)
      .map(parsePartnerContact),
    switch: assistant.switches.find((row) => row.partner_id === partnerId) ?? null,
    job: assistant.jobs.find((row) => row.partner_id === partnerId) ?? null,
    notes: assistant.notes.filter((row) => row.partner_id === partnerId),
    draft: assistant.drafts.find((row) => row.partner_id === partnerId) ?? null,
  };
}

describe("blocco dell'assistente nella scheda", () => {
  it("bozza pronta: ricerca, scelta e bozza con l'indirizzo del recapito", () => {
    const view = partnerAssistantContactFrom(contactRows(2));
    expect(view.active).toBe(true);
    expect(view.switchVersion).toBeNull();
    expect(view.job).toMatchObject({ status: "pronta", step: "controllo", reason: null });
    expect(view.research?.sources).toEqual(["https://raduno-due.example.test/espositori"]);
    expect(view.research?.text).toContain("Raduno Sintetico Due");
    // Raduno nei Paesi Bassi, non raggiungibile: magliette co-firmate, non lo stand.
    expect(view.choice).toEqual({
      request: "merch_cobranding",
      reasonIt: expect.stringContaining("raduno"),
      language: "en",
      proposedEmail: "booking@raduno-due.example.test",
    });
    expect(view.draft).toMatchObject({
      toAddress: "info@raduno-due.example.test",
      rulesVersion: 2,
    });
    expect(view.draft?.signature).toBe(partnerAssistantSignature("en", "+39 000 000 0000"));
  });

  it("Serve Tommi con il motivo, senza bozza", () => {
    const view = partnerAssistantContactFrom(contactRows(1));
    expect(view.job).toMatchObject({ status: "serve_tommaso", reason: "fatto_mancante" });
    expect(view.choice?.request).toBe("vendita_negozio");
    expect(view.draft).toBeNull();
  });

  it("solo l'interruttore: fermo, senza lavoro", () => {
    expect(partnerAssistantContactFrom(contactRows(4))).toEqual({
      active: false,
      switchVersion: 1,
      job: null,
      research: null,
      choice: null,
      draft: null,
    });
  });

  it("recapito cancellato: la bozza resta senza indirizzo", () => {
    const rows = contactRows(2);
    const draftContact = rows.draft!.contact_id;
    rows.contacts = rows.contacts.map((contact) =>
      contact.id === draftContact
        ? {
            ...contact,
            value: null,
            linkValue: null,
            active: false,
            erasedAt: `${TODAY}T10:00:00Z`,
          }
        : contact,
    );
    expect(partnerAssistantContactFrom(rows).draft?.toAddress).toBeNull();
  });

  it("valori sconosciuti o riferimenti che non tornano: errore", () => {
    const changes: ((rows: ReturnType<typeof contactRows>) => void)[] = [
      (rows) => {
        const choice = rows.notes.find((note) => note.kind === "scelta")!;
        choice.content = { ...(choice.content as object), request: "conto_vendita" };
      },
      (rows) => {
        const choice = rows.notes.find((note) => note.kind === "scelta")!;
        choice.content = { ...(choice.content as object), language: "pt" };
      },
      (rows) => (rows.job!.status = "inviata"),
      (rows) => (rows.job!.write_on = "2026-02-30"),
      (rows) => (rows.job!.updated_at = "ieri"),
      (rows) => (rows.draft = null),
      (rows) => (rows.notes = rows.notes.filter((note) => note.kind !== "ricerca")),
      (rows) => (rows.notes[0].partner_id = id(1)),
      (rows) => (rows.draft!.contact_id = id(101)),
      (rows) => (rows.draft!.subject = ""),
      (rows) => (rows.draft!.rules_version = 0),
      (rows) => {
        const research = rows.notes.find((note) => note.kind === "ricerca")!;
        research.sources = ["http://raduno-due.example.test/"];
      },
    ];
    for (const change of changes) {
      const rows = contactRows(2);
      change(rows);
      expect(() => partnerAssistantContactFrom(rows)).toThrow(PartnerReadError);
    }
  });
});

describe("regole dell'assistente", () => {
  it("quella in vigore con il testo, la cronologia con gli autori", () => {
    const { rules } = partnerAssistantFixture(TODAY);
    expect(rules.current).toMatchObject({ version: 2, author: "Ada Prova" });
    expect(rules.current.body).toContain("# Regole sintetiche dell'assistente");
    expect(rules.history).toEqual([
      { version: 2, createdAt: expect.any(String), author: "Ada Prova" },
      { version: 1, createdAt: expect.any(String), author: "Regole iniziali" },
    ]);
  });

  it("regola in vigore che non è l'ultima o autore sconosciuto: errore", () => {
    const assistant = partnerAssistantFixtureRows(TODAY);
    const profiles = partnerFixtureRows(TODAY).profiles;
    const [first, second] = assistant.rules;
    expect(() =>
      partnerAssistantRulesFrom({ current: first, history: assistant.rules, profiles }),
    ).toThrow(PartnerReadError);
    expect(() =>
      partnerAssistantRulesFrom({ current: second, history: assistant.rules, profiles: [] }),
    ).toThrow(PartnerReadError);
    expect(() => partnerAssistantRulesFrom({ current: second, history: [], profiles })).toThrow(
      PartnerReadError,
    );
  });
});

describe("etichette in italiano", () => {
  it("modalità, stati del lavoro e proposte", () => {
    expect(PARTNER_ASSISTANT_MODE_LABELS).toEqual({
      spento: "Spento",
      prepara: "Prepara",
      prova: "Prova",
      invio: "Invio",
    });
    expect(PARTNER_ASSISTANT_STATUS_LABELS).toEqual({
      in_coda: "In coda",
      attesa: "In attesa della data",
      pronta: "Bozza pronta",
      serve_tommaso: "Serve Tommi",
    });
    expect(PARTNER_ASSISTANT_REQUEST_LABELS).toEqual({
      merch_cobranding: "Merch co-firmato",
      collab_capsule: "Capsule insieme",
      stand_evento: "Stand all'evento",
      vendita_negozio: "Vendita in negozio",
    });
  });

  it("una frase per ogni motivo del brief, della SQL e del worker", () => {
    const sql = readFileSync(
      join(ROOT, "supabase/migrations/20261027140533_assistente_partner_worker.sql"),
      "utf8",
    );
    const worker = readFileSync(join(ROOT, "src/lib/partner-assistant/worker.ts"), "utf8");
    const all = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((m) => m[1]);
    // Motivi dei lavori passati a Tommi, motivi di stop e contesto cambiato.
    const fromSql = [
      ...all(sql, /reason = case ([\s\S]*?) end/g).flatMap((body) =>
        all(body, /then '([a-z_]+)'/g),
      ),
      ...all(sql, /'reason', array\[([^\]]*)\]/g).flatMap((list) => all(list, /'([a-z_]+)'/g)),
      ...all(sql, /'status', 'stop', 'reason', '([a-z_]+)'/g),
      ...all(sql, /'status', '(contesto_cambiato)'/g),
    ];
    const fromWorker = all(worker, /fail\("[a-z]+", "([a-z_]+)"\)/g);
    expect(fromSql).toEqual(
      expect.arrayContaining([
        "troppi_tentativi",
        "fatto_mancante",
        "fuso_mancante",
        "controlli_falliti",
        "seconda_lettura",
        "lease_persa",
        "non_idoneo",
        "contesto_cambiato",
      ]),
    );
    expect(fromWorker).toEqual(
      expect.arrayContaining(["risposta_non_valida", "tempo_insufficiente", "claude_attesa"]),
    );
    const brief = [
      "troppi_tentativi",
      "controlli_falliti",
      "seconda_lettura",
      "fatto_mancante",
      "fuso_mancante",
      "risposta_non_valida",
      "timeout",
      "troppe_continuazioni",
      "claude_attesa",
      "tempo_insufficiente",
      "contesto_cambiato",
    ];
    for (const reason of new Set([...brief, ...fromSql, ...fromWorker])) {
      const label = (PARTNER_ASSISTANT_REASON_LABELS as Record<string, string>)[reason];
      expect(label, reason).toMatch(/^[A-ZÈ].*\.$/);
      expect(label, reason).not.toContain("Tommaso");
      expect(partnerAssistantReasonLabel(reason)).toBe(label);
    }
    expect(partnerAssistantReasonLabel("motivo_nuovo")).toBe("Motivo non riconosciuto.");
  });
});

describe("dati sintetici dell'assistente", () => {
  it("le fixture passano i parser, con lavori da vedere ed eventi", () => {
    const { status, rules } = partnerAssistantFixture(TODAY);
    expect(status.mode).toBe("prepara");
    expect(status.toReview).toEqual([
      expect.objectContaining({ co: 1, name: "Garage Sintetico Uno", reason: "fatto_mancante" }),
    ]);
    expect(status.lastEvents.length).toBeGreaterThanOrEqual(5);
    expect(status.lastEvents.map((event) => event.createdAt)).toEqual(
      [...status.lastEvents.map((event) => event.createdAt)].sort().reverse(),
    );
    expect(rules.current.version).toBe(2);
    // I conteggi tornano con i lavori e gli interruttori delle righe sintetiche.
    const rows = partnerAssistantFixtureRows(TODAY);
    const jobs = (status: string) => rows.jobs.filter((job) => job.status === status).length;
    expect(status.counts).toEqual({
      inCoda: jobs("in_coda"),
      attesa: jobs("attesa"),
      pronta: jobs("pronta"),
      serveTommaso: jobs("serve_tommaso"),
      ferma: rows.switches.filter((row) => !row.active).length,
    });
  });

  it("solo dati sintetici: email example.test, telefono +39 000 000 0000, link example.test", () => {
    for (const today of [TODAY, "2026-12-31"]) {
      const text = JSON.stringify(partnerAssistantFixtureRows(today));
      const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
      expect(emails.length).toBeGreaterThan(0);
      for (const email of emails) expect(email).toMatch(/\.example\.test$/);
      const phones = text.match(/\+\d[\d ]{6,}\d/g) ?? [];
      expect(phones.length).toBeGreaterThan(0);
      for (const phone of phones) expect(phone).toBe("+39 000 000 0000");
      // Unica eccezione: il sito di LuckyLap, nel corpo e nella firma di ogni bozza.
      for (const url of text.match(/https?:\/\/[^\s"|\\]+/g) ?? [])
        expect(new URL(url.replace(/[.,;:]+$/, "")).hostname).toMatch(
          /(^|\.)example\.test$|^luckylap\.com$/,
        );
      expect(text).not.toMatch(/Tommi\b/);
    }
  });
});
