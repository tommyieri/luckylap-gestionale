-- New commands only; no real orders, memberships, stock counts or Finance data.
-- Keep the feature disabled until cutover and live runtime checks are complete.
begin;

alter type public.stock_movement_kind add value if not exists 'sale_fulfillment';
alter table public.app_settings
  add column manual_sales_enabled boolean not null default false,
  add column sales_started_at timestamptz,
  add constraint sales_start_required check (not manual_sales_enabled or sales_started_at is not null);

create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  channel text not null check (channel in ('direct', 'etsy', 'manual_other')),
  external_reference text check (char_length(external_reference) between 1 and 240),
  occurred_at timestamptz not null,
  operational_date date not null,
  currency text not null default 'EUR' check (currency = 'EUR'),
  total_cents bigint not null check (total_cents between 0 and 9000000000000000),
  payment_state text not null check (payment_state in ('paid', 'unpaid')),
  fulfillment_mode text not null check (fulfillment_mode in ('delivered_now', 'prepare')),
  fulfillment_state text not null check (fulfillment_state in ('fulfilled', 'unfulfilled')),
  reason text check (char_length(reason) between 3 and 500),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  command_result jsonb not null default '{}'::jsonb,
  check (operational_date = (occurred_at at time zone 'Europe/Rome')::date)
);
create unique index sales_orders_external_reference on public.sales_orders(channel, external_reference) where external_reference is not null;
create index sales_orders_occurred on public.sales_orders(occurred_at desc);
create index sales_orders_creator on public.sales_orders(created_by);

create table public.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sales_orders(id),
  stock_item_id uuid not null references public.stock_items(id),
  location_id uuid not null references public.stock_locations(id),
  sku_snapshot text not null,
  quantity integer not null check (quantity between 1 and 100000),
  fulfilled_quantity integer not null default 0 check (fulfilled_quantity >= 0),
  cancelled_quantity integer not null default 0 check (cancelled_quantity >= 0),
  unit_price_cents bigint not null check (unit_price_cents between 0 and 1000000000),
  discount_cents bigint not null check (discount_cents >= 0 and discount_cents <= unit_price_cents * quantity),
  list_price_cents bigint check (list_price_cents >= 0),
  unit_cost_cents bigint check (unit_cost_cents >= 0),
  line_total_cents bigint generated always as (unit_price_cents * quantity - discount_cents) stored,
  unique (order_id, stock_item_id),
  unique (id, stock_item_id, location_id),
  check (fulfilled_quantity + cancelled_quantity <= quantity)
);
create index sales_lines_item_location on public.sales_order_lines(stock_item_id, location_id);
create index sales_lines_location on public.sales_order_lines(location_id);

-- Operational payment declarations, not gateway verification or bank settlement.
-- References are Finance-only; ordinary members receive the order payment_state.
create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  order_id uuid not null unique references public.sales_orders(id),
  source_kind text not null default 'manual_declaration' check (source_kind = 'manual_declaration'),
  method text not null check (method in ('cash', 'bank_transfer', 'external_card', 'other')),
  amount_cents bigint not null check (amount_cents between 0 and 9000000000000000),
  currency text not null default 'EUR' check (currency = 'EUR'),
  occurred_at timestamptz not null,
  declared_reference text check (char_length(declared_reference) between 1 and 240),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now()
);
create index order_payments_creator on public.order_payments(created_by);

create table public.stock_reservations (
  order_line_id uuid primary key,
  stock_item_id uuid not null,
  location_id uuid not null,
  reserved_quantity bigint not null check (reserved_quantity >= 0),
  updated_at timestamptz not null default now(),
  foreign key (order_line_id, stock_item_id, location_id) references public.sales_order_lines(id, stock_item_id, location_id)
);
create index stock_reservations_item_location on public.stock_reservations(stock_item_id, location_id);
create index stock_reservations_location on public.stock_reservations(location_id);
create table public.stock_reservation_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  order_line_id uuid not null references public.sales_order_lines(id),
  kind text not null check (kind in ('allocate', 'release')),
  quantity_delta bigint not null check (quantity_delta <> 0 and abs(quantity_delta) <= 100000),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  check ((kind = 'allocate' and quantity_delta > 0) or (kind = 'release' and quantity_delta < 0))
);
create index stock_reservation_events_line on public.stock_reservation_events(order_line_id);
create index stock_reservation_events_creator on public.stock_reservation_events(created_by);

