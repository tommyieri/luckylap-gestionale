import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSensitiveAreaEligible } from "../auth/model";
import { verifiedSensitiveAccess } from "../auth/sensitive-access";
import { verifiedMember } from "../auth/server";
import { readCompletePages } from "../finance/read";
import { isUuid, record } from "../sales/model";
import { parseFinanceWorkCommand, type FinanceWorkResult } from "./model";
import { financeWorkFromRows, type WorkRows } from "./read";

export async function financeWorkAccess(supabase: SupabaseClient) {
  const access=await verifiedMember(supabase);
  if(access.status!=="member")return access;
  if(!isSensitiveAreaEligible(access.member,"finance"))return {status:"denied" as const};
  if(!await verifiedSensitiveAccess(supabase,access.member,"finance"))return {status:"area-locked" as const};
  return {status:"authorized" as const,member:access.member};
}
const selections={
  entries:["finance_entries","id,entry_date,entry_type,amount_cents,description,account_label,category,source_kind,review_status,created_at,created_by"],
  voids:["finance_entry_voids","id,finance_entry_id,reason,created_at,created_by"],
  facts:["commercial_facts","id,order_id,payment_id,refund_id,fact_kind,amount_cents,currency,occurred_at,source_kind,review_status"],
  payments:["order_payments","id,order_id,method,amount_cents,currency,occurred_at,declared_reference,source_kind"],
  orders:["sales_orders","id,source_kind,channel,external_reference,total_cents,cancelled_cents,refund_due_cents"],
  refunds:["shopify_refund_observations","id,order_id,transaction_gid,amount_cents,occurred_at,source_kind"],
  shopifyFinancials:["shopify_order_financials","order_id,source_updated_at,totals,taxes_included,observed_at"],
  shopifyTransactions:["shopify_transaction_observations","order_id,transaction_gid,kind,status,amount_cents,currency,gateway,parent_gid,processed_at,source_updated_at,observed_at"],
} as const;
export async function readFinanceWork(supabase: SupabaseClient) {
  const access=await financeWorkAccess(supabase); if(access.status!=="authorized")return access;
  const entries=await Promise.all(Object.entries(selections).map(async([key,[table,columns]])=>[key,await readCompletePages((from,to)=>{
    let query=supabase.from(table).select(columns as string,{count:"exact"}).order(key==="shopifyFinancials"||key==="shopifyTransactions"?"order_id":"id");
    if(key==="shopifyTransactions")query=query.order("transaction_gid");
    return query.range(from,to);
  })]));
  return {status:"ready" as const,member:access.member,snapshot:financeWorkFromRows(Object.fromEntries(entries) as WorkRows)};
}
const messages:Record<string,string>={
  finance_access_required:"Finance richiede un account abilitato e la password dell’area per questa sessione.",
  invalid_finance_payload:"Controlla data, importo, descrizione e conferma che la voce non sia già presente nelle altre fonti.",
  future_finance_entry:"La data è futura: usa il calendario come promemoria e registra il movimento quando avviene.",
  idempotency_conflict:"Questo tentativo è associato a dati diversi. Verifica il registro prima di creare altre voci.",
  finance_entry_not_found:"La voce da annullare non è disponibile. Ricarica il registro.",
  finance_entry_already_voided:"La voce risulta già annullata. La fonte originale è conservata.",
};
export async function executeFinanceWork(supabase:SupabaseClient,value:unknown):Promise<FinanceWorkResult>{
  const retry=record(value)?.retry===true;
  const uncertain=():FinanceWorkResult=>({status:"uncertain",message:"L’esito del tentativo precedente non è verificabile. Conserva lo stesso invio e riprova dopo aver verificato accesso e collegamento."});
  const command=parseFinanceWorkCommand(value);
  if(!command)return retry?uncertain():{status:"rejected",code:"invalid_finance_payload",message:messages.invalid_finance_payload};
  let submitted=false;
  try{
    const access=await financeWorkAccess(supabase);
    if(access.status!=="authorized")return retry?uncertain():{status:"rejected",code:"finance_access_required",message:messages.finance_access_required};
    submitted=true;
    const {data,error}=await supabase.rpc(command.kind,{p_operation_id:command.operationId,p_payload:command.payload});
    if(error){
      if(retry&&["finance_access_required","invalid_finance_payload","future_finance_entry"].includes(error.message))return uncertain();
      if(messages[error.message]&&["22023","42501"].includes(error.code))return {status:"rejected",code:error.message,message:messages[error.message]};
      return uncertain();
    }
    const result=record(data);
    if(!result||result.operation_id!==command.operationId||!isUuid(result.entry_id)||typeof result.replayed!=="boolean"||(command.kind==="void_finance_entry"&&!isUuid(result.void_id)))return uncertain();
    return {status:"success",entryId:result.entry_id,replayed:result.replayed,message:result.replayed?"Esito già registrato recuperato, senza duplicare la voce.":command.kind==="void_finance_entry"?"Annullamento registrato. La voce originale è conservata.":"Voce manuale salvata, da classificare. Nessun dato importato o saldo è stato modificato."};
  }catch{return submitted||retry?uncertain():{status:"rejected",code:"unavailable",message:"Verifica dell’accesso non disponibile. Nessun invio eseguito."};}
}
