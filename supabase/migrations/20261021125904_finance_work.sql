-- Manual declarations only; no source imports, bank balances or tax posting.
begin;
alter table public.finance_entries
  add column amount_cents bigint generated always as ((amount_eur * 100)::bigint) stored,
  add column account_label text check (char_length(account_label) between 1 and 120),
  add column category text check (char_length(category) between 1 and 120),
  add column source_kind text not null default 'legacy_unclassified' check (source_kind in ('legacy_unclassified','manual_declaration')),
  add column review_status text not null default 'unclassified' check (review_status='unclassified');
alter table public.finance_entries alter column source_kind set default 'manual_declaration';
create index finance_entries_creator on public.finance_entries(created_by);
create index finance_entries_date on public.finance_entries(entry_date desc,id);

-- Explicitly revoke old column grants as well as table DML privileges.
revoke insert(entry_date,entry_type,amount_eur,description,finance_document_path),
  update(entry_date,entry_type,amount_eur,description,finance_document_path), delete on public.finance_entries from public,anon,authenticated;
revoke insert,update,delete on public.finance_entries from public,anon,authenticated;
drop policy finance_insert on public.finance_entries;
drop policy finance_update on public.finance_entries;
drop policy finance_delete on public.finance_entries;
create trigger finance_entries_append_only before update or delete on public.finance_entries
  for each row execute function private.reject_ledger_mutation();

create table public.finance_entry_voids (
  id uuid primary key default gen_random_uuid(),
  finance_entry_id uuid not null unique references public.finance_entries(id),
  reason text not null check (char_length(reason) between 3 and 500),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now()
);
create index finance_entry_voids_creator on public.finance_entry_voids(created_by);
alter table public.finance_entry_voids enable row level security;
revoke all on public.finance_entry_voids from public,anon,authenticated;
grant select on public.finance_entry_voids to authenticated;
create policy finance_read on public.finance_entry_voids for select to authenticated using ((select private.can_finance()));
create trigger finance_void_append_only before update or delete on public.finance_entry_voids
  for each row execute function private.reject_ledger_mutation();
create trigger audit_change after insert or update or delete on public.finance_entry_voids
  for each row execute function private.audit_change();

