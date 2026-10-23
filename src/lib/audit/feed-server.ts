import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadSensitiveArea, type VerifiedMember } from "../auth/model";
import { isTeamId } from "../team/model";
import { isAuditTimestamp } from "./model";
import {
  activityActorFromDatabase,
  activityItemFromDatabase,
  validActivityQuery,
  type ActivityQuery,
  type ActivityFeedPage,
  type ActivityItem,
  type ActivityActor,
} from "./feed-model";

/** The RPC rechecks auth.uid + the current eight-hour CEO grant in PostgreSQL. */
export async function loadActivityFeed(
  supabase: SupabaseClient,
  member: VerifiedMember,
  unlocked: boolean,
  query: ActivityQuery,
): Promise<ActivityFeedPage> {
  if (!canReadSensitiveArea(member, "audit", unlocked))
    throw new Error("Feed riservato al founder con password CEO per questa sessione.");
  if (!validActivityQuery(query)) throw new Error("Filtri o pagina del feed non validi.");
  const { data, error } = await supabase.rpc("ceo_activity_feed", {
    p_actor: query.actor,
    p_area: query.area,
    p_before_at: query.before?.occurredAt ?? null,
    p_before_id: query.before?.id ?? null,
    p_limit: 50,
  });
  if (
    error ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).length !== 3 ||
    !["items", "actors", "next_cursor"].every((key) => Object.hasOwn(data, key)) ||
    !Array.isArray(data.items) ||
    data.items.length > 50 ||
    !Array.isArray(data.actors)
  )
    throw new Error("Feed non disponibile. Ricarica la pagina.");
  const items: ActivityItem[] = data.items.map(activityItemFromDatabase),
    actors: ActivityActor[] = data.actors.map(activityActorFromDatabase);
  if (
    new Set(items.map((item) => item.id)).size !== items.length ||
    new Set(actors.map((actor) => actor.id)).size !== actors.length
  )
    throw new Error("Lettura del feed non completa.");
  let nextCursor = null;
  if (data.next_cursor !== null) {
    const cursor = data.next_cursor,
      last = items.at(-1);
    if (
      items.length !== 50 ||
      !cursor ||
      typeof cursor !== "object" ||
      Array.isArray(cursor) ||
      Object.keys(cursor).length !== 2 ||
      !isAuditTimestamp(cursor.occurred_at) ||
      !isTeamId(cursor.id) ||
      cursor.occurred_at !== last?.occurredAt ||
      cursor.id !== last?.id
    )
      throw new Error("Collegamento del feed non disponibile.");
    nextCursor = { occurredAt: cursor.occurred_at, id: cursor.id };
  }
  return { items, actors, nextCursor, hasCursor: query.before !== null };
}
