-- Decisione di Tommi del 17 novembre 2026: dal 18, sei prime email al giorno
-- esclusivamente a eventi UE/Regno Unito, con proposta di stand e revisione del founder.
-- La scelta vale per le prime email. I solleciti conservano quote e guardie esistenti.
begin;

create function private.partner_event_first_from() returns date
language sql immutable security invoker set search_path='' as $$
 select date '2026-11-18'
$$;

-- Alias della scheda, inclusi i codici ISO e le denominazioni italiane/inglesi.
-- La tabella delle feste copre un sottoinsieme e non definisce il perimetro geografico.
create function private.partner_event_first_country(p_country text) returns boolean
language sql immutable security invoker set search_path='' as $$
 select exists(select 1 from (values
 ('at','austria','austria'),('be','belgio','belgium'),('bg','bulgaria','bulgaria'),
 ('hr','croazia','croatia'),('cy','cipro','cyprus'),('cz','repubblica ceca','czechia'),
 ('dk','danimarca','denmark'),('ee','estonia','estonia'),('fi','finlandia','finland'),
 ('fr','francia','france'),('de','germania','germany'),('gr','grecia','greece'),
 ('hu','ungheria','hungary'),('ie','irlanda','ireland'),('it','italia','italy'),
 ('lv','lettonia','latvia'),('lt','lituania','lithuania'),('lu','lussemburgo','luxembourg'),
 ('mt','malta','malta'),('nl','paesi bassi','netherlands'),('pl','polonia','poland'),
 ('pt','portogallo','portugal'),('ro','romania','romania'),('sk','slovacchia','slovakia'),
 ('si','slovenia','slovenia'),('es','spagna','spain'),('se','svezia','sweden'),
 ('gb','regno unito','united kingdom')
 ) c(iso,it,en) where lower(btrim(p_country)) in(c.iso,c.it,c.en))
 or lower(btrim(p_country)) in('uk','great britain','gran bretagna','england','inghilterra',
 'deutschland','österreich','españa','belgique','belgië','nederland','olanda','czech republic')
$$;

create table private.partner_event_first_approvals(
 draft_id uuid primary key references public.partner_assistant_drafts(id) on delete cascade,
 partner_id uuid not null references public.partners(id) on delete cascade,
 partner_version bigint not null,
 choice_note_id uuid not null references public.partner_assistant_notes(id) on delete cascade,
 contact_version bigint not null,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 official_sources text[] not null check(cardinality(official_sources) between 1 and 12),
 approved_by uuid not null references auth.users(id),
 operation_id uuid not null,
 approved_at timestamptz not null default now()
);
revoke all on private.partner_event_first_approvals from public,anon,authenticated,service_role;

-- L'approvazione riguarda esattamente questa bozza e questo contesto. La sezione Eventi
-- comprende anche negozi e sedi: la verifica editoriale certifica che si tratta di un evento.
create function private.partner_event_first_approved(p_draft uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from private.partner_event_first_approvals a
 join public.partner_assistant_drafts d on d.id=a.draft_id
 join public.partners p on p.id=a.partner_id
 join public.partner_assistant_jobs j on j.partner_id=p.id and j.draft_id=d.id
 join public.partner_assistant_notes n on n.id=j.choice_note_id
 join public.partner_contacts k on k.id=d.contact_id and k.active and k.erased_at is null
 where a.draft_id=p_draft and d.partner_id=p.id and a.partner_version=p.version
 and a.choice_note_id=j.choice_note_id and a.contact_version=k.version and a.sha256=d.sha256
 and 'eventi'=any(p.sections) and private.partner_event_first_country(p.country)
 and n.content->>'contact_kind'='evento' and n.content->>'request'='stand_evento'
 and private.partner_event_first_country(n.content->>'event_country'))
$$;

