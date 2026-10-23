export const TEAM_TIME_ZONE = "Europe/Rome";
export const EVENT_TYPES = ["meeting", "production", "delivery", "launch", "other"] as const;
export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TeamActionState = {
  error?: string;
  success?: string;
  values?: Record<string, string>;
  participantIds?: string[];
  revision?: string;
};
export type EventDetails = {
  summary: string;
  participantIds: string[];
  callUrl: string | null;
  typeLabel?: string;
  allDay?: boolean;
};
export type TeamMember = { id: string; name: string; active: boolean };
export type TeamEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  eventType: EventType;
  details: EventDetails;
  createdBy: string;
};
export type TeamTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  dueAt: string | null;
  assignedTo: string | null;
  createdBy: string;
};
export type TeamNote = {
  id: string;
  title: string;
  body: string;
  taskId: string | null;
  createdAt: string;
  createdBy: string;
};
export type TeamSnapshot = {
  events: TeamEvent[];
  tasks: TeamTask[];
  notes: TeamNote[];
  members: TeamMember[];
};

/** Anteprima locale (`isLocalPreviewEnabled()`): avviso della pagina, come in Partner. */
export const TEAM_PREVIEW_NOTICE = "Anteprima locale: dati sintetici, salvataggio disattivato.";
/** Risposta delle Server Action in anteprima: nessuna chiamata a Supabase. */
export const TEAM_PREVIEW_WRITE_MESSAGE = "Anteprima locale: salvataggio disattivato.";

export class TeamValidationError extends Error {}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTeamId = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TeamValidationError(message);
}

function field(
  form: FormData,
  name: string,
  label: string,
  maxLength: number,
  required = false,
): string {
  const values = form.getAll(name);
  ensure(
    values.length <= 1 && (values.length === 0 || typeof values[0] === "string"),
    `${label}: valore non valido.`,
  );
  const value = String(values[0] ?? "").trim();
  ensure(
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) &&
      value.length <= maxLength &&
      (!required || value.length > 0),
    `${label}: ${required ? "inserisci un valore" : "valore non valido"}, massimo ${maxLength} caratteri.`,
  );
  return value;
}
function optionalId(form: FormData, name: string, label: string): string | null {
  const value = field(form, name, label, 36);
  ensure(value === "" || isTeamId(value), `${label}: seleziona una voce valida.`);
  return value || null;
}

const romeParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TEAM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
function localParts(timestamp: number): number[] {
  const parts = romeParts.formatToParts(timestamp);
  return ["year", "month", "day", "hour", "minute"].map((key) =>
    Number(parts.find((part) => part.type === key)?.value),
  );
}

/** Never interpret datetime-local with the browser/server timezone. Reject gaps and require a fold choice for overlaps. */
export function resolveRomeLocalTime(value: string, occurrence = "", label = "L’orario"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  ensure(
    match && ["", "earlier", "later"].includes(occurrence),
    `${label}: data o orario non valido.`,
  );
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  ensure(
    year >= 2000 &&
      year <= 2100 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31 &&
      hour <= 23 &&
      minute <= 59,
    `${label}: data o orario non valido (anni 2000–2100).`,
  );
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(naive);
  ensure(
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day,
    `${label}: la data non esiste.`,
  );
  const offsets = new Set<number>();
  for (const shift of [-36, 0, 36]) {
    const sample = naive + shift * 3600000;
    const [y, m, d, h, min] = localParts(sample);
    offsets.add(Date.UTC(y, m - 1, d, h, min) - sample);
  }
  const expected = [year, month, day, hour, minute].join(",");
  const candidates = [...offsets]
    .map((offset) => naive - offset)
    .filter((candidate) => localParts(candidate).join(",") === expected)
    .sort((a, b) => a - b);
  ensure(
    candidates.length > 0,
    `${label}: questo orario non esiste nel cambio dell’ora. Scegli un altro orario.`,
  );
  ensure(
    candidates.length === 1 || occurrence !== "",
    `${label} si ripete nel cambio dell’ora: scegli prima o seconda occorrenza.`,
  );
  return new Date(
    occurrence === "later" ? candidates[candidates.length - 1] : candidates[0],
  ).toISOString();
}

