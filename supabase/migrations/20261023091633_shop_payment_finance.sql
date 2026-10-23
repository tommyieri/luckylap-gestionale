-- Canonical P3 payment extension: one amount, version, CAS and append-only history.
-- Optional Finance metadata never creates a second money ledger. Old commands
-- and their stored receipt hashes retain the exact original canonical payload.
begin;
alter table public.consignment_report_payments
 drop constraint consignment_report_payments_amount_cents_check,
 add constraint consignment_report_payments_amount_cents_check check(amount_cents between 0 and 9000000000000000),
 add column finance_direction text not null default 'income' check(finance_direction in('income','expense')),
 add column finance_category text default 'Vendite' check(finance_category is null or(char_length(finance_category)between 1 and 240 and finance_category=btrim(finance_category))),
 add column finance_description text not null default 'Incasso conto vendita' check(char_length(finance_description)<=2000),
 add column finance_pending boolean not null default false;

-- can_finance retains the existing role/password/session policy. Its area
-- lifetime uses statement time; the extra clock check rejects expiry during
-- a real lock wait without changing the shared area's established behavior.
create function private.shop_payment_finance_access()returns boolean
language sql volatile security invoker set search_path=''as $$
 select auth.uid()is not null and private.can_finance()and exists(
  select 1 from private.area_grants g join private.sensitive_area_credentials c on c.area=g.area and c.version=g.credential_version
  join auth.sessions s on s.id=g.session_id and s.user_id=g.user_id
  where g.user_id=auth.uid()and g.session_id=private.current_auth_session_id()and g.area='finance'
  and g.expires_at>clock_timestamp()and(s.not_after is null or s.not_after>clock_timestamp()))
$$;

create function private.consignment_payment_finance_metadata(p_value jsonb)returns jsonb
language plpgsql immutable security invoker set search_path=''as $$
declare direction text;category text;description text;pending boolean;
begin
 perform private.sale_object(p_value,array['direction','category','description','pending'],array['direction','category','description','pending']);
 direction:=private.consignment_text(p_value->'direction',1,10);
 if direction not in('income','expense')then raise exception'invalid_payload'using errcode='22023';end if;
 category:=private.consignment_optional_text(p_value->'category',1,240);
 description:=private.consignment_note(p_value->'description',2000);
 pending:=private.consignment_boolean(p_value->'pending');
 return jsonb_build_object('direction',direction,'category',category,'description',description,'pending',pending);
