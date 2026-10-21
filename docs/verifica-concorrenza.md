# Verifica della concorrenza su PostgreSQL reale

Il 21 ottobre 2026 la suite locale ha superato **39 controlli in 7 casi** su **PostgreSQL 17.11 Homebrew**, con processi backend distinti. Non è una prova PGlite. Non sono stati effettuati accessi, scritture, attivazioni di flag o chiamate Shopify sul cloud.

La prova è terminata tra le 13:18:09 e le 13:18:11 UTC. Il postmaster aveva PID `15682`; le tre connessioni avevano PID observer `15689`, worker A `15690`, worker B `15691`. Le transazioni usavano `READ COMMITTED`. In tutti e sei i casi con due transazioni sovrapposte, `pg_stat_activity` ha osservato B attivo in attesa `Lock` e `pg_blocking_pids(15691) = {15690}` prima del commit/rollback di A. Il replay attendeva il lock `advisory`; gli altri casi attendevano `transactionid`.

Il test orchestra la contesa: A completa il comando senza chiudere la transazione, B invia il proprio comando e viene osservato in attesa del lock, poi A effettua commit oppure rollback. Questo verifica la serializzazione effettiva delle transazioni concorrenti; non è uno stress test con scheduling casuale.

| Caso | Risultato verificato dopo entrambe le transazioni |
| --- | --- |
| Due consegne per l’ultimo capo pronto | Una vendita confermata, una rifiutata con `22023 insufficient_ready_stock`; giacenza 0, un ordine e un movimento, riserve 0. |
| Stesso operation UUID concorrente | Entrambe le richieste restituiscono lo stesso ordine; la seconda è replay. Un solo ordine, movimento, pagamento e outbox; due fatti distinti vendita/pagamento. |
| Due ordini in preparazione per un capo | Entrambi accettati: giacenza fisica 1, riservato totale 1, un solo capo da produrre; nessun movimento fisico. |
| Riserva prima di una rettifica −1 | La rettifica concorrente è rifiutata con `22023 reserved_stock_conflict`; giacenza 1 e riservato 1. |
| Rettifica −1 prima della preparazione | La preparazione legge la giacenza aggiornata a 0 e richiede produzione per 1; nessuna riserva fittizia. |
| Vendita A annullata mentre B attende | Il rollback di A libera il capo; B conclude. Rimane un solo ordine/movimento; nessun ordine o audit dell’operazione annullata. |
| Errore su una seconda riga | Un trigger esclusivamente di test emette una NOTICE dopo l’effetto fisico della prima riga; l’errore successivo annulla tutto. Conteggi di ordini, righe, pagamenti, fatti, movimenti, riserve, eventi, produzione, consegne, audit e outbox identici a prima; entrambe le giacenze ripristinate. |

È stato anche tentato un inserimento owner che avrebbe sovrariservato la seconda riga preparata: il trigger di guardia ha rifiutato `reserved_stock_conflict`, mantenendo riservato totale 1. Dopo ciascun caso si è verificato che nessuna giacenza fosse negativa e nessuna somma delle riserve superasse il fisico. `finance_entries` e `finance_import_transactions` sono rimasti vuoti nella fixture sintetica.

## Harness e riproduzione

I file sono `supabase/tests/sales-concurrency.sh` e `supabase/tests/sales-concurrency.mjs`. Il programma accetta soltanto i percorsi assoluti del runtime PostgreSQL 17 e del modulo Node `pg`, crea autonomamente il cluster in `/private/tmp`, e non accetta URL/DSN di database esterni. Il client utilizzato era **pg 8.23.1**, installato con versione esatta fuori dal repository, senza modifiche a `package.json` o lockfile del progetto.

```sh
sh supabase/tests/sales-concurrency.sh \
  /opt/homebrew/opt/postgresql@17/bin \
  /private/tmp/luckylap-pg17-client/node_modules/pg/lib/index.js
```

L’harness crea un socket Unix in una directory privata, con permessi `0700`, sceglie una porta disponibile e avvia PostgreSQL con `listen_addresses=''`: nessun listener TCP del database. Auth e metadata Storage sono simulati; le tabelle e funzioni di dominio provengono dalle quattro migrazioni originali, senza riscrivere il codice di business:

| Migrazione | SHA-256 |
| --- | --- |
| `20261021114636_initial_schema.sql` | `501ff660f99f8cfcefc4fb37f2cfa19f1164346b4f385ad7e5a61b59134e8868` |
| `20261021114642_finance_imports.sql` | `f9ac1370b08269f8f64ff64f038fbaed1a81e9bddc76e3d86a0ed5b501728026` |
| `20261021121044_sales_ecosystem.sql` | `2dac4f7312afbe3fc068ff33fb8886de5eedd99c2053051826f867457139f4a8` |
| `20261021121046_sales_lifecycle.sql` | `df001dd9a07b712b8a3c943449e931188951be53e25f30c1289221e57e9c6238` |

I risultati dettagliati, i PID, le attese e i risultati sintetici sono conservati in `.private/deployment-proof/sales-concurrency.json`, escluso da Git e Vercel. La semantica di lock e isolamento è stata verificata nella documentazione ufficiale [PostgreSQL 17: lock espliciti](https://www.postgresql.org/docs/17/explicit-locking.html) e [isolamento](https://www.postgresql.org/docs/17/transaction-iso.html); l’API client è documentata da [node-postgres](https://node-postgres.com/apis/client).

## Runtime e pulizia

PostgreSQL non era presente. È stata installata la formula ufficiale `postgresql@17` senza analytics, auto-update, cleanup o controllo/aggiornamento dei dipendenti esistenti, usando `--skip-post-install --skip-link`. Nessun `brew services`, autostart o cluster standard è stato creato. Due avvii iniziali hanno rilevato i percorsi share/timezone mancanti a causa del postinstall saltato; la causa è stata verificata e risolta creando soltanto i due link di directory della formula, prima assenti: `/opt/homebrew/share/postgresql@17` e `/opt/homebrew/lib/postgresql@17`. Il cluster del test è stato poi avviato con successo.

Homebrew ha installato dipendenze necessarie, fra cui OpenSSL 4, e aggiornato ca-certificates, readline e xz. Aveva inoltre sostituito i 6.566 link globali della versione OpenSSL 3.6.3 già presente. Dopo la prova sono stati rimossi i link di OpenSSL 4 e ripristinati esattamente 6.566 link di OpenSSL 3, senza sovrascrivere file o disinstallare dipendenze. `/opt/homebrew/bin/openssl` punta nuovamente alla 3.6.3; OpenSSL 4 rimane disponibile nel proprio percorso per PostgreSQL. Il runtime PostgreSQL risponde ancora correttamente a `--version`.

Il postmaster e tutti e tre i backend del test sono terminati; `ps` non trova più i quattro PID. Il cluster temporaneo e il relativo log sono stati rimossi. Non sono state modificate configurazioni shell, variabili del progetto o credenziali.

Questa verifica copre i casi elencati su PostgreSQL locale con Auth simulato. Non sostituisce le verifiche JWT/PostgREST/Supabase già separate, né dimostra l’assenza di ogni possibile deadlock o problema sotto carico.
