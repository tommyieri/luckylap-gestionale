import { stockRecord as record, stockUuid as uuid, type StockAvailability } from "../stock/model";
import { romeInputToIso } from "../sales/model";
import { formatEuroAmount } from "../finance/model";
export { stockQuantity as quantityLabel } from "../stock/model";
export const MAX_CENTS=9_000_000_000_000_000;
export type ConsignmentKind="transfer_consignment_stock"|"register_consignment_sale"|"record_consignment_settlement";
export type TransferPayload={schema_version:1;stock_item_id:string;from_location_id:string;to_location_id:string;quantity:number;reason:string;occurred_at:string};
export type SalePayload={schema_version:1;stock_item_id:string;location_id:string;quantity:number;reason:string;external_reference:string;occurred_at:string;shop_domain:string;variant_gid:string;expected_web_price_cents:number;expected_catalog_observed_at:string};
export type SettlementPayload={schema_version:1;sale_id:string;amount_cents:number;occurred_at:string;method:"bank_transfer"|"cash"|"other";reference:string};
export type ConsignmentCommand=({kind:"transfer_consignment_stock";payload:TransferPayload}|{kind:"register_consignment_sale";payload:SalePayload}|{kind:"record_consignment_settlement";payload:SettlementPayload})&{operationId:string;retry?:boolean};
export type ConsignmentResult={status:"success";operationId:string;replayed:boolean;message:string}|{status:"rejected";code:string;message:string}|{status:"uncertain";message:string};
export type CatalogPrice={shopDomain:string;variantGid:string;priceCents:number;observedAt:string};
export type ConsignmentItem={id:string;sku:string;name:string;active:boolean;costCents:number|null;catalog:CatalogPrice|null};
export type ConsignmentLocation={id:string;code:string;name:string;active:boolean;type:"Magazzino"|"Negozio Conto Vendita"};
export type ConsignmentTransfer={id:string;itemId:string;fromId:string;toId:string;quantity:number;reason:string;occurredAt:string};
export type ConsignmentSale={id:string;itemId:string;locationId:string;sku:string;quantity:number;webPriceCents:number;unitShopPriceCents:number;grossCents:number;brandClaimCents:number;shopShareCents:number;costCents:number|null;reference:string;reason:string;occurredAt:string};
export type ConsignmentSettlement={id:string;saleId:string;amountCents:number;occurredAt:string;method:string;reference:string};
export type ConsignmentSnapshot={stockEnabled:boolean;salesEnabled:boolean;startedAt:string|null;loadedAt:string;canSettle:boolean;items:ConsignmentItem[];locations:ConsignmentLocation[];availability:StockAvailability[];transfers:ConsignmentTransfer[];sales:ConsignmentSale[];settlements:ConsignmentSettlement[]|null};
const integer=(v:unknown,min=0,max=MAX_CENTS):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const text=(v:unknown,min:number,max:number):v is string=>typeof v==="string"&&v.trim().length>=min&&v.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
export const consignmentDate=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const exact=(p:Record<string,unknown>,keys:string[])=>Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k));
export function parseConsignmentCommand(value:unknown):ConsignmentCommand|null{
  const row=record(value),p=record(row?.payload);if(!row||!p||!uuid(row.operationId)||Object.keys(row).some(k=>!["operationId","kind","payload","retry"].includes(k))||(row.retry!==undefined&&typeof row.retry!=="boolean")||p.schema_version!==1||!consignmentDate(p.occurred_at))return null;
  const base={operationId:row.operationId.toLowerCase(),...(row.retry===undefined?{}:{retry:row.retry as boolean})};
  if(row.kind==="transfer_consignment_stock"){
    if(!exact(p,["schema_version","stock_item_id","from_location_id","to_location_id","quantity","reason","occurred_at"])||!uuid(p.stock_item_id)||!uuid(p.from_location_id)||!uuid(p.to_location_id)||p.from_location_id===p.to_location_id||!integer(p.quantity,1,100000)||!text(p.reason,3,500))return null;
    return{...base,kind:row.kind,payload:{schema_version:1,stock_item_id:p.stock_item_id.toLowerCase(),from_location_id:p.from_location_id.toLowerCase(),to_location_id:p.to_location_id.toLowerCase(),quantity:p.quantity,reason:p.reason.trim(),occurred_at:p.occurred_at}};
  }
  if(row.kind==="register_consignment_sale"){
    if(!exact(p,["schema_version","stock_item_id","location_id","quantity","reason","external_reference","occurred_at","shop_domain","variant_gid","expected_web_price_cents","expected_catalog_observed_at"])||!uuid(p.stock_item_id)||!uuid(p.location_id)||!integer(p.quantity,1,100000)||!text(p.reason,3,500)||!text(p.external_reference,1,240)||typeof p.shop_domain!=="string"||!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(p.shop_domain)||typeof p.variant_gid!=="string"||!/^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]{0,19}$/.test(p.variant_gid)||!integer(p.expected_web_price_cents,0,99999999999999)||!consignmentDate(p.expected_catalog_observed_at)||!consignmentSplit(p.expected_web_price_cents,p.quantity))return null;
    return{...base,kind:row.kind,payload:{schema_version:1,stock_item_id:p.stock_item_id.toLowerCase(),location_id:p.location_id.toLowerCase(),quantity:p.quantity,reason:p.reason.trim(),external_reference:p.external_reference.trim(),occurred_at:p.occurred_at,shop_domain:p.shop_domain,variant_gid:p.variant_gid,expected_web_price_cents:p.expected_web_price_cents,expected_catalog_observed_at:p.expected_catalog_observed_at}};
  }
  if(row.kind==="record_consignment_settlement"){
    if(!exact(p,["schema_version","sale_id","amount_cents","occurred_at","method","reference"])||!uuid(p.sale_id)||!integer(p.amount_cents,1)||!["bank_transfer","cash","other"].includes(p.method as string)||!text(p.reference,1,240))return null;
    return{...base,kind:row.kind,payload:{schema_version:1,sale_id:p.sale_id.toLowerCase(),amount_cents:p.amount_cents,occurred_at:p.occurred_at,method:p.method as SettlementPayload["method"],reference:p.reference.trim()}};
  }
  return null;
}
/** Round only the whole commercial line, using integer arithmetic. */
export function consignmentSplit(webPriceCents:number,quantity:number){
  if(!integer(webPriceCents,0,99999999999999)||!integer(quantity,1,100000))return null;
  const unit=BigInt(webPriceCents)+1000n,gross=unit*BigInt(quantity);if(gross>BigInt(MAX_CENTS))return null;
  const brand=(gross*60n+50n)/100n;return{unitShopPriceCents:Number(unit),grossCents:Number(gross),brandClaimCents:Number(brand),shopShareCents:Number(gross-brand)};
}
export function consignmentAmount(value:unknown):number|null{
  if(typeof value!=="string")return null;const m=/^(0|[1-9][0-9]{0,13})(?:[.,]([0-9]{1,2}))?$/.exec(value.trim());if(!m)return null;
  const cents=BigInt(m[1])*100n+BigInt((m[2]??"").padEnd(2,"0"));return cents<=BigInt(MAX_CENTS)?Number(cents):null;
}
export function consignmentMoney(value:number|bigint|null){if(value===null)return"Da verificare";const n=BigInt(value),sign=n<0n?"-":"",abs=n<0n?-n:n,whole=String(abs/100n),fraction=String(abs%100n).padStart(2,"0");return formatEuroAmount(`${sign}${whole}.${fraction}`)??`${sign?"−":""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g,".")},${fraction} €`;}
export const consignmentMargin=(claim:number,cost:number|null,quantity:number)=>cost===null?null:BigInt(claim)-BigInt(cost)*BigInt(quantity);
export function formQuantity(value:FormDataEntryValue|null):number|null{if(typeof value!=="string"||! /^[1-9][0-9]{0,5}$/.test(value))return null;const n=Number(value);return integer(n,1,100000)?n:null;}
export function formDate(value:FormDataEntryValue|null):string|null{return romeInputToIso(value);}
export const consignmentPendingKey=(userId:string)=>`luckylap.consignment.pending:${userId}`;
export function consignmentPending(storage:Pick<Storage,"getItem">,userId:string){const raw=storage.getItem(consignmentPendingKey(userId));if(!raw)return null;if(raw.length>16000)throw Error("Invio non leggibile.");const result=parseConsignmentCommand(JSON.parse(raw));if(!result)throw Error("Invio non leggibile.");return result;}
