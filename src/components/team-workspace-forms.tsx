"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  createTeamEvent,
  createTeamNote,
  createTeamTask,
  deleteTeamItem,
  toggleTeamTask,
  updateTeamEvent,
  updateTeamTask,
} from "../app/team/actions";
import {
  eventEditToken,
  taskEditToken,
  type TeamActionState,
  type TeamEvent,
  type TeamMember,
  type TeamTask,
} from "../lib/team/model";
import { editableMembers, eventFormDefaults, taskFormDefaults } from "../lib/team/edit-form";
import styles from "./team-workspace.module.css";

const initialState: TeamActionState = {};
function Feedback({ state }: { state: TeamActionState }) {
  return (
    <div aria-live="polite" className={styles.feedback}>
      {state.error && (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className={styles.success}>
          {state.success}
        </p>
      )}
    </div>
  );
}
function Submit({
  pending,
  label,
  editing = false,
}: {
  pending: boolean;
  label: string;
  editing?: boolean;
}) {
  return (
    <button className="button button-primary" type="submit" disabled={pending}>
      {editing ? <Check size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
      {pending ? "Salvataggio…" : label}
    </button>
  );
}
function Occurrence({ name, label, value }: { name: string; label: string; value?: string }) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={value || ""}>
        <option value="">Automatica</option>
        <option value="earlier">Prima occorrenza</option>
        <option value="later">Seconda occorrenza</option>
      </select>
    </label>
  );
}

export function NewEventForm({ members }: { members: TeamMember[] }) {
  const [state, action, pending] = useActionState(createTeamEvent, initialState);
  return (
    <EventFormFields
      key={state.revision ?? "initial"}
      state={state}
      action={action}
      pending={pending}
      members={members}
    />
  );
}

