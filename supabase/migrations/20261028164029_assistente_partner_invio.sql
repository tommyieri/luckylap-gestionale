-- Assistente Partner, consegna 2a (solo invio). Sezione 1: dati, guardie, registro e comandi del team.
-- Sezione 2: calendario, coda e RPC d'invio del worker, lettura della pagina.
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
--   preparazione (prima send_priority), la cancellazione definitiva (anche i messaggi: un invio
--   vero partito o forse partito resta senza indirizzo né testi, con l'impronta dell'indirizzo;
--   invio_incerto se l'email può essere partita; un lavoro «inviata» resta tale), il trigger dei
--   solleciti (origine «assistente»: il promemoria va a chi riceve i passaggi), claim e checkpoint (girano anche in «prova» e «invio»), modalità
--   («prova» e «invio» al founder, «invio» solo con la prova confermata), interruttore
--   (conversazione_esistente e invio_incerto restano a Tommi) e regole (un messaggio in corso,
--   inviato o incerto o un lavoro «inviata» non tornano in scrittura).
-- - Comandi del team nuovi, tutti del founder, come quelli Partner: private.<nome>(operation_id,
--   payload) security definer, wrapper public.<nome> security invoker, ricevuta idempotente,
--   eseguibili solo da authenticated. «Riprendi l'invio» prende solo lo stato della casella, mai la
--   configurazione.
-- - Sezione 2. Calendario: finestra del destinatario (lunedì-venerdì, 9:30-11:00 nel suo fuso),
--   feste nazionali e paesi in due tabelle private, niente invii dal 21 dicembre al 7 gennaio.
--   Limiti: 5 prime email al giorno nei primi 7 giorni dal primo invio vero, poi daily_first_limit;
--   15 prove al giorno; tra due invii da 4 a 11 minuti. Ogni decisione usa partner_assistant_now().
-- - RPC del worker (service_role, private security definer + wrapper public invoker): claim, skip,
--   prepare, start, finish, copia in «Posta inviata», fermo della casella, rilascio, variabili. Il
--   lock della casella è una lease nella riga di stato, presa sempre per prima (poi configurazione,
--   contatto, lavoro). Un giro morto lascia il preparato scartato e l'«in invio» incerto, a Tommi.
--   Esiti attesi come righe (idle, lease_persa, rifiutato, stop), mai eccezioni.
-- - Lettura per i membri: read_partner_assistant_send, senza indirizzi né valori delle variabili.
--
-- Codici d'errore (messaggio = codice): 42501 partner_access_required, partner_assistant_founder_required,
-- partner_assistant_message_immutable, partner_assistant_worker_access_required;
-- 22023 invalid_partner_payload, partner_not_found;
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

-- L'impronta SHA-256 di un indirizzo già normalizzato (partner_assistant_address).
create function private.partner_assistant_address_sha256(p_address text) returns text
language sql immutable security invoker set search_path = '' as $$
  select encode(sha256(convert_to(p_address, 'UTF8')), 'hex')
$$;

-- Le email preparate dall'assistente, prova e invio vero. Il testo è quello composto (frase di uscita
-- compresa); raw è il messaggio MIME, solo ASCII, con la sua impronta. I vincoli di tipo, modalità e
-- stato hanno un nome esplicito: la 2b li allargherà.
create table public.partner_assistant_messages (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  -- Nulla solo in una riga cancellata (partner_assistant_erase): la bozza non c'è più.
  draft_id uuid references public.partner_assistant_drafts(id),
  kind text not null constraint partner_assistant_messages_kind_check check (kind in ('primo')),
  mode text not null constraint partner_assistant_messages_mode_check check (mode in ('prova', 'invio')),
  send_status text not null constraint partner_assistant_messages_status_check
    check (send_status in ('pronto', 'in_invio', 'inviato', 'incerto', 'respinto', 'scartato')),
  test_run_id uuid references private.partner_assistant_test_runs(id),
  test_index smallint check (test_index between 0 and 4),
  message_id text not null unique check (message_id ~ '^<[0-9a-f-]{36}@[a-z0-9-]+(\.[a-z0-9-]+)+>$'),
  to_address text not null check (char_length(to_address) <= 254
    and to_address ~ '^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  -- L'impronta dell'indirizzo, scritta dalla guardia all'inserimento: la guardia sullo stesso
  -- indirizzo da due schede usa questa, che resta anche dopo una cancellazione definitiva.
  address_sha256 text not null check (address_sha256 ~ '^[0-9a-f]{64}$'),
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
  -- Cancellazione definitiva di un invio vero partito o forse partito: la riga resta, con valori
  -- neutri al posto di indirizzo, oggetto, testo e messaggio, senza bozza.
  erased_at timestamptz,
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
  constraint partner_assistant_messages_appended_at_check check (appended_at is null or send_status = 'inviato'),
  constraint partner_assistant_messages_erased_check check ((draft_id is not null or erased_at is not null)
    and (erased_at is null or mode = 'invio')
    and (erased_at is not null or address_sha256 = private.partner_assistant_address_sha256(to_address)))
);
-- «Mai due volte»: una sola prima email vera viva per contatto. Le prove non contano.
create unique index partner_assistant_messages_one_first on public.partner_assistant_messages(partner_id)
  where mode = 'invio' and kind = 'primo' and send_status in ('pronto', 'in_invio', 'inviato', 'incerto');
create unique index partner_assistant_messages_one_test on public.partner_assistant_messages(test_run_id, draft_id, test_index)
  where mode = 'prova' and send_status in ('pronto', 'in_invio', 'inviato', 'incerto');
create index partner_assistant_messages_address on public.partner_assistant_messages(address_sha256, created_at desc)
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
-- updated_at, e la copia in «Posta inviata» da nulla a valorizzata su un inviato. Con il flag
-- acceso, una sola volta, la cancellazione definitiva di un invio vero: valori neutri al posto di
-- indirizzo, oggetto, testo e messaggio, senza bozza; tutto il resto, impronta dell'indirizzo
-- compresa, resta. All'inserimento la guardia scrive l'impronta dell'indirizzo.
create function private.partner_assistant_message_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_free text[] := array['send_status', 'send_day', 'smtp_code', 'enhanced_code', 'outcome', 'sent_at', 'updated_at',
    'appended_at'];
  v_erased text[] := array['to_address', 'subject', 'body', 'raw', 'sha256', 'draft_id', 'erased_at', 'updated_at'];
begin
  if tg_op = 'INSERT' then
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
create trigger partner_assistant_messages_guard before insert or update or delete on public.partner_assistant_messages
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

-- Come 20261028122704, con in più i messaggi, per primi (puntano alle bozze senza on delete). Un
-- invio vero partito o forse partito (in invio, inviato, incerto) non si toglie: resta la riga, con
-- valori neutri al posto di indirizzo, oggetto, testo e messaggio e senza bozza, perché conta per il
-- limite del giorno, per il primo giorno vero e, con l'impronta dell'indirizzo, per la guardia
-- sullo stesso indirizzo da un'altra scheda. Gli altri messaggi si cancellano. Se il contatto ha un
-- invio vero in corso o incerto l'email può essere partita: il motivo è invio_incerto, anche su un
-- lavoro già di Tommi, e l'interruttore non lo riprende. Un lavoro «inviata» resta «inviata»:
-- perde solo i riferimenti a note e bozza.
create or replace function private.partner_assistant_erase(p_partner_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_previous text := current_setting('luckylap.partner_assistant.erase', true);
  v_uncertain boolean;
begin
  v_uncertain := exists (select 1 from public.partner_assistant_messages m
    where m.partner_id = p_partner_id and m.mode = 'invio' and m.send_status in ('in_invio', 'incerto'));
  perform pg_catalog.set_config('luckylap.partner_assistant.erase', 'on', true);
  update public.partner_assistant_messages set to_address = 'cancellato@cancellato.invalid',
      subject = 'Dato cancellato', body = 'Dato cancellato.', raw = 'Dato cancellato.',
      sha256 = encode(sha256(convert_to('Dato cancellato.', 'UTF8')), 'hex'), draft_id = null, erased_at = now(),
      updated_at = now()
    where partner_id = p_partner_id and mode = 'invio' and send_status in ('in_invio', 'inviato', 'incerto')
      and erased_at is null;
  delete from public.partner_assistant_messages where partner_id = p_partner_id and erased_at is null;
  delete from public.partner_assistant_drafts where partner_id = p_partner_id;
  delete from public.partner_assistant_notes where partner_id = p_partner_id;
  perform pg_catalog.set_config('luckylap.partner_assistant.erase', coalesce(v_previous, ''), true);
  update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null, research_note_id = null,
      choice_note_id = null, draft_id = null, updated_at = now()
    where partner_id = p_partner_id and status = 'inviata';
  update public.partner_assistant_jobs set status = 'serve_tommaso', step = 'ricerca', attempts = 0, rewrites = 0,
      reason = case when v_uncertain then 'invio_incerto' when status = 'serve_tommaso' then reason
        else 'dato_cancellato' end,
      write_on = null, lease_token = null, lease_expires_at = null, research_note_id = null, choice_note_id = null,
      draft_id = null, next_attempt_at = now(), updated_at = now()
    where partner_id = p_partner_id and status <> 'inviata';
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

-- Come 20261028122704. Non tornano in scrittura le bozze con un messaggio vero in corso, inviato o
-- incerto, né i lavori «inviata», che restano al passo «controllo». Un messaggio solo preparato
-- (pronto) non protegge la bozza: il lavoro torna in scrittura e start lo scarta (bozza_cambiata),
-- così regole nuove salvate tra la preparazione e l'SMTP fermano l'invio.
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
            and m.send_status in ('in_invio', 'inviato', 'incerto'))
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
  private.partner_assistant_address_sha256(text), private.partner_assistant_message_guard(),
  private.partner_assistant_send_order(),
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

-- ===========================================================================
-- Sezione 2: calendario, coda e RPC d'invio
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Feste e paesi
-- ---------------------------------------------------------------------------

-- Feste nazionali dal 29 ottobre 2026 al 31 gennaio 2027, senza le date tra il 21 dicembre e il 7
-- gennaio (già senza invii). Regno Unito: Inghilterra e Galles; Svizzera: tutti i cantoni. Dopo il
-- 31 gennaio 2027 la finestra resta chiusa (partner_assistant_holidays_until) finché una migrazione
-- non estende la tabella.
create table private.partner_assistant_holidays (
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  day date not null,
  primary key (country_code, day)
);
insert into private.partner_assistant_holidays(country_code, day) values
  ('IT', '2026-11-01'), ('IT', '2026-12-08'),
  ('AT', '2026-11-01'), ('AT', '2026-12-08'),
  ('FR', '2026-11-01'), ('FR', '2026-11-11'),
  ('ES', '2026-11-01'), ('ES', '2026-12-06'), ('ES', '2026-12-08'),
  ('BE', '2026-11-01'), ('BE', '2026-11-11');

-- Il paese della scheda (partners.country, testo libero) confrontato dopo lower(btrim(...)).
create table private.partner_assistant_countries (
  alias text primary key check (alias = lower(alias)),
  country_code text not null check (country_code ~ '^[A-Z]{2}$')
);
insert into private.partner_assistant_countries(alias, country_code) values
  ('italia', 'IT'), ('italy', 'IT'), ('it', 'IT'),
  ('regno unito', 'GB'), ('gran bretagna', 'GB'), ('inghilterra', 'GB'), ('united kingdom', 'GB'), ('uk', 'GB'),
  ('england', 'GB'), ('gb', 'GB'),
  ('germania', 'DE'), ('germany', 'DE'), ('deutschland', 'DE'), ('de', 'DE'),
  ('austria', 'AT'), ('österreich', 'AT'), ('at', 'AT'),
  ('svizzera', 'CH'), ('switzerland', 'CH'), ('schweiz', 'CH'), ('suisse', 'CH'), ('ch', 'CH'),
  ('francia', 'FR'), ('france', 'FR'), ('fr', 'FR'),
  ('spagna', 'ES'), ('spain', 'ES'), ('españa', 'ES'), ('es', 'ES'),
  ('belgio', 'BE'), ('belgium', 'BE'), ('belgique', 'BE'), ('belgië', 'BE'), ('be', 'BE'),
  ('paesi bassi', 'NL'), ('olanda', 'NL'), ('netherlands', 'NL'), ('nederland', 'NL'), ('nl', 'NL');

-- Per l'evento «paese senza calendario», una volta per contatto.
create index partner_assistant_events_no_calendar on private.partner_assistant_events(partner_id)
  where outcome = 'paese_senza_calendario';

alter table private.partner_assistant_holidays enable row level security;
alter table private.partner_assistant_countries enable row level security;
revoke all on table private.partner_assistant_holidays, private.partner_assistant_countries
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Calendario, indirizzi e limiti (privati, nessun grant)
-- ---------------------------------------------------------------------------

-- Il codice del paese, nullo se vuoto o sconosciuto (un paese sconosciuto non ha feste).
create function private.partner_assistant_country_code(p_country text) returns text
language sql stable security invoker set search_path = '' as $$
  select c.country_code from private.partner_assistant_countries c where c.alias = lower(btrim(p_country))
$$;

-- Un fuso che PostgreSQL elenca in pg_timezone_names, senza badare alle maiuscole come AT TIME ZONE:
-- anche senza «/», come UTC o GMT, che la scelta accetta con Intl. Mai un fuso POSIX («UTC+3»),
-- che pg_timezone_names non elenca.
create function private.partner_assistant_valid_timezone(p_timezone text) returns boolean
language sql stable security invoker set search_path = '' as $$
  select coalesce(p_timezone <> '' and exists (select 1 from pg_catalog.pg_timezone_names z
    where lower(z.name) = lower(p_timezone)), false)
$$;

-- L'ultimo giorno coperto dalla tabella delle feste. Dopo, la finestra resta chiusa in ogni paese
-- finché una migrazione non aggiunge le feste nuove e non sposta questa data.
create function private.partner_assistant_holidays_until() returns date
language sql immutable security invoker set search_path = '' as $$
  select date '2027-01-31'
$$;

-- La finestra d'invio del destinatario: lunedì-venerdì, dalle 9:30 incluse alle 11:00 escluse nel
-- suo fuso (Europe/Rome se manca o non è valido), fuori dal 21 dicembre-7 gennaio e dalle feste
-- nazionali del paese della scheda, fino all'ultimo giorno coperto dalla tabella delle feste. Un
-- paese che la tabella dei paesi non conosce non ha feste (il claim lo segnala negli eventi). Con un margine, aperta sia a p_at sia a p_at + margine: claim,
-- prepare e start chiedono 90 secondi, così un invio non comincia a ridosso delle 11:00.
create function private.partner_assistant_window_open(p_timezone text, p_country text, p_at timestamptz,
  p_margin interval default interval '0')
returns boolean
language plpgsql stable security invoker set search_path = '' as $$
declare
  -- Roma senza cercarla in pg_timezone_names: è anche il fuso di riserva.
  v_zone text := case when p_timezone = 'Europe/Rome' then p_timezone
    when private.partner_assistant_valid_timezone(p_timezone) then p_timezone else 'Europe/Rome' end;
  v_code text := private.partner_assistant_country_code(p_country);
  v_local timestamp;
begin
  if p_at is null or p_margin is null or p_margin < interval '0' then return false; end if;
  foreach v_local in array array[p_at at time zone v_zone, (p_at + p_margin) at time zone v_zone] loop
    if not (extract(isodow from v_local) between 1 and 5
        and v_local::time >= time '09:30' and v_local::time < time '11:00'
        and to_char(v_local::date, 'MM-DD') between '01-08' and '12-20'
        and v_local::date <= private.partner_assistant_holidays_until()
        and not exists (select 1 from private.partner_assistant_holidays h
          where h.country_code = v_code and h.day = v_local::date)) then
      return false;
    end if;
  end loop;
  return true;
end
$$;

-- p_at se la finestra di Roma (Italia) è aperta; altrimenti il primo giorno, entro 40, alle 9:30 di
-- Roma, dopo p_at, con la finestra aperta; nullo se nessuno.
create function private.partner_assistant_next_window(p_at timestamptz) returns timestamptz
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_day date := private.partner_assistant_rome_day(p_at);
  v_at timestamptz;
begin
  if p_at is null then return null; end if;
  if private.partner_assistant_window_open('Europe/Rome', 'Italia', p_at) then return p_at; end if;
  for i in 0..40 loop
    v_at := ((v_day + i) + time '09:30') at time zone 'Europe/Rome';
    if v_at > p_at and private.partner_assistant_window_open('Europe/Rome', 'Italia', v_at) then
      return v_at;
    end if;
  end loop;
  return null;
end
$$;

-- L'indirizzo a cui si manda: minuscolo e senza spazi, solo se passa la regex stretta (la stessa di
-- nodemailer) e sta in 254 caratteri. Altrimenti nullo: non arriva mai all'SMTP.
create function private.partner_assistant_address(p_value text) returns text
language sql immutable security invoker set search_path = '' as $$
  select case when char_length(a.v) <= 254 and a.v ~ '^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$' then a.v end
  from (select lower(btrim(p_value)) as v) a
