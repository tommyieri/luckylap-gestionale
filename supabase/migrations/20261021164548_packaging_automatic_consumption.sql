-- Forward only. Activation/opening counts require a separate owner command.
-- Applying the migration performs no seed or historical consumption.
begin;
create table public.packaging_automation (
 id boolean primary key default true check(id), location_id uuid references public.stock_locations(id),
 box_item_id uuid unique references public.packaging_items(stock_item_id), sticker_item_id uuid unique references public.packaging_items(stock_item_id),
 started_at timestamptz check(isfinite(started_at)),
 check(started_at is null or num_nonnulls(location_id,box_item_id,sticker_item_id)=3),
 check(box_item_id is distinct from sticker_item_id or box_item_id is null)
);
insert into public.packaging_automation(id)values(true);
create table private.packaging_activation_orders(order_id uuid primary key references public.sales_orders(id));
alter table private.packaging_activation_orders enable row level security;
revoke all on private.packaging_activation_orders from public,anon,authenticated,service_role;
create table public.packaging_consumptions (
 id uuid primary key default gen_random_uuid(), source_kind text not null check(source_kind in('fulfillment','consignment')),source_id uuid not null,
 stock_item_id uuid not null references public.packaging_items(stock_item_id),location_id uuid not null references public.stock_locations(id),
 requested_quantity bigint not null check(requested_quantity between 1 and 100000),
 consumed_quantity bigint not null default 0 check(consumed_quantity>=0 and consumed_quantity<=requested_quantity),
 automatic_allowed boolean not null default true,review_reason text,
 reviewed_reason text check(reviewed_reason is null or char_length(btrim(reviewed_reason)) between 3 and 500),
 created_at timestamptz not null default now(),unique(source_kind,source_id,stock_item_id)
);
create index packaging_consumption_pending on public.packaging_consumptions(stock_item_id,created_at,id)where consumed_quantity<requested_quantity;
create table public.packaging_consumption_entries (
 id uuid primary key default gen_random_uuid(),consumption_id uuid not null references public.packaging_consumptions(id),
 quantity bigint not null check(quantity>0),movement_id uuid not null unique references public.stock_movements(id),created_at timestamptz not null default now()
);
create index packaging_consumption_entries_receipt on public.packaging_consumption_entries(consumption_id);
create trigger packaging_entries_append_only before update or delete on public.packaging_consumption_entries for each row execute function private.reject_ledger_mutation();
-- No audit dependency here: a packaging exception must not abort the source sale.
create table public.packaging_automation_failures (
 id uuid primary key default gen_random_uuid(),source_kind text not null check(source_kind in('fulfillment','consignment')),
 source_id uuid not null,error_code text not null,resolved boolean not null default false,created_at timestamptz not null default now(),unique(source_kind,source_id)
);
do $$declare t text;begin
 foreach t in array array['packaging_automation','packaging_consumptions','packaging_consumption_entries','packaging_automation_failures']loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy packaging_member_read on public.%I for select to authenticated using((select private.is_member()))',t);
  if t<>'packaging_automation_failures' then execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',t);end if;
 end loop;
