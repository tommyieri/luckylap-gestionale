import { isUuid, record } from "@/lib/sales/model";
import type { SaleCancellationInput } from "./model";

export type PendingSaleCancellation = Omit<SaleCancellationInput, "retry">;
const key = (userId: string, orderId: string) =>
  `luckylap.sale-cancellation.pending:${userId}:${orderId}`;

function parse(value: unknown): PendingSaleCancellation | null {
  const input = record(value);
  if (
    !input ||
    Object.keys(input).sort().join(",") !==
      "confirmStock,expectedVersion,operationId,orderId,reason,userId" ||
    !isUuid(input.operationId) ||
    !isUuid(input.userId) ||
    !isUuid(input.orderId) ||
    typeof input.expectedVersion !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.expectedVersion) ||
    typeof input.reason !== "string" ||
    input.reason !== input.reason.trim() ||
    input.reason.length < 3 ||
    input.reason.length > 500 ||
    input.confirmStock !== true
  )
    return null;
  return {
    operationId: input.operationId,
    userId: input.userId,
    orderId: input.orderId,
    expectedVersion: input.expectedVersion,
    reason: input.reason,
    confirmStock: true,
  };
}

export function readPendingSaleCancellation(
  storage: Pick<Storage, "getItem">,
  userId: string,
  orderId: string,
): PendingSaleCancellation | null {
  const raw = storage.getItem(key(userId, orderId));
  if (raw === null) return null;
  if (raw.length > 4000) throw new Error("Il tentativo conservato non è leggibile.");
  const command = parse(JSON.parse(raw));
  if (!command || command.userId !== userId || command.orderId !== orderId)
    throw new Error("Il tentativo conservato non corrisponde a questa vendita.");
  return command;
}

/** Conserva UUID e dati prima della richiesta; non sostituisce mai un invio incerto. */
export function preserveSaleCancellation(
  storage: Pick<Storage, "getItem" | "setItem">,
  input: PendingSaleCancellation,
): PendingSaleCancellation {
  const next = parse(input);
  if (!next) throw new Error("Controlla motivo e conferma dell’annullamento.");
  const existing = readPendingSaleCancellation(storage, next.userId, next.orderId);
  if (existing && JSON.stringify(existing) !== JSON.stringify(next))
    throw new Error("Verifica il tentativo già conservato prima di iniziarne un altro.");
  storage.setItem(key(next.userId, next.orderId), JSON.stringify(next));
  return next;
}

/** Cancella soltanto il tentativo preciso a cui appartiene l’esito definitivo. */
export function clearSaleCancellation(
  storage: Pick<Storage, "getItem" | "removeItem">,
  input: PendingSaleCancellation,
): void {
  const pending = readPendingSaleCancellation(storage, input.userId, input.orderId);
  if (!pending || JSON.stringify(pending) !== JSON.stringify(input))
    throw new Error("L’esito non corrisponde al tentativo conservato.");
  storage.removeItem(key(input.userId, input.orderId));
}
