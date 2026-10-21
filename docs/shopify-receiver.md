# Ricevitore Shopify e inbox durevole

Il percorso `POST /api/integrations/shopify/webhook` è implementato per il protocollo HTTPS tradizionale `X-Shopify-*`. Acquisisce byte raw in runtime Node, verifica HMAC con il parser esistente e salva una ricevuta e un job nella stessa transazione. **Ricevuto non significa sincronizzato:** la ricevuta originale rimane `awaiting_app`; la lavorazione è gestita dalle lease e dal [worker separato](./shopify-worker.md), con configurazione esplicita.

Non sono stati installati app, attivati webhook, importati ordini, salvati segreti o modificati dati Shopify dall’agente implementatore. Il plugin Shopify dell’assistente non fornisce una credenziale permanente al sito. L’inventario fisico resta quello verificato dal Drive; nessuna quantità Shopify entra in `stock_balances`.

## Configurazione da completare prima dell’attivazione

La route richiede tutte queste variabili nell’ambiente server del deployment:

| Variabile | Valore da configurare |
| --- | --- |
| `SHOPIFY_SHOP_DOMAIN` | Dominio canonico dello shop, nel formato `nome.myshopify.com`; non il dominio pubblico del sito e non un valore preso dall’header della richiesta. |
| `SHOPIFY_CLIENT_SECRET` | Client secret dell’app installata, utilizzato per HMAC; mai un access token inserito al suo posto. |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del progetto già usato dall’app. È pubblico; la chiave seguente rimane privata. |
| `SUPABASE_SECRET_KEY` | Una chiave Supabase privata `sb_secret_...`, disponibile solo al server. Il ricevitore rifiuta chiavi pubblicabili e chiavi legacy JWT. |

