import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessPanel } from "../../../../../components/access-panel";
import {
  ConsignmentShopStock,
  SHOP_SIDE_TITLE,
  ShopFrame,
} from "../../../../../components/consignment-shop";
import { loadShop, shopTitle, SHOP_SETUP } from "../../../../../lib/consignment/shop-page-load";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

const TITLE = SHOP_SIDE_TITLE.stock;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: await shopTitle(code, (page) => `${TITLE} · ${page.shop.name}`) };
}

/**
 * Magazzino del negozio (Magazzino › Conto vendita): tutte le T-shirt nelle taglie del
 * negozio, «—» finché non è contato; conta, ordini, consegne e storico delle magliette.
 */
export default async function ShopStockPage({ params }: Props) {
  const { code } = await params;
  const load = await loadShop(code);
  if (load.status === "not_found") notFound();
  if (load.status !== "ready") return <AccessPanel status={load.status} setup={SHOP_SETUP} />;
  return (
    <ShopFrame
      page={load.page}
      side="stock"
      userId={load.userId}
      preview={load.preview}
      title={TITLE}
    >
      <ConsignmentShopStock page={load.page} now={new Date().toISOString()} />
    </ShopFrame>
  );
}
