-- Registra una risposta umana accertata dal controllo della posta. Nessun corpo ricevuto,
-- indirizzo o Message-ID in chiaro viene conservato. Non autorizza alcun invio.
begin;

create table private.partner_followup_reply_receipts (
  message_id_sha256 text primary key check(message_id_sha256 ~ '^[0-9a-f]{64}$'),
  conversation_id uuid not null references public.partner_assistant_followups(id) on delete cascade,
  activity_id uuid not null references public.partner_activities(id) on delete cascade,
  received_at timestamptz not null
);
alter table private.partner_followup_reply_receipts enable row level security;
revoke all on private.partner_followup_reply_receipts from public,anon,authenticated,service_role;

alter table public.partner_assistant_followups add column reply_review_attempts smallint not null default 0
  check(reply_review_attempts between 0 and 2);

create function public.record_partner_followup_reply(
  p_lease_token uuid,p_conversation_id uuid,p_expected_version bigint,p_reply jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  f public.partner_assistant_followups%rowtype;
  p public.partners%rowtype;
  m public.partner_assistant_messages%rowtype;
  v_actor uuid; v_activity uuid; v_previous uuid; v_operation uuid; v_stage text;
  v_message_id text; v_hash text; v_from text; v_subject text; v_received_text text;
  v_received timestamptz; v_now timestamptz; v_references text[]; v_status text;
  v_id_pattern constant text := '^<[^<>[:space:]@[:cntrl:]]{1,250}@[^<>[:space:]@[:cntrl:]]{1,250}>$';
  v_stale constant jsonb := '{"status":"stale"}';
begin
  perform private.partner_assistant_service_required();
  perform private.partner_keys(p_reply,array['message_id','references','from_address','received_at','subject'],
    array['message_id','references','from_address','received_at','subject']);
  v_message_id:=private.partner_text(p_reply,'message_id',254);
  v_from:=private.partner_assistant_address(private.partner_text(p_reply,'from_address',254));
  v_subject:=private.partner_text(p_reply,'subject',300);
  v_received_text:=private.partner_text(p_reply,'received_at',30);
  perform private.partner_check(v_message_id ~ v_id_pattern and octet_length(v_message_id)=char_length(v_message_id)
    and v_from is not null and v_subject is not null and v_subject !~ '[[:cntrl:]]'
    and position(chr(8232) in v_subject)=0 and position(chr(8233) in v_subject)=0
    and v_received_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
    and jsonb_typeof(p_reply->'references')='array');
  perform private.partner_check(jsonb_array_length(p_reply->'references') between 1 and 64
    and not exists(select 1 from jsonb_array_elements(p_reply->'references') as r(value)
      where jsonb_typeof(r.value)<>'string' or (r.value #>> '{}') !~ v_id_pattern
        or r.value #>> '{}'=v_message_id or octet_length(r.value #>> '{}')>254
        or octet_length(r.value #>> '{}')<>char_length(r.value #>> '{}')));
  select array_agg(distinct r.value) into v_references from jsonb_array_elements_text(p_reply->'references') as r(value);
  perform private.partner_check(cardinality(v_references)=jsonb_array_length(p_reply->'references'));
  v_received:=v_received_text::timestamptz;
  v_hash:=encode(sha256(convert_to(v_message_id,'UTF8')),'hex');

  -- Stesso ordine dei lock di prepare/start: casella, configurazioni, scheda, conversazione.
  if not private.partner_assistant_mail_guard(p_lease_token,true) then return v_stale; end if;
  perform 1 from private.partner_assistant_config where singleton and mode<>'spento' for share;
  if not found then return v_stale; end if;
  perform 1 from private.partner_followup_config where singleton and mode<>'spento' for share;
  if not found then return v_stale; end if;
  v_actor:=private.partner_assistant_as_actor();
  if v_actor is null then return v_stale; end if;
  select * into f from public.partner_assistant_followups where id=p_conversation_id;
  if not found then return v_stale; end if;
  select * into p from public.partners where id=f.partner_id for update;
  if not found then return v_stale; end if;
  select * into f from public.partner_assistant_followups where id=p_conversation_id for update;
  if not found or not exists(select 1 from private.partner_followup_leases l
    where l.lease_token=p_lease_token and l.conversation_id=f.id) then return v_stale; end if;
  select conversation_id into v_previous from private.partner_followup_reply_receipts where message_id_sha256=v_hash;
  if found then
    if v_previous=f.id then return jsonb_build_object('status','already_recorded'); end if;
    return v_stale;
  end if;
  if f.version is distinct from p_expected_version
    or not (f.status='active' or (f.status='held' and coalesce(f.reason in ('reply','ambiguous','risposta_trovata'),false)))
    or not private.partner_assistant_mail_guard(p_lease_token,true) then return v_stale; end if;

  v_now:=private.partner_followup_proof_now();
  select * into m from public.partner_assistant_messages where id=f.first_message_id;
  if not found or m.partner_id<>p.id or m.kind<>'primo' or m.mode<>'invio' or m.send_status<>'inviato'
    or m.erased_at is not null or m.sent_at is null or v_received<m.sent_at or v_received>v_now
    or exists(select 1 from public.partner_assistant_messages a where a.message_id=v_message_id)
    or not exists(select 1 from public.partner_contacts k where k.partner_id=p.id and k.kind='email'
      and k.active and k.erased_at is null and private.partner_assistant_address(k.link_value)=v_from
      and (k.verified or (k.id=f.contact_id and private.partner_assistant_address_sha256(v_from)=m.address_sha256)))
    or not exists(select 1 from public.partner_assistant_messages a where a.message_id=any(v_references)
      and a.partner_id=p.id and a.mode='invio' and a.send_status='inviato' and a.erased_at is null
      and a.sent_at<=v_received)
    or exists(select 1 from public.partner_assistant_messages a where a.message_id=any(v_references)
      and a.partner_id<>p.id and a.mode='invio' and a.send_status in ('inviato','incerto')) then return v_stale; end if;

  -- La riga della scheda serializza anche «Ha risposto» registrato a mano durante il controllo.
  select a.id into v_activity from public.partner_activities a where a.partner_id=p.id and a.kind='risposta'
    and a.occurred_at>=m.sent_at order by a.occurred_at,a.id limit 1;
  if v_activity is null then
    v_stage:=case when p.stage in ('da_contattare','contattato') then 'risposto' else p.stage end;
    v_operation:=gen_random_uuid();
    if v_stage<>p.stage then perform private.apply_partner_stage(p.id,v_stage,v_actor,v_operation,false); end if;
    v_activity:=private.partner_log(v_operation,p.id,'risposta',v_actor,p_stage_before=>p.stage,
      p_stage_after=>v_stage,p_channel=>'email',p_body=>v_subject,p_origin=>'assistente',p_occurred_at=>v_received);
    v_status:='registered';
  else
    v_status:='already_recorded';
  end if;
  insert into private.partner_followup_reply_receipts(message_id_sha256,conversation_id,activity_id,received_at)
    values(v_hash,f.id,v_activity,v_received);

  perform private.partner_followup_suppress(p.id,f.address_sha256,'possible_response');
  perform private.partner_followup_close_tasks(p.id);
  -- I vecchi compiti di verifica non hanno un link al ciclo: chiude solo il compito
  -- dell'assistente con il CO e il motivo di quella precisa verifica.
  if f.status='held' then
    update public.tasks t set status='done' where t.created_by=v_actor and t.status<>'done'
      and t.title like 'Controllare risposta · %' and t.description='Partner CO '||p.co||' · '||f.reason;
  end if;
  update private.partner_followup_drafts set invalidated_at=v_now where draft_id=f.draft_id and invalidated_at is null;
  update private.partner_followup_proofs set used_at=v_now where conversation_id=f.id and used_at is null;
  update public.partner_assistant_messages set send_status='scartato',outcome='risposta_registrata',updated_at=now()
    where partner_id=p.id and kind='sollecito' and send_status='pronto';
  update public.partner_assistant_followups set status='replied',reason='risposta_registrata',version=version+1,
    draft_id=null,next_due_on=null,deferred_until=null,last_checked_at=v_now,updated_at=now() where id=f.id;
  insert into private.partner_assistant_events(partner_id,step,outcome) values(p.id,'sollecito','risposta_registrata');
  return jsonb_build_object('status',v_status);
end
$$;

-- Rivede al massimo due volte, a distanza di un giorno, un vecchio fermo per possibile risposta.
-- Non prepara un MIME né riapre il ciclo. La lease è la stessa della posta, ma senza rubare slot.
create function public.claim_partner_followup_reply_review(p_worker_id uuid,p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  s private.partner_assistant_mail_state%rowtype;
  c private.partner_assistant_config%rowtype;
  f public.partner_assistant_followups%rowtype;
  v_mode text; v_now timestamptz; v_token uuid; v_candidate jsonb;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_check(p_worker_id is not null and p_lease_seconds between 60 and 600);
  select * into s from private.partner_assistant_mail_state where singleton for update;
  select * into c from private.partner_assistant_config where singleton for share;
  select mode into v_mode from private.partner_followup_config where singleton for share;
  if s.singleton is null or c.actor_id is null or c.handoff_to is null or v_mode is null then
    return jsonb_build_object('status','idle','reason','non_configurato');
  end if;
  if c.mode='spento' or v_mode='spento' then return jsonb_build_object('status','idle','reason','spento'); end if;
  if s.lease_expires_at>clock_timestamp() then return jsonb_build_object('status','idle','reason','occupato'); end if;
  v_now:=private.partner_followup_proof_now();
  if s.stop_reason='casella' or s.backoff_until>v_now then
    return jsonb_build_object('status','idle','reason','attesa');
  end if;
  -- Anche una lease interrotta deve scadere prima dell'inizio del prossimo slot.
  if exists(select 1 from private.partner_send_slots x where x.status='scheduled'
    and x.expires_at>v_now and x.planned_at<=v_now+make_interval(secs=>p_lease_seconds)) then
    return jsonb_build_object('status','idle','reason','intervallo');
  end if;

  select q.* into f from public.partner_assistant_followups q
    join public.partner_assistant_messages m on m.id=q.first_message_id
    join public.partner_assistant_drafts d on d.id=m.draft_id
    join public.partner_assistant_notes n on n.id=q.choice_note_id
    join public.partner_contacts k on k.id=q.contact_id
    where q.status='held' and q.reason in ('reply','ambiguous','risposta_trovata')
      and q.reply_review_attempts<2 and q.next_check_at<=v_now and q.next_due_on is not null
      and m.mode='invio' and m.kind='primo' and m.send_status='inviato' and m.erased_at is null
      and k.active and k.erased_at is null and k.kind='email'
      and private.partner_assistant_address_sha256(private.partner_assistant_address(k.link_value))=q.address_sha256
      and private.partner_assistant_valid_timezone(n.content->>'timezone')
      and n.content->>'register' in ('voi','lei','you','sie','vous','usted')
      and (select count(distinct private.partner_assistant_address(e.link_value)) from public.partner_contacts e
        where e.partner_id=q.partner_id and e.kind='email' and e.active and (e.verified or e.id=q.contact_id))<=32
    order by q.next_check_at,q.partner_id limit 1;
  if not found then return jsonb_build_object('status','idle','reason','vuota'); end if;
  perform 1 from public.partners where id=f.partner_id for share;
  select * into f from public.partner_assistant_followups where id=f.id for update;
  if not found or f.status<>'held' or f.reason is null or f.reason not in ('reply','ambiguous','risposta_trovata')
    or f.reply_review_attempts>=2 or f.next_check_at>v_now then
    return jsonb_build_object('status','idle','reason','vuota');
  end if;

  select jsonb_build_object('id',f.id,'version',f.version,'partner_id',f.partner_id,'co',p.co,'name',p.name,
    'porsche_community',coalesce(n.content->'porsche_community','false'::jsonb),'flow_template',f.flow_template,
    'contact_id',f.contact_id,'address',private.partner_assistant_address(k.link_value),
    'addresses',coalesce((select jsonb_agg(distinct private.partner_assistant_address(e.link_value)) from public.partner_contacts e
      where e.partner_id=f.partner_id and e.kind='email' and e.active and (e.verified or e.id=f.contact_id)
        and private.partner_assistant_address(e.link_value) is not null),'[]'::jsonb),
    'message_ids',(select jsonb_agg(z.message_id order by z.created_at) from public.partner_assistant_messages z
      where z.partner_id=f.partner_id and z.mode='invio' and z.send_status in ('inviato','incerto') and z.erased_at is null),
    'first_subject',m.subject,'first_sent_at',m.sent_at,'language',d.language,'register',n.content->>'register',
    'timezone',n.content->>'timezone','country',p.country,'followups_sent',f.followups_sent,
    'next_due_on',f.next_due_on,'draft',null,'send_allowed',false) into v_candidate
    from public.partners p join public.partner_contacts k on k.id=f.contact_id
    join public.partner_assistant_messages m on m.id=f.first_message_id
    join public.partner_assistant_drafts d on d.id=m.draft_id
    join public.partner_assistant_notes n on n.id=f.choice_note_id
    where p.id=f.partner_id and k.active and k.erased_at is null and m.erased_at is null
      and private.partner_assistant_address_sha256(private.partner_assistant_address(k.link_value))=f.address_sha256;
  if v_candidate is null then return jsonb_build_object('status','idle','reason','vuota'); end if;
  update private.partner_assistant_mail_state set lease_token=gen_random_uuid(),
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),candidate_draft_id=null,
    last_tick_at=clock_timestamp() where singleton returning lease_token into v_token;
  insert into private.partner_followup_leases(lease_token,conversation_id) values(v_token,f.id);
  update public.partner_assistant_followups set reply_review_attempts=reply_review_attempts+1,
    next_check_at=v_now+interval '1 day' where id=f.id;
  return jsonb_build_object('status','claimed','lease_token',v_token,'mode','osserva','candidate',v_candidate);
end
$$;

revoke all on function public.record_partner_followup_reply(uuid,uuid,bigint,jsonb),
  public.claim_partner_followup_reply_review(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.record_partner_followup_reply(uuid,uuid,bigint,jsonb),
  public.claim_partner_followup_reply_review(uuid,integer) to service_role;

commit;
