import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FinanceImportsView, revisionAuthorLine } from "./finance-imports-view";
import type { FinanceRevisionRecord } from "../lib/finance-revisions/model";
import type { FinanceSnapshot } from "../lib/finance/model";

vi.mock("./finance/finance-movement-panel", () => ({ FinanceMovementPanel: () => null }));
vi.mock("./finance/finance-new-movement", () => ({ FinanceNewMovement: () => null }));
vi.mock("./finance-work-form", () => ({ FinanceWorkRecovery: () => null }));
const transaction = (
  index: number,
  extra: Partial<FinanceSnapshot["transactions"][number]> = {},
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
  ...extra,
});
const render = (
  transactions: FinanceSnapshot["transactions"],
  params: Record<string, string> = {},
  heads: FinanceRevisionRecord[] = [],
  names = {},
) =>
  renderToStaticMarkup(
    <FinanceImportsView
      snapshot={{ batches: [], transactions }}
      initialParams={{ vista: "movements", periodo: "all", ...params }}
      revisionHeads={heads}
      names={names}
      reportDate="2026-06-15"
      displayName="Sintetico"
      readOnly
    />,
  );
const row = (html: string, description: string) =>
  [...html.matchAll(/<article[^>]*>[\s\S]*?<\/article>/g)]
    .map((m) => m[0])
    .find((r) => r.includes(description))!;
const head = (sourceId: string, deleted = false): FinanceRevisionRecord => ({
  id: "96000000-0000-4000-8000-000000000900",
  operationId: "96000000-0000-4000-8000-000000000901",
  sourceKind: "budgetflow",
  sourceId,
  version: 2,
  previousVersion: 1,
  action: deleted ? "delete" : "update",
  restoredFromVersion: null,
  values: {
    date: "2026-06-11",
    direction: "income",
    amountCents: 4000,
    account: "Conto sintetico A",
    targetAccount: null,
    category: "Vendite",
    description: "Entrata sintetica corretta",
    pending: false,
  },
  deleted,
  reason: "Correzione",
  createdBy: "96000000-0000-4000-8000-000000000777",
  createdAt: "2026-06-12T23:30:00Z",
});

describe("Finance: una sola proiezione per la nuova interfaccia", () => {
  it("mette la descrizione prima della categoria e conserva segno e direzione dei movimenti", () => {
    const html = render([
      transaction(1),
      transaction(2, { sourceAmount: "-7.89", payee: "Spesa sintetica", category: "Software" }),
      transaction(3, {
        sourceAmount: "-20.00",
        payee: "Giroconto sintetico",
        targetAccount: "Conto sintetico B",
      }),
      transaction(4, { sourceAmount: "0.00", payee: "" }),
    ]);
    const incoming = row(html, "Entrata sintetica descritta");
    expect(incoming).toContain("<strong>Entrata sintetica descritta</strong>");
    expect(incoming.indexOf("Entrata sintetica descritta")).toBeLessThan(
      incoming.indexOf("Vendite"),
    );
    expect(incoming).toContain("+12,34 €");
    expect(incoming).toContain("Entrata: ");
    expect(row(html, "Spesa sintetica")).toContain("−7,89 €");
    expect(row(html, "Spesa sintetica")).toContain("Uscita: ");
    expect(row(html, "Giroconto sintetico")).toContain("Trasferimento");
    expect(row(html, "Giroconto sintetico")).not.toContain("Uscita: ");
    expect(html).toContain("Descrizione da aggiungere");
  });
  it("esclude sospesi e futuri dal consuntivo ma li rende consultabili", () => {
    const rows = [
      transaction(1, { pending: true, payee: "Esempio sospeso" }),
      transaction(2, { sourceDate: "2026-07-10", payee: "Esempio futuro" }),
    ];
    expect(render(rows)).not.toContain("Esempio sospeso");
    const all = render(rows, { stato: "all" });
    expect(row(all, "Esempio sospeso")).toContain("In sospeso");
    expect(row(all, "Esempio futuro")).toContain("Data futura");
  });
  it("applica le revisioni prima di filtri, righe e riepiloghi", () => {
    const rows = [transaction(1), transaction(2, { payee: "Entrata mai corretta" })];
    const html = render(rows, { stato: "edited" }, [head(rows[0].id)]);
    expect(html).toContain("Entrata sintetica corretta");
    expect(html).not.toContain("Entrata mai corretta");
    expect(row(html, "Entrata sintetica corretta")).toContain("+40,00 €");
    const overview = render(rows, { vista: "overview", periodo: "month" }, [head(rows[0].id)]);
    expect(overview).toContain("52,34 €");
  });
  it("mantiene eliminati recuperabili senza sommarli al saldo", () => {
    const source = transaction(1);
    const overview = render([source], { vista: "overview" }, [head(source.id, true)]);
    expect(overview).not.toContain("40,00 €");
    const deleted = render([source], { stato: "deleted" }, [head(source.id, true)]);
    expect(row(deleted, "Entrata sintetica corretta")).toContain("Eliminato · recuperabile");
  });
  it("mostra autore e giorno di Roma della correzione", () => {
    const source = transaction(1);
    const html = render([source], {}, [head(source.id)], {
      "96000000-0000-4000-8000-000000000777": "Membro sintetico",
    });
    expect(html).toContain("Modificato da Membro sintetico · 13 giu 2026");
    expect(
      revisionAuthorLine(
        { version: 2, id: "z", deleted: true, actorId: "y", occurredAt: head("x").createdAt },
        {},
      ),
    ).toBe("Eliminato da un membro del team · 13 giu 2026");
  });
  it("conserva separatamente dati originali Budget Flow e correzioni", () => {
    const original = transaction(1, { notes: "Nota sintetica originale", tags: "evento-prova" });
    const html = render([original], { vista: "sources" }, [head(original.id)]);
    expect(html).toContain("Documenti e fonti");
    expect(html).toContain("Nessun file importato");
    expect(html).not.toContain("Entrata sintetica corretta");
  });
});
