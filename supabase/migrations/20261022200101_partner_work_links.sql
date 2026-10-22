-- P5: generated with Supabase CLI, ordered after pending P2/P3 dependencies.
-- This migration deliberately depends on Partner (20261022200000).
-- No messages, external invitations, Shopify writes or historical follow-up imports.
begin;
create table public.partner_work_links (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null references public.partners(id),
 kind text not null check(kind in('follow_up','event','deadline','project','shop_review')),
 source_key text not null check(char_length(source_key) between 1 and 64),
 activity_id uuid references public.partner_activities(id),
 task_id uuid references public.tasks(id) on delete set null,
 calendar_event_id uuid references public.calendar_events(id) on delete set null,
 project_id uuid references public.product_development_projects(id) on delete set null,
 source_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(source_snapshot)='object'),
 detached boolean not null default false, needs_review boolean not null default false,
 version bigint not null default 1 check(version between 1 and 9007199254740991),
 created_by uuid not null references public.profiles(user_id),created_at timestamptz not null default now(),
 unique(partner_id,kind,source_key),check(num_nonnulls(task_id,calendar_event_id,project_id)<=1)
);
create index partner_work_task on public.partner_work_links(task_id) where task_id is not null;
create index partner_work_calendar on public.partner_work_links(calendar_event_id) where calendar_event_id is not null;
alter table public.partner_work_links enable row level security;
revoke all on public.partner_work_links from public,anon,authenticated,service_role;
grant select on public.partner_work_links to authenticated;
create policy partner_work_member_read on public.partner_work_links for select to authenticated using((select private.is_member()));
create trigger audit_change after insert or update or delete on public.partner_work_links for each row execute function private.audit_change_keys('partner_id','kind','task_id','calendar_event_id','project_id','detached','needs_review','version');
create table public.partner_event_sales(
 event_id uuid not null references public.calendar_events(id)on delete cascade,order_id uuid not null references public.sales_orders(id),
 partner_id uuid not null references public.partners(id),created_by uuid not null references public.profiles(user_id),created_at timestamptz not null default now(),primary key(event_id,order_id)
);
alter table public.partner_event_sales enable row level security;
revoke all on public.partner_event_sales from public,anon,authenticated,service_role;
grant select on public.partner_event_sales to authenticated;
create policy partner_event_sales_member_read on public.partner_event_sales for select to authenticated using((select private.is_member()));
create trigger audit_change after insert or update or delete on public.partner_event_sales for each row execute function private.audit_change_keys('event_id','order_id','partner_id');
create table private.partner_work_receipts(operation_id uuid primary key,actor_id uuid not null,payload_sha256 text not null,result jsonb not null,created_at timestamptz not null default now());
alter table private.partner_work_receipts enable row level security;
revoke all on private.partner_work_receipts from public,anon,authenticated,service_role;
create trigger partner_work_receipts_append_only before update or delete on private.partner_work_receipts for each row execute function private.reject_ledger_mutation();

-- Shared calendar dates are actual DATE values: midnight Rome to next midnight,
-- which is 23/24/25 hours. The UI displays allDay, never these technical times.
create function private.sync_partner_work_dates(p_partner uuid,p_actor uuid,p_force boolean default false,p_kind text default null)returns void language plpgsql security definer set search_path='' as $$
declare v_partner public.partners%rowtype;v_link public.partner_work_links%rowtype;v_event public.calendar_events%rowtype;
 v_actor uuid:=p_actor;k text;day_start date;day_end date;v_title text;v_descr text;v_expected jsonb;event_id uuid;
