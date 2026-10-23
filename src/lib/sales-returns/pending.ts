import { parseSaleReturnInput, type SaleReturnInput } from "./model";

export type PendingSaleReturn = Omit<SaleReturnInput, "retry">;
const key = (userId: string, orderId: string) =>
  `luckylap.sale-return.pending:${userId}:${orderId}`;
const canonical = (input: PendingSaleReturn) => {
  const parsed = parseSaleReturnInput(input);
  if (!parsed || parsed.retry !== undefined) throw new Error("Il tentativo di reso non è valido.");
  return parsed as PendingSaleReturn;
};
export function readPendingSaleReturn(
  storage: Pick<Storage, "getItem">,
  userId: string,
  orderId: string,
): PendingSaleReturn | null {
  const raw = storage.getItem(key(userId, orderId));
  if (raw === null) return null;
  if (raw.length > 20000) throw new Error("Il tentativo conservato non è leggibile.");
  const parsed = canonical(JSON.parse(raw));
  if (parsed.userId !== userId || parsed.orderId !== orderId)
    throw new Error("Il tentativo non corrisponde alla vendita.");
  return parsed;
}
export function preserveSaleReturn(
  storage: Pick<Storage, "getItem" | "setItem">,
  input: PendingSaleReturn,
): PendingSaleReturn {
  const parsed = canonical(input),
    saved = readPendingSaleReturn(storage, input.userId, input.orderId);
  if (saved && JSON.stringify(saved) !== JSON.stringify(parsed))
    throw new Error("Verifica prima il reso già conservato.");
  storage.setItem(key(input.userId, input.orderId), JSON.stringify(parsed));
  return parsed;
}
export function clearSaleReturn(
  storage: Pick<Storage, "getItem" | "removeItem">,
  input: PendingSaleReturn,
): void {
  const parsed = canonical(input),
    saved = readPendingSaleReturn(storage, input.userId, input.orderId);
  if (!saved || JSON.stringify(saved) !== JSON.stringify(parsed))
    throw new Error("L’esito non corrisponde al reso conservato.");
  storage.removeItem(key(input.userId, input.orderId));
}
