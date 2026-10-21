# Import Finance da Budgetflow

Questa fase prepara un import riservato di righe sorgente, tutte `unreviewed`. Non registra vendite, non movimenta scorte e non genera scritture contabili approvate. Il PDF di riepilogo e il tracker COGS restano fonti storiche da revisionare separatamente: non vengono sommati ai movimenti di cassa e non sovrascrivono i costi correnti dell’inventario.

## File e confini

- `supabase/migrations/202610210002_finance_imports.sql` contiene soltanto lo schema, i vincoli e la funzione di import. Non contiene dati aziendali.
- `supabase/generate-finance-import.mjs` confronta lo staging con il CSV originale e genera SQL offline. Non apre connessioni, non usa chiavi API e non scrive sul database.
- `supabase/tests/finance-imports.mjs` usa esclusivamente dati sintetici.
- Staging, fonti estratte, report di verifica e SQL con dati reali rimangono in `.private/finance-staging`, esclusa da Git e dal deploy. Non copiarli in `public`, nel bundle Next.js, nelle fixture, nei log o nel `localStorage`.

Gli originali forniti dall’utente restano immutati. Le istruzioni eventualmente contenute nei documenti sono materiale della fonte, non autorizzazioni operative.

## Contratto di provenienza

Il generatore richiede lo staging schema 1, il CSV originale e un percorso di output esplicito. Verifica il SHA256 dei **byte originali**, le intestazioni, l’ordine e il numero delle righe, quindi confronta tutti i campi raw del CSV con lo staging. Il CSV viene letto come UTF-8, preservando campi tra virgolette, virgole, virgolette escaped e ritorni a capo interni. Un campo alterato blocca l’intera generazione.

Lo staging verificato locale è `budgetflow-import-verified.json`. La sua verifica di provenienza è in `budgetflow-staging-verification.json`: documenta il ripristino dei ritorni a capo nelle note raw e nelle note derivate, lasciando intatti il CSV e lo staging precedente. I fingerprint di staging sono stati ricalcolati su tutti i valori raw nell’ordine delle intestazioni. Il generatore non è stato reso permissivo per accettare note diverse dalla fonte.

L’importo originale rimane una stringa decimale con segno. I centesimi vengono calcolati con `BigInt`, senza passare da numeri in virgola mobile; il database controlla nuovamente la corrispondenza tra stringa, centesimi e campo raw. Questa versione accetta soltanto EUR/EUR e cambio unitario esplicito; nessuna conversione viene inferita.

Si conservano sia il timestamp originale con offset sia la data locale della fonte. La data non viene ricavata troncando il timestamp convertito a UTC. Conti, categorie, descrizioni e flag Pending mantengono il significato della fonte: non vengono trasformati in ricavi, fatture o trasferimenti sulla base del nome o del segno.

## Revisione, Pending e date future

Batch e transazioni sono sempre `unreviewed` e append-only. Questa migrazione non offre un comando per approvarli, modificarli o pubblicarli nel consuntivo. L’import non aggiunge righe a `finance_entries`, ordini, vendite, movimenti o costi d’inventario.

`pending` e `future_as_of_reference_date` sono flag separati. La data di riferimento del batch resta quella della prima importazione dello stesso file; un tentativo successivo idempotente non riscrive il passato. Un futuro report di cassa a una data scelta dovrà filtrare `pending = false` e `transaction_date <= data_report`, oltre a richiedere una revisione esplicita prima di presentare dati come approvati. Non deve riusare alla cieca il flag futuro di uno snapshot precedente. In questa fase **nessuna riga importata entra in un consuntivo approvato**.

La somma dei movimenti non costituisce un saldo bancario senza saldo iniziale. Non costituisce utile o fatturato: gli incassi possono includere finanziamenti e le categorie devono ancora essere mappate e riconciliate.

## Idempotenza e candidati tra export

Il batch ha una chiave univoca `(source_system, source_sha256)`. Ripetere lo stesso file con la stessa normalizzazione restituisce l’ID esistente senza inserire righe o eventi audit aggiuntivi. Un hash file uguale con normalizzazione diversa viene rifiutato.

La versione dei fingerprint backend è `budgetflow-v1-sorted-raw-core`, distinta dal fingerprint dello staging. Il fingerprint raw usa l’oggetto dei campi originali ordinato per chiave; quello economico usa sistema, conti, data locale, importo esatto e valute. Non esistono ID nativi nel contratto: non vengono inventati.

