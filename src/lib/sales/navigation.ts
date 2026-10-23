import { isUuid } from "./model";

export const SALES_ORDER_PAGE_SIZE = 20;

/** Resolve only canonical hashes for orders present in this caller's snapshot. */
export function salesOrderDestination(
  orders: readonly { id: string }[],
  hash: string,
): { orderId: string; page: number } | null {
  const match = /^#order-([0-9a-f-]{36})$/i.exec(hash);
  if (!match || !isUuid(match[1])) return null;
  const index = orders.findIndex((order) => order.id.toLowerCase() === match[1].toLowerCase());
  return index < 0
    ? null
    : { orderId: orders[index].id, page: Math.floor(index / SALES_ORDER_PAGE_SIZE) };
}

/** Next links may change the hash through history without emitting hashchange. */
export function listenForSalesOrderLinks(onHash: (hash: string) => void): () => void {
  const fromLocation = () => onHash(window.location.hash);
  const fromLink = (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      event.defaultPrevented
    )
      return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (
      !(anchor instanceof HTMLAnchorElement) ||
      anchor.hasAttribute("download") ||
      !["", "_self"].includes(anchor.target)
    )
      return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin === window.location.origin && url.pathname === "/sales") onHash(url.hash);
  };
  fromLocation();
  window.addEventListener("hashchange", fromLocation);
  window.addEventListener("popstate", fromLocation);
  document.addEventListener("click", fromLink, true);
  return () => {
    window.removeEventListener("hashchange", fromLocation);
    window.removeEventListener("popstate", fromLocation);
    document.removeEventListener("click", fromLink, true);
  };
}
