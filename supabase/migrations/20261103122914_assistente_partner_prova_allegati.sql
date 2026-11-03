-- Prova ufficiale dei club con i due lookbook, 3 novembre 2026.
-- In «Prova»: una bozza Porsche e una degli altri club, entrambe modello v3, con un PDF noto.
-- Dal 4 novembre (giorno di Roma) anche l'invio reale dei club v3 usa il PDF della sua marca.
-- Nessun corpo o bozza cambia; le vecchie prove restano senza allegati.
-- Nessuna accensione, nessun invio o chiamata a Claude durante la migrazione.
begin;

create function private.partner_assistant_test_lookbook(p_code text) returns jsonb
language sql immutable security invoker set search_path = '' as $$
  select case p_code
    when 'porsche_club' then jsonb_build_object('code', p_code, 'bytes', 2592305,
      'sha256', '541ddb3b20f7daa46ef428c64ae5618996711409d1819e5dfd37e8cec8831f77')
    when 'club' then jsonb_build_object('code', p_code, 'bytes', 2444810,
      'sha256', '923cf52ae33ba5dfc8e9271d1157a64719a925a14750ee96a0bd0eeb686942b1') end
$$;

alter table private.partner_assistant_test_runs add column lookbooks jsonb not null default '{}';
alter table private.partner_assistant_test_runs add constraint partner_assistant_test_runs_lookbooks_check
  check (jsonb_typeof(lookbooks) = 'object');
alter table public.partner_assistant_messages add column lookbook jsonb;
alter table public.partner_assistant_messages drop constraint partner_assistant_messages_raw_check;
alter table public.partner_assistant_messages add constraint partner_assistant_messages_raw_check
  check (octet_length(raw) = char_length(raw) and octet_length(raw) <=
    case when lookbook is not null then 4194304 else 65536 end);
alter table public.partner_assistant_messages add constraint partner_assistant_messages_lookbook_check check (
  lookbook is null or coalesce(jsonb_typeof(lookbook) = 'object'
    and lookbook = private.partner_assistant_test_lookbook(lookbook ->> 'code'), false));

