# Reader canonico Shopify

`src/lib/shopify/canonical-reader.ts` legge un ordine attraverso Shopify Admin GraphQL **2026-10** e restituisce una proiezione verificata. Non scrive sul database, non modifica Shopify, non registra vendite o incassi e non muove scorte. Scheduler, credenziali, inbox e applicazione atomica dei fatti appartengono a moduli separati.

## Contratto pubblico

```ts
readCanonicalShopifyOrder(
  { shopDomain, adminToken, orderId },
  { fetch?, timeoutMs?: number, maxPages?: number }
): Promise<CanonicalReadResult>
```

Gli input sono espliciti: dominio canonico minuscolo `*.myshopify.com`, token Admin dell'app presente soltanto sul server e GID `Order`. Non si ricavano destinazione o credenziale da header webhook, sessione del plugin o URL arbitrari. Il token viaggia soltanto nell'header della richiesta HTTPS al dominio configurato. Redirect disabilitati, cache disabilitata, nessun cookie. Questi moduli e il modello importano `server-only`.

Il risultato è una delle tre forme:

```ts
{ status: "ready", order: CanonicalShopifyOrder }
{ status: "review", code: CanonicalFailureCode, message: string }
{ status: "unavailable", code: CanonicalFailureCode, message: string }
```

Soltanto `ready` contiene dati. Gli errori non includono body HTTP, messaggi GraphQL, stack, token o risposta parziale. `unavailable` distingue problemi di configurazione/accesso, rete, limite temporaneo, timeout, GraphQL e snapshot cambiato; il chiamante decide se correggere configurazione o riprovare con backoff. `review` indica formato, valuta, precisione, identità, versione o completezza non confermati. Nessun retry interno.

## DTO versione 1

La definizione completa esportata è `CanonicalShopifyOrder` in `canonical-model.ts`; è il contratto condiviso con il processore SQL. `schemaVersion: 1`, `apiVersion: "2026-10"`. Le proprietà non presenti nell'allowlist sono eliminate dal normalizer anche se ricevute in un input sintetico.

| Gruppo | Fatti conservati |
| --- | --- |
| Identità | `shopDomain`, `orderId`, `sourceName`, `retailLocationId` |
| Stato | `createdAt`, `updatedAt`, `cancelledAt`, `test`, `edited`, `hasDiscountCodes`, valute shop/presentment, `taxesIncluded` |
| Totali | totale originale/corrente, subtotale originale/corrente, spedizione originale/corrente, imposte originali/correnti, totale rimborsato/ricevuto, sconto ordine e sconti totali |
| Righe | GID riga e variante, SKU, quantità originale/corrente, `isGiftCard`, `requiresShipping`, prezzo unitario originale, totale scontato, sconto riga e importi delle allocazioni |
| Fulfillment | GID, stato, location, aggiornamento, quantità totale; GID dettaglio, riga originale e quantità |
| Transazioni | GID, kind, status, importo e valuta, data, parent, test e gateway |
| Rimborsi | GID, creazione/aggiornamento, totale; GID dettaglio nullable, riga originale, quantità, `restockType`, `restocked`, location |

Importi: centesimi interi non negativi fino a `9_000_000_000_000_000`. Parsing decimale tramite `BigInt`, senza moltiplicazioni floating point, conversioni valutarie o arrotondamenti nascosti. Sono accettate soltanto valute EUR, anche per presentment. Importi con più di due decimali, esponenti o valori fuori limite richiedono revisione. Ogni somma o prodotto successivo deve usare aritmetica esatta e verificare il proprio limite.

Quantità: interi `0..1_000_000_000`. Date: ISO in UTC; frazioni fino a nove cifre conservate, evitando di collassare due revisioni nello stesso millisecondo. Nullable rimangono nullable: subtotale/imposte originali, sconto ordine/totale, SKU/variante, location, data transazione, quantità fulfillment e ID dettaglio rimborso. Non sono convertiti in zero o in riferimenti inventati.

Non vengono richiesti né conservati cliente, email, indirizzi, note, attributi liberi, dettagli di pagamento, ricevute o tracking. I codici sconto diventano il solo booleano `hasDiscountCodes`. I GID rappresentano identità tecniche, senza recapiti o profili cliente.

## Significato commerciale e limiti

In [LineItem 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/LineItem), `quantity` include unità rimborsate/rimosse, mentre `currentQuantity` le esclude. `discountedTotalSet(withCodeDiscounts: true)` e `totalDiscountSet` includono quelle quantità originarie ed escludono gli sconti a livello ordine. La relazione fra prezzo unitario × quantità originale, sconto riga e totale scontato deve essere verificata dal processore; non si ricostruisce un prezzo medio arrotondato. Coupon, sconti ordine, gift card, gateway e righe non mappate restano fatti espliciti da valutare.

