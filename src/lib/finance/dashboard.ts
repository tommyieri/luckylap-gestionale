import type { FinanceWorkSnapshot } from "../finance-work/model";
import { localReportDate, transactionTiming, type FinanceSnapshot } from "./model";
import { FINANCE_CATEGORY_GROUPS, financeCategoryGroup } from "./categories";

export type FinanceMovement = {
  id: string;
  source: "budgetflow" | "manual" | "payment" | "refund" | "consignment";
  sourceId: string;
  date: string;
  cents: bigint;
  account: string | null;
  targetAccount: string | null;
  category: string;
  description: string;
  pending: boolean;
  future: boolean;
  transfer: boolean;
  allocationNote: string | null;
};
export type AccountBalance = {
  name: string;
  posted: bigint;
  pending: bigint;
  future: bigint;
  count: number;
};
export type FinanceDashboard = {
  movements: FinanceMovement[];
  accounts: AccountBalance[];
  years: number[];
  reportDate: string;
};
export type FinanceMonth = {
  month: string;
  date: string;
  posted: bigint | null;
  planned: bigint | null;
  incoming: bigint;
  outgoing: bigint;
  net: bigint;
  count: number;
};
export type FinanceSeries = { name: string; months: FinanceMonth[] };
export type FinanceCategoryTotal = {
  category: string;
  group: string;
  cents: bigint;
  count: number;
};
export type DashboardSettlement = {
  id: string;
  saleId: string;
  cents: number;
  occurredAt: string;
  method: "cash" | "bank_transfer" | "other";
  reference: string;
};

