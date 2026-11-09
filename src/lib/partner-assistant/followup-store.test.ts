import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import {
  createPartnerFollowupFetch,
  createPartnerFollowupStore,
  readPartnerFollowupCandidate,
  type PartnerFollowupCandidate,
  type PartnerFollowupStore,
} from "./followup-store";

const config = {
  workerSecret: "synthetic-worker-secret-00000000000",
  anthropicApiKey: "sk-ant-synthetic-00000000000000000",
  supabaseUrl: "https://synthetic.supabase.co",
  supabaseSecretKey: "sb_secret_synthetic-followups",
  phone: "+39 000 000 0000",
};
const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const messageId = (n: number) => `<${id(n)}@brand.example.test>`;
const signal = () => new AbortController().signal;
const lease = id(1);
const operation = id(2);
const rowId = id(3);
const proofId = id(4);
const now = "2026-11-09T10:00:00Z";
function candidate(): PartnerFollowupCandidate {
  const subject = "Re: Progetto sintetico";
  const body = "Buongiorno,\nTesto sintetico del sollecito.\nUn saluto,";
  const signature = "Nome Sintetico\nRuolo sintetico\n+39 000 000 0000\nhttps://brand.example.test";
  return {
    id: id(10),
    version: 3,
    partner_id: id(951),
    co: 951,
    name: "Partner sintetico",
    porsche_community: false,
    flow_template: false,
    contact_id: id(11),
    address: "info@partner.example.test",
    addresses: ["info@partner.example.test", "alias@partner.example.test"],
    message_ids: [messageId(20)],
    first_subject: "Progetto sintetico",
    first_sent_at: "2026-11-01T08:40:00.123456+00:00",
    language: "it",
    register: "voi",
    timezone: "Europe/Rome",
    country: "Italia",
    followups_sent: 0,
    next_due_on: "2026-11-09",
    send_allowed: true,
    send_not_after: "2099-12-31T23:59:59Z",
    draft: {
      draft_id: id(12),
      number: 1,
      language: "it",
      subject,
      body,
      signature,
      sha256: createHash("sha256")
        .update(`${subject}\n\n${body}\n\n${signature}`, "utf8")
        .digest("hex"),
      rules_version: 3,
      created_at: "2026-11-08T10:00:00Z",
    },
  };
}
const checkInput = {
  result: "clear" as const,
  reason: null,
  checked_at: now,
  proof_sha256: "a".repeat(64),
  folder_count: 6,
  message_count: 42,
};
const prepareInput = {
  expected_version: 3,
  draft_id: id(12),
  number: 1,
  to_address: "info@partner.example.test",
  subject: "Re: Progetto sintetico",
  text: "Testo sintetico\n\nFirma sintetica\n\nFrase di uscita sintetica.",
  opt_out: "Frase di uscita sintetica.",
  raw: "Message-ID: <synthetic@brand.example.test>\r\n\r\nTesto sintetico\r\n",
  message_id: messageId(21),
  proof_id: proofId,
};
const finishInput = {
  messageRowId: rowId,
  outcome: "inviato" as const,
  smtpCode: 250,
  enhancedCode: null,
  spam: false,
  reason: null,
};
const replying = (data: unknown) => mocks.abortSignal.mockResolvedValue({ data, error: null });
type Run = (store: PartnerFollowupStore, signal: AbortSignal) => Promise<unknown>;
const cases: { name: string; run: Run; args: unknown; response: unknown }[] = [
  {
    name: "claim_partner_followup",
    run: (store, s) => store.claim(id(30), 300, s),
    args: { p_worker_id: id(30), p_lease_seconds: 300 },
    response: { status: "claimed", lease_token: lease, mode: "invio", candidate: candidate() },
  },
  {
    name: "record_partner_followup_check",
    run: (store, s) => store.recordCheck(lease, candidate(), checkInput, s),
    args: {
      p_lease_token: lease,
      p_conversation_id: id(10),
      p_expected_version: 3,
      p_payload: checkInput,
    },
    response: { status: "clear", proof_id: proofId, expires_at: "2026-11-09T10:00:30Z" },
  },
  {
    name: "prepare_partner_followup_send",
    run: (store, s) => store.prepare(lease, operation, id(10), prepareInput, s),
    args: {
      p_lease_token: lease,
      p_operation_id: operation,
      p_conversation_id: id(10),
      p_payload: prepareInput,
    },
    response: { status: "pronto", message_row_id: rowId, replayed: false },
  },
  {
    name: "start_partner_followup_send",
    run: (store, s) => store.start(lease, rowId, proofId, s),
    args: { p_lease_token: lease, p_message_row_id: rowId, p_proof_id: proofId },
    response: { status: "in_invio" },
  },
  {
    name: "finish_partner_followup_send",
    run: (store, s) => store.finish(lease, operation, finishInput, s),
    args: {
      p_lease_token: lease,
      p_operation_id: operation,
      p_payload: {
        message_row_id: rowId,
        outcome: "inviato",
        smtp_code: 250,
        enhanced_code: null,
        spam: false,
        reason: null,
      },
    },
    response: { status: "done", send_status: "inviato", replayed: false },
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal });
});

