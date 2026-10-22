-- Archivio dei contenuti in «Grafica e foto» (06 R15). Solo aggiunte: nessuna tabella, funzione o
-- policy esistente cambia, nessuna riga esistente viene riscritta.
--
-- - Due colonne nuove su public.assets, nulle per tutte le righe di oggi: archived_at e archived_by.
--   Archiviare toglie un contenuto dalla libreria per tutti; ripristinare lo riporta. Non si
--   cancella niente: nome, percorso, file nel bucket e metadati restano come sono.
-- - Le due colonne si cambiano solo con il comando set_brand_asset_archived: i client non hanno
--   permessi di scrittura su public.assets (revocati da brand_assets_and_development).
-- - Comando del team come gli altri: private.set_brand_asset_archived(operation_id, payload)
--   security definer, più il wrapper public.set_brand_asset_archived security invoker. Ricevuta
--   per operation_id: lo stesso invio ripetuto restituisce l'esito di allora (replayed true).
--   Archiviare un contenuto già archiviato, o ripristinarne uno attivo, non cambia niente.
-- - Il trigger audit_change già presente su public.assets registra autore, prima e dopo.
--
-- Payload: {"schema_version": 1, "asset_id": "<uuid>", "archived": true | false}.
-- Codici d'errore (messaggio = codice): 42501 asset_access_required; 22023 invalid_asset_payload,
-- asset_not_found; 23505 asset_idempotency_conflict.
begin;

alter table public.assets
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles(user_id);
alter table public.assets
  add constraint assets_archive_pair check ((archived_at is null) = (archived_by is null));
create index assets_archived_by on public.assets(archived_by);

-- Ricevute dei comandi: stesso schema di private.finance_work_receipts. Append-only.
create table private.asset_command_receipts (
  operation_id uuid primary key,
  command_kind text not null check (command_kind in ('set_brand_asset_archived')),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references public.profiles(user_id),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);
alter table private.asset_command_receipts enable row level security;
revoke all on private.asset_command_receipts from public, anon, authenticated;
create trigger asset_command_receipts_append_only before update or delete on private.asset_command_receipts
  for each row execute function private.reject_ledger_mutation();

create function private.set_brand_asset_archived(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_asset_id uuid;
  v_archived boolean;
  v_digest text;
  v_receipt private.asset_command_receipts%rowtype;
  v_row public.assets%rowtype;
  v_changed boolean := false;
  v_result jsonb;
begin
  if v_actor is null or not private.is_member() then
    raise exception 'asset_access_required' using errcode = '42501';
  end if;
  if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object'
    or (p_payload - array['schema_version', 'asset_id', 'archived']) <> '{}'::jsonb
    or not (p_payload ?& array['schema_version', 'asset_id', 'archived'])
    or p_payload -> 'schema_version' is distinct from '1'::jsonb
    or jsonb_typeof(p_payload -> 'archived') is distinct from 'boolean'
    or jsonb_typeof(p_payload -> 'asset_id') is distinct from 'string'
    or (p_payload ->> 'asset_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'invalid_asset_payload' using errcode = '22023';
  end if;
  v_asset_id := (p_payload ->> 'asset_id')::uuid;
  v_archived := (p_payload ->> 'archived')::boolean;

  v_digest := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.assets.' || p_operation_id::text, 0));
  select * into v_receipt from private.asset_command_receipts where operation_id = p_operation_id;
  if found then
    if v_receipt.command_kind <> 'set_brand_asset_archived' or v_receipt.actor_id is distinct from v_actor
      or v_receipt.payload_sha256 <> v_digest then
      raise exception 'asset_idempotency_conflict' using errcode = '23505';
    end if;
    return v_receipt.result || '{"replayed": true}'::jsonb;
  end if;

  select * into v_row from public.assets where id = v_asset_id for update;
  if not found then raise exception 'asset_not_found' using errcode = '22023'; end if;
  if v_archived and v_row.archived_at is null then
    update public.assets set archived_at = now(), archived_by = v_actor
      where id = v_asset_id returning * into v_row;
    v_changed := true;
  elsif not v_archived and v_row.archived_at is not null then
    update public.assets set archived_at = null, archived_by = null
      where id = v_asset_id returning * into v_row;
    v_changed := true;
  end if;

  v_result := jsonb_build_object('operation_id', p_operation_id, 'asset_id', v_asset_id,
    'archived', v_row.archived_at is not null, 'archived_at', v_row.archived_at,
    'changed', v_changed, 'replayed', false);
  insert into private.asset_command_receipts(operation_id, command_kind, payload_sha256, actor_id, result)
    values (p_operation_id, 'set_brand_asset_archived', v_digest, v_actor, v_result);
  return v_result;
end
$$;

create function public.set_brand_asset_archived(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.set_brand_asset_archived(p_operation_id, p_payload)
$$;

revoke all on function private.set_brand_asset_archived(uuid, jsonb), public.set_brand_asset_archived(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function private.set_brand_asset_archived(uuid, jsonb), public.set_brand_asset_archived(uuid, jsonb)
  to authenticated;

commit;