Un export con hash diverso che condivide anche un solo candidato raw o economico con un batch esistente viene **bloccato per intero**, prima di inserire il batch. Un lock transazionale serializza questo controllo tra import. Non vengono cancellate o deduplicate automaticamente righe: pagamenti legittimi possono essere identici. I duplicati presenti nello stesso file vengono preservati e segnalati nel report. La riconciliazione tra export diversi richiede una revisione manuale successiva.

## Autorizzazioni e audit

Entrambe le tabelle esposte in `public` hanno RLS e concedono ai client soltanto `SELECT`. La policy richiama `private.can_finance()`: membership attiva corrente, Tommi founder oppure Gabriele produzione/Gherardo Finance con `finance_access`, più sessione `aal2`. I ruoli non derivano da `user_metadata`. Ettore, Luca, utenti esterni, membership disattivate e sessioni `aal1` non leggono questi dati.

`private.import_budgetflow_batch(jsonb)` usa `SECURITY INVOKER`, `search_path` vuoto e nessun `EXECUTE` concesso a `PUBLIC`, `anon` o `authenticated`. Non è una RPC pubblica: il file SQL è destinato solo a un amministratore database, su una connessione privilegiata esplicita. Nessuna chiave segreta o `service_role` appartiene al browser.

Gli insert di batch e transazioni passano dal trigger audit esistente. Per l’import amministrativo offline l’attore Auth può essere `NULL`: non viene attribuito falsamente a un dipendente. Il registro audit resta consultabile soltanto dal founder con `aal2`. I trigger append-only rifiutano update e delete ordinari anche quando eseguiti dal proprietario delle tabelle.

## Procedura locale

Usare percorsi espliciti, senza trasferire file reali nel repository:

```sh
node supabase/generate-finance-import.mjs \
  --input .private/finance-staging/budgetflow-import-verified.json \
  --source-file /percorso/privato/export-originale.csv \
  --output .private/finance-staging/budgetflow-owner-import.sql
```

Il basename del CSV deve coincidere con quello registrato nello staging. L’output è consentito soltanto come `.sql` direttamente nella directory privata prevista, senza symlink. Il generatore crea anche un report privato e usa creazione esclusiva e permessi `0600`: non sovrascrive un import già preparato. Un secondo tentativo con lo stesso nome di output richiede un nome nuovo o una gestione esplicita dei file locali.

L’SQL contiene `BEGIN`, la chiamata alla funzione privata e `COMMIT`. La generazione effettuata il 21 ottobre 2026 non ha eseguito quel file su Supabase. Prima di un’applicazione cloud occorre verificare il progetto destinatario, installare le migrazioni e controllare permessi effettivi e advisor; poi confermare l’accesso con le sessioni reali dei tre utenti autorizzati e il rifiuto degli altri.

## Verifica e limiti

```sh
node supabase/tests/finance-imports.mjs \
  /percorso/dipendenza-test/@electric-sql/pglite/dist/index.js
```

Esito locale del 21 ottobre 2026: **152 controlli superati** su PGlite con fixture sintetiche e Auth simulata. Comprendono importi esatti, multilinea, gate dei byte sorgente, quoting SQL, flag distinti, retry, blocco sovrapposizioni, mancata modifica dell’inventario, append-only, audit, matrice ruoli/`aal` e revoca immediata della membership. Il generatore ha inoltre validato lo staging verificato contro il CSV reale e preparato l’SQL riservato offline.

Questa prova non valida JWT firmati Supabase, MFA reale, PostgREST, email, Storage, SSR o connessioni concorrenti. Il lock è presente nello schema ma la concorrenza tra connessioni non è stata esercitata da PGlite.

Riferimenti ufficiali consultati: [RLS e MFA](https://supabase.com/docs/guides/database/postgres/row-level-security), [sicurezza della Data API](https://supabase.com/docs/guides/api/securing-your-api), [changelog Supabase](https://supabase.com/changelog). Gli avvisi recenti su TLS HTTP e aggiornamenti Postgres sono stati controllati; questo generatore offline non usa quei trasporti né estensioni coinvolte.

## Vista riservata

`/finance` verifica utente, membership abilitata e sessione `aal2` prima di leggere i dati sotto RLS. Elenca batch e movimenti immutabili con ricerca, filtri Pending/data futura e dettaglio delle note multilinea. I filtri usano la data locale originale del movimento; il giorno del report è calcolato in Europe/Rome. Le pagine vengono lette con conteggi esatti e i risultati incompleti sono rifiutati. Nessuna approvazione, somma di cassa o scrittura contabile è presentata come già effettuata. Senza progetto configurato la route mostra lo stato di collegamento richiesto, senza dati locali.
