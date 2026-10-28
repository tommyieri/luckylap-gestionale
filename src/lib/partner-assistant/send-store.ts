import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  abortable,
  createWorkerRpcFetch,
  safeWorkerReason as safeReason,
  workerRecord as record,
  workerUuid as uuid,
} from "../shopify/worker-io";
import { day, languages, oneOf } from "./choice-fields";
import type { PartnerAssistantConfig } from "./config";
import { partnerAssistantMailAddress } from "./mail-config";
import type {
  PartnerAssistantEnvironmentInput,
  PartnerAssistantFinishInput,
  PartnerAssistantPendingAppend,
  PartnerAssistantPrepareInput,
  PartnerAssistantPrepared,
  PartnerAssistantReleaseInput,
  PartnerAssistantSendCandidate,
  PartnerAssistantSendClaim,
  PartnerAssistantSendIdleReason,
  PartnerAssistantSendMode,
  PartnerAssistantSendSkipReason,
  PartnerAssistantStart,
} from "./send-types";
import { PARTNER_ASSISTANT_RPC_MAX_BYTES, PARTNER_ASSISTANT_RPC_TIMEOUT_MS } from "./store";
import type { StoreResult } from "./types";

/** Le RPC d'invio (sezione 2 di 20261028164029_assistente_partner_invio.sql): una lista separata
 * da quella del passo con Claude, così ogni client chiama solo le sue. */
export const PARTNER_ASSISTANT_SEND_RPC_NAMES = [
  "claim_partner_assistant_send",
  "skip_partner_assistant_send",
  "prepare_partner_assistant_send",
  "start_partner_assistant_send",
  "finish_partner_assistant_send",
  "record_partner_assistant_append",
  "pause_partner_assistant_send",
  "release_partner_assistant_send",
  "record_partner_assistant_environment",
] as const;
type PartnerAssistantSendRpcName = (typeof PARTNER_ASSISTANT_SEND_RPC_NAMES)[number];

/** Lo stesso trasporto di createPartnerAssistantFetch, con la lista d'invio: 10 secondi, 1 MiB in
 * uscita e in entrata, la chiave mai inoltrata in un redirect. */
