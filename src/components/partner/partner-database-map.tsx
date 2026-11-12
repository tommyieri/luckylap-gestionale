"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  PARTNER_DATABASE_STAGE_LABELS,
  partnerCountryName,
  type PartnerDatabaseRow,
} from "../../lib/partner/database";
import { partnerDatabaseKpis, type PartnerCalendarItem } from "../../lib/partner/database-activity";
import styles from "./partner-database.module.css";

type Shape = { code: string; path: string; center: [number, number] };
type ViewBox = { x: number; y: number; width: number };
const aspect = 0.52;
const boxes = {
  Mondo: { x: 0, y: 0, width: 1000 },
  Europa: { x: 461, y: 81, width: 195 },
  Italia: { x: 510, y: 142, width: 48 },
} satisfies Record<string, ViewBox>;
const shades = ["#e9ece4", "#bed3af", "#7fa568", "#4d783b", "#1d4b07"];
const metrics = {
  contacts: "Contatti",
  toContact: "Da contattare",
  sent: "Contattati",
  replied: "Risposte",
  replyRate: "Tasso di risposta",
  deals: "Accordi fatti",
} as const;
type Metric = keyof typeof metrics;
const percent = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 });

function keepOnMap(box: ViewBox): ViewBox {
  return {
    ...box,
    x: Math.max(-box.width / 4, Math.min(1000 - box.width * 0.75, box.x)),
    y: Math.max((-box.width * aspect) / 4, Math.min(520 - box.width * aspect * 0.75, box.y)),
  };
}

