begin;

create table public.finance_budgets (
  month date not null check (extract(day from month) = 1 and month between date '0001-01-01' and date '9999-12-01'),
  category text not null check (category = btrim(category) and char_length(category) <= 240),
  limit_cents bigint not null check (limit_cents between 0 and 99999999999999),
  revision uuid not null default gen_random_uuid(),
  primary key (month, category)
);

alter table public.finance_budgets enable row level security;
revoke all on public.finance_budgets from public, anon, authenticated;
grant select on public.finance_budgets to authenticated;
create policy finance_budgets_read on public.finance_budgets for select to authenticated
  using ((select private.can_finance()));

-- Empty category is the overall monthly limit. Individual categories remain separate.
create function private.save_finance_budget(
  p_month date, p_category text, p_limit_cents bigint, p_revision uuid, p_actor_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  changed integer;
  current_limit bigint;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor_id or not private.can_finance() then
    raise exception 'finance_access_required' using errcode = '42501';
  end if;
  if p_month is null or extract(day from p_month) <> 1
    or p_month not between date '0001-01-01' and date '9999-12-01'
    or p_category is null or p_category <> btrim(p_category) or char_length(p_category) > 240
    or (p_limit_cents is not null and p_limit_cents not between 0 and 99999999999999) then
    raise exception 'invalid_finance_budget' using errcode = '22023';
  end if;

  if p_limit_cents is null then
    delete from public.finance_budgets
      where month = p_month and category = p_category and revision = p_revision;
  elsif p_revision is null then
    insert into public.finance_budgets (month, category, limit_cents)
      values (p_month, p_category, p_limit_cents)
      on conflict (month, category) do nothing;
  else
    update public.finance_budgets set limit_cents = p_limit_cents, revision = gen_random_uuid()
      where month = p_month and category = p_category and revision = p_revision;
  end if;
  get diagnostics changed = row_count;
  if changed = 1 then return; end if;

  -- An identical retry after a lost response succeeds on the existing value.
  select limit_cents into current_limit from public.finance_budgets
    where month = p_month and category = p_category;
  if current_limit is distinct from p_limit_cents then
    raise exception 'finance_budget_changed' using errcode = '40001';
  end if;
end
$$;

create function public.save_finance_budget(
  p_month date, p_category text, p_limit_cents bigint, p_revision uuid, p_actor_id uuid
) returns void language sql security invoker set search_path = '' as $$
  select private.save_finance_budget(p_month, p_category, p_limit_cents, p_revision, p_actor_id)
$$;

revoke all on function private.save_finance_budget(date, text, bigint, uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_finance_budget(date, text, bigint, uuid, uuid) from public, anon, authenticated;
grant execute on function private.save_finance_budget(date, text, bigint, uuid, uuid) to authenticated;
grant execute on function public.save_finance_budget(date, text, bigint, uuid, uuid) to authenticated;

commit;
