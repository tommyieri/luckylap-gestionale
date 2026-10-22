"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, FileSpreadsheet, Search, X } from "lucide-react";
import {
  formatCalendarDate,
  formatLocalTimestamp,
  type FinanceSnapshot,
  type FinanceTransaction,
} from "@/lib/finance/model";
import {
  buildFinanceDashboard,
  financeAccountSeries,
  financeCategoryTotals,
  financeCentsLabel,
  type DashboardSettlement,
  type FinanceMovement,
} from "@/lib/finance/dashboard";
import { FINANCE_CATEGORY_GROUPS } from "@/lib/finance/categories";
import type { FinanceWorkSnapshot } from "@/lib/finance-work/model";
import { FinanceAccountChart, FINANCE_MONTHS, financeAccountColor } from "./finance-account-chart";
import styles from "./finance.module.css";

type Filter = "all" | "pending" | "future" | "dated" | "unallocated";
const sourceLabels = {
  budgetflow: "BudgetFlow",
  manual: "Voce manuale",
  payment: "Incasso ordine",
  refund: "Rimborso Shopify",
  consignment: "Incasso conto vendita",
};
const emptyWork: FinanceWorkSnapshot = {
  entries: [],
  facts: [],
  payments: [],
  orders: [],
  refunds: [],
  shopifyFinancials: [],
  shopifyTransactions: [],
};
function Timing({ row }: { row: FinanceMovement }) {
  return (
    <span className={styles.badges}>
      {row.pending && <span className={styles.attention}>Pending</span>}
      {row.future && <span className={styles.attention}>Data futura</span>}
      {!row.pending && !row.future && (
        <span className={styles.neutral}>Registrato · Da verificare</span>
      )}
    </span>
  );
}

