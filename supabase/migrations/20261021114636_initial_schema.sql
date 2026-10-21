-- LuckyLap v1. No users, finance records or initial business stock are seeded here.
begin;

create schema if not exists private;
revoke create on schema public from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
-- Keep private OUT of the Data API exposed schemas and extra_search_path.
alter default privileges in schema private revoke execute on functions from public;

create type public.member_role as enum ('founder', 'production', 'logistics', 'finance', 'consultant');
create type public.stock_item_kind as enum ('product', 'packaging');
create type public.stock_movement_kind as enum ('opening', 'adjustment');

create table public.profiles (
  user_id uuid primary key references auth.users(id),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid primary key references public.profiles(user_id),
  role public.member_role not null,
  active boolean not null default true,
  finance_access boolean not null default false,
  invited_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  check (not finance_access or role in ('founder', 'production', 'finance'))
);

create table public.app_settings (
  id boolean primary key default true check (id),
  stock_adjustments_enabled boolean not null default false,
  discounts_enabled boolean not null default false,
  consignment_surcharge_eur numeric(12,2) not null default 10 check (consignment_surcharge_eur >= 0 and consignment_surcharge_eur < 'Infinity'::numeric),
  brand_share_percent numeric(5,2) not null default 60 check (brand_share_percent between 0 and 100),
  store_share_percent numeric(5,2) not null default 40 check (store_share_percent between 0 and 100),
  check (brand_share_percent + store_share_percent = 100)
);
insert into public.app_settings (id) values (true);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  model text not null unique check (char_length(btrim(model)) between 1 and 120),
  category text not null check (char_length(btrim(category)) between 1 and 120),
  production_lead_days integer check (production_lead_days >= 0),
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  kind public.stock_item_kind not null,
  sku text not null unique check (char_length(btrim(sku)) between 1 and 120),
  name text not null check (char_length(btrim(name)) between 1 and 240),
  unit_cost_eur numeric(12,2) check (unit_cost_eur >= 0 and unit_cost_eur < 'Infinity'::numeric),
  list_price_eur numeric(12,2) check (list_price_eur >= 0 and list_price_eur < 'Infinity'::numeric),
  margin_eur numeric(12,2) generated always as (list_price_eur - unit_cost_eur) stored,
  active boolean not null default true,
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, kind)
);

create table public.product_variants (
  stock_item_id uuid primary key,
  item_kind public.stock_item_kind not null default 'product' check (item_kind = 'product'),
  product_id uuid not null references public.products(id),
  color text not null,
  size text not null,
  central_target_quantity integer check (central_target_quantity >= 0),
  source jsonb not null default '{}'::jsonb,
  foreign key (stock_item_id, item_kind) references public.stock_items(id, kind)
);

-- Packaging has its own anagraphic records; no boxes/stickers are invented.
create table public.packaging_items (
  stock_item_id uuid primary key,
  item_kind public.stock_item_kind not null default 'packaging' check (item_kind = 'packaging'),
  packaging_type text not null check (packaging_type in ('box', 'sticker', 'other')),
  specifications text,
  foreign key (stock_item_id, item_kind) references public.stock_items(id, kind)
);

create table public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  location_type text not null,
  source jsonb not null default '{}'::jsonb,
  active boolean not null default true
);

create table public.stock_balances (
  stock_item_id uuid not null references public.stock_items(id),
  location_id uuid not null references public.stock_locations(id),
  -- NULL means not counted/unknown. Never silently convert an unknown to zero.
  quantity bigint check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (stock_item_id, location_id)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  stock_item_id uuid not null references public.stock_items(id),
  location_id uuid not null references public.stock_locations(id),
  kind public.stock_movement_kind not null,
  quantity_delta bigint not null check (quantity_delta between -1000000000 and 1000000000),
  quantity_before bigint,
  quantity_after bigint not null check (quantity_after >= 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  source jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  check (kind = 'opening' or quantity_delta <> 0)
);
create unique index stock_movements_one_opening on public.stock_movements(stock_item_id, location_id) where kind = 'opening';
create index stock_movements_item_location on public.stock_movements(stock_item_id, location_id, created_at desc);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  event_type text not null default 'other' check (event_type in ('production', 'delivery', 'launch', 'meeting', 'other')),
  created_by uuid not null default auth.uid() references public.profiles(user_id),
  created_at timestamptz not null default now(),
  check (ends_at >= starts_at)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text not null default '',
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  due_at timestamptz,
  assigned_to uuid references public.profiles(user_id),
  created_by uuid not null default auth.uid() references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  body text not null default '',
  task_id uuid references public.tasks(id) on delete set null,
  created_by uuid not null default auth.uid() references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 240),
  asset_type text not null check (asset_type in ('logo', 'mockup', 'photo', 'other')),
  description text not null default '',
  external_url text check (external_url ~ '^https://'),
  storage_path text,
  created_by uuid not null default auth.uid() references public.profiles(user_id),
  created_at timestamptz not null default now(),
  check (num_nonnulls(external_url, storage_path) <= 1)
);