end$$;
create function private.is_packaged_tshirt(p_item uuid)returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.product_variants v join public.products p on p.id=v.product_id join public.stock_items s on s.id=v.stock_item_id where s.id=p_item and s.kind='product' and p.category='T-shirt')
$$;
-- One lock orders all automatic/recovery material debits consistently.
create function private.drain_packaging_consumption(p_id uuid)returns void language plpgsql security definer set search_path='' as $$
declare receipt public.packaging_consumptions%rowtype;physical bigint;protected bigint;debit bigint;movement uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packaging.consume',0));
 select * into strict receipt from public.packaging_consumptions where id=p_id for update;
 if not receipt.automatic_allowed or receipt.consumed_quantity=receipt.requested_quantity then return;end if;
 select quantity into physical from public.stock_balances where stock_item_id=receipt.stock_item_id and location_id=receipt.location_id for update;
 if not found or physical is null then update public.packaging_consumptions set review_reason='unknown_packaging_stock' where id=p_id;return;end if;
 select coalesce(sum(reserved_quantity),0)into protected from public.stock_reservations where stock_item_id=receipt.stock_item_id and location_id=receipt.location_id;
 debit:=least(receipt.requested_quantity-receipt.consumed_quantity,greatest(0,physical-protected));
 if debit>0 then
  insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)
   values(gen_random_uuid(),receipt.stock_item_id,receipt.location_id,'adjustment',-debit,'Confezionamento T-shirt: consumo packaging',jsonb_build_object('kind','packaging_consumption','packaging_consumption_id',p_id,'source_kind',receipt.source_kind,'source_id',receipt.source_id),auth.uid())returning id into movement;
  insert into public.packaging_consumption_entries(consumption_id,quantity,movement_id)values(p_id,debit,movement);
  update public.packaging_consumptions set consumed_quantity=consumed_quantity+debit,review_reason=case when consumed_quantity+debit=requested_quantity then null else 'insufficient_packaging' end where id=p_id;
 else update public.packaging_consumptions set review_reason='insufficient_packaging' where id=p_id;end if;
end$$;
create function private.observe_packaging_source(p_kind text,p_source uuid)returns void language plpgsql security definer set search_path='' as $$
declare config public.packaging_automation%rowtype;item uuid;quantity bigint;event_time timestamptz;inserted timestamptz;v_order_id uuid;order_time timestamptz;order_source text;allowed boolean:=true;material uuid;receipt uuid;
begin
 select * into config from public.packaging_automation where id;
 if config.started_at is null then return;end if;
 if p_kind='fulfillment' then
  select l.stock_item_id,f.quantity,f.fulfilled_at,f.created_at,o.id,o.occurred_at,o.source_kind into item,quantity,event_time,inserted,v_order_id,order_time,order_source
   from public.fulfillment_lines f join public.sales_order_lines l on l.id=f.order_line_id join public.sales_orders o on o.id=l.order_id where f.id=p_source;
 elsif p_kind='consignment' then select s.stock_item_id,s.quantity,s.occurred_at,s.created_at into item,quantity,event_time,inserted from public.consignment_sales s where s.id=p_source;
 else raise exception 'invalid_packaging_source' using errcode='22023';end if;
 if not found or not private.is_packaged_tshirt(item)or inserted<config.started_at or event_time<config.started_at then return;end if;
 if p_kind='fulfillment'and order_source='shopify_canonical'and order_time<config.started_at and not exists(select 1 from private.packaging_activation_orders a where a.order_id=v_order_id)then allowed:=false;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packaging.consume',0));
 foreach material in array array[config.box_item_id,config.sticker_item_id]loop
  insert into public.packaging_consumptions(source_kind,source_id,stock_item_id,location_id,requested_quantity,automatic_allowed,review_reason)
   values(p_kind,p_source,material,config.location_id,quantity,allowed,case when allowed then null else 'historical_shopify_order' end)on conflict(source_kind,source_id,stock_item_id)do nothing;
  select id into strict receipt from public.packaging_consumptions where source_kind=p_kind and source_id=p_source and stock_item_id=material;
  perform private.drain_packaging_consumption(receipt);
 end loop;
end$$;
create function private.observe_packaging_trigger()returns trigger language plpgsql security definer set search_path='' as $$
declare kind text:=case when tg_table_name='fulfillment_lines' then 'fulfillment' else 'consignment' end;
begin
 begin perform private.observe_packaging_source(kind,new.id);
 exception when others then insert into public.packaging_automation_failures(source_kind,source_id,error_code)values(kind,new.id,sqlstate)on conflict(source_kind,source_id)do nothing;end;
 return new;
