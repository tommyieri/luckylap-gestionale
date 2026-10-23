import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { financeRevisionAccess } from "./server";
import { revisionUuid } from "./model";
export type EffectiveLegacySettlementSummary = {
  saleId: string;
  claimCents: bigint;
  netCents: bigint;
  amountDueCents: bigint;
  refundDueCents: bigint;
  corrected: boolean;
};
const money = (value: unknown, signed = false): bigint | null => {
  if (
    typeof value !== "string" ||
    !(signed ? /^-?(0|[1-9]\d{0,15})$/ : /^(0|[1-9]\d{0,15})$/).test(value)
  )
    return null;
  const cents = BigInt(value);
  return cents >= (signed ? -9_000_000_000_000_000n : 0n) && cents <= 9_000_000_000_000_000n
    ? cents
    : null;
};
export function legacySettlementSummaryFromDatabase(
  value: unknown,
): EffectiveLegacySettlementSummary | null {
  const row =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const claim = money(row?.claim_cents),
    net = money(row?.net_cents, true),
    due = money(row?.amount_due_cents),
    refund = money(row?.refund_due_cents);
  if (
    !row ||
    !revisionUuid(row.sale_id) ||
    claim === null ||
    net === null ||
    due === null ||
    refund === null ||
    typeof row.corrected !== "boolean" ||
    due !== (claim > net ? claim - net : 0n) ||
    refund !== (net > claim ? net - claim : 0n)
  )
    return null;
  return {
    saleId: row.sale_id,
    claimCents: claim,
    netCents: net,
    amountDueCents: due,
    refundDueCents: refund,
    corrected: row.corrected,
  };
}
/** Finance-only: net collections, never gross sale plus 60% claim as extra cash. */
export async function readEffectiveLegacySettlements(
  supabase: SupabaseClient,
  saleIds: string[],
): Promise<EffectiveLegacySettlementSummary[]> {
  if (
    !(await financeRevisionAccess(supabase)) ||
    saleIds.some((id) => !revisionUuid(id)) ||
    new Set(saleIds).size !== saleIds.length
  )
    throw new Error("Incassi effettivi del conto vendita non disponibili.");
  const output: EffectiveLegacySettlementSummary[] = [];
  for (let start = 0; start < saleIds.length; start += 200) {
    const ids = saleIds.slice(start, start + 200),
      response = await supabase.rpc("read_effective_consignment_settlements", { p_sale_ids: ids });
    if (response.error || !Array.isArray(response.data))
      throw new Error("Incassi effettivi del conto vendita non disponibili.");
    const rows = response.data.map(legacySettlementSummaryFromDatabase);
    if (
      rows.length !== ids.length ||
      rows.some((row) => !row || !ids.includes(row.saleId)) ||
      new Set(rows.map((row) => row?.saleId)).size !== ids.length
    )
      throw new Error("Incassi effettivi del conto vendita non disponibili.");
    output.push(...(rows as EffectiveLegacySettlementSummary[]));
  }
  return output;
}
