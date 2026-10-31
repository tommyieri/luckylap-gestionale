-- Assistente Partner, modalità modello per i club (1 novembre 2026, decisione di Tommi del 31 ottobre).
-- Per i contatti della sezione Club la bozza non la scrive Claude: il codice la compone dal testo fisso
-- approvato da Tommaso, con il nome del club, nella lingua del club. Claude fa solo la seconda lettura.
--
-- Additiva:
-- - private.partner_assistant_lock_any_step: la guardia dei complete_* con più passi ammessi;
-- - private.partner_assistant_is_template: la bozza viene dal modello (segno nella nota di ricerca);
-- - private/public.complete_partner_assistant_template: in una transazione la nota di ricerca
--   sostitutiva, la nota «scelta» composta dal database e la bozza; il lavoro va al controllo;
-- - complete_partner_assistant_review: una bozza del modello bocciata passa a Tommi, mai in
--   riscrittura (il testo fisso tornerebbe uguale);
-- - claim_partner_assistant_step: al più 20 bozze del modello pronte alla volta, così il controllo si
--   paga solo per le email che partono a breve e le bozze non scadono in coda.
-- Nessuna tabella nuova, nessun dato cambiato, nessun permesso nuovo ai ruoli client.

-- ---------------------------------------------------------------------------
-- Guardia con più passi
-- ---------------------------------------------------------------------------

-- Come private.partner_assistant_lock_step (20261028122956), con un elenco di passi ammessi: lo stesso
-- ordine dei lock (contatto for share, poi lavoro for update), la stessa lease e la stessa idoneità.
create function private.partner_assistant_lock_any_step(p_job_id uuid, p_lease_token uuid, p_steps text[])
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.partner_assistant_jobs%rowtype; v_partner uuid;
begin
  select l.partner_id into v_partner from public.partner_assistant_jobs l where l.id = p_job_id;
  if not found then return jsonb_build_object('status', 'lease_persa'); end if;
  perform 1 from public.partners where id = v_partner for share;
  select * into j from public.partner_assistant_jobs where id = p_job_id for update;
  if not found or j.lease_token is distinct from p_lease_token or j.lease_expires_at is null
    or j.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  perform private.partner_check(j.step = any (p_steps));
  if not private.partner_assistant_eligible(j.partner_id) then
    update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null, updated_at = now()
      where partner_id = j.partner_id;
    insert into private.partner_assistant_events(partner_id, step, outcome) values (j.partner_id, j.step, 'non_idoneo');
    return jsonb_build_object('status', 'non_idoneo');
  end if;
  return null;
end
$$;

