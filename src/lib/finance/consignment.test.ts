import { describe, expect, it } from "vitest";
import { archivedConsignmentReceipt, consignmentArchiveFromRows } from "./consignment";
import type { FinanceMovement } from "./dashboard";

const uuid = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const document = (index: number, role: "invoice" | "statement") => ({
  id: uuid(index),
  source_kind: `consignment_${role}`,
  file_name: `${role}.pdf`,
  storage_path: `sources/${"a".repeat(64)}/${role}.pdf`,
  sha256: "a".repeat(64),
  byte_size: 400,
  content_type: "application/pdf",
  review_status: "unreviewed",
});

const raw = {
  id: uuid(1),
  shop: { code: "SHOP", name: "Negozio demo" },
  period_start: "2028-01-01",
  period_start_month_only: true,
  period_end: "2028-02-05",
  invoice_date: "2028-02-08",
  invoice_number: "2",
  invoice: document(2, "invoice"),
  statement: document(3, "statement"),
  payment_transaction_id: uuid(4),
  payment_reference_mismatch: true,
  payment_expected_at_capture: true,
  payment: { id: uuid(4), transaction_date: "2028-02-20", note: "Fattura dimostrativa" },
  pieces: 2,
  gross_cents: "8000",
  brand_cents: "4800",
  sale_lines: [
    {
      model: "Modello demo",
      size: "L",
      quantity: 2,
      unit_cents: 4000,
      gross_cents: 8000,
      brand_cents: 4800,
    },
  ],
};

const movement: FinanceMovement = {
  id: `budgetflow:${uuid(4)}`,
  source: "budgetflow",
  sourceId: uuid(4),
  date: "2028-02-20",
  cents: 4800n,
  account: "Conto demo",
  targetAccount: null,
  category: "Vendite",
  description: "Movimento demo",
  pending: true,
  future: true,
  transfer: false,
  allocationNote: null,
};

describe("storico del conto vendita", () => {
  it("conserva il periodo originale e rifiuta importi o metadati incoerenti", () => {
    const [row] = consignmentArchiveFromRows([raw]);
    expect(row).toMatchObject({
      periodStart: "2028-01-01",
      periodStartMonthOnly: true,
      periodEnd: "2028-02-05",
      brandCents: 4800,
    });
    expect(() => consignmentArchiveFromRows([{ ...raw, brand_cents: "4799" }])).toThrow();
    expect(() => consignmentArchiveFromRows([{ ...raw, invoice: raw.statement }])).toThrow();
  });

  it("segue la revisione del pagamento, distinguendo previsto, in sospeso e incassato", () => {
    const [row] = consignmentArchiveFromRows([raw]);
    expect(archivedConsignmentReceipt(row, movement)).toMatchObject({
      paid: 0n,
      remaining: 4800n,
      status: "Incasso previsto",
    });
    expect(archivedConsignmentReceipt(row, { ...movement, future: false })).toMatchObject({
      paid: 0n,
      remaining: 4800n,
      status: "Incasso da confermare",
    });
    expect(
      archivedConsignmentReceipt(row, { ...movement, future: false, pending: false }),
    ).toMatchObject({ paid: 4800n, remaining: 0n, status: "Incassata" });
    expect(
      archivedConsignmentReceipt(row, { ...movement, future: false, pending: false, cents: 2800n }),
    ).toMatchObject({ paid: 2800n, remaining: 2000n, status: "Incassata in parte" });
    expect(archivedConsignmentReceipt(row, undefined)).toMatchObject({
      paid: 0n,
      remaining: 4800n,
      status: "Da incassare",
    });
  });
});
