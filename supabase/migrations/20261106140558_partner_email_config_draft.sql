-- Registra la configurazione usata soltanto quando chi scrive una bozza generica la indica.
-- La stessa transazione salva la bozza, la versione e la ricevuta. Le chiamate precedenti
-- omettono la chiave e il collegamento resta NULL, senza attribuire loro la configurazione v1.
begin;

create or replace function private.complete_partner_assistant_draft(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'job_id', 'lease_token', 'draft', 'checks_ok', 'failures'];
  v_draft_keys text[] := array['language', 'subject', 'body', 'signature', 'sha256', 'rules_version',
    'partner_version', 'contact_id'];
  v_actor uuid; v_job_id uuid; v_token uuid; v_draft jsonb; v_language text; v_subject text; v_body text;
  v_signature text; v_sha text; v_rules bigint; v_partner_version bigint; v_contact uuid; v_ok boolean;
  v_failures jsonb; v_outcome text; v_draft_id uuid; v_config_version integer;
  j public.partner_assistant_jobs%rowtype; replay jsonb; stop jsonb; result jsonb;
begin
  perform private.partner_assistant_service_required();
  v_actor := private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, v_keys, v_keys);
  v_job_id := private.partner_uuid(p_payload, 'job_id');
  v_token := private.partner_uuid(p_payload, 'lease_token');
  v_draft := p_payload -> 'draft';
  perform private.partner_keys(v_draft, v_draft_keys, v_draft_keys || array['config_version']);
  if v_draft ? 'config_version' then
    v_config_version := private.partner_bigint(v_draft, 'config_version', 1, 2147483647);
    perform private.partner_check(v_config_version is not null);
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
  perform private.partner_check(v_config_version is null or not private.partner_assistant_uses_template(j.partner_id));
  -- Il destinatario è l'email scelta per il contatto, la stessa del contesto: mai un'altra email
  -- (non attiva, senza link_value o non scelta) né un indirizzo copiato. Un recapito che non è del
  -- contatto non è mai stato nel contesto: payload non valido. Uno del contatto che non è più quello
  -- scelto vuol dire che il team ha cambiato le email a metà passo: contesto_cambiato, niente scritto
  -- oltre all'evento, lease rilasciata e nessun tentativo consumato; il giro dopo rifà la scrittura
  -- con il contesto nuovo.
  perform private.partner_check(exists (select 1 from public.partner_contacts c
    where c.id = v_contact and c.partner_id = j.partner_id and c.kind = 'email'));
  if v_contact is distinct from (select e.contact_id from private.partner_assistant_email(j.partner_id) e) then
    update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null, updated_at = now()
      where partner_id = j.partner_id;
    insert into private.partner_assistant_events(partner_id, step, outcome)
      values (j.partner_id, 'scrittura', 'contesto_cambiato');
    return jsonb_build_object('status', 'contesto_cambiato');
  end if;
  insert into public.partner_assistant_drafts(partner_id, contact_id, partner_version, language, subject, body,
      signature, sha256, rules_version, research_note_id, operation_id, created_by, config_version)
    values (j.partner_id, v_contact, v_partner_version, v_language, v_subject, v_body, v_signature, v_sha, v_rules,
      j.research_note_id, p_operation_id, v_actor, v_config_version)
    returning id into v_draft_id;
  if not v_ok then
    insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, operation_id, created_by)
      values (j.partner_id, 'controllo', jsonb_build_object('approved', false, 'problems', v_failures), v_rules,
        p_operation_id, v_actor);
  end if;
  v_outcome := case when v_ok then 'controlli_superati' when j.rewrites = 0 then 'riscrittura'
    else 'controlli_falliti' end;
  update public.partner_assistant_jobs set draft_id = v_draft_id, attempts = 0, lease_token = null,
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

commit;
