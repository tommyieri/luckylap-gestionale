-- Piano effettivo degli invii Partner. Le finestre locali uguali condividono la griglia UTC.
-- Nessun invio/credito/configurazione/scheduler viene attivato da questa migrazione.
begin;

create table private.partner_send_windows (
  id uuid primary key default gen_random_uuid(),
  opens_at timestamptz not null,
  grid_end_at timestamptz not null,
  latest_start_at timestamptz not null,
  local_day date not null,
  locked_at timestamptz,
  revision bigint not null default 0,
  unique(opens_at,local_day),
  check(opens_at<grid_end_at and grid_end_at<latest_start_at)
);
create table private.partner_send_slots (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null references private.partner_send_windows(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  kind text not null check(kind in ('primo','sollecito')),
  draft_id uuid not null references public.partner_assistant_drafts(id) on delete cascade,
  job_id uuid references public.partner_assistant_jobs(id) on delete cascade,
  conversation_id uuid references public.partner_assistant_followups(id) on delete cascade,
  followup_number integer not null default 0 check(followup_number between 0 and 4),
  flow_template boolean not null,
  snapshot jsonb not null,
  timezone text not null,
  local_day date not null,
  quota_day date not null,
  planned_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'scheduled' check(status in ('scheduled','sending','sent','uncertain','skipped','expired')),
  reason text check(reason ~ '^[a-z][a-z0-9_]{0,79}$'),
  message_row_id uuid references public.partner_assistant_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  check(planned_at<expires_at),
  check((kind='primo' and job_id is not null and conversation_id is null and followup_number=0)
    or (kind='sollecito' and job_id is null and conversation_id is not null and followup_number between 1 and 4))
);
create unique index partner_send_slots_one_live on private.partner_send_slots(partner_id,kind,followup_number)
  where status in ('scheduled','sending');
create index partner_send_slots_day on private.partner_send_slots(quota_day,planned_at);
alter table private.partner_send_windows enable row level security;
alter table private.partner_send_slots enable row level security;
revoke all on private.partner_send_windows,private.partner_send_slots from public,anon,authenticated,service_role;

-- Solo gli orari cambiano; festivita, copertura, blackout e margine rimangono identici.
create or replace function private.partner_assistant_window_open(p_timezone text,p_country text,p_at timestamptz,
  p_margin interval default interval '0') returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare z text:=case when private.partner_assistant_valid_timezone(p_timezone) then p_timezone else 'Europe/Rome' end;
  code text:=private.partner_assistant_country_code(p_country); local_at timestamp;
begin
  if p_at is null or p_margin is null or p_margin<interval '0' then return false; end if;
  foreach local_at in array array[p_at at time zone z,(p_at+p_margin) at time zone z] loop
    if not(extract(isodow from local_at) between 1 and 5 and local_at::time>=time '09:00' and local_at::time<time '16:00'
      and to_char(local_at::date,'MM-DD') between '01-08' and '12-20'
      and local_at::date<=private.partner_assistant_holidays_until()
      and not exists(select 1 from private.partner_assistant_holidays h where h.country_code=code and h.day=local_at::date)) then return false; end if;
  end loop;
  return true;
end
$$;
create or replace function private.partner_assistant_next_window(p_at timestamptz) returns timestamptz
language plpgsql stable security invoker set search_path='' as $$
declare d date:=private.partner_assistant_rome_day(p_at); t timestamptz;
begin
  if p_at is null then return null; end if;
  if private.partner_assistant_window_open('Europe/Rome','Italia',p_at) then return p_at; end if;
  for i in 0..40 loop
    t:=((d+i)+time '09:00') at time zone 'Europe/Rome';
    if t>p_at and private.partner_assistant_window_open('Europe/Rome','Italia',t) then return t; end if;
  end loop;
  return null;
end
$$;
create or replace function private.partner_email_windows(p_from date,p_days integer,p_timezone text,p_country text) returns jsonb
language sql stable security invoker set search_path='' as $$
 with zone as(select case when private.partner_assistant_valid_timezone(p_timezone) then p_timezone else 'Europe/Rome' end z),
 days as(select p_from+i as day from generate_series(0,p_days-1) i),windows as(
 select d.day,greatest(((d.day+k)+time '09:00') at time zone z.z,d.day::timestamp at time zone 'Europe/Rome') a,
 least(((d.day+k)+time '15:58:30') at time zone z.z,(d.day+1)::timestamp at time zone 'Europe/Rome') b
 from days d cross join zone z cross join generate_series(-1,1) k
 where private.partner_assistant_window_open(z.z,p_country,((d.day+k)+time '09:00') at time zone z.z,interval '90 seconds'))
 select coalesce(jsonb_agg(jsonb_build_object('day',day,'start',a,'end',b) order by a),'[]'::jsonb) from windows where a<b
$$;

-- Impronta del contesto corrente, senza recapiti. Nessuna prova IMAP viene prenotata.
create function private.partner_send_snapshot(p_partner uuid,p_kind text,p_draft uuid,p_number integer,p_at timestamptz) returns jsonb
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

create function private.partner_send_slot_reason(p_partner uuid,p_kind text,p_draft uuid,p_number integer,p_at timestamptz) returns text
language plpgsql stable security invoker set search_path='' as $$
declare s private.partner_send_slots%rowtype; v_snapshot jsonb;
begin
 select * into s from private.partner_send_slots where partner_id=p_partner and kind=p_kind and draft_id=p_draft
   and followup_number=coalesce(p_number,0) and status='scheduled';
 if s.id is null then return 'slot_assente'; end if;
 if p_at<s.planned_at then return 'slot_futuro'; end if;
 if p_at>=s.expires_at or private.partner_assistant_rome_day(p_at)<>s.quota_day then return 'slot_scaduto'; end if;
 v_snapshot:=private.partner_send_snapshot(p_partner,p_kind,p_draft,coalesce(p_number,0),p_at);
 if v_snapshot is null or v_snapshot is distinct from s.snapshot then return 'contesto_cambiato'; end if;
 return null;
end
$$;

-- Prenotazioni non ancora trasformate in un invio gia contato dai contatori effettivi.
create function private.partner_send_reserved(p_day date,p_kind text,p_flow boolean,p_except_window uuid) returns integer
language sql stable security invoker set search_path='' as $$
 select count(*)::integer from private.partner_send_slots s
 left join public.partner_assistant_messages m on m.id=s.message_row_id
 where s.quota_day=p_day and s.kind=p_kind and s.status in ('scheduled','sending') and s.window_id is distinct from p_except_window
 and (p_kind='sollecito' or s.flow_template=p_flow)
 and not coalesce(m.mode='invio' and m.send_day=p_day and m.send_status in ('in_invio','inviato','incerto'),false)
$$;

create function private.refresh_partner_send_plan() returns void
language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare v_now timestamptz; w record; c record; s record; v_pool jsonb; v_chosen jsonb; v_best jsonb;
 v_from timestamptz; v_end timestamptz; v_midnight timestamptz; a timestamptz; b timestamptz; t timestamptz;
 v_day date; v_window uuid; v_n integer; i integer; v_used integer; v_cap integer; v_capacity integer; v_snapshot jsonb; picked jsonb;
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
 -- Tutte le finestre effettive dei candidati reali, entro 48 ore; date locali fino a due giorni.
 for w in
   with candidates as(
     select o.partner_id,n.content->>'timezone' z,p.country from private.partner_assistant_send_order() o
       join public.partners p on p.id=o.partner_id join public.partner_assistant_jobs j on j.id=o.job_id
       join public.partner_assistant_notes n on n.id=j.choice_note_id
     union all
     select f.partner_id,n.content->>'timezone',p.country from public.partner_assistant_followups f
       join public.partners p on p.id=f.partner_id join public.partner_assistant_notes n on n.id=f.choice_note_id
       where v_fu_mode='invio' and f.status='active' and f.draft_id is not null
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
   -- La stessa finestra UTC unisce Roma, Parigi, Berlino ecc.; le feste restano per destinatario.
   select coalesce(jsonb_agg(to_jsonb(pool) order by pool.priority,pool.rank,pool.partner_id),'[]'::jsonb) into v_pool from(
   select q.*,row_number() over(partition by q.kind,case when q.kind='primo' then q.flow_template else false end order by q.rank,q.partner_id) pick_rank from(
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
   ) q where private.partner_assistant_valid_timezone(q.timezone)
     and (w.d+time '09:00') at time zone q.timezone=w.opens_at
     and private.partner_assistant_window_open(q.timezone,q.country,w.opens_at,interval '90 seconds')
     and not exists(select 1 from private.partner_send_slots x where x.partner_id=q.partner_id and x.kind=q.kind and x.followup_number=q.followup_number
       and ((x.status in ('scheduled','sending') and x.window_id<>v_window)
         or (x.local_day=w.d and x.status not in ('scheduled') and x.reason is distinct from 'ripianificato')))
     and (private.partner_send_snapshot(q.partner_id,q.kind,q.draft_id,q.followup_number,greatest(w.opens_at,v_now+interval '2 minutes')) is not null
       or private.partner_send_snapshot(q.partner_id,q.kind,q.draft_id,q.followup_number,w.grid_end_at) is not null)
   ) pool where pool.pick_rank<=case when pool.kind='primo' then 6 else 12 end;
   v_from:=case when v_now<w.opens_at then w.opens_at else v_now+interval '2 minutes' end; v_end:=w.grid_end_at;
   v_midnight:=(private.partner_assistant_rome_day(v_from)+1)::timestamp at time zone 'Europe/Rome';
   select sum(greatest(0,private.partner_assistant_flow_share(d,true)-private.partner_assistant_flow_sent(d,true)-private.partner_send_reserved(d,'primo',true,v_window))
     +greatest(0,private.partner_assistant_flow_share(d,false)-private.partner_assistant_flow_sent(d,false)-private.partner_send_reserved(d,'primo',false,v_window))
     +case when v_fu_mode='invio' then greatest(0,6-private.partner_followup_sent(d)-private.partner_send_reserved(d,'sollecito',null,v_window)) else 0 end)::integer into v_capacity
     from (select private.partner_assistant_rome_day(v_from)+i d from generate_series(0,private.partner_assistant_rome_day(v_end)-private.partner_assistant_rome_day(v_from)) i) days;
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
             v_snapshot:=private.partner_send_snapshot((c.j->>'partner_id')::uuid,c.j->>'kind',(c.j->>'draft_id')::uuid,(c.j->>'followup_number')::integer,t);
             if v_snapshot is null then continue; end if;
             if c.j->>'kind'='primo' then
               v_cap:=private.partner_assistant_flow_share(v_day,(c.j->>'flow_template')::boolean);
               v_used:=private.partner_assistant_flow_sent(v_day,(c.j->>'flow_template')::boolean)
                 +private.partner_send_reserved(v_day,'primo',(c.j->>'flow_template')::boolean,v_window);
             else
               v_cap:=6; v_used:=private.partner_followup_sent(v_day)+private.partner_send_reserved(v_day,'sollecito',null,v_window);
             end if;
             select v_used+count(*)::integer into v_used from jsonb_array_elements(v_chosen) z where z->>'quota_day'=v_day::text
               and z->>'kind'=c.j->>'kind' and (c.j->>'kind'='sollecito' or z->>'flow_template'=c.j->>'flow_template');
             if v_used>=v_cap then continue; end if;
             -- Anche la finestra locale conserva 3 Club + 3 altri + 6 FU, pur attraversando Roma00.
             if (select count(*) from jsonb_array_elements(v_chosen) z where z->>'kind'=c.j->>'kind'
               and (c.j->>'kind'='sollecito' or z->>'flow_template'=c.j->>'flow_template'))
               >=(case when c.j->>'kind'='primo' then 3 else 6 end) then continue; end if;
             -- Un unico SMTP: griglie di fusi diversi non prenotano lo stesso intervallo.
             if exists(select 1 from private.partner_send_slots x where x.window_id<>v_window and x.status in ('scheduled','sending')
               and abs(extract(epoch from x.planned_at-t))<120) then continue; end if;
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

-- La ricevuta di invio e il piano si aggiornano nella medesima transazione, anche al recovery.
create function private.partner_send_message_state() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.mode='invio' then
   update private.partner_send_slots set message_row_id=new.id,status=case new.send_status when 'pronto' then 'scheduled'
     when 'in_invio' then 'sending' when 'inviato' then 'sent' when 'incerto' then 'uncertain' else 'skipped' end,
     reason=case when new.send_status in ('respinto','scartato','incerto') then coalesce(new.outcome,'invio_incerto') end
   where partner_id=new.partner_id and kind=new.kind and draft_id=new.draft_id and followup_number=coalesce(new.followup_number,0)
     and ((message_row_id is null and status='scheduled') or message_row_id=new.id);
 end if;
 return new;
end
$$;
create trigger partner_send_message_state after insert or update of send_status on public.partner_assistant_messages
 for each row execute function private.partner_send_message_state();

create function public.read_partner_send_plan(p_day date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_member() then raise exception 'partner_member_required' using errcode='42501'; end if;
 perform private.partner_check(p_day is not null and isfinite(p_day));
 return jsonb_build_object('day',p_day,'generated_at',private.partner_followup_proof_now(),
   'mode',coalesce((select mode from private.partner_assistant_config where singleton),'spento'),
   'slots',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'kind',s.kind,'partner_id',s.partner_id,'co',p.co,'name',p.name,
     'timezone',s.timezone,'local_day',s.local_day,'planned_at',s.planned_at,'expires_at',s.expires_at,'status',s.status,'reason',s.reason)
     order by s.planned_at,s.kind,p.co,s.id) from private.partner_send_slots s join public.partners p on p.id=s.partner_id
     where s.quota_day=p_day and s.reason is distinct from 'ripianificato'),'[]'::jsonb));
