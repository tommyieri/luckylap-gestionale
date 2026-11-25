# Sonda di sola lettura dei permessi Shopify

La sonda `scripts/probe-shopify-permissions.mjs` serve a isolare un rifiuto di accesso usando **la stessa app interna LuckyLap Gestionale**. Non sostituisce il reader canonico e non applica ordini. La sua disponibilità non significa che il problema in produzione sia stato corretto.

## Prima esecuzione: nessuna rete

Eseguire prima l’aiuto e il piano:

```sh
node scripts/probe-shopify-permissions.mjs --help
node scripts/probe-shopify-permissions.mjs --dry-run
```

Anche l’avvio senza argomenti è un dry-run. Aiuto e piano non richiedono credenziali e non fanno richieste. L’importazione del modulo non avvia il comando.

La sonda usa soltanto API Node native, senza dipendenze nuove e senza leggere automaticamente file `.env`. La versione Admin API è fissata a **2026-10**, come il reader canonico del gestionale.

## Ambiente necessario per la lettura reale

`--run` richiede che un operatore autorizzato abbia già configurato l’ambiente della stessa app interna. Non incollare segreti o token in chat, nei comandi salvati o nel repository.

| Variabile | Significato |
| --- | --- |
| `SHOPIFY_SHOP_DOMAIN` | Dominio del negozio, senza protocollo o percorso, terminante in `.myshopify.com`. |
| `SHOPIFY_CLIENT_ID` | Client ID dell’app interna già usata dal gestionale. |
| `SHOPIFY_CLIENT_SECRET` | Client secret della medesima app, conservato nell’ambiente protetto. |
| `SHOPIFY_PROBE_ORDER_GID` | Facoltativo: GID esplicito di un ordine autorizzato. Senza questa variabile si leggono soltanto identità e scope. |

Con l’ambiente già disponibile:

```sh
node scripts/probe-shopify-permissions.mjs --run
```

Il client ID e la provenienza delle credenziali vanno verificati nell’ambiente autorizzato. Come ulteriore guardia, la sonda controlla che il nome dell’app autenticata sia esattamente `LuckyLap Gestionale`: se rileva un’altra app si ferma prima di leggere l’ordine. Il nome dell’app è una protezione da errori operativi, non sostituisce la verifica del client ID.

Non usare il token del connettore della chat per dimostrare che l’app interna funzioni: sono identità con scope differenti. La sonda non accetta un token Admin già pronto: ottiene un token temporaneo tramite il grant client credentials della stessa app, conservandolo solo in memoria. Il POST OAuth e i POST GraphQL delle query sono richieste tecniche di autenticazione/lettura; non contengono mutation commerciali.

## Letture separate

La sonda effettua una sola richiesta per passo, senza retry:

1. Grant OAuth client credentials.
2. `currentAppInstallation`: controllo del nome atteso e lettura degli scope concessi. Il report espone soltanto la presenza dei sei scope pertinenti.
3. Se è stato fornito un GID: `order { id }`, per distinguere un problema generale sull’ordine da quello di un campo collegato.
4. `order { id retailLocation { id } }`.
5. `order { id fulfillments(first: 1) { location { id } } }`.

Le query delle località sono isolate dalla query minima. Un errore su una località non impedisce di provare l’altra query, purché l’identità dell’app e la lettura minima dell’ordine siano state verificate. Un ordine nullo, un’identità diversa, un protocollo o input non valido, una versione API inattesa o gli scope minimi ordini/prodotti assenti fermano i passi successivi.

La lettura di un solo fulfillment serve a isolare l’accesso, non a ricostruire tutte le evasioni. Il report distingue `branch: "present"` da `branch: "empty"`: un ordine web può avere `retailLocation` nulla e un ordine non evaso può non avere evasioni. Una risposta senza errori su un ramo vuoto non dimostra la lettura di una località effettiva. Anche un esito positivo di questi passi non certifica tutte le query del reader, inclusi rimborsi e paginazioni.

## Report e riservatezza

L’output è JSON su stdout. Contiene piano o passi eseguiti, campo, HTTP status, esito, codici GraphQL noti e `errors.path` redatti. Non contiene token, secret, client ID, dominio effettivo, GID dell’ordine/località, payload degli ordini, importi, dati cliente o messaggi grezzi di errore. Codici sconosciuti diventano `UNKNOWN_CODE`; segmenti di percorso non riconosciuti diventano `[redacted]`.

Il codice non crea file e non ha un’opzione di esportazione. Se si decide di conservare l’output, usare una destinazione privata fuori dal repository con permessi restrittivi, per esempio una shell con `umask 077`. Evitare log pubblici o pipeline che acquisiscano le variabili d’ambiente. Nessuna richiesta è seguita attraverso redirect; ogni risposta è limitata a 64 KiB e ogni richiesta ha un limite temporale di otto secondi.

Codici di uscita:

- `0`: piano offline, oppure passi richiesti eseguiti senza errori. Non implica che rami vuoti siano stati verificati su dati presenti.
- `1`: accesso, identità o risposta da verificare.
- `2`: argomenti o ambiente non validi; nessuna rete per gli input invalidi.

Il codice non stampa il messaggio grezzo di un’eccezione di rete. Un HTTP 401/403 è distinto dal codice GraphQL `ACCESS_DENIED`, perché il report conserva HTTP status e passo senza esportare il corpo di errore.

## Interpretazione e intervento successivo

Se l’ordine minimo si legge ma una query di località restituisce `ACCESS_DENIED`, conservare il nome del passo e il percorso redatto. Confrontarli con gli scope effettivi e con il requisito dell’oggetto `Location`.

L’eventuale aggiunta di `read_locations` deve essere motivata da questa verifica e autorizzata secondo `AGENTS.md`: modifica le impostazioni dell’app Shopify. La sonda non concede scope e non risolve il problema cambiando il controllo locale del token. Non sono necessari permessi di scrittura per queste query.

Dopo l’eventuale aggiornamento autorizzato, ripetere il probe e poi la lettura canonica completa senza applicazione al database. Il recupero di un lavoro richiede una fase distinta: questo script non chiama worker, `requeue_shopify_order_job`, `apply_shopify_order`, Supabase o endpoint del gestionale. Non importare come nuova vendita un ordine anteriore al cutover.

## Verifiche locali

```sh
node --check scripts/probe-shopify-permissions.mjs
node --test scripts/probe-shopify-permissions.test.mjs
```

I test usano risposte e credenziali sintetiche in memoria; non interrogano il negozio. Verificano piano senza rete, help, importazione senza effetti, blocco di input/identità errati, letture isolate, risposta negata, rami vuoti, limiti delle risposte, versione API, mancata esposizione di segreti e identificativi, errori di rete e codici di uscita.

La prima consegna è stata verificata soltanto con dati sintetici. Nessuna esecuzione reale è attestata da questo documento.

## Fonti

- [Scope Shopify e verifica degli scope concessi](https://shopify.dev/docs/api/usage/access-scopes#checking-granted-access-scopes).
- [Grant client credentials](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant).
- [Location, Admin API 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Location).
- [Reader canonico del gestionale](shopify-canonical-reader.md), [worker e confini](shopify-worker.md).
