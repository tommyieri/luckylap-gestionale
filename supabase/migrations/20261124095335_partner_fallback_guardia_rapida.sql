-- Lo stato della prova precede il catalogo: nessuna scansione senza una prova utilizzabile.
begin;

create or replace function private.partner_event_fallback_check(p_at timestamptz) returns bigint
language plpgsql stable security invoker set search_path='' as $$
declare c private.partner_event_exhaustion_checks%rowtype; v_day date; v_catalog jsonb;
begin
 if p_at is null then return null; end if;
 select * into c from private.partner_event_exhaustion_checks order by id desc limit 1;
 if not found then return null; end if;
 if not c.exhausted or p_at<c.created_at or p_at>=c.valid_until then return null; end if;
 v_day:=private.partner_assistant_rome_day(p_at);
 if v_day<private.partner_event_priority_from() then return null; end if;
 if not exists(select 1 from public.memberships m where m.user_id=c.checked_by and m.active and m.role='founder') then
   return null;
 end if;
 -- Lo stesso JSON serve per impronta e contatti: una sola lettura del catalogo per prova valida.
 v_catalog:=private.partner_event_priority_catalog(v_day);
 if c.catalog_sha256 is distinct from encode(sha256(convert_to(v_catalog::text,'UTF8')),'hex') then return null; end if;
 if exists(select 1 from jsonb_array_elements(v_catalog) x where x->'contactable'='true'::jsonb) then return null; end if;
 return c.id;
end
$$;

-- Le letture collettive condividono la prova; le guardie operative restano nell'helper base.
create or replace function private.partner_assistant_ranking(p_day date)
returns table (partner_id uuid, co integer, rank bigint)
language sql stable security invoker set search_path = '' as $$
  with context as materialized (select
    private.partner_assistant_rome_day(private.partner_assistant_now()) as current_day,
    private.partner_event_fallback_check(private.partner_assistant_now()) as fallback_id)
  select p.id, p.co, row_number() over (order by
      coalesce((select s.send_priority from public.partner_assistant_contacts s where s.partner_id = p.id), 0) desc,
      (date_trunc('month', coalesce(p.next_action_on, p.contact_month)::timestamp)
        <= date_trunc('month', p_day::timestamp) + interval '2 months') desc,
      array_position(array['alta', 'media', 'bassa']::text[], p.priority),
      date_trunc('month', coalesce(p.next_action_on, p.contact_month)::timestamp),
      p.co)
  from public.partners p cross join context c
  where private.partner_assistant_base_eligible(p.id)
    and (c.current_day<private.partner_event_first_from()
      or ('eventi'=any(p.sections) and private.partner_event_first_country(p.country))
      or c.fallback_id is not null)
$$;

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
  (private.partner_assistant_base_eligible(p.id)
    and (private.partner_assistant_rome_day(v_now)<private.partner_event_first_from()
      or ('eventi'=any(p.sections) and private.partner_event_first_country(p.country))
      or v_fallback.id is not null)) as eligible,
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
  'fallbackWindow',case
    when v_fallback.id is null then null
    when r.d_id is null or r.draft_at<v_fallback.created_at or r.draft_at>v_now then null
    when coalesce(r.choice->>'contact_kind'='evento',false) or coalesce(r.choice->>'request'='stand_evento',false) then null
    else case when private.partner_first_policy_allows(r.d_id,v_now)
      then jsonb_build_object('start',v_fallback.created_at,'end',v_fallback.valid_until) end
    end,'flow',case when r.template then 'club' else 'altri' end,'status',r.status,'step',r.step,
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


commit;
