import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createPartnerAssistantFetch,
  createPartnerAssistantStore,
  PARTNER_ASSISTANT_RPC_MAX_BYTES,
  PARTNER_ASSISTANT_RPC_NAMES,
  PARTNER_ASSISTANT_RPC_TIMEOUT_MS,
} from "./store";

// Il codice installato di Supabase/PostgREST è quello vero; solo la rete è finta.
const config = {
  workerSecret: "synthetic-partner-assistant-secret-0000",
  anthropicApiKey: "sk-ant-synthetic-0000000000000000",
  supabaseUrl: "https://synthetic.supabase.co",
  supabaseSecretKey: "sb_secret_synthetic-partner-assistant",
  phone: "+39 000 000 0000",
};
const names = [
  "claim_partner_assistant_step",
  "context_partner_assistant_step",
  "checkpoint_partner_assistant_step",
  "record_partner_assistant_call",
  "complete_partner_assistant_research",
  "complete_partner_assistant_choice",
  "complete_partner_assistant_draft",
  "complete_partner_assistant_review",
  "fail_partner_assistant_step",
  "pause_partner_assistant",
];
const workerId = "90000000-0000-4000-8000-000000000001";
const rpcUrl = (name: string) => `${config.supabaseUrl}/rest/v1/rpc/${name}`;
const claimUrl = rpcUrl("claim_partner_assistant_step");
const init = (body = "{}") => ({
  method: "POST",
  headers: { apikey: config.supabaseSecretKey },
  body,
  signal: new AbortController().signal,
});
const idle = { status: "idle", reason: "vuota" };
const claim = () =>
  createPartnerAssistantStore(config).claim(workerId, 360, new AbortController().signal);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("trasporto delle RPC dell'assistente Partner", () => {
  it("ammette le dieci RPC del worker, con limiti propri", () => {
    expect([...PARTNER_ASSISTANT_RPC_NAMES]).toEqual(names);
    expect(PARTNER_ASSISTANT_RPC_TIMEOUT_MS).toBe(10_000);
    expect(PARTNER_ASSISTANT_RPC_MAX_BYTES).toBe(1_048_576);
  });
  it.each(names)(
    "solo POST verso /rest/v1/rpc/%s, senza redirect, cookie né cache",
    async (name) => {
      const fetcher = vi.fn().mockResolvedValue(Response.json(idle));
      const response = await createPartnerAssistantFetch(config, fetcher)(rpcUrl(name), init());
      expect(await response.json()).toEqual(idle);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(String(fetcher.mock.calls[0]![0])).toBe(rpcUrl(name));
      expect(fetcher.mock.calls[0]![1]).toMatchObject({
        method: "POST",
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
      });
    },
  );
  it.each<[string, string, Record<string, unknown>]>([
    ["GET", claimUrl, { method: "GET" }],
    ["un'altra origine", "https://attacker.test/rest/v1/rpc/claim_partner_assistant_step", {}],
    ["http", "http://synthetic.supabase.co/rest/v1/rpc/claim_partner_assistant_step", {}],
    ["la configurazione del profilo", rpcUrl("configure_partner_assistant"), {}],
    ["la configurazione dello scheduler", rpcUrl("configure_partner_assistant_scheduler"), {}],
    ["una RPC di Shopify", rpcUrl("claim_shopify_order_jobs"), {}],
    ["un comando del team", rpcUrl("set_partner_assistant_mode"), {}],
    ["una tabella", `${config.supabaseUrl}/rest/v1/partners`, {}],
    ["Auth", `${config.supabaseUrl}/auth/v1/user`, {}],
    ["una barra in più", `${claimUrl}/`, {}],
    ["una query", `${claimUrl}?apikey=private`, {}],
    ["un frammento", `${claimUrl}#x`, {}],
    ["credenziali nell'URL", claimUrl.replace("https://", "https://user:pass@"), {}],
    ["senza segnale", claimUrl, { signal: undefined }],
    ["senza corpo", claimUrl, { body: undefined }],
    ["un corpo non testuale", claimUrl, { body: new Blob(["{}"]) }],
  ])("%s: worker_transport_invalid prima di mandare la chiave", async (_, url, change) => {
    const fetcher = vi.fn();
    await expect(
      createPartnerAssistantFetch(config, fetcher)(url, { ...init(), ...change } as RequestInit),
    ).rejects.toThrow("worker_transport_invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rifiuta una richiesta oltre 1 MiB, contata in byte", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(idle));
    const transport = createPartnerAssistantFetch(config, fetcher);
    const atLimit = JSON.stringify({ text: "a".repeat(PARTNER_ASSISTANT_RPC_MAX_BYTES - 11) });
    expect(new TextEncoder().encode(atLimit).byteLength).toBe(PARTNER_ASSISTANT_RPC_MAX_BYTES);
    expect((await transport(claimUrl, init(atLimit))).status).toBe(200);
    const over = JSON.stringify({ text: "a".repeat(PARTNER_ASSISTANT_RPC_MAX_BYTES - 10) });
    await expect(transport(claimUrl, init(over))).rejects.toThrow("worker_transport_invalid");
    // Meno caratteri del limite, più byte: «€» vale tre byte.
    const multibyte = JSON.stringify({ text: "€".repeat(400_000) });
    expect(multibyte.length).toBeLessThan(PARTNER_ASSISTANT_RPC_MAX_BYTES);
    await expect(transport(claimUrl, init(multibyte))).rejects.toThrow("worker_transport_invalid");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([302, 401, 500])(
    "un %s: corpo scartato senza leggerlo, a PostgREST solo un errore generico",
    async (status) => {
      const response = new Response("apikey=private SQL internal value", {
        status,
        headers: { location: "https://attacker.test" },
      });
      const read = vi.spyOn(response.body!, "getReader");
      const received = await createPartnerAssistantFetch(
        config,
        vi.fn().mockResolvedValue(response),
      )(claimUrl, init());
      expect(received.status).toBe(status);
      expect(await received.text()).not.toMatch(/apikey|private|internal|attacker/);
      expect(read).not.toHaveBeenCalled();
      expect(received.headers.get("location")).toBeNull();
    },
  );
  it("accetta una risposta grande sotto 1 MiB, oltre i 64 KiB di Shopify", async () => {
    const large = { status: "ok", text: "a".repeat(512 * 1024) };
    const received = await createPartnerAssistantFetch(
      config,
      vi.fn().mockResolvedValue(Response.json(large)),
    )(claimUrl, init());
    expect(await received.json()).toEqual(large);
  });
  it("rifiuta una risposta oltre 1 MiB anche con un Content-Length falso", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(PARTNER_ASSISTANT_RPC_MAX_BYTES));
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      }),
      { headers: { "content-length": "1" } },
    );
    await expect(
      createPartnerAssistantFetch(config, vi.fn().mockResolvedValue(response))(claimUrl, init()),
    ).rejects.toThrow("worker_response_invalid");
  });
  it("ferma una risposta bloccata dopo 10 secondi, non dopo i 4 di Shopify", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream()));
    let settled = false;
    const pending = createPartnerAssistantFetch(config, fetcher)(claimUrl, init());
    pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    const assertion = expect(pending).rejects.toThrow("worker_aborted");
    await vi.advanceTimersByTimeAsync(PARTNER_ASSISTANT_RPC_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });
});