create table public.production_requirements (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null unique references public.sales_order_lines(id),
  required_quantity integer not null check (required_quantity between 1 and 100000),
  status text not null default 'to_plan' check (status = 'to_plan'),
  created_at timestamptz not null default now()
);
create table public.fulfillment_lines (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null unique references public.sales_order_lines(id),
  quantity integer not null check (quantity between 1 and 100000),
  stock_movement_id uuid not null unique references public.stock_movements(id),
  fulfilled_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Append-only observed facts: these amounts must NOT be summed together as
-- revenue. A sale, its payment and a BudgetFlow cash record are distinct facts.
create table public.commercial_facts (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  order_id uuid not null references public.sales_orders(id),
  payment_id uuid unique references public.order_payments(id),
  fact_kind text not null check (fact_kind in ('sale_observed', 'payment_reported')),
  amount_cents bigint not null check (amount_cents between 0 and 9000000000000000),
  currency text not null default 'EUR' check (currency = 'EUR'),
  occurred_at timestamptz not null,
  source_kind text not null default 'manual_declaration' check (source_kind = 'manual_declaration'),
  review_status text not null default 'observed_unclassified' check (review_status = 'observed_unclassified'),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  unique (order_id, fact_kind),
  check ((fact_kind = 'sale_observed' and payment_id is null) or (fact_kind = 'payment_reported' and payment_id is not null))
);
create index commercial_facts_creator on public.commercial_facts(created_by);

-- Durable internal notification only. No Shopify calls, providers or worker
-- are enabled by this migration. A future worker must be separately installed.
create table private.sales_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.sales_orders(id),
  event_type text not null default 'manual_sale_registered' check (event_type = 'manual_sale_registered'),
  state text not null default 'pending' check (state in ('pending', 'processed')),
  created_at timestamptz not null default now()
);
alter table private.sales_outbox enable row level security;
revoke all on private.sales_outbox from public, anon, authenticated;

create function private.guard_reserved_balance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare reserved bigint;
begin
  select coalesce(sum(reserved_quantity), 0) into reserved from public.stock_reservations
    where stock_item_id = new.stock_item_id and location_id = new.location_id;
  if reserved > 0 and (new.quantity is null or new.quantity < reserved) then
    raise exception 'reserved_stock_conflict' using errcode = '22023';
  end if;
  return new;
end
$$;
create trigger stock_balance_preserves_reservations before update of quantity on public.stock_balances
for each row execute function private.guard_reserved_balance();

create function private.guard_stock_reservation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare on_hand bigint; other_reserved bigint; pending_quantity bigint;
begin
  if tg_op = 'UPDATE' and (new.order_line_id <> old.order_line_id or new.stock_item_id <> old.stock_item_id or new.location_id <> old.location_id) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  select quantity into on_hand from public.stock_balances
    where stock_item_id = new.stock_item_id and location_id = new.location_id for update;
  if not found or on_hand is null then raise exception 'unknown_stock' using errcode = '22023'; end if;
  select coalesce(sum(reserved_quantity), 0) into other_reserved from public.stock_reservations
    where stock_item_id = new.stock_item_id and location_id = new.location_id and order_line_id <> new.order_line_id;
  select quantity - fulfilled_quantity - cancelled_quantity into pending_quantity from public.sales_order_lines where id = new.order_line_id;
  if new.reserved_quantity < 0 or new.reserved_quantity > pending_quantity or new.reserved_quantity + other_reserved > on_hand then
    raise exception 'reserved_stock_conflict' using errcode = '22023';
  end if;
  return new;
end
$$;
create trigger guard_stock_reservation before insert or update on public.stock_reservations
for each row execute function private.guard_stock_reservation();

