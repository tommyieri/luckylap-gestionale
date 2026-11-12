import { PARTNER_ASSISTANT_FORMAT_LABELS } from "./assistant";
import {
  PARTNER_DATABASE_STAGE_LABELS,
  partnerCountryName,
  type PartnerDatabaseEstimate,
  type PartnerDatabaseRow,
} from "./database";
import {
  addDays,
  addMonths,
  daysBetween,
  instantDay,
  isCalendarDay,
  monthLong,
  shortDay,
} from "./dates";
import {
  PARTNER_ACTIVITY_CHANNEL_LABELS,
  PARTNER_PRIORITY_LABELS,
  PARTNER_SECTION_LABELS,
  type PartnerActivityChannel,
  type PartnerMessageKind,
} from "./model";
import type { PartnerWorkData } from "./work";

export type PartnerCalendarKind =
  "inviata" | "risposta" | "prevista" | "sollecito" | "azione" | "evento" | "scadenza";
export type PartnerCalendarItem = {
  id: string;
  partnerId: string;
  co: number;
  name: string;
  day: string;
  /** Ultimo giorno incluso per gli eventi che durano più giorni. */
  endDay: string | null;
  kind: PartnerCalendarKind;
  label: string;
  origin: "team" | "file" | "assistente" | "scheda";
  occurredAt: string | null;
  messageKind: PartnerMessageKind | null;
  channel: PartnerActivityChannel | null;
};

function sentLabel(messageKind: PartnerMessageKind | null, channel: PartnerActivityChannel | null) {
  if (messageKind === "sollecito") return "Sollecito inviato";
  if (channel === "email")
    return messageKind === "primo" ? "Prima email registrata" : "Email registrata";
  return channel
    ? `Invio registrato · ${PARTNER_ACTIVITY_CHANNEL_LABELS[channel]}`
    : "Invio registrato";
}

/** I fatti vengono dal registro. Il piano salvato e le bozze non aggiungono invii storici. */
export function buildPartnerCalendarItems(
  rows: readonly PartnerDatabaseRow[],
  work: PartnerWorkData | null | undefined,
  estimates: readonly PartnerDatabaseEstimate[],
  today: string,
): PartnerCalendarItem[] {
  const byPartner = new Map(rows.map((row) => [row.partner.id, row]));
  const items = new Map<string, PartnerCalendarItem>();
  type Entry = Pick<PartnerCalendarItem, "id" | "day" | "kind" | "label" | "origin"> &
    Partial<Pick<PartnerCalendarItem, "endDay" | "occurredAt" | "messageKind" | "channel">>;
  const add = (partnerId: string, entry: Entry) => {
    const row = byPartner.get(partnerId);
    if (!row || !isCalendarDay(entry.day)) return;
    items.set(entry.id, {
      endDay: null,
      occurredAt: null,
      messageKind: null,
      channel: null,
      ...entry,
      partnerId,
      co: row.partner.co,
      name: row.partner.name,
    });
  };
  for (const activity of work?.activities ?? []) {
    if (activity.kind !== "inviato" && activity.kind !== "risposta") continue;
    const day = instantDay(activity.occurredAt);
    if (day === null || day > today) continue;
    const messageKind = activity.messageKind ?? null;
    const label =
      activity.kind === "risposta"
        ? "Risposta registrata"
        : sentLabel(messageKind, activity.channel);
    add(activity.partnerId, {
      id: `attivita:${activity.id}`,
      day,
      kind: activity.kind === "inviato" ? "inviata" : "risposta",
      label: activity.origin === "file" ? `${label} · vecchio sito` : label,
      origin: activity.origin,
      occurredAt: activity.occurredAt,
      messageKind,
      channel: activity.channel,
    });
  }
  for (const task of work?.followUps ?? []) {
    const row = byPartner.get(task.partnerId);
    const day = task.dueAt === null ? null : instantDay(task.dueAt);
    if (!row || row.blocked || row.stage === "chiuso" || day === null) continue;
    add(task.partnerId, {
      id: `sollecito:${task.id}`,
      day,
      kind: "sollecito",
      label: "Sollecito da fare",
      origin: "team",
    });
  }
  for (const { partnerId, day } of estimates) {
    const row = byPartner.get(partnerId);
    if (!row || row.blocked || row.stage !== "da_contattare" || day < today) continue;
    add(partnerId, {
      id: `stima:${partnerId}:${day}`,
      day,
      kind: "prevista",
      label: "Prima email prevista · stima",
      origin: "assistente",
    });
  }
  for (const { partner, stage, group, blocked } of rows) {
    if (
      !blocked &&
      (stage !== "chiuso" || group === "accordo") &&
      partner.nextActionOn &&
      partner.nextAction
    )
      add(partner.id, {
        id: `azione:${partner.id}`,
        day: partner.nextActionOn,
        kind: "azione",
        label: partner.nextAction,
        origin: "team",
      });
    if (
      stage === "chiuso" &&
      group === "accordo" &&
      partner.eventStartsOn &&
      !partner.researchRemovedAt
    )
      add(partner.id, {
        id: `evento:${partner.id}`,
        day: partner.eventStartsOn,
        endDay: partner.eventEndsOn,
        kind: "evento",
        label: "Evento con accordo",
        origin: "scheda",
      });
    if (!blocked && stage !== "chiuso" && partner.applicationDeadline && !partner.researchRemovedAt)
      add(partner.id, {
        id: `scadenza:${partner.id}`,
        day: partner.applicationDeadline,
        kind: "scadenza",
        label: "Scadenza candidatura",
        origin: "scheda",
      });
  }
  return [...items.values()].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      Date.parse(a.occurredAt ?? `${a.day}T00:00:00Z`) -
        Date.parse(b.occurredAt ?? `${b.day}T00:00:00Z`) ||
      a.id.localeCompare(b.id),
  );
}

