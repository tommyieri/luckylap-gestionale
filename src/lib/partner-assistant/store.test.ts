import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { createPartnerAssistantStore, type PartnerAssistantStore } from "./store";
import type { PartnerAssistantChoice, PartnerAssistantDraft } from "./types";

// Solo dati sintetici: domini example.test, CO da 951, UUID inventati.
const config = {
  workerSecret: "synthetic-partner-assistant-secret-0000",
  anthropicApiKey: "sk-ant-synthetic-0000000000000000",
  supabaseUrl: "https://synthetic.supabase.co",
  supabaseSecretKey: "sb_secret_synthetic-partner-assistant",
  phone: "+39 000 000 0000",
};
const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const workerId = id(1);
const operationId = id(4);
const at = "2026-10-27T14:06:00.123456+00:00";
const jobRow = {
  job_id: id(2),
  partner_id: id(951),
  step: "ricerca",
  lease_token: id(3),
  lease_expires_at: at,
  attempts: 0,
  rewrites: 0,
};
const job = {
  jobId: id(2),
  partnerId: id(951),
  step: "ricerca",
  leaseToken: id(3),
  leaseExpiresAt: at,
  attempts: 0,
  rewrites: 0,
};
const lease = { jobId: job.jobId, leaseToken: job.leaseToken };
const leaseArgs = { p_job_id: job.jobId, p_lease_token: job.leaseToken };

const choiceRow = {
  contact_kind: "club",
  porsche_community: true,
  reason_it: "Club con un raduno in primavera",
  write_now: true,
  write_on: "",
  recipient_email: "segreteria@pc-nord.example.test",
  recipient_email_source: "https://pc-nord.example.test/contatti",
  recipient_email_published_by_org: true,
  person_name: "Ada Prova",
  person_title: "Presidente",
  language: "en",
  register: "you",
  swiss: false,
  timezone: "Europe/London",
  fact_text: "Il club ha festeggiato trent'anni",
  fact_date: "2026-09-12",
  fact_source: "https://pc-nord.example.test/news",
  event_name: "",
  event_starts_on: "",
  event_city: "",
  event_country: "",
  event_reachable: false,
  notes_it: "",
  request: "merch_cobranding",
};
const choice: PartnerAssistantChoice = {
  contactKind: "club",
  porscheCommunity: true,
  reasonIt: "Club con un raduno in primavera",
  writeNow: true,
  writeOn: "",
  recipientEmail: "segreteria@pc-nord.example.test",
  recipientEmailSource: "https://pc-nord.example.test/contatti",
  recipientEmailPublishedByOrg: true,
  personName: "Ada Prova",
  personTitle: "Presidente",
  language: "en",
  register: "you",
  swiss: false,
  timezone: "Europe/London",
  factText: "Il club ha festeggiato trent'anni",
  factDate: "2026-09-12",
  factSource: "https://pc-nord.example.test/news",
  eventName: "",
  eventStartsOn: "",
  eventCity: "",
  eventCountry: "",
  eventReachable: false,
  notesIt: "",
  request: "merch_cobranding",
};
const contextRow = {
  status: "ok",
  today: "2026-10-27",
  partner: {
    co: 951,
    name: "Porsche Club Sintetico Nord",
    city: "",
    country: "Regno Unito",
    type_label: "",
    sections: ["collab"],
    priority: "alta",
    contact_month: "2026-11-01",
    event_starts_on: null,
    event_ends_on: null,
    application_deadline: null,
    version: 1,
    research: { nota: "Conto vendita", contatti: [{ ruolo: "segreteria" }] },
  },
  email: { contact_id: id(5), address: "segreteria@pc-nord.example.test", verified: true },
  rules: { version: 1, body: "# Regole sintetiche" },
  research: {
    note_id: id(6),
    text: "Ricerca sintetica",
    sources: ["https://pc-nord.example.test/"],
    created_at: "2026-10-27T14:00:00.123456+00:00",
  },
  choice: { note_id: id(7), content: { ...choiceRow, decision: { kind: "scrivi" } } },
  draft: {
    draft_id: id(8),
    language: "en",
    subject: "Oggetto sintetico",
    body: "Corpo sintetico",
    signature: "Tommaso",
    sha256: "a".repeat(64),
    rules_version: 1,
    created_at: "2026-10-27T14:02:00+00:00",
  },
  last_review: { approved: false, problems: ["parola_vietata"] },
};
const context = {
  today: "2026-10-27",
  partner: {
    co: 951,
    name: "Porsche Club Sintetico Nord",
    city: "",
    country: "Regno Unito",
    typeLabel: "",
    sections: ["collab"],
    priority: "alta",
    contactMonth: "2026-11-01",
    eventStartsOn: null,
    eventEndsOn: null,
    applicationDeadline: null,
    version: 1,
    research: { nota: "Conto vendita", contatti: [{ ruolo: "segreteria" }] },
  },
  email: { contactId: id(5), address: "segreteria@pc-nord.example.test", verified: true },
  rules: { version: 1, body: "# Regole sintetiche" },
  research: {
    noteId: id(6),
    text: "Ricerca sintetica",
    sources: ["https://pc-nord.example.test/"],
    createdAt: "2026-10-27T14:00:00.123456+00:00",
  },
  choice: { noteId: id(7), content: { ...choice, decision: { kind: "scrivi" } } },
  draft: {
    draftId: id(8),
    language: "en",
    subject: "Oggetto sintetico",
    body: "Corpo sintetico",
    signature: "Tommaso",
    sha256: "a".repeat(64),
    rulesVersion: 1,
    createdAt: "2026-10-27T14:02:00+00:00",
  },
  lastReview: { approved: false, problems: ["parola_vietata"] },
};
const draft: PartnerAssistantDraft = {
  language: "en",
  subject: "Oggetto sintetico",
  body: "Corpo sintetico",
  signature: "Tommaso",
  sha256: "b".repeat(64),
  rulesVersion: 1,
  partnerVersion: 3,
  contactId: id(5),
};
const call = {
  partnerId: id(951),
  step: "ricerca" as const,
  model: "claude-opus-5-5",
  inputTokens: 1000,
  outputTokens: 200,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 300,
  cacheReadTokens: 50,
  webSearches: 2,
  costUsd: 0.0284,
  outcome: "ok",
};
const done = { status: "done", job_status: "in_coda", step: "estrazione", replayed: false };
const doneValue = { status: "done", jobStatus: "in_coda", step: "estrazione", replayed: false };

