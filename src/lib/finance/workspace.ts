import type { RevisedMovement } from "../finance-revisions/projection";
import type { FinanceDashboard, FinanceMovement } from "./dashboard";
import type { FinanceTransaction } from "./model";

export type FinanceView = {
  tab: "overview" | "movements" | "receivables" | "sources";
  period: "month" | "previous" | "year" | "custom" | "all";
  from: string;
  to: string;
  /** "" = tutti; __unallocated = senza conto; __allocated = drilldown dei conti attribuiti. */
  account: string;
  query: string;
  direction: "all" | "income" | "expense" | "transfer";
  category: string;
  state: "posted" | "all" | "pending" | "future" | "unallocated" | "edited" | "deleted";
  source: "" | FinanceMovement["source"];
  batchId: string;
  movementId: string | null;
  newEntry: "income" | "expense" | null;
};

export type FinanceFlowBucket = {
  key: string;
  label: string;
  from: string;
  to: string;
  incoming: bigint;
  outgoing: bigint;
  closing: bigint | null;
  /** Righe attribuite consuntive, compresi i trasferimenti una sola volta. */
  count: number;
};

export type FinanceSummary = {
  closing: bigint | null;
  asOf: string;
  incoming: bigint;
  outgoing: bigint;
  net: bigint;
  /** Righe attribuite consuntive, compresi i trasferimenti una sola volta. */
  count: number;
  /** Consuntivi senza conto nel periodo, indipendenti dal conto selezionato. */
  unallocatedCount: number;
  buckets: FinanceFlowBucket[];
  expenses: { category: string; cents: bigint; count: number }[];
};

const SOURCES = [
  "",
  "budgetflow",
  "manual",
  "payment",
  "refund",
  "consignment",
  "shop_payment",
] as const;
const firstDay = "0001-01-01";
const lastDay = "9999-12-31";
const dayMilliseconds = 86_400_000;

function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < firstDay) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function monthEnd(value: string): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return `${value.slice(0, 7)}-${days[month - 1]}`;
}

function addDays(value: string, days: number): string {
  return new Date(new Date(`${value}T00:00:00Z`).getTime() + days * dayMilliseconds)
    .toISOString()
    .slice(0, 10);
}

function distance(from: string, to: string): number {
  return (
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
    dayMilliseconds
  );
}

function choice<T extends string>(value: string, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/** URL state is presentation only: no source record is changed by parsing it. */
export function parseFinanceView(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  today: string,
): FinanceView {
  if (!calendarDate(today)) throw new Error("Data del riepilogo non valida.");
  const get = (name: string) => {
    const value = params instanceof URLSearchParams ? params.get(name) : params[name];
    const raw = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
    return name === "q" ? raw : raw.trim();
  };
  let period = choice(
    get("periodo"),
    ["month", "previous", "year", "custom", "all"] as const,
    "month",
  );
  let from = `${today.slice(0, 7)}-01`;
  let to = monthEnd(today);
  if (period === "custom") {
    const customFrom = get("dal");
    const customTo = get("al");
    if (calendarDate(customFrom) && calendarDate(customTo) && customFrom <= customTo) {
      from = customFrom;
      to = customTo;
    } else period = "month";
  } else if (period === "previous") {
    to = addDays(from, -1);
    // At the supported calendar boundary there is no previous month.
    if (!calendarDate(to)) {
      period = "month";
      to = monthEnd(today);
    } else from = `${to.slice(0, 7)}-01`;
  } else if (period === "year") {
    from = `${today.slice(0, 4)}-01-01`;
    to = `${today.slice(0, 4)}-12-31`;
  } else if (period === "all") {
    from = firstDay;
    to = lastDay;
  }
  return {
    tab: choice(
      get("vista"),
      ["overview", "movements", "receivables", "sources"] as const,
      "overview",
    ),
    period,
    from,
    to,
    account: get("conto"),
    query: get("q"),
    direction: choice(get("tipo"), ["all", "income", "expense", "transfer"] as const, "all"),
    category: get("categoria"),
    state: choice(
      get("stato"),
      ["posted", "all", "pending", "future", "unallocated", "edited", "deleted"] as const,
      "posted",
    ),
    source: choice(get("fonte"), SOURCES, ""),
    batchId: get("lotto"),
    movementId: get("movimento") || null,
    newEntry: choice(get("nuovo"), ["", "income", "expense"] as const, "") || null,
  };
}

/** Stable ordering and explicit period bounds make links shareable and reproducible. */
export function financeViewHref(view: FinanceView): string {
  const params = new URLSearchParams({
    vista: view.tab,
    periodo: view.period,
    dal: view.from,
    al: view.to,
  });
  const optional: [string, string | null][] = [
    ["conto", view.account],
    ["q", view.query],
    ["tipo", view.direction === "all" ? "" : view.direction],
    ["categoria", view.category],
    ["stato", view.state],
    ["fonte", view.source],
    ["lotto", view.batchId],
    ["movimento", view.movementId],
    ["nuovo", view.newEntry],
  ];
  for (const [name, value] of optional)
    if (value && (name === "q" || value.trim()))
      params.set(name, name === "q" ? value : value.trim());
  return `/finance?${params.toString()}`;
}

function normalizedText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("it-IT")
    .replace(/\s+/g, " ")
    .trim();
}

