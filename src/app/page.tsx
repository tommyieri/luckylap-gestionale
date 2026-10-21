import { ManagementApp } from "@/components/management-app";
import { AuthShell } from "@/components/auth-shell";
import styles from "@/components/auth.module.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { verifiedMember, loadAuthenticatedInventory } from "@/lib/auth/server";
import { isLocalPreviewEnabled } from "@/lib/runtime";
import { signOut } from "./auth/actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (isLocalPreviewEnabled()) {
    const { loadInventory } = await import("@/lib/inventory");
    const { items, sourceMeta } = await loadInventory();
    return <ManagementApp items={items} sourceMeta={sourceMeta} />;
  }
  try { getSupabasePublicConfig(); } catch { return <AuthShell title="Prepariamo il workspace condiviso." description="Il collegamento al workspace deve essere completato prima di accedere. Le scorte e i dati interni non vengono caricati su questa pagina." />; }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase);
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "member") return <AuthShell title={access.status === "denied" ? "Account non abilitato." : "Workspace temporaneamente non disponibile."} description={access.status === "denied" ? "Serve un’abilitazione attiva al team LuckyLap. Rivolgiti a Tommi per verificare il tuo accesso." : "Non è stato possibile verificare l’accesso al team. Riprova tra poco."}><div className={styles.actions}><form action={signOut}><button className="button button-secondary">Esci</button></form></div></AuthShell>;
  let inventory;
  try { inventory = await loadAuthenticatedInventory(supabase); } catch { return <AuthShell title="Inventario da collegare." description="L’accesso al team è verificato. L’inventario condiviso deve ancora essere importato o non è disponibile; non vengono utilizzate copie locali in sostituzione."><div className={styles.actions}><Link href="/auth/account" className="button button-secondary">Il tuo account</Link><form action={signOut}><button className="button button-secondary">Esci</button></form></div></AuthShell>; }
  return <><div className={styles.accountBar}><p>Accesso di <strong>{access.member.displayName}</strong><small>Inventario dal database in sola lettura. Calendario e note restano su questo browser.</small></p><div><Link href="/auth/account">Account e sicurezza</Link><form action={signOut}><button>Esci</button></form></div></div><ManagementApp items={inventory.items} sourceMeta={inventory.sourceMeta} mode="authenticated" displayName={access.member.displayName} /></>;
}
