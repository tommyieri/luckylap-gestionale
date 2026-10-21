"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { verifiedMember } from "../../lib/auth/server";
import { capturedFormValues, parseDeleteForm, parseEventForm, parseNoteForm, parseTaskForm, parseTaskToggleForm, TeamValidationError, type TeamActionState } from "../../lib/team/model";

const denied = "Accesso al team richiesto. Accedi di nuovo e riprova.";
const uncertain = "Salvataggio non confermato. Ricarica la pagina prima di riprovare, per verificare se la modifica è già presente.";

function assertWriteResult(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "42501") throw new TeamValidationError("I permessi del tuo account sono cambiati. Accedi di nuovo prima di modificare il team.");
  if (error.code === "23503") throw new TeamValidationError("Un membro o un’attività collegata non è più disponibile. Ricarica la pagina e aggiorna la selezione.");
  throw new Error("Scrittura non confermata.");
}

async function mutate(form: FormData, write: (supabase: SupabaseClient) => Promise<string>, preserveValues = false): Promise<TeamActionState> {
  const values = preserveValues ? capturedFormValues(form) : {};
  // A fresh form mount restores defaultSelected as well as text inputs after
  // React resets a completed form action, including validation-error results.
  const revision = preserveValues ? { revision: crypto.randomUUID() } : {};
  let supabase: SupabaseClient;
  try {
    supabase = await createSupabaseServerClient({ writable: true });
    // The page/proxy is not an authorization boundary for an invoked action.
    const access = await verifiedMember(supabase);
    if (access.status !== "member") return { error: access.status === "unavailable" ? "Verifica dell’accesso non disponibile. Ricarica e riprova." : denied, ...values, ...revision };
  } catch { return { error: "Collegamento al workspace non disponibile. Ricarica e riprova.", ...values, ...revision }; }
  try {
    const success = await write(supabase);
    revalidatePath("/team");
    return { success, ...revision };
  } catch (error) {
    return { error: error instanceof TeamValidationError ? error.message : uncertain, ...values, ...revision };
  }
}

async function assertActiveMembers(supabase: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { data, error } = await supabase.from("memberships").select("user_id").eq("active", true).in("user_id", ids);
  if (error || !data) throw new Error("Team non disponibile.");
  if (data.length !== ids.length || ids.some(id => !data.some(member => member.user_id === id))) throw new TeamValidationError("Un membro selezionato non è più abilitato. Ricarica la pagina e aggiorna la selezione.");
}

export async function createTeamEvent(_previous: TeamActionState, form: FormData): Promise<TeamActionState> {
  return mutate(form, async supabase => {
    const { participantIds, ...row } = parseEventForm(form);
    await assertActiveMembers(supabase, participantIds);
    const { data, error } = await supabase.from("calendar_events").insert(row).select("id").single();
    assertWriteResult(error);
    if (!data) throw new Error("Appuntamento non confermato.");
    return "Appuntamento aggiunto al calendario del team.";
  }, true);
}

export async function createTeamTask(_previous: TeamActionState, form: FormData): Promise<TeamActionState> {
  return mutate(form, async supabase => {
    const row = parseTaskForm(form);
    await assertActiveMembers(supabase, row.assigned_to ? [row.assigned_to] : []);
    const { data, error } = await supabase.from("tasks").insert(row).select("id").single();
    assertWriteResult(error);
    if (!data) throw new Error("Attività non confermata.");
    return "Attività aggiunta al workspace del team.";
  }, true);
}

export async function createTeamNote(_previous: TeamActionState, form: FormData): Promise<TeamActionState> {
  return mutate(form, async supabase => {
    const row = parseNoteForm(form);
    if (row.task_id) {
      const task = await supabase.from("tasks").select("id").eq("id", row.task_id).maybeSingle();
      if (task.error) throw new Error("Attività non disponibile.");
      if (!task.data) throw new TeamValidationError("L’attività collegata non è più disponibile. Ricarica la pagina e aggiorna la selezione.");
    }
    const { data, error } = await supabase.from("notes").insert(row).select("id").single();
    assertWriteResult(error);
    if (!data) throw new Error("Nota non confermata.");
    return "Nota aggiunta al workspace del team.";
  }, true);
}

export async function deleteTeamItem(_previous: TeamActionState, form: FormData): Promise<TeamActionState> {
  return mutate(form, async supabase => {
    const { table, id } = parseDeleteForm(form);
    const { data, error } = await supabase.from(table).delete().eq("id", id).select("id");
    assertWriteResult(error);
    if (!data || data.length !== 1) throw new TeamValidationError("L’elemento è già stato rimosso o non è disponibile. Ricarica la pagina.");
    return "Elemento eliminato dal workspace del team.";
  });
}

export async function toggleTeamTask(_previous: TeamActionState, form: FormData): Promise<TeamActionState> {
  return mutate(form, async supabase => {
    const { id, expectedStatus, nextStatus } = parseTaskToggleForm(form);
    const { data, error } = await supabase.from("tasks").update({ status: nextStatus }).eq("id", id).eq("status", expectedStatus).select("id").maybeSingle();
    assertWriteResult(error);
    if (!data) throw new TeamValidationError("L’attività è stata modificata o rimossa da un altro membro. Ricarica la pagina.");
    return nextStatus === "done" ? "Attività completata." : "Attività riaperta.";
  });
}