export function FinanceImportsView({
  snapshot,
  workSnapshot = emptyWork,
  settlements = [],
  reportDate,
}: {
  snapshot: FinanceSnapshot;
  workSnapshot?: FinanceWorkSnapshot;
  settlements?: DashboardSettlement[];
  reportDate: string;
  /** Non più mostrato qui: il nome del membro sta nel menu del guscio. */
  displayName: string;
}) {
  const dashboard = useMemo(
    () => buildFinanceDashboard(snapshot, workSnapshot, reportDate, settlements),
    [snapshot, workSnapshot, reportDate, settlements],
  );
  const [year, setYear] = useState(Number(reportDate.slice(0, 4))),
    [month, setMonth] = useState("");
  const [excludedAccounts, setExcludedAccounts] = useState<string[]>([]),
    [showPlanned, setShowPlanned] = useState(false);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState<Filter>("dated"),
    [category, setCategory] = useState(""),
    [usePeriod, setUsePeriod] = useState(true),
    [batchId, setBatchId] = useState("");
  const [selected, setSelected] = useState<FinanceMovement | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null),
    transactionsRef = useRef<HTMLElement>(null),
    dialogTitle = useId();
  const accountNames = dashboard.accounts
    .filter((account) => !excludedAccounts.includes(account.name))
    .map((account) => account.name);
  const series = financeAccountSeries(dashboard, year, accountNames);
  const periodRows = dashboard.movements.filter((row) => row.date.startsWith(`${year}-${month}`));
  const periodDashboard = month ? { ...dashboard, movements: periodRows } : dashboard;
  const categories = financeCategoryTotals(periodDashboard, year, accountNames);
  const unclassified = categories.filter((row) => row.group === "unclassified");
  const totalPosted = dashboard.accounts
    .filter((account) => accountNames.includes(account.name))
    .reduce((sum, account) => sum + account.posted, 0n);
  const unallocated = dashboard.movements.filter(
    (row) => !row.account && !row.pending && !row.future,
  );
  const pendingCount = dashboard.movements.filter((row) => row.pending).length,
    futureCount = dashboard.movements.filter((row) => row.future && !row.pending).length;
  const originalById = useMemo(
    () => new Map(snapshot.transactions.map((row) => [row.id, row])),
    [snapshot.transactions],
  );
  const batchById = useMemo(
    () => new Map(snapshot.batches.map((batch) => [batch.id, batch])),
    [snapshot.batches],
  );
  const filtered = dashboard.movements.filter((row) => {
    if (
      batchId &&
      (row.source !== "budgetflow" || originalById.get(row.sourceId)?.batchId !== batchId)
    )
      return false;
    if (usePeriod && !row.date.startsWith(`${year}-${month}`)) return false;
    if (category && (row.category || "Senza categoria") !== category) return false;
    if (
      (filter === "pending" && !row.pending) ||
      (filter === "future" && (!row.future || row.pending)) ||
      (filter === "dated" && (row.pending || row.future)) ||
      (filter === "unallocated" && (row.account || row.pending || row.future))
    )
      return false;
    if (
      filter !== "unallocated" &&
      row.account &&
      !accountNames.includes(row.account) &&
      (!row.targetAccount || !accountNames.includes(row.targetAccount))
    )
      return false;
    const needle = query.trim().toLocaleLowerCase("it");
    const original = originalById.get(row.sourceId);
    return (
      !needle ||
      [
        row.account ?? "",
        row.targetAccount ?? "",
        row.category,
        row.description,
        sourceLabels[row.source],
        financeCentsLabel(row.cents),
        original?.notes ?? "",
        original?.tags ?? "",
        original?.folder ?? "",
      ].some((value) => value.toLocaleLowerCase("it").includes(needle))
    );
  });
  useEffect(() => {
    if (selected && !dialogRef.current?.open) dialogRef.current?.showModal();
    if (!selected && dialogRef.current?.open) dialogRef.current.close();
  }, [selected]);
  function drill(nextCategory: string, nextFilter: Filter = "dated") {
    setCategory(nextCategory);
    setFilter(nextFilter);
    setQuery("");
    setBatchId("");
    if (nextFilter === "unallocated" || nextFilter === "pending" || nextFilter === "future")
      setUsePeriod(false);
    else setUsePeriod(true);
    transactionsRef.current?.focus({ preventScroll: true });
    transactionsRef.current?.scrollIntoView({ block: "start" });
  }
  const original =
    selected?.source === "budgetflow" ? originalById.get(selected.sourceId) : undefined;

  return (
    <>
      <div className={styles.main}>
        <div className={styles.heading}>
          <div>
            <h1>Finance</h1>
            <p>Conti e movimenti del brand, al {formatCalendarDate(reportDate)}.</p>
          </div>
          <Link href="/finance/work#new-finance-entry" className="button button-primary">
            Nuova voce
          </Link>
        </div>
        <nav className={styles.financeNav} aria-label="Sezioni Finance">
          <a href="#finance-transactions">Movimenti</a>
          <a href="#finance-imports">Fonti importate</a>
        </nav>
        <section aria-label="Conti e saldo dai movimenti" className={styles.accountsSection}>
          <div className={styles.accountCards}>
            {dashboard.accounts.map((account) => (
              <button
                key={account.name}
                type="button"
                aria-pressed={accountNames.includes(account.name)}
                className={`${styles.balanceAccount} ${accountNames.includes(account.name) ? styles.balanceSelected : ""}`}
                onClick={() =>
                  setExcludedAccounts((current) =>
                    current.includes(account.name)
                      ? current.filter((name) => name !== account.name)
                      : [...current, account.name],
                  )
                }
              >
                <span className={styles.balanceName}>
                  <i style={{ background: financeAccountColor(account.name) }} />
                  <span>{account.name}</span>
                  <span className={styles.accountCheck}>
                    {accountNames.includes(account.name) && <Check size={13} aria-hidden="true" />}
                  </span>
                </span>
                <strong>{financeCentsLabel(account.posted)}</strong>
                <span className={styles.balanceCaption}>
                  Saldo dai movimenti · {account.count} registrazioni
                </span>
              </button>
            ))}
            <div className={styles.balanceTotal}>
              <span>Totale conti selezionati</span>
              <strong>{financeCentsLabel(totalPosted)}</strong>
              <span className={styles.balanceCaption}>
                Non pending, fino al {formatCalendarDate(reportDate)}
              </span>
            </div>
          </div>
          {!dashboard.accounts.length && (
            <p className={styles.emptyLine}>Nessun conto attribuito ai movimenti disponibili.</p>
          )}
          <p className={styles.balanceNote}>
            Saldi calcolati dalle fonti disponibili, senza saldo iniziale aggiunto. Importazioni e
            dichiarazioni restano da verificare e non equivalgono a una riconciliazione bancaria.
          </p>
        </section>
        <section className={styles.section} aria-labelledby="finance-trend-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="finance-trend-title">Andamento dei conti</h2>
              <p>
                Saldo cumulato a fine mese ·{" "}
                {year === Number(reportDate.slice(0, 4))
                  ? "mese corrente parziale"
                  : year < Number(reportDate.slice(0, 4))
                    ? "periodo storico"
                    : "periodo futuro"}
              </p>
            </div>
            <label className={styles.yearSelect}>
              <span className="sr-only">Anno del grafico e delle categorie</span>
              <select
                value={year}
                onChange={(event) => {
                  setYear(Number(event.target.value));
                  setMonth("");
                }}
              >
                {dashboard.years.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <FinanceAccountChart
            series={series}
            year={year}
            reportDate={reportDate}
            showPlanned={showPlanned}
          />
          <div className={styles.chartOptions}>
            <label>
              <input
                type="checkbox"
                checked={showPlanned}
                onChange={(event) => setShowPlanned(event.target.checked)}
              />
              Mostra movimenti futuri
            </label>
            <span>Pending sempre esclusi dal grafico.</span>
          </div>
        </section>
        <div className={styles.periodHeading}>
          <div>
            <h2>Categorie</h2>
            <p>
              Movimenti consuntivi dei conti selezionati · {year}. I trasferimenti non sono entrate
              o costi.
            </p>
          </div>
          <label className={styles.monthSelect}>
            <span>Periodo</span>
            <select value={month} onChange={(event) => setMonth(event.target.value)}>
              <option value="">Tutto l’anno</option>
              {FINANCE_MONTHS.map((label, index) => (
                <option key={label} value={String(index + 1).padStart(2, "0")}>
                  {label} {year}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.categoryGroups}>
          {FINANCE_CATEGORY_GROUPS.map((group) => {
            const rows = categories.filter((row) => row.group === group.id);
            return (
              <section
                key={group.id}
                className={styles.categoryGroup}
                aria-labelledby={`finance-category-${group.id}`}
              >
                <div className={styles.categoryGroupHeading}>
                  <div>
                    <h3 id={`finance-category-${group.id}`}>{group.label}</h3>
                    <span>{group.description}</span>
                  </div>
                  <strong>
                    {financeCentsLabel(rows.reduce((sum, row) => sum + row.cents, 0n))}
                  </strong>
                </div>
                <ul>
                  {rows.map((row) => (
                    <li key={row.category}>
                      <button type="button" onClick={() => drill(row.category)}>
                        <span>
                          {row.category}
                          <small>{row.count} movimenti</small>
                        </span>
                        <strong>{financeCentsLabel(row.cents)}</strong>
                        <ArrowUpRight size={13} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        {unclassified.length > 0 && (
          <div className={styles.customCategories}>
            <strong>Altre categorie conservate dalla fonte</strong>
            {unclassified.map((row) => (
              <button key={row.category} type="button" onClick={() => drill(row.category)}>
                {row.category}
                <span>{financeCentsLabel(row.cents)}</span>
              </button>
            ))}
          </div>
        )}
        {(pendingCount > 0 || futureCount > 0 || unallocated.length > 0) && (
          <section
            className={styles.separateFlows}
            aria-label="Movimenti separati dai saldi consuntivi"
          >
            {unallocated.length > 0 && (
              <button type="button" onClick={() => drill("", "unallocated")}>
                <strong>{unallocated.length} da attribuire</strong>
                <span>Incassi o voci senza conto · esclusi dai saldi</span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            )}
            {pendingCount > 0 && (
              <button type="button" onClick={() => drill("", "pending")}>
                <strong>{pendingCount} pending</strong>
                <span>In attesa · esclusi dal consuntivo e dal grafico</span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            )}
            {futureCount > 0 && (
              <button type="button" onClick={() => drill("", "future")}>
                <strong>{futureCount} futuri</strong>
                <span>Movimenti pianificati · separati dal consuntivo</span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            )}
          </section>
        )}
        <section
          ref={transactionsRef}
          tabIndex={-1}
          id="finance-transactions"
          className={styles.section}
          aria-labelledby="finance-transactions-title"
        >
          <div className={styles.sectionHeading}>
            <h2 id="finance-transactions-title">Movimenti</h2>
            <span>EUR · Fonti conservate</span>
          </div>
          <div className={styles.toolbar}>
            <label className={styles.search}>
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Cerca nei movimenti</span>
              <input
                type="search"
                placeholder="Cerca conto, categoria, note…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className={styles.select}>
              <span>Stato</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
                <option value="dated">Registrati, non pending</option>
                <option value="all">Tutti gli stati</option>
                <option value="pending">Pending</option>
                <option value="future">Data futura, non pending</option>
                <option value="unallocated">Conto da attribuire</option>
              </select>
            </label>
            <label className={styles.select}>
              <span>Categoria</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">Tutte le categorie</option>
                {[
                  ...new Set(
                    categories
                      .map((row) => row.category)
                      .concat(dashboard.movements.map((row) => row.category || "Senza categoria")),
                  ),
                ]
                  .sort((a, b) => a.localeCompare(b, "it"))
                  .map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
              </select>
            </label>
            {snapshot.batches.length > 1 && (
              <label className={styles.select}>
                <span>Export originale</span>
                <select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
                  <option value="">Tutte le fonti</option>
                  {snapshot.batches.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.sourceFileName}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className={styles.transactionPeriod}>
            <label>
              <input
                type="checkbox"
                checked={usePeriod}
                onChange={(event) => setUsePeriod(event.target.checked)}
              />
              Solo {month ? `${FINANCE_MONTHS[Number(month) - 1]} ` : ""}
              {year}
            </label>
            {category && (
              <button type="button" onClick={() => setCategory("")}>
                Rimuovi filtro {category}
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>
          <p className={styles.tableCaption} role="status">
            <strong>{filtered.length}</strong> di {dashboard.movements.length} movimenti · Le
            vendite e i fatti collegati non duplicano gli incassi. Gli importi senza conto rimangono
            da attribuire.
          </p>
          {filtered.length === 0 ? (
            <p className={styles.noResults}>
              {dashboard.movements.length === 0
                ? "Nessun movimento disponibile."
                : "Nessun movimento corrisponde ai filtri."}
            </p>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Conto / categoria</th>
                    <th scope="col" className={styles.statusColumn}>
                      Fonte / stato
                    </th>
                    <th scope="col" className={styles.numeric}>
                      Importo
                    </th>
                    <th scope="col">
                      <span className="sr-only">Dettagli</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <time dateTime={row.date}>{formatCalendarDate(row.date)}</time>
                      </td>
                      <td>
                        <strong className={styles.rowAccount}>
                          {row.account || "Da attribuire"}
                        </strong>
                        <span className={styles.rowCategory}>
                          {row.transfer ? "Trasferimento" : row.category || "Senza categoria"}
                        </span>
                        {row.targetAccount && (
                          <span className={styles.rowCategory}>→ {row.targetAccount}</span>
                        )}
                        <span className={styles.mobileTiming}>
                          {sourceLabels[row.source]}
                          <Timing row={row} />
                        </span>
                      </td>
                      <td className={styles.statusColumn}>
                        <span className={styles.rowSource}>{sourceLabels[row.source]}</span>
                        <Timing row={row} />
                      </td>
                      <td className={`${styles.numeric} ${styles.amount}`}>
                        {financeCentsLabel(row.cents)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.detailButton}
                          onClick={() => setSelected(row)}
                          aria-label={`Dettagli ${sourceLabels[row.source]}, ${formatCalendarDate(row.date)}, ${financeCentsLabel(row.cents)}`}
                        >
                          <ArrowUpRight size={17} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.tableFooter}>
            BudgetFlow: dati originali da verificare · Nuove voci: dichiarazioni da classificare ·
            Gli incassi non rappresentano automaticamente fatturato.
          </p>
        </section>
        <details id="finance-imports" className={styles.section}>
          <summary className={styles.sectionHeading}>
            <h2>Fonti importate</h2>
            <span>
              {snapshot.batches.length} export · {snapshot.transactions.length} movimenti originali
            </span>
          </summary>
          {snapshot.batches.length === 0 ? (
            <div className={styles.empty}>
              <FileSpreadsheet size={25} aria-hidden="true" />
              <h3>Nessun export presente.</h3>
              <p>I file importati nel workspace condiviso saranno consultabili qui.</p>
            </div>
          ) : (
            <ul className={styles.batches}>
              {snapshot.batches.map((batch) => (
                <li key={batch.id}>
                  <FileSpreadsheet size={18} aria-hidden="true" />
                  <div>
                    <strong>{batch.sourceFileName}</strong>
                    <p>
                      BudgetFlow · {batch.sourceRowCount} righe · Export del{" "}
                      {formatCalendarDate(batch.referenceDate)}
                    </p>
                    <p>Importato il {formatLocalTimestamp(batch.importedAt)} · Europe/Rome</p>
                  </div>
                  <span className={styles.attention}>Da verificare</span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.tableFooter}>
            COGS Tracker e recap PDF restano separati e non sono sommati ai conti.{" "}
            <Link href="/finance/documents">Apri i documenti originali</Link>
          </p>
        </details>
        <footer className={styles.footer}>
          <span>LuckyLap · Finance</span>
          <span>Fonti tracciabili, movimenti da verificare.</span>
        </footer>
      </div>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={dialogTitle}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className={styles.dialogBody}>
            <div className={styles.dialogTop}>
              <span>
                {sourceLabels[selected.source]}
                {original && ` · Riga ${original.sourceRow}`}
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => dialogRef.current?.close()}
                aria-label="Chiudi dettaglio"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <h2 id={dialogTitle}>{original ? "Movimento originale" : "Movimento collegato"}</h2>
            <p className={styles.detailAmount}>{financeCentsLabel(selected.cents)}</p>
            <Timing row={selected} />
            {original ? (
              <OriginalDetails
                row={original}
                sourceFile={batchById.get(original.batchId)?.sourceFileName}
              />
            ) : (
              <>
                <dl className={styles.facts}>
                  <div>
                    <dt>Data · Europe/Rome</dt>
                    <dd>{formatCalendarDate(selected.date)}</dd>
                  </div>
                  <div>
                    <dt>Conto</dt>
                    <dd>{selected.account || "Da attribuire"}</dd>
                  </div>
                  <div>
                    <dt>Categoria</dt>
                    <dd>{selected.category || "Da classificare"}</dd>
                  </div>
                  <div>
                    <dt>Descrizione</dt>
                    <dd>{selected.description}</dd>
                  </div>
                  <div>
                    <dt>Riferimento</dt>
                    <dd>{selected.sourceId}</dd>
                  </div>
                </dl>
                {selected.allocationNote && (
                  <p className={styles.detailNotice}>{selected.allocationNote}</p>
                )}
                <p className={styles.detailNotice}>
                  <Link href="/finance/work">Apri il registro Finance e la fonte collegata</Link>
                </p>
              </>
            )}
            <p className={styles.detailNotice}>
              La natura contabile del movimento resta da verificare. Questa vista non modifica dati
              o saldi bancari.
            </p>
          </div>
        )}
      </dialog>
    </>
  );
}
function OriginalDetails({ row, sourceFile }: { row: FinanceTransaction; sourceFile?: string }) {
  return (
    <>
      <dl className={styles.facts}>
        <div>
          <dt>Data locale nella fonte</dt>
          <dd>{formatCalendarDate(row.sourceDate)}</dd>
        </div>
        <div>
          <dt>Conto di origine</dt>
          <dd>{row.account}</dd>
        </div>
        <div>
          <dt>Conto di destinazione</dt>
          <dd>{row.targetAccount || "Non indicato"}</dd>
        </div>
        <div>
          <dt>Categoria originale</dt>
          <dd>{row.category || "Non indicata"}</dd>
        </div>
        <div>
          <dt>Beneficiario</dt>
          <dd>{row.payee || "Non indicato"}</dd>
        </div>
        <div>
          <dt>Cartella</dt>
          <dd>{row.folder || "Non indicata"}</dd>
        </div>
        <div>
          <dt>Tag</dt>
          <dd>{row.tags || "Non indicati"}</dd>
        </div>
        <div>
          <dt>Importo testuale nella fonte · EUR</dt>
          <dd>{row.sourceAmount}</dd>
        </div>
        <div>
          <dt>Timestamp originale (con fuso)</dt>
          <dd>{row.sourceTimestamp}</dd>
        </div>
        <div>
          <dt>File di origine</dt>
          <dd>{sourceFile || "Non disponibile"}</dd>
        </div>
        <div>
          <dt>Revisione</dt>
          <dd>Da verificare · record immutabile</dd>
        </div>
      </dl>
      <div className={styles.notes}>
        <h3>Note originali</h3>
        <p>{row.notes || "Nessuna nota nella fonte."}</p>
      </div>
    </>
  );
}