create table private.finance_work_receipts (
  operation_id uuid primary key,
  command_kind text not null check (command_kind in ('record_finance_entry','void_finance_entry')),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references public.profiles(user_id),
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.finance_work_receipts enable row level security;
revoke all on private.finance_work_receipts from public,anon,authenticated;
create trigger finance_work_receipts_append_only before update or delete on private.finance_work_receipts
  for each row execute function private.reject_ledger_mutation();

create function private.finance_work_object(p_value jsonb,p_required text[],p_allowed text[]) returns void
language plpgsql immutable security invoker set search_path='' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'object' or not (p_value ?& p_required) or (p_value-p_allowed)<>'{}'::jsonb then
    raise exception 'invalid_finance_payload' using errcode='22023';
  end if;
end
$$;
create function private.start_finance_work(p_operation_id uuid,p_kind text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing private.finance_work_receipts%rowtype; digest text;
begin
  if auth.uid() is null or not private.can_finance() then raise exception 'finance_access_required' using errcode='42501'; end if;
  if p_operation_id is null then raise exception 'invalid_finance_payload' using errcode='22023'; end if;
  digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.finance.work.'||p_operation_id::text,0));
  select * into existing from private.finance_work_receipts where operation_id=p_operation_id;
  if found then
    if existing.command_kind<>p_kind or existing.actor_id<>auth.uid() or existing.payload_sha256<>digest then
      raise exception 'idempotency_conflict' using errcode='22023';
    end if;
    return existing.result||'{"replayed":true}'::jsonb;
  end if;
  return null;
end
$$;
create function private.finish_finance_work(p_operation_id uuid,p_kind text,p_payload jsonb,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  insert into private.finance_work_receipts(operation_id,command_kind,payload_sha256,actor_id,result)
    values(p_operation_id,p_kind,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),auth.uid(),p_result);
  return p_result;
end
$$;

create function private.record_finance_entry(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare normalized jsonb; replay jsonb; day date; amount bigint; entry_type text; description text;
  account_label text; category text; entry_id uuid; result jsonb;
begin
  if auth.uid() is null or not private.can_finance() then raise exception 'finance_access_required' using errcode='42501'; end if;
  perform private.finance_work_object(p_payload,array['schema_version','entry_date','entry_type','amount_cents','description','not_duplicate_confirmed'],
    array['schema_version','entry_date','entry_type','amount_cents','description','not_duplicate_confirmed','account_label','category']);
  if p_payload->'schema_version' is distinct from '1'::jsonb or p_payload->'not_duplicate_confirmed' is distinct from 'true'::jsonb
    or jsonb_typeof(p_payload->'entry_date') is distinct from 'string' or (p_payload->>'entry_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_payload->'entry_type') is distinct from 'string' or (p_payload->>'entry_type') not in ('income','expense')
    or jsonb_typeof(p_payload->'amount_cents') is distinct from 'number' or (p_payload->>'amount_cents')!~'^[1-9][0-9]{0,13}$'
    or jsonb_typeof(p_payload->'description') is distinct from 'string' then raise exception 'invalid_finance_payload' using errcode='22023'; end if;
  day:=(p_payload->>'entry_date')::date;
  if day>(now() at time zone 'Europe/Rome')::date then raise exception 'future_finance_entry' using errcode='22023'; end if;
  amount:=(p_payload->>'amount_cents')::bigint; entry_type:=p_payload->>'entry_type'; description:=btrim(p_payload->>'description');
  if amount not between 1 and 99999999999999 or char_length(description) not between 3 and 2000 then raise exception 'invalid_finance_payload' using errcode='22023'; end if;
  if (p_payload?'account_label' and jsonb_typeof(p_payload->'account_label') not in ('string','null'))
    or (p_payload?'category' and jsonb_typeof(p_payload->'category') not in ('string','null')) then raise exception 'invalid_finance_payload' using errcode='22023'; end if;
  account_label:=nullif(btrim(p_payload->>'account_label'),''); category:=nullif(btrim(p_payload->>'category'),'');
  if char_length(account_label)>120 or char_length(category)>120 then raise exception 'invalid_finance_payload' using errcode='22023'; end if;
  normalized:=jsonb_build_object('schema_version',1,'entry_date',day,'entry_type',entry_type,'amount_cents',amount,'description',description,'not_duplicate_confirmed',true,'account_label',account_label,'category',category);
  replay:=private.start_finance_work(p_operation_id,'record_finance_entry',normalized); if replay is not null then return replay; end if;
  insert into public.finance_entries(entry_date,entry_type,amount_eur,description,account_label,category,source_kind,created_by)
    values(day,entry_type,amount::numeric/100,description,account_label,category,'manual_declaration',auth.uid()) returning id into entry_id;
  result:=jsonb_build_object('operation_id',p_operation_id,'entry_id',entry_id,'replayed',false);
  return private.finish_finance_work(p_operation_id,'record_finance_entry',normalized,result);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'invalid_finance_payload' using errcode='22023';
end
$$;

create function private.void_finance_entry(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare normalized jsonb; replay jsonb; entry_id uuid; reason text; void_id uuid; result jsonb;
begin
  if auth.uid() is null or not private.can_finance() then raise exception 'finance_access_required' using errcode='42501'; end if;
  perform private.finance_work_object(p_payload,array['schema_version','entry_id','reason'],array['schema_version','entry_id','reason']);
  if p_payload->'schema_version' is distinct from '1'::jsonb or jsonb_typeof(p_payload->'entry_id') is distinct from 'string'
    or jsonb_typeof(p_payload->'reason') is distinct from 'string' then raise exception 'invalid_finance_payload' using errcode='22023'; end if;
  entry_id:=(p_payload->>'entry_id')::uuid; reason:=btrim(p_payload->>'reason');
  if char_length(reason) not between 3 and 500 then raise exception 'invalid_finance_payload' using errcode='22023'; end if;
  normalized:=jsonb_build_object('schema_version',1,'entry_id',entry_id,'reason',reason);
  replay:=private.start_finance_work(p_operation_id,'void_finance_entry',normalized); if replay is not null then return replay; end if;
  perform 1 from public.finance_entries where id=entry_id for update;
  if not found then raise exception 'finance_entry_not_found' using errcode='22023'; end if;
  if exists(select 1 from public.finance_entry_voids v where v.finance_entry_id=entry_id) then raise exception 'finance_entry_already_voided' using errcode='22023'; end if;
  insert into public.finance_entry_voids(finance_entry_id,reason,created_by) values(entry_id,reason,auth.uid()) returning id into void_id;
  result:=jsonb_build_object('operation_id',p_operation_id,'entry_id',entry_id,'void_id',void_id,'replayed',false);
  return private.finish_finance_work(p_operation_id,'void_finance_entry',normalized,result);
exception when invalid_text_representation then raise exception 'invalid_finance_payload' using errcode='22023';
end
$$;
create function public.record_finance_entry(p_operation_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.record_finance_entry(p_operation_id,p_payload) $$;
create function public.void_finance_entry(p_operation_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.void_finance_entry(p_operation_id,p_payload) $$;

revoke all on function private.finance_work_object(jsonb,text[],text[]),private.start_finance_work(uuid,text,jsonb),private.finish_finance_work(uuid,text,jsonb,jsonb),
  private.record_finance_entry(uuid,jsonb),private.void_finance_entry(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.record_finance_entry(uuid,jsonb),private.void_finance_entry(uuid,jsonb) to authenticated;
revoke all on function public.record_finance_entry(uuid,jsonb),public.void_finance_entry(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_finance_entry(uuid,jsonb),public.void_finance_entry(uuid,jsonb) to authenticated;
commit;