end
$$;

-- I corpi delle RPC esistenti mantengono le guardie e le firme, con i soli cancelli del piano.
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
  v_candidate jsonb; v_token uuid; v_dead_uncertain integer := 0; v_dead_real integer := 0; r record;
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
  if c.mode='invio' then v_now:=private.partner_followup_proof_now(); v_today:=private.partner_assistant_rome_day(v_now); end if;
  -- 2. Niente da fare.
  if c.mode in ('spento', 'prepara') then return jsonb_build_object('status', 'idle', 'reason', c.mode); end if;
  if c.actor_id is null or c.handoff_to is null then
    return jsonb_build_object('status', 'idle', 'reason', 'non_configurato');
  end if;
  if s.lease_expires_at > clock_timestamp() then return jsonb_build_object('status', 'idle', 'reason', 'occupato'); end if;
  -- 3. Giri morti (nessuna lease attiva): un messaggio preparato non è partito; uno in invio può
  -- essere partito, quindi resta incerto e il contatto passa a Tommi. Prima i contatti, poi i lavori.
  -- Un incerto conta come invio: due minuti per i reali, intervallo prove invariato.
  if exists (select 1 from public.partner_assistant_messages m where m.send_status in ('pronto', 'in_invio')) then
    perform 1 from public.partners p
      where p.id in (select m.partner_id from public.partner_assistant_messages m
        where m.send_status in ('pronto', 'in_invio'))
      order by p.id for share;
    perform 1 from public.partner_assistant_jobs l
      where l.partner_id in (select m.partner_id from public.partner_assistant_messages m
        where m.mode = 'invio' and m.send_status = 'in_invio')
      order by l.partner_id for update;
    if exists(select 1 from public.partner_assistant_messages where mode='invio' and send_status in ('pronto','in_invio')) then
      v_now:=private.partner_followup_proof_now(); v_today:=private.partner_assistant_rome_day(v_now);
    end if;
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
    select count(*) filter (where d.send_status = 'incerto'),count(*) filter(where d.send_status='incerto' and d.mode='invio')
      into v_dead_uncertain,v_dead_real from dead d;
    if v_dead_uncertain > 0 then
      update private.partner_assistant_mail_state
        set next_send_after = v_now + case when v_dead_real>0 then interval '2 minutes' else make_interval(secs => 240 + floor(random() * 421)) end
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
  if c.mode='invio' then
    perform private.refresh_partner_send_plan();
    v_now:=private.partner_followup_proof_now(); v_today:=private.partner_assistant_rome_day(v_now);
    select * into s from private.partner_assistant_mail_state where singleton;
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
      elsif private.partner_send_slot_reason(r.partner_id,'primo',r.draft_id,0,v_now) is not null then
        v_remaining:=true;
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
  if v_candidate is not null and c.mode='invio' then
    v_candidate:=v_candidate||jsonb_build_object('send_not_after',(select least(x.expires_at+interval '90 seconds',w.latest_start_at+interval '90 seconds')
      from private.partner_send_slots x join private.partner_send_windows w on w.id=x.window_id
      where x.partner_id=v_partner and x.kind='primo' and x.draft_id=v_draft and x.status='scheduled'));
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
  v_now := case when v_mode='invio' then private.partner_followup_proof_now() else private.partner_assistant_now() end;
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
    when private.partner_email_draft_held(v_draft) then 'modifica_in_corso'
    when private.partner_email_manual_stale(v_draft) then 'bozza_manuale_da_rivedere'
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
    when v_mode = 'invio' and private.partner_send_slot_reason(j.partner_id,'primo',d.id,0,v_now) is not null
      then private.partner_send_slot_reason(j.partner_id,'primo',d.id,0,v_now)
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
        'ricerca_scaduta', 'bozza_manuale_da_rivedere') then
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
  v_now := case when m.mode='invio' then private.partner_followup_proof_now() else private.partner_assistant_now() end;
  v_today := private.partner_assistant_rome_day(v_now);
  select n.content ->> 'timezone' into v_timezone from public.partner_assistant_notes n where n.id = j.choice_note_id;
  select private.partner_assistant_address(k.link_value) into v_address
    from public.partner_assistant_drafts d join public.partner_contacts k on k.id = d.contact_id
    where d.id = m.draft_id and k.kind = 'email' and k.active and k.link_value is not null;
  v_reason := case
    when j.partner_id is null or j.status <> 'pronta' or j.draft_id is distinct from m.draft_id then 'bozza_cambiata'
    when private.partner_email_draft_held(m.draft_id) then 'modifica_in_corso'
    when private.partner_email_manual_stale(m.draft_id) then 'bozza_manuale_da_rivedere'
    when c.mode is distinct from m.mode then 'modalita_cambiata'
    when s.stop_reason is not null or s.day_stopped_on = v_today or s.backoff_until > v_now then 'fermo'
    when m.mode = 'invio' and private.partner_send_slot_reason(m.partner_id,'primo',m.draft_id,0,v_now) is not null
      then private.partner_send_slot_reason(m.partner_id,'primo',m.draft_id,0,v_now)
    when m.mode = 'invio' and (s.next_send_after>v_now or private.partner_assistant_first_sent(v_today)>=private.partner_assistant_first_limit(v_today)
      or private.partner_assistant_flow_sent(v_today,private.partner_assistant_is_template((select research_note_id from public.partner_assistant_drafts where id=m.draft_id)))
        >=private.partner_assistant_flow_share(v_today,private.partner_assistant_is_template((select research_note_id from public.partner_assistant_drafts where id=m.draft_id)))) then 'limite'
    when m.mode = 'invio' and not private.partner_assistant_eligible(m.partner_id) then 'non_idoneo'
    when m.mode = 'invio' and m.to_address is distinct from v_address then 'recapito_cambiato'
    when m.lookbook is distinct from private.partner_assistant_send_lookbook(m.draft_id, m.mode, m.test_run_id) then 'allegato_cambiato'
    when m.mode = 'invio' and not private.partner_assistant_window_open(v_timezone, v_country, v_now,
        interval '90 seconds') then 'finestra_chiusa'
  end;
  if v_reason is not null then
    update public.partner_assistant_messages set send_status = 'scartato', outcome = v_reason, updated_at = now()
      where id = m.id;
    if v_reason='bozza_manuale_da_rivedere' then
      perform private.partner_assistant_send_move(m.partner_id,m.draft_id,v_reason);
    end if;
    insert into private.partner_assistant_events(partner_id, step, outcome) values (m.partner_id, 'invio', v_reason);
    return jsonb_build_object('status', 'stop', 'reason', v_reason);
  end if;
  update public.partner_assistant_messages set send_status = 'in_invio', send_day = v_today, updated_at = now()
    where id = m.id;
  return jsonb_build_object('status', 'in_invio');
