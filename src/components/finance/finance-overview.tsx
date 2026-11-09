"use client";

import { useId, useState } from "react";
import { financeCentsLabel } from "../../lib/finance/dashboard";
import type { FinanceFlowBucket, FinanceSummary, FinanceView } from "../../lib/finance/workspace";
import styles from "./finance-overview.module.css";

type Props = {
  summary: FinanceSummary;
  view: FinanceView;
  onDrill: (patch: Partial<FinanceView>) => void;
};

const dayLabel = (date: string) => date.split("-").reverse().join("/");
const earlier = (left: string, right: string) => (left < right ? left : right);
const max = (left: bigint, right: bigint) => (left > right ? left : right);

/** Only a bounded ratio becomes a number; all monetary values remain bigint. */
function percent(value: bigint, ceiling: bigint): number {
  if (ceiling <= 0n || value <= 0n) return 0;
  return Number(value >= ceiling ? 10000n : (value * 10000n) / ceiling) / 100;
}

export function FinanceOverview({ summary, view, onDrill }: Props) {
  const id = useId();
  const [chart, setChart] = useState<"flows" | "balance">("flows");
  const account = view.account || "__allocated";
  const accountLabel =
    !view.account || view.account === "__allocated"
      ? "Tutti i conti attribuiti"
      : view.account === "__unallocated"
        ? "Movimenti senza conto, esclusi dai totali"
        : view.account;
  const perimeter = {
    tab: "movements",
    period: "custom",
    from: view.from,
    to: view.to,
    account,
    state: "posted",
  } as const;
  const cumulativePerimeter = (to: string): Partial<FinanceView> => ({
    ...perimeter,
    from: "0001-01-01",
    to: earlier(to, summary.asOf),
    direction: "all",
  });
  const flows = (bucket: FinanceFlowBucket, direction: "income" | "expense") =>
    onDrill({
      ...perimeter,
      from: bucket.from,
      to: bucket.to,
      direction,
    });
  const categoryDrill = (category: string) =>
    onDrill({ ...perimeter, direction: "expense", category });
  const ceiling = summary.buckets.reduce(
    (value, bucket) => max(value, max(bucket.incoming, bucket.outgoing)),
    0n,
  );
  const expenses = [...summary.expenses].sort((left, right) =>
    left.cents === right.cents
      ? left.category.localeCompare(right.category, "it")
      : left.cents > right.cents
        ? -1
        : 1,
  );
  const firstExpenses = expenses.slice(0, 5);
  const otherExpenses = expenses.slice(5);
  const otherTotal = otherExpenses.reduce((total, expense) => total + expense.cents, 0n);
  const expenseCeiling = max(expenses[0]?.cents ?? 0n, otherTotal);
  const points = summary.buckets.flatMap((bucket, index) =>
    bucket.closing === null || bucket.from > summary.asOf
      ? []
      : [{ bucket, index, value: bucket.closing }],
  );
  const low = points.reduce((value, point) => (point.value < value ? point.value : value), 0n);
  const high = points.reduce((value, point) => max(value, point.value), 0n);
  const spread = high - low || 1n;
  const plotWidth = Math.max(600, summary.buckets.length * 112);
  const x = (index: number) => ((index + 0.5) / Math.max(1, summary.buckets.length)) * plotWidth;
  const y = (value: bigint) => 160 - percent(value - low, spread) * 1.4;
  const fromBucket = summary.buckets[0]?.from;
  const toBucket = summary.buckets.at(-1)?.to;
  const weekly =
    fromBucket &&
    toBucket &&
    new Date(`${toBucket}T00:00:00Z`).getTime() - new Date(`${fromBucket}T00:00:00Z`).getTime() <
      62 * 86400000;

  const expenseRow = (expense: FinanceSummary["expenses"][number]) => (
    <li key={expense.category}>
      <button
        type="button"
        className={styles.categoryButton}
        aria-label={`${expense.category}: ${financeCentsLabel(expense.cents)}. Apri uscite`}
        onClick={() => categoryDrill(expense.category)}
      >
        <span className={styles.categoryLabel}>{expense.category}</span>
        <span className={styles.categoryAmount}>{financeCentsLabel(expense.cents)}</span>
        <span className={styles.categoryTrack} aria-hidden="true">
          <span style={{ width: `${percent(expense.cents, expenseCeiling)}%` }} />
        </span>
      </button>
    </li>
  );

  return (
    <div className={styles.overview}>
      <div className={styles.metrics} aria-label="Riepilogo dei movimenti registrati">
        <section className={styles.metric} aria-labelledby={`${id}-balance-label`}>
          <h2 id={`${id}-balance-label`}>Saldo dai movimenti</h2>
          <p className={styles.metricDate}>Al {dayLabel(summary.asOf)}</p>
          {summary.closing === null ? (
            <p className={styles.unavailable}>Saldo non disponibile</p>
          ) : (
            <button
              type="button"
              className={styles.metricValue}
              aria-label={`Apri i movimenti del saldo al ${dayLabel(summary.asOf)}`}
              onClick={() => onDrill(cumulativePerimeter(summary.asOf))}
            >
              {financeCentsLabel(summary.closing)}
            </button>
          )}
          <p className={styles.metricNote}>
            Calcolato dalle registrazioni, non verificato con la banca.
          </p>
        </section>
        <section className={styles.metric} aria-labelledby={`${id}-income-label`}>
          <h2 id={`${id}-income-label`}>Entrate registrate</h2>
          <p className={styles.metricDate}>Nel periodo selezionato</p>
          <button
            type="button"
            className={`${styles.metricValue} ${summary.incoming > 0n ? styles.income : ""}`}
            aria-label="Apri le entrate registrate nel periodo"
            onClick={() => onDrill({ ...perimeter, direction: "income" })}
          >
            {summary.incoming > 0n ? "+" : ""}
            {financeCentsLabel(summary.incoming)}
          </button>
          <p className={styles.metricNote}>Consuntivi, trasferimenti esclusi.</p>
        </section>
        <section className={styles.metric} aria-labelledby={`${id}-expense-label`}>
          <h2 id={`${id}-expense-label`}>Uscite registrate</h2>
          <p className={styles.metricDate}>Nel periodo selezionato</p>
          <button
            type="button"
            className={`${styles.metricValue} ${summary.outgoing > 0n ? styles.expense : ""}`}
            aria-label="Apri le uscite registrate nel periodo"
            onClick={() => onDrill({ ...perimeter, direction: "expense" })}
          >
            {summary.outgoing > 0n ? "−" : ""}
            {financeCentsLabel(summary.outgoing)}
          </button>
          <p className={styles.metricNote}>Uscite lorde, rimborsi inclusi.</p>
        </section>
      </div>
      <div className={styles.context}>
        <span>{accountLabel}</span>
        <span>
          Entrate − uscite:{" "}
          <strong className={styles.number}>{financeCentsLabel(summary.net)}</strong>
        </span>
      </div>
      {view.to > summary.asOf && (
        <p className={styles.partial}>
          {view.from > summary.asOf
            ? "Periodo futuro: nessun consuntivo incluso."
            : `Consuntivi fino al ${dayLabel(summary.asOf)}: il periodo è parziale.`}{" "}
          Voci future e in sospeso escluse.
        </p>
      )}
      {summary.unallocatedCount > 0 && (
        <aside className={styles.warning} aria-label="Movimenti da attribuire">
          <p>
            <strong>
              {summary.unallocatedCount}{" "}
              {summary.unallocatedCount === 1 ? "movimento senza conto" : "movimenti senza conto"}
            </strong>{" "}
            nel periodo, esclusi dai totali e dai grafici.
          </p>
          <button
            type="button"
            aria-label={`Da attribuire: ${summary.unallocatedCount} ${summary.unallocatedCount === 1 ? "movimento" : "movimenti"}`}
            onClick={() =>
              onDrill({
                ...perimeter,
                account: "__unallocated",
                direction: "all",
                state: "unallocated",
              })
            }
          >
            Da attribuire <span aria-hidden="true">→</span>
          </button>
        </aside>
      )}
      {summary.count === 0 && (
        <p className={styles.empty}>
          Nessun movimento consuntivo nei conti e nel periodo selezionati. Il saldo può includere
          registrazioni precedenti.
        </p>
      )}
      <div className={styles.charts}>
        <section className={styles.chartSection} aria-labelledby={`${id}-flow-title`}>
          <header className={styles.chartHeader}>
            <h2 id={`${id}-flow-title`}>
              {chart === "flows" ? "Entrate e uscite nel tempo" : "Andamento del saldo"}
            </h2>
            <div className={styles.switch} role="group" aria-label="Vista del grafico temporale">
              <button
                type="button"
                aria-label="Mostra entrate e uscite"
                aria-pressed={chart === "flows"}
                onClick={() => setChart("flows")}
              >
                Flussi
              </button>
              <button
                type="button"
                aria-label="Mostra andamento del saldo"
                aria-pressed={chart === "balance"}
                onClick={() => setChart("balance")}
              >
                Saldo
              </button>
            </div>
          </header>
          <p className={styles.chartNote}>
            {weekly ? "Intervalli settimanali" : "Intervalli di calendario"} ·{" "}
            {chart === "flows"
              ? "Seleziona una barra per vedere i movimenti."
              : "Saldo cumulato, trasferimenti inclusi. Seleziona un punto per vedere lo storico."}
          </p>
          {chart === "flows" ? (
            <>
              <ul className={styles.legend} aria-label="Legenda dei flussi">
                <li className={styles.income}>+ Entrate</li>
                <li className={styles.expense}>− Uscite</li>
              </ul>
              {summary.buckets.length > 0 && (
                <div
                  className={styles.chartScroll}
                  role="region"
                  aria-label="Grafico dei flussi, scorrimento orizzontale"
                  tabIndex={0}
                >
                  <div
                    className={styles.flowPlot}
                    style={{
                      gridTemplateColumns: `repeat(${summary.buckets.length}, minmax(112px, 1fr))`,
                    }}
                  >
                    {summary.buckets.map((bucket) => (
                      <div className={styles.flowBucket} key={bucket.key}>
                        {bucket.from > summary.asOf ? (
                          <div className={styles.futureBucket}>Non consuntivo</div>
                        ) : (
                          <div className={styles.barPair}>
                            {(["income", "expense"] as const).map((direction) => {
                              const incoming = direction === "income";
                              const value = incoming ? bucket.incoming : bucket.outgoing;
                              return (
                                <button
                                  type="button"
                                  className={`${styles.barButton} ${incoming ? styles.income : styles.expense}`}
                                  key={direction}
                                  aria-label={`${incoming ? "Entrate" : "Uscite"} ${bucket.label}: ${financeCentsLabel(value)}. Apri movimenti`}
                                  onClick={() => flows(bucket, direction)}
                                >
                                  <span className={styles.barValue}>
                                    {financeCentsLabel(value)}
                                  </span>
                                  <span className={styles.barWell} aria-hidden="true">
                                    <span
                                      className={styles.bar}
                                      style={{ height: `${percent(value, ceiling)}%` }}
                                    />
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <span className={styles.bucketLabel}>{bucket.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : points.length > 0 ? (
            <div
              className={styles.chartScroll}
              role="region"
              aria-label="Grafico del saldo, scorrimento orizzontale"
              tabIndex={0}
            >
              <div className={styles.balanceGraph} style={{ minWidth: `${plotWidth}px` }}>
                <div className={styles.balancePlot}>
                  <svg
                    viewBox={`0 0 ${plotWidth} 180`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <line className={styles.zeroLine} x1="0" y1={y(0n)} x2={plotWidth} y2={y(0n)} />
                    <polyline
                      className={styles.balanceLine}
                      points={points
                        .map((point) => `${x(point.index)},${y(point.value)}`)
                        .join(" ")}
                    />
                    {points.map((point) => (
                      <circle
                        key={point.bucket.key}
                        className={styles.balanceDot}
                        cx={x(point.index)}
                        cy={y(point.value)}
                        r="4"
                      />
                    ))}
                  </svg>
                  {points.map((point) => {
                    const date = earlier(point.bucket.to, summary.asOf);
                    return (
                      <button
                        key={point.bucket.key}
                        type="button"
                        className={styles.pointButton}
                        style={{
                          left: `${(x(point.index) / plotWidth) * 100}%`,
                          top: `${(y(point.value) / 180) * 100}%`,
                        }}
                        aria-label={`Saldo al ${dayLabel(date)}: ${financeCentsLabel(point.value)}. Apri movimenti`}
                        onClick={() => onDrill(cumulativePerimeter(date))}
                      />
                    );
                  })}
                </div>
                <div
                  className={styles.balanceLabels}
                  style={{
                    gridTemplateColumns: `repeat(${summary.buckets.length}, minmax(112px, 1fr))`,
                  }}
                >
                  {summary.buckets.map((bucket) => (
                    <div key={bucket.key}>
                      <span>{bucket.label}</span>
                      <strong>
                        {bucket.closing === null
                          ? "Non consuntivo"
                          : financeCentsLabel(bucket.closing)}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className={styles.empty}>Nessun saldo disponibile per questo intervallo.</p>
          )}
          <details className={styles.data}>
            <summary>Tabella dei valori esatti</summary>
            <div
              className={styles.tableScroll}
              role="region"
              aria-label="Valori del grafico temporale"
              tabIndex={0}
            >
              <table>
                <caption>
                  {chart === "flows"
                    ? "Entrate e uscite registrate per intervallo"
                    : "Saldo cumulato per intervallo"}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Intervallo</th>
                    {chart === "flows" ? (
                      <>
                        <th scope="col">Entrate</th>
                        <th scope="col">Uscite</th>
                      </>
                    ) : (
                      <th scope="col">Saldo al giorno</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {summary.buckets.map((bucket) => (
                    <tr key={bucket.key}>
                      <th scope="row">
                        {bucket.label}
                        <span className={styles.tableDate}>
                          {dayLabel(bucket.from)} – {dayLabel(bucket.to)}
                        </span>
                      </th>
                      {chart === "flows" ? (
                        bucket.from > summary.asOf ? (
                          <td colSpan={2}>Non consuntivo</td>
                        ) : (
                          <>
                            <td>
                              <button type="button" onClick={() => flows(bucket, "income")}>
                                {financeCentsLabel(bucket.incoming)}
                              </button>
                            </td>
                            <td>
                              <button type="button" onClick={() => flows(bucket, "expense")}>
                                {financeCentsLabel(bucket.outgoing)}
                              </button>
                            </td>
                          </>
                        )
                      ) : (
                        <td>
                          {bucket.closing === null || bucket.from > summary.asOf ? (
                            "Non consuntivo"
                          ) : (
                            <button
                              type="button"
                              onClick={() => onDrill(cumulativePerimeter(bucket.to))}
                            >
                              {financeCentsLabel(bucket.closing)}
                              <span className={styles.tableDate}>
                                al {dayLabel(earlier(bucket.to, summary.asOf))}
                              </span>
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section className={styles.chartSection} aria-labelledby={`${id}-expense-title`}>
          <header className={styles.chartHeader}>
            <h2 id={`${id}-expense-title`}>Dove spendiamo</h2>
          </header>
          <p className={styles.chartNote}>
            Uscite per categoria, trasferimenti esclusi. Seleziona una categoria per vedere i
            movimenti.
          </p>
          {expenses.length > 0 ? (
            <>
              <ol className={styles.expenseList}>{firstExpenses.map(expenseRow)}</ol>
              {otherExpenses.length > 0 && (
                <details className={styles.other} aria-label="Altre categorie di spesa">
                  <summary>
                    <span>
                      Altre <span className={styles.otherCount}>({otherExpenses.length})</span>
                    </span>
                    <strong>{financeCentsLabel(otherTotal)}</strong>
                    <span className={styles.categoryTrack} aria-hidden="true">
                      <span style={{ width: `${percent(otherTotal, expenseCeiling)}%` }} />
                    </span>
                  </summary>
                  <ol className={styles.expenseList} start={6}>
                    {otherExpenses.map(expenseRow)}
                  </ol>
                </details>
              )}
              <p className={styles.expenseTotal}>
                Totale uscite{" "}
                <strong className={styles.number}>{financeCentsLabel(summary.outgoing)}</strong>
              </p>
            </>
          ) : (
            <p className={styles.empty}>Nessuna uscita registrata nel periodo selezionato.</p>
          )}
          <details className={styles.data}>
            <summary>Tabella delle categorie</summary>
            <div
              className={styles.tableScroll}
              role="region"
              aria-label="Valori delle categorie di spesa"
              tabIndex={0}
            >
              <table>
                <caption>Uscite lorde registrate per categoria</caption>
                <thead>
                  <tr>
                    <th scope="col">Categoria</th>
                    <th scope="col">Uscite</th>
                    <th scope="col">Movimenti</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.category}>
                      <th scope="row">
                        <button type="button" onClick={() => categoryDrill(expense.category)}>
                          {expense.category}
                        </button>
                      </th>
                      <td>{financeCentsLabel(expense.cents)}</td>
                      <td>{expense.count}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Totale</th>
                    <td>{financeCentsLabel(summary.outgoing)}</td>
                    <td>{expenses.reduce((count, expense) => count + expense.count, 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}
