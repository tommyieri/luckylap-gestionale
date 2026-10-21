# Worker ordini Shopify

Motore pubblicato il 21 ottobre 2026; connessione reale e pianificazione attivate come documentato nel [deployment](deployment.md). Applicare le migrazioni non crea job cron, segreti, webhook o abbonamenti. Il worker e la pianificazione richiedono configurazione esplicita. La ricevuta del webhook prova la persistenza della notifica; non prova che magazzino e Finance siano già sincronizzati.

## Endpoint e credenziali

`POST /api/integrations/shopify/worker` esegue un ciclo completo atteso dal server. Usa Node, `maxDuration = 60`, budget interno di 45 secondi e massimo tre job sequenziali. Non usa sessioni utente, cookie, parametri URL o il corpo della richiesta per scegliere ordini, shop o quantità. L’unica autorizzazione HTTP è `Authorization: Bearer <segreto worker>`, confrontata con controllo a tempo costante dopo averne limitato la lunghezza.

| Variabile server | Scopo |
| --- | --- |
| `SHOPIFY_WORKER_ENABLED` | Deve essere esattamente `true`; assente, `false` e altri valori disabilitano il percorso. |
| `SHOPIFY_SHOP_DOMAIN` | Dominio `.myshopify.com` del solo negozio configurato. |
| `SHOPIFY_CLIENT_ID` | Client ID dell’app permanente installata. |
| `SHOPIFY_CLIENT_SECRET` | Segreto dell’app, usato per ottenere il token Admin; lo stesso segreto verifica HMAC nel receiver. |
| `SHOPIFY_WORKER_SECRET` | Segreto tecnico distinto, casuale, con 32–256 caratteri URL safe. Non è una password del team. |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del progetto, già pubblico. |
| `SUPABASE_SECRET_KEY` | Chiave privata `sb_secret_…`, usata solo dal client tecnico isolato. |

Le tre credenziali private non devono avere un prefisso `NEXT_PUBLIC_`, comparire nel repository, nei parametri URL, negli screenshot o nei messaggi. Nessun valore viene predisposto dal codice. Il client Supabase del worker non eredita JWT o cookie del chiamante e disabilita persistenza e rinnovo delle sessioni Auth. Il suo trasporto consente solo POST ai tre percorsi RPC dell’origine configurata, rifiuta redirect e limita la risposta a 64 KiB prima del parser PostgREST; i corpi di errore vengono cancellati senza lettura.

L’app Shopify e lo shop devono appartenere alla stessa organizzazione Shopify per il grant `client_credentials`. I token durano circa 24 ore; non esiste un refresh token per questo grant. `token.ts` ripete lo scambio prima della scadenza, conserva il risultato solo nella memoria del processo, coalesca richieste concorrenti e separa la cache per shop e credenziali. Un cold start riparte senza token. Il margine di rinnovo è di 60 secondi, calcolato dall’inizio della richiesta; una rotazione delle credenziali invalida la cache. La richiesta token è limitata a quattro secondi e 64 KiB, senza redirect; gli error body non vengono letti. La risposta deve confermare `read_orders` e `read_products`. [Grant ufficiale Shopify](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant?lang=node).

## Elaborazione e recupero

1. `claim_shopify_order_jobs` prende un solo job con UUID del worker, limite uno e lease di 120 secondi. Un altro claim parte solo se rimangono almeno 28 secondi per acquisizione, token, lettura e commit. I lock SQL gestiscono i processi concorrenti.
2. Il dominio del job deve coincidere con lo shop configurato prima di ottenere o inviare una credenziale Shopify. Un dominio diverso finisce in revisione senza chiamare Shopify. Una lease già scaduta o troppo breve non viene utilizzata.
3. Il reader canonico rilegge l’ordine con la versione `2026-10`, paginazione e controlli di completezza propri, entro 15 secondi. Un abort del ciclo viene propagato anche al trasporto della lettura. Il worker non ricava importi, scarichi, incassi o rimborsi dal payload webhook.
4. `ready` va a `apply_shopify_order` con lo stesso job, la stessa lease e il DTO canonico invariato. L’identità dello shop, dell’ordine e della versione viene verificata prima dell’invio. Tutti gli effetti operativi e finanziari e la finalizzazione del job appartengono alla transazione SQL.
5. Un risultato reader `review` viene finalizzato in revisione; `unavailable` viene riprogrammato tramite `finish_shopify_read_job` dopo 60 secondi, oppure 120 per throttling. Non viene persistito il messaggio del reader. Dopo `access_denied` è ammesso un solo nuovo grant e una sola rilettura, se il budget consente anche la finalizzazione; un rifiuto persistente richiede revisione.

