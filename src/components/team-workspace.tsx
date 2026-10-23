"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { romeDayOf } from "../lib/team/calendar";
import {
  TEAM_PREVIEW_NOTICE,
  formatRomeDate,
  formatRomeDateTime,
  type TeamSnapshot,
} from "../lib/team/model";
import { PartnerRefText } from "./partner-ref-text";
import { TeamCalendar } from "./team-calendar";
import {
  DeleteTeamForm,
  EditTaskForm,
  NewNoteForm,
  NewTaskForm,
  ToggleTaskForm,
} from "./team-workspace-forms";
import styles from "./team-workspace.module.css";

export function TeamWorkspace({
  snapshot,
  loadedAt,
  preview = false,
}: {
  snapshot: TeamSnapshot;
  /** Non più mostrato qui: il nome del membro sta nel menu del guscio. */
  displayName: string;
  loadedAt: string;
  /** Anteprima locale: dati sintetici e salvataggio spento. */
  preview?: boolean;
}) {
  const [refreshing, startRefresh] = useTransition();
  const router = useRouter();
  const memberName = (id: string | null) =>
    snapshot.members.find((member) => member.id === id)?.name ??
    (id ? "Membro non disponibile" : "Da assegnare");
  return (
    <div className={styles.main}>
      <div className={styles.heading}>
        <div>
          <h1>Team</h1>
          <p>
            Tutti gli eventi, le attività, le note e le idee del team, anche senza assegnatario.
          </p>
        </div>
        <button
          className="button button-secondary"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={refreshing}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {refreshing ? "Aggiornamento…" : "Aggiorna"}
        </button>
      </div>
      <nav aria-label="Sezioni del team" className={styles.navigation}>
        <a href="#calendario">Calendario e call</a>
        <a href="#attivita">Attività</a>
        <a href="#note">Note e idee</a>
        <Link href="/team/partner" prefetch={false}>
          Partner nel Team
        </Link>
      </nav>
      {preview && (
        <p className={styles.previewNotice} role="note">
          {TEAM_PREVIEW_NOTICE}
        </p>
      )}
      <p className={styles.sharedNotice}>
        Le modifiche sono salvate nel workspace condiviso. Per leggere le modifiche degli altri
        membri, usa Aggiorna. Orari Europe/Rome.
      </p>

      <section id="calendario" className={styles.section} aria-labelledby="calendar-title">
        <div className={styles.sectionHeading}>
          <h2 id="calendar-title">Calendario e call</h2>
          <span>Tocca un giorno per vedere cosa c’è</span>
        </div>
        <TeamCalendar
          events={snapshot.events}
          tasks={snapshot.tasks}
          members={snapshot.members}
          today={romeDayOf(loadedAt)}
        />
      </section>

      <section id="attivita" className={styles.section} aria-labelledby="tasks-title">
        <div className={styles.sectionHeading}>
          <h2 id="tasks-title">
            Attività <span>{snapshot.tasks.length}</span>
          </h2>
          <span>
            {snapshot.tasks.filter((task) => task.status !== "done").length} da completare
          </span>
        </div>
        <div className={styles.columns}>
          <div className={styles.list}>
            {snapshot.tasks.length === 0 ? (
              <div className={styles.empty}>
                <h3>Il prossimo passo, per tutti.</h3>
                <p>Aggiungi un’attività, con o senza assegnatario.</p>
              </div>
            ) : (
              <ul className={styles.items}>
                {snapshot.tasks.map((task) => (
                  <li key={task.id} id={`attivita-${task.id}`} className={styles.task}>
                    <div className={styles.itemMeta}>
                      <span>
                        {task.status === "done"
                          ? "Completata"
                          : task.status === "in_progress"
                            ? "In corso"
                            : "Da fare"}
                      </span>
                      <span>{memberName(task.assignedTo)}</span>
                    </div>
                    <h3 className={task.status === "done" ? styles.done : undefined}>
                      {task.title}
                    </h3>
                    {task.dueAt && (
                      <p className={styles.timeEnd}>
                        Scadenza: <time dateTime={task.dueAt}>{formatRomeDate(task.dueAt)}</time>
                      </p>
                    )}
                    {task.description && (
                      <p className={styles.bodyText}>
                        <PartnerRefText text={task.description} />
                      </p>
                    )}
                    <div className={styles.itemActions}>
                      <ToggleTaskForm task={task} />
                      <EditTaskForm task={task} members={snapshot.members} />
                      <DeleteTeamForm table="tasks" id={task.id} title={task.title} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={styles.formColumn}>
            <NewTaskForm members={snapshot.members} />
          </div>
        </div>
      </section>

      <section id="note" className={styles.section} aria-labelledby="notes-title">
        <div className={styles.sectionHeading}>
          <h2 id="notes-title">
            Note e idee <span>{snapshot.notes.length}</span>
          </h2>
          <span>Visibili a tutto il team</span>
        </div>
        <div className={styles.columns}>
          <div className={styles.list}>
            {snapshot.notes.length === 0 ? (
              <div className={styles.empty}>
                <h3>Uno spazio per le prossime idee.</h3>
                <p>Scrivi un appunto o collegalo a un’attività.</p>
              </div>
            ) : (
              <ul className={styles.items}>
                {snapshot.notes.map((note) => (
                  <li key={note.id} id={`nota-${note.id}`} className={styles.note}>
                    <div className={styles.itemMeta}>
                      <span>{memberName(note.createdBy)}</span>
                      <time dateTime={note.createdAt}>{formatRomeDateTime(note.createdAt)}</time>
                    </div>
                    <h3>{note.title}</h3>
                    {note.body && <p className={styles.bodyText}>{note.body}</p>}
                    {note.taskId && (
                      <p className={styles.related}>
                        Attività:{" "}
                        {snapshot.tasks.find((task) => task.id === note.taskId)?.title ??
                          "Attività non disponibile"}
                      </p>
                    )}
                    <DeleteTeamForm table="notes" id={note.id} title={note.title} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={styles.formColumn}>
            <NewNoteForm tasks={snapshot.tasks} />
          </div>
        </div>
      </section>
      <footer className={styles.footer}>
        <span>LuckyLap · Team</span>
        <span>Letto il {formatRomeDateTime(loadedAt)}</span>
      </footer>
    </div>
  );
}
