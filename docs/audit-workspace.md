# Controllo CEO: il feed di cosa fa il team

`/audit` («Controllo CEO») mostra un feed in sola lettura: una frase per ogni azione sui dati condivisi, con chi l'ha fatta, dalla più recente. Per esempio «Luca ha aggiunto una call: …» o «Il sistema ha ricevuto un ordine (2 unità · Shopify online).». Il registro tecnico dei trigger (`audit_logs`, con prima e dopo) resta nel database e non si mostra nella pagina. Il feed è arrivato con la pull request #3 di Codex (P6), in produzione dal 23 ottobre 2026.

## Chi lo vede

- Solo il founder, con la password CEO aperta in questa sessione (fino a 8 ore dall'apertura). La pagina (`src/app/(workspace)/audit/page.tsx`) verifica utente, membership attiva, ruolo (`isSensitiveAreaEligible(member, "audit")`) e area aperta (`verifiedSensitiveAccess`); se l'area è chiusa porta a `/auth/area/audit`.
- Il loader (`loadActivityFeed` in `src/lib/audit/feed-server.ts`) rifiuta prima della query chi non può leggere l'area. La funzione `private.ceo_activity_feed` ripete il controllo nel database (`private.can_audit()`): resta lei l'autorità.
- In cima alla pagina, dopo la verifica, la striscia «Controllo CEO aperto su questo dispositivo, fino a 8 ore dall’apertura.» con «Chiudi Controllo CEO» (06 R12). La pagina non ha un ramo dell'anteprima locale: senza Supabase mostra lo stato «da collegare».
- Il proxy copre `/audit/:path*` (cookie aggiornati e `no-store`).

## Cosa mostra

- `h1` «Controllo CEO», sotto «Le attività del team e delle automazioni, dalla più recente.».
- Filtri in un modulo GET: «Persona» (collaboratori, automazioni o una persona) e «Area» (Team, Vendite, Magazzino, Packaging, Finance, Partner, Sviluppo, Contenuti, Impostazioni). All'inizio le azioni di chi guarda sono escluse: si vedono scegliendo il proprio nome.
- Attività divise per giorno (orari di Roma), 50 per pagina, con «Più recenti» e «Attività precedenti». Il cursore è la coppia `occurred_at, id` con i microsecondi.
- Ogni riga: ora, frase, area e, se c'è, «Apri elemento». I link sono solo percorsi interni controllati da `safeActivityHref` (`src/lib/audit/feed-model.ts`): `/team#evento-…`, `/sales#order-…`, `/partner?co=N#lead-N`, `/finance`, `/development#progetto-…` e le pagine di sezione.
- Le azioni della stessa operazione sono raggruppate in una frase (per esempio vendita, righe e riserve); le operazioni indipendenti restano distinte. I solleciti chiusi da un invio o da una risposta Partner non danno una frase in più.
- Il feed non registra letture, pagine visitate o accessi.

Nota in fondo alla pagina: «Ogni riga riassume un’azione. Il feed non registra le pagine visitate o le letture dei dati.».

## Come è fatto

- Migrazione `20261023091605_ceo_activity_feed.sql`: solo funzioni di lettura, nessuna tabella, nessun trigger nuovo. `private.activity_feed_actions()` legge `audit_logs`, estrae solo chiavi e pochi campi (titolo, categoria, importi, quantità, canale, stato), toglie recapiti, link e codici dal testo, risale all'elemento principale e sceglie la frase. `public.ceo_activity_feed(p_actor, p_area, p_before_at, p_before_id, p_limit)` è il wrapper `security invoker`; `EXECUTE` solo a `authenticated`.
- Ogni richiesta ricalcola le frasi su tutto `audit_logs`, poi filtra e pagina (vedi «Limiti noti»).
- `src/lib/audit/feed-model.ts` valida filtri, cursori, righe e link; una riga non valida fa fallire tutta la lettura, senza contenuti parziali. `src/components/audit-view.tsx` disegna la pagina.
- Il vecchio lettore dei metadati (`src/lib/audit/server.ts`, `loadAuditMetadata`) resta nel codice con il suo test, ma la pagina non lo usa più.

## Limiti noti

Trovati in revisione il 23 ottobre 2026, da decidere con Tommi; l'elenco completo è in [verifiche](verification.md), «Problemi noti dopo P4-P6».

- Le frasi Finance mostrano categoria e importi, anche degli incassi, contro la decisione 16 del piano.
- Il ricalcolo completo a ogni richiesta rallenta con la crescita del registro: su una copia locale PostgreSQL 17 circa 7.500 righe di audit richiedono 6 s e 9.500 circa 11 s, oltre il limite di 8 s di Supabase. Oggi la produzione ha circa 2.200 righe.
- Un import (Partner, inventario) dà una riga per record, non una frase per operazione.
- Link e aree diversi dalla decisione 17 (conto vendita sotto «Vendite» verso `/sales`, Finance senza l'ancora del movimento); il sottotitolo non è quello della decisione 5; le azioni del founder sono nascoste all'inizio.
- Archiviare o ripristinare un contenuto in «Grafica e foto» si legge «ha aggiornato un contenuto».

## Verifiche

- Vitest: `src/lib/audit/feed-model.test.ts`, `src/lib/audit/feed-server.test.ts`, `src/components/audit-view.test.tsx`, `src/app/(workspace)/audit/page.test.tsx` (accesso, area chiusa, filtri non validi, «Chiudi Controllo CEO» solo dopo la verifica).
- PostgreSQL 17: `supabase/tests/ceo-activity-feed.mjs` (riga `// test-db: postgres minimo 121`), con Auth e dati sintetici; `area-passwords.mjs` per il gate. Numeri in [verifiche](verification.md).