end$$;
create trigger observe_packaging after insert on public.fulfillment_lines for each row execute function private.observe_packaging_trigger();
create trigger observe_packaging after insert on public.consignment_sales for each row execute function private.observe_packaging_trigger();
-- Demand reservations never impose a blocking physical-stock constraint.
create view public.packaging_material_status with(security_invoker=true)as
with demand as(
 select coalesce(sum(l.quantity-l.fulfilled_quantity-l.cancelled_quantity),0)::bigint quantity from public.sales_order_lines l join public.sales_orders o on o.id=l.order_id
 join public.product_variants v on v.stock_item_id=l.stock_item_id join public.products p on p.id=v.product_id where p.category='T-shirt'and o.order_state<>'cancelled'
),deficits as(
 select stock_item_id,sum(requested_quantity-consumed_quantity)::bigint quantity,sum(case when automatic_allowed then requested_quantity-consumed_quantity else 0 end)::bigint reconcilable,
 sum(case when not automatic_allowed then requested_quantity-consumed_quantity else 0 end)::bigint needs_review from public.packaging_consumptions group by stock_item_id
)
select s.id stock_item_id,s.name,s.sku,p.packaging_type,p.specifications,s.unit_cost_eur,a.location_id,a.started_at,b.quantity on_hand,d.quantity reserved,
 case when b.quantity is null then null else b.quantity-d.quantity end unreserved,
 coalesce(x.quantity,0)::bigint consumption_deficit,coalesce(x.reconcilable,0)::bigint reconcilable_deficit,coalesce(x.needs_review,0)::bigint historical_review,
 (select count(*)::bigint from public.packaging_automation_failures where not resolved)automation_failures