-- Un solo criterio per claim, prepare, start e guardia INSERT. La prova usa la mappa congelata;
-- l'invio reale usa il giorno di Roma e la scelta della bozza v3 ancora corrente.
create function private.partner_assistant_send_lookbook(p_draft_id uuid, p_mode text, p_test_run_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when p_mode = 'prova' then
    (select t.lookbooks -> p_draft_id::text from private.partner_assistant_test_runs t where t.id = p_test_run_id)
  when p_mode = 'invio' and private.partner_assistant_rome_day(private.partner_assistant_now()) >= date '2026-11-04' then
    (select private.partner_assistant_test_lookbook(case when s.content -> 'porsche_community' = 'true'::jsonb
        then 'porsche_club' else 'club' end)
      from public.partner_assistant_drafts d
        join public.partner_assistant_notes n on n.id = d.research_note_id
        join public.partner_assistant_jobs j on j.draft_id = d.id
        join public.partner_assistant_notes s on s.id = j.choice_note_id
      where d.id = p_draft_id and private.partner_assistant_uses_template(d.partner_id)
        and private.partner_assistant_is_template(n.id) and n.content ->> 'template_version' = '3'
        and s.content -> 'porsche_community' in ('true'::jsonb, 'false'::jsonb)) end
$$;

-- Le associazioni PDF-bozza della prova non si possono cambiare dopo la creazione.
create function private.partner_assistant_test_lookbooks_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v jsonb;
begin
  if tg_op = 'UPDATE' and (new.lookbooks is distinct from old.lookbooks
    or (old.lookbooks <> '{}'::jsonb and
      (new.draft_ids is distinct from old.draft_ids or new.recipients is distinct from old.recipients))) then
    raise exception 'partner_assistant_test_immutable' using errcode = '42501';
  end if;
  if new.lookbooks <> '{}'::jsonb then
    if cardinality(new.draft_ids) <> 2 or new.draft_ids[1] = new.draft_ids[2]
      or (select count(*) from jsonb_object_keys(new.lookbooks)) <> 2 then
      raise exception 'invalid_partner_payload' using errcode = '22023';
    end if;
    foreach v in array array[new.lookbooks -> new.draft_ids[1]::text,
        new.lookbooks -> new.draft_ids[2]::text] loop
      if v is null or v is distinct from private.partner_assistant_test_lookbook(v ->> 'code') then
        raise exception 'invalid_partner_payload' using errcode = '22023';
      end if;
    end loop;
    if (new.lookbooks -> new.draft_ids[1]::text ->> 'code')
      = (new.lookbooks -> new.draft_ids[2]::text ->> 'code') then
      raise exception 'invalid_partner_payload' using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;
create trigger partner_assistant_test_lookbooks_guard before insert or update
  on private.partner_assistant_test_runs for each row execute function private.partner_assistant_test_lookbooks_guard();
create or replace function private.partner_assistant_message_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_free text[] := array['send_status', 'send_day', 'smtp_code', 'enhanced_code', 'outcome', 'sent_at', 'updated_at',
    'appended_at'];
  v_erased text[] := array['to_address', 'subject', 'body', 'raw', 'sha256', 'draft_id', 'erased_at', 'updated_at'];
begin
  if tg_op = 'INSERT' then
    if new.lookbook is distinct from private.partner_assistant_send_lookbook(new.draft_id, new.mode, new.test_run_id) then
      raise exception 'invalid_partner_payload' using errcode = '22023';
    end if;
    new.address_sha256 := private.partner_assistant_address_sha256(new.to_address);
    new.erased_at := null;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if current_setting('luckylap.partner_assistant.erase', true) = 'on' then return old; end if;
    raise exception 'partner_assistant_message_immutable' using errcode = '42501';
  end if;
  if current_setting('luckylap.partner_assistant.erase', true) = 'on' and old.erased_at is null
    and new.erased_at is not null then
    if (to_jsonb(new) - v_erased) is distinct from (to_jsonb(old) - v_erased) or new.draft_id is not null then
      raise exception 'partner_assistant_message_immutable' using errcode = '42501';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free)
    or (new.send_status is distinct from old.send_status and not (
      (old.send_status = 'pronto' and new.send_status in ('in_invio', 'scartato'))
      or (old.send_status = 'in_invio' and new.send_status in ('inviato', 'incerto', 'respinto', 'scartato'))))
    or (new.appended_at is distinct from old.appended_at
      and (old.appended_at is not null or new.send_status <> 'inviato')) then
    raise exception 'partner_assistant_message_immutable' using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace function private.set_partner_assistant_mode(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_mode text; v_expected bigint; v_raw jsonb; v_credit numeric; v_preserve boolean;
  c private.partner_assistant_config%rowtype; replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'mode', 'expected_version'],
    array['schema_version', 'mode', 'expected_version', 'starting_credit_usd', 'preserve_preparation_pause']);
  v_preserve := false;
  if p_payload ? 'preserve_preparation_pause' then
    v_preserve := private.partner_bool(p_payload, 'preserve_preparation_pause');
    perform private.partner_check(v_preserve is not null);
  end if;
  v_mode := private.partner_enum(p_payload, 'mode', array['spento', 'prepara', 'prova', 'invio']);
  v_expected := private.partner_bigint(p_payload, 'expected_version', 1, 9007199254740991);
  -- Credito di partenza: facoltativo; un numero da 0 a 10000 con al massimo due decimali.
  v_raw := p_payload -> 'starting_credit_usd';
  if v_raw is not null and jsonb_typeof(v_raw) <> 'null' then
    perform private.partner_check(jsonb_typeof(v_raw) = 'number');
    v_credit := (v_raw #>> '{}')::numeric;
    perform private.partner_check(v_credit between 0 and 10000 and v_credit = round(v_credit, 2));
  end if;
  perform private.partner_check(v_mode is not null and v_expected is not null);
  if v_mode in ('prova', 'invio') and not private.is_founder() then
    raise exception 'partner_assistant_founder_required' using errcode = '42501';
  end if;
  replay := private.partner_assistant_begin(p_operation_id, 'set_partner_assistant_mode', v_actor, p_payload);
  if replay is not null then return replay; end if;
  select * into c from private.partner_assistant_config where singleton for update;
  if not found or (v_mode in ('prepara', 'prova', 'invio') and (c.actor_id is null or c.handoff_to is null)) then
    raise exception 'partner_assistant_not_configured' using errcode = '55000';
  end if;
  if v_mode = 'invio' and c.test_confirmed_at is null then
    raise exception 'partner_assistant_test_required' using errcode = '55000';
  end if;
  if (v_mode <> 'spento' or v_credit is not null) and c.version <> v_expected then
    raise exception 'partner_changed' using errcode = '40001';
  end if;
  update private.partner_assistant_config set mode = v_mode,
      starting_credit_usd = coalesce(v_credit, starting_credit_usd),
      paused_reason = case when v_mode in ('prepara', 'prova', 'invio') and not v_preserve then null else paused_reason end,
      backoff_until = case when v_mode in ('prepara', 'prova', 'invio') and not v_preserve then null else backoff_until end,
      version = version + 1, updated_by = v_actor, updated_at = now()
    where singleton
    returning * into c;
  result := jsonb_build_object('id', c.id, 'version', c.version, 'mode', c.mode, 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'set_partner_assistant_mode', v_actor, p_payload, result);
end
$$;

create or replace function private.start_partner_assistant_test(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_drafts bigint; v_recipients bigint; v_today date; v_ids uuid[]; v_run uuid; v_mode text;
  v_last private.partner_assistant_test_runs%rowtype; v_env smallint; v_club boolean := false; v_lookbooks jsonb := '{}'::jsonb;
  replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'drafts', 'recipients'],
    array['schema_version', 'drafts', 'recipients', 'club_lookbooks']);
  if p_payload ? 'club_lookbooks' then
    v_club := private.partner_bool(p_payload, 'club_lookbooks');
    perform private.partner_check(v_club is not null);
  end if;
  v_drafts := private.partner_bigint(p_payload, 'drafts', 1, 3);
  v_recipients := private.partner_bigint(p_payload, 'recipients', 1, 5);
  perform private.partner_check(v_drafts is not null and v_recipients is not null and (not v_club or v_drafts = 2));
  if not private.is_founder() then
    raise exception 'partner_assistant_founder_required' using errcode = '42501';
  end if;
  replay := private.partner_assistant_begin(p_operation_id, 'start_partner_assistant_test', v_actor, p_payload);
  if replay is not null then return replay; end if;
  select c.mode into v_mode from private.partner_assistant_config c where c.singleton for update;
  if v_mode is distinct from 'prova' then
    raise exception 'partner_assistant_test_mode_required' using errcode = '55000';
  end if;
  select * into v_last from private.partner_assistant_test_runs t
    order by t.requested_at desc, t.id desc limit 1;
  if found then
    -- Gli indirizzi di prova che il worker ha (letti senza lock, come la pagina): con meno indirizzi
    -- di quelli della prova, le coppie oltre non partiranno mai e non tengono ferma la prova dopo.
    select s.env_test_count into v_env from private.partner_assistant_mail_state s where s.singleton;
    if exists (select 1 from public.partner_assistant_messages m
        where m.test_run_id = v_last.id and m.send_status in ('pronto', 'in_invio'))
      or exists (select 1 from private.partner_assistant_test_pairs(v_last.id,
        least(v_last.recipients, coalesce(v_env, v_last.recipients)))) then
      raise exception 'prova_in_corso' using errcode = '55000';
    end if;
  end if;
  v_today := private.partner_assistant_rome_day(private.partner_assistant_now());
  if v_club then
    with ranked as (
      select o.draft_id, o.rank, (s.content -> 'porsche_community' = 'true'::jsonb) as porsche,
        row_number() over (partition by s.content -> 'porsche_community' order by o.rank) as pos
      from private.partner_assistant_send_order() o
        join public.partners p on p.id = o.partner_id
        join public.partner_assistant_drafts d on d.id = o.draft_id
        join public.partner_assistant_jobs j on j.id = o.job_id
        join public.partner_assistant_notes n on n.id = d.research_note_id
        join public.partner_assistant_notes s on s.id = j.choice_note_id
        join public.partner_contacts k on k.id = d.contact_id and k.kind = 'email' and k.active
      where private.partner_assistant_uses_template(p.id) and private.partner_assistant_is_template(n.id)
        and n.content ->> 'template_version' = '3'
        and s.content -> 'porsche_community' in ('true'::jsonb, 'false'::jsonb)
        and (o.event_starts_on is null or o.event_starts_on > v_today)
        and n.created_at > private.partner_assistant_now() - interval '21 days'
        and d.rules_version = (select max(version) from public.partner_assistant_rules)
        and d.partner_version = p.version
        and d.contact_id = (select e.contact_id from private.partner_assistant_email(p.id) e)
        and private.partner_assistant_address(k.link_value) is not null
        and d.sha256 = encode(sha256(convert_to(d.subject || E'\n\n' || d.body || E'\n\n' || d.signature, 'UTF8')), 'hex')
        and exists (select 1 from public.partner_assistant_notes r where r.partner_id = p.id
          and r.kind = 'controllo' and r.content -> 'approved' = 'true'::jsonb
          and r.content ->> 'sha256' = d.sha256 and r.created_at >= d.created_at)
    )
    select array_agg(x.draft_id order by x.porsche desc),
      jsonb_object_agg(x.draft_id::text, private.partner_assistant_test_lookbook(
        case when x.porsche then 'porsche_club' else 'club' end))
      into v_ids, v_lookbooks from ranked x where x.pos = 1;
    if coalesce(cardinality(v_ids), 0) <> 2 then
      raise exception 'partner_assistant_test_club_pair_missing' using errcode = '55000';
    end if;
  else
  select array_agg(o.draft_id order by o.rank) into v_ids
    from (select s.draft_id, s.rank from private.partner_assistant_send_order() s
      where s.event_starts_on is null or s.event_starts_on > v_today
      order by s.rank
      limit v_drafts) o;
  end if;
  if v_ids is null then
    raise exception 'partner_assistant_test_empty' using errcode = '55000';
  end if;
  insert into private.partner_assistant_test_runs(draft_ids, recipients, requested_by, lookbooks)
    values (v_ids, v_recipients, v_actor, v_lookbooks)
    returning id into v_run;
  insert into private.partner_assistant_events(step, outcome) values ('invio', 'prova_avviata');
  result := jsonb_build_object('id', v_run, 'test_run_id', v_run, 'drafts', cardinality(v_ids),
    'recipients', v_recipients, 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'start_partner_assistant_test', v_actor, p_payload, result);
