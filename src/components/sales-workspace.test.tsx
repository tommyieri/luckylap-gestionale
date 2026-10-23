import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/sales/model", () => import("../lib/sales/model"));
vi.mock("@/lib/sales/forms", () => import("../lib/sales/forms"));
// Nomi ricevuti da ogni modulo e dal recupero degli invii (06 R4).
const received = vi.hoisted(() => ({
  forms: [] as { kind: string; names?: SalesAttemptNames }[],
  recovery: [] as (SalesAttemptNames | undefined)[],
}));
vi.mock("./sales-command-form", () => ({
  SalesCommandForm: ({
    kind,
    enabled,
    names,
    children,
  }: {
    kind: string;
    enabled: boolean;
    names?: SalesAttemptNames;
    children: ReactNode;
  }) => {
    received.forms.push({ kind, names });
    return (
      <form data-command-kind={kind} data-enabled={enabled}>
        {children}
      </form>
    );
  },
}));
vi.mock("./sales-pending-recovery", () => ({
  SalesPendingRecovery: ({
    activeScopes,
    names,
  }: {
    activeScopes: string[];
    names?: SalesAttemptNames;
  }) => {
    received.recovery.push(names);
    return <aside data-active-scopes={activeScopes.join(",")} />;
  },
}));
vi.mock("./sale-registration-cancellation", () => ({
  SaleRegistrationCancellation: () => <button>Annulla registrazione</button>,
}));
vi.mock("./sale-return-form", () => ({ SaleReturnForm: () => <button>Registra reso</button> }));
import { SalesWorkspace } from "./sales-workspace";
import { salesSnapshotFromRows } from "../lib/sales/read";
import { externalSyntheticRows, syntheticId, syntheticRows } from "../lib/sales/fixtures";
import { money } from "../lib/sales/model";
import type { SalesAttemptNames } from "../lib/sales/attempt";
import type { MemberRole } from "../lib/auth/model";
const member = {
  userId: "80000000-0000-4000-8000-000000000010",
  displayName: "Synthetic",
  role: "founder" as const,
  financeAccess: true,
};
const render = (rows: ReturnType<typeof syntheticRows>, role: MemberRole = member.role) =>
  renderToStaticMarkup(
    <SalesWorkspace
      snapshot={salesSnapshotFromRows(rows)}
      member={{ ...member, role }}
      now="2026-10-21T12:00:00Z"
    />,
  );
describe("Shopify order controls and visible provenance", () => {
  it.each(["shopify_web", "shopify_pos"])(
    "renders %s operational amounts and source without manual source mutations",
    (channel) => {
      const html = render(externalSyntheticRows(channel));
      expect(html).toContain(channel === "shopify_pos" ? "Shopify POS" : "Shopify · Online");
      expect(html).toContain("Ordine Shopify 100");
      expect(html).toContain("Arriva da Shopify");
      expect(html).toContain("Incasso parziale Shopify");
      expect(html).toContain("90,02");
      expect(html).toContain('data-command-kind="complete_production" data-enabled="true"');
      for (const kind of [
        "record_manual_payment",
        "fulfill_order_lines",
        "cancel_unfulfilled_lines",
      ])
        expect(html).not.toContain(`data-command-kind="${kind}"`);
      expect(html).not.toContain("payment:80000000");
      expect(html).not.toContain("fulfill:80000000");
      expect(html).not.toContain("cancel:80000000");
    },
  );
  it("preserves manual payment, fulfillment and cancellation controls", () => {
    const html = render(syntheticRows());
    for (const kind of ["record_manual_payment", "fulfill_order_lines", "cancel_unfulfilled_lines"])
      expect(html).toContain(`data-command-kind="${kind}"`);
    expect(html).not.toContain("Incasso osservato su Shopify");
  });
  it.each(["founder", "production", "logistics", "finance", "consultant"] as const)(
    "keeps production access aligned with current role %s",
    (role) => {
      const html = render(externalSyntheticRows(), role);
      expect(html.includes('data-command-kind="complete_production"')).toBe(
        ["founder", "production"].includes(role),
      );
    },
  );
  it("keeps the maximum odd cent exact for operational prices", () => {
    expect(money(8999999999999999)).toBe("89.999.999.999.999,99\u00a0€");
    expect(money(-8999999999999999n)).toBe("-89.999.999.999.999,99\u00a0€");
  });
});