end
$$;

create or replace function private.finish_partner_assistant_send(p_lease_token uuid, p_operation_id uuid, p_payload jsonb)
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
  if not found or m.lease_token is distinct from p_lease_token or (m.send_status <> 'in_invio' and not(m.mode='invio' and m.send_status='pronto' and v_outcome='scartato'
      and v_reason in ('smtp_temporaneo','smtp_non_partito','smtp_credenziali','smtp_bloccato'))) then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  v_now := case when m.mode='invio' then private.partner_followup_proof_now() else private.partner_assistant_now() end;
  update public.partner_assistant_messages set send_status = v_outcome, smtp_code = v_code, enhanced_code = v_enhanced,
      outcome = v_reason, sent_at = case when v_outcome in ('inviato', 'incerto') then v_now end, updated_at = now()
    where id = m.id;
  if v_outcome in ('inviato', 'incerto', 'respinto') then
    update private.partner_assistant_mail_state
      set next_send_after = v_now + case when m.mode='invio' then interval '2 minutes' else make_interval(secs => 240 + floor(random() * 421)) end
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

create or replace function private.skip_partner_assistant_send(p_lease_token uuid, p_job_id uuid, p_reason text) returns jsonb
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
  if c.mode='invio' then
    update private.partner_send_slots set status='skipped',reason=p_reason where status='scheduled' and kind='primo'
      and draft_id=(select candidate_draft_id from private.partner_assistant_mail_state where singleton);
  end if;
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
  -- Una risposta tardiva della casella o del ricontrollo appartiene alla bozza reclamata,
  -- non a una revisione umana successiva. Vale anche per worker precedenti al nuovo editor.
  if p_job_id is not null and (j.draft_id is distinct from
      (select candidate_draft_id from private.partner_assistant_mail_state where singleton)
    or j.draft_id is null or private.partner_email_draft_held(j.draft_id)) then
    return jsonb_build_object('status','lease_persa');
  end if;
  if j.status = 'pronta' and c.mode = 'invio' and p_reason = 'conversazione_esistente' then
    perform private.partner_assistant_send_move(j.partner_id, j.draft_id, 'conversazione_esistente');
    return jsonb_build_object('status', 'done');
  elsif j.status = 'pronta' and c.mode = 'invio' and p_reason = 'bozza_scaduta' then
    select nullif(n.content ->> 'event_starts_on', '')::date into v_event
      from public.partner_assistant_notes n where n.id = j.choice_note_id;
    if (v_event is null or v_event > private.partner_assistant_rome_day(v_now))
      and j.rewrites = 0 and c.paused_reason is distinct from 'credito'
      and not private.partner_email_manual_draft(j.draft_id) then
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

