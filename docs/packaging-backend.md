# Packaging T-shirt: prenotazioni, consegne e rettifiche

Il packaging comprende due materiali distinti dai prodotti venduti:

- **Scatola T-shirt**, dimensioni **30 × 22,5 × 2,5 cm**.
- **Adesivo per scatola**.

La conta iniziale autorizzata è di **100 unità ciascuno in MAG01**. Non sono stati inventati costi o prezzi: restano `NULL`. Gli SKU `PACK-TSHIRT-BOX` e `PACK-BOX-STICKER` sono identificativi interni dei materiali; gli UUID sono generati dal database.

La migrazione forward `20261021164548_packaging_automatic_consumption.sql`, generata con `supabase@2.121.0 migration new`, aggiunge l'automazione. Le quindici migrazioni precedenti restano invariate. Applicare la migrazione non crea i materiali, non imposta quantità e non rielabora le consegne storiche.

La migrazione del conto vendita mensile (`20261022215046_consignment_monthly.sql`, vedi [conto vendita](consignment.md)) sostituisce `private.observe_packaging_source` con lo stesso corpo e la stessa firma, più un ramo: nel tipo `consignment`, un'origine che non è in `consignment_sales` si cerca in `consignment_report_movements` con `quantity_delta < 0` (articolo, quantità = −delta, istante = `created_at` della riga). Aggiunge il trigger `observe_packaging` dopo l'inserimento in `consignment_report_movements`, con la funzione trigger esistente. Grant, vincoli, viste e dati del packaging non cambiano; `packaging_consumptions.source_id` non ha chiave esterna e gli UUID delle due origini non collidono.

## Attivazione e confine temporale

Dopo revisione, l'owner esegue una sola operazione atomica:

```sql
select private.activate_tshirt_packaging();
```

La funzione richiede la location attiva `MAG01` di tipo `Magazzino`, crea le due anagrafiche e due movimenti `opening` da 100, registra `started_at` con l'orologio database e conserva l'insieme degli ordini T-shirt ancora aperti. Una ripetizione restituisce la stessa configurazione con `replayed=true`, senza nuove quantità o modifica della data di avvio. Un materiale conflittuale o una conta preesistente diversa da 100 richiedono revisione esplicita: non vengono sovrascritti.

Gli helper di attivazione e revisione non sono eseguibili da `anon`, `authenticated` o `service_role`. La procedura è riservata all'owner, fuori dal browser. Non è un controllo capace di limitare un amministratore infrastrutturale compromesso.

Solo gli eventi inseriti dopo l'attivazione, con `fulfilled_at`/`occurred_at` successivo o uguale a `started_at`, possono consumare automaticamente. Nessuna consegna manuale/LCM antecedente viene retro-consumata. Una futura consegna reale di un vecchio ordine manuale può consumare normalmente.

Shopify usa attualmente `fulfillment.updatedAt` nella proiezione della data consegna. Per non interpretare una modifica tardiva come una nuova consegna, gli ordini Shopify creati prima dell'avvio e non presenti tra gli ordini T-shirt aperti all'attivazione generano una verifica packaging bloccata, senza prelievo automatico. La verifica non interrompe import, stock prodotto o Finance.

## Contratto dell'automazione

| Evento | Effetto packaging |
| --- | --- |
| T-shirt da preparare, anche se in produzione | Prenota una scatola e un adesivo per ogni unità ancora da consegnare |
| Nuova consegna manuale, Shopify web o POS | Consuma una scatola e un adesivo per ogni T-shirt effettivamente consegnata |
| Consegna parziale | Consuma esclusivamente il nuovo delta; conserva la prenotazione residua |
| Ripetizione del medesimo effetto | Nessun doppio consumo |
| Cappellini o sticker retail | Nessun consumo packaging |
| Consegna al negozio, magliette riportate in magazzino, conta in negozio | Nessun consumo packaging |
| Vendita del resoconto mensile del conto vendita | Consuma una scatola e un adesivo da MAG01 per ogni pezzo che la versione del resoconto toglie dal negozio, senza variazione del prodotto centrale |
| Correzione al ribasso del resoconto mensile | Nessun materiale restituito |
| Vendita singola del modulo precedente (`consignment_sales`) | Consuma scatola e adesivo da MAG01, senza seconda variazione del prodotto centrale |
| Cancellazione residuo ordine | Libera il residuo prenotato; non ripristina quanto già consumato |
| Rimborso | Non rigenera materiale consumato |

I trigger osservano `fulfillment_lines`, `consignment_sales` e `consignment_report_movements`; non chiamano API Shopify e non cambiano le proiezioni economiche. Le prenotazioni sono domanda derivata dal residuo di `sales_order_lines`, non un vincolo che possa bloccare una vendita per mancanza di scatole.

`packaging_consumptions` conserva una ricevuta per origine, evento e materiale. Il richiesto e il consumato sono distinti. Ogni prelievo reale ha un movimento stock `adjustment` con causale di confezionamento e metadati `kind=packaging_consumption`, oltre alla ricevuta append-only `packaging_consumption_entries`. Il totale degli inserimenti coincide con il consumato aggregato. Un lock advisory comune e i lock dei saldi serializzano i prelievi tra ordini diversi e riconciliazioni.

