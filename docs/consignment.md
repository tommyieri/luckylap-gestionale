# Conto vendita LuckyLap

Il modulo `/consignment` collega quantità fisiche, affidi e rientri, vendite effettivamente dichiarate dal negozio e somme ricevute da LuckyLap. Non modifica la disponibilità commerciale di Shopify e non crea ordini diretti fittizi.

## Regole confermate

- Solo prodotti attivi con categoria locale `T-shirt`; le vendite richiedono anche una variante Shopify `ACTIVE`, in EUR, `product_type = T-shirt` e collegamento esatto SKU/articolo.
- Prezzo unitario in negozio = prezzo del sito verificato + **1.000 centesimi**. Non esiste un campo sconto.
- LuckyLap riceve il **60% del totale dell’intera riga**, arrotondato al centesimo; il negozio riceve il resto. Per due magliette da 50,01 €: totale 100,02 €, credito LuckyLap 60,01 €, quota negozio 40,01 €.
- La ripartizione è commerciale: non presuppone un trattamento IVA. Il margine commerciale mostrato è credito LuckyLap meno costo unitario per quantità, escludendo packaging, commissioni e IVA. Se il costo manca, il margine rimane da verificare.
- Tutti i cinque membri attivi possono affidare/ricevere merce e dichiarare vendite. I regolamenti sono riservati ai membri Finance abilitati e all’area sbloccata con password, secondo il controllo centralizzato `private.can_finance()`.

## Trasferimenti e rientri di invenduto

`transfer_consignment_stock(p_operation_id, p_payload)` richiede `schema_version`, `stock_item_id`, `from_location_id`, `to_location_id`, `quantity`, `reason`, `occurred_at`.

La quantità è compresa tra 1 e 100.000; la causale tra 3 e 500 caratteri. Sono ammesse soltanto coppie `Magazzino` → `Negozio Conto Vendita` o il percorso inverso. Le location `Esterno`, i trasferimenti tra location dello stesso tipo e le location inattive sono escluse. Entrambi i saldi devono essere già conosciuti: l’assenza non vale zero.

La transazione blocca i due saldi nell’ordine deterministico delle location, verifica le riserve e aggiunge due movimenti immutabili collegati: `transfer_out` e `transfer_in`. Se il secondo fallisce, anche il primo e la relativa ricevuta vengono annullati. Il rientro riguarda merce invenduta: non è un rimborso di una vendita già dichiarata. Nessun trasferimento crea ricavi, spese o pagamenti.

## Vendita dichiarata dal negozio

`register_consignment_sale(p_operation_id, p_payload)` richiede `schema_version`, articolo, negozio, quantità, causale, riferimento univoco della **riga** dichiarata, data, `shop_domain`, `variant_gid`, `expected_web_price_cents`, `expected_catalog_observed_at`.

Una riga contiene un solo SKU. Per un rendiconto con più SKU si usano riferimenti distinti, per esempio `rendiconto-riga-01`. Il riferimento deve essere univoco nello stesso negozio. La stessa riga non va registrata anche come vendita diretta o incasso manuale.

Il database ricontrolla mapping esatto, stato, tipo, valuta, prezzo e versione del catalogo. Se prezzo o osservazione cambiano dopo la lettura, il comando viene rifiutato: occorre rileggere e verificare prima di un nuovo invio. Lo snapshot della vendita conserva listino sito, prezzo negozio, riparto e costo unitario allora noto; i cambiamenti futuri non riscrivono lo storico.

Le vendite richiedono `stock_adjustments_enabled`, `manual_sales_enabled` e una data non precedente a `sales_started_at`. Il fisico del negozio deve essere noto e la quantità venduta libera da riserve. Un movimento `consignment_sale` riduce le scorte e la stessa transazione crea `consignment_sales`. Non viene creato alcun pagamento: nasce il credito commerciale verso il negozio.

## Regolamenti ricevuti

`record_consignment_settlement(p_operation_id, p_payload)` richiede `schema_version`, `sale_id`, `amount_cents`, `occurred_at`, `method`, `reference`.

La verifica corrente dell’identità e della password Finance precede ogni lettura riservata e ogni azione. Un membro operativo privo dell’accesso non interroga `consignment_settlements`; i relativi dettagli non vengono inviati al browser.

Sono ammessi bonifico, contanti o altro, con un riferimento obbligatorio e un importo positivo fino al credito LuckyLap residuo. Sono possibili regolamenti parziali. Il saldo viene verificato mantenendo un lock sulla vendita, così due dichiarazioni concorrenti non possono superare il credito. La data non può precedere la vendita. I regolamenti sono append-only e il riferimento è univoco per vendita.

Registrare il pagamento è una dichiarazione di ricezione, non una verifica bancaria. Il modulo non duplica automaticamente la stessa somma nelle voci Finance o nelle importazioni BudgetFlow. Il riquadro Finance distingue vendita al pubblico, credito LuckyLap, quota negozio, ricevuto dichiarato e credito residuo; non presenta una somma impropria di queste grandezze.

