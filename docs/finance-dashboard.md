# Finance: panoramica, movimenti e conto vendita

`/finance` si apre sulla **Panoramica** con le linee dei saldi per conto e le liste **Pianificati** e **In sospeso**. Nel menu Finance trovi **Movimenti**, **Analisi**, **Budget**, **Categorie**, **Conto vendita** e **Documenti e fonti**. Il pulsante «Nuovo movimento» apre il modulo da tutte le destinazioni. I saldi derivano dalle registrazioni disponibili.

La pagina legge le importazioni BudgetFlow, il lavoro Finance, gli incassi vecchi del conto vendita, i resoconti mensili dei negozi con i loro pagamenti e le revisioni Finance, con la sessione dell’utente. Mantiene i controlli esistenti di identità, membership attiva e password Finance nella sessione corrente; ogni query usa RLS. Una lettura fallita o incompleta impedisce la visualizzazione dell’intera pagina. Non usa chiavi amministrative o cache condivise. L’anteprima locale usa soltanto fixture sintetiche e disabilita le scritture.

## Percorsi e contesto

| Destinazione | Indirizzo | Scopo |
| --- | --- | --- |
| Panoramica | `/finance` oppure `?vista=overview` | Saldi cumulati per conto, movimenti pianificati e sospesi. |
| Movimenti | `/finance?vista=movements` | Registro per giorno, ricerca, filtri e scheda del movimento. |
| Analisi | `/finance?vista=analysis` | Flussi del periodo, spese per categoria e tabelle dei valori. |
| Categorie | `/finance?vista=categories` | Catalogo per gruppo e accesso ai movimenti di una categoria. |
| Budget | `/finance?vista=budgets` | Limiti mensili complessivi e per categoria, spesa effettiva e residuo. |
| Conto vendita | `/finance?vista=receivables` | Vendite, fatture, pagamenti e residui dei negozi. |
| Documenti e fonti | `/finance?vista=sources` | Importazioni originali, provenienza e link all’archivio `/finance/documents`. |
| Nuova uscita diretta | `/finance?vista=movements&nuovo=expense` | Modulo breve; `nuovo=income` seleziona un’entrata. |

Su desktop il menu Finance mostra le destinazioni, i conti e i gruppi di categorie nella colonna laterale. Su telefono si apre con «Menu Finance». Il pulsante della data apre la selezione del periodo e del conto. Il vecchio indirizzo `/finance/work` porta alla nuova uscita diretta. Gli editor `/finance/movimento?source_kind=…&source_id=…` e `/finance/incasso/<id>` restano disponibili dai rispettivi collegamenti.

Periodo, conto, ricerca, tipo, categoria, stato, fonte, importazione e movimento aperto sono nell’indirizzo (`periodo`, `dal`, `al`, `conto`, `q`, `tipo`, `categoria`, `stato`, `fonte`, `lotto`, `movimento`, `nuovo`). Sono disponibili Questo mese, Mese scorso, Quest’anno, Intervallo e Tutti i periodi. Aprire e chiudere una scheda mantiene il registro e i filtri; i pulsanti avanti e indietro del browser ripristinano il contesto. Una modifica non salvata richiede conferma prima di abbandonare la scheda o il modulo.

## Regole del calcolo

- **Revisioni (dal 23 ottobre 2026).** Prima di saldi, grafico, categorie, anni e filtri si applica l'ultima versione di ogni movimento (`revisedFinanceDashboard` in `src/lib/finance-revisions/dashboard.ts`, modello in [finance-revisions.md](finance-revisions.md)). Le righe modificate usano i valori effettivi; le eliminate escono dai saldi e restano nel filtro «Eliminati · recuperabili». Le fonti non cambiano.
- Gli importi dell’export sono convertiti dal testo in centesimi `bigint`, senza arrotondamenti in virgola mobile. Anche somme, saldi e categorie rimangono interi. Nel grafico la conversione in `Number` riguarda esclusivamente coordinate comprese nell’area di disegno.
- Il saldo dai movimenti comprende righe non pending con data non successiva a oggi. BudgetFlow conserva il giorno dichiarato nell’export; osservazioni live e incassi conto vendita usano il giorno effettivo in Europe/Rome.
- Non è aggiunto alcun saldo iniziale. Il saldo è cumulato dall’inizio delle registrazioni fino alla fine del periodo o a oggi, se precedente; non riparte da zero a gennaio. I mesi successivi a oggi non vengono mostrati come consuntivi. Il periodo in corso è dichiarato parziale. I saldi non implicano revisione o riconciliazione bancaria: le importazioni rimangono da verificare.
- Pianificati mostra le scadenze future, incluso l’incasso atteso dell’archivio. I saldi effettivi escludono futuri, sospesi ed eliminati. Un incasso storico previsto nella fonte resta sospeso anche dopo la scadenza finché viene confermato dalla scheda.
- Una riga di trasferimento con conto di origine e destinazione applica l’importo con il segno originale al primo conto e l’opposto al secondo. Il trasferimento non alimenta le categorie di entrata/costo. Non si creano trasferimenti a partire da gateway o descrizioni.
- Le voci manuali non annullate hanno il segno determinato dal tipo entrata/uscita. Un account esplicito alimenta il conto indicato; l’assenza di conto rimane da attribuire. Non sono deduplicate automaticamente fonti diverse: rimane la conferma di verifica nel modulo di inserimento.
- I pagamenti di ordine dichiarati con metodo `cash` e gli incassi conto vendita `cash` alimentano Cash una sola volta. Del conto vendita entra l’incasso realmente registrato, senza sommare nuovamente lordo o credito del 60%.
- **Conto vendita mensile.** Il resoconto del mese non è un movimento: incasso del negozio, quota del negozio e importo da fatturare non entrano in saldi, grafico o categorie, e il resoconto non crea `finance_entries`, `commercial_facts` né `sales_orders`. Entra solo il denaro ricevuto: ogni pagamento non eliminato di `consignment_report_payments` è un movimento con sorgente `shop_payment`, id `shop-payment:<id>`, giorno del pagamento a Roma, con direzione, categoria (Vendite se non cambiata), descrizione e «pianificato» dei campi Finance aggiunti da `20261023091633_shop_payment_finance.sql`. Conto: quello indicato, normalizzato come gli altri; contanti senza conto in Cash; altrimenti da attribuire. Un pagamento modificato conta con i valori attuali. Si corregge dal resoconto oppure da Finance (`/finance/incasso/<id>`), sempre con `update_consignment_payment` e lo stesso storico (`consignment_payment_revisions`): non è un bersaglio di `finance_movement_revisions`.
- Gli altri pagamenti, capture Shopify e rimborsi rimangono da attribuire quando il conto non è noto. Il gateway non viene interpretato come conto Revolut. `sale_observed`, annulli commerciali, fatti Finance collegati ai pagamenti, dettagli fiscali e transazioni descrittive non sono sommati ai conti.

