-- Un controllo preliminare incerto non fa perdere un appuntamento ancora futuro.
-- Cambi di stato o versione invalidano sempre il piano; al momento dell'invio
-- restano obbligatorie le prove fresche della casella.
begin;

create or replace function private.partner_send_followup_state() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_context_changed boolean:=new.status<>'active' or new.version<>old.version;
begin
  if v_context_changed or (new.last_checked_at is distinct from old.last_checked_at and new.reason is not null) then
    update private.partner_send_slots slots
    set status='skipped',reason=case
      when (select opens_at from private.partner_send_windows where id=slots.window_id)>private.partner_followup_proof_now()
        then 'ripianificato'
      else coalesce(new.reason,'contesto_cambiato')
    end
    where slots.conversation_id=new.id and slots.status='scheduled'
      and (v_context_changed or slots.planned_at<=new.last_checked_at);
  end if;
  return new;
end
$$;

commit;
