-- Forward-only lifecycle for the manual sales aggregate. Feature stays OFF.
begin;
alter type public.stock_movement_kind add value if not exists 'production_receipt';
alter table public.sales_orders drop constraint sales_orders_fulfillment_state_check;
alter table public.sales_orders add constraint sales_orders_fulfillment_state_check
  check (fulfillment_state in ('unfulfilled','partial','fulfilled','cancelled'));
alter table public.sales_orders
  add column order_state text not null default 'confirmed' check (order_state in ('confirmed','partially_cancelled','cancelled')),
  add column cancelled_cents bigint not null default 0 check (cancelled_cents >= 0 and cancelled_cents <= total_cents),
  add column refund_due_cents bigint not null default 0 check (refund_due_cents >= 0);
alter table public.sales_order_lines add column cancelled_amount_cents bigint not null default 0
  check (cancelled_amount_cents >= 0 and cancelled_amount_cents <= line_total_cents);
alter table public.production_requirements drop constraint production_requirements_status_check;
alter table public.production_requirements
  add column completed_quantity integer not null default 0 check (completed_quantity >= 0),
  add column cancelled_quantity integer not null default 0 check (cancelled_quantity >= 0),
  add constraint production_requirement_quantities check (completed_quantity + cancelled_quantity <= required_quantity),
  add constraint production_requirements_status_check check (status in ('to_plan','partially_ready','satisfied','cancelled'));
alter table public.fulfillment_lines drop constraint fulfillment_lines_order_line_id_key;
create index fulfillment_lines_order_line on public.fulfillment_lines(order_line_id);
alter table public.commercial_facts drop constraint commercial_facts_fact_kind_check;
alter table public.commercial_facts drop constraint commercial_facts_check;
alter table public.commercial_facts drop constraint commercial_facts_order_id_fact_kind_key;
alter table public.commercial_facts
  add constraint commercial_facts_fact_kind_check check (fact_kind in ('sale_observed','payment_reported','sale_cancellation_observed')),
  add constraint commercial_facts_payment_link check ((fact_kind = 'payment_reported' and payment_id is not null) or (fact_kind <> 'payment_reported' and payment_id is null));
create unique index commercial_facts_once_per_order on public.commercial_facts(order_id,fact_kind) where fact_kind in ('sale_observed','payment_reported');
create index commercial_facts_order on public.commercial_facts(order_id);

create table public.production_receipts (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  requirement_id uuid not null references public.production_requirements(id),
  quantity integer not null check (quantity between 1 and 100000),
  stock_movement_id uuid not null unique references public.stock_movements(id),
  occurred_at timestamptz not null,
  reason text not null check (char_length(reason) between 3 and 500),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now()
);
create index production_receipts_requirement on public.production_receipts(requirement_id);
create index production_receipts_creator on public.production_receipts(created_by);
alter table public.production_receipts enable row level security;
revoke all on public.production_receipts from public,anon,authenticated;
grant select on public.production_receipts to authenticated;
create policy member_read on public.production_receipts for select to authenticated using ((select private.is_member()));
create trigger audit_change after insert or update or delete on public.production_receipts for each row execute function private.audit_change();
create trigger production_receipts_append_only before update or delete on public.production_receipts for each row execute function private.reject_ledger_mutation();