/** An unsigned query matches either direction; an explicit sign remains meaningful. */
function amountQuery(query: string): { cents: bigint; signed: boolean } | null {
  const compact = query.replace(/\s/g, "").replace(/−/g, "-").replace(/^€|€$/g, "");
  const match = /^([+-]?)([\d.,]+)$/.exec(compact);
  if (!match) return null;
  const value = match[2];
  let whole: string;
  let fraction = "";
  if (value.includes(",")) {
    const pieces = value.split(",");
    if (
      pieces.length !== 2 ||
      !/^\d{1,2}$/.test(pieces[1]) ||
      !/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(pieces[0])
    )
      return null;
    whole = pieces[0].replace(/\./g, "");
    fraction = pieces[1];
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(value)) {
    whole = value.replace(/\./g, "");
  } else {
    const decimal = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
    if (!decimal) return null;
    whole = decimal[1];
    fraction = decimal[2] ?? "";
  }
  const unsigned = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return { cents: match[1] === "-" ? -unsigned : unsigned, signed: match[1] !== "" };
}

const isPosted = (row: RevisedMovement<FinanceMovement>) => !row.pending && !row.future;
const isUnallocated = (row: FinanceMovement) => !row.account?.trim();
const matchesAccount = (row: FinanceMovement, account: string) =>
  !account ||
  (account === "__unallocated"
    ? isUnallocated(row)
    : account === "__allocated"
      ? !isUnallocated(row)
      : row.account === account || (row.transfer && row.targetAccount === account));

/** The register keeps source ordering; filters never sort or mutate the supplied ledger. */
export function filterFinanceMovements(
  rows: readonly RevisedMovement<FinanceMovement>[],
  view: FinanceView,
  options: {
    originalById?: ReadonlyMap<string, FinanceTransaction>;
    deletedIds?: ReadonlySet<string>;
  } = {},
): RevisedMovement<FinanceMovement>[] {
  const query = normalizedText(view.query);
  const amount = amountQuery(view.query);
  return rows.filter((row) => {
    if (row.date < view.from || row.date > view.to || !matchesAccount(row, view.account))
      return false;
    const deleted = (row.revision?.deleted ?? false) || options.deletedIds?.has(row.id) === true;
    if (view.state === "deleted" ? !deleted : deleted) return false;
    if (view.state === "posted" && !isPosted(row)) return false;
    if (view.state === "pending" && !row.pending) return false;
    if (view.state === "future" && (!row.future || row.pending)) return false;
    if (view.state === "unallocated" && (!isUnallocated(row) || !isPosted(row))) return false;
    if (view.state === "edited" && !(row.revision && row.revision.version > 0)) return false;
    if (view.direction === "transfer" && !row.transfer) return false;
    if (view.direction === "income" && (row.transfer || row.cents <= 0n)) return false;
    if (view.direction === "expense" && (row.transfer || row.cents >= 0n)) return false;
    if (view.category && (row.category || "Senza categoria") !== view.category) return false;
    if (view.source && row.source !== view.source) return false;
    if (view.batchId) {
      const original =
        row.source === "budgetflow"
          ? (options.originalById?.get(row.sourceId) ?? options.originalById?.get(row.id))
          : undefined;
      if (!original || original.batchId !== view.batchId) return false;
    }
    if (!query) return true;
    if (
      normalizedText(
        [row.description, row.category, row.account, row.targetAccount].filter(Boolean).join(" "),
      ).includes(query)
    )
      return true;
    return (
      amount !== null &&
      (amount.signed
        ? row.cents === amount.cents
        : (row.cents < 0n ? -row.cents : row.cents) === amount.cents)
    );
  });
}

function accountCents(row: FinanceMovement, account: string): bigint {
  if (isUnallocated(row) || account === "__unallocated") return 0n;
  return (
    (!account || row.account === account ? row.cents : 0n) +
    (row.transfer && row.targetAccount && (!account || row.targetAccount === account)
      ? -row.cents
      : 0n)
  );
}

