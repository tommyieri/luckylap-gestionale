-- Assistente Partner, ricerca ancora valida alla data di ripresa (2 novembre 2026, su richiesta di
-- Tommi). Un contatto in attesa di una data tornava sempre alla ricerca, anche con una ricerca di pochi
-- giorni: la ricerca è il passo che costa di più. Ora, quando il lavoro viene preso, riparte
-- dall'estrazione se la ricerca è ancora buona:
-- - ha meno di 14 giorni: l'invio accetta una ricerca fino a 21 giorni, e i 7 di margine lasciano alla
--   bozza il tempo di partire;
-- - la scelta di prima ha il fatto e il fuso: l'attesa senza fatto o senza fuso serve proprio a
--   riprovare con una ricerca nuova;
-- - l'evento della scelta di prima non è ancora iniziato: dopo l'evento la ricerca è superata. Un evento
--   senza data esatta non si può giudicare, e conta come iniziato;
-- - la scheda non è cambiata dopo la ricerca: il team può averla corretta.
-- Altrimenti si rifà la ricerca, come prima.
--
-- Additiva: claim_partner_assistant_step sostituita, stessa firma, stessi permessi, stesse risposte.
-- Vale anche per i lavori già tornati alla ricerca prima di questa migrazione. Nessuna tabella nuova,
-- nessun dato cambiato, nessun permesso nuovo.

