import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerifiedMember } from "../auth/model";
import { verifiedMember } from "../auth/server";
import { verifiedSensitiveAccess } from "../auth/sensitive-access";
import { financeAccountLabel, type DashboardShopPayment } from "../finance/dashboard";
import { stockRecord as record, stockUuid as uuid } from "../stock/model";
import { consignmentDate, MAX_CENTS } from "./model";
import { consignmentPages } from "./read";
import {
  PAYMENT_METHODS,
  monthLabel,
  paymentStateFor,
  reportStatusLabel,
  type PaymentMethod,
  type PaymentState,
} from "./shop-model";
import { reportHeadFrom, shopLocationsFrom, SHOP_TYPE } from "./shop-read";
import { consignmentShopHref } from "./links";
import { localReportDate } from "../finance/model";
import { withCurrentShopPaymentStates } from "../finance-revisions/shop-payment-states";
import {
  paymentFinanceFromDatabase,
  postedShopPaymentCents,
  type PaymentFinanceMetadata,
} from "./shop-model";

/*
 * Il conto vendita in Finance (decisioni 12 e 13). Il resoconto è un credito:
 * importo da fatturare e da incassare, mai nei saldi. Nei saldi entra solo il
 * denaro ricevuto, cioè ogni pagamento non annullato, una volta, sul suo conto.
 */

function fail(): never {
  throw Error("Lettura del conto vendita in Finance non completa.");
}
const int = (v: unknown, min = 0) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= MAX_CENTS ? v : fail();
const id = (v: unknown) => (uuid(v) ? v.toLowerCase() : fail());
const optionalText = (v: unknown) =>
  v === null ? null : typeof v === "string" && v.length > 0 ? v : fail();

export type MonthlyFinanceRow = {
  reportId: string;
  locationId: string;
  code: string;
  shopName: string;
  month: string;
  monthLabel: string;
  pieces: number;
  /** Incasso del negozio: credito, non denaro ricevuto. */
  grossCents: number;
  shopCents: number;
  /** Da fatturare al negozio. */
  brandCents: number;
  invoice: { number: string; date: string } | null;
  paidCents: number;
  remainingCents: number;
  overpaidCents: number;
  paymentState: PaymentState;
  status: string;
  href: string;
};
export type MonthlyFinance = {
  rows: MonthlyFinanceRow[];
  /** «Da incassare»: somma dei residui. */
  toCollectCents: number;
  loadedAt: string;
};
/** Pagamento del negozio come movimento Finance: sorgente `shop_payment`, id `shop-payment:<id>`. */
export type { DashboardShopPayment };
type Payment = {
  id: string;
  reportId: string;
  locationId: string;
  amountCents: number;
  paidAt: string;
  method: PaymentMethod;
  accountLabel: string | null;
  reference: string | null;
  voided: boolean;
  finance: PaymentFinanceMetadata;
  extended: boolean;
};

function parseMonthly(
  reportRows: unknown[],
  paymentRows: unknown[],
  locationRows: unknown[],
  reportDate = localReportDate(new Date()) ?? fail(),
) {
  const locations = shopLocationsFrom(locationRows),
    reports = reportRows.map(reportHeadFrom);
  if (new Set(reports.map((r) => r.id)).size !== reports.length) fail();
  const shops = new Map(
    reports.map((r) => {
      const shop = locations.find((l) => l.id === r.locationId) ?? fail();
      if (shop.type !== SHOP_TYPE) fail();
      return [r.locationId, shop] as const;
    }),
  );
  const payments = paymentRows.map((raw): Payment => {
    const r = record(raw) ?? fail(),
      payment = {
        id: id(r.id),
        reportId: id(r.report_id),
        locationId: id(r.location_id),
        amountCents: int(r.amount_cents, 0),
        paidAt: consignmentDate(r.paid_at) ? r.paid_at : fail(),
        method: PAYMENT_METHODS.includes(r.method as PaymentMethod)
          ? (r.method as PaymentMethod)
          : fail(),
        accountLabel: optionalText(r.account_label),
        reference: optionalText(r.reference),
        voided: typeof r.voided === "boolean" ? r.voided : fail(),
        finance: paymentFinanceFromDatabase(r) ?? fail(),
        extended: r.finance_direction !== undefined || r.finance !== undefined,
      };
    const report = reports.find((rep) => rep.id === payment.reportId) ?? fail();
    if (report.locationId !== payment.locationId) fail();
    return payment;
  });
  if (new Set(payments.map((p) => p.id)).size !== payments.length) fail();
  const paid = new Map<string, bigint>();
  for (const p of payments)
    paid.set(p.reportId, (paid.get(p.reportId) ?? 0n) + postedShopPaymentCents(p, reportDate));
  // Lo stato visibile a tutti deve coincidere con i pagamenti letti: niente letture troncate.
  for (const r of reports)
    if (
      paymentStateFor(paid.get(r.id) ?? 0n, r.brandCents) !== r.paymentState ||
      [paid.get(r.id) ?? 0n, BigInt(r.brandCents) - (paid.get(r.id) ?? 0n)].some(
        (n) => n > BigInt(MAX_CENTS) || n < -BigInt(MAX_CENTS),
      )
    )
      fail();
  return { reports, payments, shops, paid };
}