function bucketRanges(
  from: string,
  to: string,
): Pick<FinanceFlowBucket, "key" | "label" | "from" | "to">[] {
  const weekly = distance(from, to) < 62;
  const ranges: Pick<FinanceFlowBucket, "key" | "label" | "from" | "to">[] = [];
  const monthCount =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    Number(to.slice(5, 7)) -
    Number(from.slice(5, 7)) +
    1;
  const monthsPerBucket = Math.max(1, Math.ceil(monthCount / 120));
  const intervalEnd = (start: string) => {
    const lastMonth = Math.min(
      9999 * 12 + 11,
      Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1 + monthsPerBucket - 1,
    );
    return monthEnd(
      `${String(Math.floor(lastMonth / 12)).padStart(4, "0")}-${String((lastMonth % 12) + 1).padStart(2, "0")}-01`,
    );
  };
  let start = from;
  while (start <= to) {
    const end = weekly
      ? distance(start, to) < 6
        ? to
        : addDays(start, 6)
      : intervalEnd(start) < to
        ? intervalEnd(start)
        : to;
    const label = weekly
      ? `${Number(start.slice(8, 10))}–${Number(end.slice(8, 10))} ${new Intl.DateTimeFormat("it-IT", { month: "short", timeZone: "UTC" }).format(new Date(`${end}T00:00:00Z`))}`
      : new Intl.DateTimeFormat("it-IT", {
          month: "long",
          ...(from.slice(0, 4) !== to.slice(0, 4) ? { year: "numeric" } : {}),
          timeZone: "UTC",
        }).format(new Date(`${start}T00:00:00Z`));
    const intervalLabel =
      monthsPerBucket > 1
        ? `${label} – ${new Intl.DateTimeFormat("it-IT", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${end}T00:00:00Z`))}`
        : label;
    ranges.push({ key: `${start}:${end}`, label: intervalLabel, from: start, to: end });
    if (end === to) break;
    start = addDays(end, 1);
  }
  return ranges;
}

/**
 * Overview reads only period/account. Register search, selection and state cannot
 * change the totals. The closing balance carries all prior posted movements.
 */
export function financeWorkspaceSummary(
  dashboard: FinanceDashboard,
  view: FinanceView,
): FinanceSummary {
  const selectedAccount = view.account === "__allocated" ? "" : view.account;
  const asOf = view.to < dashboard.reportDate ? view.to : dashboard.reportDate;
  const active = (dashboard.movements as RevisedMovement<FinanceMovement>[]).filter(
    (row) => !row.revision?.deleted,
  );
  const posted = active.filter((row) => isPosted(row) && row.date <= asOf);
  const hasAccount =
    selectedAccount !== "__unallocated" &&
    dashboard.accounts.some((account) => !selectedAccount || account.name === selectedAccount);
  const selected = posted.filter(
    (row) => !isUnallocated(row) && matchesAccount(row, selectedAccount),
  );
  const closingAt = (to: string) =>
    hasAccount
      ? selected.reduce(
          (sum, row) => (row.date <= to ? sum + accountCents(row, selectedAccount) : sum),
          0n,
        )
      : null;
  const periodRows = selected.filter((row) => row.date >= view.from && row.date <= view.to);
  let incoming = 0n;
  let outgoing = 0n;
  const expenses = new Map<string, { category: string; cents: bigint; count: number }>();
  for (const row of periodRows) {
    if (row.transfer) continue;
    if (row.cents > 0n) incoming += row.cents;
    else if (row.cents < 0n) {
      outgoing -= row.cents;
      const category = row.category || "Senza categoria";
      const total = expenses.get(category) ?? { category, cents: 0n, count: 0 };
      total.cents -= row.cents;
      total.count++;
      expenses.set(category, total);
    }
  }
  // “All” must search every date, but should not draw 10,000 empty calendar years.
  const graphFrom =
    view.period === "all" || view.from === firstDay
      ? active.reduce(
          (earliest, row) => (row.date < earliest && row.date <= asOf ? row.date : earliest),
          asOf,
        )
      : view.from;
  const graphTo = view.period === "all" || view.to === lastDay ? asOf : view.to;
  const buckets = bucketRanges(graphFrom, graphTo).map((range): FinanceFlowBucket => {
    let bucketIncoming = 0n;
    let bucketOutgoing = 0n;
    let count = 0;
    for (const row of periodRows) {
      if (row.date < range.from || row.date > range.to) continue;
      count++;
      if (!row.transfer) {
        if (row.cents > 0n) bucketIncoming += row.cents;
        else bucketOutgoing -= row.cents;
      }
    }
    return {
      ...range,
      incoming: bucketIncoming,
      outgoing: bucketOutgoing,
      closing: range.from > asOf ? null : closingAt(range.to < asOf ? range.to : asOf),
      count,
    };
  });
  return {
    closing: closingAt(asOf),
    asOf,
    incoming,
    outgoing,
    net: incoming - outgoing,
    count: periodRows.length,
    unallocatedCount: posted.filter(
      (row) => isUnallocated(row) && row.date >= view.from && row.date <= view.to,
    ).length,
    buckets,
    expenses: [...expenses.values()].sort((a, b) =>
      a.cents === b.cents ? a.category.localeCompare(b.category, "it") : a.cents > b.cents ? -1 : 1,
    ),
  };
}