-- Una bozza viene dal modello se la sua nota di ricerca lo dice: la scrive solo
-- complete_partner_assistant_template.
create function private.partner_assistant_is_template(p_research_note_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select coalesce((select n.kind = 'ricerca' and n.content ->> 'template' = 'true'
    from public.partner_assistant_notes n where n.id = p_research_note_id), false)
$$;

-- ---------------------------------------------------------------------------
-- La bozza del modello
-- ---------------------------------------------------------------------------

-- Dal passo ricerca, estrazione o scrittura (ogni ritorno indietro, comprese ricerca scaduta e regole
-- nuove, passa di qui) al controllo, in una transazione:
-- - una nota «ricerca» sostitutiva, senza modello e senza fonti, con il segno del modello: serve alla
--   bozza (research_note_id è obbligatorio) e alla coda d'invio, che la unisce;
-- - una nota «scelta» composta qui, con le 24 chiavi e la richiesta che il contesto e l'invio leggono:
--   club, merch_cobranding, lingua, registro e fuso dati dal codice, decisione «scrivi»;
-- - la bozza, con l'impronta ricalcolata qui sul testo ricevuto.
-- Il contatto deve essere ancora nella sezione Club, con la stessa email, la stessa versione della
-- scheda e le regole in vigore: altrimenti contesto_cambiato, lease rilasciata e nessun tentativo
-- consumato, come per la bozza scritta da Claude. Controlli del codice falliti: a Tommi, senza
-- riscrittura.
create function private.complete_partner_assistant_template(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'job_id', 'lease_token', 'template_version', 'register', 'timezone',
    'porsche_community', 'swiss', 'draft', 'checks_ok', 'failures'];
  v_draft_keys text[] := array['language', 'subject', 'body', 'signature', 'sha256', 'rules_version',
    'partner_version', 'contact_id'];
  v_actor uuid; v_job_id uuid; v_token uuid; v_template integer; v_register text; v_timezone text;
  v_porsche boolean; v_swiss boolean; v_draft jsonb; v_language text; v_subject text; v_body text;
  v_signature text; v_sha text; v_rules bigint; v_partner_version bigint; v_contact uuid; v_ok boolean;
  v_failures jsonb; v_outcome text; v_research_id uuid; v_choice_id uuid; v_draft_id uuid; v_step text;
  j public.partner_assistant_jobs%rowtype; p public.partners%rowtype; replay jsonb; stop jsonb; result jsonb;
begin
  perform private.partner_assistant_service_required();
  v_actor := private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, v_keys, v_keys);
  v_job_id := private.partner_uuid(p_payload, 'job_id');
  v_token := private.partner_uuid(p_payload, 'lease_token');
  v_template := private.partner_bigint(p_payload, 'template_version', 1, 1000);
  v_register := private.partner_enum(p_payload, 'register', array['voi', 'lei', 'you', 'sie', 'vous', 'usted']);
  v_timezone := private.partner_text(p_payload, 'timezone', 64);
  v_porsche := private.partner_bool(p_payload, 'porsche_community');
  v_swiss := private.partner_bool(p_payload, 'swiss');
  v_draft := p_payload -> 'draft';
  perform private.partner_keys(v_draft, v_draft_keys, v_draft_keys);
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
  -- Il registro va con la lingua, come lo scrive il codice; il fuso è un nome IANA che la finestra
  -- d'invio riconosce (altrimenti varrebbe Roma senza avvisi).
  perform private.partner_check(v_job_id is not null and v_token is not null and v_template is not null
    and v_register is not null and v_porsche is not null and v_swiss is not null and v_language is not null
    and v_register = case v_language when 'it' then 'voi' when 'en' then 'you' when 'de' then 'sie'
      when 'fr' then 'vous' else 'usted' end
    and private.partner_assistant_valid_timezone(v_timezone)
    and v_subject ~ '\S' and v_body ~ '\S' and v_signature ~ '\S' and v_sha ~ '^[0-9a-f]{64}$'
    and v_sha = encode(sha256(convert_to(v_subject || E'\n\n' || v_body || E'\n\n' || v_signature, 'UTF8')), 'hex')
    and v_rules is not null and v_partner_version is not null and v_contact is not null and v_ok is not null
    and v_ok = (jsonb_array_length(v_failures) = 0));
  if v_actor is null then raise exception 'partner_assistant_not_configured' using errcode = '55000'; end if;
  replay := private.partner_assistant_begin(p_operation_id, 'complete_partner_assistant_template', v_actor,
    p_payload);
  if replay is not null then return replay; end if;
  stop := private.partner_assistant_lock_any_step(v_job_id, v_token, array['ricerca', 'estrazione', 'scrittura']);
  if stop is not null then return stop; end if;
  select * into j from public.partner_assistant_jobs where id = v_job_id;
  select * into p from public.partners where id = j.partner_id;
  v_step := j.step;
  perform private.partner_check(exists (select 1 from public.partner_contacts c
    where c.id = v_contact and c.partner_id = j.partner_id and c.kind = 'email'));
  -- Sezione, email, scheda o regole cambiate a metà passo: niente scritto oltre all'evento.
  if not ('club' = any (p.sections))
    or v_contact is distinct from (select e.contact_id from private.partner_assistant_email(j.partner_id) e)
    or v_partner_version <> p.version
    or v_rules <> (select max(r.version) from public.partner_assistant_rules r) then
    update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null, updated_at = now()
      where partner_id = j.partner_id;
    insert into private.partner_assistant_events(partner_id, step, outcome)
      values (j.partner_id, v_step, 'contesto_cambiato');
    return jsonb_build_object('status', 'contesto_cambiato');
  end if;
  -- Tre righe nella stessa operazione: operation_id è unico per tabella, quindi le note hanno un id
  -- derivato e fisso (una ripetizione dell'operazione si ferma prima, sulla ricevuta).
  insert into public.partner_assistant_notes(partner_id, kind, content, sources, rules_version, model, operation_id,
      created_by)
    values (j.partner_id, 'ricerca', jsonb_build_object('text',
        'Nessuna ricerca: bozza dal testo fisso per i club approvato da Tommaso (versione ' || v_template
          || '), con il nome del club. Claude fa solo la seconda lettura.',
        'template', true, 'template_version', v_template),
      '{}'::text[], v_rules, null, md5(p_operation_id::text || ':modello:ricerca')::uuid, v_actor)
    returning id into v_research_id;
  insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id, created_by)
    values (j.partner_id, 'scelta', jsonb_build_object(
        'contact_kind', 'club', 'porsche_community', v_porsche,
        'reason_it', 'Testo fisso per i club, versione ' || v_template || ', approvato da Tommaso.',
        'write_now', true, 'write_on', '', 'recipient_email', '', 'recipient_email_source', '',
        'recipient_email_published_by_org', false, 'person_name', '', 'person_title', '',
        'language', v_language, 'register', v_register, 'swiss', v_swiss, 'timezone', v_timezone,
        'fact_text', '', 'fact_date', '', 'fact_source', '', 'event_name', '', 'event_starts_on', '',
        'event_city', '', 'event_country', '', 'event_reachable', false,
        'notes_it', 'Bozza dal modello per i club: nessuna ricerca, nessuna scrittura di Claude.',
        'request', 'merch_cobranding', 'decision', jsonb_build_object('kind', 'scrivi')),
      v_rules, null, md5(p_operation_id::text || ':modello:scelta')::uuid, v_actor)
    returning id into v_choice_id;
  insert into public.partner_assistant_drafts(partner_id, contact_id, partner_version, language, subject, body,
      signature, sha256, rules_version, research_note_id, operation_id, created_by)
    values (j.partner_id, v_contact, v_partner_version, v_language, v_subject, v_body, v_signature, v_sha, v_rules,
      v_research_id, p_operation_id, v_actor)
    returning id into v_draft_id;
  if not v_ok then
    insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, operation_id, created_by)
      values (j.partner_id, 'controllo', jsonb_build_object('approved', false, 'problems', v_failures), v_rules,
        md5(p_operation_id::text || ':modello:controllo')::uuid, v_actor);
  end if;
  v_outcome := case when v_ok then 'modello' else 'modello_controlli' end;
  update public.partner_assistant_jobs set research_note_id = v_research_id, choice_note_id = v_choice_id,
      draft_id = v_draft_id, attempts = 0, rewrites = 0, write_on = null, lease_token = null,
      lease_expires_at = null, next_attempt_at = now(), updated_at = now(),
      step = 'controllo',
      status = case when v_ok then 'in_coda' else 'serve_tommaso' end,
      reason = case when v_ok then null else 'modello_controlli' end
    where partner_id = j.partner_id
    returning * into j;
  insert into private.partner_assistant_events(partner_id, step, outcome) values (j.partner_id, v_step, v_outcome);
  result := jsonb_build_object('status', 'done', 'job_status', j.status, 'step', j.step, 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'complete_partner_assistant_template', v_actor, p_payload,
    result);
