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
import { partnerAssistantMailAddress } from "./mail-config";
import { isPartnerFollowupMessageId } from "./followup-identification";
import type { StoreResult } from "./types";

export type PartnerInboxCursor = { path: "INBOX"; uid_validity: string | null; last_uid: number };
export type PartnerInboxCandidate = {
  partner_id: string;
  co: number;
  name: string;
  first_contact_at: string;
  last_contact_at: string;
  addresses: string[];
  subject_alias: string | null;
};
export type PartnerInboxClaim =
  | { status: "idle"; reason: string }
  | {
      status: "claimed";
      lease_token: string;
      activated_at: string;
      cursors: PartnerInboxCursor[];
      candidates: PartnerInboxCandidate[];
    };
export type PartnerInboxMessage = {
  message_id: string;
  from_address: string;
  received_at: string;
  subject: string;
  automatic: boolean;
  references?: string[];
  body_excerpt?: string;
};
export type PartnerInboxBatch = {
  folder: { path: "INBOX"; uid_validity: string; expected_last_uid: number; last_uid: number };
  messages: PartnerInboxMessage[];
};
export type PartnerInboxRecorded =
  | { status: "recorded"; registered: number; review: number; ignored: number }
  | { status: "lease_persa" };
export type PartnerInboxOutcome = "inbox_osservata" | "inbox_incerta";
export type PartnerInboxStore = {
  claim(
    workerId: string,
    seconds: number,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerInboxClaim>>;
  record(
    lease: string,
    batch: PartnerInboxBatch,
    signal: AbortSignal,
  ): Promise<StoreResult<PartnerInboxRecorded>>;
  release(
    lease: string,
    outcome: PartnerInboxOutcome,
    signal: AbortSignal,
  ): Promise<StoreResult<{ status: "done" } | { status: "lease_persa" }>>;
};

const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const text = (value: unknown, max: number, empty = false): value is string =>
  typeof value === "string" &&
  value.isWellFormed() &&
  (empty || value.length > 0) &&
  value.length <= max &&
  !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value);
const validity = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,19}$/u.test(value);
const instant = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(
    value,
  ) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const address = (value: unknown): value is string =>
  typeof value === "string" && partnerAssistantMailAddress(value) === value;

export function readPartnerInboxClaim(value: unknown): PartnerInboxClaim | null {
  const result = workerRecord(value);
  if (!result) return null;
  if (
    result.status === "idle" &&
    exact(result, ["status", "reason"]) &&
    safeWorkerReason(result.reason)
  )
    return result as PartnerInboxClaim;
  if (
    result.status !== "claimed" ||
    !exact(result, ["status", "lease_token", "activated_at", "cursors", "candidates"]) ||
    !workerUuid(result.lease_token) ||
    !instant(result.activated_at) ||
    !Array.isArray(result.cursors) ||
    result.cursors.length !== 1 ||
    !Array.isArray(result.candidates) ||
    result.candidates.length > 500
  )
    return null;
  const cursor = workerRecord(result.cursors[0]);
  if (
    !cursor ||
    !exact(cursor, ["path", "uid_validity", "last_uid"]) ||
    cursor.path !== "INBOX" ||
    !(cursor.uid_validity === null || validity(cursor.uid_validity)) ||
    !integer(cursor.last_uid, 0, 4_294_967_295)
  )
    return null;
  const ids = new Set<string>();
  for (const row of result.candidates) {
    const c = workerRecord(row);
    if (
      !c ||
      !exact(c, [
        "partner_id",
        "co",
        "name",
        "first_contact_at",
        "last_contact_at",
        "addresses",
        "subject_alias",
      ]) ||
      !workerUuid(c.partner_id) ||
      ids.has(c.partner_id) ||
      !integer(c.co, 1) ||
      !text(c.name, 300) ||
      !instant(c.first_contact_at) ||
      !instant(c.last_contact_at) ||
      Date.parse(c.last_contact_at) < Date.parse(c.first_contact_at) ||
      !Array.isArray(c.addresses) ||
      c.addresses.length > 32 ||
      !c.addresses.every(address) ||
      new Set(c.addresses).size !== c.addresses.length ||
      !(c.subject_alias === null || text(c.subject_alias, 300))
    )
      return null;
    ids.add(c.partner_id);
  }
  return result as PartnerInboxClaim;
}
export function validPartnerInboxBatch(batch: PartnerInboxBatch): boolean {
  const b = workerRecord(batch);
  const f = b && workerRecord(b.folder);
  if (
    !b ||
    !exact(b, ["folder", "messages"]) ||
    !f ||
    !exact(f, ["path", "uid_validity", "expected_last_uid", "last_uid"]) ||
    f.path !== "INBOX" ||
    !validity(f.uid_validity) ||
    !integer(f.expected_last_uid, 0, 4_294_967_295) ||
    !integer(f.last_uid, 0, 4_294_967_295) ||
    !Array.isArray(b.messages) ||
    b.messages.length > 50
  )
    return false;
  return b.messages.every((value) => {
    const m = workerRecord(value);
    return (
      m &&
      exact(m, [
        "message_id",
        "from_address",
        "received_at",
        "subject",
        "automatic",
        ...(Object.hasOwn(m, "references") ? ["references"] : []),
        ...(Object.hasOwn(m, "body_excerpt") ? ["body_excerpt"] : []),
      ]) &&
      isPartnerFollowupMessageId(m.message_id) &&
      address(m.from_address) &&
      instant(m.received_at) &&
      text(m.subject, 300, true) &&
      typeof m.automatic === "boolean" &&
      (!Object.hasOwn(m, "references") ||
        (Array.isArray(m.references) &&
          m.references.length <= 64 &&
          m.references.every(isPartnerFollowupMessageId) &&
          new Set(m.references).size === m.references.length &&
          !m.references.includes(m.message_id))) &&
      (!Object.hasOwn(m, "body_excerpt") || text(m.body_excerpt, 2000, true))
    );
  });
}

