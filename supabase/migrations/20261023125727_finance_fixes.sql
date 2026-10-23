-- Finance: incassi delle vendite e rimborsi Shopify non si eliminano da Finance
-- (spec 04 B.1, B.2 passo 7). Si correggono e si ripristinano come prima; una
-- vendita sbagliata si annulla in Vendite («Annulla registrazione» o «Registra reso»).
-- Solo la funzione del comando cambia: nessuna tabella, riga o vincolo toccato.
-- L'annullamento di una registrazione (20261023121917) scrive le sue revisioni
-- direttamente e non passa da questo comando: resta invariato.
begin;

create or replace function private.revise_finance_movement(p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<revision_command>>
declare kind text; source_id uuid; expected integer; action text; reason text; target integer; normalized jsonb; v jsonb; original jsonb; parent uuid; sale_parent uuid;
  latest public.finance_movement_revisions%rowtype; receipt private.finance_revision_receipts%rowtype; current_version integer; is_deleted boolean; new_id uuid; result jsonb; digest text;
begin
  if auth.uid() is null or not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' or not(p_payload?&array['schema_version','source_kind','source_id','expected_version','action','reason'])
    or p_payload->'schema_version' is distinct from '1'::jsonb or jsonb_typeof(p_payload->'source_kind') is distinct from 'string'
    or p_payload->>'source_kind' not in('budgetflow','manual','payment','refund','consignment_settlement') or jsonb_typeof(p_payload->'source_id') is distinct from 'string'
    or jsonb_typeof(p_payload->'expected_version') is distinct from 'number' or (p_payload->>'expected_version')!~'^[0-9]{1,10}$'
    or jsonb_typeof(p_payload->'action') is distinct from 'string' or p_payload->>'action' not in('update','delete','restore') or jsonb_typeof(p_payload->'reason') is distinct from 'string' then
    raise exception 'invalid_finance_revision' using errcode='22023';end if;
  kind:=p_payload->>'source_kind';source_id:=(p_payload->>'source_id')::uuid;expected:=(p_payload->>'expected_version')::integer;action:=p_payload->>'action';reason:=btrim(p_payload->>'reason');
  if source_id is null or expected not between 0 and 2147483645 or char_length(reason) not between 3 and 500 then raise exception 'invalid_finance_revision' using errcode='22023';end if;
  normalized:=jsonb_build_object('schema_version',1,'source_kind',kind,'source_id',source_id,'expected_version',expected,'action',action,'reason',reason);
  if action='update' then
    if not(p_payload?'values') or p_payload-array['schema_version','source_kind','source_id','expected_version','action','reason','values']<>'{}'::jsonb then raise exception 'invalid_finance_revision' using errcode='22023';end if;
    v:=private.finance_revision_values(kind,p_payload->'values');normalized:=normalized||jsonb_build_object('values',v);
  elsif action='restore' then
    if jsonb_typeof(p_payload->'restore_version') is distinct from 'number' or (p_payload->>'restore_version')!~'^[0-9]{1,10}$'
      or p_payload-array['schema_version','source_kind','source_id','expected_version','action','reason','restore_version']<>'{}'::jsonb then raise exception 'invalid_finance_revision' using errcode='22023';end if;
    target:=(p_payload->>'restore_version')::integer;if target<0 or target>expected then raise exception 'invalid_finance_revision' using errcode='22023';end if;
    normalized:=normalized||jsonb_build_object('restore_version',target);
  elsif p_payload-array['schema_version','source_kind','source_id','expected_version','action','reason']<>'{}'::jsonb then raise exception 'invalid_finance_revision' using errcode='22023';end if;
  digest:=encode(sha256(convert_to(normalized::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.finance.revision.operation.'||p_operation_id::text,0));
  if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  -- A receipt written before this rule still replays its recorded outcome.
  select * into receipt from private.finance_revision_receipts where operation_id=p_operation_id;
  if found then
    if receipt.actor_id<>auth.uid() or receipt.payload_sha256<>digest then raise exception 'idempotency_conflict' using errcode='22023';end if;
    return receipt.result||'{"replayed":true}'::jsonb;
  end if;
  original:=private.finance_revision_original(kind,source_id);parent:=(original->>'order_id')::uuid;
  -- All payment edits and new residual payments take the same aggregate lock.
  if parent is not null then perform 1 from public.sales_orders where id=parent for update;
  elsif kind='manual' then perform 1 from public.finance_entries where id=source_id for update;
  elsif kind='consignment_settlement' then
    select sale_id into sale_parent from public.consignment_settlements s where s.id=source_id;
    perform 1 from public.consignment_sales where id=sale_parent for update;end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.finance.revision.source.'||kind||'.'||source_id::text,0));
  original:=private.finance_revision_original(kind,source_id);
  select * into latest from public.finance_movement_revisions r where r.source_kind=kind and r.source_id=revision_command.source_id order by version desc limit 1;
  current_version:=coalesce(latest.version,0);is_deleted:=coalesce(latest.deleted,(original->>'deleted')::boolean);
  if current_version<>expected then raise exception 'finance_revision_conflict' using errcode='22023';end if;
  if action='update' and is_deleted then raise exception 'finance_movement_deleted' using errcode='22023';end if;
  if action='delete' then
    -- Sale payments and Shopify refunds belong to the sale: correct them here,
    -- undo the sale in Vendite. Restore stays available, so nothing gets stuck.
    if kind in('payment','refund') then raise exception 'finance_movement_delete_not_allowed' using errcode='22023';end if;
    if is_deleted then raise exception 'finance_movement_deleted' using errcode='22023';end if;
    v:=coalesce(latest.value_snapshot,original->'values');
  elsif action='restore' then
    if target=0 then v:=original->'values';else select value_snapshot into v from public.finance_movement_revisions r where r.source_kind=kind and r.source_id=revision_command.source_id and version=target;end if;
    if v is null then raise exception 'finance_restore_not_found' using errcode='22023';end if;
  end if;
  if not private.finance_revision_live_access() then raise exception 'finance_access_required' using errcode='42501';end if;
  insert into public.finance_movement_revisions(operation_id,source_kind,source_id,version,previous_version,action,restored_from_version,value_snapshot,deleted,reason,created_by)
    values(p_operation_id,kind,source_id,current_version+1,current_version,action,target,v,action='delete',reason,auth.uid()) returning id into new_id;
  if parent is not null then
    perform private.effective_order_payment_summary(parent);
    -- Canonical Shopify payment_state remains a source observation. Effective
    -- internal values are supplied by the common read projection instead.
    if exists(select 1 from public.sales_orders where id=parent and source_kind='manual_declaration') then perform private.refresh_sale_order(parent);end if;
  end if;
  if sale_parent is not null then perform private.effective_consignment_settlement_summary(sale_parent);end if;
  result:=jsonb_build_object('operation_id',p_operation_id,'source_kind',kind,'source_id',source_id,'revision_id',new_id,'version',current_version+1,'replayed',false);
  insert into private.finance_revision_receipts(operation_id,actor_id,payload_sha256,result) values(p_operation_id,auth.uid(),digest,result);
  return result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'invalid_finance_revision' using errcode='22023';
end $$;

revoke all on function private.revise_finance_movement(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.revise_finance_movement(uuid,jsonb) to authenticated;
revoke all on function public.revise_finance_movement(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.revise_finance_movement(uuid,jsonb) to authenticated;

commit;