-- Come 20261101012650, con il controllo sul lavoro appena scelto. Solo il ritorno dall'attesa tiene la
-- nota di ricerca: tutti gli altri ritorni la tolgono. Il lavoro passa nello stesso stato di una ricerca
-- appena salvata (complete_partner_assistant_research): la scelta vecchia non vale più, e l'estrazione
-- la rifà con la data di oggi. Il controllo è qui, e non con le attese arrivate al giorno giusto, perché
-- un lavoro può restare in coda a lungo: contatto fermato, coda lunga, pausa per il credito.
create or replace function private.claim_partner_assistant_step(p_worker_id uuid, p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c private.partner_assistant_config%rowtype;
  j public.partner_assistant_jobs%rowtype;
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_templates_full boolean;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  if p_worker_id is null or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  -- Un giro alla volta: chi arriva secondo aspetta qui, poi vede la lease del primo.
  select * into c from private.partner_assistant_config where singleton for update;
  update private.partner_assistant_config set last_tick_at = now() where singleton;
  if c.mode not in ('prepara', 'prova', 'invio') then return jsonb_build_object('status', 'idle', 'reason', 'spento'); end if;
  if c.actor_id is null then return jsonb_build_object('status', 'idle', 'reason', 'non_configurato'); end if;
  if c.paused_reason is not null then return jsonb_build_object('status', 'idle', 'reason', 'pausa'); end if;
  if c.backoff_until > now() then return jsonb_build_object('status', 'idle', 'reason', 'attesa'); end if;
  -- Un passo alla volta.
  if exists (select 1 from public.partner_assistant_jobs l where l.lease_expires_at > clock_timestamp()) then
    return jsonb_build_object('status', 'idle', 'reason', 'occupato');
  end if;
  -- Lease scaduta: un tentativo fallito; al terzo il contatto passa a Tommi. Prima i contatti di quei
  -- lavori (for share), poi i lavori, come nei comandi del team: una cancellazione definitiva in
  -- corso finisce prima, e la sua lease tolta non conta. Senza lease attive (controllo qui sopra)
  -- le due letture trovano gli stessi lavori.
  perform 1 from public.partners p join public.partner_assistant_jobs l on l.partner_id = p.id
    where l.lease_expires_at <= clock_timestamp()
    for share of p;
  with expired as (
    update public.partner_assistant_jobs l set attempts = least(l.attempts + 1, 3),
        status = case when l.attempts + 1 >= 3 then 'serve_tommaso' else l.status end,
        reason = case when l.attempts + 1 >= 3 then 'troppi_tentativi' else l.reason end,
        lease_token = null, lease_expires_at = null, updated_at = now()
      where l.lease_expires_at <= clock_timestamp()
      returning l.partner_id, l.step)
  insert into private.partner_assistant_events(partner_id, step, outcome)
    select e.partner_id, e.step, 'lease_scaduta' from expired e;
  -- Un lavoro per ogni contatto nuovo in coda.
  insert into public.partner_assistant_jobs(partner_id, status, step)
    select q.partner_id, 'in_coda', 'ricerca' from private.partner_assistant_queue(v_today) q
    on conflict (partner_id) do nothing;
  -- Attese arrivate al giorno giusto: si riparte dalla ricerca.
  update public.partner_assistant_jobs set status = 'in_coda', step = 'ricerca', write_on = null,
      next_attempt_at = now(), updated_at = now()
    where status = 'attesa' and write_on <= v_today;
  -- Note del modello su un contatto che non usa più il modello: si riparte dalla ricerca.
  update public.partner_assistant_jobs l set step = 'ricerca', research_note_id = null, choice_note_id = null,
      draft_id = null, rewrites = 0, updated_at = now()
    where l.status = 'in_coda' and l.step in ('estrazione', 'scrittura')
      and private.partner_assistant_is_template(l.research_note_id)
      and not private.partner_assistant_uses_template(l.partner_id);
  -- Bozze del modello pronte da inviare: al tetto, i contatti del modello prima del controllo non si
  -- prendono.
  v_templates_full := (select count(*) from public.partner_assistant_jobs pj
      join public.partner_assistant_drafts d on d.id = pj.draft_id
    where pj.status = 'pronta' and private.partner_assistant_eligible(pj.partner_id)
      and private.partner_assistant_is_template(d.research_note_id)) >= 20;
  -- Il primo lavoro pronto, nell'ordine della coda, con il contatto ancora idoneo: la classifica
  -- della coda contiene solo i contatti idonei.
  select l.* into j from public.partner_assistant_jobs l
    join private.partner_assistant_ranking(v_today) r on r.partner_id = l.partner_id
    where l.status = 'in_coda' and l.next_attempt_at <= now() and l.attempts < 3
      and not (v_templates_full and l.step <> 'controllo' and private.partner_assistant_uses_template(l.partner_id))
    order by r.rank
    limit 1
    for update of l skip locked;
  if not found then return jsonb_build_object('status', 'idle', 'reason', 'vuota'); end if;
  -- Ricerca ancora buona: non si rifà, si riparte dall'estrazione.
  if j.step = 'ricerca'
    and exists (select 1 from public.partner_assistant_notes n
        join public.partners p on p.id = j.partner_id
      where n.id = j.research_note_id and n.created_at > now() - interval '14 days'
        and p.updated_at <= n.created_at and not private.partner_assistant_is_template(n.id))
    and exists (select 1 from public.partner_assistant_notes s
      where s.id = j.choice_note_id and s.content ->> 'fact_text' ~ '\S' and s.content ->> 'timezone' ~ '\S'
        and coalesce(nullif(s.content ->> 'event_starts_on', '')::date > v_today,
          s.content ->> 'event_name' !~ '\S')) then
    update public.partner_assistant_jobs set step = 'estrazione', choice_note_id = null, draft_id = null,
        rewrites = 0, attempts = 0, next_attempt_at = now()
      where partner_id = j.partner_id;
  end if;
  update public.partner_assistant_jobs set lease_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds), updated_at = now()
    where partner_id = j.partner_id
    returning * into j;
  return jsonb_build_object('status', 'claimed', 'job', jsonb_build_object('job_id', j.id, 'partner_id', j.partner_id,
    'step', j.step, 'lease_token', j.lease_token, 'lease_expires_at', j.lease_expires_at, 'attempts', j.attempts,
    'rewrites', j.rewrites));
end
$$;
