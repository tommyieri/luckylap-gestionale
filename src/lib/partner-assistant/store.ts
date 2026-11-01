import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  abortable,
  createWorkerRpcFetch,
  safeWorkerReason as safeReason,
  workerRecord as record,
  workerUuid as uuid,
} from "../shopify/worker-io";
import {
  PARTNER_ASSISTANT_CHOICE_KEYS,
  day,
  languages,
  oneOf,
  partnerAssistantChoiceFields,
  text,
} from "./choice-fields";
import type { PartnerAssistantConfig } from "./config";
import type {
  PartnerAssistantCallRecord,
  PartnerAssistantCheckpoint,
  PartnerAssistantChoice,
  PartnerAssistantChoiceNote,
  PartnerAssistantClaim,
  PartnerAssistantContext,
  PartnerAssistantContextResult,
  PartnerAssistantDecision,
  PartnerAssistantDone,
  PartnerAssistantDraft,
  PartnerAssistantEmail,
  PartnerAssistantFailKind,
  PartnerAssistantFailed,
  PartnerAssistantLease,
  PartnerAssistantPartner,
  PartnerAssistantPauseReason,
  PartnerAssistantPaused,
  PartnerAssistantRecorded,
  PartnerAssistantRegister,
  PartnerAssistantResearch,
  PartnerAssistantReview,
  PartnerAssistantRules,
  PartnerAssistantSavedDraft,
  PartnerAssistantStep,
  StoreResult,
} from "./types";

/** Le RPC del worker (compito 2), senza configure_partner_assistant, che il worker non usa. */
export const PARTNER_ASSISTANT_RPC_NAMES = [
  "claim_partner_assistant_step",
  "context_partner_assistant_step",
  "checkpoint_partner_assistant_step",
  "record_partner_assistant_call",
  "complete_partner_assistant_research",
  "complete_partner_assistant_choice",
  "complete_partner_assistant_draft",
  "complete_partner_assistant_review",
  "complete_partner_assistant_template",
  "fail_partner_assistant_step",
  "pause_partner_assistant",
] as const;
type PartnerAssistantRpcName = (typeof PARTNER_ASSISTANT_RPC_NAMES)[number];
// Più larghi di Shopify (64 KiB, 4 secondi): ricerche con fonti, regole e bozze.
export const PARTNER_ASSISTANT_RPC_TIMEOUT_MS = 10_000;
export const PARTNER_ASSISTANT_RPC_MAX_BYTES = 1_048_576;

/** Lo stesso trasporto di createShopifyWorkerFetch (createWorkerRpcFetch) con i limiti propri:
 * byte limitati in uscita e in entrata prima del parser di PostgREST, la chiave mai inoltrata
 * in un redirect. In più, una richiesta deve essere testo entro 1 MiB, contato in byte. */
export function createPartnerAssistantFetch(
  config: Pick<PartnerAssistantConfig, "supabaseUrl">,
  fetcher: typeof fetch = fetch,
): typeof fetch {
  return createWorkerRpcFetch(
    {
      supabaseUrl: config.supabaseUrl,
      rpcNames: PARTNER_ASSISTANT_RPC_NAMES,
      timeoutMs: PARTNER_ASSISTANT_RPC_TIMEOUT_MS,
      maxResponseBytes: PARTNER_ASSISTANT_RPC_MAX_BYTES,
      maxRequestBytes: PARTNER_ASSISTANT_RPC_MAX_BYTES,
    },
    fetcher,
  );
}

// ---------------------------------------------------------------------------
// Lettura delle righe: chiavi esatte, tipi ed elenchi chiusi. Una riga diversa è null.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const exact = (value: unknown, keys: readonly string[]): Row | null => {
  const row = record(value);
  return row && Object.keys(row).sort().join(",") === [...keys].sort().join(",") ? row : null;
};
const integer = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const filled = (value: unknown): value is string => typeof value === "string" && value !== "";
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const dayOrNull = (value: unknown): value is string | null => value === null || day(value);
const instant = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(
    value,
  ) &&
  day(value.slice(0, 10)) &&
  Number.isFinite(Date.parse(value));
