# Finance: fatti collegati e lavoro manuale

La route `/finance/work` aggiunge due percorsi distinti: leggere i fatti generati dalle vendite e registrare dichiarazioni manuali Finance. Le fonti BudgetFlow, COGS e PDF restano immutate e consultabili nelle sezioni già esistenti. Il codice usa soltanto il client Supabase della sessione: nessuna chiave Admin o service role nelle pagine o nelle Server Actions.

## Vendite collegate a Finance

La pagina legge `commercial_facts`, `order_payments` e gli stessi `sales_orders` usati da `/sales`, con conteggi esatti e paginazione completa. Mostra tre tabelle separate:

- **Vendite osservate:** valore originario dell’ordine, collegato al suo ID.
- **Incassi dichiarati:** un pagamento per riga `order_payments`, con metodo e riferimento dichiarato. Il corrispondente fatto `payment_reported` viene usato per verificare il collegamento e non crea una seconda riga incasso.
- **Annulli commerciali:** importi annullati, con eventuale rimborso ancora dovuto sull’ordine. L’annullo non esegue rimborso, movimento bancario o ricevimento fisico di un reso.

I collegamenti portano a `/sales#order-<ID>` e conservano l’identità dell’ordine. Queste tabelle non vengono sommate tra loro o con BudgetFlow. Vendita, pagamento cliente, regolamento su conto e movimento importato sono fatti differenti, non importi da aggiungere per ottenere ricavi. Non sono calcolati saldo bancario, utile, IVA o contabilizzazione fiscale. Anche i contatori della pagina contano righe, senza presentare somme finanziarie aggregate.

La lettura richiede `getUser()`, membership corrente, permesso Finance e apertura dell’area con la password aggiuntiva nella sessione corrente; le politiche DB `private.can_finance()` rimangono l’autorità per ogni riga. L’accesso è riservato a founder, produzione con flag Finance e Finance con flag, quindi Tommi, Gabriele e Gherardo. Il gate attuale non richiede app di autenticazione e AAL non lo sostituisce. Ruoli contenuti in metadata modificabili dal browser non sono utilizzati. Errori o risultati troncati bloccano l’intera schermata; non viene mostrata una fonte senza le sue righe collegate.

## Registro manuale

La migrazione `20261021125904_finance_work.sql`, generata tramite CLI e applicata dal root dopo revisione, estende `finance_entries` con centesimi generati dall’importo esatto, conto/cassa e categoria facoltativi, fonte dichiarata e stato `unclassified`. I valori già presenti rimangono invariati e vengono identificati come `legacy_unclassified`, senza attribuire loro una provenienza inventata.

`record_finance_entry(p_operation_id,p_payload)` riceve:

```json
{
  "schema_version": 1,
  "entry_date": "2026-10-21",
  "entry_type": "expense",
  "amount_cents": 1234,
  "description": "Esempio sintetico di dichiarazione",
  "account_label": "Nome dichiarato dall’utente",
  "category": "Categoria dichiarata",
  "not_duplicate_confirmed": true
}
```

Importi positivi interi da 1 a 99.999.999.999.999 centesimi, coerenti con il tipo `numeric(14,2)` esistente. Entrata/uscita descrive la direzione; non si memorizzano importi negativi. La data è un giorno esplicito Europe/Rome, valido e non futuro. Le scadenze future richiedono un promemoria nel calendario e una registrazione quando il movimento avviene. Account e categoria sono etichette libere dell’utente: nessun conto, saldo iniziale o classificazione contabile viene inventato.

Prima dell’invio il collaboratore conferma di aver controllato fonti BudgetFlow e fatti delle vendite per evitare copie. La conferma non costituisce una riconciliazione automatica: due pagamenti diversi possono avere lo stesso importo/data e un riconoscimento affidabile richiede riferimenti verificati. Le voci nuove restano «Da classificare» e non vengono dichiarate contabilizzate.

## Correzioni, autorizzazione e idempotenza

