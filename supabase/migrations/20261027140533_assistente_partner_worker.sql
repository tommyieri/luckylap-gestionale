-- Assistente Partner, prima consegna: coda e RPC del worker. Funzioni nuove, più tre ritocchi:
-- un vincolo sui lavori (ogni passaggio a Tommi ha il motivo), lo schema private usabile da
-- service_role e la revoca a service_role delle scritture dirette sulle tabelle Partner, che
-- scavalcherebbero comandi e «Non contattare».
--
-- - Coda: i contatti idonei senza lavoro, prima quelli del periodo (mese pianificato entro due mesi),
--   poi per priorità, mese e CO. Idoneo: «Da contattare», senza «Seguito da», prossima azione,
--   ricerca tolta, blocchi e attività del team, interruttore assente o attivo, un'email attiva.
--   L'ordine sta solo in partner_assistant_ranking, che usano sia la coda sia il giro.
-- - Un giro alla volta: claim blocca la riga di configurazione, conta le lease scadute come
--   tentativi falliti, crea i lavori nuovi, riprende le attese arrivate al giorno giusto e dà un
--   solo lavoro con la lease. Con una lease attiva il giro è «occupato»: un passo alla volta.
-- - Le quattro conclusioni dei passi passano tutte dalla stessa guardia, partner_assistant_lock_step.
-- - RPC: private.<nome> security definer più il wrapper public.<nome> security invoker, eseguibili
--   solo da service_role. Ognuna controlla il ruolo, poi fa risultare l'assistente come autore di
--   tutto quello che segue nella transazione: auth.uid() legge request.jwt.claim.sub e poi
--   request.jwt.claims->>'sub', impostati entrambi all'id configurato, con il claim role conservato.
-- - Gli esiti attesi (idle, lease_persa, non_idoneo, contesto_cambiato, stop) tornano come righe,
--   mai come eccezioni: il trasporto del worker scarta i corpi d'errore. Le conclusioni dei passi
--   hanno la ricevuta per operation_id e si ripetono anche a lease scaduta.
-- - Eventi senza testi né indirizzi: passo ed esito come codici.
--
-- Codici d'errore (messaggio = codice): 42501 partner_assistant_worker_access_required;
-- 22023 invalid_partner_assistant_configuration, invalid_partner_payload;
-- 55000 partner_assistant_not_configured; 23505 partner_idempotency_conflict.
begin;

-- Un lavoro passato a Tommi dice sempre perché.
alter table public.partner_assistant_jobs add constraint partner_assistant_jobs_reason_required
  check (status <> 'serve_tommaso' or reason is not null);

grant usage on schema private to service_role;

-- ---------------------------------------------------------------------------
-- Funzioni di supporto (nessun grant)
-- ---------------------------------------------------------------------------

-- Copia di private.shopify_service_required.
create function private.partner_assistant_service_required() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'partner_assistant_worker_access_required' using errcode = '42501';
  end if;
end
$$;

-- L'assistente come autore fino alla fine della transazione: attività, ricevute e audit leggono
-- auth.uid(). Senza profilo configurato nessun sub.
create function private.partner_assistant_as_actor() returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_actor uuid := (select c.actor_id from private.partner_assistant_config c where c.singleton);
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) - 'sub';
begin
  if v_actor is not null then v_claims := v_claims || jsonb_build_object('sub', v_actor); end if;
  perform pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(v_actor::text, ''), true);
  return v_actor;
end
$$;

