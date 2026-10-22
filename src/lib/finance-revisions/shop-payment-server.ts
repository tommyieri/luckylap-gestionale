import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { financeRevisionAccess } from "./server";
import { revisionUuid } from "./model";
import { readCompletePages } from "../finance/read";
import { executeShopCommand } from "../consignment/shop-server";
import {
  parseShopCommand,
  paymentFinanceFromDatabase,
  PAYMENT_METHODS,
  type PaymentMethod,
  type ShopResult,
} from "../consignment/shop-model";
import { consignmentDate, MAX_CENTS } from "../consignment/model";
import type { ShopPaymentFinanceHistory, ShopPaymentFinanceVersion } from "./shop-payment-model";
const fail = (): never => {
  throw Error("Pagamento e storico Finance non disponibili. Ricarica il registro.");
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
const integer = (value: unknown, min = 0) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= MAX_CENTS
    ? value
    : fail();
const id = (value: unknown) => (revisionUuid(value) ? value.toLowerCase() : fail());
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length <= max ? value : fail();
const optionalText = (value: unknown, max: number) => (value === null ? null : text(value, max));
const date = (value: unknown) => (consignmentDate(value) ? value : fail());
function snapshot(raw: Record<string, unknown>) {
  const finance = paymentFinanceFromDatabase(raw) ?? fail();
  if (!PAYMENT_METHODS.includes(raw.method as PaymentMethod) || typeof raw.voided !== "boolean")
    return fail();
  return {
    amountCents: integer(raw.amount_cents),
    paidAt: date(raw.paid_at),
    method: raw.method as PaymentMethod,
    accountLabel: optionalText(raw.account_label, 120),
    reference: optionalText(raw.reference, 240),
    voided: raw.voided,
    ...finance,
  };
}
const instant = (value: string) => {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? "";
  return (
    BigInt(Date.parse(value)) * 1000n +
    BigInt(fraction.padEnd(6, "0").slice(3, 6) || "0")
  ).toString();
};
function canonical(version: ShopPaymentFinanceVersion) {
  return JSON.stringify({
    amountCents: version.amountCents,
    paidAt: instant(version.paidAt),
    method: version.method,
    accountLabel: version.accountLabel,
    reference: version.reference,
    voided: version.voided,
    direction: version.direction,
    category: version.category,
    description: version.description,
    pending: version.pending,
  });
}
export async function loadShopPaymentFinanceHistory(
  db: SupabaseClient,
  paymentId: string,
): Promise<ShopPaymentFinanceHistory> {
  if (!revisionUuid(paymentId) || !(await financeRevisionAccess(db))) return fail();
  const [source, rows] = await Promise.all([
    db
      .from("consignment_report_payments")
      .select(
        "id,report_id,location_id,amount_cents,paid_at,method,account_label,reference,voided,version,finance_direction,finance_category,finance_description,finance_pending,updated_by,updated_at",
      )
      .eq("id", paymentId)
      .maybeSingle(),
    readCompletePages((from, to) =>
      db
        .from("consignment_payment_revisions")
        .select("id,payment_id,location_id,version,reason,snapshot,created_by,created_at", {
          count: "exact",
        })
        .eq("payment_id", paymentId)
        .order("version")
        .range(from, to),
    ),
  ]);
  if (source.error || !source.data) return fail();
  const row = object(source.data),
    reportId = id(row.report_id),
    locationId = id(row.location_id),
    version = integer(row.version, 1);
  if (id(row.id) !== paymentId.toLowerCase()) return fail();
  const revisions = rows.map((raw, index): ShopPaymentFinanceVersion => {
    const r = object(raw),
      s = object(r.snapshot),
      revision = integer(r.version, 1);
    if (
      id(r.payment_id) !== paymentId.toLowerCase() ||
      id(r.location_id) !== locationId ||
      id(s.report_id) !== reportId ||
      revision !== index + 1 ||
      !revisionUuid(r.id) ||
      (revision === 1) !== (r.reason === null)
    )
      return fail();
    return {
      version: revision,
      ...snapshot(s),
      reason: optionalText(r.reason, 500),
      createdBy: id(r.created_by),
      createdAt: date(r.created_at),
    };
  });
  const current: ShopPaymentFinanceVersion = {
    version,
    ...snapshot(row),
    reason: revisions.at(-1)?.reason ?? null,
    createdBy: id(row.updated_by),
    createdAt: date(row.updated_at),
  };
  if (
    revisions.length !== version ||
    !revisions.at(-1) ||
    canonical(current) !== canonical(revisions.at(-1)!)
  )
    return fail();
  return { paymentId: paymentId.toLowerCase(), reportId, locationId, version, current, revisions };
}
/** Delegates the exact frozen payload to P3: fresh Finance gate, one CAS/receipt. */
export async function executeShopPaymentFinanceCommand(
  db: SupabaseClient,
  value: unknown,
): Promise<ShopResult> {
  const command = parseShopCommand(value);
  if (
    !command ||
    command.kind !== "update_consignment_payment" ||
    (!command.payload.finance && command.retry !== true)
  ) {
    const retry =
      value !== null && typeof value === "object" && "retry" in value && value.retry === true;
    return retry
      ? {
          status: "uncertain",
          message: "Esito non confermato. Conserva e verifica lo stesso invio.",
        }
      : {
          status: "rejected",
          code: "invalid_payload",
          message: "Controlla i campi della correzione e la motivazione.",
        };
  }
  return executeShopCommand(db, command);
}
