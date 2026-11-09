import { financeCentsLabel, type FinanceMovement } from "../../lib/finance/dashboard";
import type { RevisedMovement } from "../../lib/finance-revisions/projection";
import { formatRomeDate } from "../../lib/team/model";

export const FINANCE_SOURCE_LABELS: Record<FinanceMovement["source"], string> = {
  budgetflow: "Budget Flow",
  manual: "Voce manuale",
  payment: "Incasso ordine",
  refund: "Rimborso Shopify",
  consignment: "Incasso conto vendita",
  shop_payment: "Pagamento del negozio",
};
export function revisionAuthorLine(
  revision: NonNullable<RevisedMovement["revision"]>,
  names: Record<string, string>,
) {
  return `${revision.deleted ? "Eliminato" : "Modificato"} da ${names[revision.actorId] ?? "un membro del team"} · ${formatRomeDate(revision.occurredAt)}`;
}
export function financeMovementTitle(row: FinanceMovement) {
  return row.description.trim() && row.description !== "Movimento BudgetFlow"
    ? row.description
    : "Descrizione da aggiungere";
}
export function financeMovementCategory(row: FinanceMovement) {
  return row.transfer ? "Trasferimento" : row.category || "Senza categoria";
}
export function financeMovementAmount(row: FinanceMovement) {
  return `${!row.transfer && row.cents > 0n ? "+" : ""}${financeCentsLabel(row.cents)}`;
}
export function financeMovementDirection(row: FinanceMovement) {
  return row.transfer
    ? "Trasferimento"
    : row.cents > 0n
      ? "Entrata"
      : row.cents < 0n
        ? "Uscita"
        : "Importo nullo";
}
export function financeMovementAnchor(row: FinanceMovement) {
  return `movimento-${row.source}-${row.sourceId}`;
}