-- Contatto che l'assistente può prendere o continuare. Le attività che contano sono quelle con cui
-- una persona dice di lavorarci già (invii, risposte, chiamate, note, stato…); un recapito
-- aggiunto dal team non conta.
create function private.partner_assistant_eligible(p_partner_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.partners p
    where p.id = p_partner_id and p.stage = 'da_contattare' and p.owner_id is null and p.next_action is null
      and p.research_removed_at is null
      and not private.partner_blocked(p.id)
      and not exists (select 1 from public.partner_assistant_contacts s where s.partner_id = p.id and not s.active)
      and exists (select 1 from public.partner_contacts c
        where c.partner_id = p.id and c.kind = 'email' and c.active and c.link_value is not null)
      and not exists (select 1 from public.partner_activities a
        where a.partner_id = p.id and a.origin in ('team', 'file')
          and a.kind in ('inviato', 'risposta', 'chiamata', 'incontro', 'nota', 'stato', 'responsabile',
            'prossima_azione', 'approccio')))
$$;

-- L'ordine della coda, scritto una volta sola: tutti i contatti idonei, con o senza lavoro, numerati
-- da 1. Prima quelli con il mese pianificato entro due mesi da p_day, poi priorità alta, media,
-- bassa, poi mese, poi CO. La coda e il giro ordinano entrambi per rank.
create function private.partner_assistant_ranking(p_day date)
returns table (partner_id uuid, co integer, rank bigint)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.co, row_number() over (order by
      (date_trunc('month', coalesce(p.next_action_on, p.contact_month)::timestamp)
        <= date_trunc('month', p_day::timestamp) + interval '2 months') desc,
      array_position(array['alta', 'media', 'bassa']::text[], p.priority),
      date_trunc('month', coalesce(p.next_action_on, p.contact_month)::timestamp),
      p.co)
  from public.partners p
  where private.partner_assistant_eligible(p.id)
$$;

-- Contatti idonei senza lavoro, nell'ordine della coda. In plpgsql, così l'ordine arriva intatto.
create function private.partner_assistant_queue(p_day date) returns table (partner_id uuid, co integer)
language plpgsql stable security invoker set search_path = '' as $$
begin
  return query
    select r.partner_id, r.co from private.partner_assistant_ranking(p_day) r
    where not exists (select 1 from public.partner_assistant_jobs j where j.partner_id = r.partner_id)
    order by r.rank;
end
$$;

-- L'email per la bozza: prima la verificata, poi la posizione e la più vecchia. L'indirizzo è
-- link_value, il valore pulito, mai il testo del recapito.
create function private.partner_assistant_email(p_partner_id uuid)
returns table (contact_id uuid, address text, verified boolean)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.link_value, c.verified from public.partner_contacts c
  where c.partner_id = p_partner_id and c.kind = 'email' and c.active and c.link_value is not null
  order by c.verified desc, c.position, c.created_at, c.id
  limit 1
$$;

-- La guardia dei quattro complete_*, scritta una volta sola. Blocca il lavoro e controlla la lease
-- (token e scadenza), il passo e il contatto. Null: il passo può concludersi, e il lavoro resta
-- bloccato fino alla fine della transazione. Altrimenti l'esito da restituire: lease_persa, oppure
-- non_idoneo dopo aver rilasciato la lease e scritto l'evento, senza avanzare. Il passo sbagliato,
-- impossibile con una lease valida, è un errore d'uso (22023).
create function private.partner_assistant_lock_step(p_job_id uuid, p_lease_token uuid, p_step text)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.partner_assistant_jobs%rowtype;
begin
  select * into j from public.partner_assistant_jobs where id = p_job_id for update;
  if not found or j.lease_token is distinct from p_lease_token or j.lease_expires_at is null
    or j.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  perform private.partner_check(j.step = p_step);
  if not private.partner_assistant_eligible(j.partner_id) then
    update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null, updated_at = now()
      where partner_id = j.partner_id;
    insert into private.partner_assistant_events(partner_id, step, outcome) values (j.partner_id, j.step, 'non_idoneo');
    return jsonb_build_object('status', 'non_idoneo');
  end if;
  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- RPC del worker
-- ---------------------------------------------------------------------------

