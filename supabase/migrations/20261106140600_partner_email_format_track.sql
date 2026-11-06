-- Il formato e il filone della scelta restano legati alla versione letta.
-- Per ogni bozza configurata si conserva la scelta con le possibilità realmente usate.
begin;

alter table public.partner_assistant_drafts
  add column choice_note_id uuid references public.partner_assistant_notes(id);
create index partner_assistant_drafts_choice_note_idx
  on public.partner_assistant_drafts(choice_note_id) where choice_note_id is not null;

-- Il chiamante ha già bloccato il contatto e il lavoro con partner_assistant_lock_step.
-- Una scelta già legata a una bozza resta valida anche se il recapito è cambiato
-- e il job ha perso il riferimento alla sua bozza corrente.
create function private.partner_assistant_reselect_email_choice_if_stale(
  j public.partner_assistant_jobs, p_choice jsonb
) returns text
language plpgsql security invoker set search_path = '' as $$
declare v_sections text[]; v_extracted text; v_kind text; v_version integer; v_step text;
begin
  if not coalesce(p_choice ? 'formato', false) or j.draft_id is not null
    or exists (select 1 from public.partner_assistant_drafts d where d.choice_note_id = j.choice_note_id) then
    return null;
  end if;

  select p.sections into strict v_sections from public.partners p where p.id = j.partner_id;
  v_extracted := coalesce(p_choice ->> 'tipo_estratto', p_choice ->> 'contact_kind');
  v_kind := case
    when 'eventi' = any(v_sections) then 'evento'
    when 'club' = any(v_sections) then 'club'
    when 'vendita' = any(v_sections) then 'negozio'
    when 'collab' = any(v_sections) then case when v_extracted = 'media' then 'media' else 'brand' end
    else v_extracted
  end;

  -- Lo stesso lock del salvataggio configurazione. Una modifica confermata prima
  -- della bozza rende la scelta obsoleta anche se Claude ha già scritto il testo.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.partner_email_config.versions', 0));
  select max(version) into v_version from public.partner_email_config_versions;
  if v_kind = p_choice ->> 'contact_kind' and v_version = (p_choice ->> 'config_version')::integer then
    return null;
  end if;

  -- Stessi requisiti di riuso della ricerca della presa in carico.
  v_step := case when exists (select 1 from public.partner_assistant_notes n
      join public.partners p on p.id = j.partner_id
      where n.id = j.research_note_id and n.created_at > now() - interval '14 days'
        and p.updated_at <= n.created_at and not private.partner_assistant_is_template(n.id))
    and p_choice ->> 'fact_text' ~ '\S' and p_choice ->> 'timezone' ~ '\S'
    and coalesce(nullif(p_choice ->> 'event_starts_on', '')::date > (now() at time zone 'Europe/Rome')::date,
      p_choice ->> 'event_name' !~ '\S')
    then 'estrazione' else 'ricerca' end;

  update public.partner_assistant_jobs set step = v_step, choice_note_id = null,
    lease_token = null, lease_expires_at = null, next_attempt_at = now(), updated_at = now()
    where id = j.id;
  insert into private.partner_assistant_events(partner_id, step, outcome)
    values (j.partner_id, 'scrittura', 'scelta_superata');
  return v_step;
end
$$;

revoke all on function private.partner_assistant_reselect_email_choice_if_stale(public.partner_assistant_jobs, jsonb)
  from public, anon, authenticated, service_role;

create function private.reselect_partner_assistant_email_choice(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'job_id', 'lease_token'];
  v_actor uuid; v_job_id uuid; v_token uuid; v_choice jsonb; v_step text;
  j public.partner_assistant_jobs%rowtype; replay jsonb; stop jsonb; result jsonb;
