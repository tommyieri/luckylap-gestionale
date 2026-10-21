-- Shared projections with explicit external provenance; manual semantics remain.
begin;
alter table public.sales_orders add column source_kind text not null default 'manual_declaration'
  check(source_kind in ('manual_declaration','shopify_canonical'));
alter table public.sales_orders alter column created_by drop not null;
alter table public.sales_orders drop constraint sales_orders_channel_check;
alter table public.sales_orders add constraint sales_orders_source_identity check (
  (source_kind='manual_declaration' and channel in('direct','etsy','manual_other') and created_by is not null)
  or(source_kind='shopify_canonical' and channel in('shopify_web','shopify_pos') and created_by is null));
alter table public.sales_orders drop constraint sales_orders_payment_state_check;
alter table public.sales_orders add constraint sales_orders_payment_state_check
  check(payment_state in('unpaid','partially_paid','paid','partially_refunded','refunded'));
alter table public.sales_order_lines add column source_kind text not null default 'manual_declaration'
  check(source_kind in('manual_declaration','shopify_canonical'));
alter table public.sales_order_lines drop constraint sales_order_lines_order_id_stock_item_id_key;
create unique index sales_manual_line_item on public.sales_order_lines(order_id,stock_item_id) where source_kind='manual_declaration';

alter table public.order_payments alter column created_by drop not null;
alter table public.order_payments drop constraint order_payments_source_kind_check;
alter table public.order_payments drop constraint order_payments_method_check;
alter table public.order_payments drop constraint order_payments_order_id_key;
alter table public.order_payments add constraint order_payments_source_identity check (
  (source_kind='manual_declaration' and created_by is not null and method in('cash','bank_transfer','external_card','other'))
  or(source_kind='shopify_observation' and created_by is null and method='shopify_observed'));
create unique index order_payments_one_manual on public.order_payments(order_id) where source_kind='manual_declaration';
create index order_payments_order on public.order_payments(order_id);
alter table public.stock_reservation_events alter column created_by drop not null;
alter table public.stock_reservation_events add column source_kind text not null default 'manual_declaration';
alter table public.stock_reservation_events add constraint reservation_event_source_identity check (
  (source_kind='manual_declaration' and created_by is not null) or(source_kind='shopify_observation' and created_by is null));
alter table public.commercial_facts alter column created_by drop not null;
alter table public.commercial_facts drop constraint commercial_facts_source_kind_check;
alter table public.commercial_facts add constraint commercial_facts_source_identity check (
  (source_kind='manual_declaration' and created_by is not null) or(source_kind='shopify_observation' and created_by is null));
alter table public.commercial_facts drop constraint commercial_facts_fact_kind_check;
alter table public.commercial_facts add constraint commercial_facts_fact_kind_check
  check(fact_kind in('sale_observed','payment_reported','sale_cancellation_observed','refund_observed'));
drop index public.commercial_facts_once_per_order;
create unique index commercial_sale_once on public.commercial_facts(order_id) where fact_kind='sale_observed';
-- payment_id is already unique: one observed fact per capture, not per order.
create unique index commercial_manual_payment_once on public.commercial_facts(order_id) where fact_kind='payment_reported' and source_kind='manual_declaration';

create table public.shopify_order_financials (
  order_id uuid primary key references public.sales_orders(id),
  source_updated_at timestamptz not null,
  totals jsonb not null check(jsonb_typeof(totals)='object'),
  taxes_included boolean not null,
  observed_at timestamptz not null default now()
);
create table public.shopify_refund_observations (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  order_id uuid not null references public.sales_orders(id),
  transaction_gid text not null check(transaction_gid ~ '^gid://shopify/OrderTransaction/[1-9][0-9]{0,19}$'),
  amount_cents bigint not null check(amount_cents between 1 and 9000000000000000),
  occurred_at timestamptz not null,
  source_kind text not null default 'shopify_observation' check(source_kind='shopify_observation'),
  created_by uuid check(created_by is null),
  created_at timestamptz not null default now(),
  unique(order_id,transaction_gid)
);
create table public.shopify_transaction_observations (
  order_id uuid not null references public.sales_orders(id),
  transaction_gid text not null check(transaction_gid ~ '^gid://shopify/OrderTransaction/[1-9][0-9]{0,19}$'),
  kind text not null,
  status text not null,
  amount_cents bigint not null check(amount_cents between 0 and 9000000000000000),
  currency text not null check(currency='EUR'),
  gateway text,
  parent_gid text,
  processed_at timestamptz,
  source_updated_at timestamptz not null,
  observed_at timestamptz not null default now(),
  primary key(order_id,transaction_gid)
);
create index shopify_refund_order on public.shopify_refund_observations(order_id);
alter table public.commercial_facts add column refund_id uuid unique references public.shopify_refund_observations(id);
alter table public.commercial_facts add constraint commercial_refund_link check (
  (fact_kind='refund_observed' and refund_id is not null and source_kind='shopify_observation') or(fact_kind<>'refund_observed' and refund_id is null));
do $$ declare name text; begin
  foreach name in array array['shopify_order_financials','shopify_refund_observations','shopify_transaction_observations'] loop
    execute format('alter table public.%I enable row level security',name);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
    execute format('grant select on public.%I to authenticated',name);
    execute format('create policy finance_read on public.%I for select to authenticated using((select private.can_finance()))',name);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',name);
  end loop;
end $$;
create trigger shopify_refunds_append_only before update or delete on public.shopify_refund_observations for each row execute function private.reject_ledger_mutation();

