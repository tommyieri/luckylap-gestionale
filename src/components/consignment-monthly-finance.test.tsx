import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/finance/model", () => import("../lib/finance/model"));
vi.mock("@/lib/finance/dashboard", () => import("../lib/finance/dashboard"));
vi.mock("@/lib/finance/categories", () => import("../lib/finance/categories"));
vi.mock("@/lib/finance-work/model", () => import("../lib/finance-work/model"));
vi.mock("@/lib/finance-work/pending", () => import("../lib/finance-work/pending"));
vi.mock("@/app/finance/work/actions", () => ({ runFinanceWork: vi.fn() }));

import { ConsignmentMonthlyFinance, FinancePreviewNotice } from "./consignment-monthly-finance";
import { FinanceImportsView } from "./finance-imports-view";
import { FinanceWorkForm } from "./finance-work-form";
import {
  dashboardShopPaymentsFromRows,
  monthlyFinanceFromRows,
} from "../lib/consignment/shop-finance";
import { shopFinanceRows, sx } from "../lib/consignment/shop-fixtures";
import type { ConsignmentFinanceSnapshot } from "../lib/consignment/finance";

const NOW = "2026-10-22T10:00:00.000Z";
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const finance = (mutate?: (rows: ReturnType<typeof shopFinanceRows>) => void) => {
  const rows = shopFinanceRows();
  mutate?.(rows);
  return monthlyFinanceFromRows(rows.reports, rows.payments, rows.locations, NOW);
};
const legacy: ConsignmentFinanceSnapshot = {
  loadedAt: NOW,
  rows: [
    {
      saleId: "94000000-0000-4000-8000-000000000900",
      occurredAt: "2026-10-05T10:00:00Z",
      shopId: sx.shop,
      shopLabel: "Negozio sintetico",
      sku: "SYN-GT3RS-BLU-M",
      quantity: 2,
      reference: "SYN-1",
      grossCents: 11000,
      brandClaimCents: 6600,
      shopShareCents: 4400,
      settledCents: 1000,
      remainingCents: 5600,
      overpaidCents: 0,
    },
  ],
};

describe("pannello «Conto vendita · da incassare»", () => {
  it("una riga per resoconto e un solo totale in alto: la somma dei residui", () => {
    const html = renderToStaticMarkup(<ConsignmentMonthlyFinance snapshot={finance()} />);
    const t = text(html);
    expect(t).toContain("Conto vendita · da incassare");
    expect(t).toMatch(/Da incassare 84,99\s€ 1 resoconto aperto/);
    expect(t).toContain("Negozio sintetico");
    expect(t).toContain("Negozio sintetico chiuso");
    expect(t).toContain("Settembre 2026 · 4 pezzi · Incasso del negozio 224,99 €");
    expect(t).toContain("Da fatturare 134,99 € · Fattura n. 12 del 3 ottobre 2026");
    expect(t).toContain("Incassato 50,00 €");
    expect(t).toContain("Pagata in parte");
    expect(html).toContain('href="/consignment/NEG01/resoconto/2026-09"');
    expect(html).toContain('href="/consignment/NEG03/resoconto/2026-09"');
    expect(html).toContain('id="conto-vendita-da-incassare"');
    // Il mese pagato ha il segno verde «fatto»; quello aperto mostra l'anno.
    expect(html.match(/>fatto</g)).toHaveLength(1);
    expect(t).toContain("Importi commerciali. Il trattamento IVA va verificato a parte.");
  });

  it("fattura da emettere in ambra, pagamento in più da controllare", () => {
    const due = finance((rows) => {
      Object.assign(rows.reports[0], {
        invoice_number: null,
        invoice_date: null,
        invoice_revision: null,
        payment_state: "unpaid",
      });
      rows.payments.splice(0, rows.payments.length);
      Object.assign(rows.reports[1], { payment_state: "unpaid" });
    });
    const t = text(renderToStaticMarkup(<ConsignmentMonthlyFinance snapshot={due} />));
    expect(t).toContain("Fattura da emettere");
    expect(t).toContain("2 resoconti aperti");
    expect(t).toMatch(/Da incassare 167,99\s€/);

    const over = finance((rows) => {
      rows.payments[0].amount_cents = 15000;
      const reports = rows.reports as Record<string, unknown>[];
      reports.find((r) => r.id === sx.september)!.payment_state = "overpaid";
    });
    const html = renderToStaticMarkup(<ConsignmentMonthlyFinance snapshot={over} />);
    expect(text(html)).toContain("15,01 € in più");
    expect(html).toContain(">controlla<");
    expect(text(html)).toContain("Nessun resoconto aperto");
  });

  it("vuoto: nessun resoconto, nessun totale inventato", () => {
    const t = text(
      renderToStaticMarkup(
        <ConsignmentMonthlyFinance snapshot={{ rows: [], toCollectCents: 0, loadedAt: NOW }} />,
      ),
    );
    expect(t).toContain("Nessun resoconto registrato.");
    expect(t).toMatch(/Da incassare 0,00\s€ Nessun resoconto aperto/);
  });

  it("le vendite del modulo precedente compaiono solo se esistono", () => {
    const without = text(
      renderToStaticMarkup(
        <ConsignmentMonthlyFinance snapshot={finance()} legacy={{ rows: [], loadedAt: NOW }} />,
      ),
    );
    expect(without).not.toContain("Vendite registrate prima del resoconto mensile");
    const t = text(
      renderToStaticMarkup(<ConsignmentMonthlyFinance snapshot={finance()} legacy={legacy} />),
    );
    expect(t).toContain("Vendite registrate prima del resoconto mensile 1");
    expect(t).toContain("SYN-GT3RS-BLU-M");
    expect(t).toContain("66,00 €");
    expect(t).toContain("56,00 €");
  });

  it("nessuna parola vietata, nessun id a vista", () => {
    const html = renderToStaticMarkup(
      <>
        <FinancePreviewNotice />
        <ConsignmentMonthlyFinance snapshot={finance()} legacy={legacy} />
      </>,
    );
    expect(text(html)).not.toMatch(
      /affid|rientr|vendit[ae] dichiarat|regolament|credito commerciale|centesimi/i,
    );
    expect(text(html)).not.toContain(sx.september);
    expect(text(html)).toContain("Anteprima locale: dati sintetici, salvataggio disattivato.");
  });
});

