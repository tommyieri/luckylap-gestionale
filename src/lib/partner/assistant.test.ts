import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  partnerAssistantDraftSha256,
  partnerAssistantSignature,
} from "../partner-assistant/checks";
import {
  PARTNER_ASSISTANT_COUNT_LABELS,
  PARTNER_ASSISTANT_EVENT_LABELS,
  PARTNER_ASSISTANT_EVENT_STEPS,
  PARTNER_ASSISTANT_JOB_STATUSES,
  PARTNER_ASSISTANT_SEND_STATUS_LABELS,
  PARTNER_ASSISTANT_STOP_LABELS,
  PARTNER_ASSISTANT_INACTIVE,
  PARTNER_ASSISTANT_MODE_LABELS,
  PARTNER_ASSISTANT_REASON_LABELS,
  PARTNER_ASSISTANT_REQUEST_LABELS,
  PARTNER_ASSISTANT_STATUS_LABELS,
  PARTNER_ASSISTANT_UNREADABLE,
  formatPartnerAssistantUsd,
  isPartnerAssistantMissing,
  parsePartnerAssistantCredit,
  partnerAssistantContactFrom,
  partnerAssistantEventLabel,
  partnerAssistantLoginLine,
  partnerAssistantReasonInline,
  partnerAssistantReasonLabel,
  partnerAssistantRulesFrom,
  partnerAssistantSendFrom,
  partnerAssistantStatusFrom,
  type PartnerAssistantContactView,
} from "./assistant";
import {
  partnerAssistantFixture,
  partnerAssistantFixtureRows,
  partnerFixtureDetail,
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
      (row) => (row.last_events[0].step = "spedizione"),
      (row) => (row.last_events[0].outcome = "Fatto!"),
      (row) => (row.to_review[0].reason = ""),
      (row) => (row.to_review[0].name = ""),
    ];
    for (const change of changes) expect(broken(change)).toThrow(PartnerReadError);
  });
});

describe("stato con l'invio", () => {
  it("un evento d'invio (step «invio») si legge", () => {
    const row = statusRow();
    row.last_events.unshift({
      created_at: "2026-10-22T08:59:00+00:00",
      co: 951,
      step: "invio",
      outcome: "invio_inviato",
    });
    expect(partnerAssistantStatusFrom(row).lastEvents[0]).toEqual({
      createdAt: "2026-10-22T08:59:00+00:00",
      co: 951,
      step: "invio",
      outcome: "invio_inviato",
    });
    expect(PARTNER_ASSISTANT_EVENT_STEPS).toEqual([
      "ricerca",
      "estrazione",
      "scrittura",
      "controllo",
      "invio",
    ]);
  });

  it("un lavoro «inviata» si legge, con la sua etichetta", () => {
    expect(PARTNER_ASSISTANT_JOB_STATUSES).toContain("inviata");
    const rows = contactRows(2);
    rows.job!.status = "inviata";
    const view = partnerAssistantContactFrom(rows);
    expect(view.job?.status).toBe("inviata");
    expect(PARTNER_ASSISTANT_STATUS_LABELS.inviata).toBe("Email inviata");
  });
});

/** La risposta di read_partner_assistant_send, con le chiavi della migrazione. */
const sendRow = (): Record<string, unknown> & {
  test_run: Record<string, unknown> | null;
  recent: Record<string, unknown>[];
  priorities: Record<string, unknown>[];
} => ({
  stop_reason: null,
  stopped_at: null,
  day_stopped_on: null,
  backoff_until: null,
  next_send_after: "2026-10-30T08:47:00+00:00",
  last_tick_at: "2026-10-30T08:40:00.123456+00:00",
  last_outcome: "copia_salvata",
  daily_first_limit: 10,
  first_limit_today: 5,
  first_sent_today: 2,
  first_real_send_on: "2026-10-30",
  test_sent_today: 0,
  test_limit: 15,
  test_confirmed_at: "2026-10-29T10:12:00+00:00",
  test_confirmed_by: "Ada Prova",
  test_run: {
    requested_at: "2026-10-29T09:00:00+00:00",
    drafts: 2,
    recipients: 3,
    sent: 6,
  },
  window_open_rome: true,
  next_window_rome: "2026-10-30T08:40:00+00:00",
  ready: 4,
  env_checked_at: "2026-10-30T08:40:00+00:00",
  env_mailbox_ok: true,
  env_test_ok: true,
  env_test_count: 3,
  smtp_login_at: "2026-10-30T08:41:00+00:00",
  smtp_login_code: "ok",
  imap_login_at: null,
  imap_login_code: null,
  recent: [
    {
      at: "2026-10-30T08:41:12+00:00",
      co: 951,
      name: "Club Sintetico",
      mode: "invio",
      status: "inviato",
      subject: "Club Sintetico and LuckyLap",
    },
    {
      at: "2026-10-29T09:20:00+00:00",
      co: 952,
      name: "Raduno Sintetico",
      mode: "prova",
      status: "inviato",
      subject: "Raduno Sintetico and LuckyLap",
    },
  ],
  priorities: [{ co: 951, name: "Club Sintetico", send_priority: 9 }],
});
const brokenSend = (change: (row: ReturnType<typeof sendRow>) => void) => {
  const row = sendRow();
  change(row);
  return () => partnerAssistantSendFrom(row);
};

