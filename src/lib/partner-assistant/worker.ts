import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { romeDay } from "../partner/dates";
import { charCount, hasControlCharacters } from "../partner/model";
import { boundedPhase, workerRecord } from "../shopify/worker-io";
import {
  checkPartnerAssistantDraft,
  partnerAssistantDraftSha256,
  partnerAssistantSignature,
} from "./checks";
import {
  parsePartnerAssistantChoice,
  partnerAssistantDecision,
  partnerAssistantRequest,
} from "./choice";
import {
  createPartnerAssistantClaude,
  partnerAssistantResearchText,
  type ClaudeCall,
  type ClaudeResult,
} from "./claude";
import {
  partnerAssistantConfig,
  type PartnerAssistantConfig,
  type PartnerAssistantEnvironment,
} from "./config";
import {
  partnerAssistantEnvironmentReport,
  partnerAssistantMailConfig,
  type PartnerAssistantMailEnvironment,
} from "./mail-config";
import {
  PARTNER_ASSISTANT_MODEL,
  partnerAssistantCostUsd,
  type PartnerAssistantUsage,
} from "./cost";
import type { PartnerEmailConfig } from "./email-config";
import { parsePartnerEmailTrackChoice, resolvePartnerEmailChoice } from "./email-config-choice";
import {
  parsePartnerEmailConditionEvidence,
  partnerEmailConditionCandidates,
  partnerEmailEligiblePossibilities,
} from "./email-config-eligibility";
import type { PartnerEmailFormatId, PartnerEmailTrack } from "./email-config-prompt";
import {
  type ConfiguredPartnerEmailPrompt,
  extractCall,
  firstJson,
  partnerAssistantCutShort,
  PartnerAssistantMissingError,
  partnerAssistantRequired as required,
  researchCall,
  reviewCall,
  templateReviewCall,
  writeCall,
} from "./prompts";
import { runPartnerAssistantSendStep, type PartnerAssistantSendDependencies } from "./send";
import { createPartnerAssistantSendStore } from "./send-store";
import {
  createPartnerAssistantStore,
  PARTNER_ASSISTANT_RPC_TIMEOUT_MS,
  type PartnerAssistantStore,
} from "./store";
import {
  composePartnerAssistantTemplate,
  PARTNER_ASSISTANT_TEMPLATE_REASON,
  PARTNER_ASSISTANT_TEMPLATE_VERSION,
  partnerAssistantTemplateBlocked,
  partnerAssistantTemplateClubName,
  partnerAssistantUsesTemplate,
} from "./template";
import type {
  PartnerAssistantChoice,
  PartnerAssistantContext,
  PartnerAssistantDone,
  PartnerAssistantDraft,
  PartnerAssistantEmailSelection,
  PartnerAssistantFailKind,
  PartnerAssistantLease,
  PartnerAssistantPauseReason,
  PartnerAssistantStep,
  StoreResult,
} from "./types";

/** Il tempo di un passo, ben sotto i 300 secondi di maxDuration della route. */
export const PARTNER_ASSISTANT_STEP_BUDGET_MS = 270_000;
/** Il tempo tenuto da parte dopo Claude, per registrare i costi e l'esito. */
export const PARTNER_ASSISTANT_RESERVE_MS = 20_000;
export const PARTNER_ASSISTANT_CLAUDE_TIMEOUT_MS = 240_000;
/** Sotto questo tempo una chiamata non parte: non basterebbe a una ricerca. */
export const PARTNER_ASSISTANT_MIN_CALL_MS = 60_000;
/** Più lunga del passo: la lease non scade mentre il passo lavora. */
export const PARTNER_ASSISTANT_LEASE_SECONDS = 360;

export type PartnerAssistantClaude = {
  call(input: ClaudeCall, signal: AbortSignal, timeoutMs: number): Promise<ClaudeResult>;
};
export type PartnerAssistantDependencies = {
  store?: PartnerAssistantStore;
  claude?: PartnerAssistantClaude;
  now?: () => number;
  workerId?: () => string;
};
export type PartnerAssistantRun = {
  status: "idle" | "complete" | "uncertain" | "paused";
  step?: PartnerAssistantStep;
};

