-- Foto dei nuovi prodotti (/development). Nessuna riga esistente viene scritta. Di esistente
-- cambiano solo il vincolo dei tipi di public.assets (allargato) e tre funzioni del feed di
-- Controllo CEO; register_brand_asset, set_brand_asset_archived e save_development_project restano
-- come sono. Il resto è nuovo: una tabella, una tabella di ricevute, policy, trigger e comandi.
--
-- Una foto di un progetto è un contenuto di public.assets (stesso bucket privato brand-assets,
-- stessi limiti di 25 MiB, stessa route /assets/files/[id]) più una riga di collegamento in
-- public.product_development_photos(project_id, asset_id, position, created_by, created_at).
-- Il contenuto porta source = {"kind": "development_photo", "development_project_id": "<uuid>"}:
-- la libreria di «Grafica e foto» lo tiene fuori dall'elenco principale e lo mostra solo con il
-- filtro «Nuovi prodotti».
--
-- Cosa cambia, in ordine:
-- 1. public.assets: il vincolo assets_content_type_check accetta anche image/heic e image/heif
--    (le foto dell'iPhone e del Mac). Le righe di oggi lo rispettano già: nessuna riga cambia.
--    register_brand_asset resta com'è: la libreria non accetta HEIC.
-- 2. storage.objects: una policy di inserimento in più per i percorsi .heic/.heif del bucket
--    brand-assets, con lo stesso schema di percorso (utente/operazione/nome). Il bucket accetta già
--    application/octet-stream: HEIC si carica così, come gli SVG. Niente update, niente delete.
-- 3. public.product_development_photos: RLS, sola lettura ai membri attivi, audit_change. Un
--    contenuto sta in un solo progetto (asset_id unico); posizioni uniche per progetto.
-- 4. Due trigger di guardia (private.development_photo_guard): un collegamento punta solo a una
--    foto attiva di quel progetto; una foto collegata non si archivia finché è nel progetto.
-- 5. private.development_photo_receipts: ricevute append-only per operation_id.
-- 6. Tre comandi del team, private security definer più wrapper public security invoker:
--    add_development_photos, remove_development_photo, move_development_photo.
-- 7. Controllo CEO: activity_feed_keys, activity_feed_parent e activity_feed_window di
--    20261023164150_riassortimento con create or replace, copiate e cambiate solo dove serve:
--    le righe delle foto (e i loro contenuti) hanno per padre il progetto e diventano una frase
--    sola per transazione («… ha aggiunto 2 foto al progetto «Collab X»»), area Nuovi prodotti,
--    link alla scheda. Stesse 24 ore, stessa privacy: il nome del progetto passa da
--    activity_feed_text. Firma, sicurezza e permessi invariati.
--
-- Payload (schema_version 1):
--   add_development_photos   {"project_id", "photos": [{"asset_id", "storage_path",
--                             "original_file_name", "content_type", "file_size_bytes", "sha256"}]}
--   remove_development_photo {"project_id", "asset_id"}
--   move_development_photo   {"project_id", "asset_id", "position"}
-- Codici d'errore (messaggio = codice): 42501 development_access_required; 22023
-- invalid_development_photo_payload, development_project_not_found, development_photo_limit,
-- development_photo_upload_missing, development_photo_not_found, development_photo_asset_unavailable,
-- development_photo_linked, development_photo_immutable; 23505 development_photo_idempotency_conflict,
-- development_photo_already_added.
begin;

-- 1. HEIC e HEIF tra i tipi dei contenuti. Il vincolo si riverifica sulle righe di oggi.
alter table public.assets drop constraint assets_content_type_check,
  add constraint assets_content_type_check check (content_type in
    ('image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'image/svg+xml', 'image/heic', 'image/heif'));

-- 2. Stesso percorso dei caricamenti del team, estensione .heic o .heif. Le policy restrittive
-- brand_assets_no_update e brand_assets_no_delete valgono anche qui.
create policy development_photos_heic_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-assets' and (select private.is_member())
    and split_part(name, '/', 1) = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9][a-z0-9._-]{0,119}\.(heic|heif)$');

-- 3. Collegamento progetto → foto.
create table public.product_development_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.product_development_projects(id),
  asset_id uuid not null references public.assets(id),
  position integer not null check (position between 1 and 1000),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  constraint product_development_photos_asset unique (asset_id),
  constraint product_development_photos_position unique (project_id, position) deferrable initially deferred
);
create index product_development_photos_creator on public.product_development_photos(created_by);
alter table public.product_development_photos enable row level security;
revoke all on public.product_development_photos from public, anon, authenticated;
grant select on public.product_development_photos to authenticated;
create policy development_photos_read on public.product_development_photos for select to authenticated
  using ((select private.is_member()));
create trigger audit_change after insert or update or delete on public.product_development_photos
  for each row execute function private.audit_change();

-- 4. Guardie: valgono anche per chi scrive come proprietario del database.
create function private.development_photo_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'product_development_photos' then
    if tg_op = 'UPDATE' and (new.project_id is distinct from old.project_id or new.asset_id is distinct from old.asset_id) then
      raise exception 'development_photo_immutable' using errcode = '22023';
    end if;
    if tg_op = 'INSERT' then
      -- for share: un archivio concorrente aspetta questo collegamento e poi lo vede.
      perform 1 from public.assets a
        where a.id = new.asset_id and a.archived_at is null and a.storage_path is not null and a.asset_type = 'photo'
          and a.source ->> 'kind' = 'development_photo' and a.source ->> 'development_project_id' = new.project_id::text
        for share;
      if not found then raise exception 'development_photo_asset_unavailable' using errcode = '22023'; end if;
    end if;
    return new;
  end if;
  -- public.assets: una foto si toglie dal progetto con remove_development_photo, che la archivia.
  if new.archived_at is not null and old.archived_at is null
    and exists (select 1 from public.product_development_photos p where p.asset_id = new.id) then
    raise exception 'development_photo_linked' using errcode = '22023';
  end if;
  return new;
end
$$;
create trigger development_photo_guard before insert or update on public.product_development_photos
  for each row execute function private.development_photo_guard();
create trigger development_photo_archive_guard before update of archived_at on public.assets
  for each row execute function private.development_photo_guard();

-- 5. Ricevute dei comandi: stesso schema di private.asset_command_receipts. Append-only.
create table private.development_photo_receipts (
  operation_id uuid primary key,
  command_kind text not null check (command_kind in ('add_development_photos', 'remove_development_photo', 'move_development_photo')),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references public.profiles(user_id),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);
alter table private.development_photo_receipts enable row level security;
revoke all on private.development_photo_receipts from public, anon, authenticated;
create trigger development_photo_receipts_append_only before update or delete on private.development_photo_receipts
  for each row execute function private.reject_ledger_mutation();

-- Lo stesso invio ripetuto restituisce l'esito di allora; lo stesso ID con un altro comando, un
-- altro payload o un altro membro è un conflitto. Null se l'operazione è nuova.
create function private.development_photo_replay(p_operation_id uuid, p_kind text, p_digest text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_receipt private.development_photo_receipts%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.development_photos.' || p_operation_id::text, 0));
  select * into v_receipt from private.development_photo_receipts where operation_id = p_operation_id;
  if not found then return null; end if;
  if v_receipt.command_kind <> p_kind or v_receipt.actor_id is distinct from auth.uid() or v_receipt.payload_sha256 <> p_digest then
    raise exception 'development_photo_idempotency_conflict' using errcode = '23505';
  end if;
  return v_receipt.result || '{"replayed": true}'::jsonb;
end
$$;

-- 6a. Aggiunge da 1 a 10 foto già caricate nel bucket, in coda al progetto, in una transazione.
create function private.add_development_photos(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_keys constant text[] := array['asset_id', 'storage_path', 'original_file_name', 'content_type', 'file_size_bytes', 'sha256'];
  v_project uuid;
  v_digest text;
  v_replay jsonb;
  v_photo jsonb;
  v_asset uuid;
  v_path text;
  v_original text;
  v_type text;
  v_size bigint;
  v_ext text;
  v_count integer;
  v_next integer;
  v_ids jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_actor is null or not private.is_member() then
    raise exception 'development_access_required' using errcode = '42501';
  end if;
  if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object'
    or (p_payload - array['schema_version', 'project_id', 'photos']) <> '{}'::jsonb
    or not (p_payload ?& array['schema_version', 'project_id', 'photos'])
    or p_payload -> 'schema_version' is distinct from '1'::jsonb
    or jsonb_typeof(p_payload -> 'project_id') is distinct from 'string'
    or (p_payload ->> 'project_id') !~ v_uuid
    or jsonb_typeof(p_payload -> 'photos') is distinct from 'array'
    or jsonb_array_length(p_payload -> 'photos') not between 1 and 10 then
    raise exception 'invalid_development_photo_payload' using errcode = '22023';
  end if;
  for v_photo in select e.value from jsonb_array_elements(p_payload -> 'photos') with ordinality e(value, n) order by e.n loop
    if jsonb_typeof(v_photo) is distinct from 'object' or (v_photo - v_keys) <> '{}'::jsonb or not (v_photo ?& v_keys)
      or jsonb_typeof(v_photo -> 'asset_id') is distinct from 'string' or (v_photo ->> 'asset_id') !~ v_uuid
      or jsonb_typeof(v_photo -> 'storage_path') is distinct from 'string'
      or jsonb_typeof(v_photo -> 'original_file_name') is distinct from 'string'
      or jsonb_typeof(v_photo -> 'content_type') is distinct from 'string'
      or jsonb_typeof(v_photo -> 'file_size_bytes') is distinct from 'number'
      or (v_photo ->> 'file_size_bytes') !~ '^[1-9][0-9]{0,7}$'
      or jsonb_typeof(v_photo -> 'sha256') is distinct from 'string' or (v_photo ->> 'sha256') !~ '^[a-f0-9]{64}$' then
      raise exception 'invalid_development_photo_payload' using errcode = '22023';
    end if;
    v_path := v_photo ->> 'storage_path';
    v_original := v_photo ->> 'original_file_name';
    v_type := v_photo ->> 'content_type';
    v_size := (v_photo ->> 'file_size_bytes')::bigint;
    v_ext := substring(v_path from '\.([a-z]+)$');
    if v_path !~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' || (v_photo ->> 'asset_id')
        || '/[a-z0-9][a-z0-9._-]{0,119}\.(png|jpg|jpeg|webp|heic|heif)$')
      or char_length(v_original) not between 1 and 240 or v_original ~ '[/\\[:cntrl:]]'
      or v_size > 26214400
      or not ((v_type = 'image/png' and v_ext = 'png') or (v_type = 'image/jpeg' and v_ext in ('jpg', 'jpeg'))
        or (v_type = 'image/webp' and v_ext = 'webp') or (v_type = 'image/heic' and v_ext = 'heic')
        or (v_type = 'image/heif' and v_ext = 'heif')) then
      raise exception 'invalid_development_photo_payload' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct e.value ->> 'asset_id') from jsonb_array_elements(p_payload -> 'photos') e)
    <> jsonb_array_length(p_payload -> 'photos') then
    raise exception 'invalid_development_photo_payload' using errcode = '22023';
  end if;
  v_project := (p_payload ->> 'project_id')::uuid;

  v_digest := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  v_replay := private.development_photo_replay(p_operation_id, 'add_development_photos', v_digest);
  if v_replay is not null then return v_replay; end if;

  -- Il progetto bloccato mette in fila gli invii concorrenti: le posizioni restano in ordine.
  perform 1 from public.product_development_projects where id = v_project for update;
  if not found then raise exception 'development_project_not_found' using errcode = '22023'; end if;
  select count(*)::integer, coalesce(max(position), 0) into v_count, v_next
    from public.product_development_photos where project_id = v_project;
  if v_count + jsonb_array_length(p_payload -> 'photos') > 60 or v_next + jsonb_array_length(p_payload -> 'photos') > 1000 then
    raise exception 'development_photo_limit' using errcode = '22023';
  end if;

  for v_photo in select e.value from jsonb_array_elements(p_payload -> 'photos') with ordinality e(value, n) order by e.n loop
    v_asset := (v_photo ->> 'asset_id')::uuid;
    v_path := v_photo ->> 'storage_path';
    v_original := v_photo ->> 'original_file_name';
    v_type := v_photo ->> 'content_type';
    v_size := (v_photo ->> 'file_size_bytes')::bigint;
    -- Il percorso è quello firmato per chi invia: utente/operazione/nome.
    if split_part(v_path, '/', 1) <> v_actor::text then
      raise exception 'invalid_development_photo_payload' using errcode = '22023';
    end if;
    if exists (select 1 from public.assets where id = v_asset) then
      raise exception 'development_photo_already_added' using errcode = '23505';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'brand-assets' and o.name = v_path
      and o.metadata ->> 'mimetype' = case when v_type in ('image/heic', 'image/heif') then 'application/octet-stream' else v_type end
      and o.metadata ->> 'size' = v_size::text) then
      raise exception 'development_photo_upload_missing' using errcode = '22023';
    end if;
    insert into public.assets(id, name, asset_type, description, external_url, storage_path, created_by,
        original_file_name, content_type, file_size_bytes, sha256, source)
      values (v_asset, left(coalesce(nullif(btrim(regexp_replace(v_original, '\.[^.]*$', '')), ''), 'Foto'), 240),
        'photo', '', null, v_path, v_actor, v_original, v_type, v_size, v_photo ->> 'sha256',
        jsonb_build_object('kind', 'development_photo', 'development_project_id', v_project));
    v_next := v_next + 1;
    insert into public.product_development_photos(project_id, asset_id, position, created_by)
      values (v_project, v_asset, v_next, v_actor);
    v_ids := v_ids || to_jsonb(v_asset::text);
  end loop;

  v_result := jsonb_build_object('operation_id', p_operation_id, 'project_id', v_project, 'asset_ids', v_ids, 'replayed', false);
  insert into private.development_photo_receipts(operation_id, command_kind, payload_sha256, actor_id, result)
    values (p_operation_id, 'add_development_photos', v_digest, v_actor, v_result);
  return v_result;