from public.packaging_automation a join public.stock_items s on s.id in(a.box_item_id,a.sticker_item_id)join public.packaging_items p on p.stock_item_id=s.id
left join public.stock_balances b on b.stock_item_id=s.id and b.location_id=a.location_id cross join demand d left join deficits x on x.stock_item_id=s.id where a.id and a.started_at is not null;
revoke all on public.packaging_material_status from public,anon,authenticated,service_role;
grant select on public.packaging_material_status to authenticated;
create table private.packaging_inventory_receipts(operation_id uuid primary key,kind text not null,actor_id uuid not null,payload_sha256 text not null,result jsonb not null,created_at timestamptz not null default now());
alter table private.packaging_inventory_receipts enable row level security;
revoke all on private.packaging_inventory_receipts from public,anon,authenticated,service_role;
create trigger packaging_inventory_receipts_append_only before update or delete on private.packaging_inventory_receipts for each row execute function private.reject_ledger_mutation();
create function private.packaging_inventory_command(p_operation_id uuid,p_kind text,p_payload jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare previous private.packaging_inventory_receipts%rowtype;digest text;config public.packaging_automation%rowtype;item uuid;expected bigint;quantity bigint;physical bigint;reason text;movement uuid;entry record;result jsonb;pending bigint;
begin
 if auth.uid()is null or not private.is_member()then raise exception 'membership_required'using errcode='42501';end if;
 if p_operation_id is null or p_kind not in('adjust','reconcile')then raise exception 'invalid_payload'using errcode='22023';end if;
 if p_kind='adjust'then
  perform private.sale_object(p_payload,array['schema_version','stock_item_id','expected_quantity','quantity','reason'],array['schema_version','stock_item_id','expected_quantity','quantity','reason']);perform private.sale_integer(p_payload->'schema_version',1,1);
  if jsonb_typeof(p_payload->'stock_item_id')is distinct from 'string'or jsonb_typeof(p_payload->'reason')is distinct from 'string'then raise exception 'invalid_payload'using errcode='22023';end if;
  item:=(p_payload->>'stock_item_id')::uuid;quantity:=private.sale_integer(p_payload->'quantity',0,1000000000);
  if p_payload->'expected_quantity'<>'null'::jsonb then expected:=private.sale_integer(p_payload->'expected_quantity',0,1000000000);end if;
  reason:=btrim(p_payload->>'reason');if char_length(reason)not between 3 and 500 then raise exception 'invalid_payload'using errcode='22023';end if;
  p_payload:=jsonb_build_object('schema_version',1,'stock_item_id',item,'expected_quantity',expected,'quantity',quantity,'reason',reason);
 else perform private.sale_object(p_payload,array['schema_version'],array['schema_version']);perform private.sale_integer(p_payload->'schema_version',1,1);end if;
 digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packaging.command.'||p_operation_id::text,0));
 select * into previous from private.packaging_inventory_receipts where operation_id=p_operation_id;
 if found then
  if previous.actor_id<>auth.uid()or previous.kind<>p_kind or previous.payload_sha256<>digest then raise exception 'idempotency_conflict'using errcode='22023';end if;
  return previous.result||'{"replayed":true}'::jsonb;
 end if;
 if not exists(select 1 from public.app_settings where id and stock_adjustments_enabled)then raise exception 'stock_mutations_disabled'using errcode='42501';end if;
 select * into config from public.packaging_automation where id;
 if config.started_at is null then raise exception 'packaging_not_active'using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packaging.consume',0));
 if p_kind='adjust'then
  if item not in(config.box_item_id,config.sticker_item_id)then raise exception 'unknown_packaging'using errcode='22023';end if;
  select b.quantity into physical from public.stock_balances b where stock_item_id=item and location_id=config.location_id for update;
  if physical is distinct from expected then raise exception 'packaging_quantity_changed'using errcode='22023';end if;
  if physical=quantity then raise exception 'quantity_unchanged'using errcode='22023';end if;
  if physical is null then insert into public.stock_balances(stock_item_id,location_id,quantity)values(item,config.location_id,null)on conflict do nothing;end if;
  insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)
   values(gen_random_uuid(),item,config.location_id,case when physical is null then 'opening'::public.stock_movement_kind else 'adjustment'::public.stock_movement_kind end,case when physical is null then quantity else quantity-physical end,reason,jsonb_build_object('packaging_operation_id',p_operation_id,'kind','packaging_manual_count'),auth.uid())returning id into movement;
 else
  for entry in select source_kind,source_id,id from public.packaging_automation_failures where not resolved order by created_at,id loop
   begin perform private.observe_packaging_source(entry.source_kind,entry.source_id);update public.packaging_automation_failures set resolved=true where id=entry.id;exception when others then null;end;
  end loop;
  for entry in select id from public.packaging_consumptions where automatic_allowed and consumed_quantity<requested_quantity order by created_at,id loop perform private.drain_packaging_consumption(entry.id);end loop;
 end if;
 select coalesce(sum(requested_quantity-consumed_quantity),0)::bigint into pending from public.packaging_consumptions;
 result:=jsonb_build_object('operation_id',p_operation_id,'stock_item_id',item,'movement_id',movement,'remaining_deficit',pending,'replayed',false);
 insert into private.packaging_inventory_receipts(operation_id,kind,actor_id,payload_sha256,result)values(p_operation_id,p_kind,auth.uid(),digest,result);return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_payload'using errcode='22023';
end$$;
create function public.adjust_packaging_quantity(p_operation_id uuid,p_payload jsonb)returns jsonb language sql security invoker set search_path=''as $$select private.packaging_inventory_command(p_operation_id,'adjust',p_payload)$$;
create function public.reconcile_packaging_consumption(p_operation_id uuid,p_payload jsonb)returns jsonb language sql security invoker set search_path=''as $$select private.packaging_inventory_command(p_operation_id,'reconcile',p_payload)$$;
-- Owner-only historical review; never invoked by triggers or bulk retries.
create function private.approve_packaging_review(p_receipt_id uuid,p_reason text)returns void language plpgsql security definer set search_path=''as $$begin
 if p_reason is null or char_length(btrim(p_reason))not between 3 and 500 then raise exception 'invalid_review_reason'using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packaging.consume',0));
 update public.packaging_consumptions set automatic_allowed=true,reviewed_reason=btrim(p_reason),review_reason=null where id=p_receipt_id;
 if not found then raise exception 'unknown_packaging_receipt'using errcode='22023';end if;perform private.drain_packaging_consumption(p_receipt_id);
