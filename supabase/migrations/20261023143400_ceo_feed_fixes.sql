-- Controllo CEO: correzioni del feed (privacy, tempi, operazioni di massa, link e aree).
--
-- Solo funzioni di lettura e indici. Nessuna tabella, colonna, trigger o riga nuova o cambiata:
-- audit_logs resta append-only e nessuna riga esistente viene toccata.
--
-- 1. Privacy: le frasi non portano più importi, categorie o descrizioni di Finance e degli incassi.
--    L'unico importo è il «da fatturare» del resoconto mensile del conto vendita (decisione 16,
--    03 §10), già visibile a ogni membro nella pagina del resoconto.
-- 2. Ultime 24 ore e tempi: il feed mostra solo le azioni delle ultime 24 ore (decisione di Tommi
--    del 23 ottobre 2026); le righe più vecchie restano in audit_logs e il feed non le legge.
--    Dentro le 24 ore legge blocchi prima del cursore e completa ogni transazione del blocco. Le
--    relazioni con righe fuori dal blocco (riga padre, canale della vendita, nome del contatto) si
--    leggono per chiave con gli indici nuovi, mai ricalcolando la storia.
-- 3. Operazioni di massa: nella stessa transazione (stesso occurred_at e attore) le azioni dello
--    stesso tipo diventano una frase con il numero («Il sistema ha importato 207 contatti in Partner»).
-- 4. Aree e link della decisione 17: area «Conto vendita», resoconto, Partner, rettifiche, Finance.
-- 5. Archiviare e ripristinare un contenuto hanno la loro frase.
-- 6. Annullamenti e resi delle vendite (PR #9) hanno la loro frase. Il feed legge solo audit_logs:
--    i nomi delle tabelle sono testo, quindi la migrazione si applica anche dove non esistono.
--
-- Le funzioni esistenti mantengono firma, sicurezza (security definer per ceo_activity_feed,
-- search_path vuoto) e permessi; le nuove funzioni di supporto sono private e senza EXECUTE.
begin;

-- Indici additivi: ricerca per elemento (riga padre e storia), per persona e per i solleciti.
create index if not exists audit_logs_feed_entity on public.audit_logs
  (table_name, (coalesce(new_data ->> 'id', old_data ->> 'id', record_key ->> 'id')));
create index if not exists audit_logs_actor_time on public.audit_logs (actor_id, occurred_at desc);
create index if not exists audit_logs_follow_up_task on public.audit_logs ((new_data ->> 'task_id'))
  where table_name = 'partner_work_links' and operation = 'INSERT';

-- Le sole chiavi che il feed legge da una riga di audit. Nessun importo, categoria, descrizione,
-- motivo, testo di messaggio o recapito. Unica eccezione: brand_cents del resoconto mensile.
create function private.activity_feed_keys(p_table text, p_new jsonb, p_old jsonb, p_key jsonb) returns jsonb
language sql immutable security invoker set search_path = '' as $$
 select jsonb_strip_nulls(
  jsonb_build_object(
   'id', coalesce(p_new ->> 'id', p_old ->> 'id', p_key ->> 'id'),
   'user_id', coalesce(p_new ->> 'user_id', p_old ->> 'user_id', p_key ->> 'user_id'),
   'stock_item_id', coalesce(p_new ->> 'stock_item_id', p_old ->> 'stock_item_id', p_key ->> 'stock_item_id'),
   'location_id', coalesce(p_new ->> 'location_id', p_old ->> 'location_id', p_key ->> 'location_id'),
   'order_id', coalesce(p_new ->> 'order_id', p_old ->> 'order_id'),
   'task_id', coalesce(p_new ->> 'task_id', p_old ->> 'task_id'),
   'calendar_event_id', coalesce(p_new ->> 'calendar_event_id', p_old ->> 'calendar_event_id'),
   'project_id', coalesce(p_new ->> 'project_id', p_old ->> 'project_id'),
   'event_id', coalesce(p_new ->> 'event_id', p_old ->> 'event_id', p_key ->> 'event_id'),
   'order_line_id', coalesce(p_new ->> 'order_line_id', p_old ->> 'order_line_id'),
   'requirement_id', coalesce(p_new ->> 'requirement_id', p_old ->> 'requirement_id'),
   'entry_id', coalesce(p_new ->> 'entry_id', p_old ->> 'entry_id'),
   'sale_id', coalesce(p_new ->> 'sale_id', p_old ->> 'sale_id'),
   'batch_id', coalesce(p_new ->> 'batch_id', p_old ->> 'batch_id'),
   'partner_id', coalesce(p_new ->> 'partner_id', p_old ->> 'partner_id', p_key ->> 'partner_id'),
   'variant_id', coalesce(p_new ->> 'variant_id', p_old ->> 'variant_id', p_key ->> 'variant_id'),
   'report_id', coalesce(p_new ->> 'report_id', p_old ->> 'report_id'),
   'payment_id', coalesce(p_new ->> 'payment_id', p_old ->> 'payment_id'),
   'shipment_id', coalesce(p_new ->> 'shipment_id', p_old ->> 'shipment_id'),
   'count_id', coalesce(p_new ->> 'count_id', p_old ->> 'count_id'),
   'consumption_id', coalesce(p_new ->> 'consumption_id', p_old ->> 'consumption_id'),
   'operation_id', coalesce(p_new ->> 'operation_id', p_old ->> 'operation_id'),
   'source_id', coalesce(p_new ->> 'source_id', p_old ->> 'source_id'),
   'source_kind', coalesce(p_new ->> 'source_kind', p_old ->> 'source_kind'),
   'return_id', coalesce(p_new ->> 'return_id', p_old ->> 'return_id'),
   'return_line_id', coalesce(p_new ->> 'return_line_id', p_old ->> 'return_line_id'))
  || jsonb_build_object(
   'parent_order', coalesce(p_new #>> '{source,sales_order_id}', p_old #>> '{source,sales_order_id}'),
   'parent_line', coalesce(p_new #>> '{source,sales_order_line_id}', p_old #>> '{source,sales_order_line_id}'),
   'parent_consumption', coalesce(p_new #>> '{source,packaging_consumption_id}', p_old #>> '{source,packaging_consumption_id}'),
   'parent_report', coalesce(p_new #>> '{source,consignment_report_id}', p_old #>> '{source,consignment_report_id}'),
   'parent_transfer', coalesce(p_new #>> '{source,consignment_transfer_id}', p_old #>> '{source,consignment_transfer_id}'),
   'parent_sale', coalesce(p_new #>> '{source,consignment_sale_id}', p_old #>> '{source,consignment_sale_id}'),
   'parent_shipment', coalesce(p_new #>> '{source,consignment_shipment_id}', p_old #>> '{source,consignment_shipment_id}'),
   'parent_count', coalesce(p_new #>> '{source,consignment_count_id}', p_old #>> '{source,consignment_count_id}'),
   'shop_location', case when p_table = 'stock_locations'
     and coalesce(p_new #>> '{source,consignment_operation_id}', p_old #>> '{source,consignment_operation_id}') is not null
     then coalesce(p_new ->> 'id', p_old ->> 'id', p_key ->> 'id') end,
   'packaging_operation', coalesce(p_new #>> '{source,packaging_operation_id}', p_old #>> '{source,packaging_operation_id}'),
   'kind', coalesce(p_new ->> 'kind', p_old ->> 'kind'),
   'origin', coalesce(p_new ->> 'origin', p_old ->> 'origin'),
   'channel', coalesce(p_new ->> 'channel', p_old ->> 'channel'),
   'action', coalesce(p_new ->> 'action', p_old ->> 'action'),
   'version', coalesce(p_new ->> 'version', p_old ->> 'version'),
   'previous_version', coalesce(p_new ->> 'previous_version', p_old ->> 'previous_version'),
   'status', coalesce(p_new ->> 'status', p_old ->> 'status'),
   'stage_after', coalesce(p_new ->> 'stage_after', p_old ->> 'stage_after'),
   'deleted', coalesce(p_new ->> 'deleted', p_new ->> 'voided'))
  || jsonb_build_object(
   'event_type', coalesce(p_new ->> 'event_type', p_old ->> 'event_type'),
   'partner_co', coalesce(p_new ->> 'partner_co', p_old ->> 'partner_co', p_new ->> 'co', p_old ->> 'co'),
   'title', private.activity_feed_text(coalesce(p_new ->> 'title', p_old ->> 'title', p_new ->> 'partner_name',
     p_old ->> 'partner_name', p_new ->> 'name', p_old ->> 'name')),
   'quantity', case when coalesce(p_new ->> 'quantity', p_old ->> 'quantity') ~ '^[0-9]{1,9}$'
     then coalesce(p_new ->> 'quantity', p_old ->> 'quantity') end,
   'archived_before', case when p_table = 'assets' and p_old is not null then (p_old ->> 'archived_at' is not null)::text end,
   'archived_after', case when p_table = 'assets' and p_new is not null then (p_new ->> 'archived_at' is not null)::text end,
   'period', case when left(coalesce(p_new ->> 'period_month', p_new #>> '{snapshot,period_month}', p_old ->> 'period_month'), 7)
     ~ '^2[0-9]{3}-(0[1-9]|1[0-2])$' then left(coalesce(p_new ->> 'period_month', p_new #>> '{snapshot,period_month}', p_old ->> 'period_month'), 7) end,
   'pieces', case when coalesce(p_new ->> 'pieces', p_new #>> '{snapshot,pieces}') ~ '^[0-9]{1,9}$'
     then coalesce(p_new ->> 'pieces', p_new #>> '{snapshot,pieces}') end,
   'brand_cents', case when p_table = 'consignment_report_revisions' and p_new #>> '{snapshot,brand_cents}' ~ '^[0-9]{1,15}$'
     then p_new #>> '{snapshot,brand_cents}' end,
   'revision', case when coalesce(p_new ->> 'revision', p_old ->> 'revision') ~ '^[0-9]{1,6}$' then coalesce(p_new ->> 'revision', p_old ->> 'revision') end,
   'change_kind', coalesce(p_new ->> 'change_kind', p_old ->> 'change_kind'),
   'direction', coalesce(p_new ->> 'direction', p_old ->> 'direction'),
   'order_number', case when coalesce(p_new ->> 'order_number', p_old ->> 'order_number') ~ '^[0-9]{1,7}$'
     then coalesce(p_new ->> 'order_number', p_old ->> 'order_number') end,
   'device', coalesce(p_new ->> 'device', p_old ->> 'device')))
$$;

-- Solo le chiavi che servono a trovare la riga padre (letture per chiave nella storia: niente testo).
create function private.activity_feed_link_keys(p_table text, p_new jsonb, p_old jsonb, p_key jsonb) returns jsonb
language sql immutable security invoker set search_path = '' as $$
 select jsonb_strip_nulls(jsonb_build_object(
   'stock_item_id', coalesce(p_new ->> 'stock_item_id', p_old ->> 'stock_item_id', p_key ->> 'stock_item_id'),
   'order_id', coalesce(p_new ->> 'order_id', p_old ->> 'order_id'),
   'order_line_id', coalesce(p_new ->> 'order_line_id', p_old ->> 'order_line_id'),
   'requirement_id', coalesce(p_new ->> 'requirement_id', p_old ->> 'requirement_id'),
   'entry_id', coalesce(p_new ->> 'entry_id', p_old ->> 'entry_id'),
   'sale_id', coalesce(p_new ->> 'sale_id', p_old ->> 'sale_id'),
   'batch_id', coalesce(p_new ->> 'batch_id', p_old ->> 'batch_id'),
   'partner_id', coalesce(p_new ->> 'partner_id', p_old ->> 'partner_id', p_key ->> 'partner_id'),
   'variant_id', coalesce(p_new ->> 'variant_id', p_old ->> 'variant_id', p_key ->> 'variant_id'),
   'report_id', coalesce(p_new ->> 'report_id', p_old ->> 'report_id'),
   'payment_id', coalesce(p_new ->> 'payment_id', p_old ->> 'payment_id'),
   'shipment_id', coalesce(p_new ->> 'shipment_id', p_old ->> 'shipment_id'),
   'count_id', coalesce(p_new ->> 'count_id', p_old ->> 'count_id'),
   'consumption_id', coalesce(p_new ->> 'consumption_id', p_old ->> 'consumption_id'),
   'source_id', coalesce(p_new ->> 'source_id', p_old ->> 'source_id'),
   'source_kind', coalesce(p_new ->> 'source_kind', p_old ->> 'source_kind'),
   'return_id', coalesce(p_new ->> 'return_id', p_old ->> 'return_id'),
   'return_line_id', coalesce(p_new ->> 'return_line_id', p_old ->> 'return_line_id'),
   'parent_order', coalesce(p_new #>> '{source,sales_order_id}', p_old #>> '{source,sales_order_id}'),
   'parent_line', coalesce(p_new #>> '{source,sales_order_line_id}', p_old #>> '{source,sales_order_line_id}'),
   'parent_consumption', coalesce(p_new #>> '{source,packaging_consumption_id}', p_old #>> '{source,packaging_consumption_id}'),
   'parent_report', coalesce(p_new #>> '{source,consignment_report_id}', p_old #>> '{source,consignment_report_id}'),
   'parent_transfer', coalesce(p_new #>> '{source,consignment_transfer_id}', p_old #>> '{source,consignment_transfer_id}'),
   'parent_sale', coalesce(p_new #>> '{source,consignment_sale_id}', p_old #>> '{source,consignment_sale_id}'),
   'parent_shipment', coalesce(p_new #>> '{source,consignment_shipment_id}', p_old #>> '{source,consignment_shipment_id}'),
   'parent_count', coalesce(p_new #>> '{source,consignment_count_id}', p_old #>> '{source,consignment_count_id}'),
   'shop_location', case when p_table = 'stock_locations'
     and coalesce(p_new #>> '{source,consignment_operation_id}', p_old #>> '{source,consignment_operation_id}') is not null
     then coalesce(p_new ->> 'id', p_old ->> 'id', p_key ->> 'id') end))
$$;

-- Elemento della riga: la chiave id, oppure la chiave naturale delle tabelle senza id.
create function private.activity_feed_entity(p_table text, p_s jsonb, p_audit uuid) returns text
language sql immutable security invoker set search_path = '' as $$
 select coalesce(p_s ->> 'id', case
   when p_table in ('profiles', 'memberships') then p_s ->> 'user_id'
   when p_table in ('product_variants', 'packaging_items', 'stock_balances') then p_s ->> 'stock_item_id'
   when p_table = 'stock_reservations' then p_s ->> 'order_line_id'
   when p_table = 'consignment_shops' then p_s ->> 'location_id' end, p_audit::text)
$$;

-- Elemento padre di una riga (vendita, resoconto, contatto…), come nella migrazione del feed.
create function private.activity_feed_parent(p_table text, p_s jsonb) returns text
language sql immutable security invoker set search_path = '' as $$
 select case
  when p_table in ('sales_order_lines', 'order_payments', 'commercial_facts', 'shopify_refund_observations', 'shopify_order_financials',
    'shopify_transaction_observations', 'sales_registration_cancellations', 'manual_sale_returns') then 'sales_orders:' || (p_s ->> 'order_id')
  when p_table in ('fulfillment_lines', 'stock_reservations', 'stock_reservation_events', 'production_requirements') then 'sales_order_lines:' || (p_s ->> 'order_line_id')
  when p_table = 'production_receipts' then 'production_requirements:' || (p_s ->> 'requirement_id')
  when p_table = 'finance_entry_voids' then 'finance_entries:' || (p_s ->> 'entry_id')
  when p_table = 'finance_import_transactions' then 'finance_import_batches:' || (p_s ->> 'batch_id')
  when p_table = 'finance_movement_revisions' then 'finance_movement:' || coalesce(p_s ->> 'source_kind', 'unknown') || ':' || (p_s ->> 'source_id')
  when p_table in ('partner_contacts', 'partner_message_variants', 'partner_activities', 'partner_do_not_contact', 'partner_import_differences',
    'partner_work_links', 'partner_event_sales') then 'partners:' || (p_s ->> 'partner_id')
  when p_table = 'partner_message_revisions' then 'partner_message_variants:' || (p_s ->> 'variant_id')
  when p_table in ('consignment_report_lines', 'consignment_report_revisions', 'consignment_report_movements', 'consignment_report_payments')
    then 'consignment_reports:' || (p_s ->> 'report_id')
  when p_table = 'consignment_payment_revisions' then 'consignment_report_payments:' || (p_s ->> 'payment_id')
  when p_table = 'consignment_order_lines' then 'consignment_orders:' || (p_s ->> 'order_id')
  when p_table = 'consignment_shipment_lines' then 'consignment_shipments:' || (p_s ->> 'shipment_id')
  when p_table = 'consignment_count_lines' then 'consignment_counts:' || (p_s ->> 'count_id')
  when p_table = 'consignment_settlements' then 'consignment_sales:' || (p_s ->> 'sale_id')
  when p_table in ('manual_sale_return_lines', 'manual_sale_return_packaging') then 'manual_sale_returns:' || (p_s ->> 'return_id')
  when p_table = 'manual_sale_return_fulfillments' then 'manual_sale_return_lines:' || (p_s ->> 'return_line_id')
  when p_table = 'packaging_consumptions' and p_s ->> 'source_kind' = 'fulfillment' then 'fulfillment_lines:' || (p_s ->> 'source_id')
  when p_table = 'packaging_consumptions' and p_s ->> 'source_kind' = 'consignment' then 'consignment_sales:' || (p_s ->> 'source_id')
  when p_table = 'packaging_consumption_entries' then 'packaging_consumptions:' || (p_s ->> 'consumption_id')
  when p_table = 'stock_movements' then coalesce('sales_orders:' || (p_s ->> 'parent_order'), 'sales_order_lines:' || (p_s ->> 'parent_line'),
    'packaging_consumptions:' || (p_s ->> 'parent_consumption'), 'consignment_reports:' || (p_s ->> 'parent_report'),
    'consignment_transfers:' || (p_s ->> 'parent_transfer'), 'consignment_sales:' || (p_s ->> 'parent_sale'),
    'consignment_shipments:' || (p_s ->> 'parent_shipment'), 'consignment_counts:' || (p_s ->> 'parent_count'),
    'stock_items:' || (p_s ->> 'stock_item_id'))
  when p_table = 'stock_locations' then 'consignment_shops:' || (p_s ->> 'shop_location')
  when p_table in ('product_variants', 'packaging_items', 'stock_balances') then 'stock_items:' || (p_s ->> 'stock_item_id')
 end
$$;

create function private.activity_feed_count(p_n bigint, p_one text, p_many text) returns text
language sql immutable security invoker set search_path = '' as $$
 select case when p_n = 1 then '1 ' || p_one else p_n::text || ' ' || p_many end
$$;

create function private.activity_feed_month(p_period text) returns text
language sql immutable security invoker set search_path = '' as $$
 select case when p_period ~ '^2[0-9]{3}-(0[1-9]|1[0-2])$' then (array['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
   'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'])[substr(p_period, 6, 2)::integer] || ' ' || left(p_period, 4) end
$$;

-- Le frasi delle transazioni con occurred_at tra p_from e p_to (estremi compresi). Ogni
-- transazione della finestra è completa: le righe di una transazione hanno lo stesso occurred_at.
create function private.activity_feed_window(p_from timestamptz, p_to timestamptz, p_actor text)
returns table(id uuid, occurred_at timestamptz, actor_id uuid, actor_name text, area text, message text, href text)
language sql stable security invoker set search_path = '' set timezone = 'UTC' as $$
with recursive extracted as materialized (
 select a.id audit_id, a.occurred_at, a.actor_id, a.table_name, a.operation,
  private.activity_feed_keys(a.table_name, a.new_data, a.old_data, a.record_key) s
 from public.audit_logs a
 where a.occurred_at >= p_from and a.occurred_at <= p_to
  and (p_actor is null or (p_actor = 'system' and a.actor_id is null) or a.actor_id = private.activity_feed_uuid(p_actor))
  and a.table_name in ('calendar_events', 'tasks', 'notes', 'assets', 'product_development_projects', 'profiles', 'memberships', 'app_settings',
   'discount_rules', 'products', 'stock_items', 'product_variants', 'packaging_items', 'stock_locations', 'stock_balances', 'stock_movements',
   'sales_orders', 'sales_order_lines', 'order_payments', 'fulfillment_lines', 'stock_reservations', 'stock_reservation_events',
   'production_requirements', 'production_receipts', 'commercial_facts', 'shopify_refund_observations', 'shopify_order_financials',
   'shopify_transaction_observations', 'sales_registration_cancellations', 'manual_sale_returns', 'manual_sale_return_lines',
   'manual_sale_return_fulfillments', 'manual_sale_return_packaging',
   'finance_entries', 'finance_entry_voids', 'finance_import_batches', 'finance_import_transactions', 'finance_documents', 'finance_movement_revisions',
   'packaging_consumptions', 'packaging_consumption_entries', 'packaging_automation', 'packaging_automation_failures',
   'partners', 'partner_contacts', 'partner_message_variants', 'partner_message_revisions', 'partner_activities', 'partner_do_not_contact',
   'partner_research_imports', 'partner_device_imports', 'partner_import_differences', 'partner_work_links', 'partner_event_sales',
   'consignment_transfers', 'consignment_sales', 'consignment_settlements', 'consignment_shops', 'consignment_counts', 'consignment_count_lines',
   'consignment_reports', 'consignment_report_lines', 'consignment_report_revisions', 'consignment_report_movements', 'consignment_report_payments',
   'consignment_payment_revisions', 'consignment_orders', 'consignment_order_lines', 'consignment_shipments', 'consignment_shipment_lines')
), identified as (
 -- tx_actor: the actor as text, so transaction joins are hash joins (never per-row scans).
 select e.*, private.activity_feed_entity(e.table_name, e.s, e.audit_id) entity_id, coalesce(e.actor_id::text, 'system') tx_actor from extracted e
), generated_targets as materialized (
 -- The inverse relation applies only to the artifact's creation transaction.
 select t.audit_id, min(l.s ->> 'partner_id') partner_id
 from identified t join identified l on l.table_name = 'partner_work_links' and l.operation = 'INSERT'
  and l.occurred_at = t.occurred_at and l.tx_actor = t.tx_actor
  and l.s ->> (case t.table_name when 'tasks' then 'task_id' when 'calendar_events' then 'calendar_event_id' when 'product_development_projects' then 'project_id' end) = t.entity_id
 where t.operation = 'INSERT' and t.table_name in ('tasks', 'calendar_events', 'product_development_projects')
  and private.activity_feed_uuid(l.s ->> 'partner_id') is not null
 group by t.audit_id having count(distinct l.s ->> 'partner_id') = 1
), nodes as materialized (
 select i.*,
  case when g.partner_id is not null then 'generated:' || i.audit_id::text else i.table_name || ':' || i.entity_id end entity_key,
  case when g.partner_id is not null then 'partners:' || g.partner_id else private.activity_feed_parent(i.table_name, i.s) end parent_key
 from identified i left join generated_targets g on g.audit_id = i.audit_id
), local_edges as materialized (
 select n.entity_key, array_agg(distinct n.parent_key) filter (where n.parent_key is not null and n.parent_key <> n.entity_key) parents
 from nodes n group by n.entity_key
), chain(key, parent) as (
 -- Each element's parent, one parent or none. Rows of this window decide; the history is read by
 -- key (audit_logs_feed_entity) only for an ancestor outside the window whose table has parents.
 select l.entity_key, case when cardinality(l.parents) = 1 then l.parents[1] end from local_edges l
 union
 select c.parent, case when w.entity_key is not null then (case when cardinality(w.parents) = 1 then w.parents[1] end)
  when split_part(c.parent, ':', 1) in ('sales_order_lines', 'fulfillment_lines', 'production_requirements', 'packaging_consumptions',
   'consignment_report_payments', 'partner_message_variants', 'manual_sale_returns', 'manual_sale_return_lines', 'consignment_sales',
   'stock_reservations', 'finance_entry_voids', 'finance_import_transactions', 'stock_movements', 'stock_locations') then (
   select case when count(distinct x.p) = 1 then min(x.p) end from (
    select private.activity_feed_parent(a.table_name, private.activity_feed_link_keys(a.table_name, a.new_data, a.old_data, a.record_key)) p
    from public.audit_logs a
    where a.table_name = split_part(c.parent, ':', 1)
     and coalesce(a.new_data ->> 'id', a.old_data ->> 'id', a.record_key ->> 'id') = substr(c.parent, strpos(c.parent, ':') + 1)
   ) x where x.p is not null and x.p <> c.parent) end
 from chain c left join local_edges w on w.entity_key = c.parent where c.parent is not null
), edges as materialized (
 select c.key entity_key, min(c.parent) parent_key from chain c where c.parent is not null group by c.key having count(distinct c.parent) = 1
), walk as (
 select n.audit_id, n.entity_key root_key, 0 depth, array[n.entity_key] visited from nodes n
 union all
 select w.audit_id, e.parent_key, w.depth + 1, w.visited || e.parent_key
 from walk w join edges e on e.entity_key = w.root_key where w.depth < 12 and not e.parent_key = any(w.visited)
), roots as (
 select distinct on (w.audit_id) w.audit_id, w.root_key from walk w order by w.audit_id, w.depth desc
), moved as materialized (
 select distinct n.occurred_at, n.tx_actor, n.s ->> 'stock_item_id' item, n.s ->> 'location_id' location from nodes n where n.table_name = 'stock_movements'
), edited as materialized (
 select distinct n.occurred_at, n.tx_actor, n.entity_id from nodes n where n.table_name = 'calendar_events'
), prepared as (
 select n.*, r.root_key,
  case when n.operation = 'INSERT' and n.table_name in ('sales_orders', 'production_receipts', 'finance_movement_revisions') then n.s ->> 'operation_id'
   when n.operation = 'INSERT' and n.table_name in ('consignment_sales', 'consignment_transfers', 'consignment_report_revisions', 'consignment_payment_revisions', 'consignment_shipments') then n.entity_id
   when n.operation = 'INSERT' and n.table_name = 'partner_activities' then coalesce(n.s ->> 'operation_id', private.activity_partner_operation(n.table_name, n.entity_id))
   when n.table_name = 'stock_movements' and r.root_key like 'stock_items:%' then coalesce(n.s ->> 'packaging_operation', n.s ->> 'operation_id') end anchor,
  case when n.table_name in ('sales_registration_cancellations', 'manual_sale_returns', 'partner_research_imports', 'partner_device_imports') then 190
   when n.table_name = 'finance_movement_revisions' then 180
   when n.table_name = 'partner_activities' then 170
   when n.table_name = 'sales_orders' and n.operation = 'INSERT' then 160
   when n.table_name in ('order_payments', 'consignment_report_payments') then 150
   when n.table_name in ('fulfillment_lines', 'production_receipts', 'consignment_payment_revisions', 'consignment_report_revisions',
    'consignment_counts', 'consignment_shipments', 'consignment_orders', 'consignment_shops') then 140
   when n.table_name in ('calendar_events', 'tasks', 'notes', 'assets', 'product_development_projects', 'finance_entries', 'finance_import_batches', 'finance_entry_voids') then 130
   when n.table_name = 'stock_movements' then 110
   when n.table_name = 'stock_balances' then 1 else 80 end priority
 from nodes n join roots r using (audit_id)
 -- A balance next to its movement is the same action.
 left join moved m on n.table_name = 'stock_balances' and m.occurred_at = n.occurred_at and m.tx_actor = n.tx_actor
  and m.item = n.s ->> 'stock_item_id' and m.location = n.s ->> 'location_id'
 -- Calendar edits invalidate a link's CAS version: not another human action.
 left join edited e on n.table_name = 'partner_work_links' and n.operation = 'UPDATE' and e.occurred_at = n.occurred_at
  and e.tx_actor = n.tx_actor and e.entity_id = n.s ->> 'calendar_event_id'
 where m.item is null and e.entity_id is null
  -- P5 closes existing reminders in the same source action: an earlier, immutable follow-up link
  -- plus the explicit team activity of this transaction proves the side effect.
  and not (n.table_name = 'tasks' and n.operation = 'UPDATE' and n.s ->> 'status' = 'done' and exists (
   select 1 from public.audit_logs l join nodes a on a.table_name = 'partner_activities'
    and a.s ->> 'partner_id' = coalesce(l.new_data ->> 'partner_id', l.record_key ->> 'partner_id')
    and a.occurred_at = n.occurred_at and a.tx_actor = n.tx_actor and a.s ->> 'origin' = 'team'
    and (a.s ->> 'kind' in ('inviato', 'risposta', 'non_contattare') or (a.s ->> 'kind' = 'stato' and a.s ->> 'stage_after' in ('chiuso', 'no')))
   where l.table_name = 'partner_work_links' and l.operation = 'INSERT' and l.new_data ->> 'task_id' = n.entity_id
    and l.new_data ->> 'kind' = 'follow_up' and l.occurred_at <= n.occurred_at))
), scopes as (
 select p.root_key, p.occurred_at, p.tx_actor, count(distinct p.anchor) anchors, min(p.anchor) anchor from prepared p group by p.root_key, p.occurred_at, p.tx_actor
), tagged as (
 select p.*, p.root_key || '|' || p.tx_actor || '|' || coalesce(case when t.anchors = 1 then t.anchor when t.anchors > 1 then p.anchor end,
   'tx:' || to_char(p.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) group_key
 from prepared p join scopes t on t.root_key = p.root_key and t.occurred_at = p.occurred_at and t.tx_actor = p.tx_actor
 where t.anchors <= 1 or p.anchor is not null
), line_quantities as (
 select q.group_key, sum(q.quantity) order_quantity from (
  select n.group_key, max((n.s ->> 'quantity')::bigint) quantity from tagged n where n.table_name = 'sales_order_lines' group by n.group_key, n.entity_id) q
 group by q.group_key
), summary as (
 select t.group_key, max(t.occurred_at) occurred_at, t.actor_id, min(q.order_quantity) order_quantity,
  sum((t.s ->> 'quantity')::bigint) filter (where t.table_name = 'fulfillment_lines') delivered_quantity,
  count(*) filter (where t.table_name = 'finance_import_transactions') imported_rows,
  max(t.s ->> 'channel') filter (where t.table_name = 'sales_orders') own_channel,
  max(t.s ->> 'partner_co') own_partner_co,
  max(t.s ->> 'title') filter (where t.table_name in ('partners', 'partner_activities')) own_partner_name,
  t.root_key summary_root
 from tagged t left join line_quantities q using (group_key) group by t.group_key, t.actor_id, t.root_key
), rooted as (
 -- The order's channel and the contact's name and CO come from the latest row of the root, read by key.
 select g.*, coalesce(g.own_channel, case when g.summary_root like 'sales_orders:%' then r.s ->> 'channel' end) channel,
  coalesce(g.own_partner_co, case when g.summary_root like 'partners:%' then r.s ->> 'partner_co' end) partner_co,
  coalesce(g.own_partner_name, case when g.summary_root like 'partners:%' then r.s ->> 'title' end) partner_name
 from summary g left join lateral (
  select private.activity_feed_keys(a.table_name, a.new_data, a.old_data, a.record_key) s
  from public.audit_logs a
  where (g.summary_root like 'sales_orders:%' and g.own_channel is null or g.summary_root like 'partners:%' and (g.own_partner_co is null or g.own_partner_name is null))
   and a.table_name = split_part(g.summary_root, ':', 1)
   and coalesce(a.new_data ->> 'id', a.old_data ->> 'id', a.record_key ->> 'id') = substr(g.summary_root, strpos(g.summary_root, ':') + 1)
   and (g.summary_root like 'sales_orders:%' or a.occurred_at <= g.occurred_at)
  order by a.occurred_at desc, a.id desc limit 1) r on true
), chosen as (
 select distinct on (t.group_key) t.group_key, t.table_name, t.operation, t.s, t.root_key, t.entity_id from tagged t order by t.group_key, t.priority desc, t.audit_id desc
), classified as (
 select g.*, c.table_name, c.operation, c.s, c.root_key, c.entity_id,
  coalesce(private.activity_feed_text(p.display_name, 120), case when g.actor_id is null then 'Automazioni' else 'Membro non disponibile' end) actor_name,
  case when c.table_name like 'consignment_%' or c.root_key like 'consignment_shops:%' then private.activity_feed_text(loc.name, 80) end shop_name,
  case when c.table_name like 'consignment_%' or c.root_key like 'consignment_shops:%' then upper(loc.code) end shop_code,
  case when c.table_name like 'finance_%' or c.table_name in ('order_payments', 'shopify_refund_observations', 'shopify_order_financials',
     'shopify_transaction_observations', 'consignment_settlements', 'consignment_report_payments', 'consignment_payment_revisions') then 'finance'
   when c.table_name in ('calendar_events', 'tasks', 'notes') then 'team'
   when c.table_name like 'partner%' then 'partner'
   when c.table_name = 'sales_registration_cancellations' or c.table_name like 'manual_sale_return%' then 'sales'
   when c.table_name like 'consignment_%' or c.root_key like 'consignment_shops:%' then 'consignment'
   when c.root_key like 'sales_orders:%' or c.table_name = 'discount_rules' then 'sales'
   when c.table_name = 'assets' then 'assets'
   when c.table_name = 'product_development_projects' then 'development'
   when c.table_name like 'packaging_%' or exists (select 1 from public.stock_items z where z.id = private.activity_feed_uuid(c.s ->> 'stock_item_id') and z.kind = 'packaging') then 'packaging'
   when c.table_name in ('profiles', 'memberships', 'app_settings') then 'settings' else 'stock' end area
 from rooted g join chosen c using (group_key)
 left join public.profiles p on p.user_id = g.actor_id
 left join public.stock_locations loc on loc.id = private.activity_feed_uuid(case when c.table_name = 'consignment_shops' then c.entity_id else c.s ->> 'location_id' end)
), worded as (
 select c.*,
  coalesce(c.shop_name, 'un negozio') shop,
  case when c.s ->> 'period' is not null then 'di ' || private.activity_feed_month(c.s ->> 'period') || ' ' else '' end month_part,
  case when c.s ->> 'pieces' is not null then private.activity_feed_count((c.s ->> 'pieces')::bigint, 'pezzo', 'pezzi') end pieces_label,
  case when c.table_name in ('order_payments', 'consignment_settlements', 'consignment_report_payments', 'consignment_payment_revisions') then
    case when c.s ->> 'deleted' = 'true' then 'delete' when c.operation = 'UPDATE' or c.table_name = 'consignment_payment_revisions' then 'update' else 'insert' end end payment_action
 from classified c
), phrases as (
 select w.*,
 case
  when w.table_name = 'calendar_events' then case w.operation when 'INSERT' then 'ha aggiunto ' when 'DELETE' then 'ha eliminato ' else 'ha modificato ' end
   || case when w.s ->> 'event_type' = 'meeting' then 'una call' else 'un appuntamento' end
  when w.table_name = 'tasks' then case when w.operation = 'DELETE' then 'ha eliminato un’attività' when w.operation = 'INSERT' then 'ha aggiunto un’attività'
   when w.s ->> 'status' = 'done' then 'ha completato un’attività' else 'ha aggiornato un’attività' end
  when w.table_name = 'notes' then case w.operation when 'INSERT' then 'ha aggiunto una nota' when 'DELETE' then 'ha eliminato una nota' else 'ha aggiornato una nota' end
  when w.table_name = 'assets' then case when w.operation = 'INSERT' then 'ha aggiunto un contenuto' when w.operation = 'DELETE' then 'ha eliminato un contenuto'
   when w.s ->> 'archived_before' = 'false' and w.s ->> 'archived_after' = 'true' then 'ha archiviato un contenuto'
   when w.s ->> 'archived_before' = 'true' and w.s ->> 'archived_after' = 'false' then 'ha ripristinato un contenuto' else 'ha aggiornato un contenuto' end
  when w.table_name = 'product_development_projects' then case w.operation when 'INSERT' then 'ha avviato un progetto' when 'DELETE' then 'ha eliminato un progetto' else 'ha aggiornato un progetto' end
  when w.table_name = 'sales_registration_cancellations' then 'ha annullato la registrazione di una vendita'
  when w.table_name = 'manual_sale_returns' then 'ha registrato un reso'
  when w.table_name = 'sales_orders' and w.operation = 'INSERT' then case when w.actor_id is null then 'ha ricevuto un ordine' else 'ha registrato una vendita' end
  when w.table_name = 'sales_orders' then 'ha aggiornato un ordine'
  when w.table_name = 'fulfillment_lines' then 'ha registrato una consegna'
  when w.table_name = 'production_receipts' then 'ha completato una produzione'
  when w.table_name = 'consignment_settlements' then 'ha registrato un incasso dal conto vendita'
  when w.payment_action is not null then case w.payment_action when 'delete' then 'ha eliminato un incasso' when 'update' then 'ha modificato un incasso' else 'ha registrato un incasso' end
   || case when w.table_name like 'consignment_%' then coalesce(' da ' || w.shop_name, ' dal conto vendita') else '' end
  when w.table_name = 'shopify_refund_observations' then 'ha registrato un rimborso'
  when w.table_name in ('shopify_order_financials', 'shopify_transaction_observations') then 'ha aggiornato i dati di pagamento di un ordine'
  when w.table_name = 'finance_movement_revisions' then case w.s ->> 'action' when 'delete' then 'ha eliminato un movimento Finance' when 'restore' then 'ha ripristinato un movimento Finance' else 'ha corretto un movimento Finance' end
  when w.table_name = 'finance_import_batches' then case when w.imported_rows > 0 then 'ha importato ' || private.activity_feed_count(w.imported_rows, 'movimento', 'movimenti') || ' da BudgetFlow' else 'ha importato movimenti Finance' end
  when w.table_name = 'finance_entry_voids' then 'ha annullato un movimento Finance'
  when w.table_name = 'finance_documents' then 'ha archiviato un documento Finance'
  when w.area = 'finance' then case w.operation when 'INSERT' then 'ha registrato un movimento Finance' when 'DELETE' then 'ha eliminato un movimento Finance' else 'ha corretto un movimento Finance' end
  when w.table_name = 'partner_research_imports' then 'ha importato la ricerca Partner'
  when w.table_name = 'partner_device_imports' then 'ha importato gli stati ' || case w.s ->> 'device' when 'telefono' then 'del telefono' when 'computer' then 'del computer' else 'di un dispositivo' end || ' in Partner'
  when w.table_name = 'partner_activities' then case w.s ->> 'kind' when 'inviato' then 'ha registrato un invio Partner' when 'risposta' then 'ha registrato una risposta Partner'
   when 'nuovo' then 'ha aggiunto un Partner' when 'stato' then 'ha aggiornato lo stato Partner' else 'ha aggiornato un Partner' end
  when w.table_name = 'partner_event_sales' then case when w.operation = 'DELETE' then 'ha rimosso il collegamento di una vendita a un evento Partner' else 'ha collegato una vendita a un evento Partner' end
  when w.area = 'partner' then 'ha aggiornato un Partner'
  when w.table_name = 'consignment_shops' then case when w.operation = 'INSERT' then 'ha aggiunto il negozio ' || w.shop else 'ha cambiato le condizioni di ' || w.shop end
  when w.table_name = 'consignment_counts' then 'ha contato ' || w.shop || coalesce(': ' || w.pieces_label, '')
  when w.table_name = 'consignment_report_revisions' then case
   when w.s ->> 'change_kind' = 'invoice' then 'ha segnato la fattura del resoconto ' || w.month_part || 'di ' || w.shop
   when coalesce((w.s ->> 'revision')::integer, 1) > 1 then 'ha corretto il resoconto ' || w.month_part || 'di ' || w.shop
   else 'ha registrato il resoconto ' || w.month_part || 'di ' || w.shop || coalesce(': ' || w.pieces_label
    || coalesce(', ' || private.activity_feed_money((w.s ->> 'brand_cents')::bigint) || ' da fatturare', ''), '') end
  when w.table_name = 'consignment_reports' then 'ha aggiornato il resoconto ' || w.month_part || 'di ' || w.shop
  when w.table_name = 'consignment_orders' then case when w.operation = 'INSERT' then 'ha inserito l’ordine' when w.s ->> 'status' = 'closed' then 'ha chiuso l’ordine'
   else 'ha aggiornato l’ordine' end || coalesce(' n. ' || (w.s ->> 'order_number'), '') || ' di ' || w.shop
  when w.table_name = 'consignment_shipments' then case when w.s ->> 'direction' = 'to_warehouse' then 'ha riportato ' || coalesce(w.pieces_label, 'merce') || ' in magazzino da ' || w.shop
   else 'ha consegnato ' || coalesce(w.pieces_label, 'merce') || ' a ' || w.shop end
  when w.table_name = 'consignment_transfers' then 'ha trasferito merce in conto vendita'
  when w.table_name = 'consignment_sales' then 'ha registrato una vendita in conto vendita'
  when w.area = 'consignment' then 'ha aggiornato il conto vendita'
  when w.area = 'packaging' then 'ha aggiornato il packaging'
  when w.area = 'settings' then 'ha aggiornato le impostazioni del team'
  when w.table_name = 'discount_rules' then 'ha aggiornato uno sconto'
  when w.table_name = 'stock_movements' and w.s ->> 'kind' = 'adjustment' then 'ha rettificato il magazzino'
  when w.table_name = 'stock_movements' and w.s ->> 'kind' = 'opening' then 'ha registrato la conta iniziale del magazzino'
  else 'ha aggiornato il magazzino' end verb,
 -- Same sentence for N actions of one transaction; %s is the number.
 case
  when w.table_name = 'calendar_events' then case w.operation when 'DELETE' then 'ha tolto %s appuntamenti dal calendario' when 'UPDATE' then 'ha modificato %s appuntamenti'
   else case when w.s ->> 'event_type' = 'meeting' then 'ha aggiunto %s call' else 'ha aggiunto %s appuntamenti nel calendario' end end
  when w.table_name = 'tasks' then case when w.operation = 'DELETE' then 'ha eliminato %s attività' when w.operation = 'INSERT' then 'ha aggiunto %s attività'
   when w.s ->> 'status' = 'done' then 'ha completato %s attività' else 'ha aggiornato %s attività' end
  when w.table_name = 'notes' then case w.operation when 'INSERT' then 'ha aggiunto %s note' when 'DELETE' then 'ha eliminato %s note' else 'ha aggiornato %s note' end
  when w.table_name = 'assets' then case when w.operation = 'INSERT' then 'ha aggiunto %s contenuti' when w.operation = 'DELETE' then 'ha eliminato %s contenuti'
   when w.s ->> 'archived_before' = 'false' and w.s ->> 'archived_after' = 'true' then 'ha archiviato %s contenuti'
   when w.s ->> 'archived_before' = 'true' and w.s ->> 'archived_after' = 'false' then 'ha ripristinato %s contenuti' else 'ha aggiornato %s contenuti' end
  when w.table_name = 'product_development_projects' then case w.operation when 'INSERT' then 'ha avviato %s progetti' when 'DELETE' then 'ha eliminato %s progetti' else 'ha aggiornato %s progetti' end
  when w.table_name = 'sales_registration_cancellations' then 'ha annullato la registrazione di %s vendite'
  when w.table_name = 'manual_sale_returns' then 'ha registrato %s resi'
  when w.table_name = 'sales_orders' and w.operation = 'INSERT' then case when w.actor_id is null then 'ha ricevuto %s ordini' else 'ha registrato %s vendite' end
  when w.table_name = 'sales_orders' then 'ha aggiornato %s ordini'
  when w.table_name = 'fulfillment_lines' then 'ha registrato %s consegne'
  when w.table_name = 'production_receipts' then 'ha completato %s produzioni'
  when w.payment_action is not null then case w.payment_action when 'delete' then 'ha eliminato %s incassi' when 'update' then 'ha modificato %s incassi' else 'ha registrato %s incassi' end
  when w.table_name = 'shopify_refund_observations' then 'ha registrato %s rimborsi'
  when w.table_name in ('shopify_order_financials', 'shopify_transaction_observations') then 'ha aggiornato i dati di pagamento di %s ordini'
  when w.table_name = 'finance_movement_revisions' then case w.s ->> 'action' when 'delete' then 'ha eliminato %s movimenti Finance' when 'restore' then 'ha ripristinato %s movimenti Finance' else 'ha corretto %s movimenti Finance' end
  when w.table_name = 'finance_import_batches' then 'ha importato %s lotti da BudgetFlow'
  when w.table_name = 'finance_entry_voids' then 'ha annullato %s movimenti Finance'
  when w.table_name = 'finance_documents' then 'ha archiviato %s documenti Finance'
  when w.area = 'finance' then case w.operation when 'INSERT' then 'ha registrato %s movimenti Finance' when 'DELETE' then 'ha eliminato %s movimenti Finance' else 'ha corretto %s movimenti Finance' end
  when w.table_name = 'partner_activities' then case w.s ->> 'kind' when 'inviato' then 'ha registrato %s invii Partner' when 'risposta' then 'ha registrato %s risposte Partner'
   when 'nuovo' then 'ha aggiunto %s contatti in Partner' when 'stato' then 'ha aggiornato lo stato di %s contatti Partner' else 'ha aggiornato %s contatti in Partner' end
  when w.table_name = 'partner_event_sales' then case when w.operation = 'DELETE' then 'ha rimosso %s collegamenti di vendite a eventi Partner' else 'ha collegato %s vendite a eventi Partner' end
  when w.area = 'partner' then 'ha aggiornato %s contatti in Partner'
  when w.area = 'consignment' then 'ha aggiornato il conto vendita (%s operazioni)'
  when w.area = 'packaging' then 'ha aggiornato %s materiali di packaging'
  when w.area = 'settings' then 'ha aggiornato le impostazioni del team'
  when w.table_name = 'discount_rules' then 'ha aggiornato %s sconti'
  when w.table_name = 'stock_movements' and w.s ->> 'kind' = 'adjustment' then 'ha rettificato %s articoli'
  else 'ha aggiornato %s articoli in magazzino' end plural,
 case
  when w.area = 'team' then '/team' || case when w.operation = 'DELETE' or private.activity_feed_uuid(w.entity_id) is null then ''
   when w.table_name = 'calendar_events' then '#evento-' || w.entity_id when w.table_name = 'tasks' then '#attivita-' || w.entity_id else '#nota-' || w.entity_id end
  when w.table_name in ('order_payments', 'shopify_refund_observations', 'shopify_order_financials', 'shopify_transaction_observations')
   then case when private.activity_feed_uuid(w.s ->> 'order_id') is not null then '/sales#order-' || (w.s ->> 'order_id') else '/sales' end
  when w.table_name in ('consignment_report_payments', 'consignment_payment_revisions') then case
   when w.payment_action <> 'delete' and private.activity_feed_uuid(case when w.table_name = 'consignment_report_payments' then w.entity_id else w.s ->> 'payment_id' end) is not null
   then '/finance#movimento-shop_payment-' || case when w.table_name = 'consignment_report_payments' then w.entity_id else w.s ->> 'payment_id' end else '/finance' end
  when w.table_name = 'finance_movement_revisions' then case
   when w.s ->> 'source_kind' in ('manual', 'budgetflow', 'payment', 'refund', 'consignment_settlement') and private.activity_feed_uuid(w.s ->> 'source_id') is not null
   then '/finance#movimento-' || case w.s ->> 'source_kind' when 'consignment_settlement' then 'consignment' else w.s ->> 'source_kind' end || '-' || (w.s ->> 'source_id') else '/finance' end
  when w.table_name = 'finance_entries' and w.operation <> 'DELETE' and private.activity_feed_uuid(w.entity_id) is not null then '/finance#movimento-manual-' || w.entity_id
  when w.table_name = 'finance_entry_voids' and private.activity_feed_uuid(w.s ->> 'entry_id') is not null then '/finance#movimento-manual-' || (w.s ->> 'entry_id')
  when w.area = 'finance' then '/finance'
  when w.area = 'sales' then case when w.root_key like 'sales_orders:%' and private.activity_feed_uuid(split_part(w.root_key, ':', 2)) is not null
   then '/sales#order-' || split_part(w.root_key, ':', 2) else '/sales' end
  when w.area = 'partner' then case when w.partner_co ~ '^[1-9][0-9]{0,4}$' then '/partner?co=' || w.partner_co || '#lead-' || w.partner_co else '/partner' end
  when w.area = 'consignment' then case when w.shop_code ~ '^[A-Z0-9]{2,12}$' then '/consignment/' || w.shop_code
   || case when w.table_name in ('consignment_report_revisions', 'consignment_reports') and w.s ->> 'period' is not null then '/resoconto/' || (w.s ->> 'period') else '' end
   else '/consignment' end
  when w.area = 'assets' then '/assets' || case when w.operation <> 'DELETE' and private.activity_feed_uuid(w.entity_id) is not null then '#contenuto-' || w.entity_id else '' end
  when w.area = 'development' then '/development' || case when w.operation <> 'DELETE' and private.activity_feed_uuid(w.entity_id) is not null then '#progetto-' || w.entity_id else '' end
  when w.area = 'packaging' then '/packaging'
  when w.area = 'settings' then '/auth/account'
  when w.table_name = 'stock_movements' and w.s ->> 'kind' = 'adjustment' then '/stock/rettifiche'
  else '/stock' end href
 from worded w
), sentenced as (
 select p.*,
  case when p.actor_id is null then 'Il sistema' else p.actor_name end actor_label,
  case when p.area in ('team', 'assets', 'development') and p.s ->> 'title' is not null then ': ' || (p.s ->> 'title')
   when p.area = 'partner' and p.partner_name is not null then ': ' || p.partner_name || case when p.partner_co ~ '^[1-9][0-9]{0,4}$' then ' (CO ' || p.partner_co || ')' else '' end
   when p.area = 'sales' and (p.table_name = 'sales_orders' or p.delivered_quantity is not null)
    and (coalesce(p.delivered_quantity, p.order_quantity) is not null or p.channel in ('shopify_web', 'shopify_pos', 'direct', 'etsy'))
    then ' (' || concat_ws(' · ', coalesce(p.delivered_quantity, p.order_quantity)::text || ' unità', case coalesce(p.channel, p.s ->> 'channel')
     when 'shopify_web' then 'Shopify online' when 'shopify_pos' then 'Shopify POS' when 'direct' then 'diretta' when 'etsy' then 'Etsy' end) || ')'
   else '' end suffix,
  to_char(p.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || coalesce(p.actor_id::text, 'system') tx_key,
  p.table_name in ('sales_registration_cancellations', 'manual_sale_returns', 'partner_research_imports', 'partner_device_imports') is_header,
  p.table_name in ('partner_work_links', 'stock_balances', 'commercial_facts', 'production_requirements', 'stock_reservations', 'packaging_consumption_entries',
   'consignment_report_lines', 'consignment_report_movements', 'consignment_count_lines', 'consignment_order_lines', 'consignment_shipment_lines',
   'finance_import_transactions', 'manual_sale_return_lines', 'manual_sale_return_fulfillments', 'manual_sale_return_packaging',
   'shopify_order_financials', 'shopify_transaction_observations', 'partner_import_differences')
   or (p.table_name = 'sales_order_lines' and p.operation = 'INSERT') is_technical,
  case p.area when 'team' then '/team' when 'sales' then '/sales' when 'consignment' then '/consignment' when 'finance' then '/finance'
   when 'partner' then '/partner' when 'assets' then '/assets' when 'development' then '/development' when 'packaging' then '/packaging'
   when 'settings' then '/auth/account' else '/stock' end section_href
 from phrases p
), tx as (
 select s.tx_key, bool_or(s.is_header) has_header, bool_or(not s.is_technical) has_main from sentenced s group by s.tx_key
), stats as (
 select to_char(n.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || coalesce(n.actor_id::text, 'system') tx_key,
  count(distinct n.entity_id) filter (where n.table_name = 'partners') partners,
  count(*) filter (where n.table_name = 'stock_items' and n.operation = 'INSERT') new_items
 from nodes n group by 1
), kept as (
 -- A command header (annullamento, reso, import Partner) is the whole transaction. Technical rows
 -- never make their own sentence next to a real action. Two or more new articles: an import.
 select s.*, st.partners, st.new_items,
  case when s.is_header then 'header:' || s.table_name when st.new_items >= 2 and s.area = 'stock' then 'stock_import'
   else 'kind:' || s.area || ':' || s.plural end merge_kind
 from sentenced s join tx t using (tx_key) join stats st using (tx_key)
 where case when t.has_header then s.is_header else not s.is_technical or not t.has_main end
), merged as (
 select k.tx_key, k.merge_kind, min(k.occurred_at) occurred_at, min(k.actor_id::text)::uuid actor_id, min(k.actor_name) actor_name,
  min(k.actor_label) actor_label, min(k.area) area, count(*) n, min(k.group_key) group_key, min(k.table_name) table_name,
  min(k.plural) plural, min(k.partners) partners, min(k.new_items) new_items, min(k.verb) verb,
  (array_agg(k.actor_label || ' ' || k.verb || k.suffix || '.' order by k.group_key))[1] single_message,
  case when count(distinct k.href) = 1 then min(k.href) end common_href, min(k.section_href) section_href
 from kept k group by k.tx_key, k.merge_kind
)
select
 case when m.n = 1 and m.merge_kind <> 'stock_import' and m.table_name not in ('partner_research_imports', 'partner_device_imports')
  then md5(m.group_key)::uuid else md5('tx|' || m.tx_key || '|' || m.merge_kind)::uuid end,
 m.occurred_at, m.actor_id, m.actor_name, m.area,
 case
  when m.merge_kind = 'stock_import' then m.actor_label || ' ha importato ' || private.activity_feed_count(m.new_items, 'articolo', 'articoli') || ' in magazzino.'
  when m.table_name = 'partner_research_imports' and m.partners > 0 then m.actor_label || ' ha importato ' || private.activity_feed_count(m.partners, 'contatto', 'contatti') || ' in Partner.'
  when m.table_name = 'partner_device_imports' and m.partners > 0 then m.actor_label || ' ' || m.verb || ': ' || private.activity_feed_count(m.partners, 'contatto', 'contatti') || '.'
  when m.n = 1 then m.single_message
  else m.actor_label || ' ' || replace(m.plural, '%s', m.n::text) || '.' end,
 case when m.n = 1 and m.merge_kind <> 'stock_import' then m.common_href else coalesce(m.common_href, m.section_href) end
from merged m
$$;

-- Same columns as before; like the feed, only the last 24 hours.
create or replace function private.activity_feed_actions() returns table(id uuid, occurred_at timestamptz, actor_id uuid, actor_name text, area text, message text, href text)
language sql stable security invoker set search_path = '' set timezone = 'UTC' as $$
 select * from private.activity_feed_window(now() - interval '24 hours', 'infinity'::timestamptz, null)
$$;

-- Only the last 24 hours (decided by Tommi on 23 October 2026): older audit rows stay in the
-- database and are never read by the feed. Paged reading inside those 24 hours: blocks of audit
-- rows before the cursor, newest first, each block extended to the whole transaction of its oldest
-- row. Stops at limit + 1 actions or after about 4.000 rows read; then the cursor is the block
-- boundary (id 00000000-…), so the next page resumes below it.
create or replace function private.ceo_activity_feed(p_actor text, p_area text, p_before_at timestamptz, p_before_id uuid, p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = '' set timezone = 'UTC' as $$
declare
 result jsonb;
 v_items jsonb := '[]'::jsonb;
 v_found jsonb;
 v_upper timestamptz := p_before_at;
 v_inclusive boolean := true;
 v_lower timestamptz;
 v_rows integer;
 v_chunk integer := 400;
 v_scanned integer := 0;
 v_boundary timestamptz;
 v_actor uuid := private.activity_feed_uuid(p_actor);
 v_count integer;
 v_since timestamptz := now() - interval '24 hours';
begin
 if auth.uid() is null or not private.can_audit() then raise exception 'ceo_access_required' using errcode = '42501'; end if;
 if p_limit is null or p_limit not between 1 and 50 or (p_actor is not null and p_actor <> 'system' and v_actor is null)
  or (p_area is not null and p_area not in ('team', 'sales', 'consignment', 'stock', 'packaging', 'finance', 'partner', 'development', 'assets', 'settings'))
  or (p_before_at is null) <> (p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at)) then
  raise exception 'invalid_activity_query' using errcode = '22023';
 end if;
 loop
  -- One block: the v_chunk newest rows before the upper bound (audit_logs_time, or
  -- audit_logs_actor_time for one person or the automations).
  if p_actor is null then
   select min(x.occurred_at), count(*) into v_lower, v_rows from (
    select a.occurred_at from public.audit_logs a
    where a.occurred_at >= v_since and (v_upper is null or a.occurred_at < v_upper or (v_inclusive and a.occurred_at = v_upper))
    order by a.occurred_at desc limit v_chunk) x;
  else
   select min(x.occurred_at), count(*) into v_lower, v_rows from (
    select a.occurred_at from public.audit_logs a
    where a.occurred_at >= v_since and (v_upper is null or a.occurred_at < v_upper or (v_inclusive and a.occurred_at = v_upper))
     and ((p_actor = 'system' and a.actor_id is null) or a.actor_id = v_actor)
    order by a.actor_id, a.occurred_at desc limit v_chunk) x;
  end if;
  exit when v_rows = 0;
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'occurred_at', to_char(w.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'actor_id', w.actor_id,
    'actor_name', w.actor_name, 'area', w.area, 'message', w.message, 'href', w.href)), '[]'::jsonb)
  into v_found
  from private.activity_feed_window(v_lower, case when v_upper is null then 'infinity'::timestamptz when v_inclusive then v_upper
    else v_upper - interval '1 microsecond' end, p_actor) w
  where (p_area is null or w.area = p_area) and (p_before_at is null or (w.occurred_at, w.id) < (p_before_at, p_before_id));
  v_items := v_items || v_found;
  v_scanned := v_scanned + v_rows;
  exit when jsonb_array_length(v_items) > p_limit or v_rows < v_chunk;
  if v_scanned >= 4000 then
   v_boundary := v_lower;
   exit;
  end if;
  v_upper := v_lower;
  v_inclusive := false;
  v_chunk := least(v_chunk * 2, 1600);
 end loop;
 v_count := jsonb_array_length(v_items);
 with ordered as (
  select e from jsonb_array_elements(v_items) e order by e ->> 'occurred_at' desc, (e ->> 'id')::uuid desc limit p_limit
 ), last_row as (
  select e from ordered order by e ->> 'occurred_at', (e ->> 'id')::uuid limit 1
 )
 select jsonb_build_object(
  'items', coalesce((select jsonb_agg(e order by e ->> 'occurred_at' desc, (e ->> 'id')::uuid desc) from ordered), '[]'::jsonb),
  'actors', coalesce((
   -- The team (active members), whoever acted in the last 24 hours, and the automations.
   with ids as (
    select m.user_id actor_id from public.memberships m where m.active
    union
    select a.actor_id from public.audit_logs a where a.occurred_at >= v_since and a.actor_id is not null
   ), names as (
    select i.actor_id::text actor, coalesce(private.activity_feed_text(p.display_name, 120), 'Membro non disponibile') name
    from ids i left join public.profiles p on p.user_id = i.actor_id
    union all
    select 'system', 'Automazioni'
   )
   select jsonb_agg(jsonb_build_object('id', n.actor, 'name', n.name) order by n.name, n.actor) from names n), '[]'::jsonb),
  'next_cursor', case
   when v_count > p_limit then (select jsonb_build_object('occurred_at', l.e ->> 'occurred_at', 'id', l.e ->> 'id') from last_row l)
   when v_boundary is not null and (select a.occurred_at from public.audit_logs a where a.occurred_at < v_boundary and a.occurred_at >= v_since
     and (p_actor is null or (p_actor = 'system' and a.actor_id is null) or a.actor_id = v_actor) order by a.actor_id, a.occurred_at desc limit 1) is not null
    then jsonb_build_object('occurred_at', to_char(v_boundary, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'id', '00000000-0000-0000-0000-000000000000')
   else null end)
 into result;
 return result;
end
$$;

-- Permessi come oggi: nessun EXECUTE sulle funzioni interne; il feed solo ad authenticated.
revoke all on function private.activity_feed_text(text, integer), private.activity_feed_uuid(text), private.activity_feed_cents(jsonb),
 private.activity_feed_money(bigint), private.activity_partner_operation(text, text), private.activity_feed_actions(),
 private.ceo_activity_feed(text, text, timestamptz, uuid, integer), public.ceo_activity_feed(text, text, timestamptz, uuid, integer),
 private.activity_feed_keys(text, jsonb, jsonb, jsonb), private.activity_feed_link_keys(text, jsonb, jsonb, jsonb), private.activity_feed_entity(text, jsonb, uuid), private.activity_feed_parent(text, jsonb),
 private.activity_feed_count(bigint, text, text),
 private.activity_feed_month(text), private.activity_feed_window(timestamptz, timestamptz, text)
 from public, anon, authenticated, service_role;
grant execute on function private.ceo_activity_feed(text, text, timestamptz, uuid, integer), public.ceo_activity_feed(text, text, timestamptz, uuid, integer) to authenticated;
commit;
