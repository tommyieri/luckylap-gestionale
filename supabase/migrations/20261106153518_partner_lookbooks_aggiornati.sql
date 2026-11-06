-- Aggiorna le impronte dei due PDF Club e mantiene validi i metadati già registrati.
begin;

create or replace function private.partner_assistant_test_lookbook(p_code text) returns jsonb
language sql immutable security invoker set search_path = '' as $$
  select case p_code
    when 'porsche_club' then jsonb_build_object('code', p_code, 'bytes', 2590257,
      'sha256', '3af4b265bb2c10f3442ad4a0ec8b9059b66a2a5033d11c886de79a412fa14e10')
    when 'club' then jsonb_build_object('code', p_code, 'bytes', 2442753,
      'sha256', 'e9e926aa0bb3bb8c4b374eeb72becd6054bcce225d677f671d28f657a4650a36') end
$$;

-- Le impronte precedenti identificano il MIME storico. La guardia INSERT
-- continua a richiedere l'allegato deciso per la bozza e il giro correnti.
alter table public.partner_assistant_messages drop constraint partner_assistant_messages_lookbook_check;
alter table public.partner_assistant_messages add constraint partner_assistant_messages_lookbook_check check (
  lookbook is null or coalesce(jsonb_typeof(lookbook) = 'object' and (
    lookbook = private.partner_assistant_test_lookbook(lookbook ->> 'code')
    or lookbook in (
      '{"code":"porsche_club","bytes":2592305,"sha256":"541ddb3b20f7daa46ef428c64ae5618996711409d1819e5dfd37e8cec8831f77"}'::jsonb,
      '{"code":"club","bytes":2444810,"sha256":"923cf52ae33ba5dfc8e9271d1157a64719a925a14750ee96a0bd0eeb686942b1"}'::jsonb
    )
  ), false));

create or replace function private.partner_assistant_test_lookbooks_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v jsonb;
begin
  -- Una prova già registrata conserva la mappa congelata, anche dopo il
  -- cambio di PDF. Solo le nuove prove devono usare le impronte correnti.
  if tg_op = 'UPDATE' then
    if new.lookbooks is distinct from old.lookbooks or (old.lookbooks <> '{}'::jsonb and
      (new.draft_ids is distinct from old.draft_ids or new.recipients is distinct from old.recipients)) then
      raise exception 'partner_assistant_test_immutable' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.lookbooks <> '{}'::jsonb then
    if cardinality(new.draft_ids) <> 2 or new.draft_ids[1] = new.draft_ids[2]
      or (select count(*) from jsonb_object_keys(new.lookbooks)) <> 2 then
      raise exception 'invalid_partner_payload' using errcode = '22023';
    end if;
    foreach v in array array[new.lookbooks -> new.draft_ids[1]::text,
        new.lookbooks -> new.draft_ids[2]::text] loop
      if v is null or v is distinct from private.partner_assistant_test_lookbook(v ->> 'code') then
        raise exception 'invalid_partner_payload' using errcode = '22023';
      end if;
    end loop;
    if (new.lookbooks -> new.draft_ids[1]::text ->> 'code')
      = (new.lookbooks -> new.draft_ids[2]::text ->> 'code') then
      raise exception 'invalid_partner_payload' using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

commit;
