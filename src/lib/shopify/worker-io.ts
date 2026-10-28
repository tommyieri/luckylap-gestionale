import "server-only";

/** Also bounds injected transports that fail to reject promptly on abort. */
export async function abortable<T>(pending: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void Promise.resolve(pending).catch(() => undefined);
    throw new Error("worker_aborted");
  }
  let listener: (() => void) | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        listener = () => reject(new Error("worker_aborted"));
        signal.addEventListener("abort", listener, { once: true });
        if (signal.aborted) listener();
      }),
    ]);
  } finally {
    if (listener) signal.removeEventListener("abort", listener);
  }
}

export async function boundedPhase<T>(
  parent: AbortSignal,
  timeoutMs: number,
  task: (signal: AbortSignal) => PromiseLike<T>,
): Promise<T> {
  if (parent.aborted || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("worker_aborted");
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parent.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await abortable(task(controller.signal), controller.signal);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", onAbort);
    controller.abort();
  }
}

/** A single bounded allocation: no response/error body can grow without limit. */
export async function workerJson(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (
    !response.body ||
    (length !== null && (!/^\d+$/.test(length) || BigInt(length) > BigInt(maxBytes)))
  )
    throw new Error("worker_response_invalid");
  const bytes = new Uint8Array(maxBytes);
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array) || size + value.byteLength > maxBytes)
        throw new Error("worker_response_invalid");
      bytes.set(value, size);
      size += value.byteLength;
    }
    // Fetch can decompress gzip/br while preserving the compressed length.
    // EOF, the actual byte cap and strict JSON parsing establish completeness.
    if (size === 0) throw new Error("worker_response_invalid");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export const workerUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) &&
  !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
export const workerRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
/** A code, never free text or an address: it ends up in events and logs. */
export const safeWorkerReason = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(value);

export type WorkerRpcTransport = {
  supabaseUrl: string;
  rpcNames: readonly string[];
  timeoutMs: number;
  maxResponseBytes: number;
  /** When set, the body must be text within this many UTF-8 bytes. */
  maxRequestBytes?: number;
};

/** Bound bytes BEFORE PostgREST's parser and never forward apikey on redirect.
 * Shared by every private worker: only the RPC names and the limits differ. */
export function createWorkerRpcFetch(
  transport: WorkerRpcTransport,
  fetcher: typeof fetch = fetch,
): typeof fetch {
  const origin = new URL(transport.supabaseUrl).origin;
  const rpcPaths = new Set(transport.rpcNames.map((name) => `/rest/v1/rpc/${name}`));
  const { timeoutMs, maxResponseBytes, maxRequestBytes } = transport;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const parentSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
    const body = init?.body;
    if (
      url.origin !== origin ||
      !rpcPaths.has(url.pathname) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      method !== "POST" ||
      !parentSignal ||
      // PostgREST always sends JSON text: count bytes, a character can take up to three.
      (maxRequestBytes !== undefined &&
        (typeof body !== "string" ||
          body.length > maxRequestBytes ||
          new TextEncoder().encode(body).byteLength > maxRequestBytes))
    )
      throw new Error("worker_transport_invalid");
    return boundedPhase(parentSignal, timeoutMs, async (signal) => {
      const response = await abortable(
        fetcher(input, {
          ...init,
          method: "POST",
          signal,
          redirect: "error",
          cache: "no-store",
          credentials: "omit",
        }),
        signal,
      );
      if (!response.ok) {
        // Never parse error bodies. RPC errors remain uncertain to the caller.
        void response.body?.cancel().catch(() => undefined);
        return Response.json(
          { code: "worker_database_unavailable", message: "worker_database_unavailable" },
          { status: response.status },
        );
      }
      if (response.redirected || response.status !== 200) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error("worker_response_invalid");
      }
      const value = await workerJson(response, signal, maxResponseBytes);
      return Response.json(value);
    });
  };
}
