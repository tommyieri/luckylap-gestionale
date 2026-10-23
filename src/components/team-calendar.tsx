"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import {
  WEEKDAYS,
  addDays,
  dayAriaLabel,
  defaultDay,
  eventDays,
  eventIdFromHash,
  itemCountLabel,
  itemsByDay,
  longDayLabel,
  monthGrid,
  monthLabel,
  monthOf,
  romeDayOf,
  shiftMonth,
  type DayItem,
} from "../lib/team/calendar";
import {
  eventTypeLabel,
  formatRomeDate,
  formatRomeDateTime,
  inclusiveEventEnd,
  type TeamActionState,
  type TeamEvent,
  type TeamMember,
  type TeamTask,
} from "../lib/team/model";
import {
  DeleteTeamForm,
  EditEventForm,
  EditTaskForm,
  NewEventForm,
  ToggleTaskForm,
} from "./team-workspace-forms";
import { PartnerRefText } from "./partner-ref-text";
import styles from "./team-workspace.module.css";

const ARROWS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
const clock = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const time = (instant: string) => clock.format(Date.parse(instant));

/** Orario nella lista del giorno: «10:00–10:45», «Giornata intera», «Dal 20 ottobre». */
function eventWhen(event: TeamEvent, day: string): string {
  const { first, last } = eventDays(event);
  if (event.details.allDay)
    return first === last
      ? "Giornata intera"
      : `Giornata intera, ${formatRomeDate(event.startsAt)} – ${formatRomeDate(inclusiveEventEnd(event))}`;
  if (first === last) return `${time(event.startsAt)}–${time(event.endsAt)}`;
  if (day === first) return `Dalle ${time(event.startsAt)}`;
  if (day === last) return `Fino alle ${time(event.endsAt)}`;
  return "Tutto il giorno";
}

