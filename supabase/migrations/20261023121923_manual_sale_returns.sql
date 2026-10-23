-- Resi manuali: rientro fisico e registrazione del rimborso già effettuato, atomici.
-- Nessun dato storico viene importato o riscritto. Rollback tramite migrazione successiva.
begin;

-- A returned fulfillment may have no remaining packaging demand.
alter table public.packaging_consumptions drop constraint packaging_consumptions_requested_quantity_check;
alter table public.packaging_consumptions add constraint packaging_consumptions_requested_quantity_check check(requested_quantity between 0 and 100000);

alter table public.sales_orders drop constraint sales_orders_order_state_check;
alter table public.sales_orders add constraint sales_orders_order_state_check check(order_state in('confirmed','partially_cancelled','cancelled','partially_returned','returned'));
alter table public.sales_orders drop constraint sales_orders_fulfillment_state_check;
alter table public.sales_orders add constraint sales_orders_fulfillment_state_check check(fulfillment_state in('unfulfilled','partial','fulfilled','cancelled','partially_returned','returned'));

create table public.manual_sale_returns (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.sales_orders(id),
 operation_id uuid not null unique,expected_version text not null check(expected_version~'^[0-9a-f]{64}$'),
 refund_cents bigint not null check(refund_cents between 1 and 99999999999999),
 finance_entry_id uuid not null unique references public.finance_entries(id),
 product_quantity bigint not null check(product_quantity between 1 and 5000000),
 box_quantity bigint not null check(box_quantity between 0 and product_quantity),
 sticker_quantity bigint not null check(sticker_quantity between 0 and product_quantity),
 occurred_at timestamptz not null check(isfinite(occurred_at)),
 reason text not null check(char_length(reason) between 3 and 500),
 created_by uuid not null references public.profiles(user_id),created_at timestamptz not null default clock_timestamp()
);
create index manual_sale_returns_order on public.manual_sale_returns(order_id,created_at,id);
create index manual_sale_returns_creator on public.manual_sale_returns(created_by);
create table public.manual_sale_return_lines (
 id uuid primary key default gen_random_uuid(),return_id uuid not null references public.manual_sale_returns(id),
 order_line_id uuid not null references public.sales_order_lines(id),quantity integer not null check(quantity between 1 and 100000),
 refund_cents bigint not null check(refund_cents>=0),stock_movement_id uuid not null unique references public.stock_movements(id),unique(return_id,order_line_id)
);
create index manual_sale_return_lines_order_line on public.manual_sale_return_lines(order_line_id);
create table public.manual_sale_return_fulfillments (
 id uuid primary key default gen_random_uuid(),return_line_id uuid not null references public.manual_sale_return_lines(id),
 fulfillment_line_id uuid not null references public.fulfillment_lines(id),quantity integer not null check(quantity between 1 and 100000),
 unique(return_line_id,fulfillment_line_id)
);
create index manual_sale_return_fulfillment_source on public.manual_sale_return_fulfillments(fulfillment_line_id);
create table public.manual_sale_return_packaging (
 id uuid primary key default gen_random_uuid(),return_id uuid not null references public.manual_sale_returns(id),
 stock_item_id uuid not null references public.packaging_items(stock_item_id),quantity bigint not null check(quantity between 1 and 5000000),
 stock_movement_id uuid not null unique references public.stock_movements(id),unique(return_id,stock_item_id)
);
create index manual_sale_return_packaging_item on public.manual_sale_return_packaging(stock_item_id);
do $$declare t text;begin
 foreach t in array array['manual_sale_returns','manual_sale_return_lines','manual_sale_return_fulfillments','manual_sale_return_packaging']loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy member_read on public.%I for select to authenticated using((select private.is_member()))',t);
  execute format('create trigger return_append_only before update or delete on public.%I for each row execute function private.reject_ledger_mutation()',t);
  execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
 end loop;
end$$;
create table private.manual_sale_return_receipts (
 operation_id uuid primary key,actor_id uuid not null references public.profiles(user_id),
 payload_sha256 text not null check(payload_sha256~'^[0-9a-f]{64}$'),result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table private.manual_sale_return_receipts enable row level security;
revoke all on private.manual_sale_return_receipts from public,anon,authenticated,service_role;
create trigger return_receipt_append_only before update or delete on private.manual_sale_return_receipts for each row execute function private.reject_ledger_mutation();

create or replace function private.assert_sale_registration_cancellation_allowed(p_order_id uuid) returns void
language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.manual_sale_returns where order_id=p_order_id) then raise exception 'sale_has_returns'using errcode='22023';end if;
end$$;

