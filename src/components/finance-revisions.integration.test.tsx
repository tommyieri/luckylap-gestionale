import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
const flags = vi.hoisted(() => ({ deleted: false }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (value: unknown) =>
      actual.useState(value === "dated" && flags.deleted ? "deleted" : value),
  };
});
vi.mock("@/lib/finance/model", () => import("../lib/finance/model"));
vi.mock("@/lib/finance/dashboard", () => import("../lib/finance/dashboard"));
vi.mock("@/lib/finance/categories", () => import("../lib/finance/categories"));
vi.mock("@/lib/finance-work/model", () => import("../lib/finance-work/model"));
vi.mock("@/lib/sales/model", () => import("../lib/sales/model"));
vi.mock("./finance-work-form", () => ({
  FinanceWorkForm: ({ children }: { children: ReactNode }) => <form>{children}</form>,
  FinanceWorkRecovery: () => null,
  FinanceAccountCategoryFields: () => null,
}));
import { FinanceImportsView } from "./finance-imports-view";
import { FinanceWorkView } from "./finance-work-view";
import { financeMovementEditorHref } from "./finance-movement-actions";
import type { FinanceSnapshot } from "../lib/finance/model";
import type { FinanceRevisionRecord } from "../lib/finance-revisions/model";
import type { FinanceWorkSnapshot } from "../lib/finance-work/model";
const id = "91000000-0000-4000-8000-000000000001";
const work: FinanceWorkSnapshot = {
  entries: [],
  facts: [],
  payments: [],
  orders: [],
  refunds: [],
  shopifyFinancials: [],
  shopifyTransactions: [],
};
const snapshot: FinanceSnapshot = {
  batches: [],
  transactions: [
    {
      id,
      batchId: id,
      sourceRow: 2,
      occurredAt: "2026-06-10T10:00:00Z",
      sourceDate: "2026-06-10",
      sourceTimestamp: "2026-06-10T10:00:00Z",
      sourceAmount: "12.34",
      formattedAmount: "12,34 €",
      account: "Cash",
      targetAccount: null,
      category: "Vendite",
      payee: "Fonte sintetica",
      folder: "",
      tags: "",
      notes: "",
      pending: false,
    },
  ],
};
const head: FinanceRevisionRecord = {
  id,
  operationId: id,
  sourceKind: "budgetflow",
  sourceId: id,
  version: 1,
  previousVersion: 0,
  action: "update",
  restoredFromVersion: null,
  values: {
    date: "2026-06-11",
    direction: "income",
    amountCents: 10000,
    account: "Revolut Business",
    targetAccount: null,
    category: "Eventi",
    description: "Correzione sintetica",
    pending: false,
  },
  deleted: false,
  reason: "Correzione sintetica",
  createdBy: id,
  createdAt: "2026-06-12T10:00:00Z",
};
describe("revisioni nei punti effettivi della UI Finance", () => {
  it("usa importo e conto corretti prima di saldi, grafico e categorie", () => {
    flags.deleted = false;
    const html = renderToStaticMarkup(
      <FinanceImportsView
        snapshot={snapshot}
        workSnapshot={work}
        revisionHeads={[head]}
        reportDate="2026-06-15"
        displayName="Sintetico"
      />,
    );
    expect(html).toContain("100,00 €");
    expect(html).not.toContain("12,34 €");
    expect(html).toContain("Revolut Business");
    expect(html).toContain("Versione 1");
    expect(html).toContain(`source_kind=budgetflow&amp;source_id=${id}`);
    expect(html).toContain("Modifica / storico");
  });
  it("recupera eliminati anche quando il loro conto non esiste più nei saldi attivi", () => {
    flags.deleted = true;
    const html = renderToStaticMarkup(
      <FinanceImportsView
        snapshot={snapshot}
        revisionHeads={[{ ...head, action: "delete", deleted: true }]}
        reportDate="2026-06-15"
        displayName="Sintetico"
      />,
    );
    expect(html).toContain("Ripristina / storico");
    expect(html).toContain("Versione 1");
    expect(html).toContain("Revolut Business");
    flags.deleted = false;
  });
  it("recupera un incasso P3 eliminato senza includerlo nei totali attivi", () => {
    const payment = {
      id,
      reportId: id,
      locationId: id,
      cents: 4500,
      paidAt: "2026-06-10T10:00:00Z",
      method: "cash" as const,
      account: "Cash",
      allocationNote: null,
      reference: null,
      shopName: "Negozio sintetico",
      month: "2026-06",
      monthLabel: "giugno 2026",
      href: "/consignment/SYN/resoconto/2026-06",
      direction: "expense" as const,
      category: "Rettifica",
      description: "Incasso eliminato sintetico",
      pending: false,
    };
    flags.deleted = false;
    const active = renderToStaticMarkup(
      <FinanceImportsView
        snapshot={{ batches: [], transactions: [] }}
        deletedShopPayments={[payment]}
        reportDate="2026-06-15"
        displayName="Sintetico"
      />,
    );
    expect(active).not.toContain("Incasso eliminato sintetico");
    expect(active).not.toContain("45,00 €");
    flags.deleted = true;
    const deleted = renderToStaticMarkup(
      <FinanceImportsView
        snapshot={{ batches: [], transactions: [] }}
        deletedShopPayments={[payment]}
        reportDate="2026-06-15"
        displayName="Sintetico"
      />,
    );
    expect(deleted).toContain("Rettifica");
    expect(deleted).toContain("Eliminato · recuperabile");
    expect(deleted).toContain(`/finance/incasso/${id}`);
    expect(deleted).toContain("Ripristina / storico");
    expect(deleted).toContain("45,00 €");
    flags.deleted = false;
  });
  it("il registro manuale mostra la versione ripristinata al posto dei campi della vecchia fonte annullata", () => {
    const entries = [
      {
        id,
        date: "2026-06-10",
        type: "expense" as const,
        cents: 1234,
        description: "Fonte precedente",
        account: "Cash",
        category: "Software",
        source: "manual_declaration" as const,
        createdAt: "2026-06-10T10:00:00Z",
        createdBy: id,
        void: {
          id,
          entryId: id,
          reason: "Vecchio annullo",
          createdAt: "2026-06-11T10:00:00Z",
          createdBy: id,
        },
      },
    ];
    const html = renderToStaticMarkup(
      <FinanceWorkView
        snapshot={{ ...work, entries }}
        revisionHeads={[
          { ...head, sourceKind: "manual", action: "restore", restoredFromVersion: 0 },
        ]}
        today="2026-06-15"
        userId={id}
        displayName="Sintetico"
      />,
    );
    expect(html).toContain("Correzione sintetica");
    expect(html).toContain("100,00");
    expect(html).toContain("Attiva");
    expect(html).toContain("Versione 1");
    expect(html).not.toContain("Annulla questa dichiarazione");
    expect(html).toContain(`source_kind=manual&amp;source_id=${id}`);
  });
  it.each(["budgetflow", "manual", "payment", "refund", "consignment", "shop_payment"])(
    "collega %s al proprio editor, compreso il singolo registro P3",
    (source) => {
      const href = financeMovementEditorHref(source, id);
      expect(href).toBe(
        source === "shop_payment"
          ? `/finance/incasso/${id}`
          : `/finance/movimento?source_kind=${source === "consignment" ? "consignment_settlement" : source}&source_id=${id}`,
      );
    },
  );
});