end
$$;

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
  v_ready_template boolean; v_ready_other boolean; v_full_template boolean := false;
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
    -- La quota: un lavoro con la sua metà già mandata oggi lascia i posti all'altro, finché l'altro
    -- ha email pronte. Se l'altro non ne ha, usa anche i suoi.
    select coalesce(bool_or(private.partner_assistant_is_template(d.research_note_id)), false),
        coalesce(bool_or(not private.partner_assistant_is_template(d.research_note_id)), false)
      into v_ready_template, v_ready_other
      from private.partner_assistant_send_order() o
        join public.partner_assistant_drafts d on d.id = o.draft_id;
    v_full_template := v_ready_other and private.partner_assistant_flow_sent(v_today, true)
      >= private.partner_assistant_flow_share(v_today, true);
    v_full_other := v_ready_template and private.partner_assistant_flow_sent(v_today, false)
      >= private.partner_assistant_flow_share(v_today, false);
    for r in
      select o.partner_id, o.draft_id, p.country, sc.content ->> 'timezone' as timezone,
        private.partner_assistant_is_template(d.research_note_id) as template,
        case
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
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
    where singleton
    returning lease_token into v_token;
  return jsonb_build_object('status', 'claimed', 'lease_token', v_token, 'mode', c.mode, 'appends', v_appends,
    'candidate', v_candidate);
