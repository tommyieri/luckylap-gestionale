import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  PARTNER_ASSISTANT_MODEL,
  partnerAssistantCostUsd,
  usageFromMessage,
  type PartnerAssistantUsage,
} from "./cost";

const zero: PartnerAssistantUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  cacheReadTokens: 0,
  webSearches: 0,
};
const cost = (usage: Partial<PartnerAssistantUsage>) =>
  partnerAssistantCostUsd({ ...zero, ...usage });
// Solo i campi di usage che legge usageFromMessage; il resto del messaggio è sintetico.
const withUsage = (usage: Partial<Anthropic.Usage>) =>
  ({
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      ...usage,
    },
  }) as unknown as Anthropic.Message;

describe("costo di una chiamata a Claude", () => {
  it("usa Opus 5.5", () => expect(PARTNER_ASSISTANT_MODEL).toBe("claude-opus-5-5"));
  it("1.000.000 token in ingresso: 4 USD", () => expect(cost({ inputTokens: 1_000_000 })).toBe(4));
  it("100.000 token in uscita: 2 USD", () => expect(cost({ outputTokens: 100_000 })).toBe(2));
  it("8 ricerche web: 0,08 USD", () => expect(cost({ webSearches: 8 })).toBe(0.08));
  it("letture in cache a 0,20 USD per milione", () =>
    expect(cost({ cacheReadTokens: 1_000_000 })).toBe(0.2));
  it("scritture in cache: 5 USD a 5 minuti, 8 USD a un'ora", () => {
    expect(cost({ cacheWrite5mTokens: 1_000_000 })).toBe(5);
    expect(cost({ cacheWrite1hTokens: 1_000_000 })).toBe(8);
  });
  it("somma le voci e arrotonda a 6 decimali", () =>
    // 0,000004 + 0,00002 + 0,000005 + 0,000008 + 0,0000002 + 0,01 = 0,0100372
    expect(
      cost({
        inputTokens: 1,
        outputTokens: 1,
        cacheWrite5mTokens: 1,
        cacheWrite1hTokens: 1,
        cacheReadTokens: 1,
        webSearches: 1,
      }),
    ).toBe(0.010037));
  it("nessun consumo: 0", () => expect(cost({})).toBe(0));
});

describe("usage di una risposta", () => {
  it("legge token, letture in cache e ricerche web", () =>
    expect(
      usageFromMessage(
        withUsage({
          input_tokens: 1200,
          output_tokens: 340,
          cache_read_input_tokens: 5000,
          server_tool_use: { web_search_requests: 3, web_fetch_requests: 2 },
        }),
      ),
    ).toEqual({
      ...zero,
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 5000,
      webSearches: 3,
    }));
  it("ripartisce le scritture in cache tra 5 minuti e un'ora", () =>
    expect(
      usageFromMessage(
        withUsage({
          cache_creation_input_tokens: 900,
          cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 700 },
        }),
      ),
    ).toEqual({ ...zero, cacheWrite5mTokens: 200, cacheWrite1hTokens: 700 }));
  it("le scritture oltre la ripartizione ferma a message_start vanno a 5 minuti", () =>
    expect(
      usageFromMessage(
        withUsage({
          cache_creation_input_tokens: 9000,
          cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 2000 },
        }),
      ),
    ).toEqual({ ...zero, cacheWrite5mTokens: 7000, cacheWrite1hTokens: 2000 }));
  it("con la ripartizione e senza il totale, vale la ripartizione", () =>
    expect(
      usageFromMessage(
        withUsage({
          cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 700 },
        }),
      ),
    ).toEqual({ ...zero, cacheWrite5mTokens: 200, cacheWrite1hTokens: 700 }));
  it("senza ripartizione, tutte le scritture in cache vanno a un'ora", () =>
    expect(usageFromMessage(withUsage({ cache_creation_input_tokens: 900 }))).toEqual({
      ...zero,
      cacheWrite1hTokens: 900,
    }));
  it("campi assenti o null: zero", () => expect(usageFromMessage(withUsage({}))).toEqual(zero));
});
