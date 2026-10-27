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
