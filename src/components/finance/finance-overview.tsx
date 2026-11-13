"use client";

import { useId, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  CreditCard,
  Hourglass,
  TrendingUp,
} from "lucide-react";
import {
  financeCentsLabel,
  type FinanceDashboard,
  type FinanceMovement,
} from "../../lib/finance/dashboard";
import { formatCalendarDate, type FinanceTransaction } from "../../lib/finance/model";
import type { FinanceSummary, FinanceView } from "../../lib/finance/workspace";
import { FinanceAnalysis } from "./finance-analysis";
import { FinanceBalanceTrend } from "./finance-balance-trend";
import { FinanceAccountIcon, FinanceCategoryIcon, financeTags } from "./finance-category-icon";
import { financeBalanceTrends, financeOverviewSchedules } from "./finance-overview-data";
import { financeMovementAmount, financeMovementCategory } from "./finance-presentation";
import styles from "./finance-overview.module.css";

type Props = {
  dashboard: FinanceDashboard;
  summary: FinanceSummary;
  view: FinanceView;
  originalById: ReadonlyMap<string, FinanceTransaction>;
  onDrill: (patch: Partial<FinanceView>) => void;
  onOpen: (row: FinanceMovement) => void;
  mode?: "analysis";
};

const historicStart = "0001-01-01";
const month = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const moneyStyle = (amount: bigint) =>
  amount < 0n ? styles.negative : amount > 0n ? styles.positive : styles.neutral;
const toDate = (value: string) => new Date(`${value}T00:00:00Z`);

function periodTitle({ from, to, period }: FinanceView) {
  if (period === "all") return "Tutto lo storico";
  if (period === "year") return from.slice(0, 4);
  if (from.slice(0, 7) === to.slice(0, 7)) return month.format(toDate(from));
  return `${formatCalendarDate(from)} – ${formatCalendarDate(to)}`;
}

