import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tile } from "./model";
import { romeDay } from "./model";
import { isCalendarDay } from "../partner/dates";
import { isPartnerId } from "../partner/model";
import { parsePartnerFollowupStatus } from "../partner/followup-status";
import { loadPartnerSendPlan } from "../partner/send-plan-server";
import { loadPartnerAssistantSend, loadPartnerAssistantStatus } from "../partner/server";
import {
  automaticMailDay,
  automaticMailTimezone,
  type AutomaticFollowupMode,
  type AutomaticMailDay,
  type AutomaticMailMessage,
  type AutomaticMailPartner,
} from "./automatic-mail-model";

const MAX_MESSAGES = 2000;
const CHUNK = 100;
const fail = (): never => {
  throw new Error("Invii automatici del giorno non leggibili.");
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
const id = (value: unknown): string => (isPartnerId(value) ? value : fail());
const nullableId = (value: unknown): string | null => (value === null ? null : id(value));
const text = (value: unknown): string => (typeof value === "string" ? value : fail());
const unique = (values: readonly (string | null)[]) => [
  ...new Set(values.filter((v): v is string => v !== null)),
];
const instant = (value: unknown): string => {
  const parsed = text(value);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(parsed) &&
    isCalendarDay(parsed.slice(0, 10)) &&
    Number.isFinite(Date.parse(parsed))
    ? parsed
    : fail();
};
type Result = { data: unknown; error: unknown; count: number | null };
function rows(result: Result, limit: number): Record<string, unknown>[] {
  if (
    result.error ||
    !Array.isArray(result.data) ||
    !Number.isSafeInteger(result.count) ||
    result.count === null ||
    result.count < 0 ||
    result.count > limit ||
    result.data.length !== result.count
  )
    fail();
  return (result.data as unknown[]).map(object);
}

/** Letture ristrette agli UUID del piano e dei messaggi: la sessione è sempre quella del membro. */
async function metadata(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  ids: readonly string[],
  column = "id",
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  const wanted = unique(ids);
  for (let start = 0; start < wanted.length; start += CHUNK) {
    const chunk = wanted.slice(start, start + CHUNK);
    const result = await supabase
      .from(table)
      .select(columns, { count: "exact" })
      .in(column, chunk)
      .limit(CHUNK)
      .abortSignal(AbortSignal.timeout(10_000));
    for (const row of rows(result, chunk.length)) {
      const key = id(row[column]);
      if (!chunk.includes(key) || found.has(key)) fail();
      found.set(key, row);
    }
  }
  return found;
}

type MessageRow = {
  id: string;
  partnerId: string;
  draftId: string | null;
  kind: "primo" | "sollecito";
  status: AutomaticMailMessage["status"];
  sendDay: string;
  sentAt: string | null;
  createdAt: string;
  reason: string | null;
};
async function dayMessages(supabase: SupabaseClient, day: string): Promise<MessageRow[]> {
  const result = await supabase
    .from("partner_assistant_messages")
    .select("id,partner_id,draft_id,kind,send_status,send_day,sent_at,created_at,outcome", {
      count: "exact",
    })
    .eq("mode", "invio")
    .eq("send_day", day)
    .in("send_status", ["in_invio", "inviato", "incerto", "respinto", "scartato"])
    .order("id")
    .limit(MAX_MESSAGES)
    .abortSignal(AbortSignal.timeout(10_000));
  return rows(result, MAX_MESSAGES).map((row) => {
    if (
      !(["primo", "sollecito"] as unknown[]).includes(row.kind) ||
      !(["in_invio", "inviato", "incerto", "respinto", "scartato"] as unknown[]).includes(
        row.send_status,
      ) ||
      row.send_day !== day ||
      !(
        row.outcome === null ||
        (typeof row.outcome === "string" && /^[a-z][a-z0-9_]{0,79}$/u.test(row.outcome))
      )
    )
      fail();
    return {
      id: id(row.id),
      partnerId: id(row.partner_id),
      draftId: nullableId(row.draft_id),
      kind: row.kind as MessageRow["kind"],
      status: row.send_status as MessageRow["status"],
      sendDay: day,
      sentAt: row.sent_at === null ? null : instant(row.sent_at),
      createdAt: instant(row.created_at),
      reason:
        row.send_status === "incerto"
          ? "invio_incerto"
          : row.send_status === "respinto"
            ? "invio_rifiutato"
            : row.send_status === "scartato"
              ? (row.outcome as string | null)
              : null,
    };
  });
}

/** Il mode dei solleciti è leggibile soltanto attraverso una conversazione esistente.
 * Un null non viene interpretato come invio attivo e non richiede privilegi amministrativi. */
export async function loadAutomaticFollowupMode(
  supabase: SupabaseClient,
  knownPartner: string | null = null,
): Promise<AutomaticFollowupMode> {
  try {
    let partnerId = knownPartner;
    if (partnerId === null) {
      const { data, error } = await supabase
        .from("partner_assistant_messages")
        .select("partner_id")
        .eq("mode", "invio")
        .eq("kind", "primo")
        .eq("send_status", "inviato")
        .order("sent_at", { ascending: false })
        .limit(1)
        .abortSignal(AbortSignal.timeout(10_000));
      if (error || !Array.isArray(data) || data.length > 1) return "unknown";
      if (data.length === 0) return "unknown";
      partnerId = id(object(data[0]).partner_id);
    }
    const { data, error } = await supabase
      .rpc("read_partner_followup", { p_partner_id: partnerId })
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) return "unknown";
    return parsePartnerFollowupStatus(data)?.mode ?? "unknown";
  } catch (error) {
    unstable_rethrow(error);
    return "unknown";
  }
}

