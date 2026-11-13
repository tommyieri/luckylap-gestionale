import { shopCode } from "../consignment/links";
import { MAX_CENTS } from "../consignment/model";
import { calendarDay } from "../consignment/shop-model";
import { stockRecord, stockUuid } from "../stock/model";
import type { FinanceMovement } from "./dashboard";
import { financeDocumentFromDatabase, type FinanceDocument } from "./documents";

type ArchiveSaleLine = {
  model: string;
  size: string;
  quantity: number;
  unitCents: number;
  grossCents: number;
  brandCents: number;
};

export type ConsignmentArchiveRow = {
  id: string;
  code: string;
  shopName: string;
  periodStart: string;
  periodStartMonthOnly: boolean;
  periodEnd: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoice: FinanceDocument;
  statement: FinanceDocument;
  paymentTransactionId: string;
  paymentReferenceMismatch: boolean;
  paymentExpectedAtCapture: boolean;
  paymentSourceDate: string;
  paymentSourceNote: string;
  pieces: number;
  grossCents: number;
  brandCents: number;
  lines: ArchiveSaleLine[];
};

export type ConsignmentArchive = ConsignmentArchiveRow[];

function fail(): never {
  throw new Error("Archivio conto vendita non disponibile.");
}

function integer(value: unknown, min: number, max = MAX_CENTS): number {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < min || number > max)
    fail();
  return number;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail();
  return value;
}

function saleLineFromDatabase(value: unknown): ArchiveSaleLine {
  const row = stockRecord(value) ?? fail();
  const quantity = integer(row.quantity, 1, 2_147_483_647);
  const unitCents = integer(row.unit_cents, 1);
  const grossCents = integer(row.gross_cents, 1);
  if (BigInt(quantity) * BigInt(unitCents) !== BigInt(grossCents)) fail();
  return {
    model: text(row.model, 240),
    size: text(row.size, 30),
    quantity,
    unitCents,
    grossCents,
    brandCents: integer(row.brand_cents, 0, grossCents),
  };
}

export function consignmentArchiveFromRows(raw: unknown[]): ConsignmentArchive {
  const rows = raw.map((value): ConsignmentArchiveRow => {
    const row = stockRecord(value) ?? fail();
    const shop = stockRecord(row.shop) ?? fail();
    const code = shopCode(shop.code) ?? fail();
    const invoice = financeDocumentFromDatabase(row.invoice);
    const statement = financeDocumentFromDatabase(row.statement);
    const payment = stockRecord(row.payment);
    if (
      !stockUuid(row.id) ||
      !stockUuid(row.payment_transaction_id) ||
      typeof row.payment_reference_mismatch !== "boolean" ||
      typeof row.payment_expected_at_capture !== "boolean" ||
      !calendarDay(row.period_start) ||
      typeof row.period_start_month_only !== "boolean" ||
      !calendarDay(row.period_end) ||
      !calendarDay(row.invoice_date) ||
      row.period_start > row.period_end ||
      row.period_end > row.invoice_date ||
      (row.period_start_month_only && !row.period_start.endsWith("-01")) ||
      invoice?.kind !== "consignment_invoice" ||
      statement?.kind !== "consignment_statement" ||
      !payment ||
      payment.id !== row.payment_transaction_id ||
      !calendarDay(payment.transaction_date) ||
      !Array.isArray(row.sale_lines) ||
      !row.sale_lines.length ||
      row.sale_lines.length > 500
    )
      fail();

    const pieces = integer(row.pieces, 1, 2_147_483_647);
    const grossCents = integer(row.gross_cents, 1);
    const brandCents = integer(row.brand_cents, 1, grossCents);
    const lines = row.sale_lines.map(saleLineFromDatabase);
    const total = (field: "quantity" | "grossCents" | "brandCents") =>
      lines.reduce((sum, line) => sum + BigInt(line[field]), 0n);
    if (
      total("quantity") !== BigInt(pieces) ||
      total("grossCents") !== BigInt(grossCents) ||
      total("brandCents") !== BigInt(brandCents)
    )
      fail();

    const paymentSourceNote = payment.note;
    if (typeof paymentSourceNote !== "string") fail();

    return {
      id: row.id,
      code,
      shopName: text(shop.name, 240),
      periodStart: row.period_start,
      periodStartMonthOnly: row.period_start_month_only,
      periodEnd: row.period_end,
      invoiceNumber: text(row.invoice_number, 60),
      invoiceDate: row.invoice_date,
      invoice,
      statement,
      paymentTransactionId: row.payment_transaction_id,
      paymentReferenceMismatch: row.payment_reference_mismatch,
      paymentExpectedAtCapture: row.payment_expected_at_capture,
      paymentSourceDate: payment.transaction_date,
      paymentSourceNote,
      pieces,
      grossCents,
      brandCents,
      lines,
    };
  });
  if (new Set(rows.map((row) => row.id)).size !== rows.length) fail();
  return rows.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.id.localeCompare(b.id));
}

export function archivedConsignmentReceipt(
  row: ConsignmentArchiveRow,
  movement: FinanceMovement | undefined,
) {
  const owed = BigInt(row.brandCents);
  const invalidPayment = movement && (movement.transfer || movement.cents <= 0n);
  const paid =
    movement && !movement.pending && !movement.future && !invalidPayment ? movement.cents : 0n;
  const remaining = owed > paid ? owed - paid : 0n;
  const excess = paid > owed ? paid - owed : 0n;
  const status = invalidPayment
    ? "Pagamento da verificare"
    : excess > 0n
      ? "Incassato in eccesso"
      : paid === owed
        ? "Incassata"
        : paid > 0n
          ? "Incassata in parte"
          : movement?.future
            ? "Incasso previsto"
            : movement?.pending
              ? row.paymentExpectedAtCapture
                ? "Incasso da confermare"
                : "Incasso in sospeso"
              : "Da incassare";
  return { paid, remaining, excess, status };
}
