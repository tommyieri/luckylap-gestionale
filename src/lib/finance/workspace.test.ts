import { describe, expect, it } from "vitest";
import type { RevisedMovement } from "../finance-revisions/projection";
import { revisedAccountBalances } from "../finance-revisions/projection";
import type { FinanceDashboard, FinanceMovement } from "./dashboard";
import type { FinanceTransaction } from "./model";
import {
  filterFinanceMovements,
  financeViewHref,
  financeWorkspaceSummary,
  parseFinanceView,
  type FinanceView,
} from "./workspace";

const today = "2026-06-15";
const view = (overrides: Partial<FinanceView> = {}): FinanceView => ({
  ...parseFinanceView({}, today),
  ...overrides,
});
const movement = (
  id: string,
  overrides: Partial<RevisedMovement<FinanceMovement>> = {},
): RevisedMovement<FinanceMovement> => ({
  id: `manual:${id}`,
  source: "manual",
  sourceId: id,
  date: "2026-06-10",
  cents: -123_456n,
  account: "Cash",
  targetAccount: null,
  category: "Servizi personalizzati",
  description: "Consulenza sintetica in città",
  pending: false,
  future: false,
  transfer: false,
  allocationNote: null,
  ...overrides,
});
const revision = (deleted = false) => ({
  version: 1,
  id: "synthetic-revision",
  deleted,
  actorId: "synthetic-actor",
  occurredAt: "2026-06-11T12:00:00Z",
});
const dashboard = (...movements: RevisedMovement<FinanceMovement>[]): FinanceDashboard => ({
  movements,
  accounts: revisedAccountBalances(movements.filter((row) => !row.revision?.deleted)),
  years: [2026],
  reportDate: today,
});

