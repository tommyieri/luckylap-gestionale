import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SensitiveAreaLockForm } from "../../../../components/auth-sensitive-area-form";
import styles from "../../../../components/auth.module.css";
import { PanelActions, WorkspacePanel } from "../../../../components/workspace-panel";
import { signOut } from "../../../auth/actions";
import { getSupabasePublicConfig } from "../../../../lib/supabase/config";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { verifiedMember } from "../../../../lib/auth/server";
import { isSensitiveAreaEligible, type SensitiveArea } from "../../../../lib/auth/model";
import { verifiedSensitiveAccess } from "../../../../lib/auth/sensitive-access";
import { isLocalPreviewEnabled } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account e sicurezza" };

/** Avviso dell'anteprima locale (00-sequenza §1.5). */
const ACCOUNT_PREVIEW_NOTICE = "Anteprima locale: dati sintetici, salvataggio disattivato.";

type AreaState = { area: SensitiveArea; unlocked: boolean | null };

export default async function AccountPage() {
  // Anteprima locale: un account sintetico con le due aree chiuse, nessuna chiamata a Supabase.
  if (isLocalPreviewEnabled())
    return (
      <AccountView
        displayName="Tommi (anteprima)"
        states={[
          { area: "finance", unlocked: false },
          { area: "audit", unlocked: false },
        ]}
        preview
      />
    );
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <WorkspacePanel
        title="Accesso da configurare."
        description="Il workspace condiviso deve essere collegato prima di usare il tuo account."
      />
    );
  }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase);
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "member")
    return (
      <WorkspacePanel
        title="Account non abilitato."
        description="Il tuo account non ha un’abilitazione attiva al team. Rivolgiti a Tommi."
        tone="warning"
      >
        <PanelActions>
          <form action={signOut}>
            <button className="button button-secondary">Esci</button>
          </form>
        </PanelActions>
      </WorkspacePanel>
    );
  const areas = (["finance", "audit"] as SensitiveArea[]).filter((area) =>
    isSensitiveAreaEligible(access.member, area),
  );
  const states: AreaState[] = await Promise.all(
    areas.map(async (area) => ({
      area,
      unlocked: await verifiedSensitiveAccess(supabase, access.member, area).catch(() => null),
    })),
  );
  return <AccountView displayName={access.member.displayName} states={states} />;
}

function AccountView({
  displayName,
  states,
  preview = false,
}: {
  displayName: string;
  states: AreaState[];
  preview?: boolean;
}) {
  return (
    <WorkspacePanel
      title="Account e sicurezza"
      description={`Accesso di ${displayName}. Entri con la tua email e la password del workspace condivisa dal team. Le attività restano associate al tuo account.`}
    >
      {preview && (
        <p className={styles.status} role="status">
          {ACCOUNT_PREVIEW_NOTICE}
        </p>
      )}
      {states.map(({ area, unlocked }) => (
        <section key={area} className={styles.status}>
          <strong>{area === "finance" ? "Finance" : "Controllo CEO"}</strong>
          <p>
            {unlocked === null
              ? "Verifica dello stato non disponibile. Riprova tra poco."
              : unlocked
                ? "Aperta in questa sessione, fino a 8 ore. Puoi chiuderla prima di lasciare il dispositivo."
                : area === "finance"
                  ? "Chiusa. Serve la password Finance."
                  : "Chiusa. Serve la password CEO scelta da Tommi."}
          </p>
          <div className={styles.actions}>
            <Link href={`/auth/area/${area}`} className="button button-secondary" prefetch={false}>
              {unlocked ? "Gestisci accesso" : "Apri l’area"}
            </Link>
            {unlocked && (
              <Link
                href={area === "finance" ? "/finance" : "/audit"}
                className="button button-primary"
                prefetch={false}
              >
                Vai all’area
              </Link>
            )}
          </div>
          {unlocked && !preview && <SensitiveAreaLockForm area={area} />}
        </section>
      ))}
      <section className={styles.status} aria-labelledby="account-password">
        <strong id="account-password">Password del tuo account</strong>
        <Link href="/auth/password" className="text-button" prefetch={false}>
          Cambia la tua password
        </Link>
        <p>
          Di solito non serve: la password è la stessa per tutto il team. Se la cambi, vale solo per
          te. Avvisa Tommi.
        </p>
      </section>
      <PanelActions>
        <Link href="/guida" className="button button-secondary" prefetch={false}>
          Come si usa
        </Link>
      </PanelActions>
    </WorkspacePanel>
  );
}
