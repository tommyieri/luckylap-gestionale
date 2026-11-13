# Finance: inserimento, correzioni e fonti collegate

L’inserimento e la correzione si svolgono dentro `/finance`: «Nuovo movimento» apre il modulo di registrazione; **Movimenti** è il registro unico delle voci manuali, delle importazioni e del denaro ricevuto o rimborsato dalle vendite. Aprire una riga mostra la scheda contestuale con dati, correzione e storico. Le revisioni di [finance-revisions.md](finance-revisions.md) continuano a preservare le fonti; i limiti di eliminazione degli incassi delle vendite e dei rimborsi restano efficaci. «Chiudi Finance» rimane in cima alla pagina.

Il vecchio `/finance/work` rimane compatibile: reindirizza a `/finance?vista=movements&nuovo=expense`. L’area richiede ancora la password Finance prima di consentire letture e scritture. Non esiste più una seconda pagina «Registrazioni» da attraversare per aggiungere una voce. Le fonti BudgetFlow e i documenti originali restano consultabili da **Documenti e fonti** e dall’archivio privato `/finance/documents`. Il codice usa soltanto il client Supabase della sessione: nessuna chiave Admin o service role nelle pagine o nelle Server Actions.

## Nuovo movimento e scheda

Il pulsante «Nuovo movimento» apre Uscita, Entrata o Trasferimento. Il modulo usa euro, con importo senza segno e fino a due decimali. Un trasferimento richiede due conti distinti e produce una sola voce con addebito sul conto di partenza e accredito su quello di destinazione. Conto e categoria sono facoltativi per entrate e uscite. Le opzioni «Altro conto…» e «Altra categoria…» accettano valori personalizzati.

Si possono indicare beneficiario, tag, luogo, ora e note. Una data futura entra in Pianificati. «Ripeti» crea da 2 a 60 occorrenze settimanali, mensili o annuali in un’unica transazione. Le date partono dalla scadenza iniziale e usano l’ultimo giorno del mese quando il giorno richiesto manca. Ogni occorrenza si può correggere dalla sua scheda. L’opzione «In sospeso» attende una conferma tramite la scheda prima di incidere sui saldi. I due interruttori di inclusione controllano le analisi e i budget, mentre il saldo continua a seguire il movimento effettivo.

La conferma di verifica dei duplicati rimane obbligatoria. «Salva» apre la scheda della nuova voce dopo la ricevuta. «Salva e aggiungi un movimento» prepara un altro inserimento. Per gli incassi nuovi dei negozi si usa il resoconto del conto vendita.

La scheda si apre nel contesto della ricerca, anche tramite indirizzo diretto con `movimento=<id>`. Chiuderla mantiene periodo e filtri; la navigazione avanti e indietro del browser li ripristina. Modifiche non salvate richiedono conferma prima di uscire. Storico e fonte sono richiudibili; il pagamento di un negozio usa il suo editor e il suo storico specifici. I vecchi collegamenti `/finance/movimento?source_kind=…&source_id=…` e `/finance/incasso/<id>` continuano a funzionare.

### Allegati

Nella scheda di un movimento salvato, **Allegati** accetta fatture e ricevute in PDF fino a 4 MB per file. I file sono privati, accessibili solo con Finance aperta. Se il caricamento si interrompe, ripeti l'operazione scegliendo lo stesso file. Il suo contenuto identifica l'allegato sul movimento. Per i pagamenti storici del conto vendita la scheda mostra anche le fatture e i riepiloghi collegati all'archivio.

## Vendite collegate a Finance

La lettura conserva `commercial_facts`, `order_payments` e gli stessi `sales_orders` usati da `/sales`, con conteggi esatti e paginazione completa. Il nuovo registro riunisce i movimenti monetari senza confondere le fonti commerciali:

- **Vendite osservate:** il valore originario dell’ordine resta un fatto della vendita, collegato al suo ID; non diventa una seconda entrata Finance.
- **Incassi dichiarati e Shopify:** un pagamento per riga `order_payments`, con metodo e riferimento dichiarato. Il fatto `payment_reported` verifica il collegamento e non crea una seconda riga incasso. Il registro mostra il valore effettivo dopo le revisioni; fonte e versione originale restano consultabili dalla scheda. I pagamenti esclusi, per esempio dopo un annullo della vendita, non entrano nei saldi attivi.
- **Rimborsi Shopify:** sono movimenti distinti in uscita; il rimborso non viene riclassificato come un costo di produzione.
- **Annulli commerciali:** gli importi annullati e l’eventuale rimborso ancora dovuto rimangono sull’ordine. L’annullo non esegue rimborso, movimento bancario o ricevimento fisico di un reso.

