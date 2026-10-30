import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import {
  createPartnerAssistantSendStore,
  PARTNER_ASSISTANT_SEND_RPC_NAMES,
  type PartnerAssistantSendStore,
} from "./send-store";

// Solo dati sintetici: domini example.test, CO da 951, UUID inventati.
const config = {
  workerSecret: "synthetic-partner-assistant-secret-0000",
  anthropicApiKey: "sk-ant-synthetic-0000000000000000",
  supabaseUrl: "https://synthetic.supabase.co",
  supabaseSecretKey: "sb_secret_synthetic-partner-assistant",
  phone: "+39 000 000 0000",
};
const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const workerId = id(1);
const lease = id(2);
const operationId = id(3);
const messageRowId = id(4);
const messageId = `<${id(5)}@luckylap.example.test>`;
const sha = "c".repeat(64);

const draftRow = {
  draft_id: id(8),
  language: "it",
  subject: "Club Sintetico e LuckyLap",
  body: "Buongiorno,\ncorpo sintetico.",
  signature: "Tommaso",
  sha256: sha,
  rules_version: 2,
  created_at: "2026-10-28T09:00:00.123456+00:00",
};
const draft = {
  draftId: id(8),
  language: "it",
  subject: "Club Sintetico e LuckyLap",
  body: "Buongiorno,\ncorpo sintetico.",
  signature: "Tommaso",
  sha256: sha,
  rulesVersion: 2,
  createdAt: "2026-10-28T09:00:00.123456+00:00",
};
const candidateRow = {
  job_id: id(10),
  partner_id: id(951),
  co: 951,
  name: "Club Sintetico",
  mode: "invio",
  draft: draftRow,
  choice: { contact_kind: "club", request: "merch_cobranding", event_starts_on: "" },
  register: "voi",
  address: "info@club-951.example.test",
  test_run_id: null,
  test_index: null,
};
const candidate = {
  jobId: id(10),
  partnerId: id(951),
  co: 951,
  name: "Club Sintetico",
  mode: "invio",
  draft,
  choice: { contactKind: "club", request: "merch_cobranding", eventStartsOn: "" },
  register: "voi",
  address: "info@club-951.example.test",
  testRunId: null,
  testIndex: null,
};
const testCandidateRow = {
  ...candidateRow,
  mode: "prova",
  choice: { contact_kind: "evento", request: "stand_evento", event_starts_on: "2026-12-05" },
  test_run_id: id(20),
  test_index: 4,
};
const testCandidate = {
  ...candidate,
  mode: "prova",
  choice: { contactKind: "evento", request: "stand_evento", eventStartsOn: "2026-12-05" },
  testRunId: id(20),
  testIndex: 4,
};
const appendRow = {
  message_row_id: messageRowId,
  message_id: messageId,
  raw: "Message-ID: x\r\n\r\ncorpo\r\n",
  sent_at: "2026-10-29T08:41:00+00:00",
};
const append = {
  messageRowId,
  messageId,
  raw: "Message-ID: x\r\n\r\ncorpo\r\n",
  sentAt: "2026-10-29T08:41:00+00:00",
};
const prepareInput = {
  jobId: id(10),
  draftId: id(8),
  mode: "invio" as const,
  testRunId: null,
  testIndex: null,
  messageId,
  toAddress: "info@club-951.example.test",
  subject: "Club Sintetico e LuckyLap",
  text: "Buongiorno,\ncorpo sintetico.\n\nTommaso\n\nSe non è il momento.",
  optOut: "Se non è il momento.",
  raw: "Message-ID: x\r\n",
  mailboxCheck: "vuota" as const,
};
const preparePayload = {
  schema_version: 1,
  job_id: id(10),
  draft_id: id(8),
  mode: "invio",
  test_run_id: null,
  test_index: null,
  message_id: messageId,
  to_address: "info@club-951.example.test",
  subject: "Club Sintetico e LuckyLap",
  text: "Buongiorno,\ncorpo sintetico.\n\nTommaso\n\nSe non è il momento.",
  opt_out: "Se non è il momento.",
  raw: "Message-ID: x\r\n",
  mailbox_check: "vuota",
};
const finishInput = {
  messageRowId,
  outcome: "respinto" as const,
  smtpCode: 550,
  enhancedCode: "5.1.1",
  spam: false,
  reason: "smtp_550",
};
const finishPayload = {
  schema_version: 1,
  message_row_id: messageRowId,
  outcome: "respinto",
  smtp_code: 550,
  enhanced_code: "5.1.1",
  spam: false,
  reason: "smtp_550",
};

