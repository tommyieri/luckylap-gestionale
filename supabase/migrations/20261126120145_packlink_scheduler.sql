-- Only a fixed internal worker is scheduled. No job or credential is activated here.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$ begin
  if pg_catalog.has_table_privilege('anon','vault.secrets','SELECT')
    or pg_catalog.has_table_privilege('anon','vault.decrypted_secrets','SELECT')
    or pg_catalog.has_table_privilege('authenticated','vault.secrets','SELECT')
    or pg_catalog.has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') then
    raise exception 'packlink_scheduler_vault_permissions_required' using errcode='55000';
  end if;
end $$;

create table private.packlink_scheduler_state (
  singleton boolean primary key default true check(singleton),
  vault_secret_id uuid not null,
  configured_at timestamptz not null default now()
);
alter table private.packlink_scheduler_state owner to postgres;
alter table private.packlink_scheduler_state enable row level security;
revoke all on private.packlink_scheduler_state from public,anon,authenticated,service_role;

create function private.dispatch_packlink_worker_tick() returns void
language plpgsql security definer set search_path='' as $$
declare v_secret text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packlink.scheduler',0));
  if not exists(select 1 from private.packlink_sync_configuration where enabled) then return;end if;
  select d.decrypted_secret into v_secret
    from private.packlink_scheduler_state s join vault.decrypted_secrets d
      on d.id=s.vault_secret_id and d.name='luckylap_packlink_worker_bearer' where s.singleton;
  if not found or v_secret is null or octet_length(v_secret) not between 32 and 256
    or v_secret !~ '^[A-Za-z0-9_-]+$' then return;end if;
  perform net.http_post(
    url:='https://luckylap.vercel.app/api/integrations/packlink/worker',
    body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),
    timeout_milliseconds:=55000
  );
end $$;
alter function private.dispatch_packlink_worker_tick() owner to postgres;
revoke all on function private.dispatch_packlink_worker_tick() from public,anon,authenticated,service_role;

create function private.configure_packlink_scheduler(p_worker_secret text,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_secret_id uuid;v_job_id bigint;v_job record;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'packlink_worker_access_required' using errcode='42501';end if;
  if p_enabled is null or (p_enabled and(p_worker_secret is null
    or octet_length(p_worker_secret) not between 32 and 256 or p_worker_secret !~ '^[A-Za-z0-9_-]+$')) then
    raise exception 'invalid_packlink_scheduler_configuration' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packlink.scheduler',0));
  if not p_enabled then
    for v_job in select jobid from cron.job where jobname='luckylap-packlink-worker' and username=current_user loop
      perform cron.unschedule(v_job.jobid);
    end loop;
    delete from private.packlink_scheduler_state where singleton;
    delete from vault.secrets where name='luckylap_packlink_worker_bearer';
    return jsonb_build_object('enabled',false,'schedule_seconds',900);
  end if;
  if not exists(select 1 from private.packlink_sync_configuration where enabled) then
    raise exception 'packlink_sync_configuration_required' using errcode='55000';end if;
  select id into v_secret_id from vault.secrets where name='luckylap_packlink_worker_bearer';
  if found then
    perform vault.update_secret(v_secret_id,p_worker_secret,'luckylap_packlink_worker_bearer','LuckyLap Packlink worker scheduler bearer');
  else
    v_secret_id:=vault.create_secret(p_worker_secret,'luckylap_packlink_worker_bearer','LuckyLap Packlink worker scheduler bearer');
  end if;
  insert into private.packlink_scheduler_state(singleton,vault_secret_id) values(true,v_secret_id)
    on conflict(singleton) do update set vault_secret_id=excluded.vault_secret_id,configured_at=now();
  v_job_id:=cron.schedule('luckylap-packlink-worker','*/15 * * * *','select private.dispatch_packlink_worker_tick();');
  perform cron.alter_job(v_job_id,active:=true);
  if not exists(select 1 from cron.job where jobid=v_job_id and username='postgres'
    and jobname='luckylap-packlink-worker' and schedule='*/15 * * * *'
    and command='select private.dispatch_packlink_worker_tick();' and active) then
    raise exception 'packlink_scheduler_configuration_unavailable' using errcode='55000';end if;
  return jsonb_build_object('enabled',true,'schedule_seconds',900);
end $$;
alter function private.configure_packlink_scheduler(text,boolean) owner to postgres;
create function public.configure_packlink_scheduler(p_worker_secret text,p_enabled boolean) returns jsonb
language sql security invoker set search_path='' as $$select private.configure_packlink_scheduler(p_worker_secret,p_enabled)$$;
alter function public.configure_packlink_scheduler(text,boolean) owner to postgres;
revoke all on function private.configure_packlink_scheduler(text,boolean),public.configure_packlink_scheduler(text,boolean) from public,anon,authenticated,service_role;
grant execute on function private.configure_packlink_scheduler(text,boolean),public.configure_packlink_scheduler(text,boolean) to service_role;
commit;
