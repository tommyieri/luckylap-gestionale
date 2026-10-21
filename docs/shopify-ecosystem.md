# Ordini Shopify e POS: database e worker duraturo

Implementazione locale, senza attivazione del negozio, nuove credenziali, importazione storica o modifiche a quantità/prezzi Shopify. Le due forward migration sono `20261021144441_shopify_sales_core.sql` e `20261021144451_shopify_canonical_worker.sql`. Il reader canonico e il worker HTTP sono moduli separati.

## Provenienza e confini

Gli ordini manuali mantengono `source_kind=manual_declaration`, account autore e canali `direct`, `etsy`, `manual_other`. Quelli osservati da Shopify hanno `source_kind=shopify_canonical`, `channel=shopify_web|shopify_pos`, `created_by=NULL`: nessun account del team viene impersonato. L'importo operativo dell'ordine è il totale originale, comprese spedizione e imposta extra quando applicabile. Prezzi, costi e margini operativi rimangono visibili a tutti i membri attivi.

Le nuove tabelle `shopify_order_financials`, `shopify_transaction_observations` e `shopify_refund_observations` sono leggibili soltanto con `private.can_finance()`, quindi con ruolo corrente ammesso e password Finance sbloccata per la sessione. Anche `order_payments` e `commercial_facts` mantengono il loro accesso Finance. Non vengono generati movimenti bancari, righe BudgetFlow o scritture contabili approvate.

Ogni osservazione esterna usa l'autore tecnico NULL anche nell'audit. Le ricevute di effetti, le identità sorgente, le configurazioni e le lease sono nello schema privato, senza accesso diretto per anon, utenti autenticati o `service_role`. Solo RPC ristrette eseguono il lavoro privilegiato.

## Inventario e località

`stock_balances` resta la fonte della disponibilità fisica. Le quantità commerciali Shopify non vengono lette né trasferite al magazzino. Il mapping richiede contemporaneamente negozio, GID variante, SKU esatto, prodotto fisico attivo e saldo censito: NULL significa sconosciuto e genera revisione.

Il catalogo già osservato contiene 51 SKU collegati a prodotti fisici e 9 adesivi retail senza collegamento. Gli adesivi retail non diventano automaticamente materiali di packaging; un ordine con SKU sconosciuto resta in revisione senza effetti parziali.

Le vendite dirette, manuali, Shopify e POS e i relativi carichi produzione/scarichi spedizione richiedono una località attiva di tipo `Magazzino`. LCM, di tipo `Negozio Conto Vendita`, resta nel ciclo separato del conto vendita. Una giacenza nota in LCM o in una località esterna non autorizza una vendita diretta. Il replay di un comando già concluso avviene prima di nuove scritture.

La configurazione privata richiede una località centrale esplicita per l'online e un mapping esplicito per i GID Location di POS e fulfillment. Nessuna località viene dedotta da nomi o inventata come default. Lo steering utente ha indicato il GID Shopify `gid://shopify/Location/109039452490` verso la località centrale esistente; il provisioning reale resta un'operazione amministrativa separata. In questo primo flusso la località del fulfillment deve coincidere con quella assegnata all'ordine: un diverso punto di evasione richiede revisione, senza trasferimenti impliciti.

## Effetti atomici

1. Un nuovo ordine non evaso riserva la parte fisicamente pronta; la parte mancante diventa `production_requirements`. Il saldo fisico non diminuisce.
2. Solo un fulfillment `SUCCESS`, con quantità completa e località verificata, produce uno scarico fisico. La riserva propria viene liberata prima dello scarico e le riserve altrui restano protette. Un'insufficienza fisica genera revisione; non viene inventata una produzione.
3. `SALE` e `CAPTURE` riuscite generano osservazioni distinte in `order_payments`, anche per catture parziali. `declared_reference` contiene il transaction GID esatto; il metodo è `shopify_observed`. AUTHORIZATION, EMV_AUTHORIZATION, VOID e transazioni pending/failed restano osservazioni Finance e non diventano incassi.
4. I REFUND riusciti generano osservazioni finanziarie collegate al pagamento padre. Non creano un rientro fisico, anche quando il payload contiene `restocked=true` o `restockType=RETURN`. Il pagamento può risultare `partially_paid`, `paid`, `partially_refunded` o `refunded`.
5. L'annullamento sorgente di un ordine mai evaso libera le riserve e cancella il fabbisogno non completato. La produzione realmente completata resta fisicamente presente. Un pagamento osservato diventa rimborso da effettuare finché non arriva il REFUND riuscito.
6. Gli ordini esterni non accettano pagamento, annullamento o evasione manuale. Founder/produzione possono registrare la produzione realmente completata con l'RPC esistente, anche quando le nuove vendite manuali sono disabilitate. La produzione non ricalcola gli stati economici canonici.

