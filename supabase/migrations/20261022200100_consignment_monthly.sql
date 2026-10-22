-- Simple consignment: shops, shop counts, monthly reports, shop orders, report payments.
-- Additive only. The single data write is the configuration row of each existing
-- shop location, inserted before its audit trigger. No balance, movement or
-- existing row changes. The previous consignment RPCs keep working unchanged.
-- New enum values are used only inside plpgsql bodies (never in this transaction).
begin;
alter type public.stock_movement_kind add value if not exists 'shop_count';
alter type public.stock_movement_kind add value if not exists 'consignment_sale_correction';

-- Shop configuration. Name and active state stay in stock_locations (one source).
create table public.consignment_shops (
  location_id uuid primary key references public.stock_locations(id),
  supply_location_id uuid references public.stock_locations(id),
  brand_share_bps integer not null default 6000 check (brand_share_bps between 0 and 10000),
  markup_cents bigint not null default 1000 check (markup_cents between 0 and 100000000),
  currency text not null default 'EUR' check (currency = 'EUR'),
  -- NULL = never counted: the shop grid shows unknown, not zero.
  first_counted_at timestamptz check (isfinite(first_counted_at)),
  note text not null default '' check (char_length(note) <= 1000),
  version bigint not null default 1 check (version >= 1),
  -- NULL only on the rows created by this migration.
  created_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id),
  updated_at timestamptz not null default now(),
  check (supply_location_id <> location_id)
);
create index consignment_shops_supply on public.consignment_shops(supply_location_id);
create index consignment_shops_creator on public.consignment_shops(created_by);
create index consignment_shops_updater on public.consignment_shops(updated_by);

create table public.consignment_counts (
  id uuid primary key,
  location_id uuid not null references public.consignment_shops(location_id),
  counted_at timestamptz not null check (isfinite(counted_at)),
  full_count boolean not null,
  pieces bigint not null check (pieces >= 0),
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now()
);
create index consignment_counts_shop on public.consignment_counts(location_id, counted_at);
create index consignment_counts_creator on public.consignment_counts(created_by);

create table public.consignment_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.consignment_counts(id),
  location_id uuid not null references public.consignment_shops(location_id),
  stock_item_id uuid not null references public.stock_items(id),
  -- NULL = no known shop balance before the count (an opening movement follows).
  quantity_before bigint check (quantity_before >= 0),
  counted_quantity bigint not null check (counted_quantity between 0 and 100000),
  movement_id uuid unique references public.stock_movements(id),
  unique (count_id, stock_item_id),
  check ((movement_id is null) = (quantity_before is not distinct from counted_quantity))
);
create index consignment_count_lines_shop on public.consignment_count_lines(location_id);
create index consignment_count_lines_item on public.consignment_count_lines(stock_item_id);

create table public.consignment_reports (
  id uuid primary key,
  location_id uuid not null references public.consignment_shops(location_id),
  period_month date not null check (extract(day from period_month) = 1),
  revision integer not null default 1 check (revision between 1 and 100000),
  brand_share_bps integer not null check (brand_share_bps between 0 and 10000),
  markup_cents bigint not null check (markup_cents between 0 and 100000000),
  pieces bigint not null check (pieces >= 0),
  gross_cents bigint not null check (gross_cents between 0 and 9000000000000000),
  brand_cents bigint not null check (brand_cents >= 0),
  shop_cents bigint not null check (shop_cents >= 0),
  invoice_number text check (char_length(invoice_number) between 1 and 60),
  invoice_date date,
  invoice_revision integer,
  payment_state text not null check (payment_state in ('nothing_due', 'unpaid', 'partial', 'paid', 'overpaid')),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(user_id),
  updated_at timestamptz not null default now(),
  unique (location_id, period_month),
  check (brand_cents + shop_cents = gross_cents),
  check (num_nonnulls(invoice_number, invoice_date, invoice_revision) in (0, 3)),
  check (invoice_revision between 1 and revision),
  check (invoice_date >= period_month)
);
create index consignment_reports_creator on public.consignment_reports(created_by);
create index consignment_reports_updater on public.consignment_reports(updated_by);

create table public.consignment_report_lines (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.consignment_reports(id),
  location_id uuid not null references public.consignment_shops(location_id),
  stock_item_id uuid not null references public.stock_items(id),
  sku_snapshot text not null check (char_length(sku_snapshot) between 1 and 120),
  quantity integer not null check (quantity between 1 and 100000),
  -- Pieces sold before a count in the month: invoiced, never removed from stock again.
  before_count_quantity integer not null default 0 check (before_count_quantity between 0 and quantity),
  shop_domain text not null,
  variant_gid text not null,
  catalog_observed_at timestamptz not null check (isfinite(catalog_observed_at)),
  web_price_cents bigint not null check (web_price_cents between 0 and 99999999999999),
  markup_cents bigint not null check (markup_cents between 0 and 100000000),
  brand_share_bps integer not null check (brand_share_bps between 0 and 10000),
  unit_shop_price_cents bigint not null,
  gross_cents bigint not null check (gross_cents between 0 and 9000000000000000),
  brand_cents bigint not null,
  shop_cents bigint not null,
  unit_cost_cents bigint check (unit_cost_cents >= 0),
  priced_at timestamptz not null default now(),
  unique (report_id, stock_item_id),
  check (unit_shop_price_cents = web_price_cents + markup_cents),
  check (gross_cents::numeric = unit_shop_price_cents::numeric * quantity),
  check (brand_cents = round(gross_cents::numeric * brand_share_bps / 10000)::bigint),
  check (shop_cents = gross_cents - brand_cents)
);
create index consignment_report_lines_shop on public.consignment_report_lines(location_id);
create index consignment_report_lines_item on public.consignment_report_lines(stock_item_id);

create table public.consignment_report_revisions (
  id uuid primary key,
  report_id uuid not null references public.consignment_reports(id),
  location_id uuid not null references public.consignment_shops(location_id),
  revision integer not null check (revision between 1 and 100000),
  change_kind text not null check (change_kind in ('lines', 'invoice')),
  reason text check (char_length(reason) between 3 and 500),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  unique (report_id, revision),
  check (change_kind <> 'lines' or revision = 1 or reason is not null)
);
create index consignment_report_revisions_shop on public.consignment_report_revisions(location_id);
create index consignment_report_revisions_creator on public.consignment_report_revisions(created_by);

-- Source of the shop stock changes of a report version, and of packaging consumption.
create table public.consignment_report_movements (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.consignment_report_revisions(id),
  location_id uuid not null references public.consignment_shops(location_id),
  stock_item_id uuid not null references public.stock_items(id),
  quantity_delta bigint not null check (quantity_delta <> 0 and quantity_delta between -100000 and 100000),
  movement_id uuid not null unique references public.stock_movements(id),
  created_at timestamptz not null default now(),
  unique (revision_id, stock_item_id)
);
create index consignment_report_movements_shop on public.consignment_report_movements(location_id);
create index consignment_report_movements_item on public.consignment_report_movements(stock_item_id);

create table public.consignment_orders (
  id uuid primary key,
  location_id uuid not null references public.consignment_shops(location_id),
  order_number integer not null check (order_number between 1 and 1000000),
  requested_on date not null,
  note text not null default '' check (char_length(note) <= 1000),
  status text not null default 'open' check (status in ('open', 'delivered', 'closed')),
  close_reason text check (char_length(close_reason) between 3 and 500),
  version bigint not null default 1 check (version >= 1),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(user_id),
  updated_at timestamptz not null default now(),
  unique (location_id, order_number),
  check ((status = 'closed') = (close_reason is not null))
);
create index consignment_orders_creator on public.consignment_orders(created_by);
create index consignment_orders_updater on public.consignment_orders(updated_by);

create table public.consignment_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.consignment_orders(id),
  location_id uuid not null references public.consignment_shops(location_id),
  stock_item_id uuid not null references public.stock_items(id),
  quantity integer not null check (quantity between 1 and 100000),
  delivered_quantity integer not null default 0 check (delivered_quantity >= 0),
  cancelled_quantity integer not null default 0 check (cancelled_quantity >= 0),
  unique (order_id, stock_item_id),
  check (delivered_quantity + cancelled_quantity <= quantity)
);
create index consignment_order_lines_shop on public.consignment_order_lines(location_id);
create index consignment_order_lines_item on public.consignment_order_lines(stock_item_id);

create table public.consignment_shipments (
  id uuid primary key,
  location_id uuid not null references public.consignment_shops(location_id),
  direction text not null check (direction in ('to_shop', 'to_warehouse')),
  order_id uuid references public.consignment_orders(id),
  warehouse_location_id uuid not null references public.stock_locations(id),
  occurred_at timestamptz not null check (isfinite(occurred_at)),
  reason text not null check (char_length(reason) between 3 and 500),
  pieces bigint not null check (pieces >= 1),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  check ((direction = 'to_shop') = (order_id is not null))
);
create index consignment_shipments_shop on public.consignment_shipments(location_id, occurred_at);
create index consignment_shipments_order on public.consignment_shipments(order_id);
create index consignment_shipments_warehouse on public.consignment_shipments(warehouse_location_id);
create index consignment_shipments_creator on public.consignment_shipments(created_by);

-- Each line is one consignment_transfers row with its transfer_out/transfer_in pair.
create table public.consignment_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.consignment_shipments(id),
  location_id uuid not null references public.consignment_shops(location_id),
  stock_item_id uuid not null references public.stock_items(id),
  quantity integer not null check (quantity between 1 and 100000),
  transfer_id uuid not null unique references public.consignment_transfers(id),
  unique (shipment_id, stock_item_id)
);
create index consignment_shipment_lines_shop on public.consignment_shipment_lines(location_id);
create index consignment_shipment_lines_item on public.consignment_shipment_lines(stock_item_id);

