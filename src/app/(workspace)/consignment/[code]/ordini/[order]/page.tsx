import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessPanel } from "../../../../../../components/access-panel";
import { ConsignmentOrder } from "../../../../../../components/consignment-order";
import { ShopFrame } from "../../../../../../components/consignment-shop";
import { shopOrderParam } from "../../../../../../lib/consignment/links";
import { periodMonth } from "../../../../../../lib/consignment/shop-model";
import { orderLinesFromReport } from "../../../../../../lib/consignment/shop-read";
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

/** Ordine del negozio: nuovo (anche dalle magliette vendute in un mese) o esistente. */
export default async function OrderPage({ params, searchParams }: Props) {
  const { code, order } = await params;
  const wanted = shopOrderParam(order);
  if (wanted === null) notFound();
  const load = await loadShop(code);
  if (load.status === "not_found") notFound();
  if (load.status !== "ready") return <AccessPanel status={load.status} setup={SHOP_SETUP} />;
  const { page } = load;
  const now = new Date().toISOString();
  if (wanted === "nuovo") {
    const from = (await searchParams).da;
    const month = typeof from === "string" ? periodMonth(from) : null;
    const report = month ? page.reports.find((r) => r.month === month) : undefined;
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
          prefill={report ? orderLinesFromReport(report) : null}
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
      <ConsignmentOrder page={page} order={found} now={now} />
    </ShopFrame>
  );
}