type Run = (store: PartnerAssistantSendStore, signal: AbortSignal) => Promise<unknown>;
type Case = { label: string; name: string; run: Run; args: unknown; row: unknown; value: unknown };

const claim: Run = (s, signal) => s.claim(workerId, 300, 2, signal);
const claimArgs = { p_worker_id: workerId, p_lease_seconds: 300, p_test_recipients: 2 };
const skip: Run = (s, signal) => s.skip(lease, id(10), "conversazione_esistente", signal);
const skipArgs = { p_lease_token: lease, p_job_id: id(10), p_reason: "conversazione_esistente" };
const prepare: Run = (s, signal) => s.prepare(lease, operationId, prepareInput, signal);
const prepareArgs = {
  p_lease_token: lease,
  p_operation_id: operationId,
  p_payload: preparePayload,
};
const start: Run = (s, signal) => s.start(lease, messageRowId, signal);
const startArgs = { p_lease_token: lease, p_message_row_id: messageRowId };
const finish: Run = (s, signal) => s.finish(lease, operationId, finishInput, signal);
const finishArgs = { p_lease_token: lease, p_operation_id: operationId, p_payload: finishPayload };
const recordAppend: Run = (s, signal) => s.recordAppend(lease, messageRowId, true, signal);
const recordAppendArgs = {
  p_lease_token: lease,
  p_message_row_id: messageRowId,
  p_payload: { schema_version: 1, found: true },
};
const pause: Run = (s, signal) => s.pause(lease, signal);
const pauseArgs = { p_lease_token: lease, p_reason: "casella" };
const release: Run = (s, signal) =>
  s.release(lease, { outcome: "inviato", smtpLogin: "ok", imapLogin: null }, signal);
const releaseArgs = {
  p_lease_token: lease,
  p_payload: { schema_version: 1, outcome: "inviato", smtp_login: "ok", imap_login: null },
};
const environment: Run = (s, signal) =>
  s.recordEnvironment({ mailboxOk: true, testOk: true, testCount: 2 }, signal);
const environmentArgs = {
  p_payload: { schema_version: 1, mailbox_ok: true, test_ok: true, test_count: 2 },
};

