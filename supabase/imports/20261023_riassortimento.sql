-- Import dei due riordini in corso al 23 ottobre 2026, dal file di produzione di Tommi
-- («Produzione» e «In Arrivo (QC)»). Il file resta privato e non è nel repository: qui ci sono solo
-- le quantità, controllate a mano sul file (totali 85 = 64 per noi + 17 per il negozio + 4 per il
-- cliente, e 36).
--
-- Da eseguire come proprietario del database, DOPO la migrazione 20261023164150_riassortimento.
-- Idempotente: un riordine con lo stesso titolo (maiuscole a parte) non si inserisce di nuovo.
-- Scrive solo restock_orders, restock_lines e restock_state_events, più le loro righe di audit.
-- Nessun movimento di magazzino: i due riordini sono «Da Antonella», non ancora in mano nostra.
-- Le conte del negozio del file non si importano: il negozio lo conta Tommi.
-- Se manca qualcosa (founder, Magadzino, negozio di Milano, una variante) non scrive niente.
begin;
do $$
declare
  v_founder uuid; v_warehouse uuid; v_shop uuid; v_sizes text[]; v_order uuid; v_title text; v_missing text;
  v_orders jsonb := jsonb_build_array(
    jsonb_build_object('title', 'Riordine settembre 2026',
      'notes', 'Le 2 F40 M per il negozio escono dal nostro stock attuale. Produzione già ridotta dei pezzi in controllo (riordine a parte). GT3 RS Blu +1 su S-M-L-XL per sicurezza.'),
    jsonb_build_object('title', 'Pezzi in controllo da Antonella',
      'notes', 'GT3 RS Blu: nessuna utilizzabile (errori di ricamo). SL Azzurro XL/XXL non disponibili dal fornitore.'));
