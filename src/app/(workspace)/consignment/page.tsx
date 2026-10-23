import type { Metadata } from "next";
import { AccessPanel } from "../../../components/access-panel";
import { ConsignmentShops } from "../../../components/consignment-shops";
import { requireMember } from "../../../lib/auth/current-member";
import { previewShopList } from "../../../lib/consignment/shop-fixtures";
import { SHOP_SETUP } from "../../../lib/consignment/shop-page-load";
import { readConsignmentShops } from "../../../lib/consignment/shop-server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conto vendita" };

/**
 * Vendite › Conto vendita: i negozi con il mese da registrare e l'ultimo resoconto.
 * Un errore di lettura arriva a `error.tsx`.
 */
export default async function ConsignmentPage() {
  const current = await requireMember();
  if (current.status === "preview")
    return <ConsignmentShops list={previewShopList()} side="sales" canFinance preview />;
  if (current.status !== "member")
    return <AccessPanel status={current.status} setup={SHOP_SETUP} />;
  const read = await readConsignmentShops(current.supabase, current.member);
  return <ConsignmentShops list={read.list} side="sales" canFinance={read.canFinance} />;
}
