import type Anthropic from "@anthropic-ai/sdk";
import type { PartnerAssistantCallRecord } from "./types";

export const PARTNER_ASSISTANT_MODEL = "claude-opus-5-5";

/** Prezzi pubblici di Opus 5.5 in USD per milione di token. */
export const PARTNER_ASSISTANT_PRICE_PER_MILLION_USD = {
  input: 4,
  output: 20,
  cacheWrite5m: 5,
  cacheWrite1h: 8,
  cacheRead: 0.2,
} as const;
/** Prezzo in USD di una ricerca web. */
export const PARTNER_ASSISTANT_WEB_SEARCH_USD = 0.01;

/** Il consumo di una chiamata, con i nomi delle colonne del registro delle chiamate. */
export type PartnerAssistantUsage = Pick<
  PartnerAssistantCallRecord,
  | "inputTokens"
  | "outputTokens"
  | "cacheWrite5mTokens"
  | "cacheWrite1hTokens"
  | "cacheReadTokens"
  | "webSearches"
>;

/** Costo di una chiamata in USD, arrotondato a 6 decimali. */
export function partnerAssistantCostUsd(usage: PartnerAssistantUsage): number {
  const price = PARTNER_ASSISTANT_PRICE_PER_MILLION_USD;
  // In milionesimi di dollaro: arrotondati all'intero e divisi per un milione, danno al più 6
  // decimali senza i resti della virgola mobile.
  const micro =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheWrite5mTokens * price.cacheWrite5m +
    usage.cacheWrite1hTokens * price.cacheWrite1h +
    usage.cacheReadTokens * price.cacheRead +
    usage.webSearches * PARTNER_ASSISTANT_WEB_SEARCH_USD * 1_000_000;
  return Math.round(micro) / 1_000_000;
}

/** Il consumo dal campo `usage` di una risposta. Con lo streaming, `message_delta` aggiorna il
 * totale delle scritture in cache ma non la ripartizione per durata, ferma a `message_start`: quel
 * che il totale ha in più l'API lo scrive sui risultati degli strumenti, sempre a 5 minuti. Senza
 * ripartizione le scritture vanno tutte a un'ora: è la cache del system prompt, e la stima resta
 * per eccesso. */
export function usageFromMessage(message: Pick<Anthropic.Message, "usage">): PartnerAssistantUsage {
  const usage = message.usage;
  const cacheCreation = usage.cache_creation;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheWrite5mTokens: cacheCreation
      ? Math.max(
          cacheCreation.ephemeral_5m_input_tokens,
          cacheWriteTokens - cacheCreation.ephemeral_1h_input_tokens,
        )
      : 0,
    cacheWrite1hTokens: cacheCreation ? cacheCreation.ephemeral_1h_input_tokens : cacheWriteTokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    webSearches: usage.server_tool_use?.web_search_requests ?? 0,
  };
}