-- Profilo dell'assistente (un profilo senza membership) e founder attivo che riceve i passaggi.
create function private.configure_partner_assistant(p_actor_id uuid, p_handoff_to uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  if p_actor_id is null or p_handoff_to is null
    or not exists (select 1 from public.profiles f where f.user_id = p_actor_id)
    or exists (select 1 from public.memberships m where m.user_id = p_actor_id)
    or not exists (select 1 from public.memberships m
      where m.user_id = p_handoff_to and m.active and m.role = 'founder') then
    raise exception 'invalid_partner_assistant_configuration' using errcode = '22023';
  end if;
  update private.partner_assistant_config set actor_id = p_actor_id, handoff_to = p_handoff_to where singleton;
  return jsonb_build_object('configured', true);
end
$$;

-- Un giro dello scheduler: al massimo un lavoro con la lease.
create function private.claim_partner_assistant_step(p_worker_id uuid, p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c private.partner_assistant_config%rowtype;
  j public.partner_assistant_jobs%rowtype;
  v_today date := (now() at time zone 'Europe/Rome')::date;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  if p_worker_id is null or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  -- Un giro alla volta: chi arriva secondo aspetta qui, poi vede la lease del primo.
  select * into c from private.partner_assistant_config where singleton for update;
  update private.partner_assistant_config set last_tick_at = now() where singleton;
  if c.mode <> 'prepara' then return jsonb_build_object('status', 'idle', 'reason', 'spento'); end if;
  if c.actor_id is null then return jsonb_build_object('status', 'idle', 'reason', 'non_configurato'); end if;
  if c.paused_reason is not null then return jsonb_build_object('status', 'idle', 'reason', 'pausa'); end if;
  if c.backoff_until > now() then return jsonb_build_object('status', 'idle', 'reason', 'attesa'); end if;
  -- Un passo alla volta.
  if exists (select 1 from public.partner_assistant_jobs l where l.lease_expires_at > clock_timestamp()) then
    return jsonb_build_object('status', 'idle', 'reason', 'occupato');
  end if;
  -- Lease scaduta: un tentativo fallito; al terzo il contatto passa a Tommi.
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
  -- Il primo lavoro pronto, nell'ordine della coda, con il contatto ancora idoneo: la classifica
  -- della coda contiene solo i contatti idonei.
  select l.* into j from public.partner_assistant_jobs l
    join private.partner_assistant_ranking(v_today) r on r.partner_id = l.partner_id
    where l.status = 'in_coda' and l.next_attempt_at <= now() and l.attempts < 3
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

-- Tutto quello che serve al passo, ricostruito dal database. Ricerca, scelta e bozza sono quelle
-- del lavoro; l'ultima seconda lettura è quella della bozza in corso.
create function private.context_partner_assistant_step(p_job_id uuid, p_lease_token uuid) returns jsonb
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
      from public.partner_assistant_notes n where n.id = j.choice_note_id),
    'draft', (select jsonb_build_object('draft_id', d.id, 'language', d.language, 'subject', d.subject,
        'body', d.body, 'signature', d.signature, 'sha256', d.sha256, 'rules_version', d.rules_version,
        'created_at', d.created_at)
      from public.partner_assistant_drafts d where d.id = j.draft_id),
    'last_review', (select jsonb_build_object('approved', n.content -> 'approved', 'problems', n.content -> 'problems')
      from public.partner_assistant_notes n join public.partner_assistant_drafts d on d.id = j.draft_id
      where n.partner_id = j.partner_id and n.kind = 'controllo' and n.created_at >= d.created_at
      order by n.created_at desc, n.id desc limit 1)
  );
end
$$;

