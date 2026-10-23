-- Riassortimento (Magazzino › Riassortimento): i riordini di magliette.
--
-- Un riordine ha righe per modello, colore e taglia con una destinazione: «per noi» (il
-- Magadzino, MAG01), «per il negozio» (un negozio del conto vendita, oggi la libreria di Milano)
-- e «per il cliente» (un ordine speciale, anche in una taglia che non è a catalogo: non entra mai
-- in magazzino). Cinque stati, liberi avanti e indietro fino all'arrivo, con lo storico. All'arrivo
-- («In mano nostra») una conferma carica nel magazzino i pezzi per noi e per il negozio, una volta
-- sola, con movimenti restock_receipt; i pezzi per il negozio escono poi con la consegna del Conto
-- vendita, come oggi. «Annulla arrivo» toglie quei pezzi solo se sono ancora liberi.
--
-- Cosa cambia oltre alle tabelle e alle funzioni nuove:
-- 1. consignment_shops.sizes: nuova colonna, NULL = tutte le taglie. Una sola riga aggiornata: il
--    negozio NEG01 di Milano tiene solo S, M, L, XL (con il trigger di audit, quindi si vede nel
--    registro). Conta, resoconto, ordini e consegne al negozio accettano solo le sue taglie.
-- 2. consignment_orders.restock_order_id: nuova colonna, NULL per tutti gli ordini esistenti. Lega
--    l'ordine del negozio al riordine da cui nasce, così la consegna chiude la parte del negozio.
-- 3. Funzioni sostituite con create or replace, stesso corpo più il minimo necessario:
--    private.count_consignment_stock (la prima conta comprende solo le taglie del negozio),
--    private.save_consignment_order (chiave facoltativa restock_order_id) e le quattro funzioni del
--    feed di Controllo CEO (frasi dei riordini e delle taglie del negozio, stesse 24 ore e regole).
-- I tipi di movimento nuovi si usano solo dentro i corpi plpgsql, mai in questa transazione.
begin;
alter type public.stock_movement_kind add value if not exists 'restock_receipt';
alter type public.stock_movement_kind add value if not exists 'restock_receipt_reversal';

-- ---------------------------------------------------------------------------------------------
-- 1. Taglie del negozio.
alter table public.consignment_shops add column sizes text[]
  check (sizes is null or (cardinality(sizes) between 1 and 20 and array_position(sizes, null) is null
    and array_to_string(sizes, ',') ~ '^[A-Z0-9]{1,10}(,[A-Z0-9]{1,10}){0,19}$'));
comment on column public.consignment_shops.sizes is
  'Taglie che il negozio tiene: conta, resoconto, ordini e consegne al negozio accettano solo queste. NULL = tutte le taglie.';
-- La libreria di Milano (NEG01) tiene solo S, M, L, XL. Una riga, solo se è ancora «tutte le taglie».
update public.consignment_shops s set sizes = array['S', 'M', 'L', 'XL']
from public.stock_locations l
where l.id = s.location_id and l.code = 'NEG01' and l.location_type = 'Negozio Conto Vendita'
  and l.name ilike '%milano%' and s.sizes is null;

-- Una riga di conta, resoconto, ordine o consegna al negozio vale solo per le taglie del negozio.
-- Le magliette riportate in magazzino (to_warehouse) restano possibili in ogni taglia.
create function private.consignment_size_allowed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_sizes text[]; v_size text; v_sku text;
begin
  if tg_table_name = 'consignment_shipment_lines' then
    if not exists (select 1 from public.consignment_shipments where id = (to_jsonb(new) ->> 'shipment_id')::uuid and direction = 'to_shop') then
      return new;
    end if;
  end if;
  select sizes into v_sizes from public.consignment_shops where location_id = new.location_id;
  if v_sizes is null then return new; end if;
  select v.size, s.sku into v_size, v_sku from public.stock_items s
    left join public.product_variants v on v.stock_item_id = s.id where s.id = new.stock_item_id;
  if v_size is null or not (v_size = any(v_sizes)) then
    raise exception 'size_not_in_shop' using errcode = '22023', detail = coalesce(v_sku, '');
  end if;
  return new;
end
$$;
revoke all on function private.consignment_size_allowed() from public, anon, authenticated, service_role;
create trigger consignment_size_allowed before insert on public.consignment_count_lines
  for each row execute function private.consignment_size_allowed();
create trigger consignment_size_allowed before insert on public.consignment_report_lines
  for each row execute function private.consignment_size_allowed();
create trigger consignment_size_allowed before insert on public.consignment_order_lines
  for each row execute function private.consignment_size_allowed();
create trigger consignment_size_allowed before insert on public.consignment_shipment_lines
  for each row execute function private.consignment_size_allowed();

-- ---------------------------------------------------------------------------------------------
-- 2. Riordini. I membri leggono; nessuna scrittura dai client: solo i comandi qui sotto.
create table public.restock_orders (
  id uuid primary key,
  title text not null check (char_length(title) between 3 and 120 and title = btrim(title) and title !~ '[[:cntrl:]]'),
  notes text not null default '' check (char_length(notes) <= 2000),
  state text not null default 'discussion' check (state in ('discussion', 'supplier', 'embroiderer', 'quality', 'in_hand')),
  state_changed_at timestamptz not null default now(),
  state_changed_by uuid not null references public.profiles(user_id),
  -- «Per noi»: il magazzino centrale (MAG01), scelto alla creazione.
  warehouse_location_id uuid not null references public.stock_locations(id),
  -- «Per il negozio»: un negozio del conto vendita, facoltativo.
  shop_location_id uuid references public.consignment_shops(location_id),
  -- Segno a mano «consegnate al negozio» (se la consegna non è legata al riordine).
  shop_done_at timestamptz,
  shop_done_by uuid references public.profiles(user_id),
  version bigint not null default 1 check (version >= 1),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(user_id),
  updated_at timestamptz not null default now(),
  check (shop_location_id is distinct from warehouse_location_id),
  check ((shop_done_at is null) = (shop_done_by is null)),
  check (shop_done_at is null or state = 'in_hand')
);
create unique index restock_orders_title_key on public.restock_orders (lower(title));
create index restock_orders_state on public.restock_orders (state, state_changed_at desc);
create index restock_orders_warehouse on public.restock_orders (warehouse_location_id);
create index restock_orders_shop on public.restock_orders (shop_location_id);
create index restock_orders_state_changer on public.restock_orders (state_changed_by);
create index restock_orders_shop_done_by on public.restock_orders (shop_done_by);
create index restock_orders_creator on public.restock_orders (created_by);
create index restock_orders_updater on public.restock_orders (updated_by);

-- Una riga per destinazione, modello, colore e taglia. La variante del catalogo c'è sempre per
-- noi e per il negozio; per il cliente può mancare (per esempio XXXL), con modello, colore e taglia.
create table public.restock_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.restock_orders(id),
  destination text not null check (destination in ('warehouse', 'shop', 'customer')),
  product_id uuid not null references public.products(id),
  color text not null check (char_length(color) between 1 and 120),
  size text not null check (size ~ '^[A-Z0-9]{1,10}$'),
  stock_item_id uuid references public.stock_items(id),
  quantity integer not null check (quantity between 1 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, destination, product_id, color, size),
  check (destination = 'customer' or stock_item_id is not null)
);
create index restock_lines_product on public.restock_lines (product_id);
create index restock_lines_item on public.restock_lines (stock_item_id);

-- Storico degli stati: chi, quando, da dove a dove, con una nota facoltativa. Solo aggiunte.
create table public.restock_state_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.restock_orders(id),
  from_state text check (from_state in ('discussion', 'supplier', 'embroiderer', 'quality', 'in_hand')),
  to_state text not null check (to_state in ('discussion', 'supplier', 'embroiderer', 'quality', 'in_hand')),
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  check (from_state is distinct from to_state)
);
create index restock_state_events_order on public.restock_state_events (order_id, created_at);
create index restock_state_events_creator on public.restock_state_events (created_by);

