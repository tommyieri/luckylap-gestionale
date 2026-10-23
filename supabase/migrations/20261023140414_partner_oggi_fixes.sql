-- Partner e Oggi: correzioni dopo P4-P6 (docs/verification.md, «Problemi noti dopo P4-P6»,
-- punti 5, 7, 11 e la parte dei permessi e degli indici del punto 12).
-- Additiva: sostituisce tre funzioni private con la stessa firma, gli stessi attributi
-- (security definer, search_path vuoto) e gli stessi permessi, toglie due EXECUTE inutili e
-- aggiunge sei indici. Nessuna riga esistente cambia: niente backfill di solleciti, niente
-- appuntamenti creati o cancellati qui.
begin;

-- 5. Solleciti anche dai file «Esporta» dei dispositivi (decisione 30).
-- Un «Contattato» del file (riga 'inviato' con origin 'file') crea «Sollecito · <nome>» per chi
-- ha caricato il file, in scadenza alla mezzanotte di Roma di 7 giorni dopo la data
-- dell'esportazione (può essere già in ritardo). «Risposto», «In trattativa», «Accordo fatto» e
-- «Non interessato» dal file chiudono il sollecito aperto, come le righe del team.
-- Restano le regole di prima: un solo sollecito aperto per contatto (ogni invio chiude i più
-- vecchi, sotto il lock della riga del contatto), niente sollecito se c'è un invio o una
-- risposta più recenti, niente per i contatti chiusi, non interessati o da non contattare.
-- Un file non riapre niente se il registro ha già un invio o una risposta della stessa data o
-- più recenti: così un nuovo import dello stesso stato non crea doppioni.
create or replace function private.partner_work_activity_trigger()returns trigger language plpgsql security definer set search_path='' as $$
declare v_partner public.partners%rowtype;task uuid;due timestamptz;v_owner uuid;
begin
 if new.origin not in('team','file')then return new;end if;
 select * into strict v_partner from public.partners where id=new.partner_id for update;
 if new.origin='file'and new.kind='inviato'and exists(select 1 from public.partner_activities a where a.partner_id=new.partner_id and a.id<>new.id and a.kind in('inviato','risposta')and a.occurred_at>=new.occurred_at)then return new;end if;
 if new.kind in('risposta','non_contattare')or(new.kind='stato'and new.stage_after in('chiuso','no'))or new.kind='inviato'then
  update public.tasks t set status='done'from public.partner_work_links l join public.partner_activities a on a.id=l.activity_id
   where l.partner_id=new.partner_id and l.kind='follow_up'and l.task_id=t.id and t.status<>'done'and a.occurred_at<=new.occurred_at;
 end if;
 if new.kind='inviato'and v_partner.stage not in('chiuso','no')and not private.partner_blocked(new.partner_id)then
  -- A message supersedes earlier reminders; a backdated message cannot replace a newer cycle.
  if exists(select 1 from public.partner_activities a where a.partner_id=new.partner_id and a.origin='team'and a.kind in('inviato','risposta')and a.occurred_at>new.occurred_at)then return new;end if;
  -- Dal file: il sollecito va a chi ha caricato il file (stessa operazione dell'import).
  v_owner:=new.created_by;
  if new.origin='file'then
   select d.imported_by into v_owner from public.partner_device_imports d where d.operation_id=new.operation_id;
   v_owner:=coalesce(v_owner,new.created_by);
  end if;
  due:=(((new.occurred_at at time zone'Europe/Rome')::date+7)::timestamp at time zone'Europe/Rome');
  insert into public.tasks(title,description,status,due_at,assigned_to,created_by)
   values(left('Sollecito · '||v_partner.name,240),'Partner CO '||v_partner.co::text||' · /partner?co='||v_partner.co::text||'#lead-'||v_partner.co::text,'todo',due,v_owner,v_owner)returning id into task;
  insert into public.partner_work_links(partner_id,kind,source_key,activity_id,task_id,created_by)values(new.partner_id,'follow_up',new.id::text,new.id,task,v_owner);
 end if;
 return new;
end$$;

-- 7. Oggi, «contatti da fare»: la stessa regola del periodo «Adesso» di Partner (decisione 33,
-- correzione 05-10). Mese pianificato (mese della prossima azione, altrimenti mese di contatto)
-- entro il mese prossimo e stato «Da contattare», più i contatti non chiusi e non «Non
-- interessato» con la prossima azione di oggi o già passata. Restano fuori i contatti da non
-- contattare e quelli tolti dalla ricerca. I solleciti portano anche partner_id, per «Ha risposto».
create or replace function private.partner_today(p_day date)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare result jsonb;
begin
 if auth.uid()is null or not private.is_member()then raise exception'membership_required'using errcode='42501';end if;
 if p_day is null or p_day<date'2000-01-01'or p_day>date'2100-12-31'then raise exception'invalid_day'using errcode='22023';end if;
 with due as(
 select p.id,p.co,p.name,p.owner_id,p.next_action,p.next_action_on from public.partners p
 where p.stage not in('chiuso','no')and p.research_removed_at is null and not private.partner_blocked(p.id)
 and(p.next_action_on<=p_day
  or(p.stage='da_contattare'and date_trunc('month',coalesce(p.next_action_on,p.contact_month))::date<=(date_trunc('month',p_day)+interval'1 month')::date))
 ),reminders as(
 select t.id,t.title,t.due_at,l.partner_id from public.tasks t join public.partner_work_links l on l.task_id=t.id
 where l.kind='follow_up'and t.status<>'done'and t.assigned_to=auth.uid()and t.due_at<(p_day+1)::timestamp at time zone'Europe/Rome'
 )select jsonb_build_object(
 'contact_count',(select count(*)from due),
 'contacts',coalesce((select jsonb_agg(to_jsonb(x))from(select d.id,d.co,d.name,d.next_action,d.next_action_on,p.display_name as owner_name from due d left join public.profiles p on p.user_id=d.owner_id order by d.next_action_on nulls last,d.co limit 8)x),'[]'::jsonb),
 'reminder_count',(select count(*)from reminders),
 'reminders',coalesce((select jsonb_agg(to_jsonb(x))from(select r.id,r.title,r.due_at,p.co,r.partner_id from reminders r join public.partners p on p.id=r.partner_id order by r.due_at,r.id limit 8)x),'[]'::jsonb)
 )into result;return result;
end$$;

-- 11. «Collega l'evento» è una scelta esplicita: con l'accordo fatto e le date, l'evento entra in
-- calendario anche se è già passato, così le vendite si possono collegare. La sincronizzazione
-- automatica (sync_partner_work_dates, invariata) continua a saltare le date passate senza
-- appuntamento. Titolo, descrizione e orari sono quelli della sincronizzazione: una modifica
-- successiva della scheda aggiorna lo stesso appuntamento senza doppioni.
-- Il resto è il testo di 20261023113212_partner_dates_only_agreed.
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
   select * into v_link from public.partner_work_links where partner_id=v_partner.id and kind='event'and source_key='dates';
   if not found then
    -- Solo le date già passate arrivano qui: la sincronizzazione le ha saltate.
    if v_partner.research_removed_at is not null and v_partner.origin='research'then raise no_data_found;end if;
    insert into public.calendar_events(title,description,starts_at,ends_at,event_type,created_by)values(
     left('Evento · '||v_partner.name,240),
     jsonb_build_object('format','luckylap-team-event','version',1,'summary','Partner CO '||v_partner.co::text||' · /partner?co='||v_partner.co::text||'#lead-'||v_partner.co::text,'participantIds','[]'::jsonb,'callUrl',null,'typeLabel','Evento partner','allDay',true)::text,
     v_partner.event_starts_on::timestamp at time zone'Europe/Rome',(coalesce(v_partner.event_ends_on,v_partner.event_starts_on)+1)::timestamp at time zone'Europe/Rome','other',v_actor)returning id into target;
    insert into public.partner_work_links(partner_id,kind,source_key,calendar_event_id,source_snapshot,created_by)
     select v_partner.id,'event','dates',e.id,jsonb_build_object('title',e.title,'description',e.description,'starts_at',e.starts_at,'ends_at',e.ends_at),v_actor from public.calendar_events e where e.id=target;
   else target:=v_link.calendar_event_id;end if;
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

-- Permessi delle tre funzioni sostituite, come in 20261023091627 e 20261023113212.
revoke all on function private.partner_work_activity_trigger(),private.partner_today(date),private.partner_work_command(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function private.partner_today(date),private.partner_work_command(uuid,jsonb)to authenticated;

-- 12. Le funzioni dei trigger del calendario non servono ai client: i trigger scattano lo
-- stesso, anche per le modifiche di un membro (il permesso EXECUTE si controlla solo quando
-- si crea il trigger).
revoke all on function private.partner_calendar_changed(),private.partner_calendar_deleted()from public,anon,authenticated,service_role;

-- 12. Indici per le chiavi esterne senza indice.
create index if not exists partner_work_links_activity on public.partner_work_links(activity_id);
create index if not exists partner_work_links_project on public.partner_work_links(project_id);
create index if not exists partner_work_links_created_by on public.partner_work_links(created_by);
create index if not exists partner_event_sales_order on public.partner_event_sales(order_id);
create index if not exists partner_event_sales_partner on public.partner_event_sales(partner_id);
create index if not exists partner_event_sales_created_by on public.partner_event_sales(created_by);
commit;
