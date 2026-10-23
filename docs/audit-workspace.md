# Controllo CEO: il feed di cosa fa il team

`/audit` («Controllo CEO») mostra un feed in sola lettura delle **ultime 24 ore**: una frase per ogni azione sui dati condivisi, con chi l'ha fatta, dalla più recente. Per esempio «Luca ha aggiunto una call: …», «Il sistema ha ricevuto un ordine (2 unità · Shopify online).» o «Il sistema ha importato 207 contatti in Partner.». Il registro tecnico dei trigger (`audit_logs`, con prima e dopo) resta tutto nel database e non si mostra nella pagina; il feed non legge le righe più vecchie di 24 ore (decisione di Tommi del 23 ottobre 2026). Il feed è arrivato con la pull request #3 di Codex (P6) e corretto con la migrazione `20261023150000_ceo_feed_fixes.sql`.

## Chi lo vede

- Ogni membro attivo può aprire Controllo CEO con la relativa password corretta in questa sessione (fino a 8 ore dall’apertura), indipendentemente dal ruolo. La pagina (`src/app/(workspace)/audit/page.tsx`) verifica utente, membership attiva e area aperta (`verifiedSensitiveAccess`); se l’area è chiusa porta a `/auth/area/audit`.
- Il loader (`loadActivityFeed` in `src/lib/audit/feed-server.ts`) rifiuta prima della query chi non può leggere l'area. La funzione `private.ceo_activity_feed` ripete il controllo nel database (`private.can_audit()`): resta lei l'autorità.
- In cima alla pagina, dopo la verifica, la striscia «Controllo CEO aperto su questo dispositivo, fino a 8 ore dall’apertura.» con «Chiudi Controllo CEO» (06 R12).
- Anteprima locale (`LUCKYLAP_LOCAL_PREVIEW=true`, mai su Vercel o con `NODE_ENV=production`): frasi sintetiche delle ultime 24 ore da `src/lib/audit/fixtures.ts`, con «Anteprima locale: dati sintetici, salvataggio disattivato.», senza chiamare Supabase.
- Il proxy copre `/audit/:path*` (cookie aggiornati e `no-store`).

## Cosa mostra

- `h1` «Controllo CEO», sotto «Cosa ha fatto il team nelle ultime 24 ore, dalla più recente. Orari di Roma.».
- Filtri in un modulo GET: «Persona» («Tutti», le persone del team, «Automazioni») e «Area» («Tutte», Team, Vendite, Conto vendita, Magazzino, Packaging, Finance, Partner, Sviluppo, Contenuti, Impostazioni). All'inizio si vede tutto, anche le azioni di chi guarda.
- Attività divise per giorno (orari di Roma), 50 per pagina. Se le 24 ore non stanno in una pagina, «Attività precedenti» continua dentro le stesse 24 ore. Il cursore è la coppia `occurred_at, id` con i microsecondi.
- Vuoto: «Nelle ultime 24 ore nessuna attività.» (con i filtri: «… per questi filtri.»).
- Ogni riga: ora, frase, area e, se c'è, «Apri elemento». I link (decisione 17) passano da `safeActivityHref` (`src/lib/audit/feed-model.ts`), che accetta solo queste forme: `/team#evento|attivita|nota-<id>`, `/sales#order-<id>`, `/consignment/<CODICE>` e `/consignment/<CODICE>/resoconto/<AAAA-MM>`, `/stock/rettifiche`, `/finance#movimento-<fonte>-<id>` (fonti `budgetflow`, `manual`, `payment`, `refund`, `consignment`, `shop_payment`), `/partner?co=N#lead-N`, `/development#progetto-<id>`, `/assets#contenuto-<id>`, `/auth/account` e le pagine di sezione.
- Le righe della stessa operazione sono una frase (una vendita scrive 6-10 righe). Nella stessa transazione (stesso `occurred_at` e stesso attore) le azioni dello stesso tipo diventano una frase con il numero: «Il sistema ha importato 207 contatti in Partner», «… ha aggiunto 54 appuntamenti nel calendario», «… ha tolto 54 appuntamenti dal calendario», «… ha importato 51 articoli in magazzino». Annullamento e reso di una vendita sono una frase sola, anche con il pagamento eliminato o il rimborso in Finance.
- Privacy (decisione 16, correzione 04-6): nessun importo, categoria, descrizione, motivo, testo dei messaggi o recapito. Finance e incassi dicono solo cosa è successo («Gherardo ha corretto un movimento Finance», «Luca ha registrato un incasso»). L'unico importo è il «da fatturare» del resoconto mensile del conto vendita (03 §10), che ogni membro vede già nella pagina del resoconto.
- Frasi del conto vendita (area «Conto vendita»): conta, resoconto («ha registrato il resoconto di ottobre 2026 di …: 12 pezzi, 134,99 € da fatturare», «ha corretto …», «ha segnato la fattura …» senza numero), ordini, consegne e ritiri, condizioni del negozio. I pagamenti del negozio sono in Finance («ha registrato un incasso da …»).
- Contenuti: «Ettore ha archiviato un contenuto: …» e «… ha ripristinato un contenuto: …».
- Il feed non registra letture, pagine visitate o accessi.