create function private.apply_reservation_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare line public.sales_order_lines%rowtype; previous bigint;
begin
  select * into strict line from public.sales_order_lines where id = new.order_line_id;
  -- Every allocator locks this balance, even if no projection row exists yet.
  perform 1 from public.stock_balances where stock_item_id = line.stock_item_id and location_id = line.location_id for update;
  select reserved_quantity into previous from public.stock_reservations where order_line_id = line.id;
  previous := coalesce(previous, 0);
  insert into public.stock_reservations(order_line_id, stock_item_id, location_id, reserved_quantity)
    values (line.id, line.stock_item_id, line.location_id, previous + new.quantity_delta)
    on conflict (order_line_id) do update set reserved_quantity = excluded.reserved_quantity, updated_at = now();
  return new;
end
$$;
create trigger apply_reservation_event before insert on public.stock_reservation_events
for each row execute function private.apply_reservation_event();

create view public.operational_stock_availability with (security_invoker = true) as
select b.stock_item_id, b.location_id, b.quantity as on_hand,
  coalesce(sum(r.reserved_quantity), 0)::bigint as reserved,
  b.quantity - coalesce(sum(r.reserved_quantity), 0)::bigint as available
from public.stock_balances b left join public.stock_reservations r
  on r.stock_item_id = b.stock_item_id and r.location_id = b.location_id
group by b.stock_item_id, b.location_id, b.quantity;
revoke all on public.operational_stock_availability from public, anon, authenticated;
grant select on public.operational_stock_availability to authenticated;

