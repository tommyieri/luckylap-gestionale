-- Quote giornaliere rigide per Club e altri Partner.
-- Mantiene il limite configurato, i contatori, i permessi e tutte le guardie d'invio.
begin;

create or replace function private.claim_partner_assistant_send(p_worker_id uuid, p_lease_seconds integer,
  p_test_recipients integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s private.partner_assistant_mail_state%rowtype;
  c private.partner_assistant_config%rowtype;
  j public.partner_assistant_jobs%rowtype;
  v_now timestamptz; v_today date; v_rules integer; v_reason text; v_appends jsonb := '[]'::jsonb;
  v_partner uuid; v_draft uuid; v_run uuid; v_index integer; v_remaining boolean := false;
  v_move_partners uuid[] := '{}'; v_move_drafts uuid[] := '{}'; v_move_reasons text[] := '{}';
  v_candidate jsonb; v_token uuid; v_dead_uncertain integer := 0; r record;
  v_full_template boolean := false;
  v_full_other boolean := false; v_share boolean := false;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  if p_worker_id is null or p_lease_seconds is null or p_lease_seconds not between 60 and 600
    or p_test_recipients is null or p_test_recipients not between 0 and 5 then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  v_now := private.partner_assistant_now();
  v_today := private.partner_assistant_rome_day(v_now);
  -- 1. La casella per prima, poi la configurazione.
  select * into s from private.partner_assistant_mail_state where singleton for update;
  update private.partner_assistant_mail_state set last_tick_at = clock_timestamp() where singleton;
  select * into c from private.partner_assistant_config where singleton for share;
  -- 2. Niente da fare.
  if c.mode in ('spento', 'prepara') then return jsonb_build_object('status', 'idle', 'reason', c.mode); end if;
  if c.actor_id is null or c.handoff_to is null then
    return jsonb_build_object('status', 'idle', 'reason', 'non_configurato');
  end if;
  if s.lease_expires_at > clock_timestamp() then return jsonb_build_object('status', 'idle', 'reason', 'occupato'); end if;
  -- 3. Giri morti (nessuna lease attiva): un messaggio preparato non è partito; uno in invio può
  -- essere partito, quindi resta incerto e il contatto passa a Tommi. Prima i contatti, poi i lavori.
  -- Un incerto conta come un invio: l'intervallo da 4 a 11 minuti riparte da adesso, come in finish.
  if exists (select 1 from public.partner_assistant_messages m where m.send_status in ('pronto', 'in_invio')) then
    perform 1 from public.partners p
      where p.id in (select m.partner_id from public.partner_assistant_messages m
        where m.send_status in ('pronto', 'in_invio'))
      order by p.id for share;
    perform 1 from public.partner_assistant_jobs l
      where l.partner_id in (select m.partner_id from public.partner_assistant_messages m
        where m.mode = 'invio' and m.send_status = 'in_invio')
      order by l.partner_id for update;
    with dead as (
      update public.partner_assistant_messages m
        set send_status = case m.send_status when 'pronto' then 'scartato' else 'incerto' end,
          outcome = case m.send_status when 'pronto' then 'pronto_abbandonato' else 'in_invio_abbandonato' end,
          sent_at = case m.send_status when 'in_invio' then v_now else m.sent_at end,
          updated_at = now()
        where m.send_status in ('pronto', 'in_invio')
        returning m.partner_id, m.mode, m.send_status),
    uncertain as (
      update public.partner_assistant_jobs l set status = 'serve_tommaso', reason = 'invio_incerto',
          lease_token = null, lease_expires_at = null, updated_at = now()
        where l.partner_id in (select d.partner_id from dead d where d.mode = 'invio' and d.send_status = 'incerto')
        returning l.partner_id),
    logged as (
      insert into private.partner_assistant_events(partner_id, step, outcome)
        select d.partner_id, 'invio', 'invio_abbandonato' from dead d
        returning 1)
    select count(*) filter (where d.send_status = 'incerto') into v_dead_uncertain from dead d;
    if v_dead_uncertain > 0 then
      update private.partner_assistant_mail_state
        set next_send_after = v_now + make_interval(secs => 240 + floor(random() * 421))
        where singleton
        returning * into s;
    end if;
  end if;
  -- 4. Copie arretrate in «Posta inviata», non durante un fermo della casella o un'attesa.
  if s.stop_reason is distinct from 'casella' and (s.backoff_until is null or s.backoff_until <= v_now) then
    select coalesce(jsonb_agg(jsonb_build_object('message_row_id', a.id, 'message_id', a.message_id, 'raw', a.raw,
        'sent_at', a.sent_at) order by a.sent_at, a.id), '[]'::jsonb)
      into v_appends
      from (select q.*, sum(octet_length(q.raw)) over (order by q.sent_at, q.id) as raw_bytes
        from (select m.id, m.message_id, m.raw, m.sent_at from public.partner_assistant_messages m
          where m.send_status = 'inviato' and m.appended_at is null and m.erased_at is null
            and m.sent_at >= v_now - interval '7 days'
          order by m.sent_at, m.id limit 3) q) a
      where a.raw_bytes <= 4194304;
  end if;
  -- 5. I cancelli del candidato.
  v_reason := case
    when s.stop_reason is not null then 'fermo'
    when s.day_stopped_on = v_today then 'fermo_oggi'
    when s.backoff_until > v_now then 'attesa'
    when s.next_send_after > v_now then 'intervallo'
    when c.mode = 'invio' and private.partner_assistant_first_sent(v_today)
      >= private.partner_assistant_first_limit(v_today) then 'limite'
    when c.mode = 'prova' and private.partner_assistant_test_sent(v_today) >= 15 then 'limite'
  end;
  if v_reason is null and c.mode = 'invio' then
    -- 6. Una passata sulla coda d'invio, senza lock: il primo motivo definitivo di ogni riga, e per le
    -- righe senza motivo la finestra del destinatario. Il candidato è la prima riga senza motivo con
    -- la finestra aperta; escono dalla coda tutte le righe con un motivo che vengono prima.
    select max(x.version) into v_rules from public.partner_assistant_rules x;
    -- Ogni lavoro conserva il proprio tetto del giorno anche se l'altra coda è vuota.
    -- Con limite 6 partono al massimo 3 Club e 3 altre prime email, senza trasferire posti.
    v_full_template := private.partner_assistant_flow_sent(v_today, true)
      >= private.partner_assistant_flow_share(v_today, true);
    v_full_other := private.partner_assistant_flow_sent(v_today, false)
      >= private.partner_assistant_flow_share(v_today, false);
    for r in
      select o.partner_id, o.draft_id, p.country, sc.content ->> 'timezone' as timezone,
        private.partner_assistant_is_template(d.research_note_id) as template,
        case
          when private.partner_email_manual_stale(d.id) then 'bozza_manuale_da_rivedere'
          when o.research_at <= v_now - interval '21 days' then 'ricerca_scaduta'
          when k.id is null then 'recapito_cambiato'
          when d.rules_version < v_rules then 'regole_superate'
          when o.event_starts_on is not null and o.event_starts_on <= v_today then 'bozza_scaduta'
          when private.partner_assistant_address(k.link_value) is null then 'indirizzo_non_valido'
          when exists (select 1 from public.partner_assistant_messages m
              where m.mode = 'invio' and m.partner_id <> o.partner_id
                and m.address_sha256
                  = private.partner_assistant_address_sha256(private.partner_assistant_address(k.link_value))
                and m.send_status in ('pronto', 'in_invio', 'inviato', 'incerto')
                and m.created_at >= v_now - interval '365 days') then 'conversazione_esistente'
        end as reason
      from private.partner_assistant_send_order() o
        join public.partners p on p.id = o.partner_id
        join public.partner_assistant_drafts d on d.id = o.draft_id
        join public.partner_assistant_jobs l on l.id = o.job_id
        left join public.partner_assistant_notes sc on sc.id = l.choice_note_id
        left join public.partner_contacts k on k.id = d.contact_id and k.kind = 'email' and k.active
          and k.link_value is not null
      order by o.rank
    loop
      -- Un paese che la tabella dei paesi non conosce: si manda senza feste, con un evento per
      -- Tommi, una volta per contatto.
      if r.reason is null and private.partner_assistant_country_code(r.country) is null
        and not exists (select 1 from private.partner_assistant_events e
          where e.partner_id = r.partner_id and e.outcome = 'paese_senza_calendario') then
        insert into private.partner_assistant_events(partner_id, step, outcome)
          values (r.partner_id, 'invio', 'paese_senza_calendario');
      end if;
      if r.reason is not null then
        v_move_partners := v_move_partners || r.partner_id;
        v_move_drafts := v_move_drafts || r.draft_id;
        v_move_reasons := v_move_reasons || r.reason;
      elsif (r.template and v_full_template) or (not r.template and v_full_other) then
        v_share := true;
      elsif private.partner_assistant_window_open(r.timezone, r.country, v_now, interval '90 seconds') then
        v_partner := r.partner_id;
        v_draft := r.draft_id;
        exit;
      else
        v_remaining := true;
      end if;
    end loop;
    -- Le righe da spostare: contatti, poi lavori, in ordine di partner_id; ognuna ricontrollata.
    if cardinality(v_move_partners) > 0 then
      perform 1 from public.partners p where p.id = any(v_move_partners) order by p.id for share;
      perform 1 from public.partner_assistant_jobs l where l.partner_id = any(v_move_partners)
        order by l.partner_id for update;
      for i in 1..cardinality(v_move_partners) loop
        perform private.partner_assistant_send_move(v_move_partners[i], v_move_drafts[i], v_move_reasons[i]);
      end loop;
    end if;
    -- 7. Nessun candidato: fuori finestra se restano righe, limite se restano solo righe di un lavoro
    -- con la sua metà già mandata, altrimenti la coda è vuota.
    if v_partner is null then
      v_reason := case when v_remaining then 'fuori_finestra' when v_share then 'limite' else 'vuota' end;
    end if;
  elsif v_reason is null and c.mode = 'prova' then
    select t.id into v_run from private.partner_assistant_test_runs t order by t.requested_at desc, t.id desc limit 1;
    select x.partner_id, x.draft_id, x.test_index into v_partner, v_draft, v_index
      from private.partner_assistant_test_pairs(v_run, p_test_recipients) x limit 1;
    if v_partner is null then v_reason := 'vuota'; v_run := null; end if;
  end if;
  -- 8. Il candidato: contatto, poi lavoro (chi arriva secondo non lo trova). Ancora «pronta» con la
  -- stessa bozza e, in invio, ancora idoneo.
  if v_partner is not null then
    perform 1 from public.partners where id = v_partner for share;
    select * into j from public.partner_assistant_jobs
      where partner_id = v_partner and status = 'pronta' and draft_id = v_draft
      for update skip locked;
    if not found or (c.mode = 'invio' and not private.partner_assistant_eligible(v_partner)) then
      v_partner := null; v_run := null; v_index := null; v_reason := 'vuota';
    end if;
  end if;
  if v_partner is not null then
    select jsonb_build_object('job_id', j.id, 'partner_id', p.id, 'co', p.co, 'name', p.name, 'mode', c.mode,
        'draft', jsonb_build_object('draft_id', d.id, 'language', d.language, 'subject', d.subject, 'body', d.body,
          'signature', d.signature, 'sha256', d.sha256, 'rules_version', d.rules_version, 'created_at', d.created_at),
        'choice', jsonb_build_object('contact_kind', sc.content ->> 'contact_kind', 'request', sc.content ->> 'request',
          'event_starts_on', coalesce(sc.content ->> 'event_starts_on', '')),
        'register', sc.content ->> 'register',
        'address', private.partner_assistant_address(k.link_value),
        'test_run_id', v_run, 'test_index', v_index)
      into v_candidate
      from public.partners p
        join public.partner_assistant_drafts d on d.id = v_draft
        left join public.partner_assistant_notes sc on sc.id = j.choice_note_id
        left join public.partner_contacts k on k.id = d.contact_id and k.kind = 'email' and k.active
          and k.link_value is not null
      where p.id = v_partner;
  end if;
  if v_candidate is not null then
    v_candidate := v_candidate || coalesce((select jsonb_build_object('lookbook', x.metadata)
      from (select private.partner_assistant_send_lookbook(v_draft, c.mode, v_run) as metadata) x
      where x.metadata is not null), '{}'::jsonb);
  end if;
  if v_candidate is null and jsonb_array_length(v_appends) = 0 then
    return jsonb_build_object('status', 'idle', 'reason', v_reason);
  end if;
  -- Una lease nuova, anche per le sole copie: record_partner_assistant_append la controlla.
  update private.partner_assistant_mail_state set lease_token = gen_random_uuid(),
      candidate_draft_id = case when v_candidate is not null then v_draft end,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
    where singleton
    returning lease_token into v_token;
  return jsonb_build_object('status', 'claimed', 'lease_token', v_token, 'mode', c.mode, 'appends', v_appends,
    'candidate', v_candidate);
end
$$;

commit;