Ogni chiamata DB è limitata a quattro secondi. Gli stati restituiti da `apply` (`applied`, `replayed`, `stale`, `ignored`, `review`, `retry`) sono già finalizzati dal database: non segue un secondo `finish`. `retry` di `apply` pianifica già il tentativo successivo.

Un timeout o una risposta persa durante `apply` resta **incerto**. Il worker non dichiara successo, non crea una nuova operazione e non sovrascrive lo stato con `finish`. Se il commit è avvenuto, il job è terminale; altrimenti la lease scaduta diventa reclamabile. Il backend conserva inoltre il replay della ricevuta per la stessa lease e lo stesso digest canonico. Un errore o una risposta non valida a claim/finish ferma il ciclo, mantenendo il recupero nel database.

La risposta HTTP contiene soltanto conteggi per stato e l’eventuale limite di budget. `200` conferma il ciclo e gli esiti persistiti, che possono includere revisione o retry; non significa che ogni ordine sia stato applicato. `401` indica bearer non valido. Configurazione incompleta o persistenza incerta restituiscono `503`, `Retry-After: 60` e nessun dettaglio interno. Tutte le risposte sono `no-store`; nessun token, lease, DTO o errore raw viene restituito o registrato.

## Avvio immediato dopo la ricevuta

La route webhook imposta anch’essa `maxDuration = 60`. Solo dopo `receiveShopifyWebhook` concluso con `200` e configurazione worker esplicitamente abilitata registra `after` di Next. Il callback parte dopo la risposta ed esegue direttamente `runShopifyWorker`, senza richiamare l’endpoint HTTP e senza conservare richiesta raw, cookie o segnale di disconnessione del chiamante. La durata interna rimane limitata a 45 secondi; il receiver conserva il budget di quattro secondi per persistenza e ACK. Le guide installate di Next 16.4.2 confermano l’uso di `after` nei Route Handler e la gestione Vercel tramite `waitUntil`.

Un errore di registrazione o esecuzione del callback non ritira una ricevuta già persistita: il cron successivo riprende il job. `400`, `401`, `409` e `503` del receiver non avviano questo callback. L’avvio immediato riduce la latenza; non sostituisce il recupero durevole.

## Pianificazione senza nuovo abbonamento

