import type { PartnerAssistantSendStatus, PartnerAssistantStatus } from "../partner/assistant";
import { partnerSendPlanReasonLabel, type PartnerSendPlan } from "../partner/send-plan";
import { isCalendarDay } from "../partner/dates";
import { hasControlCharacters, isPartnerCo, isPartnerId } from "../partner/model";
import { partnerWorkHref } from "./work-model";
import { romeDay } from "./model";

export type AutomaticMailGroupKey = "other" | "club" | "followup";
export type AutomaticMailStatus = "sent" | "sending" | "scheduled" | "skipped" | "uncertain";
export type AutomaticMailCounts = Record<AutomaticMailStatus, number>;
export type AutomaticFollowupMode = "spento" | "osserva" | "invio" | "unknown";
export type AutomaticMailRow = {
  id: string;
  partnerId: string;
  co: number;
  name: string;
  href: string;
  kind: "primo" | "sollecito";
  status: AutomaticMailStatus;
  plannedAt: string | null;
  sentAt: string | null;
  localDay: string | null;
  localTime: string | null;
  timezone: string | null;
  reasonLabel: string;
};
export type AutomaticMailGroup = {
  key: AutomaticMailGroupKey;
  label: string;
  limit: number;
  counts: AutomaticMailCounts;
  rows: AutomaticMailRow[];
};
export type AutomaticMailDay = {
  day: string;
  generatedAt: string;
  state: "automatic" | "paused" | "inactive" | "unreadable";
  stateLabel: string;
  followupMode: AutomaticFollowupMode;
  groups: AutomaticMailGroup[];
  totals: AutomaticMailCounts;
};

/** Metadati operativi soltanto: nessun recapito, oggetto, corpo, firma o prova IMAP. */
export type AutomaticMailPartner = {
  id: string;
  co: number;
  name: string;
  template: boolean;
  timezone: string | null;
};
export type AutomaticMailMessage = {
  id: string;
  partnerId: string;
  kind: "primo" | "sollecito";
  status: "in_invio" | "inviato" | "incerto" | "respinto" | "scartato";
  sendDay: string;
  sentAt: string | null;
  createdAt: string;
  template: boolean;
  timezone: string | null;
  reason: string | null;
};

const emptyCounts = (): AutomaticMailCounts => ({
  sent: 0,
  sending: 0,
  scheduled: 0,
  skipped: 0,
  uncertain: 0,
});
const fail = (): never => {
  throw new Error("Invii automatici del giorno non leggibili.");
};
const instant = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
  isCalendarDay(value.slice(0, 10)) &&
  Number.isFinite(Date.parse(value));

