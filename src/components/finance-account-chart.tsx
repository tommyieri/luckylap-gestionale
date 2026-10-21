"use client";

import { useEffect, useId, useRef, useState } from "react";
import { financeCentsLabel, financeMonthTotal, type FinanceSeries } from "@/lib/finance/dashboard";
import styles from "./finance.module.css";

export const FINANCE_MONTHS = [
  "Gen",
  "Feb",
  "Mar",
  "Apr",
  "Mag",
  "Giu",
  "Lug",
  "Ago",
  "Set",
  "Ott",
  "Nov",
  "Dic",
];
const colors = ["#1d4b07", "#98602f", "#435d76", "#734c7b"];
export function financeAccountColor(name: string): string {
  if (name === "Revolut Business") return colors[0];
  if (name === "Cash") return colors[1];
  return colors[2 + ([...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 2)];
}

/** Money remains integer cents. Conversion to Number is limited to pixel coordinates. */
export function FinanceAccountChart({
  series,
  year,
  reportDate,
  showPlanned,
}: {
  series: FinanceSeries[];
  year: number;
  reportDate: string;
  showPlanned: boolean;
}) {
  const chartId = useId();
  const container = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(1000);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () =>
      setWidth(Math.max(280, element.clientWidth - (element.clientWidth < 760 ? 12 : 36)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [series.length]);
  if (!series.length)
    return (
      <div className={styles.chartEmpty}>
        <p>Seleziona almeno un conto per vedere l’andamento.</p>
      </div>
    );
  const values = series
    .flatMap((row) =>
      row.months.flatMap((month) => [month.posted, ...(showPlanned ? [month.planned] : [])]),
    )
    .filter((value): value is bigint => value !== null);
  const low = values.reduce((min, value) => (value < min ? value : min), 0n),
    high = values.reduce((max, value) => (value > max ? value : max), 0n);
  const padding = (high - low) / 12n || 100n,
    min = low - padding,
    max = high + padding,
    range = max - min;
  const left = width < 600 ? 78 : 112,
    right = width - 24;
  const x = (index: number) => left + (index * (right - left)) / 11;
  const y = (value: bigint) =>
    20 + (Number(((max - value) * 1_000_000n) / range) / 1_000_000) * 208;
  const path = (row: FinanceSeries, planned: boolean) =>
    row.months
      .map((month, index) => {
        const value = planned ? month.planned : month.posted;
        return value === null ? null : { index, value };
      })
      .filter((point): point is { index: number; value: bigint } => point !== null)
      .map((point, index) => `${index ? "L" : "M"}${x(point.index)},${y(point.value)}`)
      .join(" ");
  return (
    <>
      <div ref={container} className={styles.chartWrap}>
        <svg
          viewBox={`0 0 ${width} 270`}
          className={styles.chart}
          role="img"
          aria-labelledby={`${chartId}-title ${chartId}-description`}
        >
          <title id={`${chartId}-title`}>{`Andamento dei conti, ${year}`}</title>
          <desc
            id={`${chartId}-description`}
          >{`Saldo cumulato dai movimenti disponibili, con riporto degli anni precedenti. Il consuntivo si ferma al ${reportDate}. ${showPlanned ? "Le linee tratteggiate includono solo movimenti futuri non pending, senza modificare i saldi consuntivi." : "I movimenti futuri e pending sono esclusi."} Gli importi esatti sono disponibili nella tabella seguente.`}</desc>
          {Array.from({ length: 5 }, (_, index) => {
            const value = max - (range * BigInt(index)) / 4n;
            return (
              <g key={index}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(value)}
                  y2={y(value)}
                  className={styles.chartGrid}
                />
                <text x={left - 15} y={y(value) + 4} textAnchor="end" className={styles.chartAxis}>
                  {axisLabel(value)}
                </text>
              </g>
            );
          })}
          {min < 0n && max > 0n && (
            <line x1={left} x2={right} y1={y(0n)} y2={y(0n)} className={styles.chartZero} />
          )}
          {FINANCE_MONTHS.map((month, index) => (
            <text key={month} x={x(index)} y="254" textAnchor="middle" className={styles.chartAxis}>
              {month}
            </text>
          ))}
          {series.map((row) => (
            <g key={row.name} stroke={financeAccountColor(row.name)} fill="none">
              <path d={path(row, false)} strokeWidth="2.8" vectorEffect="non-scaling-stroke" />
              {showPlanned && (
                <path
                  d={path(row, true)}
                  strokeWidth="2"
                  strokeDasharray="6 5"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {row.months.map(
                (month, index) =>
                  month.posted !== null && (
                    <circle
                      key={month.month}
                      cx={x(index)}
                      cy={y(month.posted)}
                      r="3.4"
                      fill={financeAccountColor(row.name)}
                      stroke="#fff"
                      strokeWidth="1.5"
                    >
                      <title>{`${row.name} · ${FINANCE_MONTHS[index]} ${year}: ${financeCentsLabel(month.posted)}`}</title>
                    </circle>
                  ),
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className={styles.chartLegend}>
        {series.map((row) => (
          <span key={row.name}>
            <i style={{ background: financeAccountColor(row.name) }} />
            {row.name}
          </span>
        ))}
        {showPlanned && (
          <span>
            <i className={styles.plannedLegend} />
            Con movimenti futuri
          </span>
        )}
      </div>
      <details className={styles.chartData}>
        <summary>Tabella dati del grafico · importi esatti</summary>
        <div className={styles.tableScroll}>
          <table className={styles.chartTable}>
            <caption>
              Saldi cumulati in EUR, {year}. Il mese corrente è parziale. Pending esclusi.
            </caption>
            <thead>
              <tr>
                <th scope="col">Mese</th>
                {series.map((row) => (
                  <th key={row.name} scope="col">
                    {row.name}
                  </th>
                ))}
                <th scope="col">Totale conti selezionati</th>
                {showPlanned && <th scope="col">Totale con futuri</th>}
              </tr>
            </thead>
            <tbody>
              {FINANCE_MONTHS.map((month, index) => (
                <tr key={month}>
                  <th scope="row">
                    {month} {year}
                  </th>
                  {series.map((row) => (
                    <td key={row.name}>
                      {row.months[index].posted === null
                        ? "Non consuntivo"
                        : financeCentsLabel(row.months[index].posted!)}
                    </td>
                  ))}
                  <td>
                    {financeMonthTotal(series, index) === null
                      ? "Non consuntivo"
                      : financeCentsLabel(financeMonthTotal(series, index)!)}
                  </td>
                  {showPlanned && (
                    <td>
                      {series.every((row) => row.months[index].planned === null)
                        ? "—"
                        : financeCentsLabel(
                            series.reduce(
                              (sum, row) => sum + (row.months[index].planned ?? 0n),
                              0n,
                            ),
                          )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function axisLabel(cents: bigint) {
  const abs = cents < 0n ? -cents : cents;
  if (abs >= 1_000_000_000_000n)
    return `${cents < 0n ? "−" : ""}${(abs / 100_000_000_000n).toString()} mld €`;
  if (abs >= 100_000_000n)
    return `${cents < 0n ? "−" : ""}${(abs / 100_000_000n).toString()} mln €`;
  return `${cents < 0n ? "−" : ""}${(abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €`;
}