end$$;
create function private.consignment_payment_finance_date(p_value jsonb)returns timestamptz
language plpgsql stable security invoker set search_path=''as $$
declare value timestamptz;
begin
 if jsonb_typeof(p_value)is distinct from'string'or(p_value#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T.+(Z|[+-][0-9]{2}:[0-9]{2})$'then raise exception'invalid_date'using errcode='22023';end if;
 value:=(p_value#>>'{}')::timestamptz;
 if not isfinite(value)or(value at time zone'Europe/Rome')::date not between date'2000-01-01'and date'2100-12-31'then raise exception'invalid_date'using errcode='22023';end if;
 return value;
exception when invalid_datetime_format or datetime_field_overflow then raise exception'invalid_date'using errcode='22023';
end$$;
create function private.consignment_posted_payment_net(p_report uuid,p_exclude uuid default null)returns numeric
language sql stable security invoker set search_path=''as $$
 select coalesce(sum(case when finance_direction='expense'then-amount_cents else amount_cents end),0)
 from public.consignment_report_payments where report_id=p_report and(p_exclude is null or id<>p_exclude)
 and not voided and not finance_pending and(paid_at at time zone'Europe/Rome')::date<=(statement_timestamp()at time zone'Europe/Rome')::date
$$;
create function private.consignment_effective_payment_state(p_report uuid)returns text
language sql stable security invoker set search_path=''as $$
 select case when n=0 and r.brand_cents=0 then'nothing_due'when n<=0 then'unpaid'when n<r.brand_cents then'partial'when n=r.brand_cents then'paid'else'overpaid'end
 from public.consignment_reports r cross join lateral(select private.consignment_posted_payment_net(r.id)n)s where r.id=p_report
$$;
create function private.consignment_payment_net_bounds(p_report uuid)returns void
language plpgsql stable security invoker set search_path=''as $$
declare net numeric;due bigint;
begin
 select brand_cents into strict due from public.consignment_reports where id=p_report;
 net:=private.consignment_posted_payment_net(p_report);
 if greatest(abs(net),greatest(0,due-net),greatest(0,net-due))>9000000000000000 then raise exception'effective_payment_limit'using errcode='22023';end if;
end$$;
create or replace function private.consignment_refresh_payment_state(p_report uuid)returns text
language plpgsql security definer set search_path=''as $$
declare state text;
begin
 perform private.consignment_payment_net_bounds(p_report);
 state:=private.consignment_effective_payment_state(p_report);
 update public.consignment_reports set payment_state=state where id=p_report and payment_state<>state;
 return state;
end$$;
create or replace function private.consignment_payment_snapshot(p_payment uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('report_id',p.report_id,'amount_cents',p.amount_cents,'paid_at',p.paid_at,'method',p.method,'account_label',p.account_label,'reference',p.reference,'voided',p.voided,
 'finance',jsonb_build_object('direction',p.finance_direction,'category',p.finance_category,'description',p.finance_description,'pending',p.finance_pending))from public.consignment_report_payments p where p.id=p_payment
$$;

create or replace function private.record_consignment_payment(p_operation_id uuid,p_payload jsonb)returns jsonb
language plpgsql security definer set search_path=''set timezone='UTC'as $$
declare v_report_id uuid;v_amount bigint;v_paid_at timestamptz;v_method text;v_account text;v_reference text;v_canonical jsonb;v_replay jsonb;v_location uuid;v_report public.consignment_reports%rowtype;v_paid numeric;v_result jsonb;
begin
 if not private.shop_payment_finance_access()then raise exception'finance_access_required'using errcode='42501';end if;
 perform private.sale_object(p_payload,array['schema_version','report_id','amount_cents','paid_at','method','account_label','reference'],array['schema_version','report_id','amount_cents','paid_at','method','account_label','reference']);
 perform private.sale_integer(p_payload->'schema_version',1,1);
 v_report_id:=private.consignment_uuid(p_payload->'report_id',false);v_amount:=private.sale_integer(p_payload->'amount_cents',1,9000000000000000);v_paid_at:=private.consignment_date(p_payload->'paid_at');
 v_method:=private.consignment_text(p_payload->'method',1,20);if v_method not in('bank_transfer','cash','other')then raise exception'invalid_payload'using errcode='22023';end if;
 v_account:=private.consignment_optional_text(p_payload->'account_label',1,120);v_reference:=private.consignment_optional_text(p_payload->'reference',1,240);
 v_canonical:=jsonb_build_object('schema_version',1,'report_id',v_report_id,'amount_cents',v_amount,'paid_at',v_paid_at,'method',v_method,'account_label',v_account,'reference',v_reference);
 v_replay:=private.start_consignment(p_operation_id,'record_consignment_payment',v_canonical);if not private.shop_payment_finance_access()then raise exception'finance_access_required'using errcode='42501';end if;if v_replay is not null then return v_replay;end if;
 select location_id into v_location from public.consignment_reports where id=v_report_id;if not found then raise exception'report_not_found'using errcode='22023';end if;
 perform private.consignment_shop_for_update(v_location,false);select * into v_report from public.consignment_reports where id=v_report_id for update;
 if v_paid_at<(v_report.period_month::timestamp at time zone'Europe/Rome')then raise exception'invalid_date'using errcode='22023';end if;
 v_paid:=private.consignment_posted_payment_net(v_report_id);
 if v_paid+v_amount>v_report.brand_cents then raise exception'payment_exceeds_invoice'using errcode='22023';end if;
 if not private.shop_payment_finance_access()then raise exception'finance_access_required'using errcode='42501';end if;
 insert into public.consignment_report_payments(id,report_id,location_id,amount_cents,paid_at,method,account_label,reference,created_by,updated_by)values(p_operation_id,v_report_id,v_location,v_amount,v_paid_at,v_method,v_account,v_reference,auth.uid(),auth.uid());
 insert into public.consignment_payment_revisions(id,payment_id,location_id,version,reason,snapshot,created_by)values(p_operation_id,p_operation_id,v_location,1,null,private.consignment_payment_snapshot(p_operation_id),auth.uid());
 perform private.consignment_refresh_payment_state(v_report_id);
 v_result:=jsonb_build_object('operation_id',p_operation_id,'payment_id',p_operation_id,'report_id',v_report_id,'replayed',false);
 if not private.shop_payment_finance_access()then raise exception'finance_access_required'using errcode='42501';end if;
 return private.finish_consignment(p_operation_id,'record_consignment_payment',v_canonical,v_result);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception'invalid_payload'using errcode='22023';
end$$;

create or replace function private.update_consignment_payment(p_operation_id uuid,p_payload jsonb)returns jsonb
language plpgsql security definer set search_path=''set timezone='UTC'as $$
declare v_payment_id uuid;v_expected bigint;v_amount bigint;v_paid_at timestamptz;v_method text;v_account text;v_reference text;v_voided boolean;v_reason text;v_canonical jsonb;v_replay jsonb;v_report_id uuid;v_location uuid;
 v_report public.consignment_reports%rowtype;v_payment public.consignment_report_payments%rowtype;v_paid numeric;v_before numeric;v_candidate numeric;v_result jsonb;v_finance jsonb;v_has_finance boolean:=p_payload?'finance';
begin
 if not private.shop_payment_finance_access()then raise exception'finance_access_required'using errcode='42501';end if;
 perform private.sale_object(p_payload,array['schema_version','payment_id','expected_version','amount_cents','paid_at','method','account_label','reference','voided','reason'],array['schema_version','payment_id','expected_version','amount_cents','paid_at','method','account_label','reference','voided','reason','finance']);
 perform private.sale_integer(p_payload->'schema_version',1,1);v_payment_id:=private.consignment_uuid(p_payload->'payment_id',false);v_expected:=private.sale_integer(p_payload->'expected_version',1,9000000000000000);
 v_amount:=private.sale_integer(p_payload->'amount_cents',case when v_has_finance then 0 else 1 end,9000000000000000);v_paid_at:=private.consignment_payment_finance_date(p_payload->'paid_at');
 v_method:=private.consignment_text(p_payload->'method',1,20);if v_method not in('bank_transfer','cash','other')then raise exception'invalid_payload'using errcode='22023';end if;
 v_account:=private.consignment_optional_text(p_payload->'account_label',1,120);v_reference:=private.consignment_optional_text(p_payload->'reference',1,240);v_voided:=private.consignment_boolean(p_payload->'voided');v_reason:=private.consignment_text(p_payload->'reason',3,500);
 if v_has_finance then v_finance:=private.consignment_payment_finance_metadata(p_payload->'finance');end if;
 v_canonical:=jsonb_build_object('schema_version',1,'payment_id',v_payment_id,'expected_version',v_expected,'amount_cents',v_amount,'paid_at',v_paid_at,'method',v_method,'account_label',v_account,'reference',v_reference,'voided',v_voided,'reason',v_reason);
 if v_has_finance then v_canonical:=v_canonical||jsonb_build_object('finance',v_finance);end if;
 v_replay:=private.start_consignment(p_operation_id,'update_consignment_payment',v_canonical);if not private.shop_payment_finance_access()then raise exception'finance_access_required'using errcode='42501';end if;if v_replay is not null then return v_replay;end if;
 select report_id,location_id into v_report_id,v_location from public.consignment_report_payments where id=v_payment_id;if not found then raise exception'payment_not_found'using errcode='22023';end if;
 perform private.consignment_shop_for_update(v_location,false);select * into v_report from public.consignment_reports where id=v_report_id for update;select * into v_payment from public.consignment_report_payments where id=v_payment_id for update;
 if v_payment.version<>v_expected then raise exception'stale_version'using errcode='22023';end if;
 -- Legacy payloads keep their original date guards, but may preserve an already
 -- corrected future/backdated timestamp while editing another canonical field.
 if not v_has_finance and v_paid_at is distinct from v_payment.paid_at and(v_paid_at>now()+interval'5 minutes'or v_paid_at<(v_report.period_month::timestamp at time zone'Europe/Rome'))then raise exception'invalid_date'using errcode='22023';end if;
 if not v_has_finance then v_finance:=jsonb_build_object('direction',v_payment.finance_direction,'category',v_payment.finance_category,'description',v_payment.finance_description,'pending',v_payment.finance_pending);end if;
 v_before:=private.consignment_posted_payment_net(v_report_id);v_paid:=private.consignment_posted_payment_net(v_report_id,v_payment_id);
 v_candidate:=case when v_voided or(v_finance->>'pending')::boolean or(v_paid_at at time zone'Europe/Rome')::date>(statement_timestamp()at time zone'Europe/Rome')::date then 0 when v_finance->>'direction'='expense'then-v_amount else v_amount end;
 if not v_has_finance and not v_voided and v_paid+v_candidate>v_report.brand_cents and v_paid+v_candidate>v_before then raise exception'payment_exceeds_invoice'using errcode='22023';end if;
 if not private.shop_payment_finance_access()then raise exception'finance_access_required'using errcode='42501';end if;
 update public.consignment_report_payments set amount_cents=v_amount,paid_at=v_paid_at,method=v_method,account_label=v_account,reference=v_reference,voided=v_voided,
 finance_direction=v_finance->>'direction',finance_category=v_finance->>'category',finance_description=v_finance->>'description',finance_pending=(v_finance->>'pending')::boolean,
 version=version+1,updated_by=auth.uid(),updated_at=now()where id=v_payment_id returning * into v_payment;
 insert into public.consignment_payment_revisions(id,payment_id,location_id,version,reason,snapshot,created_by)values(p_operation_id,v_payment_id,v_location,v_payment.version,v_reason,private.consignment_payment_snapshot(v_payment_id),auth.uid());
 perform private.consignment_refresh_payment_state(v_report_id);
 v_result:=jsonb_build_object('operation_id',p_operation_id,'payment_id',v_payment_id,'report_id',v_report_id,'version',v_payment.version,'replayed',false);
 if not private.shop_payment_finance_access()then raise exception'finance_access_required'using errcode='42501';end if;
 return private.finish_consignment(p_operation_id,'update_consignment_payment',v_canonical,v_result);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception'invalid_payload'using errcode='22023';
end$$;

-- Members see only operational state, never Finance amounts or metadata. This
-- is evaluated at read time too, so future dates becoming posted need no job.
create function private.read_consignment_payment_states(p_report_ids uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare result jsonb;
begin
 if auth.uid()is null or not private.is_member()then raise exception'membership_required'using errcode='42501';end if;
 if p_report_ids is null or cardinality(p_report_ids)>200 or array_position(p_report_ids,null)is not null or(select count(distinct x)from unnest(p_report_ids)x)<>cardinality(p_report_ids)then raise exception'invalid_payload'using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('report_id',r.id,'payment_state',private.consignment_effective_payment_state(r.id))order by r.id),'[]'::jsonb)into result from public.consignment_reports r where r.id=any(p_report_ids);
 return result;
end$$;
create function public.read_consignment_payment_states(p_report_ids uuid[])returns jsonb
language sql stable security invoker set search_path=''as $$select private.read_consignment_payment_states(p_report_ids)$$;
revoke all on function private.shop_payment_finance_access(),private.consignment_payment_finance_metadata(jsonb),private.consignment_payment_finance_date(jsonb),private.consignment_posted_payment_net(uuid,uuid),private.consignment_effective_payment_state(uuid),private.consignment_payment_net_bounds(uuid),private.read_consignment_payment_states(uuid[]),public.read_consignment_payment_states(uuid[])from public,anon,authenticated,service_role;
grant execute on function private.read_consignment_payment_states(uuid[]),public.read_consignment_payment_states(uuid[])to authenticated;
-- Existing payment/report DML and helper grants stay restricted as in P3.
commit;