Limite noto del resoconto mensile: ogni versione consuma per i pezzi che toglie in più dal negozio e una correzione al ribasso non restituisce nulla. Se si abbassa e poi si rialza lo stesso resoconto, gli stessi pezzi consumano due volte. La quantità si corregge in `/packaging` con la rettifica della conta.

## Carenze e recupero

Se servono 3 scatole ma ne risulta una sola, il registro preleva **1**, il saldo fisico diventa **0** e la ricevuta conserva **2 unità da riconciliare**. Non viene inventato un saldo negativo né presentato il consumo richiesto come interamente registrato. Un saldo sconosciuto conserva tutta la richiesta in sospeso. Le quantità restano indicate come provvisorie finché i consumi mancanti non sono verificati.

Un errore tecnico nella parte packaging annulla solo il suo sottoblocco e apre `packaging_automation_failures`: la consegna prodotto continua. Il recupero esplicito ritenta questi effetti e i consumi incompleti. Un nuovo tentativo può prelevare solo la quantità ancora mancante. La ricevuta del comando rende idempotenti anche retry di rete e doppio invio.

Dall'interfaccia, aggiornare la conta quando necessario e usare **Registra consumi mancanti**. Questa azione non approva automaticamente le consegne storiche sospette. Per quelle, l'owner verifica la provenienza e usa una causale esplicita su ciascuna ricevuta:

```sql
select private.approve_packaging_review('<UUID_RICEVUTA_VERIFICATA>', '<CAUSALE_VERIFICA>');
```

I placeholder richiedono UUID e causale reali. L'approvazione è registrata nell'audit e preleva solo materiale effettivamente disponibile. Se resta una carenza, la ricevuta rimane incompleta e recuperabile.

## Rettifica della quantità

`adjust_packaging_quantity` accetta un identificativo operazione, materiale, quantità fisica contata, causale e `expected_quantity` letto al momento della conta. Dopo il lock, il database confronta il saldo attuale con quello atteso. Se una consegna lo ha cambiato, rifiuta la modifica con `packaging_quantity_changed`: l'utente rilegge e verifica la conta. Una richiesta già confermata viene riconosciuta dalla ricevuta prima del controllo del saldo o del flag di sospensione.

Tutti i cinque ruoli attivi possono rettificare e riconciliare quando `stock_adjustments_enabled` è attivo. Nessun client aggiorna direttamente saldi, ricevute, configurazione o audit. Le letture passano da RLS; `packaging_material_status` è una vista `security_invoker`. I helper privilegiati sono privati, hanno `search_path=''` e grant espliciti. I dati della UI non comprendono documenti o importi Finance.

## Verifica

- `supabase/tests/packaging-automation.mjs`: **73 controlli PGlite** con Auth simulata, comprese attivazione/replay, prenotazioni, consegne parziali, canali Shopify, LCM, cappellini/sticker, carenze, recupero, CAS e permessi. Fixture sintetiche soltanto.
- Revisione indipendente: **92 controlli PGlite** sulla medesima SQL, includendo guardia ordini storici e privilegi degli helper.
- `supabase/tests/packaging-concurrency.mjs`: prova indipendente su **PostgreSQL 17.11 reale**, due worker e un osservatore, **6 controlli** su CAS concorrente e doppia consegna concorrente. Auth e ordini sono sintetici; nessun servizio cloud.
- Dal 22 ottobre 2026 `packaging-automation.mjs` e `packaging-concurrency.mjs` applicano anche `consignment_monthly`: con la funzione sostituita passano gli stessi 73 e 6 controlli. `supabase/tests/consignment-monthly.mjs` verifica che il resoconto consumi scatola e adesivo per i soli pezzi tolti dal negozio, che la correzione al ribasso non restituisca nulla, il limite noto (abbassare e rialzare consuma di nuovo), che conte, consegne al negozio e magliette riportate non consumino e che le vendite singole di `consignment_sales` consumino ancora. Le consegne di `fulfillment_lines` restano provate da `packaging-automation.mjs`.
- Vitest packaging: **58 test** tra modelli, server, vecchie primitive di creazione/conta e nuova UI semplificata. Typecheck passato.

Queste prove locali usano Auth simulata e non attestano la verifica JWT. La migrazione è stata applicata al progetto LuckyLap il 21 ottobre 2026, versione `20261021164548`. L’attivazione owner è avvenuta alle `2026-10-21T16:45:56.51745+00:00`: due materiali da 100 in Magadzino, nessun consumo pregresso. La verifica cloud successiva conferma 214 unità prodotto, zero ordini, 144 movimenti Finance importati e cinque membri attivi. Nessun ordine o movimento di vendita sintetico è stato scritto nel progetto cloud. I grant degli helper di attivazione/revisione risultano negati ad anon, authenticated e service_role; il comando operativo richiede membership corrente.
