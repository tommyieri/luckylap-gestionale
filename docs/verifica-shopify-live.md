# Verifica finale del collegamento Shopify attivo

Verifica indipendente in sola lettura del progetto `annvatqnllkbrtufmgnl`, 21 ottobre 2026, dalle 15:03:56 alle 15:10:33 UTC. Nessuna vendita di prova, scrittura SQL, modifica di account, ordine o movimento di magazzino. Non letti header della coda, valori Vault, comandi Cron grezzi o contenuti delle risposte: per i due HTTP 503 sono stati calcolati esclusivamente tre boolean esplicitamente autorizzati.

## Dati e configurazione verificati

| Controllo | Risultato |
| --- | --- |
| Prodotti / SKU fisici / asset | 9 / 51 / 6 |
| Celle stock / quantità sconosciute | 102 / 0 |
| Giacenza fisica | 214, tutte le 102 coppie SKU/località identiche all'estrazione originale autorizzata del Drive |
| Località operative | Magadzino (`MAG01`) attiva, 214; LCM (`NEG01`) attiva, 0; FORN e VEND disattivate |
| Catalogo Shopify | 60 varianti attive, 51 collegate, 9 senza collegamento fisico; zero mapping SKU discordanti |
| Membri / Finance / CEO | 5 attivi, 3 ammessi a Finance, 1 founder |
| Import Finance | 1 batch, 144 righe tutte unreviewed, 1 pending, 2 future rispetto al 21 ottobre 2026 |
| Finance contabile | 0 scritture approvate |
| Ordini, righe, pagamenti, rimborsi, fatti commerciali | tutti 0 |
| Riserve, fabbisogni, ricevute produzione, fulfillment | tutti 0 |
| Movimenti stock diversi dagli opening | 0 |
| Inbox Shopify, job/lease, identità ed effetti | tutti 0 |

`manual_sales_enabled=true` e cutover esatto `2026-10-21T14:06:47.976341Z` sono preservati. La sincronizzazione DB risulta `enabled=true` per il negozio configurato. La località online è Magadzino e il mapping Shopify `gid://shopify/Location/109039452490` punta a `MAG01`, attiva e di tipo Magazzino. LCM resta separato dal percorso di vendita diretta.

Sono presenti 15 migration applicate, comprese `20261021144441_shopify_sales_core`, `20261021144451_shopify_canonical_worker` e `20261021145438_shopify_scheduler`.

## Scheduler e risposte effettive

Il job `luckylap-shopify-worker` è attivo, eseguito come `postgres`, ogni minuto (`* * * * *`). Stato scheduler: una riga, configurata alle 14:59:51 UTC. Vault: COUNT pari a uno; nessun valore ispezionato.

Alle **15:10:33 UTC** risultano **11 esecuzioni Cron succeeded**, **9 risposte HTTP 200** e **2 risposte HTTP 503**, tutte con `timed_out=false`. Nessun fallimento Cron osservato.

| Tick UTC | HTTP osservato |
| --- | ---: |
| 15:06 | 503 |
| 15:07 | 200 |
| 15:08 | 503 |
| 15:09 | 200 |
| 15:10 | 200 |

Per entrambi i 503 i soli boolean autorizzati risultano `status=uncertain`, `claimed=0`, `error=worker_unavailable`. È quindi verificato l'arresto prudente prima di prendere qualsiasi job. Non è stata letta la risposta grezza né attribuita una causa tecnica non dimostrata. I due tick successivi all'ultimo errore, 15:09 e 15:10, sono tornati entrambi HTTP 200. Gli episodi rimangono registrati: questa verifica non dichiara assenza di errori HTTP.

L'esito succeeded del Cron prova l'esecuzione del dispatch, mentre le risposte HTTP verificano separatamente la chiamata asincrona. Non sono stati confusi con l'applicazione di una vendita: nessun ordine reale era presente nel periodo di controllo.

## Accessi e advisor

- Il configure scheduler resta eseguibile soltanto da service_role; il dispatch non è eseguibile da anon, authenticated o service_role. Lo stato privato ha RLS e nessun grant diretto per questi ruoli.
- Le tre nuove tabelle Finance mantengono RLS subordinata a `private.can_finance()`, nessun SELECT anon e nessun DML autenticato.
- Nessun login SQL personalizzato/non standard rilevato; i tre ruoli client sono NOLOGIN. Il ruolo provider `supabase_functions_admin` resta distinto dagli account del team.
- Il probe REST con chiave client pubblicabile, `Accept-Profile: net` e `select=id&limit=0` restituisce ancora HTTP 406 / `PGRST106`, anche dopo l'attivazione e la creazione del segreto. Lo schema net resta escluso dalla Data API. Il limite di accesso SQL diretto alla coda è descritto in [verifica-pg-net.md](./verifica-pg-net.md).

Gli advisor non mostrano nuovi warning dello schema applicativo: rimane il warning Auth preesistente sulle password compromesse ([riferimento Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)). Sono presenti 17 INFO sulle tabelle private intenzionalmente senza policy ([RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)), 18 INFO FK della baseline ([FK](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)) e 21 INFO indici ancora inutilizzati ([indici](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)). Nessuna impostazione o abbonamento modificato.

L'attivazione del deployment, le sottoscrizioni webhook e la query di recupero del gap sono state eseguite dal responsabile e non ripetute qui. Questo report attesta i dati e gli stati DB/API letti direttamente; la logica degli ordini rimane inoltre coperta dai 702 controlli locali PostgreSQL documentati in [shopify-ecosystem.md](./shopify-ecosystem.md).

Evidenze locali senza segreti o Finance grezzo: `.private/deployment-proof/shopify-live-final-read-only.json` e `shopify-live-http-recovery.json`, escluse da Git.
