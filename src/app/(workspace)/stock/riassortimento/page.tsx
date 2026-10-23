import type { Metadata } from "next";
import { AccessPanel } from "../../../../components/access-panel";
import { RestockList } from "../../../../components/restock-list";
import { requireMember } from "../../../../lib/auth/current-member";
import { previewRestockData } from "../../../../lib/restock/fixtures";
import { readRestockList } from "../../../../lib/restock/server";
import { PREVIEW_USER, RESTOCK_SETUP } from "./load";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Riassortimento" };

/** Elenco dei riordini (Magazzino › Riassortimento). Un errore di lettura arriva a `error.tsx`. */
export default async function RestockPage() {
  const current = await requireMember();
  if (current.status === "preview")
    return (
      <RestockList
        data={previewRestockData()}
        userId={PREVIEW_USER}
        preview
        now={new Date().toISOString()}
      />
    );
  if (current.status !== "member")
    return <AccessPanel status={current.status} setup={RESTOCK_SETUP} />;
  const read = await readRestockList(current.supabase);
  return (
    <RestockList data={read.data} userId={current.member.userId} now={new Date().toISOString()} />
  );
}
