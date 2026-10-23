import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSensitiveAreaEligible } from "../auth/model";
import { verifiedMember } from "../auth/server";
import { verifiedSensitiveAccess } from "../auth/sensitive-access";
import { readCompletePages } from "../finance/read";
import {
  financeRevisionDeletable,
  financeRevisionKey,
  parseFinanceRevisionCommand,
  revisionFromDatabase,
  revisionOriginalFromDatabase,
  revisionReceiptFromDatabase,
  revisionUuid,
  FINANCE_REVISION_SOURCES,
  type FinanceRevisionHistory,
  type FinanceRevisionRecord,
  type FinanceRevisionRef,
  type FinanceRevisionResult,
} from "./model";

export async function financeRevisionAccess(supabase: SupabaseClient) {
  const access = await verifiedMember(supabase);
  if (access.status !== "member" || !isSensitiveAreaEligible(access.member, "finance"))
    return false;
  return verifiedSensitiveAccess(supabase, access.member, "finance");
}
const selection =
  "id,operation_id,source_kind,source_id,version,previous_version,action,restored_from_version,value_snapshot,deleted,reason,created_by,created_at";
const unavailable = () =>
  new Error("Le revisioni Finance non sono disponibili. Ricarica la pagina.");
const validRef = (ref: FinanceRevisionRef) =>
  revisionUuid(ref.sourceId) &&
  (FINANCE_REVISION_SOURCES as readonly string[]).includes(ref.sourceKind);

export async function loadFinanceRevisions(
  supabase: SupabaseClient,
): Promise<FinanceRevisionRecord[]> {
  if (!(await financeRevisionAccess(supabase))) throw unavailable();
  const rows = await readCompletePages((from, to) =>
    supabase
      .from("finance_revision_current")
      .select(selection, { count: "exact" })
      .order("source_kind")
      .order("source_id")
      .range(from, to),
  );
  const revisions = rows.map(revisionFromDatabase);
  if (revisions.some((row) => !row)) throw unavailable();
  const result = revisions as FinanceRevisionRecord[];
  if (new Set(result.map(financeRevisionKey)).size !== result.length) throw unavailable();
  return result;
}

export async function loadFinanceRevisionHistory(
  supabase: SupabaseClient,
  ref: FinanceRevisionRef,
): Promise<FinanceRevisionHistory> {
  if (!validRef(ref) || !(await financeRevisionAccess(supabase))) throw unavailable();
  const [source, rows] = await Promise.all([
    supabase.rpc("read_finance_revision_source", {
      p_source_kind: ref.sourceKind,
      p_source_id: ref.sourceId,
    }),
    readCompletePages((from, to) =>
      supabase
        .from("finance_movement_revisions")
        .select(selection, { count: "exact" })
        .eq("source_kind", ref.sourceKind)
        .eq("source_id", ref.sourceId)
        .order("version")
        .range(from, to),
    ),
  ]);
  const original = source.error ? null : revisionOriginalFromDatabase(source.data);
  const revisions = rows.map(revisionFromDatabase);
  if (
    !original ||
    financeRevisionKey(original) !== financeRevisionKey(ref) ||
    revisions.some(
      (row, index) =>
        !row || financeRevisionKey(row) !== financeRevisionKey(ref) || row.version !== index + 1,
    )
  )
    throw unavailable();
  return { original, revisions: revisions as FinanceRevisionRecord[] };
}

const messages: Record<string, string> = {
  finance_access_required: "Verifica il tuo accesso a Finance prima di modificare il movimento.",
  invalid_finance_revision: "Controlla i campi, la data e la motivazione della correzione.",
  invalid_finance_source:
    "La fonte non è correggibile con questo comando. Riapri il movimento originale.",
  finance_source_not_found: "Il movimento originale non è disponibile. Ricarica il registro.",
  finance_revision_conflict:
    "Il movimento è stato modificato da un’altra persona. Ricaricalo prima di applicare la tua correzione.",
  finance_movement_deleted:
    "Il movimento è eliminato. Ripristinalo dallo storico prima di modificarlo.",
  finance_restore_not_found: "La versione da ripristinare non è disponibile. Ricarica lo storico.",
  idempotency_conflict:
    "Questo tentativo corrisponde a dati diversi. Conserva l’invio e verifica lo storico.",
  effective_payment_limit:
    "La correzione supera il limite dei valori di un ordine. Verifica importo e segno.",
  finance_movement_delete_not_allowed:
    "Incassi delle vendite e rimborsi Shopify non si eliminano da Finance: qui puoi correggerli. Una vendita sbagliata si annulla in Vendite, con «Annulla registrazione» o «Registra reso».",
  sale_registration_cancelled:
    "La vendita è annullata in Vendite: i suoi incassi non cambiano più da Finance.",
};
export async function executeFinanceRevision(
  supabase: SupabaseClient,
  value: unknown,
): Promise<FinanceRevisionResult> {
  const retry =
    value !== null && typeof value === "object" && "retry" in value && value.retry === true;
  const uncertain = (): FinanceRevisionResult => ({
    status: "uncertain",
    message:
      "L’esito non è confermato. Conserva e verifica lo stesso tentativo senza crearne uno nuovo.",
  });
  const command = parseFinanceRevisionCommand(value);
  if (!command)
    return retry
      ? uncertain()
      : {
          status: "rejected",
          code: "invalid_finance_revision",
          message: messages.invalid_finance_revision,
        };
  // Same rule as the database: never send a deletion it would refuse. A frozen
  // retry still goes through, so an earlier recorded outcome can be recovered.
  if (
    !retry &&
    command.payload.action === "delete" &&
    !financeRevisionDeletable(command.payload.source_kind)
  )
    return {
      status: "rejected",
      code: "finance_movement_delete_not_allowed",
      message: messages.finance_movement_delete_not_allowed,
    };
  let submitted = false;
  try {
    if (!(await financeRevisionAccess(supabase)))
      return retry
        ? uncertain()
        : {
            status: "rejected",
            code: "finance_access_required",
            message: messages.finance_access_required,
          };
    submitted = true;
    const result = await supabase.rpc("revise_finance_movement", {
      p_operation_id: command.operationId,
      p_payload: command.payload,
    });
    if (result.error) {
      const code = result.error.message;
      if (retry && ["finance_access_required", "invalid_finance_revision"].includes(code))
        return uncertain();
      if (["22023", "42501"].includes(result.error.code) && messages[code])
        return { status: "rejected", code, message: messages[code] };
      return uncertain();
    }
    const receipt = revisionReceiptFromDatabase(result.data);
    if (
      !receipt ||
      receipt.operationId !== command.operationId ||
      receipt.sourceKind !== command.payload.source_kind ||
      receipt.sourceId !== command.payload.source_id ||
      receipt.version !== command.payload.expected_version + 1
    )
      return uncertain();
    return {
      status: "success",
      receipt,
      message: receipt.replayed
        ? "Correzione già registrata recuperata, senza duplicazioni."
        : command.payload.action === "delete"
          ? "Movimento eliminato dalla vista attiva. Fonte e storico sono conservati."
          : command.payload.action === "restore"
            ? "Versione ripristinata. Lo storico delle correzioni è conservato."
            : "Correzione salvata. La fonte originale è conservata.",
    };
  } catch {
    return submitted || retry
      ? uncertain()
      : {
          status: "rejected",
          code: "unavailable",
          message: "Verifica dell’accesso non disponibile. Nessun nuovo invio eseguito.",
        };
  }
}