end
$$;

create or replace function private.prepare_partner_assistant_send(p_lease_token uuid, p_operation_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'job_id', 'draft_id', 'mode', 'test_run_id', 'test_index', 'message_id',
    'to_address', 'subject', 'text', 'opt_out', 'raw', 'mailbox_check'];
  v_actor uuid; v_job uuid; v_draft uuid; v_mode text; v_run uuid; v_index bigint; v_message_id text; v_to text;
  v_subject text; v_text text; v_opt_out text; v_raw text; v_check text; v_lookbook jsonb;
  s private.partner_assistant_mail_state%rowtype;
  c private.partner_assistant_config%rowtype;
  j public.partner_assistant_jobs%rowtype;
  d public.partner_assistant_drafts%rowtype;
  t private.partner_assistant_test_runs%rowtype;
  v_partner uuid; v_country text; v_choice jsonb; v_research timestamptz; v_address text; v_rules integer;
  v_digest text; v_event date; v_now timestamptz; v_today date; v_reason text; v_id uuid;
begin
  perform private.partner_assistant_service_required();
  v_actor := private.partner_assistant_as_actor();
  -- Il MIME ha un limite proprio; il resto mantiene il limite comune di 1 MiB.
  perform private.partner_keys(p_payload, v_keys, v_keys || array['lookbook']);
  perform private.partner_payload(p_payload - 'raw', array_remove(v_keys, 'raw'),
    array_remove(v_keys, 'raw') || array['lookbook']);
  v_job := private.partner_uuid(p_payload, 'job_id');
  v_draft := private.partner_uuid(p_payload, 'draft_id');
  v_mode := private.partner_enum(p_payload, 'mode', array['prova', 'invio']);
  v_run := private.partner_uuid(p_payload, 'test_run_id');
  v_index := private.partner_bigint(p_payload, 'test_index', 0, 4);
  v_message_id := private.partner_text(p_payload, 'message_id', 200);
  v_to := private.partner_text(p_payload, 'to_address', 254);
  v_subject := private.partner_text(p_payload, 'subject', 300);
  v_text := private.partner_text(p_payload, 'text', 20000);
  v_opt_out := private.partner_text(p_payload, 'opt_out', 1000);
  v_lookbook := nullif(p_payload -> 'lookbook', 'null'::jsonb);
  perform private.partner_check(v_lookbook is null or coalesce(v_lookbook = private.partner_assistant_test_lookbook(v_lookbook ->> 'code'), false));
  v_raw := private.partner_text(p_payload, 'raw', case when v_lookbook is not null then 4194304 else 65536 end);
  v_check := private.partner_enum(p_payload, 'mailbox_check', array['vuota', 'trovata', 'incerta']);
  perform private.partner_check(p_lease_token is not null and p_operation_id is not null and v_job is not null
    and v_draft is not null and v_mode is not null
    and v_message_id ~ '^<[0-9a-f-]{36}@[a-z0-9-]+(\.[a-z0-9-]+)+>$'
    and v_to = private.partner_assistant_address(v_to)
    and char_length(v_subject) >= 1 and char_length(v_text) >= 1 and v_opt_out is not null
    and octet_length(v_raw) = char_length(v_raw) and v_check is not null);
  if v_actor is null then raise exception 'partner_assistant_not_configured' using errcode = '55000'; end if;
  if not private.partner_assistant_mail_guard(p_lease_token, true) then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  select * into s from private.partner_assistant_mail_state where singleton;
  select * into c from private.partner_assistant_config where singleton for share;
  v_now := private.partner_assistant_now();
  v_today := private.partner_assistant_rome_day(v_now);
  select l.partner_id into v_partner from public.partner_assistant_jobs l where l.id = v_job;
  if v_partner is not null then
    select p.country into v_country from public.partners p where p.id = v_partner for share;
    select * into j from public.partner_assistant_jobs where id = v_job for update;
  end if;
  select * into d from public.partner_assistant_drafts where id = v_draft;
  if v_run is not null then select * into t from private.partner_assistant_test_runs where id = v_run; end if;
  select n.content into v_choice from public.partner_assistant_notes n where n.id = j.choice_note_id;
  select n.created_at into v_research from public.partner_assistant_notes n where n.id = d.research_note_id;
  select private.partner_assistant_address(k.link_value) into v_address from public.partner_contacts k
    where k.id = d.contact_id and k.kind = 'email' and k.active and k.link_value is not null;
  select max(x.version) into v_rules from public.partner_assistant_rules x;
  v_digest := encode(sha256(convert_to(d.subject || E'\n\n' || d.body || E'\n\n' || d.signature, 'UTF8')), 'hex');
  v_event := nullif(v_choice ->> 'event_starts_on', '')::date;
  v_reason := case
    when v_mode is distinct from c.mode
      or (v_mode = 'prova' and not coalesce(v_run is not null and v_index is not null and t.id is not null
        and v_draft = any(t.draft_ids) and v_index < t.recipients, false))
      or (v_mode = 'invio' and (v_run is not null or v_index is not null)) then 'modalita_cambiata'
    when v_lookbook is distinct from private.partner_assistant_send_lookbook(v_draft, v_mode, v_run) then 'allegato_prova'
    when s.stop_reason is not null or s.day_stopped_on = v_today or s.backoff_until > v_now then 'fermo'
    when j.id is null or j.status <> 'pronta' or j.draft_id is distinct from v_draft or d.id is null then 'bozza_cambiata'
    when v_digest is distinct from d.sha256
      or not exists (select 1 from public.partner_assistant_notes n
        where n.partner_id = d.partner_id and n.kind = 'controllo' and n.content -> 'approved' = 'true'::jsonb
          and n.content ->> 'sha256' = v_digest and n.created_at >= d.created_at)
      or v_subject is distinct from d.subject
      or v_text is distinct from d.body || E'\n\n' || d.signature || E'\n\n' || v_opt_out
      or v_opt_out !~ '^[^\r\n<>@]{20,240}$' or v_opt_out ~* 'http' or v_opt_out ~ '[0-9]'
      or position(E'\r\nMessage-ID: ' || v_message_id || E'\r\n' in v_raw) = 0 then 'impronta'
    when v_mode = 'invio' and not private.partner_assistant_eligible(j.partner_id) then 'non_idoneo'
    when v_mode = 'invio' and v_to is distinct from v_address then 'recapito_cambiato'
    when v_mode = 'invio' and d.rules_version < v_rules then 'regole_superate'
    when v_mode = 'invio' and v_research <= v_now - interval '21 days' then 'ricerca_scaduta'
    when v_mode = 'invio' and v_event <= v_today then 'bozza_scaduta'
    when v_mode = 'invio' and exists (select 1 from public.partner_assistant_messages m
        where m.mode = 'invio' and m.partner_id <> j.partner_id
          and m.address_sha256 = private.partner_assistant_address_sha256(v_to)
          and m.send_status in ('pronto', 'in_invio', 'inviato', 'incerto')
          and m.created_at >= v_now - interval '365 days') then 'conversazione_esistente'
    when v_mode = 'invio' and v_check <> 'vuota' then 'casella'
    when v_mode = 'invio' and private.partner_assistant_first_sent(v_today)
      >= private.partner_assistant_first_limit(v_today) then 'limite'
    when v_mode = 'invio' and not private.partner_assistant_window_open(v_choice ->> 'timezone', v_country, v_now,
        interval '90 seconds') then 'finestra_chiusa'
    when v_mode = 'prova' and exists (select 1 from public.partner_contacts k
        where k.link_value is not null and lower(k.link_value) = v_to) then 'destinatario_prova'
    when v_mode = 'prova' and private.partner_assistant_test_sent(v_today) >= 15 then 'limite'
  end;
  if v_reason is not null then
    if v_reason in ('impronta', 'bozza_scaduta', 'conversazione_esistente', 'regole_superate', 'recapito_cambiato',
        'ricerca_scaduta') then
      perform private.partner_assistant_send_move(j.partner_id, v_draft, v_reason);
    else
      insert into private.partner_assistant_events(partner_id, step, outcome) values (v_partner, 'invio', v_reason);
    end if;
    return jsonb_build_object('status', 'rifiutato', 'reason', v_reason);
  end if;
  begin
    insert into public.partner_assistant_messages(partner_id, draft_id, kind, mode, send_status, test_run_id, test_index,
        message_id, to_address, subject, body, raw, sha256, rules_version, lease_token, operation_id, created_by,
        created_at, updated_at, lookbook)
      values (j.partner_id, v_draft, 'primo', v_mode, 'pronto', v_run, v_index, v_message_id, v_to, v_subject, v_text,
        v_raw, encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), d.rules_version, p_lease_token, p_operation_id,
        v_actor, v_now, now(), v_lookbook)
      returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('status', 'rifiutato', 'reason', 'doppione');
  end;
  if v_mode = 'prova' then
    insert into private.partner_assistant_events(partner_id, step, outcome)
      values (j.partner_id, 'invio', 'prova_casella_' || v_check);
  end if;
  return jsonb_build_object('status', 'pronto', 'message_row_id', v_id);
