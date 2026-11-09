# Finance: panoramica, movimenti e incassi attesi

`/finance` si apre sulla **Panoramica**, con tre risposte in primo piano: **Saldo dai movimenti**, **Entrate registrate** e **Uscite registrate**. Le altre destinazioni sono **Movimenti** e **Da incassare**; **Documenti e fonti** è un ingresso secondario. «Nuovo movimento» apre direttamente il modulo breve da tutte le destinazioni. Conto Revolut e integrazioni bancarie restano quelli attuali: il saldo deriva dalle registrazioni, non è verificato con la banca e non rappresenta un saldo bancario ufficiale.

La pagina legge le importazioni BudgetFlow, il lavoro Finance, gli incassi vecchi del conto vendita, i resoconti mensili dei negozi con i loro pagamenti e le revisioni Finance, con la sessione dell’utente. Mantiene i controlli esistenti di identità, membership attiva e password Finance nella sessione corrente; ogni query usa RLS. Una lettura fallita o incompleta impedisce la visualizzazione dell’intera pagina. Non usa chiavi amministrative o cache condivise. L’anteprima locale usa soltanto fixture sintetiche e disabilita le scritture.

## Percorsi e contesto

| Destinazione | Indirizzo | Scopo |
| --- | --- | --- |
| Panoramica | `/finance` oppure `?vista=overview` | Saldo cumulato, flussi del periodo e spese per categoria. |
| Movimenti | `/finance?vista=movements` | Registro unico, ricerca, filtri e scheda del movimento. |
| Da incassare | `/finance?vista=receivables` | Residui dei resoconti dei negozi e accesso al pagamento. |
| Documenti e fonti | `/finance?vista=sources` | Importazioni originali, provenienza e link all’archivio `/finance/documents`. |
| Nuova uscita diretta | `/finance?vista=movements&nuovo=expense` | Modulo breve; `nuovo=income` seleziona un’entrata. |

Finance gestisce questa navigazione dentro la pagina; il guscio condiviso non aggiunge una seconda barra di schede. Il vecchio indirizzo `/finance/work` rimane un ingresso compatibile e porta alla nuova uscita diretta. Restano funzionanti gli editor `/finance/movimento?source_kind=…&source_id=…` e `/finance/incasso/<id>`; il percorso normale apre la scheda contestuale dal registro.

Periodo, conto, ricerca, tipo, categoria, stato, fonte, importazione e movimento aperto sono nell’indirizzo (`periodo`, `dal`, `al`, `conto`, `q`, `tipo`, `categoria`, `stato`, `fonte`, `lotto`, `movimento`, `nuovo`). Sono disponibili Questo mese, Mese scorso, Quest’anno, Intervallo e Tutti i periodi. Aprire e chiudere una scheda mantiene il registro e i filtri; i pulsanti avanti e indietro del browser ripristinano il contesto. Una modifica non salvata richiede conferma prima di abbandonare la scheda o il modulo.

## Regole del calcolo