type Case = {
  label: string;
  name: string;
  run: (store: PartnerAssistantStore, signal: AbortSignal) => Promise<unknown>;
  args: Record<string, unknown>;
  row: unknown;
  value: unknown;
};
const research = (s: PartnerAssistantStore, signal: AbortSignal) =>
  s.completeResearch(
    lease,
    {
      text: "Ricerca sintetica",
      sources: ["https://pc-nord.example.test/"],
      model: "claude-opus-5-5",
      rulesVersion: 1,
    },
    operationId,
    signal,
  );
const researchArgs = {
  p_operation_id: operationId,
  p_payload: {
    schema_version: 1,
    job_id: job.jobId,
    lease_token: job.leaseToken,
    text: "Ricerca sintetica",
    sources: ["https://pc-nord.example.test/"],
    model: "claude-opus-5-5",
    rules_version: 1,
  },
};
const chose = (s: PartnerAssistantStore, signal: AbortSignal) =>
  s.completeChoice(
    lease,
    { choice, decision: { kind: "attendi", writeOn: "2026-12-01" }, model: "m", rulesVersion: 1 },
    operationId,
    signal,
  );
const choseArgs = {
  p_operation_id: operationId,
  p_payload: {
    schema_version: 1,
    job_id: job.jobId,
    lease_token: job.leaseToken,
    choice: choiceRow,
    decision: { kind: "attendi", write_on: "2026-12-01" },
    model: "m",
    rules_version: 1,
  },
};
const wrote = (s: PartnerAssistantStore, signal: AbortSignal) =>
  s.completeDraft(
    lease,
    { draft, checksOk: false, failures: ["parola_vietata"] },
    operationId,
    signal,
  );
const wroteArgs = {
  p_operation_id: operationId,
  p_payload: {
    schema_version: 1,
    job_id: job.jobId,
    lease_token: job.leaseToken,
    draft: {
      language: "en",
      subject: "Oggetto sintetico",
      body: "Corpo sintetico",
      signature: "Tommaso",
      sha256: "b".repeat(64),
      rules_version: 1,
      partner_version: 3,
      contact_id: id(5),
    },
    checks_ok: false,
    failures: ["parola_vietata"],
  },
};
const reviewed = (s: PartnerAssistantStore, signal: AbortSignal) =>
  s.completeReview(
    lease,
    {
      approved: false,
      problems: ["regole_superate"],
      sha256: "b".repeat(64),
      model: null,
      rulesVersion: 2,
    },
    operationId,
    signal,
  );
