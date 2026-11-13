import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FinanceSummary, FinanceView } from "../../lib/finance/workspace";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useId: () => "overview-test",
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [
      hooks.states[index],
      (value: unknown) => {
        hooks.states[index] = value;
      },
    ];
  },
}));
import { FinanceAnalysis } from "./finance-analysis";

const view: FinanceView = {
  tab: "overview",
  period: "month",
  from: "2026-11-01",
  to: "2026-11-30",
  account: "",
  query: "ricerca incompatibile",
  direction: "transfer",
  category: "Altro",
  state: "deleted",
  source: "manual",
  batchId: "lotto",
  movementId: null,
  newEntry: null,
};
const summary: FinanceSummary = {
  closing: 97530n,
  asOf: "2026-11-09",
  incoming: 30000n,
  outgoing: 12470n,
  net: 17530n,
  count: 4,
  unallocatedCount: 2,
  buckets: [
    {
      key: "week-1",
      label: "1–7 nov",
      from: "2026-11-01",
      to: "2026-11-07",
      incoming: 20000n,
      outgoing: 10000n,
      closing: 90000n,
      count: 2,
    },
    {
      key: "week-2",
      label: "8–14 nov",
      from: "2026-11-08",
      to: "2026-11-14",
      incoming: 10000n,
      outgoing: 2470n,
      closing: 97530n,
      count: 2,
    },
    {
      key: "week-3",
      label: "15–21 nov",
      from: "2026-11-15",
      to: "2026-11-21",
      incoming: 0n,
      outgoing: 0n,
      closing: null,
      count: 0,
    },
  ],
  expenses: [
    { category: "Produzione", cents: 10000n, count: 1 },
    { category: "Spedizioni", cents: 2470n, count: 1 },
  ],
};
type Node = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...nodes(node.props.children as ReactNode)];
}
function render(nextSummary = summary, nextView = view, onDrill = vi.fn()) {
  hooks.cursor = 0;
  return { tree: FinanceAnalysis({ summary: nextSummary, view: nextView, onDrill }), onDrill };
}
function button(tree: ReactNode, label: string) {
  const found = nodes(tree).find(
    (node) => node.type === "button" && node.props["aria-label"] === label,
  );
  expect(found, `pulsante ${label}`).toBeDefined();
  return found!;
}
function click(node: Node) {
  (node.props.onClick as () => void)();
}
beforeEach(() => {
  hooks.states = [];
  hooks.cursor = 0;
});

