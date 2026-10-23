import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import {
  ACTIVITY_AREAS,
  activityAreaLabel,
  activityCursorHref,
  safeActivityHref,
  type ActivityFeedPage,
  type ActivityItem,
  type ActivityQuery,
} from "../lib/audit/feed-model";
import shared from "./team-workspace.module.css";
import styles from "./audit.module.css";

const dayFormatter = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function activityDays(items: ActivityItem[]) {
  const days = new Map<string, { label: string; items: ActivityItem[] }>();
  for (const item of items) {
    const occurredAt = new Date(item.occurredAt);
    const parts = dayKeyFormatter.formatToParts(occurredAt);
    const part = (name: Intl.DateTimeFormatPartTypes) =>
      parts.find((value) => value.type === name)!.value;
    const key = `${part("year")}-${part("month")}-${part("day")}`;
    const day = days.get(key) ?? { label: dayFormatter.format(occurredAt), items: [] };
    day.items.push(item);
    days.set(key, day);
  }
  return [...days].map(([key, value]) => ({ key, ...value }));
}

function ActivityDetail({ item }: { item: ActivityItem }) {
  const href = safeActivityHref(item.href);
  if (!href) return null;
  return (
    <Link
      className={styles.detail}
      href={href}
      prefetch={false}
      aria-label={`Apri l’elemento collegato: ${item.message}`}
    >
      Apri elemento
      <ArrowUpRight size={15} aria-hidden="true" />
    </Link>
  );
}

/** Anteprima locale (00-sequenza §1.5): dati sintetici, nessuna lettura da Supabase. */
export const AUDIT_PREVIEW_NOTICE = "Anteprima locale: dati sintetici, salvataggio disattivato.";

export function AuditView({
  snapshot,
  query,
  preview = false,
}: {
  snapshot: ActivityFeedPage;
  query: ActivityQuery;
  preview?: boolean;
}) {
  const filtered = query.actor !== null || query.area !== null;
  return (
    <div className={shared.main}>
      <div className={shared.heading}>
        <div>
          <h1>Controllo CEO</h1>
          <p>Cosa ha fatto il team nelle ultime 24 ore, dalla più recente. Orari di Roma.</p>
        </div>
      </div>
      {preview && (
        <p className={shared.previewNotice} role="note">
          {AUDIT_PREVIEW_NOTICE}
        </p>
      )}
      <form action="/audit" method="get" className={styles.filters} aria-label="Filtra le attività">
        <label>
          Persona
          <select name="actor" defaultValue={query.actor ?? ""}>
            <option value="">Tutti</option>
            {snapshot.actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
            {!snapshot.actors.some((actor) => actor.id === "system") && (
              <option value="system">Automazioni</option>
            )}
          </select>
        </label>
        <label>
          Area
          <select name="area" defaultValue={query.area ?? ""}>
            <option value="">Tutte</option>
            {ACTIVITY_AREAS.map((area) => (
              <option key={area} value={area}>
                {activityAreaLabel(area)}
              </option>
            ))}
          </select>
        </label>
        <button className="button button-primary" type="submit">
          Applica filtri
        </button>
        {filtered && (
          <Link className={styles.reset} href="/audit" prefetch={false}>
            Rimuovi filtri
          </Link>
        )}
      </form>
      <section className={styles.feed} aria-labelledby="activity-title">
        <div className={styles.feedHeading}>
          <h2 id="activity-title">Attività</h2>
          <span>{snapshot.items.length} attività in questa pagina</span>
        </div>
        {snapshot.items.length === 0 ? (
          <div className={styles.empty}>
            <h3>
              {snapshot.nextCursor
                ? "Niente in questo tratto delle 24 ore."
                : snapshot.hasCursor
                  ? "Nelle ultime 24 ore non ci sono altre attività."
                  : filtered
                    ? "Nelle ultime 24 ore nessuna attività per questi filtri."
                    : "Nelle ultime 24 ore nessuna attività."}
            </h3>
            <p>
              {snapshot.nextCursor
                ? "Continua con «Attività precedenti» per leggere il resto della giornata."
                : filtered
                  ? "Cambia persona o area, oppure rimuovi i filtri."
                  : "Le azioni del team e delle automazioni compaiono qui per 24 ore."}
            </p>
          </div>
        ) : (
          activityDays(snapshot.items).map((day) => (
            <section className={styles.day} key={day.key} aria-labelledby={`day-${day.key}`}>
              <h3 id={`day-${day.key}`}>
                <time dateTime={day.key}>{day.label}</time>
              </h3>
              <ol className={styles.items}>
                {day.items.map((item) => (
                  <li key={item.id} className={styles.item}>
                    <time className={styles.time} dateTime={item.occurredAt}>
                      {timeFormatter.format(new Date(item.occurredAt))}
                    </time>
                    <div className={styles.action}>
                      <p>{item.message}</p>
                      <span className={styles.area}>{activityAreaLabel(item.area)}</span>
                    </div>
                    <ActivityDetail item={item} />
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
        <nav aria-label="Pagine delle attività" className={styles.pagination}>
          {snapshot.hasCursor ? (
            <Link
              className="button button-secondary"
              href={activityCursorHref(null, query)}
              prefetch={false}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Più recenti
            </Link>
          ) : (
            <span>Attività più recenti</span>
          )}
          {snapshot.nextCursor && (
            <Link
              className="button button-secondary"
              href={activityCursorHref(snapshot.nextCursor, query)}
              prefetch={false}
            >
              Attività precedenti
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          )}
        </nav>
      </section>
      <p className={styles.scope}>
        Ogni riga riassume un’azione. Il feed non registra le pagine visitate o le letture dei dati.
      </p>
      <footer className={shared.footer}>
        <span>LuckyLap · Controllo CEO</span>
        <span>Sola lettura</span>
      </footer>
    </div>
  );
}
