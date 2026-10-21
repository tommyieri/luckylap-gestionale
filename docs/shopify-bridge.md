# Collegamento Shopify: confine verificato, ricezione ancora da attivare

Al 21 ottobre 2026 è implementato soltanto `src/lib/shopify/webhook.ts`: una funzione server senza I/O, endpoint, credenziali, sottoscrizioni o effetti sul database. Non sono stati letti/importati ordini, attivati webhook o modificati dati Shopify. Il collegamento Shopify dell'assistente non fornisce automaticamente una credenziale permanente al gestionale.

La preparazione segue il [contratto dell'ecosistema](./ecosistema-vendite.md). L'inventario pronto nasce dal Drive; Shopify comunica disponibilità commerciale e fatti del proprio ciclo ordine. Il connettore non deve copiare quantità Shopify in `stock_balances`.

## Confine implementato

`readShopifyOrderNotification` richiede corpo raw `Uint8Array`, header, dominio `.myshopify.com` configurato dal server e client secret dell'app. Verifica HMAC-SHA256 prima di interpretare JSON, decodifica base64 stretta e confronto `timingSafeEqual` su 32 byte. Un corpo riserializzato, una firma malformata o la configurazione assente falliscono. È il metodo descritto dalla [verifica HTTPS Shopify](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries).

Il modulo accetta esclusivamente webhook tradizionali `X-Shopify-*`, versione `2026-10`, topic snapshot `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`. Gli header Events `Shopify-*` sono un protocollo diverso e non vengono adattati implicitamente. Il limite locale è 1 MiB: un futuro receiver dovrà limitarne lo stream prima di allocare il corpo; ordini oltre tale limite richiedono revisione del limite e recupero canonico, mai taglio del payload.

L'output è un'indicazione di lavoro: GID ordine esatto, data creazione/aggiornamento con offset, valuta, origine, ID consegna/evento e SHA256 del corpo. Non restituisce dati cliente, righe, prezzi o comandi di magazzino. Non ricava identificativi da numeri JavaScript oltre `MAX_SAFE_INTEGER`; il GID obbligatorio evita arrotondamenti.

La firma copre il corpo, non gli header di instradamento. L'allowlist del dominio deve quindi provenire dalla configurazione del server, mai dal solo header. Prima di effetti operativi il worker deve rileggere l'ordine nello shop configurato e verificarne esistenza/versione. Anche `source_name` è solo un indizio fino a quella lettura.

`pos` produce `shopify_pos`, `web` produce `shopify_web`, ogni altra origine rimane `shopify_other`. Il pagamento POS in contanti non genera una vendita manuale aggiuntiva. L'API descrive `sourceName` come origine dell'ordine, distinta dai gateway di pagamento: [Order 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order#field-Order.fields.sourceName).

## Ricezione e idempotenza da implementare

1. Route Handler Node, POST non memorizzata in cache; acquisire byte raw senza chiamare prima `request.json()`. Nessun secret `NEXT_PUBLIC_*`. Il modulo ha `server-only` ed usa `node:crypto`.
2. Firma e routing validi → transazione di inserimento inbox e job persistente. Rispondere 2xx solo dopo commit. Se la persistenza è indisponibile, errore recuperabile; nessun lavoro affidato soltanto alla memoria di una funzione Vercel.
3. Vincolo inbox unico `(connection_id, webhook_id)`; conservare digest, topic, API version, ID evento, ricevuto a, stato e tentativi. Retry identico restituisce la ricevuta già salvata; stesso ID con digest/metadata incompatibili va in eccezione senza effetti. `deliveryKey` è un aiuto deterministico, non sostituisce il vincolo Postgres.
4. `X-Shopify-Event-Id` correla notifiche della stessa azione, non deduplica ordini o consegne differenti. Le chiavi dei fatti restano ordine per shop+GID, pagamento per ID transazione ed evasione per ID+righe. Shopify distingue esplicitamente [ID consegna e ID evento](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries#ignoring-duplicates).
5. Worker autenticato: lettura canonica fuori dai lock, paginazione completa, importi esatti, mapping variante verificato, revisione sorgente e transazione di effetti nel core. Un replay o una notifica vecchia non applica di nuovo vendita, scarico o incasso. SKU non mappato e valuta non supportata vanno in revisione.
6. Payload grezzi solo in storage/tabelle private, accesso tecnico ristretto e conservazione limitata da definire; niente log con cliente, token o corpo. I normali membri vedono stato/esito operativo. Un errore firmato di formato/versione deve produrre un'eccezione durevole e un avviso, senza falsa ricevuta di elaborazione.

L'inbox e il worker non sono ancora creati. Servono inoltre recupero periodico con cursore e finestra sovrapposta, revoca connessione, gestione refund/reso ed evasione parziale. La data di cutover impedisce di rigiocare contro l'apertura ordini già compresi nelle quantità Drive.

## App e permessi minimi

Prima dell'attivazione occorre installare un'app sul negozio e configurare server-side client secret per HMAC e accesso Admin. Non chiedere token in chat o nel repository. Per catalogo/mapping e ordini servono `read_products` e `read_orders`; per topic `fulfillments/create` e `fulfillments/update` serve `read_fulfillments` nel caso ordinario di questo negozio. I topic transazioni/rimborsi/edit richiedono parser dedicati: il presente modulo non li tratta come snapshot ordine. Verificare gli scope nel [riferimento topic 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/WebhookSubscriptionTopic).

Non richiedere scope di scrittura inventario/ordini né accesso storico esteso per questo primo collegamento. Il worker futuro userà Admin GraphQL 2026-10, con schema e query validati prima dell'esecuzione. Il secret va ruotato mediante un passaggio operativo verificato; non esiste nel codice un bypass sviluppo della firma.

## Verifica eseguita

36 test Vitest con soli dati sintetici: alterazione byte, firma troncata/base64 invalida, configurazione assente, dominio ostile, header Events, versione/topic inattesi, dedup key distinta da event ID, POS contanti, origini sconosciute, ID grande, date impossibili/senza offset, JSON e UTF-8 malformati, corpo vuoto/oltre limite. Typecheck passato. La suite non prova persistenza, concorrenza o collegamento Shopify reale, che non sono ancora implementati.

Ricerca primaria Shopify e skill con `OPT_OUT_INSTRUMENTATION=true`; nessuna query GraphQL generata/eseguita. Prima del codice lette le guide della Next installata su Route Handlers e variabili ambiente. Nessun abbonamento o servizio aggiunto.
