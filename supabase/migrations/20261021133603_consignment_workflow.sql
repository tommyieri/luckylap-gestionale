-- Physical consignment is separate from Shopify availability and direct orders.
begin;
alter type public.stock_movement_kind add value if not exists 'transfer_out';
alter type public.stock_movement_kind add value if not exists 'transfer_in';
alter type public.stock_movement_kind add value if not exists 'consignment_sale';

create table public.consignment_transfers (
  id uuid primary key, stock_item_id uuid not null references public.stock_items(id),
  from_location_id uuid not null references public.stock_locations(id), to_location_id uuid not null references public.stock_locations(id),
  quantity integer not null check(quantity between 1 and 100000), reason text not null check(char_length(reason) between 3 and 500),
  occurred_at timestamptz not null check(isfinite(occurred_at)),
  out_movement_id uuid not null unique references public.stock_movements(id), in_movement_id uuid not null unique references public.stock_movements(id),
  created_by uuid not null references public.profiles(user_id), created_at timestamptz not null default now(), check(from_location_id<>to_location_id)
);
create table public.consignment_sales (
  id uuid primary key, stock_item_id uuid not null references public.stock_items(id), location_id uuid not null references public.stock_locations(id),
  sku_snapshot text not null, quantity integer not null check(quantity between 1 and 100000),
  shop_domain text not null, variant_gid text not null, catalog_observed_at timestamptz not null,
  web_price_cents bigint not null check(web_price_cents>=0), unit_shop_price_cents bigint not null check(unit_shop_price_cents=web_price_cents+1000),
  gross_cents bigint not null check(gross_cents between 0 and 9000000000000000 and gross_cents=unit_shop_price_cents*quantity),
  brand_claim_cents bigint not null check(brand_claim_cents>=0), shop_share_cents bigint not null check(shop_share_cents>=0),
  unit_cost_cents bigint check(unit_cost_cents>=0), external_reference text not null check(char_length(external_reference) between 1 and 240),
  reason text not null check(char_length(reason) between 3 and 500), occurred_at timestamptz not null check(isfinite(occurred_at)),
  movement_id uuid not null unique references public.stock_movements(id), created_by uuid not null references public.profiles(user_id), created_at timestamptz not null default now(),
  unique(location_id,external_reference), check(brand_claim_cents+shop_share_cents=gross_cents),
  check(brand_claim_cents=round(gross_cents::numeric*60/100)::bigint)
);
create table public.consignment_settlements (
  id uuid primary key, sale_id uuid not null references public.consignment_sales(id), amount_cents bigint not null check(amount_cents between 1 and 9000000000000000),
  occurred_at timestamptz not null check(isfinite(occurred_at)), method text not null check(method in ('bank_transfer','cash','other')),
  reference text not null check(char_length(reference) between 1 and 240), created_by uuid not null references public.profiles(user_id), created_at timestamptz not null default now(),
  unique(sale_id,reference)
);
create index consignment_transfer_item on public.consignment_transfers(stock_item_id);
create index consignment_transfer_from on public.consignment_transfers(from_location_id);
create index consignment_transfer_to on public.consignment_transfers(to_location_id);
create index consignment_transfer_creator on public.consignment_transfers(created_by);
create index consignment_sale_item on public.consignment_sales(stock_item_id);
create index consignment_sale_creator on public.consignment_sales(created_by);
create index consignment_settlement_creator on public.consignment_settlements(created_by);