$$;

-- Il giorno (Roma) della prima email vera partita o forse partita, il più vecchio.
create function private.partner_assistant_first_real_day() returns date
language sql stable security invoker set search_path = '' as $$
  select min(m.send_day) from public.partner_assistant_messages m
  where m.mode = 'invio' and m.kind = 'primo' and m.send_status in ('inviato', 'incerto')
$$;

-- Prime email vere del giorno: 5 nei primi 7 giorni di calendario dal primo invio vero, poi il
-- limite della pagina.
create function private.partner_assistant_first_limit(p_day date) returns integer
language sql stable security invoker set search_path = '' as $$
  select case when f.day is null or p_day <= f.day + 6 then 5
    else (select c.daily_first_limit from private.partner_assistant_config c where c.singleton) end
  from (select private.partner_assistant_first_real_day() as day) f
$$;

create function private.partner_assistant_first_sent(p_day date) returns integer
language sql stable security invoker set search_path = '' as $$
  select count(*)::integer from public.partner_assistant_messages m
  where m.mode = 'invio' and m.send_day = p_day and m.send_status in ('in_invio', 'inviato', 'incerto')
$$;

create function private.partner_assistant_test_sent(p_day date) returns integer
language sql stable security invoker set search_path = '' as $$
  select count(*)::integer from public.partner_assistant_messages m
  where m.mode = 'prova' and m.send_day = p_day and m.send_status in ('in_invio', 'inviato', 'incerto')
