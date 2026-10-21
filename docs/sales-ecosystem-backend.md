# Nucleo transazionale vendite

Implementazione locale del primo comando descritto in [ecosistema-vendite.md](ecosistema-vendite.md), 21 ottobre 2026. La migrazione è stata creata con `supabase@2.121.0 migration new sales_ecosystem`, dopo aver verificato versione e help della CLI ufficiale. Non contiene vendite reali, storico, utenti o quantità iniziali; non modifica Shopify e non chiama servizi esterni.

## Stato di attivazione

`app_settings.manual_sales_enabled` nasce **false** e `sales_started_at` nasce NULL. Nessuna interfaccia deve presentare il comando come già operativo. L'abilitazione richiede cutover concordato, verifica delle quantità fisiche e test nel runtime Supabase effettivo. Un timestamp precedente al cutover viene rifiutato: non si possono riprodurre automaticamente vecchie vendite contro l'apertura Drive.

La seconda migrazione forward `sales_lifecycle`, creata anch'essa con la CLI, completa preparazione, ricevimento produzione, evasione parziale, cancellazione del residuo e incasso dichiarato successivo. Nessun completamento simulato e nessun lavoro di produzione avviato automaticamente. Restano fuori da questa tranche l'esecuzione/registrazione di un rimborso, ricevimento dei resi, pagamenti parziali, integrazione Shopify e attivazione UI. Un rimborso dovuto rimane esplicito e aperto finché non viene realmente gestito.

## Un comando, una transazione

La RPC esposta è `public.register_manual_sale(p_operation_id uuid, p_payload jsonb)`. Il wrapper è SECURITY INVOKER e delega a un processore SECURITY DEFINER nello schema non esposto `private`. Il processore verifica sempre `auth.uid()` e membership corrente nel database; non considera i ruoli dichiarati in metadata JWT. Tutti i membri attivi possono registrare e applicare sconti motivati, senza ottenere lettura delle tabelle Finance.

Esempio **sintetico**, con identificativi da sostituire e timestamp compreso tra cutover e istante corrente:

```json
{
  "schema_version": 1,
  "channel": "direct",
  "occurred_at": "2026-10-21T12:00:00+02:00",
  "location_id": "90000000-0000-0000-0000-000000000200",
  "lines": [
    {
      "stock_item_id": "90000000-0000-0000-0000-000000000101",
      "quantity": 2,
      "unit_price_cents": 4001,
      "discount_cents": 100
    }
  ],
  "fulfillment_mode": "delivered_now",
  "reason": "Sconto concordato per questa vendita",
  "payment": {
    "status": "paid",
    "method": "cash",
    "amount_cents": 7902,
    "occurred_at": "2026-10-21T12:00:00+02:00"
  }
}
```

| Campo | Regola implementata |
| --- | --- |
| `schema_version` | Numero intero 1. Chiavi sconosciute rifiutate a tutti i livelli. |
| `channel` | `direct`, `etsy`, `manual_other`. `cash` è un metodo, non un canale. `shopify` e `shopify_pos` rifiutati: POS deve arrivare dall'ordine esterno, senza registrazione doppia. Conto vendita rinviato. |
| `external_reference` | Testo facoltativo fino a 240 caratteri; obbligatorio per Etsy. Se presente, coppia canale/riferimento univoca. Per `manual_other` senza riferimento la deduplicazione dipende dall'operation ID stabile: non può riconoscere due inserimenti umani separati dello stesso ordine. La UI dovrà chiedere l'ID quando esiste. |
| `occurred_at` | Timestamp ISO con offset esplicito, non futuro e non precedente al cutover. La data operativa è Europe/Rome. |
| `location_id` | Location esplicita, esistente e attiva. Nessun prelievo implicito dal negozio. |
| `lines` | Da 1 a 50 prodotti attivi con variante; SKU distinti. Quantità da 1 a 100.000; prezzo unitario da 0 a 1.000.000.000 centesimi; sconto **totale di riga** tra zero e prezzo × quantità. Numeri frazionari, stringhe numeriche, costi o totali dal client rifiutati. |
| `reason` | Da 3 a 500 caratteri se fornita; obbligatoria per sconto, prezzo diverso dal listino o listino ignoto. Nessuna soglia di approvazione aggiunta. |
| `payment` | `{ "status": "unpaid" }` non crea pagamenti. `paid` richiede metodo esplicito `cash`, `bank_transfer`, `external_card` o `other`, importo esatto uguale al totale e timestamp. `reference` facoltativo è una dichiarazione, non un ID verificato del provider. Non si memorizzano carte e non si eseguono addebiti. Pagamenti parziali rinviati. |

Il server fotografa SKU, listino e costo dal catalogo bloccato durante il comando. Costo NULL rimane NULL. Calcola l'importo con bigint in centesimi e valuta EUR; non calcola IVA, ricavo netto o utile. Una modifica economica motivata è consentita a ogni membro attivo.

