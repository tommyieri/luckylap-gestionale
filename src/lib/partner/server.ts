import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedMember } from "../auth/server";
import { readTeamPages } from "../team/read";
import {
  PARTNER_ASSISTANT_INACTIVE,
  PARTNER_ASSISTANT_SENDS_LIMIT,
  PARTNER_ASSISTANT_SEND_OUTCOMES,
  isPartnerAssistantMissing,
  partnerAssistantRulesFrom,
  partnerAssistantSendFrom,
  partnerAssistantStatusFrom,
  type PartnerAssistantInactive,
  type PartnerAssistantRows,
  type PartnerAssistantRulesView,
  type PartnerAssistantSendStatus,
  type PartnerAssistantStatus,
} from "./assistant";
import {
  PARTNER_ERROR_MESSAGES,
  PARTNER_UNCERTAIN_MESSAGE,
  parsePartnerCommand,
  partnerCommandOutcome,
  partnerCommandRejection,
  type PartnerCommandKind,
  type PartnerCommandResult,
  type PartnerCommandSuccess,
} from "./commands";
import {
  parsePartnerDevicePreview,
  validatePartnerDevicePayload,
  type PartnerDevicePreview,
} from "./device-file";
import { followUpConfirmation, readSentFollowUp } from "./follow-up";
import { isPartnerCo, isPartnerId, type PartnerDetail, type PartnerWorkspace } from "./model";
import {
  partnerDataFromRows,
  partnerDetailFromRows,
  partnerDomainsOf,
  partnerRulesFromRow,
  partnerWorkspaceFromRows,
  type PartnerDataSnapshot,
  type PartnerRules,
} from "./read";

/*
 * Letture e comandi di Partner (spec 02 §5, §6). Chi chiama ha già verificato sessione e
 * membership; ogni lettura usa la sessione del membro sotto RLS. Letture complete o niente:
 * pagine con keyset (readTeamPages), conteggi esatti verificati, riferimenti controllati in
 * read.ts. Ogni errore diventa PartnerUnavailableError: la pagina non mostra dati parziali.
 * Unica eccezione, il blocco dell'assistente nella scheda: con un errore suo diventa `null` e la
 * scheda resta leggibile. Prima che le migrazioni dell'assistente siano applicate, funzione e
 * tabelle mancanti danno PARTNER_ASSISTANT_INACTIVE: striscia e blocco non si mostrano.
 */

export class PartnerUnavailableError extends Error {
  constructor() {
    super(
      "Partner non disponibile. Ricarica la pagina tra poco; nessun dato parziale viene mostrato.",
    );
  }
}

/** Colonne della lista: nessun testo della ricerca oltre a percorso e follower. */
export const PARTNER_SUMMARY_COLUMNS =
  "id,co,source_key,origin,name,city,country,type_label,sections,priority,contact_month,event_starts_on,event_ends_on,application_deadline,preferred_channel,research_removed_at,stage,stage_from_file_at,owner_id,next_action,next_action_on,chosen_approach,approach_from_file_at,version,updated_at,route:research->>route,followers:research->>followers";
/** Recapiti della lista: il valore pulito, non il testo intero. */
export const PARTNER_CONTACT_LINK_COLUMNS =
  "id,partner_id,kind,link_value,label,verified,active,position,version";
/** Indice delle varianti: nessun testo dei messaggi. */
export const PARTNER_VARIANT_SUMMARY_COLUMNS =
  "id,partner_id,approach,channel,language,lookbook_code,current_revision_id,original_changed_at,research_removed_at,version";
/** Differenze aperte della lista: senza i valori. */
export const PARTNER_OPEN_DIFFERENCE_COLUMNS = "id,partner_id,origin,field,variant_id,contact_id";
export const PARTNER_BLOCK_COLUMNS = "id,partner_id,domain,reason,created_at";
export const PARTNER_IMPORT_COLUMNS =
  "id,source_commit,source_generated,applied_at,partners_total,partners_new,partners_updated,partners_removed,variants_total,differences_new";

