import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const view = vi.hoisted(() => ({ filter: "dated" }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (value: unknown) => actual.useState(value === "dated" ? view.filter : value),
  };
});
vi.mock("@/lib/finance/model", () => import("../lib/finance/model"));
vi.mock("@/lib/finance/dashboard", () => import("../lib/finance/dashboard"));
vi.mock("@/lib/finance/categories", () => import("../lib/finance/categories"));
import { FinanceImportsView } from "./finance-imports-view";
import type { FinanceSnapshot } from "../lib/finance/model";
import type { FinanceWorkSnapshot } from "../lib/finance-work/model";
import styles from "./finance.module.css";

beforeEach(() => {
  view.filter = "dated";
});

const transaction = (
  index: number,
  overrides: Partial<FinanceSnapshot["transactions"][number]> = {},
): FinanceSnapshot["transactions"][number] => ({
  id: `96000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  batchId: "96000000-0000-4000-8000-000000000100",
  sourceRow: index + 1,
  occurredAt: "2026-06-10T10:00:00Z",
  sourceDate: "2026-06-10",
  sourceTimestamp: "2026-06-10T10:00:00Z",
  sourceAmount: "12.34",
  formattedAmount: "12,34 €",
  account: "Conto sintetico A",
  targetAccount: null,
  category: "Vendite",
  payee: "Entrata sintetica descritta",
  folder: "",
  tags: "",
  notes: "",
  pending: false,
  ...overrides,
});

/** Scope assertions to the operative rows; original sources keep their own detail. */
function movementTable(html: string) {
  const section = html.slice(html.indexOf('id="finance-transactions"'));
  const table = section.match(/<table\b[^>]*>[\s\S]*?<\/table>/)?.[0];
  expect(table, "Tabella Movimenti presente").toBeDefined();
  return table!;
}
const movementRows = (table: string) =>
  [
    ...(table.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "").matchAll(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/g,
    ),
  ].map((match) => match[0]);

describe("Finance overview source separation", () => {
  it("rende leggibili categoria e descrizione, con importi e direzioni comprensibili anche senza colore", () => {
    const html = renderToStaticMarkup(
      <FinanceImportsView
        snapshot={{
          batches: [],
          transactions: [
            transaction(1),
            transaction(2, {
              sourceAmount: "-7.89",
              formattedAmount: "−7,89 €",
              category: "Software",
              payee: "Spesa sintetica descritta",
            }),
            transaction(3, {
              sourceAmount: "-20.00",
              formattedAmount: "−20,00 €",
              category: "Spostamento sintetico",
              targetAccount: "Conto sintetico B",
              payee: "Giroconto sintetico descritto",
            }),
            transaction(4, {
              sourceAmount: "0.00",
              formattedAmount: "0,00 €",
              payee: "",
              notes: "",
            }),
          ],
        }}
        reportDate="2026-06-15"
        displayName="Sintetico"
      />,
    );
    const table = movementTable(html),
      rows = movementRows(table);
    expect(rows).toHaveLength(4);
    expect(table).toContain('scope="col">Categoria / conto');
    expect(table).not.toContain("Fonte / stato");
    expect(table).not.toContain("BudgetFlow");
    expect(table).not.toContain("Registrato · Da verificare");
    const income = rows.find((row) => row.includes("Entrata sintetica descritta"))!;
    expect(income).toMatch(/<strong\b[^>]*>Vendite<\/strong>/);
    expect(income.indexOf(">Vendite</strong>")).toBeLessThan(income.indexOf("Conto sintetico A"));
    expect(income).toContain(styles.incomeAmount);
    expect(income).toContain("+12,34 €");
    expect(income).toContain('class="sr-only">Entrata: ');
    expect(income).toContain('aria-label="Dettagli Vendite,');
    const expense = rows.find((row) => row.includes("Spesa sintetica descritta"))!;
    expect(expense).toMatch(/<strong\b[^>]*>Software<\/strong>/);
    expect(expense).toContain(styles.expenseAmount);
    expect(expense).toContain("−7,89 €");
    expect(expense).toContain('class="sr-only">Uscita: ');
    for (const [description, label] of [
      ["Giroconto sintetico descritto", "Trasferimento"],
      ["Descrizione da aggiungere", "Importo nullo"],
    ]) {
      const neutral = rows.find((row) => row.includes(description))!;
      expect(neutral).not.toContain(styles.incomeAmount);
      expect(neutral).not.toContain(styles.expenseAmount);
      expect(neutral).toContain(`class="sr-only">${label}: `);
    }
    const transfer = rows.find((row) => row.includes("Giroconto sintetico descritto"))!;
    expect(transfer).toMatch(/<strong\b[^>]*>Trasferimento<\/strong>/);
    expect(transfer).toContain("Conto sintetico A → Conto sintetico B");
    expect(transfer).not.toContain("Uscita:");
  });

  it("conserva i segnali testuali pending e data futura quando sono visibili tutti gli stati", () => {
    view.filter = "all";
    const html = renderToStaticMarkup(
      <FinanceImportsView
        snapshot={{
          batches: [],
          transactions: [
            transaction(1, { pending: true, payee: "Movimento sintetico in attesa" }),
            transaction(2, { sourceDate: "2026-07-10", payee: "Movimento sintetico pianificato" }),
          ],
        }}
        reportDate="2026-06-15"
        displayName="Sintetico"
      />,
    );
    const rows = movementRows(movementTable(html));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.includes("Movimento sintetico in attesa"))).toContain("Pending");
    expect(rows.find((row) => row.includes("Movimento sintetico pianificato"))).toContain(
      "Data futura",
    );
    expect(rows.join("")).not.toContain("Registrato · Da verificare");
  });

  it("renders account balances and a chart with exact accessible data, keeping future, pending and unallocated flows separate", () => {
    const snapshot: FinanceSnapshot = {
      batches: [],
      transactions: [
        {
          id: "synthetic-posted",
          batchId: "batch",
          sourceRow: 2,
          occurredAt: "2026-06-10T10:00:00Z",
          sourceDate: "2026-06-10",
          sourceTimestamp: "2026-06-10T10:00:00Z",
          sourceAmount: "12.34",
          formattedAmount: "12,34 €",
          account: "Revolut Business",
          targetAccount: null,
          category: "Vendite",
          payee: "Synthetic",
          folder: "",
          tags: "",
          notes: "",
          pending: false,
        },
        {
          id: "synthetic-pending",
          batchId: "batch",
          sourceRow: 3,
          occurredAt: "2026-06-10T10:00:00Z",
          sourceDate: "2026-06-10",
          sourceTimestamp: "2026-06-10T10:00:00Z",
          sourceAmount: "-5.01",
          formattedAmount: "−5,01 €",
          account: "Revolut Business",
          targetAccount: null,
          category: "Software",
          payee: "Synthetic",
          folder: "",
          tags: "",
          notes: "",
          pending: true,
        },
        {
          id: "synthetic-future",
          batchId: "batch",
          sourceRow: 4,
          occurredAt: "2026-07-10T10:00:00Z",
          sourceDate: "2026-07-10",
          sourceTimestamp: "2026-07-10T10:00:00Z",
          sourceAmount: "-7.01",
          formattedAmount: "−7,01 €",
          account: "Revolut Business",
          targetAccount: null,
          category: "Software",
          payee: "Synthetic",
          folder: "",
          tags: "",
          notes: "",
          pending: false,
        },
      ],
    };
    const work: FinanceWorkSnapshot = {
      entries: [],
      facts: [],
      payments: [
        {
          id: "bank",
          orderId: "order",
          source: "manual_declaration",
          cents: 2500,
          method: "bank_transfer",
          occurredAt: "2026-06-10T10:00:00Z",
          reference: null,
        },
      ],
      orders: [],
      refunds: [],
      shopifyFinancials: [],
      shopifyTransactions: [],
    };
    const html = renderToStaticMarkup(
      <FinanceImportsView
        snapshot={snapshot}
        workSnapshot={work}
        reportDate="2026-06-15"
        displayName="Synthetic"
      />,
    );
    expect(html).toContain("12,34 €");
    expect(html).not.toContain("32,34 €");
    expect(html).toContain("Tabella dati del grafico · importi esatti");
    expect(html).toContain("Non consuntivo");
    expect(html).toContain("1 da attribuire");
    expect(html).toContain("1 pending");
    expect(html).toContain("1 futuri");
    expect(html).toContain("Collab");
    expect(html).toContain("Stipendi");
    expect(html).toContain("Eventi");
    expect(html).toContain("Importazioni e dichiarazioni restano da verificare");
    expect(html).not.toContain("password Finance");
    const multiple = {
      ...snapshot,
      batches: [1, 2].map((index) => ({
        id: `synthetic-batch-${index}`,
        sourceFileName: `synthetic-${index}.csv`,
        extractedAt: "2026-06-15T10:00:00Z",
        referenceDate: "2026-06-15",
        sourceRowCount: index === 1 ? 2 : 1,
        importedAt: "2026-06-15T10:00:00Z",
      })),
      transactions: snapshot.transactions.map((row, index) => ({
        ...row,
        batchId: `synthetic-batch-${index < 2 ? 1 : 2}`,
      })),
    };
    const multipleHtml = renderToStaticMarkup(
      <FinanceImportsView
        snapshot={multiple}
        workSnapshot={work}
        reportDate="2026-06-15"
        displayName="Synthetic"
      />,
    );
    expect(multipleHtml.match(/Export originale/g)).toHaveLength(1);
    const chartSection = multipleHtml.slice(
      multipleHtml.indexOf('id="finance-trend-title"'),
      multipleHtml.indexOf("<h2>Categorie</h2>"),
    );
    expect(chartSection).not.toContain("Export originale");
  });
});
