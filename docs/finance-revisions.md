# P4 — Nucleo delle revisioni Finance

Finance conserva le fonti e registra correzioni applicative complete, attribuite all’utente autenticato. Saldi, grafici, categorie, filtri e registro usano la stessa proiezione corretta. Non chiama Shopify né modifica le osservazioni del provider.

## Fonti e versioni

Le identità sono `source_kind` e UUID della riga originale:

| Tipo P4 | Fonte immutabile | Movimento dashboard |
| --- | --- | --- |
| `budgetflow` | `finance_import_transactions` | `budgetflow:<UUID>` |
| `manual` | `finance_entries` | `manual:<UUID>` |
| `payment` | `order_payments` | `payment:<UUID>` |
| `refund` | `shopify_refund_observations` | `refund:<UUID>` |
| `consignment_settlement` | vecchi `consignment_settlements` | `consignment:<UUID>` |

Il pagamento mensile P3 `shop_payment`, identificato da `shop-payment:<UUID>`, resta gestito da `update_consignment_payment` e dal suo storico CAS. `financeRevisionTarget` lo delega: non viene creata una seconda fonte di importo.

La versione zero è il dato originale. La revisione contiene data locale, direzione, centesimi assoluti, conto, eventuale conto di destinazione BudgetFlow, categoria, descrizione e pending. Una eliminazione conserva questi valori e aggiunge `deleted=true`. Il ripristino copia i valori della versione richiesta e li riattiva; è possibile recuperare anche una voce manuale già annullata dal vecchio registro. Le nuove versioni non riscrivono fonte, import, eventi Shopify o altre revisioni.

Un reimport dello stesso file BudgetFlow restituisce il batch originale con gli stessi UUID: la correzione rimane collegata a quella riga. Un export sovrapposto diverso rimane bloccato dal meccanismo di importazione esistente; non vengono inventate corrispondenze tra nuovi UUID.

Le correzioni e i saldi seguono gli alias conto già adottati dalla dashboard: `cash` diventa `Cash` e `revolut business` diventa `Revolut Business`, senza distinguere maiuscole. Gli altri nomi mantengono la propria grafia. La normalizzazione precede il controllo di trasferimento sullo stesso conto; le fonti e gli snapshot originali restano integri.

## Comando e letture

`revise_finance_movement(p_operation_id uuid,p_payload jsonb)` riceve:

```text
schema_version: 1
source_kind / source_id
expected_version: versione corrente, zero per la fonte non corretta
reason: motivazione, 3–500 caratteri
azione update: values completi
azione delete: nessun values; non ammessa per payment e refund
azione restore: restore_version
```

Dal 23 ottobre 2026 (`20261023140200_finance_fixes.sql`) `delete` su `payment` o `refund` risponde `finance_movement_delete_not_allowed` (`22023`): incassi delle vendite e rimborsi Shopify si correggono e si ripristinano, ma si annullano in Vendite («Annulla registrazione» o «Registra reso»). Una ricevuta già scritta prima della regola si recupera ancora. La motivazione resta obbligatoria nel database (vincolo della tabella); nell'app è facoltativa e, se vuota, diventa «Correzione», «Eliminazione» o «Ripristino» (`financeRevisionReason`).

I nomi esatti dei campi e i DTO si trovano in `src/lib/finance-revisions/model.ts`. Il payload viene normalizzato e associato in modo persistente a UUID, utente e hash del contenuto. Un retry con lo stesso tentativo recupera la ricevuta; UUID riusato con utente o dati diversi è un conflitto. La verifica del permesso Finance precede anche il recupero della ricevuta e viene ripetuta dopo l’attesa sui lock.

`public.finance_movement_revisions` è append-only e leggibile soltanto con `private.can_finance()`. La vista `finance_revision_current` usa `security_invoker=true`. I client non hanno DML né accesso alle ricevute private; i wrapper pubblici sono invoker e i processori privati controllano l’autorizzazione corrente. Rimangono in vigore membership, password Finance, versione della password, scadenza e presenza della sessione Auth nel database.

API della proiezione:

- `loadFinanceRevisions(client)` legge tutte le revisioni correnti, con paginazione completa e conteggio esatto.
- `loadFinanceRevisionHistory(client, ref)` legge fonte/versione zero e storico ordinato, senza inventare revisioni mancanti.
- `executeFinanceRevision(client, command)` verifica l’accesso, invia il payload congelato e valida identità/versione della ricevuta. Errori sconosciuti o risposte perse rimangono incerti.
- `preserveFinanceRevision`, `readPendingFinanceRevision` e `acknowledgeFinanceRevision` conservano il tentativo per utente prima dell’invio; una ricevuta di un’altra operazione non può cancellarlo.
- `applyFinanceRevisions` sostituisce ogni movimento una volta, separa gli eliminati e conserva i pagamenti P3. Per ripristinare una fonte esclusa dal vecchio void occorre passare anche il suo originale; in mancanza la proiezione fallisce esplicitamente.
- `revisedAccountBalances` ricalcola i saldi in `bigint`, separando pending e futuri. Un trasferimento BudgetFlow mantiene due gambe opposte e non crea denaro.

## Coerenza Vendite

Un solo helper SQL, `private.effective_order_payment_summary`, legge pagamenti e rimborsi originali insieme all’ultima revisione. Esclude eliminati, pending e date future secondo il giorno Europe/Rome. Calcola netto, residuo e sovraincasso con interi; gli aggregati per ordine oltre il limite operativo generano un errore atomico.