describe("invio dell'assistente (read_partner_assistant_send)", () => {
  it("riga valida: le chiavi della migrazione in camelCase", () => {
    expect(partnerAssistantSendFrom(sendRow())).toEqual({
      stopReason: null,
      stoppedAt: null,
      dayStoppedOn: null,
      backoffUntil: null,
      nextSendAfter: "2026-10-30T08:47:00+00:00",
      lastTickAt: "2026-10-30T08:40:00.123456+00:00",
      lastOutcome: "copia_salvata",
      dailyFirstLimit: 10,
      firstLimitToday: 5,
      firstSentToday: 2,
      firstRealSendOn: "2026-10-30",
      testSentToday: 0,
      testLimit: 15,
      testConfirmedAt: "2026-10-29T10:12:00+00:00",
      testConfirmedBy: "Ada Prova",
      testRun: { requestedAt: "2026-10-29T09:00:00+00:00", drafts: 2, recipients: 3, sent: 6 },
      windowOpenRome: true,
      nextWindowRome: "2026-10-30T08:40:00+00:00",
      ready: 4,
      envCheckedAt: "2026-10-30T08:40:00+00:00",
      envMailboxOk: true,
      envTestOk: true,
      envTestCount: 3,
      smtpLoginAt: "2026-10-30T08:41:00+00:00",
      smtpLoginCode: "ok",
      imapLoginAt: null,
      imapLoginCode: null,
      recent: [
        {
          at: "2026-10-30T08:41:12+00:00",
          co: 951,
          name: "Club Sintetico",
          mode: "invio",
          status: "inviato",
          subject: "Club Sintetico and LuckyLap",
        },
        {
          at: "2026-10-29T09:20:00+00:00",
          co: 952,
          name: "Raduno Sintetico",
          mode: "prova",
          status: "inviato",
          subject: "Raduno Sintetico and LuckyLap",
        },
      ],
      priorities: [{ co: 951, name: "Club Sintetico", sendPriority: 9 }],
    });
  });

  it("fermo, variabili mai controllate, nessuna prova: valori nulli ammessi", () => {
    const send = partnerAssistantSendFrom({
      ...sendRow(),
      stop_reason: "rimbalzi",
      stopped_at: "2026-10-30T08:45:00+00:00",
      day_stopped_on: "2026-10-30",
      backoff_until: "2026-10-30T09:00:00+00:00",
      next_send_after: null,
      last_tick_at: null,
      last_outcome: null,
      first_real_send_on: null,
      test_confirmed_at: null,
      test_confirmed_by: null,
      test_run: null,
      next_window_rome: null,
      env_checked_at: null,
      env_mailbox_ok: null,
      env_test_ok: null,
      env_test_count: null,
      smtp_login_at: null,
      smtp_login_code: null,
      recent: [],
      priorities: [],
    });
    expect(send).toMatchObject({
      stopReason: "rimbalzi",
      dayStoppedOn: "2026-10-30",
      testRun: null,
      envTestCount: null,
      recent: [],
      priorities: [],
    });
  });

  it("chiave in più o in meno, anche dentro prova, messaggi e priorità: errore", () => {
    const changes: ((row: ReturnType<typeof sendRow>) => void)[] = [
      (row) => (row.extra = 1),
      (row) => delete row.env_test_count,
      (row) => (row.test_run!.to_address = "prova1@example.test"),
      (row) => delete row.test_run!.sent,
      (row) => (row.recent[0].to_address = "info@club-951.example.test"),
      (row) => delete row.recent[0].subject,
      (row) => (row.priorities[0].id = id(1)),
    ];
    for (const change of changes) expect(brokenSend(change)).toThrow(PartnerReadError);
    // Le chiavi in camelCase non sono quelle della RPC.
    expect(() => partnerAssistantSendFrom(partnerAssistantSendFrom(sendRow()))).toThrow(
      PartnerReadError,
    );
    for (const value of [null, [], "invio", 1])
      expect(() => partnerAssistantSendFrom(value)).toThrow(PartnerReadError);
  });

  it("data non valida: errore", () => {
    const changes: ((row: ReturnType<typeof sendRow>) => void)[] = [
      (row) => (row.stopped_at = "2026-02-30T10:00:00Z"),
      (row) => (row.next_send_after = "domani"),
      (row) => (row.day_stopped_on = "2026-10-32"),
      (row) => (row.first_real_send_on = "2026-10-30T08:00:00Z"),
      (row) => (row.test_run!.requested_at = ""),
      (row) => (row.recent[0].at = null),
      (row) => (row.smtp_login_at = "2026-10-30"),
    ];
    for (const change of changes) expect(brokenSend(change)).toThrow(PartnerReadError);
  });

  it("numeri fuori dai limiti: errore", () => {
    const changes: ((row: ReturnType<typeof sendRow>) => void)[] = [
      (row) => (row.env_test_count = 6),
      (row) => (row.env_test_count = -1),
      (row) => (row.daily_first_limit = 16),
      (row) => (row.daily_first_limit = 0),
      (row) => (row.first_limit_today = 0),
      (row) => (row.first_sent_today = -1),
      (row) => (row.test_sent_today = 1.5),
      (row) => (row.ready = -1),
      (row) => (row.test_run!.drafts = 4),
      (row) => (row.test_run!.recipients = 0),
      (row) => (row.test_run!.sent = -1),
      (row) => (row.recent[0].co = 0),
      (row) => (row.priorities[0].send_priority = 0),
      (row) => (row.priorities[0].send_priority = 10),
      (row) => (row.recent = Array.from({ length: 21 }, () => ({ ...row.recent[0] }))),
      (row) => (row.priorities = Array.from({ length: 51 }, () => ({ ...row.priorities[0] }))),
    ];
    for (const change of changes) expect(brokenSend(change)).toThrow(PartnerReadError);
  });

  it("codici: solo minuscole, cifre e trattini bassi, mai testo del server", () => {
    const changes: ((row: ReturnType<typeof sendRow>) => void)[] = [
      (row) => (row.smtp_login_code = "535 5.7.8 Authentication credentials invalid"),
      (row) => (row.smtp_login_code = "Smtp_eauth"),
      (row) => (row.imap_login_code = "x".repeat(81)),
      (row) => (row.last_outcome = ""),
      (row) => (row.stop_reason = "spam"),
      (row) => (row.recent[0].status = "consegnato"),
      (row) => (row.recent[0].mode = "spento"),
      (row) => (row.window_open_rome = "sì"),
      (row) => (row.env_mailbox_ok = 1),
      (row) => (row.test_confirmed_by = ""),
      (row) => (row.recent[0].subject = ""),
    ];
    for (const change of changes) expect(brokenSend(change)).toThrow(PartnerReadError);
  });

  it("riga dell'accesso: mai provato, riuscito o non riuscito con il codice", () => {
    expect(partnerAssistantLoginLine(null, null)).toBe("mai provato");
    expect(partnerAssistantLoginLine("2026-10-30T08:41:00+00:00", "ok")).toBe("riuscito alle 9:41");
    expect(partnerAssistantLoginLine("2026-10-30T08:41:00+00:00", "smtp_eauth")).toBe(
      "non riuscito alle 9:41 (smtp_eauth)",
    );
    expect(partnerAssistantLoginLine("2026-10-30T14:05:00+00:00", "imap_auth")).toBe(
      "non riuscito alle 15:05 (imap_auth)",
    );
  });

  it("etichette dei messaggi e dei fermi", () => {
    expect(PARTNER_ASSISTANT_SEND_STATUS_LABELS).toEqual({
      pronto: "Pronta",
      in_invio: "In invio",
      inviato: "Inviata",
      incerto: "Incerta",
      respinto: "Respinta",
      scartato: "Non partita",
    });
    expect(PARTNER_ASSISTANT_STOP_LABELS).toEqual({
      casella: "La casella ha rifiutato la password.",
      rimbalzi: "Il server di posta ha rifiutato delle email.",
    });
    // Gli stati dei messaggi e i fermi sono quelli dei check della migrazione.
    const sql = readFileSync(
      join(ROOT, "supabase/migrations/20261028164029_assistente_partner_invio.sql"),
      "utf8",
    );
    const list = (pattern: RegExp) =>
      [...(pattern.exec(sql)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(Object.keys(PARTNER_ASSISTANT_SEND_STATUS_LABELS)).toEqual(
      list(/check \(send_status in \(([^)]*)\)\)/),
    );
    expect(Object.keys(PARTNER_ASSISTANT_STOP_LABELS)).toEqual(
      list(/stop_reason text check \(stop_reason in \(([^)]*)\)\)/),
    );
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
    messages: assistant.messages.filter(
      (row) =>
        row.partner_id === partnerId &&
        row.mode === "invio" &&
        ["inviato", "incerto", "respinto"].includes(row.send_status as string),
    ),
  };
}

describe("blocco dell'assistente nella scheda", () => {
  it("bozza pronta: ricerca, scelta e bozza con l'indirizzo del recapito", () => {
    const view = partnerAssistantContactFrom(contactRows(2));
    expect(view.active).toBe(true);
    // «Manda per primo»: la riga dell'interruttore porta la priorità d'invio.
    expect(view.switchVersion).toBe(1);
    expect(view.sendPriority).toBe(9);
    expect(view.sends).toEqual([]);
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
      sendPriority: 0,
      sends: [],
      job: null,
      research: null,
      choice: null,
      draft: null,
    });
  });

  it("nessuna riga: vista vuota con l'interruttore attivo, mai null", () => {
    expect(partnerAssistantContactFrom(contactRows(3))).toEqual({
      active: true,
      switchVersion: null,
      sendPriority: 0,
      sends: [],
      job: null,
      research: null,
      choice: null,
      draft: null,
    });
  });

  it("prima email inviata dall'assistente: lavoro «inviata» e invii, il più recente prima", () => {
    const view = partnerAssistantContactFrom(contactRows(6));
    expect(view.job).toMatchObject({ status: "inviata", reason: null });
    expect(view.sends).toEqual([
      { at: `${TODAY}T08:41:12.000Z`, status: "inviato", subject: expect.any(String) },
    ]);
    expect(PARTNER_ASSISTANT_STATUS_LABELS[view.job!.status]).toBe("Email inviata");
    // Un rifiuto non ha sent_at: vale la data del messaggio. Al massimo cinque, dal più recente.
    const rows = contactRows(6);
    const sent = rows.messages[0];
    rows.messages = [
      { ...sent, send_status: "respinto", sent_at: null, created_at: `${TODAY}T07:00:00.000Z` },
      sent,
      { ...sent, send_status: "incerto", sent_at: `${TODAY}T09:30:00Z` },
    ];
    expect(partnerAssistantContactFrom(rows).sends.map((item) => [item.at, item.status])).toEqual([
      [`${TODAY}T09:30:00Z`, "incerto"],
      [`${TODAY}T08:41:12.000Z`, "inviato"],
      [`${TODAY}T07:00:00.000Z`, "respinto"],
    ]);
  });

  it("invii e priorità che non tornano: errore", () => {
    const changes: ((rows: ReturnType<typeof contactRows>) => void)[] = [
      (rows) => (rows.messages[0].mode = "prova"),
      (rows) => (rows.messages[0].send_status = "pronto"),
      (rows) => (rows.messages[0].send_status = "scartato"),
      (rows) => (rows.messages[0].partner_id = id(2)),
      (rows) => (rows.messages[0].subject = ""),
      (rows) => (rows.messages[0].sent_at = null),
      (rows) => (rows.messages[0].sent_at = "2026-02-30T09:00:00Z"),
      (rows) => (rows.messages = Array.from({ length: 6 }, () => ({ ...rows.messages[0] }))),
    ];
    for (const change of changes) {
      const rows = contactRows(6);
      change(rows);
      expect(() => partnerAssistantContactFrom(rows)).toThrow(PartnerReadError);
    }
    for (const value of [10, -1, 1.5, "9", null]) {
      const rows = contactRows(2);
      rows.switch!.send_priority = value;
      expect(() => partnerAssistantContactFrom(rows), String(value)).toThrow(PartnerReadError);
    }
    // Gli invii sono storia del contatto, non del lavoro: si leggono anche senza lavoro.
    const orphan = contactRows(3);
    orphan.messages = contactRows(6).messages.map((row) => ({ ...row, partner_id: id(3) }));
    expect(partnerAssistantContactFrom(orphan).sends).toHaveLength(1);
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
      (rows) => (rows.job!.status = "inviato"),
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
      inviata: "Email inviata",
    });
    expect(PARTNER_ASSISTANT_REQUEST_LABELS).toEqual({
      merch_cobranding: "Merch co-firmato",
      collab_capsule: "Capsule insieme",
      stand_evento: "Stand all'evento",
      vendita_negozio: "Vendita in negozio",
    });
  });

  it("le etichette della coda e lo stato non leggibile stanno qui, non nei componenti", () => {
    expect(PARTNER_ASSISTANT_COUNT_LABELS).toEqual({
      inCoda: "In coda",
      attesa: "In attesa della data",
      pronta: "Bozza pronta",
      serveTommaso: "Serve Tommi",
      ferma: "Fermati dal team",
    });
    expect(PARTNER_ASSISTANT_UNREADABLE).toBe(
      "Stato dell'assistente non leggibile: ricarica la pagina tra poco.",
    );
    // I componenti le importano: nessuna copia scritta a mano.
    for (const file of [
      "partner-assistant-view.tsx",
      "partner-assistant-strip.tsx",
      "partner-assistant-block.tsx",
    ]) {
      const source = readFileSync(join(ROOT, "src/components/partner", file), "utf8");
      expect(source, file).not.toContain('"Fermati dal team"');
      expect(source, file).not.toContain("non leggibile: ricarica");
    }
  });

  it("una frase per ogni motivo del brief, della SQL e del worker", () => {
    const sql = readFileSync(
      join(ROOT, "supabase/migrations/20261028122956_assistente_partner_worker.sql"),
      "utf8",
    );
    const commands = readFileSync(
      join(ROOT, "supabase/migrations/20261028122704_assistente_partner.sql"),
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
      // La cancellazione definitiva di un recapito (comandi del team).
      ...all(commands, /reason = case [^;]*? else '([a-z_]+)' end/g),
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
        "dato_cancellato",
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
    expect(PARTNER_ASSISTANT_REASON_LABELS.dato_cancellato).toBe(
      "Un dato del contatto è stato cancellato: ridallo all'assistente se vuoi rifare ricerca e bozza.",
    );
  });

  it("una frase per ogni motivo dell'invio, come li scrive la migrazione", () => {
    const sql = readFileSync(
      join(ROOT, "supabase/migrations/20261028164029_assistente_partner_invio.sql"),
      "utf8",
    );
    const all = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((m) => m[1]);
    // I motivi dei lavori passati a Tommi nella migrazione dell'invio.
    const fromSql = new Set([
      ...all(sql, /status = 'serve_tommaso', reason = '([a-z_]+)'/g),
      ...all(sql, /then 'indirizzo_non_valido' else '([a-z_]+)' end/g),
      ...all(
        sql,
        /elsif p_reason in \(([^)]*)\) then\s+update public\.partner_assistant_jobs set status = 'serve_tommaso'/g,
      ).flatMap((list) => all(list, /'([a-z_]+)'/g)),
    ]);
    expect([...fromSql].sort()).toEqual(
      [
        "bozza_scaduta",
        "conversazione_esistente",
        "impronta",
        "indirizzo_non_valido",
        "invio_incerto",
        "invio_rifiutato",
      ].sort(),
    );
    expect(PARTNER_ASSISTANT_REASON_LABELS).toMatchObject({
      bozza_scaduta:
        "Bozza scaduta: l'evento è già iniziato o una data citata è passata. L'assistente la riscrive una volta, se c'è credito; poi decide Tommi.",
      conversazione_esistente:
        "Conversazione recente nella casella: nella posta degli ultimi 12 mesi c'è già uno scambio con questo indirizzo. L'assistente non scrive; decide Tommi.",
      invio_incerto:
        "Invio incerto: controlla in «Posta inviata» se l'email è partita. L'assistente non la rimanda.",
      indirizzo_non_valido:
        "Indirizzo non valido: il server di posta lo rifiuta, oppure è scritto in un modo che l'assistente non usa.",
      invio_rifiutato: "Il server di posta ha rifiutato l'email.",
      impronta: "Il testo da inviare non era quello approvato: l'email non è partita.",
    });
    for (const reason of fromSql) {
      const label = (PARTNER_ASSISTANT_REASON_LABELS as Record<string, string>)[reason];
      expect(label, reason).toMatch(/^[A-ZÈ].*\.$/);
      expect(label, reason).not.toContain("Tommaso");
      expect(partnerAssistantReasonLabel(reason)).toBe(label);
    }
  });

  it("dopo i due punti il motivo comincia in minuscolo, tranne i nomi", () => {
    expect(partnerAssistantReasonInline("fatto_mancante")).toBe(
      "la ricerca non ha trovato un fatto vero e recente da citare.",
    );
    expect(partnerAssistantReasonInline("dato_cancellato")).toBe(
      "un dato del contatto è stato cancellato: ridallo all'assistente se vuoi rifare ricerca e bozza.",
    );
    expect(partnerAssistantReasonInline("risposta_non_valida")).toBe(
      "Claude ha dato una risposta non valida, rifiutata o incompleta.",
    );
    expect(partnerAssistantReasonInline("motivo_nuovo")).toBe("motivo non riconosciuto.");
  });

  it("una frase breve per ogni esito degli eventi; un esito sconosciuto resta il codice", () => {
    // Gli esiti che la SQL scrive negli eventi, passo per passo (aggiunte del controllore, 1).
    const byStep = {
      ricerca: ["salvata"],
      estrazione: ["scrivi", "attendi", "fatto_mancante", "fuso_mancante"],
      scrittura: ["controlli_superati", "riscrittura", "controlli_falliti", "contesto_cambiato"],
      controllo: ["pronta", "regole_superate", "riscrittura", "seconda_lettura"],
      ogniPasso: [
        "lease_scaduta",
        "non_idoneo",
        "claude_attesa",
        "timeout",
        "troppe_continuazioni",
        "risposta_non_valida",
        "tempo_insufficiente",
        "troppi_tentativi",
        "spento",
        "pausa",
        "attesa",
        "lease_persa",
      ],
      senzaPasso: ["pausa_credito", "pausa_errore_claude"],
      // Consegna 2a: gli eventi con step «invio» (comandi del founder e RPC del worker).
      invio: [
        "prova_avviata",
        "prova_casella_vuota",
        "prova_casella_trovata",
        "prova_casella_incerta",
        "prova_inviata",
        "prova_incerto",
        "prova_respinto",
        "prova_scartato",
        "invio_inviato",
        "invio_incerto",
        "invio_respinto",
        "invio_scartato",
        "invio_abbandonato",
        "copia_salvata",
        "copia_trovata",
        "ricerca_scaduta",
        "recapito_cambiato",
        "regole_superate",
        "bozza_scaduta",
        "indirizzo_non_valido",
        "conversazione_esistente",
        "impronta",
        "casella_incerta",
        "casella",
        "limite",
        "finestra_chiusa",
        "paese_senza_calendario",
        "destinatario_prova",
        "modalita_cambiata",
        "bozza_cambiata",
        "fermo",
        "non_idoneo",
        "fermo_casella",
        "fermo_rimbalzi",
        "fermo_oggi",
        "invio_ripreso",
      ],
    };
    const listed = new Set(Object.values(byStep).flat());
    // Gli esiti scritti come testo nella migrazione del worker sono tutti nell'elenco.
    const sql = readFileSync(
      join(ROOT, "supabase/migrations/20261028122956_assistente_partner_worker.sql"),
      "utf8",
    );
    const all = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((m) => m[1]);
    const literal = [
      ...all(
        sql,
        /partner_assistant_events\(partner_id, step, outcome\)\s+values \([^)]*'([a-z_]+)'\)/g,
      ),
      ...all(sql, /select e\.partner_id, e\.step, '([a-z_]+)'/g),
      ...all(sql, /v_outcome := case([\s\S]*?)end;/g).flatMap((body) => all(body, /'([a-z_]+)'/g)),
    ];
    expect(literal).toEqual(
      expect.arrayContaining([
        "salvata",
        "non_idoneo",
        "contesto_cambiato",
        "lease_scaduta",
        "controlli_superati",
        "pronta",
        "regole_superate",
      ]),
    );
    for (const code of literal) expect(listed.has(code), code).toBe(true);
    // Gli esiti dell'invio scritti come testo nella migrazione della consegna 2a: tutti con una
    // frase. Gli esiti composti (`prova_casella_` più il controllo, modalità ed esito di finish)
    // si ricostruiscono dagli elenchi chiusi della SQL.
    const invio = readFileSync(
      join(ROOT, "supabase/migrations/20261028164029_assistente_partner_invio.sql"),
      "utf8",
    );
    const sendLiteral = [
      ...all(invio, /values \('invio', '([a-z_]+)'\)/g),
      ...all(invio, /values \([a-z_.]+, 'invio', '([a-z_]+)'\)/g),
      ...all(invio, /select d\.partner_id, 'invio', '([a-z_]+)'/g),
      ...all(invio, /v_event := case when [^;]*? then '([a-z_]+)'/g),
      ...all(invio, /case when v_found then '([a-z_]+)'/g),
      ...all(invio, /case when v_found then '[a-z_]+' else '([a-z_]+)' end/g),
      // Rifiuti di prepare e di start, spostamenti della pulizia del claim, motivi di skip.
      ...all(invio, /v_reason := case\s+when (?:v_mode|j\.partner_id)([\s\S]*?)\n  end;/g).flatMap(
        (body) => all(body, /then '([a-z_]+)'/g),
      ),
      ...all(invio, /case\s+when o\.research_at([\s\S]*?)end as reason/g).flatMap((body) =>
        all(body, /then '([a-z_]+)'/g),
      ),
      ...all(invio, /p_reason not in \(([^)]*)\)/g).flatMap((list) => all(list, /'([a-z_]+)'/g)),
      ...["vuota", "trovata", "incerta"].map((check) => `prova_casella_${check}`),
      // Gli esiti di finish diversi da `prova_inviata`: modalità ed esito.
      ...["prova", "invio"].flatMap((mode) =>
        ["inviato", "incerto", "respinto", "scartato"].map((outcome) => `${mode}_${outcome}`),
      ),
    ].filter((code) => code !== "prova_inviato");
    expect(sendLiteral).toEqual(
      expect.arrayContaining([
        "prova_avviata",
        "invio_ripreso",
        "fermo_oggi",
        "fermo_rimbalzi",
        "fermo_casella",
        "invio_abbandonato",
        "copia_salvata",
        "copia_trovata",
        "indirizzo_non_valido",
        "casella_incerta",
        "finestra_chiusa",
        "paese_senza_calendario",
      ]),
    );
    for (const code of sendLiteral) expect(listed.has(code), code).toBe(true);

    expect(Object.keys(PARTNER_ASSISTANT_EVENT_LABELS).sort()).toEqual([...listed].sort());
    for (const code of listed) {
      const label = (PARTNER_ASSISTANT_EVENT_LABELS as Record<string, string>)[code];
      expect(label, code).toMatch(/^[A-ZÈ][^.]*[^.\s]$/);
      expect(label.length, code).toBeLessThanOrEqual(60);
      expect(label, code).not.toContain("Tommaso");
      expect(partnerAssistantEventLabel(code)).toBe(label);
    }
    expect(partnerAssistantEventLabel("salvata")).toBe("Ricerca salvata");
    expect(partnerAssistantEventLabel("pronta")).toBe("Bozza pronta per Tommi");
    expect(partnerAssistantEventLabel("riscrittura")).toBe("Riscrive la bozza");
    expect(partnerAssistantEventLabel("pausa_credito")).toBe("In pausa: credito finito");
    expect(partnerAssistantEventLabel("esito_nuovo")).toBe("esito_nuovo");
    expect(partnerAssistantEventLabel("constructor")).toBe("constructor");
  });

  it("dollari con la virgola e due decimali", () => {
    expect(formatPartnerAssistantUsd(1.372415)).toBe("1,37 USD");
    expect(formatPartnerAssistantUsd(0.846102)).toBe("0,85 USD");
    expect(formatPartnerAssistantUsd(0)).toBe("0,00 USD");
    expect(formatPartnerAssistantUsd(25)).toBe("25,00 USD");
    expect(formatPartnerAssistantUsd(12345.678)).toBe("12.345,68 USD");
  });
});