Il codice non configura queste variabili. I segreti non vanno inviati in chat, aggiunti al repository, prefissati con `NEXT_PUBLIC_` o inseriti nei client SSR della sessione. L’accesso all’inbox usa un client `@supabase/supabase-js` separato senza cookie, persistenza sessione, refresh token o rilevamento sessione nell’URL, come descritto dalla [documentazione Supabase per client server con chiave privata](https://supabase.com/docs/guides/troubleshooting/performing-administration-tasks-on-the-server-side-with-the-servicerole-secret-BYM4Fa).

Prima di una sottoscrizione reale occorrono app installata, migrazioni receiver e worker applicate, configurazione server, URL HTTPS di produzione e verifica del percorso end-to-end. I topic accettati sono `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`, `orders/fulfilled` e `orders/partially_fulfilled`, versione `2026-10`. I due topic di evasione sono snapshot Order con scope `read_orders`; il CHECK DB è esteso dalla migrazione forward del worker, senza riscrivere quella receiver già applicata. Il client secret autentica il corpo originale; le notifiche Events con header `Shopify-*` richiedono un adattatore diverso. La [documentazione Shopify sulla verifica HTTPS](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries) descrive firma, ID delle consegne e gestione dei retry.

## Acquisizione e risposta HTTP

Non viene chiamato `request.json()` o `request.text()` prima della firma. La route legge uno stream con limite **1 MiB**, anche se `Content-Length` manca o dichiara un valore inferiore al corpo. Lunghezze non valide/incoerenti, corpo vuoto, encoding compresso, UTF-8/JSON non validi e metadati non accettati falliscono. Ordini oltre il limite richiedono una revisione esplicita del limite o un diverso trasporto prima dell’attivazione; il payload non viene troncato.

Un budget condiviso di quattro secondi interrompe lettura e richiesta DB lasciando margine alla risposta HTTP. Non è una garanzia sul tempo totale di cold start o sulla rete del deployment. Shopify richiede la risposta entro cinque secondi; la ricevuta viene confermata soltanto dopo l’esito persistente della RPC, mai affidando il lavoro alla memoria della funzione Vercel. In caso di risposta persa dopo commit, il retry conserva la ricevuta originale.

Solo un `200` persistente registra l’avvio immediato tramite Next `after`, e solo se la configurazione worker è abilitata. Il callback usa direttamente il worker server dopo la risposta, senza prolungare l’ACK per leggere l’ordine. La route ha durata massima 60 secondi per consentire questo lavoro successivo; il cron durevole resta il recupero in caso di crash o callback perso. Gli altri esiti HTTP non registrano il callback.

| HTTP | Significato |
| --- | --- |
| `200` | Inbox e job persistiti oppure ricevuta identica recuperata. Corpo `received: true`, ID inbox/job, `received_at`, `state: awaiting_app`, `replayed`. Non indica importazione dell’ordine. |
| `400` | Corpo, dimensioni, dominio, topic, versione o metadati non accettati. Nessuna ricevuta. |
| `401` | Firma HMAC assente o non valida. Nessuna persistenza. |
| `409` | Stesso shop/ID consegna già presente con digest o metadati diversi. Nessuna seconda lavorazione. |
| `503` | Configurazione assente/non valida, stream interrotto/scaduto, DB indisponibile, errore di commit o ricevuta incompleta. `Retry-After: 30`; nessuna falsa conferma. |

Le risposte hanno `Cache-Control: no-store` e non espongono stack, query, corpo, dati cliente o segreti. Il codice non scrive log di payload/errori grezzi. La route non richiede sessione del team: l’autenticazione della consegna è HMAC. Nessun bypass locale è implementato.

Shopify considera gli errori consegne fallite e può ritentare otto volte in quattro ore; sottoscrizioni Admin API possono essere eliminate dopo fallimenti persistenti. Non attivare la sottoscrizione mentre l’endpoint restituisce `503`; il monitoraggio della consegna e la riconciliazione periodica restano parte dell’attivazione futura. [Comportamento di consegna e retry Shopify](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries#https-delivery-considerations).

## Persistenza e privilegi

La migrazione `20261021132937_shopify_receiver.sql`, creata con CLI Supabase `2.121.0 migration new` dopo consultazione di `--help`, aggiunge:

- `private.shopify_webhook_inbox`: solo cue ammessa dal parser, ID consegna/evento, shop, GID ordine, topic/versione, digest del corpo, digest dei metadati e data di ricezione. Non contiene corpo raw, cliente, indirizzi, righe prodotto, prezzi o transazioni.
- `private.shopify_order_read_jobs`: un solo job per inbox, con stato originale fisso `awaiting_app`. Le migrazioni forward del worker aggiungono le lease e lo stato di elaborazione separati, preservando questa fonte append-only.
- `public.receive_shopify_order_notification(p_cue jsonb)`: wrapper invoker verso processore definer nello schema privato, `search_path` vuoto, entrambi concessi soltanto a `service_role`. Il processore controlla anche il ruolo SQL assegnato dal gateway; ruoli del team e metadata utente non autorizzano chiamate.

Entrambe le tabelle hanno RLS, nessuna politica client, nessun privilegio diretto per `anon`, `authenticated` o `service_role`, e trigger append-only. La chiave privata serve esclusivamente al server per la RPC; nessuna pagina o Server Action utente la importa. Il worker usa migrazioni distinte con autorizzazioni e lifecycle espliciti: la fonte originale non viene marcata come eseguita tramite un UPDATE diretto.

Il processore applica un’allowlist stretta dei campi e valida il cue anche al confine DB. Un lock transazionale e il vincolo unico `(shop_domain, webhook_id)` serializzano i retry. UUID di consegna/evento vengono normalizzati; payload SHA256 e hash dei metadati canonici devono corrispondere alla prima consegna. Un replay restituisce gli stessi ID e istante, senza una seconda riga o un secondo job. Un errore nell’inserimento del job fa rollback anche dell’inbox.

`event_id` correla consegne della stessa azione; non è una chiave unica e non elimina consegne con ID differenti. Topic, dominio e header non sono coperti dalla firma del corpo: vengono vincolati nel digest dei metadati per rilevare conflitti, ma **restano indizi da verificare con lettura canonica**. Il worker legge l’ordine nello shop configurato prima di qualsiasi effetto. Le chiavi di idempotenza degli effetti ordine/pagamento/evasione sono distinte dalla chiave della consegna.

## Lavoro ancora necessario per sincronizzare

Prima dell’attivazione vanno applicate e collaudate le migrazioni del core Shopify, configurati esplicitamente mapping e flag, verificata l’app permanente e provato il percorso completo. Il reader `2026-10` e il worker gestiscono completezza, revisioni, retry e invio transazionale al core; casi non supportati restano in revisione. Il parser segnala POS/web/altro, ma questa etichetta non produce effetti e non duplica vendite POS come contanti manuali. Il recupero di eventi mai consegnati richiede inoltre una riconciliazione distinta. Non sono richiesti abbonamenti o scope di scrittura inventario per la ricezione.

## Verifiche locali

Le suite Vitest receiver/inbox, parser HMAC e trigger differito verificano limite dello stream con lunghezza assente/falsa, byte esatti, timeout/cancellazione, firma/body alterati, configurazione privata, singola RPC senza cookie, attesa del commit, errori di persistenza, replay, conflitti, sei topic ordine e avvio solo dopo l’ACK persistente. Le fixture contengono esclusivamente dati sintetici.

Harness isolato: `node supabase/tests/shopify-receiver.mjs /tmp/luckylap-sql-validation/node_modules/@electric-sql/pglite/dist/index.js`. **163 controlli passati**: negazione ai cinque ruoli del team e anon su wrapper/helper, nessun privilegio diretto sulle tabelle, RLS, servizio autorizzato alla sola RPC, ricevuta stabile, conflitti body/metadati, ID evento non usato come deduplica, input non ammesso, rollback del job, immutabilità e zero effetti su stock/vendite/Finance/flag.

L’harness applica soltanto initial schema, sales ecosystem e receiver per suffisso univoco; non include migrazioni parallele non pertinenti. Simula ruoli e Auth in PostgreSQL embedded su una connessione: non certifica il gateway/JWT reale, concorrenza su più connessioni, latenza del deployment o una consegna Shopify reale. Nessuna chiave o sottoscrizione reale è stata usata nei test.
