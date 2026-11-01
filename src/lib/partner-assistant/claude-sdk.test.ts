import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import Anthropic from "@anthropic-ai/sdk";
import { createPartnerAssistantClaude, type ClaudeCall } from "./claude";

// Qui gira l'SDK vero, con una fetch finta: risponde subito con le intestazioni dello stream,
// manda `message_start` e poi non manda più niente, come una ricerca lunga. Si ferma solo con
// l'abort del segnale della richiesta. Nessuna chiamata di rete.
const messageStart = {
  type: "message_start",
  message: {
    id: "msg_synthetic",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: 300,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      server_tool_use: { web_search_requests: 0 },
    },
  },
};
const hangingStream = async (_url: unknown, init?: RequestInit) => {
  const signal = init?.signal;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`),
      );
      signal?.addEventListener(
        "abort",
        () => controller.error(new DOMException("Richiesta interrotta", "AbortError")),
        { once: true },
      );
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream", "request-id": "req_synthetic" },
  });
};
/** Uno stream che manda message_start e poi cade (`reset`) o si chiude senza message_stop. */
const brokenStream = (mode: "reset" | "close") => async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`),
      );
      setTimeout(() => {
        if (mode === "reset") controller.error(new TypeError("terminated"));
        else controller.close();
      }, 5);
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream", "request-id": "req_synthetic" },
  });
};
/** Una ricerca completa: message_start scrive il system prompt a un'ora, poi message_delta porta
 * i totali dell'intero messaggio, con le scritture fatte sui risultati delle ricerche. */
const searchStream = async () => {
  const events = [
    {
      type: "message_start",
      message: {
        ...messageStart.message,
        usage: {
          ...messageStart.message.usage,
          cache_creation_input_tokens: 2000,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2000 },
        },
      },
    },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: {
        input_tokens: 900,
        output_tokens: 500,
        cache_creation_input_tokens: 9000,
        cache_read_input_tokens: 40000,
        server_tool_use: { web_search_requests: 2 },
      },
    },
    { type: "message_stop" },
  ];
  const text = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(new TextEncoder().encode(text), {
    status: 200,
    headers: { "content-type": "text/event-stream", "request-id": "req_synthetic" },
  });
};
const call: ClaudeCall = {
  system: "Regole sintetiche di scrittura.",
  messages: [{ role: "user", content: "Studia il contatto sintetico CO 951." }],
  effort: "high",
  maxTokens: 32000,
};
const settledWithin = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("timeout del client Claude con l'SDK vero", () => {
  it("il timeout dell'SDK si spegne con le intestazioni: da solo non ferma lo stream", async () => {
    const client = new Anthropic({
      apiKey: "sk-ant-synthetic-0000000000000000",
      maxRetries: 0,
      fetch: hangingStream,
    });
    const controller = new AbortController();
    const stream = client.messages.stream(
      { model: "claude-opus-5-5", max_tokens: 1000, messages: call.messages },
      { signal: controller.signal, timeout: 50 },
    );
    const final = stream.finalMessage().catch(() => undefined);
    expect(await settledWithin(final, 300)).toBe(false);
    controller.abort();
    await final;
  });

  it("allo scadere di timeoutMs la chiamata finisce in timeout, con l'usage di message_start", async () => {
    vi.stubGlobal("fetch", hangingStream);
    const worker = new AbortController();
    const result = createPartnerAssistantClaude("sk-ant-synthetic-0000000000000000").call(
      call,
      worker.signal,
      50,
    );
    expect(await settledWithin(result, 2_000)).toBe(true);
    expect(await result).toEqual({
      ok: false,
      code: "timeout",
      usages: [
        {
          inputTokens: 300,
          outputTokens: 1,
          cacheWrite5mTokens: 0,
          cacheWrite1hTokens: 0,
          cacheReadTokens: 0,
          webSearches: 0,
        },
      ],
    });
    expect(worker.signal.aborted).toBe(false);
  });
});

describe("consumo di una ricerca, con l'SDK vero", () => {
  it("conta le scritture in cache arrivate con message_delta", async () => {
    vi.stubGlobal("fetch", searchStream);
    const result = await createPartnerAssistantClaude("sk-ant-synthetic-0000000000000000").call(
      call,
      new AbortController().signal,
      2_000,
    );
    expect(result).toMatchObject({
      ok: true,
      usages: [
        {
          inputTokens: 900,
          outputTokens: 500,
          cacheWrite5mTokens: 7000,
          cacheWrite1hTokens: 2000,
          cacheReadTokens: 40000,
          webSearches: 2,
        },
      ],
    });
  });
});

describe("connessione che cade a metà stream, con l'SDK vero", () => {
  it("la connessione cade dopo message_start: attesa, con l'usage arrivato", async () => {
    vi.stubGlobal("fetch", brokenStream("reset"));
    const result = await createPartnerAssistantClaude("sk-ant-synthetic-0000000000000000").call(
      call,
      new AbortController().signal,
      2_000,
    );
    expect(result).toEqual({
      ok: false,
      code: "attesa",
      usages: [
        {
          inputTokens: 300,
          outputTokens: 1,
          cacheWrite5mTokens: 0,
          cacheWrite1hTokens: 0,
          cacheReadTokens: 0,
          webSearches: 0,
        },
      ],
    });
  });

  it("lo stream si chiude senza message_stop: attesa, con l'usage di message_start", async () => {
    vi.stubGlobal("fetch", brokenStream("close"));
    const result = await createPartnerAssistantClaude("sk-ant-synthetic-0000000000000000").call(
      call,
      new AbortController().signal,
      2_000,
    );
    // L'SDK azzera lo snapshot prima di rifiutare finalMessage: l'usage arriva dall'ultimo
    // snapshot visto dagli eventi dello stream.
    expect(result).toEqual({
      ok: false,
      code: "attesa",
      usages: [
        {
          inputTokens: 300,
          outputTokens: 1,
          cacheWrite5mTokens: 0,
          cacheWrite1hTokens: 0,
          cacheReadTokens: 0,
          webSearches: 0,
        },
      ],
    });
  });
});
