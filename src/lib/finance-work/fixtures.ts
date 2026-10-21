// Synthetic fixtures only. Application routes never import this file.
import type { WorkRows } from "./read";
export const workId=(n:number)=>`60000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const manualCommand=()=>({operationId:workId(90),kind:"record_finance_entry",payload:{schema_version:1,entry_date:"2026-10-21",entry_type:"expense",amount_cents:1234,description:"Synthetic user-declared expense",not_duplicate_confirmed:true}});
export function workRows():WorkRows{
  const at="2026-10-21T12:00:00Z";
  return{
    entries:[{id:workId(1),entry_date:"2026-10-21",entry_type:"expense",amount_cents:1234,description:"Synthetic user-declared expense",account_label:"Synthetic declared account",category:"Synthetic category",source_kind:"manual_declaration",review_status:"unclassified",created_at:at,created_by:workId(10)}],
    voids:[],
    orders:[{id:workId(2),channel:"direct",external_reference:"SYNTHETIC-ORDER-1",total_cents:8002,cancelled_cents:4001,refund_due_cents:4001}],
    facts:[
      {id:workId(3),order_id:workId(2),payment_id:null,fact_kind:"sale_observed",amount_cents:8002,currency:"EUR",occurred_at:at,source_kind:"manual_declaration",review_status:"observed_unclassified"},
      {id:workId(4),order_id:workId(2),payment_id:workId(6),fact_kind:"payment_reported",amount_cents:8002,currency:"EUR",occurred_at:at,source_kind:"manual_declaration",review_status:"observed_unclassified"},
      {id:workId(5),order_id:workId(2),payment_id:null,fact_kind:"sale_cancellation_observed",amount_cents:4001,currency:"EUR",occurred_at:at,source_kind:"manual_declaration",review_status:"observed_unclassified"},
    ],
    payments:[{id:workId(6),order_id:workId(2),method:"cash",amount_cents:8002,currency:"EUR",occurred_at:at,declared_reference:"Synthetic payment reference",source_kind:"manual_declaration"}],
  };
}
