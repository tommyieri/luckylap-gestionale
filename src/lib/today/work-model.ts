import { isUuid, record, safeInteger, type SalesOrder } from "../sales/model";
import { partnerDomain } from "../partner/contacts";
import { isCalendarDay } from "../partner/dates";
import { PARTNER_STAGES } from "../partner/model";
import { partnerDueToday } from "../partner/periods";
import { romeDayBounds } from "./model";

export type ContactWork = {
  id: string;
  co: number;
  name: string;
  action: string | null;
  dueOn: string | null;
  owner: string | null;
};
export type ReminderWork = {
  id: string;
  co: number;
  title: string;
  dueAt: string;
  /** Contatto del sollecito, per «Ha risposto»; `null` se il database non lo dice ancora. */
  partnerId: string | null;
};
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
    const partnerId = r.partner_id === undefined || r.partner_id === null ? null : id(r.partner_id);
    return { id: id(r.id), co: co(r.co), title: text(r.title, 240), dueAt, partnerId };
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

/** Righe operative complete: nessun testo della posta, ricerca o nota libera. */
export type PartnerOperationalRows = {
  partners: readonly unknown[];
  profiles: readonly unknown[];
  blocks: readonly unknown[];
  /** Letti soltanto quando esiste un blocco per dominio; il valore non esce dal modello. */
  domains: readonly unknown[];
  activities: readonly unknown[];
  links: readonly unknown[];
  tasks: readonly unknown[];
  /** Un assistente non leggibile conserva il lavoro manuale. */
  jobs: readonly unknown[] | null;
  toggles: readonly unknown[] | null;
};

