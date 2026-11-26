import "server-only";
import { abortable, boundedPhase } from "../shopify/worker-io";
import type {
  PacklinkCanonicalTransaction,
  PacklinkClientInput,
  PacklinkClientOptions,
  PacklinkReadFailureCode,
  PacklinkReadResult,
} from "./types";

export const PACKLINK_RESPONSE_MAX_BYTES = 256 * 1024;
export const PACKLINK_REQUEST_TIMEOUT_MS = 8000;
export const PACKLINK_MAX_TRANSACTIONS = 1000;
const ORIGIN = "https://api.packlink.com";
const PAGE_SIZE = 10;
const MAX_PAGES = 100;
const MAX_CENTS = 100_000_000n;
const TRANSACTION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const REFERENCE = /^[A-Za-z0-9_-]{1,100}$/;
const UINT64_MAX = 18_446_744_073_709_551_615n;

class ReadFailure extends Error {
  constructor(
    readonly code: PacklinkReadFailureCode,
    readonly status: "review" | "retry" = "review",
  ) {
    super(code);
  }
}
const fail = (code: PacklinkReadFailureCode, status: "review" | "retry" = "review"): never => {
  throw new ReadFailure(code, status);
};
const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return fail("malformed_response");
  return value as Record<string, unknown>;
};

/** Keep the original numeric lexeme: JSON.parse's Number alone loses 1e2/1.2300. */
class NumericAmount {
  constructor(readonly lexeme: string | undefined) {}
}
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || BigInt(length) > BigInt(PACKLINK_RESPONSE_MAX_BYTES))
  ) {
    void response.body?.cancel().catch(() => undefined);
    return fail("response_too_large");
  }
  if (!response.body) return fail("malformed_response");
  const reader = response.body.getReader();
  const bytes = new Uint8Array(PACKLINK_RESPONSE_MAX_BYTES);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array) || size + value.byteLength > bytes.length)
        return fail("response_too_large");
      bytes.set(value, size);
      size += value.byteLength;
    }
    if (!size) return fail("malformed_response");
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
      return JSON.parse(text, (key: string, value: unknown, context?: { source?: string }) =>
        key === "total_price" && typeof value === "number"
          ? new NumericAmount(context?.source)
          : value,
      ) as unknown;
    } catch {
      return fail("malformed_response");
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Preserve every representable source digit; never round across the DB cutover. */
function timestamp(value: unknown): string {
  if (typeof value !== "string" || value.length > 64) return fail("invalid_timestamp");
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      value,
    );
  if (!match) return fail("invalid_timestamp");
  if (/[1-9]/.test((match[7] ?? "").slice(6))) return fail("invalid_timestamp");
  const calendar = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  const date = new Date(value);
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== `${match[1]}-${match[2]}-${match[3]}` ||
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.getUTCFullYear() > 9999
  )
    return fail("invalid_timestamp");
  return `${date.toISOString().slice(0, 19)}.${(match[7] ?? "").padEnd(9, "0")}Z`;
}
function amount(value: unknown, kind: PacklinkCanonicalTransaction["provider_type"]): number {
  if (!(value instanceof NumericAmount) || typeof value.lexeme !== "string")
    return fail("invalid_amount");
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.lexeme);
  if (!match || value.lexeme.length > 32) return fail("invalid_amount");
  const negative = match[1] === "-";
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  if (!cents || cents > MAX_CENTS || negative !== (kind === "REFUND"))
    return fail("invalid_amount");
  return Number(cents);
}
function transaction(value: unknown): PacklinkCanonicalTransaction {
  const raw = record(value);
  if (typeof raw.order_reference !== "string" || !TRANSACTION_ID.test(raw.order_reference))
    return fail("malformed_response");
  if (raw.type !== "LABELS_ORDER" && raw.type !== "REFUND") return fail("unsupported_transaction");
  if (raw.currency !== "EUR") return fail("unsupported_currency");
  if (
    !Array.isArray(raw.shipments_search) ||
    raw.shipments_search.length > 20 ||
    raw.shipments_search.some((ref) => typeof ref !== "string" || !REFERENCE.test(ref)) ||
    new Set(raw.shipments_search).size !== raw.shipments_search.length
  )
    return fail("invalid_reference");
  return {
    provider_transaction_id: raw.order_reference,
    provider_type: raw.type,
    amount_cents: amount(raw.total_price, raw.type),
    currency: "EUR",
    occurred_at: timestamp(raw.order_date).replace(
      /\.(\d{9})Z$/,
      (_match, fraction: string) => `.${fraction.replace(/0+$/, "").padEnd(3, "0")}Z`,
    ),
    shipment_references: [...raw.shipments_search].sort(),
    shopify_order_gid: null,
  };
}
function shopifyOrderId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const numeric = /^gid:\/\/shopify\/Order\/([1-9]\d{0,19})$/.exec(value)?.[1] ?? value;
  if (!/^[1-9]\d{0,19}$/.test(numeric) || BigInt(numeric) > UINT64_MAX) return null;
  return `gid://shopify/Order/${numeric}`;
}