const idleReasons = [
  "spento",
  "prepara",
  "non_configurato",
  "occupato",
  "fermo",
  "fermo_oggi",
  "attesa",
  "intervallo",
  "limite",
  "fuori_finestra",
  "vuota",
];
const leaseLost = (label: string, name: string, run: Run, args: unknown): Case => ({
  label: `${label} senza lease`,
  name,
  run,
  args,
  row: { status: "lease_persa" },
  value: { status: "lease_persa" },
});
const cases: Case[] = [
  {
    label: "claim con candidato e copie",
    name: "claim_partner_assistant_send",
    run: claim,
    args: claimArgs,
    row: {
      status: "claimed",
      lease_token: lease,
      mode: "invio",
      appends: [appendRow],
      candidate: candidateRow,
    },
    value: { status: "claimed", leaseToken: lease, mode: "invio", appends: [append], candidate },
  },
  {
    label: "claim in prova",
    name: "claim_partner_assistant_send",
    run: claim,
    args: claimArgs,
    row: {
      status: "claimed",
      lease_token: lease,
      mode: "prova",
      appends: [],
      candidate: testCandidateRow,
    },
    value: {
      status: "claimed",
      leaseToken: lease,
      mode: "prova",
      appends: [],
      candidate: testCandidate,
    },
  },
  {
    label: "claim con le sole copie",
    name: "claim_partner_assistant_send",
    run: claim,
    args: claimArgs,
    row: {
      status: "claimed",
      lease_token: lease,
      mode: "invio",
      appends: [appendRow],
      candidate: null,
    },
    value: {
      status: "claimed",
      leaseToken: lease,
      mode: "invio",
      appends: [append],
      candidate: null,
    },
  },
  ...idleReasons.map((reason) => ({
    label: `claim ${reason}`,
    name: "claim_partner_assistant_send",
    run: claim,
    args: claimArgs,
    row: { status: "idle", reason },
    value: { status: "idle", reason },
  })),
  {
    label: "skip",
    name: "skip_partner_assistant_send",
    run: skip,
    args: skipArgs,
    row: { status: "done" },
    value: { status: "done" },
  },
  {
    label: "skip senza lavoro",
    name: "skip_partner_assistant_send",
    run: (s, signal) => s.skip(lease, null, "casella_incerta", signal),
    args: { p_lease_token: lease, p_job_id: null, p_reason: "casella_incerta" },
    row: { status: "done" },
    value: { status: "done" },
  },
  leaseLost("skip", "skip_partner_assistant_send", skip, skipArgs),
  {
    label: "prepare pronto",
    name: "prepare_partner_assistant_send",
    run: prepare,
    args: prepareArgs,
    row: { status: "pronto", message_row_id: messageRowId },
    value: { status: "pronto", messageRowId },
  },
  ...[
    "modalita_cambiata",
    "fermo",
    "bozza_cambiata",
    "impronta",
    "non_idoneo",
    "recapito_cambiato",
    "regole_superate",
    "ricerca_scaduta",
    "bozza_scaduta",
    "conversazione_esistente",
    "casella",
    "limite",
    "finestra_chiusa",
    "destinatario_prova",
    "doppione",
  ].map((reason) => ({
    label: `prepare rifiutato ${reason}`,
    name: "prepare_partner_assistant_send",
    run: prepare,
    args: prepareArgs,
    row: { status: "rifiutato", reason },
    value: { status: "rifiutato", reason },
  })),
  leaseLost("prepare", "prepare_partner_assistant_send", prepare, prepareArgs),
  {
    label: "start",
    name: "start_partner_assistant_send",
    run: start,
    args: startArgs,
    row: { status: "in_invio" },
    value: { status: "in_invio" },
  },
  ...[
    "bozza_cambiata",
    "modalita_cambiata",
    "fermo",
    "non_idoneo",
    "recapito_cambiato",
    "finestra_chiusa",
  ].map((reason) => ({
    label: `start fermato ${reason}`,
    name: "start_partner_assistant_send",
    run: start,
    args: startArgs,
    row: { status: "stop", reason },
    value: { status: "stop", reason },
  })),
  leaseLost("start", "start_partner_assistant_send", start, startArgs),
  {
    label: "finish",
    name: "finish_partner_assistant_send",
    run: finish,
    args: finishArgs,
    row: { status: "done", send_status: "respinto", replayed: false },
    value: { status: "done", sendStatus: "respinto", replayed: false },
  },
  {
    label: "finish ripetuto",
    name: "finish_partner_assistant_send",
    run: finish,
    args: finishArgs,
    row: { status: "done", send_status: "respinto", replayed: true },
    value: { status: "done", sendStatus: "respinto", replayed: true },
  },
  leaseLost("finish", "finish_partner_assistant_send", finish, finishArgs),
  {
    label: "copia registrata",
    name: "record_partner_assistant_append",
    run: recordAppend,
    args: recordAppendArgs,
    row: { status: "done" },
    value: { status: "done" },
  },
  leaseLost("copia", "record_partner_assistant_append", recordAppend, recordAppendArgs),
  {
    label: "fermo della casella",
    name: "pause_partner_assistant_send",
    run: pause,
    args: pauseArgs,
    row: { status: "done", stop_reason: "casella" },
    value: { status: "done" },
  },
  leaseLost("fermo", "pause_partner_assistant_send", pause, pauseArgs),
  {
    label: "rilascio",
    name: "release_partner_assistant_send",
    run: release,
    args: releaseArgs,
    row: { status: "done" },
    value: { status: "done" },
  },
  leaseLost("rilascio", "release_partner_assistant_send", release, releaseArgs),
  {
    label: "variabili",
    name: "record_partner_assistant_environment",
    run: environment,
    args: environmentArgs,
    row: { status: "done" },
    value: { status: "done" },
  },
];

// Per ogni oggetto della riga (anche dentro gli elenchi): una chiave in più, e poi ciascuna tolta.
type Json = Record<string, unknown>;
const objectPaths = (value: unknown, path: string[] = []): string[][] => {
  if (!value || typeof value !== "object") return [];
  const children = Object.entries(value).flatMap(([k, v]) => objectPaths(v, [...path, k]));
  return Array.isArray(value) ? children : [path, ...children];
};
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
const store = () => createPartnerAssistantSendStore(config);
const replying = (data: unknown) => mocks.abortSignal.mockResolvedValue({ data, error: null });
const signal = () => new AbortController().signal;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal });
});