function EventItem({
  event,
  day,
  memberName,
  highlighted,
  members,
  onSaved,
}: {
  event: TeamEvent;
  day: string;
  memberName: (id: string | null) => string;
  highlighted: boolean;
  members: TeamMember[];
  onSaved: (item: NonNullable<TeamActionState["updatedItem"]>) => void;
}) {
  const { first, last } = eventDays(event);
  return (
    <li
      id={`evento-${event.id}`}
      className={styles.event}
      data-highlight={highlighted || undefined}
      tabIndex={-1}
    >
      <div className={styles.itemMeta}>
        <span>{eventTypeLabel(event)}</span>
        <time dateTime={event.startsAt}>{eventWhen(event, day)}</time>
      </div>
      <h4>{event.title}</h4>
      {!event.details.allDay && first !== last && (
        <p className={styles.timeEnd}>
          <time dateTime={event.startsAt}>{formatRomeDateTime(event.startsAt)}</time> –{" "}
          <time dateTime={event.endsAt}>{formatRomeDateTime(event.endsAt)}</time>
        </p>
      )}
      {event.details.participantIds.length > 0 && (
        <p className={styles.participantNames}>
          Con {event.details.participantIds.map(memberName).join(", ")}
        </p>
      )}
      {event.details.summary && (
        <p className={styles.bodyText}>
          <PartnerRefText text={event.details.summary} />
        </p>
      )}
      {event.details.callUrl && (
        <a
          className={styles.callLink}
          href={event.details.callUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Apri il link della call <ExternalLink size={12} aria-hidden="true" />
        </a>
      )}
      <div className={styles.itemActions}>
        <EditEventForm event={event} members={members} onSaved={onSaved} />
        <DeleteTeamForm table="calendar_events" id={event.id} title={event.title} />
      </div>
    </li>
  );
}

function TaskItem({
  task,
  memberName,
  members,
  highlighted,
  onSaved,
}: {
  task: TeamTask;
  memberName: (id: string | null) => string;
  members: TeamMember[];
  highlighted: boolean;
  onSaved: (item: NonNullable<TeamActionState["updatedItem"]>) => void;
}) {
  return (
    <li
      id={`scadenza-${task.id}`}
      className={styles.task}
      data-highlight={highlighted || undefined}
      tabIndex={-1}
    >
      <div className={styles.itemMeta}>
        <span>
          Attività ·{" "}
          {task.status === "done"
            ? "Completata"
            : task.status === "in_progress"
              ? "In corso"
              : "Da fare"}
        </span>
        <span>{memberName(task.assignedTo)}</span>
      </div>
      <h4 className={task.status === "done" ? styles.done : undefined}>{task.title}</h4>
      <div className={styles.itemActions}>
        <ToggleTaskForm task={task} />
        <EditTaskForm task={task} members={members} onSaved={onSaved} />
        <DeleteTeamForm table="tasks" id={task.id} title={task.title} />
      </div>
    </li>
  );
}

/**
 * Calendario del team a mese: un pallino nero sui giorni con un impegno (eventi, anche di
 * giornata intera o di più giorni, e attività con scadenza), il giorno scelto sotto o accanto.
 * `#evento-<id>` apre il mese e il giorno dell'evento e lo evidenzia.
 */
export function TeamCalendar({
  events,
  tasks,
  members,
  today,
}: {
  events: TeamEvent[];
  tasks: TeamTask[];
  members: TeamMember[];
  /** Giorno di Roma «AAAA-MM-GG», uguale sul server e nel browser. */
  today: string;
}) {
  const [month, setMonth] = useState(() => monthOf(today));
  const [selected, setSelected] = useState(today);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const onSaved = useCallback((item: NonNullable<TeamActionState["updatedItem"]>) => {
    setSavedMessage(
      item.kind === "event"
        ? "Appuntamento aggiornato nel calendario del team."
        : item.day
          ? "Attività aggiornata nel calendario del team."
          : "Attività aggiornata. Senza scadenza la trovi nell’elenco Attività.",
    );
    if (item.day) {
      setMonth(monthOf(item.day));
      setSelected(item.day);
      setHighlight(item.id);
    }
  }, []);
  const items = useMemo(() => itemsByDay(events, tasks, month), [events, tasks, month]);
  const cells = useMemo(() => monthGrid(month), [month]);
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
  const memberName = (id: string | null) =>
    members.find((member) => member.id === id)?.name ??
    (id ? "Membro non disponibile" : "Da assegnare");
  const dayItems: DayItem[] = items.get(selected) ?? [];
  const monthCount = new Set(
    [...items.values()]
      .flat()
      .map((item) => (item.kind === "event" ? item.event.id : item.task.id)),
  ).size;

  function showMonth(next: string) {
    setMonth(next);
    setSelected(defaultDay(next, today, itemsByDay(events, tasks, next)));
    setHighlight(null);
  }
  function selectDay(day: string, focus = false) {
    setMonth(monthOf(day));
    setSelected(day);
    setHighlight(null);
    if (focus) setFocusDay(day);
  }
  function onDayKey(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const delta = ARROWS[event.key];
    if (!delta) return;
    event.preventDefault();
    selectDay(addDays(day, delta), true);
  }

  // Frecce: il fuoco segue il giorno scelto, anche nel mese accanto.
  useEffect(() => {
    if (!focusDay) return;
    document.querySelector<HTMLButtonElement>(`button[data-day="${focusDay}"]`)?.focus();
    setFocusDay(null);
  }, [focusDay, month]);

  // Link «/team#evento-<id>» (Oggi, Controllo CEO, Partner nel Team): mese e giorno dell'evento.
  useEffect(() => {
    function openFromHash() {
      const id = eventIdFromHash(window.location.hash);
      const event = id ? eventsRef.current.find((item) => item.id.toLowerCase() === id) : null;
      if (!event) return;
      const day = romeDayOf(event.startsAt);
      setMonth(monthOf(day));
      setSelected(day);
      setHighlight(event.id);
    }
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);
  useEffect(() => {
    if (!highlight) return;
    const element =
      document.getElementById(`evento-${highlight}`) ??
      document.getElementById(`scadenza-${highlight}`);
    element?.scrollIntoView({ block: "center" });
    element?.focus({ preventScroll: true });
  }, [highlight, selected]);

  return (
    <>
      <div className={styles.feedback} aria-live="polite">
        {savedMessage && (
          <p role="status" className={styles.success}>
            {savedMessage}
          </p>
        )}
      </div>
      <div className={styles.calendar}>
        <div className={styles.calendarMain}>
          <div className={styles.monthBar}>
            <h3 className={styles.monthTitle}>
              {monthLabel(month)} <span>{itemCountLabel(monthCount)}</span>
            </h3>
            <div className={styles.monthNav}>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => selectDay(today)}
              >
                Oggi
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Mese precedente"
                onClick={() => showMonth(shiftMonth(month, -1))}
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Mese successivo"
                onClick={() => showMonth(shiftMonth(month, 1))}
              >
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div
            className={styles.monthGrid}
            role="group"
            aria-label={`Giorni di ${monthLabel(month)}`}
          >
            {WEEKDAYS.map(([short, long]) => (
              <abbr key={short} className={styles.weekday} title={long} aria-hidden="true">
                {short}
              </abbr>
            ))}
            {cells.map((day, index) => {
              if (day === null)
                return <span key={`vuoto-${index}`} className={styles.blank} aria-hidden="true" />;
              const count = items.get(day)?.length ?? 0;
              return (
                <button
                  key={day}
                  type="button"
                  data-day={day}
                  className={styles.day}
                  aria-pressed={day === selected}
                  aria-current={day === today ? "date" : undefined}
                  aria-label={dayAriaLabel(day, count, today)}
                  tabIndex={day === selected ? 0 : -1}
                  onClick={() => selectDay(day)}
                  onKeyDown={(event) => onDayKey(event, day)}
                >
                  <span className={styles.dayNumber}>{Number(day.slice(8))}</span>
                  {count > 0 && <span className={styles.dot} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
        <div className={styles.dayPanel}>
          <h3 className={styles.dayTitle}>
            {longDayLabel(selected)}
            {selected === today && <span> · oggi</span>}
          </h3>
          {dayItems.length === 0 ? (
            <div className={styles.empty}>
              <h4>
                {events.length === 0 && tasks.every((task) => task.dueAt === null)
                  ? "Il calendario è pronto."
                  : "Niente in programma in questo giorno."}
              </h4>
              <p>Aggiungi una call, una consegna o un momento di lavoro per il team.</p>
            </div>
          ) : (
            <ul className={styles.items}>
              {dayItems.map((item) =>
                item.kind === "event" ? (
                  <EventItem
                    key={item.event.id}
                    event={item.event}
                    day={selected}
                    memberName={memberName}
                    highlighted={highlight === item.event.id}
                    members={members}
                    onSaved={onSaved}
                  />
                ) : (
                  <TaskItem
                    key={item.task.id}
                    task={item.task}
                    memberName={memberName}
                    members={members}
                    highlighted={highlight === item.task.id}
                    onSaved={onSaved}
                  />
                ),
              )}
            </ul>
          )}
        </div>
      </div>
      <div className={styles.calendarForm}>
        <NewEventForm members={members} />
      </div>
    </>
  );
}