| Modalità | Effetti atomici |
| --- | --- |
| `delivered_now` | Verifica disponibile fisico, registra ordine/righe, pagamento dichiarato eventuale, uscita `sale_fulfillment`, riga di consegna, fatti osservati Finance, audit e outbox locale. Fisico e disponibile scendono una sola volta. Insufficienza o quantità ignota annullano tutto. |
| `prepare` | Registra ordine/righe, riserva al massimo il disponibile, apre il deficit in `production_requirements` con stato `to_plan`, pagamento eventuale e fatti osservati. **Non scarica il fisico** e non avvia produzione. Un secondo ordine non può prenotare la stessa disponibilità. |

Riserve e on hand condividono un lock per SKU/location. Anche l'API di rettifica già esistente non può portare il fisico sotto la quantità riservata: un trigger del saldo rifiuta l'operazione. La vista `operational_stock_availability` espone `on_hand`, `reserved`, `available` con `security_invoker`; NULL fisico rimane NULL.

## Risposta e idempotenza

La risposta contiene `order_id`, `operation_id`, `replayed`, `total_cents`, `payment_state`, `fulfillment_state`, `commercial_fact_id` e `lines` con `order_line_id`, `stock_item_id`, `reserved_quantity`, `production_required_quantity`, `on_hand_after`, `available_after`. Non restituisce riferimenti di pagamento, dati BudgetFlow, saldi dei conti o righe Finance riservate. Le quantità `*_after` descrivono il commit originario, non sostituiscono una nuova lettura dello stock corrente.

Conservare lo stesso UUID operazione e lo stesso comando tra tentativi di rete. La normalizzazione ordina le righe per articolo, normalizza timestamp/UUID, rimuove spazi esterni da causale/riferimenti e equipara campi facoltativi assenti, NULL o vuoti. Il digest è SHA-256 nativo PostgreSQL del JSONB canonico; non richiede pgcrypto. Stesso attore + operation ID + digest restituiscono il risultato originale con `replayed: true`, anche se il catalogo è cambiato. Payload diverso o attore diverso producono conflitto, senza ulteriori effetti.

Un lock transazionale serializza la chiave operazione e una chiave distinta serializza canale/riferimento. Catalogo e saldi sono bloccati in ordine deterministico per articolo. Ogni movimento, pagamento, fatto e evento ha un UUID effetto distinto, persistito; non si riusa l'operation ID ordine nel registro che lo richiede univoco.

| Errore macchina | SQLSTATE | Significato |
| --- | --- | --- |
| `membership_required` | 42501 | Sessione priva di membership attiva. |
| `sales_disabled` | 42501 | Flusso non attivato o cutover assente. |
| `invalid_payload` | 22023 | Schema, tipo, timestamp, importi, location o limiti invalidi. |
| `idempotency_conflict` | 22023 | UUID operazione riutilizzato per altro payload/attore. |
| `duplicate_external_reference` | 23505 | Altro ordine già registrato con quel canale/riferimento. |
| `inactive_item` | 22023 | Articolo inesistente/inattivo o non variante prodotto vendibile. |
| `price_change_reason_required` | 22023 | Modifica economica senza motivazione. |
| `unknown_stock` | 22023 | Saldo fisico assente o NULL: serve una conta, non assumere zero. |
| `insufficient_ready_stock` | 22023 | Pronto disponibile insufficiente per consegna immediata. |
| `reserved_stock_conflict` | 22023 | L'operazione violerebbe le riserve. |

La futura API deve mappare questi codici a messaggi italiani e non inoltrare stack, query, parametri o errori SQL grezzi al browser.

## Ciclo successivo alla preparazione

Quattro RPC pubbliche adottano la stessa firma `(p_operation_id uuid, p_payload jsonb)`. Wrapper invoker, processore privato, membership corrente, feature flag, lock e idempotenza sono applicati anche qui. Gli UUID operazione non si possono riutilizzare fra tipi di comando o con la registrazione originale. I risultati dei retry sono ricevute del commit originario: ricaricare ordine e disponibilità per lo stato attuale.

| RPC | Payload e comportamento |
| --- | --- |
| `complete_production` | `requirement_id`, `quantity`, `occurred_at`, `reason`. Solo founder/Gabriele con ruolo production attivo confermano capi realmente pronti. Quantità entro il deficit ancora aperto. Movimento fisico `production_receipt` + riserva alla riga nella stessa transazione, senza spesa, acquisto o completamento automatico in due giorni. Ricevimenti parziali ammessi. |
| `fulfill_order_lines` | `order_id`, `lines: [{order_line_id, quantity}]`, `occurred_at`, `reason`. Tutti i membri attivi; verifica appartenenza delle righe e riserve sufficienti, rilascia la riserva e scarica esattamente il consegnato. Evasioni parziali/multiple ammesse; non richiede pagamento già registrato. Il tentativo di consegnare deficit non ancora prodotto viene rifiutato. |
| `cancel_unfulfilled_lines` | Stesso payload quantità. Cancella solo residui non consegnati; prima riduce deficit non ancora prodotto, poi libera la parte fisica riservata. I capi pronti rimangono fisicamente presenti. Aggiorna stato e valore annullato, aggiunge fatto commerciale di cancellazione. Non esegue né dichiara un rimborso. |
| `record_manual_payment` | `order_id`, `amount_cents`, `method`, `occurred_at`, `reference?`. Tutti i membri attivi possono dichiarare l'incasso esatto del valore rimasto dopo cancellazioni; solo EUR e un incasso completo per ordine in questo primo flusso. Non ripete vendita o scarico. Ordine interamente annullato, incasso già presente e importo diverso vengono rifiutati. |