## Panoramica e analisi

Periodo e conto impostano il perimetro dei grafici. Le registrazioni senza conto hanno un conteggio separato con accesso «Da attribuire». La ricerca e lo stato del registro agiscono sui risultati di Movimenti.

Il grafico della Panoramica traccia una linea per conto con i saldi cumulati. Le linee grigie proiettano il saldo partendo dalle registrazioni pianificate nel periodo. Selezionare una data mostra gli importi per conto e, per il consuntivo, permette di aprire lo storico fino a quel giorno. Il saldo principale apre lo storico per tutti i conti inclusi nel filtro. Sotto il grafico si possono ordinare i saldi e aprire i singoli movimenti delle liste. «In sospeso» comprende anche le voci arretrate fino alla fine del periodo selezionato.

Le voci con «Statistiche» disattivato contribuiscono al saldo e sono escluse dai grafici di flusso.

In Analisi, «Entrate e uscite nel tempo» mostra barre affiancate per intervalli settimanali o mensili. Il selettore «Saldo» passa alla linea cumulata, che include i trasferimenti. «Dove spendiamo» ordina le uscite lorde per categoria. La somma delle categorie coincide al centesimo con Uscite registrate. «Entrate − uscite» è la differenza dei flussi registrati. Gli indicatori, le barre, i punti e le categorie aprono i movimenti del proprio perimetro. Le tabelle dei grafici riportano gli importi esatti.

## Budget

Un limite si imposta sul totale del mese oppure su una categoria. La spesa effettiva somma le uscite registrate con «Budget» attivo, anche senza conto assegnato. Il residuo e lo sforamento si aggiornano con il registro. Si può impostare un limite di zero o rimuoverlo.

## Registro e scheda

In Movimenti la ricerca copre descrizione, categoria, conto, tag, note e importo. `1234,56` e `1.234,56` cercano lo stesso valore. Le schede Entrate e Uscite mostrano i totali dei risultati e filtrano il registro per tipo. «Analisi» apre i grafici e «Pianificati» mostra i movimenti futuri. Se la ricerca non trova righe nel periodo, «Cerca in tutti i periodi» lo amplia conservando il testo.

Tipo e categoria sono filtri essenziali; «Altri filtri» raccoglie stato, fonte e «Solo senza conto». Gli stati comprendono Registrati, Tutti gli stati attivi, In sospeso, Date future, Conto da attribuire, Modificati ed Eliminati · recuperabili. Le etichette dei filtri attivi sono rimovibili; «Togli i filtri» mantiene il periodo scelto.

Il registro raggruppa le righe per giorno e mostra il totale del gruppo. Le righe BudgetFlow mostrano la categoria, il conto, gli eventuali tag e il beneficiario. La scheda conserva la descrizione e l’origine del movimento. Accanto si leggono data e importo con segno. Aprire la riga mostra la scheda contestuale con dati correnti, correzione, storico richiudibile e fonte. Il pagamento di un negozio usa `update_consignment_payment` e lo storico del resoconto. Per annullare un incasso di vendita o registrare un reso Shopify, la scheda rimanda a Vendite. Gli altri percorsi di correzione e ripristino sono in [finance-revisions.md](finance-revisions.md).

## Conto vendita, fonti e categorie

Il pannello Conto vendita riunisce lo storico, i documenti collegati e i resoconti mensili dei negozi. Per ogni resoconto mostra negozio, mese, pezzi, incasso del negozio, da fatturare, fattura, incassato, residuo, stato e collegamento al dettaglio. Nei saldi entra il pagamento registrato. Il totale «Da incassare» somma i residui.

Documenti e fonti conserva importazioni Budget Flow, metadati e campi originali con «Dati originali»; «Apri i movimenti» seleziona l’importazione nel registro. Gli originali sono consultabili progressivamente. «Osservazioni commerciali e Shopify» conserva inoltre transazioni, valori fiscali osservati e fatti commerciali separati dai flussi revisionati. L’archivio privato resta in `/finance/documents` e i fatti commerciali continuano a essere consultabili in Vendite. «Chiudi Finance» rimane in cima alle pagine dell’area.

Il catalogo mostra le categorie più usate e i gruppi del catalogo suggerito:

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

La [specifica dell’interfaccia del 9 novembre](superpowers/specs/2026-11-09-finance-interfaccia.md) e il relativo [piano di implementazione](superpowers/plans/2026-11-09-finance-interfaccia.md) descrivono il flusso Finance precedente al ridisegno della Panoramica e di Movimenti.
