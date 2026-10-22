import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "@/components/finance.module.css";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { financeDocumentAccess } from "@/lib/finance/document-access";
import { financeDocumentFromDatabase } from "@/lib/finance/documents";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Documenti" };

export default async function FinanceDocumentsPage() {
  const access = await financeDocumentAccess().catch(() => null);
  if (access && !access.allowed && access.status === 401) redirect("/auth/login");
  if (!access?.allowed)
    return (
      <WorkspacePanel
        title="Documenti Finance riservati."
        description="Apri Finance per consultare i documenti."
      >
        <PanelActions>
          <Link href="/auth/area/finance" className="button button-primary" prefetch={false}>
            Apri Finance
          </Link>
        </PanelActions>
      </WorkspacePanel>
    );
  const result = await access.supabase
    .from("finance_documents")
    .select("id,source_kind,file_name,storage_path,sha256,byte_size,content_type,review_status", {
      count: "exact",
    })
    .order("source_kind")
    .limit(100);
  const documents = result.data?.map(financeDocumentFromDatabase) ?? [];
  if (result.error || result.count !== documents.length || documents.some((row) => !row))
    return (
      <WorkspacePanel
        title="Documenti non disponibili."
        description="Non è stato possibile leggere l’archivio completo. Riprova tra poco."
      />
    );
  return (
    <div className={styles.main}>
      <div className={styles.heading}>
        <div>
          <h1>Documenti</h1>
          <p>Copie integre dei tre file ricevuti, in archivio privato.</p>
        </div>
        <span className={styles.readOnly}>Da verificare</span>
      </div>
      <div className={styles.notice}>
        <strong>I documenti restano fonti da revisionare.</strong>
        <p>
          Il COGS Tracker conserva i suoi codici storici. Il recap PDF conserva i valori originali,
          comprese le differenze da chiarire. Nessuno dei due modifica scorte, costi attuali o
          totali BudgetFlow.
        </p>
      </div>
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2>File ricevuti</h2>
          <span>{documents.length} documenti</span>
        </div>
        <ul className={styles.batches}>
          {documents.map(
            (document) =>
              document && (
                <li key={document.id}>
                  <div>
                    <strong>{document.fileName}</strong>
                    <p>
                      {new Intl.NumberFormat("it-IT").format(document.bytes)} byte · Originale
                      verificato
                    </p>
                    <p style={{ overflowWrap: "anywhere" }}>SHA-256: {document.sha256}</p>
                  </div>
                  <a href={`/finance/documents/${document.id}`} className="button button-secondary">
                    Scarica originale
                  </a>
                </li>
              ),
          )}
        </ul>
      </section>
    </div>
  );
}