-- Arrivo in magazzino: uno solo aperto per riordine. «Annulla arrivo» lo chiude con chi e quando.
create table public.restock_arrivals (
  id uuid primary key,
  order_id uuid not null references public.restock_orders(id),
  location_id uuid not null references public.stock_locations(id),
  previous_state text not null check (previous_state in ('discussion', 'supplier', 'embroiderer', 'quality')),
  pieces integer not null check (pieces >= 0),
  warehouse_pieces integer not null check (warehouse_pieces >= 0),
  shop_pieces integer not null check (shop_pieces >= 0),
  customer_pieces integer not null check (customer_pieces >= 0),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references public.profiles(user_id),
  undo_operation_id uuid unique,
  check (pieces = warehouse_pieces + shop_pieces),
  check (num_nonnulls(undone_at, undone_by, undo_operation_id) in (0, 3))
);
create unique index restock_arrivals_one_open on public.restock_arrivals (order_id) where undone_at is null;
create index restock_arrivals_order on public.restock_arrivals (order_id, created_at);
create index restock_arrivals_location on public.restock_arrivals (location_id);
create index restock_arrivals_creator on public.restock_arrivals (created_by);
create index restock_arrivals_undoer on public.restock_arrivals (undone_by);
-- I movimenti di un arrivo, letti per annullarlo.
create index stock_movements_restock_arrival on public.stock_movements ((source ->> 'restock_arrival_id'))
  where source ? 'restock_arrival_id';

-- L'ordine del negozio nato da un riordine: la sua consegna chiude la parte del negozio.
alter table public.consignment_orders add column restock_order_id uuid references public.restock_orders(id);
create index consignment_orders_restock on public.consignment_orders (restock_order_id);

