-- Annullamento di una registrazione manuale errata: fonti e storico restano immutabili.
-- Nessun reso fisico, rimborso bancario o comando Shopify; nessun seed.
begin;

create table public.sales_registration_cancellations (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null unique references public.sales_orders(id),
 operation_id uuid not null unique,
 expected_version text not null check(expected_version~'^[0-9a-f]{64}$'),
 reason text not null check(char_length(reason) between 3 and 500),
 product_quantity bigint not null check(product_quantity>=0),
 box_quantity bigint not null check(box_quantity>=0),
 sticker_quantity bigint not null check(sticker_quantity>=0),
 payment_cents bigint not null check(payment_cents between -9000000000000000 and 9000000000000000),
 created_by uuid not null references public.profiles(user_id),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.sales_registration_cancellations enable row level security;
revoke all on public.sales_registration_cancellations from public,anon,authenticated,service_role;
grant select on public.sales_registration_cancellations to authenticated;
create policy member_read on public.sales_registration_cancellations for select to authenticated using((select private.is_member()));
create trigger cancellation_append_only before update or delete on public.sales_registration_cancellations for each row execute function private.reject_ledger_mutation();
create trigger audit_change after insert on public.sales_registration_cancellations for each row execute function private.audit_change();

alter table private.sales_command_receipts drop constraint sales_command_receipts_command_kind_check;
alter table private.sales_command_receipts add constraint sales_command_receipts_command_kind_check check(command_kind in('complete_production','fulfill_order_lines','cancel_unfulfilled_lines','record_manual_payment','cancel_manual_sale_registration'));
-- A cancelled source keeps its consumption ledger but has no outstanding demand.
alter table public.packaging_consumptions add column cancelled_registration boolean not null default false;

create function private.manual_sale_cancellation_access()returns boolean
language sql volatile security definer set search_path=''as $$
 select auth.uid()is not null and private.is_member()and exists(
  select 1 from auth.sessions s where s.id=private.current_auth_session_id()and s.user_id=auth.uid()
  and(s.not_after is null or s.not_after>clock_timestamp()))
$$;

-- Same order as fulfillment: aggregate, product balances, packaging global lock,
-- packaging balances. Never take the packaging lock before a product balance.
create function private.lock_manual_sale_cancellation(p_order_id uuid)returns void
language plpgsql security definer set search_path=''as $$
declare source text;
begin
 select source_kind into source from public.sales_orders where id=p_order_id for update;
 if not found then raise exception 'sale_not_found'using errcode='22023';end if;
 if source<>'manual_declaration'then raise exception 'external_order_managed_by_shopify'using errcode='22023';end if;
 perform b.stock_item_id from public.stock_balances b join public.sales_order_lines l on l.stock_item_id=b.stock_item_id and l.location_id=b.location_id
  where l.order_id=p_order_id order by b.stock_item_id,b.location_id for update of b;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packaging.consume',0));
 perform b.stock_item_id from public.stock_balances b where exists(
  select 1 from public.packaging_consumptions c join public.fulfillment_lines f on f.id=c.source_id and c.source_kind='fulfillment'
  join public.sales_order_lines l on l.id=f.order_line_id where l.order_id=p_order_id and c.stock_item_id=b.stock_item_id and c.location_id=b.location_id)
  order by b.stock_item_id,b.location_id for update of b;
 if not private.manual_sale_cancellation_access()then raise exception 'membership_required'using errcode='42501';end if;
end $$;

-- Forward hook: the subsequent real-return module can forbid cancellation once
-- a real return exists, while keeping the aggregate lock held by the caller.
create function private.assert_sale_registration_cancellation_allowed(p_order_id uuid)returns void
language plpgsql security definer set search_path=''as $$
begin
 if not exists(select 1 from public.sales_orders where id=p_order_id and source_kind='manual_declaration')then
  raise exception 'external_order_managed_by_shopify'using errcode='22023';end if;
end $$;

-- Full private CAS state. Only its digest and operational quantities leave the server.
create function private.manual_sale_cancellation_state(p_order_id uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 with lines as(select * from public.sales_order_lines where order_id=p_order_id),
 fulfillments as(select f.* from public.fulfillment_lines f join lines l on l.id=f.order_line_id),
 consumptions as(select c.* from public.packaging_consumptions c join fulfillments f on f.id=c.source_id where c.source_kind='fulfillment'),
 payments as(select p.* from public.order_payments p where p.order_id=p_order_id)
 select jsonb_build_object(
  'as_of_date',(statement_timestamp()at time zone 'Europe/Rome')::date,
  'effective_payment_summary',private.effective_order_payment_summary(p_order_id),
  'order',(select to_jsonb(o)from public.sales_orders o where o.id=p_order_id),
  'lines',coalesce((select jsonb_agg(to_jsonb(l)order by l.id)from lines l),'[]'::jsonb),
  'reservations',coalesce((select jsonb_agg(to_jsonb(r)order by r.order_line_id)from public.stock_reservations r join lines l on l.id=r.order_line_id),'[]'::jsonb),
  'requirements',coalesce((select jsonb_agg(to_jsonb(r)order by r.id)from public.production_requirements r join lines l on l.id=r.order_line_id),'[]'::jsonb),
  'fulfillments',coalesce((select jsonb_agg(to_jsonb(f)order by f.id)from fulfillments f),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(to_jsonb(p)order by p.id)from payments p),'[]'::jsonb),
  'revisions',coalesce((select jsonb_agg(to_jsonb(r)order by r.source_id,r.version)from public.finance_movement_revisions r join payments p on p.id=r.source_id where r.source_kind='payment'),'[]'::jsonb),
  'consumptions',coalesce((select jsonb_agg(to_jsonb(c)order by c.id)from consumptions c),'[]'::jsonb),
  'packaging_entries',coalesce((select jsonb_agg(to_jsonb(e)order by e.id)from public.packaging_consumption_entries e join consumptions c on c.id=e.consumption_id),'[]'::jsonb),
  'packaging_failures',coalesce((select jsonb_agg(to_jsonb(e)order by e.id)from public.packaging_automation_failures e join fulfillments f on f.id=e.source_id where e.source_kind='fulfillment'),'[]'::jsonb),
  'balances',coalesce((select jsonb_agg(to_jsonb(b)order by b.stock_item_id,b.location_id)from public.stock_balances b where exists(select 1 from lines l where l.stock_item_id=b.stock_item_id and l.location_id=b.location_id)or exists(select 1 from consumptions c where c.stock_item_id=b.stock_item_id and c.location_id=b.location_id)),'[]'::jsonb),
  'cancelled',exists(select 1 from public.sales_registration_cancellations where order_id=p_order_id))
$$;

create function private.preview_manual_sale_cancellation(p_order_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare state jsonb; result jsonb; summary jsonb;
begin
 if not private.manual_sale_cancellation_access()then raise exception 'membership_required'using errcode='42501';end if;
 if p_order_id is null then raise exception 'invalid_payload'using errcode='22023';end if;
 perform private.lock_manual_sale_cancellation(p_order_id);
 perform private.assert_sale_registration_cancellation_allowed(p_order_id);
 if exists(select 1 from public.sales_order_lines l where l.order_id=p_order_id and l.fulfilled_quantity<>(select coalesce(sum(f.quantity),0)from public.fulfillment_lines f where f.order_line_id=l.id))
  or exists(select 1 from public.fulfillment_lines f join public.sales_order_lines l on l.id=f.order_line_id join public.stock_movements m on m.id=f.stock_movement_id
   where l.order_id=p_order_id and(m.quantity_delta<>-f.quantity or m.stock_item_id<>l.stock_item_id or m.location_id<>l.location_id))
  or exists(select 1 from public.packaging_consumptions c join public.fulfillment_lines f on f.id=c.source_id and c.source_kind='fulfillment'join public.sales_order_lines l on l.id=f.order_line_id
   where l.order_id=p_order_id and c.consumed_quantity<>(select coalesce(sum(e.quantity),0)from public.packaging_consumption_entries e where e.consumption_id=c.id))then
  raise exception 'sale_cancellation_inconsistent_state'using errcode='22023';end if;
 state:=private.manual_sale_cancellation_state(p_order_id);
 summary:=private.effective_order_payment_summary(p_order_id);
 select jsonb_build_object('order_id',p_order_id,'expected_version',encode(sha256(convert_to(state::text,'UTF8')),'hex'),
  'product_quantity',coalesce((select sum(fulfilled_quantity)from public.sales_order_lines where order_id=p_order_id),0),
  'box_quantity',coalesce(sum(c.consumed_quantity)filter(where p.packaging_type='box'),0),
  'sticker_quantity',coalesce(sum(c.consumed_quantity)filter(where p.packaging_type='sticker'),0),
  'payment_cents',summary->>'net_cents','already_cancelled',(state->>'cancelled')::boolean)
 into result from public.packaging_consumptions c join public.packaging_items p on p.stock_item_id=c.stock_item_id
 join public.fulfillment_lines f on f.id=c.source_id and c.source_kind='fulfillment'
 join public.sales_order_lines l on l.id=f.order_line_id where l.order_id=p_order_id;
 return result;
end $$;

-- Guard all paths that can reactivate this aggregate, including generic Finance
-- restores. Original receipts may still replay: they perform no new write.
create function private.guard_cancelled_sale_registration()returns trigger
language plpgsql security definer set search_path=''as $$
declare parent uuid;
begin
 if tg_table_name='sales_orders'then parent:=new.id;
 elsif tg_table_name in('order_payments','sales_order_lines')then parent:=new.order_id;
 elsif tg_table_name='finance_movement_revisions'then
  if new.source_kind<>'payment'then return new;end if;
  select order_id into parent from public.order_payments where id=new.source_id;
 elsif tg_table_name='production_receipts'then
  select l.order_id into parent from public.production_requirements r join public.sales_order_lines l on l.id=r.order_line_id where r.id=new.requirement_id;
 else select order_id into parent from public.sales_order_lines where id=new.order_line_id;end if;
 if parent is not null then
  perform 1 from public.sales_orders where id=parent for update;
  if exists(select 1 from public.sales_registration_cancellations where order_id=parent)then
   raise exception 'sale_registration_cancelled'using errcode='22023';end if;
 end if;
 return new;
end $$;
create trigger guard_cancelled_registration before update on public.sales_orders for each row execute function private.guard_cancelled_sale_registration();
create trigger guard_cancelled_registration before insert or update on public.sales_order_lines for each row execute function private.guard_cancelled_sale_registration();
create trigger guard_cancelled_registration before insert on public.order_payments for each row execute function private.guard_cancelled_sale_registration();
create trigger guard_cancelled_registration before insert on public.finance_movement_revisions for each row execute function private.guard_cancelled_sale_registration();
create trigger guard_cancelled_registration before insert on public.fulfillment_lines for each row execute function private.guard_cancelled_sale_registration();
create trigger guard_cancelled_registration before insert on public.stock_reservation_events for each row execute function private.guard_cancelled_sale_registration();
create trigger guard_cancelled_registration before insert or update on public.production_requirements for each row execute function private.guard_cancelled_sale_registration();
create trigger guard_cancelled_registration before insert on public.production_receipts for each row execute function private.guard_cancelled_sale_registration();

create function private.cancel_manual_sale_registration(p_operation_id uuid,p_payload jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
<<cancellation>>
declare parent uuid; expected text; reason text; normalized jsonb; replay jsonb; preview jsonb; order_record public.sales_orders%rowtype;
 line public.sales_order_lines%rowtype; reserved bigint; requirement public.production_requirements%rowtype; consumption record;
 source record; original jsonb; latest public.finance_movement_revisions%rowtype; v jsonb; version integer; deleted boolean;
 revision_op uuid; revision_id uuid; revision_payload jsonb; revision_result jsonb; movement uuid; cancellation_id uuid:=gen_random_uuid(); result jsonb; event_at timestamptz;
begin
 if not private.manual_sale_cancellation_access()then raise exception 'membership_required'using errcode='42501';end if;
 perform private.sale_object(p_payload,array['schema_version','order_id','expected_version','reason','confirm_stock'],array['schema_version','order_id','expected_version','reason','confirm_stock']);
 if p_operation_id is null or p_payload->'schema_version'is distinct from '1'::jsonb or p_payload->'confirm_stock'is distinct from 'true'::jsonb
  or jsonb_typeof(p_payload->'order_id')is distinct from 'string'or jsonb_typeof(p_payload->'expected_version')is distinct from 'string'
  or jsonb_typeof(p_payload->'reason')is distinct from 'string'then raise exception 'invalid_payload'using errcode='22023';end if;
 parent:=(p_payload->>'order_id')::uuid;expected:=p_payload->>'expected_version';reason:=btrim(p_payload->>'reason');
 if parent is null or expected!~'^[0-9a-f]{64}$'or char_length(reason)not between 3 and 500 then raise exception 'invalid_payload'using errcode='22023';end if;
 normalized:=jsonb_build_object('schema_version',1,'order_id',parent,'expected_version',expected,'reason',reason,'confirm_stock',true);
 replay:=private.start_sale_command(p_operation_id,'cancel_manual_sale_registration',normalized);
 if not private.manual_sale_cancellation_access()then raise exception 'membership_required'using errcode='42501';end if;
 if replay is not null then return replay;end if;
 preview:=private.preview_manual_sale_cancellation(parent);
 if(preview->>'already_cancelled')::boolean then raise exception 'sale_registration_cancelled'using errcode='22023';end if;
 if preview->>'expected_version'<>expected then raise exception 'sale_cancellation_conflict'using errcode='22023';end if;
 select * into strict order_record from public.sales_orders where id=parent;
 event_at:=clock_timestamp();
 -- Keep delivered history; only open reservations and unfinished production close.
 for line in select * from public.sales_order_lines where order_id=parent order by stock_item_id,location_id,id loop
  select reserved_quantity into reserved from public.stock_reservations where order_line_id=line.id;
  if coalesce(reserved,0)>0 then insert into public.stock_reservation_events(operation_id,order_line_id,kind,quantity_delta,created_by)
   values(gen_random_uuid(),line.id,'release',-reserved,auth.uid());end if;
  select * into requirement from public.production_requirements where order_line_id=line.id for update;
  if found then update public.production_requirements set cancelled_quantity=required_quantity-completed_quantity,
   status=case when completed_quantity=0 then 'cancelled'else 'satisfied'end where id=requirement.id;end if;
  if line.fulfilled_quantity>0 then
   insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)
   values(gen_random_uuid(),line.stock_item_id,line.location_id,'adjustment',line.fulfilled_quantity,reason,
    jsonb_build_object('kind','manual_sale_registration_cancellation','sales_order_id',parent,'sales_order_line_id',line.id,'cancellation_id',cancellation_id),auth.uid());
  end if;
  update public.sales_order_lines set cancelled_quantity=quantity-fulfilled_quantity,cancelled_amount_cents=line_total_cents where id=line.id;
 end loop;
 -- Return only actual debits; preserve receipt/entry quantities as historical facts.
 for consumption in select c.* from public.packaging_consumptions c join public.fulfillment_lines f on f.id=c.source_id and c.source_kind='fulfillment'
  join public.sales_order_lines l on l.id=f.order_line_id where l.order_id=parent order by c.stock_item_id,c.location_id,c.id for update of c loop
  if consumption.consumed_quantity>0 then
   insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)
   values(gen_random_uuid(),consumption.stock_item_id,consumption.location_id,'adjustment',consumption.consumed_quantity,reason,
    jsonb_build_object('kind','manual_sale_registration_cancellation','sales_order_id',parent,'packaging_consumption_id',consumption.id,'cancellation_id',cancellation_id),auth.uid());
  end if;
  update public.packaging_consumptions set cancelled_registration=true,automatic_allowed=false,review_reason='cancelled_sale_registration',reviewed_reason=reason where id=consumption.id;
 end loop;
 update public.packaging_automation_failures e set resolved=true where e.source_kind='fulfillment'and exists(
  select 1 from public.fulfillment_lines f join public.sales_order_lines l on l.id=f.order_line_id where f.id=e.source_id and l.order_id=parent);
 -- Scoped automatic exclusion of this order's payments. Generic Finance gates and
 -- immutable sources do not change. Each child keeps the regular full CAS receipt.
 for source in select id from public.order_payments where order_id=parent order by id loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.finance.revision.source.payment.'||source.id::text,0));
  original:=private.finance_revision_original('payment',source.id);
  select * into latest from public.finance_movement_revisions r where r.source_kind='payment'and r.source_id=source.id order by r.version desc limit 1;
  version:=coalesce(latest.version,0);deleted:=coalesce(latest.deleted,(original->>'deleted')::boolean);
  if deleted then continue;end if;
  if version>=2147483646 then raise exception 'finance_revision_conflict'using errcode='22023';end if;
  v:=coalesce(latest.value_snapshot,original->'values');revision_op:=gen_random_uuid();
  revision_payload:=jsonb_build_object('schema_version',1,'source_kind','payment','source_id',source.id,'expected_version',version,'action','delete','reason',reason);
  insert into public.finance_movement_revisions(operation_id,source_kind,source_id,version,previous_version,action,value_snapshot,deleted,reason,created_by)
   values(revision_op,'payment',source.id,version+1,version,'delete',v,true,reason,auth.uid())returning id into revision_id;
  revision_result:=jsonb_build_object('operation_id',revision_op,'source_kind','payment','source_id',source.id,'revision_id',revision_id,'version',version+1,'replayed',false);
  insert into private.finance_revision_receipts(operation_id,actor_id,payload_sha256,result)
   values(revision_op,auth.uid(),encode(sha256(convert_to(revision_payload::text,'UTF8')),'hex'),revision_result);
 end loop;
 insert into public.commercial_facts(operation_id,order_id,fact_kind,amount_cents,occurred_at,created_by)
  values(gen_random_uuid(),parent,'sale_cancellation_observed',order_record.total_cents-order_record.cancelled_cents,event_at,auth.uid());
 update public.sales_orders set order_state='cancelled',fulfillment_state='cancelled',cancelled_cents=total_cents,payment_state='unpaid',refund_due_cents=0 where id=parent;
 if not private.manual_sale_cancellation_access()then raise exception 'membership_required'using errcode='42501';end if;
 insert into public.sales_registration_cancellations(id,order_id,operation_id,expected_version,reason,product_quantity,box_quantity,sticker_quantity,payment_cents,created_by,created_at)
  values(cancellation_id,parent,p_operation_id,expected,reason,(preview->>'product_quantity')::bigint,(preview->>'box_quantity')::bigint,(preview->>'sticker_quantity')::bigint,(preview->>'payment_cents')::bigint,auth.uid(),event_at);
 result:=jsonb_build_object('operation_id',p_operation_id,'order_id',parent,'replayed',false);
 return private.finish_sale_command(p_operation_id,'cancel_manual_sale_registration',normalized,result);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_payload'using errcode='22023';
end $$;

create function public.preview_manual_sale_cancellation(p_order_id uuid)returns jsonb
language sql security invoker set search_path=''as $$select private.preview_manual_sale_cancellation(p_order_id)$$;
create function public.cancel_manual_sale_registration(p_operation_id uuid,p_payload jsonb)returns jsonb
language sql security invoker set search_path=''as $$select private.cancel_manual_sale_registration(p_operation_id,p_payload)$$;
revoke all on function private.manual_sale_cancellation_access(),private.lock_manual_sale_cancellation(uuid),private.manual_sale_cancellation_state(uuid),private.guard_cancelled_sale_registration(),private.assert_sale_registration_cancellation_allowed(uuid),private.preview_manual_sale_cancellation(uuid),private.cancel_manual_sale_registration(uuid,jsonb),public.preview_manual_sale_cancellation(uuid),public.cancel_manual_sale_registration(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function private.preview_manual_sale_cancellation(uuid),private.cancel_manual_sale_registration(uuid,jsonb),public.preview_manual_sale_cancellation(uuid),public.cancel_manual_sale_registration(uuid,jsonb)to authenticated;

-- The explicit cancellation marker governs status without rewriting fulfillment history.
create or replace function private.refresh_sale_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare total_qty bigint; fulfilled bigint; cancelled bigint; cancelled_amount bigint; summary jsonb;
  order_record public.sales_orders%rowtype; state text; fulfillment text;
begin
  select * into strict order_record from public.sales_orders where id=p_order_id for update;
  if order_record.source_kind='manual_declaration' and not exists(select 1 from public.sales_registration_cancellations where order_id=p_order_id) then
    select coalesce(sum(quantity),0),coalesce(sum(fulfilled_quantity),0),coalesce(sum(cancelled_quantity),0),coalesce(sum(cancelled_amount_cents),0)
      into total_qty,fulfilled,cancelled,cancelled_amount from public.sales_order_lines where order_id=p_order_id;
    state:=case when cancelled=total_qty then 'cancelled' when cancelled>0 then 'partially_cancelled' else 'confirmed' end;
    fulfillment:=case when cancelled=total_qty then 'cancelled' when fulfilled=total_qty-cancelled then 'fulfilled' when fulfilled>0 then 'partial' else 'unfulfilled' end;
    -- Cancellation is recalculated before deriving the effective residual.
    update public.sales_orders set order_state=state,fulfillment_state=fulfillment,cancelled_cents=cancelled_amount where id=p_order_id;
    summary:=private.effective_order_payment_summary(p_order_id);
    update public.sales_orders set payment_state=summary->>'payment_state',refund_due_cents=(summary->>'refund_due_cents')::bigint where id=p_order_id returning * into order_record;
  end if;
  return jsonb_build_object('order_id',p_order_id,'order_state',order_record.order_state,'fulfillment_state',order_record.fulfillment_state,
    'payment_state',order_record.payment_state,'total_cents',order_record.total_cents,'cancelled_cents',order_record.cancelled_cents,
    'remaining_value_cents',order_record.total_cents-order_record.cancelled_cents,'refund_due_cents',order_record.refund_due_cents);
end $$;

-- Deferred recovery must never create a new debit for an annulled source.
create or replace function private.observe_packaging_source(p_kind text,p_source uuid)returns void language plpgsql security definer set search_path='' as $$
declare config public.packaging_automation%rowtype;item uuid;quantity bigint;event_time timestamptz;inserted timestamptz;v_order_id uuid;order_time timestamptz;order_source text;allowed boolean:=true;material uuid;receipt uuid;
begin
 if p_kind='fulfillment'and exists(select 1 from public.fulfillment_lines f join public.sales_order_lines l on l.id=f.order_line_id join public.sales_registration_cancellations v on v.order_id=l.order_id where f.id=p_source)then return;end if;
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

create or replace view public.packaging_material_status with(security_invoker=true)as
with demand as(
 select coalesce(sum(l.quantity-l.fulfilled_quantity-l.cancelled_quantity),0)::bigint quantity from public.sales_order_lines l join public.sales_orders o on o.id=l.order_id
 join public.product_variants v on v.stock_item_id=l.stock_item_id join public.products p on p.id=v.product_id where p.category='T-shirt'and o.order_state<>'cancelled'
),deficits as(
 select stock_item_id,sum(requested_quantity-consumed_quantity)::bigint quantity,sum(case when automatic_allowed then requested_quantity-consumed_quantity else 0 end)::bigint reconcilable,
 sum(case when not automatic_allowed then requested_quantity-consumed_quantity else 0 end)::bigint needs_review from public.packaging_consumptions where not cancelled_registration group by stock_item_id
)
select s.id stock_item_id,s.name,s.sku,p.packaging_type,p.specifications,s.unit_cost_eur,a.location_id,a.started_at,b.quantity on_hand,d.quantity reserved,
 case when b.quantity is null then null else b.quantity-d.quantity end unreserved,
 coalesce(x.quantity,0)::bigint consumption_deficit,coalesce(x.reconcilable,0)::bigint reconcilable_deficit,coalesce(x.needs_review,0)::bigint historical_review,
 (select count(*)::bigint from public.packaging_automation_failures where not resolved)automation_failures
from public.packaging_automation a join public.stock_items s on s.id in(a.box_item_id,a.sticker_item_id)join public.packaging_items p on p.stock_item_id=s.id
left join public.stock_balances b on b.stock_item_id=s.id and b.location_id=a.location_id cross join demand d left join deficits x on x.stock_item_id=s.id where a.id and a.started_at is not null;

commit;
