"use client";

import { useState } from "react";
import { financeCentsLabel } from "../../lib/finance/dashboard";
import { formatCalendarDate } from "../../lib/finance/model";
import { chartDate, type BalancePoint, type BalanceTrend } from "./finance-overview-data";
import styles from "./finance-overview.module.css";

const shortDate = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const shortMonth = new Intl.DateTimeFormat("it-IT", { month: "short", timeZone: "UTC" });
const shortYear = new Intl.DateTimeFormat("it-IT", { year: "2-digit", timeZone: "UTC" });
const accountColors = ["#118b9d", "#815bd3", "#ad5b0b"];

export function financeTrendColor(name: string) {
  if (name === "Cash") return "#21c63b";
  if (name === "Revolut Business") return "#126121";
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return accountColors[hash % accountColors.length];
}

function axisLabel(cents: bigint) {
  const abs = cents < 0n ? -cents : cents;
  const sign = cents < 0n ? "−" : "";
  const scale = [
    { divisor: 100_000_000_000n, label: "mld" },
    { divisor: 100_000_000n, label: "mln" },
  ].find(({ divisor }) => abs >= divisor);
  if (!scale) return financeCentsLabel(cents);
  const tenths = (abs * 10n) / scale.divisor;
  return `${sign}${tenths / 10n}${tenths % 10n ? `,${tenths % 10n}` : ""} ${scale.label} €`;
}

const pointAmount = (point: BalancePoint) => point.posted ?? point.planned ?? 0n;
function balanceTicks(values: bigint[]) {
  const low = values.reduce((min, value) => (value < min ? value : min), 0n);
  const high = values.reduce((max, value) => (value > max ? value : max), 0n);
  const desired = (high - low) / 3n || 100n;
  const power = 10n ** BigInt(desired.toString().length - 1);
  const step = [power, power * 2n, power * 5n, power * 10n].find((value) => value >= desired)!;
  const min = low < 0n ? ((low - step + 1n) / step) * step : 0n;
  const max = high > 0n ? ((high + step - 1n) / step) * step : 0n;
  if (min === max) return [step, 0n, -step];
  return Array.from({ length: Number((max - min) / step) + 1 }, (_, i) => max - step * BigInt(i));
}

