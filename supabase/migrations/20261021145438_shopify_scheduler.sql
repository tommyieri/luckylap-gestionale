-- Extension availability was read on the target Free project before this DDL.
-- No job, Vault secret or HTTP request is created by applying this migration.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Respect provider-managed Vault ownership and service_role grants. The
-- browser roles must already be excluded; fail closed rather than rewrite ACLs.
do $$ begin
  if pg_catalog.has_table_privilege('anon','vault.secrets','SELECT')
    or pg_catalog.has_table_privilege('anon','vault.decrypted_secrets','SELECT')
    or pg_catalog.has_table_privilege('authenticated','vault.secrets','SELECT')
    or pg_catalog.has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') then
    raise exception 'shopify_scheduler_vault_permissions_required' using errcode='55000';
  end if;
end $$;

create table private.shopify_scheduler_state (
  singleton boolean primary key default true check(singleton),
  vault_secret_id uuid not null,
  configured_at timestamptz not null default now()
);
alter table private.shopify_scheduler_state owner to postgres;
alter table private.shopify_scheduler_state enable row level security;
revoke all on private.shopify_scheduler_state from public,anon,authenticated,service_role;

create function private.dispatch_shopify_worker_tick() returns void
language plpgsql security definer set search_path='' as $$
declare v_secret text;
begin
  -- Serialize the credential read AND queue commit with disable/rotation.
  -- A completed disable cannot be followed by an enqueue from a stale read.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.shopify.scheduler',0));
  select d.decrypted_secret into v_secret
    from private.shopify_scheduler_state s
    join vault.decrypted_secrets d on d.id=s.vault_secret_id
      and d.name='luckylap_shopify_worker_bearer'
    where s.singleton;
  if not found or v_secret is null or octet_length(v_secret) not between 32 and 256
    or v_secret !~ '^[A-Za-z0-9_-]+$' then return; end if;
  -- Neither URL nor SQL nor request body is caller-controlled.
  perform net.http_post(
    url:='https://luckylap.vercel.app/api/integrations/shopify/worker',
    body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),
    timeout_milliseconds:=55000
  );
end $$;
alter function private.dispatch_shopify_worker_tick() owner to postgres;
revoke all on function private.dispatch_shopify_worker_tick() from public,anon,authenticated,service_role;

create function private.configure_shopify_scheduler(p_worker_secret text,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_secret_id uuid; v_job_id bigint; v_job record;
begin
  perform private.shopify_service_required();
  if p_enabled is null or (p_enabled and (p_worker_secret is null
    or octet_length(p_worker_secret) not between 32 and 256
    or p_worker_secret !~ '^[A-Za-z0-9_-]+$')) then
    raise exception 'invalid_shopify_scheduler_configuration' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.shopify.scheduler',0));
  if not p_enabled then
    for v_job in select jobid from cron.job
      where jobname='luckylap-shopify-worker' and username=current_user loop
      perform cron.unschedule(v_job.jobid);
    end loop;
    delete from private.shopify_scheduler_state where singleton;
    delete from vault.secrets where name='luckylap_shopify_worker_bearer';
    return jsonb_build_object('enabled',false,'schedule_seconds',60);
  end if;
  select id into v_secret_id from vault.secrets where name='luckylap_shopify_worker_bearer';
  if found then
    perform vault.update_secret(v_secret_id,p_worker_secret,'luckylap_shopify_worker_bearer','LuckyLap Shopify worker scheduler bearer');
  else
    v_secret_id:=vault.create_secret(p_worker_secret,'luckylap_shopify_worker_bearer','LuckyLap Shopify worker scheduler bearer');
  end if;
  insert into private.shopify_scheduler_state(singleton,vault_secret_id) values(true,v_secret_id)
    on conflict(singleton) do update set vault_secret_id=excluded.vault_secret_id,configured_at=now();
  -- SECURITY DEFINER owner postgres becomes the cron job username.
  v_job_id:=cron.schedule('luckylap-shopify-worker','* * * * *','select private.dispatch_shopify_worker_tick();');
  -- pg_cron 1.6.4 named upsert does not reactivate an existing paused job.
  perform cron.alter_job(v_job_id,active:=true);
  if not exists(select 1 from cron.job where jobid=v_job_id and username='postgres'
    and jobname='luckylap-shopify-worker' and schedule='* * * * *'
    and command='select private.dispatch_shopify_worker_tick();' and active) then
    raise exception 'shopify_scheduler_configuration_unavailable' using errcode='55000';
  end if;
  return jsonb_build_object('enabled',true,'schedule_seconds',60);
end $$;
alter function private.configure_shopify_scheduler(text,boolean) owner to postgres;

create function public.configure_shopify_scheduler(p_worker_secret text,p_enabled boolean) returns jsonb
language sql security invoker set search_path='' as $$select private.configure_shopify_scheduler(p_worker_secret,p_enabled)$$;
alter function public.configure_shopify_scheduler(text,boolean) owner to postgres;
revoke all on function private.configure_shopify_scheduler(text,boolean),public.configure_shopify_scheduler(text,boolean) from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function private.configure_shopify_scheduler(text,boolean),public.configure_shopify_scheduler(text,boolean) to service_role;
commit;