create or replace function private.partner_followup_send_reason(p_id uuid,p_at timestamptz default null) returns text
language plpgsql stable security invoker set search_path='' as $$
declare f public.partner_assistant_followups%rowtype; s private.partner_assistant_mail_state%rowtype;
  c private.partner_assistant_config%rowtype; v_now timestamptz:=coalesce(p_at,private.partner_followup_proof_now());
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
    when (select mode from private.partner_followup_config where singleton) is distinct from 'invio'
      or c.mode is distinct from 'invio' then 'osserva'
    when f.deferred_until>(v_now at time zone v_tz)::date then 'fuori_ufficio'
    when f.next_due_on>v_today or private.partner_assistant_rome_day(f.last_sent_at)+7>v_today then 'non_scaduto'
    when s.stop_reason is not null or s.day_stopped_on=v_today then 'fermo'
    when s.backoff_until>v_now or s.next_send_after>v_now then 'intervallo'
    when private.partner_followup_sent(v_today)>=6 then 'limite'
    when private.partner_send_slot_reason(f.partner_id,'sollecito',f.draft_id,f.followups_sent+1,v_now) is not null
      then private.partner_send_slot_reason(f.partner_id,'sollecito',f.draft_id,f.followups_sent+1,v_now)
    when not private.partner_assistant_window_open(v_tz,v_country,v_now,interval '90 seconds') then 'fuori_finestra'
  end;
