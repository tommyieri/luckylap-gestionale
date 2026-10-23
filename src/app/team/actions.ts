"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { verifiedMember } from "../../lib/auth/server";
import { isLocalPreviewEnabled } from "../../lib/runtime";
import {
  capturedFormValues,
  decodeEventDetails,
  encodeEventDetails,
  eventEditToken,
  EVENT_TYPES,
  parseDeleteForm,
  parseEventForm,
  parseNoteForm,
  parseTaskForm,
  parseTaskToggleForm,
  parseTeamEditForm,
  taskEditToken,
  TASK_STATUSES,
  TEAM_TIME_ZONE,
  TEAM_PREVIEW_WRITE_MESSAGE,
  TeamValidationError,
  type TeamActionState,
  type EventType,
  type TaskStatus,
  type TeamEvent,
  type TeamTask,
} from "../../lib/team/model";

const denied = "Accesso al team richiesto. Accedi di nuovo e riprova.";
const uncertain =
  "Salvataggio non confermato. Ricarica la pagina prima di riprovare, per verificare se la modifica è già presente.";

function assertWriteResult(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "42501")
    throw new TeamValidationError(
      "I permessi del tuo account sono cambiati. Accedi di nuovo prima di modificare il team.",
    );
  if (error.code === "23503")
    throw new TeamValidationError(
      "Un membro o un’attività collegata non è più disponibile. Ricarica la pagina e aggiorna la selezione.",
    );
  throw new Error("Scrittura non confermata.");
}

async function mutate(
  form: FormData,
  write: (
    supabase: SupabaseClient,
  ) => Promise<string | Pick<TeamActionState, "success" | "updatedItem">>,
  preserveValues = false,
  revalidatePaths: string[] = ["/team"],
): Promise<TeamActionState> {
  const values = preserveValues ? capturedFormValues(form) : {};
  // A fresh form mount restores defaultSelected as well as text inputs after
  // React resets a completed form action, including validation-error results.
  const revision = preserveValues ? { revision: crypto.randomUUID() } : {};
  // Anteprima locale: dati sintetici, mai Supabase.
  if (isLocalPreviewEnabled()) return { error: TEAM_PREVIEW_WRITE_MESSAGE, ...values, ...revision };
  let supabase: SupabaseClient;
  try {
    supabase = await createSupabaseServerClient({ writable: true });
    // The page/proxy is not an authorization boundary for an invoked action.
    const access = await verifiedMember(supabase);
    if (access.status !== "member")
      return {
        error:
          access.status === "unavailable"
            ? "Verifica dell’accesso non disponibile. Ricarica e riprova."
            : denied,
        ...values,
        ...revision,
      };
  } catch {
    return {
      error: "Collegamento al workspace non disponibile. Ricarica e riprova.",
      ...values,
      ...revision,
    };
  }
  try {
    const result = await write(supabase);
    for (const path of revalidatePaths) revalidatePath(path);
    return { ...(typeof result === "string" ? { success: result } : result), ...revision };
  } catch (error) {
    return {
      error: error instanceof TeamValidationError ? error.message : uncertain,
      ...values,
      ...revision,
    };
  }
}

async function assertActiveMembers(supabase: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("active", true)
    .in("user_id", ids);
  if (error || !data) throw new Error("Team non disponibile.");
  if (data.length !== ids.length || ids.some((id) => !data.some((member) => member.user_id === id)))
    throw new TeamValidationError(
      "Un membro selezionato non è più abilitato. Ricarica la pagina e aggiorna la selezione.",
    );
}

export async function createTeamEvent(
  _previous: TeamActionState,
  form: FormData,
): Promise<TeamActionState> {
  return mutate(
    form,
    async (supabase) => {
      const { participantIds, ...row } = parseEventForm(form);
      await assertActiveMembers(supabase, participantIds);
      const { data, error } = await supabase
        .from("calendar_events")
        .insert(row)
        .select("id")
        .single();
      assertWriteResult(error);
      if (!data) throw new Error("Appuntamento non confermato.");
      return "Appuntamento aggiunto al calendario del team.";
    },
    true,
  );
}

