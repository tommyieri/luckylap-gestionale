begin;

create table public.finance_movement_attachments (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('budgetflow','manual','payment','refund','consignment_settlement','shop_payment')),
  source_id uuid not null,
  file_name text not null check (char_length(file_name) between 1 and 180 and file_name !~ '[[:cntrl:]/\\]' and file_name ~* '\.pdf$'),
  content_type text not null check (content_type = 'application/pdf'),
  byte_size integer not null check (byte_size between 1 and 4194304),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  ready boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (source_kind, source_id, sha256)
);
alter table public.finance_movement_attachments enable row level security;
revoke all on public.finance_movement_attachments from public, anon, authenticated;
grant select on public.finance_movement_attachments to authenticated;
create policy finance_movement_attachments_read on public.finance_movement_attachments
  for select to authenticated using (ready and (select private.can_finance()));
create trigger finance_movement_attachments_audit after update on public.finance_movement_attachments
  for each row when (new.ready and not old.ready) execute function private.audit_change();

-- The namespace is independent of the document source archive. Pending objects
-- are readable for byte verification and resumable after an interrupted request.
create function private.finance_attachment_storage_access(p_name text, p_upload boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_finance() and exists (
    select 1 from public.finance_movement_attachments a
    where a.id = case when split_part(p_name,'/',2) ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      then split_part(p_name,'/',2)::uuid else null end
      and p_name = 'movements/' || a.id || '/' || a.sha256
      and (not p_upload or not a.ready)
  );
$$;
revoke all on function private.finance_attachment_storage_access(text,boolean) from public, anon, service_role;
grant execute on function private.finance_attachment_storage_access(text,boolean) to authenticated;

create policy luckylap_finance_attachment_read on storage.objects for select to authenticated
  using (bucket_id = 'finance-documents' and private.finance_attachment_storage_access(name,false));
create policy luckylap_finance_attachment_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'finance-documents' and private.finance_attachment_storage_access(name,true));

create function public.prepare_finance_movement_attachment(
  p_source_kind text, p_source_id uuid, p_file_name text, p_content_type text, p_byte_size integer, p_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attachment public.finance_movement_attachments%rowtype;
begin
  if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode = '42501'; end if;
  if p_source_kind = 'shop_payment' then
    if not exists(select 1 from public.consignment_report_payments where id = p_source_id) then
      raise exception 'finance_source_not_found' using errcode = '22023';
    end if;
  else
    perform private.finance_revision_original(p_source_kind,p_source_id);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.finance_attachment.' || p_source_kind || '.' || p_source_id, 0));
  if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode = '42501'; end if;
  select * into v_attachment from public.finance_movement_attachments
    where source_kind = p_source_kind and source_id = p_source_id and sha256 = p_sha256;
  if not found then
    if (select count(*) from public.finance_movement_attachments where source_kind = p_source_kind and source_id = p_source_id) >= 25 then
      raise exception 'finance_attachment_limit' using errcode = '22023';
    end if;
    insert into public.finance_movement_attachments(source_kind, source_id, file_name, content_type, byte_size, sha256, created_by)
      values(p_source_kind,p_source_id,p_file_name,p_content_type,p_byte_size,p_sha256,auth.uid()) returning * into v_attachment;
  elsif v_attachment.content_type <> p_content_type or v_attachment.byte_size <> p_byte_size then
    raise exception 'invalid_finance_attachment' using errcode = '22023';
  end if;
  return jsonb_build_object('id',v_attachment.id,'file_name',v_attachment.file_name,'ready',v_attachment.ready);
end;
$$;

create function public.finish_finance_movement_attachment(p_attachment_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_attachment public.finance_movement_attachments%rowtype;
begin
  if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode = '42501'; end if;
  select * into v_attachment from public.finance_movement_attachments where id = p_attachment_id for update;
  if not found then raise exception 'finance_attachment_not_found' using errcode = '22023'; end if;
  if v_attachment.ready then return true; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'finance-documents'
    and name = 'movements/' || v_attachment.id || '/' || v_attachment.sha256
    and metadata->>'size' = v_attachment.byte_size::text
    and metadata->>'mimetype' = v_attachment.content_type) then
    raise exception 'finance_attachment_missing_file' using errcode = '22023';
  end if;
  if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode = '42501'; end if;
  update public.finance_movement_attachments set ready = true where id = v_attachment.id;
  return true;
end;
$$;

revoke all on function public.prepare_finance_movement_attachment(text,uuid,text,text,integer,text), public.finish_finance_movement_attachment(uuid)
  from public, anon, service_role;
grant execute on function public.prepare_finance_movement_attachment(text,uuid,text,text,integer,text), public.finish_finance_movement_attachment(uuid)
  to authenticated;

commit;
