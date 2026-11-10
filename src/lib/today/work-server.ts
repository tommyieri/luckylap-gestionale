import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tile } from "./model";
import { romeDay } from "./model";
import {
  partnerWorkFromOperationalRows,
  preparationWork,
  type PartnerWork,
  type PreparationWork,
} from "./work-model";
import { readSalesWorkspace } from "../sales/server";
import { readTeamPages } from "../team/read";
import { loadPartnerAssistantStatus } from "../partner/server";
import { isPartnerId } from "../partner/model";
import { loadAutomaticFollowupMode } from "./automatic-mail-server";

type Filter = ["eq", string, string | boolean] | ["is", string, null] | ["in", string, string[]];

/** Liste complete sotto la sessione del membro: conteggi e cursori verificati a ogni pagina. */
function operationalReader(supabase: SupabaseClient) {
  return (table: string, columns: string, filters: Filter[] = [], key = "id") =>
    readTeamPages((after, limit) => {
      let query = supabase.from(table).select(columns, { count: "exact" }).order(key).limit(limit);
      for (const [operator, column, value] of filters)
        query =
          operator === "eq"
            ? query.eq(column, value)
            : operator === "is"
              ? query.is(column, null)
              : query.in(column, value as string[]);
      if (after !== null) query = query.gt(key, after);
      return query.abortSignal(AbortSignal.timeout(10_000));
    }, key);
}

export async function loadPartnerWorkTile(
  supabase: SupabaseClient,
  now: Date,
  userId: string,
): Promise<Tile<PartnerWork>> {
  try {
    if (!isPartnerId(userId)) throw new Error("Persona del workspace non valida.");
    const day = romeDay(now);
    const read = operationalReader(supabase);
    const [partners, profiles, blocks, activities, links, tasks, assistant] = await Promise.all([
      read(
        "partners",
        "id,co,name,stage,contact_month,owner_id,next_action,next_action_on,research_removed_at",
      ),
      read("profiles", "user_id,display_name", [], "user_id"),
      read("partner_do_not_contact", "id,partner_id,domain", [["eq", "active", true]]),
      read("partner_activities", "id,partner_id,kind,origin"),
      read("partner_work_links", "id,partner_id,kind,task_id,activity_id", [
        ["eq", "kind", "follow_up"],
      ]),
      read("tasks", "id,title,status,due_at,assigned_to", [["eq", "assigned_to", userId]]),
      Promise.allSettled([
        loadPartnerAssistantStatus(supabase),
        loadAutomaticFollowupMode(supabase),
        read("partner_assistant_jobs", "partner_id,status", [], "partner_id"),
        read("partner_assistant_contacts", "partner_id,active", [], "partner_id"),
      ]),
    ]);
    // I blocchi per dominio restano identici a Partner; nessun recapito viene caricato altrimenti.
    const hasDomainBlock = blocks.some(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        typeof (value as Record<string, unknown>).domain === "string",
    );
    const domains = hasDomainBlock
      ? await read("partner_contacts", "id,partner_id,kind,link_value", [
          ["in", "kind", ["web", "email"]],
          ["is", "erased_at", null],
        ])
      : [];
    const first =
      assistant[0].status === "fulfilled" &&
      typeof assistant[0].value === "object" &&
      assistant[0].value.configured &&
      assistant[0].value.mode === "invio";
    return {
      status: "ok",
      data: partnerWorkFromOperationalRows(
        {
          partners,
          profiles,
          blocks,
          domains,
          activities,
          links,
          tasks,
          jobs: assistant[2].status === "fulfilled" ? assistant[2].value : null,
          toggles: assistant[3].status === "fulfilled" ? assistant[3].value : null,
        },
        day,
        userId,
        {
          first,
          followups: first && assistant[1].status === "fulfilled" && assistant[1].value === "invio",
        },
      ),
    };
  } catch (error) {
    unstable_rethrow(error);
    return { status: "error" };
  }
}
export async function loadPreparationTile(
  supabase: SupabaseClient,
): Promise<Tile<PreparationWork>> {
  try {
    const sales = await readSalesWorkspace(supabase);
    if (sales.status !== "ready") throw new Error("Vendite non disponibili.");
    return { status: "ok", data: preparationWork(sales.snapshot.orders) };
  } catch (error) {
    unstable_rethrow(error);
    return { status: "error" };
  }
}
