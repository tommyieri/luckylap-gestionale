import { afterEach, describe, expect, it, vi } from "vitest";
import { listenForSalesOrderLinks, salesOrderDestination } from "./navigation";
const id = (n: number) => `81000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const orders = Array.from({ length: 45 }, (_, index) => ({ id: id(index + 1) }));
afterEach(() => vi.unstubAllGlobals());
describe("collegamenti agli ordini paginati", () => {
  it("trova la pagina del dettaglio nell’ordine effettivo della lista", () => {
    expect(salesOrderDestination(orders, `#order-${id(1)}`)).toEqual({ orderId: id(1), page: 0 });
    expect(salesOrderDestination(orders, `#order-${id(21)}`)).toEqual({ orderId: id(21), page: 1 });
    expect(salesOrderDestination(orders, `#order-${id(45)}`)).toEqual({ orderId: id(45), page: 2 });
    expect(salesOrderDestination([...orders].reverse(), `#order-${id(45)}`)?.page).toBe(0);
  });
  it.each([
    "",
    "#new-sale",
    "#order-unknown",
    `#order-${id(99)}`,
    `#order-${id(1)}?next=external`,
    "#order-%3Cscript%3E",
  ])("ignora frammenti non validi o ordini assenti (%s)", (hash) => {
    expect(salesOrderDestination(orders, hash)).toBeNull();
  });
  it("segue mount, hashchange e link Next senza intercettare nuove schede e rimuove i listener", () => {
    const listeners = new Map<string, (event?: unknown) => void>();
    const removeWindow = vi.fn(),
      removeDocument = vi.fn();
    const location = {
      hash: `#order-${id(1)}`,
      href: "https://example.invalid/sales",
      origin: "https://example.invalid",
    };
    vi.stubGlobal("window", {
      location,
      addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
      removeEventListener: removeWindow,
    });
    vi.stubGlobal("document", {
      addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
      removeEventListener: removeDocument,
    });
    class SyntheticElement {
      closest() {
        return this;
      }
    }
    class SyntheticAnchor extends SyntheticElement {
      target = "";
      href = `https://example.invalid/sales#order-${id(21)}`;
      hasAttribute() {
        return false;
      }
    }
    vi.stubGlobal("Element", SyntheticElement);
    vi.stubGlobal("HTMLAnchorElement", SyntheticAnchor);
    const onHash = vi.fn(),
      stop = listenForSalesOrderLinks(onHash);
    expect(onHash).toHaveBeenLastCalledWith(`#order-${id(1)}`);
    location.hash = `#order-${id(45)}`;
    listeners.get("hashchange")!();
    expect(onHash).toHaveBeenLastCalledWith(`#order-${id(45)}`);
    const event = {
      button: 0,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      target: new SyntheticAnchor(),
    };
    listeners.get("click")!(event);
    expect(onHash).toHaveBeenLastCalledWith(`#order-${id(21)}`);
    const count = onHash.mock.calls.length;
    listeners.get("click")!({ ...event, ctrlKey: true });
    expect(onHash).toHaveBeenCalledTimes(count);
    stop();
    expect(removeWindow).toHaveBeenCalledTimes(2);
    expect(removeDocument).toHaveBeenCalledExactlyOnceWith("click", expect.any(Function), true);
  });
});