$$;

-- Il lock della casella: blocca lo stato e dice se la lease è quella del giro. Stretta: anche non
-- scaduta. finish e la copia in «Posta inviata» bastano del token (una lease nuova lo cambia).
create function private.partner_assistant_mail_guard(p_lease_token uuid, p_strict boolean) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare s private.partner_assistant_mail_state%rowtype;
begin
  select * into s from private.partner_assistant_mail_state where singleton for update;
  return p_lease_token is not null and s.lease_token is not distinct from p_lease_token
    and (not coalesce(p_strict, true) or s.lease_expires_at > clock_timestamp());
end
$$;

-- Un esito SMTP che conta per la casella, nel giorno di Roma. Tre temporanei: niente più invii fino
-- a domani; due definitivi o uno spam: niente più invii finché Tommi non preme «Riprendi l'invio».
-- Va chiamata con lo stato della casella già bloccato.
create function private.partner_assistant_count_failure(p_kind text) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz := private.partner_assistant_now();
  v_today date := private.partner_assistant_rome_day(private.partner_assistant_now());
  s private.partner_assistant_mail_state%rowtype;
begin
  if p_kind is null or p_kind not in ('temporaneo', 'definitivo', 'spam') then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  select * into s from private.partner_assistant_mail_state where singleton for update;
  if s.failures_day is distinct from v_today then
    update private.partner_assistant_mail_state set soft_failures = 0, hard_failures = 0, failures_day = v_today
      where singleton returning * into s;
  end if;
  if p_kind = 'temporaneo' then
    update private.partner_assistant_mail_state set soft_failures = soft_failures + 1 where singleton
      returning * into s;
    if s.soft_failures >= 3 and s.day_stopped_on is distinct from v_today then
      update private.partner_assistant_mail_state set day_stopped_on = v_today where singleton;
      insert into private.partner_assistant_events(step, outcome) values ('invio', 'fermo_oggi');
    end if;
  elsif p_kind = 'definitivo' then
    update private.partner_assistant_mail_state set hard_failures = hard_failures + 1 where singleton
      returning * into s;
  end if;
  if (p_kind = 'spam' or (p_kind = 'definitivo' and s.hard_failures >= 2)) and s.stop_reason is null then
    update private.partner_assistant_mail_state set stop_reason = 'rimbalzi', stopped_at = v_now where singleton;
    insert into private.partner_assistant_events(step, outcome) values ('invio', 'fermo_rimbalzi');
  end if;