Nota in fondo alla pagina: «Ogni riga riassume un’azione. Il feed non registra le pagine visitate o le letture dei dati.».

## Come è fatto

- Migrazione `20261023091605_ceo_activity_feed.sql` (P6) e correzione `20261023150000_ceo_feed_fixes.sql`: solo funzioni di lettura e tre indici su `audit_logs`, nessuna tabella, trigger o riga toccata. `public.ceo_activity_feed(p_actor, p_area, p_before_at, p_before_id, p_limit)` è il wrapper `security invoker`; `private.ceo_activity_feed` (`security definer`, `search_path` vuoto) controlla `private.can_audit()`; `EXECUTE` solo a `authenticated`.
- Lettura: solo righe con `occurred_at >= now() - 24 ore`, calcolato nel database. Dentro le 24 ore `private.ceo_activity_feed` legge blocchi dal più recente (400, poi fino a 1.600 righe) e passa ogni blocco, completo delle sue transazioni, a `private.activity_feed_window`; si ferma a 51 frasi o dopo circa 4.000 righe. In quel caso il cursore è il confine del blocco (id `00000000-…`) e la pagina successiva riprende da lì.
- `private.activity_feed_window` estrae solo le chiavi ammesse (`private.activity_feed_keys`), risale all'elemento principale con le righe del blocco e, solo per un elemento padre fuori dal blocco, legge per chiave la sua storia (indice `audit_logs_feed_entity`). Poi sceglie la frase, raggruppa per transazione e unisce le azioni dello stesso tipo.
- Indici nuovi: `audit_logs_feed_entity` (tabella e id dell'elemento), `audit_logs_actor_time` (filtro Persona) e `audit_logs_follow_up_task` (solleciti Partner chiusi dall'invio).
- Su una copia locale PostgreSQL 17, la prima pagina richiede circa 70 ms con 24.000 righe più vecchie di 24 ore e 4.500 nelle 24 ore; una pagina filtrata su un'area rara meno di 1 s. Prima della correzione: 6.000 righe in 4,0 s, 9.100 in 11,5 s, 12.200 in 20,9 s.
- `src/lib/audit/feed-model.ts` valida filtri, cursori, righe e link; una riga non valida fa fallire tutta la lettura, senza contenuti parziali. `src/components/audit-view.tsx` disegna la pagina.
- Il vecchio lettore dei metadati (`src/lib/audit/server.ts`, `loadAuditMetadata`) resta nel codice con il suo test, ma la pagina non lo usa più.

## Limiti noti

- Due transazioni dello stesso attore nello stesso microsecondo sono indistinguibili in `audit_logs` e diventano una frase (spec 04, A.2: non realistico).
- Le ancore `#movimento-<fonte>-<id>` esistono oggi in Finance solo per i pagamenti del negozio; per le altre fonti il link apre Finance in cima finché la pagina non le aggiunge.
- Le frasi Partner sono ancora quelle di P6 («ha registrato un invio Partner: …»), non tutte quelle di 02 §10.

## Verifiche

- Vitest: `src/lib/audit/feed-model.test.ts` (link ammessi e rifiutati, area «Conto vendita», anteprima), `src/lib/audit/feed-server.test.ts` (cursore di confine), `src/components/audit-view.test.tsx` (sottotitolo, «Tutti», stati vuoti delle 24 ore), `src/app/(workspace)/audit/page.test.tsx` (accesso, area chiusa, filtri non validi, «Chiudi Controllo CEO» solo dopo la verifica, anteprima locale spenta con `VERCEL=1` e `NODE_ENV=production`).
- PostgreSQL 17: `supabase/tests/ceo-activity-feed.mjs` (riga `// test-db: postgres minimo 327`): privacy per ogni tabella Finance, frasi e link per area, raggruppamenti (vendita, import di 207 contatti, 54 appuntamenti e la loro pulizia, inventario), annullamento e reso, archivio e ripristino, founder nella vista iniziale, 24 ore, permessi delle funzioni. `supabase/tests/ceo-activity-feed-scale.mjs` (minimo 28): oltre 24.000 righe sintetiche più vecchie di 24 ore, tempi, indici con EXPLAIN, nessuna scansione completa, stesse righe lette con 6.000 o 24.000 righe vecchie. `area-passwords.mjs` e `sensitive-area-members.mjs` per il gate. Numeri in [verifiche](verification.md).
