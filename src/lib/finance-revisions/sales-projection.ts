import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedMember } from "../auth/server";
import { revisionUuid } from "./model";
export type EffectiveSalesPaymentSummary = {
  orderId: string;
  sourceKind: "manual_declaration" | "shopify_canonical";
  sourcePaymentState: string;
  paymentState: "unpaid" | "partially_paid" | "paid" | "partially_refunded" | "refunded";
  amountDueCents: bigint | null;
  refundDueCents: bigint;
  corrected: boolean;
};
const states = ["unpaid", "partially_paid", "paid", "partially_refunded", "refunded"];
const cents = (value: unknown) =>
  typeof value === "string" &&
  /^(0|[1-9]\d{0,15})$/.test(value) &&
  BigInt(value) <= 9_000_000_000_000_000n
    ? BigInt(value)
    : null;
export function effectiveSalesPaymentFromDatabase(
  value: unknown,
): EffectiveSalesPaymentSummary | null {
  const row =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const due = cents(row?.amount_due_cents),
    refund = cents(row?.refund_due_cents);
  if (
    !row ||
    Object.keys(row).sort().join(",") !==
      [
        "order_id",
        "source_kind",
        "source_payment_state",
        "payment_state",
        "amount_due_cents",
        "refund_due_cents",
        "corrected",
      ]
        .sort()
        .join(",") ||
    !revisionUuid(row.order_id) ||
    !["manual_declaration", "shopify_canonical"].includes(String(row.source_kind)) ||
    !states.includes(String(row.source_payment_state)) ||
    !states.includes(String(row.payment_state)) ||
    (due === null &&
      !(
        row.source_kind === "shopify_canonical" &&
        row.corrected === false &&
        row.amount_due_cents === null
      )) ||
    refund === null ||
    typeof row.corrected !== "boolean"
  )
    return null;
  return {
    orderId: row.order_id,
    sourceKind: row.source_kind as EffectiveSalesPaymentSummary["sourceKind"],
    sourcePaymentState: row.source_payment_state as string,
    paymentState: row.payment_state as EffectiveSalesPaymentSummary["paymentState"],
    amountDueCents: due,
    refundDueCents: refund,
    corrected: row.corrected,
  };
}
/** Operational projection only: never returns account, reference or transaction payload. */
export async function readEffectiveSalesPayments(
  supabase: SupabaseClient,
  orderIds: string[],
): Promise<EffectiveSalesPaymentSummary[]> {
  const access = await verifiedMember(supabase);
  if (
    access.status !== "member" ||
    orderIds.some((id) => !revisionUuid(id)) ||
    new Set(orderIds).size !== orderIds.length
  )
    throw new Error("Stato effettivo degli incassi non disponibile.");
  const result: EffectiveSalesPaymentSummary[] = [];
  for (let index = 0; index < orderIds.length; index += 200) {
    const ids = orderIds.slice(index, index + 200);
    const response = await supabase.rpc("read_sales_effective_payments", { p_order_ids: ids });
    if (response.error || !Array.isArray(response.data))
      throw new Error("Stato effettivo degli incassi non disponibile.");
    const summaries = response.data.map(effectiveSalesPaymentFromDatabase);
    if (
      summaries.length !== ids.length ||
      summaries.some((row) => !row || !ids.includes(row.orderId)) ||
      new Set(summaries.map((row) => row?.orderId)).size !== ids.length
    )
      throw new Error("Stato effettivo degli incassi non disponibile.");
    result.push(...(summaries as EffectiveSalesPaymentSummary[]));
  }
  return result;
}
export function applyEffectiveSalesPayments<
  T extends { id: string; paymentState: string; refundDueCents: number },
>(orders: T[], summaries: EffectiveSalesPaymentSummary[]) {
  if (
    orders.length !== summaries.length ||
    new Set(summaries.map((row) => row.orderId)).size !== summaries.length
  )
    throw new Error("Proiezione degli incassi incompleta.");
  return orders.map((order) => {
    const summary = summaries.find((row) => row.orderId === order.id);
    if (!summary) throw new Error("Proiezione degli incassi incompleta.");
    const preserveCanonical = summary.sourceKind === "shopify_canonical" && !summary.corrected;
    return {
      ...order,
      paymentState: preserveCanonical ? order.paymentState : summary.paymentState,
      refundDueCents: preserveCanonical ? order.refundDueCents : Number(summary.refundDueCents),
      effectiveAmountDueCents:
        preserveCanonical || summary.amountDueCents === null
          ? null
          : Number(summary.amountDueCents),
      sourcePaymentState: summary.sourcePaymentState,
      paymentCorrected: summary.corrected,
    };
  });
}
