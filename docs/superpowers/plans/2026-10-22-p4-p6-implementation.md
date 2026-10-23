# P4–P6 Finance, collegamenti e CEO — piano di implementazione

**Obiettivo:** rendere Finance correggibile, collegare Partner al lavoro quotidiano e offrire un feed CEO leggibile senza interferire con P2/P3.

**Architettura:** fonti immutabili e revisioni append-only; RPC atomiche e proiezioni condivise, letture sotto la sessione del chiamante. Trigger di collegamento in migrazioni aggiuntive e riquadri Oggi isolati. Il feed CEO riduce lo storico tecnico a DTO per azione.

**Stack:** Next 16.4.2, React 19.3.1, Supabase/PostgreSQL 17, TypeScript, Vitest e harness SQL esistenti. Nessuna nuova libreria UI.

**Specifica:** `docs/superpowers/specs/2026-10-22-p4-p6-design.md`.

**Aggiornamento del 23 ottobre:** Tommi ha confermato la consegna P2/P3 e autorizzato l’integrazione e il merge su main. I vincoli di attesa e di consegna in bozza sotto descrivono la fase iniziale; lo stato corrente e le verifiche finali sono in `docs/p4-p6-stato.md`.

## Vincoli globali

Seguire AGENTS.md, DESIGN.md e la proprietà dei file. P3 termina i file Finance condivisi prima dell'integrazione P4. Nessuna mutazione cloud o main; dati sintetici soltanto. Centesimi interi, Europe/Rome, password d'area invariate. Le migrazioni P5 dipendono dallo schema P2/P3 pubblicato e saranno provate su una copia di integrazione, mai applicate al cloud senza approvazione.

## Punti di revisione

1. Consegne ripetute, retry e doppi invii non duplicano importi o attività.
2. Correzioni contemporanee e ripristini obsoleti falliscono senza cancellare il primo cambiamento.
3. Ordini Shopify riletti dopo una correzione non sovrascrivono la dichiarazione Finance né falsificano la fonte.
4. Date Partner senza orario, ora legale e date cambiate mantengono un solo appuntamento coerente.
5. Paginazione e filtri CEO non separano le righe di una singola azione o rivelano dati senza area autorizzata.

## 1. Isolamento e contratti

- Base `origin/main`; branch `codex/p4-p6-finance-collegamenti-ceo` pubblicato fin dal piano.
- Contratti P2: `partners`, `partner_activities`, attività `inviato/risposta`, origine `team/file`, CO per link canonico.
- Contratti P3: `consignment_report_payments`, `update_consignment_payment` con expected_version; FinanceDashboardOptions con shopPayments; adapter `loadConsignmentToSettle`.
- Tenere i lavori Claude come dipendenze, senza modificare né importare il suo WIP.

## 2. P6 read model e sicurezza

File nuovi `src/lib/audit/feed-model.ts`, `feed-server.ts`, test, migrazione `ceo_activity_feed` generata dalla CLI e harness sintetico.

Interfaccia prodotta: `loadActivityFeed(supabase, member, unlocked, query): Promise<ActivityFeedPage>`. Query `{actor: string|null, area: ActivityArea|null, before: ActivityCursor|null}`. Pagina `{items, actors, nextCursor, hasCursor}`. Item `{id, occurredAt, actorId, actorName, area, message, href}`. Cursor conserva timestamp PostgreSQL e ID senza arrotondare i microsecondi. `ActivityArea`: team, sales, stock, packaging, finance, partner, development, assets, settings.

RPC nuova, protetta da `private.can_audit()`, che raggruppa prima di filtrare e paginare. Seleziona soltanto campi consentiti e non passa JSON grezzo. Identità dei gruppi basata su operazione e radice, mai intervalli temporali approssimativi; riletture complete dello stesso gruppo anche a cavallo del limite. Per le scritture storiche senza operation_id usare identità esatta del timestamp della transazione e autore, con riduzione per entità per non unire azioni indipendenti. Coprire vendite/consegne, pagamenti, stock, Team, Finance, contenuti, sviluppo e, con adattatori separati, P2/P3.

