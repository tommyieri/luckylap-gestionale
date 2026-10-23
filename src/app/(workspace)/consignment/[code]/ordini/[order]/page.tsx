import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessPanel } from "../../../../../../components/access-panel";
import { ConsignmentOrder } from "../../../../../../components/consignment-order";
import { ShopFrame } from "../../../../../../components/consignment-shop";
import { shopOrderParam } from "../../../../../../lib/consignment/links";
import { periodMonth } from "../../../../../../lib/consignment/shop-model";
import { orderLinesFromReport } from "../../../../../../lib/consignment/shop-read";
import { requireMember } from "../../../../../../lib/auth/current-member";
import { previewRestockPage } from "../../../../../../lib/restock/fixtures";
import { shopOrderPrefill, shopPart, type RestockOrder } from "../../../../../../lib/restock/read";
import { readRestockOrder } from "../../../../../../lib/restock/server";
import { loadShop, shopTitle, SHOP_SETUP } from "../../../load";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ code: string; order: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, order } = await params;
  const wanted = shopOrderParam(order);
  if (wanted === null) return { title: "Pagina non trovata" };
  if (wanted === "nuovo") return { title: await shopTitle(code, () => "Nuovo ordine") };
  return {
    title: await shopTitle(code, (page) =>
      page.orders.some((o) => o.number === wanted) ? `Ordine n. ${wanted}` : "Pagina non trovata",
    ),
  };
}

/**
 * Riordine da cui parte un ordine nuovo (`?riordine=<id>`): solo se è in mano nostra, per questo
 * negozio, con magliette ancora da consegnare e senza un altro ordine aperto. Altrimenti `null`.
 */
async function restockFor(value: unknown, shopLocationId: string): Promise<RestockOrder | null> {
  if (typeof value !== "string") return null;
  const current = await requireMember();
  const order =
    current.status === "preview"
      ? (previewRestockPage(value.toLowerCase())?.order ?? null)
      : current.status === "member"
        ? await readRestockOrder(current.supabase, value)
        : null;
  if (!order || order.shop?.locationId !== shopLocationId) return null;
  const part = shopPart(order);
  return part.status === "todo" && shopOrderPrefill(order).length ? order : null;
}

/** Ordine del negozio: nuovo (dalle magliette vendute in un mese o da un riordine) o esistente. */
export default async function OrderPage({ params, searchParams }: Props) {
  const { code, order } = await params;
  const wanted = shopOrderParam(order);
  if (wanted === null) notFound();
  const load = await loadShop(code);
  if (load.status === "not_found") notFound();
  if (load.status !== "ready") return <AccessPanel status={load.status} setup={SHOP_SETUP} />;
  const { page } = load;
  const now = new Date().toISOString();
  const query = await searchParams;
  if (wanted === "nuovo") {
    const from = query.da;
    const month = typeof from === "string" ? periodMonth(from) : null;
    const report = month ? page.reports.find((r) => r.month === month) : undefined;
    const restock = await restockFor(query.riordine, page.shop.locationId);
    return (
      <ShopFrame
        page={page}
        userId={load.userId}
        preview={load.preview}
        title="Nuovo ordine"
        linkShop
      >
        <ConsignmentOrder
          page={page}
          order={null}
          prefill={
            restock ? shopOrderPrefill(restock) : report ? orderLinesFromReport(report) : null
          }
          restock={restock ? { id: restock.id, title: restock.title } : null}
          now={now}
        />
      </ShopFrame>
    );
  }
  const found = page.orders.find((o) => o.number === wanted);
  if (!found) notFound();
  return (
    <ShopFrame
      page={page}
      userId={load.userId}
      preview={load.preview}
      title={`Ordine n. ${found.number}`}
      linkShop
    >
      <ConsignmentOrder
        page={page}
        order={found}
        startDelivery={query.consegna === "1"}
        now={now}
      />
    </ShopFrame>
  );
}
