import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/sales/model", () => import("../lib/sales/model"));
vi.mock("@/lib/finance-work/model", () => import("../lib/finance-work/model"));
vi.mock("./finance-work-form", () => ({
  FinanceWorkForm: ({ children }: { children: ReactNode }) => <form>{children}</form>,
  FinanceWorkRecovery: () => null,
  FinanceAccountCategoryFields: () => null,
}));
import { FinanceWorkView } from "./finance-work-view";
import { financeWorkFromRows } from "../lib/finance-work/read";
import { shopifyWorkRows, workId } from "../lib/finance-work/fixtures";
import type { FinanceRevisionRecord } from "../lib/finance-revisions/model";
describe("distinct Finance sources", () => {
  it("shows manual declarations, observed captures and refunds as separate sections without a combined cash total", () => {
    const html = renderToStaticMarkup(
      <FinanceWorkView
        snapshot={financeWorkFromRows(shopifyWorkRows())}
        userId="60000000-0000-4000-8000-000000000010"
        displayName="Synthetic"
        today="2026-10-21"
      />,
    );
    const declared = html.slice(
      html.indexOf("<h2>Incassi dichiarati</h2>"),
      html.indexOf("<h2>Incassi Shopify osservati</h2>"),
    );
    const observed = html.slice(
      html.indexOf("<h2>Incassi Shopify osservati</h2>"),
      html.indexOf("<h2>Rimborsi Shopify osservati</h2>"),
    );
    expect(declared).toContain("1 dichiarazioni");
    expect(declared).toContain("Contanti");
    expect(declared).not.toContain("gid://shopify/OrderTransaction");
    expect(observed).toContain("2 operazioni riuscite");
    expect(observed).toContain("40,00");
    expect(observed).toContain("60,00");
    expect(observed).toContain("Shopify POS");
    expect(observed).not.toContain("80,02");
    expect(observed).not.toContain("100,00");
    expect(html).toContain("AUTHORIZATION e VOID non sono incassi");
    expect(html).toContain("non provano l’accredito sul conto");
    expect(html).toContain("Un rimborso Shopify non registra un rientro fisico");
    expect(html).toContain("Imposte");
    expect(html).toContain("Da verificare");
    expect(html).toContain("Ordine Shopify 100");
    expect(html).not.toContain("Saldo bancario calcolato");
  });
});

describe("incassi dichiarati con le correzioni Finance", () => {
  const head = (changes: Partial<FinanceRevisionRecord> = {}): FinanceRevisionRecord => ({
    id: workId(90),
    operationId: workId(91),
    sourceKind: "payment",
    sourceId: workId(6),
    version: 1,
    previousVersion: 0,
    action: "update",
    restoredFromVersion: null,
    values: {
      date: "2026-10-21",
      direction: "income",
      amountCents: 7000,
      account: "Cash",
      targetAccount: null,
      category: "Vendite",
      description: "Incasso dichiarato da ordine",
      pending: false,
    },
    deleted: false,
    reason: "Correzione",
    createdBy: workId(10),
    createdAt: "2026-10-21T13:00:00Z",
    ...changes,
  });
  const declared = (heads: FinanceRevisionRecord[]) => {
    const html = renderToStaticMarkup(
      <FinanceWorkView
        snapshot={financeWorkFromRows(shopifyWorkRows())}
        userId={workId(10)}
        displayName="Synthetic"
        today="2026-10-21"
        revisionHeads={heads}
      />,
    );
    return html.slice(
      html.indexOf("<h2>Incassi dichiarati</h2>"),
      html.indexOf("<h2>Incassi Shopify osservati</h2>"),
    );
  };

  it("senza correzioni mostra l’importo dichiarato, senza riga secondaria", () => {
    const table = declared([]);
    expect(table).toContain("80,02");
    expect(table).not.toContain("Dichiarato 80,02");
    expect(table).not.toContain("Valori originali dichiarati");
  });

  it("mostra l’importo corretto e, sotto, quello dichiarato", () => {
    const table = declared([head()]);
    expect(table).toContain("70,00");
    expect(table).toContain("Dichiarato 80,02");
    expect(table).toContain("corretto in Finance");
    expect(table).toContain("Importi attuali, con le correzioni Finance.");
  });

  it("una correzione che lascia l’importo uguale non aggiunge la riga secondaria", () => {
    const same = head();
    same.values = { ...same.values, amountCents: 8002, account: "Revolut Business" };
    expect(declared([same])).not.toContain("Dichiarato 80,02");
  });

  it("un incasso escluso, per esempio da una vendita annullata, resta visibile come escluso", () => {
    const table = declared([
      head({ action: "delete", deleted: true, version: 2, previousVersion: 1 }),
    ]);
    expect(table).toContain("Escluso");
    expect(table).toContain("Dichiarato 80,02");
    expect(table).toContain("Ripristina / storico");
  });
});
