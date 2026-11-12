"use client";

import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import {
  partnerCalendarMonday,
  partnerCalendarOverlaps,
  partnerCalendarWeekNumber,
  type PartnerCalendarItem,
  type PartnerCalendarKind,
} from "../../lib/partner/database-activity";
import {
  addDays,
  addMonths,
  daysBetween,
  isCalendarDay,
  longDay,
  monthLong,
  shortDay,
} from "../../lib/partner/dates";
import styles from "./partner-database-activity.module.css";

export type PartnerCalendarMode = "mese" | "settimana" | "lista";
export type PartnerCalendarChange = {
  month?: string;
  mode?: PartnerCalendarMode;
  allHistory?: boolean;
};
type Props = {
  items: readonly PartnerCalendarItem[];
  today: string;
  month: string;
  mode: PartnerCalendarMode;
  allHistory: boolean;
  onChange: (patch: PartnerCalendarChange) => void;
  onOpen: (co: number) => void;
  estimatesAvailable: boolean;
  estimatesLoading?: boolean;
  workAvailable?: boolean;
};

const modes: Record<PartnerCalendarMode, string> = {
  mese: "Mese",
  settimana: "Settimana",
  lista: "Lista",
};
const types: { label: string; kinds: PartnerCalendarKind[] }[] = [
  { label: "Invii", kinds: ["inviata"] },
  { label: "Risposte", kinds: ["risposta"] },
  { label: "Stime", kinds: ["prevista"] },
  { label: "Solleciti da fare", kinds: ["sollecito"] },
  { label: "Azioni del team", kinds: ["azione"] },
  { label: "Eventi e scadenze", kinds: ["evento", "scadenza"] },
];
const weekdays = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const limitDay = (day: string) =>
  day < "2000-01-01" ? "2000-01-01" : day > "2100-12-31" ? "2100-12-31" : day;
const monday = (day: string) => limitDay(partnerCalendarMonday(day));
const daysFrom = (from: string, to: string) =>
  Array.from({ length: daysBetween(from, to) + 1 }, (_, index) => addDays(from, index));

function groupItems(items: readonly PartnerCalendarItem[], from: string, to: string) {
  const groups = new Map<string, PartnerCalendarItem[]>();
  for (const item of items) {
    if (!partnerCalendarOverlaps(item, from, to)) continue;
    const first = item.day < from ? from : item.day;
    const end = item.endDay && item.endDay < to ? item.endDay : item.endDay ? to : item.day;
    for (const day of daysFrom(first, end)) {
      const found = groups.get(day);
      if (found) found.push(item);
      else groups.set(day, [item]);
    }
  }
  return groups;
}

function CalendarEntry({
  item,
  onOpen,
  compact,
}: {
  item: PartnerCalendarItem;
  onOpen: Props["onOpen"];
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.calendarEntry}
      data-kind={item.kind}
      onClick={() => onOpen(item.co)}
      aria-label={`${item.name}, ${item.label}`}
    >
      <span className={styles.kindMark} aria-hidden="true" />
      <span>
        <strong>{item.name}</strong>
        <small>{item.label}</small>
        {!compact && <small>CO {item.co}</small>}
      </span>
    </button>
  );
}

