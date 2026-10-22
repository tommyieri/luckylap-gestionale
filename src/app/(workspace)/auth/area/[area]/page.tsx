import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SensitiveAreaForm, SensitiveAreaLockForm } from "@/components/auth-sensitive-area-form";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { isSensitiveAreaEligible, sensitiveAreaFrom } from "@/lib/auth/model";
import { verifiedMember } from "@/lib/auth/server";
import { verifiedSensitiveAccess } from "@/lib/auth/sensitive-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string }>;
}): Promise<Metadata> {
  const area = sensitiveAreaFrom((await params).area);
  const robots = { index: false, follow: false };
  // La pagina chiama notFound(): il titolo del browser deve dirlo, come il 404 radice.
  if (!area) return { title: "Pagina non trovata", robots };
  return { title: area === "finance" ? "Apri Finance" : "Apri Controllo CEO", robots };
}

export default async function SensitiveAreaPage({ params }: { params: Promise<{ area: string }> }) {
  const area = sensitiveAreaFrom((await params).area);
  if (!area) notFound();
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <WorkspacePanel
        title="Accesso da configurare."
        description="Il collegamento al workspace deve essere completato prima di aprire l’area."
      />
    );
  }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase).catch(() => ({ status: "unavailable" as const }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "member" || !isSensitiveAreaEligible(access.member, area))
    return (
      <WorkspacePanel
        title="Area riservata."
        description="Il tuo account non è abilitato a questa area."
      />
    );
  const unlocked = await verifiedSensitiveAccess(supabase, access.member, area).catch(() => null);
  if (unlocked === null)
    return (
      <WorkspacePanel
        title="Verifica non disponibile."
        description="Non è stato possibile verificare questa sessione. Riprova tra poco."
      >
        <PanelActions>
          <Link href="/auth/account" className="button button-secondary" prefetch={false}>
            Il tuo account
          </Link>
        </PanelActions>
      </WorkspacePanel>
    );
  const label = area === "finance" ? "Finance" : "Controllo CEO";
  // `h1` uguale al titolo del browser (01 §8.3); lo stato «aperta» lo dice il paragrafo.
  return (
    <WorkspacePanel
      title={`Apri ${label}`}
      description={
        unlocked
          ? "L’area è aperta per questa sessione. Puoi chiuderla prima di lasciare il dispositivo."
          : area === "finance"
            ? ""
            : "Inserisci la password aggiuntiva dell’area. Il tuo accesso resta personale, con l’email del team."
      }
    >
      {unlocked ? (
        <>
          <PanelActions>
            <Link
              href={area === "finance" ? "/finance" : "/audit"}
              className="button button-primary"
              prefetch={false}
            >
              Vai all’area
            </Link>
          </PanelActions>
          <SensitiveAreaLockForm area={area} />
        </>
      ) : (
        <SensitiveAreaForm area={area} />
      )}
      <PanelActions>
        <Link href="/auth/account" className="button button-secondary" prefetch={false}>
          Il tuo account
        </Link>
      </PanelActions>
    </WorkspacePanel>
  );
}
