import { describe, expect, it } from "vitest";
import { financeBatchFromDatabase, financeTransactionFromDatabase, formatEuroAmount, localReportDate, transactionTiming } from "./model";

const batch = { id: "10000000-0000-4000-8000-000000000001", source_system: "budgetflow", source_file_name: "example.csv", extracted_at: "2026-10-21T12:00:00Z", reference_date: "2026-10-21", source_row_count: 1, review_status: "unreviewed", imported_at: "2026-10-21T12:10:00Z" };
const row = { id: "20000000-0000-4000-8000-000000000001", batch_id: batch.id, source_row: 2, source_timestamp: "2026-10-21T23:30:00Z", occurred_at: "2026-10-21T23:30:00Z", transaction_date: "2026-10-21", amount_text: "-1234567.8", amount_cents: -123456780, currency: "EUR", account_label: "Conto di prova", target_account_label: null, pending: false, review_status: "unreviewed", raw_record: { Category: "Prova", Payee: "", Folder: "", Tags: "", Notes: "prima riga\nseconda riga" } };

describe("Finance source display", () => {
  it("uses today's Rome calendar date, including the day crossing from UTC", () => {
    expect(localReportDate(new Date("2026-10-21T23:30:00Z"))).toBe("2026-10-22");
    expect(localReportDate(new Date("invalid"))).toBeNull();
  });
  it("preserves the source calendar day for future checks and keeps pending independent", () => {
    // The timestamp is 22/10 in Rome, but BudgetFlow explicitly records 21/10.
    expect(transactionTiming(row.transaction_date, false, "2026-10-21")).toEqual({ future: false, pending: false });
    expect(transactionTiming("2026-10-23", true, "2026-10-22")).toEqual({ future: true, pending: true });
    expect(transactionTiming(row.transaction_date, true, "2026-10-22")).toEqual({ future: false, pending: true });
    expect(transactionTiming("invalid", false, "2026-10-21")).toBeNull();
    expect(transactionTiming(row.transaction_date, false, "2026-02-31")).toBeNull();
  });
  it("preserves exact source amounts without binary floating point rounding", () => {
    expect(formatEuroAmount("-1234567.8")).toBe("−1.234.567,80 €");
    expect(formatEuroAmount("90000000000000.00")).toBe("90.000.000.000.000,00 €");
    expect(formatEuroAmount("+0.01")).toBe("+0,01 €");
    for (const invalid of [null, 1.23, "", "1,23", "NaN", "1.234", "9e3"]) expect(formatEuroAmount(invalid)).toBeNull();
  });
  it("validates amounts against cents and preserves multiline notes", () => {
    const normalized = financeTransactionFromDatabase(row);
    expect(normalized?.notes).toBe("prima riga\nseconda riga");
    expect(normalized?.sourceAmount).toBe(row.amount_text);
    expect(financeTransactionFromDatabase({ ...row, amount_cents: -123456781 })).toBeNull();
    expect(financeTransactionFromDatabase({ ...row, amount_cents: null })).toBeNull();
    expect(financeTransactionFromDatabase({ ...row, pending: "False" })).toBeNull();
    expect(financeTransactionFromDatabase({ ...row, raw_record: null })).toBeNull();
    expect(financeTransactionFromDatabase({ ...row, occurred_at: "2026-02-31T10:00:00Z" })).toBeNull();
  });
  it("fails closed on invalid batches and unsupported review status", () => {
    expect(financeBatchFromDatabase(batch)?.sourceRowCount).toBe(1);
    expect(financeBatchFromDatabase(null)).toBeNull();
    expect(financeBatchFromDatabase({ ...batch, source_row_count: null })).toBeNull();
    expect(financeBatchFromDatabase({ ...batch, review_status: "approved" })).toBeNull();
    expect(financeTransactionFromDatabase({ ...row, review_status: "approved" })).toBeNull();
  });
});
