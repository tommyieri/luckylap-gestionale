-- Finance e Controllo CEO: ogni membro attivo può presentare la password dell'area.
-- I grant per sessione, la loro durata e versione, i limiti dei tentativi e la
-- gestione delle credenziali continuano a usare le funzioni esistenti.
-- Nessuna password, membership, scorta o movimento viene modificato.
begin;
create or replace function private.sensitive_area_eligible(p_area text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.memberships m
  where m.user_id=(select auth.uid()) and m.active and p_area in('finance','audit')
 )
$$;
revoke all on function private.sensitive_area_eligible(text) from public,anon,authenticated,service_role;
commit;