// La regex di link_value per le email (partner_contacts).
const emailAddress = (value: unknown): value is string =>
  typeof value === "string" && /^[^@\s]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/.test(value);
const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

const steps = oneOf<PartnerAssistantStep>(["ricerca", "estrazione", "scrittura", "controllo"]);
const jobStatuses = oneOf(["in_coda", "attesa", "pronta", "serve_tommaso"] as const);
const idleReasons = oneOf([
  "spento",
  "non_configurato",
  "pausa",
  "attesa",
  "occupato",
  "vuota",
] as const);
const stopReasons = oneOf(["spento", "pausa", "attesa", "lease_persa", "non_idoneo"] as const);
const sections = oneOf(["vendita", "eventi", "collab", "club"] as const);
const priorities = oneOf(["alta", "media", "bassa"] as const);
const requests = oneOf([
  "merch_cobranding",
  "collab_capsule",
  "stand_evento",
  "vendita_negozio",
] as const);
const blockReasons = oneOf(["fatto_mancante", "fuso_mancante"] as const);
const failKinds = oneOf<PartnerAssistantFailKind>(["attesa", "riprova", "rilascia", "blocca"]);
const pauseReasons = oneOf<PartnerAssistantPauseReason>(["credito", "errore_claude"]);

/** Null ammesso; undefined per un valore non valido. */
const nullable = <T>(value: unknown, read: (value: unknown) => T | null): T | null | undefined =>
  value === null ? null : (read(value) ?? undefined);

function claimFrom(value: unknown): PartnerAssistantClaim | null {
  const row = record(value);
  if (row?.status === "idle") {
    const idle = exact(row, ["status", "reason"]);
    return idle && idleReasons(idle.reason) ? { status: "idle", reason: idle.reason } : null;
  }
  const claimed = row?.status === "claimed" ? exact(row, ["status", "job"]) : null;
  const job = exact(claimed?.job, [
    "job_id",
    "partner_id",
    "step",
    "lease_token",
    "lease_expires_at",
    "attempts",
    "rewrites",
  ]);
  if (
    !job ||
    !uuid(job.job_id) ||
    !uuid(job.partner_id) ||
    !steps(job.step) ||
    !uuid(job.lease_token) ||
    !instant(job.lease_expires_at) ||
    !integer(job.attempts, 0, 3) ||
    !integer(job.rewrites, 0, 1)
  )
    return null;
  return {
    status: "claimed",
    job: {
      jobId: job.job_id,
      partnerId: job.partner_id,
      step: job.step,
      leaseToken: job.lease_token,
      leaseExpiresAt: job.lease_expires_at,
      attempts: job.attempts,
      rewrites: job.rewrites,
    },
  };
}

function partnerFrom(value: unknown): PartnerAssistantPartner | null {
  const row = exact(value, [
    "co",
    "name",
    "city",
    "country",
    "type_label",
    "sections",
    "priority",
    "contact_month",
    "event_starts_on",
    "event_ends_on",
    "application_deadline",
    "version",
    "research",
  ]);
  const research = record(row?.research);
  if (
    !row ||
    !integer(row.co, 1, 99999) ||
    !filled(row.name) ||
    !text(row.city) ||
    !text(row.country) ||
    !text(row.type_label) ||
    !Array.isArray(row.sections) ||
    !row.sections.every(sections) ||
    !priorities(row.priority) ||
    !day(row.contact_month) ||
    !dayOrNull(row.event_starts_on) ||
    !dayOrNull(row.event_ends_on) ||
    !dayOrNull(row.application_deadline) ||
    !integer(row.version, 1, Number.MAX_SAFE_INTEGER) ||
    !research
  )
    return null;
  return {
    co: row.co,
    name: row.name,
    city: row.city,
    country: row.country,
    typeLabel: row.type_label,
    sections: row.sections,
    priority: row.priority,
    contactMonth: row.contact_month,
    eventStartsOn: row.event_starts_on,
    eventEndsOn: row.event_ends_on,
    applicationDeadline: row.application_deadline,
    version: row.version,
    research,
  };
}