/** Parse decimal source text, never multiply a floating point euro amount. */
export function sourceAmountCents(value: string): bigint {
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("Importo Finance non valido.");
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -cents : cents;
}
export function financeCentsLabel(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "−" : ""}${(absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${(absolute % 100n).toString().padStart(2, "0")} €`;
}
export function financeAccountLabel(value: string | null): string | null {
  const name = value?.trim();
  if (!name) return null;
  // Only explicit account labels are normalized. Gateways never establish an account.
  if (name.toLocaleLowerCase("it") === "cash") return "Cash";
  if (name.toLocaleLowerCase("it") === "revolut business") return "Revolut Business";
  return name;
}
const legs = (row: FinanceMovement) =>
  row.account
    ? [
        { account: row.account, cents: row.cents },
        ...(row.targetAccount ? [{ account: row.targetAccount, cents: -row.cents }] : []),
      ]
    : [];
const inRome = (value: string) => {
  const day = localReportDate(new Date(value));
  if (!day) throw new Error("Data Finance non valida.");
  return day;
};
const workCents = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Importo Finance non valido.");
  return BigInt(value);
};

export function buildFinanceDashboard(
  imports: FinanceSnapshot,
  work: FinanceWorkSnapshot,
  reportDate: string,
  settlements: DashboardSettlement[] = [],
): FinanceDashboard {
  if (!transactionTiming(reportDate, false, reportDate))
    throw new Error("Data del riepilogo non valida.");
  const movements: FinanceMovement[] = imports.transactions.map((row) => {
    const timing = transactionTiming(row.sourceDate, row.pending, reportDate);
    if (!timing) throw new Error("Data del movimento non valida.");
    return {
      id: `budgetflow:${row.id}`,
      source: "budgetflow",
      sourceId: row.id,
      date: row.sourceDate,
      cents: sourceAmountCents(row.sourceAmount),
      account: financeAccountLabel(row.account),
      targetAccount: financeAccountLabel(row.targetAccount),
      category: row.category,
      description: row.payee || row.notes || "Movimento BudgetFlow",
      ...timing,
      transfer: row.targetAccount !== null,
      allocationNote: null,
    };
  });
  for (const row of work.entries) {
    if (row.void) continue;
    movements.push({
      id: `manual:${row.id}`,
      source: "manual",
      sourceId: row.id,
      date: row.date,
      cents: (row.type === "income" ? 1n : -1n) * workCents(row.cents),
      account: financeAccountLabel(row.account),
      targetAccount: null,
      category: row.category ?? "",
      description: row.description,
      pending: false,
      future: row.date > reportDate,
      transfer: false,
      allocationNote: row.account?.trim() ? null : "Conto non indicato nella dichiarazione.",
    });
  }
  // Only actual payment observations/declarations. Commercial sale facts, their
  // payment facts and Shopify transaction details describe the same lifecycle.
  for (const row of work.payments) {
    const date = inRome(row.occurredAt);
    const cash = row.source === "manual_declaration" && row.method === "cash";
    movements.push({
      id: `payment:${row.id}`,
      source: "payment",
      sourceId: row.id,
      date,
      cents: workCents(row.cents),
      account: cash ? "Cash" : null,
      targetAccount: null,
      category: "Vendite",
      description:
        row.source === "shopify_observation"
          ? "Incasso Shopify osservato"
          : cash
            ? "Incasso ordine · Contanti dichiarati"
            : "Incasso dichiarato da ordine",
      pending: false,
      future: date > reportDate,
      transfer: false,
      allocationNote: cash
        ? null
        : "Conto di accredito non attribuito. Il metodo o il gateway non provano l’accredito bancario.",
    });
  }
  for (const row of work.refunds) {
    const date = inRome(row.occurredAt);
    movements.push({
      id: `refund:${row.id}`,
      source: "refund",
      sourceId: row.id,
      date,
      cents: -workCents(row.cents),
      account: null,
      targetAccount: null,
      category: "Vendite",
      description: "Rimborso Shopify osservato",
      pending: false,
      future: date > reportDate,
      transfer: false,
      allocationNote: "Conto del rimborso non attribuito.",
    });
  }
  for (const row of settlements) {
    const date = inRome(row.occurredAt),
      cash = row.method === "cash";
    movements.push({
      id: `consignment:${row.id}`,
      source: "consignment",
      sourceId: row.id,
      date,
      cents: workCents(row.cents),
      account: cash ? "Cash" : null,
      targetAccount: null,
      category: "Vendite",
      description: `Incasso conto vendita · ${row.reference}`,
      pending: false,
      future: date > reportDate,
      transfer: false,
      allocationNote: cash ? null : "Conto dell’incasso conto vendita non attribuito.",
    });
  }
  if (new Set(movements.map((row) => row.id)).size !== movements.length)
    throw new Error("Movimenti Finance duplicati.");
  const accounts = new Map<string, AccountBalance>();
  for (const row of movements)
    for (const leg of legs(row)) {
      const account = accounts.get(leg.account) ?? {
        name: leg.account,
        posted: 0n,
        pending: 0n,
        future: 0n,
        count: 0,
      };
      if (row.pending) account.pending += leg.cents;
      else if (row.future) account.future += leg.cents;
      else account.posted += leg.cents;
      account.count++;
      accounts.set(account.name, account);
    }
  const years = [
    ...new Set([
      Number(reportDate.slice(0, 4)),
      ...movements.map((row) => Number(row.date.slice(0, 4))),
    ]),
  ].sort((a, b) => b - a);
  return {
    movements: movements.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
    accounts: [...accounts.values()].sort((a, b) =>
      a.name === "Revolut Business"
        ? -1
        : b.name === "Revolut Business"
          ? 1
          : a.name.localeCompare(b.name, "it"),
    ),
    years,
    reportDate,
  };
}

/** Closing balances retain earlier years; monthly flows only concern the chosen year. */
export function financeAccountSeries(
  dashboard: FinanceDashboard,
  year: number,
  accounts: readonly string[],
): FinanceSeries[] {
  return accounts.map((name) => {
    let posted = 0n,
      future = 0n;
    const relevant = dashboard.movements.flatMap((row) =>
      legs(row)
        .filter((leg) => leg.account === name)
        .map((leg) => ({ row, cents: leg.cents })),
    );
    for (const { row, cents } of relevant)
      if (!row.pending && row.date < `${year}-01-01`) {
        if (row.future) future += cents;
        else posted += cents;
      }
    const months = Array.from({ length: 12 }, (_, index): FinanceMonth => {
      const month = `${year}-${String(index + 1).padStart(2, "0")}`;
      const end = new Date(Date.UTC(year, index + 1, 0)).toISOString().slice(0, 10);
      const started = `${month}-01` <= dashboard.reportDate;
      let incoming = 0n,
        outgoing = 0n,
        net = 0n,
        count = 0;
      for (const { row, cents } of relevant) {
        if (!row.date.startsWith(month) || row.pending) continue;
        if (row.future) {
          future += cents;
          continue;
        }
        posted += cents;
        net += cents;
        count++;
        if (!row.transfer) {
          if (cents > 0n) incoming += cents;
          else outgoing -= cents;
        }
      }
      return {
        month,
        date: started && end > dashboard.reportDate ? dashboard.reportDate : end,
        posted: started ? posted : null,
        planned: month >= dashboard.reportDate.slice(0, 7) ? posted + future : null,
        incoming,
        outgoing,
        net,
        count,
      };
    });
    return { name, months };
  });
}

export function financeCategoryTotals(
  dashboard: FinanceDashboard,
  year: number,
  accounts: readonly string[],
): FinanceCategoryTotal[] {
  const totals = new Map<string, FinanceCategoryTotal>(
    FINANCE_CATEGORY_GROUPS.flatMap((group) =>
      group.categories.map(
        (category) => [category, { category, group: group.id, cents: 0n, count: 0 }] as const,
      ),
    ),
  );
  for (const row of dashboard.movements) {
    if (
      row.pending ||
      row.future ||
      row.transfer ||
      !row.date.startsWith(`${year}-`) ||
      !row.account ||
      !accounts.includes(row.account)
    )
      continue;
    const category = row.category || "Senza categoria";
    const total = totals.get(category) ?? {
      category,
      group: financeCategoryGroup(category),
      cents: 0n,
      count: 0,
    };
    total.cents += row.cents;
    total.count++;
    totals.set(category, total);
  }
  return [...totals.values()];
}

export function financeMonthTotal(series: FinanceSeries[], index: number): bigint | null {
  const values = series.map((row) => row.months[index].posted);
  return !values.length || values.every((value) => value === null)
    ? null
    : values.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n);
}
