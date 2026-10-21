-- Team-declared packaging only. No sample materials, quantities or costs.
begin;
create table private.packaging_command_receipts (
  operation_id uuid primary key,
  command_kind text not null check(command_kind in ('create_packaging_material','initialize_packaging_count')),
  actor_id uuid not null references public.profiles(user_id),
  payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.packaging_command_receipts enable row level security;
revoke all on private.packaging_command_receipts from public,anon,authenticated;
create trigger packaging_receipts_append_only before update or delete on private.packaging_command_receipts
for each row execute function private.reject_ledger_mutation();

create function private.start_packaging_command(p_operation_id uuid,p_kind text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous private.packaging_command_receipts%rowtype; digest text;
begin
  if auth.uid() is null or not private.is_member() then raise exception 'membership_required' using errcode='42501'; end if;
  if p_operation_id is null then raise exception 'invalid_payload' using errcode='22023'; end if;
  digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packaging.'||p_operation_id::text,0));
  select * into previous from private.packaging_command_receipts where operation_id=p_operation_id;
  if found then
    if previous.actor_id<>auth.uid() or previous.command_kind<>p_kind or previous.payload_sha256<>digest then raise exception 'idempotency_conflict' using errcode='22023'; end if;
    return previous.result||'{"replayed":true}'::jsonb;
  end if;
  if not exists(select 1 from public.app_settings where id and stock_adjustments_enabled) then raise exception 'stock_mutations_disabled' using errcode='42501'; end if;
  return null;
end
$$;
create function private.finish_packaging_command(p_operation_id uuid,p_kind text,p_payload jsonb,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  insert into private.packaging_command_receipts(operation_id,command_kind,actor_id,payload_sha256,result)
    values(p_operation_id,p_kind,auth.uid(),encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),p_result);
  return p_result;
end
$$;

create function private.create_packaging_material(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_sku text;v_name text;v_type text;v_specs text;v_cost bigint;v_quantity bigint;v_location uuid;
  v_item uuid:=gen_random_uuid();v_movement uuid;v_normalized jsonb;v_replay jsonb;v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode='42501'; end if;
  perform private.sale_object(p_payload,array['schema_version','sku','name','packaging_type','specifications','unit_cost_cents','location_id','initial_quantity'],array['schema_version','sku','name','packaging_type','specifications','unit_cost_cents','location_id','initial_quantity']);
  perform private.sale_integer(p_payload->'schema_version',1,1);
  if jsonb_typeof(p_payload->'sku') is distinct from 'string' or jsonb_typeof(p_payload->'name') is distinct from 'string'
    or jsonb_typeof(p_payload->'packaging_type') is distinct from 'string' or jsonb_typeof(p_payload->'location_id') is distinct from 'string'
    or jsonb_typeof(p_payload->'specifications') not in ('string','null') then raise exception 'invalid_payload' using errcode='22023'; end if;
  v_sku:=btrim(p_payload->>'sku');v_name:=btrim(p_payload->>'name');v_type:=p_payload->>'packaging_type';v_specs:=nullif(btrim(p_payload->>'specifications'),'');
  v_location:=(p_payload->>'location_id')::uuid;
  if char_length(v_sku) not between 1 and 120 or char_length(v_name) not between 1 and 240 or v_type not in ('box','sticker','other') or char_length(v_specs)>2000 then raise exception 'invalid_payload' using errcode='22023'; end if;
  if jsonb_typeof(p_payload->'unit_cost_cents')<>'null' then v_cost:=private.sale_integer(p_payload->'unit_cost_cents',0,999999999999);end if;
  if jsonb_typeof(p_payload->'initial_quantity')<>'null' then v_quantity:=private.sale_integer(p_payload->'initial_quantity',0,1000000000);end if;
  v_normalized:=jsonb_build_object('schema_version',1,'sku',v_sku,'name',v_name,'packaging_type',v_type,'specifications',v_specs,'unit_cost_cents',v_cost,'location_id',v_location,'initial_quantity',v_quantity);
  v_replay:=private.start_packaging_command(p_operation_id,'create_packaging_material',v_normalized);if v_replay is not null then return v_replay;end if;
  perform 1 from public.stock_locations where id=v_location and active for share;
  if not found then raise exception 'invalid_location' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.packaging.sku.'||v_sku,0));
  if exists(select 1 from public.stock_items where sku=v_sku) then raise exception 'sku_already_exists' using errcode='23505';end if;
  insert into public.stock_items(id,kind,sku,name,unit_cost_eur,source)
    values(v_item,'packaging',v_sku,v_name,v_cost::numeric/100,jsonb_build_object('entry_method','team_declared_packaging'));
  insert into public.packaging_items(stock_item_id,packaging_type,specifications)values(v_item,v_type,v_specs);
  -- NULL explicitly preserves an uncounted material; no opening zero is guessed.
  insert into public.stock_balances(stock_item_id,location_id,quantity)values(v_item,v_location,null);
  if v_quantity is not null then
    insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)
      values(gen_random_uuid(),v_item,v_location,'opening',v_quantity,'Conta iniziale packaging dichiarata',jsonb_build_object('packaging_operation_id',p_operation_id),auth.uid()) returning id into v_movement;
  end if;
  v_result:=jsonb_build_object('operation_id',p_operation_id,'stock_item_id',v_item,'movement_id',v_movement,'replayed',false);
  return private.finish_packaging_command(p_operation_id,'create_packaging_material',v_normalized,v_result);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_payload' using errcode='22023';
end
$$;

create function private.initialize_packaging_count(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_item uuid;v_location uuid;v_quantity bigint;v_reason text;v_previous bigint;v_movement uuid;v_normalized jsonb;v_replay jsonb;v_result jsonb;
begin
  if not private.is_member() then raise exception 'membership_required' using errcode='42501';end if;
  perform private.sale_object(p_payload,array['schema_version','stock_item_id','location_id','quantity','reason'],array['schema_version','stock_item_id','location_id','quantity','reason']);
  perform private.sale_integer(p_payload->'schema_version',1,1);
  if jsonb_typeof(p_payload->'stock_item_id') is distinct from 'string' or jsonb_typeof(p_payload->'location_id') is distinct from 'string' or jsonb_typeof(p_payload->'reason') is distinct from 'string' then raise exception 'invalid_payload' using errcode='22023';end if;
  v_item:=(p_payload->>'stock_item_id')::uuid;v_location:=(p_payload->>'location_id')::uuid;
  v_quantity:=private.sale_integer(p_payload->'quantity',0,1000000000);v_reason:=btrim(p_payload->>'reason');
  if char_length(v_reason) not between 3 and 500 then raise exception 'invalid_payload' using errcode='22023';end if;
  v_normalized:=jsonb_build_object('schema_version',1,'stock_item_id',v_item,'location_id',v_location,'quantity',v_quantity,'reason',v_reason);
  v_replay:=private.start_packaging_command(p_operation_id,'initialize_packaging_count',v_normalized);if v_replay is not null then return v_replay;end if;
  perform s.id from public.stock_items s join public.packaging_items p on p.stock_item_id=s.id where s.id=v_item and s.kind='packaging' and s.active for share of s;
  if not found then raise exception 'unknown_packaging' using errcode='22023';end if;
  perform 1 from public.stock_locations where id=v_location and active for share;
  if not found then raise exception 'invalid_location' using errcode='22023';end if;
  insert into public.stock_balances(stock_item_id,location_id,quantity)values(v_item,v_location,null) on conflict(stock_item_id,location_id)do nothing;
  select quantity into v_previous from public.stock_balances where stock_item_id=v_item and location_id=v_location for update;
  if v_previous is not null then raise exception 'known_stock' using errcode='22023';end if;
  insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason,source,actor_id)
    values(gen_random_uuid(),v_item,v_location,'opening',v_quantity,v_reason,jsonb_build_object('packaging_operation_id',p_operation_id),auth.uid())returning id into v_movement;
  v_result:=jsonb_build_object('operation_id',p_operation_id,'stock_item_id',v_item,'movement_id',v_movement,'replayed',false);
  return private.finish_packaging_command(p_operation_id,'initialize_packaging_count',v_normalized,v_result);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'invalid_payload' using errcode='22023';
end
$$;

create function public.create_packaging_material(p_operation_id uuid,p_payload jsonb)returns jsonb
language sql security invoker set search_path='' as $$select private.create_packaging_material(p_operation_id,p_payload)$$;
create function public.initialize_packaging_count(p_operation_id uuid,p_payload jsonb)returns jsonb
language sql security invoker set search_path='' as $$select private.initialize_packaging_count(p_operation_id,p_payload)$$;
revoke all on function private.start_packaging_command(uuid,text,jsonb),private.finish_packaging_command(uuid,text,jsonb,jsonb),private.create_packaging_material(uuid,jsonb),private.initialize_packaging_count(uuid,jsonb)from public,anon,authenticated;
grant execute on function private.create_packaging_material(uuid,jsonb),private.initialize_packaging_count(uuid,jsonb)to authenticated;
revoke all on function public.create_packaging_material(uuid,jsonb),public.initialize_packaging_count(uuid,jsonb)from public,anon,authenticated;
grant execute on function public.create_packaging_material(uuid,jsonb),public.initialize_packaging_count(uuid,jsonb)to authenticated;
commit;