end
$$;

-- Le coppie (bozza, indirizzo di prova) che una prova deve ancora mandare, bozza per bozza nell'ordine
-- della prova: bozza ancora di un lavoro «pronta», indice sotto gli indirizzi della prova e quelli
-- che il worker ha oggi, nessun messaggio della coppia che non sia scartato.
create function private.partner_assistant_test_pairs(p_test_run_id uuid, p_recipients integer)
returns table (draft_id uuid, test_index integer, job_id uuid, partner_id uuid)
language plpgsql stable security invoker set search_path = '' as $$
begin
  return query
    select x.draft, n.ix, j.id, j.partner_id
    from private.partner_assistant_test_runs r
      cross join lateral unnest(r.draft_ids) with ordinality as x(draft, pos)
      cross join lateral generate_series(0, least(r.recipients, coalesce(p_recipients, 0)) - 1) as n(ix)
      join public.partner_assistant_jobs j on j.draft_id = x.draft and j.status = 'pronta'
    where r.id = p_test_run_id
      and not exists (select 1 from public.partner_assistant_messages m
        where m.test_run_id = r.id and m.draft_id = x.draft and m.test_index = n.ix
          and m.send_status <> 'scartato')
    order by x.pos, n.ix;
end
$$;

-- Un lavoro «pronta» con quella bozza che esce dalla coda d'invio, con un evento: di nuovo alla
-- ricerca o alla scrittura, oppure a Tommi con il motivo. Chi la chiama ha già bloccato contatto e
-- lavoro. Falso se il lavoro non è più quello.
create function private.partner_assistant_send_move(p_partner_id uuid, p_draft_id uuid, p_reason text)
returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if p_reason = 'ricerca_scaduta' then
    update public.partner_assistant_jobs set status = 'in_coda', step = 'ricerca', attempts = 0, rewrites = 0,
        reason = null, lease_token = null, lease_expires_at = null, research_note_id = null, choice_note_id = null,
        draft_id = null, next_attempt_at = now(), updated_at = now()
      where partner_id = p_partner_id and status = 'pronta' and draft_id = p_draft_id;
  elsif p_reason = 'recapito_cambiato' then
    update public.partner_assistant_jobs set status = 'in_coda', step = 'scrittura', attempts = 0, rewrites = 0,
        reason = null, lease_token = null, lease_expires_at = null, draft_id = null, next_attempt_at = now(),
        updated_at = now()
      where partner_id = p_partner_id and status = 'pronta' and draft_id = p_draft_id;
  elsif p_reason = 'regole_superate' then
    -- Come save_partner_assistant_rules: la bozza resta, il passo di scrittura la rifà.
    update public.partner_assistant_jobs set status = 'in_coda', step = 'scrittura', attempts = 0, rewrites = 0,
        reason = null, lease_token = null, lease_expires_at = null, next_attempt_at = now(), updated_at = now()
      where partner_id = p_partner_id and status = 'pronta' and draft_id = p_draft_id;
  elsif p_reason in ('bozza_scaduta', 'indirizzo_non_valido', 'conversazione_esistente', 'impronta') then
    update public.partner_assistant_jobs set status = 'serve_tommaso', reason = p_reason, lease_token = null,
        lease_expires_at = null, updated_at = now()
      where partner_id = p_partner_id and status = 'pronta' and draft_id = p_draft_id;
  else
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  if not found then return false; end if;
  insert into private.partner_assistant_events(partner_id, step, outcome) values (p_partner_id, 'invio', p_reason);
  return true;
