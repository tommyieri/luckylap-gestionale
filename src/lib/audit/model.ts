import { isTeamId } from "../team/model";

export type AuditCursor = { occurredAt: string; id: string };
export type AuditSearch = Record<string, string | string[] | undefined>;
export type AuditEntry = {
  id: string;
  occurredAt: string;
  actorId: string | null;
  tableName: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  references: { label: string; id: string }[];
};
export type AuditPage = {
  entries: (AuditEntry & { actorName: string })[];
  nextCursor: AuditCursor | null;
  hasCursor: boolean;
};

export function isAuditTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (year < 1000 || year > 9999 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    Number.isFinite(Date.parse(value))
  );
}

/** Preserve PostgreSQL microseconds: Date#toISOString would skip entries in a sub-millisecond interval. */
export function auditCursorFromSearch(search: AuditSearch): AuditCursor | null {
  if (search.beforeAt === undefined && search.beforeId === undefined) return null;
  if (!isAuditTimestamp(search.beforeAt) || !isTeamId(search.beforeId))
    throw new Error("Il collegamento alla pagina del registro non è valido.");
  return { occurredAt: search.beforeAt, id: search.beforeId };
}
export function auditCursorHref(cursor: AuditCursor): string {
  return `/audit?${new URLSearchParams({ beforeAt: cursor.occurredAt, beforeId: cursor.id }).toString()}`;
}

/** No old_data/new_data or arbitrary record_key content is returned from this boundary. */
export function auditEntryFromDatabase(value: unknown): AuditEntry {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Registro non disponibile.");
  const row = value as Record<string, unknown>;
  if (
    !isTeamId(row.id) ||
    !isAuditTimestamp(row.occurred_at) ||
    (row.actor_id !== null && !isTeamId(row.actor_id)) ||
    typeof row.table_name !== "string" ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(row.table_name) ||
    !["INSERT", "UPDATE", "DELETE"].includes(String(row.operation)) ||
    !row.record_key ||
    typeof row.record_key !== "object" ||
    Array.isArray(row.record_key)
  )
    throw new Error("Registro non disponibile.");
  const key = row.record_key as Record<string, unknown>;
  const labels = {
    id: "Elemento",
    user_id: "Utente",
    stock_item_id: "Articolo",
    location_id: "Magazzino",
  };
  const references = Object.entries(labels).flatMap(([property, label]) =>
    isTeamId(key[property]) ? [{ label, id: key[property] as string }] : [],
  );
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorId: row.actor_id as string | null,
    tableName: row.table_name,
    operation: row.operation as AuditEntry["operation"],
    references,
  };
}

export const auditOperationLabel = {
  INSERT: "Creazione",
  UPDATE: "Modifica",
  DELETE: "Eliminazione",
};
const tableLabels: Record<string, string> = {
  profiles: "Profili",
  memberships: "Permessi del team",
  app_settings: "Impostazioni",
  products: "Prodotti",
  stock_items: "Articoli",
  product_variants: "Varianti",
  packaging_items: "Packaging",
  stock_locations: "Magazzini",
  stock_balances: "Giacenze",
  stock_movements: "Movimenti di magazzino",
  calendar_events: "Calendario",
  tasks: "Attività",
  notes: "Note e idee",
  assets: "Grafiche e contenuti",
  product_development_projects: "Sviluppo prodotti",
  discount_rules: "Sconti",
  finance_entries: "Finance",
  finance_entry_voids: "Annullamenti Finance",
  finance_import_batches: "Importazioni Finance",
  finance_import_transactions: "Movimenti importati Finance",
  finance_documents: "Documenti Finance",
  sales_orders: "Ordini",
  sales_order_lines: "Righe ordine",
  order_payments: "Pagamenti",
  stock_reservations: "Riserve di magazzino",
  stock_reservation_events: "Movimenti delle riserve",
  production_requirements: "Fabbisogno di produzione",
  production_receipts: "Produzione completata",
  fulfillment_lines: "Consegne",
  commercial_facts: "Fatti commerciali",
};
export const auditTableLabel = (name: string): string => tableLabels[name] ?? name;
