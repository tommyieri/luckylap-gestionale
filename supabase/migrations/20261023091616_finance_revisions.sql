-- P4: immutable sources, complete append-only application revisions, no seed data.
begin;

-- Recheck the wall clock after operation/source locks without altering area policy.
create function private.finance_revision_live_access()returns boolean
language sql volatile security invoker set search_path=''as $$
 select auth.uid()is not null and private.can_finance()and exists(
  select 1 from private.area_grants g join private.sensitive_area_credentials c on c.area=g.area and c.version=g.credential_version
  join auth.sessions s on s.id=g.session_id and s.user_id=g.user_id
  where g.user_id=auth.uid()and g.session_id=private.current_auth_session_id()and g.area='finance'
  and g.expires_at>clock_timestamp()and(s.not_after is null or s.not_after>clock_timestamp()))
$$;
revoke all on function private.finance_revision_live_access() from public,anon,authenticated,service_role;

create table public.finance_movement_revisions (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  source_kind text not null check(source_kind in ('budgetflow','manual','payment','refund','consignment_settlement')),
  source_id uuid not null,
  version integer not null check(version between 1 and 2147483646),
  previous_version integer not null check(previous_version=version-1),
  action text not null check(action in ('update','delete','restore')),
  restored_from_version integer check(restored_from_version>=0 and restored_from_version<version),
  value_snapshot jsonb not null check(jsonb_typeof(value_snapshot)='object'),
  deleted boolean not null,
  reason text not null check(char_length(reason) between 3 and 500),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  unique(source_kind,source_id,version),
  check((action='restore')=(restored_from_version is not null)),
  check((action='delete')=deleted)
);
create index finance_revision_creator on public.finance_movement_revisions(created_by);
alter table public.finance_movement_revisions enable row level security;
revoke all on public.finance_movement_revisions from public,anon,authenticated,service_role;
grant select on public.finance_movement_revisions to authenticated;
create policy finance_read on public.finance_movement_revisions for select to authenticated using((select private.can_finance()));
create trigger finance_revisions_append_only before update or delete on public.finance_movement_revisions for each row execute function private.reject_ledger_mutation();
create trigger audit_change after insert or update or delete on public.finance_movement_revisions for each row execute function private.audit_change();

create view public.finance_revision_current with(security_invoker=true) as
  select distinct on(source_kind,source_id) * from public.finance_movement_revisions order by source_kind,source_id,version desc;
revoke all on public.finance_revision_current from public,anon,authenticated,service_role;
grant select on public.finance_revision_current to authenticated;

