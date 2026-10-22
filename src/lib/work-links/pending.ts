import { parsePartnerWorkCommand, type PartnerWorkCommand, type PartnerWorkReceipt } from "./model";
export const pendingPartnerWorkKey = (actorId: string) =>
  `luckylap.partner-work.pending:${actorId}`;
const canonical = (command: PartnerWorkCommand) =>
  JSON.stringify({
    operationId: command.operationId,
    actorId: command.actorId,
    payload: command.payload,
  });
export function readPendingPartnerWork(
  storage: Pick<Storage, "getItem">,
  actorId: string,
): PartnerWorkCommand | null {
  const raw = storage.getItem(pendingPartnerWorkKey(actorId));
  if (raw === null) return null;
  if (raw.length > 4000) throw new Error("Il tentativo conservato non è leggibile.");
  const command = parsePartnerWorkCommand(JSON.parse(raw));
  if (!command || command.actorId !== actorId)
    throw new Error("Il tentativo conservato non appartiene a questo account o non è leggibile.");
  return command;
}
export function preservePartnerWork(
  storage: Pick<Storage, "getItem" | "setItem">,
  actorId: string,
  value: PartnerWorkCommand,
): PartnerWorkCommand {
  const command = parsePartnerWorkCommand(value);
  if (!command || command.actorId !== actorId)
    throw new Error("Accedi di nuovo con l’account che ha iniziato l’operazione.");
  const existing = readPendingPartnerWork(storage, actorId);
  if (existing && canonical(existing) !== canonical(command))
    throw new Error("Verifica il tentativo conservato prima di iniziarne un altro.");
  storage.setItem(pendingPartnerWorkKey(actorId), canonical(command));
  return command;
}
export function acknowledgePartnerWork(
  storage: Pick<Storage, "getItem" | "removeItem">,
  actorId: string,
  receipt: PartnerWorkReceipt,
): void {
  const command = readPendingPartnerWork(storage, actorId);
  if (
    !command ||
    receipt.actorId !== actorId ||
    receipt.operationId !== command.operationId ||
    receipt.kind !== command.payload.kind ||
    (command.payload.kind !== "resolve" && receipt.partnerId !== command.payload.partner_id)
  )
    throw new Error("La ricevuta non corrisponde al tentativo conservato.");
  storage.removeItem(pendingPartnerWorkKey(actorId));
}