export function automaticMailTimezone(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return null;
  try {
    new Intl.DateTimeFormat("it-IT", { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return null;
  }
}

function local(when: string | null, timezone: string | null) {
  if (when === null || timezone === null) return { localDay: null, localTime: null };
  return {
    localDay: new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(when)),
    localTime: new Intl.DateTimeFormat("it-IT", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(when)),
  };
}

function groupKey(kind: AutomaticMailRow["kind"], template: boolean): AutomaticMailGroupKey {
  return kind === "sollecito" ? "followup" : template ? "club" : "other";
}

function mailState(
  plan: PartnerSendPlan,
  assistant: PartnerAssistantStatus | null,
  send: PartnerAssistantSendStatus | null,
  now: Date,
): Pick<AutomaticMailDay, "state" | "stateLabel"> {
  if (!assistant || !send || assistant.mode !== plan.mode)
    return { state: "unreadable", stateLabel: "Stato dell’invio da verificare." };
  if (plan.mode !== "invio")
    return { state: "inactive", stateLabel: "Invio automatico non attivo." };
  if (!assistant.configured)
    return { state: "inactive", stateLabel: "Invio automatico da configurare." };
  if (send.stopReason !== null || send.dayStoppedOn === plan.day)
    return { state: "paused", stateLabel: "Invii fermi: controlla lo stato della posta." };
  if (send.envMailboxOk === false)
    return {
      state: "paused",
      stateLabel: "Invii in attesa: configurazione della posta da verificare.",
    };
  if (send.envMailboxOk === null)
    return { state: "unreadable", stateLabel: "Configurazione della posta non ancora verificata." };
  if (send.backoffUntil !== null && Date.parse(send.backoffUntil) > now.getTime())
    return { state: "paused", stateLabel: "Invii in attesa del prossimo tentativo automatico." };
  // La pausa credito riguarda la preparazione Claude: non ferma l’invio delle bozze pronte.
  return { state: "automatic", stateLabel: "Invio automatico secondo il calendario." };
}

/** Il piano fornisce gli appuntamenti; i messaggi del giorno attestano gli esiti effettivi.
 * Un esito presente in entrambe le fonti compare una volta sola, senza creare posti fittizi. */
export function automaticMailDay(input: {
  plan: PartnerSendPlan;
  partners: readonly AutomaticMailPartner[];
  messages: readonly AutomaticMailMessage[];
  assistant: PartnerAssistantStatus | null;
  send: PartnerAssistantSendStatus | null;
  followupMode: AutomaticFollowupMode;
  now: Date;
}): AutomaticMailDay {
  const { plan, now } = input;
  if (!Number.isFinite(now.getTime()) || plan.day !== romeDay(now)) fail();
  const partners = new Map<string, AutomaticMailPartner>();
  for (const partner of input.partners) {
    if (
      !isPartnerId(partner.id) ||
      partners.has(partner.id) ||
      !isPartnerCo(partner.co) ||
      typeof partner.name !== "string" ||
      partner.name.length === 0 ||
      partner.name.length > 240 ||
      hasControlCharacters(partner.name) ||
      typeof partner.template !== "boolean" ||
      (partner.timezone !== null && automaticMailTimezone(partner.timezone) === null)
    )
      fail();
    partners.set(partner.id, partner);
  }
  const groups: AutomaticMailGroup[] = [
    { key: "other", label: "Altri contatti", limit: 3, counts: emptyCounts(), rows: [] },
    { key: "club", label: "Club", limit: 3, counts: emptyCounts(), rows: [] },
    { key: "followup", label: "Solleciti", limit: 6, counts: emptyCounts(), rows: [] },
  ];
  const add = (key: AutomaticMailGroupKey, row: AutomaticMailRow) => {
    const group = groups.find((item) => item.key === key)!;
    group.rows.push(row);
    group.counts[row.status] += 1;
  };
  const messages = new Map<string, AutomaticMailMessage[]>();
  const messageIds = new Set<string>();
  for (const message of input.messages) {
    if (
      !isPartnerId(message.id) ||
      messageIds.has(message.id) ||
      !partners.has(message.partnerId) ||
      message.sendDay !== plan.day ||
      !instant(message.createdAt) ||
      (message.sentAt !== null && !instant(message.sentAt)) ||
      ((message.status === "inviato" || message.status === "incerto") && message.sentAt === null) ||
      typeof message.template !== "boolean" ||
      (message.timezone !== null && automaticMailTimezone(message.timezone) === null) ||
      !["primo", "sollecito"].includes(message.kind) ||
      !["in_invio", "inviato", "incerto", "respinto", "scartato"].includes(message.status)
    )
      fail();
    const key = `${message.partnerId}:${message.kind}`;
    messages.set(key, [...(messages.get(key) ?? []), message]);
    messageIds.add(message.id);
  }
  const consumes = (row: AutomaticMailMessage) =>
    ["in_invio", "inviato", "incerto"].includes(row.status);
  const slotsByContact = new Map<string, PartnerSendPlan["slots"]>();
  for (const slot of plan.slots) {
    const key = `${slot.partnerId}:${slot.kind}`;
    slotsByContact.set(key, [...(slotsByContact.get(key) ?? []), slot]);
  }
  const used = new Set<string>();
  for (const slot of plan.slots) {
    const partner = partners.get(slot.partnerId) ?? fail();
    const key = `${slot.partnerId}:${slot.kind}`;
    const contactMessages = messages.get(key) ?? [];
    const countedMessages = contactMessages.filter(consumes);
    // Senza un legame univoco non si attribuisce un esito a un orario specifico.
    // I messaggi restano comunque contati singolarmente più sotto.
    const message =
      slotsByContact.get(key)?.length === 1
        ? countedMessages.length === 1
          ? countedMessages[0]
          : countedMessages.length === 0 && contactMessages.length === 1
            ? contactMessages[0]
            : undefined
        : undefined;
    if (message) used.add(message.id);
    if (!message && ["sent", "sending", "uncertain"].includes(slot.status)) {
      if (countedMessages.length === 0) fail();
      continue;
    }
    if (!message && slot.status === "scheduled" && countedMessages.length > 0) continue;
    const status: AutomaticMailStatus = message
      ? message.status === "inviato"
        ? "sent"
        : message.status === "in_invio"
          ? "sending"
          : message.status === "incerto"
            ? "uncertain"
            : "skipped"
      : slot.status === "expired" || slot.status === "skipped"
        ? "skipped"
        : slot.status;
    const sentAt = message?.sentAt ?? null;
    add(groupKey(slot.kind, message?.template ?? partner.template), {
      id: slot.id,
      partnerId: slot.partnerId,
      co: slot.co,
      name: slot.name,
      href: partnerWorkHref(slot.co),
      kind: slot.kind,
      status,
      plannedAt: slot.plannedAt,
      sentAt,
      timezone: slot.timezone,
      ...local(sentAt ?? slot.plannedAt, slot.timezone),
      reasonLabel: partnerSendPlanReasonLabel(message?.reason ?? slot.reason),
    });
  }
  for (const message of input.messages) {
    if (used.has(message.id)) continue;
    const partner = partners.get(message.partnerId) ?? fail();
    const status: AutomaticMailStatus =
      message.status === "inviato"
        ? "sent"
        : message.status === "in_invio"
          ? "sending"
          : message.status === "incerto"
            ? "uncertain"
            : "skipped";
    add(groupKey(message.kind, message.template), {
      id: message.id,
      partnerId: partner.id,
      co: partner.co,
      name: partner.name,
      href: partnerWorkHref(partner.co),
      kind: message.kind,
      status,
      plannedAt: null,
      sentAt: message.sentAt,
      timezone: message.timezone,
      ...local(message.sentAt, message.timezone),
      reasonLabel: partnerSendPlanReasonLabel(message.reason),
    });
  }
  const totals = emptyCounts();
  for (const group of groups) {
    group.rows.sort(
      (a, b) =>
        (a.plannedAt ?? a.sentAt ?? "").localeCompare(b.plannedAt ?? b.sentAt ?? "") || a.co - b.co,
    );
    for (const key of Object.keys(totals) as AutomaticMailStatus[])
      totals[key] += group.counts[key];
  }
  return {
    day: plan.day,
    generatedAt: plan.generatedAt,
    ...mailState(plan, input.assistant, input.send, now),
    followupMode: input.followupMode,
    groups,
    totals,
  };
}
