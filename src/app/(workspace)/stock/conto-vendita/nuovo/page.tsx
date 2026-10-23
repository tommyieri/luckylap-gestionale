import type { Metadata } from "next";
import { AccessPanel } from "../../../../../components/access-panel";
import {
  ShopCommandsProvider,
  ShopPendingSlot,
} from "../../../../../components/consignment-pending";
import { ConsignmentShopSettings } from "../../../../../components/consignment-shop-settings";
import styles from "../../../../../components/consignment-shop.module.css";
import { requireMember } from "../../../../../lib/auth/current-member";
import { previewWarehouses } from "../../../../../lib/consignment/shop-fixtures";
import { PREVIEW_USER, SHOP_SETUP } from "../../../../../lib/consignment/shop-page-load";
import { readNewShopForm } from "../../../../../lib/consignment/shop-server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nuovo negozio" };

/**
 * Nuovo negozio (Magazzino › Conto vendita): solo con Finance aperta (decisione 34). Il vecchio
 * indirizzo `/consignment/nuovo` arriva qui con la sua query (next.config.ts).
 */
export default async function NewShopPage() {
  const current = await requireMember();
  if (current.status !== "member" && current.status !== "preview")
    return <AccessPanel status={current.status} setup={SHOP_SETUP} />;
  const preview = current.status === "preview";
  const form = preview
    ? { canFinance: true, warehouses: previewWarehouses() }
    : await readNewShopForm(current.supabase, current.member);
  return (
    <ShopCommandsProvider userId={preview ? PREVIEW_USER : current.member.userId} preview={preview}>
      <div className={styles.page}>
        <header className={styles.head}>
          <div>
            <h1 className={styles.title}>Nuovo negozio</h1>
            <p className={styles.lead}>
              Nome, condizioni e magazzino da cui partono le consegne. Il negozio parte da contare.
            </p>
          </div>
        </header>
        <ShopPendingSlot />
        <ConsignmentShopSettings
          shop={null}
          warehouses={form.warehouses}
          canFinance={form.canFinance}
        />
      </div>
    </ShopCommandsProvider>
  );
}