La lettura dei cataloghi sul progetto `annvatqnllkbrtufmgnl` il 21 ottobre 2026 ha trovato `pg_cron` 1.6.4 e `pg_net` 0.20.4 disponibili, non ancora installati, e Vault 0.3.1 già installato. La migrazione `*_shopify_scheduler.sql`, creata con CLI 2.121.0, dichiara le estensioni e le funzioni; non inserisce credenziali, job o richieste HTTP. Supabase documenta l’accoppiata Cron/pg_net con Vault. [Pianificazione Supabase](https://supabase.com/docs/guides/functions/schedule-functions).

`public.configure_shopify_scheduler(p_worker_secret text, p_enabled boolean)` è una RPC riservata a `service_role`, con wrapper invoker e helper definer proprietario `postgres`; i membri del team e `anon` non possono eseguirla. Si chiama dal client tecnico server, passando il segreto già presente nell’ambiente come parametro privato. Non incollare il valore in SQL Editor, nella cron expression, nei log, in chat o nel repository. Il risultato contiene solo `enabled` e `schedule_seconds`.

- `true`: valida 32–256 byte ASCII URL safe, crea o aggiorna il solo segreto Vault `luckylap_shopify_worker_bearer`, aggiorna il puntatore privato con RLS e crea o aggiorna il job `luckylap-shopify-worker` ogni minuto. La pianificazione e la rotazione sono transazionali; un errore annulla entrambe.
- `false`: con password nulla rimuove soltanto il job del modulo, il suo puntatore e il segreto con quel nome. Gli altri job e segreti rimangono invariati. Ripetere la disattivazione è consentito. Le richieste già accodate o in esecuzione non sono revocate retroattivamente; per uno stop operativo si disabilitano anche flag server e DB.

Dispatch, rotazione e disattivazione acquisiscono lo stesso advisory lock transazionale prima di leggere il segreto. Il lock rimane fino al commit dell’accodamento: una disattivazione confermata non può essere seguita da un nuovo enqueue basato su una lettura precedente; le richieste già accodate o in volo rimangono distinte.

Il cron esegue come `postgres` il solo comando fisso `select private.dispatch_shopify_worker_tick();`. Quel helper non è eseguibile da `anon`, `authenticated` o `service_role`; legge il segreto attraverso il puntatore privato e invia JSON vuoto alla sola destinazione `https://luckylap.vercel.app/api/integrations/shopify/worker`, con timeout di 55 secondi. Nessuna RPC accetta URL, SQL o corpo HTTP arbitrari. Il bearer non compare nel testo del job. Il puntatore non contiene plaintext e non è leggibile direttamente dai ruoli API. Il preflight della migrazione richiede che `anon` e `authenticated` non abbiano SELECT su Vault; non cambia owner o grant del provider. L’accesso amministrativo Vault del ruolo server `service_role` resta consentito e richiede la chiave privata, che non raggiunge il browser. [Vault e privilegi](https://supabase.com/docs/guides/database/vault).

Un tick al minuto è sufficiente per riprendere i job in retry o con lease scaduta. La coda HTTP di `pg_net` è **UNLOGGED** e può perdere richieste dopo un crash; anche le risposte sono temporanee, normalmente conservate sei ore. La durabilità deriva dall’inbox e dai job PostgreSQL ordinari, dai tick successivi e dalle lease, non dal `request_id` HTTP. Il successo del comando cron dimostra l’accodamento della chiamata, non il completamento di un ordine. Non usare endpoint echo per ispezionare richieste con credenziali. [Limiti e funzionamento pg_net](https://supabase.com/docs/guides/database/extensions/pg_net).

Il bearer decifrato viene scritto temporaneamente negli header di `net.http_request_queue`. I ruoli con una connessione SQL possono leggerlo: Vault protegge il segreto a riposo, non questo passaggio. Supabase gestisce i grant PUBLIC di queste tabelle e non consente RLS o revoche per progetto. Prima dell’attivazione occorre verificare che `net` non sia esposto nella Data API e che i ruoli LOGIN del database siano tutti fidati; `anon` e `authenticated` devono restare NOLOGIN. L’harness locale non certifica quella configurazione cloud e non modifica i grant globali. La coda contiene soltanto il segreto tecnico del worker, mai la chiave privata Supabase. [Confine di accesso documentato da Supabase](https://supabase.com/docs/guides/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net-ad6357).

Il cron nativo Vercel Hobby ammette intervalli giornalieri; il tick al minuto usa Supabase come pianificatore e una normale Vercel Function, soggetta alle quote del progetto. Nessun upgrade viene attivato. Va monitorata la coda SQL, inclusi i job in revisione, oltre alle risposte HTTP e alla crescita dello storico cron; i piani gratuiti non introducono una garanzia di servizio continuo. [Limiti cron Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Attivazione ancora separata

Servono app permanente installata, credenziali server, migrazioni SQL applicate e collaudate, mapping espliciti SKU/location e abilitazione DB della sincronizzazione. La configurazione worker e quella DB hanno entrambe effetto: la presenza dell’endpoint non abilita il progetto. L’attivazione deve verificare il percorso webhook → inbox → lettura → commit con la stessa consegna ritentata. Non importa automaticamente lo storico e non sostituisce l’inventario fisico con quello commerciale Shopify.

I test TypeScript usano soltanto fixture sintetiche: rinnovo e concorrenza del token, host e segreti, risposta troncata/sovradimensionata, timeout, receipt/lease, identità canonica, retry/review, budget, massimo batch, commit incerto e callback successivo all’ACK. L’harness `supabase/tests/shopify-scheduler.mjs` usa PGlite con stand-in dichiarati per Cron, pg_net e Vault: verifica privilegi, owner del job, RLS del puntatore, rotazione, assenza di seed, destinazione fissa e rollback. Non verifica crittografia delle estensioni reali, scatto del cron o consegna di rete. Applicazione e collaudo cloud rimangono separati.

`supabase/tests/shopify-scheduler-concurrency.mjs` avvia PostgreSQL 17 locale con socket privato e TCP disabilitato: 15 controlli, comprese quattro contese osservate tra backend distinti, verificano entrambi gli ordini dispatch/disattivazione e dispatch/rotazione. Il test attende `pg_blocking_pids` e controlla visibilità e ordine dei commit, senza basarsi su ritardi ipotetici. Cron, Vault e HTTP rimangono stand-in condivisi con l’harness precedente; non è una prova di consegna reale.
