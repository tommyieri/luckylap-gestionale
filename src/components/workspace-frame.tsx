import { Suspense, type ReactNode } from "react";
import { signOut } from "../app/auth/actions";
import type { NavAccess } from "../lib/navigation";
import { readNavAccess } from "../lib/navigation-server";
import { WorkspaceBottomBar, WorkspaceSidebar, WorkspaceTabs } from "./workspace-nav";
import styles from "./workspace-shell.module.css";

/**
 * Guscio condiviso delle pagine per i membri (docs: 01-layout §3.1).
 * Nessun `await` qui: l'accesso per il menu si legge dentro due `Suspense`,
 * così il contenuto non aspetta il menu. Il guscio non è un cancello: ogni
 * pagina verifica sessione, membership e password d'area da sola.
 */
const PENDING: NavAccess = { status: "pending" };

async function Sidebar() {
  return <WorkspaceSidebar access={await readNavAccess()} signOut={signOut} />;
}
async function BottomBar() {
  return <WorkspaceBottomBar access={await readNavAccess()} signOut={signOut} />;
}

export function WorkspaceFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#contenuto">
        Vai al contenuto
      </a>
      <div className={styles.frame}>
        <Suspense fallback={<WorkspaceSidebar access={PENDING} signOut={signOut} />}>
          <Sidebar />
        </Suspense>
        <div className={styles.column}>
          <WorkspaceTabs />
          <main id="contenuto" tabIndex={-1} className={styles.main}>
            {children}
          </main>
        </div>
      </div>
      {/* Dopo `main` nel DOM: con la tastiera si arriva prima al contenuto. */}
      <Suspense fallback={<WorkspaceBottomBar access={PENDING} signOut={signOut} />}>
        <BottomBar />
      </Suspense>
    </>
  );
}
