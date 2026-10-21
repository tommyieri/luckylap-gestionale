export type FinanceBatch = {
  id: string;
  sourceFileName: string;
  extractedAt: string;
  referenceDate: string;
  sourceRowCount: number;
  importedAt: string;
};
export type FinanceTransaction = {
  id: string;
  batchId: string;
  sourceRow: number;
  occurredAt: string;
  sourceDate: string;
  sourceTimestamp: string;
  sourceAmount: string;
  formattedAmount: string;
  account: string;
  targetAccount: string | null;
  category: string;
  payee: string;
  folder: string;
  tags: string;
  notes: string;
  pending: boolean;
};
export type FinanceSnapshot = { batches: FinanceBatch[]; transactions: FinanceTransaction[] };

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return false;
  return isCalendarDate(value.slice(0, 10)) && Number.isFinite(new Date(value).getTime());
}
function amountParts(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const fraction = (match[3] ?? "").padEnd(2, "0");
  const unsignedCents = BigInt(match[2]) * 100n + BigInt(fraction);
  if (unsignedCents > 9000000000000000n) return null;
  return { sign: match[1], whole: BigInt(match[2]).toString(), fraction, cents: match[1] === "-" ? -unsignedCents : unsignedCents };
}

/** Formats the exact source decimal string; never rounds through Number. */
export function formatEuroAmount(value: unknown): string | null {
  const parts = amountParts(value);
  if (!parts) return null;
  const whole = parts.whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${parts.sign === "-" ? "−" : parts.sign}${whole},${parts.fraction} €`;
}

/** The report day uses Europe/Rome, independently of the server timezone. */
export function localReportDate(now: Date): string | null {
  if (!Number.isFinite(now.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}-${parts.find(part => part.type === "day")!.value}`;
}
/** BudgetFlow's explicit local calendar day is authoritative; never shift it through another timezone. */
export function transactionTiming(sourceDate: unknown, pending: boolean, reportDate: string): { future: boolean; pending: boolean } | null {
  if (!isCalendarDate(sourceDate) || !isCalendarDate(reportDate) || typeof pending !== "boolean") return null;
  return { future: sourceDate > reportDate, pending };
}
export function formatLocalTimestamp(value: string): string {
  if (!timestamp(value)) return "Data non disponibile";
  return new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
export function formatCalendarDate(value: string): string {
  return isCalendarDate(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : "Data non disponibile";
}

export function financeBatchFromDatabase(value: unknown): FinanceBatch | null {
  const row = record(value);
  if (!row || !uuid(row.id) || row.source_system !== "budgetflow" || !text(row.source_file_name, 240) || !timestamp(row.extracted_at) || !timestamp(row.imported_at) || !isCalendarDate(row.reference_date) || !Number.isInteger(row.source_row_count) || (row.source_row_count as number) < 1 || (row.source_row_count as number) > 100000 || row.review_status !== "unreviewed") return null;
  return { id: row.id, sourceFileName: row.source_file_name, extractedAt: row.extracted_at, referenceDate: row.reference_date, sourceRowCount: row.source_row_count as number, importedAt: row.imported_at };
}
export function financeTransactionFromDatabase(value: unknown): FinanceTransaction | null {
  const row = record(value);
  if (!row || !uuid(row.id) || !uuid(row.batch_id) || !Number.isInteger(row.source_row) || (row.source_row as number) < 2 || (row.source_row as number) > 100001 || !timestamp(row.occurred_at) || !timestamp(row.source_timestamp) || !isCalendarDate(row.transaction_date) || row.source_timestamp.slice(0, 10) !== row.transaction_date || new Date(row.source_timestamp).getTime() !== new Date(row.occurred_at).getTime() || row.currency !== "EUR" || !text(row.account_label, 240) || !(row.target_account_label === null || text(row.target_account_label, 240)) || typeof row.pending !== "boolean" || row.review_status !== "unreviewed") return null;
  const parts = amountParts(row.amount_text);
  const storedCents = typeof row.amount_cents === "string" && /^-?\d+$/.test(row.amount_cents) ? BigInt(row.amount_cents) : typeof row.amount_cents === "number" && Number.isSafeInteger(row.amount_cents) ? BigInt(row.amount_cents) : null;
  const raw = record(row.raw_record);
  if (!parts || storedCents === null || parts.cents !== storedCents || !raw || ["Category", "Payee", "Folder", "Tags", "Notes"].some(key => typeof raw[key] !== "string")) return null;
  const formattedAmount = formatEuroAmount(row.amount_text);
  if (!formattedAmount) return null;
  return { id: row.id, batchId: row.batch_id, sourceRow: row.source_row as number, occurredAt: row.occurred_at, sourceDate: row.transaction_date, sourceTimestamp: row.source_timestamp, sourceAmount: row.amount_text as string, formattedAmount, account: row.account_label, targetAccount: row.target_account_label, category: raw.Category as string, payee: raw.Payee as string, folder: raw.Folder as string, tags: raw.Tags as string, notes: raw.Notes as string, pending: row.pending };
}
