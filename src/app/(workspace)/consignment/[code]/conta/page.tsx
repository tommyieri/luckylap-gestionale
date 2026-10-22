import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessPanel } from "../../../../../components/access-panel";
import { ConsignmentCountForm } from "../../../../../components/consignment-count-form";
import { ShopFrame } from "../../../../../components/consignment-shop";
import { loadShop, shopTitle, SHOP_SETUP } from "../../load";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: await shopTitle(code, () => "Conta in negozio") };
}

/** Conta in negozio: prima conta completa, poi correzioni anche di una sola taglia. */
export default async function CountPage({ params }: Props) {
  const { code } = await params;
  const load = await loadShop(code);
  if (load.status === "not_found") notFound();
  if (load.status !== "ready") return <AccessPanel status={load.status} setup={SHOP_SETUP} />;
  const first = load.page.shop.firstCountedAt === null;
  return (
    <ShopFrame
      page={load.page}
      userId={load.userId}
      preview={load.preview}
      title={first ? "Conta in negozio" : "Correggi la conta"}
      linkShop
    >
      <ConsignmentCountForm page={load.page} now={new Date().toISOString()} />
    </ShopFrame>
  );
}