export function PartnerDatabaseMap({
  rows,
  items,
  today,
  selected,
  onCountry,
  onOpen,
  heat = false,
  workAvailable,
}: {
  rows: readonly PartnerDatabaseRow[];
  items: readonly PartnerCalendarItem[];
  today: string;
  selected: string;
  onCountry: (code: string) => void;
  onOpen: (co: number) => void;
  heat?: boolean;
  workAvailable: boolean;
}) {
  const initial = heat ? "Europa" : "Mondo";
  const [box, setBox] = useState<ViewBox>(boxes[initial]);
  const [preset, setPreset] = useState<string | null>(initial);
  const [shapes, setShapes] = useState<Shape[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [metric, setMetric] = useState<Metric>("contacts");
  const [mapWidth, setMapWidth] = useState(640);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    scale: number;
    box: ViewBox;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    },
    [],
  );
  const tableId = heat ? "partner-heat-counts" : "partner-map-counts";

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/partner/confini.json", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Confini non disponibili");
        const data: Shape[] = await response.json();
        if (!Array.isArray(data) || !data.length) throw new Error("Confini non disponibili");
        if (!controller.signal.aborted) setShapes(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setMapWidth(Math.max(1, entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [shapes]);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const rect = element!.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      zoom(
        event.deltaY < 0 ? 1.17 : 1 / 1.17,
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height,
      );
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [shapes]);

  const countries = useMemo(() => {
    const groups = new Map<string, PartnerDatabaseRow[]>();
    const countryByPartner = new Map<string, string>();
    for (const row of rows) {
      const code = row.countryCode ?? "sconosciuto";
      const group = groups.get(code) ?? [];
      group.push(row);
      groups.set(code, group);
      countryByPartner.set(row.partner.id, code);
    }
    const events = new Map<string, PartnerCalendarItem[]>();
    for (const item of items) {
      const code = countryByPartner.get(item.partnerId);
      if (!code) continue;
      const group = events.get(code) ?? [];
      group.push(item);
      events.set(code, group);
    }
    return [...groups].map(([code, group]) => ({
      code,
      name: partnerCountryName(code === "sconosciuto" ? null : code),
      rows: group,
      stats: partnerDatabaseKpis(group, events.get(code) ?? [], today),
    }));
  }, [rows, items, today]);
  const byCode = new Map(countries.map((country) => [country.code, country]));
  const chosen = byCode.get(selected);
  function value(country: (typeof countries)[number] | undefined) {
    if (!country) return null;
    if (!workAvailable && (metric === "sent" || metric === "replied" || metric === "replyRate"))
      return null;
    return country.stats[metric];
  }
  const maximum = Math.max(0, ...countries.map((country) => value(country) ?? 0));
  const ranked = [...countries].sort(
    (a, b) => (value(b) ?? -1) - (value(a) ?? -1) || a.name.localeCompare(b.name, "it"),
  );
  const label = (country: (typeof countries)[number]) => {
    const measure = value(country);
    if (measure === null) return "—";
    return metric === "replyRate" ? percent.format(measure) : String(measure);
  };
  function setNamedBox(name: keyof typeof boxes) {
    setPreset(name);
    setBox(boxes[name]);
  }
  function zoom(factor: number, x = 0.5, y = 0.5) {
    setPreset(null);
    setBox((current) => {
      const width = Math.min(1000, Math.max(5, current.width / factor));
      return keepOnMap({
        x: current.x + (current.width - width) * x,
        y: current.y + (current.width - width) * aspect * y,
        width,
      });
    });
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scale: box.width / event.currentTarget.clientWidth,
      box,
      moved: false,
    };
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const start = drag.current;
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 5) return;
    if (!start.moved) {
      event.currentTarget.setPointerCapture(event.pointerId);
      start.moved = true;
      suppressClick.current = true;
    }
    setPreset(null);
    setBox(
      keepOnMap({
        ...start.box,
        x: start.box.x - dx * start.scale,
        y: start.box.y - dy * start.scale,
      }),
    );
  }
  function selectShape(code: string, clicks: number) {
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    if (!suppressClick.current && clicks === 1)
      clickTimer.current = setTimeout(() => select(code), 230);
  }
  function select(code: string) {
    onCountry(selected === code ? "" : code);
  }

  return (
    <section
      className={styles.mapView}
      aria-label={heat ? "Mappa di calore" : "Mappa dei contatti"}
    >
      <div className={styles.viewHeading}>
        <h2>{heat ? "Mappa di calore" : "Dove sono i contatti"}</h2>
        {heat && (
          <label className={styles.field}>
            Misura
            <select value={metric} onChange={(event) => setMetric(event.target.value as Metric)}>
              {Object.entries(metrics).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className={styles.mapLayout}>
        <div className={styles.mapMain}>
          <div className={styles.mapTools} role="group" aria-label="Zoom della mappa">
            {(Object.keys(boxes) as (keyof typeof boxes)[]).map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={preset === name}
                onClick={() => setNamedBox(name)}
              >
                {name}
              </button>
            ))}
            <button type="button" aria-label="Ingrandisci la mappa" onClick={() => zoom(1.5)}>
              +
            </button>
            <button type="button" aria-label="Riduci la mappa" onClick={() => zoom(1 / 1.5)}>
              −
            </button>
            <button type="button" onClick={() => setNamedBox(initial)}>
              Resetta vista
            </button>
          </div>
          {shapes ? (
            <svg
              ref={svg}
              className={styles.mapGraphic}
              aria-hidden="true"
              viewBox={`${box.x} ${box.y} ${box.width} ${box.width * aspect}`}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onDoubleClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                zoom(
                  1.5,
                  (event.clientX - rect.left) / rect.width,
                  (event.clientY - rect.top) / rect.height,
                );
              }}
            >
              {shapes.map((shape) => {
                const country = byCode.get(shape.code);
                const measure = value(country);
                const level =
                  measure === null
                    ? 0
                    : maximum > 0
                      ? Math.max(1, Math.min(4, Math.ceil((measure / maximum) * 4)))
                      : 1;
                return (
                  <path
                    key={shape.code}
                    d={shape.path}
                    fill={shades[level]}
                    data-selectable={Boolean(country)}
                    data-selected={selected === shape.code}
                    onClick={
                      country
                        ? (event) => {
                            selectShape(shape.code, event.detail);
                          }
                        : undefined
                    }
                  >
                    <title>
                      {country
                        ? `${country.name} · ${label(country)}`
                        : partnerCountryName(shape.code)}
                    </title>
                  </path>
                );
              })}
              {!heat &&
                shapes.flatMap((shape) => {
                  const country = byCode.get(shape.code);
                  if (!country) return [];
                  const scale = box.width / mapWidth;
                  const count = country.stats.contacts;
                  return [
                    <g
                      key={shape.code}
                      data-selectable="true"
                      onClick={(event) => {
                        selectShape(shape.code, event.detail);
                      }}
                    >
                      <circle
                        cx={shape.center[0]}
                        cy={shape.center[1]}
                        r={(count > 99 ? 15 : 12) * scale}
                      />
                      <text x={shape.center[0]} y={shape.center[1]} fontSize={12 * scale}>
                        {count}
                      </text>
                      <title>
                        {country.name} · {count}
                      </title>
                    </g>,
                  ];
                })}
            </svg>
          ) : (
            <p className={styles.notice} role="status">
              {loadError
                ? "Mappa non disponibile. Puoi usare i dati per paese."
                : "Caricamento dei confini…"}
            </p>
          )}
          <p className={styles.mapLegend}>Più scuro, valore più alto · Confini Natural Earth</p>
        </div>
        <aside
          className={styles.mapAside}
          aria-label={heat ? "Classifica dei paesi" : "Contatti per paese"}
        >
          {heat ? (
            <>
              <h3>Primi paesi</h3>
              <ol>
                {ranked.slice(0, 8).map((country) => (
                  <li key={country.code}>
                    <button
                      type="button"
                      onClick={() => select(country.code)}
                      aria-pressed={country.code === selected}
                    >
                      <span>{country.name}</span>
                      <strong>{label(country)}</strong>
                    </button>
                    {metric === "replyRate" && value(country) !== null && (
                      <small>
                        {country.stats.replied} su {country.stats.sent} contattati
                      </small>
                    )}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <h3>
                {chosen?.name ??
                  (selected
                    ? partnerCountryName(selected === "sconosciuto" ? null : selected)
                    : "Tutti i paesi")}
              </h3>
              {selected && (
                <button className="text-button" type="button" onClick={() => onCountry("")}>
                  Togli il filtro paese
                </button>
              )}
              {chosen ? (
                <>
                  <p>{chosen.rows.length} contatti</p>
                  <dl>
                    {Object.entries(PARTNER_DATABASE_STAGE_LABELS).map(([stage, name]) => (
                      <div key={stage}>
                        <dt>{name}</dt>
                        <dd>
                          {chosen.rows.filter((row) => !row.blocked && row.stage === stage).length}
                        </dd>
                      </div>
                    ))}
                    {chosen.rows.some((row) => row.blocked) && (
                      <div>
                        <dt>Non contattare</dt>
                        <dd>{chosen.rows.filter((row) => row.blocked).length}</dd>
                      </div>
                    )}
                  </dl>
                  <ul>
                    {chosen.rows.map(({ partner }) => (
                      <li key={partner.id}>
                        <button type="button" onClick={() => onOpen(partner.co)}>
                          {partner.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>
                  {selected
                    ? "Nessun contatto con questi filtri."
                    : "Seleziona un paese dalla mappa o dalla tabella."}
                </p>
              )}
            </>
          )}
        </aside>
      </div>
      <details className={styles.moreFilters}>
        <summary>Vedi i numeri per paese</summary>
        <table id={tableId} className={styles.mapTable}>
          <thead>
            <tr>
              <th scope="col">Paese</th>
              <th scope="col">{metrics[metric]}</th>
              {metric === "replyRate" && <th scope="col">Contattati</th>}
            </tr>
          </thead>
          <tbody>
            {ranked.map((country) => (
              <tr key={country.code}>
                <th scope="row">
                  <button
                    type="button"
                    aria-pressed={selected === country.code}
                    onClick={() => select(country.code)}
                  >
                    {country.name}
                  </button>
                </th>
                <td>{label(country)}</td>
                {metric === "replyRate" && <td>{workAvailable ? country.stats.sent : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!ranked.length && <p>Nessun paese con questi filtri.</p>}
      </details>
    </section>
  );
}
