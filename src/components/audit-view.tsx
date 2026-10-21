import Link from "next/link";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { auditCursorHref, auditOperationLabel, auditTableLabel, type AuditEntry, type AuditPage } from "../lib/audit/model";
import shared from "./team-workspace.module.css";
import styles from "./audit.module.css";

const date = (value: string) => new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", dateStyle: "medium" }).format(new Date(value));
const time = (value: string) => new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", timeStyle: "medium" }).format(new Date(value));

function References({ entry }: { entry: AuditEntry }) {
  return entry.references.length === 0 ? <span className={styles.noReference}>Identificativo non disponibile</span> : <details className={styles.references}><summary>Riferimenti</summary><dl>{entry.references.map(reference => <div key={reference.label}><dt>{reference.label}</dt><dd>{reference.id}</dd></div>)}</dl></details>;
}

export function AuditView({ snapshot, displayName }: { snapshot: AuditPage; displayName: string }) {
  return <div className={shared.page}>
    <a href="#audit-content" className="skip-link">Vai al registro</a>
    <header className={shared.header}><Link href="/" className={shared.brand} aria-label="LuckyLap, workspace">LuckyLap</Link><span className={shared.area}><ShieldCheck size={15} aria-hidden="true" />Controllo founder</span><Link href="/auth/account" className={shared.account}>{displayName}<span>Account verificato</span></Link></header>
    <main id="audit-content" className={shared.main} tabIndex={-1}>
      <Link href="/" className={shared.back}><ArrowLeft size={14} aria-hidden="true" />Torna al workspace</Link>
      <div className={shared.heading}><div><h1>Le modifiche al workspace.</h1><p>Il registro delle operazioni sui dati condivisi di LuckyLap.</p></div></div>
      <p className={styles.notice}>Accesso personale riservato al founder con password Controllo CEO. Qui vedi data, operatore, area e tipo di modifica. Le operazioni di sistema sono indicate separatamente. Orari Europe/Rome.</p>
      <section className={shared.section} aria-labelledby="audit-title"><div className={shared.sectionHeading}><h2 id="audit-title">Registro attività</h2><span>{snapshot.entries.length} modifiche in questa pagina</span></div>
        {snapshot.entries.length === 0 ? <div className={styles.empty}><h3>{snapshot.hasCursor ? "Non ci sono modifiche precedenti." : "Nessuna modifica registrata."}</h3><p>Le operazioni sui dati del workspace appariranno qui.</p></div> : <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th scope="col">Quando</th><th scope="col">Attività</th><th scope="col">Operatore</th><th scope="col" className={styles.referenceColumn}>Riferimenti</th></tr></thead><tbody>{snapshot.entries.map(entry => <tr key={entry.id}><td><time dateTime={entry.occurredAt}><span>{date(entry.occurredAt)}</span><small>{time(entry.occurredAt)}</small></time></td><td><strong className={entry.operation === "DELETE" ? styles.removed : undefined}>{auditOperationLabel[entry.operation]}</strong><span className={styles.areaName}>{auditTableLabel(entry.tableName)}</span><div className={styles.mobileReferences}><References entry={entry} /></div></td><td><span className={styles.actor}>{entry.actorName}</span></td><td className={styles.referenceColumn}><References entry={entry} /></td></tr>)}</tbody></table></div>}
        <nav aria-label="Pagine del registro" className={styles.pagination}>{snapshot.hasCursor ? <Link className="button button-secondary" href="/audit"><ArrowLeft size={14} aria-hidden="true" />Più recenti</Link> : <span>Modifiche più recenti</span>}{snapshot.nextCursor && <Link className="button button-secondary" href={auditCursorHref(snapshot.nextCursor)}>Modifiche precedenti<ArrowRight size={14} aria-hidden="true" /></Link>}</nav>
      </section>
      <p className={styles.scope}>Questo registro traccia creazioni, modifiche ed eliminazioni dei dati. Non registra automaticamente le pagine lette o gli accessi all’account. I contenuti delle modifiche e i dettagli Finance restano fuori da questa vista.</p>
      <footer className={shared.footer}><span>LuckyLap · Controllo founder</span><span>Sola lettura</span></footer>
    </main>
  </div>;
}