create table private.finance_revision_receipts (
  operation_id uuid primary key,
  actor_id uuid not null references public.profiles(user_id),
  payload_sha256 text not null check(payload_sha256~'^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.finance_revision_receipts enable row level security;
revoke all on private.finance_revision_receipts from public,anon,authenticated,service_role;
create trigger finance_revision_receipt_append_only before update or delete on private.finance_revision_receipts for each row execute function private.reject_ledger_mutation();

-- Private original lookup is deliberately not executable by a client role.
-- Reimporting the same BudgetFlow file returns its existing immutable row IDs.
create function private.finance_revision_original(p_kind text,p_id uuid) returns jsonb
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

create function private.finance_revision_values(p_kind text,p_values jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare day date; amount bigint; account text; target text; category text; description text;
begin
  if jsonb_typeof(p_values) is distinct from 'object' or not(p_values?&array['date','direction','amount_cents','account','target_account','category','description','pending'])
    or p_values-array['date','direction','amount_cents','account','target_account','category','description','pending']<>'{}'::jsonb
    or jsonb_typeof(p_values->'date') is distinct from 'string' or (p_values->>'date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_values->'direction') is distinct from 'string' or (p_values->>'direction') not in('income','expense')
    or jsonb_typeof(p_values->'amount_cents') is distinct from 'number' or (p_values->>'amount_cents')!~'^[0-9]{1,16}$'
    or jsonb_typeof(p_values->'description') is distinct from 'string' or jsonb_typeof(p_values->'pending') is distinct from 'boolean' then
    raise exception 'invalid_finance_revision' using errcode='22023';end if;
  day:=(p_values->>'date')::date;amount:=(p_values->>'amount_cents')::bigint;
  if day::text<>p_values->>'date' or amount not between 0 and 9000000000000000 then raise exception 'invalid_finance_revision' using errcode='22023';end if;
  if jsonb_typeof(p_values->'account') not in('string','null') or jsonb_typeof(p_values->'target_account') not in('string','null') or jsonb_typeof(p_values->'category') not in('string','null') then
    raise exception 'invalid_finance_revision' using errcode='22023';end if;
  account:=nullif(btrim(p_values->>'account'),'');target:=nullif(btrim(p_values->>'target_account'),'');category:=nullif(btrim(p_values->>'category'),'');description:=btrim(p_values->>'description');
  -- Match the established dashboard alias policy; custom account spelling is preserved.
  account:=case lower(account) when 'cash' then 'Cash' when 'revolut business' then 'Revolut Business' else account end;
  target:=case lower(target) when 'cash' then 'Cash' when 'revolut business' then 'Revolut Business' else target end;
  if char_length(account)>240 or char_length(target)>240 or char_length(category)>240 or char_length(description)>2000
    or (target is not null and (p_kind<>'budgetflow' or account is null or account=target)) then raise exception 'invalid_finance_revision' using errcode='22023';end if;
  return jsonb_build_object('date',day,'direction',p_values->>'direction','amount_cents',amount,'account',account,'target_account',target,'category',category,'description',description,'pending',p_values->'pending');
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'invalid_finance_revision' using errcode='22023';
end $$;

-- One implementation for payment state, residual and overpayment; no source or
-- account details are exposed to members through the operational wrapper below.
create function private.effective_order_payment_summary(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare original public.sales_orders%rowtype; source record; revision public.finance_movement_revisions%rowtype;
  v jsonb; signed numeric; incoming numeric:=0; outgoing numeric:=0; net numeric; remaining numeric; n integer:=0; corrected boolean:=false; state text;
begin
  select * into original from public.sales_orders where id=p_order;
  if not found then raise exception 'finance_source_not_found' using errcode='22023';end if;
  for source in select 'payment'::text kind,id from public.order_payments where order_id=p_order
    union all select 'refund'::text,id from public.shopify_refund_observations where order_id=p_order loop
    select * into revision from public.finance_movement_revisions where source_kind=source.kind and source_id=source.id order by version desc limit 1;
    if found then
      corrected:=true;if revision.deleted then continue;end if;v:=revision.value_snapshot;
    else v:=private.finance_revision_original(source.kind,source.id)->'values';end if;
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
  net:=incoming-outgoing;remaining:=original.total_cents-original.cancelled_cents;
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
declare total_qty bigint; fulfilled bigint; cancelled bigint; cancelled_amount bigint; summary jsonb;
  order_record public.sales_orders%rowtype; state text; fulfillment text;
begin
  select * into strict order_record from public.sales_orders where id=p_order_id for update;
  if order_record.source_kind='manual_declaration' then
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

create function private.revise_finance_movement(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<revision_command>>
declare kind text; source_id uuid; expected integer; action text; reason text; target integer; normalized jsonb; v jsonb; original jsonb; parent uuid; sale_parent uuid;
  latest public.finance_movement_revisions%rowtype; receipt private.finance_revision_receipts%rowtype; current_version integer; is_deleted boolean; new_id uuid; result jsonb; digest text;
begin
  if auth.uid() is null or not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' or not(p_payload?&array['schema_version','source_kind','source_id','expected_version','action','reason'])
    or p_payload->'schema_version' is distinct from '1'::jsonb or jsonb_typeof(p_payload->'source_kind') is distinct from 'string'
    or p_payload->>'source_kind' not in('budgetflow','manual','payment','refund','consignment_settlement') or jsonb_typeof(p_payload->'source_id') is distinct from 'string'
    or jsonb_typeof(p_payload->'expected_version') is distinct from 'number' or (p_payload->>'expected_version')!~'^[0-9]{1,10}$'
    or jsonb_typeof(p_payload->'action') is distinct from 'string' or p_payload->>'action' not in('update','delete','restore') or jsonb_typeof(p_payload->'reason') is distinct from 'string' then
    raise exception 'invalid_finance_revision' using errcode='22023';end if;
  kind:=p_payload->>'source_kind';source_id:=(p_payload->>'source_id')::uuid;expected:=(p_payload->>'expected_version')::integer;action:=p_payload->>'action';reason:=btrim(p_payload->>'reason');
  if source_id is null or expected not between 0 and 2147483645 or char_length(reason) not between 3 and 500 then raise exception 'invalid_finance_revision' using errcode='22023';end if;
  normalized:=jsonb_build_object('schema_version',1,'source_kind',kind,'source_id',source_id,'expected_version',expected,'action',action,'reason',reason);
  if action='update' then
    if not(p_payload?'values') or p_payload-array['schema_version','source_kind','source_id','expected_version','action','reason','values']<>'{}'::jsonb then raise exception 'invalid_finance_revision' using errcode='22023';end if;
    v:=private.finance_revision_values(kind,p_payload->'values');normalized:=normalized||jsonb_build_object('values',v);
  elsif action='restore' then
    if jsonb_typeof(p_payload->'restore_version') is distinct from 'number' or (p_payload->>'restore_version')!~'^[0-9]{1,10}$'
      or p_payload-array['schema_version','source_kind','source_id','expected_version','action','reason','restore_version']<>'{}'::jsonb then raise exception 'invalid_finance_revision' using errcode='22023';end if;
    target:=(p_payload->>'restore_version')::integer;if target<0 or target>expected then raise exception 'invalid_finance_revision' using errcode='22023';end if;
    normalized:=normalized||jsonb_build_object('restore_version',target);
  elsif p_payload-array['schema_version','source_kind','source_id','expected_version','action','reason']<>'{}'::jsonb then raise exception 'invalid_finance_revision' using errcode='22023';end if;
  digest:=encode(sha256(convert_to(normalized::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.finance.revision.operation.'||p_operation_id::text,0));
  if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  select * into receipt from private.finance_revision_receipts where operation_id=p_operation_id;
  if found then
    if receipt.actor_id<>auth.uid() or receipt.payload_sha256<>digest then raise exception 'idempotency_conflict' using errcode='22023';end if;
    return receipt.result||'{"replayed":true}'::jsonb;
  end if;
  original:=private.finance_revision_original(kind,source_id);parent:=(original->>'order_id')::uuid;
  -- All payment edits and new residual payments take the same aggregate lock.
  if parent is not null then perform 1 from public.sales_orders where id=parent for update;
  elsif kind='manual' then perform 1 from public.finance_entries where id=source_id for update;
  elsif kind='consignment_settlement' then
    select sale_id into sale_parent from public.consignment_settlements s where s.id=source_id;
    perform 1 from public.consignment_sales where id=sale_parent for update;end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.finance.revision.source.'||kind||'.'||source_id::text,0));
  original:=private.finance_revision_original(kind,source_id);
  select * into latest from public.finance_movement_revisions r where r.source_kind=kind and r.source_id=revision_command.source_id order by version desc limit 1;
  current_version:=coalesce(latest.version,0);is_deleted:=coalesce(latest.deleted,(original->>'deleted')::boolean);
  if current_version<>expected then raise exception 'finance_revision_conflict' using errcode='22023';end if;
  if action='update' and is_deleted then raise exception 'finance_movement_deleted' using errcode='22023';end if;
  if action='delete' then
    if is_deleted then raise exception 'finance_movement_deleted' using errcode='22023';end if;
    v:=coalesce(latest.value_snapshot,original->'values');
  elsif action='restore' then
    if target=0 then v:=original->'values';else select value_snapshot into v from public.finance_movement_revisions r where r.source_kind=kind and r.source_id=revision_command.source_id and version=target;end if;
    if v is null then raise exception 'finance_restore_not_found' using errcode='22023';end if;
  end if;
  if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  insert into public.finance_movement_revisions(operation_id,source_kind,source_id,version,previous_version,action,restored_from_version,value_snapshot,deleted,reason,created_by)
    values(p_operation_id,kind,source_id,current_version+1,current_version,action,target,v,action='delete',reason,auth.uid()) returning id into new_id;
  if parent is not null then
    perform private.effective_order_payment_summary(parent);
    -- Canonical Shopify payment_state remains a source observation. Effective
    -- internal values are supplied by the common read projection instead.
    if exists(select 1 from public.sales_orders where id=parent and source_kind='manual_declaration') then perform private.refresh_sale_order(parent);end if;
  end if;
  if sale_parent is not null then perform private.effective_consignment_settlement_summary(sale_parent);end if;
  result:=jsonb_build_object('operation_id',p_operation_id,'source_kind',kind,'source_id',source_id,'revision_id',new_id,'version',current_version+1,'replayed',false);
  insert into private.finance_revision_receipts(operation_id,actor_id,payload_sha256,result) values(p_operation_id,auth.uid(),digest,result);
  return result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'invalid_finance_revision' using errcode='22023';
end $$;

-- A corrected receipt can leave a genuine residual. Identity of each immutable
-- payment/fact and each command receipt remains unique; only one-per-order falls.
drop index public.order_payments_one_manual;
drop index public.commercial_manual_payment_once;
create or replace function private.record_manual_payment(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
<<payment_command>>
declare normalized jsonb; replay jsonb; order_id uuid; amount bigint; method text; occurred timestamptz; reference text;
  order_record public.sales_orders%rowtype; payment_id uuid; result jsonb; summary jsonb; due bigint;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode='42501';end if;
  perform private.sale_object(p_payload,array['order_id','amount_cents','method','occurred_at'],array['order_id','amount_cents','method','occurred_at','reference']);
  if jsonb_typeof(p_payload->'order_id') is distinct from 'string' then raise exception 'invalid_payload' using errcode='22023';end if;
  order_id:=(p_payload->>'order_id')::uuid;amount:=private.sale_integer(p_payload->'amount_cents',0,9000000000000000);
  method:=p_payload->>'method';occurred:=private.sale_timestamp(p_payload->'occurred_at');
  if method is null or method not in('cash','bank_transfer','external_card','other') then raise exception 'invalid_payload' using errcode='22023';end if;
  if p_payload?'reference' and jsonb_typeof(p_payload->'reference') not in('string','null') then raise exception 'invalid_payload' using errcode='22023';end if;
  reference:=nullif(btrim(p_payload->>'reference'),'');if char_length(reference)>240 then raise exception 'invalid_payload' using errcode='22023';end if;
  normalized:=jsonb_build_object('order_id',order_id,'amount_cents',amount,'method',method,'occurred_at',occurred,'reference',reference);
  replay:=private.start_sale_command(p_operation_id,'record_manual_payment',normalized);if replay is not null then return replay;end if;
  select * into order_record from public.sales_orders where id=order_id for update;
  if not found or occurred<order_record.occurred_at then raise exception 'invalid_payload' using errcode='22023';end if;
  if order_record.source_kind<>'manual_declaration' then raise exception 'external_order_managed_by_shopify' using errcode='22023';end if;
  if order_record.order_state='cancelled' then raise exception 'order_cancelled' using errcode='22023';end if;
  summary:=private.effective_order_payment_summary(order_id);due:=(summary->>'amount_due_cents')::bigint;
  if due=0 and exists(select 1 from public.order_payments p where p.order_id=payment_command.order_id) then raise exception 'payment_already_recorded' using errcode='22023';end if;
  if amount<>due then raise exception 'payment_amount_mismatch' using errcode='22023';end if;
  if not private.is_member() then raise exception 'membership_required' using errcode='42501';end if;
  insert into public.order_payments(operation_id,order_id,method,amount_cents,occurred_at,declared_reference,created_by)
    values(gen_random_uuid(),order_id,method,amount,occurred,reference,auth.uid()) returning id into payment_id;
  insert into public.commercial_facts(operation_id,order_id,payment_id,fact_kind,amount_cents,occurred_at,created_by)
    values(gen_random_uuid(),order_id,payment_id,'payment_reported',amount,occurred,auth.uid());
  result:=private.refresh_sale_order(order_id)||jsonb_build_object('operation_id',p_operation_id,'replayed',false);
  return private.finish_sale_command(p_operation_id,'record_manual_payment',normalized,result);
exception when invalid_text_representation then raise exception 'invalid_payload' using errcode='22023';
end $$;

-- Old commands can recover their exact receipt. A new legacy void cannot race
-- or bypass a current revision: both paths lock the immutable manual entry.
create or replace function private.void_finance_entry(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare normalized jsonb; replay jsonb; entry_id uuid; reason text; void_id uuid; result jsonb;
begin
  if auth.uid() is null or not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  perform private.finance_work_object(p_payload,array['schema_version','entry_id','reason'],array['schema_version','entry_id','reason']);
  if p_payload->'schema_version' is distinct from '1'::jsonb or jsonb_typeof(p_payload->'entry_id') is distinct from 'string' or jsonb_typeof(p_payload->'reason') is distinct from 'string' then raise exception 'invalid_finance_payload' using errcode='22023';end if;
  entry_id:=(p_payload->>'entry_id')::uuid;reason:=btrim(p_payload->>'reason');if char_length(reason) not between 3 and 500 then raise exception 'invalid_finance_payload' using errcode='22023';end if;
  normalized:=jsonb_build_object('schema_version',1,'entry_id',entry_id,'reason',reason);
  replay:=private.start_finance_work(p_operation_id,'void_finance_entry',normalized);if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;if replay is not null then return replay;end if;
  perform 1 from public.finance_entries where id=entry_id for update;
  if not found then raise exception 'finance_entry_not_found' using errcode='22023';end if;
  if exists(select 1 from public.finance_movement_revisions r where r.source_kind='manual' and r.source_id=entry_id) then raise exception 'use_finance_revisions' using errcode='22023';end if;
  if exists(select 1 from public.finance_entry_voids v where v.finance_entry_id=entry_id) then raise exception 'finance_entry_already_voided' using errcode='22023';end if;
  if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  insert into public.finance_entry_voids(finance_entry_id,reason,created_by) values(entry_id,reason,auth.uid()) returning id into void_id;
  result:=jsonb_build_object('operation_id',p_operation_id,'entry_id',entry_id,'void_id',void_id,'replayed',false);
  return private.finish_finance_work(p_operation_id,'void_finance_entry',normalized,result);
exception when invalid_text_representation then raise exception 'invalid_finance_payload' using errcode='22023';
end $$;

create function private.read_finance_revision_source(p_source_kind text,p_source_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  return private.finance_revision_original(p_source_kind,p_source_id);
end $$;
create function private.read_sales_effective_payments(p_order_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare parent uuid; summary jsonb; rows jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or not private.is_member() then raise exception 'membership_required' using errcode='42501';end if;
  if p_order_ids is null or cardinality(p_order_ids) not between 1 and 200 or array_position(p_order_ids,null) is not null
    or (select count(distinct id) from unnest(p_order_ids) id)<>cardinality(p_order_ids) then raise exception 'invalid_finance_revision' using errcode='22023';end if;
  for parent in select id from public.sales_orders where id=any(p_order_ids) order by id loop
    summary:=private.effective_order_payment_summary(parent);
    rows:=rows||jsonb_build_array(summary-array['incoming_cents','outgoing_cents','net_cents']);
  end loop;
  return rows;
end $$;

create function public.revise_finance_movement(p_operation_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.revise_finance_movement(p_operation_id,p_payload) $$;
create function public.read_finance_revision_source(p_source_kind text,p_source_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.read_finance_revision_source(p_source_kind,p_source_id) $$;
create function public.read_sales_effective_payments(p_order_ids uuid[]) returns jsonb
language sql security invoker set search_path='' as $$ select private.read_sales_effective_payments(p_order_ids) $$;

revoke all on function private.finance_revision_original(text,uuid),private.finance_revision_values(text,jsonb),private.effective_order_payment_summary(uuid),
  private.revise_finance_movement(uuid,jsonb),private.read_finance_revision_source(text,uuid),private.read_sales_effective_payments(uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.revise_finance_movement(uuid,jsonb),private.read_finance_revision_source(text,uuid),private.read_sales_effective_payments(uuid[]) to authenticated;
revoke all on function public.revise_finance_movement(uuid,jsonb),public.read_finance_revision_source(text,uuid),public.read_sales_effective_payments(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.revise_finance_movement(uuid,jsonb),public.read_finance_revision_source(text,uuid),public.read_sales_effective_payments(uuid[]) to authenticated;

create function private.effective_consignment_settlement_summary(p_sale uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare claim bigint; source record; revision public.finance_movement_revisions%rowtype; v jsonb; net numeric:=0; corrected boolean:=false;
begin
  select brand_claim_cents into claim from public.consignment_sales where id=p_sale;
  if not found then raise exception 'unknown_sale' using errcode='22023';end if;
  for source in select id from public.consignment_settlements where sale_id=p_sale loop
    select * into revision from public.finance_movement_revisions where source_kind='consignment_settlement' and source_id=source.id order by version desc limit 1;
    if found then corrected:=true;if revision.deleted then continue;end if;v:=revision.value_snapshot;
    else v:=private.finance_revision_original('consignment_settlement',source.id)->'values';end if;
    if (v->>'pending')::boolean or (v->>'date')::date>(statement_timestamp() at time zone 'Europe/Rome')::date then continue;end if;
    net:=net+(v->>'amount_cents')::numeric*case when v->>'direction'='expense' then -1 else 1 end;
  end loop;
  if greatest(abs(net),greatest(0,claim-net),greatest(0,net-claim))>9000000000000000 then raise exception 'effective_payment_limit' using errcode='22023';end if;
  return jsonb_build_object('sale_id',p_sale,'claim_cents',claim::text,'net_cents',net::text,'amount_due_cents',greatest(0,claim-net)::text,'refund_due_cents',greatest(0,net-claim)::text,'corrected',corrected);
end $$;

create or replace function private.record_consignment_settlement(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sale uuid;amount bigint;at_time timestamptz;method text;ref text;canonical jsonb;replay jsonb;claim bigint;sold_at timestamptz;summary jsonb;result jsonb;
begin
  if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  perform private.sale_object(p_payload,array['schema_version','sale_id','amount_cents','occurred_at','method','reference'],array['schema_version','sale_id','amount_cents','occurred_at','method','reference']);
  perform private.sale_integer(p_payload->'schema_version',1,1);sale:=private.consignment_text(p_payload->'sale_id',36,36)::uuid;amount:=private.sale_integer(p_payload->'amount_cents',1,9000000000000000);at_time:=private.consignment_date(p_payload->'occurred_at');method:=private.consignment_text(p_payload->'method',1,20);ref:=private.consignment_text(p_payload->'reference',1,240);
  if method not in('bank_transfer','cash','other')then raise exception 'invalid_payload' using errcode='22023';end if;
  canonical:=jsonb_build_object('schema_version',1,'sale_id',sale,'amount_cents',amount,'occurred_at',at_time,'method',method,'reference',ref);
  replay:=private.start_consignment(p_operation_id,'record_consignment_settlement',canonical);if replay is not null then return replay;end if;
  select brand_claim_cents,occurred_at into claim,sold_at from public.consignment_sales where id=sale for update;if not found then raise exception 'unknown_sale' using errcode='22023';end if;
  if at_time<sold_at then raise exception 'invalid_date' using errcode='22023';end if;
  summary:=private.effective_consignment_settlement_summary(sale);
  if amount>(summary->>'amount_due_cents')::bigint then raise exception 'settlement_exceeds_claim' using errcode='22023';end if;
  if exists(select 1 from public.consignment_settlements where sale_id=sale and reference=ref)then raise exception 'duplicate_reference' using errcode='23505';end if;
  if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  insert into public.consignment_settlements(id,sale_id,amount_cents,occurred_at,method,reference,created_by)values(p_operation_id,sale,amount,at_time,method,ref,auth.uid());
  result:=jsonb_build_object('operation_id',p_operation_id,'sale_id',sale,'settlement_id',p_operation_id,'replayed',false);return private.finish_consignment(p_operation_id,'record_consignment_settlement',canonical,result);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_payload' using errcode='22023';end $$;

create function private.read_effective_consignment_settlements(p_sale_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare parent uuid; rows jsonb:='[]'::jsonb;
begin
  if auth.uid() is null or not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  if p_sale_ids is null or cardinality(p_sale_ids) not between 1 and 200 or array_position(p_sale_ids,null) is not null
    or (select count(distinct id) from unnest(p_sale_ids) id)<>cardinality(p_sale_ids) then raise exception 'invalid_finance_revision' using errcode='22023';end if;
  for parent in select id from public.consignment_sales where id=any(p_sale_ids) order by id loop rows:=rows||jsonb_build_array(private.effective_consignment_settlement_summary(parent));end loop;
  return rows;
end $$;
create function public.read_effective_consignment_settlements(p_sale_ids uuid[]) returns jsonb
language sql security invoker set search_path='' as $$select private.read_effective_consignment_settlements(p_sale_ids)$$;
revoke all on function private.effective_consignment_settlement_summary(uuid),private.read_effective_consignment_settlements(uuid[]),public.read_effective_consignment_settlements(uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.read_effective_consignment_settlements(uuid[]),public.read_effective_consignment_settlements(uuid[]) to authenticated;
commit;