/** Pannello «Conto vendita · da incassare»: una riga per resoconto, dal mese più recente. */
export function monthlyFinanceFromRows(
  reportRows: unknown[],
  paymentRows: unknown[],
  locationRows: unknown[],
  loadedAt = new Date().toISOString(),
): MonthlyFinance {
  const { reports, shops, paid } = parseMonthly(
    reportRows,
    paymentRows,
    locationRows,
    localReportDate(new Date(loadedAt)) ?? fail(),
  );
  const rows = reports.map((r): MonthlyFinanceRow => {
    const shop = shops.get(r.locationId)!,
      received = paid.get(r.id) ?? 0n,
      due = BigInt(r.brandCents);
    return {
      reportId: r.id,
      locationId: r.locationId,
      code: shop.code,
      shopName: shop.name,
      month: r.month,
      monthLabel: monthLabel(r.month),
      pieces: r.pieces,
      grossCents: r.grossCents,
      shopCents: r.shopCents,
      brandCents: r.brandCents,
      invoice: r.invoice ? { number: r.invoice.number, date: r.invoice.date } : null,
      paidCents: Number(received),
      remainingCents: Number(received < due ? due - received : 0n),
      overpaidCents: Number(received > due ? received - due : 0n),
      paymentState: r.paymentState,
      status: reportStatusLabel(r),
      href: consignmentShopHref(shop.code, r.month),
    };
  });
  rows.sort(
    (a, b) =>
      (a.month < b.month ? 1 : a.month > b.month ? -1 : 0) ||
      a.shopName.localeCompare(b.shopName, "it") ||
      a.code.localeCompare(b.code),
  );
  const toCollect = rows.reduce((sum, r) => sum + BigInt(r.remainingCents), 0n);
  if (toCollect > BigInt(MAX_CENTS)) fail();
  return { rows, toCollectCents: Number(toCollect), loadedAt };
}

/** Pagamenti non annullati, pronti per i movimenti Finance; i resoconti non diventano mai movimenti. */
export function dashboardShopPaymentsFromRows(
  paymentRows: unknown[],
  reportRows: unknown[],
  locationRows: unknown[],
): DashboardShopPayment[] {
  return projectShopPayments(paymentRows, reportRows, locationRows, false);
}
export function deletedShopPaymentsFromRows(
  paymentRows: unknown[],
  reportRows: unknown[],
  locationRows: unknown[],
): DashboardShopPayment[] {
  return projectShopPayments(paymentRows, reportRows, locationRows, true);
}
function projectShopPayments(
  paymentRows: unknown[],
  reportRows: unknown[],
  locationRows: unknown[],
  voided: boolean,
): DashboardShopPayment[] {
  const { reports, payments, shops } = parseMonthly(reportRows, paymentRows, locationRows);
  return payments
    .filter((p) => p.voided === voided)
    .map((p): DashboardShopPayment => {
      const report = reports.find((r) => r.id === p.reportId)!,
        shop = shops.get(p.locationId)!,
        account = financeAccountLabel(p.accountLabel) ?? (p.method === "cash" ? "Cash" : null);
      return {
        id: p.id,
        reportId: p.reportId,
        locationId: p.locationId,
        cents: p.amountCents,
        paidAt: p.paidAt,
        method: p.method,
        account,
        allocationNote: account ? null : "Conto dell’incasso conto vendita non attribuito.",
        reference: p.reference,
        shopName: shop.name,
        month: report.month,
        monthLabel: monthLabel(report.month),
        href: consignmentShopHref(shop.code, report.month),
        ...(p.extended
          ? {
              direction: p.finance.direction,
              category: p.finance.category,
              description: p.finance.description,
              pending: p.finance.pending,
            }
          : {}),
      };
    })
    .sort((a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt) || a.id.localeCompare(b.id));
}