function CalendarList({
  items,
  today,
  onOpen,
}: {
  items: readonly PartnerCalendarItem[];
  today: string;
  onOpen: Props["onOpen"];
}) {
  const [limit, setLimit] = useState(200);
  const groups = new Map<string, PartnerCalendarItem[]>();
  for (const item of items.slice(0, limit)) {
    const sameDay = groups.get(item.day);
    if (sameDay) sameDay.push(item);
    else groups.set(item.day, [item]);
  }
  if (items.length === 0)
    return <p className={styles.empty}>Nessuna voce nell’intervallo selezionato.</p>;
  return (
    <div className={styles.agenda}>
      {[...groups].map(([day, entries]) => (
        <section key={day} className={styles.agendaDay}>
          <h3 className={styles.agendaDate}>
            <time dateTime={day}>{longDay(day, today)}</time>
            {day === today && <small>Oggi</small>}
          </h3>
          <ul>
            {entries.map((item) => (
              <li key={item.id}>
                <CalendarEntry item={item} onOpen={onOpen} />
                {item.endDay && item.endDay !== day && (
                  <p className={styles.eventEnd}>Fino al {longDay(item.endDay, today)}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {items.length > limit && (
        <button type="button" className={styles.control} onClick={() => setLimit(limit + 200)}>
          {items.length - limit === 1
            ? "Mostra l’ultima voce"
            : `Mostra altre ${Math.min(200, items.length - limit)} voci`}
        </button>
      )}
    </div>
  );
}

export function PartnerDatabaseCalendar({
  items,
  today,
  month,
  mode,
  allHistory,
  onChange,
  onOpen,
  estimatesAvailable,
  estimatesLoading = false,
  workAvailable = true,
}: Props) {
  const [hidden, setHidden] = useState<PartnerCalendarKind[]>([]);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [focusDay, setFocusDay] = useState(today);
  const [visibleWeek, setVisibleWeek] = useState<{ day: string; month: string } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const visible = useMemo(
    () => items.filter((item) => !hidden.includes(item.kind)),
    [items, hidden],
  );
  const first = isCalendarDay(`${month}-01`) ? `${month}-01` : `${today.slice(0, 7)}-01`;
  const nextMonth = addMonths(first, 1);
  const last = isCalendarDay(nextMonth) ? addDays(nextMonth, -1) : "2100-12-31";
  const fromWeek = limitDay(addDays(today, -365));
  const toWeek = limitDay(addDays(today, 365));
  const preferredDay = focusDay.slice(0, 7) === first.slice(0, 7) ? focusDay : first;
  const preferredMonday = monday(preferredDay);
  const anchor =
    preferredMonday < fromWeek
      ? fromWeek
      : preferredMonday > toWeek
        ? monday(toWeek)
        : preferredMonday;
  const selectedMonth = first.slice(0, 7);
  const weekLabel = visibleWeek?.month === selectedMonth ? visibleWeek.day : anchor;
  const from = mode === "settimana" ? fromWeek : monday(first);
  const to = mode === "settimana" ? toWeek : limitDay(addDays(monday(last), 6));
  const byDay = useMemo(() => groupItems(visible, from, to), [visible, from, to]);

  useEffect(() => {
    if (mode !== "settimana" || !scroll.current) return;
    const container = scroll.current;
    const target = container.querySelector(`[data-calendar-day="${anchor}"]`);
    if (target)
      container.scrollLeft +=
        target.getBoundingClientRect().left - container.getBoundingClientRect().left;
  }, [mode, anchor]);

  function monthShift(amount: number) {
    const next = addMonths(first, amount);
    if (isCalendarDay(next)) {
      setExpandedDay(null);
      onChange({ month: next.slice(0, 7) });
    }
  }

  function weekShift(amount: number) {
    const next = limitDay(addDays(weekLabel, amount));
    if (next < fromWeek || next > toWeek) return;
    setFocusDay(next);
    setVisibleWeek({ day: next, month: next.slice(0, 7) });
    onChange({ month: next.slice(0, 7) });
  }

  function goToday() {
    setFocusDay(today);
    setVisibleWeek({ day: monday(today), month: today.slice(0, 7) });
    setExpandedDay(null);
    const target = scroll.current?.querySelector(`[data-calendar-day="${monday(today)}"]`);
    if (target && scroll.current)
      scroll.current.scrollLeft +=
        target.getBoundingClientRect().left - scroll.current.getBoundingClientRect().left;
    onChange({ month: today.slice(0, 7), allHistory: false });
  }

  function trackWeek(event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    const firstColumn = container.querySelector<HTMLElement>("[data-calendar-day]");
    if (!firstColumn) return;
    const width = firstColumn.getBoundingClientRect().width;
    if (width <= 0) return;
    const offset =
      container.getBoundingClientRect().left - firstColumn.getBoundingClientRect().left;
    const day = addDays(
      fromWeek,
      Math.min(daysBetween(fromWeek, toWeek), Math.max(0, Math.floor(offset / width + 0.2))),
    );
    const mondayDay = monday(day);
    setVisibleWeek({ day: mondayDay < fromWeek ? fromWeek : mondayDay, month: selectedMonth });
  }

  const monthItems = visible.filter((item) => partnerCalendarOverlaps(item, first, last));
  const before = visible.filter((item) => (item.endDay ?? item.day) < fromWeek).length;
  const after = visible.filter((item) => item.day > toWeek).length;
  const withinWeek = visible.filter((item) =>
    partnerCalendarOverlaps(item, weekLabel, limitDay(addDays(weekLabel, 6))),
  );
  const openHistory = () => onChange({ mode: "lista", allHistory: true });
  const in7 = (kind: PartnerCalendarKind) =>
    visible.filter(
      (item) => item.kind === kind && item.day >= today && item.day <= addDays(today, 6),
    ).length;
  const history = mode === "lista" && allHistory;
  const heading =
    mode === "settimana"
      ? `${shortDay(weekLabel)} – ${longDay(limitDay(addDays(weekLabel, 6)))}`
      : history
        ? "Tutto lo storico"
        : monthLong(first);

  return (
    <section aria-label="Calendario Partner" className={styles.activity}>
      <header className={styles.header}>
        <div className={styles.calendarNav}>
          {!history && (
            <button
              className={styles.control}
              type="button"
              aria-label={mode === "settimana" ? "Settimana precedente" : "Mese precedente"}
              disabled={
                mode === "settimana"
                  ? addDays(weekLabel, -7) < fromWeek
                  : !isCalendarDay(addMonths(first, -1))
              }
              onClick={() => (mode === "settimana" ? weekShift(-7) : monthShift(-1))}
            >
              ‹
            </button>
          )}
          <h2>{heading}</h2>
          {!history && (
            <button
              className={styles.control}
              type="button"
              aria-label={mode === "settimana" ? "Settimana successiva" : "Mese successivo"}
              disabled={
                mode === "settimana"
                  ? addDays(weekLabel, 7) > toWeek
                  : !isCalendarDay(addMonths(first, 1))
              }
              onClick={() => (mode === "settimana" ? weekShift(7) : monthShift(1))}
            >
              ›
            </button>
          )}
          <button className={styles.control} type="button" onClick={goToday}>
            Oggi
          </button>
        </div>
        <div className={styles.segment} role="group" aria-label="Vista del calendario">
          {(Object.keys(modes) as PartnerCalendarMode[]).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={mode === value}
              onClick={() => {
                setExpandedDay(null);
                setVisibleWeek(null);
                onChange({ mode: value });
              }}
            >
              {modes[value]}
            </button>
          ))}
        </div>
      </header>
      <p className={styles.summaryLine}>
        <strong>Prossimi 7 giorni</strong>
        <span>{estimatesAvailable ? in7("prevista") : "—"} prime email stimate</span>
        <span>{workAvailable ? in7("sollecito") : "—"} solleciti da fare</span>
        <span>{in7("azione")} azioni del team</span>
      </p>
      <div className={styles.kindFilters} role="group" aria-label="Tipi di voce del calendario">
        {types.map(({ label, kinds }) => (
          <button
            type="button"
            key={label}
            data-kind={kinds[0]}
            aria-pressed={!hidden.includes(kinds[0])}
            onClick={() =>
              setHidden((previous) =>
                previous.includes(kinds[0])
                  ? previous.filter((kind) => !kinds.includes(kind))
                  : [...previous, ...kinds],
              )
            }
          >
            <span aria-hidden="true" className={styles.kindMark} />
            {label}
          </button>
        ))}
      </div>
      <p className={styles.note}>
        Le prime email previste sono stime del Programma email. Le registrazioni importate indicano
        la data del file.
      </p>
      {!estimatesAvailable && (
        <p className={styles.status}>
          {estimatesLoading
            ? "Caricamento delle stime…"
            : "Stime del Programma email non disponibili."}
        </p>
      )}
      {!workAvailable && (
        <p className={styles.status}>Invii, risposte e solleciti del registro non disponibili.</p>
      )}
      {mode === "lista" && (
        <label className={styles.field}>
          Periodo della lista{" "}
          <select
            value={history ? "tutto" : "mese"}
            onChange={(event) => onChange({ allHistory: event.currentTarget.value === "tutto" })}
          >
            <option value="mese">Un mese</option>
            <option value="tutto">Tutto lo storico</option>
          </select>
        </label>
      )}
      {mode === "mese" && (
        <>
          <div className={styles.monthGrid} aria-label={`Calendario di ${monthLong(first)}`}>
            {weekdays.map((day) => (
              <span className={styles.weekday} key={day}>
                {day}
              </span>
            ))}
            {daysFrom(from, to).map((day) => {
              const entries = byDay.get(day) ?? [];
              return (
                <div className={styles.monthDay} data-outside={day < first || day > last} key={day}>
                  <time dateTime={day} aria-current={day === today ? "date" : undefined}>
                    {Number(day.slice(8))}
                    {day === today && <small>Oggi</small>}
                  </time>
                  {entries.slice(0, 4).map((item) => (
                    <CalendarEntry item={item} key={item.id} onOpen={onOpen} compact />
                  ))}
                  {entries.length > 4 && (
                    <button
                      type="button"
                      className={styles.moreDay}
                      aria-expanded={expandedDay === day}
                      aria-label={`Voci del ${longDay(day, today)}`}
                      onClick={() => setExpandedDay(expandedDay === day ? null : day)}
                    >
                      Altre {entries.length - 4} voci
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {expandedDay && (
            <div className={styles.desktopAgenda}>
              <CalendarList
                key={expandedDay}
                items={byDay.get(expandedDay) ?? []}
                today={today}
                onOpen={onOpen}
              />
            </div>
          )}
          <div className={styles.mobileAgenda}>
            <CalendarList key={first} items={monthItems} today={today} onOpen={onOpen} />
          </div>
        </>
      )}
      {mode === "settimana" && (
        <>
          <div
            className={styles.weekScroll}
            ref={scroll}
            onScroll={trackWeek}
            role="region"
            tabIndex={0}
            aria-label="Calendario settimanale, scorrimento orizzontale"
          >
            {before > 0 && (
              <div className={styles.weekColumn}>
                <h3>Prima del {longDay(fromWeek, today)}</h3>
                <p>{before} voci nello storico</p>
                <button className={styles.control} type="button" onClick={openHistory}>
                  Apri lo storico
                </button>
              </div>
            )}
            {daysFrom(fromWeek, toWeek).map((day) => {
              const isMonday = day === partnerCalendarMonday(day);
              return (
                <div
                  className={styles.weekColumn}
                  key={day}
                  data-calendar-day={day}
                  data-monday={isMonday}
                >
                  <h3>
                    <time dateTime={day} aria-current={day === today ? "date" : undefined}>
                      {longDay(day, today)}
                    </time>
                    <small>
                      {day === today
                        ? "Oggi"
                        : isMonday
                          ? `Settimana ${partnerCalendarWeekNumber(day)}`
                          : weekdays[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]}
                    </small>
                  </h3>
                  {(byDay.get(day) ?? []).map((item) => (
                    <CalendarEntry item={item} key={item.id} onOpen={onOpen} compact />
                  ))}
                </div>
              );
            })}
            {after > 0 && (
              <div className={styles.weekColumn}>
                <h3>Dopo il {longDay(toWeek, today)}</h3>
                <p>{after} voci oltre l’intervallo</p>
                <button className={styles.control} type="button" onClick={openHistory}>
                  Apri la lista
                </button>
              </div>
            )}
          </div>
          <div className={styles.mobileAgenda}>
            <CalendarList key={weekLabel} items={withinWeek} today={today} onOpen={onOpen} />
            {(before > 0 || after > 0) && (
              <button className={styles.control} type="button" onClick={openHistory}>
                Apri tutto lo storico
              </button>
            )}
          </div>
        </>
      )}
      {mode === "lista" && (
        <CalendarList
          key={history ? "all" : first}
          items={history ? visible : monthItems}
          today={today}
          onOpen={onOpen}
        />
      )}
    </section>
  );
}
