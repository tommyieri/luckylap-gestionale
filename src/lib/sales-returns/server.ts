import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedMember } from "../auth/server";
import { record, type CommandResult } from "../sales/model";
import {
  parseSaleReturnInput,
  parseSaleReturnPreviewInput,
  saleReturnPayload,
  saleReturnPreviewFromDatabase,
  type SaleReturnPreviewResult,
} from "./model";
const errors: Record<string, string> = {
  membership_required: "Il tuo account non è più abilitato al team.",
  sales_disabled: "Le operazioni sulle vendite sono momentaneamente disattivate.",
  invalid_payload: "Controlla quantità, conto, data e conferma del rimborso.",
  sale_not_found: "La vendita non è disponibile. Ricarica i dati.",
  external_order_managed_by_shopify:
    "Per questo ordine registra il reso e il rimborso su Shopify: il gestionale leggerà gli aggiornamenti.",
  sale_registration_cancelled: "La registrazione è già annullata: non puoi aggiungere un reso.",
  sale_return_version_conflict:
    "La vendita o i suoi incassi sono cambiati. Rileggi il riepilogo del reso.",
  return_quantity_exceeded: "La quantità supera i capi consegnati e non ancora resi.",
  return_refund_exceeds_payment:
    "Il rimborso supera l’incasso effettivo ancora disponibile per questa vendita.",
  return_packaging_exceeded:
    "Il packaging riutilizzabile supera quello realmente consumato e non ancora rientrato.",
  manual_sale_required: "Per questo ordine usa la procedura di reso del canale originale.",
  manual_sale_location_required: "Per questa vendita usa il modulo del conto vendita.",
  refund_account_required: "Indica il conto dal quale è stato effettuato il rimborso.",
  return_refund_limit:
    "L’importo supera il limite della registrazione Finance. Riduci la quantità del reso.",
  return_refund_required: "Seleziona almeno un capo con rimborso da registrare.",
  return_delivery_mismatch:
    "Le consegne della vendita non sono coerenti. Rileggi i dati prima del reso.",
  unknown_stock_balance:
    "La scorta fisica non è verificata. Verifica il magazzino prima di registrare il rientro.",
  unknown_packaging_stock:
    "La scorta del packaging non è verificata. Verifica le quantità prima di ricaricarle.",
  idempotency_conflict: "Il tentativo è associato a dati diversi. Verifica lo stesso invio.",
};
const unavailable =
  "Non è stato possibile verificare l’accesso o leggere il reso. Nessun invio eseguito.";
const uncertain = (): CommandResult => ({
  status: "uncertain",
  message: "L’esito del reso non è confermato. Conserva il tentativo e verifica lo stesso invio.",
});
export async function readSaleReturnPreview(
  supabase: SupabaseClient,
  value: unknown,
): Promise<SaleReturnPreviewResult> {
  const input = parseSaleReturnPreviewInput(value);
  if (!input)
    return { status: "rejected", code: "invalid_payload", message: errors.invalid_payload };
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member" || access.member.userId !== input.userId)
      return {
        status: "rejected",
        code: "membership_required",
        message: errors.membership_required,
      };
    const { data, error } = await supabase.rpc("preview_manual_sale_return", {
      p_payload: saleReturnPayload(input),
    });
    if (error)
      return {
        status: "rejected",
        code: errors[error.message] ? error.message : "unavailable",
        message: errors[error.message] ?? unavailable,
      };
    const preview = saleReturnPreviewFromDatabase(data);
    if (!preview || preview.orderId !== input.orderId)
      return { status: "rejected", code: "unavailable", message: unavailable };
    const selected = preview.lines.filter((l) => l.selectedQuantity > 0);
    if (
      selected.length !== input.lines.length ||
      input.lines.some(
        (l) =>
          !selected.some(
            (s) => s.orderLineId === l.orderLineId && s.selectedQuantity === l.quantity,
          ),
      ) ||
      preview.boxQuantity !== input.reusableBoxes ||
      preview.stickerQuantity !== input.reusableStickers
    )
      return { status: "rejected", code: "unavailable", message: unavailable };
    return { status: "ready", preview };
  } catch {
    return { status: "rejected", code: "unavailable", message: unavailable };
  }
}
export async function executeSaleReturn(
  supabase: SupabaseClient,
  value: unknown,
): Promise<CommandResult> {
  const retry = record(value)?.retry === true,
    input = parseSaleReturnInput(value);
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
    const { data, error } = await supabase.rpc("return_manual_sale_registration", {
      p_operation_id: input.operationId,
      p_payload: {
        ...saleReturnPayload(input),
        expected_version: input.expectedVersion,
        occurred_at: input.occurredAt,
        reason: input.reason,
        refund_completed_confirmed: true,
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
        ? "Reso già registrato: nessuna scorta o rimborso duplicato."
        : "Reso e rimborso registrati insieme. Magazzino e Finance sono aggiornati.",
    };
  } catch {
    return submitted || retry
      ? uncertain()
      : { status: "rejected", code: "unavailable", message: unavailable };
  }
}
