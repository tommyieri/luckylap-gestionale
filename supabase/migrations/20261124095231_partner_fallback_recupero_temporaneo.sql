-- Recupero temporaneo: nessun fallback mentre non esistono attestazioni.
-- Si conserva il percorso eventi e si elimina il catalogo dalle letture UI e claim.
begin;

lock table private.partner_event_exhaustion_checks in share mode;
do $$
begin
 if exists(select 1 from private.partner_event_exhaustion_checks) then
   raise exception 'partner_event_fallback_recovery_requires_empty_history' using errcode='55000';
 end if;
end
$$;

create or replace function private.partner_event_fallback_check(p_at timestamptz) returns bigint
language sql stable security invoker set search_path='' as $$
 select null::bigint
$$;

commit;
