-- Close unimported historical notifications without requesting Shopify history.
-- The canonical apply boundary and every commercial/physical effect stay unchanged.
begin;

create function private.shopify_cue_is_before_cutover(p_created jsonb,p_cutover timestamptz) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare source_created text; parsed timestamptz;
begin
  if p_cutover is null or not isfinite(p_cutover) or jsonb_typeof(p_created) is distinct from 'string' then
    return false;
  end if;
  source_created:=p_created#>>'{}';
  if source_created !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,9})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
    or substring(source_created,1,4)::integer<2000 then return false;
  end if;
  parsed:=source_created::timestamptz;
  -- The receiver retains the source string. The extra millisecond also protects
  -- any older millisecond-rounded cue and PostgreSQL's microsecond rounding.
  return isfinite(parsed) and parsed+interval '1 millisecond'<p_cutover;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return false;
end $$;
revoke all on function private.shopify_cue_is_before_cutover(jsonb,timestamptz) from public,anon,authenticated,service_role;

create or replace function private.claim_shopify_order_jobs(p_worker_id uuid,p_limit integer,p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record; result jsonb:='[]'::jsonb; token uuid; expiry timestamptz; cutover timestamptz; sync_enabled boolean;
begin
  perform private.shopify_service_required();
  if p_worker_id is null or p_limit not between 1 and 20 or p_limit is null or p_lease_seconds not between 30 and 900 or p_lease_seconds is null then raise exception 'invalid_worker_claim' using errcode='22023'; end if;

  -- This bound is separate from the normal claim limit: historical deliveries
  -- must not consume the current orders' batch. Never take over a leased job.
  for candidate in
    select l.job_id,i.shop_domain,i.order_gid,i.cue
    from private.shopify_job_leases l
    join private.shopify_order_read_jobs j on j.id=l.job_id
    join private.shopify_webhook_inbox i on i.id=j.inbox_id
    join private.shopify_sync_configuration c on c.shop_domain=i.shop_domain and c.enabled
    join public.app_settings s on s.id
    where l.state in('pending','retry','review')
      and private.shopify_cue_is_before_cutover(i.cue->'sourceCreatedAt',s.sales_started_at)
      and not exists(select 1 from private.shopify_order_identities o where o.shop_domain=i.shop_domain and o.order_gid=i.order_gid)
    order by j.created_at,l.job_id for update of l skip locked limit 20
  loop
    -- apply_shopify_order uses this same order lock after locking its own lease.
    -- Do not wait for a different delivery currently importing this order.
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.shopify.'||candidate.shop_domain||'.'||candidate.order_gid,0)) then continue;end if;
    select c.enabled into sync_enabled from private.shopify_sync_configuration c where c.shop_domain=candidate.shop_domain for share;
    if not found or sync_enabled is distinct from true then continue;end if;
    select s.sales_started_at into cutover from public.app_settings s where s.id for share;
    if not found or not private.shopify_cue_is_before_cutover(candidate.cue->'sourceCreatedAt',cutover) then continue;end if;
    if exists(select 1 from private.shopify_order_identities o where o.shop_domain=candidate.shop_domain and o.order_gid=candidate.order_gid) then continue;end if;
    update private.shopify_job_leases set
      state='ignored',reason='before_sales_cutover',
      result=jsonb_build_object('status','ignored','reason','before_sales_cutover','job_id',candidate.job_id),
      worker_id=null,lease_token=null,lease_expires_at=null,canonical_digest=null,updated_at=now()
      where job_id=candidate.job_id and state in('pending','retry','review');
  end loop;

  for candidate in select l.job_id,i.id inbox_id,i.shop_domain,i.order_gid
    from private.shopify_job_leases l join private.shopify_order_read_jobs j on j.id=l.job_id join private.shopify_webhook_inbox i on i.id=j.inbox_id
    where ((l.state in('pending','retry') and l.next_attempt_at<=clock_timestamp()) or(l.state='leased' and l.lease_expires_at<=clock_timestamp()))
      -- Historical pending/retry rows outside the cleanup bound wait for the
      -- next cleanup, rather than making a read that may need read_all_orders.
      -- Expired leases retain their pre-existing recovery path.
      and not(l.state in('pending','retry') and exists(
        select 1 from private.shopify_sync_configuration c join public.app_settings s on s.id
        where c.shop_domain=i.shop_domain and c.enabled
          and private.shopify_cue_is_before_cutover(i.cue->'sourceCreatedAt',s.sales_started_at)
          and not exists(select 1 from private.shopify_order_identities o where o.shop_domain=i.shop_domain and o.order_gid=i.order_gid)
      ))
    order by j.created_at,l.job_id for update of l skip locked limit p_limit
  loop
    token:=gen_random_uuid();expiry:=clock_timestamp()+make_interval(secs=>p_lease_seconds);
    update private.shopify_job_leases set state='leased',worker_id=p_worker_id,lease_token=token,lease_expires_at=expiry,attempts=attempts+1,updated_at=now()
      where job_id=candidate.job_id;
    result:=result||jsonb_build_array(jsonb_build_object('job_id',candidate.job_id,'inbox_id',candidate.inbox_id,'shop_domain',candidate.shop_domain,'order_gid',candidate.order_gid,'lease_token',token,'lease_expires_at',expiry));
  end loop;
  return result;
end $$;
revoke all on function private.claim_shopify_order_jobs(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.claim_shopify_order_jobs(uuid,integer,integer) to service_role;

commit;