function emailFrom(value: unknown): PartnerAssistantEmail | null {
  const row = exact(value, ["contact_id", "address", "verified"]);
  return row &&
    uuid(row.contact_id) &&
    emailAddress(row.address) &&
    typeof row.verified === "boolean"
    ? { contactId: row.contact_id, address: row.address, verified: row.verified }
    : null;
}

function rulesFrom(value: unknown): PartnerAssistantRules | null {
  const row = exact(value, ["version", "body"]);
  return row && integer(row.version, 1, 2147483647) && filled(row.body)
    ? { version: row.version, body: row.body }
    : null;
}

function researchFrom(value: unknown): PartnerAssistantResearch | null {
  const row = exact(value, ["note_id", "text", "sources", "created_at"]);
  return row && uuid(row.note_id) && text(row.text) && texts(row.sources) && instant(row.created_at)
    ? { noteId: row.note_id, text: row.text, sources: row.sources, createdAt: row.created_at }
    : null;
}

const choiceKeys = [...PARTNER_ASSISTANT_CHOICE_KEYS, "request"] as const;

function choiceFrom(row: Row): PartnerAssistantChoice | null {
  const fields = partnerAssistantChoiceFields(row);
  return fields && requests(row.request) ? { ...fields, request: row.request } : null;
}

function decisionFrom(value: unknown): PartnerAssistantDecision | null {
  const kind = record(value)?.kind;
  if (kind === "scrivi") return exact(value, ["kind"]) ? { kind } : null;
  if (kind === "attendi") {
    const row = exact(value, ["kind", "write_on"]);
    return row && day(row.write_on) ? { kind, writeOn: row.write_on } : null;
  }
  if (kind === "blocca") {
    const row = exact(value, ["kind", "reason"]);
    return row && blockReasons(row.reason) ? { kind, reason: row.reason } : null;
  }
  return null;
}

function choiceNoteFrom(value: unknown): PartnerAssistantChoiceNote | null {
  const row = exact(value, ["note_id", "content"]);
  const content = exact(row?.content, [...choiceKeys, "decision"]);
  const choice = content && choiceFrom(content);
  const decision = content && decisionFrom(content.decision);
  return row && uuid(row.note_id) && choice && decision
    ? { noteId: row.note_id, content: { ...choice, decision } }
    : null;
}

function savedDraftFrom(value: unknown): PartnerAssistantSavedDraft | null {
  const row = exact(value, [
    "draft_id",
    "language",
    "subject",
    "body",
    "signature",
    "sha256",
    "rules_version",
    "created_at",
  ]);
  if (
    !row ||
    !uuid(row.draft_id) ||
    !languages(row.language) ||
    !filled(row.subject) ||
    !filled(row.body) ||
    !filled(row.signature) ||
    !sha256(row.sha256) ||
    !integer(row.rules_version, 1, 2147483647) ||
    !instant(row.created_at)
  )
    return null;
  return {
    draftId: row.draft_id,
    language: row.language,
    subject: row.subject,
    body: row.body,
    signature: row.signature,
    sha256: row.sha256,
    rulesVersion: row.rules_version,
    createdAt: row.created_at,
  };
}

function reviewFrom(value: unknown): PartnerAssistantReview | null {
  const row = exact(value, ["approved", "problems"]);
  return row && typeof row.approved === "boolean" && texts(row.problems)
    ? { approved: row.approved, problems: row.problems }
    : null;
}