export async function createTeamTask(
  _previous: TeamActionState,
  form: FormData,
): Promise<TeamActionState> {
  return mutate(
    form,
    async (supabase) => {
      const row = parseTaskForm(form);
      await assertActiveMembers(supabase, row.assigned_to ? [row.assigned_to] : []);
      const { data, error } = await supabase.from("tasks").insert(row).select("id").single();
      assertWriteResult(error);
      if (!data) throw new Error("Attività non confermata.");
      return "Attività aggiunta al workspace del team.";
    },
    true,
  );
}

export async function createTeamNote(
  _previous: TeamActionState,
  form: FormData,
): Promise<TeamActionState> {
  return mutate(
    form,
    async (supabase) => {
      const row = parseNoteForm(form);
      if (row.task_id) {
        const task = await supabase.from("tasks").select("id").eq("id", row.task_id).maybeSingle();
        if (task.error) throw new Error("Attività non disponibile.");
        if (!task.data)
          throw new TeamValidationError(
            "L’attività collegata non è più disponibile. Ricarica la pagina e aggiorna la selezione.",
          );
      }
      const { data, error } = await supabase.from("notes").insert(row).select("id").single();
      assertWriteResult(error);
      if (!data) throw new Error("Nota non confermata.");
      return "Nota aggiunta al workspace del team.";
    },
    true,
  );
}

export async function deleteTeamItem(
  _previous: TeamActionState,
  form: FormData,
): Promise<TeamActionState> {
  return mutate(form, async (supabase) => {
    const { table, id } = parseDeleteForm(form);
    const { data, error } = await supabase.from(table).delete().eq("id", id).select("id");
    assertWriteResult(error);
    if (!data || data.length !== 1)
      throw new TeamValidationError(
        "L’elemento è già stato rimosso o non è disponibile. Ricarica la pagina.",
      );
    return "Elemento eliminato dal workspace del team.";
  });
}

export async function toggleTeamTask(
  _previous: TeamActionState,
  form: FormData,
): Promise<TeamActionState> {
  return mutate(form, async (supabase) => {
    const { id, expectedStatus, nextStatus } = parseTaskToggleForm(form);
    const { data, error } = await supabase
      .from("tasks")
      .update({ status: nextStatus })
      .eq("id", id)
      .eq("status", expectedStatus)
      .select("id")
      .maybeSingle();
    assertWriteResult(error);
    if (!data)
      throw new TeamValidationError(
        "L’attività è stata modificata o rimossa da un altro membro. Ricarica la pagina.",
      );
    return nextStatus === "done" ? "Attività completata." : "Attività riaperta.";
  });
}

const changed =
  "L’elemento è stato modificato o rimosso da un altro membro. Ricarica la pagina e riprova.";
const updatePaths = ["/team", "/", "/audit", "/partner", "/team/partner"];
const romeDay = (value: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TEAM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));

type EventRow = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  event_type: EventType;
  created_by: string;
};
type TaskRow = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  due_at: string | null;
  assigned_to: string | null;
  created_by: string;
};
function eventSnapshot(row: EventRow): TeamEvent {
  if (!EVENT_TYPES.includes(row.event_type)) throw new Error("Appuntamento non disponibile.");
  return {
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    eventType: row.event_type,
    details: decodeEventDetails(row.description),
    createdBy: row.created_by,
  };
}
function taskSnapshot(row: TaskRow): TeamTask {
  if (!TASK_STATUSES.includes(row.status)) throw new Error("Attività non disponibile.");
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    dueAt: row.due_at,
    assignedTo: row.assigned_to,
    createdBy: row.created_by,
  };
}
/** Preserve seconds and Postgres precision when a minute-resolution input was not edited. */
function originalUnchangedMinute(next: string, previous: string): string {
  return Math.floor(Date.parse(previous) / 60000) === Date.parse(next) / 60000 ? previous : next;
}