function validatedCallUrl(value: string): string | null {
  if (!value) return null;
  ensure(
    value.length <= 2048 && !/[\u0000-\u0020\u007f]/.test(value),
    "Il link della call non è valido: usa un indirizzo completo http:// o https://.",
  );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TeamValidationError(
      "Il link della call non è valido: usa un indirizzo completo http:// o https://.",
    );
  }
  ensure(
    ["https:", "http:"].includes(url.protocol) &&
      url.hostname &&
      !url.username &&
      !url.password &&
      url.href.length <= 2048,
    "Il link della call non è valido: usa http:// o https:// senza credenziali, massimo 2048 caratteri nell’indirizzo normalizzato.",
  );
  return url.href;
}

function validateEventTypeLabel(value: unknown): asserts value is string {
  ensure(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= 80 &&
      !/[\u0000-\u001f\u007f]/.test(value),
    "Tipo appuntamento: inserisci una descrizione su una riga, massimo 80 caratteri.",
  );
}

export function eventTypeLabel(event: Pick<TeamEvent, "eventType" | "details">): string {
  const labels: Record<EventType, string> = {
    meeting: "Call / riunione",
    production: "Produzione",
    delivery: "Consegna",
    launch: "Lancio",
    other: "Altro",
  };
  return event.eventType === "other" && event.details.typeLabel
    ? event.details.typeLabel
    : labels[event.eventType];
}

export function encodeEventDetails(details: EventDetails): string {
  if (details.typeLabel !== undefined) validateEventTypeLabel(details.typeLabel);
  ensure(
    details.allDay === undefined || typeof details.allDay === "boolean",
    "La durata di giornata intera non è valida.",
  );
  const encoded = JSON.stringify({ format: "luckylap-team-event", version: 1, ...details });
  ensure(
    encoded.length <= 50000,
    "I dettagli dell’appuntamento sono troppo lunghi. Riduci descrizione o link.",
  );
  return encoded;
}
export function decodeEventDetails(description: string): EventDetails {
  const legacy = { summary: description, participantIds: [], callUrl: null };
  let value: unknown;
  try {
    value = JSON.parse(description);
  } catch {
    return legacy;
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("format" in value) ||
    value.format !== "luckylap-team-event"
  )
    return legacy;
  const data = value as Record<string, unknown>;
  try {
    ensure(
      data.version === 1 &&
        typeof data.summary === "string" &&
        data.summary.length <= 8000 &&
        Array.isArray(data.participantIds) &&
        data.participantIds.length <= 100 &&
        data.participantIds.every(isTeamId) &&
        new Set(data.participantIds).size === data.participantIds.length &&
        (data.callUrl === null || typeof data.callUrl === "string"),
      "Dettagli non validi.",
    );
    if (data.typeLabel !== undefined) validateEventTypeLabel(data.typeLabel);
    ensure(data.allDay === undefined || typeof data.allDay === "boolean", "Durata non valida.");
    return {
      summary: data.summary,
      participantIds: data.participantIds as string[],
      callUrl: validatedCallUrl((data.callUrl as string | null) ?? ""),
      ...(data.typeLabel !== undefined ? { typeLabel: data.typeLabel as string } : {}),
      ...(data.allDay !== undefined ? { allDay: data.allDay as boolean } : {}),
    };
  } catch {
    return {
      summary: "Dettagli dell’appuntamento non leggibili.",
      participantIds: [],
      callUrl: null,
    };
  }
}

