# Conto vendita

Il modulo `/consignment` (scheda «Conto vendita» della sezione Vendite) segue le magliette che LuckyLap lascia nei negozi in conto vendita: quante ce ne sono in ogni negozio, quante ne ha vendute il negozio ogni mese, quanto gli va fatturato e quanto ha pagato, e gli ordini di magliette nuove. Sostituisce il modulo precedente (affidi, vendite singole, regolamenti), le cui funzioni restano nel database: vedi «Comandi precedenti» in fondo.

Migrazione: `supabase/migrations/20261022200100_consignment_monthly.sql`, solo aggiunte. Il codice legge le tabelle nuove anche fuori dal modulo (colonna «In negozio» delle Giacenze, Finance): la migrazione va applicata in produzione prima del merge, come in «Produzione».

## Regole

| Tema | Regola |
| --- | --- |
| Giacenza del negozio | Finché il negozio non ha la prima conta, ogni cella è «—» (da contare): il saldo che c'era prima non viene letto come conta. Dopo la prima conta ogni variante è nota e un saldo assente vale 0. |
| Prima conta | Comprende tutte le T-shirt attive. Un campo vuoto vale 0, con conferma prima del salvataggio. |
| Correzione della conta | Può cambiare anche una sola variante e imposta la quantità assoluta. Il magazzino centrale non cambia mai. |
| Prezzo in negozio | Prezzo del sito (`shopify_catalog_variants`, variante `ACTIVE`, EUR, `product_type = 'T-shirt'`, SKU esatto) più la maggiorazione del negozio. NEG01: +10 €. |
| Quota LuckyLap | Percentuale del negozio, in punti base (6000 = 60%), sul totale di ogni riga (variante × mese), arrotondata al centesimo con la metà per eccesso. Da fatturare = somma delle quote delle righe. |
| Prezzo bloccato | Si fotografa la prima volta che una variante entra nel resoconto. Le modifiche successive non lo cambiano. |
| Condizioni | Quota, maggiorazione e magazzino di partenza sono del negozio. Un resoconto fotografa quota e maggiorazione alla creazione: le condizioni nuove valgono solo per i resoconti nuovi. |
| Mesi ammessi | Dal mese di `app_settings.sales_started_at` al mese corrente, all'ora di Roma. Il pulsante principale propone il mese precedente. |
| Prima della conta | Pezzi venduti nel mese ma prima di una conta dello stesso mese o successiva: vanno in fattura ma non scendono dalla giacenza, perché la conta li esclude già. La colonna compare solo quando serve. |
| Mese senza vendite | Si registra con zero pezzi: «Nessuna vendita», niente da fatturare. |
| Ordini | Non riservano il magazzino centrale. L'ordine mostra la disponibilità di adesso; la consegna ricontrolla quella vera. |
| Fattura e pagamenti | Solo con Finance aperta (password dell'area). Lo stato («Da fatturare», «Da pagare», «Pagata in parte», «Pagata») lo vedono tutti. |
| Nuovo negozio e impostazioni | Solo con Finance aperta. Codice automatico: il primo libero fra `NEG01` e `NEG99`. |
| Correzioni | Tutto si corregge e ogni correzione lascia lo storico: chi, quando, cosa e, dove serve, perché. |

Nell'interfaccia non si usano più le parole affido, rientro, vendita dichiarata, regolamento e credito commerciale (lo controlla `consignment-pages.test.tsx`).

## Calcolo

Per ogni riga, cioè una variante in un mese:

- prezzo negozio = prezzo del sito + maggiorazione;
- incasso = prezzo negozio × pezzi;
- quota LuckyLap = incasso × quota / 10000, arrotondata a metà per eccesso;
- quota negozio = incasso − quota LuckyLap.

Il resoconto somma le righe. Tutto in centesimi interi: `BigInt` in TypeScript (`shopSplit` in `src/lib/consignment/shop-model.ts`), `numeric` con conversione finale a `bigint` in SQL. Limite per riga e per totale: 9.000.000.000.000.000 centesimi. Con quota 6000 e maggiorazione 1000 il risultato coincide con `consignmentSplit` del modulo precedente (test dedicato).

Esempio con numeri inventati:

| Variante | Prezzo sito | Prezzo negozio | Pezzi | Incasso | LuckyLap 60% | Negozio |
| --- | --- | --- | --- | --- | --- | --- |
| GT3RS Blu M | 45,00 € | 55,00 € | 3 | 165,00 € | 99,00 € | 66,00 € |
| 964 Bianco L | 49,99 € | 59,99 € | 1 | 59,99 € | 35,99 € | 24,00 € |
| **Totale** | | | **4** | **224,99 €** | **134,99 €** | **90,00 €** |

Giacenza: per ogni variante scendono dal negozio i venduti meno quelli «prima della conta». Una modifica applica solo la differenza con la versione precedente: se ne scala di più, movimento `consignment_sale`; se ne scala di meno, movimento `consignment_sale_correction` positivo. Sempre e solo sulla sede del negozio.

## Pagine

Tutte dentro il guscio del workspace (`src/app/(workspace)/consignment/`), con `dynamic = "force-dynamic"`. `params` è una `Promise`. Un codice negozio fuori da `^[A-Z0-9]{2,12}$` (confrontato in maiuscolo), un mese che non è `AAAA-MM` o un ordine inesistente danno «Pagina non trovata», anche nel titolo.

| Indirizzo | Contenuto |
| --- | --- |
| `/consignment` | Elenco dei negozi. |
| `/consignment/nuovo` | Nuovo negozio (Finance). Il segmento statico vince su `[code]`. Accetta già `?nome=`, `?citta=`, `?paese=` come valori iniziali per il collegamento da Partner. |
| `/consignment/NEG01` | Pagina del negozio. |
| `/consignment/NEG01/conta` | Conta in negozio. |
| `/consignment/NEG01/resoconto/2026-10` | Resoconto del mese: modulo se manca, riepilogo se c'è. |
| `/consignment/NEG01/ordini/nuovo` | Nuovo ordine; con `?da=2026-10` parte dalle magliette vendute in quel mese. |
| `/consignment/NEG01/ordini/3` | Ordine n. 3. |
| `/consignment/NEG01/impostazioni` | Nome, condizioni, magazzino di partenza, nota, attivo (Finance). |

Gli indirizzi si costruiscono solo con `src/lib/consignment/links.ts` (`consignmentShopHref(code, month?)` e gli altri), usati anche da Finance e, più avanti, da Oggi e dal Controllo CEO.

Stati comuni: `loading.tsx` con righe scheletro ad altezza fissa e «Caricamento del conto vendita…»; `error.tsx` con «Non riesco a leggere il conto vendita. Non mostro dati parziali.» e «Riprova» (`retry()`); `[code]/not-found.tsx` con «Negozio non trovato.» e il link all'elenco. Sessione mancante: login. Database non configurato, account non abilitato o verifica non riuscita: `AccessPanel`. Flag spenti: «Le modifiche al magazzino sono sospese.», pulsanti disattivati, letture normali.

### Elenco

Una riga quadrata per negozio, tutta cliccabile: nome; condizioni in piccolo («Prezzo sito + 10 € · LuckyLap 60%»); magliette in negozio in Barlow Condensed oppure «Da contare» in ambra; ultimo resoconto («Ottobre · 12 pezzi · Pagata») oppure il mese da registrare in ambra; ordini da consegnare. Sotto, «Negozi chiusi» comprimibile se ce ne sono. «Nuovo negozio» solo con Finance aperta; altrimenti «Per aggiungere un negozio apri Finance».

### Pagina del negozio

Dall'alto:

1. **Avvisi**, solo se servono, calcolati alla lettura senza job pianificati (`shopReminders`): negozio da contare; resoconti dei mesi finiti da registrare; fatture da emettere; resoconto modificato dopo la fattura («controlla se serve una nota di credito»); pagato più del dovuto; ordini da consegnare. Un tentativo da verificare sta sopra tutto e blocca le scritture.
2. **In negozio ora**: la griglia, con il totale e «Conta in negozio» (prima conta) o «Correggi la conta». Le celle con ordini aperti mostrano «+2 in arrivo».
3. **Resoconto mensile**: «Registra il resoconto di <mese precedente>» se manca; i mesi registrati dal più recente, con pezzi, incasso del negozio, da fatturare, fattura e pagamento. Il mese in corso ha la casella verde «ora», il mese pagato (o senza niente da incassare) il segno «fatto», il mese finito senza resoconto «da fare» in ambra. Finché il negozio non è contato il resoconto è disattivato, con la spiegazione; ordini e consegne restano possibili.
4. **Ordini**: «Nuovo ordine», gli ordini aperti con «Da preparare · In magazzino · Mancano», quelli chiusi comprimibili.
5. **Storico**, comprimibile: conte, consegne, magliette riportate, versioni dei resoconti, con autore e ora. Qui c'è l'azione secondaria «Riporta in magazzino».
6. Link «Impostazioni del negozio».

### Griglia

Un solo componente (`consignment-stock-grid.tsx`) per lettura, conta, resoconto e ordini. Gruppi per modello nell'ordine del Magazzino (`orderInventoryItems`), una riga per colore, sei celle XS–XXL quadrate con filetti da 1 px. Numeri in Barlow Condensed con cifre tabellari; «—» per sconosciuto, «0» grigio per zero. Campi `type="text"`, `inputMode="numeric"`, 16 px, alti 44 px, con etichetta accessibile («GT3RS Blu M, venduti»). Sul telefono nome e colore sopra e le sei celle sotto; sotto 360 px due righe da tre.

### Conta

Prima conta: campi vuoti, un campo vuoto vale 0. Correzione: campi compilati con la giacenza; si inviano solo le varianti toccate. Data e ora della conta all'ora di Roma (predefinita adesso) e nota facoltativa. Prima dell'invio un riepilogo con «Conferma conta» e «Torna a modificare»: alla prima conta «Hai contato 23 magliette in 14 varianti. Le altre 34 varianti risultano 0.»; in correzione le taglie che cambiano (le prime tre per nome) e il totale del negozio prima e dopo, «Cambi 1 taglia: GT3RS Blu M da 5 a 4. In negozio passano da 8 a 7 magliette.». Ogni riga porta anche la quantità letta (`expected_quantity`): se nel frattempo una consegna o un resoconto ha cambiato la giacenza, il database rifiuta con `stock_changed` e la pagina chiede di controllare i numeri aggiornati.

### Resoconto mensile

Modulo: una frase di introduzione, poi una riga per variante con giacenza in negozio o già nel resoconto, più «Mostra tutte le varianti». Ogni riga ha nome, «in negozio N», il campo «venduti» e il prezzo in negozio; la colonna «Prima della conta» solo quando serve, con la spiegazione in «Cosa va in «Prima della conta»» da aprire. Una variante senza prezzo valido nel catalogo è disattivata con «Prezzo del sito mancante: collega lo SKU al catalogo Shopify» e il resto si salva. Barra che resta in basso (`position: sticky`, `bottom: var(--ws-fixed-bottom)`), sul telefono sopra la barra di navigazione: «5 pezzi · Incasso negozio 224,99 € · Da fatturare 134,99 €» e «Salva resoconto», che diventa «Salva: nessuna vendita» a zero pezzi. Sul telefono la barra sta su una riga: pezzi e «Da fatturare» uno sopra l'altro accanto al pulsante; l'incasso del negozio è nel riepilogo. Quando un campo perde il focus, le barre ferme del conto vendita (conta, resoconto, ordine) salgono sopra la barra di navigazione dopo 300 ms, così il primo tocco sul pulsante non va perso. In modifica è obbligatorio «Perché lo correggi?» (3–500 caratteri).

Riepilogo: quattro numeri grandi (pezzi venduti, incasso del negozio, quota del negozio, da fatturare al negozio); le righe a prezzo bloccato; fattura («Da emettere» o «Fattura n. 12 del 3 ottobre 2026»); pagamento («Da pagare», «Pagata in parte: 50,00 € su 134,99 €», «Pagata»); versioni («Versione 2 · autore · data · motivo»); «Prepara un ordine con le stesse magliette»; la nota «Importi commerciali. Il trattamento IVA va verificato a parte.». Con Finance aperta ci sono «Segna fattura emessa», «Registra pagamento», la modifica e l'annullo dei pagamenti con il loro storico; senza, «Fattura e pagamenti si registrano con Finance sbloccata» e il link a `/auth/area/finance`.

### Ordini

Nuovo ordine: data della richiesta (predefinita oggi), nota, griglia dei pezzi. Il numero è progressivo per negozio. Ordine aperto: per riga «Richieste · Consegnate · Da consegnare · In magazzino · Mancano», in ambra le righe con mancanze. «Consegnato» apre il modulo già compilato con tutto il residuo, modificabile per una consegna parziale, con data e ora. Se i numeri scritti superano quelli in magazzino, prima dell'invio un avviso ambra dice quante ne mancano («GT3RS Blu M (1 su 2)») e propone «Consegna solo quelle in magazzino», che abbassa solo quelle righe. Se al momento dell'invio in magazzino manca una maglietta non si registra nulla e la riga viene indicata. «Modifica ordine» finché è aperto, senza scendere sotto il consegnato. «Chiudi ordine» annulla il residuo, con motivo. Tutto consegnato: segno «fatto».

### Negozi

`/consignment/nuovo` e `/consignment/NEG01/impostazioni`, solo con Finance aperta: nome (3–120 caratteri), quota LuckyLap in percento, maggiorazione in euro, magazzino di partenza (un «Magazzino» attivo), nota, attivo. Un negozio si chiude solo se non ha magliette, ordini aperti o resoconti da pagare (`shop_not_empty`). Nome e stato attivo restano in `stock_locations`, una sola fonte.

### Invii incerti

Ogni comando passa da `runShopCommand` (`src/app/consignment/actions.ts`, fuori dal gruppo di route). UUID e payload si congelano in `sessionStorage` prima dell'invio, con chiave `luckylap.consignment.shop.pending:<userId>`, e un blocco sincrono ferma il doppio clic. Se lo spazio non è scrivibile l'invio non parte. Un esito incerto resta in cima alla pagina con la scheda di `pending-attempt.tsx` (data italiana all'ora di Roma, righe leggibili, codice tecnico solo in «Codice per l'assistenza») e blocca le altre scritture finché «Verifica lo stesso invio» non lo chiarisce con lo stesso UUID. In una verifica, un rifiuto che può arrivare prima della ricevuta (accesso, Finance, dati, mese, flag) non prova che l'invio non sia avvenuto: il tentativo resta incerto. La pagina controlla anche la chiave del modulo precedente, `luckylap.consignment.pending:<userId>`, e la verifica con `runConsignmentCommand`.

Dopo un successo si rileggono `/consignment` (con le pagine figlie), `/`, `/stock`, `/packaging`, `/finance` e `/finance/work`; un errore della cache non annulla una ricevuta confermata.

### Anteprima locale

Con `npm run dev` (`isLocalPreviewEnabled()`, sempre spento su Vercel e con `NODE_ENV=production`) le pagine del conto vendita e `/finance` leggono solo i dati sintetici di `src/lib/consignment/shop-fixtures.ts` («Negozio sintetico», `synthetic.myshopify.com`), mostrano «Anteprima locale: dati sintetici, salvataggio disattivato.» e non chiamano Supabase. `runShopCommand` rifiuta ogni invio. Indirizzi utili: `NEG01` contato, con resoconti, pagamenti e ordini; `NEG02` da contare; `NEG03` chiuso.

## Database

### Tabelle

Tredici tabelle nuove. Per tutte: RLS attiva, nessun privilegio a `anon`, sola lettura per `authenticated` con la policy `private.is_member()` (pagamenti e loro storico: `private.can_finance()`), nessun insert, update o delete dai client, trigger `audit_change`. Le tabelle «solo aggiunta» hanno anche `reject_ledger_mutation`.

| Tabella | Contenuto | Scrittura |
| --- | --- | --- |
| `consignment_shops` | Condizioni del negozio: quota in punti base, maggiorazione in centesimi, EUR, magazzino di partenza, `first_counted_at` (NULL = mai contato), nota, versione. | comandi |
| `consignment_counts`, `consignment_count_lines` | Conte: data, conta completa o no, pezzi, nota; per riga il saldo prima (NULL se assente), la quantità contata e il movimento, se c'è. | solo aggiunta |
| `consignment_reports` | Un resoconto per negozio e mese: versione, condizioni fotografate, pezzi e importi, fattura (numero, data, versione) e `payment_state`. | comandi |
| `consignment_report_lines` | Righe a prezzo bloccato: SKU, pezzi, prima della conta, variante del catalogo, prezzi, importi, costo unitario se noto. | comandi |
| `consignment_report_revisions` | Una versione per ogni modifica di righe o fattura, con motivo e fotografia. | solo aggiunta |
| `consignment_report_movements` | Movimento di giacenza del negozio per versione e variante. È la fonte del consumo packaging. | solo aggiunta |
| `consignment_orders`, `consignment_order_lines` | Ordini: numero, data, nota, stato (`open`, `delivered`, `closed`), motivo della chiusura; righe con richieste, consegnate, annullate. | comandi |
| `consignment_shipments`, `consignment_shipment_lines` | Consegne al negozio (`to_shop`, con ordine) e magliette riportate (`to_warehouse`). Ogni riga è una riga di `consignment_transfers` con i suoi `transfer_out` e `transfer_in`. | solo aggiunta |
| `consignment_report_payments` | Pagamenti del negozio: importo, data, metodo, conto, riferimento, annullato, versione. Solo Finance. | comandi |
| `consignment_payment_revisions` | Storico dei pagamenti, con motivo dalla versione 2. Solo Finance. | solo aggiunta |

Gli importi pagati non stanno in `consignment_reports`: lo stato del pagamento è visibile a tutti, gli importi solo a Finance. L'unico inserimento della migrazione è una riga di `consignment_shops` per ogni sede «Negozio Conto Vendita» già presente, con quota e maggiorazione da `app_settings` (60%, 10 €), `first_counted_at` NULL e magazzino di partenza uguale all'unico «Magazzino» attivo, se è uno solo (altrimenti resta da scegliere nelle impostazioni). È scritta prima del trigger di audit. Nessun saldo, movimento o riga esistente cambia.

La migrazione aggiunge anche i tipi di movimento `shop_count` e `consignment_sale_correction`, usati solo dentro le funzioni, e il trigger `adjustment_not_on_shop` su `stock_movements` (vedi «Magazzino»).

### Comandi

Dieci RPC, tutte `(p_operation_id uuid, p_payload jsonb) returns jsonb`, con `schema_version: 1`. Il wrapper pubblico è `security invoker` e chiama il processore `private` `security definer` con `search_path` vuoto; `execute` solo ad `authenticated`. Ogni processore, nell'ordine: identità e permesso; validazione (chiavi esatte, UUID, righe ordinate per articolo, senza doppioni, al massimo 200); ricevuta in `private.consignment_receipts` (un replay identico restituisce il risultato originale prima dei flag, un UUID riusato con dati diversi dà `idempotency_conflict`); flag; lock della riga del negozio, poi delle righe toccate, poi dei saldi per articolo e sede; effetti.

| RPC | Chi | Effetti |
| --- | --- | --- |
| `save_consignment_shop` | Finance | Crea una sede `NEGnn` e la riga del negozio, oppure aggiorna nome, stato, condizioni, magazzino di partenza e nota, con versione. |
| `count_consignment_stock` | membri | Conta assoluta. La prima deve coprire tutte le T-shirt attive. Riga senza saldo: movimento `opening`; differenza: movimento `shop_count`; uguale: nessun movimento. Imposta `first_counted_at` alla prima conta. Mai il magazzino centrale, mai il packaging. |
| `save_consignment_report` | membri | Crea o sostituisce tutte le righe del mese. Controlla negozio contato, mese, versione, catalogo (per le varianti nuove), «prima della conta» e giacenza del negozio. Muove solo il negozio, per differenza. Nessuna riga in `sales_orders`, `commercial_facts`, `finance_entries` o `consignment_sales`. |
| `set_consignment_invoice` | Finance | Segna, corregge o toglie numero e data della fattura (data non futura e non prima del mese). Nuova versione `invoice`. |
| `record_consignment_payment` | Finance | Pagamento, anche parziale: la somma dei pagamenti attivi non supera il da fatturare. Data non prima del mese. |
| `update_consignment_payment` | Finance | Modifica o annulla un pagamento, con versione e motivo. |
| `save_consignment_order` | membri | Crea o modifica un ordine aperto. Solo T-shirt attive; mai sotto il consegnato. |
| `ship_consignment_order` | membri | Consegna: dal magazzino di partenza al negozio, riga per riga, con i controlli di `transfer_consignment_stock` (saldi noti, riserve). Aggiorna consegnato, stato e versione. |
| `close_consignment_order` | membri | Annulla il residuo con motivo; stato `closed`. |
| `return_consignment_stock` | membri | Riporta magliette dal negozio al magazzino di partenza. |

Ogni comando che cambia un resoconto ricalcola `payment_state` dai pagamenti non annullati: `nothing_due`, `unpaid`, `partial`, `paid`, `overpaid` (dopo un resoconto ridotto). Conta, consegna e rientro richiedono `stock_adjustments_enabled`; il resoconto anche `manual_sales_enabled` con `sales_started_at`.

### Errori

Codici con SQLSTATE `22023`, tranne `membership_required`, `finance_access_required`, `stock_mutations_disabled` e `sales_disabled` (`42501`) e `report_exists` (`23505`). Il server (`SHOP_MESSAGES` in `src/lib/consignment/shop-server.ts`) controlla membership, e Finance per negozi, fatture e pagamenti, prima della RPC, e traduce ogni codice in italiano. Uno SKU compare nel messaggio solo se è uno SKU del gestionale letto con la RLS, e la riga colpita si evidenzia solo se è una riga dell'invio. Un errore che non è nella mappa resta incerto.

| Codice | Messaggio |
| --- | --- |
| `shop_not_counted` | Prima conta le magliette in negozio. |
| `full_count_required` | La prima conta deve comprendere tutte le magliette. Lascia 0 dove non ce ne sono. |
| `stock_changed` | Nel frattempo la giacenza è cambiata. Controlla i numeri aggiornati e salva di nuovo. |
| `stale_version` | Qualcun altro ha appena modificato questi dati. Rileggi e ripeti la modifica. |
| `report_exists` | Il resoconto di questo mese esiste già. Aprilo e usa «Modifica». |
| `report_not_found`, `payment_not_found` | Questo resoconto (pagamento) non c'è più. Rileggi la pagina. |
| `insufficient_shop_stock` | Per {SKU} il negozio ne ha meno di quelle indicate. Correggi il resoconto o la conta. |
| `insufficient_stock` | Per {SKU} non ci sono abbastanza magliette libere in magazzino. Nessuna consegna registrata. |
| `unknown_stock` | Per {SKU} la giacenza del magazzino non è verificata. Nessuna consegna registrata. |
| `catalog_changed` | Il prezzo del sito è cambiato. Rileggi e controlla il nuovo prezzo. |
| `unmatched_catalog` | Per {SKU} manca il prezzo del sito. Collega lo SKU al catalogo Shopify. |
| `before_count_not_allowed` | «Prima della conta» vale solo se hai contato il negozio in questo mese o dopo. |
| `payment_exceeds_invoice` | Il pagamento supera l'importo ancora da incassare. |
| `exceeds_order` | Per {SKU} stai consegnando più di quanto resta nell'ordine. |
| `below_delivered` | Per {SKU} non puoi scendere sotto le magliette già consegnate. |
| `order_not_open` | L'ordine non è più aperto. Rileggi la pagina. |
| `shop_not_empty` | Il negozio ha ancora magliette, ordini aperti o resoconti da pagare. |
| `invalid_period` | Questo mese non si può registrare: scegli un mese dall'avvio delle vendite a oggi. |
| `invalid_date` | La data non è valida: non può essere nel futuro né prima del mese. |
| `invalid_location`, `invalid_tshirt`, `invalid_payload`, `idempotency_conflict`, `reserved_stock_conflict`, accesso e flag | Messaggi generici senza dettagli tecnici. |

### Letture

`src/lib/consignment/shop-server.ts` legge con il client della persona collegata, mai con chiavi amministrative: elenco (`readConsignmentShops`) e pagina del negozio (`readConsignmentShop`). Ogni tabella si legge per intero con `consignmentPages` (chiave crescente e conteggio esatto); il catalogo con una sola lettura paginata delle varianti attive collegate a un articolo. Pagamenti e loro storico si leggono solo con Finance aperta. Le funzioni pure di `shop-read.ts` fanno fallire tutta la lettura se una riga è incompleta, orfana, doppia o troncata, o se lo stato del pagamento non coincide con i pagamenti letti: la pagina d'errore non mostra dati parziali.

## Finance

Il resoconto non è denaro: incasso del negozio, quota del negozio e da fatturare restano fuori da saldi, grafico e categorie. Entra solo il pagamento del negozio, una volta, sul suo conto, come movimento `shop_payment` (`shop-payment:<id>`, ancora `movimento-shop_payment-<id>`). `/finance` e `/finance/work` mostrano il pannello «Conto vendita · da incassare», una riga per resoconto. Regole e interfaccia in [Finance: conti, andamento e categorie](finance-dashboard.md).

Per Oggi (pacchetto successivo) `src/lib/consignment/shop-finance.ts` esporta `loadConsignmentToSettle(supabase, member)`: per negozio e mese, da fatturare, da incassare e stato, dopo aver riverificato membership e Finance.

## Magazzino

- Le quantità del negozio cambiano solo con i comandi di questo modulo. `/stock/rettifiche` sceglie solo i magazzini e la sua Server Action rifiuta le altre sedi con `shop_location`; nel database il trigger `adjustment_not_on_shop` (`private.reject_shop_adjustment()`, `before insert` su `stock_movements`) rifiuta ogni movimento `adjustment` su una sede «Negozio Conto Vendita». I movimenti `opening` e `transfer_in` sul negozio restano ammessi. Vedi [Rettifiche del magazzino](stock-interface.md).
- La colonna «In negozio» delle Giacenze (`/stock`) somma i negozi attivi già contati; «—» finché nessun negozio è contato.
- Ordini e consegne non creano riserve: la consegna controlla la disponibilità vera del magazzino di partenza al momento dell'invio.

## Packaging

Consegne al negozio, magliette riportate e conte non consumano packaging. Ogni pezzo che il resoconto toglie dal negozio consuma una scatola e un adesivo da MAG01, una volta sola. Una correzione al ribasso non restituisce materiale. La migrazione sostituisce `private.observe_packaging_source` con lo stesso corpo più un ramo per `consignment_report_movements` e aggiunge il trigger `observe_packaging` su quella tabella. Contratto completo e limite noto in [Packaging T-shirt nel database](packaging-backend.md).

## Produzione

Stato al 22 ottobre 2026: migrazione **non ancora applicata**. Procedura (piano di lavoro, §1.3):

1. Impronte in sola lettura di `stock_balances` e `stock_movements` (conteggio e somma delle quantità per sede), `packaging_consumptions`, `consignment_transfers`, `consignment_sales`, `consignment_settlements`.
2. Applicazione della migrazione e rinomina del file alla versione assegnata dal cloud.
3. Verifiche in sola lettura: una riga `consignment_shops` per NEG01 con 6000 / 1000, `first_counted_at` nullo, `supply_location_id` = MAG01; impronte identiche; le tre RPC precedenti esistono ancora.
4. Merge e deploy.
5. La prima conta in negozio, dall'app, quando qualcuno ci va. Fino ad allora NEG01 è «Da contare» e il resoconto è disattivato.

## Verifica

Vitest (tutti con dati sintetici, albero React senza DOM per i componenti):

| File | Test | Cosa verifica |
| --- | --- | --- |
| `src/lib/consignment/shop-model.test.ts` | 63 | `shopSplit` uguale a `consignmentSplit` con 6000/1000, mezzi centesimi, limite 9e15, altre quote; parser dei 10 comandi (chiavi, UUID, quantità, mesi, date al cambio dell'ora, righe doppie, 201 righe, `price` obbligatorio e vietato). |
| `src/lib/consignment/shop-read.test.ts` | 54 | Sconosciuto e zero, «in arrivo», promemoria, colonna «Prima della conta», mesi ammessi all'ora di Roma, totali, mancanze degli ordini, letture troncate o orfane. |
| `src/lib/consignment/shop-server.test.ts` | 42 | Membership e Finance prima della RPC, un messaggio per codice, verifiche incerte, forma del risultato, SKU solo se noto. |
| `src/lib/consignment/shop-finance.test.ts` | 8 | Pannello mensile, accesso negato prima delle query, pagamenti come movimenti, `loadConsignmentToSettle`. |
| `src/lib/consignment/links.test.ts` | 5 | Indirizzi validi o ritorno all'elenco. |
| `src/app/consignment/actions.test.ts` | 4 | Anteprima senza invii, pagine rilette dopo un successo. |
| `src/app/(workspace)/consignment/consignment-pages.test.tsx` | 7 | Anteprima sintetica (spenta con `VERCEL=1` e `NODE_ENV=production`), «Pagina non trovata», titolo della conta uguale all'h1, parole vietate, nessun «Magadzino». |
| Componenti `consignment-*.test.tsx` | 54 | Elenco 6, negozio 9, griglia 5, resoconto 9, ordine 6, invii incerti 11, pannello Finance 8: stati vuoti e da contare, «—» e «0», riepilogo della correzione, totali dal vivo, doppio invio, recupero anche dalla chiave vecchia, mancanze in ambra, avviso di consegna oltre il magazzino, pulsanti Finance nascosti. |
| `src/lib/finance/dashboard.test.ts`, `src/app/(workspace)/finance/finance-preview.test.tsx` | 16 + 3 | Pagamenti del negozio nei conti, nessun doppio conteggio, resoconti fuori dai saldi; anteprima di `/finance`. |
| `src/lib/auth/inventory-model.test.ts`, `src/components/inventory-workspace.test.tsx` | 6 + 2 | Colonna «In negozio». |
| `src/lib/stock/model.test.ts`, `src/lib/stock/server.test.ts` | 29 + 27 | Sedi del negozio escluse e rifiutate (`shop_location`). |

Harness SQL (`npm run test:db`):

- `supabase/tests/consignment-monthly.mjs`, PGlite, **613 controlli** (riga in testa `// test-db: pglite minimo 613`): permessi, migrazione, conta, resoconto, ordini e consegne, packaging, fattura e pagamenti, negozi, audit, RPC precedenti, rettifiche rifiutate sul negozio e accettate su MAG01.
- `supabase/tests/consignment-concurrency.mjs`, PostgreSQL 17 reale, **16 controlli** (`// test-db: postgres minimo 16`), cluster usa e getta: due creazioni dello stesso mese, due modifiche dalla stessa versione, ultima maglietta fra consegna e vendita diretta, conta contro consegna, due pagamenti che insieme superano il dovuto.
- `consignment.mjs` (145), `packaging-automation.mjs` (73) e `packaging-concurrency.mjs` (6) applicano anche questa migrazione: le RPC precedenti e la funzione packaging sostituita passano con gli stessi controlli.

Prova visiva del 22 ottobre 2026 sull'anteprima sintetica (`npm run dev`), a 1280 × 800 e 390 × 844: elenco; `NEG02` da contare («—» e avviso ambra); `NEG01` contato; conta; resoconto di ottobre (modulo, con la barra sopra la barra di navigazione del telefono) e di settembre (riepilogo con i quattro numeri, fattura e pagamento); nuovo ordine; ordine n. 2 con le mancanze in ambra; nuovo negozio; impostazioni; `/finance` con il pannello «Conto vendita · da incassare»; `/stock` con la colonna «In negozio». In ogni pagina nessuno scorrimento orizzontale (anche a 360 px per negozio, conta e riepilogo), nessun testo sotto 12 px, campi a 16 px; sul telefono nessun bersaglio sotto 44 px nelle pagine del conto vendita (nel pannello Finance la riga intera è il link); nessun errore nella console o nel server. In anteprima `/stock/rettifiche` resta «da collegare»: l'esclusione del negozio dalle sedi è provata da `src/lib/stock/server.test.ts`.

## Comandi precedenti

Le tre RPC del modulo precedente restano nel database e funzionano (lo provano `consignment.mjs` e il gruppo 10 di `consignment-monthly.mjs`), ma l'interfaccia non le usa più. All'ultima verifica cloud ([verification.md](verification.md)) non c'era nessuna operazione del modulo precedente.

- `transfer_consignment_stock`: trasferimento di uno SKU fra un «Magazzino» e un «Negozio Conto Vendita», con saldi noti e riserve rispettate, due movimenti `transfer_out` e `transfer_in` e una riga in `consignment_transfers`.
- `register_consignment_sale`: vendita singola dichiarata dal negozio, con prezzo del catalogo verificato, movimento `consignment_sale` e riga in `consignment_sales`. Consuma packaging come le vendite del resoconto.
- `record_consignment_settlement`: incasso di una vendita singola, solo Finance, in `consignment_settlements`.

Restano anche il loro codice (`src/lib/consignment/model.ts`, `read.ts`, `server.ts`, `finance.ts`) e l'azione `runConsignmentCommand`, che servono a verificare un tentativo rimasto in sospeso e a mostrare in `/finance/work`, sotto «Vendite registrate prima del resoconto mensile», le eventuali vendite singole con i loro incassi.
