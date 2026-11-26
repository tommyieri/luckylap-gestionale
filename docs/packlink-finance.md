# Packlink → Finance

Il gestionale legge gli addebiti e i rimborsi del conto Packlink tramite API. Lo scheduler avvia la lettura ogni quindici minuti anche quando il browser del team è chiuso. La migrazione crea il collegamento disattivato: l’attivazione richiede configurazione e rilascio autorizzati dal founder.

## Fonte contabile e collegamento agli ordini

Il client usa esclusivamente GET verso `https://api.packlink.com`:

- `/v1/clients`: verifica `identifier` contro l’account configurato prima di ogni importazione.
- `/v1/invoicing/transactions`: legge tutte le pagine del periodo, con `from`, `to`, `page` e `size=10`. Il registro fornisce identificativo, data, importo, valuta, tipo e riferimenti alle spedizioni.
- `/v1/shipments/{reference}`: arricchisce il collegamento alla vendita per una transazione riferita a una sola spedizione. Il client verifica account, riferimento e origine `module_shopify`, quindi estrae il solo identificativo ordine.

La fonte economica è il registro Transazioni, distinto dal preventivo del corriere e dal contributo di spedizione pagato dal cliente su Shopify. Il client acquisisce `LABELS_ORDER` come spesa e `REFUND` come rimborso. Un tipo nuovo richiede verifica: non viene trasformato in una spesa presunta. La guida ufficiale descrive il collegamento tra ID transazione e spedizione: [Addebiti sconosciuti](https://support-pro.packlink.com/hc/it/articles/8458683588754-Addebiti-sconosciuti). Il contratto del feed è stato verificato nel [client pubblico Packlink](https://pro.packlink.it/assets/vendor-CaXxk_jl.js) e con letture autorizzate dell’account.

Una transazione che paga più spedizioni rimane un singolo movimento. L’importo non viene ripartito fra ordini senza una fonte esplicita. Le spedizioni manuali del brand entrano comunque in Finance. Il collegamento a Vendite richiede l’uguaglianza completa fra dominio, GID Shopify e riferimento canonico della vendita; la disponibilità successiva della vendita consente di mostrarne il collegamento senza modificare la fonte Packlink.

## Integrità delle letture

Ogni lettura verifica conto, paginazione completa, conteggi e identità duplicate. Limiti: cento pagine, mille transazioni, venti riferimenti per transazione e 256 KiB per risposta del provider. La lettura ha un budget separato da quello dell’applicazione SQL. Il trasporto del database ammette soltanto tre RPC dell’origine Supabase configurata, POST senza redirect, con corpo limitato a 4 MiB e risposta a 32 KiB. Il worker ignora corpo, cookie e parametri URL del chiamante.

Gli importi vengono convertiti dal lessico JSON a centesimi con interi, senza arrotondamenti binari. Sono accettati soltanto EUR, segni coerenti e precisione fino al centesimo. Le date devono avere un fuso orario esplicito. La precisione superiore al microsecondo che cambierebbe il valore PostgreSQL genera una revisione, senza troncare né arrotondare oltre il cutover. Il confronto finale con il cutover avviene nel database.

Una lease serializza la sincronizzazione del conto. Il digest della configurazione impedisce di applicare una lettura se il binding o il cutover cambiano durante il lavoro. Il database valida l’intero batch prima degli effetti. Identità univoca: `connection_id` e `provider_transaction_id`. Stessa identità con dati finanziari diversi produce una revisione e non sovrascrive la fonte. Un riavvio o una risposta persa vengono recuperati ripetendo la lettura dopo la scadenza della lease; le identità già applicate non generano nuovi movimenti.

## Proiezione in Finance

`packlink_transactions` conserva soltanto identificativi tecnici, riferimenti, importi, valuta, istanti, tipo e digest. Indirizzi, nomi, contatti e corpo integrale del provider non vengono conservati. L’accesso alle righe richiede un membro attivo e il grant attuale dell’area Finance; il client tecnico usa soltanto le RPC previste.

La categoria è **Spedizioni**. Le spese hanno segno negativo, i rimborsi positivo. Il conto rimane **Da attribuire**: il metodo di pagamento Packlink non prova l’accredito o l’addebito su un determinato conto bancario. Fattura e movimento bancario devono riconciliare la voce esistente prima di introdurre un’altra registrazione dello stesso costo. Una fattura può comparire successivamente alla transazione: [fatture Packlink](https://support-pro.packlink.com/hc/it/articles/210235805-Come-scarico-una-fattura).

Modifica, eliminazione e ripristino usano le revisioni append-only di Finance e ammettono allegati privati. Il polling non cambia le correzioni umane e non fa ricomparire una voce eliminata. L’originale Packlink non ha un `order_id` finanziario: una correzione del costo non ricalcola i ricavi o le scorte della vendita. Il collegamento alla vendita è navigazione, non una seconda scrittura commerciale.

I grafici esistenti distinguono uscite lorde e rimborsi fra le entrate. Il saldo comprende entrambi; il grafico delle uscite non rappresenta automaticamente il costo netto delle spedizioni.

## Configurazione e verifica del rilascio

1. Con autorizzazione del founder, riutilizzare la chiave Packlink esistente. Configurare in Vercel, solo sul server di produzione, `PACKLINK_API_KEY`, un `PACKLINK_WORKER_SECRET` distinto e `PACKLINK_WORKER_ENABLED=true`. Restano necessari l’URL Supabase e la chiave server già usati dagli altri worker. Nessuna credenziale deve avere prefisso `NEXT_PUBLIC_`.
2. Applicare le migrazioni versionate. Registrare nella configurazione privata l’account restituito da `/v1/clients`, il dominio Shopify e il cutover concordato. Il cutover è la data della transazione, non quella della lettura. Per uno storico già inserito a mano, verificare prima il periodo da recuperare: non si deduplicano dichiarazioni manuali per sola somiglianza di importo o data.
3. Rilasciare il codice con i controlli richiesti dal repository. Verificare la produzione corretta prima dell’attivazione.
4. Abilitare la configurazione privata e chiamare `configure_packlink_scheduler` dal solo ruolo tecnico. Il bearer viene conservato in Vault; il job `luckylap-packlink-worker` appartiene a postgres, ha espressione `*/15 * * * *` e destinazione fissa `/api/integrations/packlink/worker`. L’API key Packlink resta su Vercel e non entra nella configurazione o nelle richieste dello scheduler.
5. Verificare una lettura completa, la presenza delle fonti attese in Finance e la corrispondenza del costo con il registro Packlink. Ripetere la lettura: il numero delle fonti deve restare invariato e i contatori devono indicare replay. HTTP 200 conferma il ciclo tecnico, non il successo contabile: verificare l’esito e i dati persistiti.
6. Verificare il successivo avvio pianificato. La pagina Finance mostra stato, ultimo successo e contatori dell’ultima lettura riuscita; ritardi superiori a quarantacinque minuti o errori richiedono attenzione.

Per sospendere il collegamento, disabilitare la configurazione, il runtime e lo scheduler. Le fonti e le revisioni restano disponibili. La rotazione della chiave mantiene il binding dell’account e viene verificata al prossimo GET del profilo; una chiave di un altro account non avvia importazioni.

## Test

Le fixture sono sintetiche. I test coprono autenticazione, pagine incomplete, limiti HTTP, conversione monetaria, binding, timeout e risposta SQL incerta. L’harness PostgreSQL 17 usa la catena di migrazioni e sessioni concorrenti reali per provare lease, cutover, atomicità, replay, RLS, revisioni e allegati. Lo scheduler viene verificato con stand-in dichiarati di Cron, Vault e HTTP: i test locali non certificano consegna di rete o cifratura Vault del provider, che richiedono la verifica del rilascio.
