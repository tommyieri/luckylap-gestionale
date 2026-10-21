import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { StockWorkspace } from "@/components/stock-workspace";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readStockWorkspace } from "@/lib/stock/server";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <AuthShell
        title="Magazzino condiviso da collegare."
        description="Il collegamento al database è necessario per consultare e rettificare le quantità reali."
      />
    );
  }
  const access = await readStockWorkspace(await createSupabaseServerClient()).catch(() => ({
    status: "unavailable" as const,
  }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "ready")
    return (
      <AuthShell
        title="Rettifiche non disponibili."
        description="Non è stato possibile verificare l’accesso e leggere tutte le quantità. Ricarica tra poco: nessun elenco parziale viene mostrato."
      >
        <Link href="/" className="button button-secondary">
          Torna al magazzino
        </Link>
      </AuthShell>
    );
  return <StockWorkspace snapshot={access.snapshot} member={access.member} />;
}
