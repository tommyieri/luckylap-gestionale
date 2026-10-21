import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/finance/model", () => import("../lib/finance/model"));
vi.mock("@/lib/finance/dashboard", () => import("../lib/finance/dashboard"));
vi.mock("@/lib/finance/categories", () => import("../lib/finance/categories"));
import { FinanceImportsView } from "./finance-imports-view";
import type { FinanceSnapshot } from "../lib/finance/model";
import type { FinanceWorkSnapshot } from "../lib/finance-work/model";

describe("Finance overview source separation", () => {
  it("renders account balances and a chart with exact accessible data, keeping future, pending and unallocated flows separate", () => {
    const snapshot: FinanceSnapshot = { batches: [], transactions: [
      { id: "synthetic-posted", batchId: "batch", sourceRow: 2, occurredAt: "2026-06-10T10:00:00Z", sourceDate: "2026-06-10", sourceTimestamp: "2026-06-10T10:00:00Z", sourceAmount: "12.34", formattedAmount: "12,34 €", account: "Revolut Business", targetAccount: null, category: "Vendite", payee: "Synthetic", folder: "", tags: "", notes: "", pending: false },
      { id: "synthetic-pending", batchId: "batch", sourceRow: 3, occurredAt: "2026-06-10T10:00:00Z", sourceDate: "2026-06-10", sourceTimestamp: "2026-06-10T10:00:00Z", sourceAmount: "-5.01", formattedAmount: "−5,01 €", account: "Revolut Business", targetAccount: null, category: "Software", payee: "Synthetic", folder: "", tags: "", notes: "", pending: true },
      { id: "synthetic-future", batchId: "batch", sourceRow: 4, occurredAt: "2026-07-10T10:00:00Z", sourceDate: "2026-07-10", sourceTimestamp: "2026-07-10T10:00:00Z", sourceAmount: "-7.01", formattedAmount: "−7,01 €", account: "Revolut Business", targetAccount: null, category: "Software", payee: "Synthetic", folder: "", tags: "", notes: "", pending: false },
    ] };
    const work: FinanceWorkSnapshot = { entries: [], facts: [], payments: [{ id: "bank", orderId: "order", source: "manual_declaration", cents: 2500, method: "bank_transfer", occurredAt: "2026-06-10T10:00:00Z", reference: null }], orders: [], refunds: [], shopifyFinancials: [], shopifyTransactions: [] };
    const html = renderToStaticMarkup(<FinanceImportsView snapshot={snapshot} workSnapshot={work} reportDate="2026-06-15" displayName="Synthetic" />);
    expect(html).toContain("12,34 €");
    expect(html).not.toContain("32,34 €");
    expect(html).toContain("Tabella dati del grafico · importi esatti");
    expect(html).toContain("Non consuntivo");
    expect(html).toContain("1 da attribuire");
    expect(html).toContain("1 pending");
    expect(html).toContain("1 futuri");
    expect(html).toContain("Collab"); expect(html).toContain("Stipendi"); expect(html).toContain("Eventi");
    expect(html).toContain("Importazioni e dichiarazioni restano da verificare");
    expect(html).not.toContain("password Finance");
    const multiple = { ...snapshot, batches: [1, 2].map(index => ({ id: `synthetic-batch-${index}`, sourceFileName: `synthetic-${index}.csv`, extractedAt: "2026-06-15T10:00:00Z", referenceDate: "2026-06-15", sourceRowCount: index === 1 ? 2 : 1, importedAt: "2026-06-15T10:00:00Z" })), transactions: snapshot.transactions.map((row, index) => ({ ...row, batchId: `synthetic-batch-${index < 2 ? 1 : 2}` })) };
    const multipleHtml = renderToStaticMarkup(<FinanceImportsView snapshot={multiple} workSnapshot={work} reportDate="2026-06-15" displayName="Synthetic" />);
    expect(multipleHtml.match(/Export originale/g)).toHaveLength(1);
    const chartSection = multipleHtml.slice(multipleHtml.indexOf('id="finance-trend-title"'), multipleHtml.indexOf('<h2>Categorie</h2>'));
    expect(chartSection).not.toContain("Export originale");
  });
});
