-- Eventi UE/UK prima; altre proposte soltanto dopo una verifica esplicita di esaurimento.
-- Non accende invii o fallback, non modifica quote totali, cron o solleciti.
begin;

create function private.partner_event_priority_from() returns date
language sql immutable security invoker set search_path='' as $$
 select date '2026-11-24'
$$;

-- Le guardie operative sono identiche al percorso ordinario; il perimetro editoriale
-- resta separato, così una coda vuota non diventa una prova di esaurimento.
create function private.partner_assistant_base_eligible(p_partner uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.partners p where p.id=p_partner
   and p.stage='da_contattare' and p.owner_id is null and p.next_action is null
   and p.research_removed_at is null and not private.partner_blocked(p.id)
   and not private.partner_followup_address_held(p.id)
   and not exists(select 1 from public.partner_assistant_contacts c where c.partner_id=p.id and not c.active)
   and exists(select 1 from public.partner_contacts k where k.partner_id=p.id and k.kind='email'
     and k.active and k.link_value is not null)
   and not exists(select 1 from public.partner_activities a where a.partner_id=p.id
     and a.origin in('team','file') and a.kind in('inviato','risposta','chiamata','incontro','nota',
       'stato','responsabile','prossima_azione','approccio')))
$$;

-- Include candidati senza bozza: non basta aver consumato le email già pronte.
-- Un tag Eventi su una sede non basta se la scelta corrente la identifica come negozio/brand.
create function private.partner_event_priority_catalog(p_day date) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'stage',p.stage,
   'owner_id',p.owner_id,'next_action',p.next_action,'next_action_on',p.next_action_on,
   'event_starts_on',p.event_starts_on,'event_ends_on',p.event_ends_on,
   'country',p.country,'sections',p.sections,'removed_at',p.research_removed_at,
   'choice_kind',n.content->>'contact_kind','choice_event_on',n.content->>'event_starts_on',
   'choice_current',coalesce(d.partner_version=p.version and d.choice_note_id=n.id,false),
   'assistant',(select jsonb_build_object('active',a.active,'version',a.version)
     from public.partner_assistant_contacts a where a.partner_id=p.id),
   'contacts',(select coalesce(jsonb_agg(jsonb_build_object('id',k.id,'version',k.version,
     'active',k.active,'erased_at',k.erased_at,'address_sha256',private.partner_assistant_address_sha256(k.link_value))
     order by k.id),'[]'::jsonb) from public.partner_contacts k where k.partner_id=p.id and k.kind='email'),
   'contactable',private.partner_assistant_base_eligible(p.id)) order by p.id),'[]'::jsonb)
 from public.partners p
 left join public.partner_assistant_jobs j on j.partner_id=p.id
 left join public.partner_assistant_drafts d on d.id=j.draft_id
 left join public.partner_assistant_notes n on n.id=j.choice_note_id
 where p.stage='da_contattare' and p.research_removed_at is null
   and private.partner_event_first_country(p.country)
   and ('eventi'=any(p.sections) or n.content->>'contact_kind'='evento' or n.content->>'request'='stand_evento')
   and (not coalesce(d.partner_version=p.version and d.choice_note_id=n.id,false)
     or n.content->>'contact_kind' is null or n.content->>'contact_kind' not in('club','brand','media','negozio')
     or n.content->>'request'='stand_evento')
   and greatest(nullif(n.content->>'event_starts_on','')::date,p.event_starts_on)>p_day
$$;

create function private.partner_event_priority_catalog_sha256(p_day date) returns text
language sql stable security invoker set search_path='' as $$
 select encode(sha256(convert_to(private.partner_event_priority_catalog(p_day)::text,'UTF8')),'hex')
$$;

create function private.partner_event_priority_pending(p_day date) returns integer
language sql stable security invoker set search_path='' as $$
 select count(*)::integer from jsonb_array_elements(private.partner_event_priority_catalog(p_day)) x
 where x->'contactable'='true'::jsonb
$$;

-- Append-only: una nuova attestazione o revoca non cancella la ricerca precedente.
create table private.partner_event_exhaustion_checks(
 id bigint generated always as identity primary key,
 operation_id uuid not null unique,
 checked_by uuid not null references auth.users(id),
 checked_on date not null,
 created_at timestamptz not null,
 valid_until timestamptz not null,
 exhausted boolean not null,
 catalog_sha256 text not null check(catalog_sha256 ~ '^[0-9a-f]{64}$'),
 reason text not null check(char_length(reason) between 30 and 4000),
 official_sources text[] not null check(cardinality(official_sources) between 1 and 12)
);
alter table private.partner_event_exhaustion_checks enable row level security;
revoke all on private.partner_event_exhaustion_checks from public,anon,authenticated,service_role;
revoke all on sequence private.partner_event_exhaustion_checks_id_seq from public,anon,authenticated,service_role;

create function private.partner_event_exhaustion_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'partner_event_exhaustion_immutable' using errcode='42501';
end
$$;
create trigger partner_event_exhaustion_immutable before update or delete on private.partner_event_exhaustion_checks
 for each row execute function private.partner_event_exhaustion_immutable();
revoke all on function private.partner_event_exhaustion_immutable() from public,anon,authenticated,service_role;

