import { formatEuroAmount, localReportDate } from "../finance/model";
import { euroCents, isUuid, record, safeInteger } from "../sales/model";
import type { CanonicalShopifyOrder } from "../shopify/canonical-model";

export type FinanceWorkKind = "record_finance_entry" | "void_finance_entry";
export type FinanceWorkCommand = {
  operationId: string;
  kind: FinanceWorkKind;
  payload: Record<string, unknown>;
  retry?: boolean;
};
export type FinanceWorkResult =
  | { status: "success"; entryId: string; replayed: boolean; message: string }
  | { status: "rejected"; code: string; message: string }
  | { status: "uncertain"; message: string };
export type ManualEntry = {
  id: string;
  date: string;
  type: "income" | "expense";
  cents: number;
  description: string;
  account: string | null;
  category: string | null;
  targetAccount?: string | null;
  pending?: boolean;
  evaluateStatistics?: boolean;
  evaluateBudgets?: boolean;
  payee?: string | null;
  tags?: string[];
  notes?: string | null;
  location?: string | null;
  time?: string | null;
  source: "manual_declaration" | "legacy_unclassified";
  createdAt: string;
  createdBy: string;
  void: FinanceVoid | null;
};
export type FinanceVoid = {
  id: string;
  entryId: string;
  reason: string;
  createdAt: string;
  createdBy: string;
};
export type ObservationSource = "manual_declaration" | "shopify_observation";
export type SalesFact = {
  id: string;
  orderId: string;
  paymentId: string | null;
  refundId: string | null;
  source: ObservationSource;
  kind: "sale_observed" | "payment_reported" | "sale_cancellation_observed" | "refund_observed";
  cents: number;
  occurredAt: string;
  reviewStatus: string;
};
export type DeclaredPayment = {
  id: string;
  orderId: string;
  source: ObservationSource;
  cents: number;
  method: string;
  occurredAt: string;
  reference: string | null;
};
export type FinanceOrder = {
  id: string;
  source: "manual_declaration" | "shopify_canonical";
  channel: string;
  reference: string | null;
  totalCents: number;
  cancelledCents: number;
  refundDueCents: number;
};
export type ObservedRefund = {
  id: string;
  orderId: string;
  transactionGid: string;
  cents: number;
  occurredAt: string;
};
export type ShopifyFinancials = {
  orderId: string;
  sourceUpdatedAt: string;
  observedAt: string;
  taxesIncluded: boolean;
  totals: CanonicalShopifyOrder["totals"];
};
export type ShopifyTransactionObservation = {
  orderId: string;
  transactionGid: string;
  kind: string;
  status: string;
  cents: number;
  currency: "EUR";
  gateway: string | null;
  parentGid: string | null;
  processedAt: string | null;
  sourceUpdatedAt: string;
  observedAt: string;
};
export type FinanceWorkSnapshot = {
  entries: ManualEntry[];
  facts: SalesFact[];
  payments: DeclaredPayment[];
  orders: FinanceOrder[];
  refunds: ObservedRefund[];
  shopifyFinancials: ShopifyFinancials[];
  shopifyTransactions: ShopifyTransactionObservation[];
};

export function centsLabel(value: number) {
  const n = BigInt(value),
    sign = n < 0n ? "-" : "",
    abs = n < 0n ? -n : n;
  return (
    formatEuroAmount(`${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`) ??
    "Da verificare"
  );
}
export function calendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const keys = (v: Record<string, unknown>, required: string[], allowed = required) =>
  required.every((key) => key in v) && Object.keys(v).every((key) => allowed.includes(key));
const text = (v: unknown, min: number, max: number) =>
  typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
const timeValue = (value: unknown) =>
  typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const repeatOptions = ["weekly", "monthly", "yearly"] as const;