end
$$;

create or replace function private.read_partner_assistant_send() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s private.partner_assistant_mail_state%rowtype;
  c private.partner_assistant_config%rowtype;
  v_now timestamptz := private.partner_assistant_now();
  v_today date := private.partner_assistant_rome_day(private.partner_assistant_now());
begin
  perform private.partner_actor();
  select * into s from private.partner_assistant_mail_state where singleton;
  select * into c from private.partner_assistant_config where singleton;
  return jsonb_build_object(
    'stop_reason', s.stop_reason,
    'stopped_at', s.stopped_at,
    'day_stopped_on', s.day_stopped_on,
    'backoff_until', s.backoff_until,
    'next_send_after', s.next_send_after,
    'last_tick_at', s.last_tick_at,
    'last_outcome', s.last_outcome,
    'daily_first_limit', c.daily_first_limit,
    'first_limit_today', private.partner_assistant_first_limit(v_today),
    'first_sent_today', private.partner_assistant_first_sent(v_today),
    'first_real_send_on', private.partner_assistant_first_real_day(),
    'test_sent_today', private.partner_assistant_test_sent(v_today),
    'test_limit', 15,
    'test_confirmed_at', c.test_confirmed_at,
    'test_confirmed_by', (select f.display_name from public.profiles f where f.user_id = c.test_confirmed_by),
    'test_run', (select jsonb_build_object('requested_at', t.requested_at, 'drafts', cardinality(t.draft_ids),
        'recipients', t.recipients,
        'sent', (select count(*) from public.partner_assistant_messages m
          where m.test_run_id = t.id and m.send_status = 'inviato')) || case when t.lookbooks <> '{}'::jsonb
        then jsonb_build_object('club_lookbooks', true) else '{}'::jsonb end
      from private.partner_assistant_test_runs t order by t.requested_at desc, t.id desc limit 1),
    'window_open_rome', private.partner_assistant_window_open('Europe/Rome', 'Italia', v_now),
    'next_window_rome', private.partner_assistant_next_window(v_now),
    'ready', (select count(*) from private.partner_assistant_send_order()),
    'env_checked_at', s.env_checked_at,
    'env_mailbox_ok', s.env_mailbox_ok,
    'env_test_ok', s.env_test_ok,
    'env_test_count', s.env_test_count,
    'smtp_login_at', s.smtp_login_at,
    'smtp_login_code', s.smtp_login_code,
    'imap_login_at', s.imap_login_at,
    'imap_login_code', s.imap_login_code,
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('at', x.at, 'co', x.co, 'name', x.name, 'mode', x.mode,
        'status', x.send_status, 'subject', x.subject) order by x.at desc, x.id desc), '[]'::jsonb)
      from (select m.id, coalesce(m.sent_at, m.created_at) as at, p.co, p.name, m.mode, m.send_status, m.subject
        from public.partner_assistant_messages m join public.partners p on p.id = m.partner_id
        order by coalesce(m.sent_at, m.created_at) desc, m.id desc limit 20) x),
    'priorities', (select coalesce(jsonb_agg(jsonb_build_object('co', x.co, 'name', x.name,
        'send_priority', x.send_priority) order by x.send_priority desc, x.co), '[]'::jsonb)
      from (select p.co, p.name, k.send_priority
        from public.partner_assistant_contacts k join public.partners p on p.id = k.partner_id
        where k.send_priority > 0 order by k.send_priority desc, p.co limit 50) x)
  );
