export const LOCAL_WORKSPACE_KEY = "luckylap-local-workspace-v1";

export type LocalAppointment = {
  id: string;
  title: string;
  date: string;
  time: string;
  notes: string;
  participants?: string;
  link?: string;
};
export type LocalTask = { id: string; title: string; done: boolean; due: string };
export type LocalWorkspace = { appointments: LocalAppointment[]; tasks: LocalTask[]; note: string };
export type LocalWorkspaceRead = { workspace: LocalWorkspace; issue: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function httpLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value === "") return "";
  if (!/^https?:\/\//i.test(value.trim())) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Recover renderable data while making any malformed storage visible to the caller. */
export function readLocalWorkspace(raw: string | null): LocalWorkspaceRead {
  const workspace: LocalWorkspace = { appointments: [], tasks: [], note: "" };
  if (raw === null) return { workspace, issue: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { workspace, issue: true };
  }
  if (!isRecord(parsed)) return { workspace, issue: true };

  let issue = false;
  if (Array.isArray(parsed.appointments)) {
    for (const value of parsed.appointments) {
      if (
        !isRecord(value) ||
        !isNonemptyText(value.id) ||
        !isNonemptyText(value.title) ||
        !isCalendarDate(value.date) ||
        !isTime(value.time)
      ) {
        issue = true;
        continue;
      }
      const appointment: LocalAppointment = {
        id: value.id,
        title: value.title,
        date: value.date,
        time: value.time,
        notes: typeof value.notes === "string" ? value.notes : "",
      };
      if (typeof value.notes !== "string") issue = true;
      if (value.participants !== undefined) {
        appointment.participants = typeof value.participants === "string" ? value.participants : "";
        if (typeof value.participants !== "string") issue = true;
      }
      if (value.link !== undefined) {
        const link = httpLink(value.link);
        appointment.link = link ?? "";
        if (link === null) issue = true;
      }
      workspace.appointments.push(appointment);
    }
  } else issue = true;

  if (Array.isArray(parsed.tasks)) {
    for (const value of parsed.tasks) {
      if (!isRecord(value) || !isNonemptyText(value.id) || !isNonemptyText(value.title)) {
        issue = true;
        continue;
      }
      const due = value.due === "" || isCalendarDate(value.due) ? value.due : "";
      if (due !== value.due || typeof value.done !== "boolean") issue = true;
      workspace.tasks.push({ id: value.id, title: value.title, done: value.done === true, due });
    }
  } else issue = true;

  if (typeof parsed.note === "string") workspace.note = parsed.note;
  else issue = true;

  return { workspace, issue };
}

/** Pass the latest getItem value immediately before writing; never replace unrelated fields. */
export function mergeWorkspaceField<K extends keyof LocalWorkspace>(
  raw: string | null,
  field: K,
  value: LocalWorkspace[K],
): LocalWorkspaceRead {
  const result = readLocalWorkspace(raw);
  // Preserve the original stored value until malformed data is explicitly recovered.
  if (result.issue) return result;
  return { workspace: { ...result.workspace, [field]: value }, issue: false };
}