begin
 select * into strict v_partner from public.partners where id=p_partner for update;
 if v_actor is null then select m.user_id into v_actor from public.memberships m where m.active and m.role='founder' order by m.user_id limit 1;end if;
 if v_actor is null then return;end if;
 foreach k in array array['event','deadline'] loop
  if p_kind is not null and k<>p_kind then continue;end if;
  day_start:=case when k='event' then v_partner.event_starts_on else v_partner.application_deadline end;
  day_end:=case when k='event' then coalesce(v_partner.event_ends_on,v_partner.event_starts_on)+1 else v_partner.application_deadline+1 end;
  select * into v_link from public.partner_work_links where partner_id=p_partner and kind=k and source_key='dates';
  if found and v_link.detached and not p_force then continue;end if;
  event_id:=v_link.calendar_event_id;
  if event_id is not null then perform 1 from public.calendar_events where id=event_id for update;end if;
  if v_link.id is not null then select * into strict v_link from public.partner_work_links where id=v_link.id for update;end if;
  if v_link.id is not null and not p_force and not(v_link.calendar_event_id is null and v_link.source_snapshot='{}'::jsonb)then
   select * into v_event from public.calendar_events where id=event_id for update;
   if not found or jsonb_build_object('title',v_event.title,'description',v_event.description,'starts_at',v_event.starts_at,'ends_at',v_event.ends_at) is distinct from v_link.source_snapshot then
    update public.partner_work_links set needs_review=true,version=version+1 where id=v_link.id and not needs_review;continue;
   end if;
  end if;
  if day_start is null or v_partner.stage='no' or (v_partner.research_removed_at is not null and v_partner.origin='research') then
   if event_id is not null and exists(select 1 from public.partner_event_sales pes where pes.event_id=v_link.calendar_event_id)then
    if p_force then raise exception'partner_work_event_has_sales'using errcode='22023';end if;
    update public.partner_work_links set needs_review=true,version=version+1 where id=v_link.id and not needs_review;continue;
   end if;
   if event_id is not null then delete from public.calendar_events where id=event_id;end if;
   if v_link.id is not null then update public.partner_work_links set source_snapshot='{}',needs_review=false,version=version+1 where id=v_link.id;end if;
   continue;
  end if;
  -- Existing past dates are not backfilled on unrelated edits.
  if v_link.id is null and day_end <= (statement_timestamp()at time zone'Europe/Rome')::date then continue;end if;
  v_title:=left(case when k='event'then 'Evento · 'else 'Candidatura · 'end||v_partner.name,240);
  v_descr:=jsonb_build_object('format','luckylap-team-event','version',1,'summary','Partner CO '||v_partner.co::text||' · /partner?co='||v_partner.co::text||'#lead-'||v_partner.co::text,'participantIds','[]'::jsonb,'callUrl',null,'typeLabel',case when k='event'then'Evento partner'else'Scadenza candidatura'end,'allDay',true)::text;
  if event_id is null or not exists(select 1 from public.calendar_events where id=event_id)then
   insert into public.calendar_events(title,description,starts_at,ends_at,event_type,created_by)values(v_title,v_descr,day_start::timestamp at time zone'Europe/Rome',day_end::timestamp at time zone'Europe/Rome','other',v_actor)returning id into event_id;
  else
   update public.calendar_events set title=v_title,description=v_descr,starts_at=day_start::timestamp at time zone'Europe/Rome',ends_at=day_end::timestamp at time zone'Europe/Rome' where id=event_id and (title,description,starts_at,ends_at)is distinct from(v_title,v_descr,day_start::timestamp at time zone'Europe/Rome',day_end::timestamp at time zone'Europe/Rome');
  end if;
  select jsonb_build_object('title',e.title,'description',e.description,'starts_at',e.starts_at,'ends_at',e.ends_at)into v_expected from public.calendar_events e where e.id=event_id;
  if v_link.id is null then
   insert into public.partner_work_links(partner_id,kind,source_key,calendar_event_id,source_snapshot,created_by)values(p_partner,k,'dates',event_id,v_expected,v_actor);
  else update public.partner_work_links set calendar_event_id=event_id,source_snapshot=v_expected,needs_review=false,detached=false,version=version+1 where id=v_link.id and (calendar_event_id,source_snapshot,needs_review,detached)is distinct from(event_id,v_expected,false,false);end if;
 end loop;
end$$;

create function private.partner_work_dates_trigger()returns trigger language plpgsql security definer set search_path='' as $$begin
 perform private.sync_partner_work_dates(new.id,coalesce(auth.uid(),new.updated_by,new.created_by));return new;
end$$;
create trigger sync_partner_work_dates after insert or update of event_starts_on,event_ends_on,application_deadline,name,stage,research_removed_at on public.partners for each row execute function private.partner_work_dates_trigger();