describe("panoramica Finance verificabile", () => {
  it("mostra tre valori distinti, data del saldo e limite bancario", () => {
    const { tree } = render();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Saldo dai movimenti");
    expect(html).toContain("975,30 €");
    expect(html).toContain("Entrate registrate");
    expect(html).toContain("300,00 €");
    expect(html).toContain("Uscite registrate");
    expect(html).toContain("124,70 €");
    expect(html).toContain("09/11/2026");
    expect(html).toContain("non verificato con la banca");
    expect(html).toContain("Consuntivi fino al");
  });
  it("apre dalle entrate il bucket esatto in tutti i conti attribuiti", () => {
    const { tree, onDrill } = render();
    click(button(tree, "Entrate 8–14 nov: 100,00 €. Apri movimenti"));
    expect(onDrill).toHaveBeenCalledWith({
      tab: "movements",
      period: "custom",
      from: "2026-11-08",
      to: "2026-11-14",
      direction: "income",
      state: "posted",
      account: "__allocated",
      statisticsOnly: true,
    });
  });
  it("conserva il conto selezionato quando apre le uscite", () => {
    const { tree, onDrill } = render(summary, { ...view, account: "Conto sintetico" });
    click(button(tree, "Uscite 1–7 nov: 100,00 €. Apri movimenti"));
    expect(onDrill).toHaveBeenCalledWith({
      tab: "movements",
      period: "custom",
      from: "2026-11-01",
      to: "2026-11-07",
      direction: "expense",
      state: "posted",
      account: "Conto sintetico",
      statisticsOnly: true,
    });
  });
  it("separa i movimenti senza conto e consente di attribuirli nel periodo", () => {
    const { tree, onDrill } = render();
    expect(renderToStaticMarkup(tree)).toContain("2 movimenti senza conto");
    click(button(tree, "Da attribuire: 2 movimenti"));
    expect(onDrill).toHaveBeenCalledWith({
      tab: "movements",
      period: "custom",
      from: "2026-11-01",
      to: "2026-11-30",
      direction: "all",
      state: "unallocated",
      account: "__unallocated",
    });
  });
  it("apre le categorie con uscite lorde e il medesimo perimetro di conti e date", () => {
    const { tree, onDrill } = render();
    click(button(tree, "Produzione: 100,00 €. Apri uscite"));
    expect(onDrill).toHaveBeenCalledWith({
      tab: "movements",
      period: "custom",
      from: "2026-11-01",
      to: "2026-11-30",
      direction: "expense",
      category: "Produzione",
      state: "posted",
      account: "__allocated",
      statisticsOnly: true,
    });
    const tables = nodes(tree).filter((node) => node.type === "table");
    expect(tables).toHaveLength(2);
    expect(nodes(tree).filter((node) => node.type === "caption")).toHaveLength(2);
  });
  it("mostra prime cinque categorie e Altre espandibile senza perdere categorie", () => {
    const expenses = [600n, 500n, 400n, 300n, 200n, 100n, 50n].map((cents, index) => ({
      category: `Categoria ${index + 1}`,
      cents,
      count: 1,
    }));
    const { tree, onDrill } = render({ ...summary, expenses, outgoing: 2150n });
    const other = nodes(tree).find(
      (node) => node.type === "details" && node.props["aria-label"] === "Altre categorie di spesa",
    );
    expect(other).toBeDefined();
    const otherHtml = renderToStaticMarkup(other!);
    expect(otherHtml).toContain("Altre");
    expect(otherHtml).toContain("1,50 €");
    click(button(other!, "Categoria 7: 0,50 €. Apri uscite"));
    expect(onDrill).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Categoria 7", direction: "expense" }),
    );
  });
  it("seleziona la linea del saldo e apre tutto lo storico fino al giorno rappresentato", () => {
    const first = render();
    click(button(first.tree, "Mostra andamento del saldo"));
    const { tree, onDrill } = render();
    expect(renderToStaticMarkup(tree)).toContain("Andamento del saldo");
    expect(nodes(tree).some((node) => node.type === "polyline")).toBe(true);
    click(button(tree, "Saldo al 09/11/2026: 975,30 €. Apri movimenti"));
    expect(onDrill).toHaveBeenCalledWith({
      tab: "movements",
      period: "custom",
      from: "0001-01-01",
      to: "2026-11-09",
      direction: "all",
      state: "posted",
      account: "__allocated",
    });
    expect(
      nodes(tree).some(
        (node) =>
          node.type === "button" && String(node.props["aria-label"]).startsWith("Saldo al 21/11"),
      ),
    ).toBe(false);
  });
  it("il saldo principale apre lo storico cumulativo anche con il conto selezionato", () => {
    const { tree, onDrill } = render(summary, { ...view, account: "Conto sintetico" });
    click(button(tree, "Apri i movimenti del saldo al 09/11/2026"));
    expect(onDrill).toHaveBeenCalledWith({
      tab: "movements",
      period: "custom",
      from: "0001-01-01",
      to: "2026-11-09",
      direction: "all",
      state: "posted",
      account: "Conto sintetico",
    });
  });
  it("distingue saldo mancante, zero e assenza di movimenti", () => {
    const { tree } = render({
      ...summary,
      closing: null,
      count: 0,
      unallocatedCount: 0,
      incoming: 0n,
      outgoing: 0n,
      net: 0n,
      buckets: [],
      expenses: [],
    });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Saldo non disponibile");
    expect(html).toContain("Nessun movimento consuntivo");
    expect(html).toContain("0,00 €");
    expect(
      nodes(tree).some((node) =>
        String(node.props["aria-label"]).startsWith("Apri i movimenti del saldo"),
      ),
    ).toBe(false);
  });
  it("non presenta gli intervalli futuri come flussi nulli già consuntivati", () => {
    const { tree } = render();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Non consuntivo");
    expect(
      nodes(tree).some(
        (node) =>
          node.type === "button" &&
          String(node.props["aria-label"]).startsWith("Entrate 15–21 nov"),
      ),
    ).toBe(false);
    const tables = nodes(tree).filter((node) => node.type === "table");
    expect(renderToStaticMarkup(tables[0])).toContain("Non consuntivo");
  });
  it("mostra flussi nulli senza un segno negativo o positivo artificiale", () => {
    const { tree } = render({ ...summary, incoming: 0n, outgoing: 0n });
    expect(
      renderToStaticMarkup(button(tree, "Apri le entrate registrate nel periodo")),
    ).not.toContain("+0,00");
    expect(
      renderToStaticMarkup(button(tree, "Apri le uscite registrate nel periodo")),
    ).not.toContain("−0,00");
  });
  it("mantiene esatti importi maggiori di Number.MAX_SAFE_INTEGER e coordinate finite", () => {
    const large = 900719925474099312345n;
    const { tree } = render({
      ...summary,
      closing: large,
      incoming: large,
      outgoing: 1n,
      buckets: [{ ...summary.buckets[0], incoming: large, outgoing: 1n, closing: large }],
      expenses: [{ category: "Sintetica", cents: large, count: 1 }],
    });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("9.007.199.254.740.993.123,45 €");
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
