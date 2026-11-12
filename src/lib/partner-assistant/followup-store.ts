import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  abortable,
  createWorkerRpcFetch,
  safeWorkerReason,
  workerRecord,
  workerUuid,
} from "../shopify/worker-io";
import type { PartnerAssistantConfig } from "./config";
import { partnerAssistantDraftSha256 } from "./checks";
import { partnerAssistantMailAddress } from "./mail-config";
import type { PartnerAssistantFinishInput } from "./send-types";
import type { PartnerAssistantLanguage, PartnerAssistantRegister, StoreResult } from "./types";

export type PartnerFollowupCandidate = {
  id: string;
  version: number;
  partner_id: string;
  co: number;
  name: string;
  porsche_community: boolean;
  flow_template: boolean;
  contact_id: string;
  address: string;
  addresses: string[];
  message_ids: string[];
  first_subject: string;
  first_sent_at: string;
  language: PartnerAssistantLanguage;
  register: PartnerAssistantRegister;
  timezone: string;
  country: string;
  followups_sent: number;
  next_due_on: string;
  send_allowed: boolean;
  /** Termine assoluto del trasporto; obbligatorio quando il piano autorizza l'invio. */
  send_not_after?: string;
  draft: null | {
    draft_id: string;
    number: number;
    language: PartnerAssistantLanguage;
    subject: string;
    body: string;
    signature: string;
    sha256: string;
    rules_version: number;
    created_at: string;
  };
};

export type PartnerFollowupClaim =
  | { status: "idle"; reason: string }
  | {
      status: "claimed";
      lease_token: string;
      mode: "osserva" | "invio";
      candidate: PartnerFollowupCandidate;
    };
export type PartnerFollowupCheckInput = {
  result: "clear" | "found" | "uncertain" | "deferred";
  resume_on?: string;
  reason: string | null;
  checked_at: string;
  proof_sha256: string;
  folder_count: number;
  message_count: number;
};
export type PartnerFollowupCheck =
  | { status: "clear"; proof_id: string; expires_at: string }
  | { status: "deferred"; resume_on: string }
  | { status: "blocked" | "retry"; reason: string }
  | { status: "lease_persa" };
export type PartnerFollowupReplyInput = {
  message_id: string;
  references: string[];
  from_address: string;
  received_at: string;
  subject: string;
};
type PartnerFollowupReply = { status: "registered" | "already_recorded" | "stale" };
type Lost = { status: "lease_persa" };
type Stopped = { status: "stop"; reason: string };
export type PartnerFollowupPrepared =
  { status: "pronto"; message_row_id: string; replayed: boolean } | Stopped | Lost;
