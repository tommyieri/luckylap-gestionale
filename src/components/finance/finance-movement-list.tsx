"use client";
import { Search, X, SlidersHorizontal, ArrowUpRight } from "lucide-react";
import type { FinanceMovement } from "../../lib/finance/dashboard";
import { financeCentsLabel } from "../../lib/finance/dashboard";
import { formatCalendarDate } from "../../lib/finance/model";
import type { FinanceView } from "../../lib/finance/workspace";
import type { RevisedMovement } from "../../lib/finance-revisions/projection";
import {
  FINANCE_SOURCE_LABELS,
  financeMovementAmount,
  financeMovementAnchor,
  financeMovementCategory,
  financeMovementDirection,
  financeMovementTitle,
  revisionAuthorLine,
} from "./finance-presentation";
import styles from "./finance-workspace.module.css";

export function FinanceMovementList({
  rows,
  view,
  categories,
  names,
  change,
  open,
  reset,
}: {
  rows: readonly RevisedMovement<FinanceMovement>[];
  view: FinanceView;
  categories: readonly string[];
  names: Record<string, string>;
  change: (patch: Partial<FinanceView>, replace?: boolean) => void;
  open: (row: FinanceMovement) => void;
  reset: () => void;
}) {
  const incoming = rows
    .filter((r) => !r.transfer && r.cents > 0n)
    .reduce((n, r) => n + r.cents, 0n);
  const outgoing = rows
    .filter((r) => !r.transfer && r.cents < 0n)
    .reduce((n, r) => n - r.cents, 0n);
  const chips = [
    view.query && { label: `Ricerca: ${view.query}`, clear: { query: "" } },
    view.direction !== "all" && {
      label:
        view.direction === "income"
          ? "Entrate"
          : view.direction === "expense"
            ? "Uscite"
            : "Trasferimenti",
      clear: { direction: "all" as const },
    },
    view.category && { label: view.category, clear: { category: "" } },
    view.account && {
      label:
        view.account === "__unallocated"
          ? "Conto da attribuire"
          : view.account === "__allocated"
            ? "Conti attribuiti"
            : view.account,
      clear: { account: "" },
    },
    view.state !== "posted" && {
      label: (
        {
          all: "Tutti gli stati",
          pending: "In sospeso",
          future: "Date future",
          unallocated: "Da attribuire",
          edited: "Modificati",
          deleted: "Eliminati",
        } as const
      )[view.state],
      clear: { state: "posted" as const },
    },
    view.source && { label: FINANCE_SOURCE_LABELS[view.source], clear: { source: "" as const } },
    view.batchId && { label: "Importazione selezionata", clear: { batchId: "" } },
  ].filter(Boolean) as { label: string; clear: Partial<FinanceView> }[];
  return (
    <section
      id="finance-transactions"
      className={styles.register}
      aria-labelledby="movements-title"
    >
      <header className={styles.sectionHeading}>
        <div>
          <h2 id="movements-title">Movimenti</h2>
          <p>Cerca una voce, aprila e correggi i dati senza perdere il punto.</p>
        </div>
      </header>
      <div className={styles.searchLine}>
        <label className={styles.search}>
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Cerca movimenti</span>
          <input
            type="search"
            value={view.query}
            placeholder="Descrizione, categoria, conto o importo"
            onChange={(e) => change({ query: e.target.value }, true)}
          />
          {view.query && (
            <button
              type="button"
              aria-label="Cancella ricerca"
              onClick={() => change({ query: "" })}
            >
              <X size={18} />
            </button>
          )}
        </label>
        <label className={styles.field}>
          <span>Tipo</span>
          <select
            value={view.direction}
            onChange={(e) => change({ direction: e.target.value as FinanceView["direction"] })}
          >
            <option value="all">Entrate e uscite</option>
            <option value="income">Entrate</option>
            <option value="expense">Uscite</option>
            <option value="transfer">Trasferimenti</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Categoria</span>
          <select value={view.category} onChange={(e) => change({ category: e.target.value })}>
            <option value="">Tutte le categorie</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details className={styles.advanced}>
        <summary>
          <SlidersHorizontal size={16} aria-hidden="true" />
          Altri filtri
        </summary>
        <div className={styles.advancedFields}>
          <label className={styles.field}>
            <span>Stato</span>
            <select
              value={view.state}
              onChange={(e) => change({ state: e.target.value as FinanceView["state"] })}
            >
              <option value="posted">Registrati</option>
              <option value="all">Tutti gli stati attivi</option>
              <option value="pending">In sospeso</option>
              <option value="future">Date future</option>
              <option value="unallocated">Conto da attribuire</option>
              <option value="edited">Modificati</option>
              <option value="deleted">Eliminati · recuperabili</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Fonte</span>
            <select
              value={view.source}
              onChange={(e) => change({ source: e.target.value as FinanceView["source"] })}
            >
              <option value="">Tutte le fonti</option>
              {Object.entries(FINANCE_SOURCE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={view.account === "__unallocated"}
              onChange={(e) => change({ account: e.target.checked ? "__unallocated" : "" })}
            />
            Solo senza conto
          </label>
        </div>
      </details>
      {chips.length > 0 && (
        <div className={styles.chips} aria-label="Filtri attivi">
          {chips.map((chip) => (
            <button key={chip.label} type="button" onClick={() => change(chip.clear)}>
              {chip.label}
              <X size={14} aria-hidden="true" />
            </button>
          ))}
          <button type="button" className={styles.clearFilters} onClick={reset}>
            Togli i filtri
          </button>
        </div>
      )}
      <div className={styles.resultLine}>
        <span>
          {rows.length} {rows.length === 1 ? "movimento" : "movimenti"}
          {view.period === "all"
            ? " · Tutti i periodi"
            : ` · ${formatCalendarDate(view.from)} – ${formatCalendarDate(view.to)}`}
        </span>
        <span>
          Entrate <b className={styles.income}>{financeCentsLabel(incoming)}</b>
          <span aria-hidden="true"> · </span>Uscite{" "}
          <b className={styles.expense}>{financeCentsLabel(outgoing)}</b>
        </span>
      </div>
      {view.state !== "posted" && (
        <p className={styles.contextNote}>
          I totali qui descrivono i risultati e lo stato selezionato. La Panoramica comprende solo i
          movimenti registrati, esclusi sospesi, futuri ed eliminati.
        </p>
      )}
      {rows.length === 0 ? (
        <div className={styles.empty}>
          <h3>Nessun movimento con questi filtri</h3>
          <p>
            {view.period === "all"
              ? "Prova una ricerca più breve o togli un filtro."
              : "La ricerca è limitata al periodo indicato."}
          </p>
          {view.period !== "all" && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => change({ period: "all" })}
            >
              Cerca in tutti i periodi
            </button>
          )}
          <button type="button" className="button button-secondary" onClick={reset}>
            Togli i filtri
          </button>
        </div>
      ) : (
        <div className={styles.movementRows} role="list" aria-label="Elenco movimenti">
          {rows.map((row) => (
            <article
              role="listitem"
              id={financeMovementAnchor(row)}
              key={row.id}
              className={styles.movementRow}
            >
              <span className={styles.rowDate}>{formatCalendarDate(row.date)}</span>
              <button
                type="button"
                className={styles.rowDescription}
                onClick={() => open(row)}
                aria-label={`Apri ${financeMovementTitle(row)}, ${financeMovementAmount(row)}`}
              >
                <strong>{financeMovementTitle(row)}</strong>
                <span>
                  {financeMovementCategory(row)}
                  <span aria-hidden="true"> · </span>
                  {row.account || "Conto da attribuire"}
                  {row.targetAccount && ` → ${row.targetAccount}`}
                </span>
              </button>
              <div className={styles.rowMeta}>
                {view.state === "deleted" && <span>Eliminato · recuperabile</span>}
                {row.pending && <span>In sospeso</span>}
                {row.future && !row.pending && <span>Data futura</span>}
                {row.revision && <span>{revisionAuthorLine(row.revision, names)}</span>}
                <span className={styles.sourceLabel}>{FINANCE_SOURCE_LABELS[row.source]}</span>
              </div>
              <div className={styles.rowAmount}>
                <span className="sr-only">{financeMovementDirection(row)}: </span>
                <strong
                  className={
                    !row.transfer && row.cents !== 0n
                      ? row.cents > 0n
                        ? styles.income
                        : styles.expense
                      : undefined
                  }
                >
                  {financeMovementAmount(row)}
                </strong>
                <button
                  type="button"
                  onClick={() => open(row)}
                  aria-label={`Dettagli e modifica di ${financeMovementTitle(row)}`}
                >
                  <ArrowUpRight size={18} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
