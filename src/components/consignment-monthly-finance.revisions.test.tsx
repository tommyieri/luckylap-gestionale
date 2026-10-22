import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsignmentMonthlyFinance } from "./consignment-monthly-finance";
import type { ConsignmentFinanceSnapshot } from "../lib/consignment/finance";
const legacy: ConsignmentFinanceSnapshot = {
  loadedAt: "2026-06-15T10:00:00Z",
  rows: [
    {
      saleId: "91000000-0000-4000-8000-000000000001",
      occurredAt: "2026-06-10T10:00:00Z",
      shopId: "91000000-0000-4000-8000-000000000002",
      shopLabel: "Negozio sintetico",
      sku: "SYN-M",
      quantity: 1,
      reference: "SYN-1",
      grossCents: 1000,
      brandClaimCents: 600,
      shopShareCents: 400,
      settledCents: 900,
      remainingCents: 0,
      overpaidCents: 300,
    },
  ],
};
describe("eccedenza delle vendite precedenti dopo una correzione Finance", () => {
  it("mostra l’importo da restituire accanto al residuo zero senza sommarlo al da incassare", () => {
    const html = renderToStaticMarkup(
      <ConsignmentMonthlyFinance
        snapshot={{ rows: [], toCollectCents: 0, loadedAt: legacy.loadedAt }}
        legacy={legacy}
      />,
    )
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ");
    expect(html).toContain("Da restituire 3,00 €");
    expect(html).toContain("Da incassare 0,00 €");
  });
});
