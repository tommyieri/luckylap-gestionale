begin;

alter table public.assets drop constraint assets_asset_type_check;
alter table public.assets add constraint assets_asset_type_check check (asset_type in ('logo','mockup','photo','video','other'));
-- An administrative import is a system operation, never falsely attributed to a team member.
alter table public.assets alter column created_by drop not null;
alter table public.assets add column original_file_name text check (char_length(original_file_name) between 1 and 240);
alter table public.assets add column content_type text check (content_type in ('image/png','image/jpeg','image/webp','video/mp4','video/webm','image/svg+xml'));
alter table public.assets add column file_size_bytes bigint check (file_size_bytes between 1 and 26214400);
alter table public.assets add column sha256 text check (sha256 ~ '^[a-f0-9]{64}$');
alter table public.assets add column source jsonb not null default '{}'::jsonb check (jsonb_typeof(source) = 'object');

-- Metadata writes go through a replay-checked operation; no client can forge created_by.
revoke insert(name,asset_type,description,external_url,storage_path), update(name,asset_type,description,external_url,storage_path), delete on public.assets from authenticated;

create function private.register_brand_asset(
  p_operation_id uuid, p_name text, p_asset_type text, p_description text,
  p_external_url text, p_storage_path text, p_original_file_name text,
  p_content_type text, p_file_size_bytes bigint, p_sha256 text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_asset public.assets%rowtype; v_storage_mime text;
begin
  if v_actor is null or not private.is_member() then raise exception 'Team access required' using errcode='42501'; end if;
  if p_operation_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 240
    or p_description is null or char_length(p_description)>8000
    or p_asset_type is null or p_asset_type not in ('logo','mockup','photo','video','other')
    or num_nonnulls(p_external_url,p_storage_path)<>1 then raise exception 'Invalid asset input' using errcode='22023'; end if;
  if p_external_url is not null then
    if char_length(p_external_url)>2048 or p_external_url !~ '^https://[^/@?#[:space:]]+([/?#][^[:space:]]*)?$'
      or num_nonnulls(p_original_file_name,p_content_type,p_file_size_bytes,p_sha256)<>0 then raise exception 'Invalid external asset' using errcode='22023'; end if;
  else
    if p_storage_path is null or p_storage_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[a-z0-9][a-z0-9._-]{0,119}\.(png|jpg|jpeg|webp|mp4|webm|svg)$'
      or split_part(p_storage_path,'/',1)<>v_actor::text or split_part(p_storage_path,'/',2)<>p_operation_id::text
      or p_original_file_name is null or char_length(p_original_file_name) not between 1 and 240 or p_original_file_name ~ '[/\\[:cntrl:]]'
      or p_content_type is null or p_content_type not in ('image/png','image/jpeg','image/webp','video/mp4','video/webm','image/svg+xml')
      or p_file_size_bytes is null or p_file_size_bytes not between 1 and 26214400
      or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$'
      or not ((p_content_type='image/png' and p_storage_path~'\.png$')
        or (p_content_type='image/jpeg' and p_storage_path~'\.(jpg|jpeg)$')
        or (p_content_type='image/webp' and p_storage_path~'\.webp$')
        or (p_content_type='video/mp4' and p_storage_path~'\.mp4$')
        or (p_content_type='video/webm' and p_storage_path~'\.webm$')
        or (p_content_type='image/svg+xml' and p_storage_path~'\.svg$')) then raise exception 'Invalid stored asset' using errcode='22023'; end if;
    v_storage_mime := case when p_content_type='image/svg+xml' then 'application/octet-stream' else p_content_type end;
    if not exists(select 1 from storage.objects where bucket_id='brand-assets' and name=p_storage_path
      and metadata->>'mimetype'=v_storage_mime and metadata->>'size'=p_file_size_bytes::text)
      then raise exception 'Uploaded object not available' using errcode='22023'; end if;
  end if;
  insert into public.assets(id,name,asset_type,description,external_url,storage_path,created_by,original_file_name,content_type,file_size_bytes,sha256,source)
    values(p_operation_id,btrim(p_name),p_asset_type,p_description,p_external_url,p_storage_path,v_actor,p_original_file_name,p_content_type,p_file_size_bytes,p_sha256,jsonb_build_object('kind',case when p_storage_path is null then 'team_link' else 'team_upload' end))
    on conflict(id) do nothing;
  select * into v_asset from public.assets where id=p_operation_id;
  if v_asset.created_by is distinct from v_actor or
    row(v_asset.name,v_asset.asset_type,v_asset.description,v_asset.external_url,v_asset.storage_path,v_asset.original_file_name,v_asset.content_type,v_asset.file_size_bytes,v_asset.sha256)
      is distinct from row(btrim(p_name),p_asset_type,p_description,p_external_url,p_storage_path,p_original_file_name,p_content_type,p_file_size_bytes,p_sha256)
    then raise exception 'Operation already used with another payload' using errcode='23505'; end if;
  return v_asset.id;
end
$$;
create function public.register_brand_asset(p_operation_id uuid,p_name text,p_asset_type text,p_description text,p_external_url text,p_storage_path text,p_original_file_name text,p_content_type text,p_file_size_bytes bigint,p_sha256 text)
returns uuid language sql security invoker set search_path='' as $$ select private.register_brand_asset(p_operation_id,p_name,p_asset_type,p_description,p_external_url,p_storage_path,p_original_file_name,p_content_type,p_file_size_bytes,p_sha256) $$;
revoke all on function private.register_brand_asset(uuid,text,text,text,text,text,text,text,bigint,text),public.register_brand_asset(uuid,text,text,text,text,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function private.register_brand_asset(uuid,text,text,text,text,text,text,text,bigint,text),public.register_brand_asset(uuid,text,text,text,text,text,text,text,bigint,text) to authenticated;

-- The bucket itself is created through Storage API, never by SQL writes to Storage metadata.
create policy brand_assets_read on storage.objects for select to authenticated using (bucket_id='brand-assets' and (select private.is_member()));
create policy brand_assets_insert on storage.objects for insert to authenticated with check (bucket_id='brand-assets' and (select private.is_member())
  and split_part(name,'/',1)=(select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}/[a-z0-9][a-z0-9._-]{0,119}\.(png|jpg|jpeg|webp|mp4|webm|svg)$');
create policy brand_assets_no_update on storage.objects as restrictive for update to authenticated using (bucket_id<>'brand-assets') with check (bucket_id<>'brand-assets');
create policy brand_assets_no_delete on storage.objects as restrictive for delete to authenticated using (bucket_id<>'brand-assets');

create table public.product_development_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(btrim(name)) between 1 and 240),
  brief text not null default '' check(char_length(brief)<=8000),
  stage text not null default 'idea' check(stage in ('idea','design','sampling','production','ready','archived')),
  target_date date,
  owner_id uuid references public.profiles(user_id),
  version bigint not null default 1 check(version between 1 and 9007199254740991),
  created_by uuid not null default auth.uid() references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_development_owner on public.product_development_projects(owner_id);
create index product_development_creator on public.product_development_projects(created_by);
alter table public.product_development_projects enable row level security;
revoke all on public.product_development_projects from public,anon,authenticated;
grant select on public.product_development_projects to authenticated;
create policy development_read on public.product_development_projects for select to authenticated using ((select private.is_member()));
create trigger audit_change after insert or update or delete on public.product_development_projects for each row execute function private.audit_change();

create function private.save_development_project(p_id uuid,p_expected_version bigint,p_name text,p_brief text,p_stage text,p_target_date date,p_owner_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_project public.product_development_projects%rowtype;
begin
  if v_actor is null or not private.is_member() then raise exception 'Team access required' using errcode='42501'; end if;
  if p_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 240 or p_brief is null or char_length(p_brief)>8000
    or p_stage is null or p_stage not in ('idea','design','sampling','production','ready','archived')
    or (p_expected_version is not null and p_expected_version not between 1 and 9007199254740991)
    then raise exception 'Invalid development project input' using errcode='22023'; end if;
  if p_owner_id is not null and not exists(select 1 from public.memberships where user_id=p_owner_id and active)
    then raise exception 'Owner is not an active member' using errcode='22023'; end if;
  if p_expected_version is null then
    insert into public.product_development_projects(id,name,brief,stage,target_date,owner_id,created_by)
      values(p_id,btrim(p_name),p_brief,p_stage,p_target_date,p_owner_id,v_actor) on conflict(id) do nothing;
    select * into v_project from public.product_development_projects where id=p_id;
    if v_project.created_by is distinct from v_actor or v_project.version<>1 or
      row(v_project.name,v_project.brief,v_project.stage,v_project.target_date,v_project.owner_id)
      is distinct from row(btrim(p_name),p_brief,p_stage,p_target_date,p_owner_id)
      then raise exception 'Operation already used with another payload' using errcode='23505'; end if;
  else
    update public.product_development_projects set name=btrim(p_name),brief=p_brief,stage=p_stage,target_date=p_target_date,owner_id=p_owner_id,version=version+1,updated_at=now()
      where id=p_id and version=p_expected_version returning * into v_project;
    if not found then raise exception 'Project changed; reload before saving' using errcode='40001'; end if;
  end if;
  return jsonb_build_object('id',v_project.id,'version',v_project.version);
end
$$;
create function public.save_development_project(p_id uuid,p_expected_version bigint,p_name text,p_brief text,p_stage text,p_target_date date,p_owner_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.save_development_project(p_id,p_expected_version,p_name,p_brief,p_stage,p_target_date,p_owner_id) $$;
revoke all on function private.save_development_project(uuid,bigint,text,text,text,date,uuid),public.save_development_project(uuid,bigint,text,text,text,date,uuid) from public,anon,authenticated;
grant execute on function private.save_development_project(uuid,bigint,text,text,text,date,uuid),public.save_development_project(uuid,bigint,text,text,text,date,uuid) to authenticated;

commit;
