import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessPanel } from "../../../../../components/access-panel";
import { ShopFrame } from "../../../../../components/consignment-shop";
import { ConsignmentShopSettings } from "../../../../../components/consignment-shop-settings";
import { loadShop, shopTitle, SHOP_SETUP } from "../../load";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: await shopTitle(code, () => "Impostazioni del negozio") };
}

/** Nome, condizioni, magazzino di partenza e stato: si cambiano con Finance aperta. */
export default async function ShopSettingsPage({ params }: Props) {
  const { code } = await params;
  const load = await loadShop(code);
  if (load.status === "not_found") notFound();
  if (load.status !== "ready") return <AccessPanel status={load.status} setup={SHOP_SETUP} />;
  return (
    <ShopFrame
      page={load.page}
      userId={load.userId}
      preview={load.preview}
      title="Impostazioni del negozio"
      linkShop
    >
      <ConsignmentShopSettings
        shop={load.page.shop}
        warehouses={load.page.warehouses}
        canFinance={load.canFinance}
      />
    </ShopFrame>
  );
}