describe("credito di partenza scritto nella pagina", () => {
  it("da 0 a 10.000 dollari, con al massimo due decimali, virgola o punto", () => {
    expect(parsePartnerAssistantCredit("25")).toBe(25);
    expect(parsePartnerAssistantCredit(" 37,45 ")).toBe(37.45);
    expect(parsePartnerAssistantCredit("92.5")).toBe(92.5);
    expect(parsePartnerAssistantCredit("0")).toBe(0);
    expect(parsePartnerAssistantCredit("10000")).toBe(10000);
    // Come lo legge il comando: String(value) con al massimo due decimali.
    for (const value of ["25", "37,45", "0,1", "9999,99"])
      expect(String(parsePartnerAssistantCredit(value))).toMatch(/^\d+(\.\d{1,2})?$/);
  });

  it("vuoto, negativo, oltre 10.000, tre decimali o non numerico: null", () => {
    for (const value of ["", "  ", "-1", "10000,01", "1,234", "abc", "1e3", "12,", ",5", "1 000"])
      expect(parsePartnerAssistantCredit(value), value).toBeNull();
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

  it("le fixture dell'invio passano i lettori: due invii, nessun fermo, una priorità", () => {
    const { send } = partnerAssistantFixture(TODAY);
    expect(send.stopReason).toBeNull();
    expect(send.recent).toHaveLength(2);
    expect(send.recent.map((item) => item.at)).toEqual(
      [...send.recent.map((item) => item.at)].sort().reverse(),
    );
    expect(send.priorities).toEqual([{ co: 2, name: "Raduno Sintetico Due", sendPriority: 9 }]);
    // La scheda con la priorità e quella con la prima email inviata.
    const raduno = partnerFixtureDetail(2, TODAY)!.assistant as PartnerAssistantContactView;
    expect(raduno.sendPriority).toBe(9);
    const club = partnerFixtureDetail(6, TODAY)!.assistant as PartnerAssistantContactView;
    expect(club.job?.status).toBe("inviata");
    expect(club.sends.map((item) => item.status)).toEqual(["inviato"]);
    // I messaggi della lista recente sono quelli delle righe sintetiche.
    const rows = partnerAssistantFixtureRows(TODAY);
    expect(send.recent.map((item) => [item.co, item.mode, item.status, item.subject])).toEqual(
      rows.messages.map((row) => [6, row.mode, row.send_status, row.subject]).reverse(),
    );
  });

  it("la bozza sintetica ha l'impronta vera di oggetto, corpo e firma", () => {
    for (const today of [TODAY, "2026-12-31"]) {
      const drafts = partnerAssistantFixtureRows(today).drafts;
      expect(drafts.length).toBeGreaterThan(0);
      for (const draft of drafts)
        expect(draft.sha256).toBe(
          partnerAssistantDraftSha256(
            draft as unknown as { subject: string; body: string; signature: string },
          ),
        );
    }
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

describe("migrazioni dell'assistente non ancora applicate", () => {
  it("funzione o tabella dell'assistente mancante, da PostgREST o da PostgreSQL: assistente non attivo", () => {
    // I messaggi come li mandano PostgREST e PostgreSQL quando l'oggetto non c'è.
    for (const error of [
      {
        code: "PGRST202",
        message:
          "Could not find the function public.read_partner_assistant_status without parameters in the schema cache",
      },
      {
        code: "PGRST205",
        message: "Could not find the table 'public.partner_assistant_jobs' in the schema cache",
      },
      { code: "42883", message: "function public.read_partner_assistant_status() does not exist" },
      { code: "42P01", message: 'relation "public.partner_assistant_contacts" does not exist' },
    ])
      expect(isPartnerAssistantMissing(error), error.code).toBe(true);
    expect(PARTNER_ASSISTANT_INACTIVE).toBe("non_attivo");
  });

  it("stesso codice, ma l'oggetto che manca non è dell'assistente: un bug, resta un errore", () => {
    for (const error of [
      { code: "42883", message: "operator does not exist: uuid = text" },
      { code: "42883", message: "function public.partner_text(text) does not exist" },
      { code: "42P01", message: 'missing FROM-clause entry for table "j"' },
      { code: "42P01", message: 'relation "public.partners" does not exist' },
      {
        code: "PGRST202",
        message:
          "Could not find the function public.set_partner_state(p_operation_id, p_payload) in the schema cache",
      },
      {
        code: "PGRST205",
        message: "Could not find the table 'public.partner_contacts' in the schema cache",
      },
      { code: "42883", message: "sintetico" },
      { code: "42883" },
      { code: "42P01", message: null },
    ])
      expect(isPartnerAssistantMissing(error), JSON.stringify(error)).toBe(false);
  });

  it("gli altri errori restano errori veri", () => {
    for (const error of [
      { code: "40001", message: "partner_changed" },
      { code: "PGRST301", message: "JWT" },
      { code: "42501", message: "permessi" },
      { message: "boom" },
      { code: 42883 },
      new Error("rete"),
      "PGRST202",
      null,
      undefined,
    ])
      expect(isPartnerAssistantMissing(error), JSON.stringify(error)).toBe(false);
  });
});