describe("candidato dei solleciti", () => {
  it.each([null, undefined, "", "domani", "2026-02-30T15:00:00Z", 123])(
    "non accetta una scadenza del trasporto non valida: %s",
    (deadline) => {
      expect(readPartnerFollowupCandidate({ ...candidate(), send_not_after: deadline })).toBeNull();
    },
  );
  it("un candidato da inviare senza scadenza è incompleto, uno solo da osservare è leggibile", () => {
    const row = { ...candidate() } as Record<string, unknown>;
    delete row.send_not_after;
    expect(readPartnerFollowupCandidate(row)).toBeNull();
    expect(
      readPartnerFollowupCandidate({ ...row, send_allowed: false, draft: null }),
    ).not.toBeNull();
  });
  it("preserva testo, impronte, versione e indirizzi senza mutare la risposta", () => {
    const c = candidate();
    const before = structuredClone(c);
    expect(readPartnerFollowupCandidate(c)).toEqual(before);
    expect(c).toEqual(before);
    expect(readPartnerFollowupCandidate({ ...c, draft: null, send_allowed: false })).toEqual({
      ...c,
      draft: null,
      send_allowed: false,
    });
  });
  it.each([
    "name",
    "porsche_community",
    "draft",
    "message_ids",
    "addresses",
    "first_sent_at",
    "timezone",
  ])("rifiuta un campo richiesto mancante, %s", (key) => {
    const c = candidate() as unknown as Record<string, unknown>;
    delete c[key];
    expect(readPartnerFollowupCandidate(c)).toBeNull();
  });
  it.each([
    { name: 7 },
    { porsche_community: "false" },
    { send_allowed: "true" },
    { extra: true },
    { id: "00000000-0000-0000-0000-000000000000" },
    { partner_id: "bad" },
    { version: 0 },
    { co: 951.5 },
    { language: "pt" },
    { register: "tu" },
    { timezone: "Non/Esistente" },
    { first_subject: "Injected\r\nBcc: private@example.test" },
    { address: "info@partner.example.test,other@example.test" },
    { address: "Nome <info@partner.example.test>" },
    { addresses: ["INFO@partner.example.test"] },
    { addresses: ["other@partner.example.test"] },
    { addresses: ["info@partner.example.test", "info@partner.example.test"] },
    {
      addresses: [
        "info@partner.example.test",
        ...Array.from({ length: 32 }, (_, index) => `alias-${index}@partner.example.test`),
      ],
    },
    { message_ids: [] },
    { message_ids: [messageId(20), messageId(20)] },
    { message_ids: [messageId(20) + "\r\nX-Header: injected"] },
    { message_ids: Array.from({ length: 6 }, (_, index) => messageId(index + 20)) },
    { followups_sent: -1 },
    { followups_sent: 5 },
    { next_due_on: "2026-02-30" },
    { first_sent_at: "ieri" },
  ])("rifiuta candidato malformato (%#)", (changes) => {
    expect(readPartnerFollowupCandidate({ ...candidate(), ...changes })).toBeNull();
  });
  it.each(["2026-99-01", "2026-00-01"])(
    "la data impossibile %s restituisce null senza eccezioni",
    (next_due_on) => {
      expect(() => readPartnerFollowupCandidate({ ...candidate(), next_due_on })).not.toThrow();
      expect(readPartnerFollowupCandidate({ ...candidate(), next_due_on })).toBeNull();
    },
  );
  it.each(["2026-02-30T12:00:00Z", "2026-11-09T10:00:00", "2026-11-09T25:00:00Z"])(
    "rifiuta istanti ambigui o impossibili (%s)",
    (first_sent_at) =>
      expect(readPartnerFollowupCandidate({ ...candidate(), first_sent_at })).toBeNull(),
  );
  it.each([
    ["en", "voi"],
    ["fr", "you"],
    ["de", "usted"],
    ["it", "vous"],
    ["es", "sie"],
  ])("rifiuta registro %s/%s incoerente", (language, register) => {
    expect(
      readPartnerFollowupCandidate({ ...candidate(), draft: null, language, register }),
    ).toBeNull();
  });
  it.each([
    ["it", "voi"],
    ["it", "lei"],
    ["en", "you"],
    ["fr", "vous"],
    ["de", "sie"],
    ["es", "usted"],
  ])("ammette la coppia lingua/registro %s/%s", (language, register) => {
    expect(
      readPartnerFollowupCandidate({ ...candidate(), draft: null, language, register }),
    ).toMatchObject({ language, register });
  });
  it.each([
    { number: 2 },
    { language: "en" },
    { draft_id: "bad" },
    { sha256: "z".repeat(64) },
    { body: "x".repeat(8001) },
    { rules_version: 0 },
    { created_at: "ieri" },
    { extra: true },
  ])("rifiuta una bozza incompatibile con la conversazione (%#)", (changes) => {
    const c = candidate();
    expect(readPartnerFollowupCandidate({ ...c, draft: { ...c.draft, ...changes } })).toBeNull();
  });
  it("rifiuta un SHA formalmente valido che non corrisponde al testo della bozza", () => {
    const c = candidate();
    expect(
      readPartnerFollowupCandidate({ ...c, draft: { ...c.draft, body: "Testo alterato" } }),
    ).toBeNull();
  });
  it("legge cinque riferimenti distinti senza inventare una quinta bozza", () => {
    const c = candidate();
    const value = {
      ...c,
      followups_sent: 4,
      message_ids: Array.from({ length: 5 }, (_, index) => messageId(index + 20)),
      draft: null,
      send_allowed: false,
    };
    expect(readPartnerFollowupCandidate(value)).toEqual(value);
  });
});

