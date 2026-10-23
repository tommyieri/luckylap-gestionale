import { isTeamId } from "../team/model";
import { isAuditTimestamp, type AuditSearch } from "./model";

export const ACTIVITY_AREAS = [
  "team",
  "sales",
  "stock",
  "packaging",
  "finance",
  "partner",
  "development",
  "assets",
  "settings",
] as const;
export type ActivityArea = (typeof ACTIVITY_AREAS)[number];
export type ActivityCursor = { occurredAt: string; id: string };
export type ActivityQuery = {
  actor: string | null;
  area: ActivityArea | null;
  before: ActivityCursor | null;
};
export type ActivityItem = {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorName: string;
  area: ActivityArea;
  message: string;
  href: string | null;
};
export type ActivityActor = { id: string; name: string };
export type ActivityFeedPage = {
  items: ActivityItem[];
  actors: ActivityActor[];
  nextCursor: ActivityCursor | null;
  hasCursor: boolean;
};
const labels: Record<ActivityArea, string> = {
  team: "Team",
  sales: "Vendite",
  stock: "Magazzino",
  packaging: "Packaging",
  finance: "Finance",
  partner: "Partner",
  development: "Sviluppo",
  assets: "Contenuti",
  settings: "Impostazioni",
};
export const activityAreaLabel = (area: ActivityArea) => labels[area];
export const isActivityArea = (value: unknown): value is ActivityArea =>
  typeof value === "string" && ACTIVITY_AREAS.includes(value as ActivityArea);
const fail = (): never => {
  throw new Error("Feed non disponibile. Ricarica la pagina.");
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
const exact = (row: Record<string, unknown>, keys: string[]) =>
  Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key));
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);

export function validActivityQuery(value: ActivityQuery): boolean {
  return (
    !!value &&
    (value.actor === null || value.actor === "system" || isTeamId(value.actor)) &&
    (value.area === null || isActivityArea(value.area)) &&
    (value.before === null ||
      (!!value.before && isAuditTimestamp(value.before.occurredAt) && isTeamId(value.before.id)))
  );
}
export function activityQueryFromSearch(search: AuditSearch): ActivityQuery {
  const actor = search.actor === undefined || search.actor === "" ? null : search.actor;
  const area = search.area === undefined || search.area === "" ? null : search.area;
  const hasCursor = search.beforeAt !== undefined || search.beforeId !== undefined;
  const before = hasCursor ? { occurredAt: search.beforeAt, id: search.beforeId } : null;
  const value = { actor, area, before };
  if (!validActivityQuery(value as ActivityQuery))
    throw new Error("I filtri o il collegamento alla pagina del feed non sono validi.");
  return value as ActivityQuery;
}
export function activityCursorHref(cursor: ActivityCursor | null, query: ActivityQuery): string {
  if (!validActivityQuery({ ...query, before: cursor }))
    throw new Error("Collegamento del feed non valido.");
  const params = new URLSearchParams();
  if (query.actor) params.set("actor", query.actor);
  if (query.area) params.set("area", query.area);
  if (cursor) {
    params.set("beforeAt", cursor.occurredAt);
    params.set("beforeId", cursor.id);
  }
  return params.size ? `/audit?${params}` : "/audit";
}
/** Only canonical local routes and typed entity anchors may cross this boundary. */
export function safeActivityHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  return new RegExp(
    `^/(?:team|sales|stock|packaging|finance|partner|development|assets|auth/account)(?:#(?:evento|attivita|nota|order|entry|asset|progetto|item|material)-${uuid})?$`,
    "i",
  ).test(value) || /^\/partner\?co=([1-9][0-9]{0,4})#lead-\1$/.test(value)
    ? value
    : null;
}
export function activityItemFromDatabase(value: unknown): ActivityItem {
  const row = object(value);
  if (
    !exact(row, ["id", "occurred_at", "actor_id", "actor_name", "area", "message", "href"]) ||
    !isTeamId(row.id) ||
    !isAuditTimestamp(row.occurred_at) ||
    !(row.actor_id === null || isTeamId(row.actor_id)) ||
    !text(row.actor_name, 120) ||
    !isActivityArea(row.area) ||
    !text(row.message, 700) ||
    !(row.href === null || safeActivityHref(row.href) !== null)
  )
    return fail();
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorId: row.actor_id as string | null,
    actorName: row.actor_name,
    area: row.area,
    message: row.message,
    href: row.href as string | null,
  };
}
export function activityActorFromDatabase(value: unknown): ActivityActor {
  const row = object(value);
  if (
    !exact(row, ["id", "name"]) ||
    !(row.id === "system" || isTeamId(row.id)) ||
    !text(row.name, 120)
  )
    return fail();
  return { id: row.id, name: row.name };
}