function EventFormFields({
  state,
  action,
  pending,
  members,
  event,
  onCancel,
}: {
  state: TeamActionState;
  action: (form: FormData) => void;
  pending: boolean;
  members: TeamMember[];
  event?: TeamEvent;
  onCancel?: () => void;
}) {
  const id = useId();
  const defaults = event ? eventFormDefaults(event) : {};
  const values = { ...defaults.values, ...state.values };
  const participantIds = state.participantIds ?? defaults.participantIds ?? [];
  const [eventType, setEventType] = useState(values.eventType || "meeting");
  const [allDay, setAllDay] = useState(values.allDay === "true");
  const [startsAt, setStartsAt] = useState(values.startsAt ?? "");
  const [endsAt, setEndsAt] = useState(values.endsAt ?? "");
  const [clockTimes, setClockTimes] = useState({
    start: values.startsAt?.slice(11) || "09:00",
    end: values.endsAt?.slice(11) || "10:00",
  });
  function changeAllDay(checked: boolean) {
    if (checked) {
      setClockTimes({
        start: startsAt.slice(11) || clockTimes.start,
        end: endsAt.slice(11) || clockTimes.end,
      });
      setStartsAt(startsAt.slice(0, 10));
      setEndsAt(endsAt.slice(0, 10));
    } else {
      setStartsAt(startsAt ? `${startsAt}T${clockTimes.start}` : "");
      setEndsAt(endsAt ? `${endsAt}T${clockTimes.end}` : "");
    }
    setAllDay(checked);
  }
  return (
    <form
      action={action}
      className={styles.form}
      aria-label={event ? `Modifica appuntamento ${event.title}` : "Nuovo appuntamento"}
    >
      {event && (
        <>
          <input type="hidden" name="id" value={event.id} />
          <input type="hidden" name="expected" value={eventEditToken(event)} />
        </>
      )}
      <fieldset disabled={pending}>
        <legend>{event ? "Modifica appuntamento" : "Nuovo appuntamento"}</legend>
        <label>
          Titolo
          <input
            name="title"
            maxLength={240}
            required
            defaultValue={values.title}
            placeholder="Es. Call produzione"
          />
        </label>
        <label className={styles.allDay}>
          <input
            type="checkbox"
            name="allDay"
            value="true"
            checked={allDay}
            onChange={(change) => changeAllDay(change.target.checked)}
          />
          Giornata intera
        </label>
        <div className={styles.fieldPair}>
          <label>
            {allDay ? "Primo giorno" : "Inizio"}
            <input
              type={allDay ? "date" : "datetime-local"}
              name="startsAt"
              min={allDay ? "2000-01-01" : "2000-01-01T00:00"}
              max={allDay ? "2100-12-31" : "2100-12-31T23:59"}
              required
              value={startsAt}
              onChange={(change) => setStartsAt(change.target.value)}
            />
          </label>
          <label>
            {allDay ? "Ultimo giorno incluso" : "Fine"}
            <input
              type={allDay ? "date" : "datetime-local"}
              name="endsAt"
              min={allDay ? "2000-01-01" : "2000-01-01T00:00"}
              max={allDay ? "2100-12-31" : "2100-12-31T23:59"}
              required
              value={endsAt}
              onChange={(change) => setEndsAt(change.target.value)}
            />
          </label>
        </div>
        <p className={styles.help}>Tutti gli orari sono nel fuso Europe/Rome.</p>
        {!allDay && (
          <details className={styles.dst} open={state.error?.includes("si ripete") || undefined}>
            <summary>Orari nel cambio dell’ora</summary>
            <p>
              Se un orario si ripete nel passaggio all’ora solare, scegli la prima o la seconda
              occorrenza.
            </p>
            <div className={styles.fieldPair}>
              <Occurrence
                name="startsOccurrence"
                label="Occorrenza inizio"
                value={values.startsOccurrence}
              />
              <Occurrence
                name="endsOccurrence"
                label="Occorrenza fine"
                value={values.endsOccurrence}
              />
            </div>
          </details>
        )}
        <label>
          Tipo
          <select
            name="eventType"
            value={eventType}
            onChange={(event) => setEventType(event.target.value)}
          >
            <option value="meeting">Call / riunione</option>
            <option value="production">Produzione</option>
            <option value="delivery">Consegna</option>
            <option value="launch">Lancio</option>
            <option value="event">Evento</option>
            <option value="other">Altro</option>
          </select>
        </label>
        {eventType === "other" && (
          <label>
            Specifica il tipo
            <input
              name="customEventType"
              maxLength={80}
              required
              defaultValue={values.customEventType}
              placeholder="Es. Shooting fotografico"
            />
          </label>
        )}
        <fieldset className={styles.participants}>
          <legend>
            Partecipanti <span>facoltativi</span>
          </legend>
          {editableMembers(members, participantIds).map((member) => (
            <label key={member.id}>
              <input
                type="checkbox"
                name="participantIds"
                value={member.id}
                defaultChecked={participantIds.includes(member.id)}
              />
              {member.name}
              {!member.active && " (non più attivo)"}
            </label>
          ))}
        </fieldset>
        <label>
          Link della call <span>facoltativo</span>
          <input
            type="url"
            name="callUrl"
            maxLength={2048}
            placeholder="https://…"
            defaultValue={values.callUrl}
            aria-describedby={`${id}-link-help`}
          />
        </label>
        <p id={`${id}-link-help`} className={styles.help}>
          Il link viene salvato nell’agenda. I partecipanti non ricevono inviti o email.
        </p>
        <label>
          Descrizione <span>facoltativa</span>
          <textarea name="summary" rows={3} maxLength={8000} defaultValue={values.summary} />
        </label>
        <div className={event ? styles.editActions : undefined}>
          <Submit
            pending={pending}
            editing={Boolean(event)}
            label={event ? "Salva modifiche" : "Aggiungi appuntamento"}
          />
          {event && (
            <button
              type="button"
              className="button button-secondary"
              disabled={pending}
              onClick={onCancel}
            >
              Annulla
            </button>
          )}
        </div>
      </fieldset>
      {!event && <Feedback state={state} />}
    </form>
  );
}

export function NewTaskForm({ members }: { members: TeamMember[] }) {
  const [state, action, pending] = useActionState(createTeamTask, initialState);
  return (
    <TaskFormFields
      key={state.revision ?? "initial"}
      state={state}
      action={action}
      pending={pending}
      members={members}
    />
  );
}