function contextFrom(value: unknown): PartnerAssistantContextResult | null {
  if (record(value)?.status === "lease_persa")
    return exact(value, ["status"]) ? { status: "lease_persa" } : null;
  const row = exact(value, [
    "status",
    "today",
    "partner",
    "email",
    "rules",
    "research",
    "choice",
    "draft",
    "last_review",
  ]);
  if (!row || row.status !== "ok" || !day(row.today)) return null;
  const context: Partial<PartnerAssistantContext> = {
    today: row.today,
    partner: partnerFrom(row.partner) ?? undefined,
    email: nullable(row.email, emailFrom),
    rules: rulesFrom(row.rules) ?? undefined,
    research: nullable(row.research, researchFrom),
    choice: nullable(row.choice, choiceNoteFrom),
    draft: nullable(row.draft, savedDraftFrom),
    lastReview: nullable(row.last_review, reviewFrom),
  };
  return Object.values(context).every((part) => part !== undefined)
    ? { status: "ok", context: context as PartnerAssistantContext }
    : null;
}

function checkpointFrom(value: unknown): PartnerAssistantCheckpoint | null {
  const row = record(value);
  if (row?.status === "ok") return exact(row, ["status"]) ? { status: "ok" } : null;
  const stop = row?.status === "stop" ? exact(row, ["status", "reason"]) : null;
  return stop && stopReasons(stop.reason) ? { status: "stop", reason: stop.reason } : null;
}

function recordedFrom(value: unknown): PartnerAssistantRecorded | null {
  const row = exact(value, ["status", "replayed"]);
  return row && row.status === "ok" && typeof row.replayed === "boolean"
    ? { status: "ok", replayed: row.replayed }
    : null;
}

/** contesto_cambiato è ammesso solo per la bozza, scritta da Claude o composta dal modello. */
function doneFrom(value: unknown, contextMayChange: boolean): PartnerAssistantDone | null {
  const status = record(value)?.status;
  if (
    status === "lease_persa" ||
    status === "non_idoneo" ||
    (contextMayChange && status === "contesto_cambiato")
  )
    return exact(value, ["status"]) ? { status } : null;
  const row = exact(value, ["status", "job_status", "step", "replayed"]);
  return row &&
    row.status === "done" &&
    jobStatuses(row.job_status) &&
    steps(row.step) &&
    typeof row.replayed === "boolean"
    ? { status: "done", jobStatus: row.job_status, step: row.step, replayed: row.replayed }
    : null;
}

function failedFrom(value: unknown): PartnerAssistantFailed | null {
  if (record(value)?.status === "lease_persa")
    return exact(value, ["status"]) ? { status: "lease_persa" } : null;
  const row = exact(value, ["status", "job_status", "attempts"]);
  return row && row.status === "done" && jobStatuses(row.job_status) && integer(row.attempts, 0, 3)
    ? { status: "done", jobStatus: row.job_status, attempts: row.attempts }
    : null;
}

// ---------------------------------------------------------------------------
// Scrittura dei payload: le chiavi SQL dei comandi del compito 2.
// ---------------------------------------------------------------------------

function choiceRow(choice: PartnerAssistantChoice): Row {
  return {
    contact_kind: choice.contactKind,
    porsche_community: choice.porscheCommunity,
    reason_it: choice.reasonIt,
    write_now: choice.writeNow,
    write_on: choice.writeOn,
    recipient_email: choice.recipientEmail,
    recipient_email_source: choice.recipientEmailSource,
    recipient_email_published_by_org: choice.recipientEmailPublishedByOrg,
    person_name: choice.personName,
    person_title: choice.personTitle,
    language: choice.language,
    register: choice.register,
    swiss: choice.swiss,
    timezone: choice.timezone,
    fact_text: choice.factText,
    fact_date: choice.factDate,
    fact_source: choice.factSource,
    event_name: choice.eventName,
    event_starts_on: choice.eventStartsOn,
    event_city: choice.eventCity,
    event_country: choice.eventCountry,
    event_reachable: choice.eventReachable,
    notes_it: choice.notesIt,
    request: choice.request,
  };
}

function decisionRow(decision: PartnerAssistantDecision): Row {
  if (decision.kind === "attendi") return { kind: decision.kind, write_on: decision.writeOn };
  if (decision.kind === "blocca") return { kind: decision.kind, reason: decision.reason };
  return { kind: decision.kind };
}