end
$$;

-- ---------------------------------------------------------------------------
-- RPC del worker: il passo d'invio
-- ---------------------------------------------------------------------------

-- Un giro d'invio. La riga della casella è il lock: un giro alla volta. Nell'ordine: modalità e
-- configurazione, lease attiva di un altro giro, recupero dei giri morti, copie arretrate in «Posta
-- inviata», cancelli del giorno (fermo, attesa, intervallo, limite), poi il candidato: in invio il
-- primo della coda d'invio con la finestra del destinatario aperta, dopo aver tolto dalla coda le
-- righe che non possono più partire; in prova la prima coppia ancora da mandare dell'ultima prova.
create function private.claim_partner_assistant_send(p_worker_id uuid, p_lease_seconds integer,
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
      from (select m.id, m.message_id, m.raw, m.sent_at from public.partner_assistant_messages m
        where m.send_status = 'inviato' and m.appended_at is null and m.erased_at is null
          and m.sent_at >= v_now - interval '7 days'
        order by m.sent_at, m.id limit 3) a;
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
    for r in
      select o.partner_id, o.draft_id, p.country, sc.content ->> 'timezone' as timezone,
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
    -- 7. Nessun candidato: fuori finestra se restano righe, altrimenti la coda è vuota.
    if v_partner is null then v_reason := case when v_remaining then 'fuori_finestra' else 'vuota' end; end if;
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

-- Il worker lascia il candidato: conversazione trovata nella casella, bozza scaduta al ricontrollo
-- delle date, oppure casella che non risponde (attesa di 15 minuti, anche senza lavoro per una copia
-- arretrata che non si chiude). Gli argomenti si controllano prima della lease.
create function private.skip_partner_assistant_send(p_lease_token uuid, p_job_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c private.partner_assistant_config%rowtype;
  j public.partner_assistant_jobs%rowtype;
  v_now timestamptz; v_partner uuid; v_event date;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  if p_reason is null or p_reason not in ('conversazione_esistente', 'bozza_scaduta', 'casella_incerta')
    or (p_job_id is null and p_reason <> 'casella_incerta') then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  if not private.partner_assistant_mail_guard(p_lease_token, true) then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  v_now := private.partner_assistant_now();
  select * into c from private.partner_assistant_config where singleton for share;
  if p_reason = 'casella_incerta' then
    update private.partner_assistant_mail_state set backoff_until = v_now + interval '15 minutes' where singleton;
  end if;
  if p_job_id is not null then
    select l.partner_id into v_partner from public.partner_assistant_jobs l where l.id = p_job_id;
    if v_partner is not null then
      perform 1 from public.partners where id = v_partner for share;
      select * into j from public.partner_assistant_jobs where id = p_job_id for update;
    end if;
  end if;
  if j.status = 'pronta' and c.mode = 'invio' and p_reason = 'conversazione_esistente' then
    perform private.partner_assistant_send_move(j.partner_id, j.draft_id, 'conversazione_esistente');
    return jsonb_build_object('status', 'done');
  elsif j.status = 'pronta' and c.mode = 'invio' and p_reason = 'bozza_scaduta' then
    select nullif(n.content ->> 'event_starts_on', '')::date into v_event
      from public.partner_assistant_notes n where n.id = j.choice_note_id;
    if (v_event is null or v_event > private.partner_assistant_rome_day(v_now))
      and j.rewrites = 0 and c.paused_reason is distinct from 'credito' then
      -- Una riscrittura con la stessa scelta: la riga della maglietta o la data del corpo cambiano.
      update public.partner_assistant_jobs set status = 'in_coda', step = 'scrittura', draft_id = null, rewrites = 1,
          attempts = 0, reason = null, lease_token = null, lease_expires_at = null, next_attempt_at = now(),
          updated_at = now()
        where partner_id = j.partner_id;
      insert into private.partner_assistant_events(partner_id, step, outcome)
        values (j.partner_id, 'invio', 'bozza_scaduta');
    else
      perform private.partner_assistant_send_move(j.partner_id, j.draft_id, 'bozza_scaduta');
    end if;
    return jsonb_build_object('status', 'done');
  end if;
  insert into private.partner_assistant_events(partner_id, step, outcome) values (v_partner, 'invio', p_reason);
  return jsonb_build_object('status', 'done');
end
$$;

-- Il messaggio pronto per l'SMTP, dopo i controlli che non dipendono dal modello: modalità, fermi,
-- bozza, impronta approvata e testo composto, poi (in invio) contatto, recapito, regole, età della
-- ricerca, date, conversazioni, casella, limite e finestra; (in prova) destinatario e limite. Il
-- primo rifiuto è la risposta; alcuni spostano subito il lavoro.
create function private.prepare_partner_assistant_send(p_lease_token uuid, p_operation_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'job_id', 'draft_id', 'mode', 'test_run_id', 'test_index', 'message_id',
    'to_address', 'subject', 'text', 'opt_out', 'raw', 'mailbox_check'];
  v_actor uuid; v_job uuid; v_draft uuid; v_mode text; v_run uuid; v_index bigint; v_message_id text; v_to text;
  v_subject text; v_text text; v_opt_out text; v_raw text; v_check text;
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
  perform private.partner_payload(p_payload, v_keys, v_keys);
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
  v_raw := private.partner_text(p_payload, 'raw', 65536);
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
        created_at, updated_at)
      values (j.partner_id, v_draft, 'primo', v_mode, 'pronto', v_run, v_index, v_message_id, v_to, v_subject, v_text,
        v_raw, encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), d.rules_version, p_lease_token, p_operation_id,
        v_actor, v_now, now())
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