create function private.partner_event_fallback_check(p_at timestamptz) returns bigint
language sql stable security invoker set search_path='' as $$
 select c.id from private.partner_event_exhaustion_checks c
 where c.id=(select max(id) from private.partner_event_exhaustion_checks)
   and c.exhausted and c.created_at<=p_at and p_at<c.valid_until
   and private.partner_assistant_rome_day(p_at)>=private.partner_event_priority_from()
   and exists(select 1 from public.memberships m where m.user_id=c.checked_by and m.active and m.role='founder')
   and c.catalog_sha256=private.partner_event_priority_catalog_sha256(private.partner_assistant_rome_day(p_at))
   and private.partner_event_priority_pending(private.partner_assistant_rome_day(p_at))=0
$$;

create function private.record_partner_event_exhaustion_as_founder(p_actor uuid,p_operation uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=private.partner_assistant_now(); v_day date:=private.partner_assistant_rome_day(v_now);
 v_sha text; v_sources text[]; v_reason text; v_exhausted boolean; v_id bigint; v_until timestamptz; v_replay jsonb;
begin
 perform 1 from public.memberships where user_id=p_actor and active and role='founder' for share;
 if not found then raise exception 'partner_assistant_founder_required' using errcode='42501'; end if;
 perform private.partner_payload(p_payload,array['schema_version','checked_on','expected_catalog_sha256','exhausted','reason','official_sources'],
   array['schema_version','checked_on','expected_catalog_sha256','exhausted','reason','official_sources']);
 perform private.partner_check(p_payload->>'checked_on'=v_day::text
   and p_payload->>'expected_catalog_sha256' ~ '^[0-9a-f]{64}$'
   and jsonb_typeof(p_payload->'exhausted')='boolean'
   and jsonb_typeof(p_payload->'official_sources')='array');
 v_reason:=private.partner_text(p_payload,'reason',4000);
 perform private.partner_check(length(v_reason)>=30 and jsonb_array_length(p_payload->'official_sources') between 1 and 12
   and not exists(select 1 from jsonb_array_elements(p_payload->'official_sources') x
     where jsonb_typeof(x)<>'string' or length(x#>>'{}')>2000 or x#>>'{}' !~ '^https://[^[:space:]]+$'));
 select array_agg(value) into v_sources from jsonb_array_elements_text(p_payload->'official_sources');
 v_exhausted:=(p_payload->>'exhausted')::boolean;
 v_replay:=private.partner_assistant_begin(p_operation,'record_partner_event_exhaustion',p_actor,p_payload);
 if v_replay is not null then return v_replay; end if;
 perform 1 from private.partner_assistant_mail_state where singleton for update;
 v_sha:=private.partner_event_priority_catalog_sha256(v_day);
 if v_sha is distinct from p_payload->>'expected_catalog_sha256' then
   raise exception 'partner_event_catalog_changed' using errcode='40001'; end if;
 if v_exhausted and private.partner_event_priority_pending(v_day)>0 then
   raise exception 'partner_events_still_contactable' using errcode='55000'; end if;
 v_until:=v_now+interval '48 hours';
 insert into private.partner_event_exhaustion_checks(operation_id,checked_by,checked_on,created_at,valid_until,
   exhausted,catalog_sha256,reason,official_sources)
 values(p_operation,p_actor,v_day,v_now,v_until,v_exhausted,v_sha,v_reason,v_sources) returning id into v_id;
 return private.partner_assistant_finish(p_operation,'record_partner_event_exhaustion',p_actor,p_payload,
   jsonb_build_object('check_id',v_id,'exhausted',v_exhausted,'valid_until',v_until,'catalog_sha256',v_sha,'replayed',false));
end
$$;

create function public.record_partner_event_exhaustion(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.partner_actor();
begin
 if not private.is_founder() then raise exception 'partner_assistant_founder_required' using errcode='42501'; end if;
 return private.record_partner_event_exhaustion_as_founder(v_actor,p_operation_id,p_payload);
end
$$;
revoke all on function public.record_partner_event_exhaustion(uuid,jsonb) from public,anon,service_role;
grant execute on function public.record_partner_event_exhaustion(uuid,jsonb) to authenticated;
revoke all on function private.record_partner_event_exhaustion_as_founder(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

-- La prova si valuta all'istante dello slot, non soltanto quando si prepara il piano.
-- Le vecchie bozze non evento non diventano inviabili applicando la migrazione.
create function private.partner_first_policy_allows(p_draft uuid,p_at timestamptz) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare d public.partner_assistant_drafts%rowtype; n public.partner_assistant_notes%rowtype;
 v_check private.partner_event_exhaustion_checks%rowtype; v_day date:=private.partner_assistant_rome_day(p_at);
begin
 if v_day<private.partner_event_first_from() then return true; end if;
 select * into d from public.partner_assistant_drafts where id=p_draft;
 select s.* into n from public.partner_assistant_jobs j join public.partner_assistant_notes s on s.id=j.choice_note_id
   where j.partner_id=d.partner_id and j.draft_id=d.id;
 if v_day<private.partner_event_priority_from() then return private.partner_event_first_approved(p_draft); end if;
 if n.content->>'contact_kind'='evento' or n.content->>'request'='stand_evento' then
   return coalesce(private.partner_event_first_approved(p_draft)
     and coalesce(nullif(n.content->>'event_starts_on','')::date,
       (select event_starts_on from public.partners where id=d.partner_id))>v_day,false);
 end if;
 select * into v_check from private.partner_event_exhaustion_checks where id=private.partner_event_fallback_check(p_at);
 return coalesce(v_check.id is not null and d.created_at>=v_check.created_at and d.created_at<=p_at
   and d.partner_version=(select version from public.partners where id=d.partner_id)
   and ((n.content->>'contact_kind'='club' and n.content->>'request'='merch_cobranding')
     or (n.content->>'contact_kind' in('brand','media') and n.content->>'request'='collab_capsule')
     or (n.content->>'contact_kind'='negozio' and n.content->>'request'='vendita_negozio')),false);
end
$$;

create or replace function private.partner_assistant_eligible(p_partner_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select private.partner_assistant_base_eligible(p_partner_id) and exists(select 1 from public.partners p where p.id=p_partner_id
   and (private.partner_assistant_rome_day(private.partner_assistant_now())<private.partner_event_first_from()
     or ('eventi'=any(p.sections) and private.partner_event_first_country(p.country))
     or private.partner_event_fallback_check(private.partner_assistant_now()) is not null))
$$;

create or replace function private.partner_assistant_flow_share(p_day date,p_template boolean) returns integer
language sql stable security invoker set search_path='' as $$
 select case when p_day>=private.partner_event_priority_from()
   and private.partner_event_fallback_check(greatest(private.partner_assistant_now(),p_day::timestamp at time zone 'Europe/Rome')) is not null then 6
   when p_day>=private.partner_event_first_from() then case when p_template then 0 else 6 end
   when p_template then l.v/2 else l.v-l.v/2 end
 from(select private.partner_assistant_first_limit(p_day) v) l
$$;

revoke all on function private.partner_event_priority_from(),private.partner_assistant_base_eligible(uuid),
 private.partner_event_priority_catalog(date),private.partner_event_priority_catalog_sha256(date),
 private.partner_event_priority_pending(date),private.partner_event_fallback_check(timestamptz),
 private.partner_first_policy_allows(uuid,timestamptz) from public,anon,authenticated,service_role;


create or replace function private.partner_send_snapshot(p_partner uuid,p_kind text,p_draft uuid,p_number integer,p_at timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare p public.partners%rowtype; d public.partner_assistant_drafts%rowtype; k public.partner_contacts%rowtype;
 j public.partner_assistant_jobs%rowtype; f public.partner_assistant_followups%rowtype; n public.partner_assistant_notes%rowtype;
 r public.partner_assistant_notes%rowtype; v_rules integer;
begin
 select * into p from public.partners where id=p_partner;
 select * into d from public.partner_assistant_drafts where id=p_draft and partner_id=p_partner;
 select * into k from public.partner_contacts where id=d.contact_id and active and kind='email';
 select max(version) into v_rules from public.partner_assistant_rules;
 select * into r from public.partner_assistant_notes where id=d.research_note_id;
 if d.id is null or r.id is null or k.id is null or private.partner_assistant_address(k.link_value) is null
   or d.rules_version is distinct from v_rules or r.created_at<=p_at-interval '21 days'
   or d.sha256 is distinct from encode(sha256(convert_to(d.subject||E'\n\n'||d.body||E'\n\n'||d.signature,'UTF8')),'hex') then return null; end if;
 if p_kind='primo' then
   if not private.partner_first_policy_allows(p_draft,p_at) then return null; end if;
   select * into j from public.partner_assistant_jobs where partner_id=p_partner and status='pronta' and draft_id=d.id;
   select * into n from public.partner_assistant_notes where id=j.choice_note_id;
   if j.id is null or not private.partner_assistant_eligible(p.id) or private.partner_email_draft_held(d.id)
     or private.partner_email_manual_stale(d.id) or not private.partner_assistant_valid_timezone(n.content->>'timezone')
     or nullif(n.content->>'event_starts_on','')::date<=private.partner_assistant_rome_day(p_at)
     or not exists(select 1 from public.partner_assistant_notes q where q.partner_id=p.id and q.kind='controllo'
       and q.content->'approved'='true'::jsonb and q.content->>'sha256'=d.sha256 and q.created_at>=d.created_at)
     or exists(select 1 from public.partner_assistant_messages m where m.mode='invio' and m.partner_id=p.id
       and m.kind='primo' and m.send_status in ('in_invio','inviato','incerto')) then return null; end if;
 elsif p_kind='sollecito' then
   select * into f from public.partner_assistant_followups where partner_id=p_partner and draft_id=d.id;
   select * into n from public.partner_assistant_notes where id=f.choice_note_id;
   if f.id is null or private.partner_followup_reason(f.id,true) is not null or f.followups_sent+1 is distinct from p_number
     or f.next_due_on>private.partner_assistant_rome_day(p_at) or f.deferred_until>(p_at at time zone (n.content->>'timezone'))::date
     or private.partner_assistant_rome_day(f.last_sent_at)+7>private.partner_assistant_rome_day(p_at) then return null; end if;
 else return null; end if;
 if not private.partner_assistant_window_open(n.content->>'timezone',p.country,p_at,interval '90 seconds') then return null; end if;
 return jsonb_build_object('partner_version',p.version,'contact_version',k.version,'rules_version',v_rules,'sha256',d.sha256,
   'choice_note_id',n.id,'research_note_id',r.id,'conversation_version',f.version,'contact_id',k.id,
   'address_sha256',private.partner_assistant_address_sha256(private.partner_assistant_address(k.link_value)));
end
$$;

create or replace function private.partner_assistant_send_order()
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
      where j.status = 'pronta' and private.partner_assistant_eligible(p.id) and not private.partner_email_draft_held(d.id)
        and (private.partner_assistant_rome_day(private.partner_assistant_now())<private.partner_event_priority_from()
          or private.partner_first_policy_allows(d.id,private.partner_assistant_now()))) o
    order by o.rank;
end
$$;

create or replace function private.refresh_partner_send_plan() returns void
language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare v_now timestamptz; w record; c record; s record; v_pool jsonb; v_chosen jsonb; v_best jsonb;
 v_from timestamptz; v_end timestamptz; v_midnight timestamptz; a timestamptz; b timestamptz; t timestamptz;
 v_day date; v_window uuid; v_n integer; i integer; v_used integer; v_cap integer; v_capacity integer; v_snapshot jsonb; picked jsonb;
 v_candidates jsonb; v_base_pool jsonb; v_quotas jsonb; v_available_club integer; v_available_other integer; v_available_fu integer; v_available_first integer;
 v_existing jsonb; v_mode text; v_fu_mode text; v_failure boolean; v_locked timestamptz;
begin
 perform 1 from private.partner_assistant_mail_state where singleton for update;
 select mode into v_mode from private.partner_assistant_config where singleton for share;
 select mode into v_fu_mode from private.partner_followup_config where singleton for share;
 v_now:=private.partner_followup_proof_now();
 -- Il primo tick puo arrivare dopo le 09:00: congelare PRIMA di scadere o invalidare slot.
 update private.partner_send_windows w set locked_at=v_now where w.opens_at<=v_now and w.locked_at is null
   and exists(select 1 from private.partner_send_slots x where x.window_id=w.id and x.reason is distinct from 'ripianificato');
 -- Le righe gia avviate si riconciliano dal messaggio: non liberano la quota in caso incerto.
 update private.partner_send_slots s set status=case m.send_status when 'in_invio' then 'sending' when 'inviato' then 'sent'
   when 'incerto' then 'uncertain' else 'skipped' end,reason=m.outcome
 from public.partner_assistant_messages m where m.id=s.message_row_id and s.status in ('scheduled','sending')
   and m.send_status<>'pronto';
 update private.partner_send_slots set status='expired',reason='slot_scaduto' where status='scheduled' and expires_at<=v_now;
 -- Vale per entrambe le categorie: prima dell'apertura un contesto nuovo puo rientrare nel piano.
 for s in select * from private.partner_send_slots where status='scheduled' order by partner_id loop
   v_snapshot:=private.partner_send_snapshot(s.partner_id,s.kind,s.draft_id,s.followup_number,s.planned_at);
   if v_snapshot is null or v_snapshot is distinct from s.snapshot then
     update private.partner_send_slots set status='skipped',reason=case when (select opens_at from private.partner_send_windows where id=s.window_id)>v_now
       then 'ripianificato' else 'contesto_cambiato' end where id=s.id;
   end if;
 end loop;
 if v_mode is distinct from 'invio' then return; end if;
 -- send_order e i relativi controlli si leggono una volta, non una volta per fuso/griglia.
 select coalesce(jsonb_agg(to_jsonb(q) order by q.priority,q.rank,q.partner_id),'[]'::jsonb) into v_candidates from(
     select o.partner_id,'primo'::text kind,o.draft_id,o.job_id,null::uuid conversation_id,0 followup_number,
       private.partner_assistant_is_template(d.research_note_id) flow_template,n.content->>'timezone' timezone,p.country,0 priority,o.rank
       from private.partner_assistant_send_order() o join public.partners p on p.id=o.partner_id
       join public.partner_assistant_jobs j on j.id=o.job_id join public.partner_assistant_drafts d on d.id=o.draft_id
       join public.partner_assistant_notes n on n.id=j.choice_note_id
     union all
     select f.partner_id,'sollecito',f.draft_id,null,f.id,f.followups_sent+1,f.flow_template,n.content->>'timezone',p.country,1,
       row_number() over(order by f.next_due_on,p.co) from public.partner_assistant_followups f
       join public.partners p on p.id=f.partner_id join public.partner_assistant_notes n on n.id=f.choice_note_id
       where v_fu_mode='invio' and f.status='active' and f.draft_id is not null

 ) q;
 -- Tutte le finestre effettive dei candidati reali, entro 48 ore; date locali fino a due giorni.
 for w in
   with candidates as(
     select (j->>'partner_id')::uuid partner_id,j->>'timezone' z,j->>'country' country
       from jsonb_array_elements(v_candidates) j
   ), windows as(
     select c.*,((v_now at time zone c.z)::date+i) d,
       (((v_now at time zone c.z)::date+i)+time '09:00') at time zone c.z opens_at
     from candidates c cross join generate_series(0,2) i where private.partner_assistant_valid_timezone(c.z)
   ) select distinct d,opens_at,(d+time '15:55') at time zone z grid_end_at,
       (d+time '15:58:30') at time zone z latest_start_at
     from windows where opens_at<v_now+interval '48 hours' and (d+time '15:55') at time zone z>v_now+interval '2 minutes'
       and private.partner_assistant_window_open(z,country,opens_at,interval '90 seconds') order by opens_at
 loop
   insert into private.partner_send_windows(opens_at,grid_end_at,latest_start_at,local_day)
     values(w.opens_at,w.grid_end_at,w.latest_start_at,w.d) on conflict(opens_at,local_day) do nothing;
   select id,locked_at into v_window,v_locked from private.partner_send_windows where opens_at=w.opens_at and local_day=w.d for update;
   if v_locked is not null and exists(select 1 from private.partner_send_slots where window_id=v_window and reason is distinct from 'ripianificato') then continue; end if;
   v_from:=case when v_now<w.opens_at then w.opens_at else v_now+interval '2 minutes' end; v_end:=w.grid_end_at;
   v_midnight:=(private.partner_assistant_rome_day(v_from)+1)::timestamp at time zone 'Europe/Rome';
   -- Quote residue reali, lette una volta per giorno. Le prenotazioni gia contate non si duplicano.
   with days as(select private.partner_assistant_rome_day(v_from)+i d
     from generate_series(0,private.partner_assistant_rome_day(v_end)-private.partner_assistant_rome_day(v_from)) i),
   remaining as materialized (
     select d,
       greatest(0,private.partner_assistant_first_limit(d)-private.partner_assistant_first_sent(d)
         -private.partner_send_reserved(d,'primo',true,v_window)-private.partner_send_reserved(d,'primo',false,v_window)) firsts,
       greatest(0,private.partner_assistant_flow_share(d,true)-private.partner_assistant_flow_sent(d,true)-private.partner_send_reserved(d,'primo',true,v_window)) club,
       greatest(0,private.partner_assistant_flow_share(d,false)-private.partner_assistant_flow_sent(d,false)-private.partner_send_reserved(d,'primo',false,v_window)) altri,
       case when v_fu_mode='invio' then greatest(0,6-private.partner_followup_sent(d)-private.partner_send_reserved(d,'sollecito',null,v_window)) else 0 end fu
     from days)
   select jsonb_object_agg(d::text,jsonb_build_object('club',club,'altri',altri,'fu',fu,'firsts',firsts)),sum(club),sum(altri),sum(fu),sum(firsts)
     into v_quotas,v_available_club,v_available_other,v_available_fu,v_available_first from remaining;
   if v_available_club+v_available_other+v_available_fu=0 then continue; end if;
   -- Il pool iniziale e economico: campi gia letti, calendario e prenotazioni. Nessuno snapshot.
   select coalesce(jsonb_agg(j order by (j->>'priority')::integer,(j->>'rank')::bigint,j->>'partner_id'),'[]'::jsonb)
     into v_base_pool from jsonb_array_elements(v_candidates) j
   where private.partner_assistant_valid_timezone(j->>'timezone')
     and (w.d+time '09:00') at time zone (j->>'timezone')=w.opens_at
     and private.partner_assistant_window_open(j->>'timezone',j->>'country',w.opens_at,interval '90 seconds')
     and (case when j->>'kind'='sollecito' then v_available_fu>0
       when (j->>'flow_template')::boolean then v_available_club>0 else v_available_other>0 end)
     and not exists(select 1 from private.partner_send_slots x where x.partner_id=(j->>'partner_id')::uuid and x.kind=j->>'kind'
       and x.followup_number=(j->>'followup_number')::integer
       and ((x.status in ('scheduled','sending') and x.window_id<>v_window)
         or (x.local_day=w.d and x.status<>'scheduled' and x.reason is distinct from 'ripianificato')));
   -- Non inventare sei posti FU se non ci sono bozze FU: questo limite precede i controlli costosi.
   select least(case when private.partner_assistant_rome_day(w.grid_end_at)>=private.partner_event_priority_from() then 6 else 12 end,
       case when private.partner_assistant_rome_day(w.grid_end_at)>=private.partner_event_priority_from() then v_available_first else 12 end,
       least(case when private.partner_assistant_rome_day(w.grid_end_at)>=private.partner_event_priority_from() then 6 else 3 end,
         v_available_club,count(*) filter(where j->>'kind'='primo' and (j->>'flow_template')::boolean))
       +least(case when private.partner_assistant_rome_day(w.grid_end_at)>=private.partner_event_first_from() then 6 else 3 end,
         v_available_other,count(*) filter(where j->>'kind'='primo' and not (j->>'flow_template')::boolean)))
     +least(6,v_available_fu,count(*) filter(where j->>'kind'='sollecito'))
     into v_capacity from jsonb_array_elements(v_base_pool) j;
   if v_capacity=0 then continue; end if;
   -- MATERIALIZED impedisce la rivalutazione degli stessi snapshot nel filtro e nella proiezione.
   with checked as materialized (
     select j,coalesce(private.partner_send_snapshot((j->>'partner_id')::uuid,j->>'kind',(j->>'draft_id')::uuid,
       (j->>'followup_number')::integer,greatest(w.opens_at,v_now+interval '2 minutes')),
       private.partner_send_snapshot((j->>'partner_id')::uuid,j->>'kind',(j->>'draft_id')::uuid,
       (j->>'followup_number')::integer,w.grid_end_at)) base_snapshot
       from jsonb_array_elements(v_base_pool) j),
   ranked as (
     select j,row_number() over(partition by j->>'kind',case when j->>'kind'='primo' then (j->>'flow_template')::boolean else false end
       order by (j->>'rank')::bigint,j->>'partner_id') pick_rank from checked where base_snapshot is not null)
   select coalesce(jsonb_agg(j order by (j->>'priority')::integer,(j->>'rank')::bigint,j->>'partner_id'),'[]'::jsonb)
     into v_pool from ranked where pick_rank<=case when j->>'kind'='primo' then 6 else 12 end;
   -- Anche le bozze scartate dai controlli non contribuiscono al numero dei tentativi.
   select least(case when private.partner_assistant_rome_day(w.grid_end_at)>=private.partner_event_priority_from() then 6 else 12 end,
       case when private.partner_assistant_rome_day(w.grid_end_at)>=private.partner_event_priority_from() then v_available_first else 12 end,
       least(case when private.partner_assistant_rome_day(w.grid_end_at)>=private.partner_event_priority_from() then 6 else 3 end,
         v_available_club,count(*) filter(where j->>'kind'='primo' and (j->>'flow_template')::boolean))
       +least(case when private.partner_assistant_rome_day(w.grid_end_at)>=private.partner_event_first_from() then 6 else 3 end,
         v_available_other,count(*) filter(where j->>'kind'='primo' and not (j->>'flow_template')::boolean)))
     +least(6,v_available_fu,count(*) filter(where j->>'kind'='sollecito'))
     into v_capacity from jsonb_array_elements(v_pool) j;
   if v_capacity=0 then continue; end if;
   v_best:=null;
   -- Una finestra AU puo attraversare due giorni di quota Roma. Si provano anche griglie
   -- interamente dopo mezzanotte: una quota piena ieri non riduce oggi a un solo candidato.
   <<sizes>>
   for v_n in reverse least(jsonb_array_length(v_pool),v_capacity,12)..1 loop
     foreach a in array array[v_from,greatest(v_from,v_midnight),v_from+interval '4 minutes',v_from+interval '8 minutes'] loop
       foreach b in array array[v_end,least(v_end,v_midnight-interval '1 microsecond')] loop
         if a>=b then continue; end if;
         if v_n>1 and (b-a)/(v_n-1)<interval '2 minutes' then continue; end if;
         v_chosen:='[]'::jsonb; v_failure:=false;
         for i in 0..v_n-1 loop
           t:=case when v_n=1 then a+(b-a)/2 else a+(b-a)*i/(v_n-1) end;
           v_day:=private.partner_assistant_rome_day(t); picked:=null;
           for c in select value j from jsonb_array_elements(v_pool) loop
             if exists(select 1 from jsonb_array_elements(v_chosen) z where z->>'partner_id'=c.j->>'partner_id' and z->>'kind'=c.j->>'kind') then continue; end if;
             v_cap:=coalesce((v_quotas->v_day::text->>(case when c.j->>'kind'='sollecito' then 'fu'
               when (c.j->>'flow_template')::boolean then 'club' else 'altri' end))::integer,0);
             v_used:=0;
             select v_used+count(*)::integer into v_used from jsonb_array_elements(v_chosen) z where z->>'quota_day'=v_day::text
               and z->>'kind'=c.j->>'kind' and (c.j->>'kind'='sollecito' or z->>'flow_template'=c.j->>'flow_template');
             if v_used>=v_cap then continue; end if;
             -- Club e altri condividono gli stessi sei posti: contati anche invii incerti e prenotazioni di altri fusi.
             if c.j->>'kind'='primo' and v_day>=private.partner_event_priority_from() and (
               private.partner_assistant_first_sent(v_day)
               +private.partner_send_reserved(v_day,'primo',true,v_window)
               +private.partner_send_reserved(v_day,'primo',false,v_window)
               +(select count(*) from jsonb_array_elements(v_chosen) z where z->>'kind'='primo' and z->>'quota_day'=v_day::text)
                 >=private.partner_assistant_first_limit(v_day)
               or (select count(*) from jsonb_array_elements(v_chosen) z where z->>'kind'='primo')>=6
             ) then continue; end if;
             -- Anche la finestra locale conserva 3 Club + 3 altri + 6 FU, pur attraversando Roma00.
             if (select count(*) from jsonb_array_elements(v_chosen) z where z->>'kind'=c.j->>'kind'
               and (c.j->>'kind'='sollecito' or z->>'flow_template'=c.j->>'flow_template'))
               >=(case when c.j->>'kind'='primo' and v_day<private.partner_event_first_from() then 3 else 6 end) then continue; end if;
             -- Un unico SMTP: griglie di fusi diversi non prenotano lo stesso intervallo.
             if exists(select 1 from private.partner_send_slots x where x.window_id<>v_window and x.status in ('scheduled','sending')
               and abs(extract(epoch from x.planned_at-t))<120) then continue; end if;
             v_snapshot:=private.partner_send_snapshot((c.j->>'partner_id')::uuid,c.j->>'kind',(c.j->>'draft_id')::uuid,(c.j->>'followup_number')::integer,t);
             if v_snapshot is null then continue; end if;
             picked:=c.j||jsonb_build_object('snapshot',v_snapshot,'planned_at',t,'quota_day',v_day,
               'expires_at',least(t+interval '5 minutes',w.latest_start_at,(v_day+1)::timestamp at time zone 'Europe/Rome'));
             exit;
           end loop;
           if picked is null then v_failure:=true; exit; end if;
           v_chosen:=v_chosen||jsonb_build_array(picked);
         end loop;
         if not v_failure then v_best:=v_chosen; exit sizes; end if;
       end loop;
     end loop;
   end loop;
   if v_best is null then continue; end if;
   -- Prima dell'apertura il ricalcolo conserva gli id se contenuti e orari non cambiano.
   select coalesce(jsonb_agg(jsonb_build_object('partner_id',s.partner_id,'kind',s.kind,'draft_id',s.draft_id,
     'snapshot',s.snapshot,'planned_at',s.planned_at) order by s.planned_at,s.partner_id),'[]'::jsonb) into v_existing
     from private.partner_send_slots s where s.window_id=v_window and s.status='scheduled';
   if v_existing is distinct from (select jsonb_agg(jsonb_build_object('partner_id',z->'partner_id','kind',z->'kind','draft_id',z->'draft_id',
     'snapshot',z->'snapshot','planned_at',z->'planned_at') order by z->>'planned_at',z->>'partner_id') from jsonb_array_elements(v_best) z) then
     update private.partner_send_slots set status='skipped',reason='ripianificato' where window_id=v_window and status='scheduled';
     for c in select value j from jsonb_array_elements(v_best) loop
       insert into private.partner_send_slots(window_id,partner_id,kind,draft_id,job_id,conversation_id,followup_number,flow_template,snapshot,timezone,local_day,quota_day,planned_at,expires_at)
       values(v_window,(c.j->>'partner_id')::uuid,c.j->>'kind',(c.j->>'draft_id')::uuid,(c.j->>'job_id')::uuid,(c.j->>'conversation_id')::uuid,
         (c.j->>'followup_number')::integer,(c.j->>'flow_template')::boolean,c.j->'snapshot',c.j->>'timezone',w.d,(c.j->>'quota_day')::date,
         (c.j->>'planned_at')::timestamptz,(c.j->>'expires_at')::timestamptz);
     end loop;
     update private.partner_send_windows set revision=revision+1 where id=v_window;
   end if;
   if w.opens_at<=v_now then update private.partner_send_windows set locked_at=v_now where id=v_window; end if;
 end loop;
end
$$;

-- Il programma distingue la prova editoriale eventi dalla finestra delle altre proposte.
create or replace function private.read_partner_email_program(p_from date,p_days integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_total integer; v_sent integer; v_unprepared_total integer; v_unprepared jsonb; v_items jsonb; v_history jsonb; v_now timestamptz:=private.partner_assistant_now();
 v_fallback private.partner_event_exhaustion_checks%rowtype;
begin
 perform private.partner_actor();
 select * into v_fallback from private.partner_event_exhaustion_checks
   where id=private.partner_event_fallback_check(v_now);
 if p_from is null or not isfinite(p_from) or p_days is null or p_days not between 1 and 90 then
   raise exception 'invalid_partner_payload' using errcode='22023'; end if;
 select count(*) into v_total from public.partner_assistant_jobs;
 select count(*) into v_unprepared_total from private.partner_assistant_queue(private.partner_assistant_rome_day(v_now));
 select count(*) into v_sent from public.partner_assistant_messages where kind='primo' and coalesce(sent_at,created_at)>=p_from::timestamp at time zone 'Europe/Rome'
   and coalesce(sent_at,created_at)<(p_from+p_days)::timestamp at time zone 'Europe/Rome';
 if v_total+v_unprepared_total>2000 or v_sent>2000 then raise exception 'partner_email_program_too_large' using errcode='54000'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('partnerId',p.id,'co',p.co,'name',p.name,'sections',p.sections,
  'flow',case when private.partner_assistant_uses_template(p.id) then 'club' else 'altri' end,
  'partnerVersion',p.version) order by q.co),'[]'::jsonb) into v_unprepared
 from private.partner_assistant_queue(private.partner_assistant_rome_day(v_now)) q join public.partners p on p.id=q.partner_id;
 with rows as (
 select j.*,p.co,p.name,p.sections,p.country,p.version as partner_version,p.priority,p.event_starts_on as partner_event_on,
  d.id as d_id,d.subject,d.body,d.language,d.sha256,d.rules_version,d.created_at as draft_at,
  n.created_at as research_at,s.content as choice,coalesce(x.send_priority,0) as send_priority,
  private.partner_assistant_eligible(p.id) as eligible,
  case when d.id is not null then private.partner_assistant_is_template(d.research_note_id)
    else private.partner_assistant_uses_template(p.id) end as template,
  row_number() over(order by coalesce(x.send_priority,0) desc,nullif(s.content->>'event_starts_on','')::date nulls last,
    n.created_at,array_position(array['alta','media','bassa']::text[],p.priority),p.co) as rank,
  h.id as hold_id,h.version as hold_version,h.created_at as hold_at
 from public.partner_assistant_jobs j join public.partners p on p.id=j.partner_id
 left join public.partner_assistant_drafts d on d.id=j.draft_id
 left join public.partner_assistant_notes n on n.id=coalesce(d.research_note_id,j.research_note_id)
 left join public.partner_assistant_notes s on s.id=j.choice_note_id
 left join public.partner_assistant_contacts x on x.partner_id=p.id
 left join private.partner_email_edit_holds h on h.job_id=j.id and h.closed_at is null
 ) select coalesce(jsonb_agg(jsonb_build_object('jobId',r.id,'partnerId',r.partner_id,'co',r.co,'name',r.name,
  'sections',r.sections,'eventApproved',private.partner_event_first_approved(r.d_id),
  'fallbackWindow',case when v_fallback.id is not null
    and not (coalesce(r.choice->>'contact_kind'='evento',false) or coalesce(r.choice->>'request'='stand_evento',false))
    and private.partner_first_policy_allows(r.d_id,v_now)
    then jsonb_build_object('start',v_fallback.created_at,'end',v_fallback.valid_until) end,'flow',case when r.template then 'club' else 'altri' end,'status',r.status,'step',r.step,
  'reason',case when private.partner_email_manual_stale(r.d_id) then 'bozza_manuale_da_rivedere' else r.reason end,'writeOn',r.write_on,'eligible',r.eligible,'rank',case when r.status='pronta' then r.rank end,
  'sendPriority',r.send_priority,'country',r.country,'timezone',case when r.status='pronta' then
    case when private.partner_assistant_valid_timezone(r.choice->>'timezone') then r.choice->>'timezone' else 'Europe/Rome' end
    else nullif(r.choice->>'timezone','') end,
  'choiceReason',nullif(r.choice->>'reason_it',''),'request',r.choice->>'request',
  'contactKind',r.choice->>'contact_kind','eventStartsOn',case
    when r.choice->>'contact_kind'='evento' or r.choice->>'request'='stand_evento'
      then coalesce(nullif(r.choice->>'event_starts_on',''),r.partner_event_on::text)
    else nullif(r.choice->>'event_starts_on','') end,
  'researchAt',r.research_at,'partnerVersion',r.partner_version,
  'draft',case when r.d_id is not null then jsonb_build_object('id',r.d_id,'sha256',r.sha256,'subject',r.subject,'body',r.body,
    'language',r.language,'rulesVersion',r.rules_version,'createdAt',r.draft_at) end,
  'hold',case when r.hold_id is not null then jsonb_build_object('id',r.hold_id,'version',r.hold_version,'createdAt',r.hold_at) end,
  'windows',case when r.status='pronta' then private.partner_email_windows(p_from,p_days,r.choice->>'timezone',r.country) else '[]'::jsonb end
 ) order by r.rank,r.co),'[]'::jsonb) into v_items from rows r;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'partnerId',m.partner_id,'co',p.co,'name',p.name,'sections',p.sections,
  'flow',case when case when d.id is not null then private.partner_assistant_is_template(d.research_note_id)
    else private.partner_assistant_uses_template(p.id) end then 'club' else 'altri' end,
  'mode',m.mode,'status',m.send_status,'subject',m.subject,'at',coalesce(m.sent_at,m.created_at),'lookbookCode',m.lookbook->>'code')
  order by coalesce(m.sent_at,m.created_at),m.id),'[]'::jsonb) into v_history
 from public.partner_assistant_messages m join public.partners p on p.id=m.partner_id
 left join public.partner_assistant_drafts d on d.id=m.draft_id
 where m.kind='primo' and coalesce(m.sent_at,m.created_at)>=p_from::timestamp at time zone 'Europe/Rome'
  and coalesce(m.sent_at,m.created_at)<(p_from+p_days)::timestamp at time zone 'Europe/Rome';
 return jsonb_build_object('generatedAt',v_now,'from',p_from,'days',p_days,
 'config',(select jsonb_build_object('mode',mode,'pausedReason',paused_reason,'backoffUntil',backoff_until,
   'dailyFirstLimit',daily_first_limit,'eventFirstFrom',private.partner_event_first_from(),'eventPriorityFrom',private.partner_event_priority_from(),'firstRealOn',private.partner_assistant_first_real_day(),
   'currentRulesVersion',(select max(version) from public.partner_assistant_rules)) from private.partner_assistant_config where singleton),
 'mail',(select jsonb_build_object('stopReason',stop_reason,'backoffUntil',backoff_until,'dayStoppedOn',day_stopped_on,
   'nextSendAfter',next_send_after) from private.partner_assistant_mail_state where singleton),
 'todaySent',jsonb_build_object('club',private.partner_assistant_flow_sent(private.partner_assistant_rome_day(v_now),true),
   'altri',private.partner_assistant_flow_sent(private.partner_assistant_rome_day(v_now),false)),
 'items',v_items,'unprepared',v_unprepared,'sent',v_history,'counts',jsonb_build_object('total',v_total,'returned',jsonb_array_length(v_items),
   'unpreparedTotal',v_unprepared_total,'unpreparedReturned',jsonb_array_length(v_unprepared)));
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
    'event_first_from', private.partner_event_first_from(),
    'event_priority_from', private.partner_event_priority_from(),
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
    'ready', (select count(*) from private.partner_assistant_send_order() o
      where private.partner_first_policy_allows(o.draft_id,v_now)),
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

commit;
