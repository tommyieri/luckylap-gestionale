-- Offline-reviewed source imports. No finance data, users or credentials are seeded.
begin;

create table public.finance_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check (source_system = 'budgetflow'),
  source_file_name text not null check (char_length(source_file_name) between 1 and 240),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_sha256 text not null check (normalized_sha256 ~ '^[0-9a-f]{64}$'),
  fingerprint_version text not null check (fingerprint_version = 'budgetflow-v1-sorted-raw-core'),
  extracted_at timestamptz not null,
  reference_date date not null,
  source_row_count integer not null check (source_row_count between 1 and 100000),
  source_record_ids_available boolean not null check (not source_record_ids_available),
  review_status text not null default 'unreviewed' check (review_status = 'unreviewed'),
  imported_at timestamptz not null default now(),
  unique (source_system, source_sha256)
);

-- Exact source amounts retain their sign. These are unreviewed source records,
-- not invoices, revenue, stock movements or posted accounting entries.
create table public.finance_import_transactions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.finance_import_batches(id),
  source_row integer not null check (source_row between 2 and 100001),
  raw_record jsonb not null check (jsonb_typeof(raw_record) = 'object')
    check (raw_record ?& array['Date','Amount','Source Currency','Target Currency','Exchange Rate','Budget Book','Source Account','Target Account','Folder','Category','Payee','Tags','Notes','Pending']),
  raw_fingerprint_sha256 text not null check (raw_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  economic_fingerprint_sha256 text not null check (economic_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  source_timestamp text not null,
  occurred_at timestamptz not null,
  transaction_date date not null,
  amount_text text not null check (amount_text ~ '^[+-]?[0-9]+([.][0-9]{1,2})?$'),
  amount_cents bigint not null check (amount_cents between -9000000000000000 and 9000000000000000),
  currency text not null check (currency = 'EUR'),
  target_currency text not null check (target_currency = 'EUR'),
  exchange_rate_text text not null check (exchange_rate_text ~ '^1([.]0+)?$'),
  account_label text not null check (char_length(account_label) between 1 and 240),
  target_account_label text check (target_account_label is null or char_length(target_account_label) between 1 and 240),
  pending boolean not null,
  future_as_of_reference_date boolean not null,
  review_status text not null default 'unreviewed' check (review_status = 'unreviewed'),
  created_at timestamptz not null default now(),
  unique (batch_id, source_row),
  check (amount_text::numeric * 100 = amount_cents),
  check (amount_text is not distinct from raw_record->>'Amount'),
  check (source_timestamp is not distinct from raw_record->>'Date'),
  check (transaction_date = left(source_timestamp, 10)::date),
  check (occurred_at = source_timestamp::timestamptz),
  check (account_label is not distinct from raw_record->>'Source Account'),
  check (target_account_label is not distinct from nullif(raw_record->>'Target Account', '')),
  check (currency is not distinct from raw_record->>'Source Currency'),
  check (target_currency is not distinct from raw_record->>'Target Currency'),
  check (exchange_rate_text is not distinct from raw_record->>'Exchange Rate'),
  check (raw_record->>'Pending' in ('True', 'False')),
  check (pending is not distinct from ((raw_record->>'Pending') = 'True'))
);
create index finance_import_transactions_economic on public.finance_import_transactions(economic_fingerprint_sha256);
create index finance_import_transactions_raw on public.finance_import_transactions(raw_fingerprint_sha256);
create index finance_import_transactions_date on public.finance_import_transactions(transaction_date);

do $$
declare table_name text;
begin
  foreach table_name in array array['finance_import_batches', 'finance_import_transactions'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('create policy finance_read on public.%I for select to authenticated using ((select private.can_finance()))', table_name);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()', table_name);
    execute format('create trigger import_append_only before update or delete on public.%I for each row execute function private.reject_ledger_mutation()', table_name);
  end loop;
end
$$;

-- SECURITY INVOKER and no client EXECUTE grant: only a database owner/admin
-- can apply an explicitly reviewed offline import. No public RPC is exposed.
create function private.import_budgetflow_batch(p_payload jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  existing public.finance_import_batches%rowtype;
  new_batch_id uuid;
  payload_rows jsonb;
  row_count integer;
  reference_date date;
begin
  if jsonb_typeof(p_payload) <> 'object' or p_payload->>'schema_version' <> '1'
    or p_payload->>'source_system' <> 'budgetflow'
    or p_payload->>'fingerprint_version' <> 'budgetflow-v1-sorted-raw-core'
    or coalesce(p_payload->>'source_sha256', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_payload->>'normalized_sha256', '') !~ '^[0-9a-f]{64}$'
    or p_payload->>'source_record_ids_available' <> 'false'
    or jsonb_typeof(p_payload->'rows') <> 'array' then
    raise exception 'Import Finance non valido: schema e provenienza richiesti.' using errcode = '22023';
  end if;
  payload_rows := p_payload->'rows';
  row_count := jsonb_array_length(payload_rows);
  if row_count not between 1 and 100000 then
    raise exception 'Import Finance non valido: numero righe fuori limite.' using errcode = '22023';
  end if;
  reference_date := (p_payload->>'reference_date')::date;
  if reference_date is null then
    raise exception 'Import Finance non valido: data di riferimento mancante.' using errcode = '22023';
  end if;
  -- Serializes imports of different files too, so overlapping exports cannot
  -- both pass the candidate check before either transaction has committed.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.finance_import', 0));
  select * into existing from public.finance_import_batches
    where source_system = 'budgetflow' and source_sha256 = p_payload->>'source_sha256';
  if found then
    if existing.normalized_sha256 <> p_payload->>'normalized_sha256' or existing.source_row_count <> row_count then
      raise exception 'Stesso file con normalizzazione diversa: revisione necessaria.' using errcode = '22023';
    end if;
    return existing.id;
  end if;
  if exists (
    select 1 from jsonb_array_elements(payload_rows) r
    join public.finance_import_transactions t
      on t.raw_fingerprint_sha256 = r->>'raw_fingerprint_sha256'
      or t.economic_fingerprint_sha256 = r->>'economic_fingerprint_sha256'
  ) then
    raise exception 'Possibile sovrapposizione con un altro export: import bloccato, revisione manuale necessaria.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(payload_rows) r
    where (r->>'future_as_of_reference_date')::boolean is distinct from ((r->>'transaction_date')::date > reference_date)) then
    raise exception 'Import Finance non valido: flag data futura incoerente.' using errcode = '22023';
  end if;

  insert into public.finance_import_batches(source_system, source_file_name, source_sha256,
    normalized_sha256, fingerprint_version, extracted_at, reference_date,
    source_row_count, source_record_ids_available)
  values ('budgetflow', p_payload->>'source_file_name', p_payload->>'source_sha256',
    p_payload->>'normalized_sha256', p_payload->>'fingerprint_version',
    (p_payload->>'extracted_at')::timestamptz, reference_date, row_count, false)
  returning id into new_batch_id;

  insert into public.finance_import_transactions(batch_id, source_row, raw_record,
    raw_fingerprint_sha256, economic_fingerprint_sha256, source_timestamp, occurred_at,
    transaction_date, amount_text, amount_cents, currency, target_currency, exchange_rate_text,
    account_label, target_account_label, pending, future_as_of_reference_date)
  select new_batch_id, (r->>'source_row')::integer, r->'raw_record',
    r->>'raw_fingerprint_sha256', r->>'economic_fingerprint_sha256', r->>'source_timestamp',
    (r->>'occurred_at')::timestamptz, (r->>'transaction_date')::date,
    r->>'amount_text', (r->>'amount_cents')::bigint,
    r->>'currency', r->>'target_currency', r->>'exchange_rate_text',
    r->>'account_label', r->>'target_account_label', (r->>'pending')::boolean,
    (r->>'future_as_of_reference_date')::boolean
  from jsonb_array_elements(payload_rows) r;
  return new_batch_id;
end
$$;
revoke all on function private.import_budgetflow_batch(jsonb) from public, anon, authenticated;

commit;
