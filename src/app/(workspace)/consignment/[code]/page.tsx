import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessPanel } from "../../../../components/access-panel";
import {
  ConsignmentShopSales,
  SHOP_SIDE_TITLE,
  ShopFrame,
} from "../../../../components/consignment-shop";
import { loadShop, shopTitle, SHOP_SETUP } from "../../../../lib/consignment/shop-page-load";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

const TITLE = SHOP_SIDE_TITLE.sales;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: await shopTitle(code, (page) => `${TITLE} · ${page.shop.name}`) };
}

/**
 * Vendite del negozio (Vendite › Conto vendita): resoconto mensile, fattura e pagamenti.
 * Le magliette in negozio solo come riepilogo, con il link al magazzino del negozio.
 */
export default async function ShopSalesPage({ params }: Props) {
  const { code } = await params;
  const load = await loadShop(code);
  if (load.status === "not_found") notFound();
  if (load.status !== "ready") return <AccessPanel status={load.status} setup={SHOP_SETUP} />;
  return (
    <ShopFrame
      page={load.page}
      side="sales"
      userId={load.userId}
      preview={load.preview}
      title={TITLE}
    >
      <ConsignmentShopSales
        page={load.page}
        canFinance={load.canFinance}
        now={new Date().toISOString()}
      />
    </ShopFrame>
  );
}
