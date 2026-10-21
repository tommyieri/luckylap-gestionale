-- A durable trusted worker boundary. No outbound Shopify writes or credentials.
begin;
create table private.shopify_sync_configuration (
  shop_domain text primary key check(shop_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$'),
  enabled boolean not null default false,
  online_location_id uuid references public.stock_locations(id)
);
create index shopify_config_location on private.shopify_sync_configuration(online_location_id);
create table private.shopify_location_mappings (
  shop_domain text not null references private.shopify_sync_configuration(shop_domain),
  shopify_location_gid text not null check(shopify_location_gid ~ '^gid://shopify/Location/[1-9][0-9]{0,19}$'),
  stock_location_id uuid not null references public.stock_locations(id),
  primary key(shop_domain,shopify_location_gid)
);
create index shopify_mapping_location on private.shopify_location_mappings(stock_location_id);
create table private.shopify_job_leases (
  job_id uuid primary key references private.shopify_order_read_jobs(id),
  state text not null default 'pending' check(state in('pending','leased','retry','applied','ignored','review')),
  worker_id uuid,lease_token uuid,lease_expires_at timestamptz,
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz not null default now(),
  reason text,canonical_digest text,result jsonb,
  updated_at timestamptz not null default now()
);
create index shopify_leases_ready on private.shopify_job_leases(state,next_attempt_at,lease_expires_at);
create table private.shopify_order_identities (
  shop_domain text not null,
  order_gid text not null,
  order_id uuid not null unique references public.sales_orders(id),
  baseline_sha256 text not null,
  source_updated_at timestamptz not null,
  source_updated_key text not null,
  canonical_digest text not null,
  canonical jsonb not null,
  primary key(shop_domain,order_gid)
);
create table private.shopify_line_identities (
  shop_domain text not null,order_gid text not null,line_gid text not null,
  order_line_id uuid not null unique references public.sales_order_lines(id),
  primary key(shop_domain,order_gid,line_gid),
  unique(shop_domain,line_gid),
  foreign key(shop_domain,order_gid) references private.shopify_order_identities(shop_domain,order_gid)
);
create table private.shopify_effect_receipts (
  id uuid primary key default gen_random_uuid(),shop_domain text not null,order_gid text not null,
  effect_kind text not null check(effect_kind in('order','payment','refund','fulfillment','cancellation')),
  source_id text not null,payload_sha256 text not null,
  created_at timestamptz not null default now(),
  unique(shop_domain,effect_kind,source_id)
);
create index shopify_effect_order on private.shopify_effect_receipts(shop_domain,order_gid);
create trigger shopify_effects_append_only before update or delete on private.shopify_effect_receipts for each row execute function private.reject_ledger_mutation();
do $$ declare n text; begin
  foreach n in array array['shopify_sync_configuration','shopify_location_mappings','shopify_job_leases','shopify_order_identities','shopify_line_identities','shopify_effect_receipts'] loop
    execute format('alter table private.%I enable row level security',n);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
  end loop;
end $$;

create function private.enqueue_shopify_worker_lease() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  insert into private.shopify_job_leases(job_id) values(new.id);
  return new;
end $$;
revoke all on function private.enqueue_shopify_worker_lease() from public,anon,authenticated,service_role;
create trigger enqueue_shopify_worker after insert on private.shopify_order_read_jobs for each row execute function private.enqueue_shopify_worker_lease();
insert into private.shopify_job_leases(job_id) select id from private.shopify_order_read_jobs;

create function private.shopify_service_required() returns void
language plpgsql security invoker set search_path='' as $$ begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'shopify_worker_access_required' using errcode='42501'; end if;
end $$;
create function private.shopify_review(p_reason text) returns void
language plpgsql security invoker set search_path='' as $$ begin raise exception '%',p_reason using errcode='P0001'; end $$;
create function private.shopify_object(p_value jsonb,p_keys text[]) returns void
language plpgsql immutable security invoker set search_path='' as $$ begin
  if jsonb_typeof(p_value) is distinct from 'object' or not(p_value ?& p_keys) or p_value-p_keys<>'{}'::jsonb then raise exception 'invalid_canonical' using errcode='P0001'; end if;
end $$;
create function private.shopify_array(p_value jsonb,p_max integer) returns void
language plpgsql immutable security invoker set search_path='' as $$ begin
  if jsonb_typeof(p_value) is distinct from 'array' then raise exception 'invalid_canonical' using errcode='P0001'; end if;
  if jsonb_array_length(p_value)>p_max then raise exception 'canonical_limit' using errcode='P0001'; end if;
end $$;
create function private.shopify_gid(p_value jsonb,p_resource text) returns text
language plpgsql immutable security invoker set search_path='' as $$ begin
  if jsonb_typeof(p_value) is distinct from 'string' or (p_value#>>'{}') !~ ('^gid://shopify/'||p_resource||'/[1-9][0-9]{0,19}$') then raise exception 'invalid_canonical' using errcode='P0001'; end if;
  if split_part(p_value#>>'{}','/',5)::numeric>18446744073709551615 then perform private.shopify_review('invalid_canonical');end if;
  return p_value#>>'{}';
end $$;
create function private.shopify_effect(p_shop text,p_order text,p_kind text,p_source text,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous private.shopify_effect_receipts%rowtype; digest text:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'); new_id uuid;
begin
  select * into previous from private.shopify_effect_receipts where shop_domain=p_shop and effect_kind=p_kind and source_id=p_source;
  if found then
    if previous.order_gid<>p_order or previous.payload_sha256<>digest then perform private.shopify_review('source_effect_changed'); end if;
    return null;
  end if;
  insert into private.shopify_effect_receipts(shop_domain,order_gid,effect_kind,source_id,payload_sha256)
    values(p_shop,p_order,p_kind,p_source,digest) returning id into new_id;
  return new_id;
end $$;

create function private.claim_shopify_order_jobs(p_worker_id uuid,p_limit integer,p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record; result jsonb:='[]'::jsonb; token uuid; expiry timestamptz;
begin
  perform private.shopify_service_required();
  if p_worker_id is null or p_limit not between 1 and 20 or p_limit is null or p_lease_seconds not between 30 and 900 or p_lease_seconds is null then raise exception 'invalid_worker_claim' using errcode='22023'; end if;
  for candidate in select l.job_id,i.id inbox_id,i.shop_domain,i.order_gid
    from private.shopify_job_leases l join private.shopify_order_read_jobs j on j.id=l.job_id join private.shopify_webhook_inbox i on i.id=j.inbox_id
    where (l.state in('pending','retry') and l.next_attempt_at<=clock_timestamp()) or(l.state='leased' and l.lease_expires_at<=clock_timestamp())
    order by j.created_at,l.job_id for update of l skip locked limit p_limit loop
    token:=gen_random_uuid();expiry:=clock_timestamp()+make_interval(secs=>p_lease_seconds);
    update private.shopify_job_leases set state='leased',worker_id=p_worker_id,lease_token=token,lease_expires_at=expiry,attempts=attempts+1,updated_at=now()
      where job_id=candidate.job_id;
    result:=result||jsonb_build_array(jsonb_build_object('job_id',candidate.job_id,'inbox_id',candidate.inbox_id,'shop_domain',candidate.shop_domain,'order_gid',candidate.order_gid,'lease_token',token,'lease_expires_at',expiry));
  end loop;
  return result;
end $$;
create function private.finish_shopify_read_job(p_job_id uuid,p_lease_token uuid,p_outcome text,p_reason text,p_retry_seconds integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare lease private.shopify_job_leases%rowtype; v_result jsonb;
begin
  perform private.shopify_service_required();
  if p_outcome not in('review','retry') or p_outcome is null or p_reason is null or p_reason !~ '^[a-z][a-z0-9_]{0,79}$'
    or p_retry_seconds is null or p_retry_seconds not between 5 and 86400 then raise exception 'invalid_worker_result' using errcode='22023'; end if;
  select * into lease from private.shopify_job_leases where job_id=p_job_id for update;
  if not found or p_lease_token is null or lease.lease_token is distinct from p_lease_token then raise exception 'worker_lease_required' using errcode='22023'; end if;
  if lease.state=p_outcome and lease.reason=p_reason and lease.result is not null then return lease.result;end if;
  if lease.state<>'leased' or lease.lease_expires_at<=clock_timestamp() then raise exception 'worker_lease_required' using errcode='22023'; end if;
  v_result:=jsonb_build_object('status',p_outcome,'reason',p_reason,'job_id',p_job_id);
  update private.shopify_job_leases set state=p_outcome,reason=p_reason,result=v_result,next_attempt_at=clock_timestamp()+make_interval(secs=>p_retry_seconds),updated_at=now() where job_id=p_job_id;
  return v_result;
end $$;
create function private.requeue_shopify_order_job(p_job_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$ begin
  perform private.shopify_service_required();
  update private.shopify_job_leases set state='pending',reason=null,result=null,canonical_digest=null,lease_token=null,lease_expires_at=null,next_attempt_at=now(),updated_at=now()
    where job_id=p_job_id and state in('review','retry');
  return found;
end $$;

-- Validate again at the trusted database boundary. No customer/PII fields or
-- unexpected JSON keys can enter the retained canonical snapshot.
create function private.shopify_integer(p_value jsonb,p_max bigint default 9000000000000000) returns bigint
language plpgsql immutable security invoker set search_path='' as $$
declare n numeric;
begin
  if jsonb_typeof(p_value) is distinct from 'number' or (p_value#>>'{}') !~ '^(0|[1-9][0-9]{0,15})$' then perform private.shopify_review('invalid_canonical'); end if;
  n:=(p_value#>>'{}')::numeric;
  if n>p_max then perform private.shopify_review('canonical_limit'); end if;
  return n::bigint;
end $$;
create function private.shopify_time_key(p_value jsonb) returns text
language plpgsql stable security invoker set search_path='' as $$
declare s text:=p_value#>>'{}'; fraction text; parsed timestamptz;
begin
  if jsonb_typeof(p_value) is distinct from 'string' or s !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,9})?Z$' then perform private.shopify_review('invalid_canonical'); end if;
  parsed:=s::timestamptz;
  if not isfinite(parsed) then perform private.shopify_review('invalid_canonical'); end if;
  fraction:=case when substring(s,20,1)='.' then substring(s,21,char_length(s)-21) else '' end;
  return substring(s,1,19)||'.'||rpad(fraction,9,'0')||'Z';
exception when invalid_datetime_format or datetime_field_overflow then perform private.shopify_review('invalid_canonical');return null;
end $$;
create function private.shopify_string(p_value jsonb,p_max integer,p_nullable boolean default false) returns text
language plpgsql immutable security invoker set search_path='' as $$ begin
  if p_nullable and p_value='null'::jsonb then return null; end if;
  if jsonb_typeof(p_value) is distinct from 'string' or char_length(p_value#>>'{}')>p_max or (p_value#>>'{}') ~ '[[:cntrl:]]' then perform private.shopify_review('invalid_canonical'); end if;
  return p_value#>>'{}';
end $$;
create function private.validate_shopify_canonical(p_order jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l jsonb;f jsonb;t jsonb;r jsonb;x jsonb;v jsonb; ids text[];child_ids text[]:='{}';
  line_ids text[]:='{}';transaction_ids text[]:='{}'; fulfillment_ids text[]:='{}';refund_ids text[]:='{}';
  line_map jsonb:='{}';fulfilled_map jsonb:='{}';refund_map jsonb:='{}';plan_lines jsonb:='[]';baseline_lines jsonb;
  q bigint;gross bigint;net bigint;discount bigint;alloc bigint;subtotal bigint:=0;discounts bigint:=0;sum_qty bigint;
  captures bigint:=0;refunds bigint:=0;refunded_total bigint:=0;parent_amount bigint;parent_refunded bigint;
  created_key text;updated_key text;baseline jsonb;key text;lineid text;id text;parent text;total bigint;tax bigint;shipping bigint;order_discount bigint;
begin
  if p_order is null or pg_column_size(p_order)>2097152 then perform private.shopify_review('canonical_limit'); end if;
  perform private.shopify_object(p_order,array['schemaVersion','apiVersion','shopDomain','orderId','sourceName','retailLocationId','createdAt','updatedAt','cancelledAt','test','edited','hasDiscountCodes','shopCurrency','presentmentCurrency','taxesIncluded','totals','lines','fulfillments','transactions','refunds']);
  if p_order->'schemaVersion' is distinct from '1'::jsonb or p_order->>'apiVersion' is distinct from '2026-10' or p_order->>'shopCurrency' is distinct from 'EUR' or p_order->>'presentmentCurrency' is distinct from 'EUR' then perform private.shopify_review('unsupported_currency_or_version'); end if;
  if private.shopify_string(p_order->'shopDomain',100) !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$' then perform private.shopify_review('invalid_canonical'); end if;
  perform private.shopify_gid(p_order->'orderId','Order');perform private.shopify_string(p_order->'sourceName',120,true);
  if p_order->'retailLocationId'<>'null'::jsonb then perform private.shopify_gid(p_order->'retailLocationId','Location'); end if;
  foreach key in array array['test','edited','hasDiscountCodes','taxesIncluded'] loop
    if jsonb_typeof(p_order->key) is distinct from 'boolean' then perform private.shopify_review('invalid_canonical'); end if;
  end loop;
  if (p_order->>'test')::boolean then perform private.shopify_review('test_order'); end if;
  if (p_order->>'edited')::boolean then perform private.shopify_review('edited_order'); end if;
  created_key:=private.shopify_time_key(p_order->'createdAt');updated_key:=private.shopify_time_key(p_order->'updatedAt');
  if created_key>updated_key then perform private.shopify_review('invalid_canonical'); end if;
  if p_order->'cancelledAt'<>'null'::jsonb then
    key:=private.shopify_time_key(p_order->'cancelledAt');if key<created_key or key>updated_key then perform private.shopify_review('invalid_canonical'); end if;
  end if;
  perform private.shopify_object(p_order->'totals',array['originalTotalCents','currentTotalCents','originalSubtotalCents','currentSubtotalCents','totalShippingPriceCents','currentShippingPriceCents','originalTaxCents','currentTaxCents','totalRefundedCents','totalReceivedCents','orderDiscountCents','totalDiscountCents']);
  for key,v in select * from jsonb_each(p_order->'totals') loop
    if key in('originalSubtotalCents','originalTaxCents','orderDiscountCents','totalDiscountCents') and v='null'::jsonb then continue; end if;
    perform private.shopify_integer(v);
  end loop;
  if p_order#>'{totals,originalSubtotalCents}'='null'::jsonb or p_order#>'{totals,originalTaxCents}'='null'::jsonb then perform private.shopify_review('missing_original_totals'); end if;
  order_discount:=coalesce(nullif(p_order#>>'{totals,orderDiscountCents}','null')::bigint,0);
  perform private.shopify_array(p_order->'lines',50);if jsonb_array_length(p_order->'lines')=0 then perform private.shopify_review('empty_order'); end if;
  for l in select * from jsonb_array_elements(p_order->'lines') loop
    perform private.shopify_object(l,array['id','variantId','sku','quantity','currentQuantity','isGiftCard','requiresShipping','originalUnitPriceCents','discountedTotalCents','lineDiscountCents','discountAllocationsCents']);
    lineid:=private.shopify_gid(l->'id','LineItem');if lineid=any(line_ids) then perform private.shopify_review('duplicate_source_id'); end if;line_ids:=array_append(line_ids,lineid);
    if l->'variantId'='null'::jsonb or l->'sku'='null'::jsonb then perform private.shopify_review('unmapped_sku'); end if;
    perform private.shopify_gid(l->'variantId','ProductVariant');perform private.shopify_string(l->'sku',120);
    if jsonb_typeof(l->'isGiftCard') is distinct from 'boolean' or jsonb_typeof(l->'requiresShipping') is distinct from 'boolean' then perform private.shopify_review('invalid_canonical'); end if;
    if (l->>'isGiftCard')::boolean or not(l->>'requiresShipping')::boolean then perform private.shopify_review('unsupported_line_kind'); end if;
    q:=private.shopify_integer(l->'quantity',100000);if q=0 or private.shopify_integer(l->'currentQuantity',100000)>q then perform private.shopify_review('invalid_canonical'); end if;
    gross:=q*private.shopify_integer(l->'originalUnitPriceCents',1000000000);net:=private.shopify_integer(l->'discountedTotalCents');discount:=private.shopify_integer(l->'lineDiscountCents');
    perform private.shopify_array(l->'discountAllocationsCents',100);alloc:=0;
    for v in select * from jsonb_array_elements(l->'discountAllocationsCents') loop alloc:=alloc+private.shopify_integer(v); end loop;
    -- discountedTotalSet can exclude order-level allocations. Apply only exact
    -- observed allocation cents; never distribute an order coupon ourselves.
    if net>gross or discount>gross-net or alloc<gross-net or alloc>gross then perform private.shopify_review('discount_allocation_mismatch'); end if;
    subtotal:=subtotal+gross-alloc;discounts:=discounts+alloc;
    plan_lines:=plan_lines||jsonb_build_array(jsonb_build_object('id',lineid,'variantId',l->>'variantId','sku',l->>'sku','quantity',q,'unit',l->'originalUnitPriceCents','discount',alloc));
    line_map:=line_map||jsonb_build_object(lineid,l);
  end loop;
  total:=private.shopify_integer(p_order#>'{totals,originalTotalCents}');tax:=private.shopify_integer(p_order#>'{totals,originalTaxCents}');shipping:=private.shopify_integer(p_order#>'{totals,totalShippingPriceCents}');
  if subtotal<>private.shopify_integer(p_order#>'{totals,originalSubtotalCents}') or total<>subtotal+shipping+(case when(p_order->>'taxesIncluded')::boolean then 0 else tax end) then perform private.shopify_review('order_totals_mismatch'); end if;
  if private.shopify_integer(p_order#>'{totals,currentTotalCents}')<>private.shopify_integer(p_order#>'{totals,currentSubtotalCents}')+private.shopify_integer(p_order#>'{totals,currentShippingPriceCents}')+(case when(p_order->>'taxesIncluded')::boolean then 0 else private.shopify_integer(p_order#>'{totals,currentTaxCents}') end) then perform private.shopify_review('current_totals_mismatch');end if;
  if p_order#>'{totals,totalDiscountCents}'<>'null'::jsonb and private.shopify_integer(p_order#>'{totals,totalDiscountCents}')<>discounts then perform private.shopify_review('discount_totals_mismatch'); end if;
  if order_discount>discounts then perform private.shopify_review('order_discount_allocation_mismatch');end if;
  perform private.shopify_array(p_order->'fulfillments',250);
  for f in select * from jsonb_array_elements(p_order->'fulfillments') loop
    perform private.shopify_object(f,array['id','status','locationId','updatedAt','totalQuantity','lines']);
    id:=private.shopify_gid(f->'id','Fulfillment');if id=any(fulfillment_ids) then perform private.shopify_review('duplicate_source_id'); end if;fulfillment_ids:=array_append(fulfillment_ids,id);
    if f->>'status' not in('CANCELLED','ERROR','FAILURE','SUCCESS') or jsonb_typeof(f->'status') is distinct from 'string' then perform private.shopify_review('invalid_canonical'); end if;
    if f->'locationId'<>'null'::jsonb then perform private.shopify_gid(f->'locationId','Location'); end if;
    if private.shopify_time_key(f->'updatedAt')>updated_key then perform private.shopify_review('invalid_canonical'); end if;
    perform private.shopify_array(f->'lines',250);sum_qty:=0;
    for x in select * from jsonb_array_elements(f->'lines') loop
      perform private.shopify_object(x,array['id','lineItemId','quantity']);key:=private.shopify_gid(x->'id','FulfillmentLineItem');
      if key=any(child_ids) then perform private.shopify_review('duplicate_source_id'); end if;child_ids:=array_append(child_ids,key);
      lineid:=private.shopify_gid(x->'lineItemId','LineItem');if not(lineid=any(line_ids)) then perform private.shopify_review('unknown_source_line'); end if;
      if x->'quantity'='null'::jsonb then perform private.shopify_review('unknown_fulfillment_quantity'); end if;
      q:=private.shopify_integer(x->'quantity',100000);if q=0 then perform private.shopify_review('invalid_canonical'); end if;sum_qty:=sum_qty+q;
      if f->>'status'='SUCCESS' then fulfilled_map:=fulfilled_map||jsonb_build_object(lineid,coalesce((fulfilled_map->>lineid)::bigint,0)+q); end if;
    end loop;
    if sum_qty<>private.shopify_integer(f->'totalQuantity',5000000) then perform private.shopify_review('fulfillment_totals_mismatch'); end if;
    if f->>'status'='SUCCESS' and(f->'locationId'='null'::jsonb or sum_qty=0) then perform private.shopify_review('unknown_fulfillment_location'); end if;
  end loop;
  perform private.shopify_array(p_order->'transactions',250);
  for t in select * from jsonb_array_elements(p_order->'transactions') loop
    perform private.shopify_object(t,array['id','kind','status','amountCents','currency','processedAt','parentId','test','gateway']);
    id:=private.shopify_gid(t->'id','OrderTransaction');if id=any(transaction_ids) then perform private.shopify_review('duplicate_source_id'); end if;transaction_ids:=array_append(transaction_ids,id);
    if t->>'kind' not in('AUTHORIZATION','CAPTURE','CHANGE','EMV_AUTHORIZATION','REFUND','SALE','SUGGESTED_REFUND','VOID') or t->>'status' not in('AWAITING_RESPONSE','ERROR','FAILURE','PENDING','SUCCESS','UNKNOWN') or jsonb_typeof(t->'kind') is distinct from 'string' or jsonb_typeof(t->'status') is distinct from 'string' or t->>'currency' is distinct from 'EUR' or jsonb_typeof(t->'test') is distinct from 'boolean' then perform private.shopify_review('invalid_canonical'); end if;
    perform private.shopify_integer(t->'amountCents');perform private.shopify_string(t->'gateway',120,true);
    if (t->>'test')::boolean then perform private.shopify_review('test_transaction'); end if;
    if t->'parentId'<>'null'::jsonb then perform private.shopify_gid(t->'parentId','OrderTransaction'); end if;
    if t->'processedAt'<>'null'::jsonb then
      key:=private.shopify_time_key(t->'processedAt');if key<created_key or key>updated_key then perform private.shopify_review('invalid_canonical'); end if;
    end if;
    if t->>'status'='SUCCESS' and t->>'kind' in('SALE','CAPTURE','REFUND') then
      if t->'processedAt'='null'::jsonb then perform private.shopify_review('missing_transaction_time'); end if;
      if lower(coalesce(t->>'gateway','')) ~ 'gift.?card' then perform private.shopify_review('gift_card_tender'); end if;
      if t->>'kind'='REFUND' then refunds:=refunds+(t->>'amountCents')::bigint;else captures:=captures+(t->>'amountCents')::bigint;end if;
    elsif t->>'status'='SUCCESS' and t->>'kind' in('CHANGE','SUGGESTED_REFUND') then perform private.shopify_review('unsupported_success_transaction'); end if;
  end loop;
  for t in select * from jsonb_array_elements(p_order->'transactions') loop
    parent:=t->>'parentId';if parent is not null and not(parent=any(transaction_ids)) then perform private.shopify_review('unknown_parent_transaction'); end if;
    if t->>'status'='SUCCESS' and t->>'kind'='REFUND' then
      select (value->>'amountCents')::bigint into parent_amount from jsonb_array_elements(p_order->'transactions') where value->>'id'=parent and value->>'status'='SUCCESS' and value->>'kind' in('SALE','CAPTURE');
      select sum((value->>'amountCents')::bigint) into parent_refunded from jsonb_array_elements(p_order->'transactions') where value->>'parentId'=parent and value->>'kind'='REFUND' and value->>'status'='SUCCESS';
      if parent_amount is null or parent_refunded>parent_amount then perform private.shopify_review('refund_parent_mismatch'); end if;
    end if;
  end loop;
  if captures>total or refunds>captures or captures<>private.shopify_integer(p_order#>'{totals,totalReceivedCents}') or refunds<>private.shopify_integer(p_order#>'{totals,totalRefundedCents}') then perform private.shopify_review('observed_payment_mismatch'); end if;
  perform private.shopify_array(p_order->'refunds',250);
  for r in select * from jsonb_array_elements(p_order->'refunds') loop
    perform private.shopify_object(r,array['id','createdAt','updatedAt','totalRefundedCents','lines']);
    id:=private.shopify_gid(r->'id','Refund');if id=any(refund_ids) then perform private.shopify_review('duplicate_source_id'); end if;refund_ids:=array_append(refund_ids,id);
    key:=private.shopify_time_key(r->'updatedAt');if key>updated_key then perform private.shopify_review('invalid_canonical'); end if;
    if r->'createdAt'<>'null'::jsonb and private.shopify_time_key(r->'createdAt')>key then perform private.shopify_review('invalid_canonical'); end if;
    refunded_total:=refunded_total+private.shopify_integer(r->'totalRefundedCents');perform private.shopify_array(r->'lines',250);
    for x in select * from jsonb_array_elements(r->'lines') loop
      perform private.shopify_object(x,array['id','lineItemId','quantity','restockType','restocked','locationId']);
      if x->'id'<>'null'::jsonb then key:=private.shopify_gid(x->'id','RefundLineItem');if key=any(child_ids) then perform private.shopify_review('duplicate_source_id'); end if;child_ids:=array_append(child_ids,key);end if;
      lineid:=private.shopify_gid(x->'lineItemId','LineItem');if not(lineid=any(line_ids)) then perform private.shopify_review('unknown_source_line');end if;
      q:=private.shopify_integer(x->'quantity',100000);refund_map:=refund_map||jsonb_build_object(lineid,coalesce((refund_map->>lineid)::bigint,0)+q);
      if x->>'restockType' not in('CANCEL','LEGACY_RESTOCK','NO_RESTOCK','RETURN') or jsonb_typeof(x->'restockType') is distinct from 'string' or jsonb_typeof(x->'restocked') is distinct from 'boolean' then perform private.shopify_review('invalid_canonical');end if;
      if x->'locationId'<>'null'::jsonb then perform private.shopify_gid(x->'locationId','Location');end if;
    end loop;
  end loop;
  if refunded_total<>refunds then perform private.shopify_review('refund_totals_mismatch');end if;
  for l in select * from jsonb_array_elements(p_order->'lines') loop
    lineid:=l->>'id';q:=(l->>'quantity')::bigint;sum_qty:=coalesce((fulfilled_map->>lineid)::bigint,0);
    if sum_qty>q then perform private.shopify_review('fulfilled_quantity_exceeded');end if;
    if p_order->'cancelledAt'<>'null'::jsonb and sum_qty>0 then perform private.shopify_review('fulfilled_cancellation_requires_review');end if;
    if p_order->'cancelledAt'='null'::jsonb and((l->>'currentQuantity')::bigint<>q-coalesce((refund_map->>lineid)::bigint,0) or coalesce((refund_map->>lineid)::bigint,0)>sum_qty) then perform private.shopify_review('unfulfilled_reduction_requires_review');end if;
  end loop;
  select jsonb_agg(value order by value->>'id') into baseline_lines from jsonb_array_elements(plan_lines);
  baseline:=jsonb_build_object('createdAt',created_key,'sourceName',p_order->'sourceName','retailLocationId',p_order->'retailLocationId','taxesIncluded',p_order->'taxesIncluded','total',total,'subtotal',subtotal,'shipping',shipping,'tax',tax,'lines',baseline_lines);
  return jsonb_build_object('baseline',baseline,'lines',plan_lines,'updatedKey',updated_key,'captures',captures,'refunds',refunds,'total',total);
end $$;

create function private.apply_shopify_order(p_job_id uuid,p_lease_token uuid,p_canonical jsonb) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
<<worker>>
declare lease private.shopify_job_leases%rowtype; inbox private.shopify_webhook_inbox%rowtype;
  identity_row private.shopify_order_identities%rowtype; config private.shopify_sync_configuration%rowtype;
  core public.sales_orders%rowtype; line public.sales_order_lines%rowtype;
  plan jsonb; baseline_digest text; canonical_digest text:=encode(sha256(convert_to(p_canonical::text,'UTF8')),'hex');
  updated_key text; shop text; source_order text; channel text; location uuid; fulfillment_location uuid;
  mapped jsonb:='[]'; l jsonb;f jsonb;x jsonb;t jsonb;item public.stock_items%rowtype;catalog public.shopify_catalog_variants%rowtype;
  line_id uuid;order_id uuid;effect_id uuid;movement_id uuid;payment_id uuid;refund_id uuid;existing_line uuid;
  ready bigint;reserved bigint;allocated bigint;quantity bigint;released bigint;deficit bigint;other_reserved bigint;
  source_keys text[]:='{}';source_key text;total bigint;captures bigint;refunds bigint;fulfilled bigint;all_qty bigint;
  v_result jsonb;result_status text;result_reason text;job_state text;cancelled boolean;is_new boolean;source_time timestamptz;cutover timestamptz;
begin
  perform private.shopify_service_required();
  select * into lease from private.shopify_job_leases where job_id=p_job_id for update;
  if not found or p_lease_token is null or lease.lease_token is distinct from p_lease_token then raise exception 'worker_lease_required' using errcode='22023';end if;
  if lease.state in('applied','ignored','review') then
    if lease.canonical_digest is distinct from canonical_digest then raise exception 'worker_terminal_conflict' using errcode='22023';end if;
    return case when lease.state='applied' then lease.result||jsonb_build_object('status','replayed') else lease.result end;
  end if;
  if lease.state<>'leased' or lease.lease_expires_at<=clock_timestamp() then raise exception 'worker_lease_required' using errcode='22023';end if;
  select i.* into strict inbox from private.shopify_webhook_inbox i join private.shopify_order_read_jobs j on j.inbox_id=i.id where j.id=p_job_id;
  -- Business mutations and effect receipts share one subtransaction. Review or
  -- retry commits only the durable job outcome; every partial business write rolls back.
  begin
    plan:=private.validate_shopify_canonical(p_canonical);shop:=p_canonical->>'shopDomain';source_order:=p_canonical->>'orderId';updated_key:=plan->>'updatedKey';
    if shop<>inbox.shop_domain or source_order<>inbox.order_gid then perform private.shopify_review('notification_identity_mismatch');end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.shopify.'||shop||'.'||source_order,0));
    select * into config from private.shopify_sync_configuration where shop_domain=shop for share;
    if not found then perform private.shopify_review('shop_configuration_required');end if;
    if not config.enabled then result_status:='retry';result_reason:='shop_sync_disabled';
    else
      select sales_started_at into cutover from public.app_settings where id;
      if cutover is null then perform private.shopify_review('sales_cutover_required');end if;
      source_time:=(p_canonical->>'createdAt')::timestamptz;
      if private.shopify_time_key(p_canonical->'createdAt')<private.shopify_time_key(to_jsonb(to_char(cutover at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'Z')) then result_status:='ignored';result_reason:='before_sales_cutover';
      else
        select * into identity_row from private.shopify_order_identities where shop_domain=shop and order_gid=source_order;
        is_new:=not found;
        if not is_new and updated_key<identity_row.source_updated_key then result_status:='stale';result_reason:='older_source_version';
        elsif not is_new and updated_key=identity_row.source_updated_key then
          if canonical_digest<>identity_row.canonical_digest then perform private.shopify_review('same_version_changed');end if;
          result_status:='replayed';order_id:=identity_row.order_id;
        else
          baseline_digest:=encode(sha256(convert_to((plan->'baseline')::text,'UTF8')),'hex');
          if not is_new and identity_row.baseline_sha256<>baseline_digest then perform private.shopify_review('original_order_changed');end if;
          cancelled:=p_canonical->'cancelledAt'<>'null'::jsonb;total:=(plan->>'total')::bigint;captures:=(plan->>'captures')::bigint;refunds:=(plan->>'refunds')::bigint;
          if p_canonical->>'sourceName'='web' then channel:='shopify_web';location:=config.online_location_id;
            if location is null then perform private.shopify_review('online_location_required');end if;
          elsif p_canonical->>'sourceName'='pos' then channel:='shopify_pos';
            select stock_location_id into location from private.shopify_location_mappings where shop_domain=shop and shopify_location_gid=p_canonical->>'retailLocationId' for share;
            if location is null then perform private.shopify_review('pos_location_required');end if;
          else perform private.shopify_review('unsupported_order_source');end if;
          if not exists(select 1 from public.stock_locations where id=location and active and location_type='Magazzino') then perform private.shopify_review('invalid_sales_location');end if;
          if not is_new then order_id:=identity_row.order_id;select * into strict core from public.sales_orders where id=order_id for update;end if;
          for l in select * from jsonb_array_elements(plan->'lines') loop
            select * into catalog from public.shopify_catalog_variants where shop_domain=shop and variant_gid=l->>'variantId' and sku=l->>'sku' and status='ACTIVE';
            if not found or catalog.stock_item_id is null then perform private.shopify_review('unmapped_sku');end if;
            select * into item from public.stock_items where id=catalog.stock_item_id and active and kind='product' and sku=l->>'sku';if not found then perform private.shopify_review('inactive_physical_sku');end if;
            if not is_new then
              select order_line_id into existing_line from private.shopify_line_identities where shop_domain=shop and order_gid=source_order and line_gid=l->>'id';
              if existing_line is null or not exists(select 1 from public.sales_order_lines where id=existing_line and stock_item_id=item.id and location_id=location) then perform private.shopify_review('physical_mapping_changed');end if;
            end if;
            mapped:=mapped||jsonb_build_array(l||jsonb_build_object('stockItem',item.id,'listPrice',case when item.list_price_eur is null then null else(item.list_price_eur*100)::bigint end,'cost',case when item.unit_cost_eur is null then null else(item.unit_cost_eur*100)::bigint end));
          end loop;
          -- All participants acquire balances in the same order. NULL is unknown,
          -- never zero; no stock receipt or transfer is inferred from Shopify.
          for item in select s.* from public.stock_items s where s.id in(select(value->>'stockItem')::uuid from jsonb_array_elements(mapped)) order by s.id loop
            select b.quantity into ready from public.stock_balances b where b.stock_item_id=item.id and b.location_id=location for update;
            if not found or ready is null then perform private.shopify_review('unknown_physical_stock');end if;
          end loop;
          for f in select * from jsonb_array_elements(p_canonical->'fulfillments') where value->>'status'='SUCCESS' loop
            select stock_location_id into fulfillment_location from private.shopify_location_mappings where shop_domain=shop and shopify_location_gid=f->>'locationId' for share;
            if fulfillment_location is null then perform private.shopify_review('fulfillment_location_required');end if;
            if fulfillment_location<>location then perform private.shopify_review('fulfillment_location_mismatch');end if;
          end loop;
          effect_id:=private.shopify_effect(shop,source_order,'order',source_order,plan->'baseline');source_keys:=array_append(source_keys,'order:'||source_order);
          if is_new then
            if effect_id is null then perform private.shopify_review('source_identity_conflict');end if;
            order_id:=gen_random_uuid();
            insert into public.sales_orders(id,operation_id,payload_sha256,channel,external_reference,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,created_by,source_kind)
              values(order_id,effect_id,baseline_digest,channel,shop||'/'||source_order,source_time,(source_time at time zone 'Europe/Rome')::date,total,'unpaid','prepare','unfulfilled',null,'shopify_canonical');
            insert into private.shopify_order_identities(shop_domain,order_gid,order_id,baseline_sha256,source_updated_at,source_updated_key,canonical_digest,canonical)
              values(shop,source_order,order_id,baseline_digest,(p_canonical->>'updatedAt')::timestamptz,updated_key,canonical_digest,p_canonical);
            for l in select * from jsonb_array_elements(mapped) loop
              line_id:=gen_random_uuid();quantity:=(l->>'quantity')::bigint;
              insert into public.sales_order_lines(id,order_id,stock_item_id,location_id,sku_snapshot,quantity,unit_price_cents,discount_cents,list_price_cents,unit_cost_cents,source_kind)
                values(line_id,order_id,(l->>'stockItem')::uuid,location,l->>'sku',quantity,(l->>'unit')::bigint,(l->>'discount')::bigint,(l->>'listPrice')::bigint,(l->>'cost')::bigint,'shopify_canonical');
              insert into private.shopify_line_identities(shop_domain,order_gid,line_gid,order_line_id) values(shop,source_order,l->>'id',line_id);
              if not cancelled then
                select b.quantity-coalesce((select sum(r.reserved_quantity) from public.stock_reservations r where r.stock_item_id=b.stock_item_id and r.location_id=b.location_id),0) into ready from public.stock_balances b where b.stock_item_id=(l->>'stockItem')::uuid and b.location_id=location;
                allocated:=least(quantity,ready);deficit:=quantity-allocated;
                if allocated>0 then insert into public.stock_reservation_events(operation_id,order_line_id,kind,quantity_delta,created_by,source_kind) values(gen_random_uuid(),line_id,'allocate',allocated,null,'shopify_observation');end if;
                if deficit>0 then insert into public.production_requirements(order_line_id,required_quantity) values(line_id,deficit);end if;
              end if;
            end loop;
            insert into public.commercial_facts(operation_id,order_id,fact_kind,amount_cents,occurred_at,created_by,source_kind) values(gen_random_uuid(),order_id,'sale_observed',total,source_time,null,'shopify_observation');
          end if;
          for t in select * from jsonb_array_elements(p_canonical->'transactions') where value->>'status'='SUCCESS' and value->>'kind' in('SALE','CAPTURE','REFUND') loop
            source_key:=case when t->>'kind'='REFUND' then 'refund' else 'payment' end;
            effect_id:=private.shopify_effect(shop,source_order,source_key,t->>'id',t-'status'-'test');source_keys:=array_append(source_keys,source_key||':'||(t->>'id'));
            if effect_id is not null and(t->>'amountCents')::bigint>0 then
              if source_key='payment' then
                insert into public.order_payments(operation_id,order_id,source_kind,method,amount_cents,occurred_at,declared_reference,created_by)
                  values(effect_id,order_id,'shopify_observation','shopify_observed',(t->>'amountCents')::bigint,(t->>'processedAt')::timestamptz,t->>'id',null) returning id into payment_id;
                insert into public.commercial_facts(operation_id,order_id,payment_id,fact_kind,amount_cents,occurred_at,created_by,source_kind)
                  values(gen_random_uuid(),order_id,payment_id,'payment_reported',(t->>'amountCents')::bigint,(t->>'processedAt')::timestamptz,null,'shopify_observation');
              else
                insert into public.shopify_refund_observations(operation_id,order_id,transaction_gid,amount_cents,occurred_at)
                  values(effect_id,order_id,t->>'id',(t->>'amountCents')::bigint,(t->>'processedAt')::timestamptz) returning id into refund_id;
                insert into public.commercial_facts(operation_id,order_id,refund_id,fact_kind,amount_cents,occurred_at,created_by,source_kind)
                  values(gen_random_uuid(),order_id,refund_id,'refund_observed',(t->>'amountCents')::bigint,(t->>'processedAt')::timestamptz,null,'shopify_observation');
              end if;
            end if;
          end loop;
          for f in select * from jsonb_array_elements(p_canonical->'fulfillments') where value->>'status'='SUCCESS' loop
            for x in select * from jsonb_array_elements(f->'lines') loop
              source_key:=(f->>'id')||'/'||(x->>'id');
              effect_id:=private.shopify_effect(shop,source_order,'fulfillment',source_key,jsonb_build_object('fulfillment',f->>'id','location',f->>'locationId','line',x));source_keys:=array_append(source_keys,'fulfillment:'||source_key);
              if effect_id is not null then
                select l.* into strict line from public.sales_order_lines l join private.shopify_line_identities i on i.order_line_id=l.id where i.shop_domain=shop and i.order_gid=source_order and i.line_gid=x->>'lineItemId';
                quantity:=(x->>'quantity')::bigint;
                select coalesce((select reserved_quantity from public.stock_reservations where order_line_id=line.id),0) into reserved;released:=least(reserved,quantity);
                select coalesce(sum(reserved_quantity),0) into other_reserved from public.stock_reservations where stock_item_id=line.stock_item_id and location_id=line.location_id and order_line_id<>line.id;
                select b.quantity into ready from public.stock_balances b where b.stock_item_id=line.stock_item_id and b.location_id=line.location_id;
                if ready<quantity+other_reserved+greatest(reserved-quantity,0) then perform private.shopify_review('physical_fulfillment_shortage');end if;
                if released>0 then insert into public.stock_reservation_events(operation_id,order_line_id,kind,quantity_delta,created_by,source_kind) values(gen_random_uuid(),line.id,'release',-released,null,'shopify_observation');end if;
                insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)
                  values(effect_id,line.stock_item_id,line.location_id,'sale_fulfillment',-quantity,'Spedizione osservata su Shopify',jsonb_build_object('shop_domain',shop,'shopify_order_gid',source_order,'shopify_fulfillment_gid',f->>'id','shopify_fulfillment_line_gid',x->>'id','sales_order_id',order_id,'sales_order_line_id',line.id),null) returning id into movement_id;
                insert into public.fulfillment_lines(order_line_id,quantity,stock_movement_id,fulfilled_at) values(line.id,quantity,movement_id,(f->>'updatedAt')::timestamptz);
                update public.sales_order_lines set fulfilled_quantity=fulfilled_quantity+worker.quantity where id=line.id;
                deficit:=quantity-released;
                if deficit>0 then update public.production_requirements set cancelled_quantity=cancelled_quantity+least(deficit,required_quantity-completed_quantity-cancelled_quantity),
                  status=case when completed_quantity+cancelled_quantity+least(deficit,required_quantity-completed_quantity-cancelled_quantity)=required_quantity then case when completed_quantity>0 then 'satisfied' else 'cancelled' end else status end where order_line_id=line.id;end if;
              end if;
            end loop;
          end loop;
          if cancelled then
            effect_id:=private.shopify_effect(shop,source_order,'cancellation',source_order,jsonb_build_object('cancelledAt',p_canonical->'cancelledAt'));source_keys:=array_append(source_keys,'cancellation:'||source_order);
            if effect_id is not null then
              for line in select * from public.sales_order_lines where sales_order_lines.order_id=worker.order_id order by id loop
                select coalesce((select reserved_quantity from public.stock_reservations where order_line_id=line.id),0) into reserved;
                if reserved>0 then insert into public.stock_reservation_events(operation_id,order_line_id,kind,quantity_delta,created_by,source_kind) values(gen_random_uuid(),line.id,'release',-reserved,null,'shopify_observation');end if;
                update public.sales_order_lines set cancelled_quantity=sales_order_lines.quantity,cancelled_amount_cents=line_total_cents where id=line.id;
                update public.production_requirements set cancelled_quantity=required_quantity-completed_quantity,status=case when completed_quantity>0 then 'satisfied' else 'cancelled' end where order_line_id=line.id;
              end loop;
              insert into public.commercial_facts(operation_id,order_id,fact_kind,amount_cents,occurred_at,created_by,source_kind) values(effect_id,order_id,'sale_cancellation_observed',total,(p_canonical->>'cancelledAt')::timestamptz,null,'shopify_observation');
            end if;
          end if;
          if exists(select 1 from private.shopify_effect_receipts e where e.shop_domain=shop and e.order_gid=source_order and not(e.effect_kind||':'||e.source_id=any(source_keys))) then perform private.shopify_review('committed_source_effect_disappeared');end if;
          select sum(sales_order_lines.quantity),sum(fulfilled_quantity) into all_qty,fulfilled from public.sales_order_lines where sales_order_lines.order_id=worker.order_id;
          update public.sales_orders set payment_state=case when captures>0 and refunds=captures then 'refunded' when refunds>0 then 'partially_refunded' when captures=total then 'paid' when captures>0 then 'partially_paid' else 'unpaid' end,
            order_state=case when cancelled then 'cancelled' else 'confirmed' end,fulfillment_state=case when cancelled then 'cancelled' when fulfilled=all_qty then 'fulfilled' when fulfilled>0 then 'partial' else 'unfulfilled' end,
            cancelled_cents=case when cancelled then total else 0 end,refund_due_cents=greatest(0,captures-refunds-case when cancelled then 0 else total end)
            where id=order_id;
          insert into public.shopify_order_financials(order_id,source_updated_at,totals,taxes_included) values(order_id,(p_canonical->>'updatedAt')::timestamptz,p_canonical->'totals',(p_canonical->>'taxesIncluded')::boolean)
            on conflict on constraint shopify_order_financials_pkey do update set source_updated_at=excluded.source_updated_at,totals=excluded.totals,taxes_included=excluded.taxes_included,observed_at=now();
          for t in select * from jsonb_array_elements(p_canonical->'transactions') loop
            insert into public.shopify_transaction_observations(order_id,transaction_gid,kind,status,amount_cents,currency,gateway,parent_gid,processed_at,source_updated_at)
              values(order_id,t->>'id',t->>'kind',t->>'status',(t->>'amountCents')::bigint,'EUR',t->>'gateway',t->>'parentId',(t->>'processedAt')::timestamptz,(p_canonical->>'updatedAt')::timestamptz)
              on conflict on constraint shopify_transaction_observations_pkey do update set kind=excluded.kind,status=excluded.status,amount_cents=excluded.amount_cents,gateway=excluded.gateway,parent_gid=excluded.parent_gid,processed_at=excluded.processed_at,source_updated_at=excluded.source_updated_at,observed_at=now();
          end loop;
          delete from public.shopify_transaction_observations o where o.order_id=worker.order_id and not exists(select 1 from jsonb_array_elements(p_canonical->'transactions') jt(value) where jt.value->>'id'=o.transaction_gid);
          update private.shopify_order_identities set source_updated_at=(p_canonical->>'updatedAt')::timestamptz,source_updated_key=updated_key,canonical_digest=worker.canonical_digest,canonical=p_canonical where shop_domain=shop and order_gid=source_order;
          result_status:='applied';
        end if;
      end if;
    end if;
  exception
    when raise_exception then result_status:='review';result_reason:=sqlerrm;
    when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then result_status:='review';result_reason:='invalid_canonical';
    when check_violation or foreign_key_violation or unique_violation then result_status:='review';result_reason:='source_state_conflict';
    when sqlstate '22023' then result_status:='review';result_reason:=case when sqlerrm in('reserved_stock_conflict','unknown_stock','insufficient_stock','invalid_sales_location') then sqlerrm else 'source_state_conflict' end;
    when serialization_failure or deadlock_detected or lock_not_available then result_status:='retry';result_reason:='concurrent_state_retry';
  end;
  if result_reason is not null and result_reason !~ '^[a-z][a-z0-9_]{0,79}$' then result_reason:='source_state_conflict';end if;
  v_result:=jsonb_build_object('status',result_status,'reason',result_reason,'job_id',p_job_id);
  if order_id is not null and result_status in('applied','replayed','stale') then v_result:=v_result||jsonb_build_object('order_id',order_id);end if;
  job_state:=case when result_status in('replayed','applied') then 'applied' when result_status in('stale','ignored') then 'ignored' else result_status end;
  update private.shopify_job_leases set state=job_state,reason=result_reason,result=v_result,canonical_digest=worker.canonical_digest,next_attempt_at=clock_timestamp()+interval '60 seconds',updated_at=now() where job_id=p_job_id;
  return v_result;
end $$;

-- Fulfillment notifications remain cues only and always require canonical reads.
create or replace function private.receive_shopify_order_notification(p_cue jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_shop text; v_webhook uuid; v_event uuid; v_gid text; v_topic text; v_source text; v_channel text;
  v_created text; v_updated text; v_body_hash text; v_metadata_hash text; v_normalized jsonb;
  v_inbox private.shopify_webhook_inbox%rowtype; v_job uuid;
begin
  -- The SQL role is assigned by the trusted API gateway, not user_metadata.
  -- Grants are also service_role-only; this guard covers direct helper invocation.
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'shopify_receiver_access_required' using errcode = '42501';
  end if;
  perform private.sale_object(p_cue,
    array['shopDomain','webhookId','eventId','deliveryKey','apiVersion','topic','orderGid','sourceName','channel','currency','sourceCreatedAt','sourceUpdatedAt','bodySha256','requiresCanonicalRead'],
    array['shopDomain','webhookId','eventId','deliveryKey','apiVersion','topic','orderGid','sourceName','channel','currency','sourceCreatedAt','sourceUpdatedAt','bodySha256','requiresCanonicalRead']);
  if jsonb_typeof(p_cue->'shopDomain') is distinct from 'string'
    or jsonb_typeof(p_cue->'webhookId') is distinct from 'string'
    or jsonb_typeof(p_cue->'eventId') not in ('string','null')
    or jsonb_typeof(p_cue->'deliveryKey') is distinct from 'string'
    or jsonb_typeof(p_cue->'apiVersion') is distinct from 'string'
    or jsonb_typeof(p_cue->'topic') is distinct from 'string'
    or jsonb_typeof(p_cue->'orderGid') is distinct from 'string'
    or jsonb_typeof(p_cue->'sourceName') not in ('string','null')
    or jsonb_typeof(p_cue->'channel') is distinct from 'string'
    or jsonb_typeof(p_cue->'currency') is distinct from 'string'
    or jsonb_typeof(p_cue->'sourceCreatedAt') is distinct from 'string'
    or jsonb_typeof(p_cue->'sourceUpdatedAt') is distinct from 'string'
    or jsonb_typeof(p_cue->'bodySha256') is distinct from 'string'
    or p_cue->'requiresCanonicalRead' is distinct from 'true'::jsonb then
    raise exception 'invalid_shopify_cue' using errcode = '22023';
  end if;
  v_shop := p_cue->>'shopDomain'; v_gid := p_cue->>'orderGid'; v_topic := p_cue->>'topic';
  v_source := p_cue->>'sourceName'; v_channel := p_cue->>'channel';
  v_created := p_cue->>'sourceCreatedAt'; v_updated := p_cue->>'sourceUpdatedAt'; v_body_hash := p_cue->>'bodySha256';
  if v_shop !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$'
    or (p_cue->>'webhookId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (p_cue->>'eventId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_cue->>'apiVersion' <> '2026-10'
    or v_topic not in ('orders/create','orders/updated','orders/paid','orders/cancelled','orders/fulfilled','orders/partially_fulfilled')
    or v_gid !~ '^gid://shopify/Order/[1-9][0-9]{0,19}$'
    or (p_cue->>'currency') !~ '^[A-Z]{3}$' or char_length(v_source) > 255
    or v_body_hash !~ '^[0-9a-f]{64}$'
    or v_created !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    or v_updated !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'invalid_shopify_cue' using errcode = '22023';
  end if;
  v_webhook := (p_cue->>'webhookId')::uuid; v_event := (p_cue->>'eventId')::uuid;
  if (substring(v_gid from 21))::numeric > 18446744073709551615
    or (substring(v_created from 1 for 4))::integer < 2000 or (substring(v_updated from 1 for 4))::integer < 2000
    or v_created::timestamptz > v_updated::timestamptz
    or p_cue->>'deliveryKey' <> v_shop || ':' || v_webhook::text
    or v_channel <> (case when v_source = 'pos' then 'shopify_pos' when v_source = 'web' then 'shopify_web' else 'shopify_other' end) then
    raise exception 'invalid_shopify_cue' using errcode = '22023';
  end if;
  v_normalized := p_cue || jsonb_build_object('webhookId',v_webhook::text,'eventId',v_event::text);
  v_metadata_hash := encode(sha256(convert_to((v_normalized - 'bodySha256')::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.shopify.delivery.' || v_shop || ':' || v_webhook::text, 0));
  select * into v_inbox from private.shopify_webhook_inbox where shop_domain = v_shop and webhook_id = v_webhook;
  if found then
    if v_inbox.payload_sha256 <> v_body_hash or v_inbox.metadata_sha256 <> v_metadata_hash then
      raise exception 'shopify_delivery_conflict' using errcode = '22023';
    end if;
    select id into v_job from private.shopify_order_read_jobs where inbox_id = v_inbox.id;
    if not found then raise exception 'shopify_receipt_incomplete' using errcode = '55000'; end if;
    return jsonb_build_object('inbox_id',v_inbox.id,'job_id',v_job,'received_at',v_inbox.received_at,'state','awaiting_app','replayed',true);
  end if;
  insert into private.shopify_webhook_inbox(shop_domain,webhook_id,event_id,order_gid,topic,api_version,payload_sha256,metadata_sha256,cue)
    values(v_shop,v_webhook,v_event,v_gid,v_topic,'2026-10',v_body_hash,v_metadata_hash,v_normalized) returning * into v_inbox;
  insert into private.shopify_order_read_jobs(inbox_id) values(v_inbox.id) returning id into v_job;
  return jsonb_build_object('inbox_id',v_inbox.id,'job_id',v_job,'received_at',v_inbox.received_at,'state','awaiting_app','replayed',false);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
  raise exception 'invalid_shopify_cue' using errcode = '22023';
end
$$;

create function private.get_shopify_sync_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare counters jsonb;reviews jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode='42501';end if;
  select jsonb_build_object('pending',count(*) filter(where state='pending' or(state='leased' and lease_expires_at<=statement_timestamp())),
    'retry',count(*) filter(where state='retry'),'processing',count(*) filter(where state='leased' and lease_expires_at>statement_timestamp()),
    'review',count(*) filter(where state='review'),'applied',count(*) filter(where state='applied'),'ignored',count(*) filter(where state='ignored'),
    'lastAppliedAt',max(updated_at) filter(where state='applied')) into counters from private.shopify_job_leases;
  select coalesce(jsonb_agg(jsonb_build_object('orderGid',r.order_gid,'reason',r.reason,'observedAt',r.updated_at) order by r.updated_at desc,r.job_id),'[]'::jsonb) into reviews
    from(select l.job_id,i.order_gid,l.reason,l.updated_at from private.shopify_job_leases l join private.shopify_order_read_jobs j on j.id=l.job_id join private.shopify_webhook_inbox i on i.id=j.inbox_id where l.state='review' order by l.updated_at desc,l.job_id limit 20) r;
  return jsonb_build_object('configured',exists(select 1 from private.shopify_sync_configuration),'enabled',exists(select 1 from private.shopify_sync_configuration where enabled),'counters',counters,'reviews',reviews);
end $$;
create function public.get_shopify_sync_status() returns jsonb language sql security invoker set search_path='' as $$select private.get_shopify_sync_status()$$;
revoke all on function private.get_shopify_sync_status(),public.get_shopify_sync_status() from public,anon,authenticated,service_role;
grant execute on function private.get_shopify_sync_status(),public.get_shopify_sync_status() to authenticated;

create function public.claim_shopify_order_jobs(p_worker_id uuid,p_limit integer default 1,p_lease_seconds integer default 120) returns jsonb language sql security invoker set search_path='' as $$select private.claim_shopify_order_jobs(p_worker_id,p_limit,p_lease_seconds)$$;
create function public.apply_shopify_order(p_job_id uuid,p_lease_token uuid,p_canonical jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.apply_shopify_order(p_job_id,p_lease_token,p_canonical)$$;
create function public.finish_shopify_read_job(p_job_id uuid,p_lease_token uuid,p_outcome text,p_reason text,p_retry_seconds integer default 60) returns jsonb language sql security invoker set search_path='' as $$select private.finish_shopify_read_job(p_job_id,p_lease_token,p_outcome,p_reason,p_retry_seconds)$$;
create function public.requeue_shopify_order_job(p_job_id uuid) returns boolean language sql security invoker set search_path='' as $$select private.requeue_shopify_order_job(p_job_id)$$;
do $$ declare r record;begin
  for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and(p.proname like 'shopify_%' or p.proname in('validate_shopify_canonical','claim_shopify_order_jobs','apply_shopify_order','finish_shopify_read_job','requeue_shopify_order_job')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
  end loop;
  for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname in('claim_shopify_order_jobs','apply_shopify_order','finish_shopify_read_job','requeue_shopify_order_job') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end $$;
commit;