function draftRow(draft: PartnerAssistantDraft): Row {
  return {
    language: draft.language,
    subject: draft.subject,
    body: draft.body,
    signature: draft.signature,
    sha256: draft.sha256,
    rules_version: draft.rulesVersion,
    partner_version: draft.partnerVersion,
    contact_id: draft.contactId,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type PartnerAssistantStore = {
  claim(
    workerId: string,
    leaseSeconds: number,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantClaim>>;
  context(
    job: PartnerAssistantLease,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantContextResult>>;
  checkpoint(
    job: PartnerAssistantLease,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantCheckpoint>>;
  recordCall(
    call: PartnerAssistantCallRecord,
    operationId: string,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantRecorded>>;
  completeResearch(
    job: PartnerAssistantLease,
    research: { text: string; sources: string[]; model: string; rulesVersion: number },
    operationId: string,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantDone>>;
  completeChoice(
    job: PartnerAssistantLease,
    input: {
      choice: PartnerAssistantChoice;
      decision: PartnerAssistantDecision;
      model: string;
      rulesVersion: number;
    },
    operationId: string,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantDone>>;
  completeDraft(
    job: PartnerAssistantLease,
    input: { draft: PartnerAssistantDraft; checksOk: boolean; failures: string[] },
    operationId: string,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantDone>>;
  /** La bozza del testo fisso per i club, con scelta e nota di ricerca composte dal database. */
  completeTemplate(
    job: PartnerAssistantLease,
    input: {
      templateVersion: number;
      register: PartnerAssistantRegister;
      timezone: string;
      porscheCommunity: boolean;
      swiss: boolean;
      draft: PartnerAssistantDraft;
      checksOk: boolean;
      failures: string[];
    },
    operationId: string,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantDone>>;
  completeReview(
    job: PartnerAssistantLease,
    input: {
      approved: boolean;
      problems: string[];
      sha256: string;
      model: string | null;
      rulesVersion: number;
    },
    operationId: string,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantDone>>;
  fail(
    job: PartnerAssistantLease,
    kind: PartnerAssistantFailKind,
    reason: string,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantFailed>>;
  pause(
    reason: PartnerAssistantPauseReason,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantPaused>>;
};

/** Client di servizio separato, con la chiave propria dell'assistente: mai cookie del browser né
 * JWT di un utente. Ogni RPC restituisce { ok: false } senza dettagli se la risposta non è certa. */
export function createPartnerAssistantStore(config: PartnerAssistantConfig): PartnerAssistantStore {
  const client = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createPartnerAssistantFetch(config) },
  });
  async function rpc<T>(
    name: PartnerAssistantRpcName,
    args: Row,
    read: (value: unknown) => T | null,
    signal: AbortSignal,
  ): Promise<StoreResult<T>> {
    try {
      const { data, error } = await abortable(client.rpc(name, args).abortSignal(signal), signal);
      const value = error ? null : read(data);
      return value === null ? { ok: false } : { ok: true, value };
    } catch {
      return { ok: false };
    }
  }
  const leased = (job: PartnerAssistantLease) => uuid(job.jobId) && uuid(job.leaseToken);
  const leaseArgs = (job: PartnerAssistantLease) => ({
    p_job_id: job.jobId,
    p_lease_token: job.leaseToken,
  });
  const complete = (
    name: PartnerAssistantRpcName,
    job: PartnerAssistantLease,
    payload: Row,
    operationId: string,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantDone>> =>
    leased(job) && uuid(operationId)
      ? rpc(
          name,
          {
            p_operation_id: operationId,
            p_payload: {
              schema_version: 1,
              job_id: job.jobId,
              lease_token: job.leaseToken,
              ...payload,
            },
          },
          (value) =>
            doneFrom(
              value,
              name === "complete_partner_assistant_draft" ||
                name === "complete_partner_assistant_template",
            ),
          signal,
        )
      : Promise.resolve({ ok: false });
  return {
    async claim(workerId, leaseSeconds, signal) {
      if (!uuid(workerId) || !integer(leaseSeconds, 30, 900)) return { ok: false };
      return rpc(
        "claim_partner_assistant_step",
        { p_worker_id: workerId, p_lease_seconds: leaseSeconds },
        claimFrom,
        signal,
      );
    },
    async context(job, signal) {
      if (!leased(job)) return { ok: false };
      return rpc("context_partner_assistant_step", leaseArgs(job), contextFrom, signal);
    },
    async checkpoint(job, signal) {
      if (!leased(job)) return { ok: false };
      return rpc("checkpoint_partner_assistant_step", leaseArgs(job), checkpointFrom, signal);
    },
    async recordCall(call, operationId, signal) {
      if (!uuid(operationId)) return { ok: false };
      return rpc(
        "record_partner_assistant_call",
        {
          p_operation_id: operationId,
          p_payload: {
            schema_version: 1,
            partner_id: call.partnerId,
            step: call.step,
            model: call.model,
            input_tokens: call.inputTokens,
            output_tokens: call.outputTokens,
            cache_write_5m_tokens: call.cacheWrite5mTokens,
            cache_write_1h_tokens: call.cacheWrite1hTokens,
            cache_read_tokens: call.cacheReadTokens,
            web_searches: call.webSearches,
            cost_usd: call.costUsd,
            outcome: call.outcome,
          },
        },
        recordedFrom,
        signal,
      );
    },
    completeResearch(job, research, operationId, signal) {
      return complete(
        "complete_partner_assistant_research",
        job,
        {
          text: research.text,
          sources: research.sources,
          model: research.model,
          rules_version: research.rulesVersion,
        },
        operationId,
        signal,
      );
    },
    completeChoice(job, input, operationId, signal) {
      return complete(
        "complete_partner_assistant_choice",
        job,
        {
          choice: choiceRow(input.choice),
          decision: decisionRow(input.decision),
          model: input.model,
          rules_version: input.rulesVersion,
        },
        operationId,
        signal,
      );
    },
    completeDraft(job, input, operationId, signal) {
      return complete(
        "complete_partner_assistant_draft",
        job,
        { draft: draftRow(input.draft), checks_ok: input.checksOk, failures: input.failures },
        operationId,
        signal,
      );
    },
    completeTemplate(job, input, operationId, signal) {
      return complete(
        "complete_partner_assistant_template",
        job,
        {
          template_version: input.templateVersion,
          register: input.register,
          timezone: input.timezone,
          porsche_community: input.porscheCommunity,
          swiss: input.swiss,
          draft: draftRow(input.draft),
          checks_ok: input.checksOk,
          failures: input.failures,
        },
        operationId,
        signal,
      );
    },
    completeReview(job, input, operationId, signal) {
      return complete(
        "complete_partner_assistant_review",
        job,
        {
          approved: input.approved,
          problems: input.problems,
          sha256: input.sha256,
          model: input.model,
          rules_version: input.rulesVersion,
        },
        operationId,
        signal,
      );
    },
    async fail(job, kind, reason, signal) {
      // Il motivo finisce negli eventi: solo un codice, mai un testo o un indirizzo.
      if (!leased(job) || !failKinds(kind) || !safeReason(reason)) return { ok: false };
      return rpc(
        "fail_partner_assistant_step",
        { ...leaseArgs(job), p_kind: kind, p_reason: reason },
        failedFrom,
        signal,
      );
    },
    async pause(reason, signal) {
      if (!pauseReasons(reason)) return { ok: false };
      return rpc(
        "pause_partner_assistant",
        { p_reason: reason },
        (value) => {
          const row = exact(value, ["status", "paused_reason"]);
          return row && row.status === "done" && row.paused_reason === reason
            ? { status: "done" as const, pausedReason: reason }
            : null;
        },
        signal,
      );
    },
  };
}