describe("RPC dei solleciti", () => {
  it.each(cases)("usa gli argomenti SQL esatti per $name", async (c) => {
    replying(c.response);
    const s = signal();
    expect(await c.run(createPartnerFollowupStore(config), s)).toEqual({
      ok: true,
      value: c.response,
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(c.name, c.args);
    expect(mocks.abortSignal).toHaveBeenCalledExactlyOnceWith(s);
    expect(mocks.createClient).toHaveBeenCalledWith(config.supabaseUrl, config.supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: expect.any(Function) },
    });
  });
  it.each(cases)("fallisce chiuso su risposta null, errore o eccezione di $name", async (c) => {
    const store = createPartnerFollowupStore(config);
    replying(null);
    expect(await c.run(store, signal())).toEqual({ ok: false });
    mocks.abortSignal.mockResolvedValue({ data: c.response, error: { message: "Dato riservato" } });
    expect(await c.run(store, signal())).toEqual({ ok: false });
    mocks.abortSignal.mockRejectedValue(new Error("Dato riservato"));
    expect(await c.run(store, signal())).toEqual({ ok: false });
  });
  it.each(cases)("rifiuta proprietà aggiunte alla risposta di $name", async (c) => {
    replying({ ...(c.response as object), injected: true });
    expect(await c.run(createPartnerFollowupStore(config), signal())).toEqual({ ok: false });
  });
  it.each([
    { status: "claimed", lease_token: "bad", mode: "invio", candidate: candidate() },
    { status: "claimed", lease_token: lease, mode: "prova", candidate: candidate() },
    { status: "claimed", lease_token: lease, mode: "invio", candidate: null },
    { status: "idle", reason: "info@private.example.test" },
  ])("un claim malformato non diventa autorizzazione (%#)", async (response) => {
    replying(response);
    expect(await createPartnerFollowupStore(config).claim(id(30), 300, signal())).toEqual({
      ok: false,
    });
  });
  it("legge osserva, retry, blocco e lease persa senza confonderli con permessi", async () => {
    const store = createPartnerFollowupStore(config);
    const observed = {
      status: "claimed",
      lease_token: lease,
      mode: "osserva",
      candidate: { ...candidate(), draft: null, send_allowed: false },
    };
    replying(observed);
    expect(await store.claim(id(30), 300, signal())).toEqual({ ok: true, value: observed });
    for (const response of [
      { status: "retry", reason: "lettura_incompleta" },
      { status: "blocked", reason: "reply" },
      { status: "lease_persa" },
    ]) {
      replying(response);
      expect(await store.recordCheck(lease, candidate(), checkInput, signal())).toEqual({
        ok: true,
        value: response,
      });
    }
    replying({ status: "stop", reason: "contesto_cambiato" });
    expect(await store.start(lease, rowId, proofId, signal())).toEqual({
      ok: true,
      value: { status: "stop", reason: "contesto_cambiato" },
    });
  });
  it.each([
    { index: 2, response: { status: "pronto", message_row_id: "bad", replayed: false } },
    { index: 2, response: { status: "pronto", message_row_id: rowId, replayed: "false" } },
    { index: 3, response: { status: "in_invio", proof_id: proofId } },
    { index: 3, response: { status: "stop", reason: "Private provider details" } },
    { index: 4, response: { status: "done", send_status: "pronto", replayed: false } },
    { index: 4, response: { status: "done", send_status: "inviato", replayed: "false" } },
  ])("non conferma mutazioni con risposte danneggiate (%#)", async ({ index, response }) => {
    replying(response);
    expect(await cases[index].run(createPartnerFollowupStore(config), signal())).toEqual({
      ok: false,
    });
  });
  it.each([
    { status: "clear", proof_id: "bad", expires_at: now },
    { status: "clear", proof_id: proofId, expires_at: "ieri" },
    { status: "blocked", reason: "Risposta privata @ indirizzo" },
    { status: "in_invio" },
  ])("una risposta check danneggiata resta un errore (%#)", async (response) => {
    replying(response);
    expect(
      await createPartnerFollowupStore(config).recordCheck(
        lease,
        candidate(),
        checkInput,
        signal(),
      ),
    ).toEqual({ ok: false });
  });
  it("propaga il segnale cancellato e ritorna errore anche se la RPC non termina", async () => {
    mocks.abortSignal.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const running = createPartnerFollowupStore(config).claim(id(30), 300, controller.signal);
    controller.abort();
    expect(await running).toEqual({ ok: false });
  });
  it.each([
    (s: PartnerFollowupStore) => s.claim("bad", 300, signal()),
    (s: PartnerFollowupStore) => s.claim(id(30), 601, signal()),
    (s: PartnerFollowupStore) =>
      s.recordCheck(
        lease,
        candidate(),
        { ...checkInput, reason: "private@example.test" },
        signal(),
      ),
    (s: PartnerFollowupStore) =>
      s.recordCheck(lease, candidate(), { ...checkInput, folder_count: 2 }, signal()),
    (s: PartnerFollowupStore) =>
      s.recordCheck(lease, candidate(), { ...checkInput, message_count: 5001 }, signal()),
    (s: PartnerFollowupStore) =>
      s.prepare(
        lease,
        operation,
        id(10),
        { ...prepareInput, to_address: "x@example.test,y@example.test" },
        signal(),
      ),
    (s: PartnerFollowupStore) =>
      s.prepare(lease, operation, id(10), { ...prepareInput, raw: "a".repeat(65537) }, signal()),
    (s: PartnerFollowupStore) =>
      s.prepare(lease, operation, id(10), { ...prepareInput, raw: "Unicode é" }, signal()),
    (s: PartnerFollowupStore) => s.start(lease, rowId, "bad", signal()),
    (s: PartnerFollowupStore) =>
      s.finish(
        lease,
        operation,
        { ...finishInput, reason: "Provider error with private text" },
        signal(),
      ),
    (s: PartnerFollowupStore) =>
      s.finish(lease, operation, { ...finishInput, smtpCode: 100 }, signal()),
  ])("rifiuta input non sicuri senza chiamare la RPC (%#)", async (run) => {
    expect(await run(createPartnerFollowupStore(config))).toEqual({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("trasporto HTTP limitato dei solleciti", () => {
  const url = `${config.supabaseUrl}/rest/v1/rpc/start_partner_followup_send`;
  const request = () => ({ method: "POST", body: "{}", signal: signal() });
  it("ammette solo RPC previste sul progetto configurato e protegge i segreti dai redirect", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "in_invio" }));
    const response = await createPartnerFollowupFetch(config, fetcher)(url, request());
    expect(await response.json()).toEqual({ status: "in_invio" });
    expect(fetcher).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([
    ["https://other.example.test/rest/v1/rpc/start_partner_followup_send", "POST"],
    [`${config.supabaseUrl}/rest/v1/partner_assistant_messages`, "POST"],
    [`${config.supabaseUrl}/rest/v1/rpc/configure_partner_assistant`, "POST"],
    [`${url}?apikey=synthetic`, "POST"],
    [`${url}#fragment`, "POST"],
    [url, "GET"],
    [url, "DELETE"],
  ])("blocca destinazione o metodo non consentiti (%#)", async (destination, method) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      createPartnerFollowupFetch(config, fetcher)(destination, { ...request(), method }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("limita i byte UTF-8 della richiesta prima di usare la rete", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      createPartnerFollowupFetch(config, fetcher)(url, { ...request(), body: "é".repeat(524289) }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["not JSON", "", "a".repeat(1048577)])(
    "rifiuta corpi HTTP200 incompleti, invalidi o eccessivi (%#)",
    async (body) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
      await expect(createPartnerFollowupFetch(config, fetcher)(url, request())).rejects.toThrow();
    },
  );
  it("cancella il fetch su abort e non legge messaggi privati dagli errori HTTP", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = createPartnerFollowupFetch(config, fetcher)(url, {
      ...request(),
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    fetcher.mockResolvedValue(new Response("Private provider details", { status: 500 }));
    const response = await createPartnerFollowupFetch(config, fetcher)(url, request());
    expect(await response.json()).toEqual({
      code: "worker_database_unavailable",
      message: "worker_database_unavailable",
    });
  });
  it("un segnale già cancellato impedisce la richiesta", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      createPartnerFollowupFetch(config, fetcher)(url, { ...request(), signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