I collegamenti portano a `/sales#order-<ID>` e conservano l’identità dell’ordine. Vendita, pagamento cliente, regolamento su conto e movimento importato sono fatti differenti, non importi da aggiungere per ottenere ricavi. Le regole di aggregazione e attribuzione dei conti sono in [finance-dashboard.md](finance-dashboard.md): il gateway non diventa automaticamente Revolut e le righe senza conto rimangono da attribuire. Non sono calcolati saldo bancario, utile, IVA o contabilizzazione fiscale. Le sovrapposizioni fra fonti diverse non vengono riconciliate automaticamente.

La lettura richiede `getUser()`, membership corrente, permesso Finance e apertura dell’area con la password aggiuntiva nella sessione corrente; le politiche DB `private.can_finance()` rimangono l’autorità per ogni riga. Ogni membro attivo può aprire Finance con la password corretta, indipendentemente dal ruolo e dal flag Finance. Il gate attuale non richiede app di autenticazione e AAL non lo sostituisce. Ruoli contenuti in metadata modificabili dal browser non sono utilizzati. Errori o risultati troncati bloccano l’intera schermata; non viene mostrata una fonte senza le sue righe collegate.

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

Importi positivi interi da 1 a 99.999.999.999.999 centesimi, coerenti con il tipo `numeric(14,2)` esistente. Entrata/uscita descrive la direzione; non si memorizzano importi negativi. Il contratto storico `schema_version: 1` accetta date fino a oggi. Il modulo Finance usa `schema_version: 2` e ammette una data futura, oltre ai campi facoltativi per ricorrenza, trasferimento, stato e metadati. La migrazione `20261113195100_finance_movimenti_pianificati.sql` conserva ricevute e compatibilità del contratto precedente. Account e categoria sono etichette libere dell’utente: nessun conto, saldo iniziale o classificazione contabile viene inventato.

Prima dell’invio il collaboratore conferma di aver controllato fonti BudgetFlow e fatti delle vendite per evitare copie. La conferma non costituisce una riconciliazione automatica: due pagamenti diversi possono avere lo stesso importo/data e un riconoscimento affidabile richiede riferimenti verificati. Le voci nuove restano «Da classificare» e non vengono dichiarate contabilizzate.

## Correzioni, autorizzazione e idempotenza

`finance_entries` è append-only. La migrazione revoca esplicitamente sia i vecchi privilegi a livello tabella sia i vecchi `INSERT`/`UPDATE` a livello colonna e rimuove le tre politiche DML. I membri autorizzati inseriscono soltanto attraverso le RPC; nessun `UPDATE` o `DELETE` diretto è ammesso, nemmeno per correggere una descrizione. Le fonti restano immutabili; le modifiche sono revisioni append-only con storico.

