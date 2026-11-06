-- La configurazione della scrittura ha una storia separata dalle regole operative.
-- Salvare una versione non cambia lo stato dei lavori o l'idoneità delle bozze pronte.
begin;

create table public.partner_email_config_versions (
  version integer primary key check (version > 0),
  config jsonb not null,
  note text check (char_length(note) <= 1000),
  created_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  operation_id uuid unique,
  check (version = 1 or (created_by is not null and operation_id is not null)),
  check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 1048576
    and coalesce(config #> '{meta,versione}' = to_jsonb(version), false))
);

alter table public.partner_email_config_versions enable row level security;
revoke all on public.partner_email_config_versions from public, anon, authenticated, service_role;
grant select on public.partner_email_config_versions to authenticated, service_role;
create policy member_read on public.partner_email_config_versions for select to authenticated
  using ((select private.is_member()));
create policy service_read on public.partner_email_config_versions for select to service_role
  using (true);

-- Questa cronologia non contiene recapiti: il flag di cancellazione dell'assistente non la riguarda.
create trigger partner_email_config_versions_append_only
  before update or delete on public.partner_email_config_versions
  for each row execute function private.reject_ledger_mutation();

-- Le bozze esistenti, quelle del modello Club e le revisioni umane possono non avere questa versione.
alter table public.partner_assistant_drafts
  add column config_version integer references public.partner_email_config_versions(version);

create function public.save_partner_email_config(
  p_actor_id uuid,
  p_operation_id uuid,
  p_expected_version integer,
  p_config jsonb,
  p_note text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb;
  v_replay jsonb;
  v_current integer;
  v_saved public.partner_email_config_versions%rowtype;
begin
  perform private.partner_assistant_service_required();
  -- Il server passa l'identità verificata. Il database controlla la membership corrente.
  perform 1 from public.memberships m
    where m.user_id = p_actor_id and m.active and m.role = 'founder' for share;
  if not found then
    raise exception 'partner_assistant_founder_required' using errcode = '42501';
  end if;

  -- Zod verifica il contratto completo sul server. Qui si difendono dimensione e forma di base.
  if p_expected_version is null or p_expected_version not between 1 and 2147483646
    or jsonb_typeof(p_config) is distinct from 'object'
    or octet_length(p_config::text) > 1048576
    or jsonb_typeof(p_config -> 'meta') is distinct from 'object'
    or p_config #> '{meta,versione}' is distinct from to_jsonb(p_expected_version)
    or jsonb_typeof(p_config -> 'tono') is distinct from 'string'
    or jsonb_typeof(p_config -> 'blocchi') is distinct from 'array'
    or jsonb_typeof(p_config -> 'formati') is distinct from 'array'
    or jsonb_typeof(p_config -> 'regole_fisse_generali') is distinct from 'array'
    or jsonb_typeof(p_config -> 'lingue') is distinct from 'array'
    or char_length(p_note) > 1000 then
    raise exception 'invalid_partner_email_config' using errcode = '22023';
  end if;

  v_payload := jsonb_build_object('expected_version', p_expected_version, 'config', p_config, 'note', p_note);
  v_replay := private.partner_assistant_begin(p_operation_id, 'save_partner_email_config', p_actor_id, v_payload);
  if v_replay is not null then
    select * into strict v_saved from public.partner_email_config_versions
      where operation_id = p_operation_id;
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.partner_email_config.versions', 0));
    select max(version) into v_current from public.partner_email_config_versions;
    if v_current is distinct from p_expected_version then
      raise exception 'partner_email_config_changed' using errcode = '40001';
    end if;

    insert into public.partner_email_config_versions (version, config, note, created_by, operation_id)
      values (v_current + 1, jsonb_set(p_config, '{meta,versione}', to_jsonb(v_current + 1)),
        p_note, p_actor_id, p_operation_id)
      returning * into v_saved;
    -- La ricevuta non duplica il testo. Il replay legge la riga immutabile identificata dall'operazione.
    perform private.partner_assistant_finish(p_operation_id, 'save_partner_email_config', p_actor_id,
      v_payload, jsonb_build_object('version', v_saved.version));
  end if;
  return to_jsonb(v_saved) - 'operation_id';
end
$$;

revoke all on function public.save_partner_email_config(uuid, uuid, integer, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_partner_email_config(uuid, uuid, integer, jsonb, text)
  to service_role;

commit;