end
$$;

create or replace function public.claim_partner_followup(p_worker_id uuid,p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.partner_assistant_mail_state%rowtype; c private.partner_assistant_config%rowtype;
  f public.partner_assistant_followups%rowtype; m public.partner_assistant_messages%rowtype; x record;
  v_now timestamptz:=private.partner_followup_proof_now(); v_mode text; v_reason text; v_candidate jsonb; v_token uuid;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  perform private.partner_check(p_worker_id is not null and p_lease_seconds between 60 and 600);
  select * into s from private.partner_assistant_mail_state where singleton for update;
  select * into c from private.partner_assistant_config where singleton for share;
  select mode into v_mode from private.partner_followup_config where singleton for share;
  if c.singleton is null or v_mode is null then
    return jsonb_build_object('status','idle','reason','non_configurato');
  end if;
  v_now:=private.partner_followup_proof_now();
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
        set next_send_after=v_now+interval '2 minutes' where singleton;
    end if;
  end loop;
  if v_mode='spento' or c.mode not in ('prepara','prova','invio') then return jsonb_build_object('status','idle','reason','spento'); end if;
  perform private.refresh_partner_followups();
  perform private.refresh_partner_send_plan();
  v_now:=private.partner_followup_proof_now();
  for x in select id,partner_id from public.partner_assistant_followups where status='active' order by partner_id loop
    perform 1 from public.partners where id=x.partner_id for update;
    v_reason:=private.partner_followup_reason(x.id,false);
    if v_reason is not null then perform private.partner_followup_hold(x.id,v_reason,false); end if;
  end loop;
  select * into f from public.partner_assistant_followups where status='active' and (next_check_at<=v_now or private.partner_send_slot_reason(partner_id,'sollecito',draft_id,followups_sent+1,v_now) is null)
    order by (private.partner_followup_send_reason(id,v_now) is null) desc,next_check_at,next_due_on,partner_id limit 1;
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
  v_candidate:=v_candidate||coalesce((select jsonb_build_object('send_not_after',least(slot.expires_at+interval '90 seconds',win.latest_start_at+interval '90 seconds'))
    from private.partner_send_slots slot join private.partner_send_windows win on win.id=slot.window_id
    where slot.partner_id=f.partner_id and slot.kind='sollecito' and slot.draft_id=f.draft_id and slot.status='scheduled'),'{}'::jsonb);
  update private.partner_assistant_mail_state set lease_token=gen_random_uuid(),
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),candidate_draft_id=f.draft_id,
    last_tick_at=clock_timestamp() where singleton returning lease_token into v_token;
  insert into private.partner_followup_leases(lease_token,conversation_id) values(v_token,f.id);
  update public.partner_assistant_followups set next_check_at=v_now+interval '30 minutes' where id=f.id;
  return jsonb_build_object('status','claimed','lease_token',v_token,'mode',v_mode,'candidate',v_candidate);
