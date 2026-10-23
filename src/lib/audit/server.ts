import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadSensitiveArea, type VerifiedMember } from "../auth/model";
import { isTeamId } from "../team/model";
import {
  auditEntryFromDatabase,
  isAuditTimestamp,
  type AuditCursor,
  type AuditPage,
} from "./model";

/** A current verified membership and fresh DB area status must be supplied by the page. RLS remains authoritative. */
export async function loadAuditMetadata(
  supabase: SupabaseClient,
  member: VerifiedMember,
  unlocked: boolean,
  cursor: AuditCursor | null,
): Promise<AuditPage> {
  // Defense in depth: no audit or actor lookup query for other roles or locked sessions.
  if (!canReadSensitiveArea(member, "audit", unlocked))
    throw new Error(
      "Per leggere il registro servono un account del team attivo e la password CEO aperta in questa sessione.",
    );
  if (cursor && (!isAuditTimestamp(cursor.occurredAt) || !isTeamId(cursor.id)))
    throw new Error("Pagina del registro non valida.");
  let query = supabase
    .from("audit_logs")
    .select("id,occurred_at,actor_id,table_name,operation,record_key", { count: "exact" })
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(51);
  if (cursor)
    query = query.or(
      `occurred_at.lt.${cursor.occurredAt},and(occurred_at.eq.${cursor.occurredAt},id.lt.${cursor.id})`,
    );
  const { data, error, count } = await query;
  if (
    error ||
    !Array.isArray(data) ||
    count === null ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    data.length !== Math.min(51, count)
  )
    throw new Error("Registro non disponibile. Ricarica la pagina.");
  const entries = data.map(auditEntryFromDatabase);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new Error("Lettura del registro non completa.");
  const visible = entries.slice(0, 50);
  const actorIds = [...new Set(visible.flatMap((entry) => (entry.actorId ? [entry.actorId] : [])))];
  const actorNames = new Map<string, string>();
  if (actorIds.length) {
    const actors = await supabase
      .from("profiles")
      .select("user_id,display_name", { count: "exact" })
      .in("user_id", actorIds)
      .limit(50);
    if (
      actors.error ||
      !Array.isArray(actors.data) ||
      actors.count !== actors.data.length ||
      actors.data.length > actorIds.length
    )
      throw new Error("Operatori del registro non disponibili.");
    for (const actor of actors.data) {
      if (
        !isTeamId(actor.user_id) ||
        !actorIds.includes(actor.user_id) ||
        typeof actor.display_name !== "string" ||
        actor.display_name.trim().length < 1 ||
        actor.display_name.length > 120 ||
        actorNames.has(actor.user_id)
      )
        throw new Error("Operatori del registro non disponibili.");
      actorNames.set(actor.user_id, actor.display_name);
    }
  }
  const last = visible[visible.length - 1];
  return {
    entries: visible.map((entry) => ({
      ...entry,
      actorName: entry.actorId
        ? (actorNames.get(entry.actorId) ?? "Membro non disponibile")
        : "Operazione di sistema",
    })),
    nextCursor: entries.length > 50 && last ? { occurredAt: last.occurredAt, id: last.id } : null,
    hasCursor: cursor !== null,
  };
}