Test prima del codice: ruoli negati, gate scaduto/assente, gruppi su confine pagina, filtri prima del limite, due azioni indipendenti simultanee, dati eliminati e nessun JSON/recapito tecnico nel DTO.

## 3. P6 UI

Modificare soltanto `src/components/audit-view.tsx`, `audit.module.css`, pagina `(workspace)/audit/page.tsx` e relativi test. Consumare il contratto del punto 2. Frasi e giorni, form GET per filtri conservati nella paginazione, nessuna tabella tecnica. Riutilizzare il guscio e i token. Anteprima sintetica isolata per verifica visiva; nessuna strada QA pubblicata.

## 4. P4 nucleo delle revisioni

Nuovi `src/lib/finance-revisions/{model,server,projection}.ts` e test; migrazione generata CLI `finance_revisions`, harness PGlite e concorrenza. Nessuna modifica iniziale ai file Finance occupati da Claude.

Identità stabile per tipo/fonte; versioni complete con operation_id, expected_version, autore, istante, motivo, stato eliminato. Comandi `update`, `delete`, `restore` con ricevuta di retry, CAS e validazione del dato originario dal server. Fonte originale immutata. Le osservazioni esterne si correggono per dichiarazione versionata, non riscrivendo la fonte. Incassi P3 delegati al suo RPC per gli importi/data/metodo/stato, attribuzioni coerenti con il medesimo pagamento.

Test: permessi Finance e gate corrente, importi/segno/date/pending, ID di origine falsificato, replay e conflitto, eliminazione/ripristino e sorgente immutabile, somma esatta e nessun doppio incasso, nuova osservazione Shopify dopo correzione.

## 5. P5 automazioni e giorno intero

Nuove migrazioni e `src/lib/work-links/**`; modifiche Team limitate a dettagli di appuntamento giornata intera e rendering. Nessun file Partner/consignment di Claude.

Trigger su attività Partner di origine team e aggiornamenti date, ricevute/link FK persistenti, sollecito per attore a +7 giorni. Risposta chiude soltanto i solleciti dello stesso Partner già aperti. Tabelle di collegamento per appuntamenti e progetti/attività da esiti; RPC manuale idempotente quando l'esito richiede una scelta. Creazione di progetto produzione solo da comando umano, non interpretando testo libero.

Test: import storico senza effetti, doppio inviato/replay, risposta e nuovo ciclo contatto, aggiornamento data/annullamento, DST e giornata intera, modifica autonoma del team conservata, attore dalla sessione e autorizzazioni di tutti i cinque membri.

## 6. P5 Oggi

File `src/lib/today/**`, `src/components/today/**` e pagina home se necessario. Nuovi riquadri per contatti/solleciti e ordini pendenti; integrazione P3 per crediti e fatture soltanto dopo sua consegna. Lettura Finance con sessione fresca, nessun importo nel payload per gli altri. Link alle fonti canoniche e stati vuoti/errore indipendenti.

## 7. Integrazione P4 e dipendenze P2/P3

Quando Claude pubblica i contratti finali, aggiornare una copia di integrazione e verificare i diff. Applicare P4 al nuovo contratto FinanceDashboardOptions senza rimuovere shopPayments o gli slot consignment. Editor, eliminati e storico su ogni movimento; ripristino da versione e conflitto leggibile. Aggiornare Vendite alla stessa proiezione delle correzioni di pagamento. Integrare feed P6 con revisioni P4 e eventi P2/P3 senza tocchi nei loro file di proprietà.

## 8. Verifica e consegna

Revisioni indipendenti dei punti 2/4/5 e del ramo completo. `npm run format`, `format:check`, `typecheck`, `test`, `build`, `test:db` con PG17 già presente. Una tornata desktop+390 px, detector Impeccable una volta, correzioni in un batch e una conferma. Nessuna installazione globale. Pubblicare ramo e PR con dipendenze e verifiche; merge, migrazioni cloud e deploy restano alla conferma finale.
