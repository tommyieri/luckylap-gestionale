-- Partner dentro il gestionale (P2). Solo oggetti nuovi: nessuna tabella, funzione o policy esistente cambia.
--
-- - Nove tabelle pubbliche, lette solo dai membri attivi; nessun grant di scrittura ai client.
-- - Due tabelle private: ricevute dei comandi e lotti in transito dell'import della ricerca.
-- - Audit con private.audit_change_keys: in audit_logs vanno solo le colonne elencate nei trigger.
--   Recapiti, testi della ricerca, testi dei messaggi, note e motivi non ci entrano mai.
-- - Comandi del team: private.<nome>(operation_id, payload) security definer, più il wrapper
--   public.<nome> security invoker. Ricevuta per operation_id, controllo di versione dove serve,
--   una sola riga di registro per contatto e operazione.
-- - Import della ricerca: private.stage_partner_research e private.apply_partner_research,
--   security invoker e senza grant: li esegue solo il proprietario del database.
-- - Lookbook: PDF nel repository (data/partner-lookbooks), nessun bucket e nessuna tabella.
--
-- Codici d'errore (messaggio = codice): 42501 partner_access_required; 22023 invalid_partner_payload,
-- partner_not_found, partner_owner_inactive, partner_contact_unusable, partner_contact_erased,
-- partner_message_no_original, partner_difference_closed, partner_domain_unavailable,
-- partner_not_blocked, partner_co_exhausted; 40001 partner_changed; 23505 partner_idempotency_conflict;
-- 55000 partner_do_not_contact. Import della ricerca: 22023 invalid_partner_research,
-- partner_batch_altered, partner_batch_conflict, partner_import_incomplete.
begin;

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------

-- Una realtà: negozio, evento, club, media o brand.
create table public.partners (
  id uuid primary key default gen_random_uuid(),
  co integer not null unique check (co between 1 and 99999),
  source_key text unique check (source_key ~ '^[A-Za-z0-9]{1,20}$'),
  origin text not null check (origin in ('research', 'team')),
  name text not null check (char_length(name) between 1 and 240 and name = btrim(name)),
  city text not null default '' check (char_length(city) <= 240),
  country text not null default '' check (char_length(country) <= 120),
  type_label text not null default '' check (char_length(type_label) <= 120),
  sections text[] not null check (
    array_ndims(sections) = 1 and array_lower(sections, 1) = 1
    and cardinality(sections) between 1 and 3
    and sections <@ array['vendita', 'eventi', 'collab']::text[]
    and (cardinality(sections) < 2 or sections[1] <> sections[2])
    and (cardinality(sections) < 3 or (sections[1] <> sections[3] and sections[2] <> sections[3]))
  ),
  priority text not null check (priority in ('alta', 'media', 'bassa')),
  contact_month date not null check (extract(day from contact_month) = 1),
  event_starts_on date,
  event_ends_on date,
  application_deadline date,
  preferred_channel text not null default 'web' check (preferred_channel in ('email', 'form', 'ig', 'phone', 'web')),
  research jsonb not null default '{}'::jsonb check (jsonb_typeof(research) = 'object' and pg_column_size(research) <= 65536),
  research_base jsonb not null default '{}'::jsonb check (jsonb_typeof(research_base) = 'object'),
  research_removed_at timestamptz,
  stage text not null default 'da_contattare'
    check (stage in ('da_contattare', 'contattato', 'risposto', 'trattativa', 'chiuso', 'no')),
  stage_from_file_at timestamptz,
  owner_id uuid references public.profiles(user_id),
  next_action text check (next_action is null or (char_length(next_action) between 1 and 240 and next_action = btrim(next_action))),
  next_action_on date,
  chosen_approach text check (chosen_approach in ('vendita', 'evento', 'collab', 'su_misura', 'media')),
  approach_from_file_at timestamptz,
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  created_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id),
  updated_at timestamptz not null default now(),
  check ((origin = 'research') = (source_key is not null)),
  check (event_ends_on is null or (event_starts_on is not null and event_ends_on >= event_starts_on)),
  check ((next_action is null) = (next_action_on is null)),
  check (approach_from_file_at is null or chosen_approach is not null)
);
create index partners_contact_month on public.partners(contact_month);
create index partners_owner on public.partners(owner_id) where owner_id is not null;
create index partners_stage on public.partners(stage);

-- I recapiti, separati dalla scheda per la privacy.
create table public.partner_contacts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id),
  kind text not null check (kind in ('email', 'phone', 'whatsapp', 'instagram', 'form', 'brand_page', 'web')),
  value text check (value is null or char_length(value) between 1 and 500),
  -- Valore pulito per il pulsante, calcolato da private.partner_link_value.
  link_value text check (link_value is null or case kind
    when 'email' then link_value ~ '^[^@\s]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$'
    when 'phone' then link_value ~ '^\+?[0-9]{5,20}$'
    when 'whatsapp' then link_value ~ '^\+?[0-9]{5,20}$'
    when 'instagram' then link_value ~ '^@[A-Za-z0-9_.]{1,30}$'
    else char_length(link_value) <= 2048 and link_value ~ '^https?://[^\s/@?#]+([/?#]\S*)?$' end),
  label text not null default '' check (char_length(label) <= 120),
  verified boolean not null default false,
  active boolean not null default true,
  erased_at timestamptz,
  erased_by uuid references public.profiles(user_id),
  research_slot text check (research_slot is null or research_slot = kind),
  research_value text check (research_value is null or char_length(research_value) between 1 and 500),
  position smallint not null default 0 check (position between 0 and 32000),
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  created_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id),
  updated_at timestamptz not null default now(),
  unique (partner_id, research_slot),
  check ((erased_at is null) = (value is not null)),
  check (erased_at is null or (not active and link_value is null and research_value is null and label = '')),
  check ((erased_at is null) = (erased_by is null))
);

-- Una variante di messaggio per contatto e approccio.
create table public.partner_message_variants (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id),
  approach text not null check (approach in ('vendita', 'evento', 'collab', 'su_misura', 'media')),
  origin text not null check (origin in ('research', 'team')),
  channel text not null check (channel in ('email', 'form', 'dm', 'phone')),
  language text not null check (language in ('en', 'de', 'fr', 'it', 'es')),
  to_text text not null default '' check (char_length(to_text) <= 500),
  cc_text text not null default '' check (char_length(cc_text) <= 500),
  lookbook_code text check (lookbook_code in ('negozi', 'eventi', 'collab', 'porsche_club', 'club')),
  original_subject text not null default '' check (char_length(original_subject) <= 300),
  original_body text not null default '' check (char_length(original_body) <= 8000),
  original_follow_up text not null default '' check (char_length(original_follow_up) <= 4000),
  original_confirm_email text not null default '' check (char_length(original_confirm_email) <= 4000),
  gist_it text not null default '' check (char_length(gist_it) <= 2000),
  notes_it text not null default '' check (char_length(notes_it) <= 4000),
  form_fields_it text not null default '' check (char_length(form_fields_it) <= 4000),
  -- Nullo: vale l'originale. Chiave esterna aggiunta dopo la tabella delle revisioni.
  current_revision_id uuid,
  original_changed_at timestamptz,
  research_removed_at timestamptz,
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  created_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id),
  updated_at timestamptz not null default now(),
  unique (partner_id, approach),
  check (original_changed_at is null or current_revision_id is not null)
);

-- Storico dei testi, append-only.
create table public.partner_message_revisions (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.partner_message_variants(id),
  revision_no integer not null check (revision_no between 1 and 100000),
  kind text not null check (kind in ('edit', 'restore', 'file')),
  subject text check (char_length(subject) <= 300),
  body text check (char_length(body) <= 8000),
  follow_up text check (char_length(follow_up) <= 4000),
  confirm_email text check (char_length(confirm_email) <= 4000),
  file_exported_at timestamptz,
  operation_id uuid not null,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  unique (id, variant_id),
  unique (variant_id, revision_no),
  check (case when kind = 'restore' then num_nonnulls(subject, body, follow_up, confirm_email) = 0
    else num_nonnulls(subject, body, follow_up, confirm_email) = 4 end),
  check ((kind = 'file') = (file_exported_at is not null))
);
alter table public.partner_message_variants
  add constraint partner_message_variants_current_revision
  foreign key (current_revision_id, id) references public.partner_message_revisions(id, variant_id);

-- Registro di ciò che il team fa su un contatto, append-only. Una riga per contatto e operazione.
create table public.partner_activities (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  partner_id uuid not null references public.partners(id),
  partner_name text not null,
  partner_co integer not null,
  kind text not null check (kind in ('inviato', 'risposta', 'chiamata', 'incontro', 'nota', 'stato', 'responsabile',
    'prossima_azione', 'approccio', 'messaggio', 'ripristino', 'scheda', 'nuovo', 'recapito', 'non_contattare', 'differenza')),
  origin text not null default 'team' check (origin in ('team', 'file')),
  occurred_at timestamptz not null default now(),
  message_kind text check (message_kind in ('primo', 'sollecito')),
  channel text check (channel in ('email', 'form', 'dm', 'phone', 'whatsapp', 'visita')),
  approach text check (approach in ('vendita', 'evento', 'collab', 'su_misura', 'media')),
  stage_before text check (stage_before in ('da_contattare', 'contattato', 'risposto', 'trattativa', 'chiuso', 'no')),
  stage_after text check (stage_after in ('da_contattare', 'contattato', 'risposto', 'trattativa', 'chiuso', 'no')),
  owner_after uuid references public.profiles(user_id),
  next_action_on date,
  body text not null default '' check (char_length(body) <= 4000),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  unique (operation_id, partner_id),
  check ((message_kind is not null) = (kind = 'inviato'))
);
create index partner_activities_partner on public.partner_activities(partner_id, occurred_at desc);