create table private.sales_command_receipts (
  operation_id uuid primary key,
  command_kind text not null check (command_kind in ('complete_production','fulfill_order_lines','cancel_unfulfilled_lines','record_manual_payment')),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references public.profiles(user_id),
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.sales_command_receipts enable row level security;
revoke all on private.sales_command_receipts from public,anon,authenticated;
create trigger command_receipts_append_only before update or delete on private.sales_command_receipts for each row execute function private.reject_ledger_mutation();

create function private.guard_sale_operation_id() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists (select 1 from private.sales_command_receipts where operation_id=new.operation_id) then
    raise exception 'idempotency_conflict' using errcode='22023';
  end if;
  return new;
end
$$;
create trigger sale_operation_id_global before insert on public.sales_orders for each row execute function private.guard_sale_operation_id();

create function private.start_sale_command(p_operation_id uuid,p_kind text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing private.sales_command_receipts%rowtype; digest text;
begin
  if auth.uid() is null or not private.is_member() then raise exception 'membership_required' using errcode='42501'; end if;
  if p_operation_id is null then raise exception 'invalid_payload' using errcode='22023'; end if;
  digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.sale.'||p_operation_id::text,0));
  select * into existing from private.sales_command_receipts where operation_id=p_operation_id;
  if found then
    if existing.command_kind<>p_kind or existing.actor_id<>auth.uid() or existing.payload_sha256<>digest then
      raise exception 'idempotency_conflict' using errcode='22023';
    end if;
    return existing.result||'{"replayed":true}'::jsonb;
  end if;
  if exists (select 1 from public.sales_orders where operation_id=p_operation_id) then raise exception 'idempotency_conflict' using errcode='22023'; end if;
  if not exists(select 1 from public.app_settings where id and manual_sales_enabled and sales_started_at is not null) then raise exception 'sales_disabled' using errcode='42501'; end if;
  return null;
end
$$;
create function private.finish_sale_command(p_operation_id uuid,p_kind text,p_payload jsonb,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  insert into private.sales_command_receipts(operation_id,command_kind,payload_sha256,actor_id,result)
    values(p_operation_id,p_kind,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),auth.uid(),p_result);
  return p_result;
end
$$;
create function private.refresh_sale_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare total_qty bigint; fulfilled bigint; cancelled bigint; cancelled_amount bigint; paid bigint;
  order_record public.sales_orders%rowtype; state text; fulfillment text;
begin
  select * into strict order_record from public.sales_orders where id=p_order_id for update;
  select coalesce(sum(quantity),0),coalesce(sum(fulfilled_quantity),0),coalesce(sum(cancelled_quantity),0),coalesce(sum(cancelled_amount_cents),0)
    into total_qty,fulfilled,cancelled,cancelled_amount from public.sales_order_lines where order_id=p_order_id;
  select coalesce(sum(amount_cents),0) into paid from public.order_payments where order_id=p_order_id;
  state:=case when cancelled=total_qty then 'cancelled' when cancelled>0 then 'partially_cancelled' else 'confirmed' end;
  fulfillment:=case when cancelled=total_qty then 'cancelled' when fulfilled=total_qty-cancelled then 'fulfilled' when fulfilled>0 then 'partial' else 'unfulfilled' end;
  update public.sales_orders set order_state=state,fulfillment_state=fulfillment,cancelled_cents=cancelled_amount,
    refund_due_cents=greatest(0,paid-(total_cents-cancelled_amount))
    where id=p_order_id returning * into order_record;
  return jsonb_build_object('order_id',p_order_id,'order_state',order_record.order_state,'fulfillment_state',order_record.fulfillment_state,
    'payment_state',order_record.payment_state,'total_cents',order_record.total_cents,'cancelled_cents',order_record.cancelled_cents,
    'remaining_value_cents',order_record.total_cents-order_record.cancelled_cents,'refund_due_cents',order_record.refund_due_cents);
end
$$;
create function private.normalize_order_quantities(p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare order_id uuid; occurred timestamptz; reason text; raw_line jsonb; lines jsonb:='[]'::jsonb; line_id uuid; qty bigint;
begin
  perform private.sale_object(p_payload,array['order_id','lines','occurred_at','reason'],array['order_id','lines','occurred_at','reason']);
  if jsonb_typeof(p_payload->'order_id') is distinct from 'string' or jsonb_typeof(p_payload->'reason') is distinct from 'string' then raise exception 'invalid_payload' using errcode='22023'; end if;
  order_id:=(p_payload->>'order_id')::uuid; occurred:=private.sale_timestamp(p_payload->'occurred_at'); reason:=btrim(p_payload->>'reason');
  if char_length(reason) not between 3 and 500 or jsonb_typeof(p_payload->'lines') is distinct from 'array' then raise exception 'invalid_payload' using errcode='22023'; end if;
  if jsonb_array_length(p_payload->'lines') not between 1 and 50 then raise exception 'invalid_payload' using errcode='22023'; end if;
  for raw_line in select value from jsonb_array_elements(p_payload->'lines') loop
    perform private.sale_object(raw_line,array['order_line_id','quantity'],array['order_line_id','quantity']);
    if jsonb_typeof(raw_line->'order_line_id') is distinct from 'string' then raise exception 'invalid_payload' using errcode='22023'; end if;
    line_id:=(raw_line->>'order_line_id')::uuid; qty:=private.sale_integer(raw_line->'quantity',1,100000);
    lines:=lines||jsonb_build_array(jsonb_build_object('order_line_id',line_id,'quantity',qty));
  end loop;
  if (select count(distinct value->>'order_line_id') from jsonb_array_elements(lines))<>jsonb_array_length(lines) then raise exception 'invalid_payload' using errcode='22023'; end if;
  select jsonb_agg(value order by value->>'order_line_id') into lines from jsonb_array_elements(lines);
  return jsonb_build_object('order_id',order_id,'lines',lines,'occurred_at',occurred,'reason',reason);
exception when invalid_text_representation then raise exception 'invalid_payload' using errcode='22023';
end
$$;

create function private.complete_production(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare normalized jsonb; replay jsonb; requirement_id uuid; qty bigint; occurred timestamptz; reason text;
  requirement public.production_requirements%rowtype; line public.sales_order_lines%rowtype;
  order_record public.sales_orders%rowtype; receipt_id uuid:=gen_random_uuid(); movement_id uuid; result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode='42501'; end if;
  if not exists(select 1 from public.memberships where user_id=auth.uid() and active and role in ('founder','production')) then
    raise exception 'production_permission_required' using errcode='42501';
  end if;
  perform private.sale_object(p_payload,array['requirement_id','quantity','occurred_at','reason'],array['requirement_id','quantity','occurred_at','reason']);
  if jsonb_typeof(p_payload->'requirement_id') is distinct from 'string' or jsonb_typeof(p_payload->'reason') is distinct from 'string' then raise exception 'invalid_payload' using errcode='22023'; end if;
  requirement_id:=(p_payload->>'requirement_id')::uuid; qty:=private.sale_integer(p_payload->'quantity',1,100000);
  occurred:=private.sale_timestamp(p_payload->'occurred_at'); reason:=btrim(p_payload->>'reason');
  if char_length(reason) not between 3 and 500 then raise exception 'invalid_payload' using errcode='22023'; end if;
  normalized:=jsonb_build_object('requirement_id',requirement_id,'quantity',qty,'occurred_at',occurred,'reason',reason);
  replay:=private.start_sale_command(p_operation_id,'complete_production',normalized); if replay is not null then return replay; end if;
  select * into requirement from public.production_requirements where id=requirement_id;
  if not found then raise exception 'invalid_payload' using errcode='22023'; end if;
  select * into strict line from public.sales_order_lines where id=requirement.order_line_id;
  select * into strict order_record from public.sales_orders where id=line.order_id for update;
  select * into requirement from public.production_requirements where id=requirement_id for update;
  if occurred<order_record.occurred_at then raise exception 'invalid_payload' using errcode='22023'; end if;
  if qty>requirement.required_quantity-requirement.completed_quantity-requirement.cancelled_quantity then raise exception 'production_quantity_exceeded' using errcode='22023'; end if;
  perform 1 from public.stock_balances where stock_item_id=line.stock_item_id and location_id=line.location_id for update;
  insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)
    values(gen_random_uuid(),line.stock_item_id,line.location_id,'production_receipt',qty,reason,
      jsonb_build_object('production_receipt_id',receipt_id,'sales_order_id',line.order_id,'sales_order_line_id',line.id),auth.uid()) returning id into movement_id;
  insert into public.production_receipts(id,operation_id,requirement_id,quantity,stock_movement_id,occurred_at,reason,created_by)
    values(receipt_id,gen_random_uuid(),requirement_id,qty,movement_id,occurred,reason,auth.uid());
  insert into public.stock_reservation_events(operation_id,order_line_id,kind,quantity_delta,created_by) values(gen_random_uuid(),line.id,'allocate',qty,auth.uid());
  update public.production_requirements set completed_quantity=completed_quantity+qty,
    status=case when completed_quantity+qty+cancelled_quantity=required_quantity then 'satisfied' else 'partially_ready' end
    where id=requirement_id;
  result:=private.refresh_sale_order(line.order_id)||jsonb_build_object('operation_id',p_operation_id,'receipt_id',receipt_id,'completed_quantity',qty,'replayed',false);
  return private.finish_sale_command(p_operation_id,'complete_production',normalized,result);
exception when invalid_text_representation then raise exception 'invalid_payload' using errcode='22023';
end
$$;

create function private.fulfill_order_lines(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
<<fulfillment_command>>
declare normalized jsonb; replay jsonb; raw_line jsonb; line public.sales_order_lines%rowtype; order_record public.sales_orders%rowtype;
  order_id uuid; qty bigint; reserved bigint; movement_id uuid; occurred timestamptz; result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode='42501'; end if;
  normalized:=private.normalize_order_quantities(p_payload);
  replay:=private.start_sale_command(p_operation_id,'fulfill_order_lines',normalized); if replay is not null then return replay; end if;
  order_id:=(normalized->>'order_id')::uuid; occurred:=(normalized->>'occurred_at')::timestamptz;
  select * into order_record from public.sales_orders where id=order_id for update;
  if not found or occurred<order_record.occurred_at then raise exception 'invalid_payload' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(normalized->'lines') r where not exists(select 1 from public.sales_order_lines l where l.id=(r->>'order_line_id')::uuid and l.order_id=fulfillment_command.order_id)) then raise exception 'invalid_payload' using errcode='22023'; end if;
  perform b.stock_item_id from public.stock_balances b join public.sales_order_lines l on l.stock_item_id=b.stock_item_id and l.location_id=b.location_id
    where l.order_id=fulfillment_command.order_id and l.id in(select (value->>'order_line_id')::uuid from jsonb_array_elements(normalized->'lines'))
    order by b.stock_item_id,b.location_id for update of b;
  for raw_line in select value from jsonb_array_elements(normalized->'lines') loop
    select * into strict line from public.sales_order_lines where id=(raw_line->>'order_line_id')::uuid;
    qty:=(raw_line->>'quantity')::bigint;
    if qty>line.quantity-line.fulfilled_quantity-line.cancelled_quantity then raise exception 'unfulfilled_quantity_exceeded' using errcode='22023'; end if;
    select reserved_quantity into reserved from public.stock_reservations where order_line_id=line.id;
    if coalesce(reserved,0)<qty then raise exception 'insufficient_ready_stock' using errcode='22023'; end if;
    -- Release this order's claim before the physical debit. Both effects roll
    -- back together and the existing balance guard protects all other orders.
    insert into public.stock_reservation_events(operation_id,order_line_id,kind,quantity_delta,created_by) values(gen_random_uuid(),line.id,'release',-qty,auth.uid());
    insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)
      values(gen_random_uuid(),line.stock_item_id,line.location_id,'sale_fulfillment',-qty,normalized->>'reason',jsonb_build_object('sales_order_id',order_id,'sales_order_line_id',line.id),auth.uid()) returning id into movement_id;
    insert into public.fulfillment_lines(order_line_id,quantity,stock_movement_id,fulfilled_at) values(line.id,qty,movement_id,occurred);
    update public.sales_order_lines set fulfilled_quantity=fulfilled_quantity+qty where id=line.id;
  end loop;
  result:=private.refresh_sale_order(order_id)||jsonb_build_object('operation_id',p_operation_id,'replayed',false);
  return private.finish_sale_command(p_operation_id,'fulfill_order_lines',normalized,result);
end
$$;

create function private.cancel_unfulfilled_lines(p_operation_id uuid,p_payload jsonb) returns jsonb
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
    cancelled_amount:=floor(line.line_total_cents::numeric*(line.cancelled_quantity+qty)/line.quantity)::bigint;
    fact_amount:=fact_amount+cancelled_amount-line.cancelled_amount_cents;
    update public.sales_order_lines set cancelled_quantity=cancelled_quantity+qty,cancelled_amount_cents=cancelled_amount where id=line.id;
  end loop;
  insert into public.commercial_facts(operation_id,order_id,fact_kind,amount_cents,occurred_at,created_by)
    values(gen_random_uuid(),order_id,'sale_cancellation_observed',fact_amount,occurred,auth.uid());
  result:=private.refresh_sale_order(order_id)||jsonb_build_object('operation_id',p_operation_id,'replayed',false);
  return private.finish_sale_command(p_operation_id,'cancel_unfulfilled_lines',normalized,result);
end
$$;

create function private.record_manual_payment(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
<<payment_command>>
declare normalized jsonb; replay jsonb; order_id uuid; amount bigint; method text; occurred timestamptz; reference text;
  order_record public.sales_orders%rowtype; payment_id uuid; result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode='42501'; end if;
  perform private.sale_object(p_payload,array['order_id','amount_cents','method','occurred_at'],array['order_id','amount_cents','method','occurred_at','reference']);
  if jsonb_typeof(p_payload->'order_id') is distinct from 'string' then raise exception 'invalid_payload' using errcode='22023'; end if;
  order_id:=(p_payload->>'order_id')::uuid; amount:=private.sale_integer(p_payload->'amount_cents',0,9000000000000000);
  method:=p_payload->>'method'; occurred:=private.sale_timestamp(p_payload->'occurred_at');
  if method is null or method not in ('cash','bank_transfer','external_card','other') then raise exception 'invalid_payload' using errcode='22023'; end if;
  if p_payload?'reference' and jsonb_typeof(p_payload->'reference') not in ('string','null') then raise exception 'invalid_payload' using errcode='22023'; end if;
  reference:=nullif(btrim(p_payload->>'reference'),'');
  if char_length(reference)>240 then raise exception 'invalid_payload' using errcode='22023'; end if;
  normalized:=jsonb_build_object('order_id',order_id,'amount_cents',amount,'method',method,'occurred_at',occurred,'reference',reference);
  replay:=private.start_sale_command(p_operation_id,'record_manual_payment',normalized); if replay is not null then return replay; end if;
  select * into order_record from public.sales_orders where id=order_id for update;
  if not found or occurred<order_record.occurred_at then raise exception 'invalid_payload' using errcode='22023'; end if;
  if order_record.order_state='cancelled' then raise exception 'order_cancelled' using errcode='22023'; end if;
  if exists(select 1 from public.order_payments p where p.order_id=payment_command.order_id) then raise exception 'payment_already_recorded' using errcode='22023'; end if;
  if amount<>order_record.total_cents-order_record.cancelled_cents then raise exception 'payment_amount_mismatch' using errcode='22023'; end if;
  insert into public.order_payments(operation_id,order_id,method,amount_cents,occurred_at,declared_reference,created_by)
    values(gen_random_uuid(),order_id,method,amount,occurred,reference,auth.uid()) returning id into payment_id;
  insert into public.commercial_facts(operation_id,order_id,payment_id,fact_kind,amount_cents,occurred_at,created_by)
    values(gen_random_uuid(),order_id,payment_id,'payment_reported',amount,occurred,auth.uid());
  update public.sales_orders set payment_state='paid' where id=order_id;
  result:=private.refresh_sale_order(order_id)||jsonb_build_object('operation_id',p_operation_id,'replayed',false);
  return private.finish_sale_command(p_operation_id,'record_manual_payment',normalized,result);
exception when invalid_text_representation then raise exception 'invalid_payload' using errcode='22023';
end
$$;

create function public.complete_production(p_operation_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.complete_production(p_operation_id,p_payload) $$;
create function public.fulfill_order_lines(p_operation_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.fulfill_order_lines(p_operation_id,p_payload) $$;
create function public.cancel_unfulfilled_lines(p_operation_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.cancel_unfulfilled_lines(p_operation_id,p_payload) $$;
create function public.record_manual_payment(p_operation_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.record_manual_payment(p_operation_id,p_payload) $$;

revoke all on function private.guard_sale_operation_id(),private.start_sale_command(uuid,text,jsonb),private.finish_sale_command(uuid,text,jsonb,jsonb),
  private.refresh_sale_order(uuid),private.normalize_order_quantities(jsonb),private.complete_production(uuid,jsonb),private.fulfill_order_lines(uuid,jsonb),
  private.cancel_unfulfilled_lines(uuid,jsonb),private.record_manual_payment(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.complete_production(uuid,jsonb),private.fulfill_order_lines(uuid,jsonb),private.cancel_unfulfilled_lines(uuid,jsonb),private.record_manual_payment(uuid,jsonb) to authenticated;
revoke all on function public.complete_production(uuid,jsonb),public.fulfill_order_lines(uuid,jsonb),public.cancel_unfulfilled_lines(uuid,jsonb),public.record_manual_payment(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_production(uuid,jsonb),public.fulfill_order_lines(uuid,jsonb),public.cancel_unfulfilled_lines(uuid,jsonb),public.record_manual_payment(uuid,jsonb) to authenticated;
commit;