-- Subito prima di ogni chiamata a Claude: si va avanti solo con «prepara», senza pausa né attesa,
-- con la lease e con il contatto ancora idoneo.
create function private.checkpoint_partner_assistant_step(p_job_id uuid, p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c private.partner_assistant_config%rowtype;
  v_partner uuid;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  select * into c from private.partner_assistant_config where singleton;
  if c.mode <> 'prepara' or c.actor_id is null then
    return jsonb_build_object('status', 'stop', 'reason', 'spento');
  end if;
  if c.paused_reason is not null then return jsonb_build_object('status', 'stop', 'reason', 'pausa'); end if;
  if c.backoff_until > now() then return jsonb_build_object('status', 'stop', 'reason', 'attesa'); end if;
  select l.partner_id into v_partner from public.partner_assistant_jobs l
    where l.id = p_job_id and l.lease_token = p_lease_token and l.lease_expires_at > clock_timestamp();
  if not found then return jsonb_build_object('status', 'stop', 'reason', 'lease_persa'); end if;
  if not private.partner_assistant_eligible(v_partner) then
    return jsonb_build_object('status', 'stop', 'reason', 'non_idoneo');
  end if;
  return jsonb_build_object('status', 'ok');
end
$$;

-- Una riga per chiamata a Claude, con token, ricerche web e costo. Un contatto sparito nel frattempo
-- non fa perdere il costo: la riga resta senza contatto.
create function private.record_partner_assistant_call(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'partner_id', 'step', 'model', 'input_tokens', 'output_tokens',
    'cache_write_5m_tokens', 'cache_write_1h_tokens', 'cache_read_tokens', 'web_searches', 'cost_usd', 'outcome'];
  v_actor uuid; v_partner uuid; v_step text; v_model text; v_outcome text; v_cost numeric;
  v_input bigint; v_output bigint; v_write_5m bigint; v_write_1h bigint; v_read bigint; v_searches bigint;
  replay jsonb; result jsonb;
begin
  perform private.partner_assistant_service_required();
  v_actor := private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, v_keys, v_keys);
  v_partner := private.partner_uuid(p_payload, 'partner_id');
  v_step := private.partner_enum(p_payload, 'step', array['ricerca', 'estrazione', 'scrittura', 'controllo']);
  v_model := private.partner_text(p_payload, 'model', 100);
  v_outcome := private.partner_text(p_payload, 'outcome', 80);
  v_input := private.partner_bigint(p_payload, 'input_tokens', 0, 9007199254740991);
  v_output := private.partner_bigint(p_payload, 'output_tokens', 0, 9007199254740991);
  v_write_5m := private.partner_bigint(p_payload, 'cache_write_5m_tokens', 0, 9007199254740991);
  v_write_1h := private.partner_bigint(p_payload, 'cache_write_1h_tokens', 0, 9007199254740991);
  v_read := private.partner_bigint(p_payload, 'cache_read_tokens', 0, 9007199254740991);
  v_searches := private.partner_bigint(p_payload, 'web_searches', 0, 10000);
  perform private.partner_check(jsonb_typeof(p_payload -> 'cost_usd') = 'number');
  v_cost := (p_payload ->> 'cost_usd')::numeric;
  perform private.partner_check(v_partner is not null and v_step is not null
    and v_model ~ '^[A-Za-z0-9._:-]{1,100}$' and v_outcome ~ '^[a-z][a-z0-9_]{0,79}$'
    and num_nonnulls(v_input, v_output, v_write_5m, v_write_1h, v_read, v_searches) = 6
    and v_cost >= 0 and v_cost < 1000000);
  if v_actor is null then raise exception 'partner_assistant_not_configured' using errcode = '55000'; end if;
  replay := private.partner_assistant_begin(p_operation_id, 'record_partner_assistant_call', v_actor, p_payload);
  if replay is not null then return replay; end if;
  insert into private.partner_assistant_runs(operation_id, partner_id, step, model, input_tokens, output_tokens,
      cache_write_5m_tokens, cache_write_1h_tokens, cache_read_tokens, web_searches, cost_usd, outcome)
    values (p_operation_id, (select p.id from public.partners p where p.id = v_partner), v_step, v_model, v_input,
      v_output, v_write_5m, v_write_1h, v_read, v_searches, v_cost, v_outcome);
  result := jsonb_build_object('status', 'ok', 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'record_partner_assistant_call', v_actor, p_payload, result);