end
$$;

create or replace function public.record_partner_followup_check(p_lease_token uuid,p_conversation_id uuid,p_expected_version bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.partner_assistant_followups%rowtype; v_now timestamptz:=private.partner_followup_proof_now();
  v_result text; v_reason text; v_checked timestamptz; v_hash text; v_folders integer; v_count integer; v_id uuid; v_prepared uuid; v_related record; v_resume date; v_proof_now timestamptz; v_timezone text; v_local_day date;
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
  v_proof_now:=private.partner_followup_proof_now();
  v_now:=v_proof_now;
  update private.partner_followup_proofs set used_at=v_proof_now where conversation_id=f.id and used_at is null;
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
  if v_result='uncertain' or v_checked<v_proof_now-interval '60 seconds' or v_checked>v_proof_now+interval '5 seconds' or v_folders<3 then
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
  -- Il rientro e una data del destinatario. Roma resta la base delle quote e della cadenza.
  -- Calcolare soltanto dopo i lock, il clock fresco e la validazione del contesto.
  select content->>'timezone' into v_timezone from public.partner_assistant_notes where id=f.choice_note_id;
  perform private.partner_check(private.partner_assistant_valid_timezone(v_timezone));
  v_local_day:=(v_now at time zone v_timezone)::date;
  if v_result='deferred' then
    perform private.partner_check(v_resume>v_local_day and v_resume<=v_local_day+366);
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
    values(f.id,f.version,f.draft_id,v_prepared,p_lease_token,v_hash,v_checked,v_folders,v_count,v_proof_now,v_proof_now+interval '30 seconds') returning id into v_id;
  update public.partner_assistant_followups set last_checked_at=v_now,reason=null,
    deferred_until=case when deferred_until>v_local_day then deferred_until end,
    next_check_at=v_now+interval '30 minutes' where id=f.id;
  return jsonb_build_object('status','clear','proof_id',v_id,'expires_at',v_proof_now+interval '30 seconds');
end
$$;

create or replace function public.finish_partner_followup_send(p_lease_token uuid,p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.partner_assistant_followups%rowtype; m public.partner_assistant_messages%rowtype;
  v_actor uuid; v_replay jsonb; v_result jsonb; v_outcome text; v_code integer; v_enhanced text; v_spam boolean; v_reason text;
  v_now timestamptz:=private.partner_followup_proof_now(); v_number integer; v_first_day date;
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
  v_now:=private.partner_followup_proof_now();
  if m.send_status<>'scartato' then
    update public.partner_assistant_messages set send_status=v_outcome,smtp_code=v_code,enhanced_code=v_enhanced,
      outcome=v_reason,sent_at=case when v_outcome in ('inviato','incerto') then v_now end,updated_at=now() where id=m.id;
  end if;
  if v_outcome in ('inviato','incerto','respinto') then
    update private.partner_assistant_mail_state set next_send_after=v_now+interval '2 minutes' where singleton;
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

create function private.partner_send_followup_state() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'active' or new.version<>old.version or (new.last_checked_at is distinct from old.last_checked_at and new.reason is not null) then
   update private.partner_send_slots slots set status='skipped',reason=case when (select opens_at from private.partner_send_windows where id=slots.window_id)>private.partner_followup_proof_now()
     then 'ripianificato' else coalesce(new.reason,'contesto_cambiato') end
   where conversation_id=new.id and status='scheduled';
 end if;
 return new;
end
$$;
create trigger partner_send_followup_state after update on public.partner_assistant_followups
 for each row execute function private.partner_send_followup_state();

revoke all on function private.partner_send_snapshot(uuid,text,uuid,integer,timestamptz),
 private.partner_send_slot_reason(uuid,text,uuid,integer,timestamptz),private.partner_send_reserved(date,text,boolean,uuid),
 private.refresh_partner_send_plan(),private.partner_send_message_state(),private.partner_send_followup_state()
 from public,anon,authenticated,service_role;
revoke all on function public.read_partner_send_plan(date) from public,anon,authenticated,service_role;
grant execute on function public.read_partner_send_plan(date) to authenticated;
commit;