export type PartnerFollowupStart = { status: "in_invio" } | Stopped | Lost;
export type PartnerFollowupPreparedInput = {
  expected_version: number;
  draft_id: string;
  number: number;
  to_address: string;
  subject: string;
  text: string;
  opt_out: string;
  raw: string;
  message_id: string;
  proof_id: string;
};
export type PartnerFollowupStore = {
  claim(
    workerId: string,
    seconds: number,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerFollowupClaim>>;
  claimReplyReview(
    workerId: string,
    seconds: number,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerFollowupClaim>>;
  recordReply(
    lease: string,
    candidate: Pick<PartnerFollowupCandidate, "id" | "version">,
    input: PartnerFollowupReplyInput,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerFollowupReply>>;
  recordCheck(
    lease: string,
    candidate: Pick<PartnerFollowupCandidate, "id" | "version">,
    input: PartnerFollowupCheckInput,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerFollowupCheck>>;
  prepare(
    lease: string,
    operationId: string,
    conversationId: string,
    input: PartnerFollowupPreparedInput,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerFollowupPrepared>>;
  start(
    lease: string,
    messageRowId: string,
    proofId: string,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerFollowupStart>>;
  finish(
    lease: string,
    operationId: string,
    input: PartnerAssistantFinishInput,
    signal: AbortSignal,
  ): Promise<StoreResult<{ status: "done"; send_status: string; replayed: boolean } | Lost>>;
};

const languages = new Set(["it", "en", "de", "fr", "es"]);
const registers = new Set(["voi", "lei", "you", "sie", "vous", "usted"]);
const integer = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const string = (v: unknown, max = 8000): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const date = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\d$/.test(v)) return false;
  const parsed = new Date(v + "T12:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
};
const instant = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
    v,
  ) &&
  date(v.slice(0, 10)) &&
  Number.isFinite(Date.parse(v));
const address = (v: unknown): v is string =>
  typeof v === "string" && partnerAssistantMailAddress(v) === v;
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const messageId = (v: unknown): v is string =>
  typeof v === "string" &&
  /^<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+>$/.test(v) &&
  v.length <= 200;
const replyMessageId = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 254 && /^[!-~]+$/u.test(v) && /^<[^<>@]+@[^<>@]+>$/u.test(v);
const code = (v: unknown): v is string => typeof v === "string" && safeWorkerReason(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).sort().join("|") === keys.sort().join("|");

/** Valori inattesi dalla RPC chiudono il passaggio: non diventano mai un permesso all'invio. */
export function readPartnerFollowupCandidate(value: unknown): PartnerFollowupCandidate | null {
  const c = workerRecord(value);
  if (
    !c ||
    !exact(c, [
      "id",
      "version",
      "partner_id",
      "co",
      "name",
      "porsche_community",
      "flow_template",
      "contact_id",
      "address",
      "addresses",
      "message_ids",
      "first_subject",
      "first_sent_at",
      "language",
      "register",
      "timezone",
      "country",
      "followups_sent",
      "next_due_on",
      "send_allowed",
      "draft",
      ...(Object.hasOwn(c, "send_not_after") ? ["send_not_after"] : []),
    ])
  )
    return null;
  if (
    !workerUuid(c.id) ||
    !workerUuid(c.partner_id) ||
    !workerUuid(c.contact_id) ||
    !integer(c.version, 1) ||
    !integer(c.co, 1) ||
    !string(c.name, 300) ||
    typeof c.porsche_community !== "boolean" ||
    typeof c.flow_template !== "boolean" ||
    typeof c.send_allowed !== "boolean" ||
    !address(c.address) ||
    !string(c.first_subject, 300) ||
    /[\r\n\t]/u.test(c.first_subject) ||
    !instant(c.first_sent_at) ||
    !languages.has(String(c.language)) ||
    !registers.has(String(c.register)) ||
    !string(c.timezone, 80) ||
    !string(c.country, 200) ||
    !integer(c.followups_sent, 0, 4) ||
    !date(c.next_due_on) ||
    (Object.hasOwn(c, "send_not_after") && !instant(c.send_not_after)) ||
    (c.send_allowed && !Object.hasOwn(c, "send_not_after"))
  )
    return null;
  try {
    new Intl.DateTimeFormat("it", { timeZone: c.timezone });
  } catch {
    return null;
  }
  const allowedRegisters: Record<string, string[]> = {
    it: ["voi", "lei"],
    en: ["you"],
    de: ["sie"],
    fr: ["vous"],
    es: ["usted"],
  };
  if (!allowedRegisters[String(c.language)].includes(String(c.register))) return null;
  if (
    !Array.isArray(c.addresses) ||
    c.addresses.length < 1 ||
    c.addresses.length > 32 ||
    !c.addresses.every(address) ||
    !c.addresses.includes(c.address) ||
    new Set(c.addresses).size !== c.addresses.length ||
    !Array.isArray(c.message_ids) ||
    c.message_ids.length < 1 ||
    c.message_ids.length > 5 ||
    !c.message_ids.every(messageId) ||
    new Set(c.message_ids).size !== c.message_ids.length
  )
    return null;
  if (c.draft !== null) {
    const d = workerRecord(c.draft);
    if (
      !d ||
      !exact(d, [
        "draft_id",
        "number",
        "language",
        "subject",
        "body",
        "signature",
        "sha256",
        "rules_version",
        "created_at",
      ]) ||
      !workerUuid(d.draft_id) ||
      !integer(d.number, 1, 4) ||
      d.number !== c.followups_sent + 1 ||
      d.language !== c.language ||
      !string(d.subject, 300) ||
      /[\r\n\t]/u.test(d.subject) ||
      !string(d.body, 8000) ||
      !string(d.signature, 2000) ||
      !sha(d.sha256) ||
      !integer(d.rules_version, 1) ||
      !instant(d.created_at)
    )
      return null;
    if (
      partnerAssistantDraftSha256({ subject: d.subject, body: d.body, signature: d.signature }) !==
      d.sha256
    )
      return null;
  }
  return c as PartnerFollowupCandidate;
}

function readClaim(value: unknown): PartnerFollowupClaim | null {
  const r = workerRecord(value);
  if (!r) return null;
  if (r.status === "idle" && exact(r, ["status", "reason"]) && code(r.reason))
    return r as PartnerFollowupClaim;
  if (
    r.status !== "claimed" ||
    !exact(r, ["status", "lease_token", "mode", "candidate"]) ||
    !workerUuid(r.lease_token) ||
    (r.mode !== "osserva" && r.mode !== "invio")
  )
    return null;
  const candidate = readPartnerFollowupCandidate(r.candidate);
  return candidate
    ? { status: "claimed", lease_token: r.lease_token, mode: r.mode, candidate }
    : null;
}
function readReviewClaim(value: unknown): PartnerFollowupClaim | null {
  const claim = readClaim(value);
  if (claim?.status !== "claimed") return claim;
  const c = claim.candidate;
  return claim.mode === "osserva" && !c.send_allowed && c.draft === null && !c.send_not_after
    ? claim
    : null;
}
function readReply(value: unknown): PartnerFollowupReply | null {
  const r = workerRecord(value);
  if (!r || !exact(r, ["status"])) return null;
  const { status } = r;
  return status === "registered" || status === "already_recorded" || status === "stale"
    ? { status }
    : null;
}
const lostOrStopped = (r: Record<string, unknown>): Lost | Stopped | null =>
  r.status === "lease_persa" && exact(r, ["status"])
    ? { status: "lease_persa" }
    : r.status === "stop" && exact(r, ["status", "reason"]) && code(r.reason)
      ? { status: "stop", reason: r.reason }
      : null;
function readCheck(value: unknown): PartnerFollowupCheck | null {
  const r = workerRecord(value);
  if (!r) return null;
  if (
    r.status === "clear" &&
    exact(r, ["status", "proof_id", "expires_at"]) &&
    workerUuid(r.proof_id) &&
    instant(r.expires_at)
  )
    return r as PartnerFollowupCheck;
  if (r.status === "deferred" && exact(r, ["status", "resume_on"]) && date(r.resume_on))
    return r as PartnerFollowupCheck;
  if (
    (r.status === "blocked" || r.status === "retry") &&
    exact(r, ["status", "reason"]) &&
    code(r.reason)
  )
    return r as PartnerFollowupCheck;
  return r.status === "lease_persa" && exact(r, ["status"]) ? { status: "lease_persa" } : null;
}

export const PARTNER_FOLLOWUP_RPC_NAMES = [
  "claim_partner_followup",
  "claim_partner_followup_reply_review",
  "record_partner_followup_check",
  "record_partner_followup_reply",
  "prepare_partner_followup_send",
  "start_partner_followup_send",
  "finish_partner_followup_send",
] as const;
export function createPartnerFollowupFetch(
  config: Pick<PartnerAssistantConfig, "supabaseUrl">,
  fetcher: typeof fetch = fetch,
): typeof fetch {
  return createWorkerRpcFetch(
    {
      supabaseUrl: config.supabaseUrl,
      rpcNames: PARTNER_FOLLOWUP_RPC_NAMES,
      timeoutMs: 10_000,
      maxRequestBytes: 1_048_576,
      maxResponseBytes: 1_048_576,
    },
    fetcher,
  );
}
export function createPartnerFollowupStore(config: PartnerAssistantConfig): PartnerFollowupStore {
  const client = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createPartnerFollowupFetch(config) },
  });
  const refused = <T>(): Promise<StoreResult<T>> => Promise.resolve({ ok: false });
  async function rpc<T>(
    name: (typeof PARTNER_FOLLOWUP_RPC_NAMES)[number],
    args: Record<string, unknown>,
    read: (v: unknown) => T | null,
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
  return {
    claim(workerId, seconds, signal) {
      if (!workerUuid(workerId) || !integer(seconds, 60, 600)) return refused();
      return rpc(
        "claim_partner_followup",
        { p_worker_id: workerId, p_lease_seconds: seconds },
        readClaim,
        signal,
      );
    },
    claimReplyReview(workerId, seconds, signal) {
      if (!workerUuid(workerId) || !integer(seconds, 60, 600)) return refused();
      return rpc(
        "claim_partner_followup_reply_review",
        { p_worker_id: workerId, p_lease_seconds: seconds },
        readReviewClaim,
        signal,
      );
    },
    recordReply(lease, c, input, signal) {
      if (
        !workerUuid(lease) ||
        !workerUuid(c.id) ||
        !integer(c.version, 1) ||
        !replyMessageId(input.message_id) ||
        !Array.isArray(input.references) ||
        input.references.length < 1 ||
        input.references.length > 64 ||
        !input.references.every(replyMessageId) ||
        new Set(input.references).size !== input.references.length ||
        input.references.includes(input.message_id) ||
        !address(input.from_address) ||
        !instant(input.received_at) ||
        typeof input.subject !== "string" ||
        !input.subject.isWellFormed() ||
        input.subject.length > 300 ||
        /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(input.subject)
      )
        return refused();
      return rpc(
        "record_partner_followup_reply",
        {
          p_lease_token: lease,
          p_conversation_id: c.id,
          p_expected_version: c.version,
          p_reply: input,
        },
        readReply,
        signal,
      );
    },
    recordCheck(lease, c, input, signal) {
      if (
        !workerUuid(lease) ||
        !workerUuid(c.id) ||
        !integer(c.version, 1) ||
        !["clear", "found", "uncertain", "deferred"].includes(input.result) ||
        !(input.reason === null || code(input.reason)) ||
        !instant(input.checked_at) ||
        !sha(input.proof_sha256) ||
        !integer(input.folder_count, 0, 64) ||
        !integer(input.message_count, 0, 5000) ||
        ((input.result === "clear" || input.result === "deferred") && input.folder_count < 3) ||
        (input.result === "deferred" ? !date(input.resume_on) : input.resume_on !== undefined)
      )
        return refused();
      return rpc(
        "record_partner_followup_check",
        {
          p_lease_token: lease,
          p_conversation_id: c.id,
          p_expected_version: c.version,
          p_payload: input,
        },
        readCheck,
        signal,
      );
    },
    prepare(lease, operationId, conversationId, input, signal) {
      if (
        !workerUuid(lease) ||
        !workerUuid(operationId) ||
        !workerUuid(conversationId) ||
        !integer(input.expected_version, 1) ||
        !workerUuid(input.draft_id) ||
        !integer(input.number, 1, 4) ||
        !address(input.to_address) ||
        !workerUuid(input.proof_id) ||
        !messageId(input.message_id) ||
        !string(input.subject, 300) ||
        /[\r\n\t]/u.test(input.subject) ||
        !string(input.text, 20000) ||
        !string(input.opt_out, 240) ||
        !string(input.raw, 65536) ||
        /[^\x00-\x7f]/u.test(input.raw)
      )
        return refused();
      return rpc(
        "prepare_partner_followup_send",
        {
          p_lease_token: lease,
          p_operation_id: operationId,
          p_conversation_id: conversationId,
          p_payload: input,
        },
        (v) => {
          const r = workerRecord(v);
          if (!r) return null;
          if (
            r.status === "pronto" &&
            exact(r, ["status", "message_row_id", "replayed"]) &&
            workerUuid(r.message_row_id) &&
            typeof r.replayed === "boolean"
          )
            return r as PartnerFollowupPrepared;
          return lostOrStopped(r);
        },
        signal,
      );
    },
    start(lease, messageRowId, proofId, signal) {
      if (![lease, messageRowId, proofId].every(workerUuid)) return refused();
      return rpc(
        "start_partner_followup_send",
        { p_lease_token: lease, p_message_row_id: messageRowId, p_proof_id: proofId },
        (v) => {
          const r = workerRecord(v);
          if (!r) return null;
          if (r.status === "in_invio" && exact(r, ["status"])) return { status: "in_invio" };
          return lostOrStopped(r);
        },
        signal,
      );
    },
    finish(lease, operationId, input, signal) {
      if (
        !workerUuid(lease) ||
        !workerUuid(operationId) ||
        !workerUuid(input.messageRowId) ||
        !["inviato", "incerto", "respinto", "scartato"].includes(input.outcome) ||
        !(input.smtpCode === null || integer(input.smtpCode, 200, 599)) ||
        !(
          input.enhancedCode === null || /^[245]\.[0-9]{1,3}\.[0-9]{1,3}$/.test(input.enhancedCode)
        ) ||
        typeof input.spam !== "boolean" ||
        !(input.reason === null || code(input.reason))
      )
        return refused();
      return rpc(
        "finish_partner_followup_send",
        {
          p_lease_token: lease,
          p_operation_id: operationId,
          p_payload: {
            message_row_id: input.messageRowId,
            outcome: input.outcome,
            smtp_code: input.smtpCode,
            enhanced_code: input.enhancedCode,
            spam: input.spam,
            reason: input.reason,
          },
        },
        (v) => {
          const r = workerRecord(v);
          if (!r) return null;
          if (
            r.status === "done" &&
            exact(r, ["status", "send_status", "replayed"]) &&
            r.send_status === input.outcome &&
            typeof r.replayed === "boolean"
          )
            return r as { status: "done"; send_status: string; replayed: boolean };
          return r.status === "lease_persa" && exact(r, ["status"])
            ? { status: "lease_persa" }
            : null;
        },
        signal,
      );
    },
  };
}
