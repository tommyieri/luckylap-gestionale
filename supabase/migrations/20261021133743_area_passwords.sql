-- Shared area passwords supplement individual account/membership identity.
-- No password or credential hash is seeded or exposed by this migration.
begin;

do $$ begin
  if to_regprocedure('extensions.crypt(text,text)') is null or to_regprocedure('extensions.gen_salt(text,integer)') is null then
    raise exception 'pgcrypto_in_extensions_required';
  end if;
end $$;

create table private.sensitive_area_credentials (
  area text primary key check (area in ('finance','audit')),
  password_hash text not null check (password_hash ~ '^\$2a\$10\$[./A-Za-z0-9]{53}$'),
  version uuid not null default gen_random_uuid(),
  rotated_at timestamptz not null default clock_timestamp()
);
create table private.area_grants (
  session_id uuid not null,
  user_id uuid not null references public.profiles(user_id),
  area text not null references private.sensitive_area_credentials(area),
  credential_version uuid not null,
  expires_at timestamptz not null check (isfinite(expires_at)),
  primary key (session_id,user_id,area)
);
create index area_grants_user on private.area_grants(user_id,area);
create index area_grants_area on private.area_grants(area);
create table private.area_password_attempts (
  user_id uuid not null references public.profiles(user_id),
  area text not null references private.sensitive_area_credentials(area),
  window_started_at timestamptz not null,
  failed_count smallint not null default 0 check (failed_count between 0 and 5),
  locked_until timestamptz,
  primary key (user_id,area)
);
create index area_password_attempts_area on private.area_password_attempts(area);
alter table private.sensitive_area_credentials enable row level security;
alter table private.area_grants enable row level security;
alter table private.area_password_attempts enable row level security;
revoke all on private.sensitive_area_credentials,private.area_grants,private.area_password_attempts from public,anon,authenticated,service_role;