-- Subito prima dell'SMTP. Aspetta un «Ferma l'assistente» (configurazione), un «Non contattare»
-- (contatto) e regole nuove (lavoro) ancora da confermare, poi ricontrolla: se qualcosa è cambiato
-- il messaggio si scarta e niente parte.
create function private.start_partner_assistant_send(p_lease_token uuid, p_message_row_id uuid) returns jsonb
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

-- L'esito dell'SMTP, con la ricevuta: un secondo arrivo è una ripetizione. Con il token della lease
-- anche scaduta (un 250 arrivato tardi va registrato), ma solo su un messaggio ancora in invio.
create function private.finish_partner_assistant_send(p_lease_token uuid, p_operation_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'message_row_id', 'outcome', 'smtp_code', 'enhanced_code', 'spam', 'reason'];
  v_actor uuid; v_message uuid; v_outcome text; v_code bigint; v_enhanced text; v_spam boolean; v_reason text;
  v_partner uuid; v_now timestamptz; v_after text; v_event text;
  p public.partners%rowtype;
  m public.partner_assistant_messages%rowtype;
  replay jsonb; result jsonb;
begin
  perform private.partner_assistant_service_required();
  v_actor := private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, v_keys, v_keys);
  v_message := private.partner_uuid(p_payload, 'message_row_id');
  v_outcome := private.partner_enum(p_payload, 'outcome', array['inviato', 'incerto', 'respinto', 'scartato']);
  v_code := private.partner_bigint(p_payload, 'smtp_code', 200, 599);
  v_enhanced := private.partner_text(p_payload, 'enhanced_code', 20);
  v_spam := private.partner_bool(p_payload, 'spam');
  v_reason := private.partner_text(p_payload, 'reason', 80);
  perform private.partner_check(p_lease_token is not null and v_message is not null and v_outcome is not null
    and (v_enhanced is null or v_enhanced ~ '^[245]\.[0-9]{1,3}\.[0-9]{1,3}$')
    and case when v_outcome = 'scartato'
      then coalesce(v_reason in ('smtp_temporaneo', 'smtp_non_partito', 'smtp_credenziali', 'smtp_bloccato'), false)
      else v_reason is null or v_reason ~ '^[a-z][a-z0-9_]{0,79}$' end);
  if v_actor is null then raise exception 'partner_assistant_not_configured' using errcode = '55000'; end if;
  replay := private.partner_assistant_begin(p_operation_id, 'finish_partner_assistant_send', v_actor, p_payload);
  if replay is not null then return replay; end if;
  if not private.partner_assistant_mail_guard(p_lease_token, false) then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  select x.partner_id into v_partner from public.partner_assistant_messages x where x.id = v_message;
  if not found then return jsonb_build_object('status', 'lease_persa'); end if;
  select * into p from public.partners where id = v_partner for update;
  perform 1 from public.partner_assistant_jobs where partner_id = v_partner for update;
  select * into m from public.partner_assistant_messages where id = v_message for update;
  if not found or m.lease_token is distinct from p_lease_token or m.send_status <> 'in_invio' then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  v_now := private.partner_assistant_now();
  update public.partner_assistant_messages set send_status = v_outcome, smtp_code = v_code, enhanced_code = v_enhanced,
      outcome = v_reason, sent_at = case when v_outcome in ('inviato', 'incerto') then v_now end, updated_at = now()
    where id = m.id;
  if v_outcome in ('inviato', 'incerto', 'respinto') then
    update private.partner_assistant_mail_state
      set next_send_after = v_now + make_interval(secs => 240 + floor(random() * 421))
      where singleton;
  end if;
  v_event := case when m.mode = 'prova' and v_outcome = 'inviato' then 'prova_inviata'
    else m.mode || '_' || v_outcome end;
  insert into private.partner_assistant_events(partner_id, step, outcome) values (v_partner, 'invio', v_event);
  if v_outcome = 'inviato' and m.mode = 'invio' then
    -- La prima email è partita: «Contattato», la riga del registro dell'assistente (il trigger crea
    -- il promemoria di sollecito per chi riceve i passaggi) e il lavoro chiuso.
    v_after := case when p.stage = 'da_contattare' then 'contattato' else p.stage end;
    if v_after <> p.stage then
      perform private.apply_partner_stage(p.id, v_after, v_actor, p_operation_id, false);
    end if;
    perform private.partner_log(p_operation_id, p.id, 'inviato', v_actor, p_stage_before => p.stage,
      p_stage_after => v_after, p_channel => 'email', p_message_kind => 'primo', p_body => '',
      p_origin => 'assistente');
    update public.partner_assistant_jobs set status = 'inviata', reason = null, lease_token = null,
        lease_expires_at = null, updated_at = now()
      where partner_id = v_partner;
  elsif v_outcome = 'incerto' and m.mode = 'invio' then
    -- Mai un nuovo tentativo: può essere partita.
    update public.partner_assistant_jobs set status = 'serve_tommaso', reason = 'invio_incerto', lease_token = null,
        lease_expires_at = null, updated_at = now()
      where partner_id = v_partner;
  elsif v_outcome = 'respinto' then
    perform private.partner_assistant_count_failure(case when v_enhanced like '5.7.%' or coalesce(v_spam, false)
      then 'spam' else 'definitivo' end);
    if m.mode = 'invio' then
      update public.partner_assistant_jobs set status = 'serve_tommaso',
          reason = case when v_enhanced like '5.1.%' then 'indirizzo_non_valido' else 'invio_rifiutato' end,
          lease_token = null, lease_expires_at = null, updated_at = now()
        where partner_id = v_partner;
    end if;
  elsif v_outcome = 'scartato' then
    -- Non partita: il lavoro resta «pronta» e si riprova al giro dopo, salvo i fermi.
    if v_reason in ('smtp_temporaneo', 'smtp_non_partito') then
      perform private.partner_assistant_count_failure('temporaneo');
    elsif v_reason = 'smtp_bloccato' then
      perform private.partner_assistant_count_failure('spam');
    elsif v_reason = 'smtp_credenziali' then
      update private.partner_assistant_mail_state set stop_reason = 'casella', stopped_at = v_now where singleton;
      insert into private.partner_assistant_events(step, outcome) values ('invio', 'fermo_casella');
    end if;
  end if;
  result := jsonb_build_object('status', 'done', 'send_status', v_outcome, 'replayed', false);
  return private.partner_assistant_finish(p_operation_id, 'finish_partner_assistant_send', v_actor, p_payload, result);
