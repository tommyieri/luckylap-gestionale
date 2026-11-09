-- Blocca il caso commerciale ritirato nei dati canonici delle email, senza decodificare MIME.
-- Le bozze e gli invii storici restano immutabili; nessuna configurazione viene modificata.
begin;

create function private.partner_assistant_retired_social_proof(p_text text,p_names text[] default '{}') returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare
  v_normal text:=lower(normalize(coalesce(p_text,''),NFKC));
  v_identity text; v_name text; v_match text[];
  -- PostgreSQL17 con lc_ctype=C deve riconoscere anche lettere/accenti delle cinque lingue.
  v_upper constant text:=$case$ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮĲĴĶĹĻĽĿŁŃŅŇŊŌŎŐŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŹŻŽƁƂƄƆƇƉƊƋƎƏƐƑƓƔƖƗƘƜƝƟƠƢƤƦƧƩƬƮƯƱƲƳƵƷƸƼǄǇǊǍǏǑǓǕǗǙǛǞǠǢǤǦǨǪǬǮǱǴǶǷǸǺǼǾȀȂȄȆȈȊȌȎȐȒȔȖȘȚȜȞȠȢȤȦȨȪȬȮȰȲȺȻȽȾɁɃɄɅɆɈɊɌɎḀḂḄḆḈḊḌḎḐḒḔḖḘḚḜḞḠḢḤḦḨḪḬḮḰḲḴḶḸḺḼḾṀṂṄṆṈṊṌṎṐṒṔṖṘṚṜṞṠṢṤṦṨṪṬṮṰṲṴṶṸṺṼṾẀẂẄẆẈẊẌẎẐẒẔẞẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸỺỼỾⰮⱠⱢⱣⱤⱧⱩⱫⱭⱮⱯⱰⱲⱵⱾⱿꜢꜤꜦꜨꜪꜬꜮꜲꜴꜶꜸꜺꜼꜾꝀꝂꝄꝆꝈꝊꝌꝎꝐꝒꝔꝖꝘꝚꝜꝞꝠꝢꝤꝦꝨꝪꝬꝮꝹꝻꝽꝾꞀꞂꞄꞆꞋꞍꞐꞒꞖꞘꞚꞜꞞꞠꞢꞤꞦꞨꞪꞫꞬꞭꞮꞰꞱꞲꞳꞴꞶꞸꞺꞼꞾꟀꟂꟄꟅꟆꟇꟉꟋꟌꟐꟖꟘꟚꟜꟵＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ$case$;
  v_lower constant text:=$case$abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįĳĵķĺļľŀłńņňŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷÿźżžɓƃƅɔƈɖɗƌǝəɛƒɠɣɩɨƙɯɲɵơƣƥʀƨʃƭʈưʊʋƴƶʒƹƽǆǉǌǎǐǒǔǖǘǚǜǟǡǣǥǧǩǫǭǯǳǵƕƿǹǻǽǿȁȃȅȇȉȋȍȏȑȓȕȗșțȝȟƞȣȥȧȩȫȭȯȱȳⱥȼƚⱦɂƀʉʌɇɉɋɍɏḁḃḅḇḉḋḍḏḑḓḕḗḙḛḝḟḡḣḥḧḩḫḭḯḱḳḵḷḹḻḽḿṁṃṅṇṉṋṍṏṑṓṕṗṙṛṝṟṡṣṥṧṩṫṭṯṱṳṵṷṹṻṽṿẁẃẅẇẉẋẍẏẑẓẕßạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹỻỽỿⱞⱡɫᵽɽⱨⱪⱬɑɱɐɒⱳⱶȿɀꜣꜥꜧꜩꜫꜭꜯꜳꜵꜷꜹꜻꜽꜿꝁꝃꝅꝇꝉꝋꝍꝏꝑꝓꝕꝗꝙꝛꝝꝟꝡꝣꝥꝧꝩꝫꝭꝯꝺꝼᵹꝿꞁꞃꞅꞇꞌɥꞑꞓꞗꞙꞛꞝꞟꞡꞣꞥꞧꞩɦɜɡɬɪʞʇʝꭓꞵꞷꞹꞻꞽꞿꟁꟃꞔʂᶎꟈꟊɤꟍꟑꟗꟙꟛƛꟶａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ$case$;
  v_space constant text:=$re$[[:space:]֊־᐀᠆‐‑‒–—―⸗⸚⸺⸻⹀⹝〜〰゠︱︲﹘﹣－𐵮𐺭-]*$re$;
  v_club text; v_quantity text; v_shirts text;
  v_anniversary constant text:=$re$(?:^|[[:space:]])(?:ann[io]|years?|jahre?n?|ans?|años?|anniversari[[:alpha:]À-ÖØ-öø-ÿĀ-ɏḀ-ỿⱠ-Ɀ꜠-ꟿꬰ-꭯]*|anniversar[[:alpha:]À-ÖØ-öø-ÿĀ-ɏḀ-ỿⱠ-Ɀ꜠-ꟿꬰ-꭯]*|aniversari[[:alpha:]À-ÖØ-öø-ÿĀ-ɏḀ-ỿⱠ-Ɀ꜠-ꟿꬰ-꭯]*|jubilä[[:alpha:]À-ÖØ-öø-ÿĀ-ɏḀ-ỿⱠ-Ɀ꜠-ꟿꬰ-꭯]*)(?=[[:space:]]|$)$re$;
