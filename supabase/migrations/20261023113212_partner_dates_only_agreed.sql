-- Calendario: solo gli eventi a cui partecipiamo.
-- Le date di una scheda Partner diventano un appuntamento del team solo con lo stato
-- «Accordo fatto» (chiave 'chiuso', invariata). Prima bastava che lo stato non fosse 'no'.
-- Additiva: sostituisce due funzioni private con la stessa firma, gli stessi attributi
-- (security definer, search_path vuoto) e gli stessi permessi, poi ripulisce gli appuntamenti
-- creati in automatico per le schede senza accordo. Restano, con needs_review, quelli con
-- vendite collegate o modificati dal team; restano quelli che il team ha scelto di tenere.
begin;

create or replace function private.sync_partner_work_dates(p_partner uuid,p_actor uuid,p_force boolean default false,p_kind text default null)returns void language plpgsql security definer set search_path='' as $$
declare v_partner public.partners%rowtype;v_link public.partner_work_links%rowtype;v_event public.calendar_events%rowtype;
 v_actor uuid:=p_actor;k text;day_start date;day_end date;v_title text;v_descr text;v_expected jsonb;event_id uuid;v_wanted boolean;
begin
 select * into strict v_partner from public.partners where id=p_partner for update;
 if v_actor is null then select m.user_id into v_actor from public.memberships m where m.active and m.role='founder' order by m.user_id limit 1;end if;
 foreach k in array array['event','deadline'] loop
  if p_kind is not null and k<>p_kind then continue;end if;
  day_start:=case when k='event' then v_partner.event_starts_on else v_partner.application_deadline end;
  day_end:=case when k='event' then coalesce(v_partner.event_ends_on,v_partner.event_starts_on)+1 else v_partner.application_deadline+1 end;
  -- In calendario solo con l'accordo fatto: ci andiamo davvero.
  v_wanted:=day_start is not null and v_partner.stage='chiuso' and not(v_partner.research_removed_at is not null and v_partner.origin='research');
  select * into v_link from public.partner_work_links where partner_id=p_partner and kind=k and source_key='dates';
  if found and v_link.detached and not p_force then continue;end if;
  event_id:=v_link.calendar_event_id;
  if event_id is not null then perform 1 from public.calendar_events where id=event_id for update;end if;
  if v_link.id is not null then select * into strict v_link from public.partner_work_links where id=v_link.id for update;end if;
  -- Senza accordo e senza appuntamento non resta niente da rivedere.
  if not v_wanted and v_link.id is not null and not exists(select 1 from public.calendar_events e where e.id=v_link.calendar_event_id)then
   update public.partner_work_links set source_snapshot='{}',needs_review=false,version=version+1 where id=v_link.id and(source_snapshot<>'{}'::jsonb or needs_review);
   continue;
  end if;
  if v_link.id is not null and not p_force and not(v_link.calendar_event_id is null and v_link.source_snapshot='{}'::jsonb)then
   select * into v_event from public.calendar_events where id=event_id for update;
   if not found or jsonb_build_object('title',v_event.title,'description',v_event.description,'starts_at',v_event.starts_at,'ends_at',v_event.ends_at) is distinct from v_link.source_snapshot then
    update public.partner_work_links set needs_review=true,version=version+1 where id=v_link.id and not needs_review;continue;
   end if;
  end if;
  if not v_wanted then
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
  -- Without an author nothing new is written; removals above never need one.
  if v_actor is null then continue;end if;
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

-- «Collega l'evento»: stesso comando, con una sola regola in più. Senza accordo fatto
-- l'evento non entra in calendario e il comando lo dice (partner_work_not_agreed).
create or replace function private.partner_work_command(p_operation_id uuid,p_payload jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
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
   if v_partner.stage<>'chiuso'then raise exception'partner_work_not_agreed'using errcode='22023';end if;
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

-- Same privileges as 20261023091627_partner_work_links: create or replace keeps them, restated here.
revoke all on function private.sync_partner_work_dates(uuid,uuid,boolean,text),private.partner_work_command(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function private.partner_work_command(uuid,jsonb)to authenticated;

-- Pulizia: ogni scheda con date collegate passa dalla regola nuova. Gli appuntamenti automatici
-- delle schede senza accordo, non toccati e senza vendite, si cancellano.
select private.sync_partner_work_dates(l.partner_id,null)
from(select distinct partner_id from public.partner_work_links where source_key='dates' order by partner_id)l;
commit;
