import { isUuid, record, safeInteger, type SalesOrder } from "../sales/model";

export type ContactWork = {
  id: string;
  co: number;
  name: string;
  action: string | null;
  dueOn: string | null;
  owner: string | null;
};
export type ReminderWork = { id: string; co: number; title: string; dueAt: string };
export type PartnerWork = {
  contactCount: number;
  contacts: ContactWork[];
  reminderCount: number;
  reminders: ReminderWork[];
};
export type OrderWork = {
  id: string;
  reference: string;
  quantity: number;
  occurredAt: string;
  channel: string;
};
export type PreparationWork = { orderCount: number; quantity: number; orders: OrderWork[] };
function fail(): never {
  throw new Error("Lettura di Oggi non completa.");
}
const text = (value: unknown, max: number): string =>
  typeof value === "string" && value.length <= max ? value : fail();
const id = (value: unknown): string => (isUuid(value) ? value : fail());
const count = (value: unknown): number => (safeInteger(value, 0, 100000) ? value : fail());
const nullableText = (value: unknown, max: number): string | null =>
  value === null ? null : text(value, max);
export const partnerWorkHref = (co: number) => `/partner?co=${co}#lead-${co}`;
/** Only allowlisted operational fields, never research, contact values or free notes. */
export function parsePartnerWork(value: unknown): PartnerWork {
  const row = record(value) ?? fail();
  const parseRows = <T>(value: unknown, parse: (row: Record<string, unknown>) => T): T[] => {
    if (!Array.isArray(value) || value.length > 8) fail();
    return value.map((raw) => parse(record(raw) ?? fail()));
  };
  const co = (v: unknown) => (safeInteger(v, 1, 99999) ? v : fail());
  const contacts = parseRows(row.contacts, (r) => {
    const dueOn = nullableText(r.next_action_on, 10);
    if (
      dueOn !== null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn) ||
        new Date(`${dueOn}T00:00Z`).toISOString().slice(0, 10) !== dueOn)
    )
      fail();
    return {
      id: id(r.id),
      co: co(r.co),
      name: text(r.name, 240),
      action: nullableText(r.next_action, 2000),
      dueOn,
      owner: nullableText(r.owner_name, 120),
    };
  });
  const reminders = parseRows(row.reminders, (r) => {
    const dueAt = text(r.due_at, 80);
    if (!Number.isFinite(Date.parse(dueAt))) fail();
    return { id: id(r.id), co: co(r.co), title: text(r.title, 240), dueAt };
  });
  const contactCount = count(row.contact_count),
    reminderCount = count(row.reminder_count);
  if (
    contacts.length !== Math.min(contactCount, 8) ||
    reminders.length !== Math.min(reminderCount, 8) ||
    new Set(contacts.map((r) => r.id)).size !== contacts.length ||
    new Set(reminders.map((r) => r.id)).size !== reminders.length
  )
    fail();
  return { contactCount, contacts, reminderCount, reminders };
}
/** Unfulfilled and not cancelled physical quantities, independent of payment timing. */
export function preparationWork(orders: readonly SalesOrder[]): PreparationWork {
  const all = orders
    .map((order) => {
      let quantity = 0;
      for (const line of order.lines) {
        const remaining = line.quantity - line.fulfilled - line.cancelled;
        if (!safeInteger(remaining) || !safeInteger(quantity + remaining)) fail();
        quantity += remaining;
      }
      return {
        id: order.id,
        reference: order.reference ?? "Vendita senza riferimento",
        quantity,
        occurredAt: order.occurredAt,
        channel: order.channel,
      };
    })
    .filter((order) => order.quantity > 0)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  let quantity = 0;
  for (const order of all) {
    quantity += order.quantity;
    if (!safeInteger(quantity)) fail();
  }
  return { orderCount: all.length, quantity, orders: all.slice(0, 8) };
}
