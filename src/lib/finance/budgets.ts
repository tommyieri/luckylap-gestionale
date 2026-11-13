import type { RevisedMovement } from "../finance-revisions/projection";
import { isUuid, record, safeInteger } from "../sales/model";
import type { FinanceMovement } from "./dashboard";

export const maximumBudgetCents = 99999999999999;
export type FinanceBudget = { category: string; limitCents: number; revision: string };

export function financeBudgetMonthRange(month: unknown) {
  if (typeof month !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) || month < "0001-01") {
    return null;
  }
  const from = `${month}-01`;
  const lastDay = new Date(`${month}-01T00:00:00Z`);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  return { from, to: lastDay.toISOString().slice(0, 10) };
}

export function financeBudgetFromRow(value: unknown): FinanceBudget | null {
  const row = record(value);
  if (
    !row ||
    typeof row.category !== "string" ||
    row.category !== row.category.trim() ||
    row.category.length > 240 ||
    !safeInteger(row.limit_cents, 0, maximumBudgetCents) ||
    !isUuid(row.revision)
  ) {
    return null;
  }
  return { category: row.category, limitCents: row.limit_cents, revision: row.revision };
}

export function financeBudgetActuals(
  rows: readonly RevisedMovement<FinanceMovement>[],
  month: string,
) {
  let total = 0n;
  const byCategory = new Map<string, bigint>();
  const prefix = `${month}-`;
  for (const row of rows) {
    if (
      !row.date.startsWith(prefix) ||
      row.cents >= 0n ||
      row.revision?.deleted ||
      row.pending ||
      row.future ||
      row.transfer ||
      row.evaluateBudgets === false
    )
      continue;
    const category = row.category || "Senza categoria";
    total -= row.cents;
    byCategory.set(category, (byCategory.get(category) ?? 0n) - row.cents);
  }
  return { total, byCategory };
}