-- Money received from the shop. Finance only.
create table public.consignment_report_payments (
  id uuid primary key,
  report_id uuid not null references public.consignment_reports(id),
  location_id uuid not null references public.consignment_shops(location_id),
  amount_cents bigint not null check (amount_cents between 1 and 9000000000000000),
  paid_at timestamptz not null check (isfinite(paid_at)),
  method text not null check (method in ('bank_transfer', 'cash', 'other')),
  account_label text check (char_length(account_label) between 1 and 120),
  reference text check (char_length(reference) between 1 and 240),
  voided boolean not null default false,
  version bigint not null default 1 check (version >= 1),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(user_id),
  updated_at timestamptz not null default now()
);
create index consignment_report_payments_report on public.consignment_report_payments(report_id);
create index consignment_report_payments_shop on public.consignment_report_payments(location_id);
create index consignment_report_payments_creator on public.consignment_report_payments(created_by);
create index consignment_report_payments_updater on public.consignment_report_payments(updated_by);

create table public.consignment_payment_revisions (
  id uuid primary key,
  payment_id uuid not null references public.consignment_report_payments(id),
  location_id uuid not null references public.consignment_shops(location_id),
  version bigint not null check (version >= 1),
  reason text check (char_length(reason) between 3 and 500),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  unique (payment_id, version),
  check ((version = 1) = (reason is null))
);
create index consignment_payment_revisions_shop on public.consignment_payment_revisions(location_id);
create index consignment_payment_revisions_creator on public.consignment_payment_revisions(created_by);

-- One configuration row per existing shop location, before the audit trigger:
-- terms from app_settings, supply = the only active Magazzino (if exactly one).
insert into public.consignment_shops(location_id, supply_location_id, brand_share_bps, markup_cents)
select l.id,
  case when (select count(*) from public.stock_locations m where m.location_type = 'Magazzino' and m.active) = 1
    then (select m.id from public.stock_locations m where m.location_type = 'Magazzino' and m.active) end,
  round(s.brand_share_percent * 100)::integer, round(s.consignment_surcharge_eur * 100)::bigint
from public.stock_locations l cross join public.app_settings s
where l.location_type = 'Negozio Conto Vendita' and s.id
on conflict (location_id) do nothing;

-- Members read; payments and their history are Finance only. Clients never write:
-- every change goes through the private commands below.
do $$
declare t text;
begin
  foreach t in array array['consignment_shops', 'consignment_counts', 'consignment_count_lines',
    'consignment_reports', 'consignment_report_lines', 'consignment_report_revisions',
    'consignment_report_movements', 'consignment_orders', 'consignment_order_lines',
    'consignment_shipments', 'consignment_shipment_lines', 'consignment_report_payments',
    'consignment_payment_revisions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy consignment_read on public.%I for select to authenticated using ((select private.%I()))',
      t, case when t in ('consignment_report_payments', 'consignment_payment_revisions') then 'can_finance' else 'is_member' end);
    if t in ('consignment_counts', 'consignment_count_lines', 'consignment_report_revisions',
      'consignment_report_movements', 'consignment_shipments', 'consignment_shipment_lines',
      'consignment_payment_revisions') then
      execute format('create trigger consignment_append_only before update or delete on public.%I for each row execute function private.reject_ledger_mutation()', t);
    end if;
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()', t);
  end loop;
end
$$;
comment on table public.consignment_reports is 'Monthly shop report: commercial claims, not money received. Creates no finance_entries, sales_orders, commercial_facts or consignment_sales. Prices are locked per line.';
comment on table public.consignment_report_payments is 'Money received from the shop for a monthly report. Finance only. History in consignment_payment_revisions.';

-- Validation helpers. No client grants.
create function private.consignment_uuid(p_value jsonb, p_nullable boolean) returns uuid
language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_nullable and p_value = 'null'::jsonb then return null; end if;
  return private.consignment_text(p_value, 36, 36)::uuid;
end
$$;
create function private.consignment_optional_integer(p_value jsonb, p_min bigint, p_max bigint) returns bigint
language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_value = 'null'::jsonb then return null; end if;
  return private.sale_integer(p_value, p_min, p_max);
end
$$;
create function private.consignment_optional_text(p_value jsonb, p_min integer, p_max integer) returns text
language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_value = 'null'::jsonb then return null; end if;
  return private.consignment_text(p_value, p_min, p_max);
