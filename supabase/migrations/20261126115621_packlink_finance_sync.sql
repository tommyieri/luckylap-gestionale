-- Packlink: fonte finanziaria append-only e sincronizzazione autonoma con lease.
-- Nessuna configurazione, credenziale, schedulazione o importazione viene attivata.
-- Migrazione forward-only; disabilitare la configurazione conserva fonti e revisioni.
begin;

create table private.packlink_sync_configuration (
  singleton boolean primary key default true check(singleton),
  connection_id uuid not null unique default gen_random_uuid(),
  expected_client_id text not null check(expected_client_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  shop_domain text not null check(shop_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$'),
  cutover_at timestamptz not null check(isfinite(cutover_at)),
  enabled boolean not null default false,
  configured_at timestamptz not null default clock_timestamp()
);
create table private.packlink_sync_state (
  connection_id uuid primary key references private.packlink_sync_configuration(connection_id),
  worker_id uuid,lease_token uuid,lease_expires_at timestamptz,configuration_digest text,
  next_attempt_at timestamptz not null default '-infinity',
  last_attempt_at timestamptz,last_success_at timestamptz,
  outcome text check(outcome in('running','applied','retry','review')),
  reason text check(reason ~ '^[a-z][a-z0-9_]{0,79}$'),
  inserted_count integer not null default 0 check(inserted_count>=0),
  replayed_count integer not null default 0 check(replayed_count>=0),
  ignored_count integer not null default 0 check(ignored_count>=0),
  check((lease_token is null)=(lease_expires_at is null)),
  check((lease_token is null)=(worker_id is null)),
  check((lease_token is null)=(configuration_digest is null))
);
create table public.packlink_transactions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references private.packlink_sync_configuration(connection_id),
  provider_transaction_id text not null check(provider_transaction_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'),
  shop_domain text not null check(shop_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$'),
  provider_type text not null check(provider_type in('LABELS_ORDER','REFUND')),
  kind text not null check(kind in('shipping_charge','shipping_refund')),
  amount_cents bigint not null check(amount_cents between 1 and 9000000000000000),
  currency text not null check(currency='EUR'),
  occurred_at timestamptz not null check(isfinite(occurred_at)),
  shipment_references text[] not null check(cardinality(shipment_references)<=20 and array_position(shipment_references,null) is null),
  shopify_order_gid text check(shopify_order_gid is null or case when shopify_order_gid ~ '^gid://shopify/Order/[1-9][0-9]{0,19}$' then split_part(shopify_order_gid,'/',5)::numeric<=18446744073709551615 else false end),
  source_digest text not null check(source_digest ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null default clock_timestamp(),
  unique(connection_id,provider_transaction_id),
  check((provider_type='LABELS_ORDER' and kind='shipping_charge') or(provider_type='REFUND' and kind='shipping_refund'))
);
create index packlink_transactions_occurred on public.packlink_transactions(occurred_at desc,id);
create trigger packlink_transactions_append_only before update or delete on public.packlink_transactions
  for each row execute function private.reject_ledger_mutation();
alter table public.packlink_transactions enable row level security;
revoke all on public.packlink_transactions from public,anon,authenticated,service_role;
grant select on public.packlink_transactions to authenticated;
create policy finance_read on public.packlink_transactions for select to authenticated using((select private.can_finance()));
alter table private.packlink_sync_configuration enable row level security;
alter table private.packlink_sync_state enable row level security;
revoke all on private.packlink_sync_configuration,private.packlink_sync_state from public,anon,authenticated,service_role;

create function private.packlink_service_required() returns void
language plpgsql security invoker set search_path='' as $$begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'packlink_worker_access_required' using errcode='42501';
  end if;
end$$;
create function private.packlink_configuration_digest(p_value private.packlink_sync_configuration) returns text
language sql immutable security invoker set search_path='' as $$
  select encode(sha256(convert_to(jsonb_build_object('connection_id',p_value.connection_id,
    'client_id',p_value.expected_client_id,'shop_domain',p_value.shop_domain,
    'cutover_at',to_char(p_value.cutover_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8')),'hex')
$$;

create function private.claim_packlink_sync(p_worker_id uuid,p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.packlink_sync_configuration%rowtype; state private.packlink_sync_state%rowtype; token uuid; expiry timestamptz;
begin
  perform private.packlink_service_required();
  if p_worker_id is null or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'invalid_packlink_claim' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packlink.sync',0));
  select * into cfg from private.packlink_sync_configuration where singleton for share;
  if not found or not cfg.enabled then return null;end if;
  insert into private.packlink_sync_state(connection_id) values(cfg.connection_id) on conflict do nothing;
  select * into state from private.packlink_sync_state where connection_id=cfg.connection_id for update;
  if state.lease_expires_at>clock_timestamp() or state.next_attempt_at>clock_timestamp() then return null;end if;
  token:=gen_random_uuid();expiry:=clock_timestamp()+make_interval(secs=>p_lease_seconds);
  update private.packlink_sync_state set worker_id=p_worker_id,lease_token=token,lease_expires_at=expiry,
    configuration_digest=private.packlink_configuration_digest(cfg),last_attempt_at=clock_timestamp(),outcome='running',reason=null,
    inserted_count=0,replayed_count=0,ignored_count=0 where connection_id=cfg.connection_id;
  return jsonb_build_object('connection_id',cfg.connection_id,'expected_client_id',cfg.expected_client_id,
    'shop_domain',cfg.shop_domain,'cutover_at',cfg.cutover_at,'lease_token',token,'lease_expires_at',expiry);
end$$;

-- Validation is completed for the whole batch before any source row is inserted.
-- Only allowlisted financial identifiers are accepted; arbitrary provider payloads/PII are not stored.
create function private.normalize_packlink_transactions(p_payload jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; reference jsonb; refs text[]; normalized jsonb:='[]'; financial jsonb; stamp timestamptz; amount bigint; gid text;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or not(p_payload?&array['schema_version','client_id','transactions'])
    or p_payload-array['schema_version','client_id','transactions']<>'{}'::jsonb
    or p_payload->'schema_version' is distinct from '1'::jsonb
    or jsonb_typeof(p_payload->'client_id') is distinct from 'string'
    or (p_payload->>'client_id') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    or jsonb_typeof(p_payload->'transactions') is distinct from 'array' then
    raise exception 'invalid_packlink_payload' using errcode='22023';end if;
  if jsonb_array_length(p_payload->'transactions')>1000 then raise exception 'invalid_packlink_payload' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(p_payload->'transactions') loop
    if jsonb_typeof(item) is distinct from 'object'
      or not(item?&array['provider_transaction_id','provider_type','amount_cents','currency','occurred_at','shipment_references','shopify_order_gid'])
      or item-array['provider_transaction_id','provider_type','amount_cents','currency','occurred_at','shipment_references','shopify_order_gid']<>'{}'::jsonb
      or jsonb_typeof(item->'provider_transaction_id') is distinct from 'string'
      or (item->>'provider_transaction_id') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'
      or jsonb_typeof(item->'provider_type') is distinct from 'string' or item->>'provider_type' not in('LABELS_ORDER','REFUND')
      or jsonb_typeof(item->'amount_cents') is distinct from 'number' or (item->>'amount_cents') !~ '^[1-9][0-9]{0,15}$'
      or jsonb_typeof(item->'currency') is distinct from 'string' or item->>'currency'<>'EUR'
      or jsonb_typeof(item->'occurred_at') is distinct from 'string'
      or (item->>'occurred_at') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6}0{0,3})?Z$'
      or jsonb_typeof(item->'shipment_references') is distinct from 'array'
      or jsonb_typeof(item->'shopify_order_gid') not in('null','string') then
      raise exception 'invalid_packlink_payload' using errcode='22023';end if;
    amount:=(item->>'amount_cents')::bigint;
    if amount>9000000000000000 or jsonb_array_length(item->'shipment_references')>20 then raise exception 'invalid_packlink_payload' using errcode='22023';end if;
    stamp:=(item->>'occurred_at')::timestamptz;
    -- Padding beyond microseconds is harmless; true nanoseconds are rejected instead of rounded across the cutover.
    if not isfinite(stamp) then raise exception 'invalid_packlink_payload' using errcode='22023';end if;
    gid:=item->>'shopify_order_gid';
    if gid is not null then
      if gid !~ '^gid://shopify/Order/[1-9][0-9]{0,19}$' then raise exception 'invalid_packlink_payload' using errcode='22023';end if;
      if split_part(gid,'/',5)::numeric>18446744073709551615 then raise exception 'invalid_packlink_payload' using errcode='22023';end if;
    end if;
    refs:=array[]::text[];
    for reference in select value from jsonb_array_elements(item->'shipment_references') loop
      if jsonb_typeof(reference) is distinct from 'string' or (reference#>>'{}') !~ '^[A-Za-z0-9_-]{1,100}$' then
        raise exception 'invalid_packlink_payload' using errcode='22023';end if;
      refs:=array_append(refs,reference#>>'{}');
    end loop;
    if cardinality(refs)<>(select count(distinct value) from unnest(refs) value) then raise exception 'invalid_packlink_payload' using errcode='22023';end if;
    select coalesce(array_agg(value order by value),array[]::text[]) into refs from unnest(refs) value;
    financial:=jsonb_build_object('provider_transaction_id',item->>'provider_transaction_id','provider_type',item->>'provider_type',
      'amount_cents',amount,'currency','EUR','occurred_at',to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'shipment_references',to_jsonb(refs));
    -- Optional order enrichment is not financial identity and cannot change an existing original.
    normalized:=normalized||jsonb_build_array(financial||jsonb_build_object('shopify_order_gid',gid,
      'source_digest',encode(sha256(convert_to(financial::text,'UTF8')),'hex')));
  end loop;
  return normalized;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'invalid_packlink_payload' using errcode='22023';
end$$;

create function private.apply_packlink_transactions(p_connection_id uuid,p_lease_token uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<packlink_apply>>
declare cfg private.packlink_sync_configuration%rowtype; state private.packlink_sync_state%rowtype;
  normalized jsonb; item jsonb; reason text; inserted_count integer:=0; replayed_count integer:=0; ignored_count integer:=0;
begin
  perform private.packlink_service_required();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packlink.sync',0));
  select * into cfg from private.packlink_sync_configuration where singleton for share;
  select * into state from private.packlink_sync_state where connection_id=p_connection_id for update;
  if p_connection_id is null or p_lease_token is null or cfg.connection_id is distinct from p_connection_id or not coalesce(cfg.enabled,false)
    or state.lease_token is distinct from p_lease_token or state.lease_expires_at<=clock_timestamp()
    or state.configuration_digest is distinct from private.packlink_configuration_digest(cfg) then
    raise exception 'packlink_lease_required' using errcode='22023';end if;
  begin
    normalized:=private.normalize_packlink_transactions(p_payload);
  exception when sqlstate '22023' then reason:='invalid_packlink_payload';
  end;
  if reason is null and p_payload->>'client_id'<>cfg.expected_client_id then reason:='packlink_client_mismatch';end if;
  if reason is null then
    if exists(select 1 from jsonb_array_elements(normalized) n
      group by n->>'provider_transaction_id' having count(distinct n->>'source_digest')>1)
      or exists(select 1 from jsonb_array_elements(normalized) n join public.packlink_transactions t
        on t.connection_id=p_connection_id and t.provider_transaction_id=n->>'provider_transaction_id'
        where t.source_digest<>n->>'source_digest') then
      reason:='packlink_transaction_conflict';
    end if;
  end if;
  if reason is not null then
    update private.packlink_sync_state set outcome='review',reason=packlink_apply.reason,
      worker_id=null,lease_token=null,lease_expires_at=null,configuration_digest=null,next_attempt_at=clock_timestamp()+interval '60 seconds',
      inserted_count=0,replayed_count=0,ignored_count=0 where connection_id=p_connection_id;
    return jsonb_build_object('status','review','inserted',0,'replayed',0,'ignored',0,'reason',reason);
  end if;
  if state.lease_expires_at<=clock_timestamp() then raise exception 'packlink_lease_required' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(normalized) loop
    if (item->>'occurred_at')::timestamptz<cfg.cutover_at then ignored_count:=ignored_count+1;continue;end if;
    if exists(select 1 from public.packlink_transactions where connection_id=p_connection_id and provider_transaction_id=item->>'provider_transaction_id') then
      replayed_count:=replayed_count+1;
    else
      insert into public.packlink_transactions(connection_id,provider_transaction_id,shop_domain,provider_type,kind,amount_cents,currency,occurred_at,shipment_references,shopify_order_gid,source_digest)
        values(p_connection_id,item->>'provider_transaction_id',cfg.shop_domain,item->>'provider_type',case when item->>'provider_type'='LABELS_ORDER' then 'shipping_charge' else 'shipping_refund' end,
          (item->>'amount_cents')::bigint,'EUR',(item->>'occurred_at')::timestamptz,
          array(select jsonb_array_elements_text(item->'shipment_references')),item->>'shopify_order_gid',item->>'source_digest');
      inserted_count:=inserted_count+1;
    end if;
  end loop;
  if state.lease_expires_at<=clock_timestamp() then raise exception 'packlink_lease_required' using errcode='22023';end if;
  update private.packlink_sync_state set outcome='applied',reason=null,last_success_at=clock_timestamp(),
    worker_id=null,lease_token=null,lease_expires_at=null,configuration_digest=null,next_attempt_at=clock_timestamp(),
    inserted_count=packlink_apply.inserted_count,replayed_count=packlink_apply.replayed_count,
    ignored_count=packlink_apply.ignored_count where connection_id=p_connection_id;
  return jsonb_build_object('status','applied','inserted',inserted_count,'replayed',replayed_count,'ignored',ignored_count,'reason',null);
end$$;

create function private.finish_packlink_sync(p_connection_id uuid,p_lease_token uuid,p_outcome text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state private.packlink_sync_state%rowtype;
begin
  perform private.packlink_service_required();
  if p_outcome is null or p_outcome not in('retry','review') or p_reason is null or p_reason !~ '^[a-z][a-z0-9_]{0,79}$' then
    raise exception 'invalid_packlink_outcome' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packlink.sync',0));
  select * into state from private.packlink_sync_state where connection_id=p_connection_id for update;
  if p_connection_id is null or p_lease_token is null or state.lease_token is distinct from p_lease_token or state.lease_expires_at<=clock_timestamp() then
    raise exception 'packlink_lease_required' using errcode='22023';end if;
  update private.packlink_sync_state set outcome=p_outcome,reason=p_reason,
    worker_id=null,lease_token=null,lease_expires_at=null,configuration_digest=null,next_attempt_at=clock_timestamp()+interval '60 seconds',
    inserted_count=0,replayed_count=0,ignored_count=0 where connection_id=p_connection_id;
  return jsonb_build_object('status',p_outcome,'inserted',0,'replayed',0,'ignored',0,'reason',p_reason);
end$$;

create function private.get_packlink_sync_status() returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.packlink_sync_configuration%rowtype; state private.packlink_sync_state%rowtype; expired boolean;
begin
  if auth.uid() is null or not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  select * into cfg from private.packlink_sync_configuration where singleton;
  if not found then return jsonb_build_object('configured',false,'enabled',false,'last_attempt_at',null,'last_success_at',null,'outcome',null,'reason',null,
    'counts',jsonb_build_object('inserted',0,'replayed',0,'ignored',0));end if;
  select * into state from private.packlink_sync_state where connection_id=cfg.connection_id;
  expired:=state.lease_token is not null and state.lease_expires_at<=clock_timestamp();
  return jsonb_build_object('configured',true,'enabled',cfg.enabled,'last_attempt_at',state.last_attempt_at,'last_success_at',state.last_success_at,
    'outcome',case when expired then 'retry' else state.outcome end,'reason',case when expired then 'lease_expired' else state.reason end,
    'counts',jsonb_build_object('inserted',coalesce(state.inserted_count,0),'replayed',coalesce(state.replayed_count,0),'ignored',coalesce(state.ignored_count,0)));
end$$;

create function public.claim_packlink_sync(p_worker_id uuid,p_lease_seconds integer default 120) returns jsonb
language sql security invoker set search_path='' as $$select private.claim_packlink_sync(p_worker_id,p_lease_seconds)$$;
create function public.apply_packlink_transactions(p_connection_id uuid,p_lease_token uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.apply_packlink_transactions(p_connection_id,p_lease_token,p_payload)$$;
create function public.finish_packlink_sync(p_connection_id uuid,p_lease_token uuid,p_outcome text,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$select private.finish_packlink_sync(p_connection_id,p_lease_token,p_outcome,p_reason)$$;
create function public.get_packlink_sync_status() returns jsonb
language sql security invoker set search_path='' as $$select private.get_packlink_sync_status()$$;
revoke all on function private.packlink_service_required(),private.packlink_configuration_digest(private.packlink_sync_configuration),private.normalize_packlink_transactions(jsonb),
  private.claim_packlink_sync(uuid,integer),public.claim_packlink_sync(uuid,integer),
  private.apply_packlink_transactions(uuid,uuid,jsonb),public.apply_packlink_transactions(uuid,uuid,jsonb),
  private.finish_packlink_sync(uuid,uuid,text,text),public.finish_packlink_sync(uuid,uuid,text,text),
  private.get_packlink_sync_status(),public.get_packlink_sync_status() from public,anon,authenticated,service_role;
grant execute on function private.claim_packlink_sync(uuid,integer),public.claim_packlink_sync(uuid,integer),
  private.apply_packlink_transactions(uuid,uuid,jsonb),public.apply_packlink_transactions(uuid,uuid,jsonb),
  private.finish_packlink_sync(uuid,uuid,text,text),public.finish_packlink_sync(uuid,uuid,text,text) to service_role;
grant execute on function private.get_packlink_sync_status(),public.get_packlink_sync_status() to authenticated;

-- Le revisioni applicative restano append-only, con gli stessi controlli CAS/permessi.
alter table public.finance_movement_revisions drop constraint finance_movement_revisions_source_kind_check;
alter table public.finance_movement_revisions add constraint finance_movement_revisions_source_kind_check
  check(source_kind in('budgetflow','manual','payment','refund','consignment_settlement','packlink'));
alter table public.finance_movement_attachments drop constraint finance_movement_attachments_source_kind_check;
alter table public.finance_movement_attachments add constraint finance_movement_attachments_source_kind_check
  check(source_kind in('budgetflow','manual','payment','refund','consignment_settlement','shop_payment','packlink'));

create or replace function private.finance_revision_original(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v jsonb; gone boolean:=false; parent uuid;
begin
  if p_kind='budgetflow' then
    select jsonb_build_object('date',transaction_date,'direction',case when amount_cents<0 then 'expense' else 'income' end,'amount_cents',abs(amount_cents),
      'account',account_label,'target_account',target_account_label,'category',nullif(raw_record->>'Category',''),
      'description',coalesce(nullif(raw_record->>'Payee',''),nullif(raw_record->>'Notes',''),'Movimento BudgetFlow'),
      'pending',pending or exists(select 1 from public.finance_consignment_archive
        where payment_transaction_id=p_id and payment_expected_at_capture))
      into v from public.finance_import_transactions where id=p_id;
  elsif p_kind='manual' then
    select jsonb_build_object('date',entry_date,'direction',entry_type,'amount_cents',amount_cents,'account',account_label,'target_account',target_account_label,
      'category',category,'description',coalesce(description,''),'pending',pending),exists(select 1 from public.finance_entry_voids where finance_entry_id=p_id)
      into v,gone from public.finance_entries where id=p_id;
    select order_id into parent from public.manual_sale_returns where finance_entry_id=p_id;
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
  elsif p_kind='packlink' then
    select jsonb_build_object('date',(occurred_at at time zone 'Europe/Rome')::date,
      'direction',case when kind='shipping_charge' then 'expense' else 'income' end,
      'amount_cents',amount_cents,'account',null,'target_account',null,'category','Spedizioni',
      'description',case when kind='shipping_charge' then 'Spedizione Packlink' else 'Rimborso spedizione Packlink' end,
      'pending',false) into v from public.packlink_transactions where id=p_id;
  else raise exception 'invalid_finance_source' using errcode='22023';
  end if;
  if v is null then raise exception 'finance_source_not_found' using errcode='22023';end if;
  return jsonb_build_object('source_kind',p_kind,'source_id',p_id,'values',v,'deleted',gone,'order_id',parent);
end $$;

create or replace function private.revise_finance_movement(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<revision_command>>
declare kind text; source_id uuid; expected integer; action text; reason text; target integer; normalized jsonb; v jsonb; original jsonb; parent uuid; sale_parent uuid;
  latest public.finance_movement_revisions%rowtype; receipt private.finance_revision_receipts%rowtype; current_version integer; is_deleted boolean; new_id uuid; result jsonb; digest text;
begin
  if auth.uid() is null or not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' or not(p_payload?&array['schema_version','source_kind','source_id','expected_version','action','reason'])
    or p_payload->'schema_version' is distinct from '1'::jsonb or jsonb_typeof(p_payload->'source_kind') is distinct from 'string'
    or p_payload->>'source_kind' not in('budgetflow','manual','payment','refund','consignment_settlement','packlink') or jsonb_typeof(p_payload->'source_id') is distinct from 'string'
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
  -- A receipt written before this rule still replays its recorded outcome.
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
    -- Sale payments and Shopify refunds belong to the sale: correct them here,
    -- undo the sale in Vendite. Restore stays available, so nothing gets stuck.
    if kind in('payment','refund') then raise exception 'finance_movement_delete_not_allowed' using errcode='22023';end if;
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

commit;
