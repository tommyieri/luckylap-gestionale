import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import {
  classifyClaudeError,
  createPartnerAssistantClaude,
  partnerAssistantResearchText,
  type ClaudeCall,
} from "./claude";

// Il client vero dell'SDK non parte mai: lo sostituisce un client finto che registra le richieste
// e risponde con messaggi sintetici. Le classi di errore restano quelle vere dell'SDK.
type FakeReply = {
  final: (signal: AbortSignal) => Promise<Anthropic.Message>;
  /** Il messaggio ricostruito fin lì dallo stream, se è partito. */
  partial?: Anthropic.Message;
};
type FakeRequest = {
  body: Record<string, unknown>;
  options: { signal?: AbortSignal; timeout?: number };
};
const fake = vi.hoisted(() => ({
  clients: [] as unknown[],
  requests: [] as FakeRequest[],
  replies: [] as FakeReply[],
}));
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic {
    constructor(options: unknown) {
      fake.clients.push(options);
    }
    messages = {
      stream: (body: Record<string, unknown>, options: FakeRequest["options"]) => {
        fake.requests.push({ body: structuredClone(body), options });
        const reply = fake.replies.shift();
        if (!reply) throw new Error("manca la risposta finta");
        return {
          finalMessage: () => reply.final(options.signal ?? new AbortController().signal),
          get currentMessage() {
            return reply.partial;
          },
        };
      },
    };
  }
  return { ...actual, default: FakeAnthropic };
});

const block = (value: Record<string, unknown>) => value as unknown as Anthropic.ContentBlock;
const text = (value: string, urls: string[] = []) =>
  block({
    type: "text",
    text: value,
    citations: urls.length
      ? urls.map((url) => ({
          type: "web_search_result_location",
          url,
          title: "Pagina sintetica",
          cited_text: value,
          encrypted_index: "synthetic",
        }))
      : null,
  });
const searchResults = (urls: string[]) =>
  block({
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_synthetic",
    content: urls.map((url) => ({
      type: "web_search_result",
      url,
      title: "Risultato sintetico",
      encrypted_content: "synthetic",
      page_age: null,
    })),
  });
const searchUse = block({
  type: "server_tool_use",
  id: "srvtoolu_synthetic",
  name: "web_search",
  input: { query: "Club sintetico example.test" },
});
const usage = (input: number, searches = 0) =>
  ({
    input_tokens: input,
    output_tokens: 10,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: null,
    server_tool_use: { web_search_requests: searches },
  }) as unknown as Anthropic.Usage;
const message = (
  stopReason: Anthropic.StopReason,
  content: Anthropic.ContentBlock[],
  input = 100,
  searches = 0,
) =>
  ({
    id: "msg_synthetic",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: usage(input, searches),
  }) as unknown as Anthropic.Message;
const replyWith = (value: Anthropic.Message): FakeReply => ({ final: async () => value });
const failWith = (error: unknown): FakeReply => ({ final: async () => Promise.reject(error) });
/** Uno stream partito che non finisce: si ferma solo con l'abort del segnale della richiesta. */
const hangUntilAbort = (partial?: Anthropic.Message): FakeReply => ({
  final: (signal) =>
    new Promise((_, reject) => {
      if (signal.aborted) reject(new APIUserAbortError());
      signal.addEventListener("abort", () => reject(new APIUserAbortError()));
    }),
  partial,
});
const apiError = (status: number, type: string, detail: string) =>
  APIError.generate(
    status,
    { type: "error", error: { type, message: detail || type } },
    undefined,
    new Headers(),
  );
const usageOf = (input: number, searches = 0) => ({
  inputTokens: input,
  outputTokens: 10,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  cacheReadTokens: 0,
  webSearches: searches,
});