end
$$;
create or replace function private.start_partner_assistant_send(p_lease_token uuid, p_message_row_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s private.partner_assistant_mail_state%rowtype;
  c private.partner_assistant_config%rowtype;
  j public.partner_assistant_jobs%rowtype;
  m public.partner_assistant_messages%rowtype;
  v_now timestamptz; v_today date; v_country text; v_timezone text; v_address text; v_reason text;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  if p_lease_token is null or p_message_row_id is null then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  if not private.partner_assistant_mail_guard(p_lease_token, true) then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  select * into s from private.partner_assistant_mail_state where singleton;
  select * into c from private.partner_assistant_config where singleton for share;
  select * into m from public.partner_assistant_messages where id = p_message_row_id;
  if not found then return jsonb_build_object('status', 'lease_persa'); end if;
  select p.country into v_country from public.partners p where p.id = m.partner_id for share;
  select * into j from public.partner_assistant_jobs where partner_id = m.partner_id for update;
  select * into m from public.partner_assistant_messages where id = p_message_row_id for update;
  if not found or m.lease_token is distinct from p_lease_token or m.send_status <> 'pronto' then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  v_now := private.partner_assistant_now();
  v_today := private.partner_assistant_rome_day(v_now);
  select n.content ->> 'timezone' into v_timezone from public.partner_assistant_notes n where n.id = j.choice_note_id;
  select private.partner_assistant_address(k.link_value) into v_address
    from public.partner_assistant_drafts d join public.partner_contacts k on k.id = d.contact_id
    where d.id = m.draft_id and k.kind = 'email' and k.active and k.link_value is not null;
  v_reason := case
    when j.partner_id is null or j.status <> 'pronta' or j.draft_id is distinct from m.draft_id then 'bozza_cambiata'
    when c.mode is distinct from m.mode then 'modalita_cambiata'
    when s.stop_reason is not null or s.day_stopped_on = v_today or s.backoff_until > v_now then 'fermo'
    when m.mode = 'invio' and not private.partner_assistant_eligible(m.partner_id) then 'non_idoneo'
    when m.mode = 'invio' and m.to_address is distinct from v_address then 'recapito_cambiato'
    when m.lookbook is distinct from private.partner_assistant_send_lookbook(m.draft_id, m.mode, m.test_run_id) then 'allegato_cambiato'
    when m.mode = 'invio' and not private.partner_assistant_window_open(v_timezone, v_country, v_now,
        interval '90 seconds') then 'finestra_chiusa'
  end;
  if v_reason is not null then
    update public.partner_assistant_messages set send_status = 'scartato', outcome = v_reason, updated_at = now()
      where id = m.id;
    insert into private.partner_assistant_events(partner_id, step, outcome) values (m.partner_id, 'invio', v_reason);
    return jsonb_build_object('status', 'stop', 'reason', v_reason);
  end if;
  update public.partner_assistant_messages set send_status = 'in_invio', send_day = v_today, updated_at = now()
    where id = m.id;
  return jsonb_build_object('status', 'in_invio');
end
$$;

-- Le funzioni sostituite conservano i grant. Gli aiuti nuovi non sono RPC.
revoke all on function private.partner_assistant_test_lookbook(text),
  private.partner_assistant_test_lookbooks_guard(),
  private.partner_assistant_send_lookbook(uuid, text, uuid) from public, anon, authenticated, service_role;
commit;