type FinanceRows = { reports: unknown[]; payments: unknown[]; locations: unknown[] };
/** Riverifica identità e Finance in questa sessione prima di leggere i pagamenti. */
async function readFinanceRows(
  supabase: SupabaseClient,
  member: VerifiedMember,
): Promise<
  { status: "signed-out" | "denied" | "unavailable" } | { status: "ready"; rows: FinanceRows }
> {
  const current = await verifiedMember(supabase);
  if (current.status !== "member") return { status: current.status };
  if (
    current.member.userId !== member.userId ||
    !(await verifiedSensitiveAccess(supabase, current.member, "finance"))
  )
    return { status: "denied" };
  const read = (table: string, columns: string) =>
    consignmentPages((after, limit) => {
      let q = supabase.from(table).select(columns, { count: "exact" }).order("id").limit(limit);
      if (after !== null) q = q.gt("id", after);
      return q;
    });
  const [reports, payments, locations] = await Promise.all([
    read(
      "consignment_reports",
      "id,location_id,period_month,revision,pieces,gross_cents,brand_cents,shop_cents,invoice_number,invoice_date,invoice_revision,payment_state",
    ),
    read(
      "consignment_report_payments",
      "id,report_id,location_id,amount_cents,paid_at,method,account_label,reference,voided,finance_direction,finance_category,finance_description,finance_pending",
    ),
    read("stock_locations", "id,code,name,active,location_type"),
  ]);
  return {
    status: "ready",
    rows: { reports: await withCurrentShopPaymentStates(supabase, reports), payments, locations },
  };
}

/** Pannello Finance e pagamenti per i saldi, con una sola lettura. */
export async function readConsignmentMonthlyFinance(
  supabase: SupabaseClient,
  member: VerifiedMember,
) {
  const read = await readFinanceRows(supabase, member);
  if (read.status !== "ready") return read;
  const { reports, payments, locations } = read.rows;
  return {
    status: "ready" as const,
    snapshot: monthlyFinanceFromRows(reports, payments, locations),
    shopPayments: dashboardShopPaymentsFromRows(payments, reports, locations),
    deletedShopPayments: deletedShopPaymentsFromRows(payments, reports, locations),
  };
}

export type ConsignmentToSettle = {
  locationId: string;
  code: string;
  shopName: string;
  month: string;
  monthLabel: string;
  /** Da fatturare: la fattura non è ancora segnata. */
  toInvoiceCents: number;
  /** Residuo ancora da incassare. */
  toCollectCents: number;
  toReturnCents?: number;
  state: "da_fatturare" | "da_incassare" | "da_restituire";
  href: string;
};
/**
 * Per Oggi (05, riquadro «Conto vendita da regolare»): per negozio e mese,
 * prima i mesi più vecchi. Riverifica membership e Finance prima di leggere.
 */
export async function loadConsignmentToSettle(supabase: SupabaseClient, member: VerifiedMember) {
  const read = await readFinanceRows(supabase, member);
  if (read.status !== "ready") return read;
  const { reports, payments, locations } = read.rows;
  const rows = monthlyFinanceFromRows(reports, payments, locations)
    .rows.flatMap((r): ConsignmentToSettle[] => {
      const state =
        r.overpaidCents > 0
          ? "da_restituire"
          : r.invoice === null && r.brandCents > 0
            ? "da_fatturare"
            : r.remainingCents > 0
              ? "da_incassare"
              : null;
      return state
        ? [
            {
              locationId: r.locationId,
              code: r.code,
              shopName: r.shopName,
              month: r.month,
              monthLabel: r.monthLabel,
              toInvoiceCents: r.brandCents,
              toCollectCents: r.remainingCents,
              ...(r.overpaidCents > 0 ? { toReturnCents: r.overpaidCents } : {}),
              state,
              href: r.href,
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        (a.month < b.month ? -1 : a.month > b.month ? 1 : 0) ||
        a.shopName.localeCompare(b.shopName, "it"),
    );
  return { status: "ready" as const, rows };
}
