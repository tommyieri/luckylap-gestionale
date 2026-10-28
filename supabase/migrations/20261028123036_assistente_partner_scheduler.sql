-- Assistente Partner, prima consegna: lo scheduler. Copia di 20261021145438_shopify_scheduler.sql
-- con nomi propri (job, segreto Vault, lock, funzioni), così lo spegnimento e la rotazione restano
-- indipendenti da Shopify. pg_cron chiama ogni due minuti, con pg_net, la route del worker
-- dell'assistente con un bearer letto da Vault; la route decide il lavoro solo dal database.
--
-- - Nessuna estensione nuova: pg_cron, pg_net e Vault esistono già in produzione (li usa lo
--   scheduler Shopify). Applicare la migrazione non crea job, segreti o chiamate HTTP: lo scheduler
--   si accende dopo, con configure_partner_assistant_scheduler, solo da service_role.
-- - Tutte le funzioni sono plpgsql: il corpo si risolve solo quando gira, così la migrazione
--   compila anche dove cron, net e vault non hanno funzioni (gli harness PostgreSQL 17).
-- - Il giro risponde subito: la route lavora dopo la risposta, quindi un timeout di 10 secondi.
--
-- Codici d'errore (messaggio = codice): 42501 partner_assistant_worker_access_required;
-- 22023 invalid_partner_assistant_scheduler_configuration;
-- 55000 partner_assistant_scheduler_vault_permissions_required,
-- partner_assistant_scheduler_configuration_unavailable.
begin;

-- Come per Shopify: i ruoli del browser non devono leggere Vault. Se li leggono ci si ferma, senza
-- riscrivere i permessi gestiti da Supabase.
do $$
begin
  if pg_catalog.has_table_privilege('anon', 'vault.secrets', 'SELECT')
    or pg_catalog.has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'vault.secrets', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT') then
    raise exception 'partner_assistant_scheduler_vault_permissions_required' using errcode = '55000';
  end if;
end
$$;

-- Il puntatore al segreto in Vault, una riga sola quando lo scheduler è acceso.
create table private.partner_assistant_scheduler_state (
  singleton boolean primary key default true check (singleton),
  vault_secret_id uuid not null,
  configured_at timestamptz not null default now()
);
alter table private.partner_assistant_scheduler_state owner to postgres;
alter table private.partner_assistant_scheduler_state enable row level security;
revoke all on private.partner_assistant_scheduler_state from public, anon, authenticated, service_role;

-- Il giro di cron. Il lock serializza la lettura del segreto e l'accodamento con lo spegnimento e
-- la rotazione: dopo uno spegnimento concluso nessun giro accoda con un segreto letto prima.
create function private.dispatch_partner_assistant_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.partner_assistant.scheduler', 0));
  select d.decrypted_secret into v_secret
    from private.partner_assistant_scheduler_state s
    join vault.decrypted_secrets d on d.id = s.vault_secret_id and d.name = 'luckylap_partner_assistant_bearer'
    where s.singleton;
  if not found or v_secret is null or octet_length(v_secret) not between 32 and 256
    or v_secret !~ '^[A-Za-z0-9_-]+$' then
    return;
  end if;
  -- URL, SQL e corpo fissi: niente viene da chi chiama.
  perform net.http_post(
    url := 'https://luckylap.vercel.app/api/integrations/partner-assistant/worker',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 10000
  );
end
$$;
alter function private.dispatch_partner_assistant_tick() owner to postgres;
revoke all on function private.dispatch_partner_assistant_tick() from public, anon, authenticated, service_role;

-- Accende (con il bearer, anche per ruotarlo) o spegne lo scheduler. Spento: via il job, il
-- puntatore e il segreto dell'assistente, nient'altro.
create function private.configure_partner_assistant_scheduler(p_worker_secret text, p_enabled boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_secret_id uuid; v_job_id bigint; v_job record;
begin
  perform private.partner_assistant_service_required();
  if p_enabled is null or (p_enabled and (p_worker_secret is null
    or octet_length(p_worker_secret) not between 32 and 256
    or p_worker_secret !~ '^[A-Za-z0-9_-]+$')) then
    raise exception 'invalid_partner_assistant_scheduler_configuration' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.partner_assistant.scheduler', 0));
  if not p_enabled then
    for v_job in select jobid from cron.job
      where jobname = 'luckylap-partner-assistant' and username = current_user loop
      perform cron.unschedule(v_job.jobid);
    end loop;
    delete from private.partner_assistant_scheduler_state where singleton;
    delete from vault.secrets where name = 'luckylap_partner_assistant_bearer';
    return jsonb_build_object('enabled', false, 'schedule_seconds', 120);
  end if;
  select id into v_secret_id from vault.secrets where name = 'luckylap_partner_assistant_bearer';
  if found then
    perform vault.update_secret(v_secret_id, p_worker_secret, 'luckylap_partner_assistant_bearer',
      'LuckyLap Partner assistant scheduler bearer');
  else
    v_secret_id := vault.create_secret(p_worker_secret, 'luckylap_partner_assistant_bearer',
      'LuckyLap Partner assistant scheduler bearer');
  end if;
  insert into private.partner_assistant_scheduler_state(singleton, vault_secret_id) values (true, v_secret_id)
    on conflict (singleton) do update set vault_secret_id = excluded.vault_secret_id, configured_at = now();
  -- Il proprietario postgres della funzione definer diventa l'utente del job.
  v_job_id := cron.schedule('luckylap-partner-assistant', '*/2 * * * *',
    'select private.dispatch_partner_assistant_tick();');
  -- In pg_cron 1.6.4 lo schedule con nome non riattiva un job in pausa.
  perform cron.alter_job(v_job_id, active := true);
  if not exists (select 1 from cron.job where jobid = v_job_id and username = 'postgres'
    and jobname = 'luckylap-partner-assistant' and schedule = '*/2 * * * *'
    and command = 'select private.dispatch_partner_assistant_tick();' and active) then
    raise exception 'partner_assistant_scheduler_configuration_unavailable' using errcode = '55000';
  end if;
  return jsonb_build_object('enabled', true, 'schedule_seconds', 120);
end
$$;
alter function private.configure_partner_assistant_scheduler(text, boolean) owner to postgres;

create function public.configure_partner_assistant_scheduler(p_worker_secret text, p_enabled boolean)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  return private.configure_partner_assistant_scheduler(p_worker_secret, p_enabled);
end
$$;
alter function public.configure_partner_assistant_scheduler(text, boolean) owner to postgres;

revoke all on function private.configure_partner_assistant_scheduler(text, boolean),
  public.configure_partner_assistant_scheduler(text, boolean) from public, anon, authenticated, service_role;
grant execute on function private.configure_partner_assistant_scheduler(text, boolean),
  public.configure_partner_assistant_scheduler(text, boolean) to service_role;

commit;
