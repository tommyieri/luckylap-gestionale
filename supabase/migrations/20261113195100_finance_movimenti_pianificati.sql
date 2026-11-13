-- Estende la fonte manuale immutabile e mantiene il contratto v1, incluse le ricevute.
begin;

alter table public.finance_entries
  add column target_account_label text check (char_length(target_account_label) between 1 and 120),
  add column pending boolean not null default false,
  add column evaluate_statistics boolean not null default true,
  add column evaluate_budgets boolean not null default true,
  add column payee text check (char_length(payee) between 1 and 240),
  add column tags text[] not null default '{}' check (cardinality(tags) <= 20),
  add column notes text check (char_length(notes) between 1 and 2000),
  add column location text check (char_length(location) between 1 and 240),
  add column entry_time time,
  add column series_id uuid,
  add constraint finance_transfer_accounts check (target_account_label is null or
    (account_label is not null and lower(account_label) <> lower(target_account_label) and entry_type='expense'));

create or replace function private.record_finance_entry(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare normalized jsonb; replay jsonb; day date; amount bigint; entry_type text; description text;
  account_label text; category text; entry_id uuid; result jsonb;
  base_payload jsonb := p_payload; is_plan boolean := coalesce(p_payload->'schema_version' = '2'::jsonb, false);
  extra_fields text[] := array['target_account_label','pending','evaluate_statistics','evaluate_budgets','payee','tags','notes','location','entry_time','repeat_interval','repeat_count'];
  target_label text; entry_tags text[] := '{}'; entry_clock time; interval_name text;
  occurrence_count integer := 1; occurrence_step interval; day_offset integer; occurrence_date date; occurrence_id uuid;
  optional_field text;
begin
  if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501'; end if;
  if is_plan then
    base_payload := (p_payload - extra_fields) || '{"schema_version":1}'::jsonb;
    foreach optional_field in array array['pending','evaluate_statistics','evaluate_budgets'] loop
      if p_payload ? optional_field and jsonb_typeof(p_payload->optional_field) <> 'boolean' then
        raise exception 'invalid_finance_payload' using errcode='22023';
      end if;
    end loop;
    foreach optional_field in array array['target_account_label','payee','notes','location','entry_time'] loop
      if p_payload ? optional_field and jsonb_typeof(p_payload->optional_field) not in ('string','null') then
        raise exception 'invalid_finance_payload' using errcode='22023';
      end if;
    end loop;
    if p_payload ? 'tags' then
      if jsonb_typeof(p_payload->'tags') <> 'array' or jsonb_array_length(p_payload->'tags') > 20
        or exists (select from jsonb_array_elements(p_payload->'tags') e(value)
          where jsonb_typeof(value) <> 'string' or char_length(btrim(value #>> '{}')) not between 1 and 60) then
        raise exception 'invalid_finance_payload' using errcode='22023';
      end if;
      entry_tags := array(select btrim(value) from jsonb_array_elements_text(p_payload->'tags') e(value));
    end if;
    if p_payload->>'entry_time' is not null then
      if (p_payload->>'entry_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'invalid_finance_payload' using errcode='22023';
      end if;
      entry_clock := (p_payload->>'entry_time')::time;
    end if;
    if p_payload ? 'repeat_interval' or p_payload ? 'repeat_count' then
      interval_name := p_payload->>'repeat_interval';
      occurrence_step := case interval_name when 'weekly' then interval '7 days'
        when 'monthly' then interval '1 month' when 'yearly' then interval '1 year' end;
      if occurrence_step is null or jsonb_typeof(p_payload->'repeat_count') is distinct from 'number'
        or (p_payload->>'repeat_count') !~ '^[0-9]{1,2}$' then
        raise exception 'invalid_finance_payload' using errcode='22023';
      end if;
      occurrence_count := (p_payload->>'repeat_count')::integer;
      if occurrence_count not between 2 and 60 then raise exception 'invalid_finance_payload' using errcode='22023'; end if;
    end if;
    if char_length(btrim(p_payload->>'payee')) not between 1 and 240
      or char_length(btrim(p_payload->>'location')) not between 1 and 240
      or char_length(btrim(p_payload->>'notes')) not between 1 and 2000 then
      raise exception 'invalid_finance_payload' using errcode='22023';
    end if;
  end if;
  perform private.finance_work_object(base_payload,array['schema_version','entry_date','entry_type','amount_cents','description','not_duplicate_confirmed'],
    array['schema_version','entry_date','entry_type','amount_cents','description','not_duplicate_confirmed','account_label','category']);
  if base_payload->'schema_version' is distinct from '1'::jsonb or p_payload->'not_duplicate_confirmed' is distinct from 'true'::jsonb
    or jsonb_typeof(p_payload->'entry_date') is distinct from 'string' or (p_payload->>'entry_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_payload->'entry_type') is distinct from 'string' or (p_payload->>'entry_type') not in ('income','expense')
    or jsonb_typeof(p_payload->'amount_cents') is distinct from 'number' or (p_payload->>'amount_cents')!~'^[1-9][0-9]{0,13}$'
    or jsonb_typeof(p_payload->'description') is distinct from 'string' then raise exception 'invalid_finance_payload' using errcode='22023'; end if;
  day:=(p_payload->>'entry_date')::date;
  if not is_plan and day>(now() at time zone 'Europe/Rome')::date then raise exception 'future_finance_entry' using errcode='22023'; end if;
  amount:=(p_payload->>'amount_cents')::bigint; entry_type:=p_payload->>'entry_type'; description:=btrim(p_payload->>'description');
  if amount not between 1 and 99999999999999 or char_length(description) not between 3 and 2000 then raise exception 'invalid_finance_payload' using errcode='22023'; end if;
  if (p_payload?'account_label' and jsonb_typeof(p_payload->'account_label') not in ('string','null'))
    or (p_payload?'category' and jsonb_typeof(p_payload->'category') not in ('string','null')) then raise exception 'invalid_finance_payload' using errcode='22023'; end if;
  account_label:=nullif(btrim(p_payload->>'account_label'),''); category:=nullif(btrim(p_payload->>'category'),'');
  if char_length(account_label)>120 or char_length(category)>120 then raise exception 'invalid_finance_payload' using errcode='22023'; end if;
  target_label := btrim(p_payload->>'target_account_label');
  if target_label is not null and (char_length(target_label) not between 1 and 120
    or account_label is null or lower(account_label) = lower(target_label) or entry_type <> 'expense') then
    raise exception 'invalid_finance_payload' using errcode='22023';
  end if;
  normalized:=jsonb_build_object('schema_version',1,'entry_date',day,'entry_type',entry_type,'amount_cents',amount,'description',description,'not_duplicate_confirmed',true,'account_label',account_label,'category',category);
  if is_plan then
    normalized := normalized || jsonb_build_object('schema_version',2,'target_account_label',target_label,
      'pending',coalesce((p_payload->>'pending')::boolean,false),
      'evaluate_statistics',coalesce((p_payload->>'evaluate_statistics')::boolean,true),
      'evaluate_budgets',coalesce((p_payload->>'evaluate_budgets')::boolean,true),
      'payee',btrim(p_payload->>'payee'),'tags',entry_tags,'notes',btrim(p_payload->>'notes'),
      'location',btrim(p_payload->>'location'),'entry_time',entry_clock,'repeat_interval',interval_name,'repeat_count',occurrence_count);
  end if;
  replay:=private.start_finance_work(p_operation_id,'record_finance_entry',normalized); if replay is not null then return replay; end if;
  if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501'; end if;
  for day_offset in 0..occurrence_count-1 loop
    occurrence_date := day;
    if day_offset > 0 then occurrence_date := (day + day_offset * occurrence_step)::date; end if;
    if occurrence_date > date '9999-12-31' then raise exception 'invalid_finance_payload' using errcode='22023'; end if;
    insert into public.finance_entries(entry_date,entry_type,amount_eur,description,account_label,category,source_kind,created_by,
      target_account_label,pending,evaluate_statistics,evaluate_budgets,payee,tags,notes,location,entry_time,series_id)
      values(occurrence_date,entry_type,amount::numeric/100,description,account_label,category,'manual_declaration',auth.uid(),
        target_label,coalesce((p_payload->>'pending')::boolean,false),coalesce((p_payload->>'evaluate_statistics')::boolean,true),
        coalesce((p_payload->>'evaluate_budgets')::boolean,true), btrim(p_payload->>'payee'),entry_tags,btrim(p_payload->>'notes'),
        btrim(p_payload->>'location'),entry_clock,case when occurrence_count > 1 then p_operation_id end)
      returning id into occurrence_id;
    if day_offset = 0 then entry_id := occurrence_id; end if;
  end loop;
  result:=jsonb_build_object('operation_id',p_operation_id,'entry_id',entry_id,'replayed',false);
  return private.finish_finance_work(p_operation_id,'record_finance_entry',normalized,result);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'invalid_finance_payload' using errcode='22023';
end
$$;

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
  else raise exception 'invalid_finance_source' using errcode='22023';
  end if;
  if v is null then raise exception 'finance_source_not_found' using errcode='22023';end if;
  return jsonb_build_object('source_kind',p_kind,'source_id',p_id,'values',v,'deleted',gone,'order_id',parent);
end $$;

create or replace function private.finance_revision_values(p_kind text,p_values jsonb) returns jsonb
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
    or (target is not null and (p_kind not in ('budgetflow','manual') or account is null or account=target or (p_kind='manual' and p_values->>'direction'<>'expense'))) then raise exception 'invalid_finance_revision' using errcode='22023';end if;
  return jsonb_build_object('date',day,'direction',p_values->>'direction','amount_cents',amount,'account',account,'target_account',target,'category',category,'description',description,'pending',p_values->'pending');
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'invalid_finance_revision' using errcode='22023';
end $$;

commit;