create function private.normalize_manual_sale_return(p_payload jsonb)returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare line jsonb;items jsonb:='[]'::jsonb;line_id uuid;qty bigint;account text;order_id uuid;boxes bigint;stickers bigint;
begin
 perform private.sale_object(p_payload,array['schema_version','order_id','lines','reusable_boxes','reusable_stickers','refund_account'],array['schema_version','order_id','lines','reusable_boxes','reusable_stickers','refund_account']);
 perform private.sale_integer(p_payload->'schema_version',1,1);
 if jsonb_typeof(p_payload->'order_id')is distinct from 'string'or jsonb_typeof(p_payload->'refund_account')is distinct from 'string'or jsonb_typeof(p_payload->'lines')is distinct from 'array'or jsonb_array_length(p_payload->'lines')>50 then raise exception 'invalid_payload'using errcode='22023';end if;
 order_id:=(p_payload->>'order_id')::uuid;boxes:=private.sale_integer(p_payload->'reusable_boxes',0,5000000);stickers:=private.sale_integer(p_payload->'reusable_stickers',0,5000000);
 account:=btrim(p_payload->>'refund_account');if char_length(account)>120 then raise exception 'invalid_payload'using errcode='22023';end if;
 account:=case lower(account)when 'cash'then 'Cash'when 'revolut business'then 'Revolut Business'else account end;
 for line in select value from jsonb_array_elements(p_payload->'lines')loop
  perform private.sale_object(line,array['order_line_id','quantity'],array['order_line_id','quantity']);
  if jsonb_typeof(line->'order_line_id')is distinct from 'string'then raise exception 'invalid_payload'using errcode='22023';end if;
  line_id:=(line->>'order_line_id')::uuid;qty:=private.sale_integer(line->'quantity',1,100000);
  if exists(select 1 from jsonb_array_elements(items)r where r->>'order_line_id'=line_id::text)then raise exception 'invalid_payload'using errcode='22023';end if;
  items:=items||jsonb_build_array(jsonb_build_object('order_line_id',line_id,'quantity',qty));
 end loop;
 select coalesce(jsonb_agg(value order by value->>'order_line_id'),'[]'::jsonb)into items from jsonb_array_elements(items);
 return jsonb_build_object('schema_version',1,'order_id',order_id,'lines',items,'reusable_boxes',boxes,'reusable_stickers',stickers,'refund_account',account);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_payload'using errcode='22023';
end$$;

create function private.manual_sale_return_quote(p_payload jsonb)returns jsonb
language plpgsql volatile security definer set search_path='' as $$
<<return_quote>>
declare normalized jsonb;oid uuid;o public.sales_orders%rowtype;config public.packaging_automation%rowtype;l record;
 selected bigint;already bigint;available bigint;value bigint;amount bigint:=0;quantity bigint:=0;tshirts bigint:=0;returned_value bigint:=0;
 boxes bigint;stickers bigint;box_available bigint:=0;sticker_available bigint:=0;result_lines jsonb:='[]'::jsonb;summary jsonb;state jsonb;version text;