create function private.partner_work_activity_trigger()returns trigger language plpgsql security definer set search_path='' as $$
declare v_partner public.partners%rowtype;task uuid;due timestamptz;
begin
 if new.origin<>'team' then return new;end if;
 select * into strict v_partner from public.partners where id=new.partner_id for update;
 if new.kind in('risposta','non_contattare')or(new.kind='stato'and new.stage_after in('chiuso','no'))or new.kind='inviato'then
  update public.tasks t set status='done'from public.partner_work_links l join public.partner_activities a on a.id=l.activity_id
   where l.partner_id=new.partner_id and l.kind='follow_up'and l.task_id=t.id and t.status<>'done'and a.occurred_at<=new.occurred_at;
 end if;
 if new.kind='inviato'and v_partner.stage not in('chiuso','no')and not private.partner_blocked(new.partner_id)then
  -- A message supersedes earlier reminders; a backdated message cannot replace a newer cycle.
  if exists(select 1 from public.partner_activities a where a.partner_id=new.partner_id and a.origin='team'and a.kind in('inviato','risposta')and a.occurred_at>new.occurred_at)then return new;end if;
  due:=(((new.occurred_at at time zone'Europe/Rome')::date+7)::timestamp at time zone'Europe/Rome');
  insert into public.tasks(title,description,status,due_at,assigned_to,created_by)
   values(left('Sollecito · '||v_partner.name,240),'Partner CO '||v_partner.co::text||' · /partner?co='||v_partner.co::text||'#lead-'||v_partner.co::text,'todo',due,new.created_by,new.created_by)returning id into task;
  insert into public.partner_work_links(partner_id,kind,source_key,activity_id,task_id,created_by)values(new.partner_id,'follow_up',new.id::text,new.id,task,new.created_by);
 end if;
 return new;
end$$;
create trigger create_partner_work_followup after insert on public.partner_activities for each row execute function private.partner_work_activity_trigger();

-- Any calendar edit invalidates a review already shown in another browser.
-- Automatic sync takes calendar -> link too, then stores its new source snapshot.
create function private.partner_calendar_changed()returns trigger language plpgsql security definer set search_path=''as $$begin
 update public.partner_work_links set needs_review=true,version=version+1
 where calendar_event_id=old.id;
 return new;
end$$;
create trigger partner_calendar_changed after update of title,description,starts_at,ends_at on public.calendar_events for each row
 when ((old.title,old.description,old.starts_at,old.ends_at)is distinct from(new.title,new.description,new.starts_at,new.ends_at))execute function private.partner_calendar_changed();
create function private.partner_calendar_deleted()returns trigger language plpgsql security definer set search_path=''as $$begin
 update public.partner_work_links set needs_review=true,version=version+1 where calendar_event_id=old.id;
 return old;
end$$;
create trigger partner_calendar_deleted before delete on public.calendar_events for each row execute function private.partner_calendar_deleted();

-- A small, complete operational view; contact details never enter Today.
create function private.partner_today(p_day date)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare result jsonb;
begin
 if auth.uid()is null or not private.is_member()then raise exception'membership_required'using errcode='42501';end if;
 if p_day is null or p_day<date'2000-01-01'or p_day>date'2100-12-31'then raise exception'invalid_day'using errcode='22023';end if;
 with due as(
 select p.id,p.co,p.name,p.owner_id,p.next_action,p.next_action_on from public.partners p
 where p.stage not in('chiuso','no')and p.research_removed_at is null and not private.partner_blocked(p.id)
 and(p.next_action_on<=p_day or(p.next_action_on is null and p.stage='da_contattare'and p.contact_month<=date_trunc('month',p_day)::date))
 ),reminders as(
 select t.id,t.title,t.due_at,l.partner_id from public.tasks t join public.partner_work_links l on l.task_id=t.id
 where l.kind='follow_up'and t.status<>'done'and t.assigned_to=auth.uid()and t.due_at<(p_day+1)::timestamp at time zone'Europe/Rome'
 )select jsonb_build_object(
 'contact_count',(select count(*)from due),
 'contacts',coalesce((select jsonb_agg(to_jsonb(x))from(select d.id,d.co,d.name,d.next_action,d.next_action_on,p.display_name as owner_name from due d left join public.profiles p on p.user_id=d.owner_id order by d.next_action_on nulls last,d.co limit 8)x),'[]'::jsonb),
 'reminder_count',(select count(*)from reminders),
 'reminders',coalesce((select jsonb_agg(to_jsonb(x))from(select r.id,r.title,r.due_at,p.co from reminders r join public.partners p on p.id=r.partner_id order by r.due_at,r.id limit 8)x),'[]'::jsonb)
 )into result;return result;
