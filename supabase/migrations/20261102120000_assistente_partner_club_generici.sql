-- Testo per i club, versione 3: approvazione editoriale di Tommi, 2 novembre 2026.
-- Una tantum, solo sulle bozze del modello v2 ancora pronte e mai affidate alla posta.
-- Non corregge righe append-only: conserva gli originali e aggiunge ricerca sostitutiva,
-- scelta, bozza e approvazione editoriale con le rispettive provenienze. Non chiama Claude.
-- La ricerca è la COPIA della stessa nota del modello: tiene created_at originale, quindi
-- i 21 giorni all'invio non ripartono da questa modifica. Nessuna pausa o impostazione cambia.
-- Le bozze con contesto superato restano intatte: dopo l'applicazione verificare il numero
-- aggiornato e l'assenza di bozze v2 ancora idonee; quelle saltate vanno controllate prima
-- di riattivarle. Una frase diversa da quella attesa interrompe tutta la transazione.
begin;

do $$
declare
  c private.partner_assistant_config%rowtype;
  j public.partner_assistant_jobs%rowtype;
  d public.partner_assistant_drafts%rowtype;
  n public.partner_assistant_notes%rowtype;
  s public.partner_assistant_notes%rowtype;
  r public.partner_assistant_notes%rowtype;
  v_partners uuid[];
  v_founder uuid;
  v_rules integer;
  v_before text;
  v_after text;
  v_body text;
  v_sha text;
  v_research uuid;
  v_choice uuid;
  v_draft uuid;
  v_updated integer := 0;
