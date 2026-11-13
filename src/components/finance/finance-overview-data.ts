import type { FinanceDashboard, FinanceMovement } from "../../lib/finance/dashboard";
import type { RevisedMovement } from "../../lib/finance-revisions/projection";
import {
  filterFinanceMovements,
  type FinanceSummary,
  type FinanceView,
} from "../../lib/finance/workspace";

export type BalancePoint = { date: string; posted: bigint | null; planned: bigint | null };
export type BalanceTrend = {
  name: string;
  opening: bigint;
  closing: bigint;
  points: BalancePoint[];
};

const day = 86_400_000;
export const chartDate = (date: string) => new Date(`${date}T00:00:00Z`).getTime();

/** Each account has its own balance, with both legs of transfers and the full opening history. */
export function financeBalanceTrends(
  dashboard: FinanceDashboard,
  view: FinanceView,
  summary: FinanceSummary,
): BalanceTrend[] {
  const from = summary.buckets[0]?.from ?? summary.asOf;
  const to = summary.buckets.at(-1)?.to ?? summary.asOf;
  if (view.account === "__unallocated") return [];
  const allAccounts = !view.account || view.account === "__allocated";
  const byAccount = new Map<string, Map<string, bigint>>(
    dashboard.accounts
      .filter(({ name }) => allAccounts || name === view.account)
      .map(({ name }) => [name, new Map()]),
  );
  function addLeg(name: string, date: string, cents: bigint) {
    const account = byAccount.get(name);
    if (account) account.set(date, (account.get(date) ?? 0n) + cents);
  }
  for (const row of dashboard.movements as RevisedMovement<FinanceMovement>[]) {
    const expected = row.expectedPayment && row.future && row.date > summary.asOf;
    if (!row.account || (row.pending && !expected) || row.revision?.deleted || row.date > to)
      continue;
    addLeg(row.account, row.date, row.cents);
    if (row.transfer && row.targetAccount) addLeg(row.targetAccount, row.date, -row.cents);
  }

  const days = Math.round((chartDate(to) - chartDate(from)) / day);
  const dates = new Set<string>([from, to]);
  if (summary.asOf >= from && summary.asOf <= to) dates.add(summary.asOf);
  if (days < 62) {
    const start = chartDate(from);
    for (let i = 1; i < days; i++) dates.add(new Date(start + i * day).toISOString().slice(0, 10));
  } else {
    for (const bucket of summary.buckets) dates.add(bucket.to);
  }
  const samples = [...dates].sort();

  return [...byAccount].map(([name, legs]) => {
    const entries = [...legs].sort(([left], [right]) => left.localeCompare(right));
    const opening = entries.reduce(
      (sum, [date, cents]) => (date < from && date <= summary.asOf ? sum + cents : sum),
      0n,
    );
    const closing = entries.reduce(
      (sum, [date, cents]) => (date <= summary.asOf ? sum + cents : sum),
      0n,
    );
    let index = 0;
    let amount = 0n;
    const points = samples.map((date): BalancePoint => {
      while (index < entries.length && entries[index][0] <= date) {
        amount += entries[index][1];
        index++;
      }
      return date <= summary.asOf
        ? { date, posted: amount, planned: null }
        : { date, posted: null, planned: amount };
    });
    return { name, opening, closing, points };
  });
}

export function financeOverviewSchedules(dashboard: FinanceDashboard, view: FinanceView) {
  const scope: FinanceView = {
    ...view,
    query: "",
    direction: "all",
    category: "",
    source: "",
    batchId: "",
  };
  const ascending = (a: FinanceMovement, b: FinanceMovement) =>
    a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  return {
    planned: filterFinanceMovements(dashboard.movements, {
      ...scope,
      state: "future",
    }).sort(ascending),
    pending: filterFinanceMovements(dashboard.movements, {
      ...scope,
      from: "0001-01-01",
      state: "pending",
    }).sort((a, b) => ascending(b, a)),
  };
}