Una sottotransazione comprende ordine, righe, riserve, fabbisogno, pagamenti, fatti Finance, scarichi, audit e ricevute degli effetti. Un errore su una riga successiva annulla tutti questi effetti; solo l'esito del job viene salvato come revisione o retry. Le modifiche a catalogo/listino correnti non rivalutano il prezzo dell'ordine.

Gli sconti di riga e i coupon a livello ordine usano i centesimi già allocati da Shopify su ciascuna riga, senza calcolare percentuali o distribuire residui. Il netto finale è lordo meno somma delle allocazioni osservate e deve riconciliarsi con subtotal, sconti complessivi e totale sorgente. Il campo `discountedTotalSet` rimane una verifica intermedia perché esclude gli sconti ordine; il relativo argomento abilita gli sconti a codice. Questa distinzione segue la documentazione [LineItem 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/LineItem). Il totale ricevuto rimane lordo prima dei rimborsi, secondo [Order 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order).

## Versioni e idempotenza

La delivery del webhook, l'ordine sorgente e ciascun effetto hanno identità diverse. Webhook/event ID differenti sullo stesso stato canonico non duplicano un ordine, una cattura, un rimborso o uno scarico. Le identità degli effetti finanziari sono i transaction GID; lo scarico usa fulfillment GID + fulfillment-line GID. Un effetto già applicato non può cambiare importo, quantità, padre o località e non può scomparire da uno snapshot completo successivo.

Un advisory lock serializza l'ordine sorgente; le righe saldo vengono bloccate in ordine deterministico. Le versioni precedenti sono ignorate. Stessa versione e digest diverso richiedono revisione. Il confronto della versione conserva una chiave UTC con nove cifre frazionarie, oltre al `timestamptz` PostgreSQL: le frazioni oltre il microsecondo non collassano. La baseline originale delle righe e dei componenti economici non viene riscritta.

Il cutover si legge sempre da `app_settings.sales_started_at`; nessuna migration lo modifica. Il valore attivato dal responsabile nella sessione è `2026-10-21T14:06:47.976341Z` (16:06:47 Roma). Il confronto conserva anche il confine al nanosecondo. Non si importano ordini creati prima di tale istante. L'eventuale recupero di ordini creati tra cutover e attivazione dei webhook richiede una coda con provenienza catch-up esplicita; non si devono fabbricare webhook Shopify.

## Contratto RPC del worker

Le quattro RPC seguenti sono `SECURITY INVOKER` sopra processori privati `SECURITY DEFINER` con `search_path=''`, execute soltanto `service_role` e controllo del ruolo SQL effettivo. Metadati utente e JWT di un membro non bastano.

| RPC | Parametri | Risultato |
| --- | --- | --- |
| `claim_shopify_order_jobs` | `p_worker_id UUID`, `p_limit` 1–20 (default 1), `p_lease_seconds` 30–900 (default 120) | Array `{job_id,inbox_id,shop_domain,order_gid,lease_token,lease_expires_at}` |
| `apply_shopify_order` | `p_job_id UUID`, `p_lease_token UUID`, `p_canonical` DTO `CanonicalShopifyOrder` schemaVersion 1 / API 2026-10 | `{status,reason,job_id,order_id?}`; stato `applied`, `replayed`, `stale`, `ignored`, `review` o `retry` |
| `finish_shopify_read_job` | Job/token, `p_outcome=review|retry`, codice lowercase `p_reason` massimo 80 caratteri, `p_retry_seconds` 5–86400 (default 60) | `{status,reason,job_id}` |
| `requeue_shopify_order_job` | `p_job_id UUID` | Boolean, soltanto job review/retry |

Il trigger AFTER INSERT del read-job crea la lease nella stessa transazione della ricevuta; inbox e read-job restano append-only. I job preesistenti ricevono una lease con il backfill una tantum della migration. Claim usa `FOR UPDATE SKIP LOCKED`, recupera lease scadute e cambia token. Non esegue INSERT concorrenti dei job durante claim.

Il DTO `ready` del reader va ad apply. Il reader `review` va a finish/review; indisponibilità temporanee vanno a finish/retry. Un apply che restituisce retry ha già impostato `next_attempt_at` a +60 secondi. Lo stesso risultato finish con token ancora identico può essere riletto senza azzerare l'attesa. Una risposta apply persa resta incerta: non va sovrascritta con finish.