Il booleano `edited` di [Order](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order) è conservato. Il processore deve anche confrontare la baseline immutabile di ID, variante, SKU, quantità, prezzo e sconto: il reader non decide che una modifica sia applicabile automaticamente.

Le [transazioni](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/OrderTransaction) mantengono kind/status e parent. Un'autorizzazione o un void non diventano incassi; una capture o una sale richiedono comunque le regole di applicazione del processore. Il reader non produce un campo `cashReceived` derivato e non tratta `totalReceivedCents` come movimento bancario.

Un [rimborso](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Refund) contiene fatti finanziari. `restocked` e `restockType` del [dettaglio](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/RefundLineItem) sono indicazioni Shopify: non autorizzano rientri fisici nel magazzino reale. Fulfillment non SUCCESS, location mancanti e quantità nullable sono conservati per la decisione successiva, senza dedurre consegne o disponibilità.

## Completezza e letture concorrenti

Le quattro query sono in `canonical-queries.ts`: riepilogo ordine, righe ordine, dettagli fulfillment e dettagli rimborso. Le tre connection usano `first: 100`, `after`, `hasNextPage` ed `endCursor`. Il reader segue tutte le pagine, controlla avanzamento del cursore, pagine vuote incoerenti, duplicati e riferimenti estranei. È ammessa una pagina corta con pagina successiva.

`Order.transactions` e `Order.fulfillments` sono array, non connection paginabili. Si chiedono fino a 250 record e si confrontano i rispettivi `transactionsCount`/`fulfillmentsCount`: precisione **EXACT** e conteggio uguale alla lunghezza sono obbligatori. Un conteggio superiore a 250, approssimato o incoerente produce `review`; nessun ordine troncato viene restituito come pronto.

`Order.refunds` viene richiesto senza `first`, quindi senza applicare l'argomento di troncamento. Non esiste un conteggio dedicato nello schema ispezionato: il reader accetta al massimo 249 rimborsi e manda 250 o più in revisione. Ogni `refundLineItems` viene poi paginato interamente. Tutte le transazioni provengono dall'elenco ordine confermato dal conteggio esatto; non si usa un sottoinsieme di transazioni del rimborso.

Il riepilogo viene letto prima e dopo tutti i dettagli. Ogni pagina di righe verifica l'ID ordine e la stessa revisione `updatedAt`; ogni pagina di fulfillment/rimborso verifica proprietario, ID e metadati del riepilogo iniziale. La verifica finale confronta l'intera proiezione del riepilogo, compresi importi e revisioni dei figli. Una differenza produce `unavailable/snapshot_changed` e richiede una nuova lettura completa. Shopify non offre qui uno snapshot transazionale: un cambiamento successivo all'ultima risposta sarà gestito da una successiva consegna/job e dal controllo versioni del processore.

Limiti espliciti: deadline globale predefinita 15 secondi (configurabile `1..60000` ms), 2 MiB effettivi per risposta anche senza `Content-Length`, 100 pagine per connection (configurabile `1..100`), 10.000 nodi per connection e massimo globale `4 × maxPages + 2` richieste. Anche molti figli o GraphQL con pagine costose possono raggiungere questi limiti: l'esito è revisione/indisponibilità, mai un risultato parziale. Il reader riconosce throttling HTTP/GraphQL ma non implementa scheduler basato sui costi. Ogni errore GraphQL impedisce l'uso di eventuale `data` parziale. La risposta deve confermare `X-Shopify-API-Version: 2026-10`.

## Verifica eseguita

Schema e campi ispezionati prima tramite MCP Shopify. Il validatore MCP ha dichiarato di saltare la validazione; non è stata eseguita alcuna query al negozio per aggirarlo. Le quattro query sono state invece validate con Shopify AI Toolkit `validate.mjs --api admin --version 2026-10`, artifact `luckylap-canonical-{summary,lines,fulfillment,refund}`, revisione 1: tutte valide, `resolvedVersion: 2026-10`. Nessuna query è stata modificata dopo quella validazione. I permessi riportati dal validator includono alternative di accesso: la disponibilità effettiva di scope e credenziali dell'app resta da verificare al collegamento reale.

60 test sintetici passati (26 modello, 34 reader): precisione centesimi e timestamp, quantità originarie, più capture con parent, authorization/void, hint di rimborso senza scorte, PII esclusi, paginazione completa, conteggi troncati/approssimati, cursor non avanzanti, identità incoerenti, concorrenza, limiti, versione, timeout di fetch/stream ed errori sanitizzati. Typecheck isolato dei sei file TypeScript passato con TypeScript del progetto. Il build complessivo e la suite integrata restano verifiche del coordinatore; nessun ordine reale o credenziale reale è stato usato in questa verifica.
