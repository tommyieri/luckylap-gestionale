import "server-only";
import { CANONICAL_API_VERSION, CANONICAL_QUERIES } from "./canonical-queries";
import { CanonicalReadError, canonicalArray, canonicalExactCount, canonicalFailure, canonicalGid, canonicalRecord, canonicalShop, canonicalTimestamp, canonicalUnique, normalizeCanonicalShopifyOrder, type CanonicalReadResult } from "./canonical-model";

export type CanonicalReaderInput = { shopDomain: string; adminToken: string; orderId: string };
export type CanonicalReaderOptions = { fetch?: typeof fetch; timeoutMs?: number; maxPages?: number };
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PAGE_SIZE = 100;
const stable = (value: unknown): string => JSON.stringify(value, (_key, row: unknown) => row && typeof row === "object" && !Array.isArray(row) ? Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))) : row);
const mismatch = (): never => { throw new CanonicalReadError("snapshot_changed", "unavailable"); };
/** No scheduling, persistence, Shopify mutation, business side effect or global credentials. */
export async function readCanonicalShopifyOrder(input: CanonicalReaderInput, options: CanonicalReaderOptions = {}): Promise<CanonicalReadResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!input || !canonicalShop(input.shopDomain) || typeof input.adminToken !== "string" || !/^[\x21-\x7e]{20,512}$/.test(input.adminToken)) throw new CanonicalReadError("configuration_required", "unavailable");
    try { canonicalGid(input.orderId, "Order"); } catch { throw new CanonicalReadError("invalid_order_id"); }
    const timeoutMs = options.timeoutMs ?? 15000, maxPages = options.maxPages ?? 100;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new CanonicalReadError("configuration_required", "unavailable");
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const fetcher = options.fetch ?? fetch;
    let requests = 0;
    async function bounded<T>(request: Promise<T>): Promise<T> {
      let listener: (() => void) | undefined;
      try { return await Promise.race([request, new Promise<never>((_resolve, reject) => { listener = () => reject(new CanonicalReadError("timeout", "unavailable")); if (controller.signal.aborted) listener(); else controller.signal.addEventListener("abort", listener, { once: true }); })]); }
      finally { if (listener) controller.signal.removeEventListener("abort", listener); }
    }
    async function request(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
      if (++requests > maxPages * 4 + 2) throw new CanonicalReadError("read_limit");
      let response: Response;
      try { response = await bounded(fetcher(`https://${input.shopDomain}/admin/api/${CANONICAL_API_VERSION}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "X-Shopify-Access-Token": input.adminToken }, body: JSON.stringify({ query, variables }), signal: controller.signal, redirect: "error", cache: "no-store", credentials: "omit" })); }
      catch (error) { if (error instanceof CanonicalReadError) throw error; throw new CanonicalReadError(controller.signal.aborted ? "timeout" : "network_unavailable", "unavailable"); }
      if (response.status === 401 || response.status === 403) throw new CanonicalReadError("access_denied", "unavailable");
      if (response.status === 429) throw new CanonicalReadError("throttled", "unavailable");
      if (!response.ok) throw new CanonicalReadError("network_unavailable", "unavailable");
      if (response.headers.get("x-shopify-api-version") !== CANONICAL_API_VERSION) throw new CanonicalReadError("version_mismatch");
      const length = response.headers.get("content-length"); if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) throw new CanonicalReadError("read_limit");
      if (!response.body) throw new CanonicalReadError("invalid_response", "unavailable");
      const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      try { for (;;) { const { done, value } = await bounded(reader.read()); if (done) break; size += value.length; if (size > MAX_RESPONSE_BYTES) { void reader.cancel().catch(() => undefined); throw new CanonicalReadError("read_limit"); } chunks.push(value); } }
      catch (error) { if (error instanceof CanonicalReadError) throw error; throw new CanonicalReadError(controller.signal.aborted ? "timeout" : "invalid_response", "unavailable"); }
      finally { try { reader.releaseLock(); } catch { void reader.cancel().catch(() => undefined); } }
      let parsed: Record<string, unknown>;
      try { const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } parsed = canonicalRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
      catch { throw new CanonicalReadError("invalid_response", "unavailable"); }
      if (parsed.errors !== undefined) {
        const errors = canonicalArray(parsed.errors, 1000);
        if (errors.length) { const codes = errors.map(e => { try { return canonicalRecord(canonicalRecord(e).extensions).code; } catch { return null; } }); throw new CanonicalReadError(codes.includes("THROTTLED") ? "throttled" : codes.includes("ACCESS_DENIED") ? "access_denied" : "graphql_error", "unavailable"); }
      }
      return canonicalRecord(parsed.data);
    }
    const summaryResponse = await request(CANONICAL_QUERIES.summary, { id: input.orderId });
    if (summaryResponse.order === null) throw new CanonicalReadError("order_not_found");
    const order = canonicalRecord(summaryResponse.order);
    if (canonicalGid(order.id, "Order") !== input.orderId) throw new CanonicalReadError("foreign_reference");
    const revision = canonicalTimestamp(order.updatedAt);
    const transactionRows = canonicalArray(order.transactions, 250), fulfillmentRows = canonicalArray(order.fulfillments, 250), refundRows = canonicalArray(order.refunds, 249);
    canonicalExactCount(order.transactionsCount, transactionRows.length); canonicalExactCount(order.fulfillmentsCount, fulfillmentRows.length);
    canonicalUnique(transactionRows.map(v => canonicalGid(canonicalRecord(v).id, "OrderTransaction")));
    canonicalUnique(fulfillmentRows.map(v => canonicalGid(canonicalRecord(v).id, "Fulfillment")));
    canonicalUnique(refundRows.map(v => canonicalGid(canonicalRecord(v).id, "Refund")));
    async function pages(query: string, root: "order" | "fulfillment" | "refund", id: string, connectionName: string, check: (row: Record<string, unknown>) => void): Promise<unknown[]> {
      let after: string | null = null; const cursors = new Set<string>(), nodes: unknown[] = [];
      for (let page = 0; page < maxPages; page++) {
        const data = await request(query, { id, after }), row = canonicalRecord(data[root]); check(row);
        const connection = canonicalRecord(row[connectionName]), batch = canonicalArray(connection.nodes, PAGE_SIZE), pageInfo = canonicalRecord(connection.pageInfo);
        if (typeof pageInfo.hasNextPage !== "boolean" || (pageInfo.endCursor !== null && (typeof pageInfo.endCursor !== "string" || pageInfo.endCursor.length < 1 || pageInfo.endCursor.length > 4096))) throw new CanonicalReadError("pagination_incomplete");
        if ((batch.length > 0 && (pageInfo.endCursor === null || cursors.has(pageInfo.endCursor as string))) || (pageInfo.hasNextPage && (batch.length === 0 || pageInfo.endCursor === null))) throw new CanonicalReadError("pagination_incomplete");
        nodes.push(...batch); if (nodes.length > 10000) throw new CanonicalReadError("read_limit");
        if (!pageInfo.hasNextPage) return nodes;
        after = pageInfo.endCursor as string; cursors.add(after);
      }
      throw new CanonicalReadError("read_limit");
    }
    const lines = await pages(CANONICAL_QUERIES.lines, "order", input.orderId, "lineItems", row => { if (canonicalGid(row.id, "Order") !== input.orderId) throw new CanonicalReadError("foreign_reference"); if (canonicalTimestamp(row.updatedAt) !== revision) mismatch(); });
    const fulfillments: unknown[] = [];
    for (const raw of fulfillmentRows) {
      const base = canonicalRecord(raw), id = canonicalGid(base.id, "Fulfillment"); let detail: Record<string, unknown> | undefined;
      const entries = await pages(CANONICAL_QUERIES.fulfillment, "fulfillment", id, "fulfillmentLineItems", row => {
        if (canonicalGid(row.id, "Fulfillment") !== id || canonicalGid(canonicalRecord(row.order).id, "Order") !== input.orderId) throw new CanonicalReadError("foreign_reference");
        if (stable({ id: row.id, status: row.status, location: row.location, updatedAt: row.updatedAt, totalQuantity: row.totalQuantity }) !== stable(base)) mismatch(); detail = row;
      });
      fulfillments.push({ ...detail, lines: entries });
    }
    const refunds: unknown[] = [];
    for (const raw of refundRows) {
      const base = canonicalRecord(raw), id = canonicalGid(base.id, "Refund"); let detail: Record<string, unknown> | undefined;
      const entries = await pages(CANONICAL_QUERIES.refund, "refund", id, "refundLineItems", row => {
        if (canonicalGid(row.id, "Refund") !== id || canonicalGid(canonicalRecord(row.order).id, "Order") !== input.orderId) throw new CanonicalReadError("foreign_reference");
        if (stable({ id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, totalRefundedSet: row.totalRefundedSet }) !== stable(base)) mismatch(); detail = row;
      });
      refunds.push({ ...detail, lines: entries });
    }
    // Re-read the whole allowlist summary, including child revisions and money,
    // after all pages. A changed snapshot never produces effects from mixed eras.
    const final = await request(CANONICAL_QUERIES.summary, { id: input.orderId });
    if (stable(final.order) !== stable(order)) mismatch();
    return normalizeCanonicalShopifyOrder({ order, lines, fulfillments, refunds }, input.shopDomain);
  } catch (error) { return canonicalFailure(error); }
  finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
}