begin
 if not private.manual_sale_cancellation_access()then raise exception 'membership_required'using errcode='42501';end if;
 normalized:=private.normalize_manual_sale_return(p_payload);oid:=(normalized->>'order_id')::uuid;
 select * into o from public.sales_orders where id=oid for update;
 if not found then raise exception 'sale_not_found'using errcode='22023';end if;
 if o.source_kind<>'manual_declaration'then raise exception 'manual_sale_required'using errcode='22023';end if;
 if exists(select 1 from public.sales_registration_cancellations where order_id=oid)then raise exception 'sale_registration_cancelled'using errcode='22023';end if;
 if not exists(select 1 from public.app_settings where id and manual_sales_enabled and sales_started_at is not null)then raise exception 'sales_disabled'using errcode='42501';end if;
 if exists(select 1 from public.sales_order_lines x join public.stock_locations s on s.id=x.location_id where x.order_id=oid and(s.code<>'MAG01'or s.location_type<>'Magazzino'))then raise exception 'manual_sale_location_required'using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(normalized->'lines')r where not exists(select 1 from public.sales_order_lines x where x.order_id=oid and x.id=(r->>'order_line_id')::uuid))then raise exception 'invalid_payload'using errcode='22023';end if;
 perform b.stock_item_id from public.stock_balances b join public.sales_order_lines x on x.stock_item_id=b.stock_item_id and x.location_id=b.location_id where x.order_id=oid order by b.stock_item_id,b.location_id for update of b;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packaging.consume',0));
 select * into config from public.packaging_automation where id;
 perform b.stock_item_id from public.stock_balances b where b.location_id=config.location_id and b.stock_item_id in(config.box_item_id,config.sticker_item_id)order by b.stock_item_id,b.location_id for update;
 if not private.manual_sale_cancellation_access()then raise exception 'membership_required'using errcode='42501';end if;
 for l in select x.*,coalesce((select sum(r.quantity)from public.manual_sale_return_lines r where r.order_line_id=x.id),0)::bigint returned from public.sales_order_lines x where x.order_id=oid order by x.id loop
  already:=l.returned;available:=l.fulfilled_quantity-already;
  select coalesce(sum((r->>'quantity')::bigint),0)into selected from jsonb_array_elements(normalized->'lines')r where r->>'order_line_id'=l.id::text;
  if available<0 or selected>available then raise exception 'return_quantity_exceeded'using errcode='22023';end if;
  value:=case when selected=0 then 0 else floor(l.line_total_cents::numeric*(l.cancelled_quantity+already+selected)/l.quantity)::bigint-l.cancelled_amount_cents-coalesce((select sum(r.refund_cents)from public.manual_sale_return_lines r where r.order_line_id=l.id),0)end;
  if selected>0 and not exists(select 1 from public.stock_balances b where b.stock_item_id=l.stock_item_id and b.location_id=l.location_id and b.quantity is not null)then raise exception 'unknown_stock_balance'using errcode='22023';end if;
  quantity:=quantity+selected;amount:=amount+value;if private.is_packaged_tshirt(l.stock_item_id)then tshirts:=tshirts+selected;end if;
  returned_value:=returned_value+coalesce((select sum(r.refund_cents)from public.manual_sale_return_lines r where r.order_line_id=l.id),0);
  if available>0 then result_lines:=result_lines||jsonb_build_array(jsonb_build_object('order_line_id',l.id,'sku',l.sku_snapshot,'available_quantity',available,'selected_quantity',selected,'refund_cents',value));end if;
 end loop;
 if amount>99999999999999 then raise exception 'return_refund_limit'using errcode='22023';end if;
 if amount>0 and normalized->>'refund_account'=''then raise exception 'refund_account_required'using errcode='22023';end if;
 summary:=private.effective_order_payment_summary(oid);
 if amount>greatest(0,(summary->>'net_cents')::bigint)then raise exception 'return_refund_exceeds_payment'using errcode='22023';end if;
 select greatest(0,coalesce(sum(c.consumed_quantity),0)-coalesce((select sum(r.quantity)from public.manual_sale_return_packaging r join public.manual_sale_returns h on h.id=r.return_id where h.order_id=oid and r.stock_item_id=config.box_item_id),0))into box_available
 from public.packaging_consumptions c join public.fulfillment_lines f on c.source_kind='fulfillment'and c.source_id=f.id join public.sales_order_lines x on x.id=f.order_line_id where x.order_id=oid and c.stock_item_id=config.box_item_id;
 select greatest(0,coalesce(sum(c.consumed_quantity),0)-coalesce((select sum(r.quantity)from public.manual_sale_return_packaging r join public.manual_sale_returns h on h.id=r.return_id where h.order_id=oid and r.stock_item_id=config.sticker_item_id),0))into sticker_available
 from public.packaging_consumptions c join public.fulfillment_lines f on c.source_kind='fulfillment'and c.source_id=f.id join public.sales_order_lines x on x.id=f.order_line_id where x.order_id=oid and c.stock_item_id=config.sticker_item_id;
 box_available:=least(box_available,tshirts);sticker_available:=least(sticker_available,tshirts);
 boxes:=(normalized->>'reusable_boxes')::bigint;stickers:=(normalized->>'reusable_stickers')::bigint;
 if boxes>box_available or stickers>sticker_available then raise exception 'return_packaging_exceeded'using errcode='22023';end if;
 if(boxes>0 and not exists(select 1 from public.stock_balances b where b.stock_item_id=config.box_item_id and b.location_id=config.location_id and b.quantity is not null))or(stickers>0 and not exists(select 1 from public.stock_balances b where b.stock_item_id=config.sticker_item_id and b.location_id=config.location_id and b.quantity is not null))then raise exception 'unknown_packaging_stock'using errcode='22023';end if;
 state:=jsonb_build_object('request',normalized,'order',to_jsonb(o),'summary',summary,'config',to_jsonb(config),
  'lines',(select coalesce(jsonb_agg(to_jsonb(x)order by x.id),'[]'::jsonb)from public.sales_order_lines x where x.order_id=oid),
  'returns',(select coalesce(jsonb_agg(to_jsonb(x)order by x.id),'[]'::jsonb)from public.manual_sale_returns x where x.order_id=oid),
  'packaging',(select coalesce(jsonb_agg(to_jsonb(c)order by c.id),'[]'::jsonb)from public.packaging_consumptions c join public.fulfillment_lines f on c.source_kind='fulfillment'and c.source_id=f.id join public.sales_order_lines x on x.id=f.order_line_id where x.order_id=oid),
  'payments',(select coalesce(jsonb_agg(to_jsonb(x)order by x.id),'[]'::jsonb)from public.order_payments x where x.order_id=oid),
  'refund_entries',(select coalesce(jsonb_agg(to_jsonb(e)order by e.id),'[]'::jsonb)from public.finance_entries e join public.manual_sale_returns h on h.finance_entry_id=e.id where h.order_id=oid),
  'refund_voids',(select coalesce(jsonb_agg(to_jsonb(v)order by v.id),'[]'::jsonb)from public.finance_entry_voids v join public.manual_sale_returns h on h.finance_entry_id=v.finance_entry_id where h.order_id=oid),
  'finance_revisions',(select coalesce(jsonb_agg(to_jsonb(r)order by r.source_kind,r.source_id,r.version),'[]'::jsonb)from public.finance_movement_revisions r where(r.source_kind='payment'and exists(select 1 from public.order_payments x where x.id=r.source_id and x.order_id=oid))or(r.source_kind='manual'and exists(select 1 from public.manual_sale_returns x where x.finance_entry_id=r.source_id and x.order_id=oid))),
  'balances',(select coalesce(jsonb_agg(to_jsonb(b)order by b.stock_item_id,b.location_id),'[]'::jsonb)from public.stock_balances b where exists(select 1 from public.sales_order_lines x where x.order_id=oid and x.stock_item_id=b.stock_item_id and x.location_id=b.location_id)or(b.location_id=config.location_id and b.stock_item_id in(config.box_item_id,config.sticker_item_id))));
 version:=encode(sha256(convert_to(state::text,'UTF8')),'hex');
 return jsonb_build_object('order_id',oid,'expected_version',version,'lines',result_lines,'product_quantity',quantity,'box_quantity',boxes,'sticker_quantity',stickers,
  'reusable_boxes_available',box_available,'reusable_stickers_available',sticker_available,'refund_cents',amount,'refundable_cents',greatest(0,(summary->>'net_cents')::bigint),'remaining_value_cents',greatest(0,o.total_cents-o.cancelled_cents-returned_value-amount));
