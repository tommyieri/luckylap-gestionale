-- Durable receipt cues only. No raw webhook, customer data, business effects or worker.
begin;
create table private.shopify_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null,
  webhook_id uuid not null,
  event_id uuid,
  order_gid text not null,
  topic text not null,
  api_version text not null check (api_version = '2026-10'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  metadata_sha256 text not null check (metadata_sha256 ~ '^[0-9a-f]{64}$'),
  cue jsonb not null check (jsonb_typeof(cue) = 'object'),
  received_at timestamptz not null default now(),
  unique (shop_domain, webhook_id)
);
create index shopify_inbox_order on private.shopify_webhook_inbox(shop_domain, order_gid, received_at);
create index shopify_inbox_event on private.shopify_webhook_inbox(shop_domain, event_id) where event_id is not null;
create table private.shopify_order_read_jobs (
  id uuid primary key default gen_random_uuid(),
  inbox_id uuid not null unique references private.shopify_webhook_inbox(id),
  state text not null default 'awaiting_app' check (state = 'awaiting_app'),
  created_at timestamptz not null default now()
);
alter table private.shopify_webhook_inbox enable row level security;
alter table private.shopify_order_read_jobs enable row level security;
revoke all on private.shopify_webhook_inbox, private.shopify_order_read_jobs from public, anon, authenticated, service_role;
create trigger shopify_inbox_append_only before update or delete on private.shopify_webhook_inbox
for each row execute function private.reject_ledger_mutation();
create trigger shopify_jobs_append_only before update or delete on private.shopify_order_read_jobs
for each row execute function private.reject_ledger_mutation();