end
$$;

-- La copia in «Posta inviata» è fatta (o c'era già).
create function private.record_partner_assistant_append(p_lease_token uuid, p_message_row_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_found boolean; v_partner uuid;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, array['schema_version', 'found'], array['schema_version', 'found']);
  v_found := private.partner_bool(p_payload, 'found');
  perform private.partner_check(p_lease_token is not null and p_message_row_id is not null and v_found is not null);
  if not private.partner_assistant_mail_guard(p_lease_token, false) then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  select m.partner_id into v_partner from public.partner_assistant_messages m where m.id = p_message_row_id;
  if v_partner is not null then
    perform 1 from public.partners where id = v_partner for share;
    update public.partner_assistant_messages set appended_at = private.partner_assistant_now(), updated_at = now()
      where id = p_message_row_id and send_status = 'inviato' and appended_at is null;
    if found then
      insert into private.partner_assistant_events(partner_id, step, outcome)
        values (v_partner, 'invio', case when v_found then 'copia_trovata' else 'copia_salvata' end);
    end if;
  end if;
  return jsonb_build_object('status', 'done');
end
$$;

-- Credenziali IMAP rifiutate: niente più invii finché Tommi non preme «Riprendi l'invio».
create function private.pause_partner_assistant_send(p_lease_token uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  if p_reason is distinct from 'casella' then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  if not private.partner_assistant_mail_guard(p_lease_token, true) then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  update private.partner_assistant_mail_state set stop_reason = 'casella', stopped_at = private.partner_assistant_now()
    where singleton;
  insert into private.partner_assistant_events(step, outcome) values ('invio', 'fermo_casella');
  return jsonb_build_object('status', 'done', 'stop_reason', 'casella');
end
$$;

-- Fine del giro: toglie la lease, salva l'esito e gli accessi (codici, ok = riuscito; nulli: nessun
-- accesso in questo giro).
create function private.release_partner_assistant_send(p_lease_token uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'outcome', 'smtp_login', 'imap_login'];
  v_outcome text; v_smtp text; v_imap text; v_now timestamptz;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, v_keys, v_keys);
  v_outcome := private.partner_text(p_payload, 'outcome', 80);
  v_smtp := private.partner_text(p_payload, 'smtp_login', 80);
  v_imap := private.partner_text(p_payload, 'imap_login', 80);
  perform private.partner_check(p_lease_token is not null and v_outcome ~ '^[a-z][a-z0-9_]{0,79}$'
    and (v_smtp is null or v_smtp ~ '^[a-z][a-z0-9_]{0,79}$') and (v_imap is null or v_imap ~ '^[a-z][a-z0-9_]{0,79}$'));
  if not private.partner_assistant_mail_guard(p_lease_token, true) then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  v_now := private.partner_assistant_now();
  update private.partner_assistant_mail_state set lease_token = null, lease_expires_at = null, last_outcome = v_outcome,
      smtp_login_at = case when v_smtp is null then smtp_login_at else v_now end,
      smtp_login_code = coalesce(v_smtp, smtp_login_code),
      imap_login_at = case when v_imap is null then imap_login_at else v_now end,
      imap_login_code = coalesce(v_imap, imap_login_code)
    where singleton;
  return jsonb_build_object('status', 'done');
end
$$;

-- Variabili della posta, a ogni giro dopo il controllo del bearer, anche senza posta: solo se ci
-- sono e quanti indirizzi di prova, mai i valori. Nessuna lease, nessun altro lock.
create function private.record_partner_assistant_environment(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['schema_version', 'mailbox_ok', 'test_ok', 'test_count'];
  v_mailbox boolean; v_test boolean; v_count bigint;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  perform private.partner_payload(p_payload, v_keys, v_keys);
  v_mailbox := private.partner_bool(p_payload, 'mailbox_ok');
  v_test := private.partner_bool(p_payload, 'test_ok');
  v_count := private.partner_bigint(p_payload, 'test_count', 0, 5);
  perform private.partner_check(v_mailbox is not null and v_test is not null and v_count is not null
    and v_test = (v_count between 1 and 5));
  perform 1 from private.partner_assistant_mail_state where singleton for update;
  update private.partner_assistant_mail_state set env_mailbox_ok = v_mailbox, env_test_ok = v_test,
      env_test_count = v_count, env_checked_at = private.partner_assistant_now()
    where singleton;
  return jsonb_build_object('status', 'done');
end
$$;

-- ---------------------------------------------------------------------------
-- Lettura della pagina
-- ---------------------------------------------------------------------------

-- Lo stato dell'invio per i membri: fermi e attese, limiti del giorno, prova, finestra di Roma,
-- coda, variabili e accessi (mai valori), ultimi messaggi senza indirizzi, priorità d'invio.
create function private.read_partner_assistant_send() returns jsonb
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
          where m.test_run_id = t.id and m.send_status = 'inviato'))
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