const recordRequired = [
  "schema_version",
  "entry_date",
  "entry_type",
  "amount_cents",
  "description",
  "not_duplicate_confirmed",
];
const recordFields = [...recordRequired, "account_label", "category"];
const planningFields = [
  "target_account_label",
  "pending",
  "evaluate_statistics",
  "evaluate_budgets",
  "payee",
  "tags",
  "notes",
  "location",
  "entry_time",
  "repeat_interval",
  "repeat_count",
];
export function parseFinanceWorkCommand(
  value: unknown,
  now = new Date(),
): FinanceWorkCommand | null {
  const c = record(value),
    p = record(c?.payload);
  if (
    !c ||
    !p ||
    !isUuid(c.operationId) ||
    !keys(c, ["operationId", "kind", "payload"], ["operationId", "kind", "payload", "retry"]) ||
    (c.retry !== undefined && typeof c.retry !== "boolean")
  )
    return null;
  if (c.kind === "record_finance_entry") {
    const planning = p.schema_version === 2;
    if (
      !keys(p, recordRequired, planning ? [...recordFields, ...planningFields] : recordFields) ||
      (!planning && p.schema_version !== 1) ||
      !calendarDay(p.entry_date) ||
      p.entry_date < "0001-01-01" ||
      (!planning && p.entry_date > (localReportDate(now) ?? "")) ||
      (p.entry_type !== "income" && p.entry_type !== "expense") ||
      !safeInteger(p.amount_cents, 1, 99999999999999) ||
      !text(p.description, 3, 2000) ||
      p.not_duplicate_confirmed !== true
    )
      return null;
    for (const key of ["account_label", "category"])
      if (p[key] !== undefined && p[key] !== null && !text(p[key], 1, 120)) return null;
    if (planning) {
      const target = p.target_account_label;
      if (
        target !== undefined &&
        target !== null &&
        (!text(target, 1, 120) ||
          !text(p.account_label, 1, 120) ||
          p.entry_type !== "expense" ||
          String(target).trim().toLowerCase() === String(p.account_label).trim().toLowerCase())
      )
        return null;
      for (const field of ["pending", "evaluate_statistics", "evaluate_budgets"])
        if (p[field] !== undefined && typeof p[field] !== "boolean") return null;
      for (const [field, limit] of [
        ["payee", 240],
        ["notes", 2000],
        ["location", 240],
      ] as const)
        if (p[field] !== undefined && p[field] !== null && !text(p[field], 1, limit)) return null;
      if (
        p.tags !== undefined &&
        (!Array.isArray(p.tags) || p.tags.length > 20 || !p.tags.every((tag) => text(tag, 1, 60)))
      )
        return null;
      if (p.entry_time !== undefined && p.entry_time !== null && !timeValue(p.entry_time))
        return null;
      if (
        p.repeat_interval === undefined
          ? p.repeat_count !== undefined
          : !(repeatOptions as readonly unknown[]).includes(p.repeat_interval) ||
            !safeInteger(p.repeat_count, 2, 60)
      )
        return null;
    }
  } else if (c.kind === "void_finance_entry") {
    if (
      !keys(p, ["schema_version", "entry_id", "reason"]) ||
      p.schema_version !== 1 ||
      !isUuid(p.entry_id) ||
      !text(p.reason, 3, 500)
    )
      return null;
  } else return null;
  return { operationId: c.operationId, kind: c.kind, payload: p, retry: c.retry === true };
}
export function financeEntryForm(form: FormData, planning = false): Record<string, unknown> {
  const string = (key: string) =>
    typeof form.get(key) === "string" ? (form.get(key) as string).trim() : "";
  const amount = euroCents(string("amount"), 99999999999999);
  if (!amount)
    throw new Error(
      "Inserisci un importo positivo in euro, con massimo due decimali e senza separatori delle migliaia.",
    );
  if (!calendarDay(string("date"))) throw new Error("Scegli una data valida.");
  if (!planning && string("date") > (localReportDate(new Date()) ?? ""))
    throw new Error(
      "Questa voce ha una data futura: usa il calendario per un promemoria e registrala quando avviene.",
    );
  const account = string("account"),
    category = string("category");
  const transfer = string("type") === "transfer";
  const payee = string("payee");
  const tags = [
    ...new Set(
      string("tags")
        .split(",")
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean),
    ),
  ];
  const payload = {
    schema_version: planning ? 2 : 1,
    entry_date: string("date"),
    entry_type: planning && transfer ? "expense" : string("type"),
    amount_cents: amount,
    description:
      string("description") || (planning ? payee || (transfer ? "Trasferimento" : category) : ""),
    not_duplicate_confirmed: form.get("confirmed") === "on",
    ...(account ? { account_label: account } : {}),
    ...(category && !transfer ? { category } : {}),
    ...(planning
      ? {
          ...(transfer ? { target_account_label: string("targetAccount") } : {}),
          pending: form.get("pending") === "on",
          evaluate_statistics: form.get("statistics") === "on",
          evaluate_budgets: form.get("budgets") === "on",
          ...(payee ? { payee } : {}),
          ...(tags.length ? { tags } : {}),
          ...(string("notes") ? { notes: string("notes") } : {}),
          ...(string("location") ? { location: string("location") } : {}),
          ...(string("time") ? { entry_time: string("time") } : {}),
          ...(string("repeat")
            ? { repeat_interval: string("repeat"), repeat_count: Number(string("repeatCount")) }
            : {}),
        }
      : {}),
  };
  if (
    !parseFinanceWorkCommand({
      operationId: "00000000-0000-4000-8000-000000000000",
      kind: "record_finance_entry",
      payload,
    })
  )
    throw new Error(
      "Controlla descrizione e categoria, poi conferma di aver verificato che la voce non sia già presente nelle altre fonti.",
    );
  return payload;
}
