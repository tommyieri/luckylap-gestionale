import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSensitiveAreaEligible, type VerifiedMember } from "../auth/model";
import { verifiedMember } from "../auth/server";
import { verifiedSensitiveAccess } from "../auth/sensitive-access";
import { readConsignmentFinance } from "../consignment/finance";
import { CONSIGNMENT_FINANCE_ANCHOR } from "../consignment/links";
import { loadConsignmentToSettle } from "../consignment/shop-finance";

export type ConsignmentWorkRow = {
  id: string;
  shopName: string;
  period: string;
  href: string;
  amountCents: number;
  state: "da_fatturare" | "da_incassare" | "da_restituire";
};
export type ConsignmentTileData =
  | { status: "ok"; rows: ConsignmentWorkRow[]; count: number }
  | { status: "locked" }
  | { status: "denied" }
  | { status: "error" };

/** Never read monetary projections from a stale role or an expired Finance grant. */
export async function loadConsignmentTile(
  supabase: SupabaseClient,
  member: VerifiedMember,
): Promise<ConsignmentTileData> {
  if (!isSensitiveAreaEligible(member, "finance")) return { status: "denied" };
  try {
    const current = await verifiedMember(supabase);
    if (
      current.status !== "member" ||
      current.member.userId !== member.userId ||
      !isSensitiveAreaEligible(current.member, "finance")
    )
      return { status: "denied" };
    if (!(await verifiedSensitiveAccess(supabase, current.member, "finance")))
      return { status: "locked" };
    const [monthly, legacy] = await Promise.all([
      loadConsignmentToSettle(supabase, current.member),
      readConsignmentFinance(supabase, current.member),
    ]);
    if (monthly.status !== "ready" || legacy.status !== "ready") return { status: "error" };
    const rows: ConsignmentWorkRow[] = monthly.rows.map((row) => {
      const amountCents =
        row.state === "da_fatturare"
          ? row.toInvoiceCents
          : row.state === "da_incassare"
            ? row.toCollectCents
            : row.toReturnCents;
      if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0)
        throw new Error("Conto da regolare incompleto.");
      return {
        id: `${row.locationId}:${row.month}`,
        shopName: row.shopName,
        period: row.monthLabel,
        href: row.href,
        state: row.state,
        amountCents,
      };
    });
    for (const row of legacy.snapshot.rows) {
      if (row.remainingCents > 0 || row.overpaidCents > 0)
        rows.push({
          id: row.saleId,
          shopName: row.shopLabel,
          period: row.reference,
          href: `/finance#${CONSIGNMENT_FINANCE_ANCHOR}`,
          amountCents: row.overpaidCents > 0 ? row.overpaidCents : row.remainingCents,
          state: row.overpaidCents > 0 ? "da_restituire" : "da_incassare",
        });
    }
    return { status: "ok", rows: rows.slice(0, 8), count: rows.length };
  } catch (error) {
    unstable_rethrow(error);
    return { status: "error" };
  }
}