function TaskFormFields({
  state,
  action,
  pending,
  members,
  task,
  onCancel,
}: {
  state: TeamActionState;
  action: (form: FormData) => void;
  pending: boolean;
  members: TeamMember[];
  task?: TeamTask;
  onCancel?: () => void;
}) {
  const values = { ...(task ? taskFormDefaults(task) : {}), ...state.values };
  return (
    <form
      action={action}
      className={styles.form}
      aria-label={task ? `Modifica attività ${task.title}` : "Nuova attività"}
    >
      {task && (
        <>
          <input type="hidden" name="id" value={task.id} />
          <input type="hidden" name="expected" value={taskEditToken(task)} />
        </>
      )}
      <fieldset disabled={pending}>
        <legend>{task ? "Modifica attività" : "Nuova attività"}</legend>
        <label>
          Titolo
          <input
            name="title"
            maxLength={240}
            required
            defaultValue={values.title}
            placeholder="Es. Verificare il packaging"
          />
        </label>
        <div className={styles.fieldPair}>
          <label>
            Scadenza <span>facoltativa</span>
            <input
              type="date"
              name="dueDate"
              min="2000-01-01"
              max="2100-12-31"
              defaultValue={values.dueDate}
            />
          </label>
          <label>
            Assegnatario
            <select name="assignedTo" defaultValue={values.assignedTo || ""}>
              <option value="">Da assegnare</option>
              {editableMembers(members, values.assignedTo ? [values.assignedTo] : []).map(
                (member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                    {!member.active && " (non più attivo)"}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        {task && (
          <label>
            Stato
            <select name="status" defaultValue={values.status}>
              <option value="todo">Da fare</option>
              <option value="in_progress">In corso</option>
              <option value="done">Completata</option>
            </select>
          </label>
        )}
        <label>
          Descrizione <span>facoltativa</span>
          <textarea
            name="description"
            rows={3}
            maxLength={8000}
            defaultValue={values.description}
          />
        </label>
        <div className={task ? styles.editActions : undefined}>
          <Submit
            pending={pending}
            editing={Boolean(task)}
            label={task ? "Salva modifiche" : "Aggiungi attività"}
          />
          {task && (
            <button
              type="button"
              className="button button-secondary"
              disabled={pending}
              onClick={onCancel}
            >
              Annulla
            </button>
          )}
        </div>
      </fieldset>
      {!task && <Feedback state={state} />}
    </form>
  );
}

type UpdatedTeamItem = NonNullable<TeamActionState["updatedItem"]>;
type EditAction = (previous: TeamActionState, form: FormData) => Promise<TeamActionState>;
type EditFields<T> = {
  item: T;
  state: TeamActionState;
  action: (form: FormData) => void;
  pending: boolean;
  onCancel: () => void;
};

function EditDisclosure<T extends { id: string; title: string }>({
  item,
  serverAction,
  onSaved,
  fields,
}: {
  item: T;
  serverAction: EditAction;
  onSaved?: (item: UpdatedTeamItem) => void;
  fields: (props: EditFields<T>) => ReactNode;
}) {
  const [state, action, pending] = useActionState(
    async (previous: TeamActionState, form: FormData) => {
      const result = await serverAction(previous, form);
      // La revalidazione può rimuovere questo form dal giorno selezionato prima degli effetti.
      // La continuazione dell’azione aggiorna comunque il calendario rimasto montato.
      if (result.success && result.updatedItem) onSaved?.(result.updatedItem);
      return result;
    },
    initialState,
  );
  const [open, setOpen] = useState(false);
  // La versione resta quella aperta dall’utente, anche se arriva un aggiornamento del team.
  const [snapshot, setSnapshot] = useState(item);
  const [reset, setReset] = useState(0);
  const [dismissed, setDismissed] = useState<TeamActionState | null>(null);
  const summary = useRef<HTMLElement>(null);
  const handled = useRef<TeamActionState | null>(null);
  const visibleState = dismissed === state ? initialState : state;
  function cancel() {
    if (pending) return;
    setOpen(false);
    setDismissed(state);
    setReset((value) => value + 1);
    summary.current?.focus();
  }
  useEffect(() => {
    if (!state.success || handled.current === state) return;
    handled.current = state;
    setOpen(false);
    setReset((value) => value + 1);
    if (!onSaved) summary.current?.focus();
  }, [state, onSaved]);
  return (
    <div className={styles.editWrap}>
      <details
        className={styles.edit}
        open={open}
        onToggle={(change) => {
          if (pending && !change.currentTarget.open) change.currentTarget.open = true;
          else setOpen(change.currentTarget.open);
        }}
      >
        <summary
          ref={summary}
          aria-disabled={pending || undefined}
          onClick={(click) => {
            click.preventDefault();
            if (pending) return;
            if (open) cancel();
            else {
              setSnapshot(item);
              setDismissed(state);
              setReset((value) => value + 1);
              setOpen(true);
            }
          }}
        >
          <Pencil size={13} aria-hidden="true" />
          Modifica<span className="sr-only"> {item.title}</span>
        </summary>
        {open && (
          <div key={`${reset}-${state.revision ?? "initial"}`}>
            {fields({ item: snapshot, state: visibleState, action, pending, onCancel: cancel })}
          </div>
        )}
      </details>
      <Feedback state={visibleState} />
    </div>
  );
}

export function EditEventForm({
  event,
  members,
  onSaved,
}: {
  event: TeamEvent;
  members: TeamMember[];
  onSaved?: (item: UpdatedTeamItem) => void;
}) {
  return (
    <EditDisclosure
      item={event}
      serverAction={updateTeamEvent}
      onSaved={onSaved}
      fields={({ item, ...props }) => <EventFormFields {...props} event={item} members={members} />}
    />
  );
}

export function EditTaskForm({
  task,
  members,
  onSaved,
}: {
  task: TeamTask;
  members: TeamMember[];
  onSaved?: (item: UpdatedTeamItem) => void;
}) {
  return (
    <EditDisclosure
      item={task}
      serverAction={updateTeamTask}
      onSaved={onSaved}
      fields={({ item, ...props }) => <TaskFormFields {...props} task={item} members={members} />}
    />
  );
}

export function NewNoteForm({ tasks }: { tasks: TeamTask[] }) {
  const [state, action, pending] = useActionState(createTeamNote, initialState);
  return (
    <form
      key={state.revision ?? "initial"}
      action={action}
      className={styles.form}
      aria-label="Nuova nota"
    >
      <fieldset disabled={pending}>
        <legend>Nuova nota o idea</legend>
        <label>
          Titolo
          <input
            name="title"
            maxLength={240}
            required
            defaultValue={state.values?.title}
            placeholder="Es. Idea per la prossima grafica"
          />
        </label>
        <label>
          Nota
          <textarea name="body" rows={5} maxLength={12000} defaultValue={state.values?.body} />
        </label>
        <label>
          Attività collegata <span>facoltativa</span>
          <select name="taskId" defaultValue={state.values?.taskId || ""}>
            <option value="">Nessuna attività</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>
        <Submit pending={pending} label="Aggiungi nota" />
      </fieldset>
      <Feedback state={state} />
    </form>
  );
}

export function DeleteTeamForm({
  table,
  id,
  title,
}: {
  table: "calendar_events" | "tasks" | "notes";
  id: string;
  title: string;
}) {
  const [state, action, pending] = useActionState(deleteTeamItem, initialState);
  return (
    <div className={styles.deleteWrap}>
      <details className={styles.delete}>
        <summary>
          <Trash2 size={13} aria-hidden="true" />
          Elimina<span className="sr-only"> {title}</span>
        </summary>
        <form action={action}>
          <input type="hidden" name="table" value={table} />
          <input type="hidden" name="id" value={id} />
          <p>Eliminare “{title}” dal workspace di tutti?</p>
          {table === "tasks" && (
            <p>Le note collegate restano salvate, senza il collegamento a questa attività.</p>
          )}
          <button className="button button-secondary" type="submit" disabled={pending}>
            {pending ? "Eliminazione…" : "Elimina per tutti"}
          </button>
        </form>
      </details>
      <Feedback state={state} />
    </div>
  );
}

export function ToggleTaskForm({ task }: { task: TeamTask }) {
  const [state, action, pending] = useActionState(toggleTeamTask, initialState);
  const done = task.status === "done";
  return (
    <div className={styles.toggleWrap}>
      <form action={action}>
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="expectedStatus" value={task.status} />
        <input type="hidden" name="nextStatus" value={done ? "todo" : "done"} />
        <button className="button button-secondary" type="submit" disabled={pending}>
          {done ? (
            <RotateCcw size={13} aria-hidden="true" />
          ) : (
            <Check size={13} aria-hidden="true" />
          )}
          {pending ? "Aggiornamento…" : done ? "Riapri" : "Completa"}
          <span className="sr-only"> {task.title}</span>
        </button>
      </form>
      <Feedback state={state} />
    </div>
  );
}
