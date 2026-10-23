import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AccessPanel } from "../../../../../components/access-panel";
import { RestockDetail } from "../../../../../components/restock-detail";
import { requireMember } from "../../../../../lib/auth/current-member";
import { previewRestockPage } from "../../../../../lib/restock/fixtures";
import { readRestockPage } from "../../../../../lib/restock/server";
import type { RestockPage } from "../../../../../lib/restock/read";
import { PREVIEW_USER, RESTOCK_SETUP } from "../load";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };
type Load =
  | { status: "unconfigured" | "denied" | "unavailable" }
  | { status: "not_found" }
  | { status: "ready"; page: RestockPage; userId: string; preview: boolean };

/** Un riordine, letto una volta per richiesta e condiviso da `generateMetadata` e dalla pagina. */
const load = cache(async (id: string): Promise<Load> => {
  const wanted = id.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(wanted))
    return { status: "not_found" };
  const current = await requireMember();
  if (current.status === "preview") {
    const page = previewRestockPage(wanted);
    return page
      ? { status: "ready", page, userId: PREVIEW_USER, preview: true }
      : { status: "not_found" };
  }
  if (current.status !== "member") return { status: current.status };
  const read = await readRestockPage(current.supabase, wanted);
  if (read.status === "not_found") return read;
  return { status: "ready", page: read.page, userId: current.member.userId, preview: false };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const result = await load((await params).id);
  if (result.status === "not_found") return { title: "Pagina non trovata" };
  return { title: result.status === "ready" ? result.page.order.title : "Riassortimento" };
}

/** Un riordine: stato, quantità per destinazione, arrivo in magazzino, consegna al negozio, storico. */
export default async function RestockOrderPage({ params }: Props) {
  const result = await load((await params).id);
  if (result.status === "not_found") notFound();
  if (result.status !== "ready")
    return <AccessPanel status={result.status} setup={RESTOCK_SETUP} />;
  return (
    <RestockDetail
      page={result.page}
      userId={result.userId}
      preview={result.preview}
      now={new Date().toISOString()}
    />
  );
}
