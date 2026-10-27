-- Assistente Partner, compito 3: sostituti sintetici di Cron, pg_net e Vault per
-- assistente-partner-scheduler.mjs. Sono le righe 8-31 di shopify-scheduler.sql (più il ruolo
-- supabase_admin e i tre schemi), più un job Shopify sintetico già attivo, che lo scheduler
-- dell'assistente non deve toccare. Si carica dopo le migrazioni dei compiti 1 e 2 e prima di
-- _assistente_partner_scheduler.sql. Nessuna estensione vera, nessuna rete, nessun segreto reale.
create role supabase_admin nologin;
create schema cron; create schema vault; create schema net;
    create table private.synthetic_scheduler_switch(mode text not null);insert into private.synthetic_scheduler_switch values('normal');
    create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,description text,secret text not null);
    create view vault.decrypted_secrets as select id,name,description,secret as decrypted_secret from vault.secrets;
    alter table vault.secrets owner to supabase_admin;alter view vault.decrypted_secrets owner to supabase_admin;
    grant usage on schema vault to supabase_admin;
    create function vault.create_secret(new_secret text,new_name text default null,new_description text default '') returns uuid
      language plpgsql as $$declare value uuid;begin insert into vault.secrets(name,description,secret) values(new_name,new_description,new_secret) returning id into value;return value;end$$;
    create function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null) returns void
      language sql as $$update vault.secrets set secret=coalesce(new_secret,secret),name=coalesce(new_name,name),description=coalesce(new_description,description) where id=secret_id$$;
    create table cron.job(jobid bigint generated always as identity primary key,jobname text not null,schedule text not null,command text not null,username text not null,active boolean not null default true,unique(jobname,username));
    create function cron.schedule(job_name text,schedule text,command text) returns bigint language plpgsql as $$
      declare value bigint;mode text;owner_name text:=current_user;begin
      select s.mode into mode from private.synthetic_scheduler_switch s;
      if mode='fail' then raise exception 'synthetic scheduler unavailable';end if;
      if mode='wrong_owner' then owner_name:='service_role';end if;
      insert into cron.job(jobname,schedule,command,username) values(job_name,schedule,command,owner_name)
      on conflict(jobname,username) do update set schedule=excluded.schedule,command=excluded.command returning jobid into value;return value;end$$;
    create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null) returns void
      language sql as $$update cron.job j set active=coalesce($6,j.active) where j.jobid=$1 and j.username=current_user$$;
    create function cron.unschedule(job_id bigint) returns boolean language plpgsql as $$begin delete from cron.job where jobid=job_id and username=current_user;return found;end$$;
    create table net.synthetic_requests(id bigint generated always as identity primary key,url text,body jsonb,headers jsonb,timeout_ms integer,executed_by text);
    create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 1000) returns bigint
      language plpgsql as $$declare value bigint;begin insert into net.synthetic_requests(url,body,headers,timeout_ms,executed_by) values(url,body,headers,timeout_milliseconds,current_user) returning id into value;return value;end$$;
    grant select,delete on vault.secrets,vault.decrypted_secrets to service_role;
    insert into cron.job(jobname,schedule,command,username)
      values('luckylap-shopify-worker','* * * * *','select private.dispatch_shopify_worker_tick();','postgres');
