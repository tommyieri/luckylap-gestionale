import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FinanceWorkspace } from "./finance-workspace";
import type { FinanceMovement } from "../../lib/finance/dashboard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./finance-movement-panel", () => ({ FinanceMovementPanel: () => null }));
vi.mock("./finance-new-movement", () => ({
  FinanceNewMovement: () => <p>Modulo nuovo movimento</p>,
}));
vi.mock("../finance-work-form", () => ({
  FinanceWorkRecovery: ({ activeScopes }: { activeScopes: string[] }) => (
    <p>{activeScopes.length ? "Recupero nel modulo" : "Tentativi recuperabili fuori dal modulo"}</p>
  ),
}));

const rows: FinanceMovement[] = [
  {
    id: "manual:97000000-0000-4000-8000-000000000001",
    source: "manual",
    sourceId: "97000000-0000-4000-8000-000000000001",
    date: "2026-11-03",
    cents: -2490n,
    account: "Conto prova",
    targetAccount: null,
    category: "Produzione",
    description: "Campioni sintetici",
    pending: false,
    future: false,
    transfer: false,
    allocationNote: null,
  },
  {
    id: "manual:97000000-0000-4000-8000-000000000002",
    source: "manual",
    sourceId: "97000000-0000-4000-8000-000000000002",
    date: "2025-03-02",
    cents: 50000n,
    account: "Conto prova",
    targetAccount: null,
    category: "Vendite",
    description: "Incasso sintetico storico",
    pending: false,
    future: false,
    transfer: false,
    allocationNote: null,
  },
];
const props = {
  dashboard: {
    movements: rows,
    accounts: [{ name: "Conto prova", posted: 47510n, pending: 0n, future: 0n, count: 2 }],
    years: [2026, 2025],
    reportDate: "2026-11-09",
  },
  deletedMovements: [],
  snapshot: { batches: [], transactions: [] },
  reportDate: "2026-11-09",
  names: {},
  actorId: "97000000-0000-4000-8000-000000000099",
  readOnly: true,
  consignment: <p>Resoconti sintetici</p>,
};

describe("Finance come spazio di lavoro", () => {
  it("apre sulla panoramica con tre valori, grafici e azione diretta", () => {
    const html = renderToStaticMarkup(<FinanceWorkspace {...props} />);
    expect(html).toContain("Saldo dai movimenti");
    expect(html).toContain("Entrate registrate");
    expect(html).toContain("Uscite registrate");
    expect(html).toContain("Dove spendiamo");
    expect(html).toContain("Nuovo movimento");
    expect(html).not.toContain("Nuova voce manuale");
    expect(html).not.toContain("Resoconti sintetici");
  });
  it("cerca nello storico quando sono selezionati tutti i periodi e mette la descrizione prima della categoria", () => {
    const html = renderToStaticMarkup(
      <FinanceWorkspace
        {...props}
        initialParams={{ vista: "movements", periodo: "all", q: "storico" }}
      />,
    );
    expect(html).toContain("Incasso sintetico storico");
    expect(html).not.toContain("Campioni sintetici");
    expect(html.indexOf("Incasso sintetico storico")).toBeLessThan(html.lastIndexOf("Vendite"));
    expect(html).toContain("Tutti i periodi");
    expect(html).toContain("Cerca movimenti");
  });
  it("separa i resoconti dai movimenti e conserva un ingresso secondario alle fonti", () => {
    const html = renderToStaticMarkup(
      <FinanceWorkspace {...props} initialParams={{ vista: "receivables" }} />,
    );
    expect(html).toContain("Resoconti sintetici");
    expect(html).toContain("Documenti e fonti");
    expect(html).not.toContain("Campioni sintetici");
  });
});

it("il recupero dei tentativi incerti resta visibile con Nuovo movimento chiuso", () => {
  const closed = renderToStaticMarkup(<FinanceWorkspace {...props} readOnly={false} />);
  expect(closed).toContain("Tentativi recuperabili fuori dal modulo");
  const opened = renderToStaticMarkup(
    <FinanceWorkspace {...props} readOnly={false} initialParams={{ nuovo: "expense" }} />,
  );
  expect(opened).toContain("Recupero nel modulo");
});