create function private.sensitive_area_eligible(p_area text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (select 1 from public.memberships m where m.user_id=(select auth.uid()) and m.active and
    ((p_area='finance' and (m.role='founder' or (m.role in ('production','finance') and m.finance_access)))
      or (p_area='audit' and m.role='founder')))
$$;
create function private.current_auth_session_id() returns uuid
language sql stable security definer set search_path='' as $$
  select s.id from auth.sessions s
  where s.id=case when (auth.jwt()->>'session_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (auth.jwt()->>'session_id')::uuid else null end
    and s.user_id=(select auth.uid()) and (s.not_after is null or s.not_after>statement_timestamp())
$$;
create function private.sensitive_area_status(p_area text) returns boolean
language sql stable security definer set search_path='' as $$
  select private.sensitive_area_eligible(p_area) and exists (
    select 1 from private.area_grants g join private.sensitive_area_credentials c on c.area=g.area and c.version=g.credential_version
    where g.session_id=private.current_auth_session_id() and g.user_id=(select auth.uid()) and g.area=p_area and g.expires_at>statement_timestamp()
  )
$$;

create function private.unlock_sensitive_area(p_area text,p_password text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); session uuid:=private.current_auth_session_id(); credential private.sensitive_area_credentials%rowtype;
  attempts private.area_password_attempts%rowtype; at_time timestamptz; expiry timestamptz; accepted boolean:=false;
begin
  if actor is null or session is null or not private.sensitive_area_eligible(p_area) then
    return jsonb_build_object('status','denied','expires_at',null);
  end if;
  -- Lock ordering: credential then user/area counter. Rotation takes the same
  -- credential lock before deleting grants/counters, so an old version cannot
  -- reappear as a valid grant after rotation commits.
  select * into credential from private.sensitive_area_credentials where area=p_area for share;
  if not found then return jsonb_build_object('status','denied','expires_at',null); end if;
  insert into private.area_password_attempts(user_id,area,window_started_at) values(actor,p_area,clock_timestamp()) on conflict(user_id,area) do nothing;
  select * into strict attempts from private.area_password_attempts where user_id=actor and area=p_area for update;
  at_time:=clock_timestamp();
  if attempts.locked_until>at_time then
    return jsonb_build_object('status','locked','expires_at',attempts.locked_until);
  end if;
  if attempts.locked_until is not null or attempts.window_started_at<=at_time-interval '15 minutes' then
    attempts.failed_count:=0; attempts.window_started_at:=at_time; attempts.locked_until:=null;
  end if;
  if p_password is not null and octet_length(convert_to(p_password,'UTF8')) between 6 and 72 then
    accepted:=extensions.crypt(p_password,credential.password_hash)=credential.password_hash;
  end if;
  if accepted then
    expiry:=clock_timestamp()+interval '8 hours';
    insert into private.area_grants(session_id,user_id,area,credential_version,expires_at)
      values(session,actor,p_area,credential.version,expiry)
      on conflict(session_id,user_id,area) do update set credential_version=excluded.credential_version,expires_at=excluded.expires_at;
    update private.area_password_attempts set failed_count=0,window_started_at=at_time,locked_until=null where user_id=actor and area=p_area;
    return jsonb_build_object('status','unlocked','expires_at',expiry);
  end if;
  attempts.failed_count:=attempts.failed_count+1;
  if attempts.failed_count>=5 then attempts.locked_until:=at_time+interval '15 minutes'; end if;
  update private.area_password_attempts set failed_count=attempts.failed_count,window_started_at=attempts.window_started_at,locked_until=attempts.locked_until
    where user_id=actor and area=p_area;
  -- Return instead of RAISE: the caller commits the failed-attempt counter.
  return jsonb_build_object('status',case when attempts.locked_until is null then 'denied' else 'locked' end,'expires_at',attempts.locked_until);
end
$$;
create function private.lock_sensitive_area(p_area text) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); session uuid:=private.current_auth_session_id();
begin
  if actor is null or session is null or not private.sensitive_area_eligible(p_area) then return false; end if;
  delete from private.area_grants where user_id=actor and session_id=session and area=p_area;
  return true;
end
$$;
create function private.configure_sensitive_password(p_area text,p_password text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' or current_setting('role',true)<>'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  if p_area is null or p_area not in ('finance','audit') or p_password is null or octet_length(convert_to(p_password,'UTF8')) not between 6 and 72 then
    raise exception 'invalid_area_password_configuration' using errcode='22023';
  end if;
  insert into private.sensitive_area_credentials(area,password_hash,version,rotated_at)
    values(p_area,extensions.crypt(p_password,extensions.gen_salt('bf',10)),gen_random_uuid(),clock_timestamp())
    on conflict(area) do update set password_hash=excluded.password_hash,version=excluded.version,rotated_at=excluded.rotated_at;
  delete from private.area_grants where area=p_area;
  delete from private.area_password_attempts where area=p_area;
  return true;
end
$$;

create function public.sensitive_area_status(p_area text) returns boolean
language sql stable security invoker set search_path='' as $$ select private.sensitive_area_status(p_area) $$;
create function public.unlock_sensitive_area(p_area text,p_password text) returns jsonb
language sql security invoker set search_path='' as $$ select private.unlock_sensitive_area(p_area,p_password) $$;
create function public.lock_sensitive_area(p_area text) returns boolean
language sql security invoker set search_path='' as $$ select private.lock_sensitive_area(p_area) $$;
create function public.configure_sensitive_password(p_area text,p_password text) returns boolean
language sql security invoker set search_path='' as $$ select private.configure_sensitive_password(p_area,p_password) $$;

-- Existing Finance/audit policies and RPCs keep using these helpers. Access now
-- requires the current session's password grant and current DB membership.
create or replace function private.can_finance() returns boolean
language sql stable security definer set search_path='' as $$ select private.sensitive_area_status('finance') $$;
create or replace function private.can_audit() returns boolean
language sql stable security definer set search_path='' as $$ select private.sensitive_area_status('audit') $$;

revoke all on function private.sensitive_area_eligible(text),private.current_auth_session_id(),private.sensitive_area_status(text),
  private.unlock_sensitive_area(text,text),private.lock_sensitive_area(text),private.configure_sensitive_password(text,text) from public,anon,authenticated,service_role;
grant execute on function private.sensitive_area_status(text),private.unlock_sensitive_area(text,text),private.lock_sensitive_area(text) to authenticated;
grant usage on schema private to service_role;
grant execute on function private.configure_sensitive_password(text,text) to service_role;
revoke all on function public.sensitive_area_status(text),public.unlock_sensitive_area(text,text),public.lock_sensitive_area(text),public.configure_sensitive_password(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.sensitive_area_status(text),public.unlock_sensitive_area(text,text),public.lock_sensitive_area(text) to authenticated;
grant execute on function public.configure_sensitive_password(text,text) to service_role;
revoke all on function private.can_finance(),private.can_audit() from public,anon,service_role;
grant execute on function private.can_finance(),private.can_audit() to authenticated;
commit;