/** Read-only provider observations. No credentials, contacts or raw responses escape. */
export async function readPacklinkTransactions(
  input: PacklinkClientInput,
  options: PacklinkClientOptions = {},
): Promise<PacklinkReadResult> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const fetcher = options.fetch ?? fetch;
  try {
    const maxPages = options.maxPages ?? MAX_PAGES;
    if (
      typeof input.apiKey !== "string" ||
      !/^[\x21-\x7e]{1,2048}$/.test(input.apiKey) ||
      typeof input.expectedClientId !== "string" ||
      !CLIENT_ID.test(input.expectedClientId) ||
      !(input.now instanceof Date) ||
      !Number.isFinite(input.now.getTime()) ||
      !Number.isInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > MAX_PAGES
    )
      return fail("invalid_input");
    let from: string;
    let to: string;
    try {
      const cutover = timestamp(input.cutoverAt);
      const now = timestamp(input.now.toISOString());
      if (cutover > now) return fail("invalid_input");
      from = cutover.slice(0, 10);
      to = timestamp(new Date(input.now.getTime() + 86_400_000).toISOString()).slice(0, 10);
    } catch {
      return fail("invalid_input");
    }
    async function get(path: string, allowNotFound = false): Promise<unknown> {
      return boundedPhase(controller.signal, PACKLINK_REQUEST_TIMEOUT_MS, async (signal) => {
        const response = await abortable(
          fetcher(`${ORIGIN}${path}`, {
            method: "GET",
            headers: { Authorization: input.apiKey, Accept: "application/json" },
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
            signal,
          }),
          signal,
        );
        if (response.redirected) {
          void response.body?.cancel().catch(() => undefined);
          return fail("malformed_response");
        }
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => undefined);
          if (response.status === 404 && allowNotFound) return null;
          if (response.status === 401 || response.status === 403) return fail("access_denied");
          if (response.status === 429) return fail("throttled", "retry");
          if (response.status >= 500) return fail("unavailable", "retry");
          return fail("malformed_response");
        }
        return json(response, signal);
      });
    }
    const profile = record(await get("/v1/clients"));
    if (profile.identifier !== input.expectedClientId) return fail("account_mismatch");

    const transactions: PacklinkCanonicalTransaction[] = [];
    const ids = new Set<string>();
    let totalPages: number | undefined;
    let totalRows: number | undefined;
    for (let page = 1; page <= (totalPages ?? 1); page++) {
      if (page > maxPages) return fail("pagination_limit");
      const query = new URLSearchParams({ from, to, page: String(page), size: String(PAGE_SIZE) });
      const body = record(await get(`/v1/invoicing/transactions?${query}`));
      const pagination = record(body.pagination);
      if (
        !Array.isArray(body.items) ||
        pagination.is_one_indexed !== true ||
        !Number.isInteger(pagination.current_page) ||
        pagination.current_page !== page ||
        typeof pagination.total_pages !== "number" ||
        !Number.isSafeInteger(pagination.total_pages) ||
        pagination.total_pages < 0 ||
        typeof pagination.total_registers !== "number" ||
        !Number.isSafeInteger(pagination.total_registers) ||
        pagination.total_registers < 0
      )
        return fail("malformed_response");
      const pages = pagination.total_pages;
      const rows = pagination.total_registers;
      if (rows > PACKLINK_MAX_TRANSACTIONS || pages > maxPages) return fail("pagination_limit");
      if (totalPages !== undefined && (pages !== totalPages || rows !== totalRows))
        return fail("pagination_changed", "retry");
      if (rows === 0 ? pages > 1 : pages !== Math.ceil(rows / PAGE_SIZE))
        return fail("malformed_response");
      totalPages = pages;
      totalRows = rows;
      const expectedRows =
        rows === 0 ? 0 : page < pages ? PAGE_SIZE : rows - (pages - 1) * PAGE_SIZE;
      if (body.items.length !== expectedRows) return fail("pagination_changed", "retry");
      for (const item of body.items) {
        const normalized = transaction(item);
        if (ids.has(normalized.provider_transaction_id))
          return fail("duplicate_transaction", "retry");
        ids.add(normalized.provider_transaction_id);
        transactions.push(normalized);
      }
    }
    if (transactions.length !== totalRows) return fail("pagination_changed", "retry");

    const singleRefs = [
      ...new Set(
        transactions.flatMap((item) =>
          item.shipment_references.length === 1 ? item.shipment_references : [],
        ),
      ),
    ];
    const links = new Map<string, string | null>();
    // Four independent reads at a time; repeat references share one lookup.
    for (let index = 0; index < singleRefs.length; index += 4) {
      await Promise.all(
        singleRefs.slice(index, index + 4).map(async (ref) => {
          const value = await get(`/v1/shipments/${encodeURIComponent(ref)}`, true);
          if (value === null) {
            links.set(ref, null);
            return;
          }
          const shipment = record(value);
          if (shipment.packlink_reference !== ref) return fail("malformed_response");
          if (shipment.client_id !== input.expectedClientId) return fail("account_mismatch");
          const additional = shipment.additional_data;
          const orderId =
            additional !== null && typeof additional === "object" && !Array.isArray(additional)
              ? (additional as Record<string, unknown>).order_id
              : undefined;
          links.set(ref, shipment.source === "module_shopify" ? shopifyOrderId(orderId) : null);
        }),
      );
    }
    if (controller.signal.aborted) return fail("aborted", "retry");
    return {
      status: "ready",
      clientId: input.expectedClientId,
      transactions: transactions.map((item) => ({
        ...item,
        shopify_order_gid:
          item.shipment_references.length === 1
            ? (links.get(item.shipment_references[0]!) ?? null)
            : null,
      })),
    };
  } catch (error) {
    if (options.signal?.aborted) return { status: "retry", code: "aborted" };
    if (error instanceof ReadFailure) return { status: error.status, code: error.code };
    return { status: "retry", code: "unavailable" };
  } finally {
    controller.abort();
    options.signal?.removeEventListener("abort", onAbort);
  }
}