-- All exposed writes pass through the command. No client DML on projections,
-- source facts, payments or fulfillment effects, even for Finance or founder.
do $$
declare table_name text;
begin
  foreach table_name in array array['sales_orders', 'sales_order_lines', 'order_payments',
    'stock_reservations', 'stock_reservation_events', 'production_requirements', 'fulfillment_lines', 'commercial_facts'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    if table_name in ('order_payments', 'commercial_facts') then
      execute format('create policy finance_read on public.%I for select to authenticated using ((select private.can_finance()))', table_name);
    else
      execute format('create policy member_read on public.%I for select to authenticated using ((select private.is_member()))', table_name);
    end if;
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()', table_name);
    if table_name in ('order_payments', 'stock_reservation_events', 'fulfillment_lines', 'commercial_facts') then
      execute format('create trigger sales_fact_append_only before update or delete on public.%I for each row execute function private.reject_ledger_mutation()', table_name);
    end if;
  end loop;
end
$$;

create function private.sale_object(p_value jsonb, p_required text[], p_allowed text[]) returns void
language plpgsql immutable security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'object' or not (p_value ?& p_required) or (p_value - p_allowed) <> '{}'::jsonb then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
end
$$;
create function private.sale_integer(p_value jsonb, p_min bigint, p_max bigint) returns bigint
language plpgsql immutable security invoker set search_path = '' as $$
declare value numeric;
begin
  if jsonb_typeof(p_value) is distinct from 'number' or (p_value #>> '{}') !~ '^(0|[1-9][0-9]{0,15})$' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  value := (p_value #>> '{}')::numeric;
  if value < p_min or value > p_max then raise exception 'invalid_payload' using errcode = '22023'; end if;
  return value::bigint;
end
$$;
create function private.sale_timestamp(p_value jsonb) returns timestamptz
language plpgsql stable security invoker set search_path = '' as $$
declare value timestamptz;
begin
  if jsonb_typeof(p_value) is distinct from 'string' or (p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  value := (p_value #>> '{}')::timestamptz;
  if not isfinite(value) or value > now() then raise exception 'invalid_payload' using errcode = '22023'; end if;
  return value;
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

-- Privileged process is in the non-exposed private schema, with explicit caller
-- checks. Public wrapper remains invoker. No provider identities are accepted.
create function private.register_manual_sale(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
<<sale_command>>
declare
  actor uuid := auth.uid();
  channel text; external_reference text; reason text; mode text; occurred timestamptz;
  location uuid; raw_line jsonb; normalized_lines jsonb := '[]'::jsonb; normalized jsonb;
  item uuid; qty bigint; price bigint; discount bigint; total bigint := 0;
  payment jsonb; payment_state text; payment_method text; payment_amount bigint; payment_at timestamptz; payment_reference text;
  request_hash text; existing public.sales_orders%rowtype; order_id uuid := gen_random_uuid();
  line_id uuid; movement_id uuid; payment_id uuid; fact_id uuid; result jsonb; result_lines jsonb := '[]'::jsonb;
  catalog public.stock_items%rowtype; on_hand bigint; reserved bigint; available bigint; allocate bigint; deficit bigint;
  start_at timestamptz; sale_enabled boolean;
begin
  if actor is null or not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  if p_operation_id is null then raise exception 'invalid_payload' using errcode = '22023'; end if;
  perform private.sale_object(p_payload,
    array['schema_version', 'channel', 'occurred_at', 'location_id', 'lines', 'fulfillment_mode', 'payment'],
    array['schema_version', 'channel', 'occurred_at', 'location_id', 'lines', 'fulfillment_mode', 'payment', 'external_reference', 'reason']);
  perform private.sale_integer(p_payload->'schema_version', 1, 1);
  channel := p_payload->>'channel'; mode := p_payload->>'fulfillment_mode';
  if channel is null or channel not in ('direct', 'etsy', 'manual_other') or mode is null or mode not in ('delivered_now', 'prepare') then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if p_payload ? 'external_reference' and jsonb_typeof(p_payload->'external_reference') not in ('string', 'null') then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  external_reference := nullif(btrim(p_payload->>'external_reference'), '');
  if char_length(external_reference) > 240 or (channel = 'etsy' and external_reference is null) then raise exception 'invalid_payload' using errcode = '22023'; end if;
  if p_payload ? 'reason' and jsonb_typeof(p_payload->'reason') not in ('string', 'null') then raise exception 'invalid_payload' using errcode = '22023'; end if;
  reason := nullif(btrim(p_payload->>'reason'), '');
  if reason is not null and char_length(reason) not between 3 and 500 then raise exception 'invalid_payload' using errcode = '22023'; end if;
  occurred := private.sale_timestamp(p_payload->'occurred_at');
  if jsonb_typeof(p_payload->'location_id') is distinct from 'string' then raise exception 'invalid_payload' using errcode = '22023'; end if;
  location := (p_payload->>'location_id')::uuid;
  if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 50 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  for raw_line in select value from jsonb_array_elements(p_payload->'lines') loop
    perform private.sale_object(raw_line, array['stock_item_id','quantity','unit_price_cents','discount_cents'], array['stock_item_id','quantity','unit_price_cents','discount_cents']);
    if jsonb_typeof(raw_line->'stock_item_id') is distinct from 'string' then raise exception 'invalid_payload' using errcode = '22023'; end if;
    item := (raw_line->>'stock_item_id')::uuid;
    qty := private.sale_integer(raw_line->'quantity', 1, 100000);
    price := private.sale_integer(raw_line->'unit_price_cents', 0, 1000000000);
    discount := private.sale_integer(raw_line->'discount_cents', 0, price * qty);
    total := total + price * qty - discount;
    normalized_lines := normalized_lines || jsonb_build_array(jsonb_build_object('stock_item_id', item, 'quantity', qty, 'unit_price_cents', price, 'discount_cents', discount));
  end loop;
  if (select count(distinct value->>'stock_item_id') from jsonb_array_elements(normalized_lines)) <> jsonb_array_length(normalized_lines) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  select jsonb_agg(value order by value->>'stock_item_id') into normalized_lines from jsonb_array_elements(normalized_lines);
  payment := p_payload->'payment';
  perform private.sale_object(payment, array['status'], array['status','method','amount_cents','occurred_at','reference']);
  payment_state := payment->>'status';
  if payment_state is null or payment_state not in ('paid','unpaid') then raise exception 'invalid_payload' using errcode = '22023'; end if;
  if payment_state = 'unpaid' then
    if payment <> '{"status":"unpaid"}'::jsonb then raise exception 'invalid_payload' using errcode = '22023'; end if;
    payment := jsonb_build_object('status','unpaid');
  else
    perform private.sale_object(payment, array['status','method','amount_cents','occurred_at'], array['status','method','amount_cents','occurred_at','reference']);
    payment_method := payment->>'method';
    if payment_method is null or payment_method not in ('cash','bank_transfer','external_card','other') then raise exception 'invalid_payload' using errcode = '22023'; end if;
    payment_amount := private.sale_integer(payment->'amount_cents', 0, 9000000000000000);
    if payment_amount <> total then raise exception 'invalid_payload' using errcode = '22023'; end if;
    payment_at := private.sale_timestamp(payment->'occurred_at');
    if payment ? 'reference' and jsonb_typeof(payment->'reference') not in ('string','null') then raise exception 'invalid_payload' using errcode = '22023'; end if;
    payment_reference := nullif(btrim(payment->>'reference'), '');
    if char_length(payment_reference) > 240 then raise exception 'invalid_payload' using errcode = '22023'; end if;
    payment := jsonb_build_object('status','paid','method',payment_method,'amount_cents',payment_amount,'occurred_at',payment_at,'reference',payment_reference);
  end if;
  normalized := jsonb_build_object('schema_version',1,'channel',channel,'external_reference',external_reference,'occurred_at',occurred,
    'location_id',location,'lines',normalized_lines,'fulfillment_mode',mode,'payment',payment,'reason',reason);
  request_hash := encode(sha256(convert_to(normalized::text, 'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.sale.' || p_operation_id::text, 0));
  select * into existing from public.sales_orders where operation_id = p_operation_id;
  if found then
    if existing.created_by <> actor or existing.payload_sha256 <> request_hash then raise exception 'idempotency_conflict' using errcode = '22023'; end if;
    return existing.command_result || '{"replayed":true}'::jsonb;
  end if;
  select manual_sales_enabled, sales_started_at into sale_enabled, start_at from public.app_settings where id;
  if not coalesce(sale_enabled, false) or start_at is null then raise exception 'sales_disabled' using errcode = '42501'; end if;
  if occurred < start_at or (payment_at is not null and payment_at < start_at) then raise exception 'invalid_payload' using errcode = '22023'; end if;
  if not exists (select 1 from public.stock_locations where id = location and active) then raise exception 'invalid_payload' using errcode = '22023'; end if;
  if external_reference is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.sale.ref.' || channel || '.' || external_reference, 0));
    if exists (select 1 from public.sales_orders o where o.channel = sale_command.channel and o.external_reference = sale_command.external_reference) then
      raise exception 'duplicate_external_reference' using errcode = '23505';
    end if;
  end if;
  -- Deterministic lock ordering across all requested SKU. Catalog snapshots and
  -- all balance/reservation changes are consistent inside this transaction.
  perform s.id from public.stock_items s where s.id in (select (value->>'stock_item_id')::uuid from jsonb_array_elements(normalized_lines)) order by s.id for share;
  perform b.stock_item_id from public.stock_balances b where b.location_id = location
    and b.stock_item_id in (select (value->>'stock_item_id')::uuid from jsonb_array_elements(normalized_lines)) order by b.stock_item_id for update;
  insert into public.sales_orders(id, operation_id, payload_sha256, channel, external_reference, occurred_at, operational_date,
    total_cents, payment_state, fulfillment_mode, fulfillment_state, reason, created_by)
  values (order_id,p_operation_id,request_hash,channel,external_reference,occurred,(occurred at time zone 'Europe/Rome')::date,
    total,payment_state,mode,case when mode='delivered_now' then 'fulfilled' else 'unfulfilled' end,reason,actor);
  for raw_line in select value from jsonb_array_elements(normalized_lines) loop
    item := (raw_line->>'stock_item_id')::uuid; qty := (raw_line->>'quantity')::bigint;
    price := (raw_line->>'unit_price_cents')::bigint; discount := (raw_line->>'discount_cents')::bigint;
    select * into catalog from public.stock_items where id=item;
    if not found or not catalog.active or catalog.kind <> 'product' or not exists (select 1 from public.product_variants where stock_item_id=item) then
      raise exception 'inactive_item' using errcode = '22023';
    end if;
    if (catalog.list_price_eur is null or price <> (catalog.list_price_eur * 100)::bigint or discount > 0) and reason is null then
      raise exception 'price_change_reason_required' using errcode = '22023';
    end if;
    select quantity into on_hand from public.stock_balances where stock_item_id=item and location_id=location;
    if not found or on_hand is null then raise exception 'unknown_stock' using errcode = '22023'; end if;
    select coalesce(sum(reserved_quantity),0) into reserved from public.stock_reservations where stock_item_id=item and location_id=location;
    available := on_hand - reserved;
    if available < 0 then raise exception 'reserved_stock_conflict' using errcode = '22023'; end if;
    if mode = 'delivered_now' and available < qty then raise exception 'insufficient_ready_stock' using errcode = '22023'; end if;
    line_id := gen_random_uuid(); allocate := 0; deficit := 0;
    insert into public.sales_order_lines(id,order_id,stock_item_id,location_id,sku_snapshot,quantity,fulfilled_quantity,
      unit_price_cents,discount_cents,list_price_cents,unit_cost_cents)
    values (line_id,order_id,item,location,catalog.sku,qty,case when mode='delivered_now' then qty else 0 end,
      price,discount,(catalog.list_price_eur*100)::bigint,(catalog.unit_cost_eur*100)::bigint);
    if mode = 'delivered_now' then
      insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)
      values (gen_random_uuid(),item,location,'sale_fulfillment',-qty,'Consegna vendita manuale',
        jsonb_build_object('sales_order_id',order_id,'sales_order_line_id',line_id),actor) returning id into movement_id;
      insert into public.fulfillment_lines(order_line_id,quantity,stock_movement_id,fulfilled_at) values (line_id,qty,movement_id,occurred);
      on_hand := on_hand - qty;
    else
      allocate := least(qty,available); deficit := qty-allocate;
      if allocate > 0 then
        insert into public.stock_reservation_events(operation_id,order_line_id,kind,quantity_delta,created_by)
          values (gen_random_uuid(),line_id,'allocate',allocate,actor);
      end if;
      if deficit > 0 then insert into public.production_requirements(order_line_id,required_quantity) values (line_id,deficit); end if;
    end if;
    result_lines := result_lines || jsonb_build_array(jsonb_build_object('order_line_id',line_id,'stock_item_id',item,
      'reserved_quantity',allocate,'production_required_quantity',deficit,'on_hand_after',on_hand,'available_after',on_hand-reserved-allocate));
  end loop;
  insert into public.commercial_facts(operation_id,order_id,fact_kind,amount_cents,occurred_at,created_by)
    values (gen_random_uuid(),order_id,'sale_observed',total,occurred,actor) returning id into fact_id;
  if payment_state = 'paid' then
    insert into public.order_payments(operation_id,order_id,method,amount_cents,occurred_at,declared_reference,created_by)
      values (gen_random_uuid(),order_id,payment_method,payment_amount,payment_at,payment_reference,actor) returning id into payment_id;
    insert into public.commercial_facts(operation_id,order_id,payment_id,fact_kind,amount_cents,occurred_at,created_by)
      values (gen_random_uuid(),order_id,payment_id,'payment_reported',payment_amount,payment_at,actor);
  end if;
  result := jsonb_build_object('order_id',order_id,'operation_id',p_operation_id,'replayed',false,'total_cents',total,
    'payment_state',payment_state,'fulfillment_state',case when mode='delivered_now' then 'fulfilled' else 'unfulfilled' end,
    'lines',result_lines,'commercial_fact_id',fact_id);
  update public.sales_orders set command_result=result where id=order_id;
  insert into private.sales_outbox(order_id) values (order_id);
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;
create function public.register_manual_sale(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.register_manual_sale(p_operation_id, p_payload)
$$;

revoke all on function private.guard_reserved_balance(), private.guard_stock_reservation(), private.apply_reservation_event(),
  private.sale_object(jsonb,text[],text[]), private.sale_integer(jsonb,bigint,bigint), private.sale_timestamp(jsonb),
  private.register_manual_sale(uuid,jsonb) from public, anon, authenticated;
grant execute on function private.register_manual_sale(uuid,jsonb) to authenticated;
revoke all on function public.register_manual_sale(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.register_manual_sale(uuid,jsonb) to authenticated;

commit;