function Schedule({
  kind,
  rows,
  originalById,
  onOpen,
  onShow,
}: {
  kind: "planned" | "pending";
  rows: FinanceMovement[];
  originalById: ReadonlyMap<string, FinanceTransaction>;
  onOpen: Props["onOpen"];
  onShow: () => void;
}) {
  const id = useId();
  const [reverse, setReverse] = useState(false);
  const planned = kind === "planned";
  const visible = (reverse ? rows.slice().reverse() : rows).slice(0, 3);
  return (
    <section className={styles.accountSection} aria-labelledby={id}>
      <header className={styles.listHeading}>
        <h2 id={id}>{planned ? "Pianificati" : "In sospeso"}</h2>
        {rows.length > 1 && (
          <button type="button" onClick={() => setReverse(!reverse)}>
            Ordina per data <span aria-hidden="true">{reverse === planned ? "↓" : "↑"}</span>
          </button>
        )}
      </header>
      <div className={styles.listCard}>
        {visible.length ? (
          <ul>
            {visible.map((row) => {
              const category = financeMovementCategory(row);
              const original =
                row.source === "budgetflow" ? originalById.get(row.sourceId) : undefined;
              const tags = row.tags ?? financeTags(original?.tags ?? "");
              return (
                <li className={styles.listItem} key={row.id}>
                  <button type="button" className={styles.listRow} onClick={() => onOpen(row)}>
                    <FinanceCategoryIcon category={category} />
                    <span className={styles.rowInformation}>
                      <strong>{category}</strong>
                      <span className={styles.rowSubtitle}>
                        {row.account || "Conto da attribuire"}
                        {row.targetAccount && ` → ${row.targetAccount}`}
                      </span>
                      {tags.length > 0 && (
                        <span className={styles.tagList}>
                          {tags.map((tag) => (
                            <span key={tag}>#{tag}</span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className={styles.rowValue}>
                      <time dateTime={row.date}>{shortDay.format(toDate(row.date))}</time>
                      <strong className={moneyStyle(row.cents)}>
                        {financeMovementAmount(row)}
                      </strong>
                    </span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.emptyRow}>
            {planned ? <CalendarDays size={18} /> : <Hourglass size={18} />}
            {planned
              ? "Nessun movimento pianificato nel periodo."
              : "Nessun movimento in sospeso fino alla fine del periodo."}
          </p>
        )}
        {rows.length > 3 && (
          <button type="button" className={styles.showMore} onClick={onShow}>
            Mostra tutti ({rows.length})
          </button>
        )}
      </div>
    </section>
  );
}

export function FinanceOverview({ mode, summary, view, onDrill, ...props }: Props) {
  if (mode === "analysis")
    return <FinanceAnalysis summary={summary} view={view} onDrill={onDrill} />;
  return <FinanceRecap summary={summary} view={view} onDrill={onDrill} {...props} />;
}

function FinanceRecap({ dashboard, summary, view, originalById, onDrill, onOpen }: Props) {
  const id = useId();
  const [sortByAmount, setSortByAmount] = useState(false);
  const trends = financeBalanceTrends(dashboard, view, summary);
  const schedules = financeOverviewSchedules(dashboard, view);
  const account = view.account || "__allocated";
  const scope = { tab: "movements", period: "custom", from: view.from, to: view.to } as const;
  const openBalance = (name: string, date: string) =>
    onDrill({ ...scope, from: historicStart, to: date, account: name, state: "posted" });
  const opening = trends.reduce((total, trend) => total + trend.opening, 0n);
  const change =
    opening !== 0n && summary.closing !== null && view.from <= summary.asOf
      ? ((summary.closing - opening) * 100n) / (opening < 0n ? -opening : opening)
      : null;
  const accountRows = sortByAmount
    ? [...trends].sort((left, right) =>
        left.closing === right.closing
          ? left.name.localeCompare(right.name, "it")
          : left.closing > right.closing
            ? -1
            : 1,
      )
    : trends;

  return (
    <div className={styles.overview}>
      <section className={styles.hero} aria-labelledby={`${id}-balance`}>
        <header className={styles.heroHeading}>
          <div>
            <h2 id={`${id}-balance`}>Saldi dei conti · {periodTitle(view)}</h2>
            {summary.closing === null ? (
              <p className={styles.totalUnavailable}>Saldo non disponibile</p>
            ) : (
              <button
                type="button"
                className={styles.total}
                onClick={() => openBalance(account, summary.asOf)}
                aria-label={`Apri i movimenti del saldo al ${formatCalendarDate(summary.asOf)}`}
              >
                {financeCentsLabel(summary.closing)}
              </button>
            )}
          </div>
          <div className={styles.heroActions}>
            <div className={styles.switch} role="group" aria-label="Grafici Finance">
              <button
                type="button"
                onClick={() => onDrill({ tab: "analysis" })}
                aria-label="Apri Analisi"
              >
                <TrendingUp size={18} aria-hidden="true" />
              </button>
              <span role="img" aria-label="Vista corrente: saldi dei conti">
                <CreditCard size={18} aria-hidden="true" />
              </span>
            </div>
            {change !== null && (
              <span className={styles.delta} title="Variazione rispetto al saldo di apertura">
                {change > 0n && <ArrowUpRight size={15} aria-hidden="true" />}
                {change < 0n && <ArrowDownRight size={15} aria-hidden="true" />}
                <span className="sr-only">Variazione del saldo </span>
                {change > 0n ? "+" : change < 0n ? "−" : ""}
                {String(change < 0n ? -change : change)}%
              </span>
            )}
          </div>
        </header>
        <FinanceBalanceTrend trends={trends} asOf={summary.asOf} onOpen={openBalance} />
        <footer className={styles.heroNote}>
          Saldo dai movimenti registrati al {formatCalendarDate(summary.asOf)}. Le linee grigie
          includono i movimenti pianificati.
        </footer>
      </section>
      {summary.unallocatedCount > 0 && (
        <button
          className={styles.unassigned}
          type="button"
          onClick={() => onDrill({ ...scope, account: "__unallocated", state: "unallocated" })}
        >
          {summary.unallocatedCount}{" "}
          {summary.unallocatedCount === 1 ? "movimento senza conto" : "movimenti senza conto"} · Da
          attribuire
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}
      <section className={styles.accountSection} aria-labelledby={`${id}-accounts`}>
        <header className={styles.listHeading}>
          <h2 id={`${id}-accounts`}>Saldi dei conti</h2>
          {trends.length > 1 && (
            <button type="button" onClick={() => setSortByAmount(!sortByAmount)}>
              {sortByAmount ? "Ordina per conto" : "Ordina per saldo"}
            </button>
          )}
        </header>
        <div className={styles.listCard}>
          {accountRows.length ? (
            <ul>
              {accountRows.map(({ name, closing }) => (
                <li className={styles.listItem} key={name}>
                  <button
                    type="button"
                    className={styles.listRow}
                    onClick={() => openBalance(name, summary.asOf)}
                  >
                    <FinanceAccountIcon name={name} />
                    <span className={styles.rowInformation}>
                      <strong>{name}</strong>
                    </span>
                    <span className={styles.rowValue}>
                      <strong className={moneyStyle(closing)}>{financeCentsLabel(closing)}</strong>
                    </span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyRow}>Nessun conto nel periodo selezionato.</p>
          )}
        </div>
      </section>
      <Schedule
        kind="planned"
        rows={schedules.planned}
        originalById={originalById}
        onOpen={onOpen}
        onShow={() => onDrill({ ...scope, account: view.account, state: "future" })}
      />
      <Schedule
        kind="pending"
        rows={schedules.pending}
        originalById={originalById}
        onOpen={onOpen}
        onShow={() =>
          onDrill({ ...scope, from: historicStart, account: view.account, state: "pending" })
        }
      />
    </div>
  );
}