create table public.discount_rules (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  discount_type text not null check (discount_type in ('percentage', 'fixed_eur')),
  value numeric(12,2) not null check (value > 0 and value < 'Infinity'::numeric),
  active boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles(user_id),
  created_at timestamptz not null default now(),
  check (discount_type <> 'percentage' or value <= 100)
);

-- Structural placeholder only: no imported financial data, files, or tax assumptions.
create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  entry_type text not null check (entry_type in ('income', 'expense')),
  amount_eur numeric(14,2) not null check (amount_eur > 0 and amount_eur < 'Infinity'::numeric),
  description text not null,
  finance_document_path text,
  created_by uuid not null default auth.uid() references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  table_name text not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  record_key jsonb not null,
  old_data jsonb,
  new_data jsonb
);
create index audit_logs_time on public.audit_logs(occurred_at desc);

-- Helpers take no target user ID, and read the caller's current DB membership.
-- A role claim in user_metadata/app_metadata is never consulted.
create function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where user_id = (select auth.uid()) and active)
$$;
create function private.is_founder() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where user_id = (select auth.uid()) and active and role = 'founder')
$$;
create function private.can_finance() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()->>'aal') = 'aal2', false) and exists (
    select 1 from public.memberships where user_id = (select auth.uid()) and active
      and (role = 'founder' or (role in ('production', 'finance') and finance_access))
  )
$$;
create function private.can_audit() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_founder() and coalesce((select auth.jwt()->>'aal') = 'aal2', false)
$$;
create function private.can_discount() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_member() and exists (select 1 from public.app_settings where id and discounts_enabled)
$$;

-- One database write produces the ledger entry and balance in the same transaction.
create function private.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  previous_quantity bigint;
  next_quantity bigint;
begin
  if new.kind = 'opening' then
    insert into public.stock_balances(stock_item_id, location_id, quantity)
      values (new.stock_item_id, new.location_id, null)
      on conflict (stock_item_id, location_id) do nothing;
  end if;
  select quantity into previous_quantity from public.stock_balances
    where stock_item_id = new.stock_item_id and location_id = new.location_id for update;
  if not found then
    raise exception 'Stock non inizializzato: serve una conta iniziale autorizzata.' using errcode = '22023';
  end if;
  if new.kind = 'opening' then
    if previous_quantity is not null or new.quantity_delta < 0 then
      raise exception 'Conta iniziale già presente o quantità non valida.' using errcode = '22023';
    end if;
    next_quantity := new.quantity_delta;
  else
    if previous_quantity is null then
      raise exception 'Quantità sconosciuta: registrare prima una conta iniziale.' using errcode = '22023';
    end if;
    next_quantity := previous_quantity + new.quantity_delta;
    if next_quantity < 0 then
      raise exception 'La rettifica produrrebbe una giacenza negativa.' using errcode = '22023';
    end if;
  end if;
  new.quantity_before := previous_quantity;
  new.quantity_after := next_quantity;
  update public.stock_balances set quantity = next_quantity, updated_at = now()
    where stock_item_id = new.stock_item_id and location_id = new.location_id;
  return new;
end
$$;
create trigger apply_stock_movement before insert on public.stock_movements
for each row execute function private.apply_stock_movement();

create function private.adjust_stock(
  p_operation_id uuid, p_stock_item_id uuid, p_location_id uuid,
  p_quantity_delta bigint, p_reason text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  existing public.stock_movements%rowtype;
  movement_id uuid;
begin
  if not private.is_member() then
    raise exception 'Appartenenza LuckyLap richiesta.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.app_settings where id and stock_adjustments_enabled) then
    raise exception 'Rettifiche di magazzino non abilitate.' using errcode = '42501';
  end if;
  if p_operation_id is null or p_stock_item_id is null or p_location_id is null
    or p_quantity_delta is null or p_quantity_delta = 0
    or p_quantity_delta not between -1000000000 and 1000000000
    or p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'Rettifica non valida: identificativi, quantità e causale sono obbligatori.' using errcode = '22023';
  end if;
  -- Serializes retries even if two requests use different stock rows.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text, 0));
  select * into existing from public.stock_movements where operation_id = p_operation_id;
  if found then
    if existing.actor_id = auth.uid() and existing.kind = 'adjustment'
      and existing.stock_item_id = p_stock_item_id and existing.location_id = p_location_id
      and existing.quantity_delta = p_quantity_delta and existing.reason = btrim(p_reason) then
      return existing.id;
    end if;
    raise exception 'operation_id già utilizzato per una richiesta diversa.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.stock_items where id = p_stock_item_id and active)
    or not exists (select 1 from public.stock_locations where id = p_location_id and active) then
    raise exception 'Articolo o location non disponibile.' using errcode = '22023';
  end if;
  insert into public.stock_movements(operation_id, stock_item_id, location_id, kind, quantity_delta, reason, actor_id)
    values (p_operation_id, p_stock_item_id, p_location_id, 'adjustment', p_quantity_delta, btrim(p_reason), auth.uid())
    returning id into movement_id;
  return movement_id;
end
$$;

