"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import type { PartnerDatabaseRow } from "../../lib/partner/database";
import {
  PARTNER_BREAKDOWN_DIMENSIONS,
  partnerDatabaseActivitySeries,
  partnerDatabaseBreakdown,
  partnerDatabaseForecast,
  partnerDatabaseKpis,
  partnerDatabaseResponseTimes,
  type PartnerActivityPeriod,
  type PartnerBreakdownDimension,
  type PartnerCalendarItem,
} from "../../lib/partner/database-activity";
import styles from "./partner-database-activity.module.css";

type Props = {
  rows: readonly PartnerDatabaseRow[];
  items: readonly PartnerCalendarItem[];
  today: string;
  workAvailable: boolean;
  estimatesAvailable: boolean;
  estimatesLoading?: boolean;
  heatMap?: ReactNode;
  onBreakdown: (dimension: PartnerBreakdownDimension, value: string) => void;
};

const periods: Record<PartnerActivityPeriod, string> = {
  "8s": "8 settimane",
  "6m": "6 mesi",
  "12m": "12 mesi",
};
const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
const average = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

function Bars({
  points,
  names,
  caption,
}: {
  points: readonly {
    key: string;
    label: string;
    values: readonly (number | null)[];
    partial?: boolean;
  }[];
  names: readonly string[];
  caption: string;
}) {
  const max = points.reduce(
    (highest, point) => Math.max(highest, ...point.values.map((value) => value ?? 0)),
    1,
  );
  return (
    <>
      <ul className={styles.chartLegend} aria-label="Legenda">
        {names.map((name, index) => (
          <li key={name}>
            <span className={styles.barSwatch} data-series={index} aria-hidden="true" />
            {name}
          </li>
        ))}
      </ul>
      <div className={styles.graphScroll} tabIndex={0} role="region" aria-label={caption}>
        <div
          className={styles.barChart}
          style={{ gridTemplateColumns: `repeat(${points.length}, minmax(68px, 1fr))` }}
        >
          {points.map(({ key, label, values, partial }) => (
            <div className={styles.barBucket} key={key}>
              <div className={styles.barColumns}>
                {values.map((value, index) => (
                  <div className={styles.barColumn} key={names[index]}>
                    <strong aria-label={`${names[index]}: ${value ?? "non disponibile"}`}>
                      {value ?? "—"}
                    </strong>
                    <span className={styles.barWell} aria-hidden="true">
                      <span
                        data-series={index}
                        style={{ height: `${((value ?? 0) / max) * 100}%` }}
                      />
                    </span>
                  </div>
                ))}
              </div>
              <span>
                {label}
                {partial && <small>Parziale</small>}
              </span>
            </div>
          ))}
        </div>
      </div>
      <details className={styles.dataTable}>
        <summary>Vedi i numeri</summary>
        <div
          className={styles.tableScroll}
          role="region"
          tabIndex={0}
          aria-label={`Dati: ${caption}`}
        >
          <table>
            <caption>{caption}</caption>
            <thead>
              <tr>
                <th scope="col">Intervallo</th>
                {names.map((name) => (
                  <th key={name} scope="col">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map(({ key, label, values, partial }) => (
                <tr key={key}>
                  <th scope="row">
                    {label}
                    {partial ? " · parziale" : ""}
                  </th>
                  {values.map((value, index) => (
                    <td key={names[index]}>{value ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

export function PartnerDatabaseInsights({
  rows,
  items,
  today,
  workAvailable,
  estimatesAvailable,
  estimatesLoading = false,
  heatMap,
  onBreakdown,
}: Props) {
  const id = useId();
  const [period, setPeriod] = useState<PartnerActivityPeriod>("8s");
  const [dimension, setDimension] = useState<PartnerBreakdownDimension>("sezione");
  const { kpis, series, responseTimes, forecast, breakdown } = useMemo(() => {
    const scope = new Set(rows.map((row) => row.partner.id));
    const scopedItems = items.filter((item) => scope.has(item.partnerId));
    return {
      kpis: partnerDatabaseKpis(rows, scopedItems, today),
      series: partnerDatabaseActivitySeries(scopedItems, today, period),
      responseTimes: partnerDatabaseResponseTimes(scopedItems, today),
      forecast: partnerDatabaseForecast(scopedItems, today),
      breakdown: partnerDatabaseBreakdown(rows, scopedItems, today, dimension),
    };
  }, [rows, items, today, period, dimension]);
  const late = rows.filter(
    (row) =>
      !row.blocked &&
      row.stage !== "chiuso" &&
      row.next.day !== null &&
      !row.next.estimated &&
      row.next.day < today,
  ).length;
  const mini = [
    {
      value:
        workAvailable && responseTimes.average !== null
          ? average.format(responseTimes.average)
          : "—",
      label: "giorni medi per risposta abbinata",
    },
    { value: workAvailable ? late : "—", label: "passi in ritardo" },
    {
      value: workAvailable
        ? rows.filter((row) => !row.blocked && row.group === "intervento").length
        : "—",
      label: "serve intervento",
    },
    {
      value:
        estimatesAvailable && workAvailable
          ? rows.filter((row) => !row.blocked && row.group === "programmato").length
          : "—",
      label: "invio programmato",
    },
    {
      value:
        workAvailable && estimatesAvailable
          ? rows.filter((row) => !row.blocked && row.group === "data").length
          : "—",
      label: "serve una data",
    },
    { value: kpis.closedWithoutDeal, label: "conclusi senza accordo" },
    { value: rows.filter((row) => row.blocked).length, label: "non contattare" },
  ];
  const milestones = [
    { label: "Contatti", value: kpis.contacts },
    { label: "Con invio registrato", value: workAvailable ? kpis.sent : null },
    { label: "Con risposta dopo un invio", value: workAvailable ? kpis.replied : null },
    { label: "In conversazione", value: kpis.inConversation },
    { label: "Accordi fatti", value: kpis.deals },
  ];
  return (
    <section className={styles.activity} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <h2 id={`${id}-title`}>Andamento</h2>
          <p className={styles.note}>Dati dei contatti che corrispondono ai filtri attivi.</p>
        </div>
      </header>
      <dl className={styles.miniStats}>
        {mini.map(({ value, label }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.insightGrid}>
        <section className={styles.insight} aria-labelledby={`${id}-series`}>
          <div className={styles.header}>
            <h3 id={`${id}-series`}>Invii e risposte registrati</h3>
            <div className={styles.segment} role="group" aria-label="Periodo dell’andamento">
              {(Object.keys(periods) as PartnerActivityPeriod[]).map((value) => (
                <button
                  type="button"
                  aria-pressed={period === value}
                  key={value}
                  onClick={() => setPeriod(value)}
                >
                  {periods[value]}
                </button>
              ))}
            </div>
          </div>
          <p className={styles.note}>
            {period === "8s" ? "Settimane da lunedì a domenica." : "Conteggi per mese."} Comprende
            le registrazioni dal vecchio sito.
          </p>
          {workAvailable ? (
            <Bars
              caption="Invii e risposte per periodo"
              names={["Invii", "Risposte"]}
              points={series.map((point) => ({
                key: point.from,
                label: point.label,
                partial: point.partial,
                values: [point.sent, point.replied],
              }))}
            />
          ) : (
            <p className={styles.status}>Registro invii e risposte non disponibile.</p>
          )}
        </section>
        <section className={styles.insight} aria-labelledby={`${id}-milestones`}>
          <h3 id={`${id}-milestones`}>Dal contatto all’accordo</h3>
          <p className={styles.note}>
            Contatti distinti. Conversazioni e accordi sono fasi attuali della scheda.
          </p>
          <ul className={styles.milestones}>
            {milestones.map(({ label, value }) => (
              <li key={label}>
                <span>{label}</span>
                <strong>{value ?? "—"}</strong>
                <span className={styles.horizontalTrack} aria-hidden="true">
                  <span
                    style={{ width: `${((value ?? 0) / Math.max(kpis.contacts, 1)) * 100}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
          {workAvailable && (
            <p className={styles.note}>
              Tasso di risposta {percent(kpis.replyRate)} · {kpis.replied} su {kpis.sent} contatti
              con invio registrato.
            </p>
          )}
        </section>
        <section className={styles.insight} aria-labelledby={`${id}-forecast`}>
          <h3 id={`${id}-forecast`}>I prossimi 14 giorni</h3>
          <p className={styles.note}>
            Prime email stimate dal Programma email e solleciti aperti del team.
          </p>
          {(!estimatesAvailable || !workAvailable) && (
            <p className={styles.status}>
              {!estimatesAvailable
                ? estimatesLoading
                  ? "Caricamento delle stime. "
                  : "Stime delle prime email non disponibili. "
                : ""}
              {!workAvailable ? "Solleciti aperti non disponibili." : ""}
            </p>
          )}
          {(estimatesAvailable || workAvailable) && (
            <Bars
              caption="Stime e solleciti per giorno"
              names={["Prime email stimate", "Solleciti da fare"]}
              points={forecast.map((point) => ({
                key: point.day,
                label: point.label,
                values: [
                  estimatesAvailable ? point.estimates : null,
                  workAvailable ? point.tasks : null,
                ],
              }))}
            />
          )}
        </section>
        <section className={styles.insight} aria-labelledby={`${id}-times`}>
          <h3 id={`${id}-times`}>Quanto ci mettono a rispondere</h3>
          <p className={styles.note}>
            Giorni tra una risposta registrata e l’ultimo invio che la precede. Le date del vecchio
            sito e gli ordini incerti restano fuori da questo calcolo.
          </p>
          {!workAvailable ? (
            <p className={styles.status}>Tempi di risposta non disponibili.</p>
          ) : responseTimes.sample === 0 ? (
            <p className={styles.empty}>Nessuna risposta abbinabile a un invio.</p>
          ) : (
            <>
              <p className={styles.note}>{responseTimes.sample} risposte abbinate.</p>
              <Bars
                caption="Giorni di risposta"
                names={["Risposte"]}
                points={responseTimes.buckets.map(({ label, count }) => ({
                  key: label,
                  label,
                  values: [count],
                }))}
              />
            </>
          )}
        </section>
      </div>
      {heatMap}
      <section className={styles.breakdown} aria-labelledby={`${id}-breakdown`}>
        <header className={styles.header}>
          <h3 id={`${id}-breakdown`}>
            Spaccato per {PARTNER_BREAKDOWN_DIMENSIONS[dimension].toLocaleLowerCase("it")}
          </h3>
          <label className={styles.field}>
            Raggruppa per{" "}
            <select
              value={dimension}
              onChange={(event) =>
                setDimension(event.currentTarget.value as PartnerBreakdownDimension)
              }
            >
              {Object.entries(PARTNER_BREAKDOWN_DIMENSIONS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </header>
        {breakdown.length === 0 ? (
          <p className={styles.empty}>Nessun contatto per i filtri attivi.</p>
        ) : (
          <div
            className={styles.tableScroll}
            role="region"
            tabIndex={0}
            aria-label="Spaccato dei contatti"
          >
            <table>
              <caption>
                Conteggi dei contatti per{" "}
                {PARTNER_BREAKDOWN_DIMENSIONS[dimension].toLocaleLowerCase("it")}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{PARTNER_BREAKDOWN_DIMENSIONS[dimension]}</th>
                  <th scope="col">Contatti</th>
                  <th scope="col">Da contattare</th>
                  <th scope="col">Con invio</th>
                  <th scope="col">Con risposta</th>
                  <th scope="col">Tasso di risposta</th>
                  <th scope="col">Accordi</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((entry) => (
                  <tr key={entry.value}>
                    <th scope="row">
                      <button
                        type="button"
                        className={styles.breakdownLink}
                        onClick={() => onBreakdown(dimension, entry.value)}
                      >
                        {entry.label}
                      </button>
                    </th>
                    <td>{entry.contacts}</td>
                    <td>{entry.toContact}</td>
                    <td>{workAvailable ? entry.sent : "—"}</td>
                    <td>{workAvailable ? entry.replied : "—"}</td>
                    <td>{workAvailable ? percent(entry.replyRate) : "—"}</td>
                    <td>{entry.deals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {dimension === "sezione" && (
          <p className={styles.note}>Un contatto può comparire in più sezioni.</p>
        )}
      </section>
    </section>
  );
}
