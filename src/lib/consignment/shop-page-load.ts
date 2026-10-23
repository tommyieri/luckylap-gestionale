import "server-only";
import { cache } from "react";
import { requireMember } from "../auth/current-member";
import { readConsignmentShop } from "./shop-server";
import { previewShopPage } from "./shop-fixtures";
import { shopCode } from "./links";
import type { ShopPage } from "./shop-read";

/** Chiave del tentativo in sospeso nell'anteprima locale: nessun membro vero. */
export const PREVIEW_USER = "anteprima-locale";

export const SHOP_SETUP = {
  title: "Conto vendita da collegare.",
  description:
    "Servono il database condiviso e il catalogo Shopify verificato per gestire negozi, conte e resoconti.",
};

export type ShopLoad =
  | { status: "unconfigured" | "denied" | "unavailable" }
  | { status: "not_found" }
  | { status: "ready"; page: ShopPage; canFinance: boolean; userId: string; preview: boolean };

/**
 * Pagina di un negozio, letta una volta per richiesta e condivisa da
 * `generateMetadata` e dalla pagina, nei due lati: Vendite › Conto vendita
 * (`/consignment/…`) e Magazzino › Conto vendita (`/stock/conto-vendita/…`). Senza sessione porta al login; un errore di
 * lettura arriva a `error.tsx`, che non mostra dati parziali. In anteprima
 * locale legge solo i dati sintetici, mai Supabase.
 */
export const loadShop = cache(async (code: string): Promise<ShopLoad> => {
  if (!shopCode(code)) return { status: "not_found" };
  const current = await requireMember();
  if (current.status === "preview") {
    const page = previewShopPage(code);
    return page
      ? { status: "ready", page, canFinance: true, userId: PREVIEW_USER, preview: true }
      : { status: "not_found" };
  }
  if (current.status !== "member") return { status: current.status };
  const read = await readConsignmentShop(current.supabase, current.member, code);
  if (read.status === "not_found") return read;
  return {
    status: "ready",
    page: read.page,
    canFinance: read.canFinance,
    userId: current.member.userId,
    preview: false,
  };
});

/** Titolo di una pagina del negozio: «Pagina non trovata» quando la pagina chiamerà `notFound()`. */
export async function shopTitle(code: string, title: (page: ShopPage) => string): Promise<string> {
  const load = await loadShop(code);
  if (load.status === "not_found") return "Pagina non trovata";
  return load.status === "ready" ? title(load.page) : "Conto vendita";
}

/** Nomi delle magliette per il riepilogo di un tentativo in sospeso. */
export const itemLabels = (page: ShopPage) =>
  Object.fromEntries(page.items.map((item) => [item.id, item.label]));