const reviewedArgs = {
  p_operation_id: operationId,
  p_payload: {
    schema_version: 1,
    job_id: job.jobId,
    lease_token: job.leaseToken,
    approved: false,
    problems: ["regole_superate"],
    sha256: "b".repeat(64),
    model: null,
    rules_version: 2,
  },
};

const cases: Case[] = [
  {
    label: "claim, lavoro preso",
    name: "claim_partner_assistant_step",
    run: (s, signal) => s.claim(workerId, 360, signal),
    args: { p_worker_id: workerId, p_lease_seconds: 360 },
    row: { status: "claimed", job: jobRow },
    value: { status: "claimed", job },
  },
  ...["spento", "non_configurato", "pausa", "attesa", "occupato", "vuota"].map((reason) => ({
    label: `claim, giro ${reason}`,
    name: "claim_partner_assistant_step",
    run: (s: PartnerAssistantStore, signal: AbortSignal) => s.claim(workerId, 360, signal),
    args: { p_worker_id: workerId, p_lease_seconds: 360 },
    row: { status: "idle", reason },
    value: { status: "idle", reason },
  })),
  {
    label: "contesto completo",
    name: "context_partner_assistant_step",
    run: (s, signal) => s.context(lease, signal),
    args: leaseArgs,
    row: contextRow,
    value: { status: "ok", context },
  },
  {
    label: "contesto senza lease",
    name: "context_partner_assistant_step",
    run: (s, signal) => s.context(lease, signal),
    args: leaseArgs,
    row: { status: "lease_persa" },
    value: { status: "lease_persa" },
  },
  {
    label: "checkpoint, si va avanti",
    name: "checkpoint_partner_assistant_step",
    run: (s, signal) => s.checkpoint(lease, signal),
    args: leaseArgs,
    row: { status: "ok" },
    value: { status: "ok" },
  },
  ...["spento", "pausa", "attesa", "lease_persa", "non_idoneo"].map((reason) => ({
    label: `checkpoint, stop ${reason}`,
    name: "checkpoint_partner_assistant_step",
    run: (s: PartnerAssistantStore, signal: AbortSignal) => s.checkpoint(lease, signal),
    args: leaseArgs,
    row: { status: "stop", reason },
    value: { status: "stop", reason },
  })),
  {
    label: "chiamata registrata",
    name: "record_partner_assistant_call",
    run: (s, signal) => s.recordCall(call, operationId, signal),
    args: {
      p_operation_id: operationId,
      p_payload: {
        schema_version: 1,
        partner_id: id(951),
        step: "ricerca",
        model: "claude-opus-5-5",
        input_tokens: 1000,
        output_tokens: 200,
        cache_write_5m_tokens: 0,
        cache_write_1h_tokens: 300,
        cache_read_tokens: 50,
        web_searches: 2,
        cost_usd: 0.0284,
        outcome: "ok",
      },
    },
    row: { status: "ok", replayed: true },
    value: { status: "ok", replayed: true },
  },
  ...(
    [
      ["ricerca", "complete_partner_assistant_research", research, researchArgs],
      ["scelta", "complete_partner_assistant_choice", chose, choseArgs],
      ["bozza", "complete_partner_assistant_draft", wrote, wroteArgs],
      ["seconda lettura", "complete_partner_assistant_review", reviewed, reviewedArgs],
    ] as const
  ).flatMap(([label, name, run, args]) => [
    { label: `${label} conclusa`, name, run, args, row: done, value: doneValue },
    {
      label: `${label} ripetuta`,
      name,
      run,
      args,
      row: { ...done, job_status: "serve_tommaso", step: "controllo", replayed: true },
      value: { ...doneValue, jobStatus: "serve_tommaso", step: "controllo", replayed: true },
    },
    ...["lease_persa", "non_idoneo"].map((status) => ({
      label: `${label} ${status}`,
      name,
      run,
      args,
      row: { status },
      value: { status },
    })),
  ]),
  {
    label: "bozza con il recapito cambiato",
    name: "complete_partner_assistant_draft",
    run: wrote,
    args: wroteArgs,
    row: { status: "contesto_cambiato" },
    value: { status: "contesto_cambiato" },
  },
  {
    label: "passo non concluso",
    name: "fail_partner_assistant_step",
    run: (s, signal) => s.fail(lease, "riprova", "risposta_non_valida", signal),
    args: { ...leaseArgs, p_kind: "riprova", p_reason: "risposta_non_valida" },
    row: { status: "done", job_status: "serve_tommaso", attempts: 3 },
    value: { status: "done", jobStatus: "serve_tommaso", attempts: 3 },
  },
  {
    label: "passo non concluso senza lease",
    name: "fail_partner_assistant_step",
    run: (s, signal) => s.fail(lease, "rilascia", "non_idoneo", signal),
    args: { ...leaseArgs, p_kind: "rilascia", p_reason: "non_idoneo" },
    row: { status: "lease_persa" },
    value: { status: "lease_persa" },
  },
  {
    label: "pausa",
    name: "pause_partner_assistant",
    run: (s, signal) => s.pause("credito", signal),
    args: { p_reason: "credito" },
    row: { status: "done", paused_reason: "credito" },
    value: { status: "done", pausedReason: "credito" },
  },
];