-- ---------------------------------------------------------------------------
-- Wrapper pubblici
-- ---------------------------------------------------------------------------

create function public.claim_partner_assistant_send(p_worker_id uuid, p_lease_seconds integer, p_test_recipients integer)
returns jsonb
language sql security invoker set search_path = '' as $$ select private.claim_partner_assistant_send(p_worker_id, p_lease_seconds, p_test_recipients) $$;
create function public.skip_partner_assistant_send(p_lease_token uuid, p_job_id uuid, p_reason text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.skip_partner_assistant_send(p_lease_token, p_job_id, p_reason) $$;
create function public.prepare_partner_assistant_send(p_lease_token uuid, p_operation_id uuid, p_payload jsonb)
returns jsonb
language sql security invoker set search_path = '' as $$ select private.prepare_partner_assistant_send(p_lease_token, p_operation_id, p_payload) $$;
create function public.start_partner_assistant_send(p_lease_token uuid, p_message_row_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.start_partner_assistant_send(p_lease_token, p_message_row_id) $$;
create function public.finish_partner_assistant_send(p_lease_token uuid, p_operation_id uuid, p_payload jsonb)
returns jsonb
language sql security invoker set search_path = '' as $$ select private.finish_partner_assistant_send(p_lease_token, p_operation_id, p_payload) $$;
create function public.record_partner_assistant_append(p_lease_token uuid, p_message_row_id uuid, p_payload jsonb)
returns jsonb
language sql security invoker set search_path = '' as $$ select private.record_partner_assistant_append(p_lease_token, p_message_row_id, p_payload) $$;
create function public.pause_partner_assistant_send(p_lease_token uuid, p_reason text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.pause_partner_assistant_send(p_lease_token, p_reason) $$;
create function public.release_partner_assistant_send(p_lease_token uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.release_partner_assistant_send(p_lease_token, p_payload) $$;
create function public.record_partner_assistant_environment(p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.record_partner_assistant_environment(p_payload) $$;
create function public.read_partner_assistant_send() returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.read_partner_assistant_send() $$;

-- ---------------------------------------------------------------------------
-- Permessi della sezione 2
-- ---------------------------------------------------------------------------

-- EXECUTE tolto a tutti, poi le RPC del worker (private e wrapper) solo a service_role e la lettura
-- solo ad authenticated. Le funzioni di supporto restano senza grant.
revoke all on function
  private.partner_assistant_country_code(text), private.partner_assistant_valid_timezone(text),
  private.partner_assistant_holidays_until(),
  private.partner_assistant_window_open(text, text, timestamptz, interval),
  private.partner_assistant_next_window(timestamptz),
  private.partner_assistant_address(text), private.partner_assistant_first_real_day(),
  private.partner_assistant_first_limit(date), private.partner_assistant_first_sent(date),
  private.partner_assistant_test_sent(date), private.partner_assistant_mail_guard(uuid, boolean),
  private.partner_assistant_count_failure(text), private.partner_assistant_test_pairs(uuid, integer),
  private.partner_assistant_send_move(uuid, uuid, text),
  private.claim_partner_assistant_send(uuid, integer, integer), public.claim_partner_assistant_send(uuid, integer, integer),
  private.skip_partner_assistant_send(uuid, uuid, text), public.skip_partner_assistant_send(uuid, uuid, text),
  private.prepare_partner_assistant_send(uuid, uuid, jsonb), public.prepare_partner_assistant_send(uuid, uuid, jsonb),
  private.start_partner_assistant_send(uuid, uuid), public.start_partner_assistant_send(uuid, uuid),
  private.finish_partner_assistant_send(uuid, uuid, jsonb), public.finish_partner_assistant_send(uuid, uuid, jsonb),
  private.record_partner_assistant_append(uuid, uuid, jsonb), public.record_partner_assistant_append(uuid, uuid, jsonb),
  private.pause_partner_assistant_send(uuid, text), public.pause_partner_assistant_send(uuid, text),
  private.release_partner_assistant_send(uuid, jsonb), public.release_partner_assistant_send(uuid, jsonb),
  private.record_partner_assistant_environment(jsonb), public.record_partner_assistant_environment(jsonb),
  private.read_partner_assistant_send(), public.read_partner_assistant_send()
from public, anon, authenticated, service_role;
grant execute on function
  private.claim_partner_assistant_send(uuid, integer, integer), public.claim_partner_assistant_send(uuid, integer, integer),
  private.skip_partner_assistant_send(uuid, uuid, text), public.skip_partner_assistant_send(uuid, uuid, text),
  private.prepare_partner_assistant_send(uuid, uuid, jsonb), public.prepare_partner_assistant_send(uuid, uuid, jsonb),
  private.start_partner_assistant_send(uuid, uuid), public.start_partner_assistant_send(uuid, uuid),
  private.finish_partner_assistant_send(uuid, uuid, jsonb), public.finish_partner_assistant_send(uuid, uuid, jsonb),
  private.record_partner_assistant_append(uuid, uuid, jsonb), public.record_partner_assistant_append(uuid, uuid, jsonb),
  private.pause_partner_assistant_send(uuid, text), public.pause_partner_assistant_send(uuid, text),
  private.release_partner_assistant_send(uuid, jsonb), public.release_partner_assistant_send(uuid, jsonb),
  private.record_partner_assistant_environment(jsonb), public.record_partner_assistant_environment(jsonb)
to service_role;
grant execute on function private.read_partner_assistant_send(), public.read_partner_assistant_send() to authenticated;

commit;
