import {
  parseFinanceRevisionCommand,
  type FinanceRevisionCommand,
  type FinanceRevisionReceipt,
} from "./model";
const prefix = "luckylap.finance-revisions.pending:";
const key = (userId: string) => `${prefix}${userId}`;
export function readPendingFinanceRevision(
  storage: Pick<Storage, "getItem">,
  userId: string,
): FinanceRevisionCommand | null {
  const raw = storage.getItem(key(userId));
  if (raw === null) return null;
  if (raw.length > 20000) throw new Error("Il tentativo conservato non è leggibile.");
  const command = parseFinanceRevisionCommand(JSON.parse(raw));
  if (!command) throw new Error("Il tentativo conservato non è leggibile.");
  return command;
}
/** Must complete before the first request. Existing uncertain payloads are frozen. */
export function preserveFinanceRevision(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  value: FinanceRevisionCommand,
): FinanceRevisionCommand {
  const command = parseFinanceRevisionCommand(value);
  if (!command) throw new Error("Correzione non valida.");
  const existing = readPendingFinanceRevision(storage, userId);
  const canonical = (entry: FinanceRevisionCommand) =>
    JSON.stringify({ operationId: entry.operationId, payload: entry.payload });
  if (existing && canonical(existing) !== canonical(command))
    throw new Error("Verifica il tentativo già conservato prima di crearne un altro.");
  storage.setItem(key(userId), canonical(command));
  return command;
}
export function acknowledgeFinanceRevision(
  storage: Pick<Storage, "getItem" | "removeItem">,
  userId: string,
  receipt: FinanceRevisionReceipt,
): void {
  const pending = readPendingFinanceRevision(storage, userId);
  if (
    !pending ||
    pending.operationId !== receipt.operationId ||
    pending.payload.source_kind !== receipt.sourceKind ||
    pending.payload.source_id !== receipt.sourceId ||
    pending.payload.expected_version + 1 !== receipt.version
  )
    throw new Error("La ricevuta non corrisponde al tentativo conservato.");
  storage.removeItem(key(userId));
}