do $$
declare t text;
begin
  foreach t in array array['restock_orders', 'restock_lines', 'restock_state_events', 'restock_arrivals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy restock_read on public.%I for select to authenticated using ((select private.is_member()))', t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()', t);
  end loop;
end
$$;
create trigger restock_state_events_append_only before update or delete on public.restock_state_events
  for each row execute function private.reject_ledger_mutation();
comment on table public.restock_orders is 'Riordini di magliette (Magazzino › Riassortimento). Si scrivono solo con i comandi *_restock_*.';
comment on table public.restock_arrivals is 'Arrivo di un riordine in magazzino: movimenti restock_receipt, una volta sola; annullo con restock_receipt_reversal.';

-- Ricevute dei comandi: un replay identico restituisce il risultato originale.
create table private.restock_receipts (
  operation_id uuid primary key,
  command_kind text not null,
  actor_id uuid not null references public.profiles(user_id),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index restock_receipts_actor on private.restock_receipts (actor_id);
alter table private.restock_receipts enable row level security;
revoke all on private.restock_receipts from public, anon, authenticated, service_role;
create trigger restock_receipts_append_only before update or delete on private.restock_receipts
  for each row execute function private.reject_ledger_mutation();

-- ---------------------------------------------------------------------------------------------
-- 3. Funzioni di supporto. Nessun EXECUTE ai client.
create function private.start_restock(p_operation_id uuid, p_kind text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_old private.restock_receipts%rowtype; v_digest text;
begin
  if auth.uid() is null or not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  if p_operation_id is null then raise exception 'invalid_payload' using errcode = '22023'; end if;
  v_digest := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.restock.' || p_operation_id::text, 0));
  select * into v_old from private.restock_receipts where operation_id = p_operation_id;
  if found then
    if v_old.actor_id <> auth.uid() or v_old.command_kind <> p_kind or v_old.payload_sha256 <> v_digest then
      raise exception 'idempotency_conflict' using errcode = '22023';
    end if;
    return v_old.result || '{"replayed": true}'::jsonb;
  end if;
  return null;
end
$$;
create function private.finish_restock(p_operation_id uuid, p_kind text, p_payload jsonb, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.restock_receipts(operation_id, command_kind, actor_id, payload_sha256, result)
    values (p_operation_id, p_kind, auth.uid(), encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex'), p_result);
  return p_result;
end
$$;
create function private.restock_state(p_value jsonb, p_allow_in_hand boolean) returns text
language plpgsql immutable security invoker set search_path = '' as $$
declare v_state text;
begin
  if jsonb_typeof(p_value) is distinct from 'string' then raise exception 'invalid_payload' using errcode = '22023'; end if;
  v_state := p_value #>> '{}';
  if v_state not in ('discussion', 'supplier', 'embroiderer', 'quality') and not (p_allow_in_hand and v_state = 'in_hand') then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  return v_state;
end
$$;
-- Riga del riordine bloccata, con la versione attesa (CAS). Ogni comando dello stesso riordine
-- passa di qui per primo.
create function private.restock_order_for_update(p_order uuid, p_expected bigint) returns public.restock_orders
language plpgsql security definer set search_path = '' as $$
declare v_order public.restock_orders%rowtype;
begin
  select * into v_order from public.restock_orders where id = p_order for update;
  if not found then raise exception 'restock_not_found' using errcode = '22023'; end if;
  if v_order.version <> p_expected then raise exception 'stale_version' using errcode = '22023'; end if;
  return v_order;
end
$$;
-- Un negozio attivo del conto vendita. Senza lock: la chiave esterna basta, e un lock qui contro
-- quello del negozio preso da save_consignment_order potrebbe incrociarsi.
create function private.restock_shop(p_location uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.consignment_shops s join public.stock_locations l on l.id = s.location_id
    where s.location_id = p_location and l.active and l.location_type = 'Negozio Conto Vendita';
  if not found then raise exception 'invalid_location' using errcode = '22023'; end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Comandi. Ognuno, nell'ordine: identità; validazione (chiavi esatte); ricevuta (un replay
-- identico restituisce il risultato originale prima di ogni altro controllo); flag; riga del
-- riordine bloccata con la versione attesa; effetti; ricevuta.

-- Crea un riordine (stato «Discussione») o ne cambia titolo, note e negozio.
create function private.save_restock_order(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_order_id uuid; v_expected bigint; v_title text; v_notes text; v_shop uuid; v_canonical jsonb; v_replay jsonb;
  v_order public.restock_orders%rowtype; v_warehouse uuid; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'order_id', 'expected_version', 'title', 'notes', 'shop_location_id'],
    array['schema_version', 'order_id', 'expected_version', 'title', 'notes', 'shop_location_id']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_order_id := private.consignment_uuid(p_payload -> 'order_id', true);
  v_expected := private.consignment_optional_integer(p_payload -> 'expected_version', 1, 9000000000000000);
  if (v_order_id is null) <> (v_expected is null) then raise exception 'invalid_payload' using errcode = '22023'; end if;
  v_title := private.consignment_text(p_payload -> 'title', 3, 120);
  v_notes := private.consignment_note(p_payload -> 'notes', 2000);
  v_shop := private.consignment_uuid(p_payload -> 'shop_location_id', true);
  v_canonical := jsonb_build_object('schema_version', 1, 'order_id', v_order_id, 'expected_version', v_expected, 'title', v_title,
    'notes', v_notes, 'shop_location_id', v_shop);
  v_replay := private.start_restock(p_operation_id, 'save_restock_order', v_canonical);
  if v_replay is not null then return v_replay; end if;
  -- Titoli unici (maiuscole a parte): un solo controllo alla volta.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.restock.title', 0));
  if v_order_id is null then
    if exists (select 1 from public.restock_orders where lower(title) = lower(v_title)) then
      raise exception 'title_taken' using errcode = '23505';
    end if;
    select id into v_warehouse from public.stock_locations where code = 'MAG01' and location_type = 'Magazzino' and active;
    if v_warehouse is null then raise exception 'invalid_location' using errcode = '22023'; end if;
    if v_shop is not null then perform private.restock_shop(v_shop); end if;
    v_order_id := p_operation_id;
    insert into public.restock_orders(id, title, notes, state, state_changed_by, warehouse_location_id, shop_location_id, created_by, updated_by)
      values (v_order_id, v_title, v_notes, 'discussion', auth.uid(), v_warehouse, v_shop, auth.uid(), auth.uid()) returning * into v_order;
    insert into public.restock_state_events(order_id, from_state, to_state, note, created_by)
      values (v_order_id, null, 'discussion', '', auth.uid());
  else
    v_order := private.restock_order_for_update(v_order_id, v_expected);
    if lower(v_title) <> lower(v_order.title)
      and exists (select 1 from public.restock_orders where lower(title) = lower(v_title) and id <> v_order_id) then
      raise exception 'title_taken' using errcode = '23505';
    end if;
    if v_shop is distinct from v_order.shop_location_id then
      if v_order.state = 'in_hand' then raise exception 'restock_received' using errcode = '22023'; end if;
      if exists (select 1 from public.restock_lines where order_id = v_order_id and destination = 'shop') then
        raise exception 'shop_has_lines' using errcode = '22023';
      end if;
      if v_shop is not null then perform private.restock_shop(v_shop); end if;
    end if;
    update public.restock_orders set title = v_title, notes = v_notes, shop_location_id = v_shop, version = version + 1,
      updated_by = auth.uid(), updated_at = now()
      where id = v_order_id returning * into v_order;
  end if;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'order_id', v_order_id, 'state', v_order.state,
    'version', v_order.version, 'replayed', false);
  return private.finish_restock(p_operation_id, 'save_restock_order', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

-- Sostituisce tutte le righe del riordine (solo prima dell'arrivo). Per noi e per il negozio serve
-- la variante attiva del catalogo; per il negozio anche una T-shirt in una taglia del negozio.
create function private.set_restock_lines(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_order_id uuid; v_expected bigint; v_raw jsonb; v_lines jsonb := '[]'::jsonb; v_resolved jsonb := '[]'::jsonb;
  v_canonical jsonb; v_replay jsonb; v_order public.restock_orders%rowtype; v_destination text; v_product uuid; v_color text;
  v_size text; v_quantity bigint; v_item uuid; v_items integer; v_active boolean; v_category text; v_sku text; v_sizes text[];
  v_pieces bigint := 0; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'order_id', 'expected_version', 'lines'],
    array['schema_version', 'order_id', 'expected_version', 'lines']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_order_id := private.consignment_uuid(p_payload -> 'order_id', false);
  v_expected := private.sale_integer(p_payload -> 'expected_version', 1, 9000000000000000);
  if jsonb_typeof(p_payload -> 'lines') is distinct from 'array' or jsonb_array_length(p_payload -> 'lines') > 600 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  for v_raw in select value from jsonb_array_elements(p_payload -> 'lines') loop
    perform private.sale_object(v_raw, array['destination', 'product_id', 'color', 'size', 'quantity'],
      array['destination', 'product_id', 'color', 'size', 'quantity']);
    v_destination := private.consignment_text(v_raw -> 'destination', 4, 9);
    if v_destination not in ('warehouse', 'shop', 'customer') then raise exception 'invalid_payload' using errcode = '22023'; end if;
    v_size := private.consignment_text(v_raw -> 'size', 1, 10);
    if v_size !~ '^[A-Z0-9]{1,10}$' then raise exception 'invalid_payload' using errcode = '22023'; end if;
    v_quantity := private.sale_integer(v_raw -> 'quantity', 1, 100000);
    v_pieces := v_pieces + v_quantity;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('destination', v_destination,
      'product_id', private.consignment_uuid(v_raw -> 'product_id', false), 'color', private.consignment_text(v_raw -> 'color', 1, 120),
      'size', v_size, 'quantity', v_quantity));
  end loop;
  if (select count(distinct (value ->> 'destination', value ->> 'product_id', value ->> 'color', value ->> 'size'))
      from jsonb_array_elements(v_lines)) <> jsonb_array_length(v_lines) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(value order by value ->> 'destination', value ->> 'product_id', value ->> 'color', value ->> 'size'), '[]'::jsonb)
    into v_lines from jsonb_array_elements(v_lines);
  v_canonical := jsonb_build_object('schema_version', 1, 'order_id', v_order_id, 'expected_version', v_expected, 'lines', v_lines);
  v_replay := private.start_restock(p_operation_id, 'set_restock_lines', v_canonical);
  if v_replay is not null then return v_replay; end if;
  v_order := private.restock_order_for_update(v_order_id, v_expected);
  if v_order.state = 'in_hand' then raise exception 'restock_received' using errcode = '22023'; end if;
  if v_order.shop_location_id is not null then
    select sizes into v_sizes from public.consignment_shops where location_id = v_order.shop_location_id;
  end if;
  for v_raw in select value from jsonb_array_elements(v_lines) loop
    v_destination := v_raw ->> 'destination'; v_product := (v_raw ->> 'product_id')::uuid; v_color := v_raw ->> 'color'; v_size := v_raw ->> 'size';
    -- Modello e colore devono essere a catalogo (in qualsiasi taglia).
    select p.category into v_category from public.products p
      where p.id = v_product and exists (select 1 from public.product_variants v where v.product_id = p.id and v.color = v_color);
    if not found then raise exception 'unknown_variant' using errcode = '22023', detail = ''; end if;
    select count(*), min(v.stock_item_id::text)::uuid, bool_and(s.active), min(s.sku) into v_items, v_item, v_active, v_sku
      from public.product_variants v join public.stock_items s on s.id = v.stock_item_id
      where v.product_id = v_product and v.color = v_color and v.size = v_size;
    if v_items > 1 then raise exception 'unknown_variant' using errcode = '22023', detail = coalesce(v_sku, ''); end if;
    if v_destination <> 'customer' and (v_items = 0 or not v_active) then
      raise exception 'unknown_variant' using errcode = '22023', detail = coalesce(v_sku, '');
    end if;
    if v_destination = 'shop' then
      if v_order.shop_location_id is null then raise exception 'no_shop' using errcode = '22023'; end if;
      if v_category <> 'T-shirt' then raise exception 'invalid_tshirt' using errcode = '22023', detail = v_sku; end if;
      if v_sizes is not null and not (v_size = any(v_sizes)) then
        raise exception 'size_not_in_shop' using errcode = '22023', detail = v_sku;
      end if;
    end if;
    v_resolved := v_resolved || jsonb_build_array(v_raw || jsonb_build_object('stock_item_id', case when v_items = 1 then v_item end));
  end loop;
  perform 1 from public.restock_lines where order_id = v_order_id order by id for update;
  delete from public.restock_lines l where l.order_id = v_order_id and not exists (
    select 1 from jsonb_array_elements(v_resolved) n where n.value ->> 'destination' = l.destination
      and (n.value ->> 'product_id')::uuid = l.product_id and n.value ->> 'color' = l.color and n.value ->> 'size' = l.size);
  update public.restock_lines l set quantity = (n.value ->> 'quantity')::integer, stock_item_id = (n.value ->> 'stock_item_id')::uuid,
      updated_at = now()
    from jsonb_array_elements(v_resolved) n
    where l.order_id = v_order_id and n.value ->> 'destination' = l.destination and (n.value ->> 'product_id')::uuid = l.product_id
      and n.value ->> 'color' = l.color and n.value ->> 'size' = l.size
      and (l.quantity <> (n.value ->> 'quantity')::integer or l.stock_item_id is distinct from (n.value ->> 'stock_item_id')::uuid);
  insert into public.restock_lines(order_id, destination, product_id, color, size, stock_item_id, quantity)
    select v_order_id, n.value ->> 'destination', (n.value ->> 'product_id')::uuid, n.value ->> 'color', n.value ->> 'size',
      (n.value ->> 'stock_item_id')::uuid, (n.value ->> 'quantity')::integer
    from jsonb_array_elements(v_resolved) n
    where not exists (select 1 from public.restock_lines l where l.order_id = v_order_id and l.destination = n.value ->> 'destination'
      and l.product_id = (n.value ->> 'product_id')::uuid and l.color = n.value ->> 'color' and l.size = n.value ->> 'size');
  update public.restock_orders set version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = v_order_id returning * into v_order;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'order_id', v_order_id, 'pieces', v_pieces,
    'version', v_order.version, 'replayed', false);
  return private.finish_restock(p_operation_id, 'set_restock_lines', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

-- Sposta il riordine fra i quattro stati prima dell'arrivo, avanti o indietro, con lo storico.
create function private.move_restock_order(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_order_id uuid; v_expected bigint; v_state text; v_note text; v_canonical jsonb; v_replay jsonb;
  v_order public.restock_orders%rowtype; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'order_id', 'expected_version', 'state', 'note'],
    array['schema_version', 'order_id', 'expected_version', 'state', 'note']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_order_id := private.consignment_uuid(p_payload -> 'order_id', false);
  v_expected := private.sale_integer(p_payload -> 'expected_version', 1, 9000000000000000);
  v_state := private.restock_state(p_payload -> 'state', false);
  v_note := private.consignment_note(p_payload -> 'note', 500);
  v_canonical := jsonb_build_object('schema_version', 1, 'order_id', v_order_id, 'expected_version', v_expected, 'state', v_state, 'note', v_note);
  v_replay := private.start_restock(p_operation_id, 'move_restock_order', v_canonical);
  if v_replay is not null then return v_replay; end if;
  v_order := private.restock_order_for_update(v_order_id, v_expected);
  if v_order.state = 'in_hand' then raise exception 'restock_received' using errcode = '22023'; end if;
  if v_order.state = v_state then raise exception 'invalid_payload' using errcode = '22023'; end if;
  insert into public.restock_state_events(order_id, from_state, to_state, note, created_by)
    values (v_order_id, v_order.state, v_state, v_note, auth.uid());
  update public.restock_orders set state = v_state, state_changed_at = now(), state_changed_by = auth.uid(), version = version + 1,
    updated_by = auth.uid(), updated_at = now()
    where id = v_order_id returning * into v_order;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'order_id', v_order_id, 'state', v_order.state,
    'version', v_order.version, 'replayed', false);
  return private.finish_restock(p_operation_id, 'move_restock_order', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

-- «In mano nostra»: carica nel magazzino del riordine i pezzi per noi e per il negozio, una volta
-- sola. I pezzi per il cliente non entrano mai. expected_pieces è il numero confermato a schermo.
create function private.receive_restock_order(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_order_id uuid; v_expected bigint; v_expected_pieces bigint; v_note text; v_canonical jsonb; v_replay jsonb;
  v_order public.restock_orders%rowtype; v_line record; v_balance bigint; v_found boolean; v_reason text;
  v_pieces bigint := 0; v_warehouse bigint := 0; v_shop bigint := 0; v_customer bigint := 0; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'order_id', 'expected_version', 'expected_pieces', 'note'],
    array['schema_version', 'order_id', 'expected_version', 'expected_pieces', 'note']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_order_id := private.consignment_uuid(p_payload -> 'order_id', false);
  v_expected := private.sale_integer(p_payload -> 'expected_version', 1, 9000000000000000);
  v_expected_pieces := private.sale_integer(p_payload -> 'expected_pieces', 0, 100000000);
  v_note := private.consignment_note(p_payload -> 'note', 500);
  v_canonical := jsonb_build_object('schema_version', 1, 'order_id', v_order_id, 'expected_version', v_expected,
    'expected_pieces', v_expected_pieces, 'note', v_note);
  v_replay := private.start_restock(p_operation_id, 'receive_restock_order', v_canonical);
  if v_replay is not null then return v_replay; end if;
  perform private.consignment_flags(false);
  v_order := private.restock_order_for_update(v_order_id, v_expected);
  if v_order.state = 'in_hand' then raise exception 'restock_received' using errcode = '22023'; end if;
  select coalesce(sum(quantity) filter (where destination = 'warehouse'), 0), coalesce(sum(quantity) filter (where destination = 'shop'), 0),
      coalesce(sum(quantity) filter (where destination = 'customer'), 0)
    into v_warehouse, v_shop, v_customer from public.restock_lines where order_id = v_order_id;
  v_pieces := v_warehouse + v_shop;
  if v_pieces <> v_expected_pieces then raise exception 'stale_version' using errcode = '22023'; end if;
  -- Saldi del magazzino nell'ordine degli articoli, come gli altri comandi.
  perform 1 from public.stock_balances where location_id = v_order.warehouse_location_id
    and stock_item_id in (select stock_item_id from public.restock_lines where order_id = v_order_id and destination <> 'customer')
    order by stock_item_id for update;
  insert into public.restock_arrivals(id, order_id, location_id, previous_state, pieces, warehouse_pieces, shop_pieces, customer_pieces, created_by)
    values (p_operation_id, v_order_id, v_order.warehouse_location_id, v_order.state, v_pieces, v_warehouse, v_shop, v_customer, auth.uid());
  v_reason := 'Riassortimento: ' || v_order.title;
  for v_line in
    select l.stock_item_id, s.sku, sum(l.quantity) quantity, coalesce(sum(l.quantity) filter (where l.destination = 'warehouse'), 0) warehouse,
        coalesce(sum(l.quantity) filter (where l.destination = 'shop'), 0) shop
      from public.restock_lines l join public.stock_items s on s.id = l.stock_item_id
      where l.order_id = v_order_id and l.destination <> 'customer'
      group by l.stock_item_id, s.sku order by l.stock_item_id
  loop
    select quantity, true into v_balance, v_found from public.stock_balances
      where stock_item_id = v_line.stock_item_id and location_id = v_order.warehouse_location_id;
    if v_found is null then
      -- Variante mai entrata in questo magazzino: parte da 0, poi arriva il riordine.
      insert into public.stock_movements(operation_id, stock_item_id, location_id, kind, quantity_delta, reason, source, actor_id)
        values (gen_random_uuid(), v_line.stock_item_id, v_order.warehouse_location_id, 'opening', 0, v_reason || ' (giacenza di partenza 0)',
          jsonb_build_object('restock_order_id', v_order_id, 'restock_arrival_id', p_operation_id), auth.uid());
    elsif v_balance is null then
      raise exception 'unknown_stock' using errcode = '22023', detail = v_line.sku;
    end if;
    insert into public.stock_movements(operation_id, stock_item_id, location_id, kind, quantity_delta, reason, source, actor_id)
      values (gen_random_uuid(), v_line.stock_item_id, v_order.warehouse_location_id, 'restock_receipt'::public.stock_movement_kind,
        v_line.quantity, v_reason,
        jsonb_build_object('restock_order_id', v_order_id, 'restock_arrival_id', p_operation_id,
          'warehouse_quantity', v_line.warehouse, 'shop_quantity', v_line.shop), auth.uid());
    v_found := null; v_balance := null;
  end loop;
  insert into public.restock_state_events(order_id, from_state, to_state, note, created_by)
    values (v_order_id, v_order.state, 'in_hand', v_note, auth.uid());
  update public.restock_orders set state = 'in_hand', state_changed_at = now(), state_changed_by = auth.uid(), version = version + 1,
    updated_by = auth.uid(), updated_at = now()
    where id = v_order_id returning * into v_order;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'order_id', v_order_id, 'arrival_id', p_operation_id,
    'pieces', v_pieces, 'state', v_order.state, 'version', v_order.version, 'replayed', false);
  return private.finish_restock(p_operation_id, 'receive_restock_order', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

-- «Annulla arrivo»: toglie dal magazzino i pezzi caricati, solo se sono ancora tutti liberi e se
-- nessun ordine del negozio legato al riordine è aperto o consegnato. Il riordine torna allo stato
-- di prima dell'arrivo e si può modificare di nuovo.
create function private.undo_restock_arrival(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_order_id uuid; v_expected bigint; v_note text; v_canonical jsonb; v_replay jsonb; v_order public.restock_orders%rowtype;
  v_arrival public.restock_arrivals%rowtype; v_move record; v_free bigint; v_number integer; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'order_id', 'expected_version', 'note'],
    array['schema_version', 'order_id', 'expected_version', 'note']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_order_id := private.consignment_uuid(p_payload -> 'order_id', false);
  v_expected := private.sale_integer(p_payload -> 'expected_version', 1, 9000000000000000);
  v_note := private.consignment_note(p_payload -> 'note', 500);
  v_canonical := jsonb_build_object('schema_version', 1, 'order_id', v_order_id, 'expected_version', v_expected, 'note', v_note);
  v_replay := private.start_restock(p_operation_id, 'undo_restock_arrival', v_canonical);
  if v_replay is not null then return v_replay; end if;
  perform private.consignment_flags(false);
  v_order := private.restock_order_for_update(v_order_id, v_expected);
  if v_order.state <> 'in_hand' then raise exception 'restock_not_received' using errcode = '22023'; end if;
  select * into v_arrival from public.restock_arrivals where order_id = v_order_id and undone_at is null for update;
  if not found then raise exception 'restock_not_received' using errcode = '22023'; end if;
  select o.order_number into v_number from public.consignment_orders o
    where o.restock_order_id = v_order_id and (o.status <> 'closed'
      or exists (select 1 from public.consignment_order_lines l where l.order_id = o.id and l.delivered_quantity > 0))
    order by o.order_number limit 1;
  if found or v_order.shop_done_at is not null then
    raise exception 'shop_order_linked' using errcode = '22023', detail = coalesce(v_number::text, '');
  end if;
  perform 1 from public.stock_balances where location_id = v_arrival.location_id
    and stock_item_id in (select m.stock_item_id from public.stock_movements m
      where m.source ->> 'restock_arrival_id' = v_arrival.id::text and m.kind = 'restock_receipt'::public.stock_movement_kind)
    order by stock_item_id for update;
  for v_move in
    select m.id, m.stock_item_id, m.quantity_delta, s.sku from public.stock_movements m join public.stock_items s on s.id = m.stock_item_id
      where m.source ->> 'restock_arrival_id' = v_arrival.id::text and m.kind = 'restock_receipt'::public.stock_movement_kind
      order by m.stock_item_id
  loop
    select b.quantity - coalesce((select sum(r.reserved_quantity) from public.stock_reservations r
        where r.stock_item_id = b.stock_item_id and r.location_id = b.location_id), 0)
      into v_free from public.stock_balances b where b.stock_item_id = v_move.stock_item_id and b.location_id = v_arrival.location_id;
    if v_free is null or v_free < v_move.quantity_delta then
      raise exception 'restock_stock_used' using errcode = '22023', detail = v_move.sku;
    end if;
    insert into public.stock_movements(operation_id, stock_item_id, location_id, kind, quantity_delta, reason, source, actor_id)
      values (gen_random_uuid(), v_move.stock_item_id, v_arrival.location_id, 'restock_receipt_reversal'::public.stock_movement_kind,
        -v_move.quantity_delta, 'Arrivo annullato. Riassortimento: ' || v_order.title,
        jsonb_build_object('restock_order_id', v_order_id, 'restock_arrival_id', v_arrival.id, 'restock_undo_id', p_operation_id,
          'reverses_movement_id', v_move.id), auth.uid());
    v_free := null;
  end loop;
  update public.restock_arrivals set undone_at = now(), undone_by = auth.uid(), undo_operation_id = p_operation_id where id = v_arrival.id;
  insert into public.restock_state_events(order_id, from_state, to_state, note, created_by)
    values (v_order_id, 'in_hand', v_arrival.previous_state, v_note, auth.uid());
  update public.restock_orders set state = v_arrival.previous_state, state_changed_at = now(), state_changed_by = auth.uid(),
    version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = v_order_id returning * into v_order;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'order_id', v_order_id, 'arrival_id', v_arrival.id,
    'pieces', v_arrival.pieces, 'state', v_order.state, 'version', v_order.version, 'replayed', false);
  return private.finish_restock(p_operation_id, 'undo_restock_arrival', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

-- Segno a mano «consegnate al negozio» (o lo toglie), dopo l'arrivo. Per una consegna registrata
-- da un ordine legato al riordine non serve: la parte del negozio si chiude da sola.
create function private.set_restock_shop_done(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_order_id uuid; v_expected bigint; v_done boolean; v_canonical jsonb; v_replay jsonb; v_order public.restock_orders%rowtype; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'order_id', 'expected_version', 'done'],
    array['schema_version', 'order_id', 'expected_version', 'done']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_order_id := private.consignment_uuid(p_payload -> 'order_id', false);
  v_expected := private.sale_integer(p_payload -> 'expected_version', 1, 9000000000000000);
  v_done := private.consignment_boolean(p_payload -> 'done');
  v_canonical := jsonb_build_object('schema_version', 1, 'order_id', v_order_id, 'expected_version', v_expected, 'done', v_done);
  v_replay := private.start_restock(p_operation_id, 'set_restock_shop_done', v_canonical);
  if v_replay is not null then return v_replay; end if;
  v_order := private.restock_order_for_update(v_order_id, v_expected);
  if v_order.state <> 'in_hand' then raise exception 'restock_not_received' using errcode = '22023'; end if;
  if v_order.shop_location_id is null or v_done = (v_order.shop_done_at is not null)
    or not exists (select 1 from public.restock_lines where order_id = v_order_id and destination = 'shop') then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  update public.restock_orders set shop_done_at = case when v_done then now() end, shop_done_by = case when v_done then auth.uid() end,
    version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = v_order_id returning * into v_order;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'order_id', v_order_id, 'done', v_done,
    'version', v_order.version, 'replayed', false);
  return private.finish_restock(p_operation_id, 'set_restock_shop_done', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

create function public.save_restock_order(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.save_restock_order(p_operation_id, p_payload)$$;
create function public.set_restock_lines(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.set_restock_lines(p_operation_id, p_payload)$$;
create function public.move_restock_order(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.move_restock_order(p_operation_id, p_payload)$$;
create function public.receive_restock_order(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.receive_restock_order(p_operation_id, p_payload)$$;
create function public.undo_restock_arrival(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.undo_restock_arrival(p_operation_id, p_payload)$$;
create function public.set_restock_shop_done(p_operation_id uuid, p_payload jsonb) returns jsonb language sql security invoker set search_path = '' as $$select private.set_restock_shop_done(p_operation_id, p_payload)$$;
revoke all on function private.start_restock(uuid, text, jsonb), private.finish_restock(uuid, text, jsonb, jsonb),
  private.restock_state(jsonb, boolean), private.restock_order_for_update(uuid, bigint), private.restock_shop(uuid),
  private.save_restock_order(uuid, jsonb), private.set_restock_lines(uuid, jsonb), private.move_restock_order(uuid, jsonb),
  private.receive_restock_order(uuid, jsonb), private.undo_restock_arrival(uuid, jsonb), private.set_restock_shop_done(uuid, jsonb),
  public.save_restock_order(uuid, jsonb), public.set_restock_lines(uuid, jsonb), public.move_restock_order(uuid, jsonb),
  public.receive_restock_order(uuid, jsonb), public.undo_restock_arrival(uuid, jsonb), public.set_restock_shop_done(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.save_restock_order(uuid, jsonb), private.set_restock_lines(uuid, jsonb), private.move_restock_order(uuid, jsonb),
  private.receive_restock_order(uuid, jsonb), private.undo_restock_arrival(uuid, jsonb), private.set_restock_shop_done(uuid, jsonb),
  public.save_restock_order(uuid, jsonb), public.set_restock_lines(uuid, jsonb), public.move_restock_order(uuid, jsonb),
  public.receive_restock_order(uuid, jsonb), public.undo_restock_arrival(uuid, jsonb), public.set_restock_shop_done(uuid, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Conto vendita: prima conta nelle taglie del negozio, ordine legato al riordine.
-- Come in 20261022215046_consignment_monthly, più una riga: la prima conta comprende le T-shirt
-- attive nelle taglie del negozio (consignment_shops.sizes; NULL = tutte).
-- Absolute shop count. The central warehouse never changes; no packaging.
create or replace function private.count_consignment_stock(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_location uuid; v_at timestamptz; v_note text; v_raw jsonb; v_lines jsonb := '[]'::jsonb; v_canonical jsonb; v_replay jsonb;
  v_shop public.consignment_shops%rowtype; v_item uuid; v_quantity bigint; v_expected bigint; v_balance bigint; v_movement uuid;
  v_full boolean; v_pieces bigint := 0; v_sku text; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'location_id', 'counted_at', 'note', 'lines'],
    array['schema_version', 'location_id', 'counted_at', 'note', 'lines']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_location := private.consignment_uuid(p_payload -> 'location_id', false);
  v_at := private.consignment_date(p_payload -> 'counted_at');
  v_note := private.consignment_note(p_payload -> 'note', 500);
  if jsonb_typeof(p_payload -> 'lines') is distinct from 'array' or jsonb_array_length(p_payload -> 'lines') not between 1 and 200 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  for v_raw in select value from jsonb_array_elements(p_payload -> 'lines') loop
    perform private.sale_object(v_raw, array['stock_item_id', 'quantity', 'expected_quantity'], array['stock_item_id', 'quantity', 'expected_quantity']);
    v_quantity := private.sale_integer(v_raw -> 'quantity', 0, 100000);
    v_pieces := v_pieces + v_quantity;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('stock_item_id', private.consignment_uuid(v_raw -> 'stock_item_id', false),
      'quantity', v_quantity, 'expected_quantity', private.consignment_optional_integer(v_raw -> 'expected_quantity', 0, 1000000000)));
  end loop;
  v_lines := private.consignment_sorted_lines(v_lines);
  v_canonical := jsonb_build_object('schema_version', 1, 'location_id', v_location, 'counted_at', v_at, 'note', v_note, 'lines', v_lines);
  v_replay := private.start_consignment(p_operation_id, 'count_consignment_stock', v_canonical);
  if v_replay is not null then return v_replay; end if;
  perform private.consignment_flags(false);
  v_shop := private.consignment_shop_for_update(v_location, true);
  if exists (select 1 from jsonb_array_elements(v_lines) l where not private.is_packaged_tshirt((l.value ->> 'stock_item_id')::uuid)) then
    raise exception 'invalid_tshirt' using errcode = '22023';
  end if;
  v_full := not exists (select 1 from public.stock_items s join public.product_variants v on v.stock_item_id = s.id join public.products p on p.id = v.product_id
    where s.kind = 'product' and s.active and p.category = 'T-shirt'
      and (v_shop.sizes is null or v.size = any(v_shop.sizes))
      and not exists (select 1 from jsonb_array_elements(v_lines) l where (l.value ->> 'stock_item_id')::uuid = s.id));
  if v_shop.first_counted_at is null and not v_full then raise exception 'full_count_required' using errcode = '22023'; end if;
  perform 1 from public.stock_balances where location_id = v_location
    and stock_item_id in (select (value ->> 'stock_item_id')::uuid from jsonb_array_elements(v_lines)) order by stock_item_id for update;
  insert into public.consignment_counts(id, location_id, counted_at, full_count, pieces, note, created_by)
    values (p_operation_id, v_location, v_at, v_full, v_pieces, v_note, auth.uid());
  for v_raw in select value from jsonb_array_elements(v_lines) loop
    v_item := (v_raw ->> 'stock_item_id')::uuid; v_quantity := (v_raw ->> 'quantity')::bigint; v_expected := (v_raw ->> 'expected_quantity')::bigint;
    v_balance := null;
    select quantity into v_balance from public.stock_balances where stock_item_id = v_item and location_id = v_location;
    if v_balance is distinct from v_expected then
      select sku into v_sku from public.stock_items where id = v_item;
      raise exception 'stock_changed' using errcode = '22023', detail = v_sku;
    end if;
    v_movement := null;
    if v_balance is null then
      insert into public.stock_movements(operation_id, stock_item_id, location_id, kind, quantity_delta, reason, source, actor_id)
        values (gen_random_uuid(), v_item, v_location, 'opening', v_quantity, 'Conta in negozio',
          jsonb_build_object('consignment_count_id', p_operation_id, 'counted_at', v_at), auth.uid()) returning id into v_movement;
    elsif v_balance <> v_quantity then
      insert into public.stock_movements(operation_id, stock_item_id, location_id, kind, quantity_delta, reason, source, actor_id)
        values (gen_random_uuid(), v_item, v_location, 'shop_count'::public.stock_movement_kind, v_quantity - v_balance, 'Conta in negozio',
          jsonb_build_object('consignment_count_id', p_operation_id, 'counted_at', v_at), auth.uid()) returning id into v_movement;
    end if;
    insert into public.consignment_count_lines(count_id, location_id, stock_item_id, quantity_before, counted_quantity, movement_id)
      values (p_operation_id, v_location, v_item, v_balance, v_quantity, v_movement);
  end loop;
  if v_shop.first_counted_at is null then
    update public.consignment_shops set first_counted_at = v_at where location_id = v_location;
  end if;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'count_id', p_operation_id, 'location_id', v_location,
    'pieces', v_pieces, 'full_count', v_full, 'replayed', false);
  return private.finish_consignment(p_operation_id, 'count_consignment_stock', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;


-- Come in 20261022215046_consignment_monthly, più la chiave facoltativa restock_order_id: un ordine
-- nuovo nato da un riordine arrivato («In mano nostra») per lo stesso negozio resta legato al riordine.
-- Senza la chiave il canonico e la ricevuta sono identici a prima.
-- Shop orders do not reserve the central warehouse; the delivery checks real stock.
create or replace function private.save_consignment_order(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_order_id uuid; v_expected bigint; v_location uuid; v_requested date; v_note text; v_raw jsonb; v_lines jsonb := '[]'::jsonb;
  v_canonical jsonb; v_replay jsonb; v_order public.consignment_orders%rowtype; v_line public.consignment_order_lines%rowtype;
  v_item uuid; v_quantity bigint; v_number integer; v_status text; v_sku text; v_result jsonb; v_restock uuid;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'order_id', 'expected_version', 'location_id', 'requested_on', 'note', 'lines'],
    array['schema_version', 'order_id', 'expected_version', 'location_id', 'requested_on', 'note', 'lines', 'restock_order_id']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_order_id := private.consignment_uuid(p_payload -> 'order_id', true);
  v_expected := private.consignment_optional_integer(p_payload -> 'expected_version', 1, 9000000000000000);
  if (v_order_id is null) <> (v_expected is null) then raise exception 'invalid_payload' using errcode = '22023'; end if;
  if p_payload ? 'restock_order_id' then v_restock := private.consignment_uuid(p_payload -> 'restock_order_id', true); end if;
  if v_restock is not null and v_order_id is not null then raise exception 'invalid_payload' using errcode = '22023'; end if;
  v_location := private.consignment_uuid(p_payload -> 'location_id', false);
  v_requested := private.consignment_day(p_payload -> 'requested_on');
  v_note := private.consignment_note(p_payload -> 'note', 1000);
  if jsonb_typeof(p_payload -> 'lines') is distinct from 'array' or jsonb_array_length(p_payload -> 'lines') not between 1 and 200 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  for v_raw in select value from jsonb_array_elements(p_payload -> 'lines') loop
    perform private.sale_object(v_raw, array['stock_item_id', 'quantity'], array['stock_item_id', 'quantity']);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('stock_item_id', private.consignment_uuid(v_raw -> 'stock_item_id', false),
      'quantity', private.sale_integer(v_raw -> 'quantity', 1, 100000)));
  end loop;
  v_lines := private.consignment_sorted_lines(v_lines);
  v_canonical := jsonb_build_object('schema_version', 1, 'order_id', v_order_id, 'expected_version', v_expected, 'location_id', v_location,
    'requested_on', v_requested, 'note', v_note, 'lines', v_lines);
  if v_restock is not null then v_canonical := v_canonical || jsonb_build_object('restock_order_id', v_restock); end if;
  v_replay := private.start_consignment(p_operation_id, 'save_consignment_order', v_canonical);
  if v_replay is not null then return v_replay; end if;
  perform private.consignment_shop_for_update(v_location, true);
  if v_restock is not null then
    perform 1 from public.restock_orders r where r.id = v_restock and r.state = 'in_hand' and r.shop_location_id = v_location for share;
    if not found then raise exception 'restock_not_ready' using errcode = '22023'; end if;
  end if;
  if v_order_id is null then
    select coalesce(max(order_number), 0) + 1 into v_number from public.consignment_orders where location_id = v_location;
    v_order_id := p_operation_id;
    insert into public.consignment_orders(id, location_id, order_number, requested_on, note, status, created_by, updated_by, restock_order_id)
      values (v_order_id, v_location, v_number, v_requested, v_note, 'open', auth.uid(), auth.uid(), v_restock) returning * into v_order;
  else
    select * into v_order from public.consignment_orders where id = v_order_id for update;
    if not found or v_order.location_id <> v_location then raise exception 'invalid_payload' using errcode = '22023'; end if;
    if v_order.status <> 'open' then raise exception 'order_not_open' using errcode = '22023'; end if;
    if v_order.version <> v_expected then raise exception 'stale_version' using errcode = '22023'; end if;
    perform 1 from public.consignment_order_lines where order_id = v_order_id order by stock_item_id for update;
    select s.sku into v_sku from public.consignment_order_lines l join public.stock_items s on s.id = l.stock_item_id
      where l.order_id = v_order_id and l.delivered_quantity > 0
        and not exists (select 1 from jsonb_array_elements(v_lines) n where (n.value ->> 'stock_item_id')::uuid = l.stock_item_id)
      order by l.stock_item_id limit 1;
    if found then raise exception 'below_delivered' using errcode = '22023', detail = v_sku; end if;
    delete from public.consignment_order_lines l where l.order_id = v_order_id
      and not exists (select 1 from jsonb_array_elements(v_lines) n where (n.value ->> 'stock_item_id')::uuid = l.stock_item_id);
  end if;
  for v_raw in select value from jsonb_array_elements(v_lines) loop
    v_item := (v_raw ->> 'stock_item_id')::uuid; v_quantity := (v_raw ->> 'quantity')::bigint;
    select * into v_line from public.consignment_order_lines where order_id = v_order_id and stock_item_id = v_item;
    if found then
      if v_quantity < v_line.delivered_quantity + v_line.cancelled_quantity then
        select sku into v_sku from public.stock_items where id = v_item;
        raise exception 'below_delivered' using errcode = '22023', detail = v_sku;
      end if;
      if v_quantity <> v_line.quantity then
        update public.consignment_order_lines set quantity = v_quantity where id = v_line.id;
      end if;
    else
      perform private.require_consignment_tshirt(v_item);
      insert into public.consignment_order_lines(order_id, location_id, stock_item_id, quantity)
        values (v_order_id, v_location, v_item, v_quantity);
    end if;
  end loop;
  if v_expected is not null then
    v_status := case when exists (select 1 from public.consignment_order_lines where order_id = v_order_id
      and quantity > delivered_quantity + cancelled_quantity) then 'open' else 'delivered' end;
    update public.consignment_orders set requested_on = v_requested, note = v_note, status = v_status, version = version + 1,
      updated_by = auth.uid(), updated_at = now() where id = v_order_id returning * into v_order;
  end if;
  v_result := jsonb_build_object('operation_id', p_operation_id, 'order_id', v_order_id, 'order_number', v_order.order_number,
    'status', v_order.status, 'version', v_order.version, 'replayed', false);
  return private.finish_consignment(p_operation_id, 'save_consignment_order', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Controllo CEO: le quattro funzioni di 20261023143400_ceo_feed_fixes con create or replace,
-- copiate e cambiate solo dove serve: chiavi e padre delle righe dei riordini (il padre di un
-- movimento di arrivo è il riordine), area Magazzino, priorità, frasi, link a /stock/riassortimento
-- e la frase delle taglie del negozio. Stesse 24 ore, stessa privacy: nessun importo, il titolo del
-- riordine passa da activity_feed_text come gli altri titoli. Firma, sicurezza e permessi invariati.
create or replace function private.activity_feed_keys(p_table text, p_new jsonb, p_old jsonb, p_key jsonb) returns jsonb
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
   'parent_restock', coalesce(p_new #>> '{source,restock_order_id}', p_old #>> '{source,restock_order_id}'),
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
   'device', coalesce(p_new ->> 'device', p_old ->> 'device'))
  || jsonb_build_object(
   'from_state', case when p_table = 'restock_state_events' then coalesce(p_new ->> 'from_state', p_old ->> 'from_state') end,
   'to_state', case when p_table = 'restock_state_events' then coalesce(p_new ->> 'to_state', p_old ->> 'to_state') end,
   'warehouse_pieces', case when p_table = 'restock_arrivals' and p_new ->> 'warehouse_pieces' ~ '^[0-9]{1,9}$' then p_new ->> 'warehouse_pieces' end,
   'shop_pieces', case when p_table = 'restock_arrivals' and p_new ->> 'shop_pieces' ~ '^[0-9]{1,9}$' then p_new ->> 'shop_pieces' end,
   'undone', case when p_table = 'restock_arrivals' and p_new is not null then (p_new ->> 'undone_at' is not null)::text end,
   'shop_done_before', case when p_table = 'restock_orders' and p_old is not null then (p_old ->> 'shop_done_at' is not null)::text end,
   'shop_done_after', case when p_table = 'restock_orders' and p_new is not null then (p_new ->> 'shop_done_at' is not null)::text end,
   'sizes_after', case when p_table = 'consignment_shops' and p_old is not null and p_new is not null and p_old -> 'sizes' is distinct from p_new -> 'sizes'
     then case when jsonb_typeof(p_new -> 'sizes') = 'array' then (select string_agg(x.size, ', ' order by x.n)
       from jsonb_array_elements_text(p_new -> 'sizes') with ordinality x(size, n) where x.size ~ '^[A-Z0-9]{1,10}$') else 'tutte le taglie' end end))
$$;

create or replace function private.activity_feed_link_keys(p_table text, p_new jsonb, p_old jsonb, p_key jsonb) returns jsonb
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
   'parent_restock', coalesce(p_new #>> '{source,restock_order_id}', p_old #>> '{source,restock_order_id}'),
   'shop_location', case when p_table = 'stock_locations'
     and coalesce(p_new #>> '{source,consignment_operation_id}', p_old #>> '{source,consignment_operation_id}') is not null
     then coalesce(p_new ->> 'id', p_old ->> 'id', p_key ->> 'id') end))
$$;

create or replace function private.activity_feed_parent(p_table text, p_s jsonb) returns text
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
  when p_table in ('restock_lines', 'restock_state_events', 'restock_arrivals') then 'restock_orders:' || (p_s ->> 'order_id')
  when p_table = 'stock_movements' then coalesce('sales_orders:' || (p_s ->> 'parent_order'), 'sales_order_lines:' || (p_s ->> 'parent_line'),
    'packaging_consumptions:' || (p_s ->> 'parent_consumption'), 'consignment_reports:' || (p_s ->> 'parent_report'),
    'consignment_transfers:' || (p_s ->> 'parent_transfer'), 'consignment_sales:' || (p_s ->> 'parent_sale'),
    'consignment_shipments:' || (p_s ->> 'parent_shipment'), 'consignment_counts:' || (p_s ->> 'parent_count'),
    'restock_orders:' || (p_s ->> 'parent_restock'), 'stock_items:' || (p_s ->> 'stock_item_id'))
  when p_table = 'stock_locations' then 'consignment_shops:' || (p_s ->> 'shop_location')
  when p_table in ('product_variants', 'packaging_items', 'stock_balances') then 'stock_items:' || (p_s ->> 'stock_item_id')
 end
$$;

create or replace function private.activity_feed_window(p_from timestamptz, p_to timestamptz, p_actor text)
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
   'consignment_payment_revisions', 'consignment_orders', 'consignment_order_lines', 'consignment_shipments', 'consignment_shipment_lines',
   'restock_orders', 'restock_lines', 'restock_state_events', 'restock_arrivals')
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
  case when n.table_name = 'restock_arrivals' then 150
   when n.table_name = 'restock_orders' and n.operation = 'INSERT' then 145
   when n.table_name = 'restock_state_events' then 140
   when n.table_name = 'restock_lines' then 135
   when n.table_name = 'restock_orders' then 130
   when n.table_name in ('sales_registration_cancellations', 'manual_sale_returns', 'partner_research_imports', 'partner_device_imports') then 190
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
  case when c.root_key like 'restock_orders:%' then private.activity_feed_text(ro.title, 80) end restock_title,
  case when c.root_key like 'restock_orders:%' then private.activity_feed_text(rs.name, 80) end restock_shop,
  case when c.table_name = 'restock_arrivals' then private.activity_feed_text(loc.name, 80) end restock_place,
  case when c.table_name like 'finance_%' or c.table_name in ('order_payments', 'shopify_refund_observations', 'shopify_order_financials',
     'shopify_transaction_observations', 'consignment_settlements', 'consignment_report_payments', 'consignment_payment_revisions') then 'finance'
   when c.table_name in ('calendar_events', 'tasks', 'notes') then 'team'
   when c.table_name like 'partner%' then 'partner'
   when c.table_name = 'sales_registration_cancellations' or c.table_name like 'manual_sale_return%' then 'sales'
   when c.table_name like 'restock_%' or c.root_key like 'restock_orders:%' then 'stock'
   when c.table_name like 'consignment_%' or c.root_key like 'consignment_shops:%' then 'consignment'
   when c.root_key like 'sales_orders:%' or c.table_name = 'discount_rules' then 'sales'
   when c.table_name = 'assets' then 'assets'
   when c.table_name = 'product_development_projects' then 'development'
   when c.table_name like 'packaging_%' or exists (select 1 from public.stock_items z where z.id = private.activity_feed_uuid(c.s ->> 'stock_item_id') and z.kind = 'packaging') then 'packaging'
   when c.table_name in ('profiles', 'memberships', 'app_settings') then 'settings' else 'stock' end area
 from rooted g join chosen c using (group_key)
 left join public.profiles p on p.user_id = g.actor_id
 left join public.stock_locations loc on loc.id = private.activity_feed_uuid(case when c.table_name = 'consignment_shops' then c.entity_id else c.s ->> 'location_id' end)
 left join public.restock_orders ro on c.root_key like 'restock_orders:%' and ro.id = private.activity_feed_uuid(split_part(c.root_key, ':', 2))
 left join public.stock_locations rs on rs.id = ro.shop_location_id
), worded as (
 select c.*,
  coalesce(c.shop_name, 'un negozio') shop,
  coalesce('il riordine «' || c.restock_title || '»', 'un riordine') restock_ref,
  coalesce('del riordine «' || c.restock_title || '»', 'di un riordine') restock_of,
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
  when w.table_name = 'restock_arrivals' and w.s ->> 'undone' = 'true' then 'ha annullato l’arrivo ' || w.restock_of
   || case when coalesce((w.s ->> 'pieces')::bigint, 0) > 0 then ': ' || w.pieces_label || case when (w.s ->> 'pieces')::bigint = 1 then ' tolto da ' else ' tolti da ' end
    || coalesce(w.restock_place, 'magazzino') else '' end
  when w.table_name = 'restock_arrivals' then case when coalesce((w.s ->> 'pieces')::bigint, 0) = 0
   then 'ha segnato ' || w.restock_ref || ' in mano nostra: nessun pezzo da caricare'
   else 'ha caricato in ' || coalesce(w.restock_place, 'magazzino') || ' ' || w.restock_ref || ': ' || case
    when coalesce((w.s ->> 'warehouse_pieces')::bigint, 0) = 0 then private.activity_feed_count((w.s ->> 'shop_pieces')::bigint, 'pezzo per ', 'pezzi per ') || coalesce(w.restock_shop, 'il negozio')
    when coalesce((w.s ->> 'shop_pieces')::bigint, 0) = 0 then private.activity_feed_count((w.s ->> 'warehouse_pieces')::bigint, 'pezzo per noi', 'pezzi per noi')
    else private.activity_feed_count((w.s ->> 'warehouse_pieces')::bigint, 'pezzo per noi', 'pezzi per noi') || ' e ' || (w.s ->> 'shop_pieces') || ' per ' || coalesce(w.restock_shop, 'il negozio') end end
  when w.table_name = 'restock_orders' and w.operation = 'INSERT' then case when w.actor_id is null then 'ha importato ' else 'ha creato ' end || w.restock_ref
  when w.table_name = 'restock_state_events' then case when w.s ->> 'from_state' is null then 'ha creato ' || w.restock_ref
   else 'ha portato ' || w.restock_ref || ' a «' || case w.s ->> 'to_state' when 'discussion' then 'Discussione su cosa riordinare' when 'supplier' then 'Ordine magliette a Marco' when 'embroiderer' then 'Dal ricamatore' when 'quality' then 'Da Antonella' when 'in_hand' then 'In mano nostra' else 'un altro stato' end || '»' end
  when w.table_name = 'restock_lines' then 'ha cambiato le quantità ' || w.restock_of
  when w.table_name = 'restock_orders' then case
   when w.s ->> 'shop_done_after' = 'true' and w.s ->> 'shop_done_before' = 'false' then 'ha segnato come consegnate a ' || coalesce(w.restock_shop, 'il negozio') || ' le magliette ' || w.restock_of
   when w.s ->> 'shop_done_after' = 'false' and w.s ->> 'shop_done_before' = 'true' then 'ha tolto il segno di consegna al negozio ' || w.restock_of
   else 'ha aggiornato ' || w.restock_ref end
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
  when w.table_name = 'consignment_shops' then case when w.operation = 'INSERT' then 'ha aggiunto il negozio ' || w.shop
   when w.s ->> 'sizes_after' is not null then 'ha impostato le taglie di ' || w.shop || ': ' || (w.s ->> 'sizes_after') else 'ha cambiato le condizioni di ' || w.shop end
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
  when w.table_name = 'restock_arrivals' then case when w.s ->> 'undone' = 'true' then 'ha annullato l’arrivo di %s riordini' else 'ha caricato in magazzino %s riordini' end
  when w.table_name = 'restock_orders' and w.operation = 'INSERT' then case when w.actor_id is null then 'ha importato %s riordini' else 'ha creato %s riordini' end
  when w.table_name = 'restock_state_events' then 'ha cambiato lo stato di %s riordini'
  when w.table_name = 'restock_lines' then 'ha cambiato le quantità di %s riordini'
  when w.table_name = 'restock_orders' then 'ha aggiornato %s riordini'
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
  when w.root_key like 'restock_orders:%' then '/stock/riassortimento' || coalesce('/' || private.activity_feed_uuid(split_part(w.root_key, ':', 2))::text, '')
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
  case when p.root_key like 'restock_orders:%' then '/stock/riassortimento' else case p.area when 'team' then '/team' when 'sales' then '/sales' when 'consignment' then '/consignment' when 'finance' then '/finance'
   when 'partner' then '/partner' when 'assets' then '/assets' when 'development' then '/development' when 'packaging' then '/packaging'
   when 'settings' then '/auth/account' else '/stock' end end section_href
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

commit;
