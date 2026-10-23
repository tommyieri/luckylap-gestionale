import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedMember } from "../auth/server";
import { isUuid, record, type CommandResult } from "../sales/model";
import {
  parseSaleCancellationInput,
  saleCancellationPreviewFromDatabase,
  type SaleCancellationPreviewResult,
} from "./model";

const errors: Record<string, string> = {
  membership_required: "Il tuo account non è più abilitato al team.",
  sales_disabled: "Le operazioni sulle vendite sono momentaneamente disattivate.",
  invalid_payload: "Controlla motivo e conferma della registrazione da annullare.",
  sale_not_found: "La vendita non è disponibile. Ricarica i dati.",
  external_order_managed_by_shopify:
    "Questo ordine si gestisce su Shopify. Il gestionale ne leggerà gli aggiornamenti.",
  sale_cancellation_conflict: "La vendita è cambiata. Rileggi l’anteprima prima di confermare.",
  finance_revision_conflict: "Gli incassi collegati sono cambiati. Rileggi l’anteprima.",
  idempotency_conflict: "Il tentativo è associato a dati diversi. Verifica lo stesso invio.",
  sale_registration_cancelled: "Questa registrazione risulta già annullata.",
  sale_has_returns: "Per questa vendita è già registrato un reso. Consulta lo storico dei resi.",
};
const unavailable =
  "Non è stato possibile verificare l’accesso o leggere la vendita. Nessun invio eseguito.";
const uncertain = (): CommandResult => ({
  status: "uncertain",
  message: "L’esito non è confermato. Conserva il tentativo e verifica lo stesso invio.",
});
export async function readSaleCancellationPreview(
  supabase: SupabaseClient,
  value: unknown,
): Promise<SaleCancellationPreviewResult> {
  const input = record(value);
  if (!input || !isUuid(input.userId) || !isUuid(input.orderId) || Object.keys(input).length !== 2)
    return { status: "rejected", code: "invalid_payload", message: errors.invalid_payload };
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member" || access.member.userId !== input.userId)
      return {
        status: "rejected",
        code: "membership_required",
        message: errors.membership_required,
      };
    const { data, error } = await supabase.rpc("preview_manual_sale_cancellation", {
      p_order_id: input.orderId,
    });
    if (error)
      return {
        status: "rejected",
        code: errors[error.message] ? error.message : "unavailable",
        message: errors[error.message] ?? unavailable,
      };
    const preview = saleCancellationPreviewFromDatabase(data);
    if (!preview || preview.orderId !== input.orderId)
      return { status: "rejected", code: "unavailable", message: unavailable };
    return { status: "ready", preview };
  } catch {
    return { status: "rejected", code: "unavailable", message: unavailable };
  }
}
export async function executeSaleCancellation(
  supabase: SupabaseClient,
  value: unknown,
): Promise<CommandResult> {
  const retry = record(value)?.retry === true;
  const input = parseSaleCancellationInput(value);
  if (!input)
    return retry
      ? uncertain()
      : { status: "rejected", code: "invalid_payload", message: errors.invalid_payload };
  let submitted = false;
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member" || access.member.userId !== input.userId)
      return retry
        ? uncertain()
        : { status: "rejected", code: "membership_required", message: errors.membership_required };
    submitted = true;
    const { data, error } = await supabase.rpc("cancel_manual_sale_registration", {
      p_operation_id: input.operationId,
      p_payload: {
        schema_version: 1,
        order_id: input.orderId,
        expected_version: input.expectedVersion,
        reason: input.reason,
        confirm_stock: true,
      },
    });
    if (error) {
      if (retry && ["membership_required", "invalid_payload"].includes(error.message))
        return uncertain();
      if (errors[error.message] && ["22023", "42501", "23505"].includes(error.code))
        return { status: "rejected", code: error.message, message: errors[error.message] };
      return uncertain();
    }
    const result = record(data);
    if (
      !result ||
      result.operation_id !== input.operationId ||
      result.order_id !== input.orderId ||
      typeof result.replayed !== "boolean"
    )
      return uncertain();
    return {
      status: "success",
      orderId: input.orderId,
      replayed: result.replayed,
      message: result.replayed
        ? "Annullamento già registrato: nessuna scorta o voce duplicata."
        : "Registrazione annullata. Magazzino, packaging e Finance sono aggiornati.",
    };
  } catch {
    return submitted || retry
      ? uncertain()
      : { status: "rejected", code: "unavailable", message: unavailable };
  }
}
