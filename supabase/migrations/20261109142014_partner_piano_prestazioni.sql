-- Piano Partner: evitare tentativi per categorie senza candidati o senza quota.
-- Stessi snapshot, guardie, ordine, finestre e permessi. Nessun nuovo helper o indice.
begin;

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
     +least(3,v_available_other,count(*) filter(where j->>'kind'='primo' and not (j->>'flow_template')::boolean))
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
     +least(3,v_available_other,count(*) filter(where j->>'kind'='primo' and not (j->>'flow_template')::boolean))
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
               >=(case when c.j->>'kind'='primo' then 3 else 6 end) then continue; end if;
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

commit;