begin
  v_normal:=translate(v_normal,v_upper,v_lower);
  v_identity:=v_normal;
  v_club:=$re$(?<![[:alnum:]À-ÖØ-öø-ÿĀ-ɏḀ-ỿⱠ-Ɀ꜠-ꟿꬰ-꭯])(?:(?:porscheSPACEclubs?|clubs?SPACEporsche)SPACE(?:(?:di|della|in|of|de|du|der|the)[[:space:]]+)?(?:toscana|toscane|tuscany|tuscan|toskana)|(?:toscana|toscane|tuscany|tuscan|toskana)[[:space:]]+(?:porscheSPACEclubs?|clubs?SPACEporsche))(?![[:alnum:]À-ÖØ-öø-ÿĀ-ɏḀ-ỿⱠ-Ɀ꜠-ꟿꬰ-꭯])$re$;
  v_club:=replace(v_club,'SPACE',v_space);
  -- Solo un'identita completa del destinatario che contiene il nome del club e esentabile.
  -- Nomi parziali come Porsche, Club o Toscana non cancellano il riferimento commerciale.
  for v_name in select translate(lower(normalize(n,NFKC)),v_upper,v_lower) from unnest(coalesce(p_names,'{}'::text[])) n
    where n is not null and n ~ '[^[:space:]]' order by char_length(n) desc
  loop
    if v_name ~ v_club then v_identity:=replace(v_identity,v_name,' '); end if;
  end loop;
  if v_identity ~ v_club then return true; end if;
  v_quantity:=$re$(?:150|centoSEP*cinquanta|(?:one|a)SEP+hundredSEP+(?:andSEP+)?fifty|(?:ein)?hundertf(?:ü|ue|u)nfzig|centSEP+cinquante|cientoSEP+cincuenta)$re$;
  v_quantity:=replace(v_quantity,'SEP',$re$[[:space:]֊־᐀᠆‐‑‒–—―⸗⸚⸺⸻⹀⹝〜〰゠︱︲﹘﹣－𐵮𐺭-]$re$);
  v_shirts:=$re$(?<![[:alnum:]À-ÖØ-öø-ÿĀ-ɏḀ-ỿⱠ-Ɀ꜠-ꟿꬰ-꭯.,])QUANTITY(?![[:alnum:]À-ÖØ-öø-ÿĀ-ɏḀ-ỿⱠ-Ɀ꜠-ꟿꬰ-꭯])[[:space:]]+((?:[[:alpha:]À-ÖØ-öø-ÿĀ-ɏḀ-ỿⱠ-Ɀ꜠-ꟿꬰ-꭯][[:alpha:]À-ÖØ-öø-ÿĀ-ɏḀ-ỿⱠ-Ɀ꜠-ꟿꬰ-꭯̀-ͯ'’֊־᐀᠆‐‑‒–—―⸗⸚⸺⸻⹀⹝〜〰゠︱︲﹘﹣－𐵮𐺭-]{0,30}[[:space:]]+){0,4}?)(?:magliett[ae]|(?:clubSPACE)?(?:tSPACEshirts?|teeSPACEshirts?|shirts?)|camisetas?|(?:bespoke|customPLUSmade)[[:space:]]+ones)(?![[:alnum:]À-ÖØ-öø-ÿĀ-ɏḀ-ỿⱠ-Ɀ꜠-ꟿꬰ-꭯])$re$;
  v_shirts:=replace(replace(replace(v_shirts,'QUANTITY',v_quantity),'PLUS',replace(v_space,'*','+')),'SPACE',v_space);
  -- La quantita si controlla sul testo originale normalizzato: nessun nome puo esentarla.
  for v_match in select regexp_matches(v_normal,v_shirts,'g') loop
    if v_match[1] !~ v_anniversary then return true; end if;
  end loop;
  return false;
end
$$;

create function private.partner_assistant_retired_reference_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_names text[];
begin
  if tg_op='INSERT' then
    if new.send_status not in ('pronto','in_invio') then return new; end if;
  elsif new.send_status<>'in_invio' or old.send_status is not distinct from new.send_status then
    return new;
  end if;
  -- Esenta soltanto l'identita ufficiale della scheda, mai un alias dell'evento nella scelta.
  select array[p.name] into v_names from public.partners p where p.id=new.partner_id;
  if private.partner_assistant_retired_social_proof(new.subject||E'\n'||new.body,coalesce(v_names,'{}'::text[])) then
    raise exception 'retired_reference' using errcode='22023';
  end if;
  return new;
end
$$;

create trigger partner_assistant_messages_retired_reference before insert or update on public.partner_assistant_messages
  for each row execute function private.partner_assistant_retired_reference_guard();

revoke all on function private.partner_assistant_retired_social_proof(text,text[]),
  private.partner_assistant_retired_reference_guard() from public,anon,authenticated,service_role;

-- Stesso snapshot del piano: aggiunge soltanto la guardia dopo la scelta dei nomi.
create or replace function private.partner_send_snapshot(p_partner uuid,p_kind text,p_draft uuid,p_number integer,p_at timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare p public.partners%rowtype; d public.partner_assistant_drafts%rowtype; k public.partner_contacts%rowtype;
 j public.partner_assistant_jobs%rowtype; f public.partner_assistant_followups%rowtype; n public.partner_assistant_notes%rowtype;
 r public.partner_assistant_notes%rowtype; v_rules integer;
begin
 select * into p from public.partners where id=p_partner;
 select * into d from public.partner_assistant_drafts where id=p_draft and partner_id=p_partner;
 select * into k from public.partner_contacts where id=d.contact_id and active and kind='email';
 select max(version) into v_rules from public.partner_assistant_rules;
 select * into r from public.partner_assistant_notes where id=d.research_note_id;
 if d.id is null or r.id is null or k.id is null or private.partner_assistant_address(k.link_value) is null
   or d.rules_version is distinct from v_rules or r.created_at<=p_at-interval '21 days'
   or d.sha256 is distinct from encode(sha256(convert_to(d.subject||E'\n\n'||d.body||E'\n\n'||d.signature,'UTF8')),'hex') then return null; end if;
 if p_kind='primo' then
   select * into j from public.partner_assistant_jobs where partner_id=p_partner and status='pronta' and draft_id=d.id;
   select * into n from public.partner_assistant_notes where id=j.choice_note_id;
   if j.id is null or not private.partner_assistant_eligible(p.id) or private.partner_email_draft_held(d.id)
     or private.partner_email_manual_stale(d.id) or not private.partner_assistant_valid_timezone(n.content->>'timezone')
     or nullif(n.content->>'event_starts_on','')::date<=private.partner_assistant_rome_day(p_at)
     or not exists(select 1 from public.partner_assistant_notes q where q.partner_id=p.id and q.kind='controllo'
       and q.content->'approved'='true'::jsonb and q.content->>'sha256'=d.sha256 and q.created_at>=d.created_at)
     or exists(select 1 from public.partner_assistant_messages m where m.mode='invio' and m.partner_id=p.id
       and m.kind='primo' and m.send_status in ('in_invio','inviato','incerto')) then return null; end if;
 elsif p_kind='sollecito' then
   select * into f from public.partner_assistant_followups where partner_id=p_partner and draft_id=d.id;
   select * into n from public.partner_assistant_notes where id=f.choice_note_id;
   if f.id is null or private.partner_followup_reason(f.id,true) is not null or f.followups_sent+1 is distinct from p_number
     or f.next_due_on>private.partner_assistant_rome_day(p_at) or f.deferred_until>(p_at at time zone (n.content->>'timezone'))::date
     or private.partner_assistant_rome_day(f.last_sent_at)+7>private.partner_assistant_rome_day(p_at) then return null; end if;
 else return null; end if;
 if private.partner_assistant_retired_social_proof(d.subject||E'\n'||d.body, array[p.name]) then return null; end if;
 if not private.partner_assistant_window_open(n.content->>'timezone',p.country,p_at,interval '90 seconds') then return null; end if;
 return jsonb_build_object('partner_version',p.version,'contact_version',k.version,'rules_version',v_rules,'sha256',d.sha256,
   'choice_note_id',n.id,'research_note_id',r.id,'conversation_version',f.version,'contact_id',k.id,
   'address_sha256',private.partner_assistant_address_sha256(private.partner_assistant_address(k.link_value)));
end
$$;

-- Stessa presa/lease del sender: aggiunge il passaggio a Tommi senza riscrivere.
create or replace function private.skip_partner_assistant_send(p_lease_token uuid, p_job_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c private.partner_assistant_config%rowtype;
  j public.partner_assistant_jobs%rowtype;
  v_now timestamptz; v_partner uuid; v_event date;
begin
  perform private.partner_assistant_service_required();
  perform private.partner_assistant_as_actor();
  if p_reason is null or p_reason not in ('conversazione_esistente', 'bozza_scaduta', 'casella_incerta', 'riferimento_superato')
    or (p_job_id is null and p_reason <> 'casella_incerta') then
    raise exception 'invalid_partner_payload' using errcode = '22023';
  end if;
  if not private.partner_assistant_mail_guard(p_lease_token, true) then
    return jsonb_build_object('status', 'lease_persa');
  end if;
  v_now := private.partner_assistant_now();
  select * into c from private.partner_assistant_config where singleton for share;
  if c.mode='invio' then
    update private.partner_send_slots set status='skipped',reason=p_reason where status='scheduled' and kind='primo'
      and draft_id=(select candidate_draft_id from private.partner_assistant_mail_state where singleton);
  end if;
  if p_reason = 'casella_incerta' then
    update private.partner_assistant_mail_state set backoff_until = v_now + interval '15 minutes' where singleton;
  end if;
  if p_job_id is not null then
    select l.partner_id into v_partner from public.partner_assistant_jobs l where l.id = p_job_id;
    if v_partner is not null then
      perform 1 from public.partners where id = v_partner for share;
      select * into j from public.partner_assistant_jobs where id = p_job_id for update;
    end if;
  end if;
  -- Una risposta tardiva della casella o del ricontrollo appartiene alla bozza reclamata,
  -- non a una revisione umana successiva. Vale anche per worker precedenti al nuovo editor.
  if p_job_id is not null and (j.draft_id is distinct from
      (select candidate_draft_id from private.partner_assistant_mail_state where singleton)
    or j.draft_id is null or private.partner_email_draft_held(j.draft_id)) then
    return jsonb_build_object('status','lease_persa');
  end if;
  if j.status = 'pronta' and c.mode = 'invio' and p_reason = 'riferimento_superato' then
    -- Nessuna riscrittura automatica o chiamata Anthropic: conserva la bozza da rivedere.
    update public.partner_assistant_jobs set status='serve_tommaso', reason='riferimento_superato',
        lease_token=null, lease_expires_at=null, updated_at=now() where id=j.id;
    insert into private.partner_assistant_events(partner_id,step,outcome)
      values(j.partner_id,'invio','riferimento_superato');
    return jsonb_build_object('status','done');
  elsif j.status = 'pronta' and c.mode = 'invio' and p_reason = 'conversazione_esistente' then
    perform private.partner_assistant_send_move(j.partner_id, j.draft_id, 'conversazione_esistente');
    return jsonb_build_object('status', 'done');
  elsif j.status = 'pronta' and c.mode = 'invio' and p_reason = 'bozza_scaduta' then
    select nullif(n.content ->> 'event_starts_on', '')::date into v_event
      from public.partner_assistant_notes n where n.id = j.choice_note_id;
    if (v_event is null or v_event > private.partner_assistant_rome_day(v_now))
      and j.rewrites = 0 and c.paused_reason is distinct from 'credito'
      and not private.partner_email_manual_draft(j.draft_id) then
      -- Una riscrittura con la stessa scelta: la riga della maglietta o la data del corpo cambiano.
      update public.partner_assistant_jobs set status = 'in_coda', step = 'scrittura', draft_id = null, rewrites = 1,
          attempts = 0, reason = null, lease_token = null, lease_expires_at = null, next_attempt_at = now(),
          updated_at = now()
        where partner_id = j.partner_id;
      insert into private.partner_assistant_events(partner_id, step, outcome)
        values (j.partner_id, 'invio', 'bozza_scaduta');
    else
      perform private.partner_assistant_send_move(j.partner_id, j.draft_id, 'bozza_scaduta');
    end if;
    return jsonb_build_object('status', 'done');
  end if;
  insert into private.partner_assistant_events(partner_id, step, outcome) values (v_partner, 'invio', p_reason);
  return jsonb_build_object('status', 'done');
end
$$;

commit;