create function private.receive_shopify_order_notification(p_cue jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_shop text; v_webhook uuid; v_event uuid; v_gid text; v_topic text; v_source text; v_channel text;
  v_created text; v_updated text; v_body_hash text; v_metadata_hash text; v_normalized jsonb;
  v_inbox private.shopify_webhook_inbox%rowtype; v_job uuid;
begin
  -- The SQL role is assigned by the trusted API gateway, not user_metadata.
  -- Grants are also service_role-only; this guard covers direct helper invocation.
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'shopify_receiver_access_required' using errcode = '42501';
  end if;
  perform private.sale_object(p_cue,
    array['shopDomain','webhookId','eventId','deliveryKey','apiVersion','topic','orderGid','sourceName','channel','currency','sourceCreatedAt','sourceUpdatedAt','bodySha256','requiresCanonicalRead'],
    array['shopDomain','webhookId','eventId','deliveryKey','apiVersion','topic','orderGid','sourceName','channel','currency','sourceCreatedAt','sourceUpdatedAt','bodySha256','requiresCanonicalRead']);
  if jsonb_typeof(p_cue->'shopDomain') is distinct from 'string'
    or jsonb_typeof(p_cue->'webhookId') is distinct from 'string'
    or jsonb_typeof(p_cue->'eventId') not in ('string','null')
    or jsonb_typeof(p_cue->'deliveryKey') is distinct from 'string'
    or jsonb_typeof(p_cue->'apiVersion') is distinct from 'string'
    or jsonb_typeof(p_cue->'topic') is distinct from 'string'
    or jsonb_typeof(p_cue->'orderGid') is distinct from 'string'
    or jsonb_typeof(p_cue->'sourceName') not in ('string','null')
    or jsonb_typeof(p_cue->'channel') is distinct from 'string'
    or jsonb_typeof(p_cue->'currency') is distinct from 'string'
    or jsonb_typeof(p_cue->'sourceCreatedAt') is distinct from 'string'
    or jsonb_typeof(p_cue->'sourceUpdatedAt') is distinct from 'string'
    or jsonb_typeof(p_cue->'bodySha256') is distinct from 'string'
    or p_cue->'requiresCanonicalRead' is distinct from 'true'::jsonb then
    raise exception 'invalid_shopify_cue' using errcode = '22023';
  end if;
  v_shop := p_cue->>'shopDomain'; v_gid := p_cue->>'orderGid'; v_topic := p_cue->>'topic';
  v_source := p_cue->>'sourceName'; v_channel := p_cue->>'channel';
  v_created := p_cue->>'sourceCreatedAt'; v_updated := p_cue->>'sourceUpdatedAt'; v_body_hash := p_cue->>'bodySha256';
  if v_shop !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$'
    or (p_cue->>'webhookId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (p_cue->>'eventId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_cue->>'apiVersion' <> '2026-10'
    or v_topic not in ('orders/create','orders/updated','orders/paid','orders/cancelled')
    or v_gid !~ '^gid://shopify/Order/[1-9][0-9]{0,19}$'
    or (p_cue->>'currency') !~ '^[A-Z]{3}$' or char_length(v_source) > 255
    or v_body_hash !~ '^[0-9a-f]{64}$'
    or v_created !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    or v_updated !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'invalid_shopify_cue' using errcode = '22023';
  end if;
  v_webhook := (p_cue->>'webhookId')::uuid; v_event := (p_cue->>'eventId')::uuid;
  if (substring(v_gid from 21))::numeric > 18446744073709551615
    or (substring(v_created from 1 for 4))::integer < 2000 or (substring(v_updated from 1 for 4))::integer < 2000
    or v_created::timestamptz > v_updated::timestamptz
    or p_cue->>'deliveryKey' <> v_shop || ':' || v_webhook::text
    or v_channel <> (case when v_source = 'pos' then 'shopify_pos' when v_source = 'web' then 'shopify_web' else 'shopify_other' end) then
    raise exception 'invalid_shopify_cue' using errcode = '22023';
  end if;
  v_normalized := p_cue || jsonb_build_object('webhookId',v_webhook::text,'eventId',v_event::text);
  v_metadata_hash := encode(sha256(convert_to((v_normalized - 'bodySha256')::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.shopify.delivery.' || v_shop || ':' || v_webhook::text, 0));
  select * into v_inbox from private.shopify_webhook_inbox where shop_domain = v_shop and webhook_id = v_webhook;
  if found then
    if v_inbox.payload_sha256 <> v_body_hash or v_inbox.metadata_sha256 <> v_metadata_hash then
      raise exception 'shopify_delivery_conflict' using errcode = '22023';
    end if;
    select id into v_job from private.shopify_order_read_jobs where inbox_id = v_inbox.id;
    if not found then raise exception 'shopify_receipt_incomplete' using errcode = '55000'; end if;
    return jsonb_build_object('inbox_id',v_inbox.id,'job_id',v_job,'received_at',v_inbox.received_at,'state','awaiting_app','replayed',true);
  end if;
  insert into private.shopify_webhook_inbox(shop_domain,webhook_id,event_id,order_gid,topic,api_version,payload_sha256,metadata_sha256,cue)
    values(v_shop,v_webhook,v_event,v_gid,v_topic,'2026-10',v_body_hash,v_metadata_hash,v_normalized) returning * into v_inbox;
  insert into private.shopify_order_read_jobs(inbox_id) values(v_inbox.id) returning id into v_job;
  return jsonb_build_object('inbox_id',v_inbox.id,'job_id',v_job,'received_at',v_inbox.received_at,'state','awaiting_app','replayed',false);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
  raise exception 'invalid_shopify_cue' using errcode = '22023';
end
$$;
create function public.receive_shopify_order_notification(p_cue jsonb) returns jsonb
language sql security invoker set search_path = '' as $$select private.receive_shopify_order_notification(p_cue)$$;
revoke all on function private.receive_shopify_order_notification(jsonb), public.receive_shopify_order_notification(jsonb) from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.receive_shopify_order_notification(jsonb), public.receive_shopify_order_notification(jsonb) to service_role;
commit;
