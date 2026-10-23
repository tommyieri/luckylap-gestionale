import Link from "next/link";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerifiedMember } from "../../lib/auth/model";
import { eventTypeLabel, TEAM_TIME_ZONE } from "../../lib/team/model";
import { romeDay, romeTime, type AgendaEvent, type AgendaTask } from "../../lib/today/model";
import { loadAgendaTile, loadStockTile } from "../../lib/today/server";
import { RefreshButton } from "../refresh-button";
import roadbook from "../roadbook.module.css";
import styles from "./today.module.css";

/*
 * Riquadri di Oggi: componenti server asincroni, ognuno dentro il suo `<Suspense>`
 * (docs: 01-layout §9). La tappa 5 aggiunge gli altri riquadri accanto a questi.
 */

const shortDay = new Intl.DateTimeFormat("it-IT", {
  timeZone: TEAM_TIME_ZONE,
  day: "numeric",
  month: "short",
});
const longDay = new Intl.DateTimeFormat("it-IT", {
  timeZone: TEAM_TIME_ZONE,
  day: "numeric",
  month: "long",
});
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function TileFrame({
  id,
  title,
  link,
  busy = false,
  children,
}: {
  id: string;
  title: string;
  link?: { href: string; label: string };
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={styles.tile} aria-labelledby={id} aria-busy={busy || undefined}>
      <div className={styles.tileHead}>
        <h2 id={id} className={styles.tileTitle}>
          {title}
        </h2>
        {link && (
          <Link href={link.href} prefetch={false} className={styles.tileLink}>
            {link.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function TileProblem({ text }: { text: string }) {
  return (
    <div className={styles.problem} role="alert">
      <p>{text}</p>
      <RefreshButton />
    </div>
  );
}

const TILES = {
  agenda: {
    id: "oggi-agenda",
    title: "Agenda",
    link: { href: "/team#calendario", label: "Apri il calendario" },
  },
  partner: {
    id: "oggi-partner",
    title: "Contatti e solleciti",
    link: { href: "/partner", label: "Apri Partner" },
  },
  preparation: {
    id: "oggi-ordini",
    title: "Ordini da preparare",
    link: { href: "/sales", label: "Apri Vendite" },
  },
  consignment: {
    id: "oggi-conto-vendita",
    title: "Conto vendita da regolare",
    link: { href: "/finance", label: "Apri Finance" },
  },
  stock: {
    id: "oggi-magazzino",
    title: "Magazzino",
    link: { href: "/stock", label: "Apri il magazzino" },
  },
} as const;
export type TileName = keyof typeof TILES;

/** Segnaposto del riquadro: tre righe vuote alte come quelle vere, niente salti di layout. */
export function TileFallback({ tile }: { tile: TileName }) {
  return (
    <TileFrame {...TILES[tile]} busy>
      <p className="sr-only" role="status">
        Caricamento di {TILES[tile].title.toLowerCase()}…
      </p>
      <ul className={roadbook.list} aria-hidden="true">
        {[0, 1, 2].map((row) => (
          <li key={row} className={roadbook.row}>
            <span className={roadbook.spine} />
            <span className={roadbook.body} />
          </li>
        ))}
      </ul>
    </TileFrame>
  );
}

/** Anteprima locale: nessuna lettura. */
export function PreviewTile({ tile }: { tile: TileName }) {
  return (
    <TileFrame {...TILES[tile]}>
      <p className={styles.empty}>Non disponibile nell’anteprima locale.</p>
    </TileFrame>
  );
}

function EventRow({ item, day }: { item: AgendaEvent; day: string }) {
  const { event } = item;
  const inclusiveEnd = new Date(Date.parse(event.endsAt) - (event.details.allDay ? 1 : 0));
  const endsToday = romeDay(inclusiveEnd) === day;
  const until = event.details.allDay
    ? endsToday
      ? "Tutto il giorno"
      : `Tutto il giorno · fino al ${longDay.format(inclusiveEnd)}`
    : endsToday
      ? `fino alle ${romeTime(event.endsAt)}`
      : `fino al ${longDay.format(new Date(event.endsAt))}`;
  return (
    <li className={roadbook.row}>
      <div className={roadbook.spine}>
        {item.time ? (
          <span className={roadbook.spineValue}>{item.time}</span>
        ) : (
          <span className={roadbook.box}>Oggi</span>
        )}
        {item.now && !event.details.allDay && (
          <span className={`${roadbook.box} ${roadbook.isNow}`}>Adesso</span>
        )}
      </div>
      <div className={roadbook.body}>
        <Link href={`/team#evento-${event.id}`} prefetch={false} className={roadbook.rowLink}>
          <span className={roadbook.title}>{event.title}</span>
        </Link>
        <span className={roadbook.meta}>
          {eventTypeLabel(event)} · {until}
        </span>
      </div>
      {event.details.callUrl && (
        <div className={roadbook.side}>
          <a
            href={event.details.callUrl}
            target="_blank"
            rel="noreferrer"
            className={roadbook.sideLink}
          >
            Apri la call
          </a>
        </div>
      )}
    </li>
  );
}

function TaskRow({ item }: { item: AgendaTask }) {
  const due = new Date(item.task.dueAt!);
  const parts = shortDay.formatToParts(due);
  return (
    <li className={roadbook.row}>
      <div className={roadbook.spine}>
        {item.late ? (
          <>
            <span className={roadbook.spineValue}>
              {parts.find((part) => part.type === "day")?.value}
            </span>
            <span className={`${roadbook.box} ${roadbook.isLate}`}>
              {parts.find((part) => part.type === "month")?.value}
            </span>
          </>
        ) : (
          <span className={roadbook.box}>Oggi</span>
        )}
      </div>
      <div className={roadbook.body}>
        <Link href={`/team#attivita-${item.task.id}`} prefetch={false} className={roadbook.rowLink}>
          <span className={roadbook.title}>{item.task.title}</span>
        </Link>
        <span className={roadbook.meta}>
          {item.late ? (
            <>
              <span className={roadbook.late}>In ritardo</span> · scadeva il {longDay.format(due)}
            </>
          ) : (
            "Attività in scadenza oggi"
          )}
        </span>
      </div>
    </li>
  );
}

/** Agenda: appuntamenti del giorno di Roma, poi le mie attività in scadenza oggi o prima. */
export async function AgendaTile({
  supabase,
  member,
  now,
}: {
  supabase: SupabaseClient;
  member: VerifiedMember;
  now: Date;
}) {
  const tile = await loadAgendaTile(supabase, member, now);
  if (tile.status === "error")
    return (
      <TileFrame {...TILES.agenda}>
        <TileProblem text="Non riesco a leggere l’agenda. Riprova tra poco." />
      </TileFrame>
    );
  const { day, events, tasks } = tile.data;
  return (
    <TileFrame {...TILES.agenda}>
      {!events.length && <p className={styles.empty}>Nessun appuntamento oggi.</p>}
      {(events.length > 0 || tasks.length > 0) && (
        <ul className={roadbook.list}>
          {events.map((item) => (
            <EventRow key={item.event.id} item={item} day={day} />
          ))}
          {tasks.map((item) => (
            <TaskRow key={item.task.id} item={item} />
          ))}
        </ul>
      )}
    </TileFrame>
  );
}

/** Magazzino: varianti esaurite e quantità ancora da contare, con la regola unica `stockSignal`. */
export async function StockTile({ supabase }: { supabase: SupabaseClient }) {
  const tile = await loadStockTile(supabase);
  if (tile.status === "error")
    return (
      <TileFrame {...TILES.stock}>
        <TileProblem text="Non riesco a leggere il magazzino. Riprova tra poco." />
      </TileFrame>
    );
  const { esaurite, daContare } = tile.data;
  const rows: { key: string; value: number; title: string; meta: string }[] = [];
  if (esaurite > 0)
    rows.push({
      key: "esaurite",
      value: esaurite,
      title: plural(esaurite, "Variante esaurita", "Varianti esaurite"),
      meta: "Giacenza zero nel Magadzino, su varianti attive.",
    });
  if (daContare > 0)
    rows.push({
      key: "da-contare",
      value: daContare,
      title: "Quantità da contare",
      meta: "Quantità non ancora note: non valgono zero.",
    });
  return (
    <TileFrame {...TILES.stock}>
      {esaurite === 0 && <p className={styles.empty}>Nessuna variante esaurita.</p>}
      {rows.length > 0 && (
        <ul className={roadbook.list}>
          {rows.map((row) => (
            <li key={row.key} className={roadbook.row}>
              <div className={roadbook.spine}>
                <span className={roadbook.spineValue}>{row.value}</span>
              </div>
              <div className={roadbook.body}>
                <Link href="/stock" prefetch={false} className={roadbook.rowLink}>
                  <span className={roadbook.title}>
                    <span className="sr-only">{row.value} </span>
                    {row.title}
                  </span>
                </Link>
                <span className={roadbook.meta}>{row.meta}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </TileFrame>
  );
}
