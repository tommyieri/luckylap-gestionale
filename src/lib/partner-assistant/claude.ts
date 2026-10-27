import "server-only";
import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { PARTNER_ASSISTANT_MODEL, usageFromMessage, type PartnerAssistantUsage } from "./cost";

/** `credito`: credito finito, pausa di tutto l'assistente. `attesa`: API non disponibile, si
 * riprova più tardi senza consumare tentativi. `errore`: chiave sbagliata o permessi, pausa di
 * tutto. `fallito`: il resto, un tentativo consumato. */
export type PartnerAssistantErrorCode = "credito" | "attesa" | "errore" | "fallito";

export type ClaudeCall = {
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Messages.ToolUnion[];
  effort: "low" | "medium" | "high";
  maxTokens: number;
  /** Lo schema JSON dell'output strutturato. */
  format?: object;
};
export type ClaudeResult =
  | {
      ok: true;
      message: Anthropic.Message;
      /** I blocchi di tutte le continuazioni, in ordine. */
      contents: Anthropic.ContentBlock[];
      usages: PartnerAssistantUsage[];
    }
  | {
      ok: false;
      code: PartnerAssistantErrorCode | "timeout" | "troppe_continuazioni";
      usages: PartnerAssistantUsage[];
    };

/** Dopo `pause_turn` si riprende al massimo quattro volte: è il limite di web_fetch, che non ha
 * un `max_uses` documentato. */
const MAX_CONTINUATIONS = 4;

/** Il timeout del nostro timer non arriva qui: lo segnala l'abort del segnale, e lo gestisce il
 * worker. Gli errori a metà stream arrivano come `APIError` senza stato, con il solo `type`. */
export function classifyClaudeError(err: unknown): PartnerAssistantErrorCode {
  if (!(err instanceof APIError)) return "fallito";
  if (
    err.status === 402 ||
    err.type === "billing_error" ||
    (err.status === 400 && /credit balance/i.test(err.message))
  )
    return "credito";
  if (
    err instanceof AuthenticationError ||
    err instanceof PermissionDeniedError ||
    err.type === "authentication_error" ||
    err.type === "permission_error"
  )
    return "errore";
  if (
    err instanceof APIConnectionError ||
    err instanceof RateLimitError ||
    err instanceof InternalServerError ||
    err.type === "rate_limit_error" ||
    err.type === "overloaded_error" ||
    err.type === "api_error" ||
    err.type === "timeout_error"
  )
    return "attesa";
  return "fallito";
}

export function createPartnerAssistantClaude(apiKey: string) {
  // Nessun ritentativo dell'SDK: le attese e i tentativi li decide il worker.
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return {
    async call(input: ClaudeCall, signal: AbortSignal, timeoutMs: number): Promise<ClaudeResult> {
      const contents: Anthropic.ContentBlock[] = [];
      const usages: PartnerAssistantUsage[] = [];
      for (let continuations = 0; ; continuations++) {
        if (signal.aborted) return { ok: false, code: "timeout", usages };
        const stream = client.messages.stream(
          {
            model: PARTNER_ASSISTANT_MODEL,
            max_tokens: input.maxTokens,
            system: [
              {
                type: "text",
                text: input.system,
                cache_control: { type: "ephemeral", ttl: "1h" },
              },
            ],
            // Dopo pause_turn si rimanda il turno dell'assistente com'è, thinking compreso.
            messages: contents.length
              ? [...input.messages, { role: "assistant", content: [...contents] }]
              : input.messages,
            ...(input.tools ? { tools: input.tools } : {}),
            thinking: { type: "adaptive" },
            output_config: {
              effort: input.effort,
              ...(input.format
                ? {
                    format: {
                      type: "json_schema",
                      schema: input.format as Record<string, unknown>,
                    },
                  }
                : {}),
            },
          },
          { signal, timeout: timeoutMs },
        );
        let message: Anthropic.Message;
        try {
          message = await stream.finalMessage();
        } catch (err) {
          // Una chiamata interrotta a metà ha già consumato: si registra quello che lo stream ha
          // contato fin lì.
          const partial = stream.currentMessage;
          if (partial) usages.push(usageFromMessage(partial));
          return { ok: false, code: signal.aborted ? "timeout" : classifyClaudeError(err), usages };
        }
        usages.push(usageFromMessage(message));
        contents.push(...message.content);
        if (message.stop_reason !== "pause_turn") return { ok: true, message, contents, usages };
        if (continuations === MAX_CONTINUATIONS)
          return { ok: false, code: "troppe_continuazioni", usages };
      }
    },
  };
}

/** I limiti di complete_partner_assistant_research: testo in byte, fonti con la stessa regola. */
const RESEARCH_MAX_BYTES = 60_000;
const RESEARCH_MAX_SOURCES = 40;
const SOURCE_MAX_LENGTH = 2048;
const SOURCE_URL = /^https:\/\/[^\s/?#@]+([/?#]\S*)?$/;

/** Tronca a `maxBytes` byte UTF-8 senza spezzare un carattere, né una coppia surrogata. */
function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // Un byte di continuazione (10xxxxxx) dopo il taglio vuol dire un carattere a metà.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

/** Il testo della ricerca e le sue fonti. Le fonti citate nel testo vengono prima dei risultati
 * di ricerca, che possono essere molti di più delle 40 da salvare. */
export function partnerAssistantResearchText(contents: Anthropic.ContentBlock[]): {
  text: string;
  sources: string[];
} {
  const texts: string[] = [];
  const cited: string[] = [];
  const found: string[] = [];
  for (const block of contents) {
    if (block.type === "text") {
      texts.push(block.text);
      for (const citation of block.citations ?? [])
        if (citation.type === "web_search_result_location") cited.push(citation.url);
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) found.push(result.url);
    }
  }
  const sources = [...new Set([...cited, ...found])]
    .filter((url) => url.length <= SOURCE_MAX_LENGTH && SOURCE_URL.test(url))
    .slice(0, RESEARCH_MAX_SOURCES);
  return { text: truncateUtf8(texts.join(""), RESEARCH_MAX_BYTES), sources };
}