/** Copia di authorizedShopifyWorker, con il segreto proprio dell'assistente. */
export function authorizedPartnerAssistant(header: string | null, secret: string): boolean {
  if (!header || header.length > 512 || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Le risposte di Claude dentro i limiti del database. Una risposta che il database rifiuterebbe
// lascerebbe il passo senza esito certo, da rifare a pagamento senza consumare tentativi: qui è
// una risposta non valida, cioè un tentativo consumato.
// ---------------------------------------------------------------------------

/** Da 1 a `max` caratteri, contati come char_length; i caratteri di controllo che
 * private.partner_text rifiuta (hasControlCharacters, lo specchio in model.ts); niente surrogati
 * spezzati, che jsonb rifiuta. */
const storable = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.isWellFormed() &&
  !hasControlCharacters(value) &&
  charCount(value) >= 1 &&
  charCount(value) <= max;
/** Come storable, con almeno un carattere non vuoto (`~ '\S'` nella SQL). */
const filled = (value: unknown, max: number): value is string =>
  storable(value, max) && /\S/u.test(value);

/** Oggetto fino a 300 caratteri e corpo fino a 8000 (complete_partner_assistant_draft). Il corpo
 * va a capo solo con «\n», come la firma e l'impronta; un oggetto su più righe lo ferma il
 * controllo `oggetto`, così la riscrittura sa che cosa correggere. */
function draftFrom(value: unknown): { subject: string; body: string } | null {
  const row = workerRecord(value);
  const subject = row?.subject;
  const body = row?.body;
  return filled(subject, 300) && filled(body, 8000) && !body.includes("\r")
    ? { subject, body }
    : null;
}

/** Il codice che scrive solo il worker, per le regole cambiate: dal modello non vale. */
const RESERVED_PROBLEM = "regole_superate";

/** Al più 20 problemi, ciascuno da 1 a 1000 caratteri (complete_partner_assistant_review). Una
 * lettura che approva ma elenca problemi si contraddice: vale come non approvata. */
function reviewFrom(value: unknown): { approved: boolean; problems: string[] } | null {
  const row = workerRecord(value);
  const approved = row?.approved;
  const problems: unknown = row?.problems;
  if (
    typeof approved !== "boolean" ||
    !Array.isArray(problems) ||
    problems.length > 20 ||
    !problems.every((problem) => storable(problem, 1000)) ||
    problems.includes(RESERVED_PROBLEM)
  )
    return null;
  return { approved: approved && problems.length === 0, problems: problems as string[] };
}

// ---------------------------------------------------------------------------
// I quattro passi
// ---------------------------------------------------------------------------

type ClaudeAnswer = Extract<ClaudeResult, { ok: true }>;
/** La conclusione del passo, una RPC complete_*. */
type Complete = (
  operationId: string,
  signal: AbortSignal,
) => Promise<StoreResult<PartnerAssistantDone>>;
/** La chiamata a Claude del passo e come concluderlo con la risposta: null se non è valida. */
type StepPlan = { input: ClaudeCall; conclude: (answer: ClaudeAnswer) => Complete | null };

/** Le scelte storiche non hanno ancora un formato esplicito. */
function emailFormatOf(choice: PartnerAssistantChoice | undefined): PartnerEmailFormatId | null {
  switch (choice?.contactKind) {
    case "evento":
      return choice.request === "stand_evento" ? "evento_vicino" : "evento_lontano";
    case "brand":
    case "media":
    case "negozio":
      return choice.contactKind;
    default:
      return null;
  }
}

function configuredWriting(
  step: PartnerAssistantStep,
  context: PartnerAssistantContext,
  config: PartnerEmailConfig | undefined,
): ConfiguredPartnerEmailPrompt | undefined {
  if (config === undefined || (step !== "scrittura" && step !== "controllo")) return;
  const note = required(context.choice, "scelta_mancante");
  const selection = note.emailSelection;
  const format = selection?.format ?? emailFormatOf(note.content);
  if (format === null) throw new Error("Formato della bozza configurata non disponibile.");
  if (selection && selection.configVersion !== config.meta.versione)
    throw new Error("La versione della configurazione non coincide con quella della scelta.");
  const track: PartnerEmailTrack = selection?.track ?? "A";
  const draft = step === "controllo" ? required(context.draft, "bozza_mancante") : null;
  const writingDay =
    draft === null ? context.today : (draft.configDay ?? romeDay(new Date(draft.createdAt)));
  return {
    config,
    format,
    track,
    writingDay,
    eligiblePossibilityIndexes: partnerEmailEligiblePossibilities(config, format, track, {
      choice: note.content,
      today: writingDay,
      sections: context.partner.sections,
      evidence: note.possibilityEvidence,
    }),
  };
}

function requiresEmailReselection(
  context: PartnerAssistantContext,
  config: PartnerEmailConfig | undefined,
): boolean {
  const note = context.choice;
  if (!note?.emailSelection || !config) return false;
  const { format, configVersion, extractedKind } = note.emailSelection;
  const current = resolvePartnerEmailChoice(context.partner.sections, {
    ...note.content,
    contactKind: extractedKind ?? note.content.contactKind,
  });
  return configVersion !== config.meta.versione || current.format !== format;
}

function usedPossibilityIndexes(value: unknown, eligible: readonly number[]): number[] | null {
  const indexes = workerRecord(value)?.possibilita_usate;
  if (
    !Array.isArray(indexes) ||
    indexes.length > 2 ||
    new Set(indexes).size !== indexes.length ||
    !indexes.every((index) => Number.isInteger(index) && eligible.includes(index))
  )
    return null;
  return indexes;
}

/** Lancia PartnerAssistantMissingError, come i costruttori dei prompt, se manca un dato che il
 * passo usa. */
function stepPlan(
  step: PartnerAssistantStep,
  context: PartnerAssistantContext,
  lease: PartnerAssistantLease,
  store: PartnerAssistantStore,
  config: PartnerAssistantConfig,
  emailConfig?: PartnerEmailConfig,
): StepPlan {
  const model = PARTNER_ASSISTANT_MODEL;
  const rulesVersion = context.rules.version;
  switch (step) {
    case "ricerca":
      return {
        input: researchCall(context),
        conclude: (answer) => {
          const research = partnerAssistantResearchText(answer.contents);
          // Vuota dopo la pulizia: il database vuole almeno un carattere non vuoto.
          if (!/\S/u.test(research.text)) return null;
          return (operationId, signal) =>
            store.completeResearch(
              lease,
              { ...research, model, rulesVersion },
              operationId,
              signal,
            );
        },
      };
    case "estrazione": {
      const candidates =
        emailConfig === undefined ? [] : partnerEmailConditionCandidates(emailConfig);
      return {
        input: extractCall(context, candidates, emailConfig),
        conclude: (answer) => {
          const raw = firstJson(answer.message);
          const row = workerRecord(raw);
          const {
            possibility_evidence: evidence,
            track_choice: trackChoice,
            ...choiceFields
          } = row ?? {};
          const extracted = parsePartnerAssistantChoice(emailConfig ? choiceFields : raw);
          if (!extracted) return null;
          const resolved = emailConfig
            ? resolvePartnerEmailChoice(context.partner.sections, extracted)
            : null;
          let choice = resolved?.choice ?? {
            ...extracted,
            request: partnerAssistantRequest(extracted),
          };
          const decision = partnerAssistantDecision(choice, context.today);
          let emailSelection: Omit<PartnerAssistantEmailSelection, "usedPossibilities"> | undefined;
          if (emailConfig && resolved?.format && resolved.format !== "club") {
            const track = parsePartnerEmailTrackChoice(trackChoice, emailConfig, resolved.format);
            if (track) {
              emailSelection = {
                format: resolved.format,
                track: track.track,
                reason: track.reason,
                configVersion: emailConfig.meta.versione,
                ...(track.subtype === null ? {} : { subtype: track.subtype }),
                ...(resolved.discordance
                  ? { extractedKind: resolved.extractedKind, discordance: resolved.discordance }
                  : {}),
              };
            } else {
              if (decision.kind === "scrivi") return null;
              // Una scelta in attesa o bloccata può non avere un fatto per motivare il filone.
              // La discordanza resta leggibile nella motivazione della nota.
              if (resolved.discordance) {
                const reasonIt = Array.from(`${resolved.discordance} ${choice.reasonIt}`)
                  .slice(0, 2000)
                  .join("");
                choice = { ...choice, reasonIt };
              }
            }
          }
          const possibilityEvidence = parsePartnerEmailConditionEvidence(
            evidence,
            candidates,
            context.research?.text ?? "",
          );
          return (operationId, signal) =>
            store.completeChoice(
              lease,
              {
                choice,
                decision,
                model,
                rulesVersion,
                ...(possibilityEvidence.length ? { possibilityEvidence } : {}),
                ...(emailSelection ? { emailSelection } : {}),
              },
              operationId,
              signal,
            );
        },
      };
    }
    case "scrittura": {
      // La revisione riprenderà la data di questa preparazione per la maglietta co-firmata.
      const configured = configuredWriting(step, context, emailConfig);
      const input = writeCall(context, context.today, configured);
      const note = required(context.choice, "scelta_mancante");
      const choice = note.content;
      const email = required(context.email, "email_mancante");
      return {
        input,
        conclude: (answer) => {
          const raw = firstJson(answer.message);
          const written = draftFrom(raw);
          if (!written) return null;
          const used =
            configured && note.emailSelection
              ? usedPossibilityIndexes(raw, configured.eligiblePossibilityIndexes)
              : undefined;
          if (used === null) return null;
          // La firma con il numero la aggiunge il codice: il modello non la vede mai.
          const signature = partnerAssistantSignature(choice.language, config.phone);
          const draft = {
            language: choice.language,
            ...written,
            signature,
            sha256: partnerAssistantDraftSha256({ ...written, signature }),
            rulesVersion,
            partnerVersion: context.partner.version,
            contactId: email.contactId,
            ...(configured
              ? { configVersion: configured.config.meta.versione, configDay: configured.writingDay }
              : {}),
          };
          const checks = checkPartnerAssistantDraft(draft, {
            porscheCommunity: choice.porscheCommunity,
            currentRulesVersion: rulesVersion,
            phone: config.phone,
            names: [context.partner.name, choice.eventName],
          });
          return (operationId, signal) =>
            store.completeDraft(
              lease,
              {
                draft,
                checksOk: checks.ok,
                failures: checks.ok ? [] : checks.failures,
                ...(used === undefined ? {} : { usedPossibilityIndexes: used }),
              },
              operationId,
              signal,
            );
        },
      };
    }
    case "controllo": {
      // Una bozza del testo fisso per i club ha la sua seconda lettura: le regole sul fatto della
      // ricerca e sul nome della persona non valgono per un testo approvato da Tommaso.
      const input = templateDraftOf(context)
        ? templateReviewCall(context)
        : reviewCall(context, configuredWriting(step, context, emailConfig));
      const draft = required(context.draft, "bozza_mancante");
      return {
        input,
        conclude: (answer) => {
          const review = reviewFrom(firstJson(answer.message));
          if (!review) return null;
          return (operationId, signal) =>
            store.completeReview(
              lease,
              { ...review, sha256: partnerAssistantDraftSha256(draft), model, rulesVersion },
              operationId,
              signal,
            );
        },
      };
    }
  }
}

/** Le note del lavoro vengono dal testo fisso per i club (la frase della scelta). */
const templateNotes = (context: PartnerAssistantContext) =>
  PARTNER_ASSISTANT_TEMPLATE_REASON.test(context.choice?.content.reasonIt ?? "");
/** Una bozza del modello di un contatto che usa ancora il modello: la seconda lettura per i club. */
const templateDraftOf = (context: PartnerAssistantContext) =>
  partnerAssistantUsesTemplate(context) && templateNotes(context);

/** Il paese del club non ha un fuso nell'elenco: il contatto passa a Tommi. */
const FUSO_MANCANTE: Complete = () => Promise.resolve({ ok: false });

/** La bozza del testo fisso per i club e la sua conclusione, oppure FUSO_MANCANTE. Lancia
 * PartnerAssistantMissingError se il contatto ha perso l'email. */
function templateConclusion(
  context: PartnerAssistantContext,
  lease: PartnerAssistantLease,
  store: PartnerAssistantStore,
  config: PartnerAssistantConfig,
): Complete {
  const email = required(context.email, "email_mancante");
  const composed = composePartnerAssistantTemplate(context.partner, config.phone);
  if (!composed) return FUSO_MANCANTE;
  const draft: PartnerAssistantDraft = {
    language: composed.language,
    subject: composed.subject,
    body: composed.body,
    signature: composed.signature,
    sha256: partnerAssistantDraftSha256(composed),
    rulesVersion: context.rules.version,
    partnerVersion: context.partner.version,
    contactId: email.contactId,
  };
  const checks = checkPartnerAssistantDraft(draft, {
    porscheCommunity: composed.porscheCommunity,
    currentRulesVersion: context.rules.version,
    phone: config.phone,
    names: [context.partner.name, partnerAssistantTemplateClubName(context.partner.name)],
    template: true,
  });
  return (operationId, signal) =>
    store.completeTemplate(
      lease,
      {
        templateVersion: PARTNER_ASSISTANT_TEMPLATE_VERSION,
        register: composed.register,
        timezone: composed.timezone,
        porscheCommunity: composed.porscheCommunity,
        swiss: composed.swiss,
        draft,
        checksOk: checks.ok,
        failures: checks.ok ? [] : checks.failures,
      },
      operationId,
      signal,
    );
}

/** Consumo pagato: token di output già generati, oppure una continuazione (più di una richiesta).
 * Un'attesa che arriva dopo non è gratis: consuma un tentativo, così un contatto non spende
 * all'infinito. L'attesa di tutto l'assistente resta: fail_partner_assistant_step la mette anche
 * per riprova con claude_attesa. */
const paidUsage = (usages: PartnerAssistantUsage[]) =>
  usages.length > 1 || usages.some((usage) => usage.outputTokens > 0);

/** Un passo di un lavoro: claim, contesto, checkpoint, una sola chiamata a Claude, esito, costi.
 * Ogni effetto si salva con le RPC del worker; un esito senza risposta certa resta alla lease. */
export async function runPartnerAssistantStep(
  config: PartnerAssistantConfig,
  parentSignal: AbortSignal,
  dependencies: PartnerAssistantDependencies = {},
): Promise<PartnerAssistantRun> {
  const now = dependencies.now ?? (() => performance.now());
  const deadline = now() + PARTNER_ASSISTANT_STEP_BUDGET_MS;
  // Un timer proprio: in after() nessuno interrompe il segnale da fuori.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parentSignal.addEventListener("abort", onAbort, { once: true });
  if (parentSignal.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), PARTNER_ASSISTANT_STEP_BUDGET_MS);
  const remaining = () => Math.max(0, deadline - now());
  let step: PartnerAssistantStep | undefined;
  // Il passo finisce solo quando l'ultima RPC ha risposto: prima il segnale resta aperto.
  async function work(): Promise<PartnerAssistantRun> {
    const store = dependencies.store ?? createPartnerAssistantStore(config);
    const claude = dependencies.claude ?? createPartnerAssistantClaude(config.anthropicApiKey);
    const workerId = (dependencies.workerId ?? randomUUID)();
    /** Una RPC entro il tempo rimasto: senza risposta certa è { ok: false }. */
    async function database<T>(
      task: (signal: AbortSignal) => Promise<StoreResult<T>>,
    ): Promise<StoreResult<T>> {
      try {
        return await boundedPhase(
          controller.signal,
          Math.min(PARTNER_ASSISTANT_RPC_TIMEOUT_MS, remaining()),
          task,
        );
      } catch {
        return { ok: false };
      }
    }

    const claimed = await database((signal) =>
      store.claim(workerId, PARTNER_ASSISTANT_LEASE_SECONDS, signal),
    );
    if (!claimed.ok) return { status: "uncertain" };
    if (claimed.value.status === "idle") return { status: "idle" };
    const job = claimed.value.job;
    step = job.step;
    const lease: PartnerAssistantLease = { jobId: job.jobId, leaseToken: job.leaseToken };
    const settled = (
      result: StoreResult<unknown>,
      certain: PartnerAssistantRun["status"] = "complete",
    ): PartnerAssistantRun => ({ status: result.ok ? certain : "uncertain", step: job.step });
    const fail = async (kind: PartnerAssistantFailKind, reason: string) =>
      settled(await database((signal) => store.fail(lease, kind, reason, signal)));
    const pause = async (reason: PartnerAssistantPauseReason) =>
      settled(await database((signal) => store.pause(reason, signal)), "paused");
    // Una conclusione senza risposta certa non si sovrascrive con fail: la decide la lease.
    const complete = async (rpc: Complete) =>
      settled(await database((signal) => rpc(randomUUID(), signal)));
    /** Solo un dato mancante è previsto: è uno stato incoerente, cioè una risposta non valida. Ogni
     * altra eccezione è un errore nel codice: il lavoro non si tocca e lo riprende la lease, con un
     * tentativo. Nel log solo il passo e il tipo dell'errore, mai testi o messaggi. */
    const unexpected = async (error: unknown): Promise<PartnerAssistantRun> => {
      if (error instanceof PartnerAssistantMissingError)
        return fail("riprova", "risposta_non_valida");
      console.error("partner_assistant_bug", {
        step: job.step,
        error: error instanceof Error ? error.name : typeof error,
      });
      return { status: "uncertain", step: job.step };
    };

    const read = await database((signal) => store.context(lease, signal));
    if (!read.ok) return { status: "uncertain", step };
    if (read.value.status === "lease_persa") return { status: "complete", step };
    const context = read.value.context;

    // Una bozza scritta con regole superate si riscrive, senza pagare una seconda lettura. Lo stesso
    // per una bozza del modello che non è più quella che il testo in vigore comporrebbe (testo o
    // telefono cambiati): torna in scrittura e il modello la ricompone, senza Claude.
    const draft = context.draft;
    const outdatedTemplate =
      draft !== null &&
      templateDraftOf(context) &&
      (() => {
        const again = composePartnerAssistantTemplate(context.partner, config.phone);
        return again === null || partnerAssistantDraftSha256(again) !== draft.sha256;
      })();
    if (
      job.step === "controllo" &&
      draft &&
      (draft.rulesVersion !== context.rules.version || outdatedTemplate)
    )
      return complete((operationId, signal) =>
        store.completeReview(
          lease,
          {
            approved: false,
            problems: ["regole_superate"],
            sha256: partnerAssistantDraftSha256(draft),
            model: null,
            rulesVersion: context.rules.version,
          },
          operationId,
          signal,
        ),
      );

    const usesTemplate = partnerAssistantUsesTemplate(context);
    const genericWrite = job.step === "scrittura" && !usesTemplate && !templateNotes(context);
    const retryDraft = genericWrite && context.lastReview?.approved === false ? draft : null;
    const usedSelection =
      genericWrite && context.choice?.emailSelectionAlreadyUsed
        ? context.choice.emailSelection
        : undefined;
    const firstDraft = genericWrite && retryDraft === null && usedSelection === undefined;
    const pinnedVersion =
      job.step === "controllo" && !templateDraftOf(context)
        ? draft?.configVersion
        : (retryDraft?.configVersion ?? usedSelection?.configVersion);
    const readCurrentConfig =
      (job.step === "estrazione" && !usesTemplate && !templateNotes(context)) ||
      (firstDraft && emailFormatOf(context.choice?.content) !== null);
    let emailConfig: PartnerEmailConfig | undefined;
    if (pinnedVersion !== undefined || readCurrentConfig) {
      const loaded = await database((signal) => store.loadEmailConfig(pinnedVersion, signal));
      if (!loaded.ok || (loaded.value === null && job.step !== "estrazione"))
        return { status: "uncertain", step };
      emailConfig = loaded.value?.config;
    }

    // Il flag, la pausa, l'attesa, la lease e il contatto si ricontrollano subito prima di Claude.
    // Un contatto che non è più idoneo (per esempio senza email) si rilascia senza tentativi.
    const checkpoint = await database((signal) => store.checkpoint(lease, signal));
    if (!checkpoint.ok) return { status: "uncertain", step };
    if (checkpoint.value.status === "stop") return fail("rilascia", checkpoint.value.reason);

    // Modalità modello: un contatto Club prima del controllo non chiama Claude. Il codice compone la
    // bozza dal testo fisso per i club e il database la salva con la scelta e una nota di ricerca
    // sostitutiva; Claude farà solo la seconda lettura. Vale per ogni ritorno indietro (ricerca
    // scaduta, regole nuove, recapito cambiato): la bozza si ricompone senza costi.
    if (job.step !== "controllo" && usesTemplate) {
      if (partnerAssistantTemplateBlocked(context.partner))
        return fail("blocca", "rete_scuderia_ferrari");
      let template: Complete;
      try {
        template = templateConclusion(context, lease, store, config);
      } catch (error) {
        return unexpected(error);
      }
      return template === FUSO_MANCANTE ? fail("blocca", "fuso_mancante") : complete(template);
    }
    // Note del modello su un contatto che non usa più il modello (tolto dalla sezione Club o diventato
    // anche un evento): Claude non scrive sopra di loro. Il giro dopo la presa del lavoro lo riporta
    // alla ricerca.
    if ((job.step === "estrazione" || job.step === "scrittura") && templateNotes(context))
      return fail("rilascia", "contesto_cambiato");

    if (firstDraft && requiresEmailReselection(context, emailConfig))
      return complete((operationId, signal) =>
        store.reselectEmailChoice(lease, operationId, signal),
      );

    let plan: StepPlan;
    try {
      plan = stepPlan(job.step, context, lease, store, config, emailConfig);
    } catch (error) {
      // ricerca_mancante, scelta_mancante, bozza_mancante, email_mancante: uno stato incoerente.
      // Ogni altra eccezione è un errore nel codice.
      return unexpected(error);
    }
    const timeoutMs = Math.min(
      PARTNER_ASSISTANT_CLAUDE_TIMEOUT_MS,
      remaining() - PARTNER_ASSISTANT_RESERVE_MS,
    );
    if (timeoutMs < PARTNER_ASSISTANT_MIN_CALL_MS) return fail("rilascia", "tempo_insufficiente");

    // Una sola chiamata per passo; il client limita da sé tutta l'invocazione a timeoutMs.
    let result: ClaudeResult;
    try {
      result = await claude.call(plan.input, controller.signal, timeoutMs);
    } catch {
      result = { ok: false, code: "fallito", usages: [] };
    }
    // Ogni chiamata costa, anche quando il passo poi fallisce. Un costo non registrato non
    // ferma il passo. record_partner_assistant_call non dipende dalla lease: quando il passo si
    // conclude, i costi vanno dopo l'esito e non ne consumano la riserva di tempo; negli errori
    // (pausa, fail) vanno prima.
    const outcome = result.ok ? "ok" : result.code;
    const usages = result.usages;
    const recordCosts = async () => {
      await Promise.allSettled(
        usages.map((usage) =>
          database((signal) =>
            store.recordCall(
              {
                ...usage,
                partnerId: job.partnerId,
                step: job.step,
                model: PARTNER_ASSISTANT_MODEL,
                costUsd: partnerAssistantCostUsd(usage),
                outcome,
              },
              randomUUID(),
              signal,
            ),
          ),
        ),
      );
    };
    if (!result.ok) {
      await recordCosts();
      if (result.code === "credito") return pause("credito");
      if (result.code === "errore") return pause("errore_claude");
      if (result.code === "attesa")
        return paidUsage(usages)
          ? fail("riprova", "claude_attesa")
          : fail("attesa", "claude_attesa");
      return fail("riprova", result.code === "fallito" ? "risposta_non_valida" : result.code);
    }
    // Il client dà ok a ogni stop_reason tranne pause_turn. Un rifiuto o una risposta tagliata
    // (max_tokens, contesto pieno) non si salva, nemmeno come ricerca con del testo parziale: è
    // una risposta non valida, cioè un tentativo consumato.
    if (partnerAssistantCutShort(result.message)) {
      await recordCosts();
      return fail("riprova", "risposta_non_valida");
    }
    let conclusion: Complete | null;
    try {
      conclusion = plan.conclude(result);
    } catch (error) {
      await recordCosts();
      return unexpected(error);
    }
    if (!conclusion) {
      await recordCosts();
      return fail("riprova", "risposta_non_valida");
    }
    const done = await complete(conclusion);
    await recordCosts();
    return done;
  }
  try {
    return await work();
  } catch {
    return step ? { status: "uncertain", step } : { status: "uncertain" };
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(status === 503 ? { "Retry-After": "120" } : {}),
    },
  });
}

