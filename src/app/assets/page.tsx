import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "../../components/auth-shell";
import { BrandAssetsView } from "../../components/brand-assets-view";
import { verifiedMember } from "../../lib/auth/server";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { getSupabasePublicConfig } from "../../lib/supabase/config";
import { loadBrandAssets } from "../../lib/assets/server";
import shared from "../../components/team-workspace.module.css";
export const dynamic = "force-dynamic";
function State({ title, description }: { title: string; description: string }) {
  return (
    <AuthShell title={title} description={description}>
      <div className={shared.accessActions}>
        <Link href="/" className="button button-secondary">
          Torna al workspace
        </Link>
      </div>
    </AuthShell>
  );
}
export default async function AssetsPage() {
  let config;
  try {
    config = getSupabasePublicConfig();
  } catch {
    return (
      <State
        title="La libreria attende il collegamento."
        description="I contenuti privati del brand saranno disponibili dopo la configurazione del workspace."
      />
    );
  }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase).catch(() => ({ status: "unavailable" as const }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "member")
    return (
      <State
        title="La libreria è riservata al team."
        description="Accedi con un account abilitato. Se la verifica non è disponibile, riprova tra poco."
      />
    );
  const assets = await loadBrandAssets(supabase).catch(() => null);
  if (!assets)
    return (
      <State
        title="Libreria non disponibile."
        description="La lettura dei contenuti non è riuscita. Ricarica la pagina tra poco; nessun dato parziale viene mostrato."
      />
    );
  return (
    <BrandAssetsView
      assets={assets}
      displayName={access.member.displayName}
      userId={access.member.userId}
      config={config}
      operationId={randomUUID()}
    />
  );
}