end
$$;

create function public.complete_partner_assistant_template(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.complete_partner_assistant_template(p_operation_id, p_payload) $$;

-- ---------------------------------------------------------------------------
-- Seconda lettura
-- ---------------------------------------------------------------------------

-- Come 20261028122956, con un caso in più: una bozza del modello non approvata (per un motivo diverso
-- dalle regole cambiate) passa a Tommi con modello_bocciato. Il modello ricomporrebbe lo stesso testo:
-- una riscrittura pagherebbe una seconda lettura per lo stesso esito.
create or replace function private.complete_partner_assistant_review(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'job_id', 'lease_token', 'approved', 'problems', 'sha256', 'model',
    'rules_version'];
  v_actor uuid; v_job_id uuid; v_token uuid; v_approved boolean; v_problems jsonb; v_sha text; v_model text;
  v_rules bigint; v_draft_sha text; v_template boolean; v_outcome text;
  j public.partner_assistant_jobs%rowtype; replay jsonb; stop jsonb; result jsonb;
begin
  perform private.partner_assistant_service_required();
  v_actor := private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, v_keys, v_keys);
  v_job_id := private.partner_uuid(p_payload, 'job_id');
  v_token := private.partner_uuid(p_payload, 'lease_token');
  v_approved := private.partner_bool(p_payload, 'approved');
  v_sha := private.partner_text(p_payload, 'sha256', 64);
  v_model := private.partner_text(p_payload, 'model', 100);
  v_rules := private.partner_bigint(p_payload, 'rules_version', 1, 2147483647);
  v_problems := p_payload -> 'problems';
  perform private.partner_check(jsonb_typeof(v_problems) = 'array');
  perform private.partner_check(jsonb_array_length(v_problems) <= 20
    and not exists (select 1 from jsonb_array_elements(v_problems) f
      where jsonb_typeof(f) <> 'string' or char_length(f #>> '{}') not between 1 and 1000
        or (f #>> '{}') ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'));
  perform private.partner_check(v_job_id is not null and v_token is not null and v_approved is not null
    and v_sha ~ '^[0-9a-f]{64}$' and (v_model is null or v_model ~ '^[A-Za-z0-9._:-]{1,100}$')
    and v_rules is not null);
  if v_actor is null then raise exception 'partner_assistant_not_configured' using errcode = '55000'; end if;
  replay := private.partner_assistant_begin(p_operation_id, 'complete_partner_assistant_review', v_actor, p_payload);
  if replay is not null then return replay; end if;
  stop := private.partner_assistant_lock_step(v_job_id, v_token, 'controllo');
  if stop is not null then return stop; end if;
  select * into j from public.partner_assistant_jobs where id = v_job_id;
  select d.sha256, private.partner_assistant_is_template(d.research_note_id) into v_draft_sha, v_template
    from public.partner_assistant_drafts d where d.id = j.draft_id;
  insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id, created_by)
    values (j.partner_id, 'controllo', jsonb_build_object('approved', v_approved, 'problems', v_problems,
      'sha256', v_sha), v_rules, v_model, p_operation_id, v_actor);
  v_outcome := case
    when v_approved and v_sha = v_draft_sha then 'pronta'
    when v_problems = '["regole_superate"]'::jsonb then 'regole_superate'
    when coalesce(v_template, false) then 'modello_bocciato'
    when j.rewrites = 0 then 'riscrittura'
    else 'seconda_lettura' end;
  update public.partner_assistant_jobs set attempts = 0, lease_token = null, lease_expires_at = null,
      next_attempt_at = now(), updated_at = now(),
      status = case v_outcome when 'pronta' then 'pronta' when 'seconda_lettura' then 'serve_tommaso'
        when 'modello_bocciato' then 'serve_tommaso' else 'in_coda' end,
      step = case when v_outcome in ('regole_superate', 'riscrittura') then 'scrittura' else step end,
      rewrites = case when v_outcome = 'riscrittura' then 1 else rewrites end,
      reason = case when v_outcome in ('seconda_lettura', 'modello_bocciato') then v_outcome else reason end
    where partner_id = j.partner_id
    returning * into j;
  insert into private.partner_assistant_events(partner_id, step, outcome) values (j.partner_id, 'controllo', v_outcome);
  result := jsonb_build_object('status', 'done', 'job_status', j.status, 'step', j.step, 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'complete_partner_assistant_review', v_actor, p_payload,
    result);
end
$$;

-- ---------------------------------------------------------------------------
-- Presa del lavoro, con il tetto delle bozze del modello pronte
-- ---------------------------------------------------------------------------

-- Come 20261030114722, con un filtro in più nella scelta del lavoro: con 20 o più bozze del modello
-- pronte da inviare, un contatto Club ancora prima del controllo aspetta. Le bozze pronte scendono con
-- gli invii; i lavori già al controllo continuano. Stesse risposte.
create or replace function private.claim_partner_assistant_step(p_worker_id uuid, p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c private.partner_assistant_config%rowtype;
  j public.partner_assistant_jobs%rowtype;
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_templates_full boolean;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  if p_worker_id is null or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  -- Un giro alla volta: chi arriva secondo aspetta qui, poi vede la lease del primo.
  select * into c from private.partner_assistant_config where singleton for update;
  update private.partner_assistant_config set last_tick_at = now() where singleton;
  if c.mode not in ('prepara', 'prova', 'invio') then return jsonb_build_object('status', 'idle', 'reason', 'spento'); end if;
  if c.actor_id is null then return jsonb_build_object('status', 'idle', 'reason', 'non_configurato'); end if;
  if c.paused_reason is not null then return jsonb_build_object('status', 'idle', 'reason', 'pausa'); end if;
  if c.backoff_until > now() then return jsonb_build_object('status', 'idle', 'reason', 'attesa'); end if;
  -- Un passo alla volta.
  if exists (select 1 from public.partner_assistant_jobs l where l.lease_expires_at > clock_timestamp()) then
    return jsonb_build_object('status', 'idle', 'reason', 'occupato');
  end if;
  -- Lease scaduta: un tentativo fallito; al terzo il contatto passa a Tommi. Prima i contatti di quei
  -- lavori (for share), poi i lavori, come nei comandi del team: una cancellazione definitiva in
  -- corso finisce prima, e la sua lease tolta non conta. Senza lease attive (controllo qui sopra)
  -- le due letture trovano gli stessi lavori.
  perform 1 from public.partners p join public.partner_assistant_jobs l on l.partner_id = p.id
    where l.lease_expires_at <= clock_timestamp()
    for share of p;
  with expired as (
    update public.partner_assistant_jobs l set attempts = least(l.attempts + 1, 3),
        status = case when l.attempts + 1 >= 3 then 'serve_tommaso' else l.status end,
        reason = case when l.attempts + 1 >= 3 then 'troppi_tentativi' else l.reason end,
        lease_token = null, lease_expires_at = null, updated_at = now()
      where l.lease_expires_at <= clock_timestamp()
      returning l.partner_id, l.step)
  insert into private.partner_assistant_events(partner_id, step, outcome)
    select e.partner_id, e.step, 'lease_scaduta' from expired e;
  -- Un lavoro per ogni contatto nuovo in coda.
  insert into public.partner_assistant_jobs(partner_id, status, step)
    select q.partner_id, 'in_coda', 'ricerca' from private.partner_assistant_queue(v_today) q
    on conflict (partner_id) do nothing;
  -- Attese arrivate al giorno giusto: si riparte dalla ricerca.
  update public.partner_assistant_jobs set status = 'in_coda', step = 'ricerca', write_on = null,
      next_attempt_at = now(), updated_at = now()
    where status = 'attesa' and write_on <= v_today;
  -- Bozze del modello pronte: al tetto, i contatti Club prima del controllo non si prendono.
  v_templates_full := (select count(*) from public.partner_assistant_jobs pj
      join public.partner_assistant_drafts d on d.id = pj.draft_id
    where pj.status = 'pronta' and private.partner_assistant_is_template(d.research_note_id)) >= 20;
  -- Il primo lavoro pronto, nell'ordine della coda, con il contatto ancora idoneo: la classifica
  -- della coda contiene solo i contatti idonei.
  select l.* into j from public.partner_assistant_jobs l
    join private.partner_assistant_ranking(v_today) r on r.partner_id = l.partner_id
    where l.status = 'in_coda' and l.next_attempt_at <= now() and l.attempts < 3
      and not (v_templates_full and l.step <> 'controllo'
        and exists (select 1 from public.partners cp where cp.id = l.partner_id and 'club' = any (cp.sections)))
    order by r.rank
    limit 1
    for update of l skip locked;
  if not found then return jsonb_build_object('status', 'idle', 'reason', 'vuota'); end if;
  update public.partner_assistant_jobs set lease_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds), updated_at = now()
    where partner_id = j.partner_id
    returning * into j;
  return jsonb_build_object('status', 'claimed', 'job', jsonb_build_object('job_id', j.id, 'partner_id', j.partner_id,
    'step', j.step, 'lease_token', j.lease_token, 'lease_expires_at', j.lease_expires_at, 'attempts', j.attempts,
    'rewrites', j.rewrites));
end
$$;

-- ---------------------------------------------------------------------------
-- Permessi
-- ---------------------------------------------------------------------------

-- Le funzioni nuove: EXECUTE tolto a tutti, poi solo service_role sulla RPC del worker (privata e
-- wrapper), come le altre RPC del worker. claim e review sostituite con create or replace tengono i
-- loro permessi.
revoke all on function private.partner_assistant_lock_any_step(uuid, uuid, text[]) from public, anon, authenticated,
  service_role;
revoke all on function private.partner_assistant_is_template(uuid) from public, anon, authenticated, service_role;
revoke all on function private.complete_partner_assistant_template(uuid, jsonb) from public, anon, authenticated,
  service_role;
revoke all on function public.complete_partner_assistant_template(uuid, jsonb) from public, anon, authenticated,
  service_role;
grant execute on function private.complete_partner_assistant_template(uuid, jsonb),
  public.complete_partner_assistant_template(uuid, jsonb) to service_role;