const daysSinceMonday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

export function partnerCalendarMonday(day: string): string {
  return addDays(day, -daysSinceMonday(day));
}

export function partnerCalendarWeekNumber(monday: string): number {
  const thursday = new Date(`${monday}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return 1 + Math.floor((thursday.getTime() - yearStart.getTime()) / 604_800_000);
}

export function partnerCalendarOverlaps(
  item: PartnerCalendarItem,
  from: string,
  to: string,
): boolean {
  return item.day <= to && (item.endDay ?? item.day) >= from;
}

type Response = { sent: PartnerCalendarItem; reply: PartnerCalendarItem };
function communications(items: readonly PartnerCalendarItem[], today: string) {
  const byPartner = new Map<string, PartnerCalendarItem[]>();
  for (const item of items) {
    if (
      item.day > today ||
      !item.occurredAt ||
      (item.kind !== "inviata" && item.kind !== "risposta")
    )
      continue;
    const partnerItems = byPartner.get(item.partnerId);
    if (partnerItems) partnerItems.push(item);
    else byPartner.set(item.partnerId, [item]);
  }
  const sent = new Set<string>();
  const replied = new Set<string>();
  const responses: Response[] = [];
  for (const [id, entries] of byPartner) {
    const time = (item: PartnerCalendarItem) => Date.parse(item.occurredAt!);
    entries.sort((a, b) => time(a) - time(b));
    let lastSend: PartnerCalendarItem | undefined;
    for (let start = 0; start < entries.length;) {
      let end = start + 1;
      while (end < entries.length && time(entries[end]) === time(entries[start])) end++;
      const simultaneous = entries.slice(start, end);
      const outbound = simultaneous.find((item) => item.kind === "inviata");
      if (outbound) sent.add(id);
      for (const reply of simultaneous.filter((item) => item.kind === "risposta")) {
        if (lastSend) replied.add(id);
        // Una data retrodatata o importata può coincidere con un invio senza stabilirne l'ordine.
        if (lastSend && !outbound && lastSend.origin !== "file" && reply.origin !== "file")
          responses.push({ sent: lastSend, reply });
      }
      if (outbound) lastSend = outbound;
      start = end;
    }
  }
  return { sent, replied, responses };
}

const actionable = (item: PartnerCalendarItem) =>
  item.kind === "prevista" || item.kind === "azione" || item.kind === "sollecito";
const agreement = (row: PartnerDatabaseRow) => row.stage === "chiuso" && row.group === "accordo";

export function partnerDatabaseKpis(
  rows: readonly PartnerDatabaseRow[],
  items: readonly PartnerCalendarItem[],
  today: string,
) {
  const ids = new Set(rows.map((row) => row.partner.id));
  const relevant = items.filter((item) => ids.has(item.partnerId));
  const { sent, replied } = communications(relevant, today);
  const first = addDays(today, -29);
  const last = addDays(today, 6);
  return {
    contacts: rows.length,
    toContact: rows.filter((row) => !row.blocked && row.stage === "da_contattare").length,
    firstEmails30: relevant.filter(
      (item) =>
        item.kind === "inviata" &&
        item.messageKind === "primo" &&
        item.channel === "email" &&
        item.day >= first &&
        item.day <= today,
    ).length,
    ready: rows.filter(
      (row) => !row.blocked && row.stage === "da_contattare" && row.work.phase === "ready",
    ).length,
    sent: sent.size,
    replied: replied.size,
    replyRate: sent.size === 0 ? null : replied.size / sent.size,
    next7: new Set(
      relevant
        .filter((item) => actionable(item) && item.day >= today && item.day <= last)
        .map((item) => item.partnerId),
    ).size,
    deals: rows.filter(agreement).length,
    inConversation: rows.filter((row) => !row.blocked && row.stage === "trattativa").length,
    closedWithoutDeal: rows.filter(
      (row) => row.stage === "chiuso" && row.group === "non_interessato",
    ).length,
  };
}

export type PartnerActivityPeriod = "8s" | "6m" | "12m";

export function partnerDatabaseActivitySeries(
  items: readonly PartnerCalendarItem[],
  today: string,
  period: PartnerActivityPeriod,
) {
  const weekly = period === "8s";
  const month = `${today.slice(0, 7)}-01`;
  const mondayOffset = daysSinceMonday(today);
  const length = weekly ? 8 : period === "6m" ? 6 : 12;
  return Array.from({ length }, (_, index) => index).flatMap((index) => {
    const offset = index - length + 1;
    const first = weekly ? addDays(today, offset * 7 - mondayOffset) : addMonths(month, offset);
    if (!weekly && !isCalendarDay(first)) return [];
    const nextMonth = weekly ? null : addMonths(first, 1);
    const end =
      nextMonth === null
        ? addDays(today, offset * 7 - mondayOffset + 6)
        : isCalendarDay(nextMonth)
          ? addDays(nextMonth, -1)
          : "2100-12-31";
    if (end < "2000-01-01") return [];
    const from = first < "2000-01-01" ? "2000-01-01" : first;
    const to = end > today ? today : end;
    const found = items.filter((item) => item.day >= from && item.day <= to);
    return [
      {
        from,
        to,
        label: weekly ? shortDay(from) : monthLong(from),
        partial: to !== end || from !== first,
        sent: found.filter((item) => item.kind === "inviata").length,
        replied: found.filter((item) => item.kind === "risposta").length,
      },
    ];
  });
}

export function partnerDatabaseResponseTimes(items: readonly PartnerCalendarItem[], today: string) {
  const days = communications(items, today).responses.map(({ sent, reply }) =>
    daysBetween(sent.day, reply.day),
  );
  const ranges = [
    ["Entro 1 giorno", 0, 1],
    ["2–3 giorni", 2, 3],
    ["4–7 giorni", 4, 7],
    ["8–14 giorni", 8, 14],
    ["Oltre 14 giorni", 15, Infinity],
  ] as const;
  return {
    sample: days.length,
    average: days.length ? days.reduce((sum, day) => sum + day, 0) / days.length : null,
    buckets: ranges.map(([label, from, to]) => ({
      label,
      count: days.filter((day) => day >= from && day <= to).length,
    })),
  };
}

export function partnerDatabaseForecast(items: readonly PartnerCalendarItem[], today: string) {
  return Array.from({ length: 14 }, (_, index) => addDays(today, index))
    .filter(isCalendarDay)
    .map((day) => {
      const matching = items.filter((item) => item.day === day);
      return {
        day,
        label: shortDay(day),
        estimates: matching.filter((item) => item.kind === "prevista").length,
        tasks: matching.filter((item) => item.kind === "sollecito").length,
      };
    });
}

export const PARTNER_BREAKDOWN_DIMENSIONS = {
  sezione: "Sezione",
  paese: "Paese",
  fase: "Fase",
  formato: "Formato della mail",
  responsabile: "Responsabile",
  priorita: "Priorità",
  sottotipo: "Sottotipo",
} as const;
export type PartnerBreakdownDimension = keyof typeof PARTNER_BREAKDOWN_DIMENSIONS;

const formatLabels: Record<string, string> = {
  ...PARTNER_ASSISTANT_FORMAT_LABELS,
  club: "Club",
};

function breakdownKeys(
  row: PartnerDatabaseRow,
  dimension: PartnerBreakdownDimension,
): [string, string][] {
  switch (dimension) {
    case "sezione":
      return row.partner.sections.map((section) => [section, PARTNER_SECTION_LABELS[section]]);
    case "paese":
      return [[row.countryCode ?? "sconosciuto", partnerCountryName(row.countryCode)]];
    case "fase":
      return row.blocked
        ? [["non_contattare", "Non contattare"]]
        : [[row.stage, PARTNER_DATABASE_STAGE_LABELS[row.stage]]];
    case "formato":
      return [
        [
          row.format ?? "sconosciuto",
          row.format === null ? "Non disponibile" : (formatLabels[row.format] ?? row.format),
        ],
      ];
    case "responsabile":
      return [[row.ownerId ?? "predefinito", row.ownerLabel.replace(/ \(predefinito\)$/, "")]];
    case "priorita":
      return [[row.partner.priority, PARTNER_PRIORITY_LABELS[row.partner.priority]]];
    case "sottotipo":
      return [
        [row.subtype ?? "sconosciuto", row.subtype?.replaceAll("_", " ") ?? "Non disponibile"],
      ];
  }
}

export function partnerDatabaseBreakdown(
  rows: readonly PartnerDatabaseRow[],
  items: readonly PartnerCalendarItem[],
  today: string,
  dimension: PartnerBreakdownDimension,
) {
  const itemsByPartner = new Map<string, PartnerCalendarItem[]>();
  for (const item of items) {
    const group = itemsByPartner.get(item.partnerId);
    if (group) group.push(item);
    else itemsByPartner.set(item.partnerId, [item]);
  }
  const groups = new Map<string, { label: string; rows: PartnerDatabaseRow[] }>();
  for (const row of rows)
    for (const [value, label] of breakdownKeys(row, dimension)) {
      const group = groups.get(value) ?? { label, rows: [] };
      group.rows.push(row);
      groups.set(value, group);
    }
  return [...groups]
    .map(([value, group]) => ({
      value,
      label: group.label,
      ...partnerDatabaseKpis(
        group.rows,
        group.rows.flatMap((row) => itemsByPartner.get(row.partner.id) ?? []),
        today,
      ),
    }))
    .sort((a, b) => b.contacts - a.contacts || a.label.localeCompare(b.label, "it"));
}