begin
  perform private.partner_assistant_service_required();
  v_actor := private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, v_keys, v_keys);
  v_job_id := private.partner_uuid(p_payload, 'job_id');
  v_token := private.partner_uuid(p_payload, 'lease_token');
  perform private.partner_check(v_job_id is not null and v_token is not null);
  if v_actor is null then raise exception 'partner_assistant_not_configured' using errcode = '55000'; end if;
  replay := private.partner_assistant_begin(p_operation_id, 'reselect_partner_assistant_email_choice', v_actor, p_payload);
  if replay is not null then return replay; end if;
  stop := private.partner_assistant_lock_step(v_job_id, v_token, 'scrittura');
  if stop is not null then return stop; end if;
  select * into strict j from public.partner_assistant_jobs where id = v_job_id;
  select n.content into v_choice from public.partner_assistant_notes n where n.id = j.choice_note_id;

  v_step := private.partner_assistant_reselect_email_choice_if_stale(j, v_choice);
  if v_step is null then
    update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null, updated_at = now()
      where id = j.id;
  end if;
  result := jsonb_build_object('status', 'done', 'job_status', j.status, 'step', coalesce(v_step, j.step), 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'reselect_partner_assistant_email_choice', v_actor, p_payload,
    result);
end
$$;

create function public.reselect_partner_assistant_email_choice(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.reselect_partner_assistant_email_choice(p_operation_id, p_payload)
$$;

revoke all on function private.reselect_partner_assistant_email_choice(uuid, jsonb),
  public.reselect_partner_assistant_email_choice(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.reselect_partner_assistant_email_choice(uuid, jsonb),
  public.reselect_partner_assistant_email_choice(uuid, jsonb) to service_role;

create or replace function private.complete_partner_assistant_choice(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'job_id', 'lease_token', 'choice', 'decision', 'model', 'rules_version'];
  v_strings text[] := array['reason_it', 'write_on', 'recipient_email', 'recipient_email_source', 'person_name',
    'person_title', 'timezone', 'fact_text', 'fact_date', 'fact_source', 'event_name', 'event_starts_on',
    'event_city', 'event_country', 'notes_it'];
  v_flags text[] := array['porsche_community', 'write_now', 'recipient_email_published_by_org', 'swiss',
    'event_reachable'];
  v_enums text[] := array['contact_kind', 'language', 'register', 'request'];
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_actor uuid; v_job_id uuid; v_token uuid; v_choice jsonb; v_decision jsonb; v_kind text; v_write_on date;
  v_reason text; v_model text; v_rules bigint; v_key text;
  v_evidence jsonb; v_condition jsonb; v_selection jsonb; v_format text; v_config_version integer;
  v_selection_keys text[] := array['formato', 'filone', 'motivo_filone', 'config_version'];
  j public.partner_assistant_jobs%rowtype; v_note uuid; replay jsonb; stop jsonb; result jsonb;
begin
  perform private.partner_assistant_service_required();
  v_actor := private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, v_keys, v_keys || array['possibility_evidence', 'email_selection']);
  if p_payload ? 'possibility_evidence' then
    v_evidence := p_payload -> 'possibility_evidence';
    perform private.partner_check(jsonb_typeof(v_evidence) = 'array');
    perform private.partner_check(jsonb_array_length(v_evidence) <= 160);
    for v_condition in select value from jsonb_array_elements(v_evidence) loop
      perform private.partner_keys(v_condition, array['format', 'condition_hash'], array['format', 'condition_hash']);
      perform private.partner_check(
        private.partner_enum(v_condition, 'format', array['evento_vicino', 'evento_lontano', 'brand', 'media', 'negozio']) is not null
        and private.partner_text(v_condition, 'condition_hash', 64) ~ '^[0-9a-f]{64}$');
    end loop;
  end if;
  v_job_id := private.partner_uuid(p_payload, 'job_id');
  v_token := private.partner_uuid(p_payload, 'lease_token');
  v_model := private.partner_text(p_payload, 'model', 100);
  v_rules := private.partner_bigint(p_payload, 'rules_version', 1, 2147483647);
  -- La scelta: chiavi esatte, tipi, elenchi chiusi, date vuote o reali.
  v_choice := p_payload -> 'choice';
  perform private.partner_keys(v_choice, v_strings || v_flags || v_enums, v_strings || v_flags || v_enums);
  perform private.partner_check(not exists (select 1 from unnest(v_strings) k
    where jsonb_typeof(v_choice -> k) <> 'string' or char_length(v_choice ->> k) > 2000
      or (v_choice ->> k) ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'));
  perform private.partner_check(not exists (select 1 from unnest(v_flags) k
    where jsonb_typeof(v_choice -> k) <> 'boolean'));
  perform private.partner_check(
    private.partner_enum(v_choice, 'contact_kind', array['club', 'brand', 'media', 'evento', 'negozio']) is not null
    and private.partner_enum(v_choice, 'language', array['it', 'en', 'de', 'fr', 'es']) is not null
    and private.partner_enum(v_choice, 'register', array['voi', 'lei', 'you', 'sie', 'vous', 'usted']) is not null
    and private.partner_enum(v_choice, 'request',
      array['merch_cobranding', 'collab_capsule', 'stand_evento', 'vendita_negozio']) is not null);
  foreach v_key in array array['write_on', 'fact_date', 'event_starts_on'] loop
    if v_choice ->> v_key <> '' then perform private.partner_date(v_choice, v_key); end if;
  end loop;
  if p_payload ? 'email_selection' then
    v_selection := p_payload -> 'email_selection';
    perform private.partner_keys(v_selection, v_selection_keys,
      v_selection_keys || array['sottotipo', 'discordanza', 'tipo_estratto']);
    v_format := private.partner_enum(v_selection, 'formato',
      array['evento_vicino', 'evento_lontano', 'brand', 'media', 'negozio']);
    v_config_version := private.partner_bigint(v_selection, 'config_version', 1, 2147483647);
    perform private.partner_check(v_format is not null and v_config_version is not null
      and private.partner_enum(v_selection, 'filone', array['A', 'B']) is not null
      and private.partner_text(v_selection, 'motivo_filone', 500) ~ '\S');
    if v_selection ? 'sottotipo' then
      perform private.partner_check(private.partner_text(v_selection, 'sottotipo', 1000) ~ '\S');
    end if;
    if v_selection ? 'discordanza' or v_selection ? 'tipo_estratto' then
      perform private.partner_check(private.partner_text(v_selection, 'discordanza', 1000) ~ '\S'
        and private.partner_enum(v_selection, 'tipo_estratto', array['club', 'brand', 'media', 'evento', 'negozio'])
          <> v_choice ->> 'contact_kind');
    end if;
    perform private.partner_check(v_format = case v_choice ->> 'contact_kind'
      when 'evento' then case when (v_choice ->> 'event_reachable')::boolean then 'evento_vicino' else 'evento_lontano' end
      when 'club' then null
      else v_choice ->> 'contact_kind'
    end and (v_choice ->> 'request') = case v_format
      when 'evento_vicino' then 'stand_evento'
      when 'evento_lontano' then 'merch_cobranding'
      when 'negozio' then 'vendita_negozio'
      else 'collab_capsule'
    end);
    perform private.partner_check(exists (select 1 from public.partner_email_config_versions c
      where c.version = v_config_version
        and (c.config -> 'formati') @> jsonb_build_array(jsonb_build_object('id', v_format))));
  end if;
  -- La decisione: scrivi, attendi fino a un giorno dopo oggi, oppure blocca con il motivo.
  v_decision := p_payload -> 'decision';
  perform private.partner_check(jsonb_typeof(v_decision) = 'object');
  v_kind := private.partner_enum(v_decision, 'kind', array['scrivi', 'attendi', 'blocca']);
  if v_kind = 'scrivi' then
    perform private.partner_keys(v_decision, array['kind'], array['kind']);
  elsif v_kind = 'attendi' then
    perform private.partner_keys(v_decision, array['kind', 'write_on'], array['kind', 'write_on']);
    v_write_on := private.partner_date(v_decision, 'write_on');
    perform private.partner_check(v_write_on > v_today);
  elsif v_kind = 'blocca' then
    perform private.partner_keys(v_decision, array['kind', 'reason'], array['kind', 'reason']);
    v_reason := private.partner_enum(v_decision, 'reason', array['fatto_mancante', 'fuso_mancante']);
    perform private.partner_check(v_reason is not null);
  else
    perform private.partner_check(false);
  end if;
  perform private.partner_check(v_job_id is not null and v_token is not null
    and v_model ~ '^[A-Za-z0-9._:-]{1,100}$' and v_rules is not null);
  if v_actor is null then raise exception 'partner_assistant_not_configured' using errcode = '55000'; end if;
  replay := private.partner_assistant_begin(p_operation_id, 'complete_partner_assistant_choice', v_actor, p_payload);
  if replay is not null then return replay; end if;
  stop := private.partner_assistant_lock_step(v_job_id, v_token, 'estrazione');
  if stop is not null then return stop; end if;
  select * into j from public.partner_assistant_jobs where id = v_job_id;
  insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id, created_by)
    values (j.partner_id, 'scelta', v_choice || jsonb_build_object('decision', v_decision)
      || case when v_evidence is null then '{}'::jsonb else jsonb_build_object('possibility_evidence', v_evidence) end
      || case when v_selection is null then '{}'::jsonb
        else v_selection || jsonb_build_object('possibilita_usate', '[]'::jsonb) end,
      v_rules, v_model, p_operation_id, v_actor)
    returning id into v_note;
  update public.partner_assistant_jobs set choice_note_id = v_note, attempts = 0, lease_token = null,
      lease_expires_at = null, next_attempt_at = now(), updated_at = now(),
      step = case when v_kind = 'scrivi' then 'scrittura' else step end,
      status = case v_kind when 'scrivi' then 'in_coda' when 'attendi' then 'attesa' else 'serve_tommaso' end,
      write_on = v_write_on,
      reason = v_reason
    where partner_id = j.partner_id
    returning * into j;
  insert into private.partner_assistant_events(partner_id, step, outcome)
    values (j.partner_id, 'estrazione', coalesce(v_reason, v_kind));
  result := jsonb_build_object('status', 'done', 'job_status', j.status, 'step', j.step, 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'complete_partner_assistant_choice', v_actor, p_payload,
    result);
end
$$;

create or replace function private.complete_partner_assistant_draft(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'job_id', 'lease_token', 'draft', 'checks_ok', 'failures'];
  v_draft_keys text[] := array['language', 'subject', 'body', 'signature', 'sha256', 'rules_version',
    'partner_version', 'contact_id'];
  v_actor uuid; v_job_id uuid; v_token uuid; v_draft jsonb; v_language text; v_subject text; v_body text;
  v_signature text; v_sha text; v_rules bigint; v_partner_version bigint; v_contact uuid; v_ok boolean;
  v_failures jsonb; v_outcome text; v_draft_id uuid; v_config_version integer; v_config_day date;
  v_indexes jsonb; v_used jsonb := '[]'::jsonb; v_item jsonb; v_index integer; v_seen integer[] := '{}';
  v_format jsonb; v_option jsonb; v_option_text text; v_choice_note_id uuid; v_step text;
  v_choice public.partner_assistant_notes%rowtype;
  j public.partner_assistant_jobs%rowtype; replay jsonb; stop jsonb; result jsonb;
begin
  perform private.partner_assistant_service_required();
  v_actor := private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, v_keys, v_keys || array['used_possibility_indexes']);
  if p_payload ? 'used_possibility_indexes' then
    v_indexes := p_payload -> 'used_possibility_indexes';
    perform private.partner_check(jsonb_typeof(v_indexes) = 'array');
    perform private.partner_check(jsonb_array_length(v_indexes) <= 2);
  end if;
  v_job_id := private.partner_uuid(p_payload, 'job_id');
  v_token := private.partner_uuid(p_payload, 'lease_token');
  v_draft := p_payload -> 'draft';
  perform private.partner_keys(v_draft, v_draft_keys, v_draft_keys || array['config_version', 'config_day']);
  if v_draft ? 'config_version' then
    v_config_version := private.partner_bigint(v_draft, 'config_version', 1, 2147483647);
    perform private.partner_check(v_config_version is not null);
  end if;
  if v_draft ? 'config_day' then
    v_config_day := private.partner_date(v_draft, 'config_day');
    perform private.partner_check(v_config_version is not null and v_config_day is not null);
  end if;
  v_language := private.partner_enum(v_draft, 'language', array['it', 'en', 'de', 'fr', 'es']);
  v_subject := private.partner_text(v_draft, 'subject', 300);
  v_body := private.partner_text(v_draft, 'body', 8000);
  v_signature := private.partner_text(v_draft, 'signature', 300);
  v_sha := private.partner_text(v_draft, 'sha256', 64);
  v_rules := private.partner_bigint(v_draft, 'rules_version', 1, 2147483647);
  v_partner_version := private.partner_bigint(v_draft, 'partner_version', 1, 9007199254740991);
  v_contact := private.partner_uuid(v_draft, 'contact_id');
  v_ok := private.partner_bool(p_payload, 'checks_ok');
  v_failures := p_payload -> 'failures';
  perform private.partner_check(jsonb_typeof(v_failures) = 'array');
  perform private.partner_check(jsonb_array_length(v_failures) <= 20
    and not exists (select 1 from jsonb_array_elements(v_failures) f
      where jsonb_typeof(f) <> 'string' or (f #>> '{}') !~ '^[a-z][a-z0-9_]{0,79}$'));
  perform private.partner_check(v_job_id is not null and v_token is not null and v_language is not null
    and v_subject ~ '\S' and v_body ~ '\S' and v_signature ~ '\S' and v_sha ~ '^[0-9a-f]{64}$'
    and v_rules is not null and v_partner_version is not null and v_contact is not null and v_ok is not null
    and v_ok = (jsonb_array_length(v_failures) = 0));
  if v_actor is null then raise exception 'partner_assistant_not_configured' using errcode = '55000'; end if;
  replay := private.partner_assistant_begin(p_operation_id, 'complete_partner_assistant_draft', v_actor, p_payload);
  if replay is not null then return replay; end if;
  stop := private.partner_assistant_lock_step(v_job_id, v_token, 'scrittura');
  if stop is not null then return stop; end if;
  select * into j from public.partner_assistant_jobs where id = v_job_id;
  select n.* into v_choice from public.partner_assistant_notes n
    where n.id = j.choice_note_id and n.partner_id = j.partner_id and n.kind = 'scelta';
  if v_indexes is not null then
    perform private.partner_check(found and v_choice.content ? 'formato'
      and v_config_version is not null and v_config_version = (v_choice.content ->> 'config_version')::integer);
    v_step := private.partner_assistant_reselect_email_choice_if_stale(j, v_choice.content);
    if v_step is not null then
      result := jsonb_build_object('status', 'done', 'job_status', j.status, 'step', v_step, 'replayed', false);
      return private.partner_assistant_finish(p_operation_id, 'complete_partner_assistant_draft', v_actor, p_payload,
        result);
    end if;
    select f into v_format
      from public.partner_email_config_versions c cross join lateral jsonb_array_elements(c.config -> 'formati') f
      where c.version = v_config_version and f ->> 'id' = v_choice.content ->> 'formato';
    perform private.partner_check(v_format is not null);
    for v_item in select value from jsonb_array_elements(v_indexes) loop
      v_index := private.partner_bigint(jsonb_build_object('index', v_item), 'index', 0, 31);
      perform private.partner_check(v_index is not null and not (v_index = any(v_seen)));
      v_option := v_format -> 'possibilita' -> v_index;
      v_option_text := private.partner_text(v_option, 'testo', 1000);
      perform private.partner_check(v_option -> 'attiva' = 'true'::jsonb and v_option_text ~ '\S');
      v_seen := array_append(v_seen, v_index);
      v_used := v_used || jsonb_build_array(v_option_text);
    end loop;
  end if;
  perform private.partner_check(v_config_version is null or not private.partner_assistant_uses_template(j.partner_id));
  -- Il destinatario è l'email scelta per il contatto, la stessa del contesto: mai un'altra email
  -- (non attiva, senza link_value o non scelta) né un indirizzo copiato. Un recapito che non è del
  -- contatto non è mai stato nel contesto: payload non valido. Uno del contatto che non è più quello
  -- scelto vuol dire che il team ha cambiato le email a metà passo: contesto_cambiato, niente scritto
  -- oltre all'evento, lease rilasciata e nessun tentativo consumato; il giro dopo rifà la scrittura
  -- con il contesto nuovo.
  perform private.partner_check(exists (select 1 from public.partner_contacts c
    where c.id = v_contact and c.partner_id = j.partner_id and c.kind = 'email'));
  -- Il ricontrollo d'invio usa la data di creazione della bozza. Se è cambiato il giorno di Roma
  -- durante la scrittura, riprova con le condizioni di oggi, senza alterare created_at.
  -- Il worker precedente legge una proiezione senza formato o filone. Non può
  -- salvare una bozza su quella scelta se non ha applicato il contratto nuovo.
  if (v_indexes is null and v_choice.content ? 'formato')
    or v_contact is distinct from (select e.contact_id from private.partner_assistant_email(j.partner_id) e)
    or (v_config_day is not null and v_config_day <> (now() at time zone 'Europe/Rome')::date) then
    update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null, updated_at = now()
      where partner_id = j.partner_id;
    insert into private.partner_assistant_events(partner_id, step, outcome)
      values (j.partner_id, 'scrittura', 'contesto_cambiato');
    return jsonb_build_object('status', 'contesto_cambiato');
  end if;
  if v_indexes is not null then
    -- Una copia della scelta per ogni bozza mantiene immutabile anche la scelta
    -- della bozza precedente in caso di riscrittura.
    insert into public.partner_assistant_notes(partner_id, kind, content, sources, rules_version, model, operation_id, created_by)
      values (j.partner_id, 'scelta', jsonb_set(v_choice.content, '{possibilita_usate}', v_used),
        v_choice.sources, v_choice.rules_version, v_choice.model, gen_random_uuid(), v_actor)
      returning id into v_choice_note_id;
  end if;
  insert into public.partner_assistant_drafts(partner_id, contact_id, partner_version, language, subject, body,
      signature, sha256, rules_version, research_note_id, operation_id, created_by, config_version, config_day, choice_note_id)
    values (j.partner_id, v_contact, v_partner_version, v_language, v_subject, v_body, v_signature, v_sha, v_rules,
      j.research_note_id, p_operation_id, v_actor, v_config_version, v_config_day, v_choice_note_id)
    returning id into v_draft_id;
  if not v_ok then
    insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, operation_id, created_by)
      values (j.partner_id, 'controllo', jsonb_build_object('approved', false, 'problems', v_failures), v_rules,
        p_operation_id, v_actor);
  end if;
  v_outcome := case when v_ok then 'controlli_superati' when j.rewrites = 0 then 'riscrittura'
    else 'controlli_falliti' end;
  update public.partner_assistant_jobs set draft_id = v_draft_id,
      choice_note_id = coalesce(v_choice_note_id, j.choice_note_id), attempts = 0, lease_token = null,
      lease_expires_at = null, next_attempt_at = now(), updated_at = now(),
      step = case when v_ok then 'controllo' else step end,
      rewrites = case when v_outcome = 'riscrittura' then 1 else rewrites end,
      status = case when v_outcome = 'controlli_falliti' then 'serve_tommaso' else status end,
      reason = case when v_outcome = 'controlli_falliti' then 'controlli_falliti' else reason end
    where partner_id = j.partner_id
    returning * into j;
  insert into private.partner_assistant_events(partner_id, step, outcome) values (j.partner_id, 'scrittura', v_outcome);
  result := jsonb_build_object('status', 'done', 'job_status', j.status, 'step', j.step, 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'complete_partner_assistant_draft', v_actor, p_payload,
    result);
end
$$;

create function private.context_partner_assistant_email_format_step(p_job_id uuid, p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.partner_assistant_jobs%rowtype;
  p public.partners%rowtype;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  select * into j from public.partner_assistant_jobs l
    where l.id = p_job_id and l.lease_token = p_lease_token and l.lease_expires_at > clock_timestamp();
  if not found then return jsonb_build_object('status', 'lease_persa'); end if;
  select * into p from public.partners where id = j.partner_id;
  return jsonb_build_object(
    'status', 'ok',
    'today', (now() at time zone 'Europe/Rome')::date,
    'partner', jsonb_build_object('co', p.co, 'name', p.name, 'city', p.city, 'country', p.country,
      'type_label', p.type_label, 'sections', to_jsonb(p.sections), 'priority', p.priority,
      'contact_month', p.contact_month, 'event_starts_on', p.event_starts_on, 'event_ends_on', p.event_ends_on,
      'application_deadline', p.application_deadline, 'version', p.version, 'research', p.research),
    'email', (select jsonb_build_object('contact_id', e.contact_id, 'address', e.address, 'verified', e.verified)
      from private.partner_assistant_email(j.partner_id) e),
    'rules', (select jsonb_build_object('version', r.version, 'body', r.body)
      from public.partner_assistant_rules r order by r.version desc limit 1),
    'research', (select jsonb_build_object('note_id', n.id, 'text', n.content ->> 'text', 'sources', to_jsonb(n.sources),
        'created_at', n.created_at)
      from public.partner_assistant_notes n where n.id = j.research_note_id),
    'choice', (select jsonb_build_object('note_id', n.id, 'content', n.content)
      || case when n.content ? 'formato' then jsonb_build_object('email_selection_already_used',
        exists (select 1 from public.partner_assistant_drafts d where d.choice_note_id = n.id))
      else '{}'::jsonb end
      from public.partner_assistant_notes n where n.id = j.choice_note_id),
    'draft', (select jsonb_build_object('draft_id', d.id, 'language', d.language, 'subject', d.subject,
        'body', d.body, 'signature', d.signature, 'sha256', d.sha256, 'rules_version', d.rules_version,
        'created_at', d.created_at)
      || case when d.config_version is null then '{}'::jsonb else jsonb_build_object('config_version', d.config_version) end
      || case when d.config_day is null then '{}'::jsonb else jsonb_build_object('config_day', d.config_day) end
      from public.partner_assistant_drafts d where d.id = j.draft_id),
    'last_review', (select jsonb_build_object('approved', n.content -> 'approved', 'problems', n.content -> 'problems')
      from public.partner_assistant_notes n join public.partner_assistant_drafts d on d.id = j.draft_id
      where n.partner_id = j.partner_id and n.kind = 'controllo' and n.created_at >= d.created_at
      order by n.created_at desc, n.id desc limit 1)
  );
end
$$;

-- Le due versioni del worker precedenti mantengono i loro contratti a chiavi esatte.
create or replace function private.context_partner_assistant_email_step(p_job_id uuid, p_lease_token uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select private.context_partner_assistant_email_format_step(p_job_id, p_lease_token)
    #- '{choice,email_selection_already_used}' #- '{choice,content,formato}'
    #- '{choice,content,filone}' #- '{choice,content,motivo_filone}' #- '{choice,content,config_version}'
    #- '{choice,content,sottotipo}' #- '{choice,content,discordanza}' #- '{choice,content,tipo_estratto}'
    #- '{choice,content,possibilita_usate}'
$$;

create function public.context_partner_assistant_email_format_step(p_job_id uuid, p_lease_token uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.context_partner_assistant_email_format_step(p_job_id, p_lease_token)
$$;

revoke all on function private.context_partner_assistant_email_format_step(uuid, uuid),
  public.context_partner_assistant_email_format_step(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.context_partner_assistant_email_format_step(uuid, uuid),
  public.context_partner_assistant_email_format_step(uuid, uuid) to service_role;

commit;