describe("contesto Finance nell’indirizzo", () => {
  it("apre la panoramica del mese con soli consuntivi", () => {
    expect(parseFinanceView({}, today)).toEqual({
      tab: "overview",
      period: "month",
      from: "2026-06-01",
      to: "2026-06-30",
      account: "",
      query: "",
      direction: "all",
      category: "",
      state: "posted",
      source: "",
      batchId: "",
      movementId: null,
      newEntry: null,
    });
  });

  it("conserva filtri e selezione con parametri italiani canonici", () => {
    const expected = view({
      tab: "movements",
      period: "custom",
      from: "2024-02-29",
      to: "2024-03-03",
      account: "Cash",
      query: "città & 1.234,56",
      direction: "expense",
      category: "Categoria su misura",
      state: "edited",
      source: "budgetflow",
      batchId: "synthetic-batch",
      movementId: "budgetflow:synthetic-row",
      newEntry: "income",
    });
    const href = financeViewHref(expected);
    const params = new URL(href, "https://synthetic.invalid").searchParams;
    expect(new URL(href, "https://synthetic.invalid").pathname).toBe("/finance");
    expect(params.get("vista")).toBe("movements");
    expect(params.get("periodo")).toBe("custom");
    expect(params.get("dal")).toBe("2024-02-29");
    expect(params.get("movimento")).toBe("budgetflow:synthetic-row");
    expect(parseFinanceView(params, today)).toEqual(expected);
    expect(financeViewHref(parseFinanceView(params, today))).toBe(href);
  });

  it("calcola mese precedente, anno e tutti i periodi senza perdere date future", () => {
    expect(parseFinanceView({ periodo: "previous" }, "2026-01-09")).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(parseFinanceView({ periodo: "previous" }, "2024-03-31")).toMatchObject({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(parseFinanceView({ periodo: "year" }, today)).toMatchObject({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(parseFinanceView({ periodo: "all" }, today)).toMatchObject({
      from: "0001-01-01",
      to: "9999-12-31",
    });
  });

  it("rifiuta date inesistenti e intervalli invertiti, accettando il bisestile", () => {
    for (const [from, to] of [
      ["2026-02-29", "2026-03-01"],
      ["2026-04-31", "2026-05-01"],
      ["2026-6-01", "2026-06-30"],
      ["2026-07-01", "2026-06-30"],
    ]) {
      expect(parseFinanceView({ periodo: "custom", dal: from, al: to }, today)).toMatchObject({
        period: "month",
        from: "2026-06-01",
        to: "2026-06-30",
      });
    }
    expect(
      parseFinanceView({ periodo: "custom", dal: "2024-02-29", al: "2024-02-29" }, today),
    ).toMatchObject({ period: "custom", from: "2024-02-29", to: "2024-02-29" });
    expect(() => parseFinanceView({}, "2026-02-30")).toThrow(/Data/);
  });

  it("ignora enum sconosciuti e canonizza i preset anche con dal/al estranei", () => {
    expect(
      parseFinanceView(
        {
          vista: ["unknown", "movements"],
          periodo: "month",
          dal: "2020-01-01",
          al: "2020-12-31",
          stato: "unknown",
          tipo: "unknown",
          fonte: "unknown",
          nuovo: "transfer",
          movimento: "  ",
        },
        today,
      ),
    ).toEqual(view());
    expect(parseFinanceView({ conto: "  Cash  ", q: "  città  " }, today)).toMatchObject({
      account: "Cash",
      query: "  città  ",
    });
  });
});

describe("registro Finance filtrato senza riscrivere i dati", () => {
  it("normalizza gli importi italiani esatti, con e senza raggruppamento o segno", () => {
    const rows = [
      movement("out"),
      movement("in", { cents: 123_456n }),
      movement("other", { cents: -123n }),
    ];
    for (const query of ["1234,56", "1.234,56", "1 234,56 €", "1234.56"])
      expect(filterFinanceMovements(rows, view({ query })).map((row) => row.sourceId)).toEqual([
        "out",
        "in",
      ]);
    expect(filterFinanceMovements(rows, view({ query: "−1.234,56 €" }))).toEqual([rows[0]]);
    expect(filterFinanceMovements(rows, view({ query: "+1234,56" }))).toEqual([rows[1]]);
    expect(filterFinanceMovements(rows, view({ query: "1.234,567" }))).toEqual([]);
  });

  it("cerca centesimi oltre la precisione di Number senza arrotondarli", () => {
    const rows = [
      movement("exact", { cents: -9_007_199_254_740_993n }),
      movement("adjacent", { cents: -9_007_199_254_740_992n }),
    ];
    expect(filterFinanceMovements(rows, view({ query: "90.071.992.547.409,93" }))).toEqual([
      rows[0],
    ]);
  });

  it("cerca testo italiano, categoria personalizzata e conto senza mutare ordine o righe", () => {
    const rows = Object.freeze([
      Object.freeze(movement("first")),
      Object.freeze(movement("second", { account: "Conto sintetico", description: "Altra voce" })),
    ]);
    expect(filterFinanceMovements(rows, view({ query: "CITTA" }))).toEqual([rows[0]]);
    expect(filterFinanceMovements(rows, view({ query: "servizi personalizzati" }))).toEqual(rows);
    expect(filterFinanceMovements(rows, view({ query: "conto SINTETICO" }))).toEqual([rows[1]]);
    expect(rows.map((row) => row.sourceId)).toEqual(["first", "second"]);
  });

  it("vede origine e destinazione dei trasferimenti, senza classificarli come flussi", () => {
    const transfer = movement("transfer", {
      account: "Cash",
      targetAccount: "Conto sintetico",
      transfer: true,
    });
    expect(filterFinanceMovements([transfer], view({ account: "Conto sintetico" }))).toEqual([
      transfer,
    ]);
    expect(filterFinanceMovements([transfer], view({ query: "conto sintetico" }))).toEqual([
      transfer,
    ]);
    expect(filterFinanceMovements([transfer], view({ direction: "income" }))).toEqual([]);
    expect(filterFinanceMovements([transfer], view({ direction: "expense" }))).toEqual([]);
    expect(filterFinanceMovements([transfer], view({ direction: "transfer" }))).toEqual([transfer]);
  });

  it("separa consuntivi, sospesi, futuri, modificati ed eliminati", () => {
    const rows = [
      movement("posted"),
      movement("pending", { pending: true }),
      movement("future", { future: true, date: "2026-06-20" }),
      movement("pending-future", { pending: true, future: true, date: "2026-06-20" }),
      movement("edited", { revision: revision() }),
      movement("deleted", { revision: revision(true) }),
      movement("unallocated", { account: null }),
      movement("unallocated-pending", { account: null, pending: true }),
    ];
    const ids = (state: FinanceView["state"]) =>
      filterFinanceMovements(rows, view({ state })).map((row) => row.sourceId);
    expect(ids("posted")).toEqual(["posted", "edited", "unallocated"]);
    expect(ids("all")).toEqual([
      "posted",
      "pending",
      "future",
      "pending-future",
      "edited",
      "unallocated",
      "unallocated-pending",
    ]);
    expect(ids("pending")).toEqual(["pending", "pending-future", "unallocated-pending"]);
    expect(ids("future")).toEqual(["future"]);
    expect(ids("edited")).toEqual(["edited"]);
    expect(ids("deleted")).toEqual(["deleted"]);
    expect(ids("unallocated")).toEqual(["unallocated"]);
  });

  it("combina periodo, fonte, categoria e lotto dalla fonte originale", () => {
    const rows = [
      movement("imported", { source: "budgetflow", id: "budgetflow:imported" }),
      movement("custom", { category: "Categoria sintetica" }),
      movement("old", { date: "2025-06-10" }),
    ];
    const originalById = new Map([
      ["imported", { id: "imported", batchId: "synthetic-batch" } as FinanceTransaction],
    ]);
    expect(
      filterFinanceMovements(
        rows,
        view({
          source: "budgetflow",
          category: "Servizi personalizzati",
          batchId: "synthetic-batch",
        }),
        { originalById },
      ),
    ).toEqual([rows[0]]);
    expect(filterFinanceMovements(rows, view({ batchId: "missing" }), { originalById })).toEqual(
      [],
    );
    expect(filterFinanceMovements(rows, view({ category: "Categoria sintetica" }))).toEqual([
      rows[1],
    ]);
    expect(
      filterFinanceMovements(
        rows,
        view({ query: "Altra", period: "all", from: "0001-01-01", to: "9999-12-31" }),
      ),
    ).toEqual([]);
    expect(filterFinanceMovements(rows, parseFinanceView({ periodo: "all" }, today))).toHaveLength(
      3,
    );
  });
});

describe("panoramica esatta per periodo e conto", () => {
  it("riporta lo storico anche da altri anni ed esclude i movimenti successivi alla fine scelta", () => {
    const data = dashboard(
      movement("old", { date: "2025-12-31", cents: 9_007_199_254_740_993n }),
      movement("month", { date: "2026-05-12", cents: -7n }),
      movement("after", { cents: 99n }),
    );
    expect(
      financeWorkspaceSummary(data, parseFinanceView({ periodo: "previous" }, today)),
    ).toMatchObject({
      closing: 9_007_199_254_740_986n,
      asOf: "2026-05-31",
      incoming: 0n,
      outgoing: 7n,
      net: -7n,
      count: 1,
    });
  });

  it("limita il mese corrente a oggi e tiene sospesi, futuri ed eliminati fuori dai numeri", () => {
    const data = dashboard(
      movement("posted", { cents: 101n }),
      movement("pending", { cents: 202n, pending: true }),
      movement("future", { cents: 303n, future: true, date: "2026-06-20" }),
      movement("deleted", { cents: 404n, revision: revision(true) }),
    );
    expect(financeWorkspaceSummary(data, view())).toMatchObject({
      closing: 101n,
      asOf: today,
      incoming: 101n,
      outgoing: 0n,
      net: 101n,
      count: 1,
    });
    const buckets = financeWorkspaceSummary(data, view()).buckets;
    expect(buckets.reduce((sum, row) => sum + row.incoming, 0n)).toBe(101n);
    expect(buckets.find((row) => row.from === "2026-06-22")?.closing).toBeNull();
  });

  it("conta entrambe le gambe dei trasferimenti nel saldo, mai nei flussi", () => {
    const data = dashboard(
      movement("income", { cents: 2001n }),
      movement("transfer", { cents: -1001n, transfer: true, targetAccount: "Conto sintetico" }),
    );
    expect(financeWorkspaceSummary(data, view())).toMatchObject({
      closing: 2001n,
      incoming: 2001n,
      outgoing: 0n,
      count: 2,
    });
    expect(financeWorkspaceSummary(data, view({ account: "Cash" }))).toMatchObject({
      closing: 1000n,
      incoming: 2001n,
      outgoing: 0n,
    });
    expect(financeWorkspaceSummary(data, view({ account: "Conto sintetico" }))).toMatchObject({
      closing: 1001n,
      incoming: 0n,
      outgoing: 0n,
    });
    expect(financeWorkspaceSummary(data, view({ account: "missing" }))).toMatchObject({
      closing: null,
      incoming: 0n,
      outgoing: 0n,
    });
  });

  it("mantiene senza conto separati da qualsiasi totale e rende il warning verificabile", () => {
    const data = dashboard(
      movement("allocated", { cents: -101n }),
      movement("unallocated", { cents: 999n, account: null }),
      movement("unallocated-pending", { cents: 888n, account: null, pending: true }),
      movement("unallocated-old", { cents: 777n, account: null, date: "2025-01-01" }),
    );
    expect(financeWorkspaceSummary(data, view())).toMatchObject({
      closing: -101n,
      incoming: 0n,
      outgoing: 101n,
      unallocatedCount: 1,
    });
    expect(financeWorkspaceSummary(data, view({ account: "Cash" })).unallocatedCount).toBe(1);
    expect(financeWorkspaceSummary(data, view({ account: "__unallocated" }))).toMatchObject({
      closing: null,
      incoming: 0n,
      outgoing: 0n,
      count: 0,
      unallocatedCount: 1,
    });
    expect(filterFinanceMovements(data.movements, view({ state: "unallocated" }))).toHaveLength(1);
    expect(financeWorkspaceSummary(dashboard(), view()).closing).toBeNull();
  });

  it("ricostruisce i grafici di tutti i conti senza includere righe da attribuire", () => {
    const data = dashboard(
      movement("allocated-out", { cents: -101n }),
      movement("allocated-in", { cents: 202n, account: "Conto sintetico" }),
      movement("unallocated-out", { cents: -999n, account: null }),
      movement("unallocated-in", { cents: 888n, account: null }),
    );
    const summary = financeWorkspaceSummary(data, view());
    const rows = filterFinanceMovements(data.movements, view({ account: "__allocated" }));
    expect(rows.map((row) => row.sourceId)).toEqual(["allocated-out", "allocated-in"]);
    expect(rows.filter((row) => row.cents > 0n).reduce((sum, row) => sum + row.cents, 0n)).toBe(
      summary.incoming,
    );
    expect(rows.filter((row) => row.cents < 0n).reduce((sum, row) => sum - row.cents, 0n)).toBe(
      summary.outgoing,
    );
    expect(financeWorkspaceSummary(data, view({ account: "__allocated" }))).toEqual(summary);
  });

  it("usa uscite lorde per categoria anche se la stessa categoria ha un rimborso in entrata", () => {
    const data = dashboard(
      movement("expense", { cents: -1001n, category: "Produzione" }),
      movement("reimbursement", { cents: 302n, category: "Produzione" }),
      movement("refund", { cents: -203n, category: "Vendite", source: "refund" }),
      movement("uncategorized", { cents: -5n, category: "" }),
    );
    const summary = financeWorkspaceSummary(data, view());
    expect(summary).toMatchObject({ incoming: 302n, outgoing: 1209n, net: -907n });
    expect(summary.expenses).toEqual([
      { category: "Produzione", cents: 1001n, count: 1 },
      { category: "Vendite", cents: 203n, count: 1 },
      { category: "Senza categoria", cents: 5n, count: 1 },
    ]);
    expect(summary.expenses.reduce((sum, row) => sum + row.cents, 0n)).toBe(summary.outgoing);
  });

  it("non dipende da ricerca, filtri del registro o movimento selezionato", () => {
    const data = dashboard(movement("expense"));
    expect(
      financeWorkspaceSummary(
        data,
        view({
          query: "inesistente",
          state: "deleted",
          direction: "income",
          category: "Altro",
          source: "refund",
          batchId: "missing",
          movementId: "missing",
        }),
      ),
    ).toEqual(financeWorkspaceSummary(data, view()));
  });

  it("produce settimane contigue e drilldown che ricostruiscono ogni importo esatto", () => {
    const data = dashboard(
      movement("first", { date: "2026-06-01", cents: 101n }),
      movement("second", { date: "2026-06-07", cents: -202n }),
      movement("third", { date: "2026-06-08", cents: -303n }),
      movement("future", { date: "2026-06-29", cents: -999n, future: true }),
    );
    const summary = financeWorkspaceSummary(data, view());
    expect(summary.buckets.map((bucket) => [bucket.from, bucket.to])).toEqual([
      ["2026-06-01", "2026-06-07"],
      ["2026-06-08", "2026-06-14"],
      ["2026-06-15", "2026-06-21"],
      ["2026-06-22", "2026-06-28"],
      ["2026-06-29", "2026-06-30"],
    ]);
    for (const bucket of summary.buckets) {
      const rows = filterFinanceMovements(
        data.movements,
        view({ period: "custom", from: bucket.from, to: bucket.to }),
      );
      expect(
        rows
          .filter((row) => !row.transfer && row.cents > 0n)
          .reduce((sum, row) => sum + row.cents, 0n),
      ).toBe(bucket.incoming);
      expect(
        rows
          .filter((row) => !row.transfer && row.cents < 0n)
          .reduce((sum, row) => sum - row.cents, 0n),
      ).toBe(bucket.outgoing);
    }
    expect(summary.buckets.reduce((sum, bucket) => sum + bucket.outgoing, 0n)).toBe(
      summary.outgoing,
    );
  });

  it("produce mesi per l’anno e intervalli lunghi con estremi personalizzati esatti", () => {
    const data = dashboard(movement("posted", { cents: 101n }));
    const year = financeWorkspaceSummary(data, parseFinanceView({ periodo: "year" }, today));
    expect(year.buckets).toHaveLength(12);
    expect(year.buckets[1]).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(year.buckets[5]).toMatchObject({ label: "giugno", closing: 101n });
    expect(year.buckets[6].closing).toBeNull();
    const custom = financeWorkspaceSummary(
      data,
      view({ period: "custom", from: "2026-02-11", to: "2026-05-03" }),
    );
    expect(custom.buckets[0]).toMatchObject({ from: "2026-02-11", to: "2026-02-28" });
    expect(custom.buckets.at(-1)).toMatchObject({ from: "2026-05-01", to: "2026-05-03" });
  });

  it("limita tutti i periodi allo storico disponibile per i grafici", () => {
    const data = dashboard(movement("old", { date: "2025-12-31", cents: 101n }));
    const summary = financeWorkspaceSummary(data, parseFinanceView({ periodo: "all" }, today));
    expect(summary.buckets).toHaveLength(7);
    expect(summary.buckets[0]).toMatchObject({
      from: "2025-12-31",
      to: "2025-12-31",
      incoming: 101n,
    });
    expect(summary.buckets.at(-1)).toMatchObject({ to: today, closing: 101n });
  });
});

describe("regressioni della revisione di integrazione", () => {
  it("conserva lo spazio durante la digitazione di una ricerca composta", () => {
    let current = view();
    for (const query of ["campioni", "campioni ", "campioni sintetici"]) {
      current = parseFinanceView(
        new URL(financeViewHref({ ...current, query }), "https://synthetic.invalid").searchParams,
        today,
      );
      expect(current.query).toBe(query);
    }
    expect(
      filterFinanceMovements([movement("a", { description: "Campioni sintetici" })], current),
    ).toHaveLength(1);
  });
  it("mantiene recuperabili gli eliminati legacy senza una revisione P4", () => {
    const legacy = movement("legacy");
    expect(
      filterFinanceMovements([legacy], view({ state: "deleted" }), {
        deletedIds: new Set([legacy.id]),
      }),
    ).toEqual([legacy]);
    expect(filterFinanceMovements([legacy], view(), { deletedIds: new Set([legacy.id]) })).toEqual(
      [],
    );
  });
  it("il drill storico del saldo non genera millenni di bucket vuoti", () => {
    const ledger = dashboard(movement("a", { cents: 100n }));
    const result = financeWorkspaceSummary(
      ledger,
      view({ period: "custom", from: "0001-01-01", to: today }),
    );
    expect(result.closing).toBe(100n);
    expect(result.buckets.length).toBeLessThan(10);
    expect(result.buckets.reduce((sum, bucket) => sum + bucket.incoming, 0n)).toBe(100n);
  });
  it("raggruppa i range di calendario molto lunghi senza perdere flussi", () => {
    const result = financeWorkspaceSummary(
      dashboard(movement("a", { cents: -700n })),
      view({ period: "custom", from: "1900-01-01", to: "9998-12-31" }),
    );
    expect(result.buckets.length).toBeLessThanOrEqual(120);
    expect(result.buckets[0].from).toBe("1900-01-01");
    expect(result.buckets.at(-1)?.to).toBe("9998-12-31");
    expect(result.buckets.reduce((sum, bucket) => sum + bucket.outgoing, 0n)).toBe(700n);
  });
});
