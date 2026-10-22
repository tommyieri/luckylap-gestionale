import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessPanel } from "../../../../components/access-panel";
import { ConsignmentShop, ShopFrame } from "../../../../components/consignment-shop";
import { loadShop, shopTitle, SHOP_SETUP } from "../load";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: await shopTitle(code, (page) => page.shop.name) };
}

/** Pagina del negozio: avvisi, giacenza, resoconti, ordini, storico. */
export default async function ShopPage({ params }: Props) {
  const { code } = await params;
  const load = await loadShop(code);
  if (load.status === "not_found") notFound();
  if (load.status !== "ready") return <AccessPanel status={load.status} setup={SHOP_SETUP} />;
  return (
    <ShopFrame
      page={load.page}
      userId={load.userId}
      preview={load.preview}
      title={load.page.shop.name}
    >
      <ConsignmentShop
        page={load.page}
        canFinance={load.canFinance}
        now={new Date().toISOString()}
      />
    </ShopFrame>
  );
}