end$$;

create function private.return_manual_sale_registration(p_operation_id uuid,p_payload jsonb)returns jsonb
language plpgsql volatile security definer set search_path='' as $$
<<return_command>>
declare normalized jsonb;base jsonb;quote jsonb;old private.manual_sale_return_receipts%rowtype;digest text;oid uuid;expected text;reason text;occurred timestamptz;
 rid uuid;entry uuid;movement uuid;return_line uuid;raw jsonb;l public.sales_order_lines%rowtype;f record;qty bigint;remaining bigint;part bigint;material uuid;material_qty bigint;config public.packaging_automation%rowtype;result jsonb;
begin
 if not private.manual_sale_cancellation_access()then raise exception 'membership_required'using errcode='42501';end if;
 perform private.sale_object(p_payload,array['schema_version','order_id','lines','reusable_boxes','reusable_stickers','refund_account','expected_version','occurred_at','reason','refund_completed_confirmed'],array['schema_version','order_id','lines','reusable_boxes','reusable_stickers','refund_account','expected_version','occurred_at','reason','refund_completed_confirmed']);
 if p_operation_id is null or jsonb_typeof(p_payload->'expected_version')is distinct from 'string'or(p_payload->>'expected_version')!~'^[0-9a-f]{64}$'or jsonb_typeof(p_payload->'reason')is distinct from 'string'or p_payload->'refund_completed_confirmed'is distinct from 'true'::jsonb then raise exception 'invalid_payload'using errcode='22023';end if;
 base:=private.normalize_manual_sale_return(p_payload-array['expected_version','occurred_at','reason','refund_completed_confirmed']);
 expected:=p_payload->>'expected_version';reason:=btrim(p_payload->>'reason');occurred:=private.sale_timestamp(p_payload->'occurred_at');
 if char_length(reason)not between 3 and 500 then raise exception 'invalid_payload'using errcode='22023';end if;
 normalized:=base||jsonb_build_object('expected_version',expected,'occurred_at',occurred,'reason',reason,'refund_completed_confirmed',true);
 digest:=encode(sha256(convert_to(normalized::text,'UTF8')),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.sale.'||p_operation_id::text,0));
 if not private.manual_sale_cancellation_access()then raise exception 'membership_required'using errcode='42501';end if;
 select * into old from private.manual_sale_return_receipts where operation_id=p_operation_id;
 if found then
  if old.actor_id<>auth.uid()or old.payload_sha256<>digest then raise exception 'idempotency_conflict'using errcode='22023';end if;
  return old.result||'{"replayed":true}'::jsonb;
 end if;
 if exists(select 1 from public.sales_orders where operation_id=p_operation_id)or exists(select 1 from private.sales_command_receipts where operation_id=p_operation_id)or exists(select 1 from public.sales_registration_cancellations where operation_id=p_operation_id)then raise exception 'idempotency_conflict'using errcode='22023';end if;
 quote:=private.manual_sale_return_quote(base);oid:=(base->>'order_id')::uuid;
 if quote->>'expected_version'<>expected then raise exception 'sale_return_version_conflict'using errcode='22023';end if;
 if(quote->>'refund_cents')::bigint<=0 or(quote->>'product_quantity')::bigint<=0 then raise exception 'return_refund_required'using errcode='22023';end if;
 if occurred<(select occurred_at from public.sales_orders where id=oid)then raise exception 'invalid_payload'using errcode='22023';end if;
 if not private.manual_sale_cancellation_access()then raise exception 'membership_required'using errcode='42501';end if;
 insert into public.finance_entries(entry_date,entry_type,amount_eur,description,account_label,category,source_kind,created_by)
 values((occurred at time zone 'Europe/Rome')::date,'expense',(quote->>'refund_cents')::numeric/100,'Rimborso reso vendita · '||reason,base->>'refund_account','Vendite','manual_declaration',auth.uid())returning id into entry;
 insert into public.manual_sale_returns(order_id,operation_id,expected_version,refund_cents,finance_entry_id,product_quantity,box_quantity,sticker_quantity,occurred_at,reason,created_by)
 values(oid,p_operation_id,expected,(quote->>'refund_cents')::bigint,entry,(quote->>'product_quantity')::bigint,(quote->>'box_quantity')::bigint,(quote->>'sticker_quantity')::bigint,occurred,reason,auth.uid())returning id into rid;
 for raw in select value from jsonb_array_elements(quote->'lines')where(value->>'selected_quantity')::bigint>0 order by value->>'order_line_id'loop
  select * into strict l from public.sales_order_lines where id=(raw->>'order_line_id')::uuid;
  qty:=(raw->>'selected_quantity')::bigint;
  insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)
  values(gen_random_uuid(),l.stock_item_id,l.location_id,'adjustment',qty,reason,jsonb_build_object('kind','manual_sale_return','return_id',rid,'sales_order_id',oid,'sales_order_line_id',l.id),auth.uid())returning id into movement;
  insert into public.manual_sale_return_lines(return_id,order_line_id,quantity,refund_cents,stock_movement_id)values(rid,l.id,qty,(raw->>'refund_cents')::bigint,movement)returning id into return_line;
  remaining:=qty;
  for f in select z.*,z.quantity-coalesce((select sum(r.quantity)from public.manual_sale_return_fulfillments r where r.fulfillment_line_id=z.id),0)available from public.fulfillment_lines z where z.order_line_id=l.id order by z.fulfilled_at,z.id loop
   part:=least(remaining,f.available);if part<=0 then continue;end if;
   insert into public.manual_sale_return_fulfillments(return_line_id,fulfillment_line_id,quantity)values(return_line,f.id,part);
   update public.packaging_consumptions c set requested_quantity=greatest(c.consumed_quantity,c.requested_quantity-part),review_reason=case when c.consumed_quantity>=c.requested_quantity-part then null else c.review_reason end where c.source_kind='fulfillment'and c.source_id=f.id;
   remaining:=remaining-part;exit when remaining=0;
  end loop;
  if remaining<>0 then raise exception 'return_delivery_mismatch'using errcode='22023';end if;
 end loop;
 select * into config from public.packaging_automation where id;
 foreach material in array array[config.box_item_id,config.sticker_item_id]loop
  material_qty:=case when material=config.box_item_id then(quote->>'box_quantity')::bigint else(quote->>'sticker_quantity')::bigint end;
  if material_qty=0 or material is null then continue;end if;
  insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)
  values(gen_random_uuid(),material,config.location_id,'adjustment',material_qty,reason,jsonb_build_object('kind','manual_sale_return_packaging','return_id',rid,'sales_order_id',oid),auth.uid())returning id into movement;
  insert into public.manual_sale_return_packaging(return_id,stock_item_id,quantity,stock_movement_id)values(rid,material,material_qty,movement);
 end loop;
 result:=private.refresh_sale_order(oid)||jsonb_build_object('operation_id',p_operation_id,'return_id',rid,'refund_cents',(quote->>'refund_cents')::bigint,'product_quantity',(quote->>'product_quantity')::bigint,'box_quantity',(quote->>'box_quantity')::bigint,'sticker_quantity',(quote->>'sticker_quantity')::bigint,'replayed',false);
 if not private.manual_sale_cancellation_access()then raise exception 'membership_required'using errcode='42501';end if;
 insert into private.manual_sale_return_receipts(operation_id,actor_id,payload_sha256,result)values(p_operation_id,auth.uid(),digest,result);return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_payload'using errcode='22023';
