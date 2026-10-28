-- Assistente Partner, consegna 2a (solo invio). Sezione 1: dati, guardie, registro e comandi del team.
--
-- - Configurazione: limite delle prime email dopo la prima settimana (daily_first_limit, da 1 a 15,
--   predefinito 10) e conferma della prova (data e autore). Interruttore per contatto: priorità
--   d'invio (send_priority, da 0 a 9), che mette il contatto per primo nella coda d'invio e in quella
--   di preparazione. Lavori: stato nuovo «inviata». Registro Partner: origine nuova «assistente».
-- - Due tabelle private, revocate a tutti: le prove avviate dal founder e lo stato della casella a
--   riga unica (lease, esiti, fermo, attese, contatori dei rifiuti, variabili e accessi).
-- - Messaggi (public.partner_assistant_messages): una riga per email preparata, letta dai membri e
--   mai scritta dai client. Una sola prima email vera per contatto finché è viva («mai due volte»);
--   le prove non contano. Testo grezzo solo ASCII con la sua impronta. La guardia lascia cambiare
--   solo lo stato in avanti e gli esiti; la cancellazione passa solo da partner_assistant_erase.
-- - Ora dell'assistente: private.partner_assistant_now(), now() salvo negli harness, e il giorno di
--   Roma. L'ordine d'invio sta solo in private.partner_assistant_send_order().
-- - Ridefinite con create or replace (stessa firma, stessi grant, stesse risposte): la classifica di
--   preparazione (prima send_priority), la cancellazione definitiva (anche i messaggi; invio_incerto
--   se l'email può essere partita), il trigger dei solleciti (origine «assistente»: il promemoria va a
--   chi riceve i passaggi), claim e checkpoint (girano anche in «prova» e «invio»), modalità
--   («prova» e «invio» al founder, «invio» solo con la prova confermata), interruttore
--   (conversazione_esistente e invio_incerto restano a Tommi) e regole (un messaggio vivo o un
--   lavoro «inviata» non tornano in scrittura).
-- - Comandi del team nuovi, tutti del founder, come quelli Partner: private.<nome>(operation_id,
--   payload) security definer, wrapper public.<nome> security invoker, ricevuta idempotente,
--   eseguibili solo da authenticated. «Riprendi l'invio» prende solo lo stato della casella, mai la
--   configurazione.
--
-- Codici d'errore (messaggio = codice): 42501 partner_access_required, partner_assistant_founder_required,
-- partner_assistant_message_immutable; 22023 invalid_partner_payload, partner_not_found;
-- 55000 partner_assistant_not_configured, partner_assistant_test_required, partner_assistant_test_mode_required,
-- partner_assistant_test_empty, partner_assistant_test_missing; 40001 partner_changed;
-- 23505 partner_idempotency_conflict.
begin;

-- ===========================================================================
-- Sezione 1: dati, guardie, registro e comandi del team
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Colonne e vincoli nuovi su tabelle esistenti
-- ---------------------------------------------------------------------------

alter table private.partner_assistant_config
  add column daily_first_limit integer not null default 10,
  add column test_confirmed_at timestamptz,
  add column test_confirmed_by uuid references public.profiles(user_id),
  add constraint partner_assistant_config_daily_first_limit_check check (daily_first_limit between 1 and 15);

alter table public.partner_assistant_contacts
  add column send_priority smallint not null default 0,
  add constraint partner_assistant_contacts_send_priority_check check (send_priority between 0 and 9);

-- I due vincoli con il nome automatico si trovano dalla definizione, uno solo per tabella, e si
-- rifanno con un nome esplicito.
do $$
declare r record; v_name text;
begin
  for r in
    select t.rel, t.pattern from (values
      ('public.partner_assistant_jobs', '^CHECK \(\(status = ANY '),
      ('public.partner_activities', '^CHECK \(\(origin = ANY ')) t(rel, pattern)
  loop
    select c.conname into strict v_name from pg_catalog.pg_constraint c
      where c.conrelid = r.rel::regclass and c.contype = 'c'
        and pg_catalog.pg_get_constraintdef(c.oid) ~ r.pattern;
    execute format('alter table %s drop constraint %I', r.rel, v_name);
  end loop;
end
$$;
alter table public.partner_assistant_jobs add constraint partner_assistant_jobs_status_check
  check (status in ('in_coda', 'attesa', 'pronta', 'serve_tommaso', 'inviata'));
alter table public.partner_activities add constraint partner_activities_origin_check
  check (origin in ('team', 'file', 'assistente'));

-- ---------------------------------------------------------------------------
-- Tabelle nuove
-- ---------------------------------------------------------------------------