end
$$;

-- 6b. Toglie una foto dal progetto: cancella il collegamento e archivia il contenuto. Il file resta
-- nel bucket, i metadati restano in public.assets.
create function private.remove_development_photo(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_project uuid;
  v_asset uuid;
  v_digest text;
  v_replay jsonb;
  v_archived_at timestamptz;
  v_result jsonb;
begin
  if v_actor is null or not private.is_member() then
    raise exception 'development_access_required' using errcode = '42501';
  end if;
  if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object'
    or (p_payload - array['schema_version', 'project_id', 'asset_id']) <> '{}'::jsonb
    or not (p_payload ?& array['schema_version', 'project_id', 'asset_id'])
    or p_payload -> 'schema_version' is distinct from '1'::jsonb
    or jsonb_typeof(p_payload -> 'project_id') is distinct from 'string' or (p_payload ->> 'project_id') !~ v_uuid
    or jsonb_typeof(p_payload -> 'asset_id') is distinct from 'string' or (p_payload ->> 'asset_id') !~ v_uuid then
    raise exception 'invalid_development_photo_payload' using errcode = '22023';
  end if;
  v_project := (p_payload ->> 'project_id')::uuid;
  v_asset := (p_payload ->> 'asset_id')::uuid;

  v_digest := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  v_replay := private.development_photo_replay(p_operation_id, 'remove_development_photo', v_digest);
  if v_replay is not null then return v_replay; end if;

  perform 1 from public.product_development_projects where id = v_project for update;
  if not found then raise exception 'development_project_not_found' using errcode = '22023'; end if;
  delete from public.product_development_photos where project_id = v_project and asset_id = v_asset;
  if not found then raise exception 'development_photo_not_found' using errcode = '22023'; end if;
  update public.assets set archived_at = now(), archived_by = v_actor
    where id = v_asset and archived_at is null returning archived_at into v_archived_at;
  if not found then select archived_at into v_archived_at from public.assets where id = v_asset; end if;

  v_result := jsonb_build_object('operation_id', p_operation_id, 'project_id', v_project, 'asset_id', v_asset,
    'removed', true, 'archived_at', v_archived_at, 'replayed', false);
  insert into private.development_photo_receipts(operation_id, command_kind, payload_sha256, actor_id, result)
    values (p_operation_id, 'remove_development_photo', v_digest, v_actor, v_result);
  return v_result;
end
$$;

-- 6c. Sposta una foto al posto indicato (1 = prima); le altre scorrono. Posizioni 1..n.
create function private.move_development_photo(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_project uuid;
  v_asset uuid;
  v_target integer;
  v_digest text;
  v_replay jsonb;
  v_order uuid[];
  v_changed integer;
  v_result jsonb;
begin
  if v_actor is null or not private.is_member() then
    raise exception 'development_access_required' using errcode = '42501';
  end if;
  if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object'
    or (p_payload - array['schema_version', 'project_id', 'asset_id', 'position']) <> '{}'::jsonb
    or not (p_payload ?& array['schema_version', 'project_id', 'asset_id', 'position'])
    or p_payload -> 'schema_version' is distinct from '1'::jsonb
    or jsonb_typeof(p_payload -> 'project_id') is distinct from 'string' or (p_payload ->> 'project_id') !~ v_uuid
    or jsonb_typeof(p_payload -> 'asset_id') is distinct from 'string' or (p_payload ->> 'asset_id') !~ v_uuid
    or jsonb_typeof(p_payload -> 'position') is distinct from 'number' or (p_payload ->> 'position') !~ '^[1-9][0-9]{0,2}$' then
    raise exception 'invalid_development_photo_payload' using errcode = '22023';
  end if;
  v_project := (p_payload ->> 'project_id')::uuid;
  v_asset := (p_payload ->> 'asset_id')::uuid;

  v_digest := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  v_replay := private.development_photo_replay(p_operation_id, 'move_development_photo', v_digest);
  if v_replay is not null then return v_replay; end if;

  perform 1 from public.product_development_projects where id = v_project for update;
  if not found then raise exception 'development_project_not_found' using errcode = '22023'; end if;
  select array_agg(p.asset_id order by p.position, p.created_at, p.id) into v_order
    from public.product_development_photos p where p.project_id = v_project;
  if v_order is null or array_position(v_order, v_asset) is null then
    raise exception 'development_photo_not_found' using errcode = '22023';
  end if;
  -- Un posto oltre la fine vale «ultima»: l'elenco può essere cambiato dopo la lettura.
  v_target := least((p_payload ->> 'position')::integer, cardinality(v_order));
  v_order := array_remove(v_order, v_asset);
  v_order := v_order[1:v_target - 1] || v_asset || v_order[v_target:];
  update public.product_development_photos p set position = x.n
    from unnest(v_order) with ordinality x(asset_id, n)
    where p.project_id = v_project and p.asset_id = x.asset_id and p.position <> x.n;
  get diagnostics v_changed = row_count;

  v_result := jsonb_build_object('operation_id', p_operation_id, 'project_id', v_project, 'asset_id', v_asset,
    'position', v_target, 'changed', v_changed > 0, 'replayed', false);
  insert into private.development_photo_receipts(operation_id, command_kind, payload_sha256, actor_id, result)
    values (p_operation_id, 'move_development_photo', v_digest, v_actor, v_result);
  return v_result;
end
$$;

create function public.add_development_photos(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.add_development_photos(p_operation_id, p_payload) $$;
create function public.remove_development_photo(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.remove_development_photo(p_operation_id, p_payload) $$;
create function public.move_development_photo(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.move_development_photo(p_operation_id, p_payload) $$;

revoke all on function private.development_photo_guard(), private.development_photo_replay(uuid, text, text),
  private.add_development_photos(uuid, jsonb), private.remove_development_photo(uuid, jsonb), private.move_development_photo(uuid, jsonb),
  public.add_development_photos(uuid, jsonb), public.remove_development_photo(uuid, jsonb), public.move_development_photo(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function private.add_development_photos(uuid, jsonb), private.remove_development_photo(uuid, jsonb),
  private.move_development_photo(uuid, jsonb), public.add_development_photos(uuid, jsonb),
  public.remove_development_photo(uuid, jsonb), public.move_development_photo(uuid, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. Controllo CEO: tre delle quattro funzioni di 20261023164150_riassortimento con create or
-- replace, copiate e cambiate solo dove serve. activity_feed_keys: la chiave photo_project dei
-- contenuti che sono foto di un progetto. activity_feed_parent: il padre delle foto e dei loro
-- contenuti è il progetto. activity_feed_window: la tabella delle foto, la priorità, il numero di
-- foto aggiunte o tolte, il nome del progetto (da activity_feed_text), l'area Nuovi prodotti, le
-- frasi e il link alla scheda. activity_feed_link_keys resta com'è. Stesse 24 ore, stessa privacy.
create or replace function private.activity_feed_keys(p_table text, p_new jsonb, p_old jsonb, p_key jsonb) returns jsonb
language sql immutable security invoker set search_path = '' as $$
 select jsonb_strip_nulls(
  jsonb_build_object(
   'id', coalesce(p_new ->> 'id', p_old ->> 'id', p_key ->> 'id'),
   'user_id', coalesce(p_new ->> 'user_id', p_old ->> 'user_id', p_key ->> 'user_id'),
   'stock_item_id', coalesce(p_new ->> 'stock_item_id', p_old ->> 'stock_item_id', p_key ->> 'stock_item_id'),
   'location_id', coalesce(p_new ->> 'location_id', p_old ->> 'location_id', p_key ->> 'location_id'),
   'order_id', coalesce(p_new ->> 'order_id', p_old ->> 'order_id'),
   'task_id', coalesce(p_new ->> 'task_id', p_old ->> 'task_id'),
   'calendar_event_id', coalesce(p_new ->> 'calendar_event_id', p_old ->> 'calendar_event_id'),
   'project_id', coalesce(p_new ->> 'project_id', p_old ->> 'project_id'),
   'event_id', coalesce(p_new ->> 'event_id', p_old ->> 'event_id', p_key ->> 'event_id'),
   'order_line_id', coalesce(p_new ->> 'order_line_id', p_old ->> 'order_line_id'),
   'requirement_id', coalesce(p_new ->> 'requirement_id', p_old ->> 'requirement_id'),
   'entry_id', coalesce(p_new ->> 'entry_id', p_old ->> 'entry_id'),
   'sale_id', coalesce(p_new ->> 'sale_id', p_old ->> 'sale_id'),
   'batch_id', coalesce(p_new ->> 'batch_id', p_old ->> 'batch_id'),
   'partner_id', coalesce(p_new ->> 'partner_id', p_old ->> 'partner_id', p_key ->> 'partner_id'),
   'variant_id', coalesce(p_new ->> 'variant_id', p_old ->> 'variant_id', p_key ->> 'variant_id'),
   'report_id', coalesce(p_new ->> 'report_id', p_old ->> 'report_id'),
   'payment_id', coalesce(p_new ->> 'payment_id', p_old ->> 'payment_id'),
   'shipment_id', coalesce(p_new ->> 'shipment_id', p_old ->> 'shipment_id'),
   'count_id', coalesce(p_new ->> 'count_id', p_old ->> 'count_id'),
   'consumption_id', coalesce(p_new ->> 'consumption_id', p_old ->> 'consumption_id'),
   'operation_id', coalesce(p_new ->> 'operation_id', p_old ->> 'operation_id'),
   'source_id', coalesce(p_new ->> 'source_id', p_old ->> 'source_id'),
   'source_kind', coalesce(p_new ->> 'source_kind', p_old ->> 'source_kind'),
   'return_id', coalesce(p_new ->> 'return_id', p_old ->> 'return_id'),
   'return_line_id', coalesce(p_new ->> 'return_line_id', p_old ->> 'return_line_id'))
  || jsonb_build_object(
   'parent_order', coalesce(p_new #>> '{source,sales_order_id}', p_old #>> '{source,sales_order_id}'),
   'parent_line', coalesce(p_new #>> '{source,sales_order_line_id}', p_old #>> '{source,sales_order_line_id}'),
   'parent_consumption', coalesce(p_new #>> '{source,packaging_consumption_id}', p_old #>> '{source,packaging_consumption_id}'),
   'parent_report', coalesce(p_new #>> '{source,consignment_report_id}', p_old #>> '{source,consignment_report_id}'),
   'parent_transfer', coalesce(p_new #>> '{source,consignment_transfer_id}', p_old #>> '{source,consignment_transfer_id}'),
   'parent_sale', coalesce(p_new #>> '{source,consignment_sale_id}', p_old #>> '{source,consignment_sale_id}'),
   'parent_shipment', coalesce(p_new #>> '{source,consignment_shipment_id}', p_old #>> '{source,consignment_shipment_id}'),
   'parent_count', coalesce(p_new #>> '{source,consignment_count_id}', p_old #>> '{source,consignment_count_id}'),
   'parent_restock', coalesce(p_new #>> '{source,restock_order_id}', p_old #>> '{source,restock_order_id}'),
   'shop_location', case when p_table = 'stock_locations'
     and coalesce(p_new #>> '{source,consignment_operation_id}', p_old #>> '{source,consignment_operation_id}') is not null
     then coalesce(p_new ->> 'id', p_old ->> 'id', p_key ->> 'id') end,
   'packaging_operation', coalesce(p_new #>> '{source,packaging_operation_id}', p_old #>> '{source,packaging_operation_id}'),
   'kind', coalesce(p_new ->> 'kind', p_old ->> 'kind'),
   'origin', coalesce(p_new ->> 'origin', p_old ->> 'origin'),
   'channel', coalesce(p_new ->> 'channel', p_old ->> 'channel'),
   'action', coalesce(p_new ->> 'action', p_old ->> 'action'),
   'version', coalesce(p_new ->> 'version', p_old ->> 'version'),
   'previous_version', coalesce(p_new ->> 'previous_version', p_old ->> 'previous_version'),
   'status', coalesce(p_new ->> 'status', p_old ->> 'status'),
   'stage_after', coalesce(p_new ->> 'stage_after', p_old ->> 'stage_after'),
   'deleted', coalesce(p_new ->> 'deleted', p_new ->> 'voided'))
  || jsonb_build_object(
   'event_type', coalesce(p_new ->> 'event_type', p_old ->> 'event_type'),
   'partner_co', coalesce(p_new ->> 'partner_co', p_old ->> 'partner_co', p_new ->> 'co', p_old ->> 'co'),
   'title', private.activity_feed_text(coalesce(p_new ->> 'title', p_old ->> 'title', p_new ->> 'partner_name',
     p_old ->> 'partner_name', p_new ->> 'name', p_old ->> 'name')),
   'quantity', case when coalesce(p_new ->> 'quantity', p_old ->> 'quantity') ~ '^[0-9]{1,9}$'
     then coalesce(p_new ->> 'quantity', p_old ->> 'quantity') end,
   'archived_before', case when p_table = 'assets' and p_old is not null then (p_old ->> 'archived_at' is not null)::text end,
   'archived_after', case when p_table = 'assets' and p_new is not null then (p_new ->> 'archived_at' is not null)::text end,
   'period', case when left(coalesce(p_new ->> 'period_month', p_new #>> '{snapshot,period_month}', p_old ->> 'period_month'), 7)
     ~ '^2[0-9]{3}-(0[1-9]|1[0-2])$' then left(coalesce(p_new ->> 'period_month', p_new #>> '{snapshot,period_month}', p_old ->> 'period_month'), 7) end,
   'pieces', case when coalesce(p_new ->> 'pieces', p_new #>> '{snapshot,pieces}') ~ '^[0-9]{1,9}$'
     then coalesce(p_new ->> 'pieces', p_new #>> '{snapshot,pieces}') end,
   'brand_cents', case when p_table = 'consignment_report_revisions' and p_new #>> '{snapshot,brand_cents}' ~ '^[0-9]{1,15}$'
     then p_new #>> '{snapshot,brand_cents}' end,
   'revision', case when coalesce(p_new ->> 'revision', p_old ->> 'revision') ~ '^[0-9]{1,6}$' then coalesce(p_new ->> 'revision', p_old ->> 'revision') end,
   'change_kind', coalesce(p_new ->> 'change_kind', p_old ->> 'change_kind'),
   'direction', coalesce(p_new ->> 'direction', p_old ->> 'direction'),
   'order_number', case when coalesce(p_new ->> 'order_number', p_old ->> 'order_number') ~ '^[0-9]{1,7}$'
     then coalesce(p_new ->> 'order_number', p_old ->> 'order_number') end,
   'device', coalesce(p_new ->> 'device', p_old ->> 'device'))
  || jsonb_build_object(
   'from_state', case when p_table = 'restock_state_events' then coalesce(p_new ->> 'from_state', p_old ->> 'from_state') end,
   'to_state', case when p_table = 'restock_state_events' then coalesce(p_new ->> 'to_state', p_old ->> 'to_state') end,
   'photo_project', case when p_table = 'assets' then coalesce(p_new #>> '{source,development_project_id}', p_old #>> '{source,development_project_id}') end,
   'warehouse_pieces', case when p_table = 'restock_arrivals' and p_new ->> 'warehouse_pieces' ~ '^[0-9]{1,9}$' then p_new ->> 'warehouse_pieces' end,
   'shop_pieces', case when p_table = 'restock_arrivals' and p_new ->> 'shop_pieces' ~ '^[0-9]{1,9}$' then p_new ->> 'shop_pieces' end,
   'undone', case when p_table = 'restock_arrivals' and p_new is not null then (p_new ->> 'undone_at' is not null)::text end,
   'shop_done_before', case when p_table = 'restock_orders' and p_old is not null then (p_old ->> 'shop_done_at' is not null)::text end,
   'shop_done_after', case when p_table = 'restock_orders' and p_new is not null then (p_new ->> 'shop_done_at' is not null)::text end,
   'sizes_after', case when p_table = 'consignment_shops' and p_old is not null and p_new is not null and p_old -> 'sizes' is distinct from p_new -> 'sizes'
     then case when jsonb_typeof(p_new -> 'sizes') = 'array' then (select string_agg(x.size, ', ' order by x.n)
       from jsonb_array_elements_text(p_new -> 'sizes') with ordinality x(size, n) where x.size ~ '^[A-Z0-9]{1,10}$') else 'tutte le taglie' end end))
$$;

create or replace function private.activity_feed_parent(p_table text, p_s jsonb) returns text
language sql immutable security invoker set search_path = '' as $$
 select case
  when p_table in ('sales_order_lines', 'order_payments', 'commercial_facts', 'shopify_refund_observations', 'shopify_order_financials',
    'shopify_transaction_observations', 'sales_registration_cancellations', 'manual_sale_returns') then 'sales_orders:' || (p_s ->> 'order_id')
  when p_table in ('fulfillment_lines', 'stock_reservations', 'stock_reservation_events', 'production_requirements') then 'sales_order_lines:' || (p_s ->> 'order_line_id')
  when p_table = 'production_receipts' then 'production_requirements:' || (p_s ->> 'requirement_id')
  when p_table = 'finance_entry_voids' then 'finance_entries:' || (p_s ->> 'entry_id')
  when p_table = 'finance_import_transactions' then 'finance_import_batches:' || (p_s ->> 'batch_id')
  when p_table = 'finance_movement_revisions' then 'finance_movement:' || coalesce(p_s ->> 'source_kind', 'unknown') || ':' || (p_s ->> 'source_id')
  when p_table in ('partner_contacts', 'partner_message_variants', 'partner_activities', 'partner_do_not_contact', 'partner_import_differences',
    'partner_work_links', 'partner_event_sales') then 'partners:' || (p_s ->> 'partner_id')
  when p_table = 'partner_message_revisions' then 'partner_message_variants:' || (p_s ->> 'variant_id')
  when p_table in ('consignment_report_lines', 'consignment_report_revisions', 'consignment_report_movements', 'consignment_report_payments')
    then 'consignment_reports:' || (p_s ->> 'report_id')
  when p_table = 'consignment_payment_revisions' then 'consignment_report_payments:' || (p_s ->> 'payment_id')
  when p_table = 'consignment_order_lines' then 'consignment_orders:' || (p_s ->> 'order_id')
  when p_table = 'consignment_shipment_lines' then 'consignment_shipments:' || (p_s ->> 'shipment_id')
  when p_table = 'consignment_count_lines' then 'consignment_counts:' || (p_s ->> 'count_id')
  when p_table = 'consignment_settlements' then 'consignment_sales:' || (p_s ->> 'sale_id')
  when p_table in ('manual_sale_return_lines', 'manual_sale_return_packaging') then 'manual_sale_returns:' || (p_s ->> 'return_id')
  when p_table = 'manual_sale_return_fulfillments' then 'manual_sale_return_lines:' || (p_s ->> 'return_line_id')
  when p_table = 'packaging_consumptions' and p_s ->> 'source_kind' = 'fulfillment' then 'fulfillment_lines:' || (p_s ->> 'source_id')
  when p_table = 'packaging_consumptions' and p_s ->> 'source_kind' = 'consignment' then 'consignment_sales:' || (p_s ->> 'source_id')
  when p_table = 'packaging_consumption_entries' then 'packaging_consumptions:' || (p_s ->> 'consumption_id')
  when p_table in ('restock_lines', 'restock_state_events', 'restock_arrivals') then 'restock_orders:' || (p_s ->> 'order_id')
  when p_table = 'product_development_photos' then 'product_development_projects:' || (p_s ->> 'project_id')
  when p_table = 'assets' then 'product_development_projects:' || (p_s ->> 'photo_project')
  when p_table = 'stock_movements' then coalesce('sales_orders:' || (p_s ->> 'parent_order'), 'sales_order_lines:' || (p_s ->> 'parent_line'),
    'packaging_consumptions:' || (p_s ->> 'parent_consumption'), 'consignment_reports:' || (p_s ->> 'parent_report'),
    'consignment_transfers:' || (p_s ->> 'parent_transfer'), 'consignment_sales:' || (p_s ->> 'parent_sale'),
    'consignment_shipments:' || (p_s ->> 'parent_shipment'), 'consignment_counts:' || (p_s ->> 'parent_count'),
    'restock_orders:' || (p_s ->> 'parent_restock'), 'stock_items:' || (p_s ->> 'stock_item_id'))
  when p_table = 'stock_locations' then 'consignment_shops:' || (p_s ->> 'shop_location')
  when p_table in ('product_variants', 'packaging_items', 'stock_balances') then 'stock_items:' || (p_s ->> 'stock_item_id')
 end
$$;

create or replace function private.activity_feed_window(p_from timestamptz, p_to timestamptz, p_actor text)
returns table(id uuid, occurred_at timestamptz, actor_id uuid, actor_name text, area text, message text, href text)
language sql stable security invoker set search_path = '' set timezone = 'UTC' as $$
with recursive extracted as materialized (
 select a.id audit_id, a.occurred_at, a.actor_id, a.table_name, a.operation,
  private.activity_feed_keys(a.table_name, a.new_data, a.old_data, a.record_key) s
 from public.audit_logs a
 where a.occurred_at >= p_from and a.occurred_at <= p_to
  and (p_actor is null or (p_actor = 'system' and a.actor_id is null) or a.actor_id = private.activity_feed_uuid(p_actor))
  and a.table_name in ('calendar_events', 'tasks', 'notes', 'assets', 'product_development_projects', 'profiles', 'memberships', 'app_settings',
   'discount_rules', 'products', 'stock_items', 'product_variants', 'packaging_items', 'stock_locations', 'stock_balances', 'stock_movements',
   'sales_orders', 'sales_order_lines', 'order_payments', 'fulfillment_lines', 'stock_reservations', 'stock_reservation_events',
   'production_requirements', 'production_receipts', 'commercial_facts', 'shopify_refund_observations', 'shopify_order_financials',
   'shopify_transaction_observations', 'sales_registration_cancellations', 'manual_sale_returns', 'manual_sale_return_lines',
   'manual_sale_return_fulfillments', 'manual_sale_return_packaging',
   'finance_entries', 'finance_entry_voids', 'finance_import_batches', 'finance_import_transactions', 'finance_documents', 'finance_movement_revisions',
   'packaging_consumptions', 'packaging_consumption_entries', 'packaging_automation', 'packaging_automation_failures',
   'partners', 'partner_contacts', 'partner_message_variants', 'partner_message_revisions', 'partner_activities', 'partner_do_not_contact',
   'partner_research_imports', 'partner_device_imports', 'partner_import_differences', 'partner_work_links', 'partner_event_sales',
   'consignment_transfers', 'consignment_sales', 'consignment_settlements', 'consignment_shops', 'consignment_counts', 'consignment_count_lines',
   'consignment_reports', 'consignment_report_lines', 'consignment_report_revisions', 'consignment_report_movements', 'consignment_report_payments',
   'consignment_payment_revisions', 'consignment_orders', 'consignment_order_lines', 'consignment_shipments', 'consignment_shipment_lines',
   'restock_orders', 'restock_lines', 'restock_state_events', 'restock_arrivals', 'product_development_photos')
), identified as (
 -- tx_actor: the actor as text, so transaction joins are hash joins (never per-row scans).
 select e.*, private.activity_feed_entity(e.table_name, e.s, e.audit_id) entity_id, coalesce(e.actor_id::text, 'system') tx_actor from extracted e
), generated_targets as materialized (
 -- The inverse relation applies only to the artifact's creation transaction.
 select t.audit_id, min(l.s ->> 'partner_id') partner_id
 from identified t join identified l on l.table_name = 'partner_work_links' and l.operation = 'INSERT'
  and l.occurred_at = t.occurred_at and l.tx_actor = t.tx_actor
  and l.s ->> (case t.table_name when 'tasks' then 'task_id' when 'calendar_events' then 'calendar_event_id' when 'product_development_projects' then 'project_id' end) = t.entity_id
 where t.operation = 'INSERT' and t.table_name in ('tasks', 'calendar_events', 'product_development_projects')
  and private.activity_feed_uuid(l.s ->> 'partner_id') is not null
 group by t.audit_id having count(distinct l.s ->> 'partner_id') = 1
), nodes as materialized (
 select i.*,
  case when g.partner_id is not null then 'generated:' || i.audit_id::text else i.table_name || ':' || i.entity_id end entity_key,
  case when g.partner_id is not null then 'partners:' || g.partner_id else private.activity_feed_parent(i.table_name, i.s) end parent_key
 from identified i left join generated_targets g on g.audit_id = i.audit_id
), local_edges as materialized (
 select n.entity_key, array_agg(distinct n.parent_key) filter (where n.parent_key is not null and n.parent_key <> n.entity_key) parents
 from nodes n group by n.entity_key
), chain(key, parent) as (
 -- Each element's parent, one parent or none. Rows of this window decide; the history is read by
 -- key (audit_logs_feed_entity) only for an ancestor outside the window whose table has parents.
 select l.entity_key, case when cardinality(l.parents) = 1 then l.parents[1] end from local_edges l
 union
 select c.parent, case when w.entity_key is not null then (case when cardinality(w.parents) = 1 then w.parents[1] end)
  when split_part(c.parent, ':', 1) in ('sales_order_lines', 'fulfillment_lines', 'production_requirements', 'packaging_consumptions',
   'consignment_report_payments', 'partner_message_variants', 'manual_sale_returns', 'manual_sale_return_lines', 'consignment_sales',
   'stock_reservations', 'finance_entry_voids', 'finance_import_transactions', 'stock_movements', 'stock_locations') then (
   select case when count(distinct x.p) = 1 then min(x.p) end from (
    select private.activity_feed_parent(a.table_name, private.activity_feed_link_keys(a.table_name, a.new_data, a.old_data, a.record_key)) p
    from public.audit_logs a
    where a.table_name = split_part(c.parent, ':', 1)
     and coalesce(a.new_data ->> 'id', a.old_data ->> 'id', a.record_key ->> 'id') = substr(c.parent, strpos(c.parent, ':') + 1)
   ) x where x.p is not null and x.p <> c.parent) end
 from chain c left join local_edges w on w.entity_key = c.parent where c.parent is not null
), edges as materialized (
 select c.key entity_key, min(c.parent) parent_key from chain c where c.parent is not null group by c.key having count(distinct c.parent) = 1
), walk as (
 select n.audit_id, n.entity_key root_key, 0 depth, array[n.entity_key] visited from nodes n
 union all
 select w.audit_id, e.parent_key, w.depth + 1, w.visited || e.parent_key
 from walk w join edges e on e.entity_key = w.root_key where w.depth < 12 and not e.parent_key = any(w.visited)
), roots as (
 select distinct on (w.audit_id) w.audit_id, w.root_key from walk w order by w.audit_id, w.depth desc
), moved as materialized (
 select distinct n.occurred_at, n.tx_actor, n.s ->> 'stock_item_id' item, n.s ->> 'location_id' location from nodes n where n.table_name = 'stock_movements'
), edited as materialized (
 select distinct n.occurred_at, n.tx_actor, n.entity_id from nodes n where n.table_name = 'calendar_events'
), prepared as (
 select n.*, r.root_key,
  case when n.operation = 'INSERT' and n.table_name in ('sales_orders', 'production_receipts', 'finance_movement_revisions') then n.s ->> 'operation_id'
   when n.operation = 'INSERT' and n.table_name in ('consignment_sales', 'consignment_transfers', 'consignment_report_revisions', 'consignment_payment_revisions', 'consignment_shipments') then n.entity_id
   when n.operation = 'INSERT' and n.table_name = 'partner_activities' then coalesce(n.s ->> 'operation_id', private.activity_partner_operation(n.table_name, n.entity_id))
   when n.table_name = 'stock_movements' and r.root_key like 'stock_items:%' then coalesce(n.s ->> 'packaging_operation', n.s ->> 'operation_id') end anchor,
  case when n.table_name = 'restock_arrivals' then 150
   when n.table_name = 'restock_orders' and n.operation = 'INSERT' then 145
   when n.table_name = 'restock_state_events' then 140
   when n.table_name = 'restock_lines' then 135
   when n.table_name = 'restock_orders' then 130
   when n.table_name in ('sales_registration_cancellations', 'manual_sale_returns', 'partner_research_imports', 'partner_device_imports') then 190
   when n.table_name = 'finance_movement_revisions' then 180
   when n.table_name = 'partner_activities' then 170
   when n.table_name = 'sales_orders' and n.operation = 'INSERT' then 160
   when n.table_name in ('order_payments', 'consignment_report_payments') then 150
   when n.table_name in ('fulfillment_lines', 'production_receipts', 'consignment_payment_revisions', 'consignment_report_revisions',
    'consignment_counts', 'consignment_shipments', 'consignment_orders', 'consignment_shops') then 140
   when n.table_name = 'product_development_photos' then 135
   when n.table_name in ('calendar_events', 'tasks', 'notes', 'assets', 'product_development_projects', 'finance_entries', 'finance_import_batches', 'finance_entry_voids') then 130
   when n.table_name = 'stock_movements' then 110
   when n.table_name = 'stock_balances' then 1 else 80 end priority
 from nodes n join roots r using (audit_id)
 -- A balance next to its movement is the same action.
 left join moved m on n.table_name = 'stock_balances' and m.occurred_at = n.occurred_at and m.tx_actor = n.tx_actor
  and m.item = n.s ->> 'stock_item_id' and m.location = n.s ->> 'location_id'
 -- Calendar edits invalidate a link's CAS version: not another human action.
 left join edited e on n.table_name = 'partner_work_links' and n.operation = 'UPDATE' and e.occurred_at = n.occurred_at
  and e.tx_actor = n.tx_actor and e.entity_id = n.s ->> 'calendar_event_id'
 where m.item is null and e.entity_id is null
  -- P5 closes existing reminders in the same source action: an earlier, immutable follow-up link
  -- plus the explicit team activity of this transaction proves the side effect.
  and not (n.table_name = 'tasks' and n.operation = 'UPDATE' and n.s ->> 'status' = 'done' and exists (
   select 1 from public.audit_logs l join nodes a on a.table_name = 'partner_activities'
    and a.s ->> 'partner_id' = coalesce(l.new_data ->> 'partner_id', l.record_key ->> 'partner_id')
    and a.occurred_at = n.occurred_at and a.tx_actor = n.tx_actor and a.s ->> 'origin' = 'team'
    and (a.s ->> 'kind' in ('inviato', 'risposta', 'non_contattare') or (a.s ->> 'kind' = 'stato' and a.s ->> 'stage_after' in ('chiuso', 'no')))
   where l.table_name = 'partner_work_links' and l.operation = 'INSERT' and l.new_data ->> 'task_id' = n.entity_id
    and l.new_data ->> 'kind' = 'follow_up' and l.occurred_at <= n.occurred_at))
), scopes as (
 select p.root_key, p.occurred_at, p.tx_actor, count(distinct p.anchor) anchors, min(p.anchor) anchor from prepared p group by p.root_key, p.occurred_at, p.tx_actor
), tagged as (
 select p.*, p.root_key || '|' || p.tx_actor || '|' || coalesce(case when t.anchors = 1 then t.anchor when t.anchors > 1 then p.anchor end,
   'tx:' || to_char(p.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) group_key
 from prepared p join scopes t on t.root_key = p.root_key and t.occurred_at = p.occurred_at and t.tx_actor = p.tx_actor
 where t.anchors <= 1 or p.anchor is not null
), line_quantities as (
 select q.group_key, sum(q.quantity) order_quantity from (
  select n.group_key, max((n.s ->> 'quantity')::bigint) quantity from tagged n where n.table_name = 'sales_order_lines' group by n.group_key, n.entity_id) q
 group by q.group_key
), summary as (
 select t.group_key, max(t.occurred_at) occurred_at, t.actor_id, min(q.order_quantity) order_quantity,
  sum((t.s ->> 'quantity')::bigint) filter (where t.table_name = 'fulfillment_lines') delivered_quantity,
  count(*) filter (where t.table_name = 'finance_import_transactions') imported_rows,
  max(t.s ->> 'channel') filter (where t.table_name = 'sales_orders') own_channel,
  max(t.s ->> 'partner_co') own_partner_co,
  max(t.s ->> 'title') filter (where t.table_name in ('partners', 'partner_activities')) own_partner_name,
  count(*) filter (where t.table_name = 'product_development_photos' and t.operation = 'INSERT') photos_added,
  count(*) filter (where t.table_name = 'product_development_photos' and t.operation = 'DELETE') photos_removed,
  t.root_key summary_root
 from tagged t left join line_quantities q using (group_key) group by t.group_key, t.actor_id, t.root_key
), rooted as (
 -- The order's channel and the contact's name and CO come from the latest row of the root, read by key.
 select g.*, coalesce(g.own_channel, case when g.summary_root like 'sales_orders:%' then r.s ->> 'channel' end) channel,
  coalesce(g.own_partner_co, case when g.summary_root like 'partners:%' then r.s ->> 'partner_co' end) partner_co,
  coalesce(g.own_partner_name, case when g.summary_root like 'partners:%' then r.s ->> 'title' end) partner_name
 from summary g left join lateral (
  select private.activity_feed_keys(a.table_name, a.new_data, a.old_data, a.record_key) s
  from public.audit_logs a
  where (g.summary_root like 'sales_orders:%' and g.own_channel is null or g.summary_root like 'partners:%' and (g.own_partner_co is null or g.own_partner_name is null))
   and a.table_name = split_part(g.summary_root, ':', 1)
   and coalesce(a.new_data ->> 'id', a.old_data ->> 'id', a.record_key ->> 'id') = substr(g.summary_root, strpos(g.summary_root, ':') + 1)
   and (g.summary_root like 'sales_orders:%' or a.occurred_at <= g.occurred_at)
  order by a.occurred_at desc, a.id desc limit 1) r on true
), chosen as (
 select distinct on (t.group_key) t.group_key, t.table_name, t.operation, t.s, t.root_key, t.entity_id from tagged t order by t.group_key, t.priority desc, t.audit_id desc
), classified as (
 select g.*, c.table_name, c.operation, c.s, c.root_key, c.entity_id,
  coalesce(private.activity_feed_text(p.display_name, 120), case when g.actor_id is null then 'Automazioni' else 'Membro non disponibile' end) actor_name,
  case when c.table_name like 'consignment_%' or c.root_key like 'consignment_shops:%' then private.activity_feed_text(loc.name, 80) end shop_name,
  case when c.table_name like 'consignment_%' or c.root_key like 'consignment_shops:%' then upper(loc.code) end shop_code,
  case when c.root_key like 'restock_orders:%' then private.activity_feed_text(ro.title, 80) end restock_title,
  case when c.root_key like 'restock_orders:%' then private.activity_feed_text(rs.name, 80) end restock_shop,
  case when c.table_name = 'restock_arrivals' then private.activity_feed_text(loc.name, 80) end restock_place,
  case when c.table_name = 'product_development_photos' then private.activity_feed_text(dp.name, 80) end photo_project,
  case when c.table_name like 'finance_%' or c.table_name in ('order_payments', 'shopify_refund_observations', 'shopify_order_financials',
     'shopify_transaction_observations', 'consignment_settlements', 'consignment_report_payments', 'consignment_payment_revisions') then 'finance'
   when c.table_name in ('calendar_events', 'tasks', 'notes') then 'team'
   when c.table_name like 'partner%' then 'partner'
   when c.table_name = 'sales_registration_cancellations' or c.table_name like 'manual_sale_return%' then 'sales'
   when c.table_name like 'restock_%' or c.root_key like 'restock_orders:%' then 'stock'
   when c.table_name like 'consignment_%' or c.root_key like 'consignment_shops:%' then 'consignment'
   when c.root_key like 'sales_orders:%' or c.table_name = 'discount_rules' then 'sales'
   when c.table_name = 'assets' then 'assets'
   when c.table_name in ('product_development_projects', 'product_development_photos') then 'development'
   when c.table_name like 'packaging_%' or exists (select 1 from public.stock_items z where z.id = private.activity_feed_uuid(c.s ->> 'stock_item_id') and z.kind = 'packaging') then 'packaging'
   when c.table_name in ('profiles', 'memberships', 'app_settings') then 'settings' else 'stock' end area
 from rooted g join chosen c using (group_key)
 left join public.profiles p on p.user_id = g.actor_id
 left join public.stock_locations loc on loc.id = private.activity_feed_uuid(case when c.table_name = 'consignment_shops' then c.entity_id else c.s ->> 'location_id' end)
 left join public.restock_orders ro on c.root_key like 'restock_orders:%' and ro.id = private.activity_feed_uuid(split_part(c.root_key, ':', 2))
 left join public.stock_locations rs on rs.id = ro.shop_location_id
 left join public.product_development_projects dp on c.table_name = 'product_development_photos' and dp.id = private.activity_feed_uuid(c.s ->> 'project_id')
), worded as (
 select c.*,
  coalesce(c.shop_name, 'un negozio') shop,
  coalesce('il riordine «' || c.restock_title || '»', 'un riordine') restock_ref,
  coalesce('del riordine «' || c.restock_title || '»', 'di un riordine') restock_of,
  case when c.s ->> 'period' is not null then 'di ' || private.activity_feed_month(c.s ->> 'period') || ' ' else '' end month_part,
  case when c.s ->> 'pieces' is not null then private.activity_feed_count((c.s ->> 'pieces')::bigint, 'pezzo', 'pezzi') end pieces_label,
  case when c.table_name in ('order_payments', 'consignment_settlements', 'consignment_report_payments', 'consignment_payment_revisions') then
    case when c.s ->> 'deleted' = 'true' then 'delete' when c.operation = 'UPDATE' or c.table_name = 'consignment_payment_revisions' then 'update' else 'insert' end end payment_action
 from classified c
), phrases as (
 select w.*,
 case
  when w.table_name = 'calendar_events' then case w.operation when 'INSERT' then 'ha aggiunto ' when 'DELETE' then 'ha eliminato ' else 'ha modificato ' end
   || case when w.s ->> 'event_type' = 'meeting' then 'una call' else 'un appuntamento' end
  when w.table_name = 'tasks' then case when w.operation = 'DELETE' then 'ha eliminato un’attività' when w.operation = 'INSERT' then 'ha aggiunto un’attività'
   when w.s ->> 'status' = 'done' then 'ha completato un’attività' else 'ha aggiornato un’attività' end
  when w.table_name = 'notes' then case w.operation when 'INSERT' then 'ha aggiunto una nota' when 'DELETE' then 'ha eliminato una nota' else 'ha aggiornato una nota' end
  when w.table_name = 'assets' then case when w.operation = 'INSERT' then 'ha aggiunto un contenuto' when w.operation = 'DELETE' then 'ha eliminato un contenuto'
   when w.s ->> 'archived_before' = 'false' and w.s ->> 'archived_after' = 'true' then 'ha archiviato un contenuto'
   when w.s ->> 'archived_before' = 'true' and w.s ->> 'archived_after' = 'false' then 'ha ripristinato un contenuto' else 'ha aggiornato un contenuto' end
  when w.table_name = 'product_development_projects' then case w.operation when 'INSERT' then 'ha avviato un progetto' when 'DELETE' then 'ha eliminato un progetto' else 'ha aggiornato un progetto' end
  when w.table_name = 'product_development_photos' then case
   when w.photos_added > 0 then 'ha aggiunto ' || case when w.photos_added = 1 then 'una foto' else w.photos_added || ' foto' end
    || coalesce(' al progetto «' || w.photo_project || '»', ' a un progetto')
   when w.photos_removed > 0 then 'ha tolto ' || case when w.photos_removed = 1 then 'una foto' else w.photos_removed || ' foto' end
    || coalesce(' dal progetto «' || w.photo_project || '»', ' da un progetto')
   else 'ha riordinato le foto ' || coalesce('del progetto «' || w.photo_project || '»', 'di un progetto') end
  when w.table_name = 'restock_arrivals' and w.s ->> 'undone' = 'true' then 'ha annullato l’arrivo ' || w.restock_of
   || case when coalesce((w.s ->> 'pieces')::bigint, 0) > 0 then ': ' || w.pieces_label || case when (w.s ->> 'pieces')::bigint = 1 then ' tolto da ' else ' tolti da ' end
    || coalesce(w.restock_place, 'magazzino') else '' end
  when w.table_name = 'restock_arrivals' then case when coalesce((w.s ->> 'pieces')::bigint, 0) = 0
   then 'ha segnato ' || w.restock_ref || ' in mano nostra: nessun pezzo da caricare'
   else 'ha caricato in ' || coalesce(w.restock_place, 'magazzino') || ' ' || w.restock_ref || ': ' || case
    when coalesce((w.s ->> 'warehouse_pieces')::bigint, 0) = 0 then private.activity_feed_count((w.s ->> 'shop_pieces')::bigint, 'pezzo per ', 'pezzi per ') || coalesce(w.restock_shop, 'il negozio')
    when coalesce((w.s ->> 'shop_pieces')::bigint, 0) = 0 then private.activity_feed_count((w.s ->> 'warehouse_pieces')::bigint, 'pezzo per noi', 'pezzi per noi')
    else private.activity_feed_count((w.s ->> 'warehouse_pieces')::bigint, 'pezzo per noi', 'pezzi per noi') || ' e ' || (w.s ->> 'shop_pieces') || ' per ' || coalesce(w.restock_shop, 'il negozio') end end
  when w.table_name = 'restock_orders' and w.operation = 'INSERT' then case when w.actor_id is null then 'ha importato ' else 'ha creato ' end || w.restock_ref
  when w.table_name = 'restock_state_events' then case when w.s ->> 'from_state' is null then 'ha creato ' || w.restock_ref
   else 'ha portato ' || w.restock_ref || ' a «' || case w.s ->> 'to_state' when 'discussion' then 'Discussione su cosa riordinare' when 'supplier' then 'Ordine magliette a Marco' when 'embroiderer' then 'Dal ricamatore' when 'quality' then 'Da Antonella' when 'in_hand' then 'In mano nostra' else 'un altro stato' end || '»' end
  when w.table_name = 'restock_lines' then 'ha cambiato le quantità ' || w.restock_of
  when w.table_name = 'restock_orders' then case
   when w.s ->> 'shop_done_after' = 'true' and w.s ->> 'shop_done_before' = 'false' then 'ha segnato come consegnate a ' || coalesce(w.restock_shop, 'il negozio') || ' le magliette ' || w.restock_of
   when w.s ->> 'shop_done_after' = 'false' and w.s ->> 'shop_done_before' = 'true' then 'ha tolto il segno di consegna al negozio ' || w.restock_of
   else 'ha aggiornato ' || w.restock_ref end
  when w.table_name = 'sales_registration_cancellations' then 'ha annullato la registrazione di una vendita'
  when w.table_name = 'manual_sale_returns' then 'ha registrato un reso'
  when w.table_name = 'sales_orders' and w.operation = 'INSERT' then case when w.actor_id is null then 'ha ricevuto un ordine' else 'ha registrato una vendita' end
  when w.table_name = 'sales_orders' then 'ha aggiornato un ordine'
  when w.table_name = 'fulfillment_lines' then 'ha registrato una consegna'
  when w.table_name = 'production_receipts' then 'ha completato una produzione'
  when w.table_name = 'consignment_settlements' then 'ha registrato un incasso dal conto vendita'
  when w.payment_action is not null then case w.payment_action when 'delete' then 'ha eliminato un incasso' when 'update' then 'ha modificato un incasso' else 'ha registrato un incasso' end
   || case when w.table_name like 'consignment_%' then coalesce(' da ' || w.shop_name, ' dal conto vendita') else '' end
  when w.table_name = 'shopify_refund_observations' then 'ha registrato un rimborso'
  when w.table_name in ('shopify_order_financials', 'shopify_transaction_observations') then 'ha aggiornato i dati di pagamento di un ordine'
  when w.table_name = 'finance_movement_revisions' then case w.s ->> 'action' when 'delete' then 'ha eliminato un movimento Finance' when 'restore' then 'ha ripristinato un movimento Finance' else 'ha corretto un movimento Finance' end
  when w.table_name = 'finance_import_batches' then case when w.imported_rows > 0 then 'ha importato ' || private.activity_feed_count(w.imported_rows, 'movimento', 'movimenti') || ' da BudgetFlow' else 'ha importato movimenti Finance' end
  when w.table_name = 'finance_entry_voids' then 'ha annullato un movimento Finance'
  when w.table_name = 'finance_documents' then 'ha archiviato un documento Finance'
  when w.area = 'finance' then case w.operation when 'INSERT' then 'ha registrato un movimento Finance' when 'DELETE' then 'ha eliminato un movimento Finance' else 'ha corretto un movimento Finance' end
  when w.table_name = 'partner_research_imports' then 'ha importato la ricerca Partner'
  when w.table_name = 'partner_device_imports' then 'ha importato gli stati ' || case w.s ->> 'device' when 'telefono' then 'del telefono' when 'computer' then 'del computer' else 'di un dispositivo' end || ' in Partner'
  when w.table_name = 'partner_activities' then case w.s ->> 'kind' when 'inviato' then 'ha registrato un invio Partner' when 'risposta' then 'ha registrato una risposta Partner'
   when 'nuovo' then 'ha aggiunto un Partner' when 'stato' then 'ha aggiornato lo stato Partner' else 'ha aggiornato un Partner' end
  when w.table_name = 'partner_event_sales' then case when w.operation = 'DELETE' then 'ha rimosso il collegamento di una vendita a un evento Partner' else 'ha collegato una vendita a un evento Partner' end
  when w.area = 'partner' then 'ha aggiornato un Partner'
  when w.table_name = 'consignment_shops' then case when w.operation = 'INSERT' then 'ha aggiunto il negozio ' || w.shop
   when w.s ->> 'sizes_after' is not null then 'ha impostato le taglie di ' || w.shop || ': ' || (w.s ->> 'sizes_after') else 'ha cambiato le condizioni di ' || w.shop end
  when w.table_name = 'consignment_counts' then 'ha contato ' || w.shop || coalesce(': ' || w.pieces_label, '')
  when w.table_name = 'consignment_report_revisions' then case
   when w.s ->> 'change_kind' = 'invoice' then 'ha segnato la fattura del resoconto ' || w.month_part || 'di ' || w.shop
   when coalesce((w.s ->> 'revision')::integer, 1) > 1 then 'ha corretto il resoconto ' || w.month_part || 'di ' || w.shop
   else 'ha registrato il resoconto ' || w.month_part || 'di ' || w.shop || coalesce(': ' || w.pieces_label
    || coalesce(', ' || private.activity_feed_money((w.s ->> 'brand_cents')::bigint) || ' da fatturare', ''), '') end
  when w.table_name = 'consignment_reports' then 'ha aggiornato il resoconto ' || w.month_part || 'di ' || w.shop
  when w.table_name = 'consignment_orders' then case when w.operation = 'INSERT' then 'ha inserito l’ordine' when w.s ->> 'status' = 'closed' then 'ha chiuso l’ordine'
   else 'ha aggiornato l’ordine' end || coalesce(' n. ' || (w.s ->> 'order_number'), '') || ' di ' || w.shop
  when w.table_name = 'consignment_shipments' then case when w.s ->> 'direction' = 'to_warehouse' then 'ha riportato ' || coalesce(w.pieces_label, 'merce') || ' in magazzino da ' || w.shop
   else 'ha consegnato ' || coalesce(w.pieces_label, 'merce') || ' a ' || w.shop end
  when w.table_name = 'consignment_transfers' then 'ha trasferito merce in conto vendita'
  when w.table_name = 'consignment_sales' then 'ha registrato una vendita in conto vendita'
  when w.area = 'consignment' then 'ha aggiornato il conto vendita'
  when w.area = 'packaging' then 'ha aggiornato il packaging'
  when w.area = 'settings' then 'ha aggiornato le impostazioni del team'
  when w.table_name = 'discount_rules' then 'ha aggiornato uno sconto'
  when w.table_name = 'stock_movements' and w.s ->> 'kind' = 'adjustment' then 'ha rettificato il magazzino'
  when w.table_name = 'stock_movements' and w.s ->> 'kind' = 'opening' then 'ha registrato la conta iniziale del magazzino'
  else 'ha aggiornato il magazzino' end verb,
 -- Same sentence for N actions of one transaction; %s is the number.
 case
  when w.table_name = 'calendar_events' then case w.operation when 'DELETE' then 'ha tolto %s appuntamenti dal calendario' when 'UPDATE' then 'ha modificato %s appuntamenti'
   else case when w.s ->> 'event_type' = 'meeting' then 'ha aggiunto %s call' else 'ha aggiunto %s appuntamenti nel calendario' end end
  when w.table_name = 'tasks' then case when w.operation = 'DELETE' then 'ha eliminato %s attività' when w.operation = 'INSERT' then 'ha aggiunto %s attività'
   when w.s ->> 'status' = 'done' then 'ha completato %s attività' else 'ha aggiornato %s attività' end
  when w.table_name = 'notes' then case w.operation when 'INSERT' then 'ha aggiunto %s note' when 'DELETE' then 'ha eliminato %s note' else 'ha aggiornato %s note' end
  when w.table_name = 'assets' then case when w.operation = 'INSERT' then 'ha aggiunto %s contenuti' when w.operation = 'DELETE' then 'ha eliminato %s contenuti'
   when w.s ->> 'archived_before' = 'false' and w.s ->> 'archived_after' = 'true' then 'ha archiviato %s contenuti'
   when w.s ->> 'archived_before' = 'true' and w.s ->> 'archived_after' = 'false' then 'ha ripristinato %s contenuti' else 'ha aggiornato %s contenuti' end
  when w.table_name = 'product_development_projects' then case w.operation when 'INSERT' then 'ha avviato %s progetti' when 'DELETE' then 'ha eliminato %s progetti' else 'ha aggiornato %s progetti' end
  when w.table_name = 'product_development_photos' then 'ha aggiornato le foto di %s progetti'
  when w.table_name = 'restock_arrivals' then case when w.s ->> 'undone' = 'true' then 'ha annullato l’arrivo di %s riordini' else 'ha caricato in magazzino %s riordini' end
  when w.table_name = 'restock_orders' and w.operation = 'INSERT' then case when w.actor_id is null then 'ha importato %s riordini' else 'ha creato %s riordini' end
  when w.table_name = 'restock_state_events' then 'ha cambiato lo stato di %s riordini'
  when w.table_name = 'restock_lines' then 'ha cambiato le quantità di %s riordini'
  when w.table_name = 'restock_orders' then 'ha aggiornato %s riordini'
  when w.table_name = 'sales_registration_cancellations' then 'ha annullato la registrazione di %s vendite'
  when w.table_name = 'manual_sale_returns' then 'ha registrato %s resi'
  when w.table_name = 'sales_orders' and w.operation = 'INSERT' then case when w.actor_id is null then 'ha ricevuto %s ordini' else 'ha registrato %s vendite' end
  when w.table_name = 'sales_orders' then 'ha aggiornato %s ordini'
  when w.table_name = 'fulfillment_lines' then 'ha registrato %s consegne'
  when w.table_name = 'production_receipts' then 'ha completato %s produzioni'
  when w.payment_action is not null then case w.payment_action when 'delete' then 'ha eliminato %s incassi' when 'update' then 'ha modificato %s incassi' else 'ha registrato %s incassi' end
  when w.table_name = 'shopify_refund_observations' then 'ha registrato %s rimborsi'
  when w.table_name in ('shopify_order_financials', 'shopify_transaction_observations') then 'ha aggiornato i dati di pagamento di %s ordini'
  when w.table_name = 'finance_movement_revisions' then case w.s ->> 'action' when 'delete' then 'ha eliminato %s movimenti Finance' when 'restore' then 'ha ripristinato %s movimenti Finance' else 'ha corretto %s movimenti Finance' end
  when w.table_name = 'finance_import_batches' then 'ha importato %s lotti da BudgetFlow'
  when w.table_name = 'finance_entry_voids' then 'ha annullato %s movimenti Finance'
  when w.table_name = 'finance_documents' then 'ha archiviato %s documenti Finance'
  when w.area = 'finance' then case w.operation when 'INSERT' then 'ha registrato %s movimenti Finance' when 'DELETE' then 'ha eliminato %s movimenti Finance' else 'ha corretto %s movimenti Finance' end
  when w.table_name = 'partner_activities' then case w.s ->> 'kind' when 'inviato' then 'ha registrato %s invii Partner' when 'risposta' then 'ha registrato %s risposte Partner'
   when 'nuovo' then 'ha aggiunto %s contatti in Partner' when 'stato' then 'ha aggiornato lo stato di %s contatti Partner' else 'ha aggiornato %s contatti in Partner' end
  when w.table_name = 'partner_event_sales' then case when w.operation = 'DELETE' then 'ha rimosso %s collegamenti di vendite a eventi Partner' else 'ha collegato %s vendite a eventi Partner' end
  when w.area = 'partner' then 'ha aggiornato %s contatti in Partner'
  when w.area = 'consignment' then 'ha aggiornato il conto vendita (%s operazioni)'
  when w.area = 'packaging' then 'ha aggiornato %s materiali di packaging'
  when w.area = 'settings' then 'ha aggiornato le impostazioni del team'
  when w.table_name = 'discount_rules' then 'ha aggiornato %s sconti'
  when w.table_name = 'stock_movements' and w.s ->> 'kind' = 'adjustment' then 'ha rettificato %s articoli'
  else 'ha aggiornato %s articoli in magazzino' end plural,
 case
  when w.area = 'team' then '/team' || case when w.operation = 'DELETE' or private.activity_feed_uuid(w.entity_id) is null then ''
   when w.table_name = 'calendar_events' then '#evento-' || w.entity_id when w.table_name = 'tasks' then '#attivita-' || w.entity_id else '#nota-' || w.entity_id end
  when w.table_name in ('order_payments', 'shopify_refund_observations', 'shopify_order_financials', 'shopify_transaction_observations')
   then case when private.activity_feed_uuid(w.s ->> 'order_id') is not null then '/sales#order-' || (w.s ->> 'order_id') else '/sales' end
  when w.table_name in ('consignment_report_payments', 'consignment_payment_revisions') then case
   when w.payment_action <> 'delete' and private.activity_feed_uuid(case when w.table_name = 'consignment_report_payments' then w.entity_id else w.s ->> 'payment_id' end) is not null
   then '/finance#movimento-shop_payment-' || case when w.table_name = 'consignment_report_payments' then w.entity_id else w.s ->> 'payment_id' end else '/finance' end
  when w.table_name = 'finance_movement_revisions' then case
   when w.s ->> 'source_kind' in ('manual', 'budgetflow', 'payment', 'refund', 'consignment_settlement') and private.activity_feed_uuid(w.s ->> 'source_id') is not null
   then '/finance#movimento-' || case w.s ->> 'source_kind' when 'consignment_settlement' then 'consignment' else w.s ->> 'source_kind' end || '-' || (w.s ->> 'source_id') else '/finance' end
  when w.table_name = 'finance_entries' and w.operation <> 'DELETE' and private.activity_feed_uuid(w.entity_id) is not null then '/finance#movimento-manual-' || w.entity_id
  when w.table_name = 'finance_entry_voids' and private.activity_feed_uuid(w.s ->> 'entry_id') is not null then '/finance#movimento-manual-' || (w.s ->> 'entry_id')
  when w.area = 'finance' then '/finance'
  when w.area = 'sales' then case when w.root_key like 'sales_orders:%' and private.activity_feed_uuid(split_part(w.root_key, ':', 2)) is not null
   then '/sales#order-' || split_part(w.root_key, ':', 2) else '/sales' end
  when w.area = 'partner' then case when w.partner_co ~ '^[1-9][0-9]{0,4}$' then '/partner?co=' || w.partner_co || '#lead-' || w.partner_co else '/partner' end
  when w.area = 'consignment' then case when w.shop_code ~ '^[A-Z0-9]{2,12}$' then '/consignment/' || w.shop_code
   || case when w.table_name in ('consignment_report_revisions', 'consignment_reports') and w.s ->> 'period' is not null then '/resoconto/' || (w.s ->> 'period') else '' end
   else '/consignment' end
  when w.area = 'assets' then '/assets' || case when w.operation <> 'DELETE' and private.activity_feed_uuid(w.entity_id) is not null then '#contenuto-' || w.entity_id else '' end
  when w.area = 'development' then '/development' || case when w.table_name = 'product_development_photos'
   then coalesce('#progetto-' || private.activity_feed_uuid(w.s ->> 'project_id')::text, '')
   when w.operation <> 'DELETE' and private.activity_feed_uuid(w.entity_id) is not null then '#progetto-' || w.entity_id else '' end
  when w.area = 'packaging' then '/packaging'
  when w.area = 'settings' then '/auth/account'
  when w.root_key like 'restock_orders:%' then '/stock/riassortimento' || coalesce('/' || private.activity_feed_uuid(split_part(w.root_key, ':', 2))::text, '')
  when w.table_name = 'stock_movements' and w.s ->> 'kind' = 'adjustment' then '/stock/rettifiche'
  else '/stock' end href
 from worded w
), sentenced as (
 select p.*,
  case when p.actor_id is null then 'Il sistema' else p.actor_name end actor_label,
  case when p.area in ('team', 'assets', 'development') and p.s ->> 'title' is not null then ': ' || (p.s ->> 'title')
   when p.area = 'partner' and p.partner_name is not null then ': ' || p.partner_name || case when p.partner_co ~ '^[1-9][0-9]{0,4}$' then ' (CO ' || p.partner_co || ')' else '' end
   when p.area = 'sales' and (p.table_name = 'sales_orders' or p.delivered_quantity is not null)
    and (coalesce(p.delivered_quantity, p.order_quantity) is not null or p.channel in ('shopify_web', 'shopify_pos', 'direct', 'etsy'))
    then ' (' || concat_ws(' · ', coalesce(p.delivered_quantity, p.order_quantity)::text || ' unità', case coalesce(p.channel, p.s ->> 'channel')
     when 'shopify_web' then 'Shopify online' when 'shopify_pos' then 'Shopify POS' when 'direct' then 'diretta' when 'etsy' then 'Etsy' end) || ')'
   else '' end suffix,
  to_char(p.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || coalesce(p.actor_id::text, 'system') tx_key,
  p.table_name in ('sales_registration_cancellations', 'manual_sale_returns', 'partner_research_imports', 'partner_device_imports') is_header,
  p.table_name in ('partner_work_links', 'stock_balances', 'commercial_facts', 'production_requirements', 'stock_reservations', 'packaging_consumption_entries',
   'consignment_report_lines', 'consignment_report_movements', 'consignment_count_lines', 'consignment_order_lines', 'consignment_shipment_lines',
   'finance_import_transactions', 'manual_sale_return_lines', 'manual_sale_return_fulfillments', 'manual_sale_return_packaging',
   'shopify_order_financials', 'shopify_transaction_observations', 'partner_import_differences')
   or (p.table_name = 'sales_order_lines' and p.operation = 'INSERT') is_technical,
  case when p.root_key like 'restock_orders:%' then '/stock/riassortimento' else case p.area when 'team' then '/team' when 'sales' then '/sales' when 'consignment' then '/consignment' when 'finance' then '/finance'
   when 'partner' then '/partner' when 'assets' then '/assets' when 'development' then '/development' when 'packaging' then '/packaging'
   when 'settings' then '/auth/account' else '/stock' end end section_href
 from phrases p
), tx as (
 select s.tx_key, bool_or(s.is_header) has_header, bool_or(not s.is_technical) has_main from sentenced s group by s.tx_key
), stats as (
 select to_char(n.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || coalesce(n.actor_id::text, 'system') tx_key,
  count(distinct n.entity_id) filter (where n.table_name = 'partners') partners,
  count(*) filter (where n.table_name = 'stock_items' and n.operation = 'INSERT') new_items
 from nodes n group by 1
), kept as (
 -- A command header (annullamento, reso, import Partner) is the whole transaction. Technical rows
 -- never make their own sentence next to a real action. Two or more new articles: an import.
 select s.*, st.partners, st.new_items,
  case when s.is_header then 'header:' || s.table_name when st.new_items >= 2 and s.area = 'stock' then 'stock_import'
   else 'kind:' || s.area || ':' || s.plural end merge_kind
 from sentenced s join tx t using (tx_key) join stats st using (tx_key)
 where case when t.has_header then s.is_header else not s.is_technical or not t.has_main end
), merged as (
 select k.tx_key, k.merge_kind, min(k.occurred_at) occurred_at, min(k.actor_id::text)::uuid actor_id, min(k.actor_name) actor_name,
  min(k.actor_label) actor_label, min(k.area) area, count(*) n, min(k.group_key) group_key, min(k.table_name) table_name,
  min(k.plural) plural, min(k.partners) partners, min(k.new_items) new_items, min(k.verb) verb,
  (array_agg(k.actor_label || ' ' || k.verb || k.suffix || '.' order by k.group_key))[1] single_message,
  case when count(distinct k.href) = 1 then min(k.href) end common_href, min(k.section_href) section_href
 from kept k group by k.tx_key, k.merge_kind
)
select
 case when m.n = 1 and m.merge_kind <> 'stock_import' and m.table_name not in ('partner_research_imports', 'partner_device_imports')
  then md5(m.group_key)::uuid else md5('tx|' || m.tx_key || '|' || m.merge_kind)::uuid end,
 m.occurred_at, m.actor_id, m.actor_name, m.area,
 case
  when m.merge_kind = 'stock_import' then m.actor_label || ' ha importato ' || private.activity_feed_count(m.new_items, 'articolo', 'articoli') || ' in magazzino.'
  when m.table_name = 'partner_research_imports' and m.partners > 0 then m.actor_label || ' ha importato ' || private.activity_feed_count(m.partners, 'contatto', 'contatti') || ' in Partner.'
  when m.table_name = 'partner_device_imports' and m.partners > 0 then m.actor_label || ' ' || m.verb || ': ' || private.activity_feed_count(m.partners, 'contatto', 'contatti') || '.'
  when m.n = 1 then m.single_message
  else m.actor_label || ' ' || replace(m.plural, '%s', m.n::text) || '.' end,
 case when m.n = 1 and m.merge_kind <> 'stock_import' then m.common_href else coalesce(m.common_href, m.section_href) end
from merged m
$$;

commit;