- **Revisioni (dal 23 ottobre 2026).** Prima di saldi, grafico, categorie, anni e filtri si applica l'ultima versione di ogni movimento (`revisedFinanceDashboard` in `src/lib/finance-revisions/dashboard.ts`, modello in [finance-revisions.md](finance-revisions.md)). Le righe modificate usano i valori effettivi; le eliminate escono dai saldi e restano nel filtro «Eliminati · recuperabili». Le fonti non cambiano.
- Gli importi dell’export sono convertiti dal testo in centesimi `bigint`, senza arrotondamenti in virgola mobile. Anche somme, saldi e categorie rimangono interi. Nel grafico la conversione in `Number` riguarda esclusivamente coordinate comprese nell’area di disegno.
- Il saldo dai movimenti comprende righe non pending con data non successiva a oggi. BudgetFlow conserva il giorno dichiarato nell’export; osservazioni live e incassi conto vendita usano il giorno effettivo in Europe/Rome.
- Non è aggiunto alcun saldo iniziale. Il saldo è cumulato dall’inizio delle registrazioni fino alla fine del periodo o a oggi, se precedente; non riparte da zero a gennaio. I mesi successivi a oggi non vengono mostrati come consuntivi. Il periodo in corso è dichiarato parziale. I saldi non implicano revisione o riconciliazione bancaria: le importazioni rimangono da verificare.
- Pending rimane separato, anche quando la stessa riga ha data futura. La Panoramica esclude sospesi, futuri ed eliminati; il registro li rende consultabili con stati espliciti. La vista «Date future» contiene solo righe future non pending. Il nuovo inserimento manuale continua a rifiutare date future: possono esistere nelle fonti importate o nelle revisioni già supportate, senza diventare consuntivi.
- Una riga di trasferimento con conto di origine e destinazione applica l’importo con il segno originale al primo conto e l’opposto al secondo. Il trasferimento non alimenta le categorie di entrata/costo. Non si creano trasferimenti a partire da gateway o descrizioni.
- Le voci manuali non annullate hanno il segno determinato dal tipo entrata/uscita. Un account esplicito alimenta il conto indicato; l’assenza di conto rimane da attribuire. Non sono deduplicate automaticamente fonti diverse: rimane la conferma di verifica nel modulo di inserimento.
- I pagamenti di ordine dichiarati con metodo `cash` e gli incassi conto vendita `cash` alimentano Cash una sola volta. Del conto vendita entra l’incasso realmente registrato, senza sommare nuovamente lordo o credito del 60%.
- **Conto vendita mensile.** Il resoconto del mese non è un movimento: incasso del negozio, quota del negozio e importo da fatturare non entrano in saldi, grafico o categorie, e il resoconto non crea `finance_entries`, `commercial_facts` né `sales_orders`. Entra solo il denaro ricevuto: ogni pagamento non eliminato di `consignment_report_payments` è un movimento con sorgente `shop_payment`, id `shop-payment:<id>`, giorno del pagamento a Roma, con direzione, categoria (Vendite se non cambiata), descrizione e «pianificato» dei campi Finance aggiunti da `20261023091633_shop_payment_finance.sql`. Conto: quello indicato, normalizzato come gli altri; contanti senza conto in Cash; altrimenti da attribuire. Un pagamento modificato conta con i valori attuali. Si corregge dal resoconto oppure da Finance (`/finance/incasso/<id>`), sempre con `update_consignment_payment` e lo stesso storico (`consignment_payment_revisions`): non è un bersaglio di `finance_movement_revisions`.
- Gli altri pagamenti, capture Shopify e rimborsi rimangono da attribuire quando il conto non è noto. Il gateway non viene interpretato come conto Revolut. `sale_observed`, annulli commerciali, fatti Finance collegati ai pagamenti, dettagli fiscali e transazioni descrittive non sono sommati ai conti.

## Panoramica e grafici

Periodo e conto controllano tutti e tre gli indicatori e i grafici. Ricerca e stato del registro non cambiano di nascosto i numeri della Panoramica. Le registrazioni senza conto sono escluse dai totali per conto e dai grafici, con conteggio separato e accesso «Da attribuire»; non sono assegnate automaticamente a Revolut. Il registro completo le conserva.

«Entrate e uscite nel tempo» mostra barre affiancate per intervalli settimanali o mensili, con granularità dichiarata. Il selettore «Saldo» passa alla linea cumulata, che include i trasferimenti. «Dove spendiamo» ordina le uscite per categoria: prime cinque e «Altre» espandibile. Le uscite sono lorde: un’entrata nella stessa categoria non riduce una spesa, e un rimborso in uscita rimane tale. La somma delle categorie coincide al centesimo con Uscite registrate. «Entrate − uscite» è la differenza dei flussi registrati, senza calcolare utile o margine.

Ogni indicatore, barra, punto e categoria apre i movimenti del proprio perimetro, rimuovendo gli eventuali filtri incompatibili. Il saldo apre lo storico cumulato fino alla sua data; i flussi aprono l’intervallo della barra. I grafici hanno legenda, valori raggiungibili da tastiera e tocco e «Tabella dei valori esatti». Il colore accompagna sempre segni e testo.

## Registro e scheda

In Movimenti la ricerca è subito in alto e copre descrizione, categoria, conto e importo. `1234,56` e `1.234,56` cercano lo stesso valore; non è il formato richiesto per inserire un nuovo importo. Il registro dichiara periodo e numero dei risultati, con totali distinti di entrate e uscite. Se la ricerca non trova righe nel periodo, «Cerca in tutti i periodi» lo amplia conservando il testo. L’ampliamento non avviene in modo implicito.

Tipo e categoria sono filtri essenziali; «Altri filtri» raccoglie stato, fonte e «Solo senza conto». Gli stati comprendono Registrati, Tutti gli stati attivi, In sospeso, Date future, Conto da attribuire, Modificati ed Eliminati · recuperabili. Le etichette dei filtri attivi sono rimovibili; «Togli i filtri» mantiene il periodo scelto. Nei risultati diversi dai consuntivi una nota distingue quei totali dalla Panoramica.

La descrizione identifica la riga; sotto si leggono categoria e conto, accanto data, importo con segno e autore dell’ultima revisione. Aprire la riga mostra la scheda contestuale con dati correnti, correzione, storico richiudibile e fonte. La scheda usa gli editor esistenti, senza riscrivere i documenti originali. Il pagamento di un negozio continua a usare `update_consignment_payment` e lo storico del resoconto, distinto dalle revisioni generali Finance. Incassi delle vendite e rimborsi Shopify non si eliminano da Finance: l’editor rimanda a Vendite per «Annulla registrazione» o «Registra reso». Gli altri limiti di correzione e ripristino sono quelli di [finance-revisions.md](finance-revisions.md).