const DETAIL_COLUMNS =
  "id,co,source_key,origin,name,city,country,type_label,sections,priority,contact_month,event_starts_on,event_ends_on,application_deadline,preferred_channel,research_removed_at,stage,stage_from_file_at,owner_id,next_action,next_action_on,chosen_approach,approach_from_file_at,version,updated_at,research,created_at,created_by";
const CONTACT_COLUMNS = `${PARTNER_CONTACT_LINK_COLUMNS},value,research_slot,erased_at,created_at`;
const VARIANT_COLUMNS =
  "id,partner_id,approach,origin,channel,language,to_text,cc_text,lookbook_code,original_subject,original_body,original_follow_up,original_confirm_email,gist_it,notes_it,form_fields_it,current_revision_id,original_changed_at,research_removed_at,version";
const REVISION_COLUMNS =
  "id,variant_id,revision_no,kind,subject,body,follow_up,confirm_email,file_exported_at,created_by,created_at";
const ACTIVITY_COLUMNS =
  "id,operation_id,partner_id,partner_name,partner_co,kind,origin,occurred_at,message_kind,channel,approach,stage_before,stage_after,owner_after,next_action_on,body,created_by,created_at";
const DIFFERENCE_COLUMNS = `${PARTNER_OPEN_DIFFERENCE_COLUMNS},team_value,incoming_value,created_at,device_import_id`;
const DEVICE_IMPORT_COLUMNS =
  "id,operation_id,device,exported_at,stages_applied,texts_applied,approaches_applied,differences,ignored,unknown,imported_by,imported_at";

/**
 * Blocco dell'assistente nella scheda: niente lease né tentativi del lavoro, niente motivo
 * dell'interruttore, niente impronta né operation_id della bozza. Dei messaggi solo modalità,
 * esito, oggetto e date: mai indirizzo, testo, MIME, impronta, codici SMTP o lease.
 */
const ASSISTANT_SWITCH_COLUMNS = "partner_id,active,send_priority,version";
const ASSISTANT_MESSAGE_COLUMNS = "partner_id,mode,send_status,subject,sent_at,created_at";
const ASSISTANT_JOB_COLUMNS =
  "partner_id,status,step,reason,write_on,research_note_id,choice_note_id,draft_id,updated_at";
const ASSISTANT_NOTE_COLUMNS = "id,partner_id,kind,content,sources,created_at";
const ASSISTANT_DRAFT_COLUMNS =
  "id,partner_id,contact_id,subject,body,signature,rules_version,created_at";
/** Cronologia delle regole, senza il testo: il testo si legge solo per quella in vigore. */
const ASSISTANT_RULES_COLUMNS = "id,version,created_by,created_at";

/** Ultime attività e revisioni lette nel dettaglio (spec 02 §6). */
export const PARTNER_DETAIL_ACTIVITY_LIMIT = 100;
export const PARTNER_DETAIL_REVISION_LIMIT = 10;
export const PARTNER_IMPORT_HISTORY_LIMIT = 10;

type Filter = ["eq", string, unknown] | ["is", string, null] | ["in", string, readonly string[]];
type Result = { data: unknown; error: unknown; count?: number | null };

class ReadFailure extends Error {}
const ensure = (condition: unknown): void => {
  if (!condition) throw new ReadFailure();
};
const rowsOf = (result: Result): unknown[] => {
  ensure(!result.error && Array.isArray(result.data));
  return result.data as unknown[];
};
/** Lista con limite: il conteggio esatto dice se sono arrivate tutte le righe attese. */
const limited = (result: Result, limit: number): { rows: unknown[]; count: number } => {
  const rows = rowsOf(result);
  const count = result.count;
  ensure(
    typeof count === "number" &&
      Number.isSafeInteger(count) &&
      count >= 0 &&
      rows.length === Math.min(limit, count),
  );
  return { rows, count: count as number };
};

