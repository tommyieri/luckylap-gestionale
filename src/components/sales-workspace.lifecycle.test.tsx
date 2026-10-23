import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SalesSnapshot } from "../lib/sales/model";

const view = vi.hoisted(() => ({ filter: "active" }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => actual.useState(initial === "active" ? view.filter : initial),
  };
});
vi.mock("@/lib/sales/model", () => import("../lib/sales/model"));
vi.mock("@/lib/sales/forms", () => import("../lib/sales/forms"));
vi.mock("./sales-command-form", () => ({
  SalesCommandForm: ({ kind, children }: { kind: string; children: ReactNode }) => (
    <form data-command-kind={kind}>{children}</form>
  ),
}));
vi.mock("./sales-pending-recovery", () => ({ SalesPendingRecovery: () => null }));
vi.mock("./sales-new-sale", () => ({
  NewSaleFields: () => null,
  PaymentMethodField: () => null,
  SaleTimeField: () => null,
}));
vi.mock("./sale-registration-cancellation", () => ({
  SaleRegistrationCancellation: ({
    orderId,
    alreadyCancelled,
  }: {
    orderId: string;
    alreadyCancelled?: boolean;
  }) =>
    alreadyCancelled ? (
      <p data-cancelled-order={orderId}>Registrazione annullata</p>
    ) : (
      <button data-cancel-order={orderId}>Annulla registrazione</button>
    ),
}));
vi.mock("./sale-return-form", () => ({
  SaleReturnForm: ({ orderId }: { orderId: string }) => (
    <button data-return-order={orderId}>Registra reso</button>
  ),
}));

import { SalesWorkspace } from "./sales-workspace";
import { salesSnapshotFromRows } from "../lib/sales/read";
import { externalSyntheticRows, syntheticId, syntheticRows } from "../lib/sales/fixtures";
const member = {
  userId: syntheticId(10),
  displayName: "Membro sintetico",
  role: "founder" as const,
  financeAccess: true,
};
function delivered(external = false, channel = "shopify_web") {
  const snapshot = salesSnapshotFromRows(
    external ? externalSyntheticRows(channel) : syntheticRows(),
  );
  snapshot.enabled = true;
  snapshot.requirements = [];
  snapshot.orders[0] = {
    ...snapshot.orders[0],
    fulfillmentState: "fulfilled",
    paymentState: "paid",
    effectiveAmountDueCents: 0,
    lines: snapshot.orders[0].lines.map((line) => ({
      ...line,
      fulfilled: line.quantity,
      reserved: 0,
    })),
  };
  return snapshot;
}
type Props = Parameters<typeof SalesWorkspace>[0];
const render = (snapshot: SalesSnapshot, overrides: Partial<Props> = {}) =>
  renderToStaticMarkup(
    <SalesWorkspace
      snapshot={snapshot}
      member={member}
      now="2026-10-22T12:00:00Z"
      {...overrides}
    />,
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
function orderSection(html: string, orderId: string) {
  const start = html.indexOf(`<details id="order-${orderId}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  return html.slice(start);
}
function orderSummary(html: string, orderId: string) {
  const section = orderSection(html, orderId);
  return text(section.slice(0, section.indexOf("</summary>")));
}
beforeEach(() => {
  view.filter = "active";
});

describe("ciclo vendita visibile: annullamento e resi", () => {
  it("offre i due comandi distinti sulla vendita manuale consegnata, senza riproporre consegna o incasso", () => {
    const snapshot = delivered(),
      orderId = snapshot.orders[0].id;
    const html = render(snapshot),
      order = orderSection(html, orderId);
    expect(order).toContain(`data-cancel-order="${orderId}"`);
    expect(order).toContain(`data-return-order="${orderId}"`);
    expect(order).not.toContain('data-command-kind="record_manual_payment"');
    expect(order).not.toContain('data-command-kind="fulfill_order_lines"');
    expect(orderSummary(html, orderId)).toContain("Consegnata");
    expect(orderSummary(html, orderId)).toContain("80,02");
  });

  it.each(["shopify_web", "shopify_pos"])(
    "lascia annulli, resi, incassi e consegne %s alla loro fonte",
    (channel) => {
      const snapshot = delivered(true, channel),
        html = render(snapshot),
        orderId = snapshot.orders[0].id;
      const order = orderSection(html, orderId);
      expect(order).toContain(
        "Arriva da Shopify: consegne, annulli e pagamenti si aggiornano da soli.",
      );
      expect(order).not.toContain("Annulla registrazione");
      expect(order).not.toContain("Registra reso");
      for (const kind of [
        "record_manual_payment",
        "fulfill_order_lines",
        "cancel_unfulfilled_lines",
      ])
        expect(order).not.toContain(`data-command-kind="${kind}"`);
    },
  );

  it("nasconde la registrazione annullata dall’elenco attivo e conserva lo storico nei filtri dedicati", () => {
    const snapshot = delivered(),
      orderId = snapshot.orders[0].id;
    snapshot.orders[0] = {
      ...snapshot.orders[0],
      orderState: "cancelled",
      fulfillmentState: "cancelled",
      cancelledCents: snapshot.orders[0].totalCents,
      lines: snapshot.orders[0].lines.map((line) => ({
        ...line,
        fulfilled: 0,
        cancelled: line.quantity,
      })),
    };
    const props = { cancelledRegistrationIds: [orderId] };
    const active = render(snapshot, props);
    expect(active).not.toContain(`id="order-${orderId}"`);
    expect(text(active)).toContain("Nessuna registrazione attiva corrisponde alla ricerca");
    for (const filter of ["cancelled", "all"]) {
      view.filter = filter;
      const html = render(snapshot, props),
        order = orderSection(html, orderId);
      expect(order).toContain(`data-cancelled-order="${orderId}"`);
      expect(text(order)).toContain("Registrazione annullata");
      expect(order).not.toContain("Registra reso");
      expect(order).not.toContain('data-command-kind="record_manual_payment"');
      expect(order).not.toContain("Incassi rettificati in Finance");
      expect(orderSummary(html, orderId)).toContain("0,00");
    }
  });

  it.each([
    {
      state: "partially_returned",
      payment: "partially_refunded",
      quantity: 1,
      refunded: 4001,
      residual: "40,01",
      label: "Reso parziale",
    },
    {
      state: "returned",
      payment: "refunded",
      quantity: 2,
      refunded: 8002,
      residual: "0,00",
      label: "Reso totale",
    },
  ])(
    "mostra quantità, valore e residuo del caso $state senza riaprire attività concluse",
    ({ state, payment, quantity, refunded, residual, label }) => {
      const snapshot = delivered(),
        orderId = snapshot.orders[0].id;
      snapshot.orders[0] = {
        ...snapshot.orders[0],
        orderState: state,
        fulfillmentState: state,
        paymentState: payment,
      };
      const props = {
        returnSummaries: [{ orderId, productQuantity: quantity, refundCents: refunded }],
      };
      view.filter = "returned";
      const html = render(snapshot, props),
        order = text(orderSection(html, orderId));
      expect(order).toContain(
        `Resi ${quantity} capi · Valore reso ${quantity === 1 ? "40,01" : "80,02"} € · Valore residuo ${residual} €`,
      );
      expect(orderSummary(html, orderId)).toContain(label);
      expect(orderSummary(html, orderId)).toContain(residual);
      expect(order).not.toContain("Registra una consegna");
      expect(order).not.toContain("Registra il saldo da incassare");
      view.filter = "open";
      const open = render(snapshot, props);
      expect(open).not.toContain(`id="order-${orderId}"`);
    },
  );
});