Il nuovo `refresh_sale_order` usa questo calcolo per i manuali. `record_manual_payment` blocca la riga ordine e accetta esattamente il residuo efficace: una correzione da 100 a 50 permette un nuovo incasso di 50. Sono rimossi soltanto i due indici che imponevano un pagamento manuale per ordine; rimangono unicità di ID, operation ID, collegamento pagamento/fatto e ricevute. Due incassi concorrenti dello stesso residuo non possono riuscire entrambi.

Correggere un incasso a un importo minore riapre il residuo; da Finance non si elimina. L'annullamento di una registrazione in Vendite esclude i suoi incassi con revisioni proprie, senza passare da `revise_finance_movement`. Ripristinare la versione originale dopo un altro pagamento espone il sovraincasso come importo da restituire, senza creare un rimborso eseguito. Segni, pending e date corrette determinano il flusso dichiarato; non generano eventi esterni. Per Shopify la revisione lascia intatti capture, rimborsi, stato del provider, importi fiscali e identità tecniche. Una nuova osservazione viene aggiunta una volta e non sostituisce l’overlay.

`readEffectiveSalesPayments` e `applyEffectiveSalesPayments` forniscono a Vendite il medesimo stato efficace, residuo e sovraincasso. Il DTO per tutti i membri contiene soltanto valori operativi già pertinenti all’ordine, con `sourcePaymentState` separato; per Shopify senza correzioni conserva lo stato canonico e il sovraincasso del provider, lasciando sconosciuto (`null`) il residuo interno anziché dedurlo da osservazioni incomplete; non include conto, riferimento, transazioni o JSON Finance. La scrittura della correzione rimane Finance-only. Nessuna funzione cambia quantità, prezzi, riserve, consegne o scorte.

## Vecchio conto vendita

`private.effective_consignment_settlement_summary` somma gli incassi effettivi corretti della vecchia vendita e conserva il credito/60–40 originale. Il vecchio `record_consignment_settlement` usa questo residuo sotto lock della medesima vendita, con ricevuta invariata. `readEffectiveLegacySettlements` espone netto, credito, residuo e sovraincasso solo dopo una nuova verifica Finance.

**Collegamenti operativi:**

1. Vendite legge la proiezione efficace, compresi i passaggi di giorno delle date future. Il modulo del pagamento usa `effectiveAmountDueCents` e consente il nuovo incasso del residuo.
2. La dashboard conserva `settlements` e `shopPayments`, applica le revisioni prima di ogni aggregazione e recupera la fonte originale per i manuali già annullati.
3. Il reader legacy conto vendita conserva credito e ripartizione, ma usa il netto degli incassi corretti. Dopo una correzione, originali più nuovo saldo possono superare il credito: residuo e sovraincasso dipendono dalla proiezione efficace. Non si sommano lordo, credito e incasso.
4. La vecchia azione `void_finance_entry` rimane compatibile per fonti mai corrette e per retry già riusciti. Su una fonte revisionata risponde `use_finance_revisions`; i nuovi pulsanti devono usare P4.

## Incassi mensili P3

`/finance/incasso/<UUID>` usa il pagamento P3 e il suo storico completo. Data, importo, conto, entrata/uscita, categoria, descrizione e stato pianificato vengono corretti con `update_consignment_payment`, la stessa versione attesa e le stesse ricevute P3. Eliminare imposta `voided`; ripristinare copia uno snapshot storico in una nuova versione. I vecchi comandi P3 rimangono compatibili e conservano i campi Finance quando non li specificano.

Solo importi non eliminati, non pianificati e con data già raggiunta nel giorno di Roma concorrono all’incassato netto. Una uscita lo riduce; un’eccedenza resta visibile come «Da restituire». Nessuna correzione cambia pezzi venduti, prezzi, scorte, ripartizione o fattura. Lo stato operativo del pagamento viene riletto dal medesimo calcolo anche per chi non ha accesso ai dati Finance: la risposta contiene soltanto ID e stato.

Oggi mostra i conti mensili e legacy da regolare soltanto agli utenti idonei Finance. Riverifica sessione, ruolo e apertura dell’area prima delle proiezioni; senza accesso corrente non legge importi. Un errore impedisce la visualizzazione di totali parziali.

## Verifiche locali

`supabase/tests/finance-revisions.mjs` usa PGlite 0.5.10, pgcrypto reale e i controlli Auth/sessione originali con utenti e movimenti sintetici. Verifica fonti, CAS, replay, immutabilità, restore/delete, residui, sovraincassi, nuovo evento esterno, permessi e sessioni revocate.

`supabase/tests/finance-revisions-concurrency.mjs` crea PostgreSQL 17 temporaneo, su socket privata con TCP disabilitato. Due PID reali verificano CAS simultaneo, stesso UUID concorrente, doppio residuo, revisione contro incasso, doppio incasso legacy, vecchio void contro revisione, logout durante l’attesa e rollback atomico. Il cluster viene fermato e rimosso; la prova locale conserva soltanto metadati in `.private/deployment-proof/finance-revisions-concurrency.json`.

I nuovi harness si registrano nel runner `test:db` tramite l’intestazione e non modificano il registro condiviso. Nessuna fixture contiene dati personali o finanziari del brand.