const call: ClaudeCall = {
  system: "Regole sintetiche di scrittura.",
  messages: [{ role: "user", content: "Studia il contatto sintetico CO 951." }],
  effort: "high",
  maxTokens: 32000,
};
const run = (
  input: ClaudeCall = call,
  signal = new AbortController().signal,
  timeoutMs = 240_000,
) =>
  createPartnerAssistantClaude("sk-ant-synthetic-0000000000000000").call(input, signal, timeoutMs);
/** La promessa e un flag che dice se è già finita. */
const watch = <T>(promise: Promise<T>) => {
  const state = { settled: false, promise };
  void promise.then(() => (state.settled = true));
  return state;
};
const sentBody = (index = 0) => fake.requests[index]?.body;

beforeEach(() => {
  fake.clients.length = 0;
  fake.requests.length = 0;
  fake.replies.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("client Claude dell'assistente Partner", () => {
  it("ripete su pause_turn, unisce i contenuti e conta ogni chiamata", async () => {
    const first = [searchUse, searchResults(["https://club.example.test/"])];
    const second = [text("Il club "), text("ha un evento.", ["https://club.example.test/"])];
    fake.replies.push(
      replyWith(message("pause_turn", first, 100, 1)),
      replyWith(message("end_turn", second, 200)),
    );
    const r = await run();
    expect(r.ok && r.contents).toHaveLength(4);
    expect(r.ok && r.contents).toEqual([...first, ...second]);
    expect(r.ok && r.message.stop_reason).toBe("end_turn");
    expect(r.usages).toEqual([usageOf(100, 1), usageOf(200)]);
    expect(fake.requests).toHaveLength(2);
    expect(sentBody(1)?.messages).toEqual([
      ...call.messages,
      { role: "assistant", content: first },
    ]);
  });

  it("dopo 4 continuazioni: troppe_continuazioni", async () => {
    for (let i = 0; i < 6; i++) fake.replies.push(replyWith(message("pause_turn", [searchUse])));
    const r = await run();
    expect(r).toEqual({
      ok: false,
      code: "troppe_continuazioni",
      usages: Array.from({ length: 5 }, () => usageOf(100)),
    });
    expect(fake.requests).toHaveLength(5);
    expect(sentBody(4)?.messages).toEqual([
      ...call.messages,
      { role: "assistant", content: [searchUse, searchUse, searchUse, searchUse] },
    ]);
  });

  it.each([
    [402, "billing_error", "", "credito"],
    [400, "invalid_request_error", "Your credit balance is too low", "credito"],
    [401, "authentication_error", "", "errore"],
    [429, "rate_limit_error", "", "attesa"],
    [529, "overloaded_error", "", "attesa"],
    [400, "invalid_request_error", "bad", "fallito"],
  ])("%i %s → %s", async (status, type, detail, code) => {
    fake.replies.push(failWith(apiError(status, type, detail)));
    expect(await run()).toEqual({ ok: false, code, usages: [] });
  });

  it("errore su una continuazione: restano gli usage delle chiamate già fatte", async () => {
    fake.replies.push(
      replyWith(message("pause_turn", [searchUse], 100, 2)),
      failWith(apiError(402, "billing_error", "")),
    );
    expect(await run()).toEqual({ ok: false, code: "credito", usages: [usageOf(100, 2)] });
  });

  it("abort del segnale: timeout, con l'usage della chiamata interrotta", async () => {
    const controller = new AbortController();
    fake.replies.push(hangUntilAbort(message("end_turn", [], 300, 1)));
    const pending = run(call, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ ok: false, code: "timeout", usages: [usageOf(300, 1)] });
    expect(fake.requests[0]?.options.signal?.aborted).toBe(true);
  });

  // Il timeout dell'SDK si spegne all'arrivo delle intestazioni: uno stream già partito lo ferma
  // solo il nostro timer.
  it("allo scadere di timeoutMs ferma anche uno stream già partito: timeout", async () => {
    vi.useFakeTimers();
    const worker = new AbortController();
    fake.replies.push(hangUntilAbort(message("end_turn", [], 300, 1)));
    const pending = watch(run(call, worker.signal, 240_000));
    await vi.advanceTimersByTimeAsync(239_999);
    expect(pending.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(pending.settled).toBe(true);
    expect(await pending.promise).toEqual({
      ok: false,
      code: "timeout",
      usages: [usageOf(300, 1)],
    });
    expect(fake.requests[0]?.options.signal?.aborted).toBe(true);
    expect(fake.requests[0]?.options.timeout).toBe(240_000);
    expect(worker.signal.aborted).toBe(false);
  });

  it("timeoutMs vale per tutte le continuazioni insieme, non per ognuna", async () => {
    vi.useFakeTimers();
    fake.replies.push(
      {
        final: () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(message("pause_turn", [searchUse], 100, 1)), 200_000),
          ),
      },
      hangUntilAbort(message("end_turn", [], 300, 1)),
      replyWith(message("end_turn", [text("ok")])),
    );
    const pending = watch(run(call, new AbortController().signal, 240_000));
    await vi.advanceTimersByTimeAsync(200_000);
    expect(fake.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(39_999);
    expect(pending.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(pending.settled).toBe(true);
    expect(await pending.promise).toEqual({
      ok: false,
      code: "timeout",
      usages: [usageOf(100, 1), usageOf(300, 1)],
    });
    expect(fake.requests).toHaveLength(2);
  });

  it("a chiamata finita il timer si spegne", async () => {
    vi.useFakeTimers();
    fake.replies.push(replyWith(message("end_turn", [text("ok")])));
    expect((await run()).ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("abort tra due continuazioni: timeout senza una nuova chiamata", async () => {
    const controller = new AbortController();
    fake.replies.push(
      {
        final: async () => {
          controller.abort();
          return message("pause_turn", [searchUse], 100, 1);
        },
      },
      replyWith(message("end_turn", [text("ok")])),
    );
    expect(await run(call, controller.signal)).toEqual({
      ok: false,
      code: "timeout",
      usages: [usageOf(100, 1)],
    });
    expect(fake.requests).toHaveLength(1);
  });

  it("system con cache di un'ora, thinking adattivo, niente temperature", async () => {
    fake.replies.push(replyWith(message("end_turn", [text("ok")])));
    await run();
    expect(sentBody()).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 32000,
      system: [
        {
          type: "text",
          text: "Regole sintetiche di scrittura.",
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      thinking: { type: "adaptive" },
      messages: call.messages,
    });
    expect(sentBody()?.output_config).toEqual({ effort: "high" });
    for (const key of ["temperature", "top_p", "top_k", "tool_choice", "tools"])
      expect(sentBody()).not.toHaveProperty(key);
    expect(sentBody()?.thinking).toEqual({ type: "adaptive" });
    expect(fake.clients).toEqual([{ apiKey: "sk-ant-synthetic-0000000000000000", maxRetries: 0 }]);
    expect(fake.requests[0]?.options.timeout).toBe(240_000);
  });

  it("output strutturato e strumenti passano com'erano", async () => {
    const schema = { type: "object", properties: { subject: { type: "string" } } };
    const tools: Anthropic.Messages.ToolUnion[] = [
      { type: "web_search_20260209", name: "web_search", max_uses: 8 },
      { type: "web_fetch_20260209", name: "web_fetch" },
    ];
    fake.replies.push(replyWith(message("end_turn", [text("{}")])));
    await run({ ...call, effort: "low", maxTokens: 8000, format: schema, tools });
    expect(sentBody()).toMatchObject({ max_tokens: 8000, tools });
    expect(sentBody()?.output_config).toEqual({
      effort: "low",
      format: { type: "json_schema", schema },
    });
  });
});

describe("classificazione degli errori di Claude", () => {
  it.each<[string, unknown, string]>([
    ["connessione", new APIConnectionError({ message: "rete sintetica" }), "attesa"],
    ["timeout dell'SDK", new APIConnectionTimeoutError(), "attesa"],
    ["500", apiError(500, "api_error", ""), "attesa"],
    ["503", apiError(503, "api_error", ""), "attesa"],
    [
      "overloaded_error a metà stream, senza stato",
      new APIError(
        undefined,
        { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
        undefined,
        new Headers(),
        "overloaded_error",
      ),
      "attesa",
    ],
    ["403", apiError(403, "permission_error", ""), "errore"],
    ["400 con billing_error", apiError(400, "billing_error", ""), "credito"],
    ["404", apiError(404, "not_found_error", ""), "fallito"],
    ["errore qualsiasi", new Error("sintetico"), "fallito"],
    ["valore non errore", "sintetico", "fallito"],
  ])("%s → %s", (_, error, code) => expect(classifyClaudeError(error)).toBe(code));
});

describe("testo e fonti della ricerca", () => {
  it("il testo sono i blocchi text in ordine", () =>
    expect(
      partnerAssistantResearchText([
        searchUse,
        searchResults(["https://club.example.test/"]),
        text("Il club "),
        text("organizza un raduno.", ["https://club.example.test/raduno"]),
      ]).text,
    ).toBe("Il club organizza un raduno."));

  it("fonti senza doppioni e al massimo 40", () => {
    const urls = Array.from({ length: 50 }, (_, i) => `https://club${i}.example.test/`);
    const manySources = [
      searchResults(urls.slice(0, 30)),
      searchResults(urls.slice(10, 50)),
      text("Fatto.", [urls[0]!, urls[1]!]),
    ];
    const { sources } = partnerAssistantResearchText(manySources);
    expect(sources).toHaveLength(40);
    expect(new Set(sources).size).toBe(40);
  });

  it("le fonti citate vengono prima dei risultati di ricerca", () =>
    expect(
      partnerAssistantResearchText([
        searchResults(["https://a.example.test/", "https://b.example.test/"]),
        text("Fatto.", ["https://b.example.test/", "https://c.example.test/"]),
      ]).sources,
    ).toEqual(["https://b.example.test/", "https://c.example.test/", "https://a.example.test/"]));

  it("solo URL https che il database accetta", () =>
    expect(
      partnerAssistantResearchText([
        searchResults([
          "http://club.example.test/",
          "https://club.example.test/ spazio",
          "https://utente@club.example.test/",
          `https://club.example.test/${"a".repeat(2048)}`,
          "ftp://club.example.test/",
          "https://club.example.test/eventi?anno=2027#date",
        ]),
      ]).sources,
    ).toEqual(["https://club.example.test/eventi?anno=2027#date"]));

  it("errore della ricerca web: nessuna fonte", () =>
    expect(
      partnerAssistantResearchText([
        block({
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_synthetic",
          content: { type: "web_search_tool_result_error", error_code: "unavailable" },
        }),
        text("Niente."),
      ]),
    ).toEqual({ text: "Niente.", sources: [] }));

  it("30.000 caratteri da 3 byte: al massimo 60.000 byte, con un carattere intero in fondo", () => {
    const { text: cut } = partnerAssistantResearchText([text("ab" + "€".repeat(30_000))]);
    expect(Buffer.byteLength(cut)).toBeLessThanOrEqual(60_000);
    expect(cut).toBe("ab" + "€".repeat(19_999));
  });

  it("non spezza una coppia surrogata", () => {
    const { text: cut } = partnerAssistantResearchText([text("a" + "😀".repeat(20_000))]);
    expect(Buffer.byteLength(cut)).toBeLessThanOrEqual(60_000);
    expect(cut).toBe("a" + "😀".repeat(14_999));
  });

  it("un testo di 60.000 byte esatti resta intero", () => {
    const exact = "€".repeat(20_000);
    expect(partnerAssistantResearchText([text(exact)]).text).toBe(exact);
  });
});