-- Lista «non contattare», per contatto e per dominio.
create table public.partner_do_not_contact (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.partners(id),
  domain text check (char_length(domain) <= 253 and domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  reason text not null check (char_length(reason) between 3 and 500 and reason = btrim(reason)),
  active boolean not null default true,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  lifted_by uuid references public.profiles(user_id),
  lifted_at timestamptz,
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  check (num_nonnulls(partner_id, domain) >= 1),
  check (active = (lifted_at is null)),
  check ((lifted_at is null) = (lifted_by is null))
);
create unique index partner_do_not_contact_partner on public.partner_do_not_contact(partner_id) where active;
create unique index partner_do_not_contact_domain on public.partner_do_not_contact(domain) where active;

-- Un import della ricerca applicato, append-only. Nessun dato di contatto.
create table public.partner_research_imports (
  id uuid primary key default gen_random_uuid(),
  normalized_sha256 text not null unique check (normalized_sha256 ~ '^[0-9a-f]{64}$'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_commit text not null check (source_commit ~ '^[0-9a-f]{7,40}$'),
  source_generated date not null,
  batch_count integer not null check (batch_count between 1 and 100),
  partners_total integer not null check (partners_total >= 0),
  partners_new integer not null check (partners_new >= 0),
  partners_updated integer not null check (partners_updated >= 0),
  partners_removed integer not null check (partners_removed >= 0),
  variants_total integer not null check (variants_total >= 0),
  variants_new integer not null check (variants_new >= 0),
  variants_updated integer not null check (variants_updated >= 0),
  differences_new integer not null check (differences_new >= 0),
  context_md text not null default '' check (char_length(context_md) <= 100000),
  applied_at timestamptz not null default now()
);

-- Un file «Esporta» del vecchio sito importato, append-only.
create table public.partner_device_imports (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  file_sha256 text not null unique check (file_sha256 ~ '^[0-9a-f]{64}$'),
  device text not null check (device in ('telefono', 'computer')),
  exported_at timestamptz not null,
  stages_applied integer not null check (stages_applied >= 0),
  texts_applied integer not null check (texts_applied >= 0),
  approaches_applied integer not null check (approaches_applied >= 0),
  differences integer not null check (differences >= 0),
  ignored integer not null check (ignored >= 0),
  unknown integer not null check (unknown >= 0),
  imported_by uuid not null references public.profiles(user_id),
  imported_at timestamptz not null default now()
);

-- Differenze da controllare: il valore del team resta, quello in arrivo aspetta una scelta.
create table public.partner_import_differences (
  id uuid primary key default gen_random_uuid(),
  origin text not null check (origin in ('research', 'file')),
  research_import_id uuid references public.partner_research_imports(id),
  device_import_id uuid references public.partner_device_imports(id),
  partner_id uuid not null references public.partners(id),
  variant_id uuid references public.partner_message_variants(id),
  contact_id uuid references public.partner_contacts(id),
  field text not null check (field in ('name', 'city', 'country', 'type_label', 'sections', 'priority', 'contact_month',
    'event_starts_on', 'event_ends_on', 'preferred_channel', 'contact', 'message', 'stage')),
  team_value jsonb,
  incoming_value jsonb,
  status text not null default 'open' check (status in ('open', 'kept_team', 'used_incoming', 'superseded')),
  resolved_by uuid references public.profiles(user_id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check ((origin = 'research') = (research_import_id is not null) and (origin = 'file') = (device_import_id is not null)),
  check ((status = 'open') = (resolved_at is null)),
  check ((field = 'message') = (variant_id is not null)),
  check ((field = 'contact') = (contact_id is not null))
);
create unique index partner_import_differences_open on public.partner_import_differences(partner_id, field,
  coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'open';
create index partner_import_differences_partner on public.partner_import_differences(partner_id);

-- Ricevute dei comandi: stesso schema di private.finance_work_receipts. Append-only.
create table private.partner_command_receipts (
  operation_id uuid primary key,
  command_kind text not null check (command_kind in ('set_partner_state', 'save_partner', 'record_partner_activity',
    'save_partner_message', 'restore_partner_message', 'save_partner_contact', 'remove_partner_contact',
    'set_partner_do_not_contact', 'resolve_partner_difference', 'import_partner_device_file')),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references public.profiles(user_id),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);

-- Lotti dell'import della ricerca in transito. Si cancellano dopo l'applicazione.
create table private.partner_import_staging (
  normalized_sha256 text not null check (normalized_sha256 ~ '^[0-9a-f]{64}$'),
  batch_index integer not null check (batch_index between 1 and 100),
  batch_count integer not null check (batch_count between 1 and 100),
  payload_text text not null check (octet_length(payload_text) <= 1048576),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  staged_at timestamptz not null default now(),
  primary key (normalized_sha256, batch_index),
  check (batch_index <= batch_count)
);

-- ---------------------------------------------------------------------------
-- Audit con le sole colonne elencate
-- ---------------------------------------------------------------------------

-- Come private.audit_change, ma old_data e new_data portano solo le colonne passate come argomenti
-- del trigger, più _changed (nomi delle colonne cambiate) negli UPDATE. record_key porta id,
-- partner_id e variant_id quando esistono.
create function private.audit_change_keys() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_record jsonb;
  new_record jsonb;
  record_data jsonb;
  changed text[];
begin
  if tg_op <> 'INSERT' then old_record := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_record := to_jsonb(new); end if;
  record_data := coalesce(new_record, old_record);
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into changed
      from jsonb_object_keys(new_record) k where new_record -> k is distinct from old_record -> k;
  end if;
  insert into public.audit_logs(actor_id, table_name, operation, record_key, old_data, new_data)
  values (auth.uid(), tg_table_name, tg_op,
    jsonb_strip_nulls(jsonb_build_object('id', record_data -> 'id', 'partner_id', record_data -> 'partner_id',
      'variant_id', record_data -> 'variant_id')),
    (select jsonb_object_agg(k, old_record -> k) from unnest(tg_argv) k where old_record is not null),
    (select jsonb_object_agg(k, new_record -> k) from unnest(tg_argv) k where new_record is not null)
      || case when tg_op = 'UPDATE' then jsonb_build_object('_changed', to_jsonb(changed)) else '{}'::jsonb end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger audit_change after insert or update or delete on public.partners for each row
  execute function private.audit_change_keys('co', 'source_key', 'name', 'stage', 'owner_id', 'next_action_on',
    'chosen_approach', 'contact_month', 'priority', 'sections', 'research_removed_at', 'version');
create trigger audit_change after insert or update or delete on public.partner_contacts for each row
  execute function private.audit_change_keys('partner_id', 'kind', 'active', 'verified', 'erased_at', 'version');
create trigger audit_change after insert or update or delete on public.partner_message_variants for each row
  execute function private.audit_change_keys('partner_id', 'approach', 'channel', 'language', 'lookbook_code',
    'current_revision_id', 'original_changed_at', 'research_removed_at', 'version');
create trigger audit_change after insert or update or delete on public.partner_message_revisions for each row
  execute function private.audit_change_keys('variant_id', 'revision_no', 'kind', 'created_by');
create trigger audit_change after insert or update or delete on public.partner_activities for each row
  execute function private.audit_change_keys('partner_id', 'partner_name', 'partner_co', 'kind', 'origin',
    'occurred_at', 'message_kind', 'channel', 'approach', 'stage_before', 'stage_after', 'owner_after', 'next_action_on');
create trigger audit_change after insert or update or delete on public.partner_do_not_contact for each row
  execute function private.audit_change_keys('partner_id', 'domain', 'active');
create trigger audit_change after insert or update or delete on public.partner_research_imports for each row
  execute function private.audit_change_keys('source_commit', 'partners_total', 'partners_new', 'partners_updated',
    'partners_removed', 'variants_total', 'differences_new');
create trigger audit_change after insert or update or delete on public.partner_device_imports for each row
  execute function private.audit_change_keys('device', 'exported_at', 'stages_applied', 'texts_applied',
    'approaches_applied', 'differences');
create trigger audit_change after insert or update or delete on public.partner_import_differences for each row
  execute function private.audit_change_keys('origin', 'partner_id', 'variant_id', 'contact_id', 'field', 'status');

create trigger partner_message_revisions_append_only before update or delete on public.partner_message_revisions
  for each row execute function private.reject_ledger_mutation();
create trigger partner_activities_append_only before update or delete on public.partner_activities
  for each row execute function private.reject_ledger_mutation();
create trigger partner_research_imports_append_only before update or delete on public.partner_research_imports
  for each row execute function private.reject_ledger_mutation();
create trigger partner_device_imports_append_only before update or delete on public.partner_device_imports
  for each row execute function private.reject_ledger_mutation();
create trigger partner_command_receipts_append_only before update or delete on private.partner_command_receipts
  for each row execute function private.reject_ledger_mutation();

-- ---------------------------------------------------------------------------
-- RLS e grant delle tabelle
-- ---------------------------------------------------------------------------

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'partners', 'partner_contacts', 'partner_message_variants', 'partner_message_revisions', 'partner_activities',
    'partner_do_not_contact', 'partner_research_imports', 'partner_device_imports', 'partner_import_differences'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('create policy member_read on public.%I for select to authenticated using ((select private.is_member()))', table_name);
  end loop;
  foreach table_name in array array['partner_command_receipts', 'partner_import_staging'] loop
    execute format('alter table private.%I enable row level security', table_name);
    execute format('revoke all on table private.%I from public, anon, authenticated', table_name);
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
      execute format('revoke all on table private.%I from service_role', table_name);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Funzioni di supporto (nessun grant)
-- ---------------------------------------------------------------------------

create function private.partner_stages() returns text[]
language sql immutable set search_path = '' as $$
  select array['da_contattare', 'contattato', 'risposto', 'trattativa', 'chiuso', 'no']::text[]
$$;
create function private.partner_approaches() returns text[]
language sql immutable set search_path = '' as $$
  select array['vendita', 'evento', 'collab', 'su_misura', 'media']::text[]
$$;

create function private.partner_check(p_ok boolean) returns void
language plpgsql set search_path = '' as $$
begin
  if p_ok is not true then raise exception 'invalid_partner_payload' using errcode = '22023'; end if;
end
$$;

-- Oggetto con le chiavi richieste e solo quelle ammesse.
create function private.partner_keys(p jsonb, p_required text[], p_allowed text[]) returns void
language plpgsql stable set search_path = '' as $$
begin
  if jsonb_typeof(p) is distinct from 'object' or not (p ?& p_required) or (p - p_allowed) <> '{}'::jsonb then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
end
$$;

-- Payload di un comando: chiavi come sopra e schema_version = 1.
create function private.partner_payload(p jsonb, p_required text[], p_allowed text[]) returns void
language plpgsql stable set search_path = '' as $$
begin
  perform private.partner_keys(p, p_required, p_allowed);
  if p -> 'schema_version' is distinct from '1'::jsonb or octet_length(p::text) > 1000000 then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
end
$$;

-- Lettori del payload: chiave assente o JSON null → null; tipo o formato sbagliato → errore.
create function private.partner_text(p jsonb, p_key text, p_max integer) returns text
language plpgsql stable set search_path = '' as $$
declare v jsonb := p -> p_key; t text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'string' then raise exception 'invalid_partner_payload' using errcode = '22023'; end if;
  t := v #>> '{}';
  -- Niente caratteri di controllo, tranne tab, a capo e ritorno a capo.
  if char_length(t) > p_max or t ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  return t;
end
$$;

create function private.partner_enum(p jsonb, p_key text, p_allowed text[]) returns text
language plpgsql stable set search_path = '' as $$
declare t text := private.partner_text(p, p_key, 40);
begin
  if t is not null and not (t = any(p_allowed)) then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  return t;
end
$$;

create function private.partner_uuid(p jsonb, p_key text) returns uuid
language plpgsql stable set search_path = '' as $$
declare t text := private.partner_text(p, p_key, 36);
begin
  if t is null then return null; end if;
  if t !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  return t::uuid;
end
$$;

create function private.partner_bigint(p jsonb, p_key text, p_min bigint, p_max bigint) returns bigint
language plpgsql stable set search_path = '' as $$
declare v jsonb := p -> p_key; n bigint;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^-?[0-9]{1,16}$' then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  n := (v #>> '{}')::bigint;
  if n < p_min or n > p_max then raise exception 'invalid_partner_payload' using errcode = '22023'; end if;
  return n;
end
$$;

create function private.partner_bool(p jsonb, p_key text) returns boolean
language plpgsql stable set search_path = '' as $$
declare v jsonb := p -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'boolean' then raise exception 'invalid_partner_payload' using errcode = '22023'; end if;
  return (v #>> '{}')::boolean;
end
$$;

-- Data reale in formato AAAA-MM-GG, tra il 2000 e il 2100.
create function private.partner_date(p jsonb, p_key text) returns date
language plpgsql stable set search_path = '' as $$
declare t text := private.partner_text(p, p_key, 10); d date;
begin
  if t is null then return null; end if;
  if t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_partner_payload' using errcode = '22023'; end if;
  begin
    d := t::date;
  exception when others then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end;
  if d < date '2000-01-01' or d > date '2100-12-31' then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  return d;
end
$$;

-- Mese come AAAA-MM o AAAA-MM-01: restituisce il primo giorno del mese.
create function private.partner_month(p jsonb, p_key text) returns date
language plpgsql stable set search_path = '' as $$
declare t text := private.partner_text(p, p_key, 10);
begin
  if t is null then return null; end if;
  if t ~ '^[0-9]{4}-[0-9]{2}$' then t := t || '-01'; end if;
  if t !~ '^[0-9]{4}-[0-9]{2}-01$' then raise exception 'invalid_partner_payload' using errcode = '22023'; end if;
  return private.partner_date(jsonb_build_object('v', t), 'v');
end
$$;

-- Sezioni distinte, da 1 a 3, nell'ordine canonico vendita, eventi, collab.
create function private.partner_sections(v jsonb) returns text[]
language plpgsql stable set search_path = '' as $$
declare r text[];
begin
  if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) not between 1 and 3
    or exists (select 1 from jsonb_array_elements(v) e
      where jsonb_typeof(e) <> 'string' or (e #>> '{}') not in ('vendita', 'eventi', 'collab'))
    or (select count(distinct e #>> '{}') from jsonb_array_elements(v) e) <> jsonb_array_length(v) then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  select array_agg(s order by array_position(array['vendita', 'eventi', 'collab']::text[], s)) into r
    from (select e #>> '{}' s from jsonb_array_elements(v) e) x;
  return r;
end
$$;

-- Valore pulito per il pulsante di un recapito; null se il testo non ne contiene uno valido.
-- Email: primo indirizzo. Telefono e WhatsApp: primo numero, solo cifre e + iniziale.
-- Instagram: primo @nome, oppure il nome da un link instagram.com/…. Moduli e siti: il testo
-- intero, se è un URL http(s) senza spazi.
create function private.partner_link_value(p_kind text, p_value text) returns text
language plpgsql immutable set search_path = '' as $$
declare m text[]; v text;
begin
  if p_value is null then return null; end if;
  if p_kind = 'email' then
    m := regexp_match(p_value, '([A-Za-z0-9._%+''-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24})');
    v := m[1];
    if v ~ '^[^@\s]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$' then return v; end if;
  elsif p_kind in ('phone', 'whatsapp') then
    m := regexp_match(p_value, '(\+?[0-9][0-9 ().-]{3,}[0-9])');
    if m is not null then
      v := regexp_replace(m[1], '[^0-9]', '', 'g');
      if left(m[1], 1) = '+' then v := '+' || v; end if;
      if v ~ '^\+?[0-9]{5,20}$' then return v; end if;
    end if;
  elsif p_kind = 'instagram' then
    m := regexp_match(p_value, '(?:^|[^A-Za-z0-9_.@/])@([A-Za-z0-9_.]{1,30})');
    if m is null then
      m := regexp_match(p_value, 'instagram\.com/([A-Za-z0-9_.]{1,30})', 'i');
      if m is not null and lower(m[1]) in ('p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts') then
        m := null;
      end if;
    end if;
    v := rtrim(m[1], '.');
    if v ~ '^[A-Za-z0-9_.]{1,30}$' then return '@' || v; end if;
  elsif p_kind in ('form', 'brand_page', 'web') then
    v := btrim(p_value);
    if char_length(v) <= 2048 and v ~ '^https?://[^\s/@?#]+([/?#]\S*)?$' then return v; end if;
  end if;
  return null;
end
$$;

-- Dominio minuscolo da un URL o da un'email, senza www., shop. o store. iniziale.
create function private.partner_domain(p_value text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text;
begin
  if p_value is null then return null; end if;
  if p_value ~* '^https?://' then
    d := lower((regexp_match(p_value, '^https?://([^/:?#@\s]+)', 'i'))[1]);
  elsif p_value ~ '@' then
    d := lower((regexp_match(p_value, '@([A-Za-z0-9.-]+)'))[1]);
  end if;
  d := regexp_replace(rtrim(d, '.'), '^(www|shop|store)\.', '');
  if char_length(d) <= 253 and d ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then return d; end if;
  return null;
end
$$;

-- Indirizzi riconoscibili in un testo, per togliere un dato cancellato dai destinatari dei
-- messaggi: email e @profili in minuscolo, numeri come sole cifre (almeno 6), link senza schema,
-- «www.» e «/» finale, più il testo intero. Con p_kind solo gli indirizzi di quel tipo di recapito.
create function private.partner_recipient_items(p_text text, p_kind text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct x.item), '{}') from (
    select 't:' || lower(btrim(p_text)) item where btrim(coalesce(p_text, '')) <> ''
    union all
    select 'e:' || lower(m[1]) from regexp_matches(coalesce(p_text, ''),
        '([A-Za-z0-9._%+''-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24})', 'g') m
      where p_kind is null or p_kind = 'email'
    union all
    select 'p:' || regexp_replace(m[1], '[^0-9]', '', 'g') from regexp_matches(coalesce(p_text, ''),
        '(\+?[0-9][0-9 ()./-]{4,}[0-9])', 'g') m
      where (p_kind is null or p_kind in ('phone', 'whatsapp'))
        and char_length(regexp_replace(m[1], '[^0-9]', '', 'g')) >= 6
    union all
    select 'h:' || lower(rtrim(m[1], '.')) from regexp_matches(coalesce(p_text, ''),
        '(?:^|[^A-Za-z0-9_.@/])(@[A-Za-z0-9_.]{1,30})', 'g') m
      where p_kind is null or p_kind = 'instagram'
    union all
    select 'h:@' || lower(rtrim(m[1], '.')) from regexp_matches(coalesce(p_text, ''),
        'instagram\.com/([A-Za-z0-9_.]{1,30})', 'gi') m
      where (p_kind is null or p_kind = 'instagram')
        and lower(m[1]) not in ('p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts')
    union all
    select 'u:' || rtrim(regexp_replace(lower(m[1]), '^https?://(www\.)?', ''), '/') from regexp_matches(
        coalesce(p_text, ''), '(https?://[^\s,;<>"]+)', 'gi') m
      where p_kind is null or p_kind in ('instagram', 'form', 'brand_page', 'web')
  ) x
$$;

-- Vero se i due elenchi hanno un indirizzo in comune. Due numeri coincidono anche quando uno
-- finisce con l'altro (prefisso internazionale), se il più corto ha almeno 8 cifre.
create function private.partner_items_overlap(a text[], b text[]) returns boolean
language sql immutable set search_path = '' as $$
  select exists (select 1 from unnest(a) x, unnest(b) y where x = y
    or (left(x, 2) = 'p:' and left(y, 2) = 'p:' and least(char_length(x), char_length(y)) >= 10
      and (right(x, char_length(y) - 2) = substr(y, 3) or right(y, char_length(x) - 2) = substr(x, 3))))
$$;

-- Toglie da un elenco di destinatari («a@x, b@y; c@z») le voci con uno degli indirizzi dati.
-- Senza voci tolte il testo resta identico; altrimenti le voci rimaste si uniscono con «, ».
create function private.partner_strip_recipients(p_text text, p_items text[]) returns text
language plpgsql immutable set search_path = '' as $$
declare v_part text; v_kept text[] := '{}'; v_dropped boolean := false;
begin
  if p_text is null or btrim(p_text) = '' or coalesce(cardinality(p_items), 0) = 0 then return p_text; end if;
  foreach v_part in array regexp_split_to_array(p_text, '[,;\n\r]|\s+/\s+') loop
    v_part := btrim(v_part);
    if v_part = '' then continue; end if;
    if private.partner_items_overlap(private.partner_recipient_items(v_part, null), p_items) then
      v_dropped := true;
    else
      v_kept := v_kept || v_part;
    end if;
  end loop;
  if not v_dropped then return p_text; end if;
  return array_to_string(v_kept, ', ');
end
$$;

-- Attore della sessione: membro attivo, altrimenti 42501.
create function private.partner_actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not private.is_member() then
    raise exception 'partner_access_required' using errcode = '42501';
  end if;
  return v_actor;
end
$$;

-- Ricevute: stessa operazione e stesso payload restituiscono il risultato salvato con replayed true.
create function private.partner_begin(p_operation_id uuid, p_kind text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing private.partner_command_receipts%rowtype; digest text;
begin
  if p_operation_id is null then raise exception 'invalid_partner_payload' using errcode = '22023'; end if;
  digest := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.partner.' || p_operation_id::text, 0));
  select * into existing from private.partner_command_receipts where operation_id = p_operation_id;
  if found then
    if existing.command_kind <> p_kind or existing.actor_id is distinct from auth.uid() or existing.payload_sha256 <> digest then
      raise exception 'partner_idempotency_conflict' using errcode = '23505';
    end if;
    return existing.result || '{"replayed": true}'::jsonb;
  end if;
  return null;
end
$$;

create function private.partner_finish(p_operation_id uuid, p_kind text, p_payload jsonb, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.partner_command_receipts(operation_id, command_kind, payload_sha256, actor_id, result)
    values (p_operation_id, p_kind, encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex'), auth.uid(), p_result);
  return p_result;
end
$$;

-- Una riga di registro, con nome e CO copiati dalla scheda.
create function private.partner_log(
  p_operation_id uuid, p_partner_id uuid, p_kind text, p_actor uuid,
  p_stage_before text default null, p_stage_after text default null, p_approach text default null,
  p_channel text default null, p_message_kind text default null, p_owner_after uuid default null,
  p_next_action_on date default null, p_body text default '', p_origin text default 'team',
  p_occurred_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.partner_activities(operation_id, partner_id, partner_name, partner_co, kind, origin, occurred_at,
    message_kind, channel, approach, stage_before, stage_after, owner_after, next_action_on, body, created_by)
  select p_operation_id, p.id, p.name, p.co, p_kind, p_origin, coalesce(p_occurred_at, now()),
    p_message_kind, p_channel, p_approach, p_stage_before, p_stage_after, p_owner_after, p_next_action_on,
    coalesce(p_body, ''), p_actor
  from public.partners p where p.id = p_partner_id
  returning id into v_id;
  if v_id is null then raise exception 'partner_not_found' using errcode = '22023'; end if;
  return v_id;
end
$$;

-- Cambio di stato: blocca la riga, cambia stage, azzera stage_from_file_at, incrementa version.
-- Con p_log scrive anche la riga «stato» (serve p_operation_id); i comandi che scrivono una loro
-- riga di registro passano p_log => false. Stato già uguale: nessun effetto.
create function private.apply_partner_stage(
  p_partner_id uuid, p_stage text, p_actor uuid, p_operation_id uuid, p_log boolean default true
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_before text; v_version bigint;
begin
  if p_partner_id is null or p_actor is null or p_stage is null or not (p_stage = any(private.partner_stages()))
    or p_log is null or (p_log and p_operation_id is null) then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  select stage, version into v_before, v_version from public.partners where id = p_partner_id for update;
  if not found then raise exception 'partner_not_found' using errcode = '22023'; end if;
  if v_before = p_stage then return v_version; end if;
  update public.partners set stage = p_stage, stage_from_file_at = null, version = version + 1,
      updated_by = p_actor, updated_at = now()
    where id = p_partner_id returning version into v_version;
  if p_log then
    perform private.partner_log(p_operation_id, p_partner_id, 'stato', p_actor, p_stage_before => v_before, p_stage_after => p_stage);
  end if;
  return v_version;
end
$$;

-- Bloccato: riga attiva sua, oppure dominio del suo sito o della sua email in una riga attiva.
create function private.partner_blocked(p_partner_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.partner_do_not_contact d where d.active and d.partner_id = p_partner_id)
    or exists (select 1 from public.partner_do_not_contact d
      join public.partner_contacts c on c.partner_id = p_partner_id and c.kind in ('web', 'email') and c.link_value is not null
      where d.active and d.domain is not null and d.domain = private.partner_domain(c.link_value))
$$;

-- I dieci campi della scheda che l'import della ricerca confronta a tre vie.
create function private.partner_fields(p public.partners) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('name', p.name, 'city', p.city, 'country', p.country, 'type_label', p.type_label,
    'sections', to_jsonb(p.sections), 'priority', p.priority, 'contact_month', p.contact_month,
    'event_starts_on', p.event_starts_on, 'event_ends_on', p.event_ends_on, 'preferred_channel', p.preferred_channel)
$$;

-- Scrive i dieci campi da un oggetto come quello di partner_fields e incrementa version.
create function private.partner_write_fields(p_partner_id uuid, m jsonb, p_actor uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_version bigint;
begin
  update public.partners set
      name = m ->> 'name', city = m ->> 'city', country = m ->> 'country', type_label = m ->> 'type_label',
      sections = array(select s from jsonb_array_elements_text(m -> 'sections') with ordinality t(s, i) order by i),
      priority = m ->> 'priority', contact_month = (m ->> 'contact_month')::date,
      event_starts_on = (m ->> 'event_starts_on')::date, event_ends_on = (m ->> 'event_ends_on')::date,
      preferred_channel = m ->> 'preferred_channel',
      version = version + 1, updated_by = p_actor, updated_at = now()
    where id = p_partner_id returning version into v_version;
  return v_version;
exception when check_violation or not_null_violation then
  raise exception 'invalid_partner_payload' using errcode = '22023';
end
$$;

create function private.partner_message_original(v public.partner_message_variants) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('subject', v.original_subject, 'body', v.original_body,
    'follow_up', v.original_follow_up, 'confirm_email', v.original_confirm_email)
$$;

-- Testo in uso: l'ultima revisione scelta, oppure l'originale.
create function private.partner_message_current(v public.partner_message_variants) returns jsonb
language sql stable set search_path = '' as $$
  select case when v.current_revision_id is null then private.partner_message_original(v)
    else (select jsonb_build_object('subject', r.subject, 'body', r.body, 'follow_up', r.follow_up,
      'confirm_email', r.confirm_email) from public.partner_message_revisions r where r.id = v.current_revision_id) end
$$;

-- Nuova revisione (edit, restore o file) e variante aggiornata. edit e restore azzerano
-- original_changed_at; restore torna all'originale.
create function private.partner_add_revision(
  p_variant_id uuid, p_kind text, p_texts jsonb, p_operation_id uuid, p_actor uuid, p_file_exported_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_no integer; v_id uuid;
begin
  select coalesce(max(revision_no), 0) + 1 into v_no from public.partner_message_revisions where variant_id = p_variant_id;
  insert into public.partner_message_revisions(variant_id, revision_no, kind, subject, body, follow_up, confirm_email,
      file_exported_at, operation_id, created_by)
    values (p_variant_id, v_no, p_kind,
      case when p_kind <> 'restore' then p_texts ->> 'subject' end, case when p_kind <> 'restore' then p_texts ->> 'body' end,
      case when p_kind <> 'restore' then p_texts ->> 'follow_up' end,
      case when p_kind <> 'restore' then p_texts ->> 'confirm_email' end,
      case when p_kind = 'file' then p_file_exported_at end, p_operation_id, p_actor)
    returning id into v_id;
  update public.partner_message_variants set
      current_revision_id = case when p_kind = 'restore' then null else v_id end,
      original_changed_at = case when p_kind = 'file' then original_changed_at end,
      version = version + 1, updated_by = p_actor, updated_at = now()
    where id = p_variant_id;
  return v_id;
end
$$;

-- Chiude le differenze aperte di una chiave. Restituisce quante.
create function private.partner_close_differences(
  p_partner_id uuid, p_field text, p_variant_id uuid, p_contact_id uuid, p_status text, p_actor uuid
) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.partner_import_differences set status = p_status, resolved_by = p_actor, resolved_at = now()
    where partner_id = p_partner_id and field = p_field and variant_id is not distinct from p_variant_id
      and contact_id is not distinct from p_contact_id and status = 'open';
  get diagnostics n = row_count;
  return n;
end
$$;

-- Apre una differenza. Se ce n'è già una aperta con gli stessi valori non fa nulla (false);
-- se ce n'è una aperta con altri valori la segna superseded e ne apre una nuova (true).
create function private.partner_open_difference(
  p_origin text, p_import_id uuid, p_partner_id uuid, p_field text, p_variant_id uuid, p_contact_id uuid,
  p_team jsonb, p_incoming jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.partner_import_differences
      where partner_id = p_partner_id and field = p_field and variant_id is not distinct from p_variant_id
        and contact_id is not distinct from p_contact_id and status = 'open'
        and team_value is not distinct from p_team and incoming_value is not distinct from p_incoming) then
    return false;
  end if;
  perform private.partner_close_differences(p_partner_id, p_field, p_variant_id, p_contact_id, 'superseded', null);
  insert into public.partner_import_differences(origin, research_import_id, device_import_id, partner_id, variant_id,
      contact_id, field, team_value, incoming_value)
    values (p_origin, case when p_origin = 'research' then p_import_id end, case when p_origin = 'file' then p_import_id end,
      p_partner_id, p_variant_id, p_contact_id, p_field, p_team, p_incoming);
  return true;
end
$$;

-- ---------------------------------------------------------------------------
-- Comandi del team
-- ---------------------------------------------------------------------------

-- Stato, responsabile, prossima azione, approccio scelto. Una sola riga di registro.
create function private.set_partner_state(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_id uuid; v_expected bigint; v_stage text; v_owner uuid; v_next text; v_next_on date; v_approach text;
  has_stage boolean; has_owner boolean; has_next boolean; has_approach boolean;
  ch_stage boolean; ch_owner boolean; ch_next boolean; ch_approach boolean;
  p public.partners%rowtype; v_version bigint; v_activity uuid; replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'partner_id', 'expected_version'],
    array['schema_version', 'partner_id', 'expected_version', 'stage', 'owner_id', 'next_action', 'next_action_on', 'chosen_approach']);
  v_id := private.partner_uuid(p_payload, 'partner_id');
  v_expected := private.partner_bigint(p_payload, 'expected_version', 1, 9007199254740991);
  has_stage := p_payload ? 'stage';
  has_owner := p_payload ? 'owner_id';
  has_next := p_payload ? 'next_action' or p_payload ? 'next_action_on';
  has_approach := p_payload ? 'chosen_approach';
  v_stage := private.partner_enum(p_payload, 'stage', private.partner_stages());
  v_owner := private.partner_uuid(p_payload, 'owner_id');
  v_next := btrim(private.partner_text(p_payload, 'next_action', 240));
  v_next_on := private.partner_date(p_payload, 'next_action_on');
  v_approach := private.partner_enum(p_payload, 'chosen_approach', private.partner_approaches());
  perform private.partner_check(v_id is not null and v_expected is not null
    and (has_stage or has_owner or has_next or has_approach)
    and (not has_stage or v_stage is not null)
    and (not has_next or (p_payload ? 'next_action' and p_payload ? 'next_action_on'
      and (v_next is null) = (v_next_on is null) and (v_next is null or v_next <> ''))));
  replay := private.partner_begin(p_operation_id, 'set_partner_state', p_payload);
  if replay is not null then return replay; end if;
  if v_owner is not null and not exists (select 1 from public.memberships where user_id = v_owner and active) then
    raise exception 'partner_owner_inactive' using errcode = '22023';
  end if;
  select * into p from public.partners where id = v_id for update;
  if not found then raise exception 'partner_not_found' using errcode = '22023'; end if;
  if p.version <> v_expected then raise exception 'partner_changed' using errcode = '40001'; end if;
  ch_stage := has_stage and v_stage <> p.stage;
  ch_owner := has_owner and v_owner is distinct from p.owner_id;
  ch_next := has_next and (v_next is distinct from p.next_action or v_next_on is distinct from p.next_action_on);
  ch_approach := has_approach and (v_approach is distinct from p.chosen_approach or p.approach_from_file_at is not null);
  v_version := p.version;
  if ch_stage then
    v_version := private.apply_partner_stage(v_id, v_stage, v_actor, p_operation_id, false);
  end if;
  if ch_owner or ch_next or ch_approach then
    update public.partners set
        owner_id = case when ch_owner then v_owner else owner_id end,
        next_action = case when ch_next then v_next else next_action end,
        next_action_on = case when ch_next then v_next_on else next_action_on end,
        chosen_approach = case when ch_approach then v_approach else chosen_approach end,
        approach_from_file_at = case when ch_approach then null else approach_from_file_at end,
        version = version + case when ch_stage then 0 else 1 end, updated_by = v_actor, updated_at = now()
      where id = v_id returning version into v_version;
  end if;
  if ch_stage or ch_owner or ch_next or ch_approach then
    v_activity := private.partner_log(p_operation_id, v_id,
      case when ch_stage then 'stato' when ch_owner then 'responsabile' when ch_next then 'prossima_azione' else 'approccio' end,
      v_actor,
      p_stage_before => case when ch_stage then p.stage end, p_stage_after => case when ch_stage then v_stage end,
      p_approach => case when ch_approach then v_approach end, p_owner_after => case when ch_owner then v_owner end,
      p_next_action_on => case when ch_next then v_next_on end);
  end if;
  result := jsonb_build_object('id', v_id, 'version', v_version, 'stage', case when ch_stage then v_stage else p.stage end,
    'activity_id', v_activity, 'replayed', false);
  return private.partner_finish(p_operation_id, 'set_partner_state', p_payload, result);
end
$$;

-- Nuovo contatto del team (partner_id null) o modifica della scheda.
create function private.save_partner(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_id uuid; v_expected bigint; v_in jsonb := '{}'::jsonb; v_text text; v_date date; v_field text;
  v_deadline date; v_deadline_set boolean := p_payload ? 'application_deadline';
  p public.partners%rowtype; v_old jsonb; v_new jsonb; v_co integer; v_version bigint; v_activity uuid;
  replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'partner_id'],
    array['schema_version', 'partner_id', 'expected_version', 'name', 'city', 'country', 'type_label', 'sections',
      'priority', 'contact_month', 'event_starts_on', 'event_ends_on', 'preferred_channel', 'application_deadline']);
  v_id := private.partner_uuid(p_payload, 'partner_id');
  v_expected := private.partner_bigint(p_payload, 'expected_version', 1, 9007199254740991);
  if p_payload ? 'name' then
    v_text := btrim(private.partner_text(p_payload, 'name', 240));
    perform private.partner_check(char_length(v_text) between 1 and 240 and v_text !~ '[\r\n]');
    v_in := v_in || jsonb_build_object('name', v_text);
  end if;
  foreach v_field in array array['city', 'country', 'type_label'] loop
    if p_payload ? v_field then
      v_text := btrim(private.partner_text(p_payload, v_field, case v_field when 'city' then 240 else 120 end));
      perform private.partner_check(v_text is not null);
      v_in := v_in || jsonb_build_object(v_field, v_text);
    end if;
  end loop;
  if p_payload ? 'sections' then
    v_in := v_in || jsonb_build_object('sections', to_jsonb(private.partner_sections(p_payload -> 'sections')));
  end if;
  if p_payload ? 'priority' then
    v_text := private.partner_enum(p_payload, 'priority', array['alta', 'media', 'bassa']);
    perform private.partner_check(v_text is not null);
    v_in := v_in || jsonb_build_object('priority', v_text);
  end if;
  if p_payload ? 'contact_month' then
    v_date := private.partner_month(p_payload, 'contact_month');
    perform private.partner_check(v_date is not null);
    v_in := v_in || jsonb_build_object('contact_month', v_date);
  end if;
  foreach v_field in array array['event_starts_on', 'event_ends_on'] loop
    if p_payload ? v_field then
      v_in := v_in || jsonb_build_object(v_field, private.partner_date(p_payload, v_field));
    end if;
  end loop;
  if p_payload ? 'preferred_channel' then
    v_text := private.partner_enum(p_payload, 'preferred_channel', array['email', 'form', 'ig', 'phone', 'web']);
    perform private.partner_check(v_text is not null);
    v_in := v_in || jsonb_build_object('preferred_channel', v_text);
  end if;
  v_deadline := private.partner_date(p_payload, 'application_deadline');
  if v_id is null then
    perform private.partner_check(v_expected is null and v_in ?& array['name', 'sections', 'priority', 'contact_month']);
  else
    perform private.partner_check(v_expected is not null and (v_in <> '{}'::jsonb or v_deadline_set));
  end if;
  replay := private.partner_begin(p_operation_id, 'save_partner', p_payload);
  if replay is not null then return replay; end if;
  if v_id is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.partner.co', 0));
    select coalesce(max(co), 0) + 1 into v_co from public.partners;
    if v_co > 99999 then raise exception 'partner_co_exhausted' using errcode = '22023'; end if;
    begin
      insert into public.partners(co, origin, name, city, country, type_label, sections, priority, contact_month,
          event_starts_on, event_ends_on, application_deadline, preferred_channel, created_by, updated_by)
        values (v_co, 'team', v_in ->> 'name', coalesce(v_in ->> 'city', ''), coalesce(v_in ->> 'country', ''),
          coalesce(v_in ->> 'type_label', ''),
          array(select s from jsonb_array_elements_text(v_in -> 'sections') with ordinality t(s, i) order by i),
          v_in ->> 'priority', (v_in ->> 'contact_month')::date, (v_in ->> 'event_starts_on')::date,
          (v_in ->> 'event_ends_on')::date, v_deadline, coalesce(v_in ->> 'preferred_channel', 'web'), v_actor, v_actor)
        returning * into p;
    exception when check_violation then
      raise exception 'invalid_partner_payload' using errcode = '22023';
    end;
    v_version := p.version;
    v_activity := private.partner_log(p_operation_id, p.id, 'nuovo', v_actor);
  else
    select * into p from public.partners where id = v_id for update;
    if not found then raise exception 'partner_not_found' using errcode = '22023'; end if;
    if p.version <> v_expected then raise exception 'partner_changed' using errcode = '40001'; end if;
    v_old := private.partner_fields(p);
    v_new := v_old || v_in;
    v_version := p.version;
    if v_new <> v_old then v_version := private.partner_write_fields(p.id, v_new, v_actor); end if;
    if v_deadline_set and v_deadline is distinct from p.application_deadline then
      update public.partners set application_deadline = v_deadline,
          version = version + case when v_new <> v_old then 0 else 1 end, updated_by = v_actor, updated_at = now()
        where id = p.id returning version into v_version;
    end if;
    if v_version <> p.version then v_activity := private.partner_log(p_operation_id, p.id, 'scheda', v_actor); end if;
  end if;
  result := jsonb_build_object('id', p.id, 'co', p.co, 'version', v_version, 'activity_id', v_activity, 'replayed', false);
  return private.partner_finish(p_operation_id, 'save_partner', p_payload, result);
end
$$;

-- Registro: inviato, risposta, chiamata, incontro, nota. Nessuna versione attesa.
create function private.record_partner_activity(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_id uuid; v_kind text; v_day date; v_message text; v_channel text; v_approach text; v_body text; v_at timestamptz;
  p public.partners%rowtype; v_stage text; v_set_approach boolean; v_version bigint; v_activity uuid;
  replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'partner_id', 'kind'],
    array['schema_version', 'partner_id', 'kind', 'occurred_on', 'message_kind', 'channel', 'approach', 'body']);
  v_id := private.partner_uuid(p_payload, 'partner_id');
  v_kind := private.partner_enum(p_payload, 'kind', array['inviato', 'risposta', 'chiamata', 'incontro', 'nota']);
  v_day := private.partner_date(p_payload, 'occurred_on');
  v_message := private.partner_enum(p_payload, 'message_kind', array['primo', 'sollecito']);
  v_channel := private.partner_enum(p_payload, 'channel', array['email', 'form', 'dm', 'phone', 'whatsapp', 'visita']);
  v_approach := private.partner_enum(p_payload, 'approach', private.partner_approaches());
  v_body := coalesce(btrim(private.partner_text(p_payload, 'body', 4000)), '');
  perform private.partner_check(v_id is not null and v_kind is not null
    and (v_kind = 'inviato' or v_message is null) and (v_kind <> 'nota' or v_body <> '')
    and (v_day is null or v_day between v_today - 365 and v_today));
  if v_kind = 'inviato' then v_message := coalesce(v_message, 'primo'); end if;
  v_at := case when v_day is null or v_day = v_today then now()
    else (v_day + time '12:00') at time zone 'Europe/Rome' end;
  replay := private.partner_begin(p_operation_id, 'record_partner_activity', p_payload);
  if replay is not null then return replay; end if;
  select * into p from public.partners where id = v_id for update;
  if not found then raise exception 'partner_not_found' using errcode = '22023'; end if;
  if v_kind in ('inviato', 'chiamata', 'incontro') and private.partner_blocked(p.id) then
    raise exception 'partner_do_not_contact' using errcode = '55000';
  end if;
  v_stage := case
    when v_kind = 'inviato' and p.stage = 'da_contattare' then 'contattato'
    when v_kind = 'risposta' and p.stage in ('da_contattare', 'contattato') then 'risposto'
    else p.stage end;
  v_set_approach := v_kind = 'inviato' and v_approach is not null
    and (v_approach is distinct from p.chosen_approach or p.approach_from_file_at is not null);
  v_version := p.version;
  if v_stage <> p.stage then
    v_version := private.apply_partner_stage(p.id, v_stage, v_actor, p_operation_id, false);
  end if;
  if v_set_approach then
    update public.partners set chosen_approach = v_approach, approach_from_file_at = null,
        version = version + case when v_stage <> p.stage then 0 else 1 end, updated_by = v_actor, updated_at = now()
      where id = p.id returning version into v_version;
  end if;
  v_activity := private.partner_log(p_operation_id, p.id, v_kind, v_actor, p_stage_before => p.stage,
    p_stage_after => v_stage, p_approach => v_approach, p_channel => v_channel, p_message_kind => v_message,
    p_body => v_body, p_occurred_at => v_at);
  result := jsonb_build_object('id', p.id, 'version', v_version, 'stage', v_stage, 'activity_id', v_activity,
    'occurred_at', v_at, 'replayed', false);
  return private.partner_finish(p_operation_id, 'record_partner_activity', p_payload, result);
end
$$;

-- Testo del team per una variante (nuova revisione) o variante nuova del team.
create function private.save_partner_message(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_partner uuid; v_approach text; v_expected bigint; v_texts jsonb; v_channel text; v_language text;
  v public.partner_message_variants%rowtype; v_orig jsonb; v_kind text; v_rev uuid; v_version bigint; v_activity uuid;
  replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload,
    array['schema_version', 'partner_id', 'approach', 'expected_version', 'subject', 'body', 'follow_up', 'confirm_email'],
    array['schema_version', 'partner_id', 'approach', 'expected_version', 'subject', 'body', 'follow_up', 'confirm_email',
      'channel', 'language']);
  v_partner := private.partner_uuid(p_payload, 'partner_id');
  v_approach := private.partner_enum(p_payload, 'approach', private.partner_approaches());
  v_expected := private.partner_bigint(p_payload, 'expected_version', 1, 9007199254740991);
  v_texts := jsonb_build_object('subject', private.partner_text(p_payload, 'subject', 300),
    'body', private.partner_text(p_payload, 'body', 8000), 'follow_up', private.partner_text(p_payload, 'follow_up', 4000),
    'confirm_email', private.partner_text(p_payload, 'confirm_email', 4000));
  v_channel := private.partner_enum(p_payload, 'channel', array['email', 'form', 'dm', 'phone']);
  v_language := private.partner_enum(p_payload, 'language', array['en', 'de', 'fr', 'it', 'es']);
  perform private.partner_check(v_partner is not null and v_approach is not null
    and not exists (select 1 from jsonb_each(v_texts) t where jsonb_typeof(t.value) <> 'string')
    and exists (select 1 from jsonb_each_text(v_texts) t where btrim(t.value) <> '')
    and case when v_expected is null then v_channel is not null and v_language is not null
      else not (p_payload ? 'channel' or p_payload ? 'language') end);
  replay := private.partner_begin(p_operation_id, 'save_partner_message', p_payload);
  if replay is not null then return replay; end if;
  perform 1 from public.partners where id = v_partner for update;
  if not found then raise exception 'partner_not_found' using errcode = '22023'; end if;
  select * into v from public.partner_message_variants where partner_id = v_partner and approach = v_approach for update;
  if v_expected is null then
    if found then raise exception 'partner_changed' using errcode = '40001'; end if;
    insert into public.partner_message_variants(partner_id, approach, origin, channel, language, created_by, updated_by)
      values (v_partner, v_approach, 'team', v_channel, v_language, v_actor, v_actor) returning * into v;
    v_rev := private.partner_add_revision(v.id, 'edit', v_texts, p_operation_id, v_actor);
    v_kind := 'messaggio';
  else
    if not found then raise exception 'partner_not_found' using errcode = '22023'; end if;
    if v.version <> v_expected then raise exception 'partner_changed' using errcode = '40001'; end if;
    v_orig := private.partner_message_original(v);
    if v_texts = v_orig and exists (select 1 from jsonb_each_text(v_orig) t where t.value <> '') then
      -- Uguale all'originale: come restore_partner_message.
      if v.current_revision_id is not null then
        v_rev := private.partner_add_revision(v.id, 'restore', null, p_operation_id, v_actor);
        perform private.partner_close_differences(v_partner, 'message', v.id, null, 'used_incoming', v_actor);
        v_kind := 'ripristino';
      end if;
    elsif v_texts <> private.partner_message_current(v) then
      v_rev := private.partner_add_revision(v.id, 'edit', v_texts, p_operation_id, v_actor);
      perform private.partner_close_differences(v_partner, 'message', v.id, null, 'kept_team', v_actor);
      v_kind := 'messaggio';
    end if;
  end if;
  select version into v_version from public.partner_message_variants where id = v.id;
  if v_kind is not null then
    v_activity := private.partner_log(p_operation_id, v_partner, v_kind, v_actor, p_approach => v_approach,
      p_channel => v.channel);
  end if;
  result := jsonb_build_object('id', v.id, 'partner_id', v_partner, 'version', v_version, 'revision_id', v_rev,
    'activity_id', v_activity, 'replayed', false);
  return private.partner_finish(p_operation_id, 'save_partner_message', p_payload, result);
end
$$;

-- Torna al testo originale della ricerca.
create function private.restore_partner_message(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_variant uuid; v_expected bigint; v public.partner_message_variants%rowtype; v_rev uuid; v_activity uuid;
  v_version bigint; replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'variant_id', 'expected_version'],
    array['schema_version', 'variant_id', 'expected_version']);
  v_variant := private.partner_uuid(p_payload, 'variant_id');
  v_expected := private.partner_bigint(p_payload, 'expected_version', 1, 9007199254740991);
  perform private.partner_check(v_variant is not null and v_expected is not null);
  replay := private.partner_begin(p_operation_id, 'restore_partner_message', p_payload);
  if replay is not null then return replay; end if;
  select * into v from public.partner_message_variants where id = v_variant;
  if not found then raise exception 'partner_not_found' using errcode = '22023'; end if;
  perform 1 from public.partners where id = v.partner_id for update;
  select * into v from public.partner_message_variants where id = v_variant for update;
  if v.version <> v_expected then raise exception 'partner_changed' using errcode = '40001'; end if;
  if not exists (select 1 from jsonb_each_text(private.partner_message_original(v)) t where t.value <> '') then
    raise exception 'partner_message_no_original' using errcode = '22023';
  end if;
  if v.current_revision_id is not null then
    v_rev := private.partner_add_revision(v.id, 'restore', null, p_operation_id, v_actor);
    perform private.partner_close_differences(v.partner_id, 'message', v.id, null, 'used_incoming', v_actor);
    v_activity := private.partner_log(p_operation_id, v.partner_id, 'ripristino', v_actor, p_approach => v.approach,
      p_channel => v.channel);
  end if;
  select version into v_version from public.partner_message_variants where id = v.id;
  result := jsonb_build_object('id', v.id, 'partner_id', v.partner_id, 'version', v_version, 'revision_id', v_rev,
    'activity_id', v_activity, 'replayed', false);
  return private.partner_finish(p_operation_id, 'restore_partner_message', p_payload, result);
end
$$;

-- Recapito nuovo (contact_id null) o modificato. Un recapito salvato dal team deve avere un
-- valore utilizzabile dal pulsante.
create function private.save_partner_contact(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_contact uuid; v_partner uuid; v_expected bigint; v_kind text; v_value text; v_label text; v_verified boolean;
  v_link text; c public.partner_contacts%rowtype; v_version bigint; v_activity uuid; replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'contact_id', 'partner_id', 'expected_version', 'kind', 'value'],
    array['schema_version', 'contact_id', 'partner_id', 'expected_version', 'kind', 'value', 'label', 'verified']);
  v_contact := private.partner_uuid(p_payload, 'contact_id');
  v_partner := private.partner_uuid(p_payload, 'partner_id');
  v_expected := private.partner_bigint(p_payload, 'expected_version', 1, 9007199254740991);
  v_kind := private.partner_enum(p_payload, 'kind', array['email', 'phone', 'whatsapp', 'instagram', 'form', 'brand_page', 'web']);
  v_value := btrim(private.partner_text(p_payload, 'value', 500));
  v_label := btrim(private.partner_text(p_payload, 'label', 120));
  v_verified := private.partner_bool(p_payload, 'verified');
  perform private.partner_check(v_partner is not null and v_kind is not null and v_value <> ''
    and (v_contact is null) = (v_expected is null));
  v_link := private.partner_link_value(v_kind, v_value);
  if v_link is null then raise exception 'partner_contact_unusable' using errcode = '22023'; end if;
  replay := private.partner_begin(p_operation_id, 'save_partner_contact', p_payload);
  if replay is not null then return replay; end if;
  perform 1 from public.partners where id = v_partner for update;
  if not found then raise exception 'partner_not_found' using errcode = '22023'; end if;
  if v_contact is null then
    insert into public.partner_contacts(partner_id, kind, value, link_value, label, verified, position, created_by, updated_by)
      values (v_partner, v_kind, v_value, v_link, coalesce(v_label, ''), coalesce(v_verified, false),
        (select coalesce(max(position) + 1, 0) from public.partner_contacts where partner_id = v_partner),
        v_actor, v_actor)
      returning * into c;
    v_version := c.version;
    v_activity := private.partner_log(p_operation_id, v_partner, 'recapito', v_actor);
  else
    select * into c from public.partner_contacts where id = v_contact for update;
    if not found or c.partner_id <> v_partner then raise exception 'partner_not_found' using errcode = '22023'; end if;
    if c.version <> v_expected then raise exception 'partner_changed' using errcode = '40001'; end if;
    if c.erased_at is not null then raise exception 'partner_contact_erased' using errcode = '22023'; end if;
    if c.kind <> v_kind then raise exception 'invalid_partner_payload' using errcode = '22023'; end if;
    v_version := c.version;
    if row(c.value, c.label, c.verified, c.active)
        is distinct from row(v_value, coalesce(v_label, c.label), coalesce(v_verified, c.verified), true) then
      update public.partner_contacts set value = v_value, link_value = v_link, label = coalesce(v_label, label),
          verified = coalesce(v_verified, verified), active = true, version = version + 1,
          updated_by = v_actor, updated_at = now()
        where id = c.id returning version into v_version;
      v_activity := private.partner_log(p_operation_id, v_partner, 'recapito', v_actor);
    end if;
  end if;
  result := jsonb_build_object('id', c.id, 'partner_id', v_partner, 'version', v_version, 'activity_id', v_activity,
    'replayed', false);
  return private.partner_finish(p_operation_id, 'save_partner_contact', p_payload, result);
end
$$;

-- Rimuove un recapito (recuperabile) o cancella il dato (definitivo: anche dalle differenze e dai
-- destinatari dei messaggi dello stesso contatto).
create function private.remove_partner_contact(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_contact uuid; v_expected bigint; v_erase boolean; c public.partner_contacts%rowtype; v_version bigint;
  v_activity uuid; replay jsonb; result jsonb; v_items text[]; v_cleaned integer := 0;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'contact_id', 'expected_version', 'erase'],
    array['schema_version', 'contact_id', 'expected_version', 'erase']);
  v_contact := private.partner_uuid(p_payload, 'contact_id');
  v_expected := private.partner_bigint(p_payload, 'expected_version', 1, 9007199254740991);
  v_erase := private.partner_bool(p_payload, 'erase');
  perform private.partner_check(v_contact is not null and v_expected is not null and v_erase is not null);
  replay := private.partner_begin(p_operation_id, 'remove_partner_contact', p_payload);
  if replay is not null then return replay; end if;
  select * into c from public.partner_contacts where id = v_contact;
  if not found then raise exception 'partner_not_found' using errcode = '22023'; end if;
  perform 1 from public.partners where id = c.partner_id for update;
  select * into c from public.partner_contacts where id = v_contact for update;
  if c.version <> v_expected then raise exception 'partner_changed' using errcode = '40001'; end if;
  if c.erased_at is not null then raise exception 'partner_contact_erased' using errcode = '22023'; end if;
  v_version := c.version;
  if v_erase then
    v_items := private.partner_recipient_items(c.value, c.kind) || private.partner_recipient_items(c.research_value, c.kind);
    update public.partner_contacts set value = null, link_value = null, label = '', research_value = null,
        active = false, erased_at = now(), erased_by = v_actor, version = version + 1, updated_by = v_actor, updated_at = now()
      where id = c.id returning version into v_version;
    -- Il dato sparisce anche dalle differenze che lo riportano.
    update public.partner_import_differences set team_value = null, incoming_value = null,
        resolved_by = case when status = 'open' then v_actor else resolved_by end,
        resolved_at = case when status = 'open' then now() else resolved_at end,
        status = case when status = 'open' then 'superseded' else status end
      where contact_id = c.id;
    -- … e dai destinatari dei messaggi («A», «Cc»), che la ricerca copia dai recapiti.
    with cleaned as (
      update public.partner_message_variants
          set to_text = private.partner_strip_recipients(to_text, v_items),
            cc_text = private.partner_strip_recipients(cc_text, v_items),
            version = version + 1, updated_by = v_actor, updated_at = now()
        where partner_id = c.partner_id
          and (to_text <> private.partner_strip_recipients(to_text, v_items)
            or cc_text <> private.partner_strip_recipients(cc_text, v_items))
        returning 1)
    select count(*) into v_cleaned from cleaned;
  elsif c.active then
    update public.partner_contacts set active = false, version = version + 1, updated_by = v_actor, updated_at = now()
      where id = c.id returning version into v_version;
  end if;
  if v_version <> c.version then
    v_activity := private.partner_log(p_operation_id, c.partner_id, 'recapito', v_actor);
  end if;
  result := jsonb_build_object('id', c.id, 'partner_id', c.partner_id, 'version', v_version, 'erased', v_erase,
    'messages_cleaned', v_cleaned, 'activity_id', v_activity, 'replayed', false);
  return private.partner_finish(p_operation_id, 'remove_partner_contact', p_payload, result);
end
$$;

-- Mette o toglie un contatto dalla lista «non contattare». Con include_domain blocca anche il
-- dominio del sito del contatto.
create function private.set_partner_do_not_contact(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_partner uuid; v_active boolean; v_reason text; v_include boolean; v_domain text;
  d public.partner_do_not_contact%rowtype; v_block uuid; v_changed boolean := false; v_activity uuid;
  replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'partner_id', 'active'],
    array['schema_version', 'partner_id', 'active', 'reason', 'include_domain']);
  v_partner := private.partner_uuid(p_payload, 'partner_id');
  v_active := private.partner_bool(p_payload, 'active');
  v_reason := btrim(private.partner_text(p_payload, 'reason', 500));
  v_include := coalesce(private.partner_bool(p_payload, 'include_domain'), false);
  perform private.partner_check(v_partner is not null and v_active is not null
    and (not v_active or char_length(v_reason) between 3 and 500));
  replay := private.partner_begin(p_operation_id, 'set_partner_do_not_contact', p_payload);
  if replay is not null then return replay; end if;
  perform 1 from public.partners where id = v_partner for update;
  if not found then raise exception 'partner_not_found' using errcode = '22023'; end if;
  select * into d from public.partner_do_not_contact where partner_id = v_partner and active for update;
  if v_active then
    if v_include then
      select private.partner_domain(c.link_value) into v_domain from public.partner_contacts c
        where c.partner_id = v_partner and c.kind = 'web' and c.link_value is not null
          and private.partner_domain(c.link_value) is not null
        order by c.active desc, c.position, c.created_at limit 1;
      if v_domain is null then raise exception 'partner_domain_unavailable' using errcode = '22023'; end if;
      -- Un dominio già bloccato da un'altra riga resta in quella.
      if exists (select 1 from public.partner_do_not_contact x where x.active and x.domain = v_domain
          and x.id is distinct from d.id) then
        v_domain := null;
      end if;
    end if;
    if d.id is null then
      insert into public.partner_do_not_contact(partner_id, domain, reason, created_by)
        values (v_partner, v_domain, v_reason, v_actor) returning id into v_block;
      v_changed := true;
    else
      v_block := d.id;
      if d.reason <> v_reason or (v_domain is not null and d.domain is distinct from v_domain) then
        update public.partner_do_not_contact set reason = v_reason, domain = coalesce(v_domain, domain), version = version + 1
          where id = d.id;
        v_changed := true;
      end if;
    end if;
  else
    if d.id is null then raise exception 'partner_not_blocked' using errcode = '22023'; end if;
    update public.partner_do_not_contact set active = false, lifted_by = v_actor, lifted_at = now(), version = version + 1
      where id = d.id;
    v_block := d.id;
    v_changed := true;
  end if;
  if v_changed then
    v_activity := private.partner_log(p_operation_id, v_partner, 'non_contattare', v_actor);
  end if;
  result := jsonb_build_object('id', v_partner, 'block_id', v_block, 'active', v_active,
    'blocked', private.partner_blocked(v_partner), 'activity_id', v_activity, 'replayed', false);
  return private.partner_finish(p_operation_id, 'set_partner_do_not_contact', p_payload, result);
end
$$;

-- Risolve una differenza: tiene il valore del team o usa quello in arrivo.
create function private.resolve_partner_difference(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_difference uuid; v_choice text; v_expected bigint; x public.partner_import_differences%rowtype;
  p public.partners%rowtype; v public.partner_message_variants%rowtype; c public.partner_contacts%rowtype;
  v_version bigint; v_stage_after text; v_value text; v_exported timestamptz; v_activity uuid; replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'difference_id', 'choice', 'expected_version'],
    array['schema_version', 'difference_id', 'choice', 'expected_version']);
  v_difference := private.partner_uuid(p_payload, 'difference_id');
  v_choice := private.partner_enum(p_payload, 'choice', array['kept_team', 'used_incoming']);
  v_expected := private.partner_bigint(p_payload, 'expected_version', 1, 9007199254740991);
  perform private.partner_check(v_difference is not null and v_choice is not null and v_expected is not null);
  replay := private.partner_begin(p_operation_id, 'resolve_partner_difference', p_payload);
  if replay is not null then return replay; end if;
  select * into x from public.partner_import_differences where id = v_difference;
  if not found then raise exception 'partner_not_found' using errcode = '22023'; end if;
  select * into p from public.partners where id = x.partner_id for update;
  select * into x from public.partner_import_differences where id = v_difference for update;
  if x.status <> 'open' then raise exception 'partner_difference_closed' using errcode = '22023'; end if;
  if x.field = 'message' then
    select * into v from public.partner_message_variants where id = x.variant_id for update;
    v_version := v.version;
  elsif x.field = 'contact' then
    select * into c from public.partner_contacts where id = x.contact_id for update;
    v_version := c.version;
  else
    v_version := p.version;
  end if;
  if v_version <> v_expected then raise exception 'partner_changed' using errcode = '40001'; end if;
  if v_choice = 'kept_team' then
    if x.field = 'message' and v.original_changed_at is not null then
      update public.partner_message_variants set original_changed_at = null, version = version + 1,
          updated_by = v_actor, updated_at = now()
        where id = v.id returning version into v_version;
    end if;
  elsif x.field = 'stage' then
    v_stage_after := x.incoming_value #>> '{}';
    v_version := private.apply_partner_stage(p.id, v_stage_after, v_actor, p_operation_id, false);
  elsif x.field = 'message' then
    if x.origin = 'research' then
      if v.current_revision_id is not null then
        perform private.partner_add_revision(v.id, 'restore', null, p_operation_id, v_actor);
      end if;
    else
      select exported_at into v_exported from public.partner_device_imports where id = x.device_import_id;
      perform private.partner_add_revision(v.id, 'file', x.incoming_value, p_operation_id, v_actor, v_exported);
    end if;
    select version into v_version from public.partner_message_variants where id = v.id;
  elsif x.field = 'contact' then
    if c.erased_at is not null then raise exception 'partner_contact_erased' using errcode = '22023'; end if;
    v_value := x.incoming_value ->> 'value';
    if v_value is null then
      update public.partner_contacts set active = false, version = version + 1, updated_by = v_actor, updated_at = now()
        where id = c.id returning version into v_version;
    else
      update public.partner_contacts set value = v_value, link_value = private.partner_link_value(c.kind, v_value),
          verified = coalesce((x.incoming_value ->> 'verified')::boolean, verified), active = true,
          version = version + 1, updated_by = v_actor, updated_at = now()
        where id = c.id returning version into v_version;
    end if;
  else
    v_version := private.partner_write_fields(p.id, private.partner_fields(p) || jsonb_build_object(x.field, x.incoming_value),
      v_actor);
  end if;
  update public.partner_import_differences set status = v_choice, resolved_by = v_actor, resolved_at = now()
    where id = x.id;
  v_activity := private.partner_log(p_operation_id, p.id, 'differenza', v_actor,
    p_stage_before => case when v_stage_after is not null then p.stage end, p_stage_after => v_stage_after);
  result := jsonb_build_object('id', x.id, 'partner_id', p.id, 'field', x.field, 'choice', v_choice, 'version', v_version,
    'activity_id', v_activity, 'replayed', false);
  return private.partner_finish(p_operation_id, 'resolve_partner_difference', p_payload, result);
end
$$;

-- ---------------------------------------------------------------------------
-- File «Esporta» del vecchio sito
-- ---------------------------------------------------------------------------

-- Payload normalizzato dal parser TypeScript (src/lib/partner/device-file.ts):
-- { schema_version: 1, file_sha256, device: telefono|computer, exported_at: ISO,
--   stages: { L014: "contattato" }, texts: { "L014|collab|body": "testo" },
--   approaches: { L014: "collab" }, names: { L014: "Nome" } }
create function private.partner_device_payload(p jsonb) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare v_exported timestamptz; v_map text; v_key text; v_value jsonb;
begin
  perform private.partner_payload(p,
    array['schema_version', 'file_sha256', 'device', 'exported_at', 'stages', 'texts', 'approaches', 'names'],
    array['schema_version', 'file_sha256', 'device', 'exported_at', 'stages', 'texts', 'approaches', 'names']);
  perform private.partner_check(coalesce(private.partner_text(p, 'file_sha256', 64), '') ~ '^[0-9a-f]{64}$'
    and private.partner_enum(p, 'device', array['telefono', 'computer']) is not null
    and coalesce(private.partner_text(p, 'exported_at', 40), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:?[0-9]{2})$');
  begin
    v_exported := (p ->> 'exported_at')::timestamptz;
  exception when others then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end;
  perform private.partner_check(v_exported > timestamptz '2020-01-01 00:00:00+00' and v_exported <= now() + interval '1 day');
  foreach v_map in array array['stages', 'texts', 'approaches', 'names'] loop
    perform private.partner_check(jsonb_typeof(p -> v_map) = 'object'
      and (select count(*) from jsonb_object_keys(p -> v_map)) <= 2000);
    for v_key, v_value in select key, value from jsonb_each(p -> v_map) loop
      perform private.partner_check(case v_map
        when 'texts' then v_key ~ '^[A-Za-z0-9]{1,20}\|(vendita|evento|collab|su_misura|media)\|(subject|body|follow_up|confirm_email)$'
        else v_key ~ '^[A-Za-z0-9]{1,20}$' end);
      perform private.partner_check(case v_map
        when 'stages' then private.partner_enum(jsonb_build_object('v', v_value), 'v', private.partner_stages()) is not null
        when 'approaches' then private.partner_enum(jsonb_build_object('v', v_value), 'v', private.partner_approaches()) is not null
        when 'names' then private.partner_text(jsonb_build_object('v', v_value), 'v', 240) is not null
        else private.partner_text(jsonb_build_object('v', v_value), 'v', case split_part(v_key, '|', 3)
          when 'subject' then 300 when 'body' then 8000 else 4000 end) is not null end);
    end loop;
  end loop;
  return v_exported;
end
$$;

-- Piano dell'import di un file, senza scritture. La stessa funzione serve all'anteprima e all'import.
-- Ogni voce: kind (stage, approach, text, unknown), action (apply, difference, ignored, superseded, unknown).
create function private.partner_device_plan(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_exported timestamptz := (p ->> 'exported_at')::timestamptz;
  v_key text; v_approach text; v_field text; v_value text; v_action text;
  pr public.partners%rowtype; v public.partner_message_variants%rowtype; v_rev public.partner_message_revisions%rowtype;
  v_orig jsonb; v_cur jsonb; v_new jsonb; v_items jsonb := '[]'::jsonb; v_names jsonb := '[]'::jsonb;
  v_unknown jsonb := '[]'::jsonb; n_stage integer := 0; n_text integer := 0; n_approach integer := 0; n_diff integer := 0;
  n_ignored integer := 0; n_unknown integer := 0; n_entries integer;
begin
  for v_key in
    select k from (
      select jsonb_object_keys(p -> 'stages') k
      union select jsonb_object_keys(p -> 'approaches')
      union select split_part(t, '|', 1) from jsonb_object_keys(p -> 'texts') t
      union select jsonb_object_keys(p -> 'names')
    ) keys order by k
  loop
    select * into pr from public.partners where source_key = v_key;
    if not found then
      n_entries := (case when p -> 'stages' ? v_key then 1 else 0 end) + (case when p -> 'approaches' ? v_key then 1 else 0 end)
        + (select count(distinct split_part(t, '|', 2)) from jsonb_object_keys(p -> 'texts') t where split_part(t, '|', 1) = v_key);
      n_unknown := n_unknown + n_entries;
      if n_entries > 0 then v_unknown := v_unknown || to_jsonb(v_key); end if;
      continue;
    end if;
    if p -> 'names' ? v_key and (p -> 'names' ->> v_key) is distinct from pr.name then
      v_names := v_names || jsonb_build_object('source_key', v_key, 'co', pr.co, 'file_name', p -> 'names' ->> v_key, 'name', pr.name);
    end if;
    if p -> 'stages' ? v_key then
      v_value := p -> 'stages' ->> v_key;
      if v_value = 'da_contattare' or v_value = pr.stage then
        v_action := 'ignored';
      elsif pr.stage_from_file_at is not null then
        v_action := case when pr.stage_from_file_at < v_exported then 'apply' else 'superseded' end;
      elsif pr.stage = 'da_contattare' and not exists (select 1 from public.partner_activities a
          where a.partner_id = pr.id and a.origin = 'team' and a.stage_after is not null
            and a.stage_before is distinct from a.stage_after) then
        v_action := 'apply';
      else
        v_action := 'difference';
      end if;
      v_items := v_items || jsonb_build_object('kind', 'stage', 'source_key', v_key, 'co', pr.co, 'partner_id', pr.id,
        'action', v_action, 'from', pr.stage, 'to', v_value);
      if v_action = 'apply' then n_stage := n_stage + 1;
      elsif v_action = 'difference' then n_diff := n_diff + 1;
      else n_ignored := n_ignored + 1; end if;
    end if;
    if p -> 'approaches' ? v_key then
      v_value := p -> 'approaches' ->> v_key;
      v_action := case when pr.chosen_approach is null
          or (pr.approach_from_file_at < v_exported and pr.chosen_approach <> v_value) then 'apply' else 'ignored' end;
      v_items := v_items || jsonb_build_object('kind', 'approach', 'source_key', v_key, 'co', pr.co, 'partner_id', pr.id,
        'action', v_action, 'to', v_value);
      if v_action = 'apply' then n_approach := n_approach + 1; else n_ignored := n_ignored + 1; end if;
    end if;
    for v_approach in
      select distinct split_part(t, '|', 2) from jsonb_object_keys(p -> 'texts') t where split_part(t, '|', 1) = v_key order by 1
    loop
      select * into v from public.partner_message_variants where partner_id = pr.id and approach = v_approach;
      if not found then
        n_unknown := n_unknown + 1;
        v_items := v_items || jsonb_build_object('kind', 'text', 'source_key', v_key, 'co', pr.co, 'partner_id', pr.id,
          'approach', v_approach, 'action', 'unknown');
        continue;
      end if;
      v_orig := private.partner_message_original(v);
      v_cur := private.partner_message_current(v);
      v_new := v_orig;
      foreach v_field in array array['subject', 'body', 'follow_up', 'confirm_email'] loop
        if p -> 'texts' ? (v_key || '|' || v_approach || '|' || v_field) then
          v_new := v_new || jsonb_build_object(v_field, p -> 'texts' ->> (v_key || '|' || v_approach || '|' || v_field));
        end if;
      end loop;
      v_rev := null;
      if v.current_revision_id is not null then
        select * into v_rev from public.partner_message_revisions where id = v.current_revision_id;
      end if;
      if v_new = v_orig or v_new = v_cur then
        v_action := 'ignored';
      elsif v.current_revision_id is null then
        v_action := 'apply';
      elsif v_rev.kind = 'file' then
        v_action := case when v_rev.file_exported_at < v_exported then 'apply' else 'superseded' end;
      else
        v_action := 'difference';
      end if;
      v_items := v_items || jsonb_build_object('kind', 'text', 'source_key', v_key, 'co', pr.co, 'partner_id', pr.id,
        'variant_id', v.id, 'approach', v_approach, 'channel', v.channel, 'action', v_action, 'texts', v_new, 'current', v_cur);
      if v_action = 'apply' then n_text := n_text + 1;
      elsif v_action = 'difference' then n_diff := n_diff + 1;
      else n_ignored := n_ignored + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('items', v_items, 'names_changed', v_names, 'unknown_keys', v_unknown,
    'counts', jsonb_build_object('stages_applied', n_stage, 'texts_applied', n_text, 'approaches_applied', n_approach,
      'differences', n_diff, 'ignored', n_ignored, 'unknown', n_unknown));
end
$$;

-- Anteprima per la pagina /partner/dati: nessuna scrittura, nessun testo dei messaggi.
create function private.preview_partner_device_file(p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_plan jsonb; v_existing public.partner_device_imports%rowtype;
begin
  perform private.partner_actor();
  perform private.partner_device_payload(p_payload);
  v_plan := private.partner_device_plan(p_payload);
  select * into v_existing from public.partner_device_imports where file_sha256 = p_payload ->> 'file_sha256';
  return jsonb_build_object('file_sha256', p_payload ->> 'file_sha256', 'device', p_payload ->> 'device',
    'exported_at', (p_payload ->> 'exported_at')::timestamptz,
    'already_imported', v_existing.id is not null, 'device_import_id', v_existing.id,
    'file', jsonb_build_object(
      'stages', (select count(*) from jsonb_object_keys(p_payload -> 'stages')),
      'texts', (select count(distinct split_part(t, '|', 1) || '|' || split_part(t, '|', 2)) from jsonb_object_keys(p_payload -> 'texts') t),
      'approaches', (select count(*) from jsonb_object_keys(p_payload -> 'approaches'))),
    'plan', v_plan -> 'counts',
    'differences', coalesce((select jsonb_agg(jsonb_build_object('kind', i ->> 'kind', 'source_key', i ->> 'source_key',
        'co', (i ->> 'co')::integer, 'approach', i ->> 'approach', 'from', i ->> 'from', 'to', i ->> 'to'))
      from jsonb_array_elements(v_plan -> 'items') i where i ->> 'action' = 'difference'), '[]'::jsonb),
    'names_changed', v_plan -> 'names_changed', 'unknown_keys', v_plan -> 'unknown_keys');
end
$$;

-- Importa un file: stati, testi e approcci, mai sopra il lavoro del team. Lo stesso file già
-- importato restituisce il resoconto di allora.
create function private.import_partner_device_file(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_exported timestamptz; v_existing public.partner_device_imports%rowtype; v_old_result jsonb; v_plan jsonb;
  v_import uuid; i jsonb; v_partner uuid; v_stage jsonb; v_texts jsonb; v_approach jsonb;
  v_activity_approach text; v_channel text; v_kind text; v_preferred text; replay jsonb; result jsonb;
begin
  v_exported := private.partner_device_payload(p_payload);
  replay := private.partner_begin(p_operation_id, 'import_partner_device_file', p_payload);
  if replay is not null then return replay; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.partner.device', 0));
  select * into v_existing from public.partner_device_imports where file_sha256 = p_payload ->> 'file_sha256';
  if found then
    select r.result into v_old_result from private.partner_command_receipts r where r.operation_id = v_existing.operation_id;
    return private.partner_finish(p_operation_id, 'import_partner_device_file', p_payload, v_old_result)
      || '{"replayed": true}'::jsonb;
  end if;
  perform 1 from public.partners where source_key in (
      select jsonb_object_keys(p_payload -> 'stages') union select jsonb_object_keys(p_payload -> 'approaches')
      union select split_part(t, '|', 1) from jsonb_object_keys(p_payload -> 'texts') t)
    order by id for update;
  v_plan := private.partner_device_plan(p_payload);
  insert into public.partner_device_imports(operation_id, file_sha256, device, exported_at, stages_applied, texts_applied,
      approaches_applied, differences, ignored, unknown, imported_by)
    values (p_operation_id, p_payload ->> 'file_sha256', p_payload ->> 'device', v_exported,
      (v_plan -> 'counts' ->> 'stages_applied')::integer, (v_plan -> 'counts' ->> 'texts_applied')::integer,
      (v_plan -> 'counts' ->> 'approaches_applied')::integer, (v_plan -> 'counts' ->> 'differences')::integer,
      (v_plan -> 'counts' ->> 'ignored')::integer, (v_plan -> 'counts' ->> 'unknown')::integer, v_actor)
    returning id into v_import;
  for v_partner in
    select distinct (x ->> 'partner_id')::uuid from jsonb_array_elements(v_plan -> 'items') x
      where x ->> 'action' in ('apply', 'difference')
  loop
    v_stage := null; v_approach := null;
    v_texts := '[]'::jsonb;
    for i in select x from jsonb_array_elements(v_plan -> 'items') x
        where (x ->> 'partner_id')::uuid = v_partner and x ->> 'action' in ('apply', 'difference')
    loop
      if i ->> 'action' = 'difference' then
        if i ->> 'kind' = 'stage' then
          perform private.partner_open_difference('file', v_import, v_partner, 'stage', null, null,
            to_jsonb(i ->> 'from'), to_jsonb(i ->> 'to'));
        else
          perform private.partner_open_difference('file', v_import, v_partner, 'message', (i ->> 'variant_id')::uuid, null,
            i -> 'current', i -> 'texts');
        end if;
      elsif i ->> 'kind' = 'stage' then
        perform private.apply_partner_stage(v_partner, i ->> 'to', v_actor, p_operation_id, false);
        update public.partners set stage_from_file_at = v_exported where id = v_partner;
        v_stage := i;
      elsif i ->> 'kind' = 'approach' then
        update public.partners set chosen_approach = i ->> 'to', approach_from_file_at = v_exported,
            version = version + 1, updated_by = v_actor, updated_at = now()
          where id = v_partner;
        v_approach := i;
      else
        perform private.partner_add_revision((i ->> 'variant_id')::uuid, 'file', i -> 'texts', p_operation_id, v_actor,
          v_exported);
        v_texts := v_texts || i;
      end if;
    end loop;
    -- Una riga di registro per contatto toccato; il tipo segue lo stato applicato.
    if v_stage is null and v_approach is null and jsonb_array_length(v_texts) = 0 then continue; end if;
    select chosen_approach, preferred_channel into v_activity_approach, v_preferred from public.partners where id = v_partner;
    if v_stage is not null then
      v_kind := case v_stage ->> 'to' when 'contattato' then 'inviato' when 'risposto' then 'risposta'
        when 'trattativa' then 'risposta' else 'stato' end;
    elsif jsonb_array_length(v_texts) > 0 then
      v_kind := 'messaggio';
      v_activity_approach := case when jsonb_array_length(v_texts) = 1 then v_texts -> 0 ->> 'approach' end;
    else
      v_kind := 'approccio';
    end if;
    v_channel := null;
    if v_kind in ('inviato', 'messaggio') then
      select m.channel into v_channel from public.partner_message_variants m
        where m.partner_id = v_partner and m.approach = v_activity_approach;
      if v_channel is null and v_kind = 'inviato' then
        v_channel := case v_preferred when 'email' then 'email' when 'form' then 'form' when 'ig' then 'dm'
          when 'phone' then 'phone' end;
      end if;
    end if;
    perform private.partner_log(p_operation_id, v_partner, v_kind, v_actor,
      p_stage_before => v_stage ->> 'from', p_stage_after => v_stage ->> 'to', p_approach => v_activity_approach,
      p_channel => v_channel, p_message_kind => case when v_kind = 'inviato' then 'primo' end,
      p_origin => 'file', p_occurred_at => v_exported);
  end loop;
  result := jsonb_build_object('id', v_import, 'device', p_payload ->> 'device', 'exported_at', v_exported) || (v_plan -> 'counts')
    || jsonb_build_object('replayed', false);
  return private.partner_finish(p_operation_id, 'import_partner_device_file', p_payload, result);
end
$$;

-- ---------------------------------------------------------------------------
-- Import della ricerca (solo proprietario del database)
-- ---------------------------------------------------------------------------

-- Un lotto è il testo JSON scritto da supabase/generate-partner-import.mjs:
-- { schema_version: 1, source: "luckylap-partner", normalized_sha256, source_sha256, source_commit,
--   source_generated: "AAAA-MM-GG", batch_index, batch_count, context_md?: testo (le parti si
--   uniscono nell'ordine dei lotti), partners: [contatto, …] }.
-- normalized_sha256 identifica i dati normalizzati dell'import (lo calcola il generatore); il
-- database verifica lo SHA-256 di ogni lotto contro l'elenco passato ad apply_partner_research.
-- Contatto: { source_key, name, city, country, type_label, sections, priority,
--   contact_month: "AAAA-MM-01", event_starts_on, event_ends_on, preferred_channel, research: {…},
--   contacts: [{ slot, value, verified }], variants: [{ approach, channel, language, to, cc, lookbook,
--   subject, body, follow_up, confirm_email, gist_it, notes_it, form_fields_it }] }.
create function private.partner_research_entry(e jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  k text; v_name text; v_city text; v_country text; v_type text; v_sections text[]; v_month date; v_start date; v_end date;
  v_priority text; v_channel text; c jsonb; x jsonb; v_slot text; v_value text; v_contacts jsonb := '[]'::jsonb;
  v_variants jsonb := '[]'::jsonb; v_slots text[] := '{}'; v_approaches text[] := '{}'; v_approach text;
begin
  if jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e -> 'source_key') is distinct from 'string'
    or (e ->> 'source_key') !~ '^[A-Za-z0-9]{1,20}$' then
    raise exception 'invalid_partner_research' using errcode = '22023', detail = 'Contatto senza codice valido.';
  end if;
  k := e ->> 'source_key';
  begin
    perform private.partner_keys(e,
      array['source_key', 'name', 'city', 'country', 'type_label', 'sections', 'priority', 'contact_month', 'event_starts_on',
        'event_ends_on', 'preferred_channel', 'research', 'contacts', 'variants'],
      array['source_key', 'name', 'city', 'country', 'type_label', 'sections', 'priority', 'contact_month', 'event_starts_on',
        'event_ends_on', 'preferred_channel', 'research', 'contacts', 'variants']);
    v_name := btrim(private.partner_text(e, 'name', 240));
    v_city := btrim(private.partner_text(e, 'city', 240));
    v_country := btrim(private.partner_text(e, 'country', 120));
    v_type := btrim(private.partner_text(e, 'type_label', 120));
    v_sections := private.partner_sections(e -> 'sections');
    v_priority := private.partner_enum(e, 'priority', array['alta', 'media', 'bassa']);
    v_month := private.partner_month(e, 'contact_month');
    v_start := private.partner_date(e, 'event_starts_on');
    v_end := private.partner_date(e, 'event_ends_on');
    v_channel := private.partner_enum(e, 'preferred_channel', array['email', 'form', 'ig', 'phone', 'web']);
    perform private.partner_check(char_length(v_name) between 1 and 240 and v_name !~ '[\r\n]'
      and v_city is not null and v_country is not null and v_type is not null and v_priority is not null
      and v_month is not null and v_channel is not null
      and (v_end is null or (v_start is not null and v_end >= v_start))
      and jsonb_typeof(e -> 'research') = 'object' and pg_column_size(e -> 'research') <= 65536
      and jsonb_typeof(e -> 'contacts') = 'array' and jsonb_array_length(e -> 'contacts') <= 7
      and jsonb_typeof(e -> 'variants') = 'array' and jsonb_array_length(e -> 'variants') <= 5);
    for c in select * from jsonb_array_elements(e -> 'contacts') loop
      perform private.partner_keys(c, array['slot', 'value', 'verified'], array['slot', 'value', 'verified']);
      v_slot := private.partner_enum(c, 'slot', array['email', 'phone', 'whatsapp', 'instagram', 'form', 'brand_page', 'web']);
      v_value := btrim(private.partner_text(c, 'value', 500));
      perform private.partner_check(v_slot is not null and not (v_slot = any(v_slots)) and v_value <> ''
        and private.partner_bool(c, 'verified') is not null);
      v_slots := v_slots || v_slot;
      v_contacts := v_contacts || jsonb_build_object('slot', v_slot, 'value', v_value, 'verified', c -> 'verified');
    end loop;
    for x in select * from jsonb_array_elements(e -> 'variants') loop
      perform private.partner_keys(x,
        array['approach', 'channel', 'language', 'to', 'cc', 'lookbook', 'subject', 'body', 'follow_up', 'confirm_email',
          'gist_it', 'notes_it', 'form_fields_it'],
        array['approach', 'channel', 'language', 'to', 'cc', 'lookbook', 'subject', 'body', 'follow_up', 'confirm_email',
          'gist_it', 'notes_it', 'form_fields_it']);
      v_approach := private.partner_enum(x, 'approach', private.partner_approaches());
      perform private.partner_check(v_approach is not null and not (v_approach = any(v_approaches))
        and private.partner_enum(x, 'channel', array['email', 'form', 'dm', 'phone']) is not null
        and private.partner_enum(x, 'language', array['en', 'de', 'fr', 'it', 'es']) is not null
        and (jsonb_typeof(x -> 'lookbook') = 'null'
          or private.partner_enum(x, 'lookbook', array['negozi', 'eventi', 'collab', 'porsche_club', 'club']) is not null)
        and private.partner_text(x, 'to', 500) is not null and private.partner_text(x, 'cc', 500) is not null
        and private.partner_text(x, 'subject', 300) is not null and private.partner_text(x, 'body', 8000) is not null
        and private.partner_text(x, 'follow_up', 4000) is not null and private.partner_text(x, 'confirm_email', 4000) is not null
        and private.partner_text(x, 'gist_it', 2000) is not null and private.partner_text(x, 'notes_it', 4000) is not null
        and private.partner_text(x, 'form_fields_it', 4000) is not null);
      v_approaches := v_approaches || v_approach;
      v_variants := v_variants || x;
    end loop;
  exception when sqlstate '22023' then
    raise exception 'invalid_partner_research' using errcode = '22023', detail = 'Contatto ' || k || ': dati non validi.';
  end;
  return jsonb_build_object('source_key', k,
    'fields', jsonb_build_object('name', v_name, 'city', v_city, 'country', v_country, 'type_label', v_type,
      'sections', to_jsonb(v_sections), 'priority', v_priority, 'contact_month', v_month, 'event_starts_on', v_start,
      'event_ends_on', v_end, 'preferred_channel', v_channel),
    'research', e -> 'research', 'contacts', v_contacts, 'variants', v_variants);
end
$$;

-- Registra un lotto in transito, solo se il testo ricevuto ha lo SHA-256 atteso (il generatore lo
-- scrive nel file): un testo alterato nel trasporto non si registra, e il file si rimanda così
-- com'è. Stesso lotto ripetuto: nessun effetto. Stesso indice con testo diverso: errore.
create function private.stage_partner_research(p_payload_text text, p_expected_sha256 text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_sha text; b jsonb; v_normalized text; v_index integer; v_count integer; e jsonb; n integer := 0;
  existing private.partner_import_staging%rowtype;
begin
  if p_expected_sha256 is null or p_expected_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_partner_research' using errcode = '22023', detail = 'SHA-256 atteso del lotto non valido.';
  end if;
  if p_payload_text is null or octet_length(p_payload_text) > 1048576 then
    raise exception 'invalid_partner_research' using errcode = '22023', detail = 'Lotto vuoto o troppo grande.';
  end if;
  v_sha := encode(sha256(convert_to(p_payload_text, 'UTF8')), 'hex');
  if v_sha <> p_expected_sha256 then
    raise exception 'partner_batch_altered' using errcode = '22023',
      detail = 'Testo del lotto diverso da quello del file: niente è stato registrato, rimandare il file.';
  end if;
  begin
    b := p_payload_text::jsonb;
  exception when others then
    raise exception 'invalid_partner_research' using errcode = '22023', detail = 'Il lotto non è JSON valido.';
  end;
  begin
    perform private.partner_keys(b,
      array['schema_version', 'source', 'normalized_sha256', 'source_sha256', 'source_commit', 'source_generated',
        'batch_index', 'batch_count', 'partners'],
      array['schema_version', 'source', 'normalized_sha256', 'source_sha256', 'source_commit', 'source_generated',
        'batch_index', 'batch_count', 'partners', 'context_md']);
    v_index := private.partner_bigint(b, 'batch_index', 1, 100);
    v_count := private.partner_bigint(b, 'batch_count', 1, 100);
    perform private.partner_check(b -> 'schema_version' = '1'::jsonb and b ->> 'source' = 'luckylap-partner'
      and coalesce(private.partner_text(b, 'normalized_sha256', 64), '') ~ '^[0-9a-f]{64}$'
      and coalesce(private.partner_text(b, 'source_sha256', 64), '') ~ '^[0-9a-f]{64}$'
      and coalesce(private.partner_text(b, 'source_commit', 40), '') ~ '^[0-9a-f]{7,40}$'
      and private.partner_date(b, 'source_generated') is not null
      and v_index is not null and v_count is not null and v_index <= v_count
      and (not (b ? 'context_md') or private.partner_text(b, 'context_md', 100000) is not null)
      and jsonb_typeof(b -> 'partners') = 'array');
  exception when sqlstate '22023' then
    raise exception 'invalid_partner_research' using errcode = '22023', detail = 'Intestazione del lotto non valida.';
  end;
  for e in select * from jsonb_array_elements(b -> 'partners') loop
    perform private.partner_research_entry(e);
    n := n + 1;
  end loop;
  v_normalized := b ->> 'normalized_sha256';
  if exists (select 1 from public.partner_research_imports where normalized_sha256 = v_normalized) then
    return jsonb_build_object('normalized_sha256', v_normalized, 'batch_index', v_index, 'batch_count', v_count,
      'payload_sha256', v_sha, 'partners', n, 'staged', false, 'already_applied', true);
  end if;
  select * into existing from private.partner_import_staging where normalized_sha256 = v_normalized and batch_index = v_index;
  if found then
    if existing.payload_sha256 <> v_sha or existing.batch_count <> v_count then
      raise exception 'partner_batch_conflict' using errcode = '22023',
        detail = 'Lotto ' || v_index || ' già registrato con un testo diverso.';
    end if;
    return jsonb_build_object('normalized_sha256', v_normalized, 'batch_index', v_index, 'batch_count', v_count,
      'payload_sha256', v_sha, 'partners', n, 'staged', false, 'already_applied', false);
  end if;
  insert into private.partner_import_staging(normalized_sha256, batch_index, batch_count, payload_text, payload_sha256)
    values (v_normalized, v_index, v_count, p_payload_text, v_sha);
  return jsonb_build_object('normalized_sha256', v_normalized, 'batch_index', v_index, 'batch_count', v_count,
    'payload_sha256', v_sha, 'partners', n, 'staged', true, 'already_applied', false);
end
$$;

-- Applica in una sola transazione tutti i lotti di un import. Confronto a tre vie per i campi
-- della scheda e i recapiti; gli originali dei messaggi si aggiornano sempre, il testo del team
-- resta in uso. Niente si cancella: chi esce dalla ricerca riceve research_removed_at.
create function private.apply_partner_research(p_normalized_sha256 text, p_batch_sha256 text[]) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_fields constant text[] := array['name', 'city', 'country', 'type_label', 'sections', 'priority', 'contact_month',
    'event_starts_on', 'event_ends_on', 'preferred_channel'];
  v_slots constant text[] := array['email', 'phone', 'whatsapp', 'instagram', 'form', 'brand_page', 'web'];
  n integer; v_index integer; s private.partner_import_staging%rowtype; b jsonb; v_first jsonb; v_context text := '';
  v_existing public.partner_research_imports%rowtype; e jsonb; k text; v_seen text[] := '{}';
  p public.partners%rowtype; c public.partner_contacts%rowtype; v public.partner_message_variants%rowtype;
  v_inc jsonb; v_ours jsonb; v_base jsonb; v_merged jsonb; v_field text; v_b jsonb; v_o jsonb; v_n jsonb;
  v_taken text[]; v_diffs jsonb := '[]'::jsonb; d jsonb; v_touched boolean; v_row_changed boolean; v_co integer;
  v_slot text; v_contact jsonb; v_value text; v_variant jsonb; v_approaches text[]; v_orig_changed boolean;
  v_other_changed boolean; v_import uuid; v_gone integer; v_strip text[]; v_to text; v_cc text;
  n_total integer := 0; n_new integer := 0; n_updated integer := 0; n_removed integer := 0; n_variants integer := 0;
  n_variants_new integer := 0; n_variants_updated integer := 0; n_diffs integer := 0;
  v_new_codes jsonb := '[]'::jsonb; v_blocked jsonb := '[]'::jsonb; v_erased jsonb := '[]'::jsonb;
begin
  if p_normalized_sha256 is null or p_normalized_sha256 !~ '^[0-9a-f]{64}$' or p_batch_sha256 is null
    or cardinality(p_batch_sha256) not between 1 and 100 or array_ndims(p_batch_sha256) <> 1
    or exists (select 1 from unnest(p_batch_sha256) x where x is null or x !~ '^[0-9a-f]{64}$') then
    raise exception 'invalid_partner_research' using errcode = '22023', detail = 'SHA-256 dell''import o dei lotti non validi.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.partner.import', 0));
  select * into v_existing from public.partner_research_imports where normalized_sha256 = p_normalized_sha256;
  if found then
    delete from private.partner_import_staging where normalized_sha256 = p_normalized_sha256;
    return jsonb_build_object('import_id', v_existing.id, 'normalized_sha256', v_existing.normalized_sha256,
      'source_commit', v_existing.source_commit, 'partners_total', v_existing.partners_total,
      'partners_new', v_existing.partners_new, 'partners_updated', v_existing.partners_updated,
      'partners_removed', v_existing.partners_removed, 'variants_total', v_existing.variants_total,
      'variants_new', v_existing.variants_new, 'variants_updated', v_existing.variants_updated,
      'differences_new', v_existing.differences_new, 'replayed', true);
  end if;
  n := cardinality(p_batch_sha256);
  if (select count(*) from private.partner_import_staging where normalized_sha256 = p_normalized_sha256) <> n then
    raise exception 'partner_import_incomplete' using errcode = '22023',
      detail = 'Lotti registrati diversi da quelli attesi: rimandare i lotti mancanti.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.partner.co', 0));
  for v_index in 1 .. n loop
    select * into s from private.partner_import_staging where normalized_sha256 = p_normalized_sha256 and batch_index = v_index;
    if not found or s.batch_count <> n or s.payload_sha256 <> p_batch_sha256[v_index] then
      raise exception 'partner_import_incomplete' using errcode = '22023',
        detail = 'Lotto ' || v_index || ' mancante o con SHA-256 diverso.';
    end if;
    b := s.payload_text::jsonb;
    if v_index = 1 then v_first := b; end if;
    if b ->> 'source_commit' <> v_first ->> 'source_commit' or b ->> 'source_sha256' <> v_first ->> 'source_sha256'
      or b ->> 'source_generated' <> v_first ->> 'source_generated' or (b ->> 'batch_index')::integer <> v_index then
      raise exception 'partner_import_incomplete' using errcode = '22023', detail = 'Lotti di import diversi.';
    end if;
    v_context := v_context || coalesce(b ->> 'context_md', '');
    for e in select x from jsonb_array_elements(b -> 'partners') with ordinality t(x, i) order by i loop
      e := private.partner_research_entry(e);
      k := e ->> 'source_key';
      if k = any(v_seen) then
        raise exception 'invalid_partner_research' using errcode = '22023', detail = 'Contatto ' || k || ' ripetuto.';
      end if;
      v_seen := v_seen || k;
      n_total := n_total + 1;
      n_variants := n_variants + jsonb_array_length(e -> 'variants');
      v_inc := e -> 'fields';
      v_touched := false;
      select * into p from public.partners where source_key = k for update;
      if not found then
        -- Contatto nuovo: CO successivo, stato da contattare, base del confronto = valori importati.
        select coalesce(max(co), 0) + 1 into v_co from public.partners;
        insert into public.partners(co, source_key, origin, name, city, country, type_label, sections, priority,
            contact_month, event_starts_on, event_ends_on, preferred_channel, research, research_base)
          values (v_co, k, 'research', v_inc ->> 'name', v_inc ->> 'city', v_inc ->> 'country', v_inc ->> 'type_label',
            array(select x from jsonb_array_elements_text(v_inc -> 'sections') with ordinality t(x, i) order by i),
            v_inc ->> 'priority', (v_inc ->> 'contact_month')::date, (v_inc ->> 'event_starts_on')::date,
            (v_inc ->> 'event_ends_on')::date, v_inc ->> 'preferred_channel', e -> 'research', v_inc)
          returning * into p;
        n_new := n_new + 1;
        v_new_codes := v_new_codes || jsonb_build_object('source_key', k, 'co', v_co);
      else
        v_ours := private.partner_fields(p);
        v_base := p.research_base;
        v_merged := '{}'::jsonb;
        v_taken := '{}';
        foreach v_field in array v_fields loop
          v_b := coalesce(v_base -> v_field, 'null'::jsonb);
          v_o := v_ours -> v_field;
          v_n := v_inc -> v_field;
          if v_n = v_b then
            v_merged := v_merged || jsonb_build_object(v_field, v_o);
          elsif v_o = v_b or v_o = v_n then
            v_merged := v_merged || jsonb_build_object(v_field, v_n);
            if v_o <> v_n then v_taken := v_taken || v_field; end if;
            perform private.partner_close_differences(p.id, v_field, null, null, 'superseded', null);
          else
            v_merged := v_merged || jsonb_build_object(v_field, v_o);
            v_diffs := v_diffs || jsonb_build_object('partner_id', p.id, 'field', v_field, 'team', v_o, 'incoming', v_n);
          end if;
        end loop;
        -- Date dell'evento incoerenti dopo l'unione: restano quelle del team, con le differenze.
        if v_merged ->> 'event_ends_on' is not null and (v_merged ->> 'event_starts_on' is null
            or (v_merged ->> 'event_ends_on')::date < (v_merged ->> 'event_starts_on')::date) then
          foreach v_field in array array['event_starts_on', 'event_ends_on'] loop
            if v_field = any(v_taken) then
              v_diffs := v_diffs || jsonb_build_object('partner_id', p.id, 'field', v_field, 'team', v_ours -> v_field,
                'incoming', v_inc -> v_field);
            end if;
            v_merged := v_merged || jsonb_build_object(v_field, v_ours -> v_field);
          end loop;
        end if;
        v_row_changed := v_merged <> v_ours or p.research is distinct from e -> 'research'
          or p.research_base is distinct from v_inc or p.research_removed_at is not null;
        if v_row_changed then
          update public.partners set
              name = v_merged ->> 'name', city = v_merged ->> 'city', country = v_merged ->> 'country',
              type_label = v_merged ->> 'type_label',
              sections = array(select x from jsonb_array_elements_text(v_merged -> 'sections') with ordinality t(x, i) order by i),
              priority = v_merged ->> 'priority', contact_month = (v_merged ->> 'contact_month')::date,
              event_starts_on = (v_merged ->> 'event_starts_on')::date, event_ends_on = (v_merged ->> 'event_ends_on')::date,
              preferred_channel = v_merged ->> 'preferred_channel', research = e -> 'research', research_base = v_inc,
              research_removed_at = null, version = version + 1, updated_by = null, updated_at = now()
            where id = p.id;
          v_touched := true;
        end if;
      end if;

      -- Recapiti, per slot della ricerca. v_strip raccoglie gli indirizzi dei recapiti cancellati
      -- che la ricerca riporta ancora: non tornano nemmeno nei destinatari dei messaggi.
      v_strip := '{}';
      foreach v_slot in array v_slots loop
        select x into v_contact from jsonb_array_elements(e -> 'contacts') x where x ->> 'slot' = v_slot;
        v_value := v_contact ->> 'value';
        select * into c from public.partner_contacts where partner_id = p.id and research_slot = v_slot for update;
        if not found then
          if v_value is not null then
            insert into public.partner_contacts(partner_id, kind, value, link_value, verified, research_slot, research_value, position)
              values (p.id, v_slot, v_value, private.partner_link_value(v_slot, v_value), (v_contact ->> 'verified')::boolean,
                v_slot, v_value, array_position(v_slots, v_slot) - 1);
            v_touched := true;
          end if;
        elsif c.erased_at is not null then
          if v_value is not null then
            v_erased := v_erased || jsonb_build_object('source_key', k, 'slot', v_slot);
            v_strip := v_strip || private.partner_recipient_items(v_value, v_slot);
          end if;
        elsif v_value is not distinct from c.research_value then
          if c.active and c.value = c.research_value and c.verified <> (v_contact ->> 'verified')::boolean then
            update public.partner_contacts set verified = (v_contact ->> 'verified')::boolean, version = version + 1,
                updated_by = null, updated_at = now()
              where id = c.id;
            v_touched := true;
          end if;
        elsif (c.active and c.value is not distinct from c.research_value) or (not c.active and c.research_value is null) then
          -- Recapito non toccato dal team: prende il valore nuovo (o si disattiva se è sparito).
          if v_value is null then
            update public.partner_contacts set active = false, research_value = null, version = version + 1,
                updated_by = null, updated_at = now()
              where id = c.id;
          else
            update public.partner_contacts set value = v_value, link_value = private.partner_link_value(v_slot, v_value),
                verified = (v_contact ->> 'verified')::boolean, active = true, research_value = v_value,
                version = version + 1, updated_by = null, updated_at = now()
              where id = c.id;
          end if;
          perform private.partner_close_differences(p.id, 'contact', null, c.id, 'superseded', null);
          v_touched := true;
        elsif (c.active and c.value = v_value) or (not c.active and v_value is null) then
          -- Stessa scelta dal team e dalla ricerca.
          update public.partner_contacts set research_value = v_value, verified = coalesce((v_contact ->> 'verified')::boolean, verified),
              version = version + 1, updated_by = null, updated_at = now()
            where id = c.id;
          perform private.partner_close_differences(p.id, 'contact', null, c.id, 'superseded', null);
          v_touched := true;
        else
          update public.partner_contacts set research_value = v_value, version = version + 1, updated_by = null, updated_at = now()
            where id = c.id;
          v_diffs := v_diffs || jsonb_build_object('partner_id', p.id, 'field', 'contact', 'contact_id', c.id,
            'team', jsonb_build_object('value', c.value, 'active', c.active),
            'incoming', jsonb_build_object('value', v_value, 'verified', v_contact -> 'verified'));
          v_touched := true;
        end if;
      end loop;

      -- Varianti, per approccio.
      v_approaches := '{}';
      for v_variant in select x from jsonb_array_elements(e -> 'variants') x loop
        v_approaches := v_approaches || (v_variant ->> 'approach');
        v_to := private.partner_strip_recipients(v_variant ->> 'to', v_strip);
        v_cc := private.partner_strip_recipients(v_variant ->> 'cc', v_strip);
        if v_to <> v_variant ->> 'to' or v_cc <> v_variant ->> 'cc' then
          v_erased := v_erased || jsonb_build_object('source_key', k, 'approach', v_variant ->> 'approach');
        end if;
        select * into v from public.partner_message_variants where partner_id = p.id and approach = v_variant ->> 'approach'
          for update;
        if not found then
          insert into public.partner_message_variants(partner_id, approach, origin, channel, language, to_text, cc_text,
              lookbook_code, original_subject, original_body, original_follow_up, original_confirm_email, gist_it, notes_it,
              form_fields_it)
            values (p.id, v_variant ->> 'approach', 'research', v_variant ->> 'channel', v_variant ->> 'language',
              v_to, v_cc, v_variant ->> 'lookbook', v_variant ->> 'subject', v_variant ->> 'body',
              v_variant ->> 'follow_up', v_variant ->> 'confirm_email', v_variant ->> 'gist_it', v_variant ->> 'notes_it',
              v_variant ->> 'form_fields_it');
          n_variants_new := n_variants_new + 1;
          v_touched := true;
          continue;
        end if;
        v_orig_changed := row(v.original_subject, v.original_body, v.original_follow_up, v.original_confirm_email)
          is distinct from row(v_variant ->> 'subject', v_variant ->> 'body', v_variant ->> 'follow_up', v_variant ->> 'confirm_email');
        v_other_changed := row(v.channel, v.language, v.to_text, v.cc_text, v.lookbook_code, v.gist_it, v.notes_it, v.form_fields_it)
          is distinct from row(v_variant ->> 'channel', v_variant ->> 'language', v_to, v_cc,
            v_variant ->> 'lookbook', v_variant ->> 'gist_it', v_variant ->> 'notes_it', v_variant ->> 'form_fields_it')
          or v.research_removed_at is not null;
        if v_orig_changed or v_other_changed then
          update public.partner_message_variants set channel = v_variant ->> 'channel', language = v_variant ->> 'language',
              to_text = v_to, cc_text = v_cc, lookbook_code = v_variant ->> 'lookbook',
              original_subject = v_variant ->> 'subject', original_body = v_variant ->> 'body',
              original_follow_up = v_variant ->> 'follow_up', original_confirm_email = v_variant ->> 'confirm_email',
              gist_it = v_variant ->> 'gist_it', notes_it = v_variant ->> 'notes_it', form_fields_it = v_variant ->> 'form_fields_it',
              original_changed_at = case when v_orig_changed and current_revision_id is not null then now()
                else original_changed_at end,
              research_removed_at = null, version = version + 1, updated_by = null, updated_at = now()
            where id = v.id;
          if v_orig_changed and v.current_revision_id is not null then
            v_diffs := v_diffs || jsonb_build_object('partner_id', p.id, 'field', 'message', 'variant_id', v.id,
              'team', private.partner_message_current(v),
              'incoming', jsonb_build_object('subject', v_variant ->> 'subject', 'body', v_variant ->> 'body',
                'follow_up', v_variant ->> 'follow_up', 'confirm_email', v_variant ->> 'confirm_email'));
          end if;
          n_variants_updated := n_variants_updated + 1;
          v_touched := true;
        end if;
      end loop;
      -- Varianti della ricerca sparite: restano, con research_removed_at.
      with gone as (
        update public.partner_message_variants set research_removed_at = now(), version = version + 1,
            updated_by = null, updated_at = now()
          where partner_id = p.id and origin = 'research' and research_removed_at is null and not (approach = any(v_approaches))
          returning 1)
      select count(*) into v_gone from gone;
      if v_gone > 0 then
        n_variants_updated := n_variants_updated + v_gone;
        v_touched := true;
      end if;
      if v_touched and not exists (select 1 from jsonb_array_elements(v_new_codes) x where x ->> 'source_key' = k) then
        n_updated := n_updated + 1;
      end if;
      if private.partner_blocked(p.id) then v_blocked := v_blocked || to_jsonb(k); end if;
    end loop;
  end loop;

  if n_total = 0 then
    raise exception 'invalid_partner_research' using errcode = '22023', detail = 'Import senza contatti.';
  end if;

  -- Contatti della ricerca assenti: research_removed_at, niente si cancella.
  with gone as (
    update public.partners set research_removed_at = now(), version = version + 1, updated_by = null, updated_at = now()
      where origin = 'research' and research_removed_at is null and not (source_key = any(v_seen))
      returning 1)
  select count(*) into n_removed from gone;

  -- Le differenze che restano uguali a una già aperta non contano come nuove.
  for d in select x from jsonb_array_elements(v_diffs) x loop
    if not exists (select 1 from public.partner_import_differences
        where partner_id = (d ->> 'partner_id')::uuid and field = d ->> 'field'
          and variant_id is not distinct from (d ->> 'variant_id')::uuid
          and contact_id is not distinct from (d ->> 'contact_id')::uuid and status = 'open'
          and team_value is not distinct from d -> 'team' and incoming_value is not distinct from d -> 'incoming') then
      n_diffs := n_diffs + 1;
    end if;
  end loop;

  insert into public.partner_research_imports(normalized_sha256, source_sha256, source_commit, source_generated, batch_count,
      partners_total, partners_new, partners_updated, partners_removed, variants_total, variants_new, variants_updated,
      differences_new, context_md)
    values (p_normalized_sha256, v_first ->> 'source_sha256', v_first ->> 'source_commit',
      (v_first ->> 'source_generated')::date, n, n_total, n_new, n_updated, n_removed, n_variants, n_variants_new,
      n_variants_updated, n_diffs, v_context)
    returning id into v_import;
  for d in select x from jsonb_array_elements(v_diffs) x loop
    perform private.partner_open_difference('research', v_import, (d ->> 'partner_id')::uuid, d ->> 'field',
      (d ->> 'variant_id')::uuid, (d ->> 'contact_id')::uuid, d -> 'team', d -> 'incoming');
  end loop;
  delete from private.partner_import_staging where normalized_sha256 = p_normalized_sha256;
  return jsonb_build_object('import_id', v_import, 'normalized_sha256', p_normalized_sha256,
    'source_commit', v_first ->> 'source_commit', 'partners_total', n_total, 'partners_new', n_new,
    'partners_updated', n_updated, 'partners_removed', n_removed, 'variants_total', n_variants,
    'variants_new', n_variants_new, 'variants_updated', n_variants_updated, 'differences_new', n_diffs,
    'new_codes', v_new_codes, 'blocked_codes', v_blocked, 'erased_skipped', v_erased, 'replayed', false);
end
$$;

-- ---------------------------------------------------------------------------
-- Wrapper pubblici e grant
-- ---------------------------------------------------------------------------

create function public.set_partner_state(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.set_partner_state(p_operation_id, p_payload) $$;
create function public.save_partner(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.save_partner(p_operation_id, p_payload) $$;
create function public.record_partner_activity(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.record_partner_activity(p_operation_id, p_payload) $$;
create function public.save_partner_message(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.save_partner_message(p_operation_id, p_payload) $$;
create function public.restore_partner_message(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.restore_partner_message(p_operation_id, p_payload) $$;
create function public.save_partner_contact(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.save_partner_contact(p_operation_id, p_payload) $$;
create function public.remove_partner_contact(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.remove_partner_contact(p_operation_id, p_payload) $$;
create function public.set_partner_do_not_contact(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.set_partner_do_not_contact(p_operation_id, p_payload) $$;
create function public.resolve_partner_difference(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.resolve_partner_difference(p_operation_id, p_payload) $$;
create function public.import_partner_device_file(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.import_partner_device_file(p_operation_id, p_payload) $$;
create function public.preview_partner_device_file(p_payload jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.preview_partner_device_file(p_payload) $$;

-- PostgreSQL (e Supabase per lo schema public) dà EXECUTE a tutti per default: si toglie a ogni
-- funzione di questo modulo, poi si concede solo ai comandi.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and (p.proname like '%partner%' or p.proname = 'audit_change_keys')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
      execute format('revoke all on function %s from service_role', f);
    end if;
  end loop;
end
$$;
grant execute on function
  private.set_partner_state(uuid, jsonb), public.set_partner_state(uuid, jsonb),
  private.save_partner(uuid, jsonb), public.save_partner(uuid, jsonb),
  private.record_partner_activity(uuid, jsonb), public.record_partner_activity(uuid, jsonb),
  private.save_partner_message(uuid, jsonb), public.save_partner_message(uuid, jsonb),
  private.restore_partner_message(uuid, jsonb), public.restore_partner_message(uuid, jsonb),
  private.save_partner_contact(uuid, jsonb), public.save_partner_contact(uuid, jsonb),
  private.remove_partner_contact(uuid, jsonb), public.remove_partner_contact(uuid, jsonb),
  private.set_partner_do_not_contact(uuid, jsonb), public.set_partner_do_not_contact(uuid, jsonb),
  private.resolve_partner_difference(uuid, jsonb), public.resolve_partner_difference(uuid, jsonb),
  private.import_partner_device_file(uuid, jsonb), public.import_partner_device_file(uuid, jsonb),
  private.preview_partner_device_file(jsonb), public.preview_partner_device_file(jsonb)
to authenticated;

commit;