## Da incassare, fonti e categorie

Da incassare riguarda soltanto i resoconti dei negozi: non è uno scadenziario generale. Il pannello «Conto vendita · da incassare» presenta una riga per resoconto, dal mese più recente, con negozio, mese, pezzi, incasso del negozio, da fatturare, fattura, incassato, residuo, stato e link al resoconto. Il totale «Da incassare» somma i residui. Pannello e pagamenti nei saldi arrivano dalla stessa lettura completa. Il resoconto non è denaro incassato: il pagamento entra una sola volta, senza aggiungere una voce manuale.

Documenti e fonti conserva importazioni Budget Flow, metadati e campi originali con «Dati originali»; «Apri i movimenti» seleziona l’importazione nel registro. Gli originali sono consultabili progressivamente. «Osservazioni commerciali e Shopify» conserva inoltre transazioni, valori fiscali osservati e fatti commerciali separati dai flussi revisionati. L’archivio privato resta in `/finance/documents` e i fatti commerciali continuano a essere consultabili in Vendite. «Chiudi Finance» rimane in cima alle pagine dell’area.

Il catalogo suggerito contiene 16 categorie, con gruppi in italiano:

| Gruppo | Categorie |
| --- | --- |
| Entrate | Collab; Fund Raising; Others; Vendite |
| Costi fissi | Software; Stipendi; Tasse & Contributi |
| Costi variabili | Attrezzatura; Commissioni; Eventi; Marketing; Packaging; Produzione; Servizi e consulenze; Spedizioni; Trasferte |

Packaging, Commissioni e Servizi e consulenze sono nuovi suggerimenti. Nessuna riga storica viene riclassificata o rinominata, compresa Stipendi; le categorie personalizzate restano consultabili. La categoria descrive la natura del movimento: non sostituisce conto, fonte, canale, evento o collezione. Il modulo mantiene conto e categoria facoltativi, con «Da attribuire» e «Da classificare», e permette valori personalizzati. Campi, conferma anti-duplicato e limiti della registrazione sono descritti in [finance-work.md](finance-work.md).

## Verifica

`buildFinanceDashboard(imports, work, reportDate, options = {})` riceve le fonti in più nell’oggetto `options`: `settlements` (incassi vecchi) e `shopPayments` (pagamenti dei resoconti). Le revisioni non passano da `options`: le applica `revisedFinanceDashboard` sul risultato, prima di ogni somma. Resoconti e pagamenti arrivano da una sola lettura, `readConsignmentMonthlyFinance` in `src/lib/consignment/shop-finance.ts`: riverifica membership, identità e password Finance prima di ogni query, legge tutte le pagine con conteggio esatto e rifiuta righe orfane o uno stato del pagamento che non coincide con i pagamenti letti. Lo stesso controllo vale per `loadConsignmentToSettle`, che legge il riquadro «Conto vendita da regolare» di Oggi (solo per chi può aprire Finance; con l’area chiusa il riquadro chiede di aprirla e non legge importi).

`src/lib/finance/workspace.ts` aggiunge la proiezione pura del contesto: `parseFinanceView` e `financeViewHref` gestiscono l’indirizzo, `filterFinanceMovements` il registro e `financeWorkspaceSummary` indicatori e grafici. Tutti lavorano sulle righe revisionate e preservano gli importi `bigint`; nessuna ricerca o selezione scrive alle fonti. Il loader della scheda `loadFinanceEditor` riverifica identità e area aperta prima di leggere lo storico. Una risposta tardiva non sostituisce la scheda corrente.

I test sintetici coprono centesimi oltre la precisione aggregata di `Number`, sospesi/futuri, riporto storico, entrambe le gambe dei trasferimenti, voci annullate, conto sconosciuto, incassi cash, Shopify senza conto, assenza di doppio conteggio dei fatti, incassi conto vendita, pagamenti del negozio, resoconti mai nei saldi, giorno Europe/Rome e categorie. La proiezione del workspace verifica indirizzi, periodi e ricerca italiana, uscite lorde e coerenza dei perimetri. I test dei componenti coprono navigazione, modulo breve, scheda, grafici e tabella dei valori esatti. I loader sono testati per negazione prima della query e letture incomplete. Non sono salvati dati finanziari reali nelle fixture Git.

La modifica non richiede migrazioni o nuove dipendenze e mantiene i comandi di scrittura esistenti. Decisioni, ricerca e criteri di accettazione sono nella [specifica dell’interfaccia](superpowers/specs/2026-11-09-finance-interfaccia.md) e nel [piano di implementazione](superpowers/plans/2026-11-09-finance-interfaccia.md); grafica e componenti seguono DESIGN.md.