end
$$;
-- Free notes: may be empty and may contain line breaks, no other control characters.
create function private.consignment_note(p_value jsonb, p_max integer) returns text
language plpgsql immutable security invoker set search_path = '' as $$
declare v_note text;
begin
  if jsonb_typeof(p_value) is distinct from 'string' then raise exception 'invalid_payload' using errcode = '22023'; end if;
  v_note := btrim(replace(p_value #>> '{}', E'\r\n', E'\n'), E' \n');
  if char_length(v_note) > p_max or replace(v_note, E'\n', '') ~ '[[:cntrl:]]' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  return v_note;
end
$$;
create function private.consignment_boolean(p_value jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'boolean' then raise exception 'invalid_payload' using errcode = '22023'; end if;
  return (p_value #>> '{}')::boolean;
end
$$;
-- A calendar day (YYYY-MM-DD), not after today in Rome.
create function private.consignment_day(p_value jsonb) returns date
language plpgsql stable security invoker set search_path = '' as $$
declare v_day date;
begin
  if jsonb_typeof(p_value) is distinct from 'string' then raise exception 'invalid_payload' using errcode = '22023'; end if;
  if (p_value #>> '{}') !~ '^2[0-9]{3}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_date' using errcode = '22023'; end if;
  v_day := (p_value #>> '{}')::date;
  if to_char(v_day, 'YYYY-MM-DD') <> (p_value #>> '{}') or v_day > (now() at time zone 'Europe/Rome')::date then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  return v_day;
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'invalid_date' using errcode = '22023';
end
$$;
-- A report month (YYYY-MM): from the sales start month to the current month, in Rome.
create function private.consignment_period(p_value jsonb) returns date
language plpgsql stable security definer set search_path = '' as $$
declare v_period date; v_started timestamptz;
begin
  if jsonb_typeof(p_value) is distinct from 'string' then raise exception 'invalid_payload' using errcode = '22023'; end if;
  if (p_value #>> '{}') !~ '^2[0-9]{3}-(0[1-9]|1[0-2])$' then raise exception 'invalid_period' using errcode = '22023'; end if;
  v_period := ((p_value #>> '{}') || '-01')::date;
  if v_period > date_trunc('month', now() at time zone 'Europe/Rome')::date then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  select sales_started_at into v_started from public.app_settings where id;
  if v_started is not null and v_period < date_trunc('month', v_started at time zone 'Europe/Rome')::date then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  return v_period;
end
$$;
-- Lines sorted by stock item (the lock order), without duplicates.
create function private.consignment_sorted_lines(p_lines jsonb) returns jsonb
language plpgsql immutable security invoker set search_path = '' as $$
declare v_sorted jsonb;
begin
  if (select count(distinct (value ->> 'stock_item_id')::uuid) from jsonb_array_elements(p_lines)) <> jsonb_array_length(p_lines) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(value order by (value ->> 'stock_item_id')::uuid), '[]'::jsonb) into v_sorted
    from jsonb_array_elements(p_lines);
  return v_sorted;
end
$$;
create function private.consignment_flags(p_sales boolean) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.app_settings where id and stock_adjustments_enabled) then
    raise exception 'stock_mutations_disabled' using errcode = '42501';
  end if;
  if p_sales and not exists (select 1 from public.app_settings where id and manual_sales_enabled and sales_started_at is not null) then
    raise exception 'sales_disabled' using errcode = '42501';
  end if;
end
$$;
-- Locks the shop row: every command of the same shop is serialized here, first.
create function private.consignment_shop_for_update(p_location uuid, p_active_only boolean) returns public.consignment_shops
language plpgsql security definer set search_path = '' as $$
declare v_shop public.consignment_shops%rowtype;
begin
  select * into v_shop from public.consignment_shops where location_id = p_location for update;
  if not found or not exists (select 1 from public.stock_locations l where l.id = p_location
    and l.location_type = 'Negozio Conto Vendita' and (l.active or not p_active_only)) then
    raise exception 'invalid_location' using errcode = '22023';
  end if;
  return v_shop;
end
$$;
-- A shop balance must be known before stock arrives. Missing or unknown: opening at 0.
create function private.consignment_ensure_shop_balance(p_item uuid, p_shop uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.stock_balances where stock_item_id = p_item and location_id = p_shop and quantity is not null) then
    insert into public.stock_movements(operation_id, stock_item_id, location_id, kind, quantity_delta, reason, source, actor_id)
      values (gen_random_uuid(), p_item, p_shop, 'opening', 0, 'Prima consegna al negozio: giacenza di partenza 0',
        jsonb_build_object('kind', 'consignment_shop_opening'), auth.uid());
  end if;
end
$$;
-- Same rules as private.transfer_consignment_stock, without a receipt: Magazzino <->
-- shop only, known balances, reservations respected, two movements, one transfer row.
-- The caller already holds the balance locks in (stock_item_id, location_id) order.
create function private.consignment_move(p_item uuid, p_from uuid, p_to uuid, p_quantity bigint, p_reason text, p_at timestamptz, p_source jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_from_type text; v_to_type text; v_balance bigint; v_sku text; v_out uuid; v_in uuid; v_transfer uuid := gen_random_uuid(); v_source jsonb;
begin
  perform id from public.stock_locations where id in (p_from, p_to) order by id for share;
  select location_type into v_from_type from public.stock_locations where id = p_from and active;
  select location_type into v_to_type from public.stock_locations where id = p_to and active;
  if p_from = p_to or v_from_type is null or v_to_type is null
    or not ((v_from_type = 'Magazzino' and v_to_type = 'Negozio Conto Vendita') or (v_from_type = 'Negozio Conto Vendita' and v_to_type = 'Magazzino')) then
    raise exception 'invalid_location' using errcode = '22023';
  end if;
  perform location_id from public.stock_balances where stock_item_id = p_item and location_id in (p_from, p_to) order by location_id for update;
  select sku into v_sku from public.stock_items where id = p_item;
  if (select count(*) from public.stock_balances where stock_item_id = p_item and location_id in (p_from, p_to) and quantity is not null) <> 2 then
    raise exception 'unknown_stock' using errcode = '22023', detail = coalesce(v_sku, '');
  end if;
  select quantity into v_balance from public.stock_balances where stock_item_id = p_item and location_id = p_from;
  if v_balance - coalesce((select sum(reserved_quantity) from public.stock_reservations where stock_item_id = p_item and location_id = p_from), 0) < p_quantity then
    raise exception '%', case when v_from_type = 'Magazzino' then 'insufficient_stock' else 'insufficient_shop_stock' end
      using errcode = '22023', detail = coalesce(v_sku, '');
  end if;
  v_source := coalesce(p_source, '{}'::jsonb) || jsonb_build_object('consignment_transfer_id', v_transfer, 'occurred_at', p_at);
  insert into public.stock_movements(operation_id, stock_item_id, location_id, kind, quantity_delta, reason, source, actor_id)
    values (gen_random_uuid(), p_item, p_from, 'transfer_out', -p_quantity, p_reason, v_source, auth.uid()) returning id into v_out;
  insert into public.stock_movements(operation_id, stock_item_id, location_id, kind, quantity_delta, reason, source, actor_id)
    values (gen_random_uuid(), p_item, p_to, 'transfer_in', p_quantity, p_reason, v_source, auth.uid()) returning id into v_in;
  insert into public.consignment_transfers(id, stock_item_id, from_location_id, to_location_id, quantity, reason, occurred_at, out_movement_id, in_movement_id, created_by)
    values (v_transfer, p_item, p_from, p_to, p_quantity, p_reason, p_at, v_out, v_in, auth.uid());
  return v_transfer;
end
$$;
-- Payment state from the non-voided payments; visible to every member.
create function private.consignment_refresh_payment_state(p_report uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_due bigint; v_paid numeric; v_state text;
begin
  select brand_cents into v_due from public.consignment_reports where id = p_report;
  select coalesce(sum(amount_cents), 0) into v_paid from public.consignment_report_payments where report_id = p_report and not voided;
  v_state := case when v_paid = 0 and v_due = 0 then 'nothing_due' when v_paid = 0 then 'unpaid'
    when v_paid < v_due then 'partial' when v_paid = v_due then 'paid' else 'overpaid' end;
  update public.consignment_reports set payment_state = v_state where id = p_report and payment_state <> v_state;
  return v_state;
end
$$;
create function private.consignment_report_snapshot(p_report uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'period_month', to_char(r.period_month, 'YYYY-MM'), 'brand_share_bps', r.brand_share_bps, 'markup_cents', r.markup_cents,
    'pieces', r.pieces, 'gross_cents', r.gross_cents, 'brand_cents', r.brand_cents, 'shop_cents', r.shop_cents,
    'invoice', case when r.invoice_number is null then null else jsonb_build_object('number', r.invoice_number, 'date', r.invoice_date, 'revision', r.invoice_revision) end,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('stock_item_id', l.stock_item_id, 'sku', l.sku_snapshot, 'quantity', l.quantity,
      'before_count_quantity', l.before_count_quantity, 'web_price_cents', l.web_price_cents, 'unit_shop_price_cents', l.unit_shop_price_cents,
      'gross_cents', l.gross_cents, 'brand_cents', l.brand_cents, 'shop_cents', l.shop_cents) order by l.stock_item_id)
      from public.consignment_report_lines l where l.report_id = r.id), '[]'::jsonb))
  from public.consignment_reports r where r.id = p_report
$$;
create function private.consignment_payment_snapshot(p_payment uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('report_id', p.report_id, 'amount_cents', p.amount_cents, 'paid_at', p.paid_at, 'method', p.method,
    'account_label', p.account_label, 'reference', p.reference, 'voided', p.voided)
  from public.consignment_report_payments p where p.id = p_payment
$$;

-- Commands. Each one: identity and permission; validation; canonical payload and
-- receipt (an identical replay returns the original result before any flag check);
-- flags; shop lock, then touched rows, then balances by stock item and location;
-- effects; receipt.
create function private.save_consignment_shop(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_location uuid; v_expected bigint; v_name text; v_bps bigint; v_markup bigint; v_supply uuid; v_note text; v_active boolean;
  v_canonical jsonb; v_replay jsonb; v_shop public.consignment_shops%rowtype; v_place public.stock_locations%rowtype; v_code text; v_result jsonb;
begin
  if not private.can_finance() then raise exception 'finance_access_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload,
    array['schema_version', 'location_id', 'expected_version', 'name', 'brand_share_bps', 'markup_cents', 'supply_location_id', 'note', 'active'],
    array['schema_version', 'location_id', 'expected_version', 'name', 'brand_share_bps', 'markup_cents', 'supply_location_id', 'note', 'active']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_location := private.consignment_uuid(p_payload -> 'location_id', true);
  v_expected := private.consignment_optional_integer(p_payload -> 'expected_version', 1, 9000000000000000);
  v_name := private.consignment_text(p_payload -> 'name', 3, 120);
  v_bps := private.sale_integer(p_payload -> 'brand_share_bps', 0, 10000);
  v_markup := private.sale_integer(p_payload -> 'markup_cents', 0, 100000000);
  v_supply := private.consignment_uuid(p_payload -> 'supply_location_id', false);
  v_note := private.consignment_note(p_payload -> 'note', 1000);
  v_active := private.consignment_boolean(p_payload -> 'active');
  if (v_location is null) <> (v_expected is null) or (v_location is null and not v_active) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  v_canonical := jsonb_build_object('schema_version', 1, 'location_id', v_location, 'expected_version', v_expected, 'name', v_name,
    'brand_share_bps', v_bps, 'markup_cents', v_markup, 'supply_location_id', v_supply, 'note', v_note, 'active', v_active);
  v_replay := private.start_consignment(p_operation_id, 'save_consignment_shop', v_canonical);
  if v_replay is not null then return v_replay; end if;
  if v_location is null then
    -- New shop: first free code NEG01..NEG99, chosen under one lock.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.consignment.shop_code', 0));
    select 'NEG' || lpad(n::text, 2, '0') into v_code from generate_series(1, 99) n
      where not exists (select 1 from public.stock_locations l where l.code = 'NEG' || lpad(n::text, 2, '0')) order by n limit 1;
    if v_code is null then raise exception 'invalid_location' using errcode = '22023'; end if;
    perform 1 from public.stock_locations where id = v_supply and active and location_type = 'Magazzino' for share;
    if not found then raise exception 'invalid_location' using errcode = '22023'; end if;
    insert into public.stock_locations(code, name, location_type, source, active)
      values (v_code, v_name, 'Negozio Conto Vendita', jsonb_build_object('consignment_operation_id', p_operation_id), true)
      returning id into v_location;
    insert into public.consignment_shops(location_id, supply_location_id, brand_share_bps, markup_cents, note, created_by, updated_by)
      values (v_location, v_supply, v_bps, v_markup, v_note, auth.uid(), auth.uid()) returning * into v_shop;
  else
    v_shop := private.consignment_shop_for_update(v_location, false);
    if v_shop.version <> v_expected then raise exception 'stale_version' using errcode = '22023'; end if;
    perform 1 from public.stock_locations where id = v_supply and active and location_type = 'Magazzino' for share;
    if not found then raise exception 'invalid_location' using errcode = '22023'; end if;
    select * into v_place from public.stock_locations where id = v_location for update;
    -- A shop closes only without T-shirts, open orders or reports still to be paid.
    if v_place.active and not v_active and (
      exists (select 1 from public.stock_balances where location_id = v_location and quantity > 0)
      or exists (select 1 from public.consignment_orders where location_id = v_location and status = 'open')
      or exists (select 1 from public.consignment_reports where location_id = v_location and payment_state in ('unpaid', 'partial'))) then
      raise exception 'shop_not_empty' using errcode = '22023';
    end if;
    if v_place.name is distinct from v_name or v_place.active is distinct from v_active then
      update public.stock_locations set name = v_name, active = v_active where id = v_location;
    end if;
    update public.consignment_shops set supply_location_id = v_supply, brand_share_bps = v_bps, markup_cents = v_markup, note = v_note,
      version = version + 1, updated_by = auth.uid(), updated_at = now()
      where location_id = v_location returning * into v_shop;
    v_code := v_place.code;
  end if;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'location_id', v_location, 'code', v_code, 'version', v_shop.version, 'replayed', false);
  return private.finish_consignment(p_operation_id, 'save_consignment_shop', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

-- Absolute shop count. The central warehouse never changes; no packaging.
create function private.count_consignment_stock(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_location uuid; v_at timestamptz; v_note text; v_raw jsonb; v_lines jsonb := '[]'::jsonb; v_canonical jsonb; v_replay jsonb;
  v_shop public.consignment_shops%rowtype; v_item uuid; v_quantity bigint; v_expected bigint; v_balance bigint; v_movement uuid;
  v_full boolean; v_pieces bigint := 0; v_sku text; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'location_id', 'counted_at', 'note', 'lines'],
    array['schema_version', 'location_id', 'counted_at', 'note', 'lines']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_location := private.consignment_uuid(p_payload -> 'location_id', false);
  v_at := private.consignment_date(p_payload -> 'counted_at');
  v_note := private.consignment_note(p_payload -> 'note', 500);
  if jsonb_typeof(p_payload -> 'lines') is distinct from 'array' or jsonb_array_length(p_payload -> 'lines') not between 1 and 200 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  for v_raw in select value from jsonb_array_elements(p_payload -> 'lines') loop
    perform private.sale_object(v_raw, array['stock_item_id', 'quantity', 'expected_quantity'], array['stock_item_id', 'quantity', 'expected_quantity']);
    v_quantity := private.sale_integer(v_raw -> 'quantity', 0, 100000);
    v_pieces := v_pieces + v_quantity;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('stock_item_id', private.consignment_uuid(v_raw -> 'stock_item_id', false),
      'quantity', v_quantity, 'expected_quantity', private.consignment_optional_integer(v_raw -> 'expected_quantity', 0, 1000000000)));
  end loop;
  v_lines := private.consignment_sorted_lines(v_lines);
  v_canonical := jsonb_build_object('schema_version', 1, 'location_id', v_location, 'counted_at', v_at, 'note', v_note, 'lines', v_lines);
  v_replay := private.start_consignment(p_operation_id, 'count_consignment_stock', v_canonical);
  if v_replay is not null then return v_replay; end if;
  perform private.consignment_flags(false);
  v_shop := private.consignment_shop_for_update(v_location, true);
  if exists (select 1 from jsonb_array_elements(v_lines) l where not private.is_packaged_tshirt((l.value ->> 'stock_item_id')::uuid)) then
    raise exception 'invalid_tshirt' using errcode = '22023';
  end if;
  v_full := not exists (select 1 from public.stock_items s join public.product_variants v on v.stock_item_id = s.id join public.products p on p.id = v.product_id
    where s.kind = 'product' and s.active and p.category = 'T-shirt'
      and not exists (select 1 from jsonb_array_elements(v_lines) l where (l.value ->> 'stock_item_id')::uuid = s.id));
  if v_shop.first_counted_at is null and not v_full then raise exception 'full_count_required' using errcode = '22023'; end if;
  perform 1 from public.stock_balances where location_id = v_location
    and stock_item_id in (select (value ->> 'stock_item_id')::uuid from jsonb_array_elements(v_lines)) order by stock_item_id for update;
  insert into public.consignment_counts(id, location_id, counted_at, full_count, pieces, note, created_by)
    values (p_operation_id, v_location, v_at, v_full, v_pieces, v_note, auth.uid());
  for v_raw in select value from jsonb_array_elements(v_lines) loop
    v_item := (v_raw ->> 'stock_item_id')::uuid; v_quantity := (v_raw ->> 'quantity')::bigint; v_expected := (v_raw ->> 'expected_quantity')::bigint;
    v_balance := null;
    select quantity into v_balance from public.stock_balances where stock_item_id = v_item and location_id = v_location;
    if v_balance is distinct from v_expected then
      select sku into v_sku from public.stock_items where id = v_item;
      raise exception 'stock_changed' using errcode = '22023', detail = v_sku;
    end if;
    v_movement := null;
    if v_balance is null then
      insert into public.stock_movements(operation_id, stock_item_id, location_id, kind, quantity_delta, reason, source, actor_id)
        values (gen_random_uuid(), v_item, v_location, 'opening', v_quantity, 'Conta in negozio',
          jsonb_build_object('consignment_count_id', p_operation_id, 'counted_at', v_at), auth.uid()) returning id into v_movement;
    elsif v_balance <> v_quantity then
      insert into public.stock_movements(operation_id, stock_item_id, location_id, kind, quantity_delta, reason, source, actor_id)
        values (gen_random_uuid(), v_item, v_location, 'shop_count'::public.stock_movement_kind, v_quantity - v_balance, 'Conta in negozio',
          jsonb_build_object('consignment_count_id', p_operation_id, 'counted_at', v_at), auth.uid()) returning id into v_movement;
    end if;
    insert into public.consignment_count_lines(count_id, location_id, stock_item_id, quantity_before, counted_quantity, movement_id)
      values (p_operation_id, v_location, v_item, v_balance, v_quantity, v_movement);
  end loop;
  if v_shop.first_counted_at is null then
    update public.consignment_shops set first_counted_at = v_at where location_id = v_location;
  end if;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'count_id', p_operation_id, 'location_id', v_location,
    'pieces', v_pieces, 'full_count', v_full, 'replayed', false);
  return private.finish_consignment(p_operation_id, 'count_consignment_stock', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

-- Creates or replaces the whole monthly report. Only the shop stock changes, by the
-- difference from the previous version; prices are locked when a variant enters.
create function private.save_consignment_report(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_location uuid; v_period date; v_expected bigint; v_reason text; v_raw jsonb; v_price jsonb; v_lines jsonb := '[]'::jsonb;
  v_canonical jsonb; v_replay jsonb; v_shop public.consignment_shops%rowtype; v_report public.consignment_reports%rowtype;
  v_report_id uuid; v_new boolean; v_bps integer; v_markup bigint; v_item uuid; v_quantity bigint; v_before bigint;
  v_old public.consignment_report_lines%rowtype; v_catalog public.shopify_catalog_variants%rowtype; v_sku text; v_cost bigint;
  v_planned jsonb := '[]'::jsonb; v_web bigint; v_unit bigint; v_gross numeric; v_brand bigint;
  v_pieces bigint := 0; v_total_gross numeric := 0; v_total_brand numeric := 0; v_revision integer;
  v_moves jsonb; v_move record; v_balance bigint; v_movement uuid; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'location_id', 'period_month', 'expected_revision', 'reason', 'lines'],
    array['schema_version', 'location_id', 'period_month', 'expected_revision', 'reason', 'lines']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_location := private.consignment_uuid(p_payload -> 'location_id', false);
  v_period := private.consignment_period(p_payload -> 'period_month');
  v_expected := private.consignment_optional_integer(p_payload -> 'expected_revision', 1, 100000);
  v_reason := private.consignment_optional_text(p_payload -> 'reason', 3, 500);
  if v_expected is not null and v_reason is null then raise exception 'invalid_payload' using errcode = '22023'; end if;
  if jsonb_typeof(p_payload -> 'lines') is distinct from 'array' or jsonb_array_length(p_payload -> 'lines') > 200 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  for v_raw in select value from jsonb_array_elements(p_payload -> 'lines') loop
    perform private.sale_object(v_raw, array['stock_item_id', 'quantity', 'before_count_quantity', 'price'],
      array['stock_item_id', 'quantity', 'before_count_quantity', 'price']);
    v_quantity := private.sale_integer(v_raw -> 'quantity', 0, 100000);
    v_before := private.sale_integer(v_raw -> 'before_count_quantity', 0, v_quantity);
    v_price := v_raw -> 'price';
    if v_price <> 'null'::jsonb then
      if v_quantity = 0 then raise exception 'invalid_payload' using errcode = '22023'; end if;
      perform private.sale_object(v_price, array['shop_domain', 'variant_gid', 'expected_web_price_cents', 'expected_catalog_observed_at'],
        array['shop_domain', 'variant_gid', 'expected_web_price_cents', 'expected_catalog_observed_at']);
      v_price := jsonb_build_object('shop_domain', private.consignment_text(v_price -> 'shop_domain', 1, 120),
        'variant_gid', private.consignment_text(v_price -> 'variant_gid', 1, 120),
        'expected_web_price_cents', private.sale_integer(v_price -> 'expected_web_price_cents', 0, 99999999999999),
        'expected_catalog_observed_at', private.consignment_date(v_price -> 'expected_catalog_observed_at'));
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('stock_item_id', private.consignment_uuid(v_raw -> 'stock_item_id', false),
      'quantity', v_quantity, 'before_count_quantity', v_before, 'price', v_price));
  end loop;
  v_lines := private.consignment_sorted_lines(v_lines);
  v_canonical := jsonb_build_object('schema_version', 1, 'location_id', v_location, 'period_month', to_char(v_period, 'YYYY-MM'),
    'expected_revision', v_expected, 'reason', v_reason, 'lines', v_lines);
  v_replay := private.start_consignment(p_operation_id, 'save_consignment_report', v_canonical);
  if v_replay is not null then return v_replay; end if;
  perform private.consignment_flags(true);
  v_shop := private.consignment_shop_for_update(v_location, true);
  if v_shop.first_counted_at is null then raise exception 'shop_not_counted' using errcode = '22023'; end if;
  select * into v_report from public.consignment_reports where location_id = v_location and period_month = v_period for update;
  v_new := not found;
  if v_new and v_expected is not null then raise exception 'report_not_found' using errcode = '22023'; end if;
  if not v_new and v_expected is null then raise exception 'report_exists' using errcode = '23505'; end if;
  if not v_new and v_report.revision <> v_expected then raise exception 'stale_version' using errcode = '22023'; end if;
  if v_new then
    v_report_id := p_operation_id; v_bps := v_shop.brand_share_bps; v_markup := v_shop.markup_cents; v_revision := 1;
  else
    v_report_id := v_report.id; v_bps := v_report.brand_share_bps; v_markup := v_report.markup_cents; v_revision := v_report.revision + 1;
  end if;
  -- "Before the count" pieces need a shop count from the start of the month on.
  if exists (select 1 from jsonb_array_elements(v_lines) where (value ->> 'before_count_quantity')::bigint > 0)
    and not exists (select 1 from public.consignment_counts c where c.location_id = v_location
      and c.counted_at >= (v_period::timestamp at time zone 'Europe/Rome')) then
    raise exception 'before_count_not_allowed' using errcode = '22023';
  end if;
  perform 1 from public.consignment_report_lines where report_id = v_report_id order by stock_item_id for update;
  for v_raw in select value from jsonb_array_elements(v_lines) loop
    v_item := (v_raw ->> 'stock_item_id')::uuid; v_quantity := (v_raw ->> 'quantity')::bigint; v_before := (v_raw ->> 'before_count_quantity')::bigint;
    v_price := v_raw -> 'price';
    select * into v_old from public.consignment_report_lines where report_id = v_report_id and stock_item_id = v_item;
    if found then
      if v_price <> 'null'::jsonb then raise exception 'invalid_payload' using errcode = '22023'; end if;
      continue when v_quantity = 0;
      v_unit := v_old.unit_shop_price_cents; v_gross := v_unit::numeric * v_quantity;
      if v_gross > 9000000000000000 then raise exception 'invalid_payload' using errcode = '22023'; end if;
      v_brand := round(v_gross * v_old.brand_share_bps / 10000)::bigint;
      v_planned := v_planned || jsonb_build_array(jsonb_build_object('existing', true, 'stock_item_id', v_item, 'quantity', v_quantity,
        'before_count_quantity', v_before, 'gross_cents', v_gross, 'brand_cents', v_brand, 'shop_cents', v_gross - v_brand));
    else
      continue when v_quantity = 0;
      if v_price = 'null'::jsonb then raise exception 'invalid_payload' using errcode = '22023'; end if;
      if not private.is_packaged_tshirt(v_item) then raise exception 'invalid_tshirt' using errcode = '22023'; end if;
      select s.sku, (s.unit_cost_eur * 100)::bigint into v_sku, v_cost from public.stock_items s where s.id = v_item;
      select * into v_catalog from public.shopify_catalog_variants c where c.shop_domain = v_price ->> 'shop_domain'
        and c.variant_gid = v_price ->> 'variant_gid' and c.stock_item_id = v_item and c.sku = v_sku and c.status = 'ACTIVE'
        and c.currency_code = 'EUR' and c.product_type = 'T-shirt' for share;
      if not found then raise exception 'unmatched_catalog' using errcode = '22023', detail = v_sku; end if;
      if v_catalog.price_cents <> (v_price ->> 'expected_web_price_cents')::bigint
        or v_catalog.observed_at <> (v_price ->> 'expected_catalog_observed_at')::timestamptz then
        raise exception 'catalog_changed' using errcode = '22023', detail = v_sku;
      end if;
      v_web := v_catalog.price_cents; v_unit := v_web + v_markup; v_gross := v_unit::numeric * v_quantity;
      if v_gross > 9000000000000000 then raise exception 'invalid_payload' using errcode = '22023'; end if;
      v_brand := round(v_gross * v_bps / 10000)::bigint;
      v_planned := v_planned || jsonb_build_array(jsonb_build_object('existing', false, 'stock_item_id', v_item, 'quantity', v_quantity,
        'before_count_quantity', v_before, 'sku', v_sku, 'shop_domain', v_catalog.shop_domain, 'variant_gid', v_catalog.variant_gid,
        'catalog_observed_at', v_catalog.observed_at, 'web_price_cents', v_web, 'unit_shop_price_cents', v_unit, 'unit_cost_cents', v_cost,
        'gross_cents', v_gross, 'brand_cents', v_brand, 'shop_cents', v_gross - v_brand));
    end if;
    v_pieces := v_pieces + v_quantity; v_total_gross := v_total_gross + v_gross; v_total_brand := v_total_brand + v_brand;
  end loop;
  if v_total_gross > 9000000000000000 then raise exception 'invalid_payload' using errcode = '22023'; end if;
  -- Shop stock moves by (sold - before the count), new version minus previous version.
  select coalesce(jsonb_agg(jsonb_build_object('stock_item_id', d.item, 'delta', d.delta) order by d.item), '[]'::jsonb) into v_moves
  from (
    select coalesce(n.stock_item_id, o.stock_item_id) item,
      coalesce(n.quantity - n.before_count_quantity, 0) - coalesce(o.quantity - o.before_count_quantity, 0) delta
    from jsonb_to_recordset(v_planned) as n(stock_item_id uuid, quantity bigint, before_count_quantity bigint)
    full join (select stock_item_id, quantity::bigint quantity, before_count_quantity::bigint before_count_quantity
      from public.consignment_report_lines where report_id = v_report_id) o on o.stock_item_id = n.stock_item_id
  ) d where d.delta <> 0;
  for v_move in select (value ->> 'stock_item_id')::uuid item from jsonb_array_elements(v_moves) where (value ->> 'delta')::bigint < 0 loop
    perform private.consignment_ensure_shop_balance(v_move.item, v_location);
  end loop;
  perform 1 from public.stock_balances where location_id = v_location
    and stock_item_id in (select (value ->> 'stock_item_id')::uuid from jsonb_array_elements(v_moves)) order by stock_item_id for update;
  for v_move in select (value ->> 'stock_item_id')::uuid item, (value ->> 'delta')::bigint delta from jsonb_array_elements(v_moves) loop
    if v_move.delta > 0 then
      select quantity into v_balance from public.stock_balances where stock_item_id = v_move.item and location_id = v_location;
      if v_balance is null or v_balance - coalesce((select sum(reserved_quantity) from public.stock_reservations
        where stock_item_id = v_move.item and location_id = v_location), 0) < v_move.delta then
        select sku into v_sku from public.stock_items where id = v_move.item;
        raise exception 'insufficient_shop_stock' using errcode = '22023', detail = v_sku;
      end if;
    end if;
  end loop;
  if v_new then
    insert into public.consignment_reports(id, location_id, period_month, revision, brand_share_bps, markup_cents, pieces, gross_cents,
      brand_cents, shop_cents, payment_state, created_by, updated_by)
      values (v_report_id, v_location, v_period, 1, v_bps, v_markup, v_pieces, v_total_gross, v_total_brand, v_total_gross - v_total_brand,
        case when v_total_brand = 0 then 'nothing_due' else 'unpaid' end, auth.uid(), auth.uid());
  else
    update public.consignment_reports set revision = v_revision, pieces = v_pieces, gross_cents = v_total_gross, brand_cents = v_total_brand,
      shop_cents = v_total_gross - v_total_brand, updated_by = auth.uid(), updated_at = now() where id = v_report_id;
    delete from public.consignment_report_lines l where l.report_id = v_report_id
      and not exists (select 1 from jsonb_to_recordset(v_planned) as p(stock_item_id uuid) where p.stock_item_id = l.stock_item_id);
    update public.consignment_report_lines l set quantity = p.quantity, before_count_quantity = p.before_count_quantity,
      gross_cents = p.gross_cents, brand_cents = p.brand_cents, shop_cents = p.shop_cents
      from jsonb_to_recordset(v_planned) as p(existing boolean, stock_item_id uuid, quantity integer, before_count_quantity integer,
        gross_cents bigint, brand_cents bigint, shop_cents bigint)
      where p.existing and l.report_id = v_report_id and l.stock_item_id = p.stock_item_id
        and (l.quantity, l.before_count_quantity) is distinct from (p.quantity, p.before_count_quantity);
  end if;
  insert into public.consignment_report_lines(report_id, location_id, stock_item_id, sku_snapshot, quantity, before_count_quantity, shop_domain,
    variant_gid, catalog_observed_at, web_price_cents, markup_cents, brand_share_bps, unit_shop_price_cents, gross_cents, brand_cents,
    shop_cents, unit_cost_cents)
  select v_report_id, v_location, p.stock_item_id, p.sku, p.quantity, p.before_count_quantity, p.shop_domain, p.variant_gid,
    p.catalog_observed_at, p.web_price_cents, v_markup, v_bps, p.unit_shop_price_cents, p.gross_cents, p.brand_cents, p.shop_cents, p.unit_cost_cents
  from jsonb_to_recordset(v_planned) as p(existing boolean, stock_item_id uuid, sku text, quantity integer, before_count_quantity integer,
    shop_domain text, variant_gid text, catalog_observed_at timestamptz, web_price_cents bigint, unit_shop_price_cents bigint,
    gross_cents bigint, brand_cents bigint, shop_cents bigint, unit_cost_cents bigint)
  where not p.existing order by p.stock_item_id;
  insert into public.consignment_report_revisions(id, report_id, location_id, revision, change_kind, reason, snapshot, created_by)
    values (p_operation_id, v_report_id, v_location, v_revision, 'lines', v_reason, private.consignment_report_snapshot(v_report_id), auth.uid());
  for v_move in select (value ->> 'stock_item_id')::uuid item, (value ->> 'delta')::bigint delta from jsonb_array_elements(v_moves) loop
    insert into public.stock_movements(operation_id, stock_item_id, location_id, kind, quantity_delta, reason, source, actor_id)
      values (gen_random_uuid(), v_move.item, v_location,
        case when v_move.delta > 0 then 'consignment_sale'::public.stock_movement_kind else 'consignment_sale_correction'::public.stock_movement_kind end,
        -v_move.delta, case when v_move.delta > 0 then 'Vendite del resoconto mensile' else 'Correzione del resoconto mensile' end,
        jsonb_build_object('consignment_report_id', v_report_id, 'consignment_report_revision_id', p_operation_id, 'period_month', to_char(v_period, 'YYYY-MM')),
        auth.uid()) returning id into v_movement;
    -- The packaging trigger reads this row: only negative deltas consume.
    insert into public.consignment_report_movements(revision_id, location_id, stock_item_id, quantity_delta, movement_id)
      values (p_operation_id, v_location, v_move.item, -v_move.delta, v_movement);
  end loop;
  perform private.consignment_refresh_payment_state(v_report_id);
  v_result := jsonb_build_object('operation_id', p_operation_id, 'report_id', v_report_id, 'revision', v_revision, 'replayed', false);
  return private.finish_consignment(p_operation_id, 'save_consignment_report', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

create function private.set_consignment_invoice(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_report_id uuid; v_expected bigint; v_number text; v_date date; v_canonical jsonb; v_replay jsonb; v_location uuid;
  v_report public.consignment_reports%rowtype; v_revision integer; v_result jsonb;
begin
  if not private.can_finance() then raise exception 'finance_access_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'report_id', 'expected_revision', 'invoice_number', 'invoice_date'],
    array['schema_version', 'report_id', 'expected_revision', 'invoice_number', 'invoice_date']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_report_id := private.consignment_uuid(p_payload -> 'report_id', false);
  v_expected := private.sale_integer(p_payload -> 'expected_revision', 1, 100000);
  v_number := private.consignment_optional_text(p_payload -> 'invoice_number', 1, 60);
  if p_payload -> 'invoice_date' <> 'null'::jsonb then v_date := private.consignment_day(p_payload -> 'invoice_date'); end if;
  if (v_number is null) <> (v_date is null) then raise exception 'invalid_payload' using errcode = '22023'; end if;
  v_canonical := jsonb_build_object('schema_version', 1, 'report_id', v_report_id, 'expected_revision', v_expected,
    'invoice_number', v_number, 'invoice_date', v_date);
  v_replay := private.start_consignment(p_operation_id, 'set_consignment_invoice', v_canonical);
  if v_replay is not null then return v_replay; end if;
  select location_id into v_location from public.consignment_reports where id = v_report_id;
  if not found then raise exception 'report_not_found' using errcode = '22023'; end if;
  perform private.consignment_shop_for_update(v_location, false);
  select * into v_report from public.consignment_reports where id = v_report_id for update;
  if v_report.revision <> v_expected then raise exception 'stale_version' using errcode = '22023'; end if;
  if v_date < v_report.period_month then raise exception 'invalid_date' using errcode = '22023'; end if;
  v_revision := v_report.revision + 1;
  update public.consignment_reports set revision = v_revision, invoice_number = v_number, invoice_date = v_date,
    invoice_revision = case when v_number is null then null else v_revision end, updated_by = auth.uid(), updated_at = now()
    where id = v_report_id;
  insert into public.consignment_report_revisions(id, report_id, location_id, revision, change_kind, reason, snapshot, created_by)
    values (p_operation_id, v_report_id, v_location, v_revision, 'invoice', null, private.consignment_report_snapshot(v_report_id), auth.uid());
  v_result := jsonb_build_object('operation_id', p_operation_id, 'report_id', v_report_id, 'revision', v_revision, 'replayed', false);
  return private.finish_consignment(p_operation_id, 'set_consignment_invoice', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

create function private.record_consignment_payment(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_report_id uuid; v_amount bigint; v_paid_at timestamptz; v_method text; v_account text; v_reference text; v_canonical jsonb; v_replay jsonb;
  v_location uuid; v_report public.consignment_reports%rowtype; v_paid numeric; v_result jsonb;
begin
  if not private.can_finance() then raise exception 'finance_access_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'report_id', 'amount_cents', 'paid_at', 'method', 'account_label', 'reference'],
    array['schema_version', 'report_id', 'amount_cents', 'paid_at', 'method', 'account_label', 'reference']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_report_id := private.consignment_uuid(p_payload -> 'report_id', false);
  v_amount := private.sale_integer(p_payload -> 'amount_cents', 1, 9000000000000000);
  v_paid_at := private.consignment_date(p_payload -> 'paid_at');
  v_method := private.consignment_text(p_payload -> 'method', 1, 20);
  if v_method not in ('bank_transfer', 'cash', 'other') then raise exception 'invalid_payload' using errcode = '22023'; end if;
  v_account := private.consignment_optional_text(p_payload -> 'account_label', 1, 120);
  v_reference := private.consignment_optional_text(p_payload -> 'reference', 1, 240);
  v_canonical := jsonb_build_object('schema_version', 1, 'report_id', v_report_id, 'amount_cents', v_amount, 'paid_at', v_paid_at,
    'method', v_method, 'account_label', v_account, 'reference', v_reference);
  v_replay := private.start_consignment(p_operation_id, 'record_consignment_payment', v_canonical);
  if v_replay is not null then return v_replay; end if;
  select location_id into v_location from public.consignment_reports where id = v_report_id;
  if not found then raise exception 'report_not_found' using errcode = '22023'; end if;
  perform private.consignment_shop_for_update(v_location, false);
  select * into v_report from public.consignment_reports where id = v_report_id for update;
  if v_paid_at < (v_report.period_month::timestamp at time zone 'Europe/Rome') then raise exception 'invalid_date' using errcode = '22023'; end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.consignment_report_payments where report_id = v_report_id and not voided;
  if v_paid + v_amount > v_report.brand_cents then raise exception 'payment_exceeds_invoice' using errcode = '22023'; end if;
  insert into public.consignment_report_payments(id, report_id, location_id, amount_cents, paid_at, method, account_label, reference, created_by, updated_by)
    values (p_operation_id, v_report_id, v_location, v_amount, v_paid_at, v_method, v_account, v_reference, auth.uid(), auth.uid());
  insert into public.consignment_payment_revisions(id, payment_id, location_id, version, reason, snapshot, created_by)
    values (p_operation_id, p_operation_id, v_location, 1, null, private.consignment_payment_snapshot(p_operation_id), auth.uid());
  perform private.consignment_refresh_payment_state(v_report_id);
  v_result := jsonb_build_object('operation_id', p_operation_id, 'payment_id', p_operation_id, 'report_id', v_report_id, 'replayed', false);
  return private.finish_consignment(p_operation_id, 'record_consignment_payment', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

create function private.update_consignment_payment(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_payment_id uuid; v_expected bigint; v_amount bigint; v_paid_at timestamptz; v_method text; v_account text; v_reference text;
  v_voided boolean; v_reason text; v_canonical jsonb; v_replay jsonb; v_report_id uuid; v_location uuid;
  v_report public.consignment_reports%rowtype; v_payment public.consignment_report_payments%rowtype; v_paid numeric; v_result jsonb;
begin
  if not private.can_finance() then raise exception 'finance_access_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload,
    array['schema_version', 'payment_id', 'expected_version', 'amount_cents', 'paid_at', 'method', 'account_label', 'reference', 'voided', 'reason'],
    array['schema_version', 'payment_id', 'expected_version', 'amount_cents', 'paid_at', 'method', 'account_label', 'reference', 'voided', 'reason']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_payment_id := private.consignment_uuid(p_payload -> 'payment_id', false);
  v_expected := private.sale_integer(p_payload -> 'expected_version', 1, 9000000000000000);
  v_amount := private.sale_integer(p_payload -> 'amount_cents', 1, 9000000000000000);
  v_paid_at := private.consignment_date(p_payload -> 'paid_at');
  v_method := private.consignment_text(p_payload -> 'method', 1, 20);
  if v_method not in ('bank_transfer', 'cash', 'other') then raise exception 'invalid_payload' using errcode = '22023'; end if;
  v_account := private.consignment_optional_text(p_payload -> 'account_label', 1, 120);
  v_reference := private.consignment_optional_text(p_payload -> 'reference', 1, 240);
  v_voided := private.consignment_boolean(p_payload -> 'voided');
  v_reason := private.consignment_text(p_payload -> 'reason', 3, 500);
  v_canonical := jsonb_build_object('schema_version', 1, 'payment_id', v_payment_id, 'expected_version', v_expected, 'amount_cents', v_amount,
    'paid_at', v_paid_at, 'method', v_method, 'account_label', v_account, 'reference', v_reference, 'voided', v_voided, 'reason', v_reason);
  v_replay := private.start_consignment(p_operation_id, 'update_consignment_payment', v_canonical);
  if v_replay is not null then return v_replay; end if;
  select report_id, location_id into v_report_id, v_location from public.consignment_report_payments where id = v_payment_id;
  if not found then raise exception 'payment_not_found' using errcode = '22023'; end if;
  perform private.consignment_shop_for_update(v_location, false);
  select * into v_report from public.consignment_reports where id = v_report_id for update;
  select * into v_payment from public.consignment_report_payments where id = v_payment_id for update;
  if v_payment.version <> v_expected then raise exception 'stale_version' using errcode = '22023'; end if;
  if v_paid_at < (v_report.period_month::timestamp at time zone 'Europe/Rome') then raise exception 'invalid_date' using errcode = '22023'; end if;
  if not v_voided then
    select coalesce(sum(amount_cents), 0) into v_paid from public.consignment_report_payments
      where report_id = v_report_id and not voided and id <> v_payment_id;
    if v_paid + v_amount > v_report.brand_cents then raise exception 'payment_exceeds_invoice' using errcode = '22023'; end if;
  end if;
  update public.consignment_report_payments set amount_cents = v_amount, paid_at = v_paid_at, method = v_method, account_label = v_account,
    reference = v_reference, voided = v_voided, version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = v_payment_id returning * into v_payment;
  insert into public.consignment_payment_revisions(id, payment_id, location_id, version, reason, snapshot, created_by)
    values (p_operation_id, v_payment_id, v_location, v_payment.version, v_reason, private.consignment_payment_snapshot(v_payment_id), auth.uid());
  perform private.consignment_refresh_payment_state(v_report_id);
  v_result := jsonb_build_object('operation_id', p_operation_id, 'payment_id', v_payment_id, 'report_id', v_report_id,
    'version', v_payment.version, 'replayed', false);
  return private.finish_consignment(p_operation_id, 'update_consignment_payment', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

-- Shop orders do not reserve the central warehouse; the delivery checks real stock.
create function private.save_consignment_order(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_order_id uuid; v_expected bigint; v_location uuid; v_requested date; v_note text; v_raw jsonb; v_lines jsonb := '[]'::jsonb;
  v_canonical jsonb; v_replay jsonb; v_order public.consignment_orders%rowtype; v_line public.consignment_order_lines%rowtype;
  v_item uuid; v_quantity bigint; v_number integer; v_status text; v_sku text; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'order_id', 'expected_version', 'location_id', 'requested_on', 'note', 'lines'],
    array['schema_version', 'order_id', 'expected_version', 'location_id', 'requested_on', 'note', 'lines']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_order_id := private.consignment_uuid(p_payload -> 'order_id', true);
  v_expected := private.consignment_optional_integer(p_payload -> 'expected_version', 1, 9000000000000000);
  if (v_order_id is null) <> (v_expected is null) then raise exception 'invalid_payload' using errcode = '22023'; end if;
  v_location := private.consignment_uuid(p_payload -> 'location_id', false);
  v_requested := private.consignment_day(p_payload -> 'requested_on');
  v_note := private.consignment_note(p_payload -> 'note', 1000);
  if jsonb_typeof(p_payload -> 'lines') is distinct from 'array' or jsonb_array_length(p_payload -> 'lines') not between 1 and 200 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  for v_raw in select value from jsonb_array_elements(p_payload -> 'lines') loop
    perform private.sale_object(v_raw, array['stock_item_id', 'quantity'], array['stock_item_id', 'quantity']);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('stock_item_id', private.consignment_uuid(v_raw -> 'stock_item_id', false),
      'quantity', private.sale_integer(v_raw -> 'quantity', 1, 100000)));
  end loop;
  v_lines := private.consignment_sorted_lines(v_lines);
  v_canonical := jsonb_build_object('schema_version', 1, 'order_id', v_order_id, 'expected_version', v_expected, 'location_id', v_location,
    'requested_on', v_requested, 'note', v_note, 'lines', v_lines);
  v_replay := private.start_consignment(p_operation_id, 'save_consignment_order', v_canonical);
  if v_replay is not null then return v_replay; end if;
  perform private.consignment_shop_for_update(v_location, true);
  if v_order_id is null then
    select coalesce(max(order_number), 0) + 1 into v_number from public.consignment_orders where location_id = v_location;
    v_order_id := p_operation_id;
    insert into public.consignment_orders(id, location_id, order_number, requested_on, note, status, created_by, updated_by)
      values (v_order_id, v_location, v_number, v_requested, v_note, 'open', auth.uid(), auth.uid()) returning * into v_order;
  else
    select * into v_order from public.consignment_orders where id = v_order_id for update;
    if not found or v_order.location_id <> v_location then raise exception 'invalid_payload' using errcode = '22023'; end if;
    if v_order.status <> 'open' then raise exception 'order_not_open' using errcode = '22023'; end if;
    if v_order.version <> v_expected then raise exception 'stale_version' using errcode = '22023'; end if;
    perform 1 from public.consignment_order_lines where order_id = v_order_id order by stock_item_id for update;
    select s.sku into v_sku from public.consignment_order_lines l join public.stock_items s on s.id = l.stock_item_id
      where l.order_id = v_order_id and l.delivered_quantity > 0
        and not exists (select 1 from jsonb_array_elements(v_lines) n where (n.value ->> 'stock_item_id')::uuid = l.stock_item_id)
      order by l.stock_item_id limit 1;
    if found then raise exception 'below_delivered' using errcode = '22023', detail = v_sku; end if;
    delete from public.consignment_order_lines l where l.order_id = v_order_id
      and not exists (select 1 from jsonb_array_elements(v_lines) n where (n.value ->> 'stock_item_id')::uuid = l.stock_item_id);
  end if;
  for v_raw in select value from jsonb_array_elements(v_lines) loop
    v_item := (v_raw ->> 'stock_item_id')::uuid; v_quantity := (v_raw ->> 'quantity')::bigint;
    select * into v_line from public.consignment_order_lines where order_id = v_order_id and stock_item_id = v_item;
    if found then
      if v_quantity < v_line.delivered_quantity + v_line.cancelled_quantity then
        select sku into v_sku from public.stock_items where id = v_item;
        raise exception 'below_delivered' using errcode = '22023', detail = v_sku;
      end if;
      if v_quantity <> v_line.quantity then
        update public.consignment_order_lines set quantity = v_quantity where id = v_line.id;
      end if;
    else
      perform private.require_consignment_tshirt(v_item);
      insert into public.consignment_order_lines(order_id, location_id, stock_item_id, quantity)
        values (v_order_id, v_location, v_item, v_quantity);
    end if;
  end loop;
  if v_expected is not null then
    v_status := case when exists (select 1 from public.consignment_order_lines where order_id = v_order_id
      and quantity > delivered_quantity + cancelled_quantity) then 'open' else 'delivered' end;
    update public.consignment_orders set requested_on = v_requested, note = v_note, status = v_status, version = version + 1,
      updated_by = auth.uid(), updated_at = now() where id = v_order_id returning * into v_order;
  end if;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'order_id', v_order_id, 'order_number', v_order.order_number,
    'status', v_order.status, 'version', v_order.version, 'replayed', false);
  return private.finish_consignment(p_operation_id, 'save_consignment_order', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

create function private.ship_consignment_order(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_order_id uuid; v_expected bigint; v_at timestamptz; v_raw jsonb; v_lines jsonb := '[]'::jsonb; v_canonical jsonb; v_replay jsonb;
  v_location uuid; v_shop public.consignment_shops%rowtype; v_order public.consignment_orders%rowtype; v_line public.consignment_order_lines%rowtype;
  v_item uuid; v_quantity bigint; v_pieces bigint := 0; v_reason text; v_transfer uuid; v_sku text; v_status text; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'order_id', 'expected_version', 'occurred_at', 'lines'],
    array['schema_version', 'order_id', 'expected_version', 'occurred_at', 'lines']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_order_id := private.consignment_uuid(p_payload -> 'order_id', false);
  v_expected := private.sale_integer(p_payload -> 'expected_version', 1, 9000000000000000);
  v_at := private.consignment_date(p_payload -> 'occurred_at');
  if jsonb_typeof(p_payload -> 'lines') is distinct from 'array' or jsonb_array_length(p_payload -> 'lines') not between 1 and 200 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  for v_raw in select value from jsonb_array_elements(p_payload -> 'lines') loop
    perform private.sale_object(v_raw, array['stock_item_id', 'quantity'], array['stock_item_id', 'quantity']);
    v_quantity := private.sale_integer(v_raw -> 'quantity', 1, 100000);
    v_pieces := v_pieces + v_quantity;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('stock_item_id', private.consignment_uuid(v_raw -> 'stock_item_id', false),
      'quantity', v_quantity));
  end loop;
  v_lines := private.consignment_sorted_lines(v_lines);
  v_canonical := jsonb_build_object('schema_version', 1, 'order_id', v_order_id, 'expected_version', v_expected, 'occurred_at', v_at, 'lines', v_lines);
  v_replay := private.start_consignment(p_operation_id, 'ship_consignment_order', v_canonical);
  if v_replay is not null then return v_replay; end if;
  perform private.consignment_flags(false);
  select location_id into v_location from public.consignment_orders where id = v_order_id;
  if not found then raise exception 'invalid_payload' using errcode = '22023'; end if;
  v_shop := private.consignment_shop_for_update(v_location, true);
  select * into v_order from public.consignment_orders where id = v_order_id for update;
  if v_order.status <> 'open' then raise exception 'order_not_open' using errcode = '22023'; end if;
  if v_order.version <> v_expected then raise exception 'stale_version' using errcode = '22023'; end if;
  if v_shop.supply_location_id is null then raise exception 'invalid_location' using errcode = '22023'; end if;
  perform 1 from public.consignment_order_lines where order_id = v_order_id order by stock_item_id for update;
  for v_raw in select value from jsonb_array_elements(v_lines) loop
    v_item := (v_raw ->> 'stock_item_id')::uuid; v_quantity := (v_raw ->> 'quantity')::bigint;
    select * into v_line from public.consignment_order_lines where order_id = v_order_id and stock_item_id = v_item;
    if not found or v_quantity > v_line.quantity - v_line.delivered_quantity - v_line.cancelled_quantity then
      select sku into v_sku from public.stock_items where id = v_item;
      raise exception 'exceeds_order' using errcode = '22023', detail = coalesce(v_sku, '');
    end if;
    perform private.consignment_ensure_shop_balance(v_item, v_location);
  end loop;
  perform 1 from public.stock_balances where location_id in (v_shop.supply_location_id, v_location)
    and stock_item_id in (select (value ->> 'stock_item_id')::uuid from jsonb_array_elements(v_lines)) order by stock_item_id, location_id for update;
  v_reason := 'Consegna al negozio, ordine n. ' || v_order.order_number;
  insert into public.consignment_shipments(id, location_id, direction, order_id, warehouse_location_id, occurred_at, reason, pieces, created_by)
    values (p_operation_id, v_location, 'to_shop', v_order_id, v_shop.supply_location_id, v_at, v_reason, v_pieces, auth.uid());
  for v_raw in select value from jsonb_array_elements(v_lines) loop
    v_item := (v_raw ->> 'stock_item_id')::uuid; v_quantity := (v_raw ->> 'quantity')::bigint;
    v_transfer := private.consignment_move(v_item, v_shop.supply_location_id, v_location, v_quantity, v_reason, v_at,
      jsonb_build_object('consignment_shipment_id', p_operation_id, 'consignment_order_id', v_order_id));
    insert into public.consignment_shipment_lines(shipment_id, location_id, stock_item_id, quantity, transfer_id)
      values (p_operation_id, v_location, v_item, v_quantity, v_transfer);
    update public.consignment_order_lines set delivered_quantity = delivered_quantity + v_quantity where order_id = v_order_id and stock_item_id = v_item;
  end loop;
  v_status := case when exists (select 1 from public.consignment_order_lines where order_id = v_order_id
    and quantity > delivered_quantity + cancelled_quantity) then 'open' else 'delivered' end;
  update public.consignment_orders set status = v_status, version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = v_order_id returning * into v_order;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'shipment_id', p_operation_id, 'order_id', v_order_id,
    'status', v_order.status, 'version', v_order.version, 'replayed', false);
  return private.finish_consignment(p_operation_id, 'ship_consignment_order', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

create function private.close_consignment_order(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_order_id uuid; v_expected bigint; v_reason text; v_canonical jsonb; v_replay jsonb; v_location uuid;
  v_order public.consignment_orders%rowtype; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'order_id', 'expected_version', 'reason'],
    array['schema_version', 'order_id', 'expected_version', 'reason']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_order_id := private.consignment_uuid(p_payload -> 'order_id', false);
  v_expected := private.sale_integer(p_payload -> 'expected_version', 1, 9000000000000000);
  v_reason := private.consignment_text(p_payload -> 'reason', 3, 500);
  v_canonical := jsonb_build_object('schema_version', 1, 'order_id', v_order_id, 'expected_version', v_expected, 'reason', v_reason);
  v_replay := private.start_consignment(p_operation_id, 'close_consignment_order', v_canonical);
  if v_replay is not null then return v_replay; end if;
  select location_id into v_location from public.consignment_orders where id = v_order_id;
  if not found then raise exception 'invalid_payload' using errcode = '22023'; end if;
  perform private.consignment_shop_for_update(v_location, false);
  select * into v_order from public.consignment_orders where id = v_order_id for update;
  if v_order.status <> 'open' then raise exception 'order_not_open' using errcode = '22023'; end if;
  if v_order.version <> v_expected then raise exception 'stale_version' using errcode = '22023'; end if;
  update public.consignment_order_lines set cancelled_quantity = quantity - delivered_quantity
    where order_id = v_order_id and quantity > delivered_quantity + cancelled_quantity;
  update public.consignment_orders set status = 'closed', close_reason = v_reason, version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = v_order_id returning * into v_order;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'order_id', v_order_id, 'status', v_order.status,
    'version', v_order.version, 'replayed', false);
  return private.finish_consignment(p_operation_id, 'close_consignment_order', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

-- Unsold T-shirts back to the supply warehouse. No packaging effects.
create function private.return_consignment_stock(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_location uuid; v_at timestamptz; v_reason text; v_raw jsonb; v_lines jsonb := '[]'::jsonb; v_canonical jsonb; v_replay jsonb;
  v_shop public.consignment_shops%rowtype; v_item uuid; v_quantity bigint; v_pieces bigint := 0; v_transfer uuid; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'location_id', 'occurred_at', 'reason', 'lines'],
    array['schema_version', 'location_id', 'occurred_at', 'reason', 'lines']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_location := private.consignment_uuid(p_payload -> 'location_id', false);
  v_at := private.consignment_date(p_payload -> 'occurred_at');
  v_reason := private.consignment_text(p_payload -> 'reason', 3, 500);
  if jsonb_typeof(p_payload -> 'lines') is distinct from 'array' or jsonb_array_length(p_payload -> 'lines') not between 1 and 200 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  for v_raw in select value from jsonb_array_elements(p_payload -> 'lines') loop
    perform private.sale_object(v_raw, array['stock_item_id', 'quantity'], array['stock_item_id', 'quantity']);
    v_quantity := private.sale_integer(v_raw -> 'quantity', 1, 100000);
    v_pieces := v_pieces + v_quantity;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('stock_item_id', private.consignment_uuid(v_raw -> 'stock_item_id', false),
      'quantity', v_quantity));
  end loop;
  v_lines := private.consignment_sorted_lines(v_lines);
  v_canonical := jsonb_build_object('schema_version', 1, 'location_id', v_location, 'occurred_at', v_at, 'reason', v_reason, 'lines', v_lines);
  v_replay := private.start_consignment(p_operation_id, 'return_consignment_stock', v_canonical);
  if v_replay is not null then return v_replay; end if;
  perform private.consignment_flags(false);
  v_shop := private.consignment_shop_for_update(v_location, true);
  if v_shop.supply_location_id is null then raise exception 'invalid_location' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(v_lines) l where not private.is_packaged_tshirt((l.value ->> 'stock_item_id')::uuid)) then
    raise exception 'invalid_tshirt' using errcode = '22023';
  end if;
  perform 1 from public.stock_balances where location_id in (v_shop.supply_location_id, v_location)
    and stock_item_id in (select (value ->> 'stock_item_id')::uuid from jsonb_array_elements(v_lines)) order by stock_item_id, location_id for update;
  insert into public.consignment_shipments(id, location_id, direction, order_id, warehouse_location_id, occurred_at, reason, pieces, created_by)
    values (p_operation_id, v_location, 'to_warehouse', null, v_shop.supply_location_id, v_at, v_reason, v_pieces, auth.uid());
  for v_raw in select value from jsonb_array_elements(v_lines) loop
    v_item := (v_raw ->> 'stock_item_id')::uuid; v_quantity := (v_raw ->> 'quantity')::bigint;
    v_transfer := private.consignment_move(v_item, v_location, v_shop.supply_location_id, v_quantity, v_reason, v_at,
      jsonb_build_object('consignment_shipment_id', p_operation_id));
    insert into public.consignment_shipment_lines(shipment_id, location_id, stock_item_id, quantity, transfer_id)
      values (p_operation_id, v_location, v_item, v_quantity, v_transfer);
  end loop;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'shipment_id', p_operation_id, 'location_id', v_location, 'replayed', false);
  return private.finish_consignment(p_operation_id, 'return_consignment_stock', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

create function public.save_consignment_shop(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.save_consignment_shop(p_operation_id, p_payload)$$;
create function public.count_consignment_stock(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.count_consignment_stock(p_operation_id, p_payload)$$;
create function public.save_consignment_report(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.save_consignment_report(p_operation_id, p_payload)$$;
create function public.set_consignment_invoice(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.set_consignment_invoice(p_operation_id, p_payload)$$;
create function public.record_consignment_payment(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.record_consignment_payment(p_operation_id, p_payload)$$;
create function public.update_consignment_payment(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.update_consignment_payment(p_operation_id, p_payload)$$;
create function public.save_consignment_order(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.save_consignment_order(p_operation_id, p_payload)$$;
create function public.ship_consignment_order(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.ship_consignment_order(p_operation_id, p_payload)$$;
create function public.close_consignment_order(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.close_consignment_order(p_operation_id, p_payload)$$;
create function public.return_consignment_stock(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.return_consignment_stock(p_operation_id, p_payload)$$;

revoke all on function private.consignment_uuid(jsonb, boolean), private.consignment_optional_integer(jsonb, bigint, bigint),
  private.consignment_optional_text(jsonb, integer, integer), private.consignment_note(jsonb, integer), private.consignment_boolean(jsonb),
  private.consignment_day(jsonb), private.consignment_period(jsonb), private.consignment_sorted_lines(jsonb), private.consignment_flags(boolean),
  private.consignment_shop_for_update(uuid, boolean), private.consignment_ensure_shop_balance(uuid, uuid),
  private.consignment_move(uuid, uuid, uuid, bigint, text, timestamptz, jsonb), private.consignment_refresh_payment_state(uuid),
  private.consignment_report_snapshot(uuid), private.consignment_payment_snapshot(uuid),
  private.save_consignment_shop(uuid, jsonb), private.count_consignment_stock(uuid, jsonb), private.save_consignment_report(uuid, jsonb),
  private.set_consignment_invoice(uuid, jsonb), private.record_consignment_payment(uuid, jsonb), private.update_consignment_payment(uuid, jsonb),
  private.save_consignment_order(uuid, jsonb), private.ship_consignment_order(uuid, jsonb), private.close_consignment_order(uuid, jsonb),
  private.return_consignment_stock(uuid, jsonb),
  public.save_consignment_shop(uuid, jsonb), public.count_consignment_stock(uuid, jsonb), public.save_consignment_report(uuid, jsonb),
  public.set_consignment_invoice(uuid, jsonb), public.record_consignment_payment(uuid, jsonb), public.update_consignment_payment(uuid, jsonb),
  public.save_consignment_order(uuid, jsonb), public.ship_consignment_order(uuid, jsonb), public.close_consignment_order(uuid, jsonb),
  public.return_consignment_stock(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.save_consignment_shop(uuid, jsonb), private.count_consignment_stock(uuid, jsonb), private.save_consignment_report(uuid, jsonb),
  private.set_consignment_invoice(uuid, jsonb), private.record_consignment_payment(uuid, jsonb), private.update_consignment_payment(uuid, jsonb),
  private.save_consignment_order(uuid, jsonb), private.ship_consignment_order(uuid, jsonb), private.close_consignment_order(uuid, jsonb),
  private.return_consignment_stock(uuid, jsonb),
  public.save_consignment_shop(uuid, jsonb), public.count_consignment_stock(uuid, jsonb), public.save_consignment_report(uuid, jsonb),
  public.set_consignment_invoice(uuid, jsonb), public.record_consignment_payment(uuid, jsonb), public.update_consignment_payment(uuid, jsonb),
  public.save_consignment_order(uuid, jsonb), public.ship_consignment_order(uuid, jsonb), public.close_consignment_order(uuid, jsonb),
  public.return_consignment_stock(uuid, jsonb)
  to authenticated;

-- Shop quantities change only through the consignment commands (06 R7). The name
-- sorts before apply_stock_movement: PostgreSQL fires same-event triggers in name
-- order, so the rejection comes before any balance lock or balance error.
create function private.reject_shop_adjustment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'adjustment' and exists (select 1 from public.stock_locations where id = new.location_id and location_type = 'Negozio Conto Vendita') then
    raise exception 'shop_location' using errcode = '22023';
  end if;
  return new;
end
$$;
revoke all on function private.reject_shop_adjustment() from public, anon, authenticated, service_role;
create trigger adjustment_not_on_shop before insert on public.stock_movements
  for each row execute function private.reject_shop_adjustment();

-- Packaging: the body of 20261021164548 unchanged, plus one branch. A monthly report
-- movement that lowers the shop consumes one box and one sticker per piece; a
-- correction upwards (positive delta) consumes nothing and returns nothing.
create or replace function private.observe_packaging_source(p_kind text,p_source uuid)returns void language plpgsql security definer set search_path='' as $$
declare config public.packaging_automation%rowtype;item uuid;quantity bigint;event_time timestamptz;inserted timestamptz;v_order_id uuid;order_time timestamptz;order_source text;allowed boolean:=true;material uuid;receipt uuid;
begin
 select * into config from public.packaging_automation where id;
 if config.started_at is null then return;end if;
 if p_kind='fulfillment' then
  select l.stock_item_id,f.quantity,f.fulfilled_at,f.created_at,o.id,o.occurred_at,o.source_kind into item,quantity,event_time,inserted,v_order_id,order_time,order_source
   from public.fulfillment_lines f join public.sales_order_lines l on l.id=f.order_line_id join public.sales_orders o on o.id=l.order_id where f.id=p_source;
 elsif p_kind='consignment' then select s.stock_item_id,s.quantity,s.occurred_at,s.created_at into item,quantity,event_time,inserted from public.consignment_sales s where s.id=p_source;
  if not found then select m.stock_item_id,-m.quantity_delta,m.created_at,m.created_at into item,quantity,event_time,inserted from public.consignment_report_movements m where m.id=p_source and m.quantity_delta<0;end if;
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
create trigger observe_packaging after insert on public.consignment_report_movements for each row execute function private.observe_packaging_trigger();
commit;
