import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerifiedMember } from "../auth/model";
import { verifiedMember } from "../auth/server";
import { verifiedSensitiveAccess } from "../auth/sensitive-access";
import { stockRecord as record, stockUuid as uuid } from "../stock/model";
import { consignmentDate, consignmentSplit, MAX_CENTS } from "./model";
import { consignmentPages } from "./read";
import {
  readEffectiveLegacySettlements,
  type EffectiveLegacySettlementSummary,
} from "../finance-revisions/consignment-projection";
export type ConsignmentFinanceRow = {
  saleId: string;
  occurredAt: string;
  shopId: string;
  shopLabel: string;
  sku: string;
  quantity: number;
  reference: string;
  grossCents: number;
  brandClaimCents: number;
  shopShareCents: number;
  settledCents: number;
  remainingCents: number;
  overpaidCents: number;
};
export type ConsignmentFinanceSnapshot = { rows: ConsignmentFinanceRow[]; loadedAt: string };
function fail(): never {
  throw Error("Lettura crediti conto vendita non completa.");
}
const int = (v: unknown, min = 0) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= MAX_CENTS ? v : fail();
const id = (v: unknown) => (uuid(v) ? v : fail()),
  str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : fail());
export function consignmentFinanceFromRows(
  sales: unknown[],
  settlements: unknown[],
  loadedAt = new Date().toISOString(),
  effective?: EffectiveLegacySettlementSummary[],
): ConsignmentFinanceSnapshot {
  const rows = sales.map((raw) => {
    const r = record(raw) ?? fail(),
      quantity = int(r.quantity, 1),
      web = int(r.web_price_cents),
      gross = int(r.gross_cents),
      brand = int(r.brand_claim_cents),
      share = int(r.shop_share_cents),
      split = consignmentSplit(web, quantity),
      shop = record(r.shop) ?? fail();
    if (
      !split ||
      split.grossCents !== gross ||
      split.brandClaimCents !== brand ||
      split.shopShareCents !== share ||
      !consignmentDate(r.occurred_at)
    )
      fail();
    return {
      saleId: id(r.id),
      occurredAt: r.occurred_at,
      shopId: id(r.location_id),
      shopLabel: str(shop.name),
      sku: str(r.sku_snapshot),
      quantity,
      reference: str(r.external_reference),
      grossCents: gross,
      brandClaimCents: brand,
      shopShareCents: share,
      settledCents: 0,
      remainingCents: brand,
      overpaidCents: 0,
    };
  });
  if (new Set(rows.map((r) => r.saleId)).size !== rows.length) fail();
  if (effective) {
    if (
      settlements.length ||
      effective.length !== rows.length ||
      new Set(effective.map((r) => r.saleId)).size !== rows.length
    )
      fail();
    for (const row of rows) {
      const summary = effective.find((s) => s.saleId === row.saleId) ?? fail();
      if (summary.claimCents !== BigInt(row.brandClaimCents)) fail();
      row.settledCents = Number(summary.netCents);
      row.remainingCents = Number(summary.amountDueCents);
      row.overpaidCents = Number(summary.refundDueCents);
    }
  }
  const seen = new Set<string>();
  for (const raw of settlements) {
    const r = record(raw) ?? fail(),
      key = id(r.id),
      sale = rows.find((s) => s.saleId === r.sale_id) ?? fail();
    if (seen.has(key)) fail();
    seen.add(key);
    const total = BigInt(sale.settledCents) + BigInt(int(r.amount_cents, 1));
    if (total > BigInt(sale.brandClaimCents)) fail();
    sale.settledCents = Number(total);
    sale.remainingCents = sale.brandClaimCents - sale.settledCents;
  }
  rows.sort(
    (a, b) =>
      Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.saleId.localeCompare(b.saleId),
  );
  return { rows, loadedAt };
}
/** Reverify caller and the Finance password gate before either private projection read. */
export async function readConsignmentFinance(supabase: SupabaseClient, member: VerifiedMember) {
  const current = await verifiedMember(supabase);
  if (current.status !== "member") return current;
  if (
    current.member.userId !== member.userId ||
    !(await verifiedSensitiveAccess(supabase, current.member, "finance"))
  )
    return { status: "denied" as const };
  const read = (table: string, columns: string) =>
    consignmentPages((after, limit) => {
      let q = supabase.from(table).select(columns, { count: "exact" }).order("id").limit(limit);
      if (after !== null) q = q.gt("id", after);
      return q;
    });
  const sales = await read(
    "consignment_sales",
    "id,occurred_at,location_id,sku_snapshot,quantity,external_reference,web_price_cents,gross_cents,brand_claim_cents,shop_share_cents,shop:stock_locations!consignment_sales_location_id_fkey(code,name)",
  );
  const ids = sales.map((raw) => id((record(raw) ?? fail()).id));
  const effective = await readEffectiveLegacySettlements(supabase, ids);
  return {
    status: "ready" as const,
    snapshot: consignmentFinanceFromRows(sales, [], new Date().toISOString(), effective),
  };
}