describe("pagamenti del negozio nella panoramica Finance", () => {
  it("solo il denaro ricevuto entra nei saldi; il pannello sta prima dei movimenti", () => {
    const rows = shopFinanceRows();
    const html = renderToStaticMarkup(
      <FinanceImportsView
        snapshot={{ batches: [], transactions: [] }}
        shopPayments={dashboardShopPaymentsFromRows(rows.payments, rows.reports, rows.locations)}
        consignment={<ConsignmentMonthlyFinance snapshot={finance()} />}
        reportDate="2026-10-22"
        displayName="Synthetic"
      />,
    );
    // Conto indicato: 50,00 €; contanti senza conto: «Cash» 33,00 €. Mai 134,99 € da fatturare.
    const accounts = html.slice(0, html.indexOf('id="finance-trend-title"'));
    expect(accounts).toContain("Conto sintetico");
    expect(accounts).toContain("50,00 €");
    expect(accounts).toContain("Cash");
    expect(accounts).toContain("33,00 €");
    expect(accounts).toContain("83,00 €");
    expect(accounts).not.toContain("134,99");
    expect(html).toContain('href="#conto-vendita-da-incassare"');
    expect(html.indexOf('id="conto-vendita-da-incassare"')).toBeLessThan(
      html.indexOf('id="finance-transactions"'),
    );
    expect(html).toContain(`id="movimento-shop_payment-${sx.payment}"`);
    expect(html).toContain(`id="movimento-shop_payment-${sx.closedPayment}"`);
    expect(html).not.toContain(`movimento-shop_payment-${sx.voidedPayment}`);
    expect(text(html)).toContain("Pagamento del negozio");
  });

  it("senza pannello la panoramica resta com'era", () => {
    const html = renderToStaticMarkup(
      <FinanceImportsView
        snapshot={{ batches: [], transactions: [] }}
        reportDate="2026-10-22"
        displayName="Synthetic"
      />,
    );
    expect(html).not.toContain("conto-vendita-da-incassare");
    expect(html).not.toContain("Pagamento del negozio");
  });
});

describe("modulo della voce manuale", () => {
  it("avvisa di non registrare qui gli incassi del conto vendita", () => {
    const form = (kind: "record_finance_entry" | "void_finance_entry") =>
      text(
        renderToStaticMarkup(
          <FinanceWorkForm
            userId={sx.user}
            scope="record"
            kind={kind}
            label="Registra"
            build={() => ({})}
          >
            <span>campi</span>
          </FinanceWorkForm>,
        ),
      );
    expect(form("record_finance_entry")).toContain(
      "Gli incassi del conto vendita si registrano dal resoconto del negozio: non inserirli anche qui.",
    );
    expect(form("void_finance_entry")).not.toContain("conto vendita");
  });
});
