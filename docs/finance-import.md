# Import Finance da Budgetflow

Questa fase prepara un import riservato di righe sorgente, tutte `unreviewed`. Non registra vendite, non movimenta scorte e non genera scritture contabili approvate. Il PDF di riepilogo e il tracker COGS restano fonti storiche da revisionare separatamente: non vengono sommati ai movimenti di cassa e non sovrascrivono i costi correnti dell’inventario.

## File e confini

- `supabase/migrations/20261021114642_finance_imports.sql` contiene soltanto lo schema, i vincoli e la funzione di import. Non contiene dati aziendali.
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

L’SQL contiene `BEGIN`, la chiamata alla funzione privata e `COMMIT`. Il file è stato successivamente applicato al progetto `annvatqnllkbrtufmgnl` dopo verifica della destinazione e delle policy. Il confronto cloud conferma tutte le 144 righe e i fingerprint; le prove con JWT/MFA reali hanno verificato la matrice dei cinque ruoli usando un account QA separato. Le sessioni personali dei membri richiedono ancora la loro attivazione. Vedere `verifica-import-cloud.md` e `verifica-auth-cloud.md`.

## Aggiornare lo storico da un nuovo export completo

`supabase/reconcile-finance-export.mjs` confronta un nuovo CSV completo con le righe già archiviate. L’anteprima conserva i numeri di riga del nuovo CSV e distingue le corrispondenze esatte, le date diverse a parità di tutti gli altri campi, le righe nuove e i casi da chiarire. Voci senza corrispondenza nello storico e candidati ambigui bloccano la generazione dell’SQL. Le date diverse richiedono una scelta esplicita per riusare la riga esistente con le sue revisioni. Le modifiche manuali si fanno dalla scheda del movimento in Finance.

1. Salva in `.private/finance-staging` i risultati delle query in sola lettura stampate da `node supabase/reconcile-finance-export.mjs --baseline-query` e `node supabase/reconcile-finance-export.mjs --register-query`. La prima restituisce l’array dello storico BudgetFlow, la seconda un oggetto con le voci manuali, gli incassi degli ordini e la loro impronta. Se usi `psql` con una connessione già configurata al database di destinazione, i flag `-XAt` restituiscono il JSON senza intestazione. Usa `umask 077` prima di scrivere i file.
2. Genera l’anteprima offline.

   ```sh
   node supabase/reconcile-finance-export.mjs \
     --source /percorso/privato/export-originale.csv \
     --baseline .private/finance-staging/baseline.json \
     --register .private/finance-staging/registro.json \
     --extracted-at '2026-11-13T12:00:00+01:00' \
     --as-of 2026-11-13 \
     --output .private/finance-staging/anteprima
   ```

3. Controlla `anteprima.report.json`. Crea un JSON privato con `source_sha256`, `ledger_sha256` e `register_sha256` copiati dal report. Nell’array `keep_existing`, per ogni voce in `date_changes` aggiungi una decisione con `source_row`, `existing_id`, `expected_version` e il motivo in `reason`. Per ogni voce in `register_candidates`, aggiungi a `register_matches` la riga `source_row`, l’ID `existing_id` del movimento da conservare o `null` per importare il nuovo movimento, e la motivazione `reason`. I candidati del registro hanno stesso conto e importo entro sette giorni. Verifica direttamente note, categorie o dettagli degli ordini prima di decidere. Usa array vuoti quando il report non contiene candidati.
4. Ripeti il comando con un prefisso nuovo per `--output` e aggiungi `--review .private/finance-staging/revisione.json`. Il report finale lega l’hash dell’export a quello del lotto derivato e conserva la corrispondenza tra riga originale e riga del delta. L’SQL contiene soltanto le nuove righe e riusa l’importatore esistente. Al primo passaggio controlla sotto lock che storico, registro e revisioni citate coincidano con quelli esaminati. Rieseguire lo stesso SQL restituisce il lotto già importato.
5. Dopo l’OK esplicito di Tommi, applica l’SQL al progetto verificato con una connessione proprietario, ad esempio con `psql -X --set ON_ERROR_STOP=1 --file <delta.sql>` su una connessione già configurata. Controlla il numero di nuove righe e l’assenza di duplicati prima di caricare documenti che fanno riferimento al nuovo incasso.

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
