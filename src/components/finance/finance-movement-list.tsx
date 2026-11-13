"use client";
import { useRef, useEffect } from "react";
import {
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  Paperclip,
  Search,
  X,
  SlidersHorizontal,
} from "lucide-react";
import type { FinanceMovement } from "../../lib/finance/dashboard";
import { financeCentsLabel } from "../../lib/finance/dashboard";
import { formatCalendarDate, type FinanceTransaction } from "../../lib/finance/model";
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
import { FinanceCategoryIcon, financeTags } from "./finance-category-icon";
import styles from "./finance-workspace.module.css";

const dayLabel = new Intl.DateTimeFormat("it-IT", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function FinanceMovementList({
  rows,
  view,
  categories,
  originalById,
  invoicePaymentIds = [],
  reportDate,
  showSearch,
  names,
  change,
  open,
  reset,
}: {
  rows: readonly RevisedMovement<FinanceMovement>[];
  view: FinanceView;
  categories: readonly string[];
  originalById: ReadonlyMap<string, FinanceTransaction>;
  invoicePaymentIds?: readonly string[];
  reportDate: string;
  showSearch: boolean;
  names: Record<string, string>;
  change: (patch: Partial<FinanceView>, replace?: boolean) => void;
  open: (row: FinanceMovement) => void;
  reset: () => void;
}) {
  const search = useRef<HTMLDetailsElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (showSearch && search.current) {
      search.current.open = true;
      searchInput.current?.focus();
    }
  }, [showSearch]);
  const days = new Map<string, RevisedMovement<FinanceMovement>[]>();
  for (const row of rows) {
    const day = days.get(row.date) ?? [];
    day.push(row);
    days.set(row.date, day);
  }
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
    view.statisticsOnly && { label: "Incluse nelle statistiche", clear: { statisticsOnly: false } },
  ].filter(Boolean) as { label: string; clear: Partial<FinanceView> }[];
  return (
    <section
      id="finance-transactions"
      className={styles.register}
      aria-labelledby="movements-title"
    >
      <h1 id="movements-title" className={styles.screenHeading}>
        Movimenti
      </h1>
      <div className={styles.registerTiles}>
        <button
          type="button"
          className={styles.surface}
          aria-pressed={view.direction === "income"}
          onClick={() => change({ direction: view.direction === "income" ? "all" : "income" })}
        >
          Entrate <b className={styles.income}>{financeCentsLabel(incoming)}</b>
        </button>
        <button
          type="button"
          className={styles.surface}
          aria-pressed={view.direction === "expense"}
          onClick={() => change({ direction: view.direction === "expense" ? "all" : "expense" })}
        >
          Uscite <b className={styles.expense}>{financeCentsLabel(-outgoing)}</b>
        </button>
        <button
          type="button"
          className={styles.surface}
          onClick={() => change({ tab: "analysis" })}
        >
          <ChartNoAxesCombined size={17} aria-hidden="true" /> Analisi
        </button>
        <button
          type="button"
          className={styles.surface}
          aria-pressed={view.state === "future"}
          onClick={() =>
            change(
              view.state === "future"
                ? { state: "posted" }
                : { state: "future", period: "all", direction: "all" },
            )
          }
        >
          <CalendarDays size={17} aria-hidden="true" /> Pianificati
        </button>
      </div>
      <details ref={search} className={styles.advanced} open={view.query ? true : undefined}>
        <summary>
          <SlidersHorizontal size={16} aria-hidden="true" /> Cerca e filtra
        </summary>
        <div className={styles.searchLine}>
          <label className={styles.search}>
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Cerca movimenti</span>
            <input
              ref={searchInput}
              type="search"
              value={view.query}
              placeholder="Descrizione, categoria, tag o importo"
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
        <div className={styles.movementRows} aria-label="Elenco movimenti">
          {[...days]
            .sort(([left], [right]) => right.localeCompare(left))
            .map(([date, items]) => (
              <section key={date} className={styles.dayGroup}>
                <h2>
                  {date === reportDate ? "Oggi" : dayLabel.format(new Date(`${date}T00:00:00Z`))}
                </h2>
                <div className={styles.surface} role="list">
                  {items.map((row) => {
                    const original =
                      row.source === "budgetflow" ? originalById.get(row.sourceId) : undefined;
                    const tags = row.tags ?? financeTags(original?.tags ?? "");
                    const category = financeMovementCategory(row);
                    const description = financeMovementTitle(row);
                    const importedWithCategory = original && row.category;
                    const title = importedWithCategory ? category : description;
                    const secondary = importedWithCategory
                      ? row.revision
                        ? description
                        : original.payee
                      : category;
                    const hasInvoice =
                      row.source === "budgetflow" && invoicePaymentIds.includes(row.sourceId);
                    return (
                      <article
                        role="listitem"
                        id={financeMovementAnchor(row)}
                        key={row.id}
                        className={styles.movementRow}
                      >
                        <button
                          type="button"
                          className={styles.movementButton}
                          onClick={() => open(row)}
                          aria-label={`Dettagli e modifica di ${description}, ${financeMovementAmount(row)}${title === description ? "" : `, ${title}`}`}
                        >
                          <FinanceCategoryIcon category={row.category} />
                          <span className={styles.movementDetail}>
                            <strong>{title}</strong>
                            <span>
                              {row.account || "Conto da attribuire"}
                              {row.targetAccount && ` → ${row.targetAccount}`}
                              {secondary && secondary !== title && (
                                <>
                                  {" "}
                                  <span aria-hidden="true"> · </span> {secondary}
                                </>
                              )}
                            </span>
                            {(hasInvoice ||
                              tags.length > 0 ||
                              view.state === "deleted" ||
                              row.pending ||
                              row.future ||
                              row.revision) && (
                              <span className={styles.rowMeta}>
                                {hasInvoice && (
                                  <span className={styles.tag}>
                                    <Paperclip size={12} aria-hidden="true" /> Fattura e riepilogo
                                  </span>
                                )}
                                {tags.map((tag) => (
                                  <span className={styles.tag} key={tag}>
                                    #{tag}
                                  </span>
                                ))}
                                {view.state === "deleted" && <span>Eliminato · recuperabile</span>}
                                {row.pending && !(row.future && row.expectedPayment) && (
                                  <span>In sospeso</span>
                                )}
                                {row.future && (!row.pending || row.expectedPayment) && (
                                  <span>Pianificato</span>
                                )}
                                {row.revision && (
                                  <span>{revisionAuthorLine(row.revision, names)}</span>
                                )}
                              </span>
                            )}
                          </span>
                          <span className={styles.rowTotal}>
                            <time dateTime={date}>{formatCalendarDate(date)}</time>
                            <span className="sr-only">{financeMovementDirection(row)}: </span>
                            <strong
                              className={
                                row.transfer
                                  ? undefined
                                  : row.cents > 0n
                                    ? styles.income
                                    : styles.expense
                              }
                            >
                              {financeMovementAmount(row)}
                            </strong>
                          </span>
                          <ChevronRight
                            size={16}
                            className={styles.rowChevron}
                            aria-hidden="true"
                          />
                        </button>
                      </article>
                    );
                  })}
                </div>
                <p className={styles.daySum}>
                  Totale{" "}
                  {financeCentsLabel(
                    items.reduce((sum, row) => sum + (row.transfer ? 0n : row.cents), 0n),
                  )}
                </p>
              </section>
            ))}
        </div>
      )}
    </section>
  );
}
