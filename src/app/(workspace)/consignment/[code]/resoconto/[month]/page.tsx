import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessPanel } from "../../../../../../components/access-panel";
import { ConsignmentReport } from "../../../../../../components/consignment-report";
import { ShopFrame } from "../../../../../../components/consignment-shop";
import styles from "../../../../../../components/consignment-shop.module.css";
import { consignmentShopHref } from "../../../../../../lib/consignment/links";
import { monthLabel, periodMonth } from "../../../../../../lib/consignment/shop-model";
import { reportMonthAllowed } from "../../../../../../lib/consignment/shop-read";
import { loadShop, shopTitle, SHOP_SETUP } from "../../../load";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string; month: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, month } = await params;
  const period = periodMonth(month);
  if (!period) return { title: "Pagina non trovata" };
  return { title: await shopTitle(code, () => `Resoconto di ${monthLabel(period)}`) };
}

/** Resoconto del mese: modulo se manca, riepilogo con «Modifica» se è registrato. */
export default async function ReportPage({ params }: Props) {
  const { code, month } = await params;
  const period = periodMonth(month);
  if (!period) notFound();
  const load = await loadShop(code);
  if (load.status === "not_found") notFound();
  if (load.status !== "ready") return <AccessPanel status={load.status} setup={SHOP_SETUP} />;
  const { page } = load;
  const now = new Date().toISOString();
  const report = page.reports.find((r) => r.month === period) ?? null;
  return (
    <ShopFrame
      page={page}
      userId={load.userId}
      preview={load.preview}
      title={`Resoconto di ${monthLabel(period)}`}
      linkShop
    >
      {!report && !reportMonthAllowed(page.settings, period, now) ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>Questo mese non si può registrare.</p>
          <p className={styles.muted}>
            Si registrano i mesi dall’avvio delle vendite a quello in corso.
          </p>
          <Link
            href={consignmentShopHref(page.shop.code)}
            prefetch={false}
            className="button button-secondary"
          >
            Apri il negozio
          </Link>
        </div>
      ) : (
        <ConsignmentReport page={page} month={period} canFinance={load.canFinance} now={now} />
      )}
    </ShopFrame>
  );
}