`finance_entries` diventa append-only. La migrazione revoca esplicitamente sia i vecchi privilegi a livello tabella sia i vecchi `INSERT`/`UPDATE` a livello colonna e rimuove le tre politiche DML. I membri autorizzati inseriscono soltanto attraverso le RPC; nessun `UPDATE` o `DELETE` diretto è ammesso, nemmeno per correggere una descrizione.

Per correggere si usa `void_finance_entry(p_operation_id,{schema_version:1,entry_id,reason})`, con causale da 3 a 500 caratteri. Aggiunge un record immutabile e univoco in `finance_entry_voids`, conserva la voce originale e ne espone lo stato annullato. Il movimento corretto si inserisce separatamente dopo verifica delle altre fonti. Annullare una dichiarazione non esegue un’operazione su conto/cassa.

Le RPC pubbliche sono invoker, i processori privati verificano sempre `auth.uid()` e `private.can_finance()`, che nel modello corrente richiede il grant della password Finance per questa sessione. Helper e tabelle private non sono concessi a client; gli EXECUTE impliciti PUBLIC sono revocati. Un lock per UUID e una ricevuta privata con autore, tipo comando e hash del payload normalizzato rendono idempotenti registrazione e annullo. Stesso UUID/autore/payload recupera l’esito; differenze producono conflitto. Il lock sulla voce e il vincolo unico impediscono annulli duplicati. Voce, annullo, ricevuta e audit sono nella stessa transazione.

L’interfaccia conserva prima dell’invio UUID e payload congelato in `sessionStorage`, per utente e modulo. Una guardia sincrona impedisce doppio click prima dell’aggiornamento dello stato React. Errori di rete o risposte incomplete consentono soltanto lo stesso retry. Durante il recupero, errori Auth, chiusura del gate o validazioni che precedono la ricerca della ricevuta mantengono il tentativo incerto: non provano che l’originale sia fallito. Un recupero generale rende accessibili gli annulli anche quando la voce è filtrata o il modulo non compare più. Chiudere la scheda o cancellare lo storage può perdere il marker; prima di reinserire occorre verificare il registro. Le password non fanno parte dei marker conservati.

## Verifiche

24 test Vitest Finance e typecheck passati: importi e formattazione esatta anche a valori elevati, data Roma al cambio giorno UTC, input non ammessi, conferma fonti, separazione di vendita/incasso/annullo, riferimenti completi, conservazione delle voci annullate, permessi correnti e gate DB, RPC di comando singola, retry dopo revoca e recupero del payload originario. Il grant viene riletto prima di ogni lettura o comando; non è un flag memorizzato nell’interfaccia.

Harness SQL isolato: `node supabase/tests/finance-work.mjs /tmp/luckylap-sql-validation/node_modules/@electric-sql/pglite/dist/index.js`. **177 controlli passati** su fixture sintetiche e Auth simulato: ruoli/AAL, revoca immediata, privilegi a colonna revocati, immutable ledger, importi interi, rifiuto futuro, idempotenza, atomicità dell’annullo e preservazione del legacy. Una vendita sintetica genera tre fatti distinti (vendita, incasso, annullo) e un solo pagamento senza produrre una nuova voce Finance manuale o una riga BudgetFlow. Il test applica solo le migrazioni pertinenti per suffisso e non esegue le migrazioni Storage/asset/packaging sviluppate in parallelo.

I test non certificano JWT/PostgREST e concorrenza su più connessioni del progetto reale. Nessun dato cloud, account, email, flag o import storico è stato modificato dall’agente implementatore. La migrazione remota è stata applicata dal root; i dati sorgente finanziari non vengono riscritti da questa funzionalità.

Il design riusa palette, Barlow e controlli descritti in DESIGN.md. Nessun nuovo contesto o detector Impeccable è stato eseguito. Consultate le guide della Next installata su azioni server/cache e le fonti Supabase correnti su RPC, privilegi e RLS. QA visuale eseguita dal root su fixture sintetiche a 1280 e 390 px: tre tabelle distinte, importi 80,02 / 80,02 / 40,01 coerenti, viewport mobile a scala 1 senza overflow della pagina e nessun errore in console. La route temporanea è stata eliminata; verifica HTTP 404 completata.
