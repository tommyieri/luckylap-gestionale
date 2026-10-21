"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, ExternalLink, RefreshCw } from "lucide-react";
import { formatRomeDate, formatRomeDateTime, type TeamSnapshot } from "../lib/team/model";
import { DeleteTeamForm, NewEventForm, NewNoteForm, NewTaskForm, ToggleTaskForm } from "./team-workspace-forms";
import styles from "./team-workspace.module.css";

const eventLabels = { meeting: "Call / riunione", production: "Produzione", delivery: "Consegna", launch: "Lancio", other: "Appuntamento" };

export function TeamWorkspace({ snapshot, displayName, loadedAt }: { snapshot: TeamSnapshot; displayName: string; loadedAt: string }) {
  const [showPast, setShowPast] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const router = useRouter();
  const memberName = (id: string | null) => snapshot.members.find(member => member.id === id)?.name ?? (id ? "Membro non disponibile" : "Da assegnare");
  const events = snapshot.events.filter(event => showPast || Date.parse(event.endsAt) >= Date.parse(loadedAt));
  return <div className={styles.page}>
    <a href="#team-content" className="skip-link">Vai al contenuto</a>
    <header className={styles.header}><Link href="/" className={styles.brand} aria-label="LuckyLap, workspace">LuckyLap</Link><span className={styles.area}><CalendarDays size={15} aria-hidden="true" />Team</span><Link href="/auth/account" className={styles.account}>{displayName}<span>Il tuo account</span></Link></header>
    <main id="team-content" className={styles.main} tabIndex={-1}>
      <Link href="/" className={styles.back}><ArrowLeft size={14} aria-hidden="true" />Torna al workspace</Link>
      <div className={styles.heading}><div><h1>Il lavoro del team.</h1><p>Calendario, attività e idee condivisi tra i membri di LuckyLap.</p></div><button className="button button-secondary" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing}><RefreshCw size={14} aria-hidden="true" />{refreshing ? "Aggiornamento…" : "Aggiorna"}</button></div>
      <nav aria-label="Sezioni del team" className={styles.navigation}><a href="#calendario">Calendario e call</a><a href="#attivita">Attività</a><a href="#note">Note e idee</a></nav>
      <p className={styles.sharedNotice}>Le modifiche sono salvate nel workspace condiviso. Per leggere le modifiche degli altri membri, usa Aggiorna. Orari Europe/Rome.</p>

      <section id="calendario" className={styles.section} aria-labelledby="calendar-title">
        <div className={styles.sectionHeading}><h2 id="calendar-title">Calendario e call <span>{snapshot.events.length}</span></h2><label className={styles.filter}><input type="checkbox" checked={showPast} onChange={event => setShowPast(event.target.checked)} />Mostra anche passati</label></div>
        <div className={styles.columns}><div className={styles.list}>
          {events.length === 0 ? <div className={styles.empty}><h3>{snapshot.events.length ? "Nessun appuntamento in programma." : "Il calendario è pronto."}</h3><p>Aggiungi una call, una consegna o un momento di lavoro per il team.</p></div> : <ul className={styles.items}>{events.map(event => <li key={event.id} className={styles.event}>
            <div className={styles.itemMeta}><span>{eventLabels[event.eventType]}</span><time dateTime={event.startsAt}>{formatRomeDateTime(event.startsAt)}</time></div>
            <h3>{event.title}</h3><p className={styles.timeEnd}>Fine: <time dateTime={event.endsAt}>{formatRomeDateTime(event.endsAt)}</time></p>
            {event.details.participantIds.length > 0 && <p className={styles.participantNames}>Con {event.details.participantIds.map(memberName).join(", ")}</p>}
            {event.details.summary && <p className={styles.bodyText}>{event.details.summary}</p>}
            {event.details.callUrl && <a className={styles.callLink} href={event.details.callUrl} target="_blank" rel="noopener noreferrer">Apri il link della call <ExternalLink size={12} aria-hidden="true" /></a>}
            <DeleteTeamForm table="calendar_events" id={event.id} title={event.title} />
          </li>)}</ul>}
        </div><div className={styles.formColumn}><NewEventForm members={snapshot.members} /></div></div>
      </section>

      <section id="attivita" className={styles.section} aria-labelledby="tasks-title">
        <div className={styles.sectionHeading}><h2 id="tasks-title">Attività <span>{snapshot.tasks.length}</span></h2><span>{snapshot.tasks.filter(task => task.status !== "done").length} da completare</span></div>
        <div className={styles.columns}><div className={styles.list}>{snapshot.tasks.length === 0 ? <div className={styles.empty}><h3>Il prossimo passo, per tutti.</h3><p>Assegna un’attività e una scadenza al team.</p></div> : <ul className={styles.items}>{snapshot.tasks.map(task => <li key={task.id} className={styles.task}>
          <div className={styles.itemMeta}><span>{task.status === "done" ? "Completata" : task.status === "in_progress" ? "In corso" : "Da fare"}</span><span>{memberName(task.assignedTo)}</span></div><h3 className={task.status === "done" ? styles.done : undefined}>{task.title}</h3>
          {task.dueAt && <p className={styles.timeEnd}>Scadenza: <time dateTime={task.dueAt}>{formatRomeDate(task.dueAt)}</time></p>}{task.description && <p className={styles.bodyText}>{task.description}</p>}
          <div className={styles.itemActions}><ToggleTaskForm task={task} /><DeleteTeamForm table="tasks" id={task.id} title={task.title} /></div>
        </li>)}</ul>}</div><div className={styles.formColumn}><NewTaskForm members={snapshot.members} /></div></div>
      </section>

      <section id="note" className={styles.section} aria-labelledby="notes-title">
        <div className={styles.sectionHeading}><h2 id="notes-title">Note e idee <span>{snapshot.notes.length}</span></h2><span>Visibili a tutto il team</span></div>
        <div className={styles.columns}><div className={styles.list}>{snapshot.notes.length === 0 ? <div className={styles.empty}><h3>Uno spazio per le prossime idee.</h3><p>Scrivi un appunto o collegalo a un’attività.</p></div> : <ul className={styles.items}>{snapshot.notes.map(note => <li key={note.id} className={styles.note}>
          <div className={styles.itemMeta}><span>{memberName(note.createdBy)}</span><time dateTime={note.createdAt}>{formatRomeDateTime(note.createdAt)}</time></div><h3>{note.title}</h3>{note.body && <p className={styles.bodyText}>{note.body}</p>}
          {note.taskId && <p className={styles.related}>Attività: {snapshot.tasks.find(task => task.id === note.taskId)?.title ?? "Attività non disponibile"}</p>}<DeleteTeamForm table="notes" id={note.id} title={note.title} />
        </li>)}</ul>}</div><div className={styles.formColumn}><NewNoteForm tasks={snapshot.tasks} /></div></div>
      </section>
      <footer className={styles.footer}><span>LuckyLap · Workspace del team</span><span>Letto il {formatRomeDateTime(loadedAt)}</span></footer>
    </main>
  </div>;
}