describe("trasporto con il client Supabase installato", () => {
  it("passa la chiave privata solo alla RPC ammessa, con corpo JSON e senza redirect", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(idle));
    vi.stubGlobal("fetch", fetcher);
    expect(await claim()).toEqual({ ok: true, value: idle });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, sent] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(claimUrl);
    expect(sent).toMatchObject({
      method: "POST",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    expect(new Headers(sent.headers).get("apikey")).toBe(config.supabaseSecretKey);
    expect(JSON.parse(sent.body)).toEqual({ p_worker_id: workerId, p_lease_seconds: 360 });
  });
  it("un 500 con un corpo privato resta incerto: { ok: false }, senza il testo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("private remote body", { status: 500 })),
    );
    const result = await claim();
    expect(result).toEqual({ ok: false });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("una risposta oltre 1 MiB: { ok: false }", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ status: "idle", reason: "a".repeat(PARTNER_ASSISTANT_RPC_MAX_BYTES) }),
        ),
    );
    expect(await claim()).toEqual({ ok: false });
  });
  it("una richiesta oltre 1 MiB non parte: { ok: false }", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await createPartnerAssistantStore(config).completeResearch(
      { jobId: workerId, leaseToken: workerId },
      {
        text: "€".repeat(400_000),
        sources: [],
        model: "claude-opus-5-5",
        rulesVersion: 1,
      },
      "90000000-0000-4000-8000-000000000004",
      new AbortController().signal,
    );
    expect(result).toEqual({ ok: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