-- «Manda la prova»: le bozze scelte, nell'ordine d'invio, e quanti indirizzi di prova.
create table private.partner_assistant_test_runs (
  id uuid primary key default gen_random_uuid(),
  draft_ids uuid[] not null check (cardinality(draft_ids) between 1 and 3),
  recipients smallint not null check (recipients between 1 and 5),
  requested_by uuid not null references public.profiles(user_id),
  requested_at timestamptz not null default now()
);

-- Stato della casella, una sola riga creata qui. La lease è il lock della casella tra due RPC; gli
-- esiti sono codici. Variabili e accessi restano nulli finché il worker non li scrive: ok vuol dire
-- accesso riuscito. Il controllo sulle prove non lascia passare i valori a metà (uno nullo e l'altro no).
create table private.partner_assistant_mail_state (
  singleton boolean primary key default true check (singleton),
  id uuid not null unique default gen_random_uuid(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_tick_at timestamptz,
  last_outcome text check (last_outcome ~ '^[a-z][a-z0-9_]{0,79}$'),
  stop_reason text check (stop_reason in ('casella', 'rimbalzi')),
  stopped_at timestamptz,
  next_send_after timestamptz,
  backoff_until timestamptz,
  failures_day date,
  soft_failures integer not null default 0 check (soft_failures >= 0),
  hard_failures integer not null default 0 check (hard_failures >= 0),
  day_stopped_on date,
  env_checked_at timestamptz,
  env_mailbox_ok boolean,
  env_test_ok boolean,
  env_test_count smallint check (env_test_count between 0 and 5),
  smtp_login_at timestamptz,
  smtp_login_code text check (smtp_login_code ~ '^[a-z][a-z0-9_]{0,79}$'),
  imap_login_at timestamptz,
  imap_login_code text check (imap_login_code ~ '^[a-z][a-z0-9_]{0,79}$'),
  constraint partner_assistant_mail_state_env_test_check check (coalesce(
    (env_test_ok and env_test_count between 1 and 5) or (not env_test_ok and env_test_count = 0)
      or (env_test_ok is null and env_test_count is null), false))
);
insert into private.partner_assistant_mail_state default values;

-- Le email preparate dall'assistente, prova e invio vero. Il testo è quello composto (frase di uscita
-- compresa); raw è il messaggio MIME, solo ASCII, con la sua impronta. I vincoli di tipo, modalità e
-- stato hanno un nome esplicito: la 2b li allargherà.
create table public.partner_assistant_messages (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  draft_id uuid not null references public.partner_assistant_drafts(id),
  kind text not null constraint partner_assistant_messages_kind_check check (kind in ('primo')),
  mode text not null constraint partner_assistant_messages_mode_check check (mode in ('prova', 'invio')),
  send_status text not null constraint partner_assistant_messages_status_check
    check (send_status in ('pronto', 'in_invio', 'inviato', 'incerto', 'respinto', 'scartato')),
  test_run_id uuid references private.partner_assistant_test_runs(id),
  test_index smallint check (test_index between 0 and 4),
  message_id text not null unique check (message_id ~ '^<[0-9a-f-]{36}@[a-z0-9-]+(\.[a-z0-9-]+)+>$'),
  to_address text not null check (char_length(to_address) <= 254
    and to_address ~ '^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  subject text not null check (char_length(subject) between 1 and 300),
  body text not null check (char_length(body) between 1 and 20000),
  raw text not null check (octet_length(raw) <= 65536 and octet_length(raw) = char_length(raw)),
  sha256 text not null,
  rules_version integer not null,
  lease_token uuid not null,
  send_day date,
  smtp_code smallint check (smtp_code between 200 and 599),
  enhanced_code text check (enhanced_code ~ '^[245]\.[0-9]{1,3}\.[0-9]{1,3}$'),
  outcome text check (outcome ~ '^[a-z][a-z0-9_]{0,79}$'),
  sent_at timestamptz,
  appended_at timestamptz,
  operation_id uuid not null unique,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_assistant_messages_sha256_check check (sha256 = encode(sha256(convert_to(raw, 'UTF8')), 'hex')),
  -- Solo una prova ha la sua prova e la posizione dell'indirizzo; mai una delle due senza l'altra.
  constraint partner_assistant_messages_test_check check ((mode = 'prova') = (test_run_id is not null and test_index is not null)
    and (test_run_id is null) = (test_index is null)),
  constraint partner_assistant_messages_send_day_check check (send_status in ('pronto', 'scartato') or send_day is not null),
  constraint partner_assistant_messages_sent_at_check check (send_status not in ('inviato', 'incerto') or sent_at is not null),
  constraint partner_assistant_messages_appended_at_check check (appended_at is null or send_status = 'inviato')
);
-- «Mai due volte»: una sola prima email vera viva per contatto. Le prove non contano.
create unique index partner_assistant_messages_one_first on public.partner_assistant_messages(partner_id)
  where mode = 'invio' and kind = 'primo' and send_status in ('pronto', 'in_invio', 'inviato', 'incerto');
create unique index partner_assistant_messages_one_test on public.partner_assistant_messages(test_run_id, draft_id, test_index)
  where mode = 'prova' and send_status in ('pronto', 'in_invio', 'inviato', 'incerto');
create index partner_assistant_messages_address on public.partner_assistant_messages(to_address, created_at desc)
  where mode = 'invio';
create index partner_assistant_messages_send_day on public.partner_assistant_messages(send_day)
  where send_day is not null;
create index partner_assistant_messages_partner on public.partner_assistant_messages(partner_id, created_at desc);
create index partner_assistant_messages_created on public.partner_assistant_messages(created_at desc);
-- Per la chiave esterna verso le bozze (cancellazione definitiva) e per il controllo delle regole.
create index partner_assistant_messages_draft on public.partner_assistant_messages(draft_id);

-- ---------------------------------------------------------------------------
-- Ora, giorno di Roma e guardia dei messaggi
-- ---------------------------------------------------------------------------

-- L'ora delle decisioni dell'assistente: now(), salvo il valore che solo gli harness impostano nella
-- transazione.
create function private.partner_assistant_now() returns timestamptz
language sql stable security invoker set search_path = '' as $$
  select coalesce(nullif(current_setting('luckylap.partner_assistant.now', true), '')::timestamptz, now())
$$;

create function private.partner_assistant_rome_day(p_at timestamptz) returns date
language sql immutable security invoker set search_path = '' as $$
  select (p_at at time zone 'Europe/Rome')::date
$$;

-- Un messaggio non si cancella (salvo partner_assistant_erase, con il flag acceso) e non si
-- riscrive: un update cambia solo lo stato in avanti, giorno, codici, esito, ora d'invio e
-- updated_at, e la copia in «Posta inviata» da nulla a valorizzata su un inviato.
create function private.partner_assistant_message_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_free text[] := array['send_status', 'send_day', 'smtp_code', 'enhanced_code', 'outcome', 'sent_at', 'updated_at',
    'appended_at'];
begin
  if tg_op = 'DELETE' then
    if current_setting('luckylap.partner_assistant.erase', true) = 'on' then return old; end if;
    raise exception 'partner_assistant_message_immutable' using errcode = '42501';
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
create trigger partner_assistant_messages_guard before update or delete on public.partner_assistant_messages
  for each row execute function private.partner_assistant_message_guard();

-- ---------------------------------------------------------------------------
-- Ordine d'invio e classifica di preparazione
-- ---------------------------------------------------------------------------

-- I lavori «pronta» con la bozza, dei contatti idonei, nell'ordine della coda d'invio: priorità
-- d'invio, evento della scelta (il più vicino prima, senza data in fondo), ricerca più vecchia,
-- priorità della scheda, CO. In plpgsql, così l'ordine arriva intatto.
create function private.partner_assistant_send_order()
returns table (job_id uuid, partner_id uuid, co integer, draft_id uuid, research_at timestamptz,
  event_starts_on date, rank bigint)
language plpgsql stable security invoker set search_path = '' as $$
begin
  return query
    select o.job_id, o.partner_id, o.co, o.draft_id, o.research_at, o.event_starts_on, o.rank
    from (
      select j.id as job_id, p.id as partner_id, p.co, d.id as draft_id, r.created_at as research_at,
        nullif(s.content ->> 'event_starts_on', '')::date as event_starts_on,
        row_number() over (order by coalesce(c.send_priority, 0) desc,
          nullif(s.content ->> 'event_starts_on', '')::date nulls last, r.created_at,
          array_position(array['alta', 'media', 'bassa']::text[], p.priority), p.co) as rank
      from public.partner_assistant_jobs j
        join public.partners p on p.id = j.partner_id
        join public.partner_assistant_drafts d on d.id = j.draft_id
        join public.partner_assistant_notes r on r.id = d.research_note_id
        left join public.partner_assistant_notes s on s.id = j.choice_note_id
        left join public.partner_assistant_contacts c on c.partner_id = p.id
      where j.status = 'pronta' and private.partner_assistant_eligible(p.id)) o
    order by o.rank;
end
$$;

-- Come 20261028122956, con la priorità d'invio come prima chiave: un contatto messo per primo arriva
-- prima anche alla preparazione con Claude. Senza priorità l'ordine resta quello di oggi.
create or replace function private.partner_assistant_ranking(p_day date)
returns table (partner_id uuid, co integer, rank bigint)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.co, row_number() over (order by
      coalesce((select s.send_priority from public.partner_assistant_contacts s where s.partner_id = p.id), 0) desc,
      (date_trunc('month', coalesce(p.next_action_on, p.contact_month)::timestamp)
        <= date_trunc('month', p_day::timestamp) + interval '2 months') desc,
      array_position(array['alta', 'media', 'bassa']::text[], p.priority),
      date_trunc('month', coalesce(p.next_action_on, p.contact_month)::timestamp),
      p.co)
  from public.partners p
  where private.partner_assistant_eligible(p.id)
$$;

-- ---------------------------------------------------------------------------
-- Cancellazione definitiva, ridefinita
-- ---------------------------------------------------------------------------

-- Come 20261028122704, con in più i messaggi, per primi (puntano alle bozze senza on delete). Se il
-- contatto ha un invio vero in corso o incerto l'email può essere partita: il motivo è
-- invio_incerto, anche su un lavoro già di Tommi, e l'interruttore non lo riprende.
create or replace function private.partner_assistant_erase(p_partner_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_previous text := current_setting('luckylap.partner_assistant.erase', true);
  v_uncertain boolean;
begin
  v_uncertain := exists (select 1 from public.partner_assistant_messages m
    where m.partner_id = p_partner_id and m.mode = 'invio' and m.send_status in ('in_invio', 'incerto'));
  perform pg_catalog.set_config('luckylap.partner_assistant.erase', 'on', true);
  delete from public.partner_assistant_messages where partner_id = p_partner_id;
  delete from public.partner_assistant_drafts where partner_id = p_partner_id;
  delete from public.partner_assistant_notes where partner_id = p_partner_id;
  perform pg_catalog.set_config('luckylap.partner_assistant.erase', coalesce(v_previous, ''), true);
  update public.partner_assistant_jobs set status = 'serve_tommaso', step = 'ricerca', attempts = 0, rewrites = 0,
      reason = case when v_uncertain then 'invio_incerto' when status = 'serve_tommaso' then reason
        else 'dato_cancellato' end,
      write_on = null, lease_token = null, lease_expires_at = null, research_note_id = null, choice_note_id = null,
      draft_id = null, next_attempt_at = now(), updated_at = now()
    where partner_id = p_partner_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Solleciti dal registro, ridefiniti
-- ---------------------------------------------------------------------------

-- Come 20261023140414, con l'origine «assistente»: conta come il team per «invio o risposta più
-- recente», e la sua prima email crea «Sollecito · <nome>» per chi riceve i passaggi (handoff_to;
-- senza configurazione per chi l'ha scritta), con l'assistente come autore del compito e del
-- collegamento. Scadenza e descrizione come oggi.
create or replace function private.partner_work_activity_trigger()returns trigger language plpgsql security definer set search_path='' as $$
declare v_partner public.partners%rowtype;task uuid;due timestamptz;v_owner uuid;v_creator uuid;
begin
 if new.origin not in('team','file','assistente')then return new;end if;
 select * into strict v_partner from public.partners where id=new.partner_id for update;
 if new.origin='file'and new.kind='inviato'and exists(select 1 from public.partner_activities a where a.partner_id=new.partner_id and a.id<>new.id and a.kind in('inviato','risposta')and a.occurred_at>=new.occurred_at)then return new;end if;
 if new.kind in('risposta','non_contattare')or(new.kind='stato'and new.stage_after in('chiuso','no'))or new.kind='inviato'then
  update public.tasks t set status='done'from public.partner_work_links l join public.partner_activities a on a.id=l.activity_id
   where l.partner_id=new.partner_id and l.kind='follow_up'and l.task_id=t.id and t.status<>'done'and a.occurred_at<=new.occurred_at;
 end if;
 if new.kind='inviato'and v_partner.stage not in('chiuso','no')and not private.partner_blocked(new.partner_id)then
  -- A message supersedes earlier reminders; a backdated message cannot replace a newer cycle.
  if exists(select 1 from public.partner_activities a where a.partner_id=new.partner_id and a.origin in('team','assistente')and a.kind in('inviato','risposta')and a.occurred_at>new.occurred_at)then return new;end if;
  -- Dal file: il sollecito va a chi ha caricato il file (stessa operazione dell'import).
  v_owner:=new.created_by;
  if new.origin='file'then
   select d.imported_by into v_owner from public.partner_device_imports d where d.operation_id=new.operation_id;
   v_owner:=coalesce(v_owner,new.created_by);
  end if;
  -- Dall'assistente: il sollecito va a chi riceve i passaggi; l'autore resta l'assistente.
  if new.origin='assistente'then
   select c.handoff_to into v_owner from private.partner_assistant_config c where c.singleton;
   v_owner:=coalesce(v_owner,new.created_by);
  end if;
  v_creator:=case when new.origin='assistente'then new.created_by else v_owner end;
  due:=(((new.occurred_at at time zone'Europe/Rome')::date+7)::timestamp at time zone'Europe/Rome');
  insert into public.tasks(title,description,status,due_at,assigned_to,created_by)
   values(left('Sollecito · '||v_partner.name,240),'Partner CO '||v_partner.co::text||' · /partner?co='||v_partner.co::text||'#lead-'||v_partner.co::text,'todo',due,v_owner,v_creator)returning id into task;
  insert into public.partner_work_links(partner_id,kind,source_key,activity_id,task_id,created_by)values(new.partner_id,'follow_up',new.id::text,new.id,task,v_creator);
 end if;
 return new;
end$$;

-- ---------------------------------------------------------------------------
-- Giro del worker, ridefinito: i passi con Claude girano anche in «prova» e «invio»
-- ---------------------------------------------------------------------------

-- Come 20261028122956, con «prova» e «invio» accanto a «prepara». Stesse risposte.
create or replace function private.claim_partner_assistant_step(p_worker_id uuid, p_lease_seconds integer) returns jsonb
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

-- Come 20261028122956, con «prova» e «invio» accanto a «prepara». Stesse risposte.
create or replace function private.checkpoint_partner_assistant_step(p_job_id uuid, p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c private.partner_assistant_config%rowtype;
  v_partner uuid;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  select * into c from private.partner_assistant_config where singleton;
  if c.mode not in ('prepara', 'prova', 'invio') or c.actor_id is null then
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

-- ---------------------------------------------------------------------------
-- Comandi del team della consegna 1, ridefiniti
-- ---------------------------------------------------------------------------

-- Come 20261028122704. «prova» e «invio» solo al founder (prima della ricevuta), «invio» solo con la
-- prova confermata. «prepara», «prova» e «invio» chiedono assistente e passaggi configurati e tolgono
-- pausa e attesa di Claude; lo stato della casella non si tocca. Stessa risposta di oggi.
create or replace function private.set_partner_assistant_mode(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_mode text; v_expected bigint; v_raw jsonb; v_credit numeric;
  c private.partner_assistant_config%rowtype; replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'mode', 'expected_version'],
    array['schema_version', 'mode', 'expected_version', 'starting_credit_usd']);
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
      paused_reason = case when v_mode in ('prepara', 'prova', 'invio') then null else paused_reason end,
      backoff_until = case when v_mode in ('prepara', 'prova', 'invio') then null else backoff_until end,
      version = version + 1, updated_by = v_actor, updated_at = now()
    where singleton
    returning * into c;
  result := jsonb_build_object('id', c.id, 'version', c.version, 'mode', c.mode, 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'set_partner_assistant_mode', v_actor, p_payload, result);
end
$$;

-- Come 20261028122704: riattivarlo ridà all'assistente un lavoro passato a Tommi, dalla ricerca. Non
-- quelli con una conversazione recente nella casella o un invio incerto: ridarli costerebbe una
-- ricerca nuova e finirebbe allo stesso punto, o rischierebbe una seconda email.
create or replace function private.set_partner_assistant_contact(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_partner uuid; v_active boolean; v_reason text; v_id uuid; v_version bigint; replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'partner_id', 'active'],
    array['schema_version', 'partner_id', 'active', 'reason']);
  v_partner := private.partner_uuid(p_payload, 'partner_id');
  v_active := private.partner_bool(p_payload, 'active');
  v_reason := nullif(btrim(private.partner_text(p_payload, 'reason', 240)), '');
  perform private.partner_check(v_partner is not null and v_active is not null);
  replay := private.partner_assistant_begin(p_operation_id, 'set_partner_assistant_contact', v_actor, p_payload);
  if replay is not null then return replay; end if;
  perform 1 from public.partners where id = v_partner for update;
  if not found then raise exception 'partner_not_found' using errcode = '22023'; end if;
  insert into public.partner_assistant_contacts as s (partner_id, active, reason, updated_by)
    values (v_partner, v_active, v_reason, v_actor)
    on conflict (partner_id) do update set active = excluded.active, reason = excluded.reason,
      version = s.version + 1, updated_by = excluded.updated_by, updated_at = now()
    returning s.id, s.version into v_id, v_version;
  if v_active then
    update public.partner_assistant_jobs set status = 'in_coda', step = 'ricerca', attempts = 0, rewrites = 0,
        reason = null, lease_token = null, lease_expires_at = null, research_note_id = null, choice_note_id = null,
        draft_id = null, next_attempt_at = now(), updated_at = now()
      where partner_id = v_partner and status = 'serve_tommaso'
        and reason not in ('conversazione_esistente', 'invio_incerto');
  end if;
  result := jsonb_build_object('id', v_id, 'partner_id', v_partner, 'version', v_version, 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'set_partner_assistant_contact', v_actor, p_payload, result);
end
$$;

-- Come 20261028122704. Non tornano in scrittura le bozze con un messaggio vero vivo (pronto, in
-- corso, inviato o incerto) né i lavori «inviata», che restano al passo «controllo».
create or replace function private.save_partner_assistant_rules(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_body text; v_expected bigint; v_current integer; v_id uuid; v_version integer; v_requeued integer;
  replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'body', 'expected_version'],
    array['schema_version', 'body', 'expected_version']);
  v_body := private.partner_text(p_payload, 'body', 100000);
  v_expected := private.partner_bigint(p_payload, 'expected_version', 1, 2147483647);
  perform private.partner_check(btrim(v_body) <> '' and v_expected is not null);
  replay := private.partner_assistant_begin(p_operation_id, 'save_partner_assistant_rules', v_actor, p_payload);
  if replay is not null then return replay; end if;
  -- Un salvataggio alla volta: chi arriva secondo trova la versione cambiata.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.partner_assistant.rules', 0));
  select max(version) into v_current from public.partner_assistant_rules;
  if v_current is distinct from v_expected then
    raise exception 'partner_changed' using errcode = '40001';
  end if;
  insert into public.partner_assistant_rules(version, body, created_by)
    values (v_current + 1, v_body, v_actor)
    returning id, version into v_id, v_version;
  with requeued as (
    update public.partner_assistant_jobs j set status = 'in_coda', step = 'scrittura', attempts = 0, rewrites = 0,
        reason = null, lease_token = null, lease_expires_at = null, next_attempt_at = now(), updated_at = now()
      from public.partner_assistant_drafts d
      where d.id = j.draft_id and d.rules_version < v_version
        and (j.status = 'pronta' or (j.step = 'controllo' and j.status not in ('serve_tommaso', 'inviata')))
        and not exists (select 1 from public.partner_assistant_messages m
          where m.draft_id = j.draft_id and m.mode = 'invio'
            and m.send_status in ('pronto', 'in_invio', 'inviato', 'incerto'))
      returning j.partner_id)
  select count(*) into v_requeued from requeued;
  result := jsonb_build_object('id', v_id, 'version', v_version, 'requeued', v_requeued, 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'save_partner_assistant_rules', v_actor, p_payload, result);
end
$$;

-- ---------------------------------------------------------------------------
-- Comandi del team nuovi, tutti del founder
-- ---------------------------------------------------------------------------

-- «Manda la prova»: in «prova», le prime bozze della coda d'invio (da 1 a 3), saltando gli eventi già
-- iniziati, ognuna verso ogni indirizzo di prova (da 1 a 5). L'id della risposta è quello della prova.
create function private.start_partner_assistant_test(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_drafts bigint; v_recipients bigint; v_today date; v_ids uuid[]; v_run uuid; v_mode text;
  replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'drafts', 'recipients'],
    array['schema_version', 'drafts', 'recipients']);
  v_drafts := private.partner_bigint(p_payload, 'drafts', 1, 3);
  v_recipients := private.partner_bigint(p_payload, 'recipients', 1, 5);
  perform private.partner_check(v_drafts is not null and v_recipients is not null);
  if not private.is_founder() then
    raise exception 'partner_assistant_founder_required' using errcode = '42501';
  end if;
  replay := private.partner_assistant_begin(p_operation_id, 'start_partner_assistant_test', v_actor, p_payload);
  if replay is not null then return replay; end if;
  select c.mode into v_mode from private.partner_assistant_config c where c.singleton for share;
  if v_mode is distinct from 'prova' then
    raise exception 'partner_assistant_test_mode_required' using errcode = '55000';
  end if;
  v_today := private.partner_assistant_rome_day(private.partner_assistant_now());
  select array_agg(o.draft_id order by o.rank) into v_ids
    from (select s.draft_id, s.rank from private.partner_assistant_send_order() s
      where s.event_starts_on is null or s.event_starts_on > v_today
      order by s.rank
      limit v_drafts) o;
  if v_ids is null then
    raise exception 'partner_assistant_test_empty' using errcode = '55000';
  end if;
  insert into private.partner_assistant_test_runs(draft_ids, recipients, requested_by)
    values (v_ids, v_recipients, v_actor)
    returning id into v_run;
  insert into private.partner_assistant_events(step, outcome) values ('invio', 'prova_avviata');
  result := jsonb_build_object('id', v_run, 'test_run_id', v_run, 'drafts', cardinality(v_ids),
    'recipients', v_recipients, 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'start_partner_assistant_test', v_actor, p_payload, result);
end
$$;

-- «La prova è arrivata in posta in arrivo»: data e autore, solo dopo almeno una prova inviata.
create function private.confirm_partner_assistant_test(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_expected bigint; c private.partner_assistant_config%rowtype; replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'expected_version'],
    array['schema_version', 'expected_version']);
  v_expected := private.partner_bigint(p_payload, 'expected_version', 1, 9007199254740991);
  perform private.partner_check(v_expected is not null);
  if not private.is_founder() then
    raise exception 'partner_assistant_founder_required' using errcode = '42501';
  end if;
  replay := private.partner_assistant_begin(p_operation_id, 'confirm_partner_assistant_test', v_actor, p_payload);
  if replay is not null then return replay; end if;
  select * into c from private.partner_assistant_config where singleton for update;
  if not found or c.version <> v_expected then
    raise exception 'partner_changed' using errcode = '40001';
  end if;
  if not exists (select 1 from public.partner_assistant_messages m
      where m.mode = 'prova' and m.send_status = 'inviato') then
    raise exception 'partner_assistant_test_missing' using errcode = '55000';
  end if;
  update private.partner_assistant_config set test_confirmed_at = now(), test_confirmed_by = v_actor,
      version = version + 1, updated_by = v_actor, updated_at = now()
    where singleton
    returning * into c;
  result := jsonb_build_object('id', c.id, 'version', c.version, 'test_confirmed_at', c.test_confirmed_at,
    'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'confirm_partner_assistant_test', v_actor, p_payload,
    result);
end
$$;

-- «Manda per primo»: la priorità d'invio del contatto (da 0 a 9). Una riga nuova dell'interruttore
-- nasce attiva; una esistente tiene stato e motivo.
create function private.set_partner_assistant_send_priority(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_partner uuid; v_priority bigint; v_id uuid; v_version bigint; v_saved smallint; replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'partner_id', 'send_priority'],
    array['schema_version', 'partner_id', 'send_priority']);
  v_partner := private.partner_uuid(p_payload, 'partner_id');
  v_priority := private.partner_bigint(p_payload, 'send_priority', 0, 9);
  perform private.partner_check(v_partner is not null and v_priority is not null);
  if not private.is_founder() then
    raise exception 'partner_assistant_founder_required' using errcode = '42501';
  end if;
  replay := private.partner_assistant_begin(p_operation_id, 'set_partner_assistant_send_priority', v_actor,
    p_payload);
  if replay is not null then return replay; end if;
  perform 1 from public.partners where id = v_partner for update;
  if not found then raise exception 'partner_not_found' using errcode = '22023'; end if;
  insert into public.partner_assistant_contacts as s (partner_id, active, send_priority, updated_by)
    values (v_partner, true, v_priority, v_actor)
    on conflict (partner_id) do update set send_priority = excluded.send_priority, version = s.version + 1,
      updated_by = excluded.updated_by, updated_at = now()
    returning s.id, s.version, s.send_priority into v_id, v_version, v_saved;
  result := jsonb_build_object('id', v_id, 'partner_id', v_partner, 'send_priority', v_saved, 'version', v_version,
    'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'set_partner_assistant_send_priority', v_actor, p_payload,
    result);