create function private.guard_operational_sale_location() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  if tg_table_name='stock_movements' and to_jsonb(new)->>'kind' not in('sale_fulfillment','production_receipt') then return new;end if;
  if not exists(select 1 from public.stock_locations where id=new.location_id and active and location_type='Magazzino') then
    raise exception 'invalid_sales_location' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function private.guard_operational_sale_location() from public,anon,authenticated,service_role;
create trigger guard_sale_location before insert or update on public.sales_order_lines for each row execute function private.guard_operational_sale_location();
create trigger guard_sale_location before insert on public.stock_movements for each row execute function private.guard_operational_sale_location();

-- Keep authenticated manual commands from dispatching, cancelling or declaring
-- payments against an externally managed aggregate. Real production allocations
-- by founder/production remain possible through the existing production RPC.
create function private.guard_shopify_core_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare parent uuid; source text; row_data jsonb:=to_jsonb(new);
begin
  if tg_table_name='sales_orders' then source:=row_data->>'source_kind';
  else
    if tg_table_name='stock_reservation_events' or tg_table_name='fulfillment_lines' then
      select l.order_id into parent from public.sales_order_lines l where l.id=(row_data->>'order_line_id')::uuid;
    else parent:=(row_data->>'order_id')::uuid; end if;
    select o.source_kind into source from public.sales_orders o where o.id=parent;
  end if;
  if tg_table_name='sales_order_lines' and row_data->>'source_kind' is distinct from source then raise exception 'source_identity_conflict' using errcode='22023'; end if;
  if source='shopify_canonical' then
    if current_setting('role',true)='service_role' then return new; end if;
    if tg_table_name='stock_reservation_events' and row_data->>'kind'='allocate' and (row_data->>'created_by')::uuid=auth.uid()
      and exists(select 1 from public.memberships where user_id=auth.uid() and active and role in('founder','production')) then return new; end if;
    raise exception 'external_order_managed_by_shopify' using errcode='22023';
  end if;
  if tg_table_name in('order_payments','commercial_facts','stock_reservation_events') and row_data->>'source_kind'='shopify_observation' then
    raise exception 'source_identity_conflict' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function private.guard_shopify_core_write() from public,anon,authenticated,service_role;
do $$ declare name text; begin
  foreach name in array array['sales_orders','sales_order_lines','order_payments','stock_reservation_events','fulfillment_lines','commercial_facts'] loop
    execute format('create trigger guard_shopify_core_write before insert or update on public.%I for each row execute function private.guard_shopify_core_write()',name);
  end loop;
end $$;

create or replace function private.start_sale_command(p_operation_id uuid,p_kind text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing private.sales_command_receipts%rowtype; digest text;
begin
  if auth.uid() is null or not private.is_member() then raise exception 'membership_required' using errcode='42501'; end if;
  if p_operation_id is null then raise exception 'invalid_payload' using errcode='22023'; end if;
  digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.sale.'||p_operation_id::text,0));
  select * into existing from private.sales_command_receipts where operation_id=p_operation_id;
  if found then
    if existing.command_kind<>p_kind or existing.actor_id<>auth.uid() or existing.payload_sha256<>digest then raise exception 'idempotency_conflict' using errcode='22023'; end if;
    return existing.result||'{"replayed":true}'::jsonb;
  end if;
  if exists(select 1 from public.sales_orders where operation_id=p_operation_id) then raise exception 'idempotency_conflict' using errcode='22023'; end if;
  if not exists(select 1 from public.app_settings where id and manual_sales_enabled and sales_started_at is not null)
    and not(p_kind='complete_production' and exists(select 1 from public.production_requirements r join public.sales_order_lines l on l.id=r.order_line_id
      join public.sales_orders o on o.id=l.order_id where r.id=(p_payload->>'requirement_id')::uuid and o.source_kind='shopify_canonical')) then
    raise exception 'sales_disabled' using errcode='42501';
  end if;
  return null;
end $$;

create or replace function private.refresh_sale_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare total_qty bigint; fulfilled bigint; cancelled bigint; cancelled_amount bigint; paid bigint;
  order_record public.sales_orders%rowtype; state text; fulfillment text;
begin
  select * into strict order_record from public.sales_orders where id=p_order_id for update;
  -- Canonical source owns cancellation, fulfillment and payment state. Production
  -- receipts update physical readiness but cannot reinterpret source economics.
  if order_record.source_kind='manual_declaration' then
    select coalesce(sum(quantity),0),coalesce(sum(fulfilled_quantity),0),coalesce(sum(cancelled_quantity),0),coalesce(sum(cancelled_amount_cents),0)
      into total_qty,fulfilled,cancelled,cancelled_amount from public.sales_order_lines where order_id=p_order_id;
    select coalesce(sum(amount_cents),0) into paid from public.order_payments where order_id=p_order_id;
    state:=case when cancelled=total_qty then 'cancelled' when cancelled>0 then 'partially_cancelled' else 'confirmed' end;
    fulfillment:=case when cancelled=total_qty then 'cancelled' when fulfilled=total_qty-cancelled then 'fulfilled' when fulfilled>0 then 'partial' else 'unfulfilled' end;
    update public.sales_orders set order_state=state,fulfillment_state=fulfillment,cancelled_cents=cancelled_amount,
      refund_due_cents=greatest(0,paid-(total_cents-cancelled_amount)) where id=p_order_id returning * into order_record;
  end if;
  return jsonb_build_object('order_id',p_order_id,'order_state',order_record.order_state,'fulfillment_state',order_record.fulfillment_state,
    'payment_state',order_record.payment_state,'total_cents',order_record.total_cents,'cancelled_cents',order_record.cancelled_cents,
    'remaining_value_cents',order_record.total_cents-order_record.cancelled_cents,'refund_due_cents',order_record.refund_due_cents);
end $$;
commit;
