-- Acquisizione IONOS anche per contatti iniziati dal team via email o modulo.
-- Legge soltanto i nuovi messaggi. La ricezione non abilita alcun percorso di invio.
begin;

create table private.partner_ionos_inbox_state (
  singleton boolean primary key default true check (singleton),
  activated_at timestamptz,
  next_scan_at timestamptz not null default now(),
  lease_token uuid,
  last_checked_at timestamptz,
  last_outcome text
);
insert into private.partner_ionos_inbox_state default values;

create table private.partner_ionos_inbox_cursors (
  path text primary key check (path = 'INBOX'),
  uid_validity text not null check (uid_validity ~ '^[1-9][0-9]{0,29}$'),
  last_uid bigint not null check (last_uid between 0 and 4294967295)
);

-- Un unico identificativo copre il vecchio lettore dei solleciti e quello della casella.
create table private.partner_ionos_inbox_receipts (
  message_id_sha256 text primary key check (message_id_sha256 ~ '^[0-9a-f]{64}$'),
  partner_id uuid references public.partners(id) on delete cascade,
  activity_id uuid references public.partner_activities(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  disposition text not null check (disposition in ('registered', 'review', 'ignored')),
  from_address_sha256 text check (from_address_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index partner_ionos_inbox_registered_sender
  on private.partner_ionos_inbox_receipts(partner_id, from_address_sha256)
  where disposition = 'registered';
insert into private.partner_ionos_inbox_receipts
  (message_id_sha256, partner_id, activity_id, disposition, received_at)
select r.message_id_sha256, a.partner_id, r.activity_id, 'registered', r.received_at
from private.partner_followup_reply_receipts r
join public.partner_activities a on a.id = r.activity_id;

alter table private.partner_ionos_inbox_state enable row level security;
alter table private.partner_ionos_inbox_cursors enable row level security;
alter table private.partner_ionos_inbox_receipts enable row level security;
revoke all on private.partner_ionos_inbox_state, private.partner_ionos_inbox_cursors,
  private.partner_ionos_inbox_receipts from public, anon, authenticated, service_role;

create function private.partner_ionos_words(p_text text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(
    translate(lower(coalesce(p_text, '')), 'àáâäãåèéêëìíîïòóôöõùúûüçñ', 'aaaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- L'alias mantiene il nome distintivo, togliendo anno e descrizioni tra parentesi.
-- Nomi generici o troppo corti non autorizzano l'associazione per il solo oggetto.
create function private.partner_ionos_subject_alias(p_name text) returns text
language sql immutable set search_path = '' as $$
  with cleaned as (
    select private.partner_ionos_words(regexp_replace(regexp_replace(p_name,
      '\([^)]*\)', ' ', 'g'), '\m20[0-9]{2}\M', ' ', 'g')) as value
  )
  select case when char_length(value) >= 8
    and value not in ('porsche club', 'ferrari club', 'mercedes benz club', 'classic car', 'classic cars')
    then value end from cleaned
$$;

create function private.partner_ionos_candidates() returns table (
  partner_id uuid, co integer, name text, first_contact_at timestamptz,
  last_contact_at timestamptz, last_form_at timestamptz, addresses jsonb, subject_alias text
)
language sql stable set search_path = '' as $$
  select p.id, p.co, p.name, min(a.occurred_at), max(a.occurred_at),
    max(a.occurred_at) filter (where a.channel = 'form'),
    coalesce((select jsonb_agg(distinct private.partner_assistant_address(c.link_value))
      from public.partner_contacts c where c.partner_id = p.id and c.kind = 'email'
        and c.active and c.erased_at is null
        and (c.verified or exists (select 1 from private.partner_ionos_inbox_receipts r
          where r.partner_id = p.id and r.disposition = 'registered'
            and r.from_address_sha256 = private.partner_assistant_address_sha256(
              private.partner_assistant_address(c.link_value))))
        and private.partner_assistant_address(c.link_value) is not null), '[]'::jsonb),
    private.partner_ionos_subject_alias(p.name)
  from public.partners p join public.partner_activities a on a.partner_id = p.id
  where a.kind = 'inviato' and a.channel in ('email', 'form')
    and a.occurred_at <= private.partner_followup_proof_now()
    and p.research_removed_at is null
  group by p.id
$$;

create function public.claim_partner_ionos_inbox(p_worker_id uuid, p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s private.partner_assistant_mail_state%rowtype;
  i private.partner_ionos_inbox_state%rowtype;
  v_now timestamptz := private.partner_followup_proof_now();
  v_token uuid;
  v_candidates jsonb;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_check(p_worker_id is not null and p_lease_seconds between 60 and 300);
  select * into s from private.partner_assistant_mail_state where singleton for update;
  select * into i from private.partner_ionos_inbox_state where singleton for update;
  if s.singleton is null or not exists (select 1 from private.partner_assistant_config
    where singleton and actor_id is not null and handoff_to is not null) then
    return jsonb_build_object('status', 'idle', 'reason', 'non_configurato');
  end if;
  if s.lease_expires_at > clock_timestamp() then
    return jsonb_build_object('status', 'idle', 'reason', 'occupato');
  end if;
  if s.stop_reason = 'casella' or s.backoff_until > v_now then
    return jsonb_build_object('status', 'idle', 'reason', 'attesa');
  end if;
  if i.activated_at is not null and i.next_scan_at > v_now then
    return jsonb_build_object('status', 'idle', 'reason', 'intervallo');
  end if;
  if (select count(*) from private.partner_ionos_candidates()) > 500 then
    if not exists (select 1 from public.tasks
      where title = 'Controllare acquisizione IONOS · limite contatti' and status <> 'done') then
      insert into public.tasks(title, description, status, due_at, assigned_to, created_by)
        select 'Controllare acquisizione IONOS · limite contatti',
          'La casella non è stata acquisita perché più di 500 schede hanno contatti email o modulo precedenti. Nessun risultato è stato troncato.',
          'todo', v_now, c.handoff_to, c.actor_id
        from private.partner_assistant_config c where c.singleton;
    end if;
    update private.partner_ionos_inbox_state set next_scan_at = v_now + interval '2 minutes',
      last_outcome = 'limite_contatti' where singleton;
    return jsonb_build_object('status', 'idle', 'reason', 'limite_contatti');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('partner_id', c.partner_id, 'co', c.co,
    'name', c.name, 'first_contact_at', c.first_contact_at, 'last_contact_at', c.last_contact_at,
    'addresses', c.addresses, 'subject_alias', c.subject_alias) order by c.co), '[]'::jsonb)
    into v_candidates from private.partner_ionos_candidates() c;
  v_token := gen_random_uuid();
  update private.partner_assistant_mail_state set lease_token = v_token,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    candidate_draft_id = null where singleton;
  update private.partner_ionos_inbox_state set activated_at = coalesce(activated_at, v_now),
    next_scan_at = v_now + interval '2 minutes', lease_token = v_token
    where singleton returning * into i;
  return jsonb_build_object('status', 'claimed', 'lease_token', v_token,
    'activated_at', i.activated_at, 'candidates', v_candidates,
    'cursors', coalesce((select jsonb_agg(jsonb_build_object('path', path,
      'uid_validity', uid_validity, 'last_uid', last_uid) order by path)
      from private.partner_ionos_inbox_cursors),
      '[{"path":"INBOX","uid_validity":null,"last_uid":0}]'::jsonb));
end
$$;

create function public.record_partner_ionos_inbox(p_lease_token uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  i private.partner_ionos_inbox_state%rowtype;
  cursor_row private.partner_ionos_inbox_cursors%rowtype;
  p public.partners%rowtype;
  msg jsonb;
  folder jsonb;
  v_uid_validity text;
  v_last_uid bigint;
  v_expected bigint;
  v_message_id text;
  v_from text;
  v_subject text;
  v_excerpt text;
  v_hash text;
  v_received timestamptz;
  v_refs text[];
  v_ids uuid[];
  v_sender_ids uuid[];
  v_subject_ids uuid[];
  v_thread_ids uuid[];
  v_raw_thread_ids uuid[];
  v_review_only boolean;
  v_partner uuid;
  v_task uuid;
  v_activity uuid;
  v_actor uuid;
  v_operation uuid;
  v_stage text;
  v_body text;
  v_now timestamptz := private.partner_followup_proof_now();
  v_registered integer := 0;
  v_review integer := 0;
  v_ignored integer := 0;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_keys(p_payload, array['folder', 'messages'], array['folder', 'messages']);
  folder := p_payload -> 'folder';
  perform private.partner_keys(folder, array['path', 'uid_validity', 'expected_last_uid', 'last_uid'],
    array['path', 'uid_validity', 'expected_last_uid', 'last_uid']);
  perform private.partner_check(folder ->> 'path' = 'INBOX'
    and folder ->> 'uid_validity' ~ '^[1-9][0-9]{0,29}$'
    and folder ->> 'expected_last_uid' ~ '^[0-9]{1,10}$'
    and folder ->> 'last_uid' ~ '^[0-9]{1,10}$'
    and jsonb_typeof(p_payload -> 'messages') = 'array'
    and jsonb_array_length(p_payload -> 'messages') <= 50);
  v_uid_validity := folder ->> 'uid_validity';
  v_expected := (folder ->> 'expected_last_uid')::bigint;
  v_last_uid := (folder ->> 'last_uid')::bigint;
  perform private.partner_check(v_last_uid between 0 and 4294967295
    and v_expected between 0 and 4294967295);
  if not private.partner_assistant_mail_guard(p_lease_token, true) then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  select * into i from private.partner_ionos_inbox_state where singleton for update;
  if i.lease_token is distinct from p_lease_token or i.activated_at is null then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  select * into cursor_row from private.partner_ionos_inbox_cursors where path = 'INBOX' for update;
  if found then
    if cursor_row.last_uid <> v_expected then return jsonb_build_object('status', 'lease_persa'); end if;
    perform private.partner_check(cursor_row.uid_validity <> v_uid_validity or v_last_uid >= v_expected);
  elsif v_expected <> 0 then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  v_actor := private.partner_assistant_as_actor();
  perform private.partner_check(v_actor is not null);

  for msg in select value from jsonb_array_elements(p_payload -> 'messages') loop
    perform private.partner_keys(msg,
      array['message_id', 'from_address', 'received_at', 'subject', 'automatic'],
      array['message_id', 'from_address', 'received_at', 'subject', 'automatic', 'references', 'body_excerpt']);
    v_message_id := private.partner_text(msg, 'message_id', 254);
    v_from := private.partner_assistant_address(private.partner_text(msg, 'from_address', 254));
    v_subject := private.partner_text(msg, 'subject', 300);
    v_excerpt := coalesce(private.partner_text(msg, 'body_excerpt', 2000), '');
    perform private.partner_check(v_message_id ~ '^<[^<>[:space:]@[:cntrl:]]{1,250}@[^<>[:space:]@[:cntrl:]]{1,250}>$'
      and octet_length(v_message_id) = char_length(v_message_id) and v_from is not null
      and v_subject is not null and v_subject !~ '[[:cntrl:]]'
      and position(chr(8232) in v_subject) = 0 and position(chr(8233) in v_subject) = 0
      and (msg ->> 'received_at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      and jsonb_typeof(msg -> 'automatic') = 'boolean'
      and v_excerpt !~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]');
    if msg ? 'references' then
      perform private.partner_check(jsonb_typeof(msg -> 'references') = 'array'
        and jsonb_array_length(msg -> 'references') <= 64
        and not exists (select 1 from jsonb_array_elements(msg -> 'references') r
          where jsonb_typeof(r) <> 'string'
            or r #>> '{}' !~ '^<[^<>[:space:]@[:cntrl:]]{1,250}@[^<>[:space:]@[:cntrl:]]{1,250}>$'));
    end if;
    v_received := (msg ->> 'received_at')::timestamptz;
    v_hash := encode(sha256(convert_to(v_message_id, 'UTF8')), 'hex');
    if v_received < i.activated_at or v_received > v_now
      or exists (select 1 from private.partner_ionos_inbox_receipts where message_id_sha256 = v_hash) then
      v_ignored := v_ignored + 1;
      continue;
    end if;
    v_partner := null;
    v_task := null;
    v_activity := null;
    select coalesce(array_agg(value), array[]::text[]) into v_refs
      from jsonb_array_elements_text(coalesce(msg -> 'references', '[]'::jsonb));
    select coalesce(array_agg(distinct m.partner_id), array[]::uuid[]) into v_thread_ids
      from public.partner_assistant_messages m where m.message_id = any(v_refs)
        and m.mode = 'invio' and m.send_status = 'inviato' and m.erased_at is null
        and m.sent_at <= v_received
        and (private.partner_assistant_address(m.to_address) = v_from
          or exists (select 1 from public.partner_contacts c where c.partner_id = m.partner_id
            and c.kind = 'email' and c.active and c.verified and c.erased_at is null
            and private.partner_assistant_address(c.link_value) = v_from));
    select coalesce(array_agg(distinct m.partner_id), array[]::uuid[]) into v_raw_thread_ids
      from public.partner_assistant_messages m where m.message_id = any(v_refs)
        and m.mode = 'invio' and m.send_status = 'inviato' and m.erased_at is null
        and m.sent_at <= v_received;
    select coalesce(array_agg(c.partner_id), array[]::uuid[]) into v_sender_ids
      from private.partner_ionos_candidates() c where c.first_contact_at <= v_received
        and c.addresses ? v_from;
    select coalesce(array_agg(c.partner_id), array[]::uuid[]) into v_subject_ids
      from private.partner_ionos_candidates() c where c.last_form_at <= v_received
        and c.last_form_at >= v_received - interval '90 days' and c.subject_alias is not null
        and position(' ' || c.subject_alias || ' ' in ' ' || private.partner_ionos_words(v_subject) || ' ') > 0;
    select coalesce(array_agg(distinct x), array[]::uuid[]) into v_ids
      from unnest(v_thread_ids || v_sender_ids || v_subject_ids) x;
    v_review_only := cardinality(v_raw_thread_ids) > 0 and
      (cardinality(v_ids) = 0 or exists (select 1 from unnest(v_raw_thread_ids) x where not (x = any(v_ids))));
    select coalesce(array_agg(distinct x), array[]::uuid[]) into v_ids
      from unnest(v_ids || v_raw_thread_ids) x;

    if (msg ->> 'automatic')::boolean or cardinality(v_ids) = 0 then
      insert into private.partner_ionos_inbox_receipts
        (message_id_sha256, disposition, received_at) values (v_hash, 'ignored', v_received);
      v_ignored := v_ignored + 1;
      continue;
    end if;
    -- Riferimenti discordanti, indirizzi condivisi e più eventi nel titolo richiedono verifica.
    if cardinality(v_ids) > 1 or v_review_only then
      for p in select * from public.partners where id = any(v_ids) order by id for update loop
        perform private.partner_followup_hold(f.id, 'ambiguous', false)
          from public.partner_assistant_followups f where f.partner_id = p.id and f.status = 'active';
      end loop;
      insert into public.tasks(title, description, status, due_at, assigned_to, created_by)
        select 'Controllare risposta IONOS · ' || left(v_subject, 190),
          'Messaggio ricevuto il ' || to_char(v_received at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI')
            || E'.\nDa: ' || v_from || E'\nID messaggio: ' || v_message_id
            || E'\nCollegamento da verificare. CO ' || string_agg(c.co::text, ', ' order by c.co),
          'todo', v_now, config.handoff_to, v_actor
        from public.partners c cross join private.partner_assistant_config config
        where c.id = any(v_ids) and config.singleton group by config.handoff_to
        returning id into v_task;
      insert into private.partner_ionos_inbox_receipts
        (message_id_sha256, task_id, disposition, received_at) values (v_hash, v_task, 'review', v_received);
      v_review := v_review + 1;
      continue;
    end if;
    v_partner := v_ids[1];
    select * into p from public.partners where id = v_partner for update;
    if not found then v_ignored := v_ignored + 1; continue; end if;
    v_operation := gen_random_uuid();
    v_stage := case when p.stage in ('da_contattare', 'contattato') then 'risposto' else p.stage end;
    if private.partner_blocked(p.id) then v_stage := p.stage; end if;
    if v_stage <> p.stage then
      perform private.apply_partner_stage(p.id, v_stage, v_actor, v_operation, false);
    end if;
    v_body := 'Risposta ricevuta dalla casella IONOS.' || E'\nDa: ' || v_from
      || E'\nOggetto: ' || v_subject || E'\nID messaggio: ' || v_message_id;
    if v_excerpt <> '' then v_body := v_body || E'\n\n' || v_excerpt; end if;
    v_activity := private.partner_log(v_operation, p.id, 'risposta', v_actor,
      p_stage_before => p.stage, p_stage_after => v_stage, p_channel => 'email',
      p_body => left(v_body, 4000), p_origin => 'assistente', p_occurred_at => v_received);
    insert into private.partner_ionos_inbox_receipts
      (message_id_sha256, partner_id, activity_id, disposition, received_at, from_address_sha256)
      values (v_hash, p.id, v_activity, 'registered', v_received,
        private.partner_assistant_address_sha256(v_from));
    -- Un referente incontrato con un collegamento certo resta utilizzabile se cambia oggetto.
    -- La provenienza è la risposta, distinta dalla verifica sul sito del flag verified.
    if not private.partner_blocked(p.id) and not exists (select 1 from public.partner_contacts c
      where c.partner_id = p.id and c.kind = 'email' and c.erased_at is null
        and private.partner_assistant_address(c.link_value) = v_from) then
      insert into public.partner_contacts(partner_id, kind, value, link_value, label,
        verified, active, created_by, updated_by)
        values (p.id, 'email', v_from, v_from, 'Risposta ricevuta in IONOS', false, true,
          v_actor, v_actor);
      perform private.partner_log(gen_random_uuid(), p.id, 'recapito', v_actor,
        p_body => 'Referente aggiunto dalla risposta ricevuta in IONOS.', p_origin => 'assistente');
    end if;

    -- Chiude solo i promemoria precedenti alla ricezione, anche quelli dei contatti manuali.
    update public.tasks t set status = 'done'
      from public.partner_work_links l join public.partner_activities a on a.id = l.activity_id
      where l.partner_id = p.id and l.kind = 'follow_up' and l.task_id = t.id
        and t.status <> 'done' and a.occurred_at <= v_received;
    perform private.partner_followup_suppress(p.id,
      private.partner_assistant_address_sha256(v_from), 'possible_response');
    update public.partner_assistant_followups set status = 'replied', reason = 'risposta_registrata',
      next_due_on = null, deferred_until = null, draft_id = null, version = version + 1,
      last_checked_at = v_now, updated_at = now() where partner_id = p.id and status <> 'replied';
    update private.partner_followup_drafts set invalidated_at = v_now
      where conversation_id in (select id from public.partner_assistant_followups where partner_id = p.id)
        and invalidated_at is null;
    update private.partner_followup_proofs set used_at = v_now
      where conversation_id in (select id from public.partner_assistant_followups where partner_id = p.id)
        and used_at is null;
    update public.partner_assistant_messages set send_status = 'scartato', outcome = 'risposta_registrata',
      updated_at = now() where partner_id = p.id and kind = 'sollecito' and send_status = 'pronto';
    update public.tasks set status = 'done' where title = 'Controllare risposta · ' || p.name
      and created_by = v_actor and status <> 'done';
    v_registered := v_registered + 1;
  end loop;

  insert into private.partner_ionos_inbox_cursors(path, uid_validity, last_uid)
    values ('INBOX', v_uid_validity, v_last_uid)
    on conflict (path) do update set uid_validity = excluded.uid_validity, last_uid = excluded.last_uid;
  update private.partner_ionos_inbox_state set last_checked_at = v_now,
    last_outcome = 'inbox_osservata' where singleton;
  return jsonb_build_object('status', 'recorded', 'registered', v_registered,
    'review', v_review, 'ignored', v_ignored);
end
$$;

create function public.release_partner_ionos_inbox(p_lease_token uuid, p_outcome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := private.partner_followup_proof_now();
begin
  perform private.partner_assistant_service_required();
  perform private.partner_check(p_outcome in ('inbox_osservata', 'inbox_incerta'));
  if not private.partner_assistant_mail_guard(p_lease_token, false) then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  perform 1 from private.partner_ionos_inbox_state
    where singleton and lease_token = p_lease_token for update;
  if not found then return jsonb_build_object('status', 'lease_persa'); end if;
  update private.partner_ionos_inbox_state set lease_token = null, last_outcome = p_outcome,
    last_checked_at = v_now where singleton;
  update private.partner_assistant_mail_state set lease_token = null, lease_expires_at = null,
    imap_login_at = v_now, imap_login_code = case when p_outcome = 'inbox_osservata'
      then 'ok' else 'imap_verifica_incompleta' end where singleton;
  return jsonb_build_object('status', 'done');
end
$$;

-- Il vecchio percorso conserva tutti i controlli. Prima e dopo la sua RPC consulta la ricevuta
-- comune, sotto lo stesso lock della casella, così nessun ordine dei due lettori duplica l'attività.
alter function public.record_partner_followup_reply(uuid, uuid, bigint, jsonb)
  rename to record_partner_followup_reply_before_ionos;
revoke all on function public.record_partner_followup_reply_before_ionos(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated, service_role;
create function public.record_partner_followup_reply(
  p_lease_token uuid, p_conversation_id uuid, p_expected_version bigint, p_reply jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_partner uuid; v_receipt private.partner_ionos_inbox_receipts%rowtype; v_result jsonb;
begin
  perform private.partner_assistant_service_required();
  if not private.partner_assistant_mail_guard(p_lease_token, true) then
    return jsonb_build_object('status', 'stale');
  end if;
  v_hash := encode(sha256(convert_to(p_reply ->> 'message_id', 'UTF8')), 'hex');
  select * into v_receipt from private.partner_ionos_inbox_receipts where message_id_sha256 = v_hash;
  if found and v_receipt.disposition = 'registered' then
    select partner_id into v_partner from public.partner_assistant_followups where id = p_conversation_id;
    return jsonb_build_object('status', case when v_receipt.disposition = 'registered'
      and v_receipt.partner_id = v_partner then 'already_recorded' else 'stale' end);
  end if;
  v_result := public.record_partner_followup_reply_before_ionos(
    p_lease_token, p_conversation_id, p_expected_version, p_reply);
  if v_result ->> 'status' in ('registered', 'already_recorded') then
    insert into private.partner_ionos_inbox_receipts
      (message_id_sha256, partner_id, activity_id, disposition, received_at, from_address_sha256)
      select r.message_id_sha256, a.partner_id, r.activity_id, 'registered', r.received_at,
        private.partner_assistant_address_sha256(private.partner_assistant_address(p_reply ->> 'from_address'))
      from private.partner_followup_reply_receipts r join public.partner_activities a on a.id = r.activity_id
      where r.message_id_sha256 = v_hash on conflict (message_id_sha256) do update
        set partner_id = excluded.partner_id, activity_id = excluded.activity_id,
          disposition = excluded.disposition, received_at = excluded.received_at,
          from_address_sha256 = excluded.from_address_sha256;
    if v_receipt.task_id is not null then
      update public.tasks set status = 'done' where id = v_receipt.task_id and status <> 'done';
    end if;
  end if;
  return v_result;
end
$$;

revoke all on function private.partner_ionos_words(text), private.partner_ionos_subject_alias(text),
  private.partner_ionos_candidates() from public, anon, authenticated, service_role;
revoke all on function public.claim_partner_ionos_inbox(uuid, integer),
  public.record_partner_ionos_inbox(uuid, jsonb), public.release_partner_ionos_inbox(uuid, text),
  public.record_partner_followup_reply(uuid, uuid, bigint, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.claim_partner_ionos_inbox(uuid, integer),
  public.record_partner_ionos_inbox(uuid, jsonb), public.release_partner_ionos_inbox(uuid, text),
  public.record_partner_followup_reply(uuid, uuid, bigint, jsonb) to service_role;

commit;
