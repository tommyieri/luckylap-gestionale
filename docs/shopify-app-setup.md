# App interna Shopify: preparazione LuckyLap

Ricerca su fonti ufficiali verificata il **21 ottobre 2026**. Destinazione comunicata dal founder: `qrtmdm-i1.myshopify.com`, piano Basic, nuova app interna `LuckyLap Gestionale`. App interna **creata e installata** con autorizzazione esplicita del founder il 21 ottobre 2026, versione `luckylap-internal-1`, API 2026-10. Il grant client credentials è stato verificato: soli `read_products` e `read_orders`, scadenza 24 ore. Le credenziali sono configurate esclusivamente sul server Vercel LuckyLap. Sottoscrizioni e avvio sono tracciati nel [deployment](deployment.md).

## Percorso compatibile con Basic e senza nuovi abbonamenti

Dal 1° gennaio 2026 le nuove custom app si creano nel Dev Dashboard; il vecchio percorso che generava un token permanente nell’admin riguarda app legacy già esistenti. [Changelog Shopify](https://changelog.shopify.com/posts/legacy-custom-apps-can-t-be-created-after-january-1-2026).

Per l’app di un solo merchant non occorre iscriversi allo Shopify App Store: la documentazione esenta esplicitamente questo caso dalla registrazione. Non serve scegliere distribuzione pubblica o configurare piani Billing/App Pricing. Questa integrazione non richiede un acquisto né una richiesta di abbonamento; il piano Shopify del negozio resta quello esistente. [Registrazione e revenue share Shopify](https://shopify.dev/docs/apps/launch/distribution/revenue-share).

**Basic non è il blocco del grant:** app e negozio devono appartenere alla stessa organizzazione Shopify, distinta da Supabase/Vercel. Stessa email, accesso collaboratore o installazione dell’app non provano l’appartenenza. Va verificata nell’account del titolare. Organizzazioni diverse possono causare `shop_not_permitted`: non risolverlo acquistando Plus o modificando la proprietà del negozio. [Prerequisito e troubleshooting del client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant?lang=node#troubleshooting).

Plus serve ad alcune possibilità di installazione multipla, non a questo singolo negozio. Per app create nell’organizzazione merchant si usa la scheda **Installs**; la scheda **Distribution** è riservata alle organizzazioni Partner. Se quest’ultima non compare, non manca automaticamente un piano a pagamento. [Distribuzione e installazione](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method).

## Passi del titolare nel Dev Dashboard

1. Aprire [**https://dev.shopify.com/dashboard**](https://dev.shopify.com/dashboard) con l’account proprietario LuckyLap. Un’alternativa dal negozio è **Impostazioni → App → Sviluppa app → Build apps in Dev Dashboard**. Il proprietario ha accesso alla gestione delle custom app; un semplice account collaboratore non ha gli stessi permessi organizzativi. [Percorso dall’admin](https://help.shopify.com/en/manual/apps/managing-apps), [permessi del titolare](https://help.shopify.com/en/manual/apps/about-apps#required-permissions-for-creating-and-managing-custom-apps).
2. Controllare il selettore dell’organizzazione. Usare quella merchant che possiede `qrtmdm-i1.myshopify.com`, senza creare un’organizzazione Partner separata per questa app. Se compare un avviso di mancato accesso developer, verificare il ruolo **App developer** con il proprietario; non è necessario acquistare Plus per i ruoli standard. [Permessi Dev Dashboard](https://shopify.dev/docs/apps/build/dev-dashboard/user-permissions).
3. In **Apps → Create app → Start from Dev Dashboard**, scegliere il nome **LuckyLap Gestionale**.
4. Creare una versione: **App URL** ufficiale per app non embedded `https://shopify.dev/apps/default-app-home`, **Webhooks API version: 2026-10**, scope della tabella seguente. App URL ed endpoint webhook sono distinti.
5. Selezionare **Release**. La versione deve esistere prima dell’installazione.
6. In **Installs → Install app**, scegliere il negozio reale LuckyLap e verificare gli scope prima di **Install**. Shopify può mostrare una pagina di consenso OAuth.
7. In **Settings / App settings → Credentials**, recuperare Client ID e Client secret per la configurazione privata del server. Non incollarli in chat, documenti, screenshot condivisi o repository.

I passaggi 3–7 seguono la [guida ufficiale alla creazione di app dal Dev Dashboard](https://shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard). Le etichette possono seguire la lingua dell’admin. Il percorso è stato completato dopo l’autorizzazione del founder; in questa UI l’installazione era disponibile dal menu della riga app, voce «Installa app».

## Scope minimi da verificare nella versione

| Scope | Quando serve |
| --- | --- |
| `read_products` | Rilettura del catalogo e mapping esatto dei GID variante/SKU/prezzi. |
| `read_orders` | Ordini, righe, transazioni e dati di evasione esposti dall’ordine; notifiche snapshot `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`, `orders/fulfilled`, `orders/partially_fulfilled`. Copre normalmente gli ultimi 60 giorni. |
| `read_fulfillments` | Necessario per gli eventuali topic distinti `fulfillments/create` e `fulfillments/update`. Questi due topic non appartengono al receiver corrente. I due eventi `orders/*fulfilled` sono invece snapshot Order e usano `read_orders`. |

Per i sei topic del receiver bastano i primi due scope. Non richiedere `write_orders`, `write_inventory`, `write_products`, `read_customers`, pagamenti Shopify o `read_all_orders` per questa fase. Lo storico oltre sessanta giorni richiederebbe approvazione separata: non è necessario per avviare gli eventi nuovi rispettando il cutover concordato. La documentazione 2026-10 conferma i topic, gli scope e il payload Order; il receiver conserva solo il riferimento verificato e il worker rilegge lo stato completo. [Riferimento scope](https://shopify.dev/docs/api/usage/access-scopes), [topic webhook 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/WebhookSubscriptionTopic), [payload ufficiali](https://shopify.dev/docs/api/admin-rest/2026-10/resources/webhook).

La lettura dell’oggetto GraphQL `Fulfillment` è già ammessa con `read_orders`; lo scope richiesto dai suoi webhook dedicati è un requisito distinto. Non aggiungere permessi di scrittura evasione per leggere gli eventi. [Oggetto Fulfillment 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Fulfillment).

Su Basic esistono limiti alle custom app che richiedono dati personali di livello 2, come nome, indirizzo, email e telefono. Il gestionale può preparare la sincronizzazione operativa usando GID, SKU, quantità, importi, stato e canale senza richiedere questi campi. È una scelta di implementazione coerente con il cue già presente, non una garanzia che qualunque query ordine sia esente da controlli o redazioni. Non acquistare un upgrade per aggiungere dati cliente non richiesti dal progetto. [Limite Basic per Level 2 PII](https://help.shopify.com/en/manual/apps/about-apps#custom-level-2-pii-apps), [classificazione dei dati protetti](https://shopify.dev/docs/apps/launch/protected-customer-data).

## Token: ottenimento e rinnovo sul server

Con app installata nella stessa organizzazione dello shop, il backend usa **client credentials grant**: POST a `https://qrtmdm-i1.myshopify.com/admin/oauth/access_token`, corpo con `grant_type=client_credentials`, Client ID e secret. Il gestionale non deve implementare redirect OAuth per questo grant; non invia direttamente Client ID/secret come token GraphQL. [Flusso per l’organizzazione proprietaria](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant?lang=node).

Il token dura circa **24 ore**, con `expires_in` documentato pari a `86399`. Va rispettata la durata restituita, con margine prima della scadenza. Non viene fornito un `refresh_token` per questo grant: il rinnovo ripete lo scambio con Client ID e secret. Il worker futuro dovrà gestire questo rinnovo sul server; un token copiato una volta non rende permanente l’integrazione. Le richieste Admin GraphQL usano poi `X-Shopify-Access-Token`. [Durata e rinnovo dei token](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens#token-lifetimes).

Se l’app deve agire su shop esterni all’organizzazione, client credentials non è applicabile: occorre distribuzione custom e un flusso adatto all’app, come authorization code grant per un backend esterno o token exchange per un’app embedded. Questa alternativa comporta lavoro applicativo diverso, non un semplice token aggiuntivo da incollare. Per LuckyLap la prima scelta resta l’app nella propria organizzazione merchant. [Scelta del flusso di autenticazione](https://shopify.dev/docs/apps/build/authentication-authorization#choosing-an-approach).

## Webhook: credenziale e stato attuale

HMAC usa **il Client secret dell’app**, sul corpo raw, non l’access token a scadenza. Il nostro endpoint è `/api/integrations/shopify/webhook`, protocollo `X-Shopify-*`, versione `2026-10`. Dominio e secret devono provenire dalla configurazione del server, non dalla richiesta. [Verifica delle consegne HTTPS](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries).

Il [receiver implementato](./shopify-receiver.md) richiede `SHOPIFY_SHOP_DOMAIN=qrtmdm-i1.myshopify.com`, `SHOPIFY_CLIENT_SECRET`, URL Supabase e chiave privata Supabase server. `SHOPIFY_CLIENT_ID` è usato dal worker per il grant; il receiver non richiede un token Admin. I valori privati vanno configurati direttamente nell’ambiente server senza pubblicarli o trasmetterli in chat.

La persistenza in inbox produce un job duraturo. Il worker implementa rinnovo token, lettura canonica, transazione degli effetti e retry; la sua applicazione cloud va verificata prima di attivare i sei topic. La sola ricevuta webhook non dimostra l’applicazione degli effetti. L’inventario commerciale Shopify non sostituisce l’apertura fisica derivata dal Drive.

## Prerequisiti ancora aperti, senza nuove scelte di piano

- Verificare nell’account del titolare l’organizzazione Shopify corretta e il diritto di sviluppare/installare l’app. La ricerca non ha ispezionato quell’account.
- Creare, rilasciare e installare **LuckyLap Gestionale** nel negozio indicato, con `read_products` e `read_orders` per i sei topic del receiver corrente.
- Configurare in modo privato Client ID/secret e la chiave tecnica Supabase per il server, verificando che appartengano alle destinazioni corrette. Nessun valore è richiesto in chat.
- Completare worker, rinnovo token, lettura canonica e applicazione idempotente degli effetti, usando il cutover già concordato e senza import storico automatico. Solo dopo verificare una consegna controllata e attivare le sottoscrizioni ammesse.

Il piano Basic e la registrazione App Store non richiedono una scelta ulteriore per il percorso descritto. Se l’account reale smentisce il requisito della stessa organizzazione, il punto da risolvere è l’origine dell’app o il flusso OAuth, senza attivare abbonamenti.
