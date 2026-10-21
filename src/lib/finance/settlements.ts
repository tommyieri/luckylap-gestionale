import type { DashboardSettlement } from "./dashboard";

export function dashboardSettlementsFromRows(rows: unknown[]): DashboardSettlement[] {
  const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const result = rows.map((value): DashboardSettlement => {
    const row = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    if (!uuid(row.id) || !uuid(row.sale_id) || typeof row.amount_cents !== "number" || !Number.isSafeInteger(row.amount_cents) || row.amount_cents < 1 || row.amount_cents > 9_000_000_000_000_000 || typeof row.occurred_at !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.occurred_at) || !Number.isFinite(Date.parse(row.occurred_at)) || !["cash", "bank_transfer", "other"].includes(row.method as string) || typeof row.reference !== "string" || !row.reference.length) throw new Error("Incassi conto vendita non disponibili.");
    return { id: row.id, saleId: row.sale_id, cents: row.amount_cents, occurredAt: row.occurred_at, method: row.method as DashboardSettlement["method"], reference: row.reference };
  });
  if (new Set(result.map(row => row.id)).size !== result.length) throw new Error("Incassi conto vendita duplicati.");
  return result;
}