end$$;


-- Keep Finance corrections and sale residuals on their common aggregate.
create or replace function private.finance_revision_original(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v jsonb; gone boolean:=false; parent uuid;
begin
  if p_kind='budgetflow' then
    select jsonb_build_object('date',transaction_date,'direction',case when amount_cents<0 then 'expense' else 'income' end,'amount_cents',abs(amount_cents),
      'account',account_label,'target_account',target_account_label,'category',nullif(raw_record->>'Category',''),
      'description',coalesce(nullif(raw_record->>'Payee',''),nullif(raw_record->>'Notes',''),'Movimento BudgetFlow'),'pending',pending)
      into v from public.finance_import_transactions where id=p_id;
  elsif p_kind='manual' then
    select jsonb_build_object('date',entry_date,'direction',entry_type,'amount_cents',amount_cents,'account',account_label,'target_account',null,
      'category',category,'description',coalesce(description,''),'pending',false),exists(select 1 from public.finance_entry_voids where finance_entry_id=p_id)
      into v,gone from public.finance_entries where id=p_id;
    select order_id into parent from public.manual_sale_returns where finance_entry_id=p_id;
  elsif p_kind='payment' then
    select jsonb_build_object('date',(occurred_at at time zone 'Europe/Rome')::date,'direction','income','amount_cents',amount_cents,
      'account',case when source_kind='manual_declaration' and method='cash' then 'Cash' else null end,'target_account',null,
      'category','Vendite','description',case when source_kind='shopify_observation' then 'Incasso Shopify osservato' else 'Incasso dichiarato da ordine' end,'pending',false),order_id
      into v,parent from public.order_payments where id=p_id;
  elsif p_kind='refund' then
    select jsonb_build_object('date',(occurred_at at time zone 'Europe/Rome')::date,'direction','expense','amount_cents',amount_cents,'account',null,'target_account',null,
      'category','Vendite','description','Rimborso Shopify osservato','pending',false),order_id into v,parent from public.shopify_refund_observations where id=p_id;
  elsif p_kind='consignment_settlement' then
    select jsonb_build_object('date',(occurred_at at time zone 'Europe/Rome')::date,'direction','income','amount_cents',amount_cents,
      'account',case when method='cash' then 'Cash' else null end,'target_account',null,'category','Vendite',
      'description','Incasso conto vendita · '||reference,'pending',false) into v from public.consignment_settlements where id=p_id;
  else raise exception 'invalid_finance_source' using errcode='22023';
  end if;
  if v is null then raise exception 'finance_source_not_found' using errcode='22023';end if;
  return jsonb_build_object('source_kind',p_kind,'source_id',p_id,'values',v,'deleted',gone,'order_id',parent);
end $$;

create or replace function private.effective_order_payment_summary(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare original public.sales_orders%rowtype; source record; revision public.finance_movement_revisions%rowtype;
  v jsonb; signed numeric; incoming numeric:=0; outgoing numeric:=0; net numeric; remaining numeric; n integer:=0; corrected boolean:=false; state text;
begin
  select * into original from public.sales_orders where id=p_order;
  if not found then raise exception 'finance_source_not_found' using errcode='22023';end if;
  for source in select 'payment'::text kind,id from public.order_payments where order_id=p_order
    union all select 'refund'::text,id from public.shopify_refund_observations where order_id=p_order
    union all select 'manual'::text,finance_entry_id from public.manual_sale_returns where order_id=p_order loop
    select * into revision from public.finance_movement_revisions where source_kind=source.kind and source_id=source.id order by version desc limit 1;
    if found then
      corrected:=true;if revision.deleted then continue;end if;v:=revision.value_snapshot;
    else
      v:=private.finance_revision_original(source.kind,source.id);if(v->>'deleted')::boolean then continue;end if;v:=v->'values';
    end if;
    if (v->>'pending')::boolean or (v->>'date')::date>(statement_timestamp() at time zone 'Europe/Rome')::date then continue;end if;
    signed:=(v->>'amount_cents')::numeric*case when v->>'direction'='expense' then -1 else 1 end;n:=n+1;
    if signed>=0 then incoming:=incoming+signed;else outgoing:=outgoing-signed;end if;
  end loop;
  if original.source_kind='shopify_canonical' and not corrected then
    -- A provider status is authoritative until an internal declaration exists.
    -- Missing/unsupported observations do not turn a canonical paid order unpaid.
    return jsonb_build_object('order_id',p_order,'source_kind',original.source_kind,'source_payment_state',original.payment_state,
      'payment_state',original.payment_state,'incoming_cents',null,'outgoing_cents',null,'net_cents',null,
      'amount_due_cents',null,'refund_due_cents',original.refund_due_cents::text,'corrected',false);
  end if;
  net:=incoming-outgoing;remaining:=original.total_cents-original.cancelled_cents-coalesce((select sum(refund_cents)from public.manual_sale_returns where order_id=p_order),0);
  if greatest(incoming,outgoing,abs(net),greatest(0,remaining-net),greatest(0,net-remaining))>9000000000000000 then
    raise exception 'effective_payment_limit' using errcode='22023';end if;
  state:=case when n=0 then 'unpaid' when outgoing>0 and net<=0 then 'refunded' when outgoing>0 then 'partially_refunded'
    when net>=remaining then 'paid' when net>0 then 'partially_paid' else 'unpaid' end;
  return jsonb_build_object('order_id',p_order,'source_kind',original.source_kind,'source_payment_state',original.payment_state,
    'payment_state',state,'incoming_cents',incoming::text,'outgoing_cents',outgoing::text,'net_cents',net::text,
    'amount_due_cents',greatest(0,remaining-net)::text,'refund_due_cents',greatest(0,net-remaining)::text,'corrected',corrected);
end $$;

create or replace function private.refresh_sale_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare total_qty bigint; fulfilled bigint; cancelled bigint; cancelled_amount bigint; returned bigint; returned_amount bigint; summary jsonb;
  order_record public.sales_orders%rowtype; state text; fulfillment text;
begin
  select * into strict order_record from public.sales_orders where id=p_order_id for update;
  if order_record.source_kind='manual_declaration'and not exists(select 1 from public.sales_registration_cancellations where order_id=p_order_id)then
    select coalesce(sum(quantity),0),coalesce(sum(fulfilled_quantity),0),coalesce(sum(cancelled_quantity),0),coalesce(sum(cancelled_amount_cents),0)
      into total_qty,fulfilled,cancelled,cancelled_amount from public.sales_order_lines where order_id=p_order_id;
    select coalesce(sum(product_quantity),0),coalesce(sum(refund_cents),0)into returned,returned_amount from public.manual_sale_returns where order_id=p_order_id;
    state:=case when returned>0 and cancelled+returned=total_qty then 'returned'when returned>0 then 'partially_returned'when cancelled=total_qty then 'cancelled' when cancelled>0 then 'partially_cancelled' else 'confirmed' end;
    fulfillment:=case when returned>0 and cancelled+returned=total_qty then 'returned'when returned>0 then 'partially_returned'when cancelled=total_qty then 'cancelled' when fulfilled=total_qty-cancelled then 'fulfilled' when fulfilled>0 then 'partial' else 'unfulfilled' end;
    -- Cancellation is recalculated before deriving the effective residual.
    update public.sales_orders set order_state=state,fulfillment_state=fulfillment,cancelled_cents=cancelled_amount where id=p_order_id;
    summary:=private.effective_order_payment_summary(p_order_id);
    update public.sales_orders set payment_state=summary->>'payment_state',refund_due_cents=(summary->>'refund_due_cents')::bigint where id=p_order_id returning * into order_record;
  end if;
  return jsonb_build_object('order_id',p_order_id,'order_state',order_record.order_state,'fulfillment_state',order_record.fulfillment_state,
    'payment_state',order_record.payment_state,'total_cents',order_record.total_cents,'cancelled_cents',order_record.cancelled_cents,
    'remaining_value_cents',order_record.total_cents-order_record.cancelled_cents-coalesce((select sum(refund_cents)from public.manual_sale_returns where order_id=p_order_id),0),'refund_due_cents',order_record.refund_due_cents);
end $$;

-- Cumulative cents remain exact whichever reduction happens first.
create or replace function private.cancel_unfulfilled_lines(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
<<cancellation_command>>
declare normalized jsonb; replay jsonb; raw_line jsonb; line public.sales_order_lines%rowtype; order_record public.sales_orders%rowtype;
  requirement public.production_requirements%rowtype; order_id uuid; qty bigint; cancel_production bigint; release_qty bigint;
  cancelled_amount bigint; fact_amount bigint:=0; occurred timestamptz; result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode='42501'; end if;
  normalized:=private.normalize_order_quantities(p_payload);
  replay:=private.start_sale_command(p_operation_id,'cancel_unfulfilled_lines',normalized); if replay is not null then return replay; end if;
  order_id:=(normalized->>'order_id')::uuid; occurred:=(normalized->>'occurred_at')::timestamptz;
  select * into order_record from public.sales_orders where id=order_id for update;
  if not found or occurred<order_record.occurred_at then raise exception 'invalid_payload' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(normalized->'lines') r where not exists(select 1 from public.sales_order_lines l where l.id=(r->>'order_line_id')::uuid and l.order_id=cancellation_command.order_id)) then raise exception 'invalid_payload' using errcode='22023'; end if;
  perform b.stock_item_id from public.stock_balances b join public.sales_order_lines l on l.stock_item_id=b.stock_item_id and l.location_id=b.location_id
    where l.order_id=cancellation_command.order_id and l.id in(select (value->>'order_line_id')::uuid from jsonb_array_elements(normalized->'lines'))
    order by b.stock_item_id,b.location_id for update of b;
  for raw_line in select value from jsonb_array_elements(normalized->'lines') loop
    select * into strict line from public.sales_order_lines where id=(raw_line->>'order_line_id')::uuid;
    qty:=(raw_line->>'quantity')::bigint;
    if qty>line.quantity-line.fulfilled_quantity-line.cancelled_quantity then raise exception 'unfulfilled_quantity_exceeded' using errcode='22023'; end if;
    select * into requirement from public.production_requirements where order_line_id=line.id for update;
    cancel_production:=0;
    if found then
      cancel_production:=least(qty,requirement.required_quantity-requirement.completed_quantity-requirement.cancelled_quantity);
      if cancel_production>0 then
        update public.production_requirements set cancelled_quantity=cancelled_quantity+cancel_production,
          status=case when completed_quantity+cancelled_quantity+cancel_production=required_quantity then case when completed_quantity=0 then 'cancelled' else 'satisfied' end else status end
          where id=requirement.id;
      end if;
    end if;
    release_qty:=qty-cancel_production;
    if release_qty>0 then insert into public.stock_reservation_events(operation_id,order_line_id,kind,quantity_delta,created_by) values(gen_random_uuid(),line.id,'release',-release_qty,auth.uid()); end if;
    -- Cumulative integer allocation avoids losing discount remainders across
    -- partial cancellations. Exact total cancellation always equals line total.
    cancelled_amount:=floor(line.line_total_cents::numeric*(line.cancelled_quantity+qty+coalesce((select sum(r.quantity)from public.manual_sale_return_lines r where r.order_line_id=line.id),0))/line.quantity)::bigint-coalesce((select sum(r.refund_cents)from public.manual_sale_return_lines r where r.order_line_id=line.id),0);
    fact_amount:=fact_amount+cancelled_amount-line.cancelled_amount_cents;
    update public.sales_order_lines set cancelled_quantity=cancelled_quantity+qty,cancelled_amount_cents=cancelled_amount where id=line.id;
  end loop;
  insert into public.commercial_facts(operation_id,order_id,fact_kind,amount_cents,occurred_at,created_by)
    values(gen_random_uuid(),order_id,'sale_cancellation_observed',fact_amount,occurred,auth.uid());
  result:=private.refresh_sale_order(order_id)||jsonb_build_object('operation_id',p_operation_id,'replayed',false);
  return private.finish_sale_command(p_operation_id,'cancel_unfulfilled_lines',normalized,result);
end
$$;

-- Recovery must not consume packaging for already returned units.
create or replace function private.observe_packaging_source(p_kind text,p_source uuid)returns void language plpgsql security definer set search_path='' as $$
declare config public.packaging_automation%rowtype;item uuid;quantity bigint;event_time timestamptz;inserted timestamptz;v_order_id uuid;order_time timestamptz;order_source text;allowed boolean:=true;material uuid;receipt uuid;
begin
 if p_kind='fulfillment'and exists(select 1 from public.fulfillment_lines f join public.sales_order_lines l on l.id=f.order_line_id join public.sales_registration_cancellations v on v.order_id=l.order_id where f.id=p_source)then return;end if;
 select * into config from public.packaging_automation where id;
 if config.started_at is null then return;end if;
 if p_kind='fulfillment' then
  select l.stock_item_id,f.quantity-coalesce((select sum(r.quantity)from public.manual_sale_return_fulfillments r where r.fulfillment_line_id=f.id),0),f.fulfilled_at,f.created_at,o.id,o.occurred_at,o.source_kind into item,quantity,event_time,inserted,v_order_id,order_time,order_source
   from public.fulfillment_lines f join public.sales_order_lines l on l.id=f.order_line_id join public.sales_orders o on o.id=l.order_id where f.id=p_source;
 elsif p_kind='consignment' then select s.stock_item_id,s.quantity,s.occurred_at,s.created_at into item,quantity,event_time,inserted from public.consignment_sales s where s.id=p_source;
  if not found then select m.stock_item_id,-m.quantity_delta,m.created_at,m.created_at into item,quantity,event_time,inserted from public.consignment_report_movements m where m.id=p_source and m.quantity_delta<0;end if;
 else raise exception 'invalid_packaging_source' using errcode='22023';end if;
 if not found or quantity<=0 or not private.is_packaged_tshirt(item)or inserted<config.started_at or event_time<config.started_at then return;end if;
 if p_kind='fulfillment'and order_source='shopify_canonical'and order_time<config.started_at and not exists(select 1 from private.packaging_activation_orders a where a.order_id=v_order_id)then allowed:=false;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packaging.consume',0));
 foreach material in array array[config.box_item_id,config.sticker_item_id]loop
  insert into public.packaging_consumptions(source_kind,source_id,stock_item_id,location_id,requested_quantity,automatic_allowed,review_reason)
   values(p_kind,p_source,material,config.location_id,quantity,allowed,case when allowed then null else 'historical_shopify_order' end)on conflict(source_kind,source_id,stock_item_id)do nothing;
  select id into strict receipt from public.packaging_consumptions where source_kind=p_kind and source_id=p_source and stock_item_id=material;
  perform private.drain_packaging_consumption(receipt);
 end loop;
end$$;

-- Linked Finance voids are serialized on the sale and refresh its projection.
create function private.lock_manual_sale_refund_void()returns trigger
language plpgsql security definer set search_path=''as $$declare parent uuid;begin
 select order_id into parent from public.manual_sale_returns where finance_entry_id=new.finance_entry_id;
 if parent is not null then
  perform 1 from public.sales_orders where id=parent for update;
  -- The legacy command validated these before the trigger could wait.
  -- P4 and grant/session expiry must be checked again under the sale lock.
  if not private.finance_revision_live_access()then raise exception 'finance_access_required'using errcode='42501';end if;
  if exists(select 1 from public.finance_movement_revisions r where r.source_kind='manual'and r.source_id=new.finance_entry_id)then raise exception 'use_finance_revisions'using errcode='22023';end if;
 end if;
 return new;
end$$;
create function private.refresh_manual_sale_refund_void()returns trigger
language plpgsql security definer set search_path=''as $$declare parent uuid;begin
 select order_id into parent from public.manual_sale_returns where finance_entry_id=new.finance_entry_id;
 if parent is not null then perform private.refresh_sale_order(parent);end if;
 return new;
end$$;
create trigger lock_sale_refund before insert on public.finance_entry_voids for each row execute function private.lock_manual_sale_refund_void();
create trigger refresh_sale_refund after insert on public.finance_entry_voids for each row execute function private.refresh_manual_sale_refund_void();

-- Existing sales command namespaces cannot reuse a completed return operation.
create function private.guard_manual_sale_return_operation()returns trigger
language plpgsql security definer set search_path=''as $$begin
 if exists(select 1 from public.manual_sale_returns where operation_id=new.operation_id)then raise exception 'idempotency_conflict'using errcode='22023';end if;
 return new;
end$$;
create trigger return_operation_conflict before insert on public.sales_orders for each row execute function private.guard_manual_sale_return_operation();
create trigger return_operation_conflict before insert on private.sales_command_receipts for each row execute function private.guard_manual_sale_return_operation();

create function public.preview_manual_sale_return(p_payload jsonb)returns jsonb
language sql volatile security invoker set search_path=''as $$select private.manual_sale_return_quote(p_payload)$$;
create function public.return_manual_sale_registration(p_operation_id uuid,p_payload jsonb)returns jsonb
language sql volatile security invoker set search_path=''as $$select private.return_manual_sale_registration(p_operation_id,p_payload)$$;
revoke all on function private.normalize_manual_sale_return(jsonb),private.manual_sale_return_quote(jsonb),private.return_manual_sale_registration(uuid,jsonb),private.lock_manual_sale_refund_void(),private.refresh_manual_sale_refund_void(),private.guard_manual_sale_return_operation(),public.preview_manual_sale_return(jsonb),public.return_manual_sale_registration(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function private.manual_sale_return_quote(jsonb),private.return_manual_sale_registration(uuid,jsonb),public.preview_manual_sale_return(jsonb),public.return_manual_sale_registration(uuid,jsonb)to authenticated;
commit;