it("shows a corrected residual, permits the remaining manual collection, and preserves Shopify source status", () => {
  const snapshot = salesSnapshotFromRows(syntheticRows());
  snapshot.orders[0] = {
    ...snapshot.orders[0],
    paymentState: "partially_paid",
    sourcePaymentState: "paid",
    effectiveAmountDueCents: 2500,
    paymentCorrected: true,
  };
  const html = renderToStaticMarkup(
    <SalesWorkspace snapshot={snapshot} member={member} now="2026-10-22T12:00Z" />,
  );
  expect(html).toContain("Incassi rettificati in Finance");
  expect(html).toContain('value="25,00"');
  expect(html).toContain('data-command-kind="record_manual_payment"');
  const external = salesSnapshotFromRows(externalSyntheticRows());
  external.orders[0] = {
    ...external.orders[0],
    paymentState: "unpaid",
    sourcePaymentState: "paid",
    effectiveAmountDueCents: 1234,
    paymentCorrected: true,
  };
  const shop = renderToStaticMarkup(
    <SalesWorkspace snapshot={external} member={member} now="2026-10-22T12:00Z" />,
  );
  expect(shop).toContain("Stato osservato su Shopify: Incasso osservato su Shopify");
  expect(shop).not.toContain('data-command-kind="record_manual_payment"');
});

describe("invii da verificare con i nomi della pagina (06 R4)", () => {
  it("i cinque moduli e il recupero ricevono articoli e ordini con il loro nome", () => {
    received.forms.length = 0;
    received.recovery.length = 0;
    const rows = syntheticRows();
    Object.assign(rows.orders[0] as Record<string, unknown>, {
      external_reference: "VENDITA-SINTETICA-7",
    });
    render(rows);
    expect(received.forms.map((form) => form.kind).sort()).toEqual([
      "cancel_unfulfilled_lines",
      "complete_production",
      "fulfill_order_lines",
      "record_manual_payment",
      "register_manual_sale",
    ]);
    const article = "Synthetic tee · Synthetic · M";
    for (const names of [...received.forms.map((form) => form.names), ...received.recovery]) {
      expect(names?.item?.(syntheticId(1))).toBe(article);
      expect(names?.order?.(syntheticId(3))).toBe("VENDITA-SINTETICA-7");
      expect(names?.orderLine?.(syntheticId(5))).toBe(article);
      expect(names?.requirement?.(syntheticId(6))).toBe(`${article}, VENDITA-SINTETICA-7`);
    }
    expect(received.recovery).toHaveLength(1);
  });
});

describe("testi senza gergo (06 R10)", () => {
  it("produzione, origine Shopify, colonne e piè di pagina in parole semplici", () => {
    const html = render(syntheticRows());
    const start = html.indexOf('aria-labelledby="sales-production"'),
      production = html.slice(start, html.indexOf("</section>", start));
    expect(production).toContain("1 capo da produrre");
    expect(production).toContain("Richiesti 1 · Completati 0 · Annullati 0.");
    expect(production).not.toMatch(/fabbisogn/i);
    expect(html).toContain("L’annullo libera i capi riservati e toglie quelli ancora da produrre.");
    expect(html).toContain("<th>Prezzo, costo e margine</th>");
    expect(html).toContain("Questi numeri non sono il saldo della banca.");
    // I testi sostituiti non tornano: lo controlla anche src/lib/ui-copy.test.ts.
    const shop = render(externalSyntheticRows());
    expect(shop).toContain(
      "Arriva da Shopify: consegne, annulli e pagamenti si aggiornano da soli.",
    );
    expect(shop).not.toMatch(/account tecnico/i);
  });

  it("senza capi da produrre lo dice senza gergo", () => {
    const snapshot = salesSnapshotFromRows(syntheticRows());
    snapshot.requirements = [];
    const html = renderToStaticMarkup(
      <SalesWorkspace snapshot={snapshot} member={member} now="2026-10-22T12:00Z" />,
    );
    expect(html).toContain("0 capi da produrre");
    expect(html).toContain("Nessun capo da produrre.");
    expect(html).not.toContain("Nessun fabbisogno");
  });
});