export function createPartnerAssistantSendFetch(
  config: Pick<PartnerAssistantConfig, "supabaseUrl">,
  fetcher: typeof fetch = fetch,
): typeof fetch {
  return createWorkerRpcFetch(
    {
      supabaseUrl: config.supabaseUrl,
      rpcNames: PARTNER_ASSISTANT_SEND_RPC_NAMES,
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
const instant = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(
    value,
  ) &&
  day(value.slice(0, 10)) &&
  Number.isFinite(Date.parse(value));
const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
/** Il Message-ID del codice, come lo controlla prepare_partner_assistant_send. */
const messageIdOf = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 200 &&
  /^<[0-9a-f-]{36}@[a-z0-9-]+(\.[a-z0-9-]+)+>$/.test(value);
/** Un indirizzo già minuscolo che passa la regex stretta. */
const strictAddress = (value: unknown): value is string =>
  typeof value === "string" && partnerAssistantMailAddress(value) === value;
const dayOrEmpty = (value: unknown): value is string => value === "" || day(value);

const modes = oneOf<PartnerAssistantSendMode>(["prova", "invio"]);
const idleReasons = oneOf<PartnerAssistantSendIdleReason>([
  "spento",
  "prepara",
  "non_configurato",
  "occupato",
  "fermo",
  "fermo_oggi",
  "attesa",
  "intervallo",
  "limite",
  "fuori_finestra",
  "vuota",
]);
const contactKinds = oneOf(["club", "brand", "media", "evento", "negozio"] as const);
const requests = oneOf([
  "merch_cobranding",
  "collab_capsule",
  "stand_evento",
  "vendita_negozio",
] as const);
const registers = oneOf(["voi", "lei", "you", "sie", "vous", "usted"] as const);
const prepareRefusals = oneOf([
  "modalita_cambiata",
  "fermo",
  "bozza_cambiata",
  "impronta",
  "non_idoneo",
  "recapito_cambiato",
  "regole_superate",
  "ricerca_scaduta",
  "bozza_scaduta",
  "conversazione_esistente",
  "casella",
  "limite",
  "finestra_chiusa",
  "destinatario_prova",
  "doppione",
] as const);
const startStops = oneOf([
  "bozza_cambiata",
  "modalita_cambiata",
  "fermo",
  "non_idoneo",
  "recapito_cambiato",
  "finestra_chiusa",
] as const);
const skipReasons = oneOf<PartnerAssistantSendSkipReason>([
  "conversazione_esistente",
  "bozza_scaduta",
  "casella_incerta",
]);
const finishOutcomes = oneOf<PartnerAssistantFinishInput["outcome"]>([
  "inviato",
  "incerto",
  "respinto",
  "scartato",
]);
const discardReasons = oneOf([
  "smtp_temporaneo",
  "smtp_non_partito",
  "smtp_credenziali",
  "smtp_bloccato",
] as const);
const mailboxChecks = oneOf(["vuota", "trovata", "incerta"] as const);

/** Al più tre copie arretrate (claim_partner_assistant_send, `limit 3`). */
function appendsFrom(value: unknown): PartnerAssistantPendingAppend[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const appends: PartnerAssistantPendingAppend[] = [];
  for (const item of value) {
    const row = exact(item, ["message_row_id", "message_id", "raw", "sent_at"]);
    if (
      !row ||
      !uuid(row.message_row_id) ||
      !messageIdOf(row.message_id) ||
      !filled(row.raw) ||
      !instant(row.sent_at)
    )
      return null;
    appends.push({
      messageRowId: row.message_row_id,
      messageId: row.message_id,
      raw: row.raw,
      sentAt: row.sent_at,
    });
  }
  return appends;
}

function candidateFrom(
  value: unknown,
  mode: PartnerAssistantSendMode,
): PartnerAssistantSendCandidate | null {
  const row = exact(value, [
    "job_id",
    "partner_id",
    "co",
    "name",
    "mode",
    "draft",
    "choice",
    "register",
    "address",
    "test_run_id",
    "test_index",
  ]);
  const draft = exact(row?.draft, [
    "draft_id",
    "language",
    "subject",
    "body",
    "signature",
    "sha256",
    "rules_version",
    "created_at",
  ]);
  const choice = exact(row?.choice, ["contact_kind", "request", "event_starts_on"]);
  if (
    !row ||
    !draft ||
    !choice ||
    !uuid(row.job_id) ||
    !uuid(row.partner_id) ||
    !integer(row.co, 1, 99999) ||
    !filled(row.name) ||
    row.mode !== mode ||
    !registers(row.register) ||
    !(row.address === null || strictAddress(row.address)) ||
    !uuid(draft.draft_id) ||
    !languages(draft.language) ||
    !filled(draft.subject) ||
    !filled(draft.body) ||
    !filled(draft.signature) ||
    !sha256(draft.sha256) ||
    !integer(draft.rules_version, 1, 2147483647) ||
    !instant(draft.created_at) ||
    !contactKinds(choice.contact_kind) ||
    !requests(choice.request) ||
    !dayOrEmpty(choice.event_starts_on)
  )
    return null;
  // In prova la coppia (run, indirizzo) c'è sempre; in invio mai.
  const test =
    mode === "prova"
      ? uuid(row.test_run_id) && integer(row.test_index, 0, 4)
      : row.test_run_id === null && row.test_index === null;
  if (!test) return null;
  return {
    jobId: row.job_id,
    partnerId: row.partner_id,
    co: row.co,
    name: row.name,
    mode,
    draft: {
      draftId: draft.draft_id,
      language: draft.language,
      subject: draft.subject,
      body: draft.body,
      signature: draft.signature,
      sha256: draft.sha256,
      rulesVersion: draft.rules_version,
      createdAt: draft.created_at,
    },
    choice: {
      contactKind: choice.contact_kind,
      request: choice.request,
      eventStartsOn: choice.event_starts_on,
    },
    register: row.register,
    address: row.address,
    testRunId: mode === "prova" ? (row.test_run_id as string) : null,
    testIndex: mode === "prova" ? (row.test_index as number) : null,
  };
}

function claimFrom(value: unknown): PartnerAssistantSendClaim | null {
  const row = record(value);
  if (row?.status === "idle") {
    const idle = exact(row, ["status", "reason"]);
    return idle && idleReasons(idle.reason) ? { status: "idle", reason: idle.reason } : null;
  }
  const claimed =
    row?.status === "claimed"
      ? exact(row, ["status", "lease_token", "mode", "appends", "candidate"])
      : null;
  if (!claimed || !uuid(claimed.lease_token) || !modes(claimed.mode)) return null;
  const mode = claimed.mode;
  const appends = appendsFrom(claimed.appends);
  const candidate = claimed.candidate === null ? null : candidateFrom(claimed.candidate, mode);
  // Senza candidato né copie il claim risponde idle, mai claimed.
  if (
    !appends ||
    (claimed.candidate !== null && !candidate) ||
    (candidate === null && appends.length === 0)
  )
    return null;
  return { status: "claimed", leaseToken: claimed.lease_token, mode, appends, candidate };
}

type LeaseLost = { status: "lease_persa" };
const leaseLost = (value: unknown): LeaseLost | null =>
  record(value)?.status === "lease_persa" && exact(value, ["status"])
    ? { status: "lease_persa" }
    : null;
const doneOnly = (value: unknown): { status: "done" } | null =>
  record(value)?.status === "done" && exact(value, ["status"]) ? { status: "done" } : null;
const doneOrLost = (value: unknown) => doneOnly(value) ?? leaseLost(value);

function preparedFrom(value: unknown): PartnerAssistantPrepared | LeaseLost | null {
  const status = record(value)?.status;
  if (status === "pronto") {
    const row = exact(value, ["status", "message_row_id"]);
    return row && uuid(row.message_row_id)
      ? { status: "pronto", messageRowId: row.message_row_id }
      : null;
  }
  if (status === "rifiutato") {
    const row = exact(value, ["status", "reason"]);
    return row && prepareRefusals(row.reason) ? { status: "rifiutato", reason: row.reason } : null;
  }
  return leaseLost(value);
}

function startFrom(value: unknown): PartnerAssistantStart | LeaseLost | null {
  const status = record(value)?.status;
  if (status === "in_invio") return exact(value, ["status"]) ? { status: "in_invio" } : null;
  if (status === "stop") {
    const row = exact(value, ["status", "reason"]);
    return row && startStops(row.reason) ? { status: "stop", reason: row.reason } : null;
  }
  return leaseLost(value);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type PartnerAssistantSendStore = {
  claim(
    workerId: string,
    leaseSeconds: number,
    testRecipients: number,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantSendClaim>>;
  skip(
    lease: string,
    jobId: string | null,
    reason: PartnerAssistantSendSkipReason,
    signal: AbortSignal,
  ): Promise<StoreResult<{ status: "done" } | LeaseLost>>;
  prepare(
    lease: string,
    operationId: string,
    input: PartnerAssistantPrepareInput,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantPrepared | LeaseLost>>;
  start(
    lease: string,
    messageRowId: string,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerAssistantStart | LeaseLost>>;
  finish(
    lease: string,
    operationId: string,
    input: PartnerAssistantFinishInput,
    signal: AbortSignal,
  ): Promise<StoreResult<{ status: "done"; sendStatus: string; replayed: boolean } | LeaseLost>>;
  recordAppend(
    lease: string,
    messageRowId: string,
    found: boolean,
    signal: AbortSignal,
  ): Promise<StoreResult<{ status: "done" } | LeaseLost>>;
  pause(lease: string, signal: AbortSignal): Promise<StoreResult<{ status: "done" } | LeaseLost>>;
  release(
    lease: string,
    input: PartnerAssistantReleaseInput,
    signal: AbortSignal,
  ): Promise<StoreResult<{ status: "done" } | LeaseLost>>;
  recordEnvironment(
    input: PartnerAssistantEnvironmentInput,
    signal: AbortSignal,
  ): Promise<StoreResult<{ status: "done" }>>;
};

const nullableUuid = (value: unknown): value is string | null => value === null || uuid(value);
const nullableCode = (value: unknown): value is string | null =>
  value === null || safeReason(value);

function validPrepare(input: PartnerAssistantPrepareInput): boolean {
  const test =
    input.mode === "prova"
      ? uuid(input.testRunId) && integer(input.testIndex, 0, 4)
      : input.testRunId === null && input.testIndex === null;
  return (
    uuid(input.jobId) &&
    uuid(input.draftId) &&
    modes(input.mode) &&
    test &&
    messageIdOf(input.messageId) &&
    strictAddress(input.toAddress) &&
    filled(input.subject) &&
    filled(input.text) &&
    filled(input.optOut) &&
    filled(input.raw) &&
    mailboxChecks(input.mailboxCheck)
  );
}

function validFinish(input: PartnerAssistantFinishInput): boolean {
  return (
    uuid(input.messageRowId) &&
    finishOutcomes(input.outcome) &&
    (input.smtpCode === null || integer(input.smtpCode, 200, 599)) &&
    (input.enhancedCode === null ||
      (typeof input.enhancedCode === "string" &&
        /^[245]\.[0-9]{1,3}\.[0-9]{1,3}$/.test(input.enhancedCode))) &&
    typeof input.spam === "boolean" &&
    (input.outcome === "scartato" ? discardReasons(input.reason) : nullableCode(input.reason))
  );
}

/** Client di servizio separato, con la chiave propria dell'assistente, come lo store del passo con
 * Claude. Ogni RPC restituisce { ok: false } senza dettagli se la risposta non è certa. Gli
 * argomenti si controllano prima: un valore che il database rifiuterebbe non parte. */
export function createPartnerAssistantSendStore(
  config: PartnerAssistantConfig,
): PartnerAssistantSendStore {
  const client = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createPartnerAssistantSendFetch(config) },
  });
  async function rpc<T>(
    name: PartnerAssistantSendRpcName,
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
  const refused = <T>(): Promise<StoreResult<T>> => Promise.resolve({ ok: false });
  return {
    claim(workerId, leaseSeconds, testRecipients, signal) {
      if (!uuid(workerId) || !integer(leaseSeconds, 60, 600) || !integer(testRecipients, 0, 5))
        return refused();
      return rpc(
        "claim_partner_assistant_send",
        {
          p_worker_id: workerId,
          p_lease_seconds: leaseSeconds,
          p_test_recipients: testRecipients,
        },
        claimFrom,
        signal,
      );
    },
    skip(lease, jobId, reason, signal) {
      if (
        !uuid(lease) ||
        !nullableUuid(jobId) ||
        !skipReasons(reason) ||
        (jobId === null && reason !== "casella_incerta")
      )
        return refused();
      return rpc(
        "skip_partner_assistant_send",
        { p_lease_token: lease, p_job_id: jobId, p_reason: reason },
        doneOrLost,
        signal,
      );
    },
    prepare(lease, operationId, input, signal) {
      if (!uuid(lease) || !uuid(operationId) || !validPrepare(input)) return refused();
      return rpc(
        "prepare_partner_assistant_send",
        {
          p_lease_token: lease,
          p_operation_id: operationId,
          p_payload: {
            schema_version: 1,
            job_id: input.jobId,
            draft_id: input.draftId,
            mode: input.mode,
            test_run_id: input.testRunId,
            test_index: input.testIndex,
            message_id: input.messageId,
            to_address: input.toAddress,
            subject: input.subject,
            text: input.text,
            opt_out: input.optOut,
            raw: input.raw,
            mailbox_check: input.mailboxCheck,
          },
        },
        preparedFrom,
        signal,
      );
    },
    start(lease, messageRowId, signal) {
      if (!uuid(lease) || !uuid(messageRowId)) return refused();
      return rpc(
        "start_partner_assistant_send",
        { p_lease_token: lease, p_message_row_id: messageRowId },
        startFrom,
        signal,
      );
    },
    finish(lease, operationId, input, signal) {
      if (!uuid(lease) || !uuid(operationId) || !validFinish(input)) return refused();
      return rpc(
        "finish_partner_assistant_send",
        {
          p_lease_token: lease,
          p_operation_id: operationId,
          p_payload: {
            schema_version: 1,
            message_row_id: input.messageRowId,
            outcome: input.outcome,
            smtp_code: input.smtpCode,
            enhanced_code: input.enhancedCode,
            spam: input.spam,
            reason: input.reason,
          },
        },
        (value) => {
          const lost = leaseLost(value);
          if (lost) return lost;
          const row = exact(value, ["status", "send_status", "replayed"]);
          // Anche una ripetizione porta l'esito di questo payload: un altro è una risposta sbagliata.
          return row &&
            row.status === "done" &&
            row.send_status === input.outcome &&
            typeof row.replayed === "boolean"
            ? { status: "done" as const, sendStatus: input.outcome, replayed: row.replayed }
            : null;
        },
        signal,
      );
    },
    recordAppend(lease, messageRowId, found, signal) {
      if (!uuid(lease) || !uuid(messageRowId) || typeof found !== "boolean") return refused();
      return rpc(
        "record_partner_assistant_append",
        {
          p_lease_token: lease,
          p_message_row_id: messageRowId,
          p_payload: { schema_version: 1, found },
        },
        doneOrLost,
        signal,
      );
    },
    pause(lease, signal) {
      if (!uuid(lease)) return refused();
      return rpc(
        "pause_partner_assistant_send",
        { p_lease_token: lease, p_reason: "casella" },
        (value) => {
          const row = exact(value, ["status", "stop_reason"]);
          return row && row.status === "done" && row.stop_reason === "casella"
            ? { status: "done" as const }
            : leaseLost(value);
        },
        signal,
      );
    },
    release(lease, input, signal) {
      if (
        !uuid(lease) ||
        !safeReason(input.outcome) ||
        !nullableCode(input.smtpLogin) ||
        !nullableCode(input.imapLogin)
      )
        return refused();
      return rpc(
        "release_partner_assistant_send",
        {
          p_lease_token: lease,
          p_payload: {
            schema_version: 1,
            outcome: input.outcome,
            smtp_login: input.smtpLogin,
            imap_login: input.imapLogin,
          },
        },
        doneOrLost,
        signal,
      );
    },
    recordEnvironment(input, signal) {
      if (
        typeof input.mailboxOk !== "boolean" ||
        typeof input.testOk !== "boolean" ||
        !integer(input.testCount, 0, 5) ||
        input.testOk !== input.testCount >= 1
      )
        return refused();
      return rpc(
        "record_partner_assistant_environment",
        {
          p_payload: {
            schema_version: 1,
            mailbox_ok: input.mailboxOk,
            test_ok: input.testOk,
            test_count: input.testCount,
          },
        },
        doneOnly,
        signal,
      );
    },
  };
}
