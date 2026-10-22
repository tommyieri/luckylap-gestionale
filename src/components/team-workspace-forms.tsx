"use client";

import { useActionState, useId, useState } from "react";
import { Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  createTeamEvent,
  createTeamNote,
  createTeamTask,
  deleteTeamItem,
  toggleTeamTask,
} from "../app/team/actions";
import type { TeamActionState, TeamMember, TeamTask } from "../lib/team/model";
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
function Submit({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button className="button button-primary" type="submit" disabled={pending}>
      <Plus size={15} aria-hidden="true" />
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
}: {
  state: TeamActionState;
  action: (form: FormData) => void;
  pending: boolean;
  members: TeamMember[];
}) {
  const id = useId();
  const [eventType, setEventType] = useState(state.values?.eventType || "meeting");
  return (
    <form action={action} className={styles.form} aria-label="Nuovo appuntamento">
      <fieldset disabled={pending}>
        <legend>Nuovo appuntamento</legend>
        <label>
          Titolo
          <input
            name="title"
            maxLength={240}
            required
            defaultValue={state.values?.title}
            placeholder="Es. Call produzione"
          />
        </label>
        <div className={styles.fieldPair}>
          <label>
            Inizio
            <input
              type="datetime-local"
              name="startsAt"
              min="2000-01-01T00:00"
              max="2100-12-31T23:59"
              required
              defaultValue={state.values?.startsAt}
            />
          </label>
          <label>
            Fine
            <input
              type="datetime-local"
              name="endsAt"
              min="2000-01-01T00:00"
              max="2100-12-31T23:59"
              required
              defaultValue={state.values?.endsAt}
            />
          </label>
        </div>
        <p className={styles.help}>Tutti gli orari sono nel fuso Europe/Rome.</p>
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
              value={state.values?.startsOccurrence}
            />
            <Occurrence
              name="endsOccurrence"
              label="Occorrenza fine"
              value={state.values?.endsOccurrence}
            />
          </div>
        </details>
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
              defaultValue={state.values?.customEventType}
              placeholder="Es. Shooting fotografico"
            />
          </label>
        )}
        <fieldset className={styles.participants}>
          <legend>
            Partecipanti <span>facoltativi</span>
          </legend>
          {members
            .filter((member) => member.active)
            .map((member) => (
              <label key={member.id}>
                <input
                  type="checkbox"
                  name="participantIds"
                  value={member.id}
                  defaultChecked={state.participantIds?.includes(member.id)}
                />
                {member.name}
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
            defaultValue={state.values?.callUrl}
            aria-describedby={`${id}-link-help`}
          />
        </label>
        <p id={`${id}-link-help`} className={styles.help}>
          Il link viene salvato nell’agenda. I partecipanti non ricevono inviti o email.
        </p>
        <label>
          Descrizione <span>facoltativa</span>
          <textarea name="summary" rows={3} maxLength={8000} defaultValue={state.values?.summary} />
        </label>
        <Submit pending={pending} label="Aggiungi appuntamento" />
      </fieldset>
      <Feedback state={state} />
    </form>
  );
}

export function NewTaskForm({ members }: { members: TeamMember[] }) {
  const [state, action, pending] = useActionState(createTeamTask, initialState);
  return (
    <form
      key={state.revision ?? "initial"}
      action={action}
      className={styles.form}
      aria-label="Nuova attività"
    >
      <fieldset disabled={pending}>
        <legend>Nuova attività</legend>
        <label>
          Titolo
          <input
            name="title"
            maxLength={240}
            required
            defaultValue={state.values?.title}
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
              defaultValue={state.values?.dueDate}
            />
          </label>
          <label>
            Assegnatario
            <select name="assignedTo" defaultValue={state.values?.assignedTo || ""}>
              <option value="">Da assegnare</option>
              {members
                .filter((member) => member.active)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <label>
          Descrizione <span>facoltativa</span>
          <textarea
            name="description"
            rows={3}
            maxLength={8000}
            defaultValue={state.values?.description}
          />
        </label>
        <Submit pending={pending} label="Aggiungi attività" />
      </fieldset>
      <Feedback state={state} />
    </form>
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