/** Il tempo della registrazione delle variabili, a ogni giro. */
const PARTNER_ASSISTANT_ENVIRONMENT_MS = 10_000;

/** Risponde subito e fa il giro dopo la risposta: le variabili della posta, poi l'invio, poi il
 * passo con Claude. Il lavoro lo sceglie solo il database: corpo, query e cookie della richiesta
 * non si leggono mai. */
export async function receivePartnerAssistantTick(
  request: Request,
  afterResponse: (callback: () => Promise<void>) => void,
  dependencies: PartnerAssistantDependencies & {
    environment?: PartnerAssistantEnvironment & PartnerAssistantMailEnvironment;
    run?: typeof runPartnerAssistantStep;
    send?: typeof runPartnerAssistantSendStep;
    sendDependencies?: PartnerAssistantSendDependencies;
  } = {},
): Promise<Response> {
  const {
    environment,
    run = runPartnerAssistantStep,
    send = runPartnerAssistantSendStep,
    sendDependencies,
    ...stepDependencies
  } = dependencies;
  const config = partnerAssistantConfig(environment);
  if (!config) return reply(503, { code: "worker_unavailable" });
  if (!authorizedPartnerAssistant(request.headers.get("authorization"), config.workerSecret))
    return reply(401, { code: "unauthorized" });
  try {
    afterResponse(async () => {
      // La risposta già mandata non deve fermare il giro: un segnale proprio, mai quello della
      // richiesta. Ogni passo ha il suo timer.
      const signal = new AbortController().signal;
      // 1. Quali variabili della posta sono valide, mai i valori: a ogni giro, anche senza posta.
      // Un errore non ferma il giro.
      let sendStore = sendDependencies?.store;
      try {
        sendStore ??= createPartnerAssistantSendStore(config);
        const store = sendStore;
        const report = partnerAssistantEnvironmentReport(environment);
        await boundedPhase(signal, PARTNER_ASSISTANT_ENVIRONMENT_MS, (phase) =>
          store.recordEnvironment(
            {
              mailboxOk: report.casella,
              testOk: report.prova,
              testCount: report.indirizziProva,
            },
            phase,
          ),
        );
      } catch {
        /* La pagina mostra la registrazione precedente. */
      }
      // 2. L'invio, solo con la posta configurata. Un giro che manda o copia non fa il passo con
      // Claude: i due insieme non stanno nei 300 secondi.
      try {
        const mail = partnerAssistantMailConfig(environment);
        if (mail) {
          const sent = await send(config, mail, signal, { ...sendDependencies, store: sendStore });
          if (sent.status !== "idle") return;
        }
      } catch {
        /* Un invio senza esito certo: la lease della casella lo riporta al giro dopo. */
        return;
      }
      // 3. Il passo con Claude.
      try {
        await run(config, signal, stepDependencies);
      } catch {
        /* La lease del lavoro riporta il passo al giro dopo. */
      }
    });
  } catch {
    return reply(503, { code: "worker_unavailable" });
  }
  return reply(202, { accepted: true });
}