// Per ogni oggetto della riga (tranne la ricerca importata, che ha forma libera): una chiave in
// più, e poi ciascuna chiave tolta.
type Json = Record<string, unknown>;
const objectPaths = (value: unknown, path: string[] = []): string[][] =>
  !value ||
  typeof value !== "object" ||
  Array.isArray(value) ||
  path.join(".") === "partner.research"
    ? []
    : [path, ...Object.entries(value).flatMap(([k, v]) => objectPaths(v, [...path, k]))];
const objectAt = (root: unknown, path: string[]) =>
  path.reduce((o, k) => (o as Json)[k], root) as Json;
const keyMutations = (row: unknown): [string, unknown][] =>
  objectPaths(row).flatMap((path) => {
    const extra = structuredClone(row);
    objectAt(extra, path).extra = "";
    return [
      [[...path, "+extra"].join("."), extra] as [string, unknown],
      ...Object.keys(objectAt(row, path)).map((key) => {
        const missing = structuredClone(row);
        delete objectAt(missing, path)[key];
        return [[...path, `-${key}`].join("."), missing] as [string, unknown];
      }),
    ];
  });
const store = () => createPartnerAssistantStore(config);
const replying = (data: unknown) => mocks.abortSignal.mockResolvedValue({ data, error: null });
const signal = () => new AbortController().signal;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal });
});