Con lo stesso token e digest, un apply terminale è ripetibile anche dopo scadenza: il precedente applied torna replayed, gli altri esiti restano uguali. Un requeue esplicito revoca il token precedente. Un nuovo payload sullo stesso token terminale produce `22023 worker_terminal_conflict`; token assente, sostituito o scaduto su job non concluso produce `22023 worker_lease_required`. Accesso non ammesso: `42501 shopify_worker_access_required`.

I topic `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`, `orders/fulfilled`, `orders/partially_fulfilled` restano soltanto cue per una lettura canonica. Il body del webhook non viene applicato direttamente.

## Salute operativa e revisione

`get_shopify_sync_status()` è leggibile dagli account autenticati con membership attiva, senza richiedere Finance. Restituisce `{configured,enabled,counters,reviews}`. I contatori `pending`, `retry`, `processing`, `review`, `applied`, `ignored` contano consegne/job; un replay gestito conta come consegna applicata. `lastAppliedAt` è il momento dell'ultima consegna gestita. Lease scadute rientrano nel contatore pending. La lista review è limitata a 20 elementi `{orderGid,reason,observedAt}`, senza snapshot canonico, importi, credenziali o capability. La revoca della membership blocca subito anche questa RPC.

I casi non supportati sono visibili in revisione senza nuovi effetti. Comprendono SKU o saldo sconosciuti, località mancante/diversa, modifiche ordine (`edited`), cambio baseline, annullamento di ordine già evaso, rimozione non spiegata di unità non evase, gift card/prodotti non spedibili, gift-card tender, ordine non EUR, transazioni positive non interpretabili, totali/sconti non riconciliabili (inclusi sconti spedizione non rappresentati nelle allocazioni complete), effetti già applicati cambiati o scomparsi. Gli sconti riconciliabili di riga e ordine funzionano a centesimi esatti. Nessun caso viene interpretato come importo o quantità zero per convenienza.

Il retry non riprende automaticamente un job review. Dopo aver chiarito e corretto una causa reale, un operatore tecnico autorizzato può effettuare il requeue. Non ci sono scritture outbound Shopify né sincronizzazione delle sue quantità commerciali.

## Verifica locale

`supabase/tests/shopify-ecosystem.mjs` avvia un cluster PostgreSQL 17 temporaneo, socket Unix privata, TCP disabilitato, nessun DSN e nessun accesso cloud. Richiede un runtime PostgreSQL 17 e il client pubblico `pg`; nell'ambiente di lavoro sono già disponibili PostgreSQL 17.11 Homebrew e `pg@8.23.1` in una directory temporanea esterna al repository. Nessuna dipendenza applicativa è stata aggiunta.

```sh
node supabase/tests/shopify-ecosystem.mjs /absolute/postgresql17/bin /absolute/pg/lib/index.js
```

L'harness applica le nove migration di dominio necessarie, usa Auth/sessioni sintetiche e pgcrypto reale, verifica gli account/ruoli, il gate Finance attuale, ACL, assenza di mutazioni da anon/utenti, valori esatti, scenari di annullamento/rimborso, doppie consegne e rollback successivo a uno scarico già iniziato. Due connessioni PostgreSQL distinte dimostrano sia claim SKIP LOCKED sia attesa del secondo worker sul lock dell'ordine. Riesegue inoltre tutte le 445 assertion della suite manuale/lifecycle esistente contro il nuovo core in un database reale separato: cambia solo il trasporto embedded in client `pg`, il nome sintetico della località centrale e la lista delle migration applicate.

L'evidenza locale `.private/deployment-proof/shopify-ecosystem.json` contiene contatori, PID distinti, hash delle migration/suite originaria e cleanup; non contiene dati del negozio o credenziali. Run conclusivo del 21 ottobre 2026, ore 14:40:58–14:41:00 UTC: **702 controlli PASS**, di cui 445 assertion della suite manuale esistente, 256 controlli del nuovo ecosistema e una verifica di esecuzione completa della regressione. Backend observer/A/B: 28387/28388/28389; database manuale separato: backend 28397. Cluster e socket rimossi. Questa è evidenza locale con Auth simulata, non una prova di webhook o JWT del negozio reale.

Durante una verifica il file baseline lifecycle in Documents è rimasto in un read di filesystem (backend PostgreSQL già idle, `sample`/`lsof` confermati). Quel processo e il suo cluster sono stati chiusi. Il fallback opzionale `LUCKYLAP_BASELINE_MIGRATIONS=/percorso/assoluto/supabase/migrations` legge esclusivamente le migration già applicate e la suite originale da una copia locale della baseline; i due SQL nuovi vengono sempre letti dalla workspace. La copia non viene modificata.