export function FinanceBalanceTrend({
  trends,
  asOf,
  onOpen,
}: {
  trends: readonly BalanceTrend[];
  asOf: string;
  onOpen: (account: string, date: string) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const dates = trends[0]?.points.map(({ date }) => date) ?? [];
  if (!dates.length)
    return <p className={styles.chartEmpty}>Nessun conto nel periodo selezionato.</p>;

  const width = 1000;
  const height = 300;
  const start = chartDate(dates[0]);
  const end = chartDate(dates.at(-1)!);
  const x = (date: string) =>
    start === end ? width / 2 : 14 + ((chartDate(date) - start) / (end - start)) * (width - 28);
  const ticks = balanceTicks(trends.flatMap((trend) => trend.points.map(pointAmount)));
  const top = ticks[0];
  const range = top - ticks.at(-1)!;
  const y = (value: bigint) =>
    8 + (Number(((top - value) * 10000n) / range) / 10000) * (height - 16);
  const path = (points: BalancePoint[]) => {
    if (points.length === 0) return "";
    const first = points[0];
    return points.slice(1).reduce(
      (line, point, index) => {
        const previous = points[index];
        const middle = (x(previous.date) + x(point.date)) / 2;
        return `${line} C${middle} ${y(pointAmount(previous))} ${middle} ${y(pointAmount(point))} ${x(point.date)} ${y(pointAmount(point))}`;
      },
      `M${x(first.date)} ${y(pointAmount(first))}`,
    );
  };
  const activeDate =
    selectedDate && dates.includes(selectedDate)
      ? selectedDate
      : dates.includes(asOf)
        ? asOf
        : dates[0];
  const activeIndex = dates.indexOf(activeDate);
  const displayedDates = Array.from({ length: 5 }, (_, index) => {
    const position = (width * index) / 4;
    return dates.reduce((best, date) =>
      Math.abs(position - x(date)) < Math.abs(position - x(best)) ? date : best,
    );
  }).filter((date, index, values) => !index || x(date) - x(values[index - 1]) > width / 10);
  const formatter =
    end - start < 62 * 86_400_000
      ? shortDate
      : dates[0].slice(0, 4) === dates.at(-1)!.slice(0, 4)
        ? shortMonth
        : shortYear;
  function selectClosest(clientX: number, bounds: DOMRect) {
    if (!bounds.width) return;
    const position = ((clientX - bounds.left) / bounds.width) * width;
    const closest = dates.reduce((best, date) =>
      Math.abs(position - x(date)) < Math.abs(position - x(best)) ? date : best,
    );
    setSelectedDate(closest);
  }

  return (
    <>
      <div className={styles.balanceChart}>
        <div className={styles.balancePlot}>
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
            {ticks.map((tick) => (
              <line
                key={String(tick)}
                x1="0"
                x2={width}
                y1={y(tick)}
                y2={y(tick)}
                className={styles.gridLine}
              />
            ))}
            <line
              x1={x(activeDate)}
              x2={x(activeDate)}
              y1="8"
              y2={height - 8}
              className={styles.guideLine}
            />
            {trends.map((trend) => {
              const posted = trend.points.filter((point) => point.posted !== null);
              const planned = trend.points.filter((point) => point.planned !== null);
              if (planned.length && posted.length) planned.unshift(posted.at(-1)!);
              return (
                <g key={trend.name}>
                  <path
                    className={styles.line}
                    stroke={financeTrendColor(trend.name)}
                    d={path(posted)}
                  />
                  <path className={styles.line} stroke="#c4c8cf" d={path(planned)} />
                </g>
              );
            })}
          </svg>
          <div
            className={styles.hoverArea}
            onPointerMove={(event) => {
              if (event.pointerType !== "touch") {
                selectClosest(event.clientX, event.currentTarget.getBoundingClientRect());
              }
            }}
            onPointerDown={(event) => {
              selectClosest(event.clientX, event.currentTarget.getBoundingClientRect());
            }}
          />
          {trends.map((trend) => {
            const point = trend.points[activeIndex];
            return (
              <span
                key={trend.name}
                aria-hidden="true"
                className={styles.lineMarker}
                style={{
                  left: `${(x(activeDate) / width) * 100}%`,
                  top: `${(y(pointAmount(point)) / height) * 100}%`,
                  background: point.posted !== null ? financeTrendColor(trend.name) : "#858d98",
                }}
              />
            );
          })}
        </div>
        <div className={styles.balanceAxis} aria-hidden="true">
          {ticks.map((tick) => (
            <span key={String(tick)} style={{ top: `${(y(tick) / height) * 100}%` }}>
              {axisLabel(tick)}
            </span>
          ))}
        </div>
        <div className={styles.dateAxis} aria-label="Date del grafico">
          {displayedDates.map((date) => {
            const datePosition = (x(date) / width) * 100;
            return (
              <button
                type="button"
                key={date}
                aria-label={`Mostra saldi al ${formatCalendarDate(date)}`}
                aria-pressed={date === activeDate}
                onClick={() => setSelectedDate(date)}
                style={{ left: `clamp(20px, ${datePosition}%, calc(100% - 20px))` }}
              >
                {formatter === shortYear
                  ? `’${formatter.format(chartDate(date))}`
                  : formatter.format(chartDate(date))}
              </button>
            );
          })}
        </div>
      </div>
      <div className={styles.chartReadout} aria-label="Saldi del giorno selezionato">
        <span>
          <time dateTime={activeDate}>{formatCalendarDate(activeDate)}</time>
          {activeDate > asOf && " · Previsto"}
        </span>
        {trends.map((trend) => {
          const point = trend.points[activeIndex];
          const balance = financeCentsLabel(pointAmount(point));
          return (
            <span key={trend.name}>
              <i style={{ background: financeTrendColor(trend.name) }} />
              {trend.name}{" "}
              {point.posted === null ? (
                <strong>{balance}</strong>
              ) : (
                <button
                  type="button"
                  aria-label={`Apri movimenti di ${trend.name} al ${formatCalendarDate(activeDate)}`}
                  onClick={() => onOpen(trend.name, activeDate)}
                >
                  {balance}
                </button>
              )}
            </span>
          );
        })}
      </div>
    </>
  );
}