export function parseEventForm(form: FormData) {
  const title = field(form, "title", "Titolo", 240, true);
  const eventType = field(form, "eventType", "Tipo appuntamento", 20, true);
  ensure(
    eventType === "event" || EVENT_TYPES.includes(eventType as EventType),
    "Seleziona un tipo di appuntamento valido.",
  );
  const typeLabel =
    eventType === "event"
      ? "Evento"
      : eventType === "other"
        ? field(form, "customEventType", "Tipo appuntamento", 80, true)
        : undefined;
  if (typeLabel !== undefined) validateEventTypeLabel(typeLabel);
  const startsAt = resolveRomeLocalTime(
    field(form, "startsAt", "Inizio", 16, true),
    field(form, "startsOccurrence", "Occorrenza inizio", 10),
    "L’orario di inizio",
  );
  const endsAt = resolveRomeLocalTime(
    field(form, "endsAt", "Fine", 16, true),
    field(form, "endsOccurrence", "Occorrenza fine", 10),
    "L’orario di fine",
  );
  ensure(endsAt > startsAt, "L’orario di fine deve essere successivo all’inizio.");
  const ids = form.getAll("participantIds");
  ensure(
    ids.length <= 100 && ids.every(isTeamId) && new Set(ids).size === ids.length,
    "Partecipanti: seleziona membri validi del team.",
  );
  const participantIds = ids as string[];
  const details = {
    summary: field(form, "summary", "Descrizione", 8000),
    participantIds,
    callUrl: validatedCallUrl(field(form, "callUrl", "Link call", 2048)),
    ...(typeLabel !== undefined ? { typeLabel } : {}),
  };
  return {
    title,
    description: encodeEventDetails(details),
    starts_at: startsAt,
    ends_at: endsAt,
    event_type: (eventType === "event" ? "other" : eventType) as EventType,
    participantIds,
  };
}

export function parseTaskForm(form: FormData) {
  const dueDate = field(form, "dueDate", "Scadenza", 10);
  ensure(
    dueDate === "" || /^\d{4}-\d{2}-\d{2}$/.test(dueDate),
    "La data di scadenza non è valida.",
  );
  return {
    title: field(form, "title", "Titolo", 240, true),
    description: field(form, "description", "Descrizione", 8000),
    status: "todo" as const,
    due_at: dueDate ? resolveRomeLocalTime(`${dueDate}T12:00`, "", "La scadenza") : null,
    assigned_to: optionalId(form, "assignedTo", "Assegnatario"),
  };
}
export function parseNoteForm(form: FormData) {
  return {
    title: field(form, "title", "Titolo", 240, true),
    body: field(form, "body", "Nota", 12000),
    task_id: optionalId(form, "taskId", "Attività collegata"),
  };
}
export function parseDeleteForm(form: FormData) {
  const table = field(form, "table", "Sezione", 30, true);
  ensure(["calendar_events", "tasks", "notes"].includes(table), "Sezione non valida.");
  const id = optionalId(form, "id", "Elemento");
  ensure(id, "Seleziona un elemento da eliminare.");
  return { table: table as "calendar_events" | "tasks" | "notes", id };
}
export function parseTaskToggleForm(form: FormData) {
  const id = optionalId(form, "id", "Attività");
  const expectedStatus = field(form, "expectedStatus", "Stato attività", 20, true);
  const nextStatus = field(form, "nextStatus", "Nuovo stato", 20, true);
  ensure(
    id &&
      TASK_STATUSES.includes(expectedStatus as TaskStatus) &&
      ["todo", "done"].includes(nextStatus) &&
      nextStatus !== expectedStatus,
    "Lo stato dell’attività non è valido. Ricarica la pagina.",
  );
  return {
    id,
    expectedStatus: expectedStatus as TaskStatus,
    nextStatus: nextStatus as "todo" | "done",
  };
}

export function capturedFormValues(
  form: FormData,
): Pick<TeamActionState, "values" | "participantIds"> {
  const keys = [
    "title",
    "summary",
    "description",
    "body",
    "startsAt",
    "endsAt",
    "startsOccurrence",
    "endsOccurrence",
    "eventType",
    "customEventType",
    "callUrl",
    "dueDate",
    "assignedTo",
    "taskId",
  ];
  return {
    values: Object.fromEntries(
      keys.map((key) => [
        key,
        typeof form.get(key) === "string" ? String(form.get(key)).slice(0, 16000) : "",
      ]),
    ),
    participantIds: form.getAll("participantIds").filter(isTeamId).slice(0, 100),
  };
}

export const formatRomeDateTime = (value: string): string =>
  new Intl.DateTimeFormat("it-IT", {
    timeZone: TEAM_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export const formatRomeDate = (value: string): string =>
  new Intl.DateTimeFormat("it-IT", { timeZone: TEAM_TIME_ZONE, dateStyle: "medium" }).format(
    new Date(value),
  );

/** Linked all-day events use an exclusive next-midnight end, including DST changes. */
export const inclusiveEventEnd = (event: Pick<TeamEvent, "startsAt" | "endsAt">): string =>
  new Date(Math.max(Date.parse(event.startsAt), Date.parse(event.endsAt) - 1)).toISOString();
