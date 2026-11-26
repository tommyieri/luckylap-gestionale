-- Il pagamento Shopify e la creazione dell'ordine sono eventi distinti.
-- processedAt puo precedere createdAt: conservarlo senza spostare date o importi.
-- Restano invariati formato, limite updatedAt e tutti i controlli sugli effetti.
begin;
create or replace function private.validate_shopify_canonical(p_order jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l jsonb;f jsonb;t jsonb;r jsonb;x jsonb;v jsonb; ids text[];child_ids text[]:='{}';
  line_ids text[]:='{}';transaction_ids text[]:='{}'; fulfillment_ids text[]:='{}';refund_ids text[]:='{}';
  line_map jsonb:='{}';fulfilled_map jsonb:='{}';refund_map jsonb:='{}';plan_lines jsonb:='[]';baseline_lines jsonb;
  q bigint;gross bigint;net bigint;discount bigint;alloc bigint;subtotal bigint:=0;discounts bigint:=0;sum_qty bigint;
  captures bigint:=0;refunds bigint:=0;refunded_total bigint:=0;parent_amount bigint;parent_refunded bigint;
  created_key text;updated_key text;baseline jsonb;key text;lineid text;id text;parent text;total bigint;tax bigint;shipping bigint;order_discount bigint;
begin
  if p_order is null or pg_column_size(p_order)>2097152 then perform private.shopify_review('canonical_limit'); end if;
  perform private.shopify_object(p_order,array['schemaVersion','apiVersion','shopDomain','orderId','sourceName','retailLocationId','createdAt','updatedAt','cancelledAt','test','edited','hasDiscountCodes','shopCurrency','presentmentCurrency','taxesIncluded','totals','lines','fulfillments','transactions','refunds']);
  if p_order->'schemaVersion' is distinct from '1'::jsonb or p_order->>'apiVersion' is distinct from '2026-10' or p_order->>'shopCurrency' is distinct from 'EUR' or p_order->>'presentmentCurrency' is distinct from 'EUR' then perform private.shopify_review('unsupported_currency_or_version'); end if;
  if private.shopify_string(p_order->'shopDomain',100) !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$' then perform private.shopify_review('invalid_canonical'); end if;
  perform private.shopify_gid(p_order->'orderId','Order');perform private.shopify_string(p_order->'sourceName',120,true);
  if p_order->'retailLocationId'<>'null'::jsonb then perform private.shopify_gid(p_order->'retailLocationId','Location'); end if;
  foreach key in array array['test','edited','hasDiscountCodes','taxesIncluded'] loop
    if jsonb_typeof(p_order->key) is distinct from 'boolean' then perform private.shopify_review('invalid_canonical'); end if;
  end loop;
  if (p_order->>'test')::boolean then perform private.shopify_review('test_order'); end if;
  if (p_order->>'edited')::boolean then perform private.shopify_review('edited_order'); end if;
  created_key:=private.shopify_time_key(p_order->'createdAt');updated_key:=private.shopify_time_key(p_order->'updatedAt');
  if created_key>updated_key then perform private.shopify_review('invalid_canonical'); end if;
  if p_order->'cancelledAt'<>'null'::jsonb then
    key:=private.shopify_time_key(p_order->'cancelledAt');if key<created_key or key>updated_key then perform private.shopify_review('invalid_canonical'); end if;
  end if;
  perform private.shopify_object(p_order->'totals',array['originalTotalCents','currentTotalCents','originalSubtotalCents','currentSubtotalCents','totalShippingPriceCents','currentShippingPriceCents','originalTaxCents','currentTaxCents','totalRefundedCents','totalReceivedCents','orderDiscountCents','totalDiscountCents']);
  for key,v in select * from jsonb_each(p_order->'totals') loop
    if key in('originalSubtotalCents','originalTaxCents','orderDiscountCents','totalDiscountCents') and v='null'::jsonb then continue; end if;
    perform private.shopify_integer(v);
  end loop;
  if p_order#>'{totals,originalSubtotalCents}'='null'::jsonb or p_order#>'{totals,originalTaxCents}'='null'::jsonb then perform private.shopify_review('missing_original_totals'); end if;
  order_discount:=coalesce(nullif(p_order#>>'{totals,orderDiscountCents}','null')::bigint,0);
  perform private.shopify_array(p_order->'lines',50);if jsonb_array_length(p_order->'lines')=0 then perform private.shopify_review('empty_order'); end if;
  for l in select * from jsonb_array_elements(p_order->'lines') loop
    perform private.shopify_object(l,array['id','variantId','sku','quantity','currentQuantity','isGiftCard','requiresShipping','originalUnitPriceCents','discountedTotalCents','lineDiscountCents','discountAllocationsCents']);
    lineid:=private.shopify_gid(l->'id','LineItem');if lineid=any(line_ids) then perform private.shopify_review('duplicate_source_id'); end if;line_ids:=array_append(line_ids,lineid);
    if l->'variantId'='null'::jsonb or l->'sku'='null'::jsonb then perform private.shopify_review('unmapped_sku'); end if;
    perform private.shopify_gid(l->'variantId','ProductVariant');perform private.shopify_string(l->'sku',120);
    if jsonb_typeof(l->'isGiftCard') is distinct from 'boolean' or jsonb_typeof(l->'requiresShipping') is distinct from 'boolean' then perform private.shopify_review('invalid_canonical'); end if;
    if (l->>'isGiftCard')::boolean or not(l->>'requiresShipping')::boolean then perform private.shopify_review('unsupported_line_kind'); end if;
    q:=private.shopify_integer(l->'quantity',100000);if q=0 or private.shopify_integer(l->'currentQuantity',100000)>q then perform private.shopify_review('invalid_canonical'); end if;
    gross:=q*private.shopify_integer(l->'originalUnitPriceCents',1000000000);net:=private.shopify_integer(l->'discountedTotalCents');discount:=private.shopify_integer(l->'lineDiscountCents');
    perform private.shopify_array(l->'discountAllocationsCents',100);alloc:=0;
    for v in select * from jsonb_array_elements(l->'discountAllocationsCents') loop alloc:=alloc+private.shopify_integer(v); end loop;
    -- discountedTotalSet can exclude order-level allocations. Apply only exact
    -- observed allocation cents; never distribute an order coupon ourselves.
    if net>gross or discount>gross-net or alloc<gross-net or alloc>gross then perform private.shopify_review('discount_allocation_mismatch'); end if;
    subtotal:=subtotal+gross-alloc;discounts:=discounts+alloc;
    plan_lines:=plan_lines||jsonb_build_array(jsonb_build_object('id',lineid,'variantId',l->>'variantId','sku',l->>'sku','quantity',q,'unit',l->'originalUnitPriceCents','discount',alloc));
    line_map:=line_map||jsonb_build_object(lineid,l);
  end loop;
  total:=private.shopify_integer(p_order#>'{totals,originalTotalCents}');tax:=private.shopify_integer(p_order#>'{totals,originalTaxCents}');shipping:=private.shopify_integer(p_order#>'{totals,totalShippingPriceCents}');
  if subtotal<>private.shopify_integer(p_order#>'{totals,originalSubtotalCents}') or total<>subtotal+shipping+(case when(p_order->>'taxesIncluded')::boolean then 0 else tax end) then perform private.shopify_review('order_totals_mismatch'); end if;
  if private.shopify_integer(p_order#>'{totals,currentTotalCents}')<>private.shopify_integer(p_order#>'{totals,currentSubtotalCents}')+private.shopify_integer(p_order#>'{totals,currentShippingPriceCents}')+(case when(p_order->>'taxesIncluded')::boolean then 0 else private.shopify_integer(p_order#>'{totals,currentTaxCents}') end) then perform private.shopify_review('current_totals_mismatch');end if;
  if p_order#>'{totals,totalDiscountCents}'<>'null'::jsonb and private.shopify_integer(p_order#>'{totals,totalDiscountCents}')<>discounts then perform private.shopify_review('discount_totals_mismatch'); end if;
  if order_discount>discounts then perform private.shopify_review('order_discount_allocation_mismatch');end if;
  perform private.shopify_array(p_order->'fulfillments',250);
  for f in select * from jsonb_array_elements(p_order->'fulfillments') loop
    perform private.shopify_object(f,array['id','status','locationId','updatedAt','totalQuantity','lines']);
    id:=private.shopify_gid(f->'id','Fulfillment');if id=any(fulfillment_ids) then perform private.shopify_review('duplicate_source_id'); end if;fulfillment_ids:=array_append(fulfillment_ids,id);
    if f->>'status' not in('CANCELLED','ERROR','FAILURE','SUCCESS') or jsonb_typeof(f->'status') is distinct from 'string' then perform private.shopify_review('invalid_canonical'); end if;
    if f->'locationId'<>'null'::jsonb then perform private.shopify_gid(f->'locationId','Location'); end if;
    if private.shopify_time_key(f->'updatedAt')>updated_key then perform private.shopify_review('invalid_canonical'); end if;
    perform private.shopify_array(f->'lines',250);sum_qty:=0;
    for x in select * from jsonb_array_elements(f->'lines') loop
      perform private.shopify_object(x,array['id','lineItemId','quantity']);key:=private.shopify_gid(x->'id','FulfillmentLineItem');
      if key=any(child_ids) then perform private.shopify_review('duplicate_source_id'); end if;child_ids:=array_append(child_ids,key);
      lineid:=private.shopify_gid(x->'lineItemId','LineItem');if not(lineid=any(line_ids)) then perform private.shopify_review('unknown_source_line'); end if;
      if x->'quantity'='null'::jsonb then perform private.shopify_review('unknown_fulfillment_quantity'); end if;
      q:=private.shopify_integer(x->'quantity',100000);if q=0 then perform private.shopify_review('invalid_canonical'); end if;sum_qty:=sum_qty+q;
      if f->>'status'='SUCCESS' then fulfilled_map:=fulfilled_map||jsonb_build_object(lineid,coalesce((fulfilled_map->>lineid)::bigint,0)+q); end if;
    end loop;
    if sum_qty<>private.shopify_integer(f->'totalQuantity',5000000) then perform private.shopify_review('fulfillment_totals_mismatch'); end if;
    if f->>'status'='SUCCESS' and(f->'locationId'='null'::jsonb or sum_qty=0) then perform private.shopify_review('unknown_fulfillment_location'); end if;
  end loop;
  perform private.shopify_array(p_order->'transactions',250);
  for t in select * from jsonb_array_elements(p_order->'transactions') loop
    perform private.shopify_object(t,array['id','kind','status','amountCents','currency','processedAt','parentId','test','gateway']);
    id:=private.shopify_gid(t->'id','OrderTransaction');if id=any(transaction_ids) then perform private.shopify_review('duplicate_source_id'); end if;transaction_ids:=array_append(transaction_ids,id);
    if t->>'kind' not in('AUTHORIZATION','CAPTURE','CHANGE','EMV_AUTHORIZATION','REFUND','SALE','SUGGESTED_REFUND','VOID') or t->>'status' not in('AWAITING_RESPONSE','ERROR','FAILURE','PENDING','SUCCESS','UNKNOWN') or jsonb_typeof(t->'kind') is distinct from 'string' or jsonb_typeof(t->'status') is distinct from 'string' or t->>'currency' is distinct from 'EUR' or jsonb_typeof(t->'test') is distinct from 'boolean' then perform private.shopify_review('invalid_canonical'); end if;
    perform private.shopify_integer(t->'amountCents');perform private.shopify_string(t->'gateway',120,true);
    if (t->>'test')::boolean then perform private.shopify_review('test_transaction'); end if;
    if t->'parentId'<>'null'::jsonb then perform private.shopify_gid(t->'parentId','OrderTransaction'); end if;
    if t->'processedAt'<>'null'::jsonb then
      key:=private.shopify_time_key(t->'processedAt');if key>updated_key then perform private.shopify_review('invalid_canonical'); end if;
    end if;
    if t->>'status'='SUCCESS' and t->>'kind' in('SALE','CAPTURE','REFUND') then
      if t->'processedAt'='null'::jsonb then perform private.shopify_review('missing_transaction_time'); end if;
      if lower(coalesce(t->>'gateway','')) ~ 'gift.?card' then perform private.shopify_review('gift_card_tender'); end if;
      if t->>'kind'='REFUND' then refunds:=refunds+(t->>'amountCents')::bigint;else captures:=captures+(t->>'amountCents')::bigint;end if;
    elsif t->>'status'='SUCCESS' and t->>'kind' in('CHANGE','SUGGESTED_REFUND') then perform private.shopify_review('unsupported_success_transaction'); end if;
  end loop;
  for t in select * from jsonb_array_elements(p_order->'transactions') loop
    parent:=t->>'parentId';if parent is not null and not(parent=any(transaction_ids)) then perform private.shopify_review('unknown_parent_transaction'); end if;
    if t->>'status'='SUCCESS' and t->>'kind'='REFUND' then
      select (value->>'amountCents')::bigint into parent_amount from jsonb_array_elements(p_order->'transactions') where value->>'id'=parent and value->>'status'='SUCCESS' and value->>'kind' in('SALE','CAPTURE');
      select sum((value->>'amountCents')::bigint) into parent_refunded from jsonb_array_elements(p_order->'transactions') where value->>'parentId'=parent and value->>'kind'='REFUND' and value->>'status'='SUCCESS';
      if parent_amount is null or parent_refunded>parent_amount then perform private.shopify_review('refund_parent_mismatch'); end if;
    end if;
  end loop;
  if captures>total or refunds>captures or captures<>private.shopify_integer(p_order#>'{totals,totalReceivedCents}') or refunds<>private.shopify_integer(p_order#>'{totals,totalRefundedCents}') then perform private.shopify_review('observed_payment_mismatch'); end if;
  perform private.shopify_array(p_order->'refunds',250);
  for r in select * from jsonb_array_elements(p_order->'refunds') loop
    perform private.shopify_object(r,array['id','createdAt','updatedAt','totalRefundedCents','lines']);
    id:=private.shopify_gid(r->'id','Refund');if id=any(refund_ids) then perform private.shopify_review('duplicate_source_id'); end if;refund_ids:=array_append(refund_ids,id);
    key:=private.shopify_time_key(r->'updatedAt');if key>updated_key then perform private.shopify_review('invalid_canonical'); end if;
    if r->'createdAt'<>'null'::jsonb and private.shopify_time_key(r->'createdAt')>key then perform private.shopify_review('invalid_canonical'); end if;
    refunded_total:=refunded_total+private.shopify_integer(r->'totalRefundedCents');perform private.shopify_array(r->'lines',250);
    for x in select * from jsonb_array_elements(r->'lines') loop
      perform private.shopify_object(x,array['id','lineItemId','quantity','restockType','restocked','locationId']);
      if x->'id'<>'null'::jsonb then key:=private.shopify_gid(x->'id','RefundLineItem');if key=any(child_ids) then perform private.shopify_review('duplicate_source_id'); end if;child_ids:=array_append(child_ids,key);end if;
      lineid:=private.shopify_gid(x->'lineItemId','LineItem');if not(lineid=any(line_ids)) then perform private.shopify_review('unknown_source_line');end if;
      q:=private.shopify_integer(x->'quantity',100000);refund_map:=refund_map||jsonb_build_object(lineid,coalesce((refund_map->>lineid)::bigint,0)+q);
      if x->>'restockType' not in('CANCEL','LEGACY_RESTOCK','NO_RESTOCK','RETURN') or jsonb_typeof(x->'restockType') is distinct from 'string' or jsonb_typeof(x->'restocked') is distinct from 'boolean' then perform private.shopify_review('invalid_canonical');end if;
      if x->'locationId'<>'null'::jsonb then perform private.shopify_gid(x->'locationId','Location');end if;
    end loop;
  end loop;
  if refunded_total<>refunds then perform private.shopify_review('refund_totals_mismatch');end if;
  for l in select * from jsonb_array_elements(p_order->'lines') loop
    lineid:=l->>'id';q:=(l->>'quantity')::bigint;sum_qty:=coalesce((fulfilled_map->>lineid)::bigint,0);
    if sum_qty>q then perform private.shopify_review('fulfilled_quantity_exceeded');end if;
    if p_order->'cancelledAt'<>'null'::jsonb and sum_qty>0 then perform private.shopify_review('fulfilled_cancellation_requires_review');end if;
    if p_order->'cancelledAt'='null'::jsonb and((l->>'currentQuantity')::bigint<>q-coalesce((refund_map->>lineid)::bigint,0) or coalesce((refund_map->>lineid)::bigint,0)>sum_qty) then perform private.shopify_review('unfulfilled_reduction_requires_review');end if;
  end loop;
  select jsonb_agg(value order by value->>'id') into baseline_lines from jsonb_array_elements(plan_lines);
  baseline:=jsonb_build_object('createdAt',created_key,'sourceName',p_order->'sourceName','retailLocationId',p_order->'retailLocationId','taxesIncluded',p_order->'taxesIncluded','total',total,'subtotal',subtotal,'shipping',shipping,'tax',tax,'lines',baseline_lines);
  return jsonb_build_object('baseline',baseline,'lines',plan_lines,'updatedKey',updated_key,'captures',captures,'refunds',refunds,'total',total);
end $$;
commit;