do $$declare t text;begin
  foreach t in array array['consignment_transfers','consignment_sales','consignment_settlements'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy consignment_read on public.%I for select to authenticated using ((select private.%I()))',t,case when t='consignment_settlements' then 'can_finance' else 'is_member' end);
    execute format('create trigger consignment_append_only before update or delete on public.%I for each row execute function private.reject_ledger_mutation()',t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
  end loop;
end$$;
create table private.consignment_receipts (
  operation_id uuid primary key, command_kind text not null, actor_id uuid not null references public.profiles(user_id),
  payload_sha256 text not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table private.consignment_receipts enable row level security;
revoke all on private.consignment_receipts from public,anon,authenticated;
create trigger consignment_receipts_append_only before update or delete on private.consignment_receipts for each row execute function private.reject_ledger_mutation();

create function private.start_consignment(p_operation_id uuid,p_kind text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old private.consignment_receipts%rowtype; digest text;
begin
  if auth.uid() is null or not private.is_member() then raise exception 'membership_required' using errcode='42501';end if;
  if p_kind='record_consignment_settlement' and not private.can_finance() then raise exception 'finance_access_required' using errcode='42501';end if;
  if p_operation_id is null then raise exception 'invalid_payload' using errcode='22023';end if;
  digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.consignment.'||p_operation_id::text,0));
  select * into old from private.consignment_receipts where operation_id=p_operation_id;
  if found then
    if old.actor_id<>auth.uid() or old.command_kind<>p_kind or old.payload_sha256<>digest then raise exception 'idempotency_conflict' using errcode='22023';end if;
    return old.result||'{"replayed":true}'::jsonb;
  end if;
  if p_kind in ('transfer_consignment_stock','register_consignment_sale') and not exists(select 1 from public.app_settings where id and stock_adjustments_enabled) then raise exception 'stock_mutations_disabled' using errcode='42501';end if;
  if p_kind='register_consignment_sale' and not exists(select 1 from public.app_settings where id and manual_sales_enabled and sales_started_at is not null) then raise exception 'sales_disabled' using errcode='42501';end if;
  return null;
end$$;
create function private.finish_consignment(p_operation_id uuid,p_kind text,p_payload jsonb,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$begin
  insert into private.consignment_receipts(operation_id,command_kind,actor_id,payload_sha256,result)values(p_operation_id,p_kind,auth.uid(),encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),p_result);return p_result;
end$$;
create function private.consignment_date(p_value jsonb) returns timestamptz
language plpgsql stable security invoker set search_path='' as $$declare v timestamptz;begin
  if jsonb_typeof(p_value) is distinct from 'string' then raise exception 'invalid_payload' using errcode='22023';end if;
  if (p_value#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.+(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'invalid_date' using errcode='22023';end if;
  v:=(p_value#>>'{}')::timestamptz;
  if not isfinite(v) or v>now()+interval '5 minutes' then raise exception 'invalid_date' using errcode='22023';end if;return v;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'invalid_date' using errcode='22023';end$$;
create function private.consignment_text(p_value jsonb,p_min integer,p_max integer) returns text
language plpgsql immutable security invoker set search_path='' as $$declare v text;begin
  if jsonb_typeof(p_value) is distinct from 'string' then raise exception 'invalid_payload' using errcode='22023';end if;
  v:=btrim(p_value#>>'{}');if char_length(v) not between p_min and p_max or v~'[[:cntrl:]]' then raise exception 'invalid_payload' using errcode='22023';end if;return v;
end$$;
create function private.require_consignment_tshirt(p_item uuid) returns void
language plpgsql security definer set search_path='' as $$begin
  perform s.id from public.stock_items s join public.product_variants v on v.stock_item_id=s.id join public.products p on p.id=v.product_id
    where s.id=p_item and s.kind='product' and s.active and p.category='T-shirt' for share of s,v,p;
  if not found then raise exception 'invalid_tshirt' using errcode='22023';end if;
end$$;
create function private.transfer_consignment_stock(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item uuid;src uuid;dst uuid;qty bigint;why text;at_time timestamptz;canonical jsonb;replay jsonb;src_type text;dst_type text;balance bigint;out_id uuid;in_id uuid;result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode='42501';end if;
  perform private.sale_object(p_payload,array['schema_version','stock_item_id','from_location_id','to_location_id','quantity','reason','occurred_at'],array['schema_version','stock_item_id','from_location_id','to_location_id','quantity','reason','occurred_at']);
  perform private.sale_integer(p_payload->'schema_version',1,1);
  item:=private.consignment_text(p_payload->'stock_item_id',36,36)::uuid;src:=private.consignment_text(p_payload->'from_location_id',36,36)::uuid;dst:=private.consignment_text(p_payload->'to_location_id',36,36)::uuid;
  qty:=private.sale_integer(p_payload->'quantity',1,100000);why:=private.consignment_text(p_payload->'reason',3,500);at_time:=private.consignment_date(p_payload->'occurred_at');
  canonical:=jsonb_build_object('schema_version',1,'stock_item_id',item,'from_location_id',src,'to_location_id',dst,'quantity',qty,'reason',why,'occurred_at',at_time);
  replay:=private.start_consignment(p_operation_id,'transfer_consignment_stock',canonical);if replay is not null then return replay;end if;
  perform private.require_consignment_tshirt(item);
  perform id from public.stock_locations where id in(src,dst) order by id for share;
  select location_type into src_type from public.stock_locations where id=src and active;select location_type into dst_type from public.stock_locations where id=dst and active;
  if src=dst or not ((src_type='Magazzino' and dst_type='Negozio Conto Vendita') or(src_type='Negozio Conto Vendita' and dst_type='Magazzino')) or src_type is null or dst_type is null then raise exception 'invalid_location' using errcode='22023';end if;
  -- Same item + sorted location keys prevent opposite transfers locking in reverse order.
  perform location_id from public.stock_balances where stock_item_id=item and location_id in(src,dst) order by location_id for update;
  if (select count(*) from public.stock_balances where stock_item_id=item and location_id in(src,dst) and quantity is not null)<>2 then raise exception 'unknown_stock' using errcode='22023';end if;
  select quantity into balance from public.stock_balances where stock_item_id=item and location_id=src;
  if balance-coalesce((select sum(reserved_quantity) from public.stock_reservations where stock_item_id=item and location_id=src),0)<qty then raise exception 'insufficient_stock' using errcode='22023';end if;
  insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)values(gen_random_uuid(),item,src,'transfer_out',-qty,why,jsonb_build_object('consignment_operation_id',p_operation_id,'occurred_at',at_time),auth.uid())returning id into out_id;
  insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)values(gen_random_uuid(),item,dst,'transfer_in',qty,why,jsonb_build_object('consignment_operation_id',p_operation_id,'occurred_at',at_time),auth.uid())returning id into in_id;
  insert into public.consignment_transfers(id,stock_item_id,from_location_id,to_location_id,quantity,reason,occurred_at,out_movement_id,in_movement_id,created_by)values(p_operation_id,item,src,dst,qty,why,at_time,out_id,in_id,auth.uid());
  result:=jsonb_build_object('operation_id',p_operation_id,'transfer_id',p_operation_id,'replayed',false);return private.finish_consignment(p_operation_id,'transfer_consignment_stock',canonical,result);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_payload' using errcode='22023';end$$;

create function private.register_consignment_sale(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item uuid;loc uuid;qty bigint;why text;ref text;at_time timestamptz;domain text;variant text;expected bigint;observed timestamptz;canonical jsonb;replay jsonb;catalog public.shopify_catalog_variants%rowtype;balance bigint;cost bigint;v_sku text;gross numeric;claim bigint;move uuid;result jsonb;cutover timestamptz;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode='42501';end if;
  perform private.sale_object(p_payload,array['schema_version','stock_item_id','location_id','quantity','reason','external_reference','occurred_at','shop_domain','variant_gid','expected_web_price_cents','expected_catalog_observed_at'],array['schema_version','stock_item_id','location_id','quantity','reason','external_reference','occurred_at','shop_domain','variant_gid','expected_web_price_cents','expected_catalog_observed_at']);
  perform private.sale_integer(p_payload->'schema_version',1,1);item:=private.consignment_text(p_payload->'stock_item_id',36,36)::uuid;loc:=private.consignment_text(p_payload->'location_id',36,36)::uuid;qty:=private.sale_integer(p_payload->'quantity',1,100000);
  why:=private.consignment_text(p_payload->'reason',3,500);ref:=private.consignment_text(p_payload->'external_reference',1,240);at_time:=private.consignment_date(p_payload->'occurred_at');domain:=private.consignment_text(p_payload->'shop_domain',1,120);variant:=private.consignment_text(p_payload->'variant_gid',1,120);
  expected:=private.sale_integer(p_payload->'expected_web_price_cents',0,99999999999999);observed:=private.consignment_date(p_payload->'expected_catalog_observed_at');
  canonical:=jsonb_build_object('schema_version',1,'stock_item_id',item,'location_id',loc,'quantity',qty,'reason',why,'external_reference',ref,'occurred_at',at_time,'shop_domain',domain,'variant_gid',variant,'expected_web_price_cents',expected,'expected_catalog_observed_at',observed);
  replay:=private.start_consignment(p_operation_id,'register_consignment_sale',canonical);if replay is not null then return replay;end if;
  select sales_started_at into cutover from public.app_settings where id;if at_time<cutover then raise exception 'before_cutover' using errcode='22023';end if;
  perform private.require_consignment_tshirt(item);
  perform id from public.stock_locations where id=loc and active and location_type='Negozio Conto Vendita' for share;if not found then raise exception 'invalid_location' using errcode='22023';end if;
  select s.sku,(s.unit_cost_eur*100)::bigint into v_sku,cost from public.stock_items s where s.id=item;
  select * into catalog from public.shopify_catalog_variants c where c.shop_domain=domain and c.variant_gid=variant and c.stock_item_id=item and c.sku=v_sku and c.status='ACTIVE' and c.currency_code='EUR' and c.product_type='T-shirt' for share;
  if not found then raise exception 'unmatched_catalog' using errcode='22023';end if;
  if catalog.price_cents<>expected or catalog.observed_at<>observed then raise exception 'catalog_changed' using errcode='22023';end if;
  gross:=(catalog.price_cents::numeric+1000)*qty;if gross>9000000000000000 then raise exception 'invalid_payload' using errcode='22023';end if;claim:=round(gross*60/100)::bigint;
  select quantity into balance from public.stock_balances where stock_item_id=item and location_id=loc for update;if not found or balance is null then raise exception 'unknown_stock' using errcode='22023';end if;
  if balance-coalesce((select sum(reserved_quantity) from public.stock_reservations where stock_item_id=item and location_id=loc),0)<qty then raise exception 'insufficient_stock' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.consignment.reference.'||loc::text||'.'||ref,0));
  if exists(select 1 from public.consignment_sales where location_id=loc and external_reference=ref)then raise exception 'duplicate_reference' using errcode='23505';end if;
  insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)values(gen_random_uuid(),item,loc,'consignment_sale',-qty,why,jsonb_build_object('consignment_sale_id',p_operation_id,'occurred_at',at_time),auth.uid())returning id into move;
  insert into public.consignment_sales(id,stock_item_id,location_id,sku_snapshot,quantity,shop_domain,variant_gid,catalog_observed_at,web_price_cents,unit_shop_price_cents,gross_cents,brand_claim_cents,shop_share_cents,unit_cost_cents,external_reference,reason,occurred_at,movement_id,created_by)
    values(p_operation_id,item,loc,v_sku,qty,domain,variant,catalog.observed_at,catalog.price_cents,catalog.price_cents+1000,gross::bigint,claim,gross::bigint-claim,cost,ref,why,at_time,move,auth.uid());
  result:=jsonb_build_object('operation_id',p_operation_id,'sale_id',p_operation_id,'replayed',false);return private.finish_consignment(p_operation_id,'register_consignment_sale',canonical,result);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_payload' using errcode='22023';end$$;

create function private.record_consignment_settlement(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sale uuid;amount bigint;at_time timestamptz;method text;ref text;canonical jsonb;replay jsonb;claim bigint;sold_at timestamptz;paid bigint;result jsonb;
begin
  if not private.can_finance() then raise exception 'finance_access_required' using errcode='42501';end if;
  perform private.sale_object(p_payload,array['schema_version','sale_id','amount_cents','occurred_at','method','reference'],array['schema_version','sale_id','amount_cents','occurred_at','method','reference']);
  perform private.sale_integer(p_payload->'schema_version',1,1);sale:=private.consignment_text(p_payload->'sale_id',36,36)::uuid;amount:=private.sale_integer(p_payload->'amount_cents',1,9000000000000000);at_time:=private.consignment_date(p_payload->'occurred_at');method:=private.consignment_text(p_payload->'method',1,20);ref:=private.consignment_text(p_payload->'reference',1,240);
  if method not in('bank_transfer','cash','other')then raise exception 'invalid_payload' using errcode='22023';end if;
  canonical:=jsonb_build_object('schema_version',1,'sale_id',sale,'amount_cents',amount,'occurred_at',at_time,'method',method,'reference',ref);
  replay:=private.start_consignment(p_operation_id,'record_consignment_settlement',canonical);if replay is not null then return replay;end if;
  select brand_claim_cents,occurred_at into claim,sold_at from public.consignment_sales where id=sale for update;if not found then raise exception 'unknown_sale' using errcode='22023';end if;
  if at_time<sold_at then raise exception 'invalid_date' using errcode='22023';end if;
  select coalesce(sum(amount_cents),0) into paid from public.consignment_settlements where sale_id=sale;
  if amount>claim-paid then raise exception 'settlement_exceeds_claim' using errcode='22023';end if;
  if exists(select 1 from public.consignment_settlements where sale_id=sale and reference=ref)then raise exception 'duplicate_reference' using errcode='23505';end if;
  insert into public.consignment_settlements(id,sale_id,amount_cents,occurred_at,method,reference,created_by)values(p_operation_id,sale,amount,at_time,method,ref,auth.uid());
  result:=jsonb_build_object('operation_id',p_operation_id,'sale_id',sale,'settlement_id',p_operation_id,'replayed',false);return private.finish_consignment(p_operation_id,'record_consignment_settlement',canonical,result);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_payload' using errcode='22023';end$$;

create function public.transfer_consignment_stock(p_operation_id uuid,p_payload jsonb)returns jsonb language sql security invoker set search_path='' as $$select private.transfer_consignment_stock(p_operation_id,p_payload)$$;
create function public.register_consignment_sale(p_operation_id uuid,p_payload jsonb)returns jsonb language sql security invoker set search_path='' as $$select private.register_consignment_sale(p_operation_id,p_payload)$$;
create function public.record_consignment_settlement(p_operation_id uuid,p_payload jsonb)returns jsonb language sql security invoker set search_path='' as $$select private.record_consignment_settlement(p_operation_id,p_payload)$$;
revoke all on function private.start_consignment(uuid,text,jsonb),private.finish_consignment(uuid,text,jsonb,jsonb),private.consignment_date(jsonb),private.consignment_text(jsonb,integer,integer),private.require_consignment_tshirt(uuid),private.transfer_consignment_stock(uuid,jsonb),private.register_consignment_sale(uuid,jsonb),private.record_consignment_settlement(uuid,jsonb),public.transfer_consignment_stock(uuid,jsonb),public.register_consignment_sale(uuid,jsonb),public.record_consignment_settlement(uuid,jsonb)from public,anon,authenticated;
grant execute on function private.transfer_consignment_stock(uuid,jsonb),private.register_consignment_sale(uuid,jsonb),private.record_consignment_settlement(uuid,jsonb),public.transfer_consignment_stock(uuid,jsonb),public.register_consignment_sale(uuid,jsonb),public.record_consignment_settlement(uuid,jsonb)to authenticated;
comment on table public.consignment_sales is 'Commercial allocation: webshop EUR price +10, no shop discount, 60% LuckyLap rounded on full line and 40% remainder. No VAT accounting or implied payment.';
commit;
