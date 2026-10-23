-- Read-only projection: no new tracking, no copied audit payloads, no changes to
-- existing gates/triggers/tables. Historic fallback is EXACT transaction time +
-- actor + relational root, never a guessed interval or a raw-row page/window.
begin;

create function private.activity_feed_text(p_value text,p_max integer default 240) returns text
language sql immutable security invoker set search_path='' as $$
 select nullif(left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  coalesce(p_value,''),'[[:cntrl:]]',' ','g'),
  '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}','[recapito omesso]','gi'),
  'https?://[^[:space:]]+','[link omesso]','gi'),
  '(sb_(secret|publishable)_[[:alnum:]_-]+|eyJ[[:alnum:]_-]+\.[[:alnum:]_-]+\.[[:alnum:]_-]+)','[dato omesso]','g'),
  '\+?[0-9][0-9 ()/.-]{6,}[0-9]','[recapito omesso]','g')),least(greatest(p_max,1),240)),'')
$$;
create function private.activity_feed_uuid(p_value text) returns uuid
language sql immutable security invoker set search_path='' as $$
 select case when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'then p_value::uuid end
$$;
create function private.activity_feed_cents(p_value jsonb)returns bigint
language plpgsql immutable security invoker set search_path='' as $$
declare v text;
begin
 v:=coalesce(p_value->>'amount_cents',p_value#>>'{value_snapshot,amount_cents}',p_value#>>'{snapshot,amount_cents}');
 if v ~ '^-?[0-9]{1,16}$'and abs(v::numeric)<=9000000000000000 then
  return case when coalesce(p_value#>>'{value_snapshot,direction}',p_value->>'finance_direction',p_value#>>'{snapshot,finance,direction}',p_value->>'direction',p_value->>'entry_type')='expense' then -abs(v::bigint)else v::bigint end;end if;
 v:=p_value->>'amount_eur';
 if v ~ '^-?[0-9]{1,13}(\.[0-9]{1,2})?$'then return case when p_value->>'entry_type'='expense'then -abs((v::numeric*100)::bigint)else (v::numeric*100)::bigint end;end if;
 return null;
end$$;
create function private.activity_feed_money(p_cents bigint)returns text
language sql immutable security invoker set search_path=''as $$
 select replace(to_char(p_cents::numeric/100,'FM999999999999990.00'),'.',',')||' €'
$$;
-- P2's privacy trigger intentionally omits operation_id. Read just that one
-- immutable identifier when its optional source table exists; never contacts,
-- messages or arbitrary source fields. Deleted sources use the exact fallback.
create function private.activity_partner_operation(p_table text,p_id text)returns text
language plpgsql stable security invoker set search_path=''as $$
declare v text;
begin
 if p_table<>'partner_activities'or private.activity_feed_uuid(p_id)is null or to_regclass('public.partner_activities')is null then return null;end if;
 execute 'select operation_id::text from public.partner_activities where id=$1'into v using private.activity_feed_uuid(p_id);
 return v;
exception when undefined_column then return null;
end$$;

create function private.activity_feed_actions()returns table(id uuid,occurred_at timestamptz,actor_id uuid,actor_name text,area text,message text,href text)
language sql stable security invoker set search_path=''set timezone='UTC'as $$
with recursive extracted as materialized(
 select a.id audit_id,a.occurred_at,a.actor_id,a.table_name,a.operation,
  jsonb_strip_nulls(jsonb_build_object(
   'id',coalesce(a.new_data->>'id',a.old_data->>'id',a.record_key->>'id'),
   'user_id',coalesce(a.new_data->>'user_id',a.old_data->>'user_id',a.record_key->>'user_id'),
   'stock_item_id',coalesce(a.new_data->>'stock_item_id',a.old_data->>'stock_item_id',a.record_key->>'stock_item_id'),
   'location_id',coalesce(a.new_data->>'location_id',a.old_data->>'location_id',a.record_key->>'location_id'),
   'order_id',coalesce(a.new_data->>'order_id',a.old_data->>'order_id'),
   'task_id',coalesce(a.new_data->>'task_id',a.old_data->>'task_id'),
   'calendar_event_id',coalesce(a.new_data->>'calendar_event_id',a.old_data->>'calendar_event_id'),
   'project_id',coalesce(a.new_data->>'project_id',a.old_data->>'project_id'),
   'event_id',coalesce(a.new_data->>'event_id',a.old_data->>'event_id',a.record_key->>'event_id'),
   'order_line_id',coalesce(a.new_data->>'order_line_id',a.old_data->>'order_line_id'),
   'requirement_id',coalesce(a.new_data->>'requirement_id',a.old_data->>'requirement_id'),
   'entry_id',coalesce(a.new_data->>'entry_id',a.old_data->>'entry_id'),
   'sale_id',coalesce(a.new_data->>'sale_id',a.old_data->>'sale_id'),
   'batch_id',coalesce(a.new_data->>'batch_id',a.old_data->>'batch_id'),
   'partner_id',coalesce(a.new_data->>'partner_id',a.old_data->>'partner_id',a.record_key->>'partner_id'),
   'variant_id',coalesce(a.new_data->>'variant_id',a.old_data->>'variant_id',a.record_key->>'variant_id'),
   'report_id',coalesce(a.new_data->>'report_id',a.old_data->>'report_id'),
   'payment_id',coalesce(a.new_data->>'payment_id',a.old_data->>'payment_id'),
   'shipment_id',coalesce(a.new_data->>'shipment_id',a.old_data->>'shipment_id'),
   'count_id',coalesce(a.new_data->>'count_id',a.old_data->>'count_id'),
   'consumption_id',coalesce(a.new_data->>'consumption_id',a.old_data->>'consumption_id'),
   'operation_id',coalesce(a.new_data->>'operation_id',a.old_data->>'operation_id'),
   'source_id',coalesce(a.new_data->>'source_id',a.old_data->>'source_id'),
   'source_kind',coalesce(a.new_data->>'source_kind',a.old_data->>'source_kind'),
   'parent_order',coalesce(a.new_data#>>'{source,sales_order_id}',a.old_data#>>'{source,sales_order_id}'),
   'parent_line',coalesce(a.new_data#>>'{source,sales_order_line_id}',a.old_data#>>'{source,sales_order_line_id}'),
   'parent_consumption',coalesce(a.new_data#>>'{source,packaging_consumption_id}',a.old_data#>>'{source,packaging_consumption_id}'),
   'parent_report',coalesce(a.new_data#>>'{source,consignment_report_id}',a.old_data#>>'{source,consignment_report_id}'),
   'parent_transfer',coalesce(a.new_data#>>'{source,consignment_transfer_id}',a.old_data#>>'{source,consignment_transfer_id}'),
   'parent_sale',coalesce(a.new_data#>>'{source,consignment_sale_id}',a.old_data#>>'{source,consignment_sale_id}'),
   'packaging_operation',coalesce(a.new_data#>>'{source,packaging_operation_id}',a.old_data#>>'{source,packaging_operation_id}'),
   'kind',coalesce(a.new_data->>'kind',a.old_data->>'kind'),
   'origin',coalesce(a.new_data->>'origin',a.old_data->>'origin'),
   'channel',coalesce(a.new_data->>'channel',a.old_data->>'channel'),
   'action',coalesce(a.new_data->>'action',a.old_data->>'action'),
   'version',coalesce(a.new_data->>'version',a.old_data->>'version'),
   'previous_version',coalesce(a.new_data->>'previous_version',a.old_data->>'previous_version'),
   'status',coalesce(a.new_data->>'status',a.old_data->>'status'),
   'stage_after',coalesce(a.new_data->>'stage_after',a.old_data->>'stage_after'),
   'deleted',coalesce(a.new_data->>'deleted',a.new_data->>'voided'),
   'event_type',coalesce(a.new_data->>'event_type',a.old_data->>'event_type'),
   'partner_co',coalesce(a.new_data->>'partner_co',a.old_data->>'partner_co',a.new_data->>'co',a.old_data->>'co'),
   'title',private.activity_feed_text(coalesce(a.new_data->>'title',a.old_data->>'title',a.new_data->>'partner_name',a.old_data->>'partner_name',a.new_data->>'name',a.old_data->>'name')),
   'category',private.activity_feed_text(coalesce(a.new_data->>'finance_category',a.new_data#>>'{snapshot,finance,category}',a.new_data->>'category_label',a.new_data->>'category',a.new_data#>>'{value_snapshot,category_label}',a.new_data#>>'{value_snapshot,category}',a.old_data->>'category_label',a.old_data->>'category'),120),
   'amount_before',private.activity_feed_cents(a.old_data),'amount_after',private.activity_feed_cents(a.new_data),
   'quantity',case when coalesce(a.new_data->>'quantity',a.old_data->>'quantity')~'^[0-9]{1,9}$'then coalesce(a.new_data->>'quantity',a.old_data->>'quantity')end
  ))s
 from public.audit_logs a
 where a.table_name in('calendar_events','tasks','notes','assets','product_development_projects','profiles','memberships','app_settings','discount_rules',
  'products','stock_items','product_variants','packaging_items','stock_locations','stock_balances','stock_movements','sales_orders','sales_order_lines','order_payments',
  'fulfillment_lines','stock_reservations','stock_reservation_events','production_requirements','production_receipts','commercial_facts','shopify_refund_observations','shopify_order_financials','shopify_transaction_observations',
  'finance_entries','finance_entry_voids','finance_import_batches','finance_import_transactions','finance_documents','finance_movement_revisions',
  'packaging_consumptions','packaging_consumption_entries','packaging_automation','packaging_automation_failures',
  'partners','partner_contacts','partner_message_variants','partner_message_revisions','partner_activities','partner_do_not_contact','partner_research_imports','partner_device_imports','partner_import_differences','partner_work_links','partner_event_sales',
  'consignment_transfers','consignment_sales','consignment_settlements','consignment_shops','consignment_counts','consignment_count_lines','consignment_reports','consignment_report_lines','consignment_report_revisions','consignment_report_movements','consignment_report_payments','consignment_payment_revisions','consignment_orders','consignment_order_lines','consignment_shipments','consignment_shipment_lines')
),revision_values as(
 select e.audit_id,coalesce((select p.s->'amount_after'from extracted p where p.table_name='finance_movement_revisions'
  and p.s->>'source_kind'=e.s->>'source_kind'and p.s->>'source_id'=e.s->>'source_id'and p.s->>'version'=e.s->>'previous_version'order by p.occurred_at desc,p.audit_id desc limit 1),
  (select p.s->'amount_after'from extracted p where p.s->>'id'=e.s->>'source_id'and p.table_name=case e.s->>'source_kind'
    when 'manual'then 'finance_entries'when 'budgetflow'then 'finance_import_transactions'when 'payment'then 'order_payments'when 'refund'then 'shopify_refund_observations'when 'consignment_settlement'then 'consignment_settlements'end
   order by p.occurred_at desc,p.audit_id desc limit 1))previous_amount
 from extracted e where e.table_name='finance_movement_revisions'
),normalized as(
 select e.audit_id,e.occurred_at,e.actor_id,e.table_name,e.operation,
  case when r.previous_amount is not null then e.s||jsonb_build_object('amount_before',r.previous_amount)else e.s end s
 from extracted e left join revision_values r using(audit_id)
),identified as(
 select e.*,coalesce(s->>'id',case when table_name in('profiles','memberships')then s->>'user_id'when table_name in('product_variants','packaging_items','stock_balances')then s->>'stock_item_id'when table_name='stock_reservations'then s->>'order_line_id'when table_name='consignment_shops'then s->>'location_id'end,audit_id::text)entity_id
 from normalized e
),generated_targets as materialized(
 -- The inverse relation applies only to the artifact's creation transaction.
 -- A global task:id -> Partner edge would conflate independent later Team edits.
 select t.audit_id,min(l.s->>'partner_id')partner_id
 from identified t join identified l on l.table_name='partner_work_links'and l.operation='INSERT'
  and l.occurred_at=t.occurred_at and l.actor_id is not distinct from t.actor_id
  and l.s->>(case t.table_name when 'tasks'then'task_id'when 'calendar_events'then'calendar_event_id'when 'product_development_projects'then'project_id'end)=t.entity_id
 where t.operation='INSERT'and t.table_name in('tasks','calendar_events','product_development_projects')and private.activity_feed_uuid(l.s->>'partner_id')is not null
 group by t.audit_id having count(distinct l.s->>'partner_id')=1
),nodes as materialized(
 select i.*,case when g.partner_id is not null then 'generated:'||i.audit_id::text else table_name||':'||entity_id end entity_key,
 case
  when g.partner_id is not null then 'partners:'||g.partner_id
  when table_name in('sales_order_lines','order_payments','commercial_facts','shopify_refund_observations','shopify_order_financials','shopify_transaction_observations')then 'sales_orders:'||(s->>'order_id')
  when table_name in('fulfillment_lines','stock_reservations','stock_reservation_events','production_requirements')then 'sales_order_lines:'||(s->>'order_line_id')
  when table_name='production_receipts'then 'production_requirements:'||(s->>'requirement_id')
  when table_name='finance_entry_voids'then 'finance_entries:'||(s->>'entry_id')
  when table_name='finance_import_transactions'then 'finance_import_batches:'||(s->>'batch_id')
  when table_name='finance_movement_revisions'then 'finance_movement:'||coalesce(s->>'source_kind','unknown')||':'||(s->>'source_id')
  when table_name in('partner_contacts','partner_message_variants','partner_activities','partner_do_not_contact','partner_import_differences','partner_work_links','partner_event_sales')then 'partners:'||(s->>'partner_id')
  when table_name='partner_message_revisions'then 'partner_message_variants:'||(s->>'variant_id')
  when table_name in('consignment_report_lines','consignment_report_revisions','consignment_report_movements','consignment_report_payments')then 'consignment_reports:'||(s->>'report_id')
  when table_name='consignment_payment_revisions'then 'consignment_report_payments:'||(s->>'payment_id')
  when table_name='consignment_order_lines'then 'consignment_orders:'||(s->>'order_id')
  when table_name='consignment_shipment_lines'then 'consignment_shipments:'||(s->>'shipment_id')
  when table_name='consignment_count_lines'then 'consignment_counts:'||(s->>'count_id')
  when table_name='consignment_settlements'then 'consignment_sales:'||(s->>'sale_id')
  when table_name='packaging_consumptions'and s->>'source_kind'='fulfillment'then 'fulfillment_lines:'||(s->>'source_id')
  when table_name='packaging_consumptions'and s->>'source_kind'='consignment'then 'consignment_sales:'||(s->>'source_id')
  when table_name='packaging_consumption_entries'then 'packaging_consumptions:'||(s->>'consumption_id')
  when table_name='stock_movements'then coalesce('sales_orders:'||(s->>'parent_order'),'sales_order_lines:'||(s->>'parent_line'),'packaging_consumptions:'||(s->>'parent_consumption'),'consignment_reports:'||(s->>'parent_report'),'consignment_transfers:'||(s->>'parent_transfer'),'consignment_sales:'||(s->>'parent_sale'),'stock_items:'||(s->>'stock_item_id'))
  when table_name in('product_variants','packaging_items','stock_balances')then 'stock_items:'||(s->>'stock_item_id')
 end parent_key
 from identified i left join generated_targets g on g.audit_id=i.audit_id
),edges as materialized(
 select entity_key,min(parent_key)parent_key from nodes where parent_key is not null and parent_key<>entity_key group by entity_key having count(distinct parent_key)=1
),walk as(
 select n.audit_id,n.entity_key root_key,0 depth,array[n.entity_key]visited from nodes n
 union all select w.audit_id,e.parent_key,w.depth+1,w.visited||e.parent_key from walk w join edges e on e.entity_key=w.root_key where w.depth<12 and not e.parent_key=any(w.visited)
),roots as(
 select distinct on(audit_id)audit_id,root_key from walk order by audit_id,depth desc
),prepared as(
 select n.*,r.root_key,
 case when operation='INSERT'and table_name in('sales_orders','order_payments','production_receipts','finance_movement_revisions')then s->>'operation_id'
  when operation='INSERT'and table_name in('consignment_sales','consignment_transfers','consignment_report_revisions','consignment_payment_revisions','consignment_shipments')then entity_id
  when operation='INSERT'and table_name='partner_activities'then coalesce(s->>'operation_id',private.activity_partner_operation(table_name,entity_id))
  when table_name='stock_movements'and r.root_key like 'stock_items:%'then coalesce(s->>'packaging_operation',s->>'operation_id')end anchor,
 case when table_name='sales_orders'and operation='INSERT'then 160 when table_name='finance_movement_revisions'then 180
  when table_name in('order_payments','consignment_report_payments')then 150 when table_name='partner_activities'then 170
  when table_name in('fulfillment_lines','production_receipts','consignment_payment_revisions','consignment_report_revisions')then 140
  when table_name in('calendar_events','tasks','notes','assets','product_development_projects','finance_entries','finance_import_batches','finance_entry_voids')then 130
  when table_name='stock_movements'then 110 when table_name='stock_balances'then 1 else 80 end priority
 from nodes n join roots r using(audit_id)
 where not(n.table_name='stock_balances'and exists(select 1 from nodes m where m.table_name='stock_movements'and m.occurred_at=n.occurred_at and m.actor_id is not distinct from n.actor_id and m.s->>'stock_item_id'=n.s->>'stock_item_id'and m.s->>'location_id'=n.s->>'location_id'))
 -- Calendar edits invalidate a link's CAS version. That metadata update is not
 -- another human action and must not reparent later independent Team edits.
 and not(n.table_name='partner_work_links'and n.operation='UPDATE'and exists(select 1 from nodes m where m.table_name='calendar_events'and m.occurred_at=n.occurred_at and m.actor_id is not distinct from n.actor_id and m.entity_id=n.s->>'calendar_event_id'))
 -- P5 closes existing reminders in the same source action. A historical,
 -- immutable link plus the exact explicit team activity proves this side effect;
 -- unrelated manual task updates retain their own entity roots and feed rows.
 and not(n.table_name='tasks'and n.operation='UPDATE'and n.s->>'status'='done'and exists(
  select 1 from nodes l join nodes a on a.table_name='partner_activities'and a.s->>'partner_id'=l.s->>'partner_id'
   and a.occurred_at=n.occurred_at and a.actor_id is not distinct from n.actor_id and a.s->>'origin'='team'
   and(a.s->>'kind'in('inviato','risposta','non_contattare')or(a.s->>'kind'='stato'and a.s->>'stage_after'in('chiuso','no')))
  where l.table_name='partner_work_links'and l.operation='INSERT'and l.s->>'kind'='follow_up'and l.s->>'task_id'=n.entity_id and l.occurred_at<=n.occurred_at))
),scopes as(
 select root_key,occurred_at,actor_id,count(distinct anchor)anchors,min(anchor)anchor from prepared group by root_key,occurred_at,actor_id
),tagged as(
 select p.*,p.root_key||'|'||coalesce(p.actor_id::text,'system')||'|'||coalesce(case when t.anchors=1 then t.anchor when t.anchors>1 then p.anchor end,'tx:'||to_char(p.occurred_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))group_key
 from prepared p join scopes t on t.root_key=p.root_key and t.occurred_at=p.occurred_at and t.actor_id is not distinct from p.actor_id
 where t.anchors<=1 or p.anchor is not null
),summary as(
 select group_key,max(occurred_at)occurred_at,actor_id,(select sum(q.quantity)from(select max((n.s->>'quantity')::bigint)quantity from tagged n where n.group_key=t.group_key and n.table_name='sales_order_lines'group by n.entity_id)q)order_quantity,
  sum((s->>'quantity')::bigint)filter(where table_name='fulfillment_lines')delivered_quantity,
  coalesce(max(s->>'channel')filter(where table_name='sales_orders'),(select n.s->>'channel'from nodes n where n.entity_key=t.root_key and n.table_name='sales_orders'order by n.occurred_at desc,n.audit_id desc limit 1))channel,
  coalesce(max(s->>'partner_co'),(select n.s->>'partner_co'from nodes n where n.entity_key=t.root_key and n.table_name='partners'and n.occurred_at<=max(t.occurred_at)order by n.occurred_at desc,n.audit_id desc limit 1))partner_co,
  coalesce(max(s->>'title')filter(where table_name in('partners','partner_activities')),(select n.s->>'title'from nodes n where n.entity_key=t.root_key and n.table_name='partners'and n.occurred_at<=max(t.occurred_at)order by n.occurred_at desc,n.audit_id desc limit 1))partner_name
 from tagged t group by group_key,actor_id,root_key
),chosen as(
 select distinct on(group_key)group_key,table_name,operation,s,root_key,entity_id from tagged order by group_key,priority desc,audit_id desc
),classified as(
 select g.*,c.table_name,c.operation,c.s,c.root_key,c.entity_id,
 coalesce(private.activity_feed_text(p.display_name,120),case when g.actor_id is null then 'Automazioni'else 'Membro non disponibile'end)actor_name,
 case when c.table_name like 'finance_%'or c.table_name in('order_payments','shopify_refund_observations','shopify_order_financials','shopify_transaction_observations','consignment_settlements','consignment_report_payments','consignment_payment_revisions')then 'finance'
  when c.table_name in('calendar_events','tasks','notes')then 'team'when c.table_name like 'partner%'then 'partner'
  when c.root_key like 'sales_orders:%'or c.table_name like 'consignment_%'or c.table_name='discount_rules'then 'sales'
  when c.table_name='assets'then 'assets'when c.table_name='product_development_projects'then 'development'
  when c.table_name like 'packaging_%'or exists(select 1 from public.stock_items z where z.id=private.activity_feed_uuid(c.s->>'stock_item_id')and z.kind='packaging')then 'packaging'
  when c.table_name in('profiles','memberships','app_settings')then 'settings'else 'stock'end area
 from summary g join chosen c using(group_key)left join public.profiles p on p.user_id=g.actor_id
),phrases as(
 select c.*,
 case
 when table_name='calendar_events'then case operation when 'INSERT'then 'ha aggiunto 'when 'DELETE'then 'ha eliminato 'else 'ha modificato 'end||case when s->>'event_type'='meeting'then 'una call'else 'un appuntamento'end
 when table_name='tasks'then case when operation='DELETE'then 'ha eliminato un’attività'when operation='INSERT'then 'ha aggiunto un’attività'when s->>'status'='done'then 'ha completato un’attività'else 'ha aggiornato un’attività'end
 when table_name='notes'then case operation when 'INSERT'then 'ha aggiunto una nota'when 'DELETE'then 'ha eliminato una nota'else 'ha aggiornato una nota'end
 when table_name='assets'then case operation when 'INSERT'then 'ha aggiunto un contenuto'when 'DELETE'then 'ha eliminato un contenuto'else 'ha aggiornato un contenuto'end
 when table_name='product_development_projects'then case operation when 'INSERT'then 'ha avviato un progetto'when 'DELETE'then 'ha eliminato un progetto'else 'ha aggiornato un progetto'end
 when table_name='sales_orders'and operation='INSERT'then case when actor_id is null then 'ha ricevuto un ordine'else 'ha registrato una vendita'end
 when table_name='fulfillment_lines'then 'ha registrato una consegna'
 when table_name='production_receipts'then 'ha completato una produzione'
 when table_name in('order_payments','consignment_report_payments','consignment_payment_revisions','consignment_settlements')then case when s->>'deleted'='true'then 'ha eliminato un incasso'when operation='UPDATE'or table_name='consignment_payment_revisions'then 'ha modificato un incasso'else 'ha registrato un incasso'end
 when table_name='finance_movement_revisions'then case s->>'action'when 'delete'then 'ha eliminato un movimento Finance'when 'restore'then 'ha ripristinato un movimento Finance'else 'ha modificato un movimento Finance'end
 when table_name='finance_import_batches'then 'ha importato movimenti Finance'
 when table_name='finance_entry_voids'then 'ha annullato un movimento Finance'
 when area='finance'then case operation when 'INSERT'then 'ha registrato un movimento Finance'when 'DELETE'then 'ha eliminato un movimento Finance'else 'ha modificato un movimento Finance'end
 when table_name='partner_activities'then case s->>'kind'when 'inviato'then 'ha registrato un invio Partner'when 'risposta'then 'ha registrato una risposta Partner'when 'nuovo'then 'ha aggiunto un Partner'when 'stato'then 'ha aggiornato lo stato Partner'else 'ha aggiornato un Partner'end
 when table_name='partner_event_sales'then case when operation='DELETE'then 'ha rimosso il collegamento di una vendita a un evento Partner'else 'ha collegato una vendita a un evento Partner'end
 when area='partner'then 'ha aggiornato un Partner'
 when table_name='consignment_transfers'then 'ha trasferito merce in conto vendita'
 when table_name in('consignment_reports','consignment_report_revisions')then 'ha aggiornato un resoconto conto vendita'
 when table_name='consignment_shipments'then 'ha registrato una spedizione conto vendita'
 when table_name='consignment_sales'then 'ha registrato una vendita conto vendita'
 when area='packaging'then 'ha aggiornato il packaging'
 when area='settings'then 'ha aggiornato le impostazioni del team'
 when table_name='discount_rules'then 'ha aggiornato uno sconto'
 else 'ha aggiornato il magazzino'end verb,
 case when area='team'then '/team'||case when operation='DELETE'or private.activity_feed_uuid(entity_id)is null then ''when table_name='calendar_events'then '#evento-'||entity_id when table_name='tasks'then '#attivita-'||entity_id else '#nota-'||entity_id end
 when area='sales'then case when root_key like 'sales_orders:%'and private.activity_feed_uuid(split_part(root_key,':',2))is not null then '/sales#order-'||split_part(root_key,':',2)else '/sales'end
 when area='partner'then case when partner_co~'^[1-9][0-9]{0,4}$'then '/partner?co='||partner_co||'#lead-'||partner_co else '/partner'end
 when area='finance'then '/finance'when area='packaging'then '/packaging'when area='assets'then '/assets'when area='development'then '/development'||case when operation<>'DELETE'and private.activity_feed_uuid(entity_id)is not null then '#progetto-'||entity_id else ''end when area='settings'then '/auth/account'else '/stock'end href
 from classified c
)
select md5(group_key)::uuid,occurred_at,actor_id,actor_name,area,
 (case when actor_id is null then 'Il sistema'else actor_name end)||' '||verb||
 case when area in('team','assets','development')and s->>'title'is not null then ': '||(s->>'title')
 when area='partner'and partner_name is not null then ': '||partner_name||case when partner_co~'^[1-9][0-9]{0,4}$'then ' (CO '||partner_co||')'else ''end
 when area='sales'and(table_name='sales_orders'or delivered_quantity is not null)and(coalesce(delivered_quantity,order_quantity)is not null or channel in('shopify_web','shopify_pos','direct','etsy'))then ' ('||concat_ws(' · ',coalesce(delivered_quantity,order_quantity)::text||' unità',case coalesce(channel,s->>'channel')when 'shopify_web'then 'Shopify online'when 'shopify_pos'then 'Shopify POS'when 'direct'then 'diretta'when 'etsy'then 'Etsy'end)||')'
 when area='finance'then coalesce(' · '||(s->>'category'),'')||case when s->>'amount_before'is not null and s->>'amount_after'is not null and s->>'amount_before'<>s->>'amount_after'then ' · da '||private.activity_feed_money((s->>'amount_before')::bigint)||' a '||private.activity_feed_money((s->>'amount_after')::bigint)when s->>'amount_after'is not null then ' · '||private.activity_feed_money((s->>'amount_after')::bigint)else ''end
 else ''end||'.',href
from phrases
$$;

create function private.ceo_activity_feed(p_actor text,p_area text,p_before_at timestamptz,p_before_id uuid,p_limit integer)returns jsonb
language plpgsql stable security definer set search_path=''set timezone='UTC'as $$
declare result jsonb;
begin
 if auth.uid()is null or not private.can_audit()then raise exception 'ceo_access_required'using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 50 or(p_actor is not null and p_actor<>'system'and private.activity_feed_uuid(p_actor)is null)
  or(p_area is not null and p_area not in('team','sales','stock','packaging','finance','partner','development','assets','settings'))
  or(p_before_at is null)<>(p_before_id is null)or(p_before_at is not null and not isfinite(p_before_at))then raise exception 'invalid_activity_query'using errcode='22023';end if;
 with actions as materialized(select * from private.activity_feed_actions()),filtered as(
  select * from actions where(p_actor is null and actor_id is distinct from auth.uid()or p_actor='system'and actor_id is null or actor_id=private.activity_feed_uuid(p_actor))
   and(p_area is null or area=p_area)and(p_before_at is null or(occurred_at,id)<(p_before_at,p_before_id))
 ),page as(select * from filtered order by occurred_at desc,id desc limit p_limit+1),visible as(select * from page order by occurred_at desc,id desc limit p_limit),last_row as(select * from visible order by occurred_at,id limit 1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'occurred_at',to_char(occurred_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'actor_id',actor_id,'actor_name',actor_name,'area',area,'message',message,'href',href)order by occurred_at desc,id desc)from visible),'[]'::jsonb),
  'actors',coalesce((select jsonb_agg(jsonb_build_object('id',actor,'name',name)order by name,actor)from(select distinct coalesce(actor_id::text,'system')actor,actor_name name from actions)names),'[]'::jsonb),
  'next_cursor',case when(select count(*)from page)>p_limit then(select jsonb_build_object('occurred_at',to_char(occurred_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',id)from last_row)else null end)into result;
 return result;
end$$;
create function public.ceo_activity_feed(p_actor text default null,p_area text default null,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50)returns jsonb
language sql stable security invoker set search_path=''as $$select private.ceo_activity_feed(p_actor,p_area,p_before_at,p_before_id,p_limit)$$;
revoke all on function private.activity_feed_text(text,integer),private.activity_feed_uuid(text),private.activity_feed_cents(jsonb),private.activity_feed_money(bigint),private.activity_partner_operation(text,text),private.activity_feed_actions(),private.ceo_activity_feed(text,text,timestamptz,uuid,integer),public.ceo_activity_feed(text,text,timestamptz,uuid,integer)from public,anon,authenticated,service_role;
grant execute on function private.ceo_activity_feed(text,text,timestamptz,uuid,integer),public.ceo_activity_feed(text,text,timestamptz,uuid,integer)to authenticated;
commit;
