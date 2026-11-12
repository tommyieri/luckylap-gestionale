// Proiezioni operative lette sotto RLS: i testi restano limitati alle risposte registrate.
import {
  PARTNER_ASSISTANT_FORMAT_LABELS,
  PARTNER_ASSISTANT_JOB_STATUSES,
  PARTNER_ASSISTANT_STEPS,
} from "./assistant";
import { isCalendarDay } from "./dates";
import {
  PartnerReadError,
  charCount,
  isPartnerActivityChannel,
  isPartnerActivityKind,
  isPartnerId,
} from "./model";
import type { PartnerWorkActivity, PartnerWorkData, PartnerWorkReply } from "./work";

export type PartnerWorkRows = {
  assistantStatus: PartnerWorkData["assistantStatus"];
  jobs: readonly unknown[];
  choices?: readonly unknown[];
  toggles: readonly unknown[];
  activities: readonly unknown[];
  replies: readonly unknown[];
  links: readonly unknown[];
  tasks: readonly unknown[];
};
function ensure(condition: unknown): asserts condition {
  if (!condition) throw new PartnerReadError("Lavoro Partner");
}
const row = (value: unknown): Record<string, unknown> => {
  ensure(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
};
const id = (value: unknown): string => {
  ensure(isPartnerId(value));
  return value;
};
const nullableId = (value: unknown): string | null => (value === null ? null : id(value));
const instant = (value: unknown): string => {
  ensure(typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)));
  return value;
};
const unique = <T>(items: T[], key: (item: T) => unknown) => {
  ensure(new Set(items.map(key)).size === items.length);
  return items;
};
const text = (value: unknown, max: number): string => {
  ensure(typeof value === "string" && charCount(value) <= max);
  return value;
};

/** Un assistente non leggibile non cancella le risposte e i solleciti leggibili. */
export function partnerWorkFromRows(
  rows: PartnerWorkRows,
  partnerIds: readonly string[],
  options: { withoutReplyBodies?: boolean } = {},
): PartnerWorkData {
  const known = new Set(partnerIds);
  const own = (value: unknown): string => {
    const parsed = id(value);
    ensure(known.has(parsed));
    return parsed;
  };
  const activity = (value: unknown): PartnerWorkActivity => {
    const r = row(value);
    ensure(isPartnerActivityKind(r.kind));
    ensure(r.origin === "team" || r.origin === "file" || r.origin === "assistente");
    ensure(r.channel === null || isPartnerActivityChannel(r.channel));
    const messageKind = r.message_kind;
    ensure(
      messageKind === undefined ||
        messageKind === null ||
        (r.kind === "inviato" && (messageKind === "primo" || messageKind === "sollecito")),
    );
    return {
      id: id(r.id),
      partnerId: own(r.partner_id),
      kind: r.kind,
      origin: r.origin,
      channel: r.channel,
      occurredAt: instant(r.occurred_at),
      createdBy: id(r.created_by),
      ...(messageKind === undefined ? {} : { messageKind }),
    };
  };
  const activities = unique(rows.activities.map(activity), (a) => a.id);
  const byActivity = new Map(activities.map((a) => [a.id, a]));
  const replyActivities = activities.filter((activity) => activity.kind === "risposta");
  const replies: PartnerWorkReply[] = options.withoutReplyBodies
    ? []
    : unique(
        rows.replies.map((value): PartnerWorkReply => {
          const r = row(value);
          const parsed = activity(value);
          ensure(parsed.kind === "risposta");
          const summary = byActivity.get(parsed.id);
          ensure(
            summary &&
              Object.entries(parsed).every(
                ([key, value]) => summary[key as keyof PartnerWorkActivity] === value,
              ),
          );
          return { ...parsed, kind: "risposta", body: text(r.body, 4000) };
        }),
        (a) => a.id,
      );
  replies.sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || b.id.localeCompare(a.id),
  );
  if (!options.withoutReplyBodies) ensure(replyActivities.length === replies.length);
  const tasks = unique(
    rows.tasks.map((value) => {
      const r = row(value);
      ensure(r.status === "todo" || r.status === "in_progress" || r.status === "done");
      return {
        id: id(r.id),
        dueAt: r.due_at === null ? null : instant(r.due_at),
        assignedTo: nullableId(r.assigned_to),
        status: r.status,
      };
    }),
    (a) => a.id,
  );
  const links = unique(
    rows.links.map((value) => {
      const r = row(value);
      ensure(r.kind === "follow_up");
      const partnerId = own(r.partner_id);
      const activityId = nullableId(r.activity_id);
      ensure(activityId === null || byActivity.get(activityId)?.partnerId === partnerId);
      return { id: id(r.id), partnerId, taskId: nullableId(r.task_id) };
    }),
    (a) => a.id,
  );
  unique(
    links.filter((a) => a.taskId !== null),
    (a) => a.taskId,
  );
  const linkedTaskIds = new Set(links.map((link) => link.taskId));
  ensure(tasks.every((task) => linkedTaskIds.has(task.id)));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const followUps: PartnerWorkData["followUps"] = [];
  for (const link of links) {
    if (link.taskId === null) continue;
    const task = tasksById.get(link.taskId);
    ensure(task);
    if (task.status !== "done")
      followUps.push({
        id: task.id,
        partnerId: link.partnerId,
        dueAt: task.dueAt,
        assignedTo: task.assignedTo,
      });
  }
  let assistantStatus = rows.assistantStatus;
  let jobs: PartnerWorkData["jobs"] = [];
  let toggles: PartnerWorkData["toggles"] = [];
  if (assistantStatus === "ready") {
    try {
      const choices = new Map(
        (rows.choices ?? []).map((value) => {
          const choice = row(value);
          return [choice.id, choice] as const;
        }),
      );
      jobs = unique(
        rows.jobs.map((value) => {
          const r = row(value);
          ensure(PARTNER_ASSISTANT_JOB_STATUSES.includes(r.status as never));
          ensure(PARTNER_ASSISTANT_STEPS.includes(r.step as never));
          ensure(r.write_on === null || isCalendarDay(r.write_on));
          const choice = choices.get(r.choice_note_id);
          const ownsChoice = choice?.partner_id === r.partner_id;
          const format = ownsChoice ? choice?.format : null;
          const subtype = ownsChoice ? choice?.subtype : null;
          return {
            partnerId: own(r.partner_id),
            status: r.status as PartnerWorkData["jobs"][number]["status"],
            step: r.step as PartnerWorkData["jobs"][number]["step"],
            reason: r.reason === null ? null : text(r.reason, 500),
            writeOn: r.write_on as string | null,
            updatedAt: instant(r.updated_at),
            draftId: nullableId(r.draft_id),
            ...(rows.choices
              ? {
                  format:
                    typeof format === "string" &&
                    (format === "club" || Object.hasOwn(PARTNER_ASSISTANT_FORMAT_LABELS, format))
                      ? format
                      : null,
                  subtype:
                    typeof subtype === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(subtype)
                      ? subtype
                      : null,
                }
              : {}),
          };
        }),
        (a) => a.partnerId,
      );
      toggles = unique(
        rows.toggles.map((value) => {
          const r = row(value);
          ensure(typeof r.active === "boolean");
          return { partnerId: own(r.partner_id), active: r.active };
        }),
        (a) => a.partnerId,
      );
    } catch (error) {
      if (!(error instanceof PartnerReadError)) throw error;
      assistantStatus = "error";
      jobs = [];
      toggles = [];
    }
  }
  return { assistantStatus, jobs, toggles, activities, replies, followUps };
}
