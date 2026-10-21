-- Commercial catalog observations only. Physical availability remains in stock_balances.
begin;

create table public.shopify_catalog_variants (
  shop_domain text not null check (
    shop_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$'
  ),
  variant_gid text not null check (variant_gid ~ '^gid://shopify/ProductVariant/[1-9][0-9]{0,19}$'),
  product_gid text not null check (product_gid ~ '^gid://shopify/Product/[1-9][0-9]{0,19}$'),
  sku text not null check (sku = btrim(sku) and char_length(sku) between 1 and 120 and sku !~ '[[:cntrl:]]'),
  product_title text not null check (char_length(btrim(product_title)) between 1 and 500),
  product_type text not null default '' check (char_length(product_type) <= 240),
  status text not null check (status in ('ACTIVE', 'DRAFT', 'ARCHIVED')),
  price_cents bigint not null check (price_cents between 0 and 99999999999999),
  currency_code text not null default 'EUR' check (currency_code = 'EUR'),
  source_updated_at timestamptz not null check (isfinite(source_updated_at)),
  observed_at timestamptz not null default now() check (isfinite(observed_at)),
  stock_item_id uuid references public.stock_items(id),
  primary key (shop_domain, variant_gid)
);

-- An active SKU and a physical identity each map to at most one variant per shop.
create unique index shopify_catalog_active_sku on public.shopify_catalog_variants(shop_domain, sku) where status = 'ACTIVE';
create unique index shopify_catalog_stock_identity on public.shopify_catalog_variants(shop_domain, stock_item_id) where stock_item_id is not null;
create index shopify_catalog_stock_item on public.shopify_catalog_variants(stock_item_id) where stock_item_id is not null;

-- The optional link is exact and only targets a physical product. An unmatched
-- commercial SKU stays NULL; it never creates a stock item or packaging material.
create function private.check_shopify_catalog_mapping() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare item public.stock_items%rowtype;
begin
  if new.stock_item_id is not null then
    select * into item from public.stock_items where id = new.stock_item_id;
    if not found then raise exception 'Unknown physical stock item' using errcode = '23503'; end if;
    if item.kind <> 'product' or item.sku <> new.sku then
      raise exception 'Catalog mapping requires an exact physical product SKU' using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;
revoke all on function private.check_shopify_catalog_mapping() from public, anon, authenticated, service_role;
create trigger check_mapping before insert or update on public.shopify_catalog_variants
  for each row execute function private.check_shopify_catalog_mapping();

-- All writes are owner imports. Keep the composite source identity and the
-- system actor without attributing an administrative import to a staff member.
create function private.audit_shopify_catalog_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare old_record jsonb; new_record jsonb; record_data jsonb;
begin
  if tg_op <> 'INSERT' then old_record := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_record := to_jsonb(new); end if;
  record_data := coalesce(new_record, old_record);
  insert into public.audit_logs(actor_id, table_name, operation, record_key, old_data, new_data)
    values (null, tg_table_name, tg_op,
      jsonb_strip_nulls(jsonb_build_object('shop_domain', record_data->'shop_domain',
        'variant_gid', record_data->'variant_gid', 'stock_item_id', record_data->'stock_item_id')),
      old_record, new_record);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
revoke all on function private.audit_shopify_catalog_change() from public, anon, authenticated, service_role;
create trigger audit_change after insert or update or delete on public.shopify_catalog_variants
  for each row execute function private.audit_shopify_catalog_change();

alter table public.shopify_catalog_variants enable row level security;
revoke all on public.shopify_catalog_variants from public, anon, authenticated, service_role;
grant select on public.shopify_catalog_variants to authenticated;
create policy catalog_read on public.shopify_catalog_variants for select to authenticated
  using ((select private.is_member()));

comment on table public.shopify_catalog_variants is 'Read-only Shopify commercial catalog. Owner-managed observations, no inventory quantities or stock synchronization.';
comment on column public.shopify_catalog_variants.stock_item_id is 'Optional exact-SKU link to a physical product. NULL means no verified mapping; never implies zero stock.';
commit;