-- The API exposes an invoker wrapper only. Its private definer checks auth itself.
create function public.adjust_stock(
  p_operation_id uuid, p_stock_item_id uuid, p_location_id uuid,
  p_quantity_delta bigint, p_reason text
) returns uuid
language sql security invoker set search_path = '' as $$
  select private.adjust_stock(p_operation_id, p_stock_item_id, p_location_id, p_quantity_delta, p_reason)
$$;

create function private.audit_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_record jsonb;
  new_record jsonb;
  record_data jsonb;
begin
  if tg_op <> 'INSERT' then old_record := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_record := to_jsonb(new); end if;
  record_data := coalesce(new_record, old_record);
  insert into public.audit_logs(actor_id, table_name, operation, record_key, old_data, new_data)
    values (auth.uid(), tg_table_name, tg_op,
      jsonb_strip_nulls(jsonb_build_object('id', record_data->'id', 'user_id', record_data->'user_id',
        'stock_item_id', record_data->'stock_item_id', 'location_id', record_data->'location_id')),
      old_record, new_record);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create function private.reject_ledger_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Registro append-only: aggiungere un movimento di rettifica.' using errcode = '42501';
end
$$;
create trigger stock_movements_append_only before update or delete on public.stock_movements
for each row execute function private.reject_ledger_mutation();
create trigger audit_logs_append_only before update or delete on public.audit_logs
for each row execute function private.reject_ledger_mutation();

-- Explicit allowlist: every exposed table has RLS and no anonymous grants.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles', 'memberships', 'app_settings', 'products', 'stock_items', 'product_variants',
    'packaging_items', 'stock_locations', 'stock_balances', 'stock_movements', 'calendar_events',
    'tasks', 'notes', 'assets', 'discount_rules', 'finance_entries', 'audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    if table_name <> 'audit_logs' then
      execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()', table_name);
    end if;
  end loop;
end
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles', 'memberships', 'app_settings', 'products', 'stock_items', 'product_variants',
    'packaging_items', 'stock_locations', 'stock_balances', 'stock_movements',
    'calendar_events', 'tasks', 'notes', 'assets', 'discount_rules'
  ] loop
    execute format('create policy member_read on public.%I for select to authenticated using ((select private.is_member()))', table_name);
  end loop;
end
$$;

-- Membership/role/finance grants/settings/catalog/stock remain owner-managed.
-- The app can edit its own display name, never its membership or identity.
grant update(display_name) on public.profiles to authenticated;
create policy profile_update_self on public.profiles for update to authenticated
using ((select private.is_member()) and user_id = (select auth.uid()))
with check ((select private.is_member()) and user_id = (select auth.uid()));

grant insert(title, description, starts_at, ends_at, event_type),
  update(title, description, starts_at, ends_at, event_type), delete on public.calendar_events to authenticated;
grant insert(title, description, status, due_at, assigned_to),
  update(title, description, status, due_at, assigned_to), delete on public.tasks to authenticated;
grant insert(title, body, task_id), update(title, body, task_id), delete on public.notes to authenticated;
grant insert(name, asset_type, description, external_url, storage_path),
  update(name, asset_type, description, external_url, storage_path), delete on public.assets to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['calendar_events', 'tasks', 'notes', 'assets'] loop
    execute format('create policy member_insert on public.%I for insert to authenticated with check ((select private.is_member()) and created_by = (select auth.uid()))', table_name);
    execute format('create policy member_update on public.%I for update to authenticated using ((select private.is_member())) with check ((select private.is_member()))', table_name);
    execute format('create policy member_delete on public.%I for delete to authenticated using ((select private.is_member()))', table_name);
  end loop;
end
$$;

grant insert(label, discount_type, value, active), update(label, discount_type, value, active), delete on public.discount_rules to authenticated;
create policy discount_insert on public.discount_rules for insert to authenticated
with check ((select private.can_discount()) and created_by = (select auth.uid()));
create policy discount_update on public.discount_rules for update to authenticated
using ((select private.can_discount())) with check ((select private.can_discount()));
create policy discount_delete on public.discount_rules for delete to authenticated using ((select private.can_discount()));

create policy finance_read on public.finance_entries for select to authenticated using ((select private.can_finance()));
grant insert(entry_date, entry_type, amount_eur, description, finance_document_path),
  update(entry_date, entry_type, amount_eur, description, finance_document_path), delete on public.finance_entries to authenticated;
create policy finance_insert on public.finance_entries for insert to authenticated
with check ((select private.can_finance()) and created_by = (select auth.uid()));
create policy finance_update on public.finance_entries for update to authenticated
using ((select private.can_finance())) with check ((select private.can_finance()));
create policy finance_delete on public.finance_entries for delete to authenticated using ((select private.can_finance()));
create policy audit_read on public.audit_logs for select to authenticated using ((select private.can_audit()));

-- PostgreSQL gives PUBLIC execution by default; revoke it before opting in.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(), private.is_founder(), private.can_finance(),
  private.can_audit(), private.can_discount() to authenticated;
grant execute on function private.adjust_stock(uuid, uuid, uuid, bigint, text) to authenticated;
revoke all on function public.adjust_stock(uuid, uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.adjust_stock(uuid, uuid, uuid, bigint, text) to authenticated;

commit;