describe("store d'invio dell'assistente Partner", () => {
  it("le nove RPC d'invio, nessun'altra", () => {
    expect([...PARTNER_ASSISTANT_SEND_RPC_NAMES]).toEqual([
      "claim_partner_assistant_send",
      "skip_partner_assistant_send",
      "prepare_partner_assistant_send",
      "start_partner_assistant_send",
      "finish_partner_assistant_send",
      "record_partner_assistant_append",
      "pause_partner_assistant_send",
      "release_partner_assistant_send",
      "record_partner_assistant_environment",
    ]);
  });
  it("usa un client privato con la chiave propria e il trasporto limitato", async () => {
    replying({ status: "idle", reason: "vuota" });
    const aborted = signal();
    await store().claim(workerId, 300, 0, aborted);
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
  const claimed = (change: Json = {}, candidateChange: Json = {}) => ({
    status: "claimed",
    lease_token: lease,
    mode: "invio",
    appends: [],
    candidate: { ...candidateRow, ...candidateChange },
    ...change,
  });
  it.each<[string, unknown]>([
    ["stato sconosciuto", { status: "preso" }],
    ["motivo sconosciuto", { status: "idle", reason: "dorme" }],
    ["modalità sconosciuta", claimed({ mode: "prepara" })],
    ["lease non valida", claimed({ lease_token: "x" })],
    ["niente da fare ma claimed", claimed({ candidate: null })],
    ["più di tre copie", claimed({ appends: [appendRow, appendRow, appendRow, appendRow] })],
    ["copie non in un elenco", claimed({ appends: appendRow })],
    [
      "copia con un Message-ID non valido",
      claimed({ appends: [{ ...appendRow, message_id: "x" }] }),
    ],
    ["copia senza testo", claimed({ appends: [{ ...appendRow, raw: "" }] })],
    ["copia senza data", claimed({ appends: [{ ...appendRow, sent_at: "ieri" }] })],
    ["candidato di un'altra modalità", claimed({}, { mode: "prova" })],
    ["un testIndex 5", claimed({ mode: "prova" }, { ...testCandidateRow, test_index: 5 })],
    ["un testIndex negativo", claimed({ mode: "prova" }, { ...testCandidateRow, test_index: -1 })],
    ["prova senza indice", claimed({ mode: "prova" }, { ...testCandidateRow, test_index: null })],
    ["prova senza run", claimed({ mode: "prova" }, { ...testCandidateRow, test_run_id: null })],
    ["invio con un indice di prova", claimed({}, { test_index: 0 })],
    ["invio con un run di prova", claimed({}, { test_run_id: id(20) })],
    [
      "choice senza event_starts_on",
      claimed({}, { choice: { contact_kind: "club", request: "merch_cobranding" } }),
    ],
    [
      "choice con una data non valida",
      claimed({}, { choice: { ...candidateRow.choice, event_starts_on: "5/12" } }),
    ],
    [
      "choice con un tipo fuori elenco",
      claimed({}, { choice: { ...candidateRow.choice, contact_kind: "altro" } }),
    ],
    [
      "choice con una richiesta fuori elenco",
      claimed({}, { choice: { ...candidateRow.choice, request: "regalo" } }),
    ],
    ["registro fuori elenco", claimed({}, { register: "tu" })],
    ["registro nullo", claimed({}, { register: null })],
    ["indirizzo non minuscolo", claimed({}, { address: "Info@club-951.example.test" })],
    ["indirizzo con l'apostrofo", claimed({}, { address: "o'neil@club-963.example.test" })],
    ["CO non intero", claimed({}, { co: 951.5 })],
    ["nome vuoto", claimed({}, { name: "" })],
    ["lingua fuori elenco", claimed({}, { draft: { ...draftRow, language: "pt" } })],
    ["impronta non valida", claimed({}, { draft: { ...draftRow, sha256: "ABC" } })],
    ["bozza senza data", claimed({}, { draft: { ...draftRow, created_at: "ieri" } })],
    ["bozza con il corpo vuoto", claimed({}, { draft: { ...draftRow, body: "" } })],
    ["regole a zero", claimed({}, { draft: { ...draftRow, rules_version: 0 } })],
    ["un array al posto dell'oggetto", [claimed()]],
    ["niente", null],
  ])("claim con %s: { ok: false }", async (_, row) => {
    replying(row);
    expect(await claim(store(), signal())).toEqual({ ok: false });
  });
  it("claim in invio con l'indirizzo nullo: il passo d'invio decide", async () => {
    replying(claimed({}, { address: null }));
    expect(await claim(store(), signal())).toMatchObject({
      ok: true,
      value: { candidate: { address: null } },
    });
  });
  it.each<[string, unknown, Run]>([
    ["prepare con un motivo fuori elenco", { status: "rifiutato", reason: "boh" }, prepare],
    ["prepare senza id", { status: "pronto", message_row_id: "x" }, prepare],
    ["start con un motivo fuori elenco", { status: "stop", reason: "occupato" }, start],
    [
      "finish con un esito diverso",
      { status: "done", send_status: "inviato", replayed: false },
      finish,
    ],
    [
      "finish con un esito fuori elenco",
      { status: "done", send_status: "partito", replayed: false },
      finish,
    ],
    [
      "finish con la ripetizione non booleana",
      { status: "done", send_status: "respinto", replayed: "no" },
      finish,
    ],
    ["fermo con un altro motivo", { status: "done", stop_reason: "spam" }, pause],
    ["variabili senza lease ma lease_persa", { status: "lease_persa" }, environment],
    ["skip con uno stato sconosciuto", { status: "via" }, skip],
  ])("%s: { ok: false }", async (_, row, run) => {
    replying(row);
    expect(await run(store(), signal())).toEqual({ ok: false });
  });
  it("non restituisce i dettagli degli errori del database", async () => {
    mocks.abortSignal.mockResolvedValue({
      data: { status: "done" },
      error: { code: "42501", message: "private sql credentials" },
    });
    expect(await release(store(), signal())).toEqual({ ok: false });
    mocks.abortSignal.mockRejectedValue(new Error("private response"));
    expect(await release(store(), signal())).toEqual({ ok: false });
  });
  it.each<[string, Run]>([
    ["un worker senza UUID", (s) => s.claim("worker", 300, 1, signal())],
    ["una lease troppo corta", (s) => s.claim(workerId, 59, 1, signal())],
    ["una lease troppo lunga", (s) => s.claim(workerId, 601, 1, signal())],
    ["sei indirizzi di prova", (s) => s.claim(workerId, 300, 6, signal())],
    ["indirizzi di prova non interi", (s) => s.claim(workerId, 300, 1.5, signal())],
    ["skip senza lease", (s) => s.skip("x", null, "casella_incerta", signal())],
    [
      "skip senza lavoro per una conversazione",
      (s) => s.skip(lease, null, "conversazione_esistente", signal()),
    ],
    [
      "skip con un motivo sconosciuto",
      (s) => s.skip(lease, null, "x" as "bozza_scaduta", signal()),
    ],
    ["prepare senza operazione", (s) => s.prepare(lease, "op", prepareInput, signal())],
    [
      "prepare con un Message-ID non valido",
      (s) => s.prepare(lease, operationId, { ...prepareInput, messageId: "<x@y>" }, signal()),
    ],
    [
      "prepare con un destinatario non valido",
      (s) =>
        s.prepare(lease, operationId, { ...prepareInput, toAddress: "A@B.example.test" }, signal()),
    ],
    [
      "prepare con un controllo fuori elenco",
      (s) =>
        s.prepare(
          lease,
          operationId,
          { ...prepareInput, mailboxCheck: "forse" as "vuota" },
          signal(),
        ),
    ],
    ["start senza messaggio", (s) => s.start(lease, "x", signal())],
    [
      "finish scartato senza motivo",
      (s) =>
        s.finish(
          lease,
          operationId,
          { ...finishInput, outcome: "scartato", reason: null },
          signal(),
        ),
    ],
    [
      "finish con un motivo con un indirizzo",
      (s) =>
        s.finish(lease, operationId, { ...finishInput, reason: "a@club.example.test" }, signal()),
    ],
    ["copia senza lease", (s) => s.recordAppend("x", messageRowId, true, signal())],
    ["fermo senza lease", (s) => s.pause("x", signal())],
    [
      "rilascio con un testo libero",
      (s) => s.release(lease, { outcome: "Login OK", smtpLogin: null, imapLogin: null }, signal()),
    ],
    [
      "rilascio con un accesso non valido",
      (s) => s.release(lease, { outcome: "ok", smtpLogin: "OK!", imapLogin: null }, signal()),
    ],
    [
      "variabili incoerenti",
      (s) => s.recordEnvironment({ mailboxOk: true, testOk: true, testCount: 0 }, signal()),
    ],
    [
      "sei indirizzi di prova nelle variabili",
      (s) => s.recordEnvironment({ mailboxOk: true, testOk: true, testCount: 6 }, signal()),
    ],
  ])("con %s non chiama il database", async (_, run) => {
    expect(await run(store(), signal())).toEqual({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