export const PARTNER_INBOX_RPC_NAMES = [
  "claim_partner_ionos_inbox",
  "record_partner_ionos_inbox",
  "release_partner_ionos_inbox",
] as const;
export function createPartnerInboxFetch(
  config: Pick<PartnerAssistantConfig, "supabaseUrl">,
  fetcher: typeof fetch = fetch,
): typeof fetch {
  return createWorkerRpcFetch(
    {
      supabaseUrl: config.supabaseUrl,
      rpcNames: PARTNER_INBOX_RPC_NAMES,
      timeoutMs: 10_000,
      maxRequestBytes: 1_048_576,
      maxResponseBytes: 1_048_576,
    },
    fetcher,
  );
}
export function createPartnerInboxStore(config: PartnerAssistantConfig): PartnerInboxStore {
  const client = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createPartnerInboxFetch(config) },
  });
  async function rpc<T>(
    name: (typeof PARTNER_INBOX_RPC_NAMES)[number],
    args: Record<string, unknown>,
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
  return {
    claim(workerId, seconds, signal) {
      if (!workerUuid(workerId) || !integer(seconds, 60, 300))
        return Promise.resolve({ ok: false });
      return rpc(
        "claim_partner_ionos_inbox",
        { p_worker_id: workerId, p_lease_seconds: seconds },
        readPartnerInboxClaim,
        signal,
      );
    },
    record(lease, batch, signal) {
      if (!workerUuid(lease) || !validPartnerInboxBatch(batch))
        return Promise.resolve({ ok: false });
      return rpc(
        "record_partner_ionos_inbox",
        { p_lease_token: lease, p_payload: batch },
        (value) => {
          const r = workerRecord(value);
          if (!r) return null;
          if (r.status === "lease_persa" && exact(r, ["status"])) return { status: "lease_persa" };
          return r.status === "recorded" &&
            exact(r, ["status", "registered", "review", "ignored"]) &&
            integer(r.registered, 0, 50) &&
            integer(r.review, 0, 50) &&
            integer(r.ignored, 0, 50)
            ? (r as PartnerInboxRecorded)
            : null;
        },
        signal,
      );
    },
    release(lease, outcome, signal) {
      if (!workerUuid(lease) || !["inbox_osservata", "inbox_incerta"].includes(outcome))
        return Promise.resolve({ ok: false });
      return rpc(
        "release_partner_ionos_inbox",
        { p_lease_token: lease, p_outcome: outcome },
        (value) => {
          const r = workerRecord(value);
          return r && exact(r, ["status"]) && (r.status === "done" || r.status === "lease_persa")
            ? (r as { status: "done" } | { status: "lease_persa" })
            : null;
        },
        signal,
      );
    },
  };
}