## Autorizzazione e tentativi sospesi

Le tabelle operative hanno RLS per i membri attivi, i regolamenti RLS Finance. I client possono leggere secondo il proprio ruolo, ma non inserire, modificare o eliminare direttamente righe. Le funzioni pubbliche sono wrapper `SECURITY INVOKER`; i processori privati verificano l’identità e i permessi. Le ricevute private legano UUID, attore, tipo di comando e hash del payload canonico.

Un replay identico viene verificato prima dei flag e delle condizioni operative che possono cambiare. La revoca della membership o del diritto Finance continua a bloccare l’accesso anche a una ricevuta precedente. I conflitti di UUID/payload non vengono trattati come conferme.

La UI conserva un solo tentativo globale del modulo per utente in `sessionStorage`. UUID e payload vengono congelati prima dell’invio; un lock sincrono blocca doppio submit o doppio clic prima del rendering React. Se l’archiviazione fallisce, la mutazione non parte. La sezione di recupero rimane visibile anche quando il modulo originario non serve più, il saldo risulta esaurito o il credito è stato regolato.

Una risposta persa, un errore non classificato o un retry bloccato da controlli di identità, password, data, validazione o flag mantiene il tentativo incerto. **Verifica lo stesso invio** riusa lo stesso UUID. Non si crea una nuova operazione per risolvere un esito dubbio. Dopo la conferma vengono rilette conto vendita, stock, magazzino e Finance.

## Date, importi e letture

I campi data sono esplicitamente **Europe/Rome**, indipendentemente dal fuso del dispositivo. La conversione condivisa con Sales rifiuta le ore inesistenti o ambigue nel cambio dell’ora. Il database richiede timestamp con fuso esplicito, finiti e non oltre cinque minuti nel futuro, per tollerare piccoli disallineamenti dell’orologio.

Tutti gli importi e i riparti usano centesimi interi, con `BigInt` per calcoli, formattazione e margini estesi; nessun passaggio divide un grande importo `Number` per 100 per poi arrotondarlo. Le quantità sconosciute restano nulle e le quantità esplicitamente contate a zero rimangono zero.

I loader usano cursori per chiave con conteggio esatto. Il catalogo viene letto per SKU, ordinando il dominio univoco della variante attiva; la disponibilità per location, ordinando l’articolo. Un catalogo ambiguo tra più negozi online non viene scelto automaticamente. Elenchi troncati, riferimenti orfani o proiezioni incoerenti fanno fallire la lettura intera.

## Integrazione Finance e verifica

`readConsignmentFinance(supabase, member)` in `src/lib/consignment/finance.ts` riverifica membership corrente, corrispondenza dell’identità e `verifiedSensitiveAccess(..., 'finance')` prima di interrogare le due proiezioni vendite/regolamenti (il nome del negozio è incluso nella lettura vendite tramite relazione a `stock_locations`). Restituisce una proiezione tipizzata per riga, senza inventare saldi bancari. `ConsignmentFinanceView` è presentazionale e collega la dichiarazione nel modulo operativo.

La migrazione `*_consignment_workflow.sql` è stata creata con Supabase CLI. La suite `supabase/tests/consignment.mjs` usa PostgreSQL embedded e Auth simulata: verifica idempotenza, revoca, ruoli, prezzi/versioni/tipi, stock sconosciuto e riservato, trasferimenti inversi, rollback della seconda scrittura, riparto, regolamenti parziali, RLS e immutabilità. La suite TypeScript verifica parser, centesimi estremi, date e DST, letture complete, controlli per ogni azione, separazione Finance, invii concorrenti nello stesso tick e recupero globale.

Queste verifiche sintetiche non provano la concorrenza con più connessioni PostgreSQL, la password reale, JWT/PostgREST o il browser pubblicato. Il modulo non attiva flag, non importa vendite o movimenti reali e non invia messaggi. Lo stile riusa il sistema stock esistente senza modificarne i token.

Il 21 ottobre 2026 il collaudo CUA su fixture locali ha verificato conto vendita a 1280 e 390 px, proiezione Finance a 1280 px e larghezza del documento mobile pari a 390 px, modulo password Finance a 390 px e composizione Account a 1280 px. I dati erano sintetici e gli invii dei form intercettati; non è stata utilizzata la sessione del founder né eseguita alcuna mutazione reale. Una cache obsoleta di Next dev aveva inizialmente prodotto HTML Finance diverso dal client: il riavvio del solo server di sviluppo ha risolto il problema, senza modifiche al codice di produzione. Le due route temporanee sono state rimosse e verificate con risposta HTTP 404. Questa prova riguarda layout, leggibilità e adattamento mobile, non l’autenticazione reale o il sito pubblicato.
