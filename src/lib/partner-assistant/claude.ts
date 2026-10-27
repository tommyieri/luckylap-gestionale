import "server-only";
import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { PARTNER_ASSISTANT_MODEL, usageFromMessage, type PartnerAssistantUsage } from "./cost";

/** `credito`: credito finito, pausa di tutto l'assistente. `attesa`: API non disponibile o
 * connessione caduta, si riprova più tardi senza consumare tentativi. `errore`: chiave sbagliata,
 * permessi o configurazione (modello, strumenti), uguale per tutti i contatti: pausa di tutto.
 * `fallito`: il resto, un tentativo consumato. */
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

/** Dopo `pause_turn` si riprende al massimo quattro volte. Il `max_uses` di web_search e web_fetch
 * vale per singola richiesta, quindi per ogni continuazione: il tetto di tutta la ricerca lo danno
 * le continuazioni e il timer. */
const MAX_CONTINUATIONS = 4;

/** Un 400 che dice un problema di configurazione (strumento spento, modello, parametro), non del
 * singolo contatto come «prompt is too long». */
const CONFIGURATION =
  /not enabled|not available|not supported|unsupported|does not support|invalid model|model:/i;
/** Una connessione caduta: la fetch la dà come TypeError, l'SDK la avvolge in un AnthropicError. */
const NETWORK = /terminated|ECONNRESET|socket|stream ended/i;

/** Il timeout del nostro timer non arriva qui: lo segnala l'abort del segnale, e lo gestisce il
 * worker. Gli eventi `error` a metà stream arrivano come `APIError` senza stato, con il solo
 * `type`; una connessione che cade a metà stream arriva invece come errore qualsiasi, con la causa
 * di rete. */
export function classifyClaudeError(err: unknown): PartnerAssistantErrorCode {
  if (!(err instanceof APIError)) {
    const network =
      err instanceof TypeError ||
      (err instanceof Error && (err.cause instanceof TypeError || NETWORK.test(err.message)));
    return network ? "attesa" : "fallito";
  }
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
    err.type === "permission_error" ||
    err instanceof NotFoundError ||
    (err instanceof BadRequestError && CONFIGURATION.test(err.message))
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
    /** `timeoutMs` limita tutta l'invocazione, continuazioni comprese: allo scadere l'esito è
     * `timeout`, come per l'abort di `signal`. Il `timeout` dell'SDK copre solo l'attesa delle
     * intestazioni, che con lo streaming arrivano subito: da solo non fermerebbe una ricerca
     * lunga, e il worker perderebbe la riserva per registrare l'esito. */
    async call(input: ClaudeCall, signal: AbortSignal, timeoutMs: number): Promise<ClaudeResult> {
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), timeoutMs);
      const stop = AbortSignal.any([signal, deadline.signal]);
      const contents: Anthropic.ContentBlock[] = [];
      const usages: PartnerAssistantUsage[] = [];
      try {
        for (let continuations = 0; ; continuations++) {
          if (stop.aborted) return { ok: false, code: "timeout", usages };
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
            { signal: stop, timeout: timeoutMs },
          );
          // L'SDK azzera lo snapshot quando lo stream si chiude senza message_stop, prima di
          // rifiutare finalMessage: l'ultimo visto dagli eventi resta qui.
          let last: Anthropic.Message | undefined;
          stream.on("streamEvent", (_event, snapshot) => {
            last = snapshot;
          });
          let message: Anthropic.Message;
          try {
            message = await stream.finalMessage();
          } catch (err) {
            // Una chiamata interrotta a metà ha già consumato: si registra quello che lo stream ha
            // contato fin lì. Le ricerche web l'API le conta solo a fine messaggio: valgono almeno
            // i blocchi server_tool_use di web_search già arrivati.
            const partial = stream.currentMessage ?? last;
            if (partial) {
              const usage = usageFromMessage(partial);
              const searches = partial.content.filter(
                (block) => block.type === "server_tool_use" && block.name === "web_search",
              ).length;
              usages.push({ ...usage, webSearches: Math.max(usage.webSearches, searches) });
            }
            return { ok: false, code: stop.aborted ? "timeout" : classifyClaudeError(err), usages };
          }
          usages.push(usageFromMessage(message));
          contents.push(...message.content);
          if (message.stop_reason !== "pause_turn") return { ok: true, message, contents, usages };
          if (continuations === MAX_CONTINUATIONS)
            return { ok: false, code: "troppe_continuazioni", usages };
        }
      } finally {
        clearTimeout(timer);
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

/** I caratteri di controllo che private.partner_text rifiuta, più il ritorno a capo: restano solo
 * a capo e tab. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f]/gu;

/** Il testo della ricerca e le sue fonti. I blocchi di testo contigui (spezzati dalle citazioni)
 * si uniscono così come sono; tra due serie separate da strumenti, risultati o thinking va una riga
 * vuota. Le fonti citate nel testo vengono prima dei risultati di ricerca, che possono essere
 * molti di più delle 40 da salvare. */
export function partnerAssistantResearchText(contents: Anthropic.ContentBlock[]): {
  text: string;
  sources: string[];
} {
  const runs: string[] = [];
  let previousWasText = false;
  const cited: string[] = [];
  const found: string[] = [];
  for (const block of contents) {
    if (block.type === "text") {
      if (previousWasText) runs[runs.length - 1] += block.text;
      else runs.push(block.text);
      for (const citation of block.citations ?? [])
        if (citation.type === "web_search_result_location") cited.push(citation.url);
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) found.push(result.url);
    }
    previousWasText = block.type === "text";
  }
  const sources = [...new Set([...cited, ...found])]
    .filter((url) => url.length <= SOURCE_MAX_LENGTH && SOURCE_URL.test(url))
    .slice(0, RESEARCH_MAX_SOURCES);
  const cleaned = runs.join("\n\n").replace(CONTROL_CHARACTERS, "");
  // Un surrogato isolato non entra in jsonb: il testo si ricodifica, con U+FFFD al suo posto.
  const text = cleaned.isWellFormed() ? cleaned : cleaned.toWellFormed();
  return { text: truncateUtf8(text, RESEARCH_MAX_BYTES), sources };
}
