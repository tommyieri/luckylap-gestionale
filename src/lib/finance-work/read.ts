import { isUuid, record, safeInteger } from "../sales/model";
import { calendarDay, type FinanceWorkSnapshot, type FinanceVoid, type ManualEntry, type SalesFact, type DeclaredPayment, type FinanceOrder } from "./model";
export type WorkRows = { entries: unknown[]; voids: unknown[]; facts: unknown[]; payments: unknown[]; orders: unknown[] };
function fail(): never { throw new Error("Lettura Finance non completa."); }
const obj = (v: unknown) => record(v) ?? fail();
const id = (v: unknown) => isUuid(v) ? v : fail();
const str = (v: unknown) => typeof v === "string" ? v : fail();
const optional = (v: unknown) => v === null ? null : str(v);
const cents = (v: unknown, max = 9000000000000000) => safeInteger(v,0,max) ? v : fail();
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : fail();
const choice = <T extends string>(v: unknown, allowed: readonly T[]): T => typeof v === "string" && allowed.includes(v as T) ? v as T : fail();
function unique(values: string[]) { if (new Set(values).size !== values.length) fail(); }
export function financeWorkFromRows(rows: WorkRows): FinanceWorkSnapshot {
  const voids: FinanceVoid[] = rows.voids.map(raw => { const r = obj(raw); return {id:id(r.id),entryId:id(r.finance_entry_id),reason:str(r.reason),createdAt:date(r.created_at),createdBy:id(r.created_by)}; });
  unique(voids.map(v=>v.id)); unique(voids.map(v=>v.entryId));
  const entries: ManualEntry[] = rows.entries.map(raw => { const r=obj(raw); if(!calendarDay(r.entry_date)||r.review_status!=="unclassified")fail(); return {id:id(r.id),date:r.entry_date,type:choice(r.entry_type,["income","expense"]),cents:cents(r.amount_cents,99999999999999),description:str(r.description),account:optional(r.account_label),category:optional(r.category),source:choice(r.source_kind,["manual_declaration","legacy_unclassified"]),createdAt:date(r.created_at),createdBy:id(r.created_by),void:voids.find(v=>v.entryId===r.id)??null}; });
  unique(entries.map(v=>v.id)); if(entries.some(v=>v.cents<=0)||voids.some(v=>!entries.some(e=>e.id===v.entryId)))fail();
  const orders: FinanceOrder[] = rows.orders.map(raw=>{const r=obj(raw);return {id:id(r.id),channel:str(r.channel),reference:optional(r.external_reference),totalCents:cents(r.total_cents),cancelledCents:cents(r.cancelled_cents),refundDueCents:cents(r.refund_due_cents)};});
  unique(orders.map(v=>v.id)); if(orders.some(v=>v.cancelledCents>v.totalCents))fail();
  const facts: SalesFact[] = rows.facts.map(raw=>{const r=obj(raw);if(r.currency!=="EUR"||r.review_status!=="observed_unclassified"||r.source_kind!=="manual_declaration")fail();return {id:id(r.id),orderId:id(r.order_id),paymentId:r.payment_id===null?null:id(r.payment_id),kind:choice(r.fact_kind,["sale_observed","payment_reported","sale_cancellation_observed"]),cents:cents(r.amount_cents),occurredAt:date(r.occurred_at),reviewStatus:r.review_status};});
  const payments: DeclaredPayment[] = rows.payments.map(raw=>{const r=obj(raw);if(r.currency!=="EUR"||r.source_kind!=="manual_declaration")fail();return {id:id(r.id),orderId:id(r.order_id),cents:cents(r.amount_cents),method:choice(r.method,["cash","bank_transfer","external_card","other"]),occurredAt:date(r.occurred_at),reference:optional(r.declared_reference)};});
  unique(facts.map(v=>v.id)); unique(payments.map(v=>v.id));
  if(facts.some(f=>!orders.some(o=>o.id===f.orderId))||payments.some(p=>!orders.some(o=>o.id===p.orderId)))fail();
  for(const f of facts) {
    if(f.kind==="payment_reported") { const p=payments.find(p=>p.id===f.paymentId); if(!p||p.orderId!==f.orderId||p.cents!==f.cents)fail(); }
    else if(f.paymentId!==null)fail();
  }
  for(const p of payments)if(facts.filter(f=>f.kind==="payment_reported"&&f.paymentId===p.id).length!==1)fail();
  for(const o of orders) {
    const sale=facts.filter(f=>f.orderId===o.id&&f.kind==="sale_observed");
    if(sale.length!==1||sale[0].cents!==o.totalCents||facts.filter(f=>f.orderId===o.id&&f.kind==="sale_cancellation_observed").reduce((sum,f)=>sum+f.cents,0)!==o.cancelledCents)fail();
  }
  entries.sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  facts.sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)); payments.sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
  return {entries,facts,payments,orders};
}