function reader(supabase: SupabaseClient) {
  return (table: string, columns: string, filters: Filter[] = [], idColumn = "id") =>
    readTeamPages((after, limit) => {
      let query = supabase
        .from(table)
        .select(columns, { count: "exact" })
        .order(idColumn)
        .limit(limit);
      for (const [operator, column, value] of filters)
        query =
          operator === "eq"
            ? query.eq(column, value)
            : operator === "is"
              ? query.is(column, null)
              : query.in(column, value as string[]);
      if (after !== null) query = query.gt(idColumn, after);
      return query;
    }, idColumn);
}

async function guarded<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch {
    throw new PartnerUnavailableError();
  }
}

function readMembers(supabase: SupabaseClient) {
  const read = reader(supabase);
  return Promise.all([
    read("profiles", "user_id,display_name", [], "user_id"),
    read("memberships", "user_id,active", [["eq", "active", true]], "user_id"),
  ]);
}

/**
 * Tutto ciò che serve alla lista di /partner: contatti (colonne di sintesi), recapiti non
 * cancellati, indice delle varianti, differenze aperte, blocchi attivi, membri, ultimo import.
 */
export async function loadPartnerWorkspace(supabase: SupabaseClient): Promise<PartnerWorkspace> {
  return guarded(async () => {
    const read = reader(supabase);
    const [partners, contacts, variants, differences, blocks, [profiles, memberships], imports] =
      await Promise.all([
        read("partners", PARTNER_SUMMARY_COLUMNS),
        read("partner_contacts", PARTNER_CONTACT_LINK_COLUMNS, [["is", "erased_at", null]]),
        read("partner_message_variants", PARTNER_VARIANT_SUMMARY_COLUMNS),
        read("partner_import_differences", PARTNER_OPEN_DIFFERENCE_COLUMNS, [
          ["eq", "status", "open"],
        ]),
        read("partner_do_not_contact", PARTNER_BLOCK_COLUMNS, [["eq", "active", true]]),
        readMembers(supabase),
        supabase
          .from("partner_research_imports")
          .select(PARTNER_IMPORT_COLUMNS)
          .order("applied_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1),
      ]);
    const lastImport = rowsOf(imports);
    ensure(lastImport.length <= 1);
    return partnerWorkspaceFromRows({
      partners,
      contacts,
      variants,
      differences,
      blocks,
      profiles,
      memberships,
      lastImport: lastImport[0] ?? null,
    });
  });
}

/**
 * Dettaglio di un contatto per CO: testi della ricerca, recapiti anche rimossi, varianti con il
 * testo in uso e le ultime 10 revisioni, ultime 100 attività, differenze aperte con i valori,
 * blocchi che valgono per lui. `null` se il CO non esiste.
 */
export async function loadPartnerDetail(
  supabase: SupabaseClient,
  co: number,
): Promise<PartnerDetail | null> {
  if (!isPartnerCo(co)) return null;
  return guarded(async () => {
    const found = await supabase.from("partners").select(DETAIL_COLUMNS).eq("co", co).maybeSingle();
    ensure(!found.error);
    if (found.data === null) return null;
    const partnerId = (found.data as Record<string, unknown>).id;
    ensure(isPartnerId(partnerId));
    const read = reader(supabase);
    const [contacts, variants, differences, activityResult, ownBlocks, assistant] =
      await Promise.all([
        read("partner_contacts", CONTACT_COLUMNS, [["eq", "partner_id", partnerId]]),
        read("partner_message_variants", VARIANT_COLUMNS, [["eq", "partner_id", partnerId]]),
        read("partner_import_differences", DIFFERENCE_COLUMNS, [
          ["eq", "partner_id", partnerId],
          ["eq", "status", "open"],
        ]),
        supabase
          .from("partner_activities")
          .select(ACTIVITY_COLUMNS, { count: "exact" })
          .eq("partner_id", partnerId)
          .order("occurred_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(PARTNER_DETAIL_ACTIVITY_LIMIT),
        read("partner_do_not_contact", PARTNER_BLOCK_COLUMNS, [
          ["eq", "partner_id", partnerId],
          ["eq", "active", true],
        ]),
        // Catch proprio: un errore delle tabelle dell'assistente non oscura la scheda.
        readPartnerAssistant(supabase, partnerId as string).catch(() => null),
      ]);
    const activities = limited(activityResult, PARTNER_DETAIL_ACTIVITY_LIMIT);
    const field = (row: unknown, key: string) => (row as Record<string, unknown>)[key];
    const ids = (rows: unknown[], key: string) => [
      ...new Set(rows.map((row) => field(row, key)).filter(isPartnerId)),
    ];
    const domains = partnerDomainsOf(contacts);
    const operationIds = ids(
      activities.rows.filter((row) => field(row, "origin") === "file"),
      "operation_id",
    );
    const importIds = ids(differences, "device_import_id");
    const [domainBlocks, revisions, byOperation, byId] = await Promise.all([
      domains.length
        ? read("partner_do_not_contact", PARTNER_BLOCK_COLUMNS, [
            ["eq", "active", true],
            ["in", "domain", domains],
          ])
        : Promise.resolve([]),
      Promise.all(
        variants.map(async (variant) => {
          const variantId = field(variant, "id");
          ensure(isPartnerId(variantId));
          const { rows, count } = limited(
            await supabase
              .from("partner_message_revisions")
              .select(REVISION_COLUMNS, { count: "exact" })
              .eq("variant_id", variantId)
              .order("revision_no", { ascending: false })
              .limit(PARTNER_DETAIL_REVISION_LIMIT),
            PARTNER_DETAIL_REVISION_LIMIT,
          );
          return { variantId: variantId as string, rows, count };
        }),
      ),
      operationIds.length
        ? read("partner_device_imports", DEVICE_IMPORT_COLUMNS, [
            ["in", "operation_id", operationIds],
          ])
        : Promise.resolve([]),
      importIds.length
        ? read("partner_device_imports", DEVICE_IMPORT_COLUMNS, [["in", "id", importIds]])
        : Promise.resolve([]),
    ]);
    // La revisione in uso è di solito l'ultima; se è più vecchia delle ultime 10 si legge a parte.
    const missing = variants
      .map((variant) => field(variant, "current_revision_id"))
      .filter(
        (current): current is string =>
          isPartnerId(current) &&
          !revisions.some((set) => set.rows.some((row) => field(row, "id") === current)),
      );
    const currentRevisions = missing.length
      ? await read("partner_message_revisions", REVISION_COLUMNS, [["in", "id", missing]])
      : [];
    const deviceImports = new Map<unknown, unknown>();
    for (const row of [...byOperation, ...byId]) deviceImports.set(field(row, "id"), row);
    const blocks = new Map<unknown, unknown>();
    for (const row of [...ownBlocks, ...domainBlocks]) blocks.set(field(row, "id"), row);
    return partnerDetailFromRows(co, {
      partner: found.data,
      contacts,
      variants,
      revisions,
      currentRevisions,
      activities: activities.rows,
      activityCount: activities.count,
      differences,
      blocks: [...blocks.values()],
      deviceImports: [...deviceImports.values()],
      assistant,
    });
  });
}

/**
 * Righe dell'assistente per la scheda: interruttore e lavoro del contatto, le ultime prime email
 * vere con un esito, poi solo le note e la bozza citate dal lavoro. Senza le tabelle (migrazioni
 * non applicate) PARTNER_ASSISTANT_INACTIVE. Lancia se una lettura non riesce, anche quella dei
 * messaggi; chi chiama ne fa `null`.
 */
async function readPartnerAssistant(
  supabase: SupabaseClient,
  partnerId: string,
): Promise<PartnerAssistantRows | PartnerAssistantInactive> {
  const [toggle, job, messages] = await Promise.all([
    supabase
      .from("partner_assistant_contacts")
      .select(ASSISTANT_SWITCH_COLUMNS)
      .eq("partner_id", partnerId)
      .maybeSingle(),
    supabase
      .from("partner_assistant_jobs")
      .select(ASSISTANT_JOB_COLUMNS)
      .eq("partner_id", partnerId)
      .maybeSingle(),
    supabase
      .from("partner_assistant_messages")
      .select(ASSISTANT_MESSAGE_COLUMNS)
      .eq("partner_id", partnerId)
      .eq("mode", "invio")
      .in("send_status", [...PARTNER_ASSISTANT_SEND_OUTCOMES])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PARTNER_ASSISTANT_SENDS_LIMIT),
  ]);
  if (isPartnerAssistantMissing(toggle.error) || isPartnerAssistantMissing(job.error))
    return PARTNER_ASSISTANT_INACTIVE;
  ensure(!toggle.error && !job.error);
  // La tabella dei messaggi nasce con la consegna 2a: anche se manca, è un errore del blocco.
  const sends = rowsOf(messages);
  const field = (key: string) =>
    job.data === null ? null : (job.data as Record<string, unknown>)[key];
  const noteIds = [field("research_note_id"), field("choice_note_id")].filter(isPartnerId);
  const draftId = field("draft_id");
  const [notes, draft] = await Promise.all([
    noteIds.length
      ? supabase
          .from("partner_assistant_notes")
          .select(ASSISTANT_NOTE_COLUMNS)
          .eq("partner_id", partnerId)
          .in("id", noteIds)
          .then(rowsOf)
      : Promise.resolve([]),
    isPartnerId(draftId)
      ? supabase
          .from("partner_assistant_drafts")
          .select(ASSISTANT_DRAFT_COLUMNS)
          .eq("partner_id", partnerId)
          .eq("id", draftId)
          .maybeSingle()
          .then((result) => {
            ensure(!result.error);
            return result.data as unknown;
          })
      : Promise.resolve(null),
  ]);
  return { switch: toggle.data, job: job.data, notes, draft, messages: sends };
}

/**
 * Striscia di /partner e pagina /partner/assistente: lo stato da read_partner_assistant_status.
 * Senza la funzione (migrazioni non applicate) PARTNER_ASSISTANT_INACTIVE, non un errore.
 */
export async function loadPartnerAssistantStatus(
  supabase: SupabaseClient,
): Promise<PartnerAssistantStatus | PartnerAssistantInactive> {
  return guarded(async () => {
    const { data, error } = await supabase.rpc("read_partner_assistant_status");
    if (isPartnerAssistantMissing(error)) return PARTNER_ASSISTANT_INACTIVE;
    ensure(!error);
    return partnerAssistantStatusFrom(data);
  });
}

/**
 * /partner/assistente: lo stato dell'invio da read_partner_assistant_send (consegna 2a). Ogni
 * errore, anche la funzione che non c'è ancora, e ogni risposta non valida: Partner non disponibile.
 */
export async function loadPartnerAssistantSend(
  supabase: SupabaseClient,
): Promise<PartnerAssistantSendStatus> {
  return guarded(async () => {
    const { data, error } = await supabase.rpc("read_partner_assistant_send");
    ensure(!error);
    return partnerAssistantSendFrom(data);
  });
}

/** /partner/assistente: le regole in vigore con il testo e la cronologia con gli autori. */
export async function loadPartnerAssistantRules(
  supabase: SupabaseClient,
): Promise<PartnerAssistantRulesView> {
  return guarded(async () => {
    const read = reader(supabase);
    const history = await read("partner_assistant_rules", ASSISTANT_RULES_COLUMNS);
    const field = (row: unknown, key: string) => (row as Record<string, unknown>)[key];
    const versions = history.map((row) => field(row, "version"));
    ensure(versions.length > 0 && versions.every(Number.isSafeInteger));
    // Le regole sono append-only: la versione più alta letta qui ha sempre il suo testo.
    const latest = Math.max(...(versions as number[]));
    const authors = [...new Set(history.map((row) => field(row, "created_by")))].filter(
      isPartnerId,
    );
    const [current, profiles] = await Promise.all([
      supabase
        .from("partner_assistant_rules")
        .select(`${ASSISTANT_RULES_COLUMNS},body`)
        .eq("version", latest)
        .maybeSingle(),
      authors.length
        ? read("profiles", "user_id,display_name", [["in", "user_id", authors]], "user_id")
        : Promise.resolve([]),
    ]);
    ensure(!current.error && current.data !== null);
    return partnerAssistantRulesFrom({ current: current.data, history, profiles });
  });
}

/**
 * /partner/assistente: l'id delle schede passate a Tommi, dal CO. Lo stato dell'assistente dà
 * solo CO e nome, mentre «Ridai all'assistente» manda l'id. Un CO senza scheda manca anche qui.
 */
export async function loadPartnerIdsByCo(
  supabase: SupabaseClient,
  cos: readonly number[],
): Promise<Record<number, string>> {
  if (cos.length === 0) return {};
  return guarded(async () => {
    const rows = rowsOf(
      await supabase
        .from("partners")
        .select("id,co")
        .in("co", [...cos]),
    );
    const ids: Record<number, string> = {};
    for (const row of rows) {
      const { id, co } = row as Record<string, unknown>;
      ensure(isPartnerId(id) && isPartnerCo(co) && cos.includes(co) && !Object.hasOwn(ids, co));
      ids[co as number] = id as string;
    }
    return ids;
  });
}

/** /partner/dati: ultimi import della ricerca, file importati, differenze aperte, membri. */
export async function loadPartnerData(supabase: SupabaseClient): Promise<PartnerDataSnapshot> {
  return guarded(async () => {
    const read = reader(supabase);
    const [importResult, deviceImports, differenceResult, [profiles, memberships]] =
      await Promise.all([
        supabase
          .from("partner_research_imports")
          .select(PARTNER_IMPORT_COLUMNS, { count: "exact" })
          .order("applied_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(PARTNER_IMPORT_HISTORY_LIMIT),
        read("partner_device_imports", DEVICE_IMPORT_COLUMNS),
        supabase
          .from("partner_import_differences")
          .select("id", { count: "exact", head: true })
          .eq("status", "open"),
        readMembers(supabase),
      ]);
    ensure(!differenceResult.error && typeof differenceResult.count === "number");
    return partnerDataFromRows({
      imports: limited(importResult, PARTNER_IMPORT_HISTORY_LIMIT).rows,
      deviceImports,
      openDifferences: differenceResult.count as number,
      profiles,
      memberships,
    });
  });
}

/** /partner/regole: CONTESTO.md dell'ultimo import; `null` se la ricerca non è importata. */
export async function loadPartnerRules(supabase: SupabaseClient): Promise<PartnerRules | null> {
  return guarded(async () => {
    const rows = rowsOf(
      await supabase
        .from("partner_research_imports")
        .select(`${PARTNER_IMPORT_COLUMNS},context_md`)
        .order("applied_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1),
    );
    ensure(rows.length <= 1);
    return partnerRulesFromRow(rows[0] ?? null);
  });
}

const rejected = (code: string, message: string): PartnerCommandResult => ({
  status: "rejected",
  code,
  message,
  refresh: false,
});
const uncertain = (): PartnerCommandResult => ({
  status: "uncertain",
  message: PARTNER_UNCERTAIN_MESSAGE,
});
const UNAVAILABLE = "Verifica dell’accesso non disponibile. Nessun salvataggio eseguito.";

/**
 * Esegue un comando del team: prima la membership (anche con input non valido), poi il
 * controllo del comando, poi la RPC con il suo operation_id. L'autore lo decide il database.
 * In una ripetizione («Verifica») ciò che non si può verificare resta «non confermato».
 */
export async function executePartnerCommand(
  supabase: SupabaseClient,
  value: unknown,
  now: Date = new Date(),
  options: { kind?: PartnerCommandKind } = {},
): Promise<PartnerCommandResult> {
  const retry =
    value !== null && typeof value === "object" && (value as { retry?: unknown }).retry === true;
  let access: Awaited<ReturnType<typeof verifiedMember>>;
  try {
    access = await verifiedMember(supabase);
  } catch {
    return retry ? uncertain() : rejected("unavailable", UNAVAILABLE);
  }
  if (access.status === "unavailable")
    return retry ? uncertain() : rejected("unavailable", UNAVAILABLE);
  if (access.status !== "member")
    return retry
      ? uncertain()
      : rejected("partner_access_required", PARTNER_ERROR_MESSAGES.partner_access_required.message);
  // Ogni Server Action accetta solo il suo comando: un altro tipo vale come payload non valido.
  const parsed = parsePartnerCommand(value, now);
  const command = parsed && (!options.kind || parsed.kind === options.kind) ? parsed : null;
  if (!command)
    return retry
      ? uncertain()
      : rejected("invalid_partner_payload", PARTNER_ERROR_MESSAGES.invalid_partner_payload.message);
  try {
    const { data, error } = await supabase.rpc(command.kind, {
      p_operation_id: command.operationId,
      p_payload: command.payload,
    });
    if (error) return partnerCommandRejection(error, command.retry, command.kind) ?? uncertain();
    const outcome = partnerCommandOutcome(command, data);
    if (!outcome) return uncertain();
    return command.kind === "record_partner_activity" && command.payload.kind === "inviato"
      ? withFollowUpDate(supabase, outcome, access.member.userId)
      : outcome;
  } catch {
    return uncertain();
  }
}

/**
 * «Segna inviato» e «Segna sollecito inviato»: la conferma dice quando scade il sollecito che
 * il database ha appena creato. Se la lettura non riesce, l'invio resta confermato senza data.
 */
async function withFollowUpDate(
  supabase: SupabaseClient,
  outcome: PartnerCommandSuccess,
  userId: string,
): Promise<PartnerCommandSuccess> {
  if (!outcome.activityId) return outcome;
  try {
    const followUp = await readSentFollowUp(supabase, outcome.activityId);
    return followUp
      ? { ...outcome, message: `${outcome.message} ${followUpConfirmation(followUp, userId)}` }
      : outcome;
  } catch {
    return outcome;
  }
}

export type PartnerPreviewResult =
  | { status: "ready"; preview: PartnerDevicePreview }
  | { status: "rejected"; code: string; message: string };

/** «Controlla il file»: il piano dell'import, senza scritture. */
export async function previewPartnerDeviceFile(
  supabase: SupabaseClient,
  payload: unknown,
  now: Date = new Date(),
): Promise<PartnerPreviewResult> {
  const unavailable = {
    status: "rejected" as const,
    code: "unavailable",
    message: "Controllo del file non disponibile. Riprova tra poco: niente è stato importato.",
  };
  try {
    const access = await verifiedMember(supabase);
    if (access.status === "unavailable") return unavailable;
    if (access.status !== "member")
      return {
        status: "rejected",
        code: "partner_access_required",
        message: PARTNER_ERROR_MESSAGES.partner_access_required.message,
      };
    const checked = validatePartnerDevicePayload(payload, now);
    if (!checked)
      return {
        status: "rejected",
        code: "invalid_partner_payload",
        message: PARTNER_ERROR_MESSAGES.invalid_partner_payload.message,
      };
    const { data, error } = await supabase.rpc("preview_partner_device_file", {
      p_payload: checked,
    });
    if (error) {
      const rejection = partnerCommandRejection(error, false);
      return rejection
        ? { status: "rejected", code: rejection.code, message: rejection.message }
        : unavailable;
    }
    const preview = parsePartnerDevicePreview(data);
    return preview ? { status: "ready", preview } : unavailable;
  } catch {
    return unavailable;
  }
}
