"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, FileSpreadsheet, LockKeyhole, Search, X } from "lucide-react";
import { formatCalendarDate, formatLocalTimestamp, transactionTiming, type FinanceSnapshot, type FinanceTransaction } from "@/lib/finance/model";
import styles from "./finance.module.css";

type Filter = "all" | "pending" | "future" | "dated";
function Timing({ row, reportDate }: { row: FinanceTransaction; reportDate: string }) {
  const timing = transactionTiming(row.sourceDate, row.pending, reportDate);
  return <span className={styles.badges}>{timing?.pending && <span className={styles.attention}>Pending</span>}{timing?.future && <span className={styles.attention}>Data futura</span>}{!timing?.pending && !timing?.future && <span className={styles.neutral}>Data odierna o passata</span>}</span>;
}

export function FinanceImportsView({ snapshot, reportDate, displayName }: { snapshot: FinanceSnapshot; reportDate: string; displayName: string }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [batchId, setBatchId] = useState("");
  const [selected, setSelected] = useState<FinanceTransaction | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTitle = useId();
  const batchById = useMemo(() => new Map(snapshot.batches.map(batch => [batch.id, batch])), [snapshot.batches]);
  const filtered = useMemo(() => snapshot.transactions.filter(row => {
    if (batchId && row.batchId !== batchId) return false;
    const timing = transactionTiming(row.sourceDate, row.pending, reportDate);
    if (filter === "pending" && !timing?.pending) return false;
    if (filter === "future" && !timing?.future) return false;
    if (filter === "dated" && (timing?.pending || timing?.future)) return false;
    const needle = query.trim().toLocaleLowerCase("it");
    return !needle || [row.account, row.targetAccount ?? "", row.category, row.payee, row.folder, row.tags, row.notes, row.sourceAmount, row.formattedAmount].some(value => value.toLocaleLowerCase("it").includes(needle));
  }), [snapshot.transactions, query, filter, batchId, reportDate]);
  useEffect(() => {
    if (selected && !dialogRef.current?.open) dialogRef.current?.showModal();
    if (!selected && dialogRef.current?.open) dialogRef.current.close();
  }, [selected]);

  return <div className={styles.page}>
    <a className="skip-link" href="#finance-content">Vai ai movimenti</a>
    <header className={styles.header}><Link href="/" className={styles.brand} aria-label="LuckyLap, torna al workspace">LuckyLap</Link><span className={styles.area}><LockKeyhole size={14} aria-hidden="true" />Finance riservata</span><Link href="/auth/account" className={styles.account}>{displayName}<span>Account verificato</span></Link></header>
    <main className={styles.main} id="finance-content" tabIndex={-1}>
      <Link href="/" className={styles.back}><ArrowLeft size={14} aria-hidden="true" />Workspace</Link>
      <div className={styles.heading}><div><p className={styles.eyebrow}>FINANCE / FONTI IMPORTATE</p><h1>Movimenti da BudgetFlow.</h1><p>Una lettura fedele degli export, pronta per la revisione.</p></div><span className={styles.readOnly}>Sola lettura</span></div>
      <div className={styles.notice}><strong>Tutti i movimenti sono da verificare.</strong><p>Questi dati conservano categorie, conti e importi dell’export. Incassi, apporti e finanziamenti possono avere natura diversa: non costituiscono automaticamente fatturato. Pending e date future non sono consuntivi.</p><p>COGS Tracker e recap PDF sono ancora in revisione separata. Non sono sommati a questi movimenti.</p></div>
      <section className={styles.section} aria-labelledby="finance-batches-title"><div className={styles.sectionHeading}><h2 id="finance-batches-title">Importazioni</h2><span>{snapshot.batches.length} export</span></div>
        {snapshot.batches.length === 0 ? <div className={styles.empty}><FileSpreadsheet size={25} aria-hidden="true" /><h3>Nessun export presente.</h3><p>I file ricevuti saranno visibili qui dopo l’importazione nel workspace condiviso.</p></div> : <ul className={styles.batches}>{snapshot.batches.map(batch => <li key={batch.id}><FileSpreadsheet size={18} aria-hidden="true" /><div><strong>{batch.sourceFileName}</strong><p>BudgetFlow · {batch.sourceRowCount} righe · Riferimento export {formatCalendarDate(batch.referenceDate)}</p><p>Importato il {formatLocalTimestamp(batch.importedAt)} · Europe/Rome</p></div><span className={styles.attention}>Da verificare</span></li>)}</ul>}
      </section>
      <section className={styles.section} aria-labelledby="finance-transactions-title"><div className={styles.sectionHeading}><h2 id="finance-transactions-title">Movimenti originali</h2><span>EUR</span></div>
        <div className={styles.toolbar}><label className={styles.search}><Search size={16} aria-hidden="true" /><span className="sr-only">Cerca nei movimenti</span><input type="search" placeholder="Cerca conto, categoria, note…" value={query} onChange={event => setQuery(event.target.value)} /></label><label className={styles.select}><span>Stato</span><select value={filter} onChange={event => setFilter(event.target.value as Filter)}><option value="all">Tutti i movimenti</option><option value="pending">Pending</option><option value="future">Data futura</option><option value="dated">Non pending, data odierna o passata</option></select></label>{snapshot.batches.length > 1 && <label className={styles.select}><span>Export</span><select value={batchId} onChange={event => setBatchId(event.target.value)}><option value="">Tutte le importazioni</option>{snapshot.batches.map(batch => <option key={batch.id} value={batch.id}>{batch.sourceFileName}</option>)}</select></label>}</div>
        <p className={styles.tableCaption} role="status"><strong>{filtered.length}</strong> di {snapshot.transactions.length} movimenti · Date originali BudgetFlow · Confronto con il {formatCalendarDate(reportDate)} (oggi in Europe/Rome). Pending è il flag originale.</p>
        {filtered.length === 0 ? <p className={styles.noResults}>{snapshot.transactions.length === 0 ? "Nessun movimento importato." : "Nessun movimento corrisponde ai filtri."}</p> : <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th scope="col">Data locale</th><th scope="col">Conto / categoria</th><th scope="col" className={styles.statusColumn}>Stato fonte / data</th><th scope="col" className={styles.numeric}>Importo</th><th scope="col"><span className="sr-only">Dettagli</span></th></tr></thead><tbody>{filtered.map(row => <tr key={row.id}><td><time dateTime={row.sourceDate}>{formatCalendarDate(row.sourceDate)}</time></td><td><strong className={styles.rowAccount}>{row.account}</strong><span className={styles.rowCategory}>{row.category || "Senza categoria"}</span>{row.targetAccount && <span className={styles.rowCategory}>→ {row.targetAccount}</span>}<span className={styles.mobileTiming}><Timing row={row} reportDate={reportDate} /></span></td><td className={styles.statusColumn}><Timing row={row} reportDate={reportDate} /></td><td className={`${styles.numeric} ${styles.amount}`}>{row.formattedAmount}</td><td><button className={styles.detailButton} onClick={() => setSelected(row)} aria-label={`Dettagli del movimento, riga ${row.sourceRow}, ${formatCalendarDate(row.sourceDate)}, ${row.formattedAmount}`}><ArrowUpRight size={17} aria-hidden="true" /></button></td></tr>)}</tbody></table></div>}
        <p className={styles.tableFooter}>Importi con il segno dell’export · Nessuna scrittura o approvazione contabile</p>
      </section>
      <footer className={styles.footer}><span>LuckyLap · Finance</span><span>Accesso personale, verifica in due passaggi e permessi del team.</span></footer>
    </main>
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={dialogTitle} onClose={() => setSelected(null)}>{selected && <div className={styles.dialogBody}><div className={styles.dialogTop}><span>BudgetFlow · Riga {selected.sourceRow}</span><button className="icon-button" onClick={() => dialogRef.current?.close()} aria-label="Chiudi dettaglio"><X size={20} aria-hidden="true" /></button></div><h2 id={dialogTitle}>Movimento originale</h2><p className={styles.detailAmount}>{selected.formattedAmount}</p><Timing row={selected} reportDate={reportDate} /><dl className={styles.facts}><div><dt>Data locale nella fonte</dt><dd>{formatCalendarDate(selected.sourceDate)}</dd></div><div><dt>Conto di origine</dt><dd>{selected.account}</dd></div><div><dt>Conto di destinazione</dt><dd>{selected.targetAccount || "Non indicato"}</dd></div><div><dt>Categoria originale</dt><dd>{selected.category || "Non indicata"}</dd></div><div><dt>Beneficiario</dt><dd>{selected.payee || "Non indicato"}</dd></div><div><dt>Cartella</dt><dd>{selected.folder || "Non indicata"}</dd></div><div><dt>Tag</dt><dd>{selected.tags || "Non indicati"}</dd></div><div><dt>Importo testuale nella fonte · EUR</dt><dd>{selected.sourceAmount}</dd></div><div><dt>Timestamp originale (con fuso)</dt><dd>{selected.sourceTimestamp}</dd></div><div><dt>File di origine</dt><dd>{batchById.get(selected.batchId)?.sourceFileName || "Non disponibile"}</dd></div><div><dt>Revisione</dt><dd>Da verificare · record immutabile</dd></div></dl><div className={styles.notes}><h3>Note originali</h3><p>{selected.notes || "Nessuna nota nella fonte."}</p></div><p className={styles.detailNotice}>La natura contabile del movimento resta da verificare. Questa lettura non registra vendite e non modifica le scorte.</p></div>}</dialog>
  </div>;
}
