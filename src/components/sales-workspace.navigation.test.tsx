import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  effects: [] as (() => void | (() => void))[],
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = initial;
    return [
      mocks.states[index],
      (value: unknown) => {
        mocks.states[index] = value;
      },
    ];
  },
  useEffect: (effect: () => void | (() => void)) => {
    mocks.effects.push(effect);
  },
}));
vi.mock("@/lib/sales/model", () => import("../lib/sales/model"));
vi.mock("@/lib/sales/forms", () => import("../lib/sales/forms"));
vi.mock("./sales-command-form", () => ({
  SalesCommandForm: ({ children }: { children: ReactNode }) => <form>{children}</form>,
}));
vi.mock("./sales-pending-recovery", () => ({ SalesPendingRecovery: () => null }));
vi.mock("./sales-new-sale", () => ({
  NewSaleFields: () => null,
  PaymentMethodField: () => null,
  SaleTimeField: () => null,
}));
import { SalesWorkspace } from "./sales-workspace";
import { salesSnapshotFromRows } from "../lib/sales/read";
import { syntheticRows, syntheticId } from "../lib/sales/fixtures";
import type { SalesSnapshot } from "../lib/sales/model";
const member = {
  userId: syntheticId(10),
  displayName: "Membro sintetico",
  role: "founder" as const,
  financeAccess: true,
};
const render = (snapshot: SalesSnapshot) => {
  mocks.index = 0;
  mocks.effects = [];
  return renderToStaticMarkup(SalesWorkspace({ snapshot, member, now: "2026-10-22T12:00Z" }));
};
beforeEach(() => {
  mocks.states = [];
  mocks.index = 0;
  mocks.effects = [];
});
afterEach(() => vi.unstubAllGlobals());
describe("navigazione al dettaglio e residui rettificati", () => {
  it("rende e apre il ventunesimo ordine richiamato da Oggi, ripulendo i filtri precedenti", () => {
    const snapshot = salesSnapshotFromRows(syntheticRows()),
      original = snapshot.orders[0];
    snapshot.orders = Array.from({ length: 21 }, (_, index) => ({
      ...original,
      id: syntheticId(100 + index),
      operationId: syntheticId(200 + index),
    }));
    const target = snapshot.orders[20].id;
    mocks.states[0] = "ricerca precedente";
    mocks.states[1] = "open";
    const browser = Object.assign(new EventTarget(), {
      location: {
        hash: `#order-${target}`,
        href: `https://example.invalid/sales#order-${target}`,
        origin: "https://example.invalid",
        pathname: "/sales",
      },
    });
    class SyntheticDetails {
      open = false;
      scrollIntoView = vi.fn();
    }
    const details = new SyntheticDetails();
    vi.stubGlobal("HTMLDetailsElement", SyntheticDetails);
    vi.stubGlobal("window", browser);
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), { getElementById: vi.fn(() => details) }),
    );
    render(snapshot);
    const cleanup = mocks.effects[0]();
    expect(mocks.states[0]).toBe("");
    expect(mocks.states[1]).toBe("all");
    expect(mocks.states[2]).toBe(1);
    const html = render(snapshot);
    expect(html).toMatch(new RegExp(`<details[^>]*id="order-${target}"[^>]*open=""`));
    mocks.effects[1]();
    expect(details.open).toBe(true);
    expect(details.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      block: "start",
      behavior: "instant",
    });
    if (typeof cleanup === "function") cleanup();
  });
  it.each(["partially_refunded", "refunded"])(
    "mantiene nel filtro da incassare un ordine consegnato %s con saldo efficace positivo",
    (paymentState) => {
      const snapshot = salesSnapshotFromRows(syntheticRows());
      snapshot.orders[0] = {
        ...snapshot.orders[0],
        fulfillmentState: "fulfilled",
        paymentState,
        paymentCorrected: true,
        effectiveAmountDueCents: 2500,
      };
      mocks.states[1] = "open";
      expect(render(snapshot)).toContain(`id="order-${snapshot.orders[0].id}"`);
    },
  );
  it("mantiene il filtro Shopify osservato quando il saldo non è noto, senza offrire un incasso manuale", () => {
    const snapshot = salesSnapshotFromRows(syntheticRows());
    snapshot.orders[0] = {
      ...snapshot.orders[0],
      source: "shopify_canonical",
      channel: "shopify_web",
      fulfillmentState: "fulfilled",
      paymentState: "partially_paid",
      paymentCorrected: false,
      effectiveAmountDueCents: null,
    };
    mocks.states[1] = "open";
    const html = render(snapshot);
    expect(html).toContain(`id="order-${snapshot.orders[0].id}"`);
    expect(html).not.toContain("Registra il saldo da incassare");
  });
});
