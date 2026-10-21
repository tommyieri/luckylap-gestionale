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