end
$$;

-- Le quattro conclusioni dei passi seguono lo stesso schema: payload valido, ricevuta (la ripetizione
-- vale anche a lease scaduta), la guardia comune partner_assistant_lock_step (lavoro bloccato con
-- la lease ancora valida, passo giusto, contatto ancora idoneo, altrimenti lease_persa o non_idoneo),
-- poi il salvataggio e l'avanzamento, che rilascia la lease, azzera i tentativi e scrive un evento.

-- Ricerca: la nota «ricerca» con le fonti; si passa all'estrazione con scelta e bozza da rifare.
create function private.complete_partner_assistant_research(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'job_id', 'lease_token', 'text', 'sources', 'model', 'rules_version'];
  v_actor uuid; v_job_id uuid; v_token uuid; v_text text; v_sources text[]; v_model text; v_rules bigint;
  j public.partner_assistant_jobs%rowtype; v_note uuid; replay jsonb; stop jsonb; result jsonb;
begin
  perform private.partner_assistant_service_required();
  v_actor := private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, v_keys, v_keys);
  v_job_id := private.partner_uuid(p_payload, 'job_id');
  v_token := private.partner_uuid(p_payload, 'lease_token');
  v_text := private.partner_text(p_payload, 'text', 60000);
  v_model := private.partner_text(p_payload, 'model', 100);
  v_rules := private.partner_bigint(p_payload, 'rules_version', 1, 2147483647);
  perform private.partner_check(jsonb_typeof(p_payload -> 'sources') = 'array');
  perform private.partner_check(jsonb_array_length(p_payload -> 'sources') <= 40
    and not exists (select 1 from jsonb_array_elements(p_payload -> 'sources') s
      where jsonb_typeof(s) <> 'string' or char_length(s #>> '{}') > 2048
        or (s #>> '{}') !~ '^https://[^\s/?#@]+([/?#]\S*)?$'));
  v_sources := array(select s #>> '{}' from jsonb_array_elements(p_payload -> 'sources') with ordinality t(s, i)
    order by i);
  -- Anche in byte: un testo multibyte nei 60.000 caratteri supererebbe i 64 KiB della nota.
  perform private.partner_check(v_job_id is not null and v_token is not null and v_text ~ '\S'
    and octet_length(v_text) <= 60000 and v_model ~ '^[A-Za-z0-9._:-]{1,100}$' and v_rules is not null);
  if v_actor is null then raise exception 'partner_assistant_not_configured' using errcode = '55000'; end if;
  replay := private.partner_assistant_begin(p_operation_id, 'complete_partner_assistant_research', v_actor, p_payload);
  if replay is not null then return replay; end if;
  stop := private.partner_assistant_lock_step(v_job_id, v_token, 'ricerca');
  if stop is not null then return stop; end if;
  select * into j from public.partner_assistant_jobs where id = v_job_id;
  insert into public.partner_assistant_notes(partner_id, kind, content, sources, rules_version, model, operation_id,
      created_by)
    values (j.partner_id, 'ricerca', jsonb_build_object('text', v_text), v_sources, v_rules, v_model, p_operation_id,
      v_actor)
    returning id into v_note;
  update public.partner_assistant_jobs set step = 'estrazione', research_note_id = v_note, choice_note_id = null,
      draft_id = null, rewrites = 0, attempts = 0, lease_token = null, lease_expires_at = null,
      next_attempt_at = now(), updated_at = now()
    where partner_id = j.partner_id
    returning * into j;
  insert into private.partner_assistant_events(partner_id, step, outcome) values (j.partner_id, 'ricerca', 'salvata');
  result := jsonb_build_object('status', 'done', 'job_status', j.status, 'step', j.step, 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'complete_partner_assistant_research', v_actor, p_payload,
    result);
end
$$;

-- Scelta: la nota «scelta» con lo schema dell'estrazione, la richiesta e la decisione. Scrivere:
-- scrittura. Attendere: in attesa fino al giorno indicato, che deve essere dopo oggi. Bloccare:
-- il contatto passa a Tommi con il motivo.
create function private.complete_partner_assistant_choice(p_operation_id uuid, p_payload jsonb) returns jsonb
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
  j public.partner_assistant_jobs%rowtype; v_note uuid; replay jsonb; stop jsonb; result jsonb;
begin
  perform private.partner_assistant_service_required();
  v_actor := private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, v_keys, v_keys);
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
    values (j.partner_id, 'scelta', v_choice || jsonb_build_object('decision', v_decision), v_rules, v_model,
      p_operation_id, v_actor)
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

-- Bozza: si salva sempre, sul recapito del contatto, se è ancora quello del contesto. Controlli
-- superati: seconda lettura. Falliti la prima volta: una riscrittura, con i problemi in una nota
-- «controllo». Falliti di nuovo: a Tommi.
create function private.complete_partner_assistant_draft(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'job_id', 'lease_token', 'draft', 'checks_ok', 'failures'];
  v_draft_keys text[] := array['language', 'subject', 'body', 'signature', 'sha256', 'rules_version',
    'partner_version', 'contact_id'];
  v_actor uuid; v_job_id uuid; v_token uuid; v_draft jsonb; v_language text; v_subject text; v_body text;
  v_signature text; v_sha text; v_rules bigint; v_partner_version bigint; v_contact uuid; v_ok boolean;
  v_failures jsonb; v_outcome text; v_draft_id uuid;
  j public.partner_assistant_jobs%rowtype; replay jsonb; stop jsonb; result jsonb;
begin
  perform private.partner_assistant_service_required();
  v_actor := private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, v_keys, v_keys);
  v_job_id := private.partner_uuid(p_payload, 'job_id');
  v_token := private.partner_uuid(p_payload, 'lease_token');
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
      signature, sha256, rules_version, research_note_id, operation_id, created_by)
    values (j.partner_id, v_contact, v_partner_version, v_language, v_subject, v_body, v_signature, v_sha, v_rules,
      j.research_note_id, p_operation_id, v_actor)
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

-- Seconda lettura: la nota «controllo» con l'esito e l'impronta letta. Approvata con l'impronta della
-- bozza: pronta. Regole superate: di nuovo in scrittura, senza consumare la riscrittura. Altrimenti
-- come per la bozza: una riscrittura, poi a Tommi.
create function private.complete_partner_assistant_review(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'job_id', 'lease_token', 'approved', 'problems', 'sha256', 'model',
    'rules_version'];
  v_actor uuid; v_job_id uuid; v_token uuid; v_approved boolean; v_problems jsonb; v_sha text; v_model text;
  v_rules bigint; v_draft_sha text; v_outcome text;
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
  select d.sha256 into v_draft_sha from public.partner_assistant_drafts d where d.id = j.draft_id;
  insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id, created_by)
    values (j.partner_id, 'controllo', jsonb_build_object('approved', v_approved, 'problems', v_problems,
      'sha256', v_sha), v_rules, v_model, p_operation_id, v_actor);
  v_outcome := case
    when v_approved and v_sha = v_draft_sha then 'pronta'
    when v_problems = '["regole_superate"]'::jsonb then 'regole_superate'
    when j.rewrites = 0 then 'riscrittura'
    else 'seconda_lettura' end;
  update public.partner_assistant_jobs set attempts = 0, lease_token = null, lease_expires_at = null,
      next_attempt_at = now(), updated_at = now(),
      status = case v_outcome when 'pronta' then 'pronta' when 'seconda_lettura' then 'serve_tommaso'
        else 'in_coda' end,
      step = case when v_outcome in ('regole_superate', 'riscrittura') then 'scrittura' else step end,
      rewrites = case when v_outcome = 'riscrittura' then 1 else rewrites end,
      reason = case when v_outcome = 'seconda_lettura' then 'seconda_lettura' else reason end
    where partner_id = j.partner_id
    returning * into j;
  insert into private.partner_assistant_events(partner_id, step, outcome) values (j.partner_id, 'controllo', v_outcome);
  result := jsonb_build_object('status', 'done', 'job_status', j.status, 'step', j.step, 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'complete_partner_assistant_review', v_actor, p_payload,
    result);