Dal 23 ottobre 2026 (pull request #3) una voce si corregge con le revisioni: oggi la scheda contestuale incorpora lo stesso editor dell’indirizzo compatibile `/finance/movimento?source_kind=manual&source_id=<id>`. Si salva una correzione completa, si elimina o si ripristina una versione (`revise_finance_movement`, tabella `finance_movement_revisions`). La motivazione è facoltativa: se resta vuota, lo storico scrive «Correzione», «Eliminazione» o «Ripristino»; se c’è, da 3 a 500 caratteri.

Incassi delle vendite (`payment`) e rimborsi Shopify (`refund`) non si eliminano da Finance (`20261023125727_finance_fixes.sql`, errore `finance_movement_delete_not_allowed`): l’editor non mostra «Elimina movimento» e dice dove andare. Una vendita registrata per errore si annulla in Vendite con «Annulla registrazione»; la merce restituita si registra con «Registra reso» (vedi [annullamenti-e-resi.md](annullamenti-e-resi.md)). Correggere e ripristinare restano possibili. In Movimenti, «Altri filtri» contiene «Eliminati · recuperabili»: aprendo una riga si ripristina una versione dallo storico. Nei saldi contano i valori dell’ultima versione e gli eliminati ne escono. Correggere o eliminare non esegue un’operazione su conto o cassa.

`void_finance_entry(p_operation_id,{schema_version:1,entry_id,reason})` resta solo per compatibilità: l'interfaccia non lo offre più per le voci nuove, i vecchi annulli restano visibili («Annullamento della fonte originale il …») e la voce annullata si può ripristinare dallo storico. Su una fonte già revisionata risponde `use_finance_revisions`.

Le RPC pubbliche sono invoker, i processori privati verificano sempre `auth.uid()` e `private.can_finance()`, che nel modello corrente richiede il grant della password Finance per questa sessione. Helper e tabelle private non sono concessi a client; gli EXECUTE impliciti PUBLIC sono revocati. Un lock per UUID e una ricevuta privata con autore, tipo comando e hash del payload normalizzato rendono idempotenti registrazione e annullo. Stesso UUID/autore/payload recupera l’esito; differenze producono conflitto. Il lock sulla voce e il vincolo unico impediscono annulli duplicati. Voce, annullo, ricevuta e audit sono nella stessa transazione.

L’interfaccia conserva prima dell’invio UUID e payload congelato in `sessionStorage`, per utente e modulo. Una guardia sincrona impedisce doppio click prima dell’aggiornamento dello stato React. Errori di rete o risposte incomplete consentono soltanto lo stesso retry. Durante il recupero, errori Auth, chiusura del gate o validazioni che precedono la ricerca della ricevuta mantengono il tentativo incerto: non provano che l’originale sia fallito. Un recupero generale rende accessibili anche i vecchi annulli ancora in sospeso, quando la voce è filtrata o il modulo non compare più. L'editor delle revisioni conserva i suoi tentativi a parte, con lo stesso riquadro. Ogni tentativo usa il riquadro `src/components/pending-attempt.tsx` con il riepilogo di `src/lib/finance-work/attempt.ts` (data in italiano, entrata o uscita in euro, descrizione o motivo; mai l’id della voce). Un tentativo illeggibile o in conflitto si può scartare con «Scarta questo tentativo», dopo una conferma: libera il modulo, non cancella niente nel registro. Chiudere la scheda o cancellare lo storage può perdere il marker; prima di reinserire occorre verificare il registro. Le password non fanno parte dei marker conservati.

## Verifiche

La nuova interfaccia conserva `FinanceWorkForm` e `financeEntryForm` per validazione, RPC e recupero. I test del modulo coprono importi, scadenze future, ricorrenze, trasferimenti, conferma dei duplicati, esiti incerti e anteprima. Il test SQL verifica retry della serie, recupero delle ricevute precedenti e correzione di un trasferimento senza modificare la fonte. I test della scheda e del loader coprono identità corrente, area chiusa prima della lettura, risposta tardiva e distinzione fra revisioni Finance e storico dei pagamenti del negozio. La descrizione della Panoramica e del registro è in [finance-dashboard.md](finance-dashboard.md).

Le correzioni con storico sono provate da `supabase/tests/finance-revisions.mjs` (PGlite), `finance-revisions-concurrency.mjs` e `finance-ecosystem-integration.mjs` (PostgreSQL 17): numeri in [verifiche](verification.md).

### Verbale del primo rilascio, 21 ottobre 2026

24 test Vitest Finance e typecheck passati: importi e formattazione esatta anche a valori elevati, data Roma al cambio giorno UTC, input non ammessi, conferma fonti, separazione di vendita/incasso/annullo, riferimenti completi, conservazione delle voci annullate, permessi correnti e gate DB, RPC di comando singola, retry dopo revoca e recupero del payload originario. Il grant viene riletto prima di ogni lettura o comando; non è un flag memorizzato nell’interfaccia.

Harness SQL isolato: `node supabase/tests/finance-work.mjs /tmp/luckylap-sql-validation/node_modules/@electric-sql/pglite/dist/index.js`. **177 controlli passati** su fixture sintetiche e Auth simulato: ruoli/AAL, revoca immediata, privilegi a colonna revocati, immutable ledger, importi interi, rifiuto futuro, idempotenza, atomicità dell’annullo e preservazione del legacy. Una vendita sintetica genera tre fatti distinti (vendita, incasso, annullo) e un solo pagamento senza produrre una nuova voce Finance manuale o una riga BudgetFlow. Il test applica solo le migrazioni pertinenti per suffisso e non esegue le migrazioni Storage/asset/packaging sviluppate in parallelo.

I test non certificano JWT/PostgREST e concorrenza su più connessioni del progetto reale. Nessun dato cloud, account, email, flag o import storico è stato modificato dall’agente implementatore. La migrazione remota è stata applicata dal root; i dati sorgente finanziari non vengono riscritti da questa funzionalità.

Il design riusa palette, Barlow e controlli descritti in DESIGN.md. Nessun nuovo contesto o detector Impeccable è stato eseguito. Consultate le guide della Next installata su azioni server/cache e le fonti Supabase correnti su RPC, privilegi e RLS. QA visuale eseguita dal root su fixture sintetiche a 1280 e 390 px: tre tabelle distinte, importi 80,02 / 80,02 / 40,01 coerenti, viewport mobile a scala 1 senza overflow della pagina e nessun errore in console. La route temporanea è stata eliminata; verifica HTTP 404 completata.