create function private.approve_partner_event_first_draft_as_founder(p_actor_id uuid,p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_partner uuid; v_draft uuid; v_version bigint; v_sha text; v_sources text[];
 p public.partners%rowtype; d public.partner_assistant_drafts%rowtype; j public.partner_assistant_jobs%rowtype;
 k public.partner_contacts%rowtype; n public.partner_assistant_notes%rowtype; v_replay jsonb; v_result jsonb;
begin
 perform 1 from public.memberships where user_id=p_actor_id and active and role='founder' for share;
 if not found then raise exception 'partner_assistant_founder_required' using errcode='42501'; end if;
 perform private.partner_payload(p_payload,array['schema_version','partner_id','draft_id','expected_partner_version','expected_sha256','official_sources'],
 array['schema_version','partner_id','draft_id','expected_partner_version','expected_sha256','official_sources']);
 v_partner:=private.partner_uuid(p_payload,'partner_id'); v_draft:=private.partner_uuid(p_payload,'draft_id');
 v_version:=private.partner_bigint(p_payload,'expected_partner_version',1,9007199254740991);
 v_sha:=private.partner_text(p_payload,'expected_sha256',64);
 perform private.partner_check(v_partner is not null and v_draft is not null and v_version is not null and v_sha ~ '^[0-9a-f]{64}$'
 and jsonb_typeof(p_payload->'official_sources')='array');
 perform private.partner_check(jsonb_array_length(p_payload->'official_sources') between 1 and 12
 and not exists(select 1 from jsonb_array_elements(p_payload->'official_sources') s
 where jsonb_typeof(s)<>'string' or length(s#>>'{}')>2000 or (s#>>'{}') !~ '^https://[^[:space:]]+$'));
 select array_agg(value) into v_sources from jsonb_array_elements_text(p_payload->'official_sources');
 v_replay:=private.partner_assistant_begin(p_operation_id,'approve_partner_event_first_draft',p_actor_id,p_payload);
 if v_replay is not null then return v_replay; end if;
 select * into p from public.partners where id=v_partner for update;
 select * into j from public.partner_assistant_jobs where partner_id=v_partner for update;
 select * into d from public.partner_assistant_drafts where id=v_draft and partner_id=v_partner;
 select * into k from public.partner_contacts where id=d.contact_id for share;
 select * into n from public.partner_assistant_notes where id=j.choice_note_id;
 if p.version is distinct from v_version or d.sha256 is distinct from v_sha or j.draft_id is distinct from v_draft then
 raise exception 'partner_changed' using errcode='40001'; end if;
 perform private.partner_check(j.status='pronta' and d.partner_version=p.version
 and private.partner_assistant_eligible(p.id) and not private.partner_email_draft_held(d.id)
 and 'eventi'=any(p.sections) and private.partner_event_first_country(p.country)
 and n.content->>'contact_kind'='evento' and n.content->>'request'='stand_evento'
 and private.partner_event_first_country(n.content->>'event_country')
 and (nullif(n.content->>'event_starts_on','') is null or (n.content->>'event_starts_on')::date>private.partner_assistant_rome_day(private.partner_assistant_now()))
 and k.active and k.erased_at is null);
 insert into private.partner_event_first_approvals(draft_id,partner_id,partner_version,choice_note_id,contact_version,sha256,official_sources,approved_by,operation_id)
 values(d.id,p.id,p.version,j.choice_note_id,k.version,d.sha256,v_sources,p_actor_id,p_operation_id)
 on conflict(draft_id) do update set partner_version=excluded.partner_version,choice_note_id=excluded.choice_note_id,
 contact_version=excluded.contact_version,sha256=excluded.sha256,official_sources=excluded.official_sources,
 approved_by=excluded.approved_by,operation_id=excluded.operation_id,approved_at=now();
 v_result:=jsonb_build_object('draft_id',d.id,'partner_id',p.id,'approved',true,'replayed',false);
 return private.partner_assistant_finish(p_operation_id,'approve_partner_event_first_draft',p_actor_id,p_payload,v_result);
end
$$;

create function public.approve_partner_event_first_draft(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.partner_actor();
begin
 if not private.is_founder() then raise exception 'partner_assistant_founder_required' using errcode='42501'; end if;
 return private.approve_partner_event_first_draft_as_founder(v_actor,p_operation_id,p_payload);
end
$$;
revoke all on function public.approve_partner_event_first_draft(uuid,jsonb) from public,anon,service_role;
grant execute on function public.approve_partner_event_first_draft(uuid,jsonb) to authenticated;
revoke all on function private.approve_partner_event_first_draft_as_founder(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.partner_event_first_from() from public,anon,authenticated,service_role;
revoke all on function private.partner_event_first_country(text) from public,anon,authenticated,service_role;
revoke all on function private.partner_event_first_approved(uuid) from public,anon,authenticated,service_role;


create or replace function private.partner_assistant_eligible(p_partner_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.partners p
    where p.id = p_partner_id and p.stage = 'da_contattare' and p.owner_id is null and p.next_action is null
      and (private.partner_assistant_rome_day(private.partner_assistant_now())<private.partner_event_first_from()
        or ('eventi'=any(p.sections) and private.partner_event_first_country(p.country)))
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

create or replace function private.partner_assistant_first_limit(p_day date) returns integer
language sql stable security invoker set search_path = '' as $$
  select case when p_day>=private.partner_event_first_from() then 6
    when f.day is null or p_day <= f.day + 6 then 5
    else (select c.daily_first_limit from private.partner_assistant_config c where c.singleton) end
  from (select private.partner_assistant_first_real_day() as day) f
$$;

create or replace function private.partner_assistant_flow_share(p_day date, p_template boolean) returns integer
language sql stable security invoker set search_path = '' as $$
  select case when p_day>=private.partner_event_first_from() then case when p_template then 0 else 6 end
    when p_template then l.v / 2 else l.v - l.v / 2 end
  from (select private.partner_assistant_first_limit(p_day) as v) l
$$;

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
   if private.partner_assistant_rome_day(p_at)>=private.partner_event_first_from() and not private.partner_event_first_approved(p_draft) then return null; end if;
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

create or replace function private.refresh_partner_send_plan() returns void
language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare v_now timestamptz; w record; c record; s record; v_pool jsonb; v_chosen jsonb; v_best jsonb;
 v_from timestamptz; v_end timestamptz; v_midnight timestamptz; a timestamptz; b timestamptz; t timestamptz;
 v_day date; v_window uuid; v_n integer; i integer; v_used integer; v_cap integer; v_capacity integer; v_snapshot jsonb; picked jsonb;
 v_candidates jsonb; v_base_pool jsonb; v_quotas jsonb; v_available_club integer; v_available_other integer; v_available_fu integer;
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
       greatest(0,private.partner_assistant_flow_share(d,true)-private.partner_assistant_flow_sent(d,true)-private.partner_send_reserved(d,'primo',true,v_window)) club,
       greatest(0,private.partner_assistant_flow_share(d,false)-private.partner_assistant_flow_sent(d,false)-private.partner_send_reserved(d,'primo',false,v_window)) altri,
       case when v_fu_mode='invio' then greatest(0,6-private.partner_followup_sent(d)-private.partner_send_reserved(d,'sollecito',null,v_window)) else 0 end fu
     from days)
   select jsonb_object_agg(d::text,jsonb_build_object('club',club,'altri',altri,'fu',fu)),sum(club),sum(altri),sum(fu)
     into v_quotas,v_available_club,v_available_other,v_available_fu from remaining;
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
   select least(3,v_available_club,count(*) filter(where j->>'kind'='primo' and (j->>'flow_template')::boolean))
     +least(case when private.partner_assistant_rome_day(w.grid_end_at)>=private.partner_event_first_from() then 6 else 3 end,v_available_other,count(*) filter(where j->>'kind'='primo' and not (j->>'flow_template')::boolean))
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
   select least(3,v_available_club,count(*) filter(where j->>'kind'='primo' and (j->>'flow_template')::boolean))
     +least(case when private.partner_assistant_rome_day(w.grid_end_at)>=private.partner_event_first_from() then 6 else 3 end,v_available_other,count(*) filter(where j->>'kind'='primo' and not (j->>'flow_template')::boolean))
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

create or replace function private.read_partner_email_program(p_from date,p_days integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_total integer; v_sent integer; v_unprepared_total integer; v_unprepared jsonb; v_items jsonb; v_history jsonb; v_now timestamptz:=private.partner_assistant_now();
begin
 perform private.partner_actor();
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
 select j.*,p.co,p.name,p.sections,p.country,p.version as partner_version,p.priority,
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
  'sections',r.sections,'eventApproved',private.partner_event_first_approved(r.d_id),'flow',case when r.template then 'club' else 'altri' end,'status',r.status,'step',r.step,
  'reason',case when private.partner_email_manual_stale(r.d_id) then 'bozza_manuale_da_rivedere' else r.reason end,'writeOn',r.write_on,'eligible',r.eligible,'rank',case when r.status='pronta' then r.rank end,
  'sendPriority',r.send_priority,'country',r.country,'timezone',case when r.status='pronta' then
    case when private.partner_assistant_valid_timezone(r.choice->>'timezone') then r.choice->>'timezone' else 'Europe/Rome' end
    else nullif(r.choice->>'timezone','') end,
  'choiceReason',nullif(r.choice->>'reason_it',''),'request',r.choice->>'request',
  'contactKind',r.choice->>'contact_kind','eventStartsOn',nullif(r.choice->>'event_starts_on',''),
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
   'dailyFirstLimit',daily_first_limit,'eventFirstFrom',private.partner_event_first_from(),'firstRealOn',private.partner_assistant_first_real_day(),
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
      where v_today<private.partner_event_first_from() or private.partner_event_first_approved(o.draft_id)),
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