/** Esclude solo il lavoro attestato come automatico, prima di conteggiare e limitare le righe. */
export function partnerWorkFromOperationalRows(
  rows: PartnerOperationalRows,
  day: string,
  userId: string,
  automatic: { first: boolean; followups: boolean },
): PartnerWork {
  if (!isCalendarDay(day) || !isUuid(userId)) fail();
  const objects = (values: readonly unknown[]) => values.map((value) => record(value) ?? fail());
  const nullableId = (value: unknown): string | null => (value === null ? null : id(value));
  const date = (value: unknown): string => (isCalendarDay(value) ? value : fail());
  const nullableDate = (value: unknown): string | null => (value === null ? null : date(value));
  const unique = <T>(values: T[], key: (value: T) => string): T[] => {
    if (new Set(values.map(key)).size !== values.length) fail();
    return values;
  };
  const partners = unique(
    objects(rows.partners).map((r) => {
      if (!PARTNER_STAGES.includes(r.stage as never)) fail();
      return {
        id: id(r.id),
        co: safeInteger(r.co, 1, 99999) ? r.co : fail(),
        name: text(r.name, 240),
        stage: r.stage as string,
        contactMonth: date(r.contact_month),
        ownerId: nullableId(r.owner_id),
        nextAction: nullableText(r.next_action, 2000),
        nextActionOn: nullableDate(r.next_action_on),
        researchRemovedAt: nullableText(r.research_removed_at, 80),
      };
    }),
    (partner) => partner.id,
  );
  const known = new Set(partners.map((partner) => partner.id));
  const profiles = new Map(
    unique(
      objects(rows.profiles).map((r) => ({ id: id(r.user_id), name: text(r.display_name, 120) })),
      (profile) => profile.id,
    ).map((profile) => [profile.id, profile.name]),
  );
  const blocked = new Set<string>();
  const blockedDomains = new Set<string>();
  for (const r of objects(rows.blocks)) {
    id(r.id);
    const partnerId = nullableId(r.partner_id);
    const domain = nullableText(r.domain, 253);
    if (partnerId === null && domain === null) fail();
    if (partnerId !== null) blocked.add(partnerId);
    if (domain !== null) blockedDomains.add(domain);
  }
  for (const r of objects(rows.domains)) {
    id(r.id);
    const partnerId = id(r.partner_id);
    if (!known.has(partnerId) || (r.kind !== "web" && r.kind !== "email")) fail();
    const domain = partnerDomain(nullableText(r.link_value, 2048));
    if (domain !== null && blockedDomains.has(domain)) blocked.add(partnerId);
  }
  const activities = new Map(
    unique(
      objects(rows.activities).map((r) => ({
        id: id(r.id),
        partnerId: id(r.partner_id),
        kind: text(r.kind, 80),
        origin: text(r.origin, 80),
      })),
      (activity) => activity.id,
    ).map((activity) => [activity.id, activity]),
  );
  // Anche un'origine sconosciuta impedisce di considerare la scheda affidata all'assistente.
  const workedByTeam = new Set(
    [...activities.values()]
      .filter((activity) => activity.origin !== "assistente")
      .map((activity) => activity.partnerId),
  );
  const automaticFirst = new Set<string>();
  if (automatic.first && rows.jobs !== null && rows.toggles !== null) {
    try {
      const jobs = unique(
        objects(rows.jobs).map((r) => {
          if (
            !["in_coda", "attesa", "pronta", "serve_tommaso", "inviata"].includes(
              r.status as string,
            )
          )
            fail();
          return { partnerId: id(r.partner_id), status: r.status as string };
        }),
        (job) => job.partnerId,
      );
      const toggles = new Map(
        unique(
          objects(rows.toggles).map((r) => {
            if (typeof r.active !== "boolean") fail();
            return { partnerId: id(r.partner_id), active: r.active };
          }),
          (toggle) => toggle.partnerId,
        ).map((toggle) => [toggle.partnerId, toggle.active]),
      );
      for (const job of jobs)
        if (
          ["in_coda", "attesa", "pronta"].includes(job.status) &&
          toggles.get(job.partnerId) !== false
        )
          automaticFirst.add(job.partnerId);
    } catch {
      // Nessun filtro se le letture dell'assistente sono assenti o non interpretabili.
      automaticFirst.clear();
    }
  }
  const contacts = partners
    .filter(
      (partner) =>
        partnerDueToday(partner, day, blocked.has(partner.id)) &&
        !(
          automaticFirst.has(partner.id) &&
          partner.stage === "da_contattare" &&
          partner.ownerId === null &&
          partner.nextAction === null &&
          partner.nextActionOn === null &&
          !workedByTeam.has(partner.id)
        ),
    )
    .sort(
      (a, b) =>
        (a.nextActionOn ?? "9999-12-31").localeCompare(b.nextActionOn ?? "9999-12-31") ||
        a.co - b.co,
    )
    .map((partner): ContactWork => ({
      id: partner.id,
      co: partner.co,
      name: partner.name,
      action: partner.nextAction,
      dueOn: partner.nextActionOn,
      owner: partner.ownerId === null ? null : (profiles.get(partner.ownerId) ?? null),
    }));
  const partnersById = new Map(partners.map((partner) => [partner.id, partner]));
  const links = new Map<string, { partnerId: string; activityId: string | null }>();
  for (const r of objects(rows.links)) {
    id(r.id);
    const taskId = nullableId(r.task_id);
    const partnerId = id(r.partner_id);
    const activityId = nullableId(r.activity_id);
    if (r.kind !== "follow_up" || !known.has(partnerId) || (taskId !== null && links.has(taskId)))
      fail();
    if (taskId !== null) links.set(taskId, { partnerId, activityId });
  }
  const end = Date.parse(romeDayBounds(day).end);
  const reminders = unique(
    objects(rows.tasks).map((r) => {
      const dueAt = nullableText(r.due_at, 80);
      if (dueAt !== null && !Number.isFinite(Date.parse(dueAt))) fail();
      if (!["todo", "in_progress", "done"].includes(r.status as string)) fail();
      return {
        id: id(r.id),
        title: text(r.title, 240),
        dueAt,
        assignedTo: nullableId(r.assigned_to),
        status: r.status,
      };
    }),
    (task) => task.id,
  )
    .filter(
      (task) =>
        task.assignedTo === userId &&
        task.status !== "done" &&
        task.dueAt !== null &&
        Date.parse(task.dueAt) < end,
    )
    .flatMap((task): ReminderWork[] => {
      const link = links.get(task.id);
      if (!link) return [];
      const source = link.activityId === null ? null : activities.get(link.activityId);
      if (
        automatic.followups &&
        source?.partnerId === link.partnerId &&
        source.origin === "assistente" &&
        source.kind === "inviato"
      )
        return [];
      return [
        {
          id: task.id,
          co: partnersById.get(link.partnerId)!.co,
          title: task.title,
          dueAt: task.dueAt!,
          partnerId: link.partnerId,
        },
      ];
    })
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id));
  return {
    contactCount: contacts.length,
    contacts: contacts.slice(0, 8),
    reminderCount: reminders.length,
    reminders: reminders.slice(0, 8),
  };
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
