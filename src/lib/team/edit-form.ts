import { romeDayOf } from "./calendar";
import {
  inclusiveEventEnd,
  resolveRomeLocalTime,
  TEAM_TIME_ZONE,
  type TeamActionState,
  type TeamEvent,
  type TeamMember,
  type TeamTask,
} from "./model";

const localDateTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: TEAM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Mantiene l’orario di Roma anche quando il browser usa un altro fuso. */
export function romeDateTimeInput(instant: string): string {
  const parts = localDateTime.formatToParts(new Date(instant));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** Conserva la prima o seconda occorrenza di un orario già salvato nel cambio dell’ora. */
export function romeInputOccurrence(instant: string): "" | "earlier" | "later" {
  const local = romeDateTimeInput(instant);
  const earlier = resolveRomeLocalTime(local, "earlier");
  const later = resolveRomeLocalTime(local, "later");
  if (earlier === later) return "";
  return Math.floor(Date.parse(instant) / 60000) === Math.floor(Date.parse(later) / 60000)
    ? "later"
    : "earlier";
}

export function eventFormDefaults(
  event: TeamEvent,
): Pick<TeamActionState, "values" | "participantIds"> {
  const allDay = event.details.allDay === true;
  return {
    values: {
      title: event.title,
      startsAt: allDay ? romeDayOf(event.startsAt) : romeDateTimeInput(event.startsAt),
      endsAt: allDay ? romeDayOf(inclusiveEventEnd(event)) : romeDateTimeInput(event.endsAt),
      startsOccurrence: allDay ? "" : romeInputOccurrence(event.startsAt),
      endsOccurrence: allDay ? "" : romeInputOccurrence(event.endsAt),
      eventType:
        event.eventType === "other" && event.details.typeLabel === "Evento"
          ? "event"
          : event.eventType,
      customEventType: event.details.typeLabel ?? "Altro",
      summary: event.details.summary,
      callUrl: event.details.callUrl ?? "",
      allDay: allDay ? "true" : "false",
    },
    participantIds: [...event.details.participantIds],
  };
}

export function taskFormDefaults(task: TeamTask): Record<string, string> {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    dueDate: task.dueAt ? romeDayOf(task.dueAt) : "",
    assignedTo: task.assignedTo ?? "",
  };
}

/** Le selezioni precedenti restano visibili anche se il membro non è più attivo. */
export function editableMembers(members: TeamMember[], selectedIds: string[]): TeamMember[] {
  const available = members.filter((member) => member.active || selectedIds.includes(member.id));
  const missing = selectedIds.filter((id) => !available.some((member) => member.id === id));
  return [
    ...available,
    ...missing.map((id) => ({ id, name: "Membro non più disponibile", active: false })),
  ];
}