begin
  -- Lo stesso ordine dell'invio: casella, configurazione, schede, lavori.
  perform 1 from private.partner_assistant_mail_state where singleton for update;
  select * into c from private.partner_assistant_config where singleton for update;
  select array_agg(l.partner_id order by l.partner_id) into v_partners
    from public.partner_assistant_jobs l
      join public.partner_assistant_drafts b on b.id = l.draft_id
      join public.partner_assistant_notes a on a.id = b.research_note_id
    where l.status = 'pronta' and private.partner_assistant_is_template(a.id)
      and a.content ->> 'template_version' = '2';
  if v_partners is null then return; end if;
  if exists (select 1 from private.partner_assistant_mail_state m
      where m.lease_expires_at > clock_timestamp())
    or exists (select 1 from public.partner_assistant_jobs l
      where l.lease_expires_at > clock_timestamp()) then
    raise exception 'partner_assistant_club_editorial_busy' using errcode = '55000';
  end if;
  v_founder := c.handoff_to;
  if not exists (select 1 from public.memberships m
      where m.user_id = v_founder and m.active and m.role = 'founder') then
    raise exception 'partner_assistant_club_editorial_founder_required' using errcode = '55000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.partner_assistant.rules', 0));
  select max(version) into v_rules from public.partner_assistant_rules;
  perform 1 from public.partners p where p.id = any(v_partners) order by p.id for share;
  perform 1 from public.partner_assistant_jobs l
    where l.partner_id = any(v_partners) order by l.partner_id for update;

  for j in select l.* from public.partner_assistant_jobs l
    where l.partner_id = any(v_partners) and l.status = 'pronta' order by l.partner_id
  loop
    select * into d from public.partner_assistant_drafts where id = j.draft_id;
    select * into n from public.partner_assistant_notes where id = d.research_note_id;
    select * into s from public.partner_assistant_notes where id = j.choice_note_id;
    -- Mai spostare un lavoro già preso dalla posta, né una bozza già composta in MIME,
    -- comprese le prove. Non toccare contesti che richiedono una nuova preparazione.
    if not private.partner_assistant_eligible(j.partner_id)
      or not private.partner_assistant_uses_template(j.partner_id)
      or d.partner_id is distinct from j.partner_id or n.id is distinct from j.research_note_id
      or n.partner_id is distinct from j.partner_id or s.kind is distinct from 'scelta'
      or s.partner_id is distinct from j.partner_id
      or not private.partner_assistant_is_template(n.id)
      or n.content ->> 'template_version' is distinct from '2'
      or d.rules_version is distinct from v_rules or n.rules_version is distinct from v_rules
      or s.rules_version is distinct from v_rules
      or n.created_at <= now() - interval '21 days'
      or d.partner_version is distinct from (select p.version from public.partners p where p.id = j.partner_id)
      or d.contact_id is distinct from (select e.contact_id from private.partner_assistant_email(j.partner_id) e)
      or private.partner_assistant_address((select k.link_value from public.partner_contacts k
        where k.id = d.contact_id and k.kind = 'email' and k.active)) is null
      or exists (select 1 from public.partner_assistant_messages m where m.draft_id = d.id)
      or exists (select 1 from public.partner_assistant_messages m
        where m.partner_id = j.partner_id and m.mode = 'invio'
          and m.send_status in ('pronto', 'in_invio', 'inviato', 'incerto')) then
      continue;
    end if;
    select a.* into r from public.partner_assistant_notes a
      where a.partner_id = j.partner_id and a.kind = 'controllo' and a.content -> 'approved' = 'true'::jsonb
        and a.content ->> 'sha256' = d.sha256 and a.rules_version = v_rules and a.created_at >= d.created_at
        and a.model is not null
      order by a.created_at desc, a.id desc limit 1;
    if not found or d.sha256 is distinct from
      encode(sha256(convert_to(d.subject || E'\n\n' || d.body || E'\n\n' || d.signature, 'UTF8')), 'hex') then
      continue;
    end if;

    select x.before_text, x.after_text into v_before, v_after from (values
      ('it', 'Abbiamo già avviato collaborazioni con alcuni Porsche Club in Italia: per il Porsche Club Toscana abbiamo realizzato 150 magliette dedicate ai soci, con il logo del club ricamato sulla manica.',
        'Abbiamo già avviato alcune collaborazioni con Porsche Club in Italia, realizzando magliette dedicate ai soci con il logo del club ricamato sulla manica.'),
      ('en', 'We have already started working with several Porsche Clubs in Italy: for the Porsche Club Toscana we made 150 T-shirts for its members, with the club logo embroidered on the sleeve.',
        'We have already started working with some Porsche Clubs in Italy, creating T-shirts for their members with the club logo embroidered on the sleeve.'),
      ('de', 'Wir arbeiten bereits mit einigen Porsche Clubs in Italien zusammen: Für den Porsche Club Toscana haben wir 150 T-Shirts für die Mitglieder gefertigt, mit dem Clublogo auf dem Ärmel gestickt.',
        'Wir haben bereits einige Kooperationen mit Porsche Clubs in Italien begonnen und T-Shirts für die Mitglieder mit dem auf den Ärmel gestickten Clublogo gefertigt.'),
      ('fr', 'Nous avons déjà lancé des collaborations avec plusieurs Porsche Clubs en Italie : pour le Porsche Club Toscana, nous avons réalisé 150 t-shirts dédiés aux membres, avec le logo du club brodé sur la manche.',
        'Nous avons déjà lancé quelques collaborations avec des Porsche Clubs en Italie, en réalisant des t-shirts dédiés aux membres avec le logo du club brodé sur la manche.'),
      ('es', 'Ya hemos empezado a colaborar con varios Porsche Club en Italia: para el Porsche Club Toscana hicimos 150 camisetas dedicadas a los socios, con el logotipo del club bordado en la manga.',
        'Ya hemos iniciado algunas colaboraciones con Porsche Club en Italia, realizando camisetas dedicadas a los socios con el logotipo del club bordado en la manga.')
    ) x(language, before_text, after_text) where x.language = d.language;
    if v_before is null or (length(d.body) - length(replace(d.body, v_before, ''))) <> length(v_before) then
      raise exception 'partner_assistant_club_editorial_text_changed' using errcode = '55000';
    end if;
    v_body := replace(d.body, v_before, v_after);
    if v_body ~* 'Toscana|150' then
      raise exception 'partner_assistant_club_editorial_text_changed' using errcode = '55000';
    end if;
    v_sha := encode(sha256(convert_to(d.subject || E'\n\n' || v_body || E'\n\n' || d.signature, 'UTF8')), 'hex');

    insert into public.partner_assistant_notes(partner_id, kind, content, sources, rules_version, model,
        operation_id, created_by, created_at)
      values (j.partner_id, 'ricerca', n.content || jsonb_build_object(
          'text', 'Nessuna ricerca: bozza dal testo fisso per i club approvato da Tommaso (versione 3). Copia della stessa nota, senza nuova ricerca: modifica editoriale approvata da Tommi; la data originale resta valida per la scadenza.',
          'template_version', 3, 'approval_source', 'founder_editorial',
          'previous_research_note_id', n.id, 'previous_draft_id', d.id, 'previous_review_id', r.id),
        n.sources, n.rules_version, null, gen_random_uuid(), v_founder, n.created_at)
      returning id into v_research;
    insert into public.partner_assistant_notes(partner_id, kind, content, sources, rules_version, model,
        operation_id, created_by)
      values (j.partner_id, 'scelta', s.content || jsonb_build_object(
          'reason_it', 'Testo fisso per i club, versione 3, approvato da Tommaso.',
          'template_version', 3, 'approval_source', 'founder_editorial',
          'previous_choice_note_id', s.id, 'previous_draft_id', d.id, 'previous_review_id', r.id),
        s.sources, s.rules_version, null, gen_random_uuid(), v_founder)
      returning id into v_choice;
    insert into public.partner_assistant_drafts(partner_id, contact_id, partner_version, language, subject,
        body, signature, sha256, rules_version, research_note_id, operation_id, created_by)
      values (j.partner_id, d.contact_id, d.partner_version, d.language, d.subject, v_body, d.signature,
        v_sha, d.rules_version, v_research, gen_random_uuid(), v_founder)
      returning id into v_draft;
    insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id,
        created_by)
      values (j.partner_id, 'controllo', jsonb_build_object('approved', true, 'problems', '[]'::jsonb,
          'sha256', v_sha, 'template_version', 3, 'approval_source', 'founder_editorial',
          'previous_draft_id', d.id, 'previous_review_id', r.id),
        d.rules_version, null, gen_random_uuid(), v_founder);
    update public.partner_assistant_jobs set research_note_id = v_research, choice_note_id = v_choice,
        draft_id = v_draft, updated_at = now()
      where partner_id = j.partner_id;
    insert into private.partner_assistant_events(partner_id, step, outcome)
      values (j.partner_id, 'controllo', 'modello_editoriale');
    v_updated := v_updated + 1;
  end loop;
  raise notice 'Assistente Partner: % bozze del modello aggiornate alla versione 3.', v_updated;
end
$$;

commit;
