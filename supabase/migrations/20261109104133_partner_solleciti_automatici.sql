-- Solleciti Partner, con controlli della posta obbligatori e quote condivise.
-- La modalità iniziale osserva le conversazioni. Nessuna impostazione esistente cambia.
begin;

create table private.partner_followup_config (
  singleton boolean primary key default true check(singleton),
  mode text not null default 'osserva' check(mode in ('spento','osserva','invio')),
  version bigint not null default 1,
  updated_by uuid references public.profiles(user_id),
  updated_at timestamptz not null default now()
);
insert into private.partner_followup_config default values;

create table public.partner_assistant_followups (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null unique references public.partners(id) on delete cascade,
  first_message_id uuid not null unique references public.partner_assistant_messages(id) on delete cascade,
  contact_id uuid not null references public.partner_contacts(id) on delete cascade,
  choice_note_id uuid references public.partner_assistant_notes(id) on delete set null,
  address_sha256 text not null check(address_sha256 ~ '^[0-9a-f]{64}$'),
  flow_template boolean not null,
  followups_sent integer not null default 0 check(followups_sent between 0 and 4),
  last_sent_at timestamptz not null,
  next_due_on date,
  deferred_until date,
  status text not null default 'active' check(status in ('active','held','replied','complete')),
  reason text check(reason ~ '^[a-z][a-z0-9_]{0,79}$'),
  version bigint not null default 1,
  draft_id uuid references public.partner_assistant_drafts(id) on delete set null,
  last_checked_at timestamptz,
  next_check_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table private.partner_followup_drafts (
  draft_id uuid primary key references public.partner_assistant_drafts(id) on delete cascade,
  conversation_id uuid not null references public.partner_assistant_followups(id) on delete cascade,
  number integer not null check(number between 1 and 4),
  contact_version bigint not null,
  address_sha256 text not null check(address_sha256 ~ '^[0-9a-f]{64}$'),
  review_id uuid not null references public.partner_assistant_notes(id) on delete cascade,
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);
create index partner_followup_drafts_conversation on private.partner_followup_drafts(conversation_id,number);
create table private.partner_followup_proofs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.partner_assistant_followups(id) on delete cascade,
  conversation_version bigint not null,
  draft_id uuid references public.partner_assistant_drafts(id) on delete cascade,
  prepared_message_id uuid references public.partner_assistant_messages(id) on delete cascade,
  lease_token uuid not null,
  proof_sha256 text not null check(proof_sha256 ~ '^[0-9a-f]{64}$'),
  checked_at timestamptz not null,
  folder_count integer not null check(folder_count >= 3),
  message_count integer not null check(message_count >= 0),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index partner_followup_proofs_conversation on private.partner_followup_proofs(conversation_id);
create table private.partner_followup_leases (
  lease_token uuid primary key,
  conversation_id uuid not null references public.partner_assistant_followups(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.partner_followup_leases enable row level security;
revoke all on private.partner_followup_leases from public,anon,authenticated,service_role;

alter table public.partner_assistant_followups enable row level security;
alter table private.partner_followup_config enable row level security;
alter table private.partner_followup_drafts enable row level security;
alter table private.partner_followup_proofs enable row level security;
revoke all on public.partner_assistant_followups,private.partner_followup_config,
  private.partner_followup_drafts,private.partner_followup_proofs from public,anon,authenticated,service_role;

alter table public.partner_assistant_messages drop constraint partner_assistant_messages_kind_check;
alter table public.partner_assistant_messages add constraint partner_assistant_messages_kind_check
  check(kind in ('primo','sollecito'));
alter table public.partner_assistant_messages
  add column followup_number integer,
  add column flow_template boolean,
  add constraint partner_assistant_messages_followup_check check(
    (kind='primo' and followup_number is null and flow_template is null)
    or (kind='sollecito' and mode='invio' and followup_number between 1 and 4
      and followup_number is not null and flow_template is not null));
create unique index partner_assistant_messages_one_followup
  on public.partner_assistant_messages(partner_id,followup_number)
  where mode='invio' and kind='sollecito' and send_status in ('pronto','in_invio','inviato','incerto');

-- I nuovi attributi non sono tra i campi modificabili della guardia già presente.
create or replace function private.partner_assistant_flow_sent(p_day date,p_template boolean) returns integer
language sql stable security invoker set search_path='' as $$
  select count(*)::integer from public.partner_assistant_messages m
  left join public.partner_assistant_drafts d on d.id=m.draft_id
  where m.mode='invio' and m.send_day=p_day and m.send_status in ('in_invio','inviato','incerto')
    and coalesce(m.flow_template,case when d.id is not null
      then private.partner_assistant_is_template(d.research_note_id)
      else private.partner_assistant_uses_template(m.partner_id) end)=p_template
$$;

create table private.partner_followup_suppressions (
  address_sha256 text primary key check(address_sha256 ~ '^[0-9a-f]{64}$'),
  partner_id uuid references public.partners(id) on delete set null,
  reason text not null check(reason in ('possible_response','manual','ambiguous')),
  created_at timestamptz not null default now()
);
alter table private.partner_followup_suppressions enable row level security;
revoke all on private.partner_followup_suppressions from public,anon,authenticated,service_role;

create function private.partner_followup_address_held(p_partner_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.partner_contacts k join private.partner_followup_suppressions s
    on s.address_sha256=private.partner_assistant_address_sha256(private.partner_assistant_address(k.link_value))
    where k.partner_id=p_partner_id and k.kind='email' and k.active)
$$;

create or replace function private.partner_assistant_eligible(p_partner_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.partners p
    where p.id = p_partner_id and p.stage = 'da_contattare' and p.owner_id is null and p.next_action is null
      and p.research_removed_at is null
      and not private.partner_blocked(p.id)
      and not private.partner_followup_address_held(p.id)
      and not exists (select 1 from public.partner_assistant_contacts s where s.partner_id = p.id and not s.active)
      and exists (select 1 from public.partner_contacts c
        where c.partner_id = p.id and c.kind = 'email' and c.active and c.link_value is not null)
      and not exists (select 1 from public.partner_activities a
        where a.partner_id = p.id and a.origin in ('team', 'file')
          and a.kind in ('inviato', 'risposta', 'chiamata', 'incontro', 'nota', 'stato', 'responsabile',
            'prossima_azione', 'approccio')))
$$;

create function private.partner_followup_reason(p_id uuid,p_draft boolean default false) returns text
language sql stable security invoker set search_path='' as $$
  select case
    when f.id is null then 'conversazione_assente'
    when f.status<>'active' then coalesce(f.reason,'conversazione_ferma')
    when m.id is null or m.kind<>'primo' or m.mode<>'invio' or m.send_status<>'inviato'
      or m.erased_at is not null or m.draft_id is null then 'primo_non_valido'
    when p.stage<>'contattato' or p.owner_id is not null or p.next_action is not null then 'attivita_team'
    when p.research_removed_at is not null or private.partner_blocked(p.id) then 'non_contattare'
    when private.partner_followup_address_held(p.id) then 'risposta_possibile'
    when exists(select 1 from public.partner_assistant_contacts t where t.partner_id=p.id and not t.active)
      then 'assistente_fermo'
    when k.id is null or not k.active or k.kind<>'email' or private.partner_assistant_address(k.link_value) is null
      or f.contact_id is distinct from (select e.contact_id from private.partner_assistant_email(p.id) e)
      or f.address_sha256 is distinct from private.partner_assistant_address_sha256(private.partner_assistant_address(k.link_value))
      then 'recapito_cambiato'
    when exists(select 1 from public.partner_activities a where a.partner_id=p.id
      and a.kind='risposta' and a.occurred_at>=m.sent_at) then 'risposta_registrata'
    when exists(select 1 from public.partner_activities a where a.partner_id=p.id
      and a.origin in ('team','file') and a.occurred_at>=m.sent_at) then 'attivita_team'
    when exists(select 1 from public.partner_assistant_messages x where x.partner_id=p.id and x.mode='invio'
      and x.send_status='incerto') then 'invio_incerto'
    when exists(select 1 from private.partner_email_edit_holds h where h.partner_id=p.id and h.closed_at is null)
      then 'modifica_in_corso'
    when f.followups_sent>=4 then 'solleciti_finiti'
    when (select count(distinct private.partner_assistant_address(e.link_value)) from public.partner_contacts e
      where e.partner_id=f.partner_id and e.kind='email' and e.active and (e.verified or e.id=f.contact_id)
        and private.partner_assistant_address(e.link_value) is not null)>32 then 'recapiti_ambigui'
    when not exists(select 1 from public.partner_assistant_notes sc where sc.id=f.choice_note_id
      and sc.kind='scelta' and private.partner_assistant_valid_timezone(sc.content->>'timezone')
      and sc.content->>'register' in ('voi','lei','you','sie','vous','usted')) then 'contesto_assente'
    when p_draft and (d.id is null or fd.draft_id is null or fd.invalidated_at is not null or n.id is null or r.id is null or fd.number<>f.followups_sent+1 or fd.conversation_id<>f.id
      or d.partner_id<>f.partner_id or d.contact_id<>f.contact_id or d.partner_version<>p.version
      or fd.contact_version<>k.version or fd.address_sha256<>f.address_sha256
      or d.rules_version<>(select max(version) from public.partner_assistant_rules)
      or n.created_at<=private.partner_assistant_now()-interval '21 days'
      or d.sha256<>encode(sha256(convert_to(d.subject||E'\n\n'||d.body||E'\n\n'||d.signature,'UTF8')),'hex')
      or r.kind<>'controllo' or r.content->'approved' is distinct from 'true'::jsonb
      or r.content->>'sha256' is distinct from d.sha256) then 'bozza_da_preparare'
  end from (select p_id id) x
    left join public.partner_assistant_followups f on f.id=x.id
    left join public.partners p on p.id=f.partner_id
    left join public.partner_assistant_messages m on m.id=f.first_message_id
    left join public.partner_contacts k on k.id=f.contact_id
    left join public.partner_assistant_drafts d on d.id=f.draft_id
    left join private.partner_followup_drafts fd on fd.draft_id=d.id
    left join public.partner_assistant_notes n on n.id=d.research_note_id
    left join public.partner_assistant_notes r on r.id=fd.review_id
$$;

create function private.partner_followup_send_reason(p_id uuid) returns text
language plpgsql stable security invoker set search_path='' as $$
declare f public.partner_assistant_followups%rowtype; s private.partner_assistant_mail_state%rowtype;
  c private.partner_assistant_config%rowtype; v_now timestamptz:=private.partner_assistant_now();
  v_today date:=private.partner_assistant_rome_day(v_now); v_reason text; v_tz text; v_country text;
begin
  v_reason:=private.partner_followup_reason(p_id,true);
  if v_reason is not null then return v_reason; end if;
  select * into f from public.partner_assistant_followups where id=p_id;
  select * into s from private.partner_assistant_mail_state where singleton;
  select * into c from private.partner_assistant_config where singleton;
  select n.content->>'timezone',p.country into v_tz,v_country from public.partners p
    left join public.partner_assistant_notes n on n.id=f.choice_note_id where p.id=f.partner_id;
  return case
    when (select mode from private.partner_followup_config where singleton)<>'invio' or c.mode<>'invio' then 'osserva'
    when f.deferred_until>v_today then 'fuori_ufficio'
    when f.next_due_on>v_today or private.partner_assistant_rome_day(f.last_sent_at)+7>v_today then 'non_scaduto'
    when s.stop_reason is not null or s.day_stopped_on=v_today then 'fermo'
    when s.backoff_until>v_now or s.next_send_after>v_now then 'intervallo'
    when private.partner_assistant_first_sent(v_today)>=private.partner_assistant_first_limit(v_today)
      or private.partner_assistant_flow_sent(v_today,f.flow_template)>=private.partner_assistant_flow_share(v_today,f.flow_template) then 'limite'
    when not private.partner_assistant_window_open(v_tz,v_country,v_now,interval '90 seconds') then 'fuori_finestra'
  end;
end
$$;

create function private.partner_followup_close_tasks(p_partner uuid) returns void
language sql security invoker set search_path='' as $$
  update public.tasks t set status='done' from public.partner_work_links l
    join public.partner_activities a on a.id=l.activity_id
  where l.partner_id=p_partner and l.kind='follow_up' and l.task_id=t.id and t.status<>'done'
    and a.origin='assistente' and a.kind='inviato'
$$;

create function private.partner_followup_suppress(p_partner_id uuid,p_address_sha256 text,p_reason text) returns void
language plpgsql security invoker set search_path='' as $$
begin
  insert into private.partner_followup_suppressions(address_sha256,partner_id,reason)
    values(p_address_sha256,p_partner_id,p_reason) on conflict(address_sha256) do nothing;
  insert into private.partner_followup_suppressions(address_sha256,partner_id,reason)
    select distinct private.partner_assistant_address_sha256(private.partner_assistant_address(k.link_value)),p_partner_id,p_reason
    from public.partner_contacts k where k.partner_id=p_partner_id and k.kind='email' and k.active
      and (k.verified or k.id=(select e.contact_id from private.partner_assistant_email(p_partner_id) e))
      and private.partner_assistant_address(k.link_value) is not null
    on conflict(address_sha256) do nothing;
end
$$;

create function private.partner_followup_hold(p_id uuid,p_reason text,p_notify boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
declare f public.partner_assistant_followups%rowtype; v_actor uuid; v_owner uuid; v_name text; v_co integer;
begin
  select * into f from public.partner_assistant_followups where id=p_id for update;
  if f.id is null then return; end if;
  if p_reason in ('attivita_team','risposta_registrata') then
    perform private.partner_followup_suppress(f.partner_id,f.address_sha256,'manual');
  end if;
  if f.status<>'active' then return; end if;
  update public.partner_assistant_followups set status='held',reason=p_reason,version=version+1,
    draft_id=null,next_check_at=private.partner_assistant_now()+interval '30 minutes',updated_at=now() where id=f.id;
  update private.partner_followup_proofs set used_at=private.partner_assistant_now() where conversation_id=f.id and used_at is null;
  update public.partner_assistant_messages set send_status='scartato',outcome=p_reason,updated_at=now()
    where partner_id=f.partner_id and kind='sollecito' and send_status='pronto';
  insert into private.partner_assistant_events(partner_id,step,outcome) values(f.partner_id,'sollecito',p_reason);
  if p_notify then
    select actor_id,handoff_to into v_actor,v_owner from private.partner_assistant_config where singleton;
    select name,co into v_name,v_co from public.partners where id=f.partner_id;
    insert into public.tasks(title,description,status,due_at,assigned_to,created_by)
      values(left('Controllare risposta · '||v_name,240),'Partner CO '||v_co||' · '||p_reason,
        'todo',private.partner_assistant_rome_day(private.partner_assistant_now())::timestamp at time zone 'Europe/Rome',v_owner,v_actor);
  end if;
end
$$;

-- Un intervento registrato dal team ferma il ciclo anche prima del prossimo giro IMAP.
-- Il trigger del Registro ha già acquisito la scheda; non acquisisce il lock della casella.
create function private.partner_followup_manual_intervention() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_first public.partner_assistant_messages%rowtype; v_id uuid;
begin
  if new.origin not in ('team','file') then return new; end if;
  select * into v_first from public.partner_assistant_messages m where m.partner_id=new.partner_id
    and m.mode='invio' and m.kind='primo' and m.send_status='inviato' and m.sent_at<=new.occurred_at
    order by m.sent_at,m.id limit 1;
  if v_first.id is null then return new; end if;
  perform private.partner_followup_suppress(new.partner_id,v_first.address_sha256,'manual');
  select id into v_id from public.partner_assistant_followups where partner_id=new.partner_id;
  if v_id is not null then perform private.partner_followup_hold(v_id,'attivita_team',false); end if;
  return new;
end
$$;
create trigger partner_followup_manual_intervention after insert on public.partner_activities
  for each row execute function private.partner_followup_manual_intervention();

create function private.refresh_partner_followups() returns void
language plpgsql security invoker set search_path='' as $$
declare x record; v_id uuid; v_reason text;
begin
  for x in select m.*,d.contact_id,d.language,coalesce(d.choice_note_id,j.choice_note_id) as choice_note,
      private.partner_assistant_is_template(d.research_note_id) as template
    from public.partner_assistant_messages m join public.partner_assistant_drafts d on d.id=m.draft_id
    join public.partners p on p.id=m.partner_id
    left join public.partner_assistant_jobs j on j.partner_id=m.partner_id
    where m.mode='invio' and m.kind='primo' and m.send_status='inviato' and m.erased_at is null
      and p.stage='contattato' and not exists(select 1 from public.partner_assistant_followups f where f.partner_id=m.partner_id)
    order by m.partner_id
  loop
    perform 1 from public.partners where id=x.partner_id for update;
    insert into public.partner_assistant_followups(partner_id,first_message_id,contact_id,choice_note_id,address_sha256,
      flow_template,last_sent_at,next_due_on)
      values(x.partner_id,x.id,x.contact_id,x.choice_note,x.address_sha256,x.template,x.sent_at,
        private.partner_assistant_rome_day(x.sent_at)+7) on conflict(partner_id) do nothing returning id into v_id;
    if v_id is not null then
      v_reason:=private.partner_followup_reason(v_id,false);
      if v_reason is not null then perform private.partner_followup_hold(v_id,v_reason,false); end if;
    end if;
  end loop;
end
$$;

create function public.claim_partner_followup(p_worker_id uuid,p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.partner_assistant_mail_state%rowtype; c private.partner_assistant_config%rowtype;
  f public.partner_assistant_followups%rowtype; m public.partner_assistant_messages%rowtype; x record;
  v_now timestamptz:=private.partner_assistant_now(); v_mode text; v_reason text; v_candidate jsonb; v_token uuid;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  perform private.partner_check(p_worker_id is not null and p_lease_seconds between 60 and 600);
  select * into s from private.partner_assistant_mail_state where singleton for update;
  select * into c from private.partner_assistant_config where singleton for share;
  select mode into v_mode from private.partner_followup_config where singleton for share;
  if c.actor_id is null or c.handoff_to is null then return jsonb_build_object('status','idle','reason','non_configurato'); end if;
  if s.lease_expires_at>clock_timestamp() then return jsonb_build_object('status','idle','reason','occupato'); end if;
  -- Prima del recupero storico del worker delle prime email, recupera soltanto i MIME dei solleciti.
  for m in select * from public.partner_assistant_messages where kind='sollecito' and send_status in ('pronto','in_invio') order by partner_id loop
    perform 1 from public.partners where id=m.partner_id for update;
    select * into f from public.partner_assistant_followups where partner_id=m.partner_id for update;
    update public.partner_assistant_messages set send_status=case when m.send_status='pronto' then 'scartato' else 'incerto' end,
      outcome='sollecito_abbandonato',sent_at=case when m.send_status='in_invio' then v_now else sent_at end,updated_at=now() where id=m.id;
    if m.send_status='in_invio' then
      perform private.partner_followup_hold(f.id,'invio_incerto',true);
      update private.partner_assistant_mail_state
        set next_send_after=v_now+make_interval(secs=>240+floor(random()*421)::integer) where singleton;
    end if;
  end loop;
  if v_mode='spento' or c.mode not in ('prepara','prova','invio') then return jsonb_build_object('status','idle','reason','spento'); end if;
  perform private.refresh_partner_followups();
  for x in select id,partner_id from public.partner_assistant_followups where status='active' order by partner_id loop
    perform 1 from public.partners where id=x.partner_id for update;
    v_reason:=private.partner_followup_reason(x.id,false);
    if v_reason is not null then perform private.partner_followup_hold(x.id,v_reason,false); end if;
  end loop;
  select * into f from public.partner_assistant_followups where status='active' and next_check_at<=v_now
    order by next_check_at,next_due_on,partner_id limit 1;
  if f.id is null then return jsonb_build_object('status','idle','reason','vuota'); end if;
  perform 1 from public.partners where id=f.partner_id for share;
  select * into f from public.partner_assistant_followups where id=f.id for update;
  select jsonb_build_object('id',f.id,'version',f.version,'partner_id',f.partner_id,'co',p.co,'name',p.name,
    'porsche_community',coalesce(n.content->'porsche_community','false'::jsonb),'flow_template',f.flow_template,'contact_id',f.contact_id,'address',private.partner_assistant_address(k.link_value),
    'addresses',coalesce((select jsonb_agg(distinct private.partner_assistant_address(e.link_value)) from public.partner_contacts e
      where e.partner_id=f.partner_id and e.kind='email' and e.active and (e.verified or e.id=f.contact_id)
        and private.partner_assistant_address(e.link_value) is not null),'[]'::jsonb),
    'message_ids',(select jsonb_agg(z.message_id order by z.created_at) from public.partner_assistant_messages z
      where z.partner_id=f.partner_id and z.mode='invio' and z.send_status in ('inviato','incerto')),
    'first_subject',original.subject,'first_sent_at',original.sent_at,'language',d.language,
    'register',n.content->>'register','timezone',n.content->>'timezone','country',p.country,
    'followups_sent',f.followups_sent,'next_due_on',f.next_due_on,
    'draft',case when private.partner_followup_reason(f.id,true) is null then
      jsonb_build_object('draft_id',b.id,'number',fd.number,'language',b.language,'subject',b.subject,
        'body',b.body,'signature',b.signature,'sha256',b.sha256,'rules_version',b.rules_version,'created_at',b.created_at) end,
    'send_allowed',private.partner_followup_send_reason(f.id) is null) into v_candidate
    from public.partners p join public.partner_contacts k on k.id=f.contact_id
    join public.partner_assistant_messages original on original.id=f.first_message_id
    join public.partner_assistant_drafts d on d.id=original.draft_id
    left join public.partner_assistant_notes n on n.id=f.choice_note_id
    left join public.partner_assistant_drafts b on b.id=f.draft_id
    left join private.partner_followup_drafts fd on fd.draft_id=b.id where p.id=f.partner_id;
  update private.partner_assistant_mail_state set lease_token=gen_random_uuid(),
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),candidate_draft_id=f.draft_id,
    last_tick_at=clock_timestamp() where singleton returning lease_token into v_token;
  insert into private.partner_followup_leases(lease_token,conversation_id) values(v_token,f.id);
  update public.partner_assistant_followups set next_check_at=v_now+interval '30 minutes' where id=f.id;
  return jsonb_build_object('status','claimed','lease_token',v_token,'mode',v_mode,'candidate',v_candidate);
end
$$;

create function public.record_partner_followup_check(p_lease_token uuid,p_conversation_id uuid,p_expected_version bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.partner_assistant_followups%rowtype; v_now timestamptz:=private.partner_assistant_now();
  v_result text; v_reason text; v_checked timestamptz; v_hash text; v_folders integer; v_count integer; v_id uuid; v_prepared uuid; v_related record; v_resume date;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  if not private.partner_assistant_mail_guard(p_lease_token,true) then return jsonb_build_object('status','lease_persa'); end if;
  perform 1 from private.partner_assistant_config where singleton for share;
  perform private.partner_keys(p_payload,array['result','reason','checked_at','proof_sha256','folder_count','message_count'],array['result','reason','checked_at','proof_sha256','folder_count','message_count','resume_on']);
  v_result:=private.partner_enum(p_payload,'result',array['clear','found','uncertain','deferred']);
  perform private.partner_check((v_result='deferred')=(p_payload ? 'resume_on'));
  if v_result='deferred' then
    v_resume:=private.partner_date(p_payload,'resume_on');
    perform private.partner_check(v_resume>private.partner_assistant_rome_day(v_now) and v_resume<=private.partner_assistant_rome_day(v_now)+366);
  end if;
  v_reason:=private.partner_text(p_payload,'reason',80);
  v_checked:=(p_payload->>'checked_at')::timestamptz;
  v_hash:=private.partner_text(p_payload,'proof_sha256',64);
  v_folders:=private.partner_bigint(p_payload,'folder_count',0,1000);
  v_count:=private.partner_bigint(p_payload,'message_count',0,1000000);
  perform private.partner_check(v_result is not null and v_checked is not null and v_hash ~ '^[0-9a-f]{64}$'
    and v_folders is not null and v_count is not null and (v_reason is null or v_reason ~ '^[a-z][a-z0-9_]{0,79}$'));
  select * into f from public.partner_assistant_followups where id=p_conversation_id;
  perform 1 from public.partners where id=f.partner_id for update;
  select * into f from public.partner_assistant_followups where id=p_conversation_id for update;
  if f.id is null or f.version is distinct from p_expected_version or f.status<>'active'
    or not exists(select 1 from private.partner_followup_leases l where l.lease_token=p_lease_token and l.conversation_id=f.id) then return jsonb_build_object('status','lease_persa'); end if;
  update private.partner_followup_proofs set used_at=v_now where conversation_id=f.id and used_at is null;
  if v_result='found' then
    update public.partner_assistant_followups set last_checked_at=v_now where id=f.id;
    perform private.partner_followup_suppress(f.partner_id,f.address_sha256,'possible_response');
    -- Le impronte restano anche dopo la cancellazione del recapito. Nessuna deduzione sul dominio.
    for v_related in select x.id,x.partner_id from public.partner_assistant_followups x
      where x.status='active' and (x.id=f.id or private.partner_followup_address_held(x.partner_id)) order by x.partner_id
    loop
      perform 1 from public.partners where id=v_related.partner_id for update;
      perform private.partner_followup_hold(v_related.id,coalesce(v_reason,'risposta_trovata'),true);
    end loop;
    return jsonb_build_object('status','blocked','reason',coalesce(v_reason,'risposta_trovata'));
  end if;
  if v_result='uncertain' or v_checked<v_now-interval '60 seconds' or v_checked>v_now+interval '5 seconds' or v_folders<3 then
    if v_reason='bozza_non_valida' then
      update private.partner_followup_drafts set invalidated_at=v_now where draft_id=f.draft_id;
      update public.partner_assistant_messages set send_status='scartato',outcome='bozza_non_valida',updated_at=now()
        where partner_id=f.partner_id and kind='sollecito' and draft_id=f.draft_id and send_status='pronto';
      update public.partner_assistant_followups set draft_id=null,version=version+1,updated_at=now() where id=f.id;
    end if;
    update public.partner_assistant_followups set last_checked_at=v_now,reason=coalesce(v_reason,'controllo_incerto'),next_check_at=v_now+interval '15 minutes' where id=f.id;
    return jsonb_build_object('status','retry','reason',coalesce(v_reason,'controllo_incerto'));
  end if;
  v_reason:=private.partner_followup_reason(f.id,false);
  if v_reason is not null then
    perform private.partner_followup_hold(f.id,v_reason,false);
    return jsonb_build_object('status','blocked','reason',v_reason);
  end if;
  if v_result='deferred' then
    update public.partner_assistant_messages set send_status='scartato',outcome='fuori_ufficio',updated_at=now()
      where partner_id=f.partner_id and kind='sollecito' and send_status='pronto';
    if f.deferred_until is distinct from v_resume then
      update private.partner_followup_drafts set invalidated_at=v_now where draft_id=f.draft_id;
      update public.partner_assistant_followups set deferred_until=v_resume,next_due_on=greatest(next_due_on,v_resume),
        draft_id=null,version=version+1,reason='fuori_ufficio',last_checked_at=v_now,
        next_check_at=v_now+interval '30 minutes',updated_at=now() where id=f.id;
      insert into private.partner_assistant_events(partner_id,step,outcome) values(f.partner_id,'sollecito','fuori_ufficio');
    else
      update public.partner_assistant_followups set reason='fuori_ufficio',last_checked_at=v_now,
        next_check_at=v_now+interval '30 minutes' where id=f.id;
    end if;
    return jsonb_build_object('status','deferred','resume_on',v_resume);
  end if;
  select id into v_prepared from public.partner_assistant_messages where partner_id=f.partner_id
    and kind='sollecito' and draft_id=f.draft_id and send_status='pronto';
  insert into private.partner_followup_proofs(conversation_id,conversation_version,draft_id,prepared_message_id,
    lease_token,proof_sha256,checked_at,folder_count,message_count,created_at,expires_at)
    values(f.id,f.version,f.draft_id,v_prepared,p_lease_token,v_hash,v_checked,v_folders,v_count,v_now,v_now+interval '30 seconds') returning id into v_id;
  update public.partner_assistant_followups set last_checked_at=v_now,reason=null,
    deferred_until=case when deferred_until>private.partner_assistant_rome_day(v_now) then deferred_until end,
    next_check_at=v_now+interval '30 minutes' where id=f.id;
  return jsonb_build_object('status','clear','proof_id',v_id,'expires_at',v_now+interval '30 seconds');
end
$$;

create function private.save_partner_followup_draft_as_founder(p_actor_id uuid,p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.partner_assistant_followups%rowtype; p public.partners%rowtype; k public.partner_contacts%rowtype;
  m public.partner_assistant_messages%rowtype; d public.partner_assistant_drafts%rowtype;
  v_payload jsonb:=p_payload; v_replay jsonb; v_result jsonb; v_rules integer; v_number integer; v_expected bigint;
  v_subject text; v_body text; v_signature text; v_language text; v_research text; v_sources text[]; v_sha text;
  v_note uuid; v_draft uuid; v_review uuid; v_words integer; v_lines text[]; v_reason text; v_address text; v_now timestamptz:=private.partner_assistant_now();
begin
  perform 1 from public.memberships where user_id=p_actor_id and active and role='founder' for share;
  if not found then raise exception 'partner_assistant_founder_required' using errcode='42501'; end if;
  perform private.partner_payload(v_payload,array['schema_version','conversation_id','expected_version','number',
    'partner_version','contact_version','address_sha256','rules_version','language','subject','body','signature','research_text','sources'],
    array['schema_version','conversation_id','expected_version','number','partner_version','contact_version','address_sha256',
      'rules_version','language','subject','body','signature','research_text','sources']);
  v_replay:=private.partner_assistant_begin(p_operation_id,'save_partner_followup_draft',p_actor_id,v_payload);
  if v_replay is not null then return v_replay; end if;
  perform 1 from private.partner_assistant_mail_state where singleton for update;
  perform 1 from private.partner_assistant_config where singleton for share;
  perform pg_advisory_xact_lock(hashtextextended('luckylap.partner_assistant.rules',0));
  select * into f from public.partner_assistant_followups where id=private.partner_uuid(v_payload,'conversation_id');
  select * into p from public.partners where id=f.partner_id for update;
  select * into f from public.partner_assistant_followups where id=f.id for update;
  select * into k from public.partner_contacts where id=f.contact_id for share;
  select * into m from public.partner_assistant_messages where id=f.first_message_id;
  select * into d from public.partner_assistant_drafts where id=m.draft_id;
  select max(version) into v_rules from public.partner_assistant_rules;
  v_expected:=private.partner_bigint(v_payload,'expected_version',1,9007199254740991);
  v_number:=private.partner_bigint(v_payload,'number',1,4);
  v_language:=private.partner_enum(v_payload,'language',array['it','en','de','fr','es']);
  v_subject:=private.partner_text(v_payload,'subject',300);
  v_body:=private.partner_text(v_payload,'body',8000);
  v_signature:=private.partner_text(v_payload,'signature',300);
  v_research:=private.partner_text(v_payload,'research_text',60000);
  perform private.partner_check(jsonb_typeof(v_payload->'sources')='array' and jsonb_array_length(v_payload->'sources') between 1 and 40);
  select array_agg(value) into v_sources from jsonb_array_elements_text(v_payload->'sources');
  perform private.partner_check(not exists(select 1 from unnest(v_sources) s where s is null or s !~ '^https?://[^[:space:]]+$' or char_length(s)>2000));
  v_reason:=private.partner_followup_reason(f.id,false);
  if f.id is null or f.version is distinct from v_expected or v_reason is not null
    or v_number is distinct from f.followups_sent+1
    or p.version is distinct from private.partner_bigint(v_payload,'partner_version',1,9007199254740991)
    or k.version is distinct from private.partner_bigint(v_payload,'contact_version',1,9007199254740991)
    or v_rules is distinct from private.partner_bigint(v_payload,'rules_version',1,2147483647)
    or f.address_sha256 is distinct from v_payload->>'address_sha256' then
      raise exception 'partner_changed' using errcode='40001'; end if;
  v_lines:=string_to_array(v_body,E'\n');
  select count(*) into v_words from regexp_split_to_table(
    array_to_string(v_lines[2:greatest(cardinality(v_lines)-1,1)],' '),'[[:space:]]+') w where w ~ '[[:alnum:]]';
  perform private.partner_check(v_language=d.language and v_subject='Re: '||btrim(regexp_replace(btrim(m.subject),'^(re\s*:\s*)+','','i'))
    and v_subject !~ E'[\r\n\t]' and v_body ~ '\S' and v_words between 40 and 90
    and v_signature ~ '\S' and cardinality(string_to_array(v_signature,E'\n'))=4 and v_research ~ '\S'
    and v_body !~ '[!¡]' and v_body !~* '(\{\{|\[inser|placeholder|lorem ipsum|conto vendita|consignment)'
    and char_length(v_body)-char_length(replace(v_body,'?',''))<=1);
  if exists(select 1 from public.partner_assistant_messages x where x.partner_id=f.partner_id
      and x.kind='sollecito' and x.send_status in ('pronto','in_invio','incerto')) then
    raise exception 'partner_email_not_editable' using errcode='55000'; end if;
  v_sha:=encode(sha256(convert_to(v_subject||E'\n\n'||v_body||E'\n\n'||v_signature,'UTF8')),'hex');
  insert into public.partner_assistant_notes(partner_id,kind,content,sources,rules_version,model,operation_id,created_by,created_at)
    values(f.partner_id,'ricerca',jsonb_build_object('text',v_research,'prepared_by','codex','followup_number',v_number),
      v_sources,v_rules,null,md5(p_operation_id::text||':ricerca')::uuid,p_actor_id,v_now) returning id into v_note;
  insert into public.partner_assistant_drafts(partner_id,contact_id,partner_version,language,subject,body,signature,sha256,
    rules_version,research_note_id,operation_id,created_by,choice_note_id,created_at)
    values(f.partner_id,f.contact_id,p.version,v_language,v_subject,v_body,v_signature,v_sha,v_rules,v_note,p_operation_id,p_actor_id,f.choice_note_id,v_now)
    returning id into v_draft;
  insert into public.partner_assistant_notes(partner_id,kind,content,rules_version,model,operation_id,created_by,created_at)
    values(f.partner_id,'controllo',jsonb_build_object('approved',true,'problems','[]'::jsonb,'sha256',v_sha,
      'approval_source','founder_edit','prepared_by','codex','followup_number',v_number,'choice_note_id',f.choice_note_id,
      'contact_version',k.version,'address_sha256',f.address_sha256),v_rules,null,md5(p_operation_id::text||':controllo')::uuid,p_actor_id,v_now)
    returning id into v_review;
  insert into private.partner_followup_drafts(draft_id,conversation_id,number,contact_version,address_sha256,review_id)
    values(v_draft,f.id,v_number,k.version,f.address_sha256,v_review);
  update public.partner_assistant_followups set draft_id=v_draft,version=version+1,next_check_at=private.partner_assistant_now(),updated_at=now()
    where id=f.id returning * into f;
  update private.partner_followup_proofs set used_at=private.partner_assistant_now() where conversation_id=f.id and used_at is null;
  insert into private.partner_assistant_events(partner_id,step,outcome) values(f.partner_id,'sollecito','bozza_sollecito_salvata');
  v_result:=jsonb_build_object('id',v_draft,'version',f.version,'number',v_number,'replayed',false);
  return private.partner_assistant_finish(p_operation_id,'save_partner_followup_draft',p_actor_id,v_payload,v_result);
end
$$;

create function public.save_partner_followup_draft(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.partner_actor();
begin
  if not private.is_founder() then raise exception 'partner_assistant_founder_required' using errcode='42501'; end if;
  return private.save_partner_followup_draft_as_founder(v_actor,p_operation_id,p_payload);
end
$$;

create function public.prepare_partner_followup_send(p_operation_id uuid,p_lease_token uuid,p_conversation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.partner_assistant_followups%rowtype; d public.partner_assistant_drafts%rowtype;
  m public.partner_assistant_messages%rowtype; pr private.partner_followup_proofs%rowtype;
  v_actor uuid; v_reason text; v_replay jsonb; v_result jsonb; v_address text; v_raw text; v_text text; v_opt text; v_id uuid; v_message_id text;
  v_now timestamptz:=private.partner_assistant_now(); v_payload jsonb; v_headers text; v_references text;
begin
  perform private.partner_assistant_service_required(); v_actor:=private.partner_assistant_as_actor();
  perform private.partner_keys(p_payload,array['expected_version','draft_id','number','to_address','subject','text','opt_out','raw','message_id','proof_id'],
    array['expected_version','draft_id','number','to_address','subject','text','opt_out','raw','message_id','proof_id']);
  v_payload:=p_payload||jsonb_build_object('conversation_id',p_conversation_id);
  v_replay:=private.partner_assistant_begin(p_operation_id,'prepare_partner_followup_send',v_actor,v_payload);
  if v_replay is not null then return v_replay; end if;
  if not private.partner_assistant_mail_guard(p_lease_token,true) then return jsonb_build_object('status','lease_persa'); end if;
  perform 1 from private.partner_assistant_config where singleton for share;
  perform 1 from private.partner_followup_config where singleton for share;
  select * into f from public.partner_assistant_followups where id=p_conversation_id;
  perform 1 from public.partners where id=f.partner_id for share;
  select * into f from public.partner_assistant_followups where id=p_conversation_id for update;
  select * into d from public.partner_assistant_drafts where id=f.draft_id;
  select * into m from public.partner_assistant_messages where id=f.first_message_id;
  select * into pr from private.partner_followup_proofs where id=private.partner_uuid(p_payload,'proof_id') for update;
  select private.partner_assistant_address(link_value) into v_address from public.partner_contacts where id=f.contact_id;
  v_reason:=private.partner_followup_send_reason(f.id);
  if f.id is null or not exists(select 1 from private.partner_followup_leases l where l.lease_token=p_lease_token and l.conversation_id=f.id)
    or f.version is distinct from private.partner_bigint(p_payload,'expected_version',1,9007199254740991)
    or d.id is distinct from private.partner_uuid(p_payload,'draft_id')
    or private.partner_bigint(p_payload,'number',1,4) is distinct from f.followups_sent+1 then v_reason:='contesto_cambiato'; end if;
  if pr.id is null or pr.used_at is not null or pr.expires_at<=v_now or pr.lease_token is distinct from p_lease_token
    or pr.conversation_id is distinct from f.id or pr.conversation_version is distinct from f.version
    or pr.draft_id is distinct from d.id or pr.prepared_message_id is not null then v_reason:='controllo_scaduto'; end if;
  if v_reason is not null then return jsonb_build_object('status','stop','reason',v_reason); end if;
  v_raw:=private.partner_text(p_payload,'raw',65536); v_text:=private.partner_text(p_payload,'text',20000);
  v_opt:=private.partner_text(p_payload,'opt_out',240); v_message_id:=private.partner_text(p_payload,'message_id',200);
  v_headers:=E'\r\n'||regexp_replace(split_part(v_raw,E'\r\n\r\n',1),E'\r\n[ \t]+',' ','g')||E'\r\n';
  select btrim(substr(h,strpos(h,':')+1)) into v_references from regexp_split_to_table(v_headers,E'\r\n') h
    where lower(split_part(h,':',1))='references' limit 1;
  perform private.partner_check((select count(*)=1 from regexp_split_to_table(v_headers,E'\r\n') h where lower(split_part(h,':',1))='to')
    and not exists(select 1 from regexp_split_to_table(v_headers,E'\r\n') h where lower(split_part(h,':',1)) in ('cc','bcc'))
    and v_address is not null and v_address=p_payload->>'to_address' and d.subject=p_payload->>'subject'
    and v_opt ~ '^[^\r\n<>@0-9]{20,240}$' and v_opt !~* 'http'
    and v_text=d.body||E'\n\n'||d.signature||E'\n\n'||v_opt
    and v_message_id ~ '^<[0-9a-f-]{36}@[a-z0-9-]+(\.[a-z0-9-]+)+>$'
    and octet_length(v_raw)=char_length(v_raw)
    and position(lower(E'\r\nMessage-ID: '||v_message_id||E'\r\n') in lower(v_headers))>0
    and position(lower(E'\r\nIn-Reply-To: '||m.message_id||E'\r\n') in lower(v_headers))>0
    and m.message_id=any(regexp_split_to_array(v_references,'[[:space:]]+'))
    and v_raw !~* '(content-disposition:[[:space:]]*attachment|content-type:[[:space:]]*multipart/)');
  if exists(select 1 from public.partner_assistant_messages z where z.partner_id=f.partner_id and z.kind='sollecito'
    and z.followup_number=f.followups_sent+1 and z.send_status in ('pronto','in_invio','inviato','incerto')) then
    return jsonb_build_object('status','stop','reason','doppione'); end if;
  insert into public.partner_assistant_messages(partner_id,draft_id,kind,mode,send_status,message_id,to_address,address_sha256,
    subject,body,raw,sha256,rules_version,lease_token,operation_id,created_by,followup_number,flow_template,created_at)
    values(f.partner_id,d.id,'sollecito','invio','pronto',v_message_id,v_address,f.address_sha256,d.subject,v_text,v_raw,
      encode(sha256(convert_to(v_raw,'UTF8')),'hex'),d.rules_version,p_lease_token,p_operation_id,v_actor,f.followups_sent+1,f.flow_template,v_now)
    returning id into v_id;
  update private.partner_followup_proofs set used_at=v_now where id=pr.id;
  v_result:=jsonb_build_object('status','pronto','message_row_id',v_id,'replayed',false);
  return private.partner_assistant_finish(p_operation_id,'prepare_partner_followup_send',v_actor,v_payload,v_result);
end
$$;

create function public.start_partner_followup_send(p_lease_token uuid,p_message_row_id uuid,p_proof_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.partner_assistant_followups%rowtype; m public.partner_assistant_messages%rowtype;
  pr private.partner_followup_proofs%rowtype; v_reason text; v_now timestamptz:=private.partner_assistant_now();
begin
  perform private.partner_assistant_service_required(); perform private.partner_assistant_as_actor();
  if not private.partner_assistant_mail_guard(p_lease_token,true) then return jsonb_build_object('status','lease_persa'); end if;
  perform 1 from private.partner_assistant_config where singleton for share;
  perform 1 from private.partner_followup_config where singleton for share;
  select * into m from public.partner_assistant_messages where id=p_message_row_id;
  perform 1 from public.partners where id=m.partner_id for share;
  select * into f from public.partner_assistant_followups where partner_id=m.partner_id for update;
  select * into m from public.partner_assistant_messages where id=p_message_row_id for update;
  select * into pr from private.partner_followup_proofs where id=p_proof_id for update;
  if m.id is null or m.kind<>'sollecito' or m.mode<>'invio' or m.send_status<>'pronto'
    or m.lease_token is distinct from p_lease_token then return jsonb_build_object('status','lease_persa'); end if;
  v_reason:=private.partner_followup_send_reason(f.id);
  if not exists(select 1 from private.partner_followup_leases l where l.lease_token=p_lease_token and l.conversation_id=f.id)
    or m.draft_id is distinct from f.draft_id or m.followup_number is distinct from f.followups_sent+1 then v_reason:='contesto_cambiato'; end if;
  if pr.id is null or pr.used_at is not null or pr.expires_at<=v_now or pr.lease_token is distinct from p_lease_token
    or pr.conversation_id is distinct from f.id or pr.conversation_version is distinct from f.version
    or pr.draft_id is distinct from m.draft_id or pr.prepared_message_id is distinct from m.id
    or pr.created_at<m.created_at or pr.checked_at<m.created_at then v_reason:='controllo_scaduto'; end if;
  if v_reason is not null then
    update public.partner_assistant_messages set send_status='scartato',outcome=v_reason,updated_at=now() where id=m.id;
    return jsonb_build_object('status','stop','reason',v_reason);
  end if;
  update private.partner_followup_proofs set used_at=v_now where id=pr.id;
  update public.partner_assistant_messages set send_status='in_invio',send_day=private.partner_assistant_rome_day(v_now),updated_at=now() where id=m.id;
  return jsonb_build_object('status','in_invio');
end
$$;

create function public.finish_partner_followup_send(p_lease_token uuid,p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.partner_assistant_followups%rowtype; m public.partner_assistant_messages%rowtype;
  v_actor uuid; v_replay jsonb; v_result jsonb; v_outcome text; v_code integer; v_enhanced text; v_spam boolean; v_reason text;
  v_now timestamptz:=private.partner_assistant_now(); v_number integer; v_first_day date;
begin
  perform private.partner_assistant_service_required(); v_actor:=private.partner_assistant_as_actor();
  perform private.partner_keys(p_payload,array['message_row_id','outcome','smtp_code','enhanced_code','spam','reason'],
    array['message_row_id','outcome','smtp_code','enhanced_code','spam','reason']);
  v_outcome:=private.partner_enum(p_payload,'outcome',array['inviato','incerto','respinto','scartato']);
  v_code:=private.partner_bigint(p_payload,'smtp_code',200,599); v_enhanced:=private.partner_text(p_payload,'enhanced_code',20);
  v_spam:=private.partner_bool(p_payload,'spam'); v_reason:=private.partner_text(p_payload,'reason',80);
  perform private.partner_check(v_outcome is not null and (v_reason is null or v_reason ~ '^[a-z][a-z0-9_]{0,79}$')
    and (v_enhanced is null or v_enhanced ~ '^[245]\.[0-9]{1,3}\.[0-9]{1,3}$')
    and (v_outcome<>'inviato' or v_code=250));
  v_replay:=private.partner_assistant_begin(p_operation_id,'finish_partner_followup_send',v_actor,p_payload);
  if v_replay is not null then return v_replay; end if;
  if not private.partner_assistant_mail_guard(p_lease_token,false) then return jsonb_build_object('status','lease_persa'); end if;
  perform 1 from private.partner_assistant_config where singleton for share;
  select * into m from public.partner_assistant_messages where id=private.partner_uuid(p_payload,'message_row_id');
  perform 1 from public.partners where id=m.partner_id for update;
  select * into f from public.partner_assistant_followups where partner_id=m.partner_id for update;
  select * into m from public.partner_assistant_messages where id=m.id for update;
  if m.id is null or m.kind<>'sollecito' or m.lease_token is distinct from p_lease_token
    or (m.send_status<>'in_invio' and not(v_outcome='scartato' and m.send_status in ('pronto','scartato'))) then
      return jsonb_build_object('status','lease_persa'); end if;
  if m.send_status<>'scartato' then
    update public.partner_assistant_messages set send_status=v_outcome,smtp_code=v_code,enhanced_code=v_enhanced,
      outcome=v_reason,sent_at=case when v_outcome in ('inviato','incerto') then v_now end,updated_at=now() where id=m.id;
  end if;
  if v_outcome in ('inviato','incerto','respinto') then
    update private.partner_assistant_mail_state set next_send_after=v_now+make_interval(secs=>240+floor(random()*421)::integer) where singleton;
  end if;
  if v_outcome='inviato' then
    if f.followups_sent+1<>m.followup_number then raise exception 'partner_changed' using errcode='40001'; end if;
    v_number:=m.followup_number;
    select private.partner_assistant_rome_day(sent_at) into v_first_day from public.partner_assistant_messages where id=f.first_message_id;
    update public.partner_assistant_followups set followups_sent=v_number,last_sent_at=v_now,draft_id=null,version=version+1,
      status=case when v_number=4 then 'complete' else status end,
      reason=case when v_number=4 then 'solleciti_finiti' else reason end,
      next_due_on=case when v_number<4 then greatest(v_first_day+(array[7,17,45,90])[v_number+1],private.partner_assistant_rome_day(v_now)+7) end,
      next_check_at=v_now+interval '30 minutes',updated_at=now() where id=f.id;
    perform private.partner_log(p_operation_id,f.partner_id,'inviato',v_actor,p_channel=>'email',p_message_kind=>'sollecito',p_body=>'',p_origin=>'assistente');
    perform private.partner_followup_close_tasks(f.partner_id);
  elsif v_outcome in ('incerto','respinto') then
    perform private.partner_followup_hold(f.id,case when v_outcome='incerto' then 'invio_incerto' else 'invio_rifiutato' end,true);
    if v_outcome='respinto' then perform private.partner_assistant_count_failure(case when v_enhanced like '5.7.%' or v_spam then 'spam' else 'definitivo' end); end if;
  elsif v_reason in ('smtp_temporaneo','smtp_non_partito') then
    perform private.partner_assistant_count_failure('temporaneo');
  elsif v_reason='smtp_bloccato' then perform private.partner_assistant_count_failure('spam');
  end if;
  insert into private.partner_assistant_events(partner_id,step,outcome) values(f.partner_id,'sollecito','sollecito_'||v_outcome);
  v_result:=jsonb_build_object('status','done','send_status',v_outcome,'replayed',false);
  return private.partner_assistant_finish(p_operation_id,'finish_partner_followup_send',v_actor,p_payload,v_result);
end
$$;

create function public.set_partner_followup_mode(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.partner_actor(); v_mode text; v_expected bigint; v_replay jsonb; c private.partner_followup_config%rowtype; v_result jsonb;
begin
  if not private.is_founder() then raise exception 'partner_assistant_founder_required' using errcode='42501'; end if;
  perform private.partner_payload(p_payload,array['schema_version','expected_version','mode'],array['schema_version','expected_version','mode']);
  v_mode:=private.partner_enum(p_payload,'mode',array['spento','osserva','invio']);
  v_expected:=private.partner_bigint(p_payload,'expected_version',1,9007199254740991);
  perform private.partner_check(v_mode is not null and v_expected is not null);
  v_replay:=private.partner_assistant_begin(p_operation_id,'set_partner_followup_mode',v_actor,p_payload);
  if v_replay is not null then return v_replay; end if;
  perform 1 from private.partner_assistant_mail_state where singleton for update;
  select * into c from private.partner_followup_config where singleton for update;
  if c.version<>v_expected then raise exception 'partner_changed' using errcode='40001'; end if;
  update private.partner_followup_config set mode=v_mode,version=version+1,updated_by=v_actor,updated_at=now() where singleton returning * into c;
  v_result:=jsonb_build_object('mode',c.mode,'version',c.version,'replayed',false);
  return private.partner_assistant_finish(p_operation_id,'set_partner_followup_mode',v_actor,p_payload,v_result);
end
$$;

create function public.read_partner_followup(p_partner_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_member() then raise exception 'partner_member_required' using errcode='42501'; end if;
  return (select jsonb_build_object('id',id,'status',status,'reason',reason,'version',version,
    'followups_sent',followups_sent,'next_due_on',next_due_on,'deferred_until',deferred_until,'last_checked_at',last_checked_at,'next_check_at',next_check_at,
    'mode',(select mode from private.partner_followup_config where singleton))
    from public.partner_assistant_followups where partner_id=p_partner_id);
end
$$;

create function private.read_partner_followup_preparation_queue_as_founder(p_actor_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.memberships where user_id=p_actor_id and active and role='founder') then
    raise exception 'partner_assistant_founder_required' using errcode='42501'; end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(q.item order by q.due_on,q.co) from (
    select f.next_due_on due_on,p.co,jsonb_build_object('id',f.id,'version',f.version,'partner_id',f.partner_id,'co',p.co,'name',p.name,
      'porsche_community',coalesce(n.content->'porsche_community','false'::jsonb),'flow_template',f.flow_template,'contact_id',f.contact_id,'contact_version',k.version,'address_sha256',f.address_sha256,
      'partner_version',p.version,'rules_version',(select max(version) from public.partner_assistant_rules),
      'number',f.followups_sent+1,'next_due_on',f.next_due_on,'language',d.language,'register',n.content->>'register',
      'timezone',n.content->>'timezone','country',p.country,'first_subject',m.subject,'first_sent_at',m.sent_at,'first_body',d.body,
      'previous_bodies',coalesce((select jsonb_agg(xd.body order by z.followup_number) from public.partner_assistant_messages z
        join public.partner_assistant_drafts xd on xd.id=z.draft_id where z.partner_id=f.partner_id and z.kind='sollecito' and z.send_status='inviato'),'[]'::jsonb)) item
      from public.partner_assistant_followups f join public.partners p on p.id=f.partner_id
      join public.partner_contacts k on k.id=f.contact_id join public.partner_assistant_messages m on m.id=f.first_message_id
      join public.partner_assistant_drafts d on d.id=m.draft_id left join public.partner_assistant_notes n on n.id=f.choice_note_id
      where f.status='active' and f.next_due_on<=private.partner_assistant_rome_day(private.partner_assistant_now())+1
        and private.partner_followup_reason(f.id,false) is null and private.partner_followup_reason(f.id,true) is not null
      order by f.next_due_on,p.co limit 100
    ) q),'[]'::jsonb));
end
$$;

create function public.read_partner_followup_preparation_queue() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=private.partner_actor();
begin
  return private.read_partner_followup_preparation_queue_as_founder(v_actor);
end
$$;

revoke all on function private.read_partner_followup_preparation_queue_as_founder(uuid),private.partner_followup_suppress(uuid,text,text),private.partner_followup_manual_intervention(),private.partner_followup_address_held(uuid),private.partner_followup_reason(uuid,boolean),private.partner_followup_send_reason(uuid),
  private.partner_followup_close_tasks(uuid),private.partner_followup_hold(uuid,text,boolean),private.refresh_partner_followups(),
  private.save_partner_followup_draft_as_founder(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.claim_partner_followup(uuid,integer),public.record_partner_followup_check(uuid,uuid,bigint,jsonb),
  public.prepare_partner_followup_send(uuid,uuid,uuid,jsonb),public.start_partner_followup_send(uuid,uuid,uuid),
  public.finish_partner_followup_send(uuid,uuid,jsonb),public.set_partner_followup_mode(uuid,jsonb),
  public.save_partner_followup_draft(uuid,jsonb),public.read_partner_followup(uuid),public.read_partner_followup_preparation_queue()
  from public,anon,authenticated,service_role;
grant execute on function public.claim_partner_followup(uuid,integer),public.record_partner_followup_check(uuid,uuid,bigint,jsonb),
  public.prepare_partner_followup_send(uuid,uuid,uuid,jsonb),public.start_partner_followup_send(uuid,uuid,uuid),
  public.finish_partner_followup_send(uuid,uuid,jsonb) to service_role;
grant execute on function public.set_partner_followup_mode(uuid,jsonb),public.save_partner_followup_draft(uuid,jsonb),
  public.read_partner_followup(uuid),public.read_partner_followup_preparation_queue() to authenticated;

commit;
