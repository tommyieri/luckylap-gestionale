begin;

alter table public.finance_documents drop constraint finance_documents_source_kind_check;
alter table public.finance_documents add constraint finance_documents_source_kind_check check (
  source_kind in ('budgetflow', 'cogs', 'recap') or
  (source_kind in ('consignment_invoice', 'consignment_statement') and content_type = 'application/pdf')
);

create function private.finance_consignment_lines_valid(p_lines jsonb, p_pieces integer, p_gross bigint, p_brand bigint)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_lines) <> 'array' then false else (
    select count(*) between 1 and 500
      and coalesce(bool_and(
        char_length(item.model) between 1 and 240 and
        char_length(item.size) between 1 and 30 and
        item.quantity > 0 and item.unit_cents > 0 and
        item.gross_cents = item.quantity::numeric * item.unit_cents and
        item.brand_cents between 0 and item.gross_cents
      and item.model is not null and item.size is not null and item.quantity is not null
      and item.unit_cents is not null and item.gross_cents is not null and item.brand_cents is not null), false)
      and sum(item.quantity) = p_pieces
      and sum(item.gross_cents) = p_gross
      and sum(item.brand_cents) = p_brand
    from jsonb_to_recordset(p_lines) as item(model text, size text, quantity integer, unit_cents bigint, gross_cents bigint, brand_cents bigint)
  ) end
$$;

create table public.finance_consignment_archive (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.stock_locations(id),
  period_start date not null,
  period_start_month_only boolean not null,
  period_end date not null,
  invoice_date date not null,
  invoice_number text not null check (char_length(invoice_number) between 1 and 60),
  invoice_document_id uuid not null unique references public.finance_documents(id),
  statement_document_id uuid not null unique references public.finance_documents(id),
  payment_transaction_id uuid not null unique references public.finance_import_transactions(id),
  payment_reference_mismatch boolean not null,
  payment_expected_at_capture boolean not null,
  pieces integer not null check (pieces > 0),
  gross_cents bigint not null check (gross_cents between 1 and 9000000000000000),
  brand_cents bigint not null check (brand_cents between 1 and gross_cents),
  sale_lines jsonb not null,
  imported_at timestamptz not null default now(),
  unique (location_id, invoice_number, invoice_date),
  check (period_start <= period_end and period_end <= invoice_date),
  check (not period_start_month_only or extract(day from period_start) = 1),
  check (invoice_document_id <> statement_document_id),
  check (private.finance_consignment_lines_valid(sale_lines, pieces, gross_cents, brand_cents))
);
alter table public.finance_consignment_archive enable row level security;
revoke all on public.finance_consignment_archive from public, anon, authenticated;
grant select on public.finance_consignment_archive to authenticated;
create policy finance_consignment_archive_read on public.finance_consignment_archive
  for select to authenticated using ((select private.can_finance()));
create trigger finance_consignment_archive_audit after insert or update or delete on public.finance_consignment_archive
  for each row execute function private.audit_change();
create trigger finance_consignment_archive_immutable before update or delete on public.finance_consignment_archive
  for each row execute function private.reject_ledger_mutation();

-- Privileged import, invoked only after the PDF originals have been stored via the Storage API.
create function private.import_finance_consignment_archive(p_value jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_archive public.finance_consignment_archive%rowtype;
  v_existing public.finance_consignment_archive%rowtype;
  v_document public.finance_documents%rowtype;
  v_meta jsonb;
  v_payment public.finance_import_transactions%rowtype;
  v_kind text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.finance_consignment_archive', 0));
  select id into strict v_archive.location_id from public.stock_locations
    where code = p_value->>'shop_code' and location_type = 'Negozio Conto Vendita';
  v_archive.period_start := (p_value->>'period_start')::date;
  v_archive.period_start_month_only := (p_value->>'period_start_month_only')::boolean;
  v_archive.period_end := (p_value->>'period_end')::date;
  v_archive.invoice_date := (p_value->>'invoice_date')::date;
  v_archive.invoice_number := p_value->>'invoice_number';
  v_archive.pieces := (p_value->>'pieces')::integer;
  v_archive.gross_cents := (p_value->>'gross_cents')::bigint;
  v_archive.brand_cents := (p_value->>'brand_cents')::bigint;
  v_archive.sale_lines := p_value->'sale_lines';
  v_archive.payment_reference_mismatch := (p_value->>'payment_reference_mismatch')::boolean;

  select * into strict v_payment from public.finance_import_transactions
    where raw_record = p_value->'payment_raw' and target_account_label is null
      and amount_cents = v_archive.brand_cents and transaction_date >= v_archive.invoice_date;
  v_archive.payment_transaction_id := v_payment.id;
  v_archive.payment_expected_at_capture := v_payment.pending or v_payment.transaction_date > (p_value->>'reference_date')::date;

  foreach v_kind in array array['consignment_invoice', 'consignment_statement'] loop
    v_meta := p_value->v_kind;
    if not exists (select 1 from storage.objects
      where bucket_id = 'finance-documents' and name = v_meta->>'storage_path') then
      raise exception 'Originale conto vendita non disponibile nell’archivio.' using errcode = '22023';
    end if;
    insert into public.finance_documents(source_kind, file_name, storage_path, sha256, byte_size, content_type)
      values (v_kind, v_meta->>'file_name', v_meta->>'storage_path', v_meta->>'sha256', (v_meta->>'byte_size')::integer, 'application/pdf')
      on conflict (sha256) do nothing;
    select * into strict v_document from public.finance_documents where sha256 = v_meta->>'sha256';
    if v_document.source_kind <> v_kind or v_document.file_name is distinct from v_meta->>'file_name'
      or v_document.storage_path is distinct from v_meta->>'storage_path'
      or v_document.storage_path <> 'sources/' || v_document.sha256 || '/' || v_document.file_name
      or v_document.byte_size is distinct from (v_meta->>'byte_size')::integer then
      raise exception 'Metadati originale conto vendita discordanti.' using errcode = '22023';
    end if;
    if v_kind = 'consignment_invoice' then
      v_archive.invoice_document_id := v_document.id;
    else
      v_archive.statement_document_id := v_document.id;
    end if;
  end loop;

  select * into v_existing from public.finance_consignment_archive
    where location_id = v_archive.location_id and invoice_number = v_archive.invoice_number and invoice_date = v_archive.invoice_date;
  if found then
    v_archive.id := v_existing.id;
    v_archive.imported_at := v_existing.imported_at;
    if v_archive is distinct from v_existing then
      raise exception 'Fattura conto vendita già archiviata con dati diversi.' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  if exists (select 1 from public.finance_consignment_archive
    where location_id = v_archive.location_id
      and daterange(period_start, period_end, '[]') && daterange(v_archive.period_start, v_archive.period_end, '[]')) then
    raise exception 'Periodi storici conto vendita sovrapposti.' using errcode = '22023';
  end if;

  v_archive.id := gen_random_uuid();
  v_archive.imported_at := now();
  insert into public.finance_consignment_archive values (v_archive.*);
  return v_archive.id;
end
$$;
revoke all on function private.import_finance_consignment_archive(jsonb) from public, anon, authenticated, service_role;

commit;
