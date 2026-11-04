-- Programma delle email Partner e revisione umana, 4 novembre 2026.
-- Nessuna modifica alle regole o all'accensione. Le bozze restano append-only;
-- un hold persistente ferma solo la bozza aperta nell'editor, fino a salva/annulla.
begin;

create table private.partner_email_edit_holds (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.partner_assistant_jobs(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  draft_id uuid not null references public.partner_assistant_drafts(id) on delete cascade,
  sha256 text not null,
  partner_version bigint not null,
  rules_version integer not null,
  contact_id uuid not null references public.partner_contacts(id) on delete cascade,
  contact_version bigint not null,
  address_sha256 text not null check(address_sha256 ~ '^[0-9a-f]{64}$'),
  research_note_id uuid not null references public.partner_assistant_notes(id) on delete cascade,
  choice_note_id uuid references public.partner_assistant_notes(id) on delete cascade,
  version bigint not null default 1,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles(user_id)
);
create unique index partner_email_edit_holds_active_job on private.partner_email_edit_holds(job_id)
  where closed_at is null;
create index partner_email_edit_holds_draft on private.partner_email_edit_holds(draft_id);
alter table private.partner_email_edit_holds enable row level security;
revoke all on private.partner_email_edit_holds from public, anon, authenticated, service_role;

-- Snapshot opaca della bozza reclamata con la lease: nessun indirizzo. Nessuna FK,
-- per non introdurre lock casella dopo partner durante la cancellazione di un recapito.
alter table private.partner_assistant_mail_state add column candidate_draft_id uuid;

create function private.partner_email_draft_held(p_draft_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from private.partner_email_edit_holds h where h.draft_id=p_draft_id and h.closed_at is null)
$$;

create function private.partner_email_manual_draft(p_draft_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.partner_assistant_drafts d join public.partner_assistant_notes n
    on n.partner_id=d.partner_id and n.kind='controllo' and n.content->'approved'='true'::jsonb
      and n.content->>'sha256'=d.sha256 and n.created_at>=d.created_at
    where d.id=p_draft_id and n.content->>'approval_source'='founder_edit')
$$;

-- Il contesto approvato dall'editor vale solo finché scheda, email, regole e scelta restano quelli.
create function private.partner_email_manual_stale(p_draft_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
 select private.partner_email_manual_draft(p_draft_id) and not exists(
  select 1 from public.partner_assistant_drafts d join public.partners p on p.id=d.partner_id
  join public.partner_assistant_jobs j on j.draft_id=d.id
  join public.partner_assistant_notes n on n.id=d.research_note_id
  join public.partner_contacts k on k.id=d.contact_id and k.kind='email' and k.active
  where d.id=p_draft_id and d.partner_version=p.version
   and d.rules_version=(select max(version) from public.partner_assistant_rules)
   and n.created_at>private.partner_assistant_now()-interval '21 days'
   and d.contact_id=(select contact_id from private.partner_assistant_email(p.id))
   and private.partner_assistant_address(k.link_value) is not null
   and exists(select 1 from public.partner_assistant_notes r where r.partner_id=p.id and r.kind='controllo'
    and r.content->>'approval_source'='founder_edit' and r.content->>'sha256'=d.sha256
    and r.content->'approved'='true'::jsonb and r.created_at>=d.created_at
    and r.content->>'choice_note_id'=j.choice_note_id::text
    and r.content->'contact_version'=to_jsonb(k.version)
    and r.content->>'address_sha256'=private.partner_assistant_address_sha256(private.partner_assistant_address(k.link_value))))
$$;

-- Guardia pura condivisa da dettaglio e apertura editor. Una lease SMTP scaduta non
-- rende modificabile un in_invio: il processo può avere già consegnato l'email.
create function private.partner_email_edit_reason(p_job_id uuid) returns text
language sql stable security invoker set search_path = '' as $$
  select case
    when j.id is null then 'non_pronta'
    when exists(select 1 from public.partner_assistant_messages m where m.partner_id=j.partner_id
      and m.mode='invio' and m.send_status='in_invio') then 'invio_in_corso'
    when exists(select 1 from public.partner_assistant_messages m where m.partner_id=j.partner_id
      and m.mode='invio' and m.send_status='incerto') then 'invio_incerto'
    when j.status='inviata' or exists(select 1 from public.partner_assistant_messages m where m.partner_id=j.partner_id
      and m.mode='invio' and m.send_status='inviato') then 'inviata'
    when j.status<>'pronta' or d.id is null then 'non_pronta'
    when not private.partner_assistant_eligible(j.partner_id) then 'non_idoneo'
    when n.created_at <= private.partner_assistant_now()-interval '21 days' then 'ricerca_scaduta'
    when d.rules_version is distinct from (select max(version) from public.partner_assistant_rules)
      or d.partner_version is distinct from p.version
      or d.contact_id is distinct from (select contact_id from private.partner_assistant_email(j.partner_id))
      or private.partner_assistant_address(k.link_value) is null or not coalesce(k.active,false)
      then 'contesto_cambiato'
    when not exists(select 1 from public.partner_assistant_notes r where r.partner_id=j.partner_id
      and r.kind='controllo' and r.content->'approved'='true'::jsonb and r.content->>'sha256'=d.sha256
      and r.created_at>=d.created_at) then 'contesto_cambiato'
    when d.sha256<>encode(sha256(convert_to(d.subject||E'\n\n'||d.body||E'\n\n'||d.signature,'UTF8')),'hex') then 'contesto_cambiato'
    when exists(select 1 from private.partner_assistant_test_runs t where d.id=any(t.draft_ids)
      and (exists(select 1 from private.partner_assistant_test_pairs(t.id,t.recipients))
        or exists(select 1 from public.partner_assistant_messages m where m.test_run_id=t.id and m.send_status in('pronto','in_invio'))))
      then 'prova_in_corso'
  end from (select p_job_id as id) x
    left join public.partner_assistant_jobs j on j.id=x.id
    left join public.partners p on p.id=j.partner_id
    left join public.partner_assistant_drafts d on d.id=j.draft_id
    left join public.partner_assistant_notes n on n.id=d.research_note_id
    left join public.partner_contacts k on k.id=d.contact_id and k.kind='email'
$$;

create function private.begin_partner_email_edit(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a uuid := private.partner_actor(); v_job uuid; v_draft uuid; v_sha text; v_partner uuid; why text;
  j public.partner_assistant_jobs%rowtype; d public.partner_assistant_drafts%rowtype;
  h private.partner_email_edit_holds%rowtype; replay jsonb; result jsonb;
begin
  if not private.is_founder() then raise exception 'partner_assistant_founder_required' using errcode='42501'; end if;
  perform private.partner_payload(p_payload,array['schema_version','job_id','expected_draft_id','expected_sha256'],array['schema_version','job_id','expected_draft_id','expected_sha256']);
  v_job:=private.partner_uuid(p_payload,'job_id'); v_draft:=private.partner_uuid(p_payload,'expected_draft_id');
  v_sha:=private.partner_text(p_payload,'expected_sha256',64);
  perform private.partner_check(v_job is not null and v_draft is not null and v_sha ~ '^[0-9a-f]{64}$');
  replay:=private.partner_assistant_begin(p_operation_id,'begin_partner_email_edit',a,p_payload);
  if replay is not null then return replay; end if;
  perform 1 from private.partner_assistant_mail_state where singleton for update;
  perform 1 from private.partner_assistant_config where singleton for share;
  perform pg_advisory_xact_lock(hashtextextended('luckylap.partner_assistant.rules',0));
  select partner_id into v_partner from public.partner_assistant_jobs where id=v_job;
  perform 1 from public.partners where id=v_partner for update;
  select * into j from public.partner_assistant_jobs where id=v_job for update;
  select * into d from public.partner_assistant_drafts where id=j.draft_id;
  if j.draft_id is distinct from v_draft or d.sha256 is distinct from v_sha then
    raise exception 'partner_changed' using errcode='40001';
  end if;
  why:=private.partner_email_edit_reason(v_job);
  if why is not null then raise exception 'partner_email_not_editable:%',why using errcode='55000'; end if;
  select * into h from private.partner_email_edit_holds where job_id=v_job and closed_at is null for update;
  if found then
    if h.created_by<>a or h.draft_id<>v_draft or h.sha256<>v_sha then
      raise exception 'partner_changed' using errcode='40001';
    end if;
  else
    insert into private.partner_email_edit_holds(job_id,partner_id,draft_id,sha256,partner_version,rules_version,
        contact_id,contact_version,address_sha256,research_note_id,choice_note_id,created_by)
      select j.id,j.partner_id,d.id,d.sha256,p.version,d.rules_version,d.contact_id,k.version,
          private.partner_assistant_address_sha256(private.partner_assistant_address(k.link_value)),d.research_note_id,j.choice_note_id,a
        from public.partners p join public.partner_contacts k on k.id=d.contact_id where p.id=j.partner_id returning * into h;
    update public.partner_assistant_messages set send_status='scartato',outcome='modifica_in_corso',updated_at=now()
      where draft_id=d.id and send_status='pronto';
    insert into private.partner_assistant_events(partner_id,step,outcome) values(j.partner_id,'controllo','modifica_iniziata');
  end if;
  result:=jsonb_build_object('id',h.id,'version',h.version,'holdId',h.id,'holdVersion',h.version,'replayed',false);
  return private.partner_assistant_finish(p_operation_id,'begin_partner_email_edit',a,p_payload,result);
end
$$;

create function private.save_partner_email_edit(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 a uuid:=private.partner_actor(); v_hold uuid; v_version bigint; v_draft uuid; v_sha text; v_subject text; v_body text;
 v_partner uuid; v_job uuid; h private.partner_email_edit_holds%rowtype; j public.partner_assistant_jobs%rowtype;
 d public.partner_assistant_drafts%rowtype; v_review uuid; v_new uuid; v_new_sha text; replay jsonb; result jsonb;
begin
 if not private.is_founder() then raise exception 'partner_assistant_founder_required' using errcode='42501'; end if;
 perform private.partner_payload(p_payload,array['schema_version','hold_id','expected_hold_version','expected_draft_id','expected_sha256','subject','body'],array['schema_version','hold_id','expected_hold_version','expected_draft_id','expected_sha256','subject','body']);
 v_hold:=private.partner_uuid(p_payload,'hold_id'); v_version:=private.partner_bigint(p_payload,'expected_hold_version',1,9007199254740991);
 v_draft:=private.partner_uuid(p_payload,'expected_draft_id'); v_sha:=private.partner_text(p_payload,'expected_sha256',64);
 v_subject:=private.partner_text(p_payload,'subject',300); v_body:=private.partner_text(p_payload,'body',8000);
 perform private.partner_check(v_hold is not null and v_version is not null and v_draft is not null
   and v_sha ~ '^[0-9a-f]{64}$' and v_subject ~ '\S' and v_subject !~ E'[\r\n]' and v_body ~ '\S');
 replay:=private.partner_assistant_begin(p_operation_id,'save_partner_email_edit',a,p_payload);
 if replay is not null then return replay; end if;
 perform 1 from private.partner_assistant_mail_state where singleton for update;
 perform 1 from private.partner_assistant_config where singleton for share;
 perform pg_advisory_xact_lock(hashtextextended('luckylap.partner_assistant.rules',0));
 select partner_id,job_id into v_partner,v_job from private.partner_email_edit_holds where id=v_hold;
 perform 1 from public.partners where id=v_partner for update;
 select * into j from public.partner_assistant_jobs where id=v_job for update;
 select * into h from private.partner_email_edit_holds where id=v_hold for update;
 select * into d from public.partner_assistant_drafts where id=j.draft_id;
 if h.id is null or h.closed_at is not null or h.created_by<>a or h.version<>v_version
   or h.draft_id<>v_draft or h.sha256<>v_sha or j.draft_id is distinct from v_draft
   or d.sha256 is distinct from v_sha or h.partner_version is distinct from (select version from public.partners where id=v_partner)
   or h.rules_version is distinct from (select max(version) from public.partner_assistant_rules)
   or h.choice_note_id is distinct from j.choice_note_id or h.research_note_id is distinct from d.research_note_id
   or h.contact_id is distinct from d.contact_id
   or h.contact_version is distinct from (select version from public.partner_contacts where id=h.contact_id)
   or h.address_sha256 is distinct from (select private.partner_assistant_address_sha256(private.partner_assistant_address(link_value)) from public.partner_contacts where id=h.contact_id) then raise exception 'partner_changed' using errcode='40001'; end if;
 if private.partner_email_edit_reason(j.id) is not null then
   raise exception 'partner_email_not_editable' using errcode='55000'; end if;
 select id into v_review from public.partner_assistant_notes where partner_id=v_partner and kind='controllo'
   and content->'approved'='true'::jsonb and content->>'sha256'=d.sha256 and created_at>=d.created_at
   order by created_at desc,id desc limit 1;
 v_new_sha:=encode(sha256(convert_to(v_subject||E'\n\n'||v_body||E'\n\n'||d.signature,'UTF8')),'hex');
 insert into public.partner_assistant_drafts(partner_id,contact_id,partner_version,language,subject,body,signature,sha256,
   rules_version,research_note_id,operation_id,created_by)
 values(v_partner,d.contact_id,d.partner_version,d.language,v_subject,v_body,d.signature,v_new_sha,d.rules_version,d.research_note_id,p_operation_id,a)
 returning id into v_new;
 insert into public.partner_assistant_notes(partner_id,kind,content,rules_version,model,operation_id,created_by)
 values(v_partner,'controllo',jsonb_build_object('approved',true,'problems','[]'::jsonb,'sha256',v_new_sha,
   'approval_source','founder_edit','previous_draft_id',d.id,'previous_review_id',v_review,'choice_note_id',j.choice_note_id,
   'contact_version',h.contact_version,'address_sha256',h.address_sha256),d.rules_version,null,p_operation_id,a);
 update public.partner_assistant_messages set send_status='scartato',outcome='modifica_in_corso',updated_at=now()
   where draft_id=d.id and send_status='pronto';
 update public.partner_assistant_jobs set draft_id=v_new,updated_at=now() where id=j.id;
 update private.partner_email_edit_holds set version=version+1,closed_at=now(),closed_by=a where id=h.id returning * into h;
 insert into private.partner_assistant_events(partner_id,step,outcome) values(v_partner,'controllo','modifica_salvata');
 result:=jsonb_build_object('id',v_new,'version',h.version,'draftId',v_new,'sha256',v_new_sha,'status','pronta','holdClosed',true,'replayed',false);
 return private.partner_assistant_finish(p_operation_id,'save_partner_email_edit',a,p_payload,result);
end
$$;

create function private.cancel_partner_email_edit(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 a uuid:=private.partner_actor(); v_hold uuid; v_version bigint; v_draft uuid; v_partner uuid; v_job uuid;
 h private.partner_email_edit_holds%rowtype; j public.partner_assistant_jobs%rowtype; replay jsonb; result jsonb; v_resume text;
begin
 if not private.is_founder() then raise exception 'partner_assistant_founder_required' using errcode='42501'; end if;
 perform private.partner_payload(p_payload,array['schema_version','hold_id','expected_hold_version','expected_draft_id'],array['schema_version','hold_id','expected_hold_version','expected_draft_id']);
 v_hold:=private.partner_uuid(p_payload,'hold_id'); v_version:=private.partner_bigint(p_payload,'expected_hold_version',1,9007199254740991);
 v_draft:=private.partner_uuid(p_payload,'expected_draft_id');
 perform private.partner_check(v_hold is not null and v_version is not null and v_draft is not null);
 replay:=private.partner_assistant_begin(p_operation_id,'cancel_partner_email_edit',a,p_payload);
 if replay is not null then return replay; end if;
 perform 1 from private.partner_assistant_mail_state where singleton for update;
 perform 1 from private.partner_assistant_config where singleton for share;
 perform pg_advisory_xact_lock(hashtextextended('luckylap.partner_assistant.rules',0));
 select partner_id,job_id into v_partner,v_job from private.partner_email_edit_holds where id=v_hold;
 perform 1 from public.partners where id=v_partner for update;
 select * into j from public.partner_assistant_jobs where id=v_job for update;
 select * into h from private.partner_email_edit_holds where id=v_hold for update;
 if h.id is null or h.closed_at is not null or h.created_by<>a or h.version<>v_version or h.draft_id<>v_draft
   or j.draft_id is distinct from v_draft then raise exception 'partner_changed' using errcode='40001'; end if;
 v_resume:=case when private.partner_email_edit_reason(j.id) is null and h.partner_version=(select version from public.partners where id=v_partner)
   and h.rules_version=(select max(version) from public.partner_assistant_rules)
   and h.choice_note_id is not distinct from j.choice_note_id
   and h.research_note_id is not distinct from (select research_note_id from public.partner_assistant_drafts where id=j.draft_id)
   and h.contact_id is not distinct from (select contact_id from public.partner_assistant_drafts where id=j.draft_id)
   and h.contact_version is not distinct from (select version from public.partner_contacts where id=h.contact_id)
   and h.address_sha256 is not distinct from (select private.partner_assistant_address_sha256(private.partner_assistant_address(link_value)) from public.partner_contacts where id=h.contact_id) then 'pronta' else 'serve_tommaso' end;
 if v_resume='serve_tommaso' then
   update public.partner_assistant_jobs set status='serve_tommaso',reason='bozza_manuale_da_rivedere',updated_at=now() where id=j.id;
 end if;
 update private.partner_email_edit_holds set version=version+1,closed_at=now(),closed_by=a where id=h.id returning * into h;
 insert into private.partner_assistant_events(partner_id,step,outcome) values(v_partner,'controllo','modifica_annullata');
 result:=jsonb_build_object('id',h.id,'version',h.version,'cancelled',true,'resumeState',v_resume,'replayed',false);
 return private.partner_assistant_finish(p_operation_id,'cancel_partner_email_edit',a,p_payload,result);
end
$$;

-- Finestre [start,end), già ridotte del margine SMTP di90secondi, separate per giorno Roma.
create function private.partner_email_windows(p_from date,p_days integer,p_timezone text,p_country text) returns jsonb
language sql stable security invoker set search_path = '' as $$
 with zone as (select case when private.partner_assistant_valid_timezone(p_timezone) then p_timezone else 'Europe/Rome' end as z),
 days as (select p_from+i as day from generate_series(0,p_days-1) i),
 windows as (
 select d.day,greatest(((d.day+k)+time '09:30') at time zone z.z,d.day::timestamp at time zone 'Europe/Rome') as a,
 least(((d.day+k)+time '10:58:30') at time zone z.z,(d.day+1)::timestamp at time zone 'Europe/Rome') as b
 from days d cross join zone z cross join generate_series(-1,1) k
 where private.partner_assistant_window_open(z.z,p_country,((d.day+k)+time '09:30') at time zone z.z,interval '90 seconds')
 ) select coalesce(jsonb_agg(jsonb_build_object('day',day,'start',a,'end',b) order by a),'[]'::jsonb) from windows where a<b
$$;

create function private.read_partner_email_program(p_from date,p_days integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_total integer; v_sent integer; v_unprepared_total integer; v_unprepared jsonb; v_items jsonb; v_history jsonb; v_now timestamptz:=private.partner_assistant_now();
begin
 perform private.partner_actor();
 if p_from is null or not isfinite(p_from) or p_days is null or p_days not between 1 and 90 then
   raise exception 'invalid_partner_payload' using errcode='22023'; end if;
 select count(*) into v_total from public.partner_assistant_jobs;
 select count(*) into v_unprepared_total from private.partner_assistant_queue(private.partner_assistant_rome_day(v_now));
 select count(*) into v_sent from public.partner_assistant_messages where coalesce(sent_at,created_at)>=p_from::timestamp at time zone 'Europe/Rome'
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
  'sections',r.sections,'flow',case when r.template then 'club' else 'altri' end,'status',r.status,'step',r.step,
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
 where coalesce(m.sent_at,m.created_at)>=p_from::timestamp at time zone 'Europe/Rome'
  and coalesce(m.sent_at,m.created_at)<(p_from+p_days)::timestamp at time zone 'Europe/Rome';
 return jsonb_build_object('generatedAt',v_now,'from',p_from,'days',p_days,
 'config',(select jsonb_build_object('mode',mode,'pausedReason',paused_reason,'backoffUntil',backoff_until,
   'dailyFirstLimit',daily_first_limit,'firstRealOn',private.partner_assistant_first_real_day(),
   'currentRulesVersion',(select max(version) from public.partner_assistant_rules)) from private.partner_assistant_config where singleton),
 'mail',(select jsonb_build_object('stopReason',stop_reason,'backoffUntil',backoff_until,'dayStoppedOn',day_stopped_on,
   'nextSendAfter',next_send_after) from private.partner_assistant_mail_state where singleton),
 'todaySent',jsonb_build_object('club',private.partner_assistant_flow_sent(private.partner_assistant_rome_day(v_now),true),
   'altri',private.partner_assistant_flow_sent(private.partner_assistant_rome_day(v_now),false)),
 'items',v_items,'unprepared',v_unprepared,'sent',v_history,'counts',jsonb_build_object('total',v_total,'returned',jsonb_array_length(v_items),
   'unpreparedTotal',v_unprepared_total,'unpreparedReturned',jsonb_array_length(v_unprepared)));
end
$$;

create function private.read_partner_email_detail(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare j public.partner_assistant_jobs%rowtype; d public.partner_assistant_drafts%rowtype;
 m public.partner_assistant_messages%rowtype; p public.partners%rowtype; h private.partner_email_edit_holds%rowtype;
 n public.partner_assistant_notes%rowtype; s public.partner_assistant_notes%rowtype; why text; v_address text; v_book text;
begin
 perform private.partner_actor();
 if p_kind is null or p_kind not in('draft','sent','job') or p_id is null then raise exception 'invalid_partner_payload' using errcode='22023'; end if;
 if p_kind='sent' then
   select * into m from public.partner_assistant_messages where id=p_id;
   if not found then raise exception 'partner_email_not_found' using errcode='22023'; end if;
   select * into j from public.partner_assistant_jobs where partner_id=m.partner_id;
   select * into d from public.partner_assistant_drafts where id=m.draft_id;
   select * into p from public.partners where id=m.partner_id;
   v_address:=case when m.erased_at is null then m.to_address end; v_book:=m.lookbook->>'code'; why:='inviata';
 else
   if p_kind='job' then select * into j from public.partner_assistant_jobs where id=p_id;
   else select * into j from public.partner_assistant_jobs where draft_id=p_id; end if;
   if j.id is null then raise exception 'partner_email_not_found' using errcode='22023'; end if;
   select * into d from public.partner_assistant_drafts where id=j.draft_id;
   select * into p from public.partners where id=j.partner_id;
   select private.partner_assistant_address(link_value) into v_address from public.partner_contacts where id=d.contact_id and active;
   v_book:=private.partner_assistant_send_lookbook(d.id,'invio',null)->>'code';
   why:=private.partner_email_edit_reason(j.id);
   if not private.is_founder() then why:='solo_founder'; end if;
 end if;
 select * into n from public.partner_assistant_notes where id=coalesce(d.research_note_id,j.research_note_id);
 select * into s from public.partner_assistant_notes where id=j.choice_note_id;
 if p_kind='sent' and (j.draft_id is distinct from m.draft_id or s.created_at>m.created_at) then s:=null; end if;
 if p_kind<>'sent' then select * into h from private.partner_email_edit_holds where job_id=j.id and closed_at is null; end if;
 return jsonb_build_object('kind',p_kind,'id',p_id,'jobId',j.id,'partnerId',p.id,'co',p.co,'name',p.name,'sections',p.sections,
 'draftId',d.id,'subject',case when p_kind='sent' then m.subject else d.subject end,'body',case when p_kind='sent' then m.body else d.body end,
 'signature',case when p_kind<>'sent' then d.signature end,'language',d.language,'register',s.content->>'register',
 'address',v_address,'lookbookCode',v_book,'sha256',case when p_kind='sent' then m.sha256 else d.sha256 end,
 'rulesVersion',case when p_kind='sent' then m.rules_version else d.rules_version end,
 'createdAt',case when p_kind='sent' then m.created_at else coalesce(d.created_at,j.created_at) end,'sentAt',m.sent_at,
 'choiceReason',s.content->>'reason_it','researchSources',coalesce(to_jsonb(n.sources),'[]'::jsonb),
 'hold',case when h.id is not null then jsonb_build_object('id',h.id,'version',h.version,'createdAt',h.created_at) end,
 'editable',p_kind<>'sent' and why is null,'whyNotEditable',why,'status',j.status,'step',j.step,'reason',j.reason);
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
      where j.status = 'pronta' and private.partner_assistant_eligible(p.id) and not private.partner_email_draft_held(d.id)) o
    order by o.rank;
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
  v_now := private.partner_assistant_now();
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

create or replace function private.partner_assistant_send_move(p_partner_id uuid, p_draft_id uuid, p_reason text)
returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if private.partner_email_manual_draft(p_draft_id) and p_reason in('ricerca_scaduta','recapito_cambiato','regole_superate','bozza_scaduta','bozza_manuale_da_rivedere') then
    update public.partner_assistant_jobs set status='serve_tommaso',reason='bozza_manuale_da_rivedere',
      lease_token=null,lease_expires_at=null,updated_at=now()
      where partner_id=p_partner_id and status='pronta' and draft_id=p_draft_id;
  elsif p_reason = 'ricerca_scaduta' then
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
    update public.partner_assistant_jobs j set status = case when (private.partner_email_manual_draft(j.draft_id) or private.partner_email_draft_held(j.draft_id)) then 'serve_tommaso' else 'in_coda' end,
        step = case when (private.partner_email_manual_draft(j.draft_id) or private.partner_email_draft_held(j.draft_id)) then j.step else 'scrittura' end, attempts = 0, rewrites = 0,
        reason = case when (private.partner_email_manual_draft(j.draft_id) or private.partner_email_draft_held(j.draft_id)) then 'bozza_manuale_da_rivedere' else null end, lease_token = null, lease_expires_at = null, next_attempt_at = now(), updated_at = now()
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

create or replace function private.claim_partner_assistant_step(p_worker_id uuid, p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c private.partner_assistant_config%rowtype;
  j public.partner_assistant_jobs%rowtype;
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_templates_full boolean;
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
  -- Note del modello su un contatto che non usa più il modello: si riparte dalla ricerca.
  update public.partner_assistant_jobs l set step = 'ricerca', research_note_id = null, choice_note_id = null,
      draft_id = null, rewrites = 0, updated_at = now()
    where l.status = 'in_coda' and l.step in ('estrazione', 'scrittura')
      and private.partner_assistant_is_template(l.research_note_id)
      and not private.partner_assistant_uses_template(l.partner_id);
  -- Bozze del modello pronte da inviare: al tetto, i contatti del modello prima del controllo non si
  -- prendono.
  v_templates_full := (select count(*) from public.partner_assistant_jobs pj
      join public.partner_assistant_drafts d on d.id = pj.draft_id
    where pj.status = 'pronta' and private.partner_assistant_eligible(pj.partner_id)
      and private.partner_assistant_is_template(d.research_note_id)) >= 20;
  -- Una bozza modificata da Tommi non si riscrive automaticamente, qualunque sia il ritorno indietro.
  update public.partner_assistant_jobs l set status='serve_tommaso',reason='bozza_manuale_da_rivedere',
      lease_token=null,lease_expires_at=null,updated_at=now()
    where l.status='in_coda' and private.partner_email_manual_draft(l.draft_id);
  -- Il primo lavoro pronto, nell'ordine della coda, con il contatto ancora idoneo: la classifica
  -- della coda contiene solo i contatti idonei.
  select l.* into j from public.partner_assistant_jobs l
    join private.partner_assistant_ranking(v_today) r on r.partner_id = l.partner_id
    where l.status = 'in_coda' and l.next_attempt_at <= now() and l.attempts < 3
      and not exists(select 1 from private.partner_email_edit_holds h where h.job_id=l.id and h.closed_at is null)
      and not (v_templates_full and l.step <> 'controllo' and private.partner_assistant_uses_template(l.partner_id))
    order by r.rank
    limit 1
    for update of l skip locked;
  if not found then return jsonb_build_object('status', 'idle', 'reason', 'vuota'); end if;
  -- Ricerca ancora buona: non si rifà, si riparte dall'estrazione.
  if j.step = 'ricerca'
    and exists (select 1 from public.partner_assistant_notes n
        join public.partners p on p.id = j.partner_id
      where n.id = j.research_note_id and n.created_at > now() - interval '14 days'
        and p.updated_at <= n.created_at and not private.partner_assistant_is_template(n.id))
    and exists (select 1 from public.partner_assistant_notes s
      where s.id = j.choice_note_id and s.content ->> 'fact_text' ~ '\S' and s.content ->> 'timezone' ~ '\S'
        and coalesce(nullif(s.content ->> 'event_starts_on', '')::date > v_today,
          s.content ->> 'event_name' !~ '\S')) then
    update public.partner_assistant_jobs set step = 'estrazione', choice_note_id = null, draft_id = null,
        rewrites = 0, attempts = 0, next_attempt_at = now()
      where partner_id = j.partner_id;
  end if;
  update public.partner_assistant_jobs set lease_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds), updated_at = now()
    where partner_id = j.partner_id
    returning * into j;
  return jsonb_build_object('status', 'claimed', 'job', jsonb_build_object('job_id', j.id, 'partner_id', j.partner_id,
    'step', j.step, 'lease_token', j.lease_token, 'lease_expires_at', j.lease_expires_at, 'attempts', j.attempts,
    'rewrites', j.rewrites));
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
  if v_active and exists(select 1 from public.partner_assistant_jobs j join private.partner_email_edit_holds h on h.job_id=j.id and h.closed_at is null where j.partner_id=v_partner and j.status='serve_tommaso') then
    raise exception 'partner_email_edit_active' using errcode='55000';
  end if;
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

create or replace function private.release_partner_assistant_send(p_lease_token uuid, p_payload jsonb) returns jsonb
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
  update private.partner_assistant_mail_state set lease_token = null, lease_expires_at = null, candidate_draft_id = null, last_outcome = v_outcome,
      smtp_login_at = case when v_smtp is null then smtp_login_at else v_now end,
      smtp_login_code = coalesce(v_smtp, smtp_login_code),
      imap_login_at = case when v_imap is null then imap_login_at else v_now end,
      imap_login_code = coalesce(v_imap, imap_login_code)
    where singleton;
  return jsonb_build_object('status', 'done');
end
$$;

create function public.read_partner_email_program(p_from date,p_days integer) returns jsonb
language sql security invoker set search_path = '' as $$ select private.read_partner_email_program(p_from,p_days) $$;

create function public.read_partner_email_detail(p_kind text,p_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.read_partner_email_detail(p_kind,p_id) $$;

create function public.begin_partner_email_edit(p_operation_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.begin_partner_email_edit(p_operation_id,p_payload) $$;

create function public.save_partner_email_edit(p_operation_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.save_partner_email_edit(p_operation_id,p_payload) $$;

create function public.cancel_partner_email_edit(p_operation_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.cancel_partner_email_edit(p_operation_id,p_payload) $$;

revoke all on function private.partner_email_draft_held(uuid), private.partner_email_manual_draft(uuid),
 private.partner_email_manual_stale(uuid), private.partner_email_edit_reason(uuid), private.partner_email_windows(date,integer,text,text) from public,anon,authenticated,service_role;
revoke all on function private.read_partner_email_program(date,integer),public.read_partner_email_program(date,integer) from public,anon,authenticated,service_role;
grant execute on function private.read_partner_email_program(date,integer),public.read_partner_email_program(date,integer) to authenticated;
revoke all on function private.read_partner_email_detail(text,uuid),public.read_partner_email_detail(text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.read_partner_email_detail(text,uuid),public.read_partner_email_detail(text,uuid) to authenticated;
revoke all on function private.begin_partner_email_edit(uuid,jsonb),public.begin_partner_email_edit(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.begin_partner_email_edit(uuid,jsonb),public.begin_partner_email_edit(uuid,jsonb) to authenticated;
revoke all on function private.save_partner_email_edit(uuid,jsonb),public.save_partner_email_edit(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.save_partner_email_edit(uuid,jsonb),public.save_partner_email_edit(uuid,jsonb) to authenticated;
revoke all on function private.cancel_partner_email_edit(uuid,jsonb),public.cancel_partner_email_edit(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.cancel_partner_email_edit(uuid,jsonb),public.cancel_partner_email_edit(uuid,jsonb) to authenticated;

commit;