Gli istanti devono essere espliciti, non futuri e non precedenti all'ordine. Le righe quantitative sono ordinate in normalizzazione, univoche e limitate a 50; quantità intere positive entro 100.000 e causale da 3 a 500 caratteri. Non si ricevono costi, totali, ruoli o identità provider dal client. Per la produzione non esiste ancora un comando di avvio né capacità/materiali stimati: il ricevimento è l'attestazione esplicita del responsabile che i capi sono pronti.

L'annullamento parziale ripartisce il totale scontato della riga con una regola cumulativa esatta: `floor(totale_riga × quantità_annullata_cumulativa / quantità_originale)`. Ogni nuovo fatto registra soltanto la differenza dal cumulativo precedente. Esempio sintetico: 12.002 centesimi per 3 unità, annullate una alla volta → cumulativi 4.000, 8.001, 12.002; nessun centesimo perso e totale finale esatto.

Lo stato ordine (`confirmed`, `partially_cancelled`, `cancelled`), quello di consegna (`unfulfilled`, `partial`, `fulfilled`, `cancelled`) e quello pagamento restano separati. La risposta lifecycle include `total_cents` originale, `cancelled_cents`, `remaining_value_cents` e `refund_due_cents`. Quest'ultimo è `max(0, pagamento_dichiarato − valore_rimasto)`: è un debito operativo da gestire, senza un pagamento negativo, una riga BudgetFlow o un movimento di cassa inventato. Le autorizzazioni Finance continuano a proteggere i riferimenti dell'incasso.

Ulteriori errori macchina, tutti SQLSTATE 22023 salvo `production_permission_required` 42501: `production_quantity_exceeded`, `unfulfilled_quantity_exceeded`, `payment_amount_mismatch`, `payment_already_recorded`, `order_cancelled`. Per consegna priva di riserve pronte si usa `insufficient_ready_stock`. Ogni errore su una riga annulla anche effetti già tentati sulle precedenti.

## Finance e accessi

`commercial_facts` conserva `sale_observed`, `payment_reported` e `sale_cancellation_observed`, tutti `observed_unclassified`. Non sommarli insieme come ricavi: sono fatti distinti dello stesso ciclo. Le cancellazioni hanno importo positivo e tipo esplicito, da sottrarre nella vista del valore commerciale; non rappresentano un rimborso. `order_payments` conserva solo la dichiarazione del membro. Nessun insert automatico in `finance_entries`; nessuna modifica a `finance_import_transactions` BudgetFlow; nessun saldo cassa, accredito, commissione, IVA o profitto inventato.

Tutte le nove nuove tabelle esposte hanno RLS. I membri leggono ordini, righe, riserve, preparazione, ricevimenti produzione e consegne operative. `commercial_facts` e `order_payments` richiedono `private.can_finance()` con ruolo ammesso e aal2; un membro operativo può crearli tramite il comando senza leggerli. Nessun membro, nemmeno founder, ottiene DML diretto su queste tabelle. Eventi riserva, pagamenti, ricevimenti, consegne e fatti osservati sono append-only, con audit. La outbox e le ricevute comandi sono private e non leggibili dai membri; non esiste ancora worker Shopify.

## Verifica

Esecuzione senza cloud e senza dipendenze aggiunte all'app:

```sh
node supabase/tests/sales-ecosystem.mjs /tmp/luckylap-sql-validation/node_modules/@electric-sql/pglite/dist/index.js
```

**445 verifiche PASS** con fixture sintetiche e Auth simulato: payload invalidi, ruoli/revoca immediata, RLS/anon, prezzi e costo ignoto, centesimi, idempotenza e ordinamento canonico, riferimenti duplicati, atomicità su seconda riga, stock ignoto/insufficiente, riserve senza doppia allocazione, rettifiche compatibili con riserve, completamento produzione, evasione/cancellazione parziali, sconto con resto di un centesimo, pagamento successivo senza scarico doppio, append-only e separazione Finance/BudgetFlow. La prova dell'ultimo capo è sequenziale: il secondo comando viene rifiutato; non è una prova di due connessioni in gara. Non certifica JWT/MFA reali, PostgREST, connessioni PostgreSQL simultanee, gestione deadlock/retry applicativa, API o flussi frontend. Eseguire advisor sicurezza/prestazioni sul progetto dopo l'eventuale applicazione; questa implementazione non ha operato sul cloud.

Riferimenti verificati: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Database Functions](https://supabase.com/docs/guides/database/functions), [changelog](https://supabase.com/changelog). L'indice del changelog segnalava l'upgrade minore PostgreSQL 15.19/17.11: questa migrazione usa hashing nativo e non aggiunge pgcrypto, ltree, btree_gist, operatori custom o dipendenze dalle parti interessate.