export async function updateTeamEvent(
  _previous: TeamActionState,
  form: FormData,
): Promise<TeamActionState> {
  return mutate(
    form,
    async (supabase) => {
      const { id, expected } = parseTeamEditForm(form);
      const { participantIds, ...row } = parseEventForm(form);
      const current = await supabase
        .from("calendar_events")
        .select("id,title,description,starts_at,ends_at,event_type,created_by")
        .eq("id", id)
        .maybeSingle();
      assertWriteResult(current.error);
      if (!current.data) throw new TeamValidationError(changed);
      const original = current.data as EventRow;
      const snapshot = eventSnapshot(original);
      if (eventEditToken(snapshot) !== expected) throw new TeamValidationError(changed);
      const nextDetails = decodeEventDetails(row.description);
      if (
        original.event_type === "other" &&
        snapshot.details.typeLabel === undefined &&
        row.event_type === "other" &&
        nextDetails.typeLabel === "Altro"
      ) {
        // Existing Other events had no explicit label: the form's visible "Altro"
        // fallback represents the same category and must not create an audit entry.
        delete nextDetails.typeLabel;
        row.description = encodeEventDetails(nextDetails);
      }
      await assertActiveMembers(
        supabase,
        participantIds.filter((memberId) => !snapshot.details.participantIds.includes(memberId)),
      );
      row.starts_at = originalUnchangedMinute(row.starts_at, original.starts_at);
      row.ends_at = originalUnchangedMinute(row.ends_at, original.ends_at);
      const updatedItem = { id, day: romeDay(row.starts_at), kind: "event" as const };
      if (eventEditToken(eventSnapshot({ ...original, ...row })) === expected)
        return {
          success: "L’appuntamento è già aggiornato: nessuna modifica da salvare.",
          updatedItem,
        };
      // Include the original raw description and timestamps, so another writer between
      // this SELECT and UPDATE cannot be silently overwritten. RLS remains authoritative.
      const { data, error } = await supabase
        .from("calendar_events")
        .update(row)
        .eq("id", id)
        .eq("title", original.title)
        .eq("description", original.description)
        .eq("starts_at", original.starts_at)
        .eq("ends_at", original.ends_at)
        .eq("event_type", original.event_type)
        .select("id")
        .maybeSingle();
      assertWriteResult(error);
      if (!data) throw new TeamValidationError(changed);
      return { success: "Appuntamento modificato nel calendario del team.", updatedItem };
    },
    true,
    updatePaths,
  );
}

export async function updateTeamTask(
  _previous: TeamActionState,
  form: FormData,
): Promise<TeamActionState> {
  return mutate(
    form,
    async (supabase) => {
      const { id, expected } = parseTeamEditForm(form);
      const row = parseTaskForm(form, { editing: true });
      const current = await supabase
        .from("tasks")
        .select("id,title,description,status,due_at,assigned_to,created_by")
        .eq("id", id)
        .maybeSingle();
      assertWriteResult(current.error);
      if (!current.data) throw new TeamValidationError(changed);
      const original = current.data as TaskRow;
      if (taskEditToken(taskSnapshot(original)) !== expected)
        throw new TeamValidationError(changed);
      if (row.assigned_to !== null && row.assigned_to !== original.assigned_to)
        await assertActiveMembers(supabase, [row.assigned_to]);
      if (
        row.due_at !== null &&
        original.due_at !== null &&
        romeDay(row.due_at) === romeDay(original.due_at)
      )
        row.due_at = original.due_at;
      const updatedItem = {
        id,
        day: row.due_at === null ? null : romeDay(row.due_at),
        kind: "task" as const,
      };
      if (taskEditToken(taskSnapshot({ ...original, ...row })) === expected)
        return {
          success: "L’attività è già aggiornata: nessuna modifica da salvare.",
          updatedItem,
        };
      let query = supabase
        .from("tasks")
        .update(row)
        .eq("id", id)
        .eq("title", original.title)
        .eq("description", original.description)
        .eq("status", original.status);
      query =
        original.due_at === null ? query.is("due_at", null) : query.eq("due_at", original.due_at);
      query =
        original.assigned_to === null
          ? query.is("assigned_to", null)
          : query.eq("assigned_to", original.assigned_to);
      const { data, error } = await query.select("id").maybeSingle();
      assertWriteResult(error);
      if (!data) throw new TeamValidationError(changed);
      return { success: "Attività modificata nel calendario del team.", updatedItem };
    },
    true,
    updatePaths,
  );
}
