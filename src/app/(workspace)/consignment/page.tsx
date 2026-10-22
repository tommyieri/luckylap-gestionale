import type { Metadata } from "next";
import { AccessPanel } from "../../../components/access-panel";
import { ConsignmentShops } from "../../../components/consignment-shops";
import { requireMember } from "../../../lib/auth/current-member";
import { previewShopList } from "../../../lib/consignment/shop-fixtures";
import { readConsignmentShops } from "../../../lib/consignment/shop-server";
import { SHOP_SETUP } from "./load";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conto vendita" };

/** Elenco dei negozi in conto vendita. Un errore di lettura arriva a `error.tsx`. */
export default async function ConsignmentPage() {
  const current = await requireMember();
  if (current.status === "preview")
    return <ConsignmentShops list={previewShopList()} canFinance preview />;
  if (current.status !== "member")
    return <AccessPanel status={current.status} setup={SHOP_SETUP} />;
  const read = await readConsignmentShops(current.supabase, current.member);
  return <ConsignmentShops list={read.list} canFinance={read.canFinance} />;
}
