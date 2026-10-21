begin;

create table public.finance_documents (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('budgetflow', 'cogs', 'recap')),
  file_name text not null check (file_name ~ '^[A-Za-z0-9_.-]{1,180}$'),
  storage_path text not null unique check (storage_path ~ '^sources/[a-f0-9]{64}/[A-Za-z0-9_.-]{1,180}$'),
  sha256 text not null unique check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer not null check (byte_size between 1 and 26214400),
  content_type text not null check (content_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv')),
  review_status text not null default 'unreviewed' check (review_status = 'unreviewed'),
  imported_at timestamptz not null default now()
);
alter table public.finance_documents enable row level security;
revoke all on public.finance_documents from public, anon, authenticated;
grant select on public.finance_documents to authenticated;
create policy finance_documents_read on public.finance_documents for select to authenticated
  using ((select private.can_finance()));
create trigger finance_document_audit after insert or update or delete on public.finance_documents
  for each row execute function private.audit_change();
create trigger finance_document_append_only before update or delete on public.finance_documents
  for each row execute function private.reject_ledger_mutation();

-- No upload/update/delete policy for clients: source files stay immutable.
-- Bucket creation and file upload use Storage API, never direct storage SQL.
create policy luckylap_finance_source_read on storage.objects for select to authenticated
  using (bucket_id = 'finance-documents' and (select private.can_finance()) and exists (
    select 1 from public.finance_documents d where d.storage_path = name
  ));

commit;