end
$$;

-- Passo non concluso. Rilascia sempre la lease. attesa: nessun tentativo, il lavoro e tutto
-- l'assistente aspettano dieci minuti (429, 529, 5xx). riprova: un tentativo fallito e dieci minuti;
-- al terzo a Tommi. rilascia: niente tentativo né attesa (fermato dal checkpoint). blocca: a Tommi
-- con il motivo. Lock nello stesso ordine del giro: configurazione, poi lavoro.
create function private.fail_partner_assistant_step(p_job_id uuid, p_lease_token uuid, p_kind text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.partner_assistant_jobs%rowtype;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  if p_job_id is null or p_lease_token is null or p_kind is null
    or p_kind not in ('attesa', 'riprova', 'rilascia', 'blocca')
    or p_reason is null or p_reason !~ '^[a-z][a-z0-9_]{0,79}$' then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  perform 1 from private.partner_assistant_config where singleton for update;
  select * into j from public.partner_assistant_jobs where id = p_job_id for update;
  if not found or j.lease_token is distinct from p_lease_token then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  if p_kind = 'attesa' then
    update private.partner_assistant_config set backoff_until = now() + interval '10 minutes' where singleton;
  end if;
  update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null, updated_at = now(),
      attempts = case when p_kind = 'riprova' then least(attempts + 1, 3) else attempts end,
      next_attempt_at = case when p_kind in ('attesa', 'riprova') then now() + interval '10 minutes'
        else next_attempt_at end,
      status = case when p_kind = 'blocca' or (p_kind = 'riprova' and attempts + 1 >= 3) then 'serve_tommaso'
        else status end,
      reason = case when p_kind = 'blocca' then p_reason
        when p_kind = 'riprova' and attempts + 1 >= 3 then 'troppi_tentativi' else reason end
    where partner_id = j.partner_id
    returning * into j;
  insert into private.partner_assistant_events(partner_id, step, outcome) values (j.partner_id, j.step, p_reason);
  return jsonb_build_object('status', 'done', 'job_status', j.status, 'attempts', j.attempts);
end
$$;

-- Credito finito o errore di Claude: pausa di tutto l'assistente, ogni lease rilasciata senza
-- consumare tentativi. Si riparte solo quando una persona rimette «prepara».
create function private.pause_partner_assistant(p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  if p_reason is null or p_reason not in ('credito', 'errore_claude') then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  update private.partner_assistant_config set paused_reason = p_reason where singleton;
  update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null, updated_at = now()
    where lease_token is not null or lease_expires_at is not null;
  insert into private.partner_assistant_events(outcome) values ('pausa_' || p_reason);
  return jsonb_build_object('status', 'done', 'paused_reason', p_reason);
end
$$;

-- ---------------------------------------------------------------------------
-- Wrapper pubblici
-- ---------------------------------------------------------------------------

create function public.configure_partner_assistant(p_actor_id uuid, p_handoff_to uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.configure_partner_assistant(p_actor_id, p_handoff_to) $$;
create function public.claim_partner_assistant_step(p_worker_id uuid, p_lease_seconds integer) returns jsonb
language sql security invoker set search_path = '' as $$ select private.claim_partner_assistant_step(p_worker_id, p_lease_seconds) $$;
create function public.context_partner_assistant_step(p_job_id uuid, p_lease_token uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.context_partner_assistant_step(p_job_id, p_lease_token) $$;
create function public.checkpoint_partner_assistant_step(p_job_id uuid, p_lease_token uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.checkpoint_partner_assistant_step(p_job_id, p_lease_token) $$;
create function public.record_partner_assistant_call(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.record_partner_assistant_call(p_operation_id, p_payload) $$;
create function public.complete_partner_assistant_research(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.complete_partner_assistant_research(p_operation_id, p_payload) $$;
create function public.complete_partner_assistant_choice(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.complete_partner_assistant_choice(p_operation_id, p_payload) $$;
create function public.complete_partner_assistant_draft(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.complete_partner_assistant_draft(p_operation_id, p_payload) $$;
create function public.complete_partner_assistant_review(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.complete_partner_assistant_review(p_operation_id, p_payload) $$;
create function public.fail_partner_assistant_step(p_job_id uuid, p_lease_token uuid, p_kind text, p_reason text)
returns jsonb
language sql security invoker set search_path = '' as $$ select private.fail_partner_assistant_step(p_job_id, p_lease_token, p_kind, p_reason) $$;
create function public.pause_partner_assistant(p_reason text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.pause_partner_assistant(p_reason) $$;

-- ---------------------------------------------------------------------------
-- Permessi
-- ---------------------------------------------------------------------------

-- EXECUTE si toglie a ogni funzione di questa migrazione, poi si concede solo a service_role sulle
-- RPC, private e wrapper. Le funzioni del compito precedente restano come sono.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname = any (array[
        'partner_assistant_service_required', 'partner_assistant_as_actor', 'partner_assistant_eligible',
        'partner_assistant_ranking', 'partner_assistant_queue', 'partner_assistant_email',
        'partner_assistant_lock_step', 'configure_partner_assistant',
        'claim_partner_assistant_step', 'context_partner_assistant_step', 'checkpoint_partner_assistant_step',
        'record_partner_assistant_call', 'complete_partner_assistant_research', 'complete_partner_assistant_choice',
        'complete_partner_assistant_draft', 'complete_partner_assistant_review', 'fail_partner_assistant_step',
        'pause_partner_assistant'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end
$$;
grant execute on function
  private.configure_partner_assistant(uuid, uuid), public.configure_partner_assistant(uuid, uuid),
  private.claim_partner_assistant_step(uuid, integer), public.claim_partner_assistant_step(uuid, integer),
  private.context_partner_assistant_step(uuid, uuid), public.context_partner_assistant_step(uuid, uuid),
  private.checkpoint_partner_assistant_step(uuid, uuid), public.checkpoint_partner_assistant_step(uuid, uuid),
  private.record_partner_assistant_call(uuid, jsonb), public.record_partner_assistant_call(uuid, jsonb),
  private.complete_partner_assistant_research(uuid, jsonb), public.complete_partner_assistant_research(uuid, jsonb),
  private.complete_partner_assistant_choice(uuid, jsonb), public.complete_partner_assistant_choice(uuid, jsonb),
  private.complete_partner_assistant_draft(uuid, jsonb), public.complete_partner_assistant_draft(uuid, jsonb),
  private.complete_partner_assistant_review(uuid, jsonb), public.complete_partner_assistant_review(uuid, jsonb),
  private.fail_partner_assistant_step(uuid, uuid, text, text), public.fail_partner_assistant_step(uuid, uuid, text, text),
  private.pause_partner_assistant(text), public.pause_partner_assistant(text)
to service_role;

-- Il worker scrive solo con le sue RPC: service_role non scrive più direttamente le tabelle Partner.
revoke insert, update, delete, truncate on table
  public.partners, public.partner_contacts, public.partner_message_variants, public.partner_message_revisions,
  public.partner_activities, public.partner_do_not_contact, public.partner_research_imports,
  public.partner_device_imports, public.partner_import_differences
from service_role;

commit;