end$$;
-- Explicit owner bootstrap. Repeated calls never reset stock or move the cutoff.
create function private.activate_tshirt_packaging()returns jsonb language plpgsql security definer set search_path=''as $$
declare config public.packaging_automation%rowtype;location uuid;material uuid;physical bigint;v_role text;v_sku text;v_name text;v_specs text;box uuid;sticker uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packaging.consume',0));select * into strict config from public.packaging_automation where id for update;
 if config.started_at is not null then return to_jsonb(config)||'{"replayed":true}'::jsonb;end if;
 select id into location from public.stock_locations where code='MAG01'and active and location_type='Magazzino';
 if location is null then raise exception 'packaging_central_location_required'using errcode='22023';end if;
 foreach v_role in array array['box','sticker']loop
  v_sku:=case when v_role='box'then 'PACK-TSHIRT-BOX'else 'PACK-BOX-STICKER'end;v_name:=case when v_role='box'then 'Scatola T-shirt'else 'Adesivo per scatola'end;v_specs:=case when v_role='box'then '30 × 22,5 × 2,5 cm'else null end;
  select id into material from public.stock_items where sku=v_sku;
  if material is null then
   insert into public.stock_items(kind,sku,name,unit_cost_eur,list_price_eur,source)values('packaging',v_sku,v_name,null,null,'{"entry_method":"user_authorized_packaging_count"}')returning id into material;
   insert into public.packaging_items(stock_item_id,packaging_type,specifications)values(material,v_role,v_specs);
  elsif not exists(select 1 from public.stock_items s join public.packaging_items p on p.stock_item_id=s.id where s.id=material and s.kind='packaging'and s.name=v_name and p.packaging_type=v_role)then raise exception 'packaging_material_conflict'using errcode='22023';end if;
  insert into public.stock_balances(stock_item_id,location_id,quantity)values(material,location,null)on conflict do nothing;select quantity into physical from public.stock_balances where stock_item_id=material and location_id=location for update;
  if physical is null then
   insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)values(gen_random_uuid(),material,location,'opening',100,'Conta iniziale packaging autorizzata: 100 unità','{"entry_method":"user_authorized_packaging_count"}',auth.uid());
  elsif physical<>100 then raise exception 'packaging_initial_count_conflict'using errcode='22023';end if;
  if v_role='box'then box:=material;else sticker:=material;end if;
 end loop;
 insert into private.packaging_activation_orders(order_id)
  select o.id from public.sales_orders o where o.order_state<>'cancelled'and exists(
   select 1 from public.sales_order_lines l where l.order_id=o.id and l.quantity>l.fulfilled_quantity+l.cancelled_quantity and private.is_packaged_tshirt(l.stock_item_id));
 update public.packaging_automation set location_id=location,box_item_id=box,sticker_item_id=sticker,started_at=clock_timestamp()where id returning * into config;
 return to_jsonb(config)||'{"replayed":false}'::jsonb;
end$$;
revoke all on function private.is_packaged_tshirt(uuid),private.drain_packaging_consumption(uuid),private.observe_packaging_source(text,uuid),private.observe_packaging_trigger(),private.packaging_inventory_command(uuid,text,jsonb),private.approve_packaging_review(uuid,text),private.activate_tshirt_packaging()from public,anon,authenticated,service_role;
grant execute on function private.packaging_inventory_command(uuid,text,jsonb)to authenticated;
revoke all on function public.adjust_packaging_quantity(uuid,jsonb),public.reconcile_packaging_consumption(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.adjust_packaging_quantity(uuid,jsonb),public.reconcile_packaging_consumption(uuid,jsonb)to authenticated;
commit;
