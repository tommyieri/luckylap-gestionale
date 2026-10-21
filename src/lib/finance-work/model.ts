import { formatEuroAmount, localReportDate } from "../finance/model";
import { euroCents, isUuid, record, safeInteger } from "../sales/model";

export type FinanceWorkKind = "record_finance_entry" | "void_finance_entry";
export type FinanceWorkCommand = { operationId: string; kind: FinanceWorkKind; payload: Record<string, unknown>; retry?: boolean };
export type FinanceWorkResult = { status: "success"; entryId: string; replayed: boolean; message: string } | { status: "rejected"; code: string; message: string } | { status: "uncertain"; message: string };
export type ManualEntry = { id: string; date: string; type: "income" | "expense"; cents: number; description: string; account: string | null; category: string | null; source: "manual_declaration" | "legacy_unclassified"; createdAt: string; createdBy: string; void: FinanceVoid | null };
export type FinanceVoid = { id: string; entryId: string; reason: string; createdAt: string; createdBy: string };
export type SalesFact = { id: string; orderId: string; paymentId: string | null; kind: "sale_observed" | "payment_reported" | "sale_cancellation_observed"; cents: number; occurredAt: string; reviewStatus: string };
export type DeclaredPayment = { id: string; orderId: string; cents: number; method: string; occurredAt: string; reference: string | null };
export type FinanceOrder = { id: string; channel: string; reference: string | null; totalCents: number; cancelledCents: number; refundDueCents: number };
export type FinanceWorkSnapshot = { entries: ManualEntry[]; facts: SalesFact[]; payments: DeclaredPayment[]; orders: FinanceOrder[] };

export function centsLabel(value: number) {
  const n = BigInt(value), sign = n < 0n ? "-" : "", abs = n < 0n ? -n : n;
  return formatEuroAmount(`${sign}${abs / 100n}.${String(abs % 100n).padStart(2,"0")}`) ?? "Da verificare";
}
export function calendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
const keys = (v: Record<string, unknown>, required: string[], allowed = required) => required.every(key => key in v) && Object.keys(v).every(key => allowed.includes(key));
const text = (v: unknown, min: number, max: number) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
export function parseFinanceWorkCommand(value: unknown, now = new Date()): FinanceWorkCommand | null {
  const c = record(value), p = record(c?.payload);
  if (!c || !p || !isUuid(c.operationId) || !keys(c,["operationId","kind","payload"],["operationId","kind","payload","retry"]) || (c.retry !== undefined && typeof c.retry !== "boolean")) return null;
  if (c.kind === "record_finance_entry") {
    if (!keys(p,["schema_version","entry_date","entry_type","amount_cents","description","not_duplicate_confirmed"],["schema_version","entry_date","entry_type","amount_cents","description","not_duplicate_confirmed","account_label","category"]) || p.schema_version !== 1 || !calendarDay(p.entry_date) || p.entry_date > (localReportDate(now) ?? "") || (p.entry_type !== "income" && p.entry_type !== "expense") || !safeInteger(p.amount_cents,1,99999999999999) || !text(p.description,3,2000) || p.not_duplicate_confirmed !== true) return null;
    for (const key of ["account_label","category"]) if (p[key] !== undefined && p[key] !== null && !text(p[key],1,120)) return null;
  } else if (c.kind === "void_finance_entry") {
    if (!keys(p,["schema_version","entry_id","reason"]) || p.schema_version !== 1 || !isUuid(p.entry_id) || !text(p.reason,3,500)) return null;
  } else return null;
  return { operationId: c.operationId, kind: c.kind, payload: p, retry: c.retry === true };
}
export function financeEntryForm(form: FormData): Record<string, unknown> {
  const string = (key: string) => typeof form.get(key) === "string" ? (form.get(key) as string).trim() : "";
  const amount = euroCents(string("amount"),99999999999999);
  if (!amount) throw new Error("Inserisci un importo positivo in euro, con massimo due decimali e senza separatori delle migliaia.");
  if (!calendarDay(string("date"))) throw new Error("Scegli una data valida.");
  if (string("date") > (localReportDate(new Date()) ?? "")) throw new Error("Questa voce ha una data futura: usa il calendario per un promemoria e registrala quando avviene.");
  const account = string("account"), category = string("category");
  const payload = { schema_version: 1, entry_date: string("date"), entry_type: string("type"), amount_cents: amount, description: string("description"), not_duplicate_confirmed: form.get("confirmed") === "on", ...(account ? { account_label: account } : {}), ...(category ? { category } : {}) };
  if (!parseFinanceWorkCommand({operationId:"00000000-0000-4000-8000-000000000000",kind:"record_finance_entry",payload})) throw new Error("Controlla descrizione e categoria, poi conferma di aver verificato che la voce non sia già presente nelle altre fonti.");
  return payload;
}