begin
  if (select count(*) from public.memberships where role = 'founder' and active) <> 1 then
    raise exception 'Serve un solo founder attivo.';
  end if;
  select user_id into v_founder from public.memberships where role = 'founder' and active;
  select id into v_warehouse from public.stock_locations where code = 'MAG01' and location_type = 'Magazzino' and active;
  if v_warehouse is null then raise exception 'Magadzino (MAG01) non trovato.'; end if;
  select s.location_id, s.sizes into v_shop, v_sizes from public.consignment_shops s join public.stock_locations l on l.id = s.location_id
    where l.code = 'NEG01' and l.location_type = 'Negozio Conto Vendita' and l.active;
  if v_shop is null then raise exception 'Negozio LCM (NEG01) non trovato.'; end if;

  -- Righe: titolo, destinazione, modello, colore, taglia, pezzi.
  -- Riordine di settembre, per noi = prodotti − per il negozio − per il cliente (le 4 XXXL).
  create temporary table import_restock_lines (title text, destination text, model text, color text, size text, quantity integer) on commit drop;
  insert into import_restock_lines values
    ('Riordine settembre 2026', 'warehouse', 'GT3RS', 'Bianco', 'S', 1),
    ('Riordine settembre 2026', 'warehouse', 'GT3RS', 'Bianco', 'XL', 1),
    ('Riordine settembre 2026', 'warehouse', 'GT3RS', 'Bianco', 'XXL', 1),
    ('Riordine settembre 2026', 'shop', 'GT3RS', 'Bianco', 'S', 2),
    ('Riordine settembre 2026', 'shop', 'GT3RS', 'Bianco', 'M', 2),
    ('Riordine settembre 2026', 'shop', 'GT3RS', 'Bianco', 'L', 2),
    ('Riordine settembre 2026', 'shop', 'GT3RS', 'Bianco', 'XL', 2),
    ('Riordine settembre 2026', 'customer', 'GT3RS', 'Bianco', 'XXXL', 1),
    ('Riordine settembre 2026', 'warehouse', 'GT3RS', 'Blu', 'XS', 1),
    ('Riordine settembre 2026', 'warehouse', 'GT3RS', 'Blu', 'S', 3),
    ('Riordine settembre 2026', 'warehouse', 'GT3RS', 'Blu', 'M', 4),
    ('Riordine settembre 2026', 'warehouse', 'GT3RS', 'Blu', 'L', 7),
    ('Riordine settembre 2026', 'warehouse', 'GT3RS', 'Blu', 'XL', 4),
    ('Riordine settembre 2026', 'warehouse', 'GT3RS', 'Blu', 'XXL', 1),
    ('Riordine settembre 2026', 'shop', 'GT3RS', 'Blu', 'S', 1),
    ('Riordine settembre 2026', 'customer', 'GT3RS', 'Blu', 'XXXL', 1),
    ('Riordine settembre 2026', 'warehouse', 'TESTAROSSA', 'Bianco', 'M', 1),
    ('Riordine settembre 2026', 'warehouse', 'TESTAROSSA', 'Bianco', 'L', 1),
    ('Riordine settembre 2026', 'warehouse', 'TESTAROSSA', 'Bianco', 'XL', 1),
    ('Riordine settembre 2026', 'shop', 'TESTAROSSA', 'Bianco', 'M', 1),
    ('Riordine settembre 2026', 'warehouse', 'SL', 'Azzurro', 'S', 2),
    ('Riordine settembre 2026', 'warehouse', 'SL', 'Azzurro', 'M', 6),
    ('Riordine settembre 2026', 'warehouse', 'SL', 'Azzurro', 'L', 6),
    ('Riordine settembre 2026', 'warehouse', 'SL', 'Azzurro', 'XL', 3),
    ('Riordine settembre 2026', 'warehouse', 'SL', 'Azzurro', 'XXL', 2),
    ('Riordine settembre 2026', 'shop', 'SL', 'Azzurro', 'XL', 3),
    ('Riordine settembre 2026', 'warehouse', '964', 'Blu', 'M', 1),
    ('Riordine settembre 2026', 'warehouse', '964', 'Blu', 'L', 5),
    ('Riordine settembre 2026', 'warehouse', '964', 'Blu', 'XXL', 1),
    ('Riordine settembre 2026', 'customer', '964', 'Blu', 'XXXL', 1),
    ('Riordine settembre 2026', 'warehouse', '964', 'Bianco', 'S', 1),
    ('Riordine settembre 2026', 'warehouse', '964', 'Bianco', 'M', 1),
    ('Riordine settembre 2026', 'warehouse', '964', 'Bianco', 'L', 1),
    ('Riordine settembre 2026', 'warehouse', '964', 'Bianco', 'XL', 1),
    ('Riordine settembre 2026', 'shop', '964', 'Bianco', 'XL', 1),
    ('Riordine settembre 2026', 'customer', '964', 'Bianco', 'XXXL', 1),
    ('Riordine settembre 2026', 'warehouse', 'F40', 'Bianco', 'S', 2),
    ('Riordine settembre 2026', 'warehouse', 'F40', 'Bianco', 'XL', 2),
    ('Riordine settembre 2026', 'shop', 'F40', 'Bianco', 'S', 1),
    ('Riordine settembre 2026', 'shop', 'F40', 'Bianco', 'M', 2),
    ('Riordine settembre 2026', 'warehouse', 'SENNA', 'Bianco', 'S', 3),
    ('Riordine settembre 2026', 'warehouse', 'SENNA', 'Bianco', 'M', 1),
    -- Pezzi in controllo da Antonella: tutti per noi.
    ('Pezzi in controllo da Antonella', 'warehouse', 'GT3RS', 'Bianco', 'XS', 3),
    ('Pezzi in controllo da Antonella', 'warehouse', 'GT3RS', 'Bianco', 'S', 2),
    ('Pezzi in controllo da Antonella', 'warehouse', 'GT3RS', 'Bianco', 'M', 5),
    ('Pezzi in controllo da Antonella', 'warehouse', 'GT3RS', 'Bianco', 'L', 5),
    ('Pezzi in controllo da Antonella', 'warehouse', 'GT3RS', 'Bianco', 'XL', 2),
    ('Pezzi in controllo da Antonella', 'warehouse', 'GT3RS', 'Bianco', 'XXL', 1),
    ('Pezzi in controllo da Antonella', 'warehouse', 'TESTAROSSA', 'Bianco', 'S', 3),
    ('Pezzi in controllo da Antonella', 'warehouse', 'TESTAROSSA', 'Bianco', 'M', 3),
    ('Pezzi in controllo da Antonella', 'warehouse', 'TESTAROSSA', 'Bianco', 'L', 4),
    ('Pezzi in controllo da Antonella', 'warehouse', 'TESTAROSSA', 'Bianco', 'XL', 4),
    ('Pezzi in controllo da Antonella', 'warehouse', '964', 'Blu', 'S', 2),
    ('Pezzi in controllo da Antonella', 'warehouse', '964', 'Bianco', 'L', 2);

  -- Totali attesi dal file: se una riga è sbagliata, nessuna scrittura.
  if (select sum(quantity) from import_restock_lines where title = 'Riordine settembre 2026') <> 85
    or (select sum(quantity) from import_restock_lines where title = 'Riordine settembre 2026' and destination = 'warehouse') <> 64
    or (select sum(quantity) from import_restock_lines where title = 'Riordine settembre 2026' and destination = 'shop') <> 17
    or (select sum(quantity) from import_restock_lines where title = 'Riordine settembre 2026' and destination = 'customer') <> 4
    or (select sum(quantity) from import_restock_lines where title = 'Pezzi in controllo da Antonella') <> 36 then
    raise exception 'Totali del file non corrispondenti.';
  end if;

  -- Ogni modello e colore a catalogo; per noi e per il negozio la variante attiva; per il negozio
  -- solo le sue taglie.
  select string_agg(i.model || ' ' || i.color || ' ' || i.size, ', ') into v_missing from import_restock_lines i
    where not exists (select 1 from public.products p join public.product_variants v on v.product_id = p.id
        where upper(p.model) = upper(i.model) and v.color = i.color)
      or (i.destination <> 'customer' and not exists (select 1 from public.products p join public.product_variants v on v.product_id = p.id
        join public.stock_items s on s.id = v.stock_item_id
        where upper(p.model) = upper(i.model) and v.color = i.color and v.size = i.size and s.active))
      or (i.destination = 'shop' and v_sizes is not null and not i.size = any(v_sizes));
  if v_missing is not null then raise exception 'Varianti non trovate o taglie non del negozio: %', v_missing; end if;

  for v_title in select value ->> 'title' from jsonb_array_elements(v_orders) loop
    continue when exists (select 1 from public.restock_orders where lower(title) = lower(v_title));
    v_order := gen_random_uuid();
    insert into public.restock_orders(id, title, notes, state, state_changed_by, warehouse_location_id, shop_location_id, created_by, updated_by)
      select v_order, v_title, o.value ->> 'notes', 'quality', v_founder, v_warehouse,
        case when exists (select 1 from import_restock_lines where title = v_title and destination = 'shop') then v_shop end,
        v_founder, v_founder
      from jsonb_array_elements(v_orders) o where o.value ->> 'title' = v_title;
    insert into public.restock_lines(order_id, destination, product_id, color, size, stock_item_id, quantity)
      select v_order, i.destination, p.id, i.color, i.size,
        (select v.stock_item_id from public.product_variants v where v.product_id = p.id and v.color = i.color and v.size = i.size),
        i.quantity
      from import_restock_lines i join public.products p on upper(p.model) = upper(i.model)
      where i.title = v_title;
    insert into public.restock_state_events(order_id, from_state, to_state, note, created_by)
      values (v_order, null, 'quality', 'Importato dal file di produzione', v_founder);
  end loop;
end
$$;
commit;
