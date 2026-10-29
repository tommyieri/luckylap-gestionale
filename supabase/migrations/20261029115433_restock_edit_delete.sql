-- Eliminazione recuperabile dei riassortimenti. Le righe, gli arrivi e lo storico
-- restano disponibili; eliminare o ripristinare non muove merce né denaro.
begin;

alter table public.restock_orders
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(user_id),
  add column deletion_note text not null default '' check (char_length(deletion_note) <= 500),
  add constraint restock_orders_deletion_pair check ((deleted_at is null) = (deleted_by is null));
create index restock_orders_deleted_by on public.restock_orders (deleted_by);
comment on column public.restock_orders.deleted_at is
  'Eliminazione recuperabile dall’elenco operativo. Non annulla un arrivo e non cambia le scorte.';

create table public.restock_deletion_events (
  id uuid primary key,
  order_id uuid not null references public.restock_orders(id),
  deleted boolean not null,
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now()
);
create index restock_deletion_events_order on public.restock_deletion_events (order_id, created_at);
create index restock_deletion_events_creator on public.restock_deletion_events (created_by);
alter table public.restock_deletion_events enable row level security;
revoke all on public.restock_deletion_events from public, anon, authenticated, service_role;
grant select on public.restock_deletion_events to authenticated;
create policy restock_read on public.restock_deletion_events for select to authenticated
  using ((select private.is_member()));
create trigger restock_deletion_events_append_only before update or delete on public.restock_deletion_events
  for each row execute function private.reject_ledger_mutation();
create trigger audit_change after insert or update or delete on public.restock_deletion_events
  for each row execute function private.audit_change();

-- Tutti i comandi esistenti passano da questa riga bloccata. Il replay di una
-- ricevuta già registrata continua a restituire il risultato originario.
create or replace function private.restock_order_for_update(p_order uuid, p_expected bigint) returns public.restock_orders
language plpgsql security definer set search_path = '' as $$
declare v_order public.restock_orders%rowtype;
begin
  select * into v_order from public.restock_orders where id = p_order for update;
  if not found then raise exception 'restock_not_found' using errcode = '22023'; end if;
  if v_order.version <> p_expected then raise exception 'stale_version' using errcode = '22023'; end if;
  if v_order.deleted_at is not null then raise exception 'restock_deleted' using errcode = '22023'; end if;
  return v_order;
end
$$;

create function private.set_restock_deleted(p_operation_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_order_id uuid; v_expected bigint; v_deleted boolean; v_note text; v_canonical jsonb; v_replay jsonb;
  v_order public.restock_orders%rowtype; v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode = '42501'; end if;
  perform private.sale_object(p_payload, array['schema_version', 'order_id', 'expected_version', 'deleted', 'note'],
    array['schema_version', 'order_id', 'expected_version', 'deleted', 'note']);
  perform private.sale_integer(p_payload -> 'schema_version', 1, 1);
  v_order_id := private.consignment_uuid(p_payload -> 'order_id', false);
  v_expected := private.sale_integer(p_payload -> 'expected_version', 1, 9000000000000000);
  if jsonb_typeof(p_payload -> 'deleted') is distinct from 'boolean' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  v_deleted := (p_payload ->> 'deleted')::boolean;
  v_note := private.consignment_note(p_payload -> 'note', 500);
  if char_length(v_note) < 3 then raise exception 'invalid_payload' using errcode = '22023'; end if;
  v_canonical := jsonb_build_object('schema_version', 1, 'order_id', v_order_id, 'expected_version', v_expected,
    'deleted', v_deleted, 'note', v_note);
  v_replay := private.start_restock(p_operation_id, 'set_restock_deleted', v_canonical);
  if v_replay is not null then return v_replay; end if;

  -- Qui serve anche la riga eliminata per consentirne il ripristino. Lo stesso
  -- lock e la stessa versione serializzano eliminazione, ripristino e modifiche.
  select * into v_order from public.restock_orders where id = v_order_id for update;
  if not found then raise exception 'restock_not_found' using errcode = '22023'; end if;
  if v_order.version <> v_expected then raise exception 'stale_version' using errcode = '22023'; end if;
  if (v_order.deleted_at is not null) = v_deleted then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  update public.restock_orders
    set deleted_at = case when v_deleted then now() end,
      deleted_by = case when v_deleted then auth.uid() end,
      deletion_note = case when v_deleted then v_note else '' end,
      version = version + 1, updated_by = auth.uid(), updated_at = now()
    where id = v_order_id returning * into v_order;
  insert into public.restock_deletion_events(id, order_id, deleted, note, created_by)
    values (p_operation_id, v_order_id, v_deleted, v_note, auth.uid());
  v_result := jsonb_build_object('operation_id', p_operation_id, 'order_id', v_order_id,
    'state', v_order.state, 'version', v_order.version, 'deleted', v_deleted, 'replayed', false);
  return private.finish_restock(p_operation_id, 'set_restock_deleted', v_canonical, v_result);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'invalid_payload' using errcode = '22023';
end
$$;

create function public.set_restock_deleted(p_operation_id uuid, p_payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.set_restock_deleted(p_operation_id, p_payload)
$$;
revoke all on function private.set_restock_deleted(uuid, jsonb), public.set_restock_deleted(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.set_restock_deleted(uuid, jsonb), public.set_restock_deleted(uuid, jsonb)
  to authenticated;

-- I collegamenti già esistenti restano utilizzabili nel Conto vendita. Un
-- riassortimento eliminato non può generare un nuovo ordine collegato, neppure
-- richiamando direttamente la vecchia RPC. Il lock condiviso è compatibile con
-- il controllo esistente in save_consignment_order e serializza l’eliminazione.
create function private.restock_link_active() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_deleted_at timestamptz;
begin
  if new.restock_order_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.restock_order_id is not distinct from old.restock_order_id then return new; end if;
  select deleted_at into v_deleted_at from public.restock_orders where id = new.restock_order_id for share;
  if v_deleted_at is not null then raise exception 'restock_deleted' using errcode = '22023'; end if;
  return new;
end
$$;
revoke all on function private.restock_link_active() from public, anon, authenticated, service_role;
create trigger restock_link_active before insert or update of restock_order_id on public.consignment_orders
  for each row execute function private.restock_link_active();

commit;
