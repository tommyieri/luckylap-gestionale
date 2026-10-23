import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../app/finance/movimento/actions", () => ({ reviseMovement: vi.fn() }));
import { FinanceRevisionEditor } from "./finance-revision-editor";
import type { FinanceRevisionHistory, FinanceRevisionSource } from "../lib/finance-revisions/model";

const id = (n: number) => `92000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const history = (
  sourceKind: FinanceRevisionSource,
  orderId: string | null = id(9),
): FinanceRevisionHistory => ({
  original: {
    sourceKind,
    sourceId: id(2),
    orderId,
    deleted: false,
    values: {
      date: "2026-06-10",
      direction: sourceKind === "refund" ? "expense" : "income",
      amountCents: 4500,
      account: null,
      targetAccount: null,
      category: "Vendite",
      description: "Incasso sintetico",
      pending: false,
    },
  },
  revisions: [],
});
const render = (value: FinanceRevisionHistory) =>
  renderToStaticMarkup(<FinanceRevisionEditor history={value} actorId={id(1)} names={{}} />);

describe("editor dei movimenti Finance", () => {
  it("non offre «Elimina movimento» per un incasso di vendita e dice dove annullarlo", () => {
    const html = render(history("payment"));
    expect(html).not.toContain("Elimina movimento");
    expect(html).toContain("Salva correzione");
    expect(html).toContain('data-undo-in-sales="payment"');
    expect(html).toContain("«Annulla registrazione» o «Registra reso»");
    expect(html).toContain(`href="/sales#order-${id(9)}"`);
    expect(html).toContain("Vai alla vendita in Vendite");
  });

  it("non offre «Elimina movimento» per un rimborso Shopify", () => {
    const html = render(history("refund"));
    expect(html).not.toContain("Elimina movimento");
    expect(html).toContain('data-undo-in-sales="refund"');
    expect(html).toContain("Un rimborso Shopify non si elimina da Finance");
  });

  it("senza vendita collegata il suggerimento resta, senza link", () => {
    const html = render(history("payment", null));
    expect(html).toContain('data-undo-in-sales="payment"');
    expect(html).not.toContain("Vai alla vendita in Vendite");
  });

  it("le altre fonti si eliminano ancora, senza il suggerimento", () => {
    for (const kind of ["budgetflow", "manual", "consignment_settlement"] as const) {
      const html = render(history(kind, null));
      expect(html).toContain("Elimina movimento");
      expect(html).not.toContain("data-undo-in-sales");
    }
  });

  it("la motivazione è facoltativa, con «Correzione» come valore neutro", () => {
    const html = render(history("manual", null));
    const input = html.match(/<input[^>]*name="reason"[^>]*>/)?.[0] ?? "";
    expect(input).not.toContain("required");
    expect(input).not.toContain("minLength");
    expect(input).toContain('placeholder="Correzione"');
    expect(input).toContain('maxLength="500"');
    expect(html).toContain("Motivazione, facoltativa");
    expect(html).toContain("Se la lasci vuota, nello storico resta «Correzione»");
  });
});
