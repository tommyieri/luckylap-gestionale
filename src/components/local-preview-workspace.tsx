"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Monitor,
  Plus,
  Trash2,
} from "lucide-react";
import {
  LOCAL_WORKSPACE_KEY,
  mergeWorkspaceField,
  readLocalWorkspace,
  type LocalWorkspace,
  type LocalAppointment as Appointment,
  type LocalTask as Task,
} from "../lib/local-workspace";

/*
 * Calendario, attività e note dell'anteprima locale (`LUCKYLAP_LOCAL_PREVIEW`),
 * estratti dal vecchio monolite. Tutto resta su `localStorage` di questo browser:
 * la pagina `/team` lo mostra solo in anteprima locale (docs: 01-layout §8.5).
 */

function dayDate(day: string) {
  return new Date(`${day}T12:00:00Z`);
}
function formatDay(
  day: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" },
) {
  return new Intl.DateTimeFormat("it-IT", { ...options, timeZone: "Europe/Rome" }).format(
    dayDate(day),
  );
}
function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** `today`: giorno di Roma «AAAA-MM-GG», calcolato sul server. */
export function LocalPreviewWorkspace({ today }: { today: string }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [note, setNote] = useState("");
  const workspaceRef = useRef<LocalWorkspace>({ appointments: [], tasks: [], note: "" });
  const [storageIssue, setStorageIssue] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [toast, setToast] = useState("");
  function applyWorkspace(workspace: LocalWorkspace) {
    workspaceRef.current = workspace;
    setAppointments(workspace.appointments);
    setTasks(workspace.tasks);
    setNote(workspace.note);
  }
  useEffect(() => {
    try {
      const result = readLocalWorkspace(localStorage.getItem(LOCAL_WORKSPACE_KEY));
      applyWorkspace(result.workspace);
      setStorageIssue(result.issue);
    } catch {
      setStorageError(true);
    }
    const syncWorkspace = (event: StorageEvent) => {
      if (event.key !== LOCAL_WORKSPACE_KEY && event.key !== null) return;
      try {
        // A queued event may describe a revision older than this tab's last write.
        const result = readLocalWorkspace(localStorage.getItem(LOCAL_WORKSPACE_KEY));
        setStorageIssue(result.issue);
        if (!result.issue) applyWorkspace(result.workspace);
      } catch {
        setStorageError(true);
      }
    };
    window.addEventListener("storage", syncWorkspace);
    return () => window.removeEventListener("storage", syncWorkspace);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  function updateLocalField<K extends keyof LocalWorkspace>(
    field: K,
    update: LocalWorkspace[K] | ((previous: LocalWorkspace[K]) => LocalWorkspace[K]),
  ) {
    const valueFor = (workspace: LocalWorkspace) =>
      typeof update === "function"
        ? (update as (previous: LocalWorkspace[K]) => LocalWorkspace[K])(workspace[field])
        : update;
    const keepInSession = () =>
      applyWorkspace({ ...workspaceRef.current, [field]: valueFor(workspaceRef.current) });
    try {
      const latestRaw = localStorage.getItem(LOCAL_WORKSPACE_KEY);
      const latest = readLocalWorkspace(latestRaw);
      if (latest.issue) {
        setStorageIssue(true);
        keepInSession();
        return false;
      }
      const result = mergeWorkspaceField(latestRaw, field, valueFor(latest.workspace));
      if (result.issue) {
        setStorageIssue(true);
        keepInSession();
        return false;
      }
      localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(result.workspace));
      applyWorkspace(result.workspace);
      setStorageError(false);
      setStorageIssue(false);
      return true;
    } catch {
      setStorageError(true);
      keepInSession();
      return false;
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Team</h1>
          <p>Calendario, attività e note dell’anteprima locale.</p>
        </div>
      </div>
      <div
        className={`local-notice ${storageError || storageIssue ? "notice-error" : ""}`}
        role={storageError || storageIssue ? "alert" : undefined}
      >
        <Monitor size={15} />
        <span>
          {storageIssue
            ? "Alcuni dati locali non sono leggibili. Gli originali restano nel browser: il salvataggio è sospeso per evitare sovrascritture. Le nuove modifiche restano solo in questa pagina."
            : storageError
              ? "Il browser non consente il salvataggio. Le modifiche resteranno disponibili solo fino alla chiusura della pagina."
              : "Appuntamenti, attività e note sono salvati solo su questo browser e aggiornati tra le schede aperte. Non sono condivisi con il team."}
        </span>
      </div>
      <section id="calendario" aria-label="Calendario">
        <CalendarView
          today={today}
          appointments={appointments}
          onAdd={(appointment) => {
            const saved = updateLocalField("appointments", (value) => [...value, appointment]);
            setToast(
              saved
                ? "Appuntamento salvato su questo browser"
                : "Appuntamento disponibile solo in questa pagina",
            );
          }}
          onDelete={(id) =>
            updateLocalField("appointments", (value) => value.filter((a) => a.id !== id))
          }
        />
      </section>
      <section id="attivita" aria-label="Attività e note">
        <TasksView
          tasks={tasks}
          note={note}
          onNote={(value) => updateLocalField("note", value)}
          onAdd={(task) => updateLocalField("tasks", (value) => [...value, task])}
          onToggle={(id) =>
            updateLocalField("tasks", (value) =>
              value.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
            )
          }
          onDelete={(id) => updateLocalField("tasks", (value) => value.filter((t) => t.id !== id))}
          savingAvailable={!storageError && !storageIssue}
        />
      </section>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </>
  );
}

function AppointmentList({
  appointments,
  onDelete,
  emptyText,
}: {
  appointments: Appointment[];
  onDelete: (id: string) => void;
  emptyText?: string;
}) {
  return appointments.length ? (
    <div className="appointment-list">
      {appointments.map((appointment) => (
        <div className="appointment" key={appointment.id}>
          <span className="appointment-time">{appointment.time}</span>
          <div>
            <strong>{appointment.title}</strong>
            {appointment.participants && (
              <p className="appointment-participants">Con: {appointment.participants}</p>
            )}
            {appointment.notes && <p>{appointment.notes}</p>}
            {appointment.link && safeHttpUrl(appointment.link) && (
              <a
                className="appointment-link"
                href={safeHttpUrl(appointment.link)}
                target="_blank"
                rel="noreferrer"
              >
                Apri collegamento <ExternalLink size={12} />
              </a>
            )}
          </div>
          <button
            className="icon-button delete-button"
            aria-label={`Elimina appuntamento ${appointment.title}`}
            onClick={() => onDelete(appointment.id)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  ) : (
    <div className="agenda-empty">
      <CalendarDays size={23} strokeWidth={1.5} />
      <p>{emptyText || "Nessun appuntamento per questa data."}</p>
    </div>
  );
}

function CalendarView({
  today,
  appointments,
  onAdd,
  onDelete,
}: {
  today: string;
  appointments: Appointment[];
  onAdd: (a: Appointment) => void;
  onDelete: (id: string) => void;
}) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [showForm, setShowForm] = useState(false);
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const daysCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  function changeMonth(change: number) {
    const date = new Date(Date.UTC(year, monthNumber - 1 + change, 1));
    setMonth(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return (
    <div className="calendar-layout">
      <section className="panel calendar-panel">
        <div className="calendar-heading">
          <h2>{formatDay(`${month}-01`, { month: "long", year: "numeric" })}</h2>
          <div>
            <button
              className="button button-secondary button-small"
              onClick={() => {
                setMonth(today.slice(0, 7));
                setSelected(today);
              }}
            >
              Oggi
            </button>
            <button
              className="icon-button"
              onClick={() => changeMonth(-1)}
              aria-label="Mese precedente"
            >
              <ChevronLeft size={19} />
            </button>
            <button
              className="icon-button"
              onClick={() => changeMonth(1)}
              aria-label="Mese successivo"
            >
              <ChevronRight size={19} />
            </button>
          </div>
        </div>
        <div className="calendar-weekdays">
          {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {Array.from({ length: offset }, (_, i) => (
            <div className="calendar-blank" key={`empty-${i}`} />
          ))}
          {Array.from({ length: daysCount }, (_, i) => {
            const date = `${month}-${String(i + 1).padStart(2, "0")}`;
            const count = appointments.filter((a) => a.date === date).length;
            return (
              <button
                className={`calendar-day ${selected === date ? "selected" : ""} ${today === date ? "today" : ""}`}
                key={date}
                onClick={() => setSelected(date)}
                aria-pressed={selected === date}
                aria-label={`${formatDay(date, { day: "numeric", month: "long", year: "numeric" })}${count ? `, ${count} appuntamenti` : ""}${today === date ? ", oggi" : ""}`}
              >
                <span>{i + 1}</span>
                {count > 0 && (
                  <small>
                    {count}
                    <span className="calendar-event-label">
                      {" "}
                      {count === 1 ? "appuntamento" : "appuntamenti"}
                    </span>
                  </small>
                )}
              </button>
            );
          })}
        </div>
      </section>
      <section className="panel day-panel">
        <div className="panel-heading">
          <h2>{formatDay(selected, { day: "numeric", month: "long" })}</h2>
          <span className="subtle-label">{formatDay(selected, { weekday: "long" })}</span>
        </div>
        <AppointmentList
          appointments={appointments
            .filter((a) => a.date === selected)
            .sort((a, b) => a.time.localeCompare(b.time))}
          onDelete={onDelete}
        />
        {showForm ? (
          <AppointmentForm
            key={selected}
            date={selected}
            onCancel={() => setShowForm(false)}
            onAdd={(appointment) => {
              onAdd(appointment);
              setShowForm(false);
            }}
          />
        ) : (
          <button className="button button-primary full-width" onClick={() => setShowForm(true)}>
            <Plus size={16} />
            Aggiungi appuntamento
          </button>
        )}
      </section>
    </div>
  );
}

function AppointmentForm({
  date,
  onAdd,
  onCancel,
}: {
  date: string;
  onAdd: (a: Appointment) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const [participants, setParticipants] = useState("");
  const [link, setLink] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    onAdd({
      id: uid(),
      title: title.trim(),
      date,
      time,
      notes: notes.trim(),
      participants: participants.trim(),
      link: safeHttpUrl(link.trim()),
    });
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>Nuovo appuntamento</h3>
      <label>
        Titolo
        <input
          required
          maxLength={150}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Es. Ritiro campioni"
          autoFocus
        />
      </label>
      <label>
        Orario · Europe/Rome
        <input
          type="time"
          required
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />
      </label>
      <label>
        Partecipanti <span>(facoltativi)</span>
        <input
          value={participants}
          onChange={(event) => setParticipants(event.target.value)}
          maxLength={300}
          placeholder="Es. Tommi, Gabriele"
        />
      </label>
      <label>
        Link alla call <span>(facoltativo)</span>
        <input
          type="url"
          pattern="https?://.+"
          title="Inserisci un link che inizi con https:// o http://"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          maxLength={2000}
          placeholder="https://…"
        />
      </label>
      <label>
        Agenda e note <span>(facoltative)</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Luogo, dettagli, cose da ricordare…"
        />
      </label>
      <div className="form-actions">
        <button className="button button-secondary" type="button" onClick={onCancel}>
          Annulla
        </button>
        <button className="button button-primary" type="submit">
          Salva appuntamento
        </button>
      </div>
    </form>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
}: {
  task: Task;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`task-row ${task.done ? "is-done" : ""}`}>
      <button
        className="task-checkbox"
        onClick={onToggle}
        aria-label={`${task.done ? "Riapri" : "Completa"} attività ${task.title}`}
        aria-pressed={task.done}
      >
        {task.done && <Check size={13} />}
      </button>
      <div>
        <span>{task.title}</span>
        {task.due && (
          <small>
            <CalendarDays size={12} />
            {formatDay(task.due)}
          </small>
        )}
      </div>
      <button
        className="icon-button delete-button"
        onClick={onDelete}
        aria-label={`Elimina attività ${task.title}`}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function TasksView({
  tasks,
  note,
  onNote,
  onAdd,
  onToggle,
  onDelete,
  savingAvailable,
}: {
  tasks: Task[];
  note: string;
  onNote: (value: string) => void;
  onAdd: (task: Task) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  savingAvailable: boolean;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [showCompleted, setShowCompleted] = useState(true);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    onAdd({ id: uid(), title: title.trim(), done: false, due });
    setTitle("");
    setDue("");
  }
  return (
    <div className="tasks-layout">
      <section className="panel">
        <div className="panel-heading">
          <h2>Attività</h2>
          <span className="subtle-label">{tasks.filter((t) => !t.done).length} aperte</span>
        </div>
        <form className="task-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="task-title">
            Nuova attività
          </label>
          <input
            id="task-title"
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Qual è il prossimo passo?"
          />
          <div>
            <label>
              Scadenza <span>(facoltativa)</span>
              <input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            </label>
            <button className="button button-primary" type="submit">
              <Plus size={16} />
              Aggiungi
            </button>
          </div>
        </form>
        {tasks.length ? (
          <>
            <div className="task-list">
              {tasks
                .filter((t) => showCompleted || !t.done)
                .sort((a, b) => Number(a.done) - Number(b.done))
                .map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => onToggle(task.id)}
                    onDelete={() => onDelete(task.id)}
                  />
                ))}
            </div>
            {tasks.some((t) => t.done) && (
              <button
                className="text-button completed-toggle"
                onClick={() => setShowCompleted((value) => !value)}
              >
                {showCompleted ? "Nascondi" : "Mostra"} attività completate{" "}
                <ChevronDown size={14} />
              </button>
            )}
          </>
        ) : (
          <p className="inline-empty">
            <ClipboardList size={19} />
            La prima attività parte da qui.
          </p>
        )}
      </section>
      <section className="panel notes-panel">
        <div className="panel-heading">
          <h2>Blocco note</h2>
          <span className="save-label">
            {savingAvailable ? (
              <>
                <Check size={13} />
                Salvataggio automatico locale
              </>
            ) : (
              <>
                <AlertCircle size={13} />
                Modifiche solo in questa pagina
              </>
            )}
          </span>
        </div>
        <label className="sr-only" htmlFor="workspace-note">
          Note locali del workspace
        </label>
        <textarea
          id="workspace-note"
          className="workspace-note"
          rows={12}
          maxLength={20000}
          value={note}
          onChange={(event) => onNote(event.target.value)}
          placeholder="Idee per una prossima uscita, materiali da ordinare, cose da approfondire…"
        />
        <p className="note-count">
          {new Intl.NumberFormat("it-IT").format(note.length)} / 20.000 caratteri
        </p>
      </section>
    </div>
  );
}