end
$$;

-- «Riprendi l'invio»: toglie il fermo della casella, le attese e i rifiuti contati. Prende solo lo
-- stato della casella, mai la configurazione. L'id della risposta è quello dello stato della casella.
create function private.resume_partner_assistant_send(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_id uuid; replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version'], array['schema_version']);
  if not private.is_founder() then
    raise exception 'partner_assistant_founder_required' using errcode = '42501';
  end if;
  replay := private.partner_assistant_begin(p_operation_id, 'resume_partner_assistant_send', v_actor, p_payload);
  if replay is not null then return replay; end if;
  select m.id into v_id from private.partner_assistant_mail_state m where m.singleton for update;
  update private.partner_assistant_mail_state set stop_reason = null, stopped_at = null, backoff_until = null,
      day_stopped_on = null, soft_failures = 0, hard_failures = 0
    where singleton;
  insert into private.partner_assistant_events(step, outcome) values ('invio', 'invio_ripreso');
  result := jsonb_build_object('id', v_id, 'status', 'ripreso', 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'resume_partner_assistant_send', v_actor, p_payload,
    result);
end
$$;

-- Il limite delle prime email al giorno dopo la prima settimana (da 1 a 15). La 2b aggiunge le sue
-- chiavi, facoltative.
create function private.set_partner_assistant_settings(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.partner_actor();
  v_expected bigint; v_limit bigint; c private.partner_assistant_config%rowtype; replay jsonb; result jsonb;
begin
  perform private.partner_payload(p_payload, array['schema_version', 'expected_version', 'daily_first_limit'],
    array['schema_version', 'expected_version', 'daily_first_limit']);
  v_expected := private.partner_bigint(p_payload, 'expected_version', 1, 9007199254740991);
  v_limit := private.partner_bigint(p_payload, 'daily_first_limit', 1, 15);
  perform private.partner_check(v_expected is not null and v_limit is not null);
  if not private.is_founder() then
    raise exception 'partner_assistant_founder_required' using errcode = '42501';
  end if;
  replay := private.partner_assistant_begin(p_operation_id, 'set_partner_assistant_settings', v_actor, p_payload);
  if replay is not null then return replay; end if;
  select * into c from private.partner_assistant_config where singleton for update;
  if not found or c.version <> v_expected then
    raise exception 'partner_changed' using errcode = '40001';
  end if;
  update private.partner_assistant_config set daily_first_limit = v_limit, version = version + 1,
      updated_by = v_actor, updated_at = now()
    where singleton
    returning * into c;
  result := jsonb_build_object('id', c.id, 'version', c.version, 'daily_first_limit', c.daily_first_limit,
    'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'set_partner_assistant_settings', v_actor, p_payload,
    result);
end
$$;

-- Wrapper pubblici.
create function public.start_partner_assistant_test(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.start_partner_assistant_test(p_operation_id, p_payload) $$;
create function public.confirm_partner_assistant_test(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.confirm_partner_assistant_test(p_operation_id, p_payload) $$;
create function public.set_partner_assistant_send_priority(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.set_partner_assistant_send_priority(p_operation_id, p_payload) $$;
create function public.resume_partner_assistant_send(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.resume_partner_assistant_send(p_operation_id, p_payload) $$;
create function public.set_partner_assistant_settings(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.set_partner_assistant_settings(p_operation_id, p_payload) $$;

-- ---------------------------------------------------------------------------
-- Permessi della sezione 1
-- ---------------------------------------------------------------------------

-- Come le tabelle della consegna 1: i messaggi li leggono solo i membri attivi e non li scrive nessun
-- client, service_role compreso; le tabelle private restano chiuse a tutti.
alter table public.partner_assistant_messages enable row level security;
revoke all on table public.partner_assistant_messages from public, anon, authenticated, service_role;
grant select on table public.partner_assistant_messages to authenticated;
create policy member_read on public.partner_assistant_messages for select to authenticated
  using ((select private.is_member()));
alter table private.partner_assistant_test_runs enable row level security;
alter table private.partner_assistant_mail_state enable row level security;
revoke all on table private.partner_assistant_test_runs, private.partner_assistant_mail_state
  from public, anon, authenticated, service_role;

-- Funzioni nuove: EXECUTE tolto a tutti, poi i cinque comandi (privati e wrapper) ai membri. Le
-- funzioni ridefinite tengono i loro grant; per il trigger dei solleciti si ripete la revoca di
-- 20261023140414.
revoke all on function
  private.partner_assistant_now(), private.partner_assistant_rome_day(timestamptz),
  private.partner_assistant_message_guard(), private.partner_assistant_send_order(),
  private.start_partner_assistant_test(uuid, jsonb), public.start_partner_assistant_test(uuid, jsonb),
  private.confirm_partner_assistant_test(uuid, jsonb), public.confirm_partner_assistant_test(uuid, jsonb),
  private.set_partner_assistant_send_priority(uuid, jsonb), public.set_partner_assistant_send_priority(uuid, jsonb),
  private.resume_partner_assistant_send(uuid, jsonb), public.resume_partner_assistant_send(uuid, jsonb),
  private.set_partner_assistant_settings(uuid, jsonb), public.set_partner_assistant_settings(uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.partner_work_activity_trigger() from public, anon, authenticated, service_role;
grant execute on function
  private.start_partner_assistant_test(uuid, jsonb), public.start_partner_assistant_test(uuid, jsonb),
  private.confirm_partner_assistant_test(uuid, jsonb), public.confirm_partner_assistant_test(uuid, jsonb),
  private.set_partner_assistant_send_priority(uuid, jsonb), public.set_partner_assistant_send_priority(uuid, jsonb),
  private.resume_partner_assistant_send(uuid, jsonb), public.resume_partner_assistant_send(uuid, jsonb),
  private.set_partner_assistant_settings(uuid, jsonb), public.set_partner_assistant_settings(uuid, jsonb)
to authenticated;

commit;