end$$;
create function public.read_partner_today(p_day date)returns jsonb language sql stable security invoker set search_path=''as $$select private.partner_today(p_day)$$;
revoke all on function private.partner_today(date),public.read_partner_today(date)from public,anon,authenticated,service_role;
grant execute on function private.partner_today(date),public.read_partner_today(date)to authenticated;

-- Explicit outcomes, chosen by a person. No interpretation of notes or emails.
create function private.partner_work_command(p_operation_id uuid,p_payload jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_previous private.partner_work_receipts%rowtype;v_digest text;v_kind text;v_partner public.partners%rowtype;v_link public.partner_work_links%rowtype;
 v_partner_id uuid;target uuid;v_production_owner uuid;result jsonb;v_expected bigint;v_keep_manual boolean;
begin
 if v_actor is null or not private.is_member()then raise exception'partner_work_access_required'using errcode='42501';end if;
 if p_operation_id is null then raise exception'invalid_partner_work_payload'using errcode='22023';end if;
 perform private.sale_object(p_payload,array['schema_version','kind'],array['schema_version','kind','partner_id','link_id','expected_version','keep_manual','event_id','order_id']);perform private.sale_integer(p_payload->'schema_version',1,1);
 v_kind:=p_payload->>'kind';if v_kind is null or v_kind not in('event','project','shop_review','resolve','link_sale')then raise exception'invalid_partner_work_payload'using errcode='22023';end if;
 v_digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.partner_work.'||p_operation_id::text,0));
 select * into v_previous from private.partner_work_receipts where operation_id=p_operation_id;
 if found then if v_previous.actor_id<>v_actor or v_previous.payload_sha256<>v_digest then raise exception'partner_work_idempotency_conflict'using errcode='23505';end if;return v_previous.result||'{"replayed":true}'::jsonb;end if;
 if v_kind='link_sale'then
  perform private.sale_object(p_payload,array['schema_version','kind','partner_id','event_id','order_id'],array['schema_version','kind','partner_id','event_id','order_id']);
  v_partner_id:=(p_payload->>'partner_id')::uuid;perform 1 from public.partners where id=v_partner_id for update;if not found then raise no_data_found;end if;
  target:=(p_payload->>'event_id')::uuid;perform 1 from public.calendar_events where id=target for update;if not found then raise no_data_found;end if;
  if not exists(select 1 from public.partner_work_links where partner_id=v_partner_id and calendar_event_id=target and kind='event')then raise exception'partner_work_event_required'using errcode='22023';end if;
  perform 1 from public.sales_orders where id=(p_payload->>'order_id')::uuid for key share;if not found then raise no_data_found;end if;
  insert into public.partner_event_sales(event_id,order_id,partner_id,created_by)values(target,(p_payload->>'order_id')::uuid,v_partner_id,v_actor)on conflict(event_id,order_id)do nothing;
 elsif v_kind='resolve'then
  perform private.sale_object(p_payload,array['schema_version','kind','link_id','expected_version','keep_manual'],array['schema_version','kind','link_id','expected_version','keep_manual']);
  if jsonb_typeof(p_payload->'keep_manual')<>'boolean'then raise exception'invalid_partner_work_payload'using errcode='22023';end if;
  v_expected:=private.sale_integer(p_payload->'expected_version',1,9007199254740991);v_keep_manual:=(p_payload->>'keep_manual')::boolean;
  select * into strict v_link from public.partner_work_links where id=(p_payload->>'link_id')::uuid and kind in('event','deadline');
  perform 1 from public.partners where id=v_link.partner_id for update;
  if v_link.calendar_event_id is not null then perform 1 from public.calendar_events where id=v_link.calendar_event_id for update;end if;
  select * into strict v_link from public.partner_work_links where id=v_link.id for update;
  if v_link.version<>v_expected then raise exception'partner_work_changed'using errcode='40001';end if;
  v_partner_id:=v_link.partner_id;
  if v_keep_manual then update public.partner_work_links set detached=true,needs_review=false,version=version+1 where id=v_link.id;
  else perform private.sync_partner_work_dates(v_link.partner_id,v_actor,true,v_link.kind);end if;
  select calendar_event_id into target from public.partner_work_links where id=v_link.id;
 else
  perform private.sale_object(p_payload,array['schema_version','kind','partner_id'],array['schema_version','kind','partner_id']);
  v_partner_id:=(p_payload->>'partner_id')::uuid;select * into strict v_partner from public.partners where id=v_partner_id for update;
  if v_kind='event'then
   if v_partner.event_starts_on is null then raise exception'partner_work_date_required'using errcode='22023';end if;
   perform private.sync_partner_work_dates(v_partner_id,v_actor);
   select * into strict v_link from public.partner_work_links where partner_id=v_partner.id and kind='event'and source_key='dates';target:=v_link.calendar_event_id;
  else
   select * into v_link from public.partner_work_links where partner_id=v_partner.id and kind=v_kind and source_key='outcome'for update;
   if found then target:=coalesce(v_link.project_id,v_link.task_id);if target is null then raise exception'partner_work_target_deleted'using errcode='22023';end if;
   elsif v_kind='project'then
    select user_id into v_production_owner from public.memberships where active and role='production'order by user_id limit 1;
    if v_production_owner is null then raise exception'partner_work_production_owner_required'using errcode='22023';end if;
    insert into public.product_development_projects(name,brief,stage,owner_id,created_by)values(left('Collaborazione · '||v_partner.name,240),'Partner CO '||v_partner.co::text||' · /partner?co='||v_partner.co::text||'#lead-'||v_partner.co::text,'idea',v_production_owner,v_actor)returning id into target;
    insert into public.partner_work_links(partner_id,kind,source_key,project_id,created_by)values(v_partner.id,v_kind,'outcome',target,v_actor);
   else
    insert into public.tasks(title,description,assigned_to,created_by)values(left('Aprire conto vendita · '||v_partner.name,240),'Verificare condizioni e collegare il negozio. Per sedi estere attendere la verifica del commercialista prima dell’apertura. Partner CO '||v_partner.co::text||' · /partner?co='||v_partner.co::text||'#lead-'||v_partner.co::text,coalesce(v_partner.owner_id,v_actor),v_actor)returning id into target;
    insert into public.partner_work_links(partner_id,kind,source_key,task_id,created_by)values(v_partner.id,v_kind,'outcome',target,v_actor);
   end if;
  end if;
 end if;
 result:=jsonb_build_object('operation_id',p_operation_id,'partner_id',v_partner_id,'kind',v_kind,'target_id',target,'replayed',false);
 insert into private.partner_work_receipts(operation_id,actor_id,payload_sha256,result)values(p_operation_id,v_actor,v_digest,result);return result;
exception when no_data_found then raise exception'partner_work_source_missing'using errcode='22023';
 when invalid_text_representation or numeric_value_out_of_range then raise exception'invalid_partner_work_payload'using errcode='22023';end$$;
create function public.create_partner_work(p_operation_id uuid,p_payload jsonb)returns jsonb language sql security invoker set search_path=''as $$select private.partner_work_command(p_operation_id,p_payload)$$;
revoke all on function private.sync_partner_work_dates(uuid,uuid,boolean,text),private.partner_work_dates_trigger(),private.partner_work_activity_trigger(),private.partner_work_command(uuid,jsonb),private.partner_calendar_changed(),private.partner_calendar_deleted(),public.create_partner_work(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function private.partner_work_command(uuid,jsonb),private.partner_calendar_changed(),private.partner_calendar_deleted(),public.create_partner_work(uuid,jsonb)to authenticated;
-- Backfill date-only calendar links from existing Partner data; no historic messages/reminders.
select private.sync_partner_work_dates(id,null)from public.partners where event_starts_on is not null or application_deadline is not null;
commit;
