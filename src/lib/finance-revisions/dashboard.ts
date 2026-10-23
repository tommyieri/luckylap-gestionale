import type { AccountBalance } from "../finance/dashboard";
import {
  applyFinanceRevisions,
  revisedAccountBalances,
  type RevisableMovement,
} from "./projection";
import type { FinanceRevisionOriginal, FinanceRevisionRecord } from "./model";
/** Applies one effective ledger before every chart/filter/category calculation. P3 shop payments pass through. */
export function revisedFinanceDashboard<T extends RevisableMovement>(
  base: { movements: T[]; accounts: AccountBalance[]; years: number[]; reportDate: string },
  heads: FinanceRevisionRecord[],
  originals: FinanceRevisionOriginal[] = [],
) {
  const { active, deleted } = applyFinanceRevisions(
    base.movements,
    heads,
    base.reportDate,
    originals,
  );
  const movements = active.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const accounts = revisedAccountBalances(movements).sort((a, b) =>
    a.name === "Revolut Business"
      ? -1
      : b.name === "Revolut Business"
        ? 1
        : a.name.localeCompare(b.name, "it"),
  );
  const years = [
    ...new Set([
      Number(base.reportDate.slice(0, 4)),
      ...movements.map((row) => Number(row.date.slice(0, 4))),
    ]),
  ].sort((a, b) => b - a);
  return { ...base, movements, accounts, years, deletedMovements: deleted };
}