/** Nessuna creazione del piano o autorizzazione d’invio: questa lettura alimenta soltanto Oggi. */
export async function loadAutomaticMailTile(
  supabase: SupabaseClient,
  now: Date,
): Promise<Tile<AutomaticMailDay>> {
  try {
    const day = romeDay(now);
    const [planResult, messagesResult, assistantResult, sendResult] = await Promise.allSettled([
      loadPartnerSendPlan(supabase, day),
      dayMessages(supabase, day),
      loadPartnerAssistantStatus(supabase),
      loadPartnerAssistantSend(supabase),
    ]);
    for (const result of [planResult, messagesResult, assistantResult, sendResult])
      if (result.status === "rejected") unstable_rethrow(result.reason);
    const plan = planResult.status === "fulfilled" ? (planResult.value ?? fail()) : fail();
    const messages = messagesResult.status === "fulfilled" ? messagesResult.value : fail();
    const partnerIds = unique([
      ...plan.slots.map((row) => row.partnerId),
      ...messages.map((row) => row.partnerId),
    ]);
    const [partners, jobs] = await Promise.all([
      metadata(supabase, "partners", "id,co,name", partnerIds),
      metadata(
        supabase,
        "partner_assistant_jobs",
        "partner_id,draft_id,choice_note_id",
        partnerIds,
        "partner_id",
      ),
    ]);
    if (partners.size !== partnerIds.length) fail();
    const draftIds = unique(
      [...jobs.values()]
        .map((row) => nullableId(row.draft_id))
        .concat(messages.map((row) => row.draftId)),
    );
    const drafts = await metadata(
      supabase,
      "partner_assistant_drafts",
      "id,research_note_id,choice_note_id",
      draftIds,
    );
    if (drafts.size !== draftIds.length) fail();
    const noteIds = unique(
      [...drafts.values()]
        .flatMap((row) => [nullableId(row.research_note_id), nullableId(row.choice_note_id)])
        .concat([...jobs.values()].map((row) => nullableId(row.choice_note_id))),
    );
    const notes = await metadata(
      supabase,
      "partner_assistant_notes",
      "id,kind,template:content->>template,timezone:content->>timezone",
      noteIds,
    );
    if (notes.size !== noteIds.length) fail();
    const template = (draftId: string | null) => {
      if (draftId === null) return fail();
      const draft = drafts.get(draftId) ?? fail();
      const researchId = nullableId(draft.research_note_id);
      if (researchId === null) return fail();
      const research = notes.get(researchId) ?? fail();
      return research.kind === "ricerca" && research.template === "true";
    };
    const partnerRows: AutomaticMailPartner[] = partnerIds.map((partnerId) => {
      const partner = partners.get(partnerId) ?? fail();
      const job = jobs.get(partnerId);
      const draftId = job ? nullableId(job.draft_id) : null;
      const hasFirstSlot = plan.slots.some(
        (slot) => slot.partnerId === partnerId && slot.kind === "primo",
      );
      const choiceId = job ? nullableId(job.choice_note_id) : null;
      const choice = choiceId === null ? null : (notes.get(choiceId) ?? fail());
      return {
        id: partnerId,
        co: partner.co as number,
        name: text(partner.name),
        // Per i solleciti la categoria è già certa; non si indovina il percorso di una prima email cancellata.
        template: draftId !== null || hasFirstSlot ? template(draftId) : false,
        timezone: automaticMailTimezone(choice?.timezone),
      };
    });
    const byPartner = new Map(partnerRows.map((row) => [row.id, row]));
    const classifiedMessages: AutomaticMailMessage[] = messages.map((message) => {
      const draft = message.draftId === null ? null : (drafts.get(message.draftId) ?? fail());
      const draftChoiceId = draft === null ? null : nullableId(draft.choice_note_id);
      const draftChoice = draftChoiceId === null ? null : (notes.get(draftChoiceId) ?? fail());
      const job = jobs.get(message.partnerId);
      const timezone =
        automaticMailTimezone(draftChoice?.timezone) ??
        (job?.draft_id === message.draftId
          ? (byPartner.get(message.partnerId)?.timezone ?? null)
          : null);
      return {
        ...message,
        template: message.kind === "primo" ? template(message.draftId) : false,
        timezone,
      };
    });
    const knownFollowup =
      plan.slots.find((row) => row.kind === "sollecito")?.partnerId ??
      messages.find((row) => row.kind === "sollecito")?.partnerId ??
      null;
    const mode = await loadAutomaticFollowupMode(supabase, knownFollowup);
    const assistant =
      assistantResult.status === "fulfilled" && typeof assistantResult.value === "object"
        ? assistantResult.value
        : null;
    const send = sendResult.status === "fulfilled" ? sendResult.value : null;
    return {
      status: "ok",
      data: automaticMailDay({
        plan,
        messages: classifiedMessages,
        partners: partnerRows,
        assistant,
        send,
        followupMode: mode,
        now,
      }),
    };
  } catch (error) {
    unstable_rethrow(error);
    return { status: "error" };
  }
}