describe("store dell'assistente Partner", () => {
  it("usa un client privato con la chiave propria e il trasporto limitato", async () => {
    replying({ status: "idle", reason: "vuota" });
    const aborted = signal();
    await store().claim(workerId, 360, aborted);
    expect(mocks.createClient).toHaveBeenCalledExactlyOnceWith(
      config.supabaseUrl,
      config.supabaseSecretKey,
      {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: expect.any(Function) },
      },
    );
    expect(mocks.abortSignal).toHaveBeenCalledWith(aborted);
  });
  it.each(cases.map((c) => [c.label, c] as const))(
    "%s: la riga attesa diventa il tipo camelCase",
    async (_, c) => {
      replying(c.row);
      expect(await c.run(store(), signal())).toEqual({ ok: true, value: c.value });
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(c.name, c.args);
    },
  );
  it.each(
    cases.flatMap((c) =>
      keyMutations(c.row).map(([mutation, row]) => [c.label, mutation, c, row] as const),
    ),
  )("%s, %s: { ok: false }", async (_, __, c, row) => {
    replying(row);
    expect(await c.run(store(), signal())).toEqual({ ok: false });
  });
  it.each([
    ["contesto senza email attiva", { email: null }, { email: null }],
    [
      "contesto senza note né bozze",
      { research: null, choice: null, draft: null, last_review: null },
      { research: null, choice: null, draft: null, lastReview: null },
    ],
    [
      "contesto con una scelta in attesa",
      {
        choice: {
          note_id: id(7),
          content: { ...choiceRow, decision: { kind: "attendi", write_on: "2026-12-01" } },
        },
      },
      {
        choice: {
          noteId: id(7),
          content: { ...choice, decision: { kind: "attendi", writeOn: "2026-12-01" } },
        },
      },
    ],
    [
      "contesto con una scelta bloccata",
      {
        choice: {
          note_id: id(7),
          content: { ...choiceRow, decision: { kind: "blocca", reason: "fuso_mancante" } },
        },
      },
      {
        choice: {
          noteId: id(7),
          content: { ...choice, decision: { kind: "blocca", reason: "fuso_mancante" } },
        },
      },
    ],
  ])("%s", async (_, change, expected) => {
    replying({ ...contextRow, ...change });
    expect(await store().context(lease, signal())).toEqual({
      ok: true,
      value: { status: "ok", context: { ...context, ...expected } },
    });
  });
  it.each(["merch_cobranding", "collab_capsule", "stand_evento", "vendita_negozio"])(
    "accetta la richiesta %s",
    async (request) => {
      replying({
        ...contextRow,
        choice: {
          note_id: id(7),
          content: { ...choiceRow, request, decision: { kind: "scrivi" } },
        },
      });
      expect(await store().context(lease, signal())).toMatchObject({ ok: true });
    },
  );
  const withChoice = (change: Json, decision: Json = { kind: "scrivi" }) => ({
    ...contextRow,
    choice: { note_id: id(7), content: { ...choiceRow, ...change, decision } },
  });
  const withPartner = (change: Json) => ({
    ...contextRow,
    partner: { ...contextRow.partner, ...change },
  });
  it.each<[string, unknown]>([
    ["richiesta del vecchio elenco", withChoice({ request: "progetto_futuro" })],
    ["richiesta fuori elenco", withChoice({ request: "regalo" })],
    ["tipo di contatto fuori elenco", withChoice({ contact_kind: "altro" })],
    ["lingua fuori elenco", withChoice({ language: "pt" })],
    ["forma di cortesia fuori elenco", withChoice({ register: "tu" })],
    ["data della scelta non valida", withChoice({ write_on: "27/10/2026" })],
    ["data della scelta impossibile", withChoice({ fact_date: "2026-02-30" })],
    ["campo booleano come testo", withChoice({ swiss: "no" })],
    ["campo testo nullo", withChoice({ notes_it: null })],
    ["decisione sconosciuta", withChoice({}, { kind: "manda" })],
    ["attesa senza data", withChoice({}, { kind: "attendi", write_on: "" })],
    ["blocco con un motivo sconosciuto", withChoice({}, { kind: "blocca", reason: "altro" })],
    ["sezione fuori elenco", withPartner({ sections: ["altro"] })],
    ["priorità fuori elenco", withPartner({ priority: "urgente" })],
    ["CO non intero", withPartner({ co: 951.5 })],
    ["versione della scheda a zero", withPartner({ version: 0 })],
    ["mese non valido", withPartner({ contact_month: "novembre" })],
    ["ricerca importata non oggetto", withPartner({ research: [] })],
    [
      "email senza indirizzo valido",
      { ...contextRow, email: { ...contextRow.email, address: "x" } },
    ],
    [
      "email con un id non valido",
      { ...contextRow, email: { ...contextRow.email, contact_id: "1" } },
    ],
    ["regole mancanti", { ...contextRow, rules: null }],
    ["regole vuote", { ...contextRow, rules: { version: 1, body: "" } }],
    ["giorno non valido", { ...contextRow, today: "oggi" }],
    ["fonti non testuali", { ...contextRow, research: { ...contextRow.research, sources: [1] } }],
    ["ricerca senza data", { ...contextRow, research: { ...contextRow.research, created_at: "" } }],
    ["impronta non valida", { ...contextRow, draft: { ...contextRow.draft, sha256: "ABC" } }],
    ["problemi non testuali", { ...contextRow, last_review: { approved: false, problems: [1] } }],
    ["stato sconosciuto", { ...contextRow, status: "occupato" }],
    ["un array al posto dell'oggetto", [contextRow]],
    ["niente", null],
  ])("contesto con %s: { ok: false }", async (_, row) => {
    replying(row);
    expect(await store().context(lease, signal())).toEqual({ ok: false });
  });
  it.each<[string, unknown]>([
    ["stato sconosciuto", { status: "preso", job: jobRow }],
    ["motivo sconosciuto", { status: "idle", reason: "dorme" }],
    ["passo fuori elenco", { status: "claimed", job: { ...jobRow, step: "invio" } }],
    ["quattro tentativi", { status: "claimed", job: { ...jobRow, attempts: 4 } }],
    ["due riscritture", { status: "claimed", job: { ...jobRow, rewrites: 2 } }],
    ["lease non valida", { status: "claimed", job: { ...jobRow, lease_token: null } }],
    ["scadenza non valida", { status: "claimed", job: { ...jobRow, lease_expires_at: "domani" } }],
    ["una lista di lavori", [{ status: "claimed", job: jobRow }]],
  ])("claim con %s: { ok: false }", async (_, row) => {
    replying(row);
    expect(await store().claim(workerId, 360, signal())).toEqual({ ok: false });
  });
  const checkpoint = (s: PartnerAssistantStore) => s.checkpoint(lease, signal());
  const record = (s: PartnerAssistantStore) => s.recordCall(call, operationId, signal());
  const fail = (s: PartnerAssistantStore) => s.fail(lease, "riprova", "timeout", signal());
  const pause = (s: PartnerAssistantStore) => s.pause("credito", signal());
  it.each<[string, unknown, (s: PartnerAssistantStore) => Promise<unknown>]>([
    ["checkpoint con un motivo sconosciuto", { status: "stop", reason: "occupato" }, checkpoint],
    ["checkpoint con uno stato sconosciuto", { status: "via" }, checkpoint],
    ["chiamata con la ripetizione non booleana", { status: "ok", replayed: "no" }, record],
    ["chiamata con uno stato sconosciuto", { status: "done", replayed: false }, record],
    [
      "fallimento con lo stato del lavoro fuori elenco",
      { status: "done", job_status: "fatto", attempts: 1 },
      fail,
    ],
    [
      "fallimento con quattro tentativi",
      { status: "done", job_status: "in_coda", attempts: 4 },
      fail,
    ],
    ["fallimento non idoneo", { status: "non_idoneo" }, fail],
    ["pausa con un altro motivo", { status: "done", paused_reason: "errore_claude" }, pause],
  ])("%s: { ok: false }", async (_, row, run) => {
    replying(row);
    expect(await run(store())).toEqual({ ok: false });
  });
  it.each([
    ["ricerca", research],
    ["scelta", chose],
    ["seconda lettura", reviewed],
  ] as const)("%s: contesto_cambiato è solo della bozza", async (_, run) => {
    replying({ status: "contesto_cambiato" });
    expect(await run(store(), signal())).toEqual({ ok: false });
  });
  it.each<[string, unknown]>([
    ["stato del lavoro fuori elenco", { ...done, job_status: "fatto" }],
    ["passo fuori elenco", { ...done, step: "invio" }],
    ["ripetizione non booleana", { ...done, replayed: null }],
    ["stato sconosciuto", { status: "occupato" }],
  ])("conclusione con %s: { ok: false }", async (_, row) => {
    replying(row);
    expect(await research(store(), signal())).toEqual({ ok: false });
  });
  it("non restituisce i dettagli degli errori del database", async () => {
    mocks.abortSignal.mockResolvedValue({
      data: contextRow,
      error: { code: "42501", message: "private sql credentials" },
    });
    expect(await store().context(lease, signal())).toEqual({ ok: false });
    mocks.abortSignal.mockRejectedValue(new Error("private response"));
    expect(await store().context(lease, signal())).toEqual({ ok: false });
  });
  it.each<[string, (s: PartnerAssistantStore) => Promise<unknown>]>([
    ["un worker senza UUID", (s) => s.claim("worker", 360, signal())],
    ["una lease troppo corta", (s) => s.claim(workerId, 29, signal())],
    ["una lease troppo lunga", (s) => s.claim(workerId, 901, signal())],
    ["una lease non intera", (s) => s.claim(workerId, 360.5, signal())],
    ["un lavoro senza UUID", (s) => s.context({ ...lease, jobId: "1" }, signal())],
    ["una lease senza UUID", (s) => s.checkpoint({ ...lease, leaseToken: "x" }, signal())],
    ["un'operazione senza UUID", (s) => s.recordCall(call, "op", signal())],
    [
      "un tipo di fallimento sconosciuto",
      (s) => s.fail(lease, "salta" as "riprova", "x", signal()),
    ],
    ["un motivo con un indirizzo", (s) => s.fail(lease, "blocca", "ada@example.test", signal())],
    ["un motivo di pausa sconosciuto", (s) => s.pause("stanco" as "credito", signal())],
  ])("con %s non chiama il database", async (_, run) => {
    expect(await run(store())).toEqual({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
