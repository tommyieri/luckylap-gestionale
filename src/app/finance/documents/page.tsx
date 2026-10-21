import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import styles from "@/components/finance.module.css";
import { financeDocumentAccess } from "@/lib/finance/document-access";
import { financeDocumentFromDatabase } from "@/lib/finance/documents";
export const dynamic = "force-dynamic";

export default async function FinanceDocumentsPage() {
  const access = await financeDocumentAccess().catch(() => null);
  if (access && !access.allowed && access.status === 401) redirect("/auth/login");
  if (!access?.allowed) return <AuthShell title="Documenti Finance riservati." description="Apri Finance per consultare i documenti."><div className={styles.accessActions}><Link href="/auth/area/finance" className="button button-primary">Apri Finance</Link><Link href="/" className="button button-secondary">Workspace</Link></div></AuthShell>;
  const result = await access.supabase.from("finance_documents").select("id,source_kind,file_name,storage_path,sha256,byte_size,content_type,review_status", { count: "exact" }).order("source_kind").limit(100);
  const documents = result.data?.map(financeDocumentFromDatabase) ?? [];
  if (result.error || result.count !== documents.length || documents.some(row => !row)) return <AuthShell title="Documenti non disponibili." description="Non è stato possibile leggere l’archivio completo. Riprova tra poco." />;
  return <div className={styles.page}><header className={styles.header}><Link href="/" className="wordmark">LuckyLap</Link><span>Finance · {access.member.displayName}</span></header><main className={styles.main}><Link href="/finance" className={styles.back}>← Movimenti BudgetFlow</Link><div className={styles.heading}><div><p className={styles.eyebrow}>FINANCE / DOCUMENTI ORIGINALI</p><h1>Le fonti del brand.</h1><p>Copie integre dei tre file ricevuti, in archivio privato.</p></div><span className={styles.readOnly}>Da verificare</span></div><div className={styles.notice}><strong>I documenti restano fonti da revisionare.</strong><p>Il COGS Tracker conserva i suoi codici storici. Il recap PDF conserva i valori originali, comprese le differenze da chiarire. Nessuno dei due modifica scorte, costi attuali o totali BudgetFlow.</p></div><section className={styles.section}><div className={styles.sectionHeading}><h2>File ricevuti</h2><span>{documents.length} documenti</span></div><ul className={styles.batches}>{documents.map(document => document && <li key={document.id}><div><strong>{document.fileName}</strong><p>{new Intl.NumberFormat("it-IT").format(document.bytes)} byte · Originale verificato</p><p style={{overflowWrap:"anywhere"}}>SHA-256: {document.sha256}</p></div><a href={`/finance/documents/${document.id}`} className="button button-secondary">Scarica originale</a></li>)}</ul></section></main></div>;
}
