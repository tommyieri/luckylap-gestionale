# Finance LuckyLap: proposta di interfaccia

9 novembre 2026 — specifica approvata da Tommi con «ok costruisci», implementazione sul branch `codex/finance-interfaccia`.

## Obiettivo

Finance deve rispondere subito a «qual è il saldo registrato, quanto è entrato e quanto abbiamo speso?». Inserire, trovare e correggere un movimento devono essere percorsi brevi, riconoscibili e utilizzabili anche dal telefono.

La prima schermata sarà **Panoramica**, come indicato da Tommi. Il conto Revolut e le integrazioni bancarie restano quelli attuali. Il piano riguarda l'interfaccia e le proiezioni necessarie a leggerne i dati, non l'attivazione dell'Open Banking.

Il contesto è un piccolo brand di abbigliamento, organizzato come ditta individuale, con produzione, Shopify, eventi, collaborazioni e conto vendita. Una buona Finance deve aiutare a controllare i flussi registrati e capire le spese. Non deve trasformarsi in un programma di contabilità fiscale o duplicare Vendite e Magazzino.

## Ricerca e diagnosi

Audit del codice aggiornato di `origin/main`, commit `dc03a6d99f584ebb8f0ffb9d72da7082030c85f5`. Il checkout corrente contiene lavoro Partner di un'altra chat e non è stato modificato. Ricerca esterna su siti, manuali, schermate e changelog ufficiali. Il browser locale è disattivato: le applicazioni concorrenti non sono state provate interattivamente.

| Problema attuale | Conseguenza | Decisione proposta |
| --- | --- | --- |
| «Nuova voce» apre un'altra lunga pagina di registrazioni. | L'azione più comune richiede orientarsi fra informazioni estranee. | Un pulsante «Nuovo movimento» apre direttamente il modulo. |
| Ricerca e registro vengono dopo conti, grafico, categorie, avvisi e conto vendita. | Trovare una voce richiede molto scorrimento. | Una destinazione Movimenti con ricerca subito in alto. |
| Periodo e altri filtri possono nascondere una voce; la ricerca è locale. | Una voce presente può sembrare mancante. | Perimetro visibile, «Tutti i periodi», filtri nell'indirizzo e ritorno conservato. |
| Dettaglio e modifica sono ingressi distinti; lo storico domina l'editor. | Non è chiaro dove modificare, né come tornare alla ricerca. | Una scheda coerente per leggere e correggere; storico secondario. |
| Il grafico principale è un saldo cumulato per conto. | Risponde poco a «quanto spendiamo e dove?». | Flussi del periodo e spese per categoria, collegati ai movimenti. |

Riferimenti dell'audit: `src/components/finance-imports-view.tsx`, `finance-work-view.tsx`, `finance-work-form.tsx`, `finance-revision-editor.tsx`, `finance-account-chart.tsx`; `src/lib/finance/dashboard.ts`, `categories.ts`; `docs/finance-dashboard.md`, `finance-revisions.md`, `finance-work.md`.

### Cosa prendere dalle altre app

| Riferimento | Funzionalità documentata | Applicazione a LuckyLap |
| --- | --- | --- |
| [Budget Flow](https://budget-flow.app/) | Periodo condiviso, conti e gruppi di categorie, dashboard, ricerca e filtri. | Gerarchia semplice e contesto temporale chiaro; evitare tutte le funzioni di budgeting personale. |
| [Lunch Money: azioni sui movimenti](https://support.lunchmoney.app/finances/transactions/transaction-actions) | Inserimento vicino al registro, modifica della riga o nel pannello laterale. | Inserimento immediato e modifica contestuale; mantenere le conferme e le revisioni LuckyLap. |
| [Lunch Money: ricerca e filtri](https://support.lunchmoney.app/finances/transactions/other-features) | Ricerca unificata, filtri, storico. | Una ricerca e filtri progressivi; niente secondo registro operativo separato. |
| [Actual: report](https://actualbudget.org/docs/reports/) e [rilasci](https://actualbudget.org/docs/releases/) | Analisi e apertura dei movimenti dai grafici, anche per intervallo nelle versioni recenti. | Ogni numero e grafico deve permettere di controllare quali movimenti lo compongono. |
| [Categorie e tag Lunch Money](https://support.lunchmoney.app/setup/categories/faq) | Natura della spesa distinta dai tag. | Non usare una categoria diversa per ogni evento, collezione, cliente o SKU. |

Riferimenti visivi: [Budget Flow, schermata 1](https://budget-flow.app/wp-content/uploads/2025/11/hero-phone-1.png), [schermata 2](https://budget-flow.app/wp-content/uploads/2025/11/hero-phone-2.png), [scheda italiana App Store](https://apps.apple.com/it/app/budget-flow-traccia-spese/id1640091876); [Actual, report personalizzati con schermate](https://actualbudget.org/docs/reports/custom-reports/). Si prendono i principi di interazione, senza copiare layout, icone o contenuti proprietari.

### Quali domande contano per un brand come LuckyLap

| Domanda | Utilità | In questa consegna |
| --- | --- | --- |
| Quanto denaro risulta registrato e come cambiano entrate e uscite? | Controllare il periodo senza leggere un lungo registro. | Sì, con perimetro e completezza dichiarati. |
| Quanto assorbono produzione, marketing, spedizioni e commissioni? | Individuare le aree di spesa che incidono sul flusso registrato. | Sì, categorie e dettaglio dei movimenti. |
| Quanto devono ancora pagare i negozi? | Separare il credito dal denaro già ricevuto. | Sì, dati dei resoconti esistenti. |
| Quanto rende un capo o una collezione? | Valutare prodotto e prezzi. | Successivamente: servono vendite, resi e costi riferiti ai prodotti venduti. |
| Quanto denaro è impegnato nelle scorte? | Collegare acquisti e disponibilità senza scambiare inventario per liquidità. | Successivamente, collegando le fonti di Magazzino; non da un grafico delle uscite. |

Il criterio è coerente anche con la documentazione [Shopify sui report Finance](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/finances-report), che distingue vendite, pagamenti e accrediti, e con i [report di profitto](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/profit-reports), che richiedono costi disponibili al momento della vendita. Non si usa la semplice differenza entrate/uscite come margine del brand.

## 1. Tre destinazioni, un'azione principale

| Destinazione | A cosa serve | Cosa mostra subito |
| --- | --- | --- |
| **Panoramica** — apertura predefinita | Capire saldo registrato, entrate e spese. | Periodo e conti, tre valori principali, due grafici. |
| **Movimenti** | Cercare, inserire e correggere. | Ricerca, filtri essenziali e lista unica. |
| **Da incassare** | Controllare il denaro ancora dovuto dai negozi. | Resoconti, residuo e accesso al relativo pagamento. |

«Nuovo movimento» è sempre disponibile nelle tre destinazioni, senza passare per la vecchia pagina di lavoro. «Chiudi Finance» rimane raggiungibile. Fonti, importazioni e documenti stanno in un ingresso secondario «Documenti e fonti»; i dettagli tecnici sono nella scheda del movimento.

La voce Da incassare è circoscritta ai dati realmente presenti del conto vendita: non promette una scadenziaria generale di clienti, fornitori e imposte.

## 2. Panoramica: poche risposte affidabili

In alto: titolo Finance, azione Nuovo movimento, periodo riconoscibile e selezione dei conti. Scelte rapide: Questo mese, Mese scorso, Quest'anno, Intervallo. Il contesto resta leggibile passando ai movimenti.

I tre valori principali sono:

1. **Saldo dai movimenti**, con la data: per un mese passato è alla fine del mese, per quello corrente fino a oggi. È cumulato dalle registrazioni disponibili, non ricomincia da zero a gennaio.
2. **Entrate registrate** nel periodo e nei conti selezionati.
3. **Uscite registrate** nello stesso periodo e negli stessi conti.

Accanto ai flussi si può leggere la differenza «Entrate − uscite», senza chiamarla utile o margine. La dicitura breve del saldo spiega che è calcolato dalle registrazioni e non verificato con la banca. Non si inventano un saldo iniziale o una disponibilità bancaria ufficiale.

Le registrazioni senza conto sono evidenziate separatamente con conteggio e accesso «Da attribuire»: non vengono assegnate automaticamente a Revolut e non spariscono dietro un totale apparentemente completo. Le entrate e uscite della panoramica per conto escludono queste righe, esattamente come il relativo grafico. Il registro completo continua a renderle consultabili.

Confronti col periodo precedente soltanto con basi omogenee. Il mese in corso è dichiarato parziale; niente percentuali su dati mancanti, denominatore zero o confronti fra nove giorni e un mese intero.

## 3. Grafici: capire e verificare

| Grafico | Domanda | Forma e interazione |
| --- | --- | --- |
| **Entrate e uscite nel tempo** | Quanto entra ed esce, e come cambia? | Barre affiancate per intervalli del periodo selezionato: settimane nel mese, mesi nell'anno. Granularità dichiarata, legenda e valori esatti. Selezionare una barra apre i movimenti corrispondenti. |
| **Dove spendiamo** | Quali categorie assorbono denaro? | Barre orizzontali ordinate: prime cinque categorie e Altre. Selezionare apre la lista filtrata; Altre è espandibile. |
| **Andamento del saldo** — vista secondaria | Come si è mosso il saldo registrato? | Linea cumulata selezionabile al posto del grafico flussi; conto e periodo espliciti. |

La somma del grafico delle uscite coincide con il relativo indicatore: aggrega i movimenti negativi del periodo esclusi i trasferimenti, non il saldo netto fra entrate e uscite della stessa categoria. I rimborsi restano leggibili come uscite di denaro collegate alle vendite, senza essere ribattezzati costi di produzione.

Consuntivi, voci future e voci in sospeso non sono mescolati. L'eventuale previsione rimane una vista esplicita, con tratto diverso, e usa solo movimenti futuri già registrati. Nessuna stima di vendite, imposte o rifornimenti inventata.

Ogni grafico ha etichette italiane, valori raggiungibili da tastiera e tocco, tabella dei numeri esatti e accesso ai movimenti. Niente grafici a torta con tredici spicchi, 3D, animazioni decorative o percentuali senza base. Il colore accompagna segni, testo e legenda; non li sostituisce.

## 4. Nuovo movimento: modulo breve

Un'azione apre un pannello dedicato sul computer e una schermata ampia sul telefono. Il collegamento diretto deve funzionare anche dopo un ricaricamento. Non si impila un secondo dialog sopra il dettaglio già aperto.

Campi subito visibili: **Uscita / Entrata**, **Importo**, **Data**, **Descrizione**, **Conto**, **Categoria**. Data iniziale oggi; le nuove voci manuali non accettano date future, come nel comando e nel database esistenti. I movimenti importati o corretti con data futura restano consultabili separatamente. Formato italiano, virgola decimale, valuta EUR. L'importo non richiede di digitare un segno: lo determina la scelta Entrata/Uscita. Conto e categoria mantengono il contratto facoltativo attuale; «Da attribuire» e «Da classificare» sono scelte esplicite, non valori silenziosi.

Il testo della descrizione aiuta a scrivere «a chi / per cosa». Il menu delle categorie propone prima quelle pertinenti, ma permette sempre le altre e una categoria personalizzata. I dettagli secondari vengono mostrati solo se disponibili nel contratto esistente: questa tappa non crea campi fittizi per allegati, fatture o fornitori.

Azioni: «Registra uscita» o «Registra entrata»; opzione distinta «Registra e aggiungi un'altra». Il nuovo tentativo si può creare solo quando il precedente ha un esito certo. Dopo il salvataggio si vede la voce e si può aprirla. Errori vicini al campo e dati compilati conservati.

Rimane una verifica anti-duplicato breve e comprensibile. Gli incassi del negozio conducono al resoconto invece di creare una seconda entrata manuale. Non si aggiungono trasferimenti manuali, ricorrenze o scansione ricevute senza un contratto specifico successivo.

## 5. Trovare e modificare

Il registro ha una ricerca subito visibile e una riga compatta per movimento: data, descrizione in evidenza, categoria/conto secondari, importo allineato. Da telefono descrizione e importo stanno nella prima riga; niente riduzione della tabella desktop a testo minuscolo.

Ricerca per descrizione, categoria, conto e importo con formati italiani normalizzati. Riferimenti ordine/negozio si cercano soltanto quando realmente disponibili al lettore; in alternativa è presente il collegamento alla fonte. La descrizione resta un testo, non viene interpretata come anagrafica fornitore.

Filtri frequenti: periodo, conto, Entrate/Uscite, categoria. «Altri filtri»: fonte, in sospeso, future, da attribuire, modificati, eliminati. I filtri attivi appaiono come etichette rimovibili; numero dei risultati, perimetro e totale sono espliciti. Il totale delle uscite e quello delle entrate restano distinti quando il risultato contiene entrambe.

Una ricerca senza risultati mostra il periodo applicato e offre «Cerca in tutti i periodi», conservando il testo. Non allarga la ricerca di nascosto. Filtri e selezione sono condivisibili; tornando dalla modifica si mantengono ricerca, periodo, posizione e riga. La navigazione precedente/successiva del browser funziona.

Una sola apertura della riga porta alla scheda del movimento, con modifica riconoscibile. Lo storico è richiudibile e descrive prima cosa è cambiato, poi permette di leggere la versione completa. Importo, data, descrizione, conto e categoria si correggono con i comandi e lo storico esistenti. L'editor del pagamento del negozio continua a usare il suo contratto specifico. Incassi delle vendite e rimborsi mantengono i limiti di eliminazione previsti; il rimando a Vendite è chiaro. Eliminati recuperabili e ripristino restano disponibili.

## 6. Categorie utili al brand

La categoria descrive **la natura del movimento**; conto, fonte e canale non diventano categorie. Un progetto o una collezione non genera una nuova categoria di spesa.

| Area | Categorie di riferimento | Esempi di voci da riconoscere, non nuovi obblighi |
| --- | --- | --- |
| Entrate commerciali | Vendite, Collab | Incassi web, eventi e negozi; collaborazioni pagate. Il canale resta distinto dalla categoria. |
| Prodotto | Produzione, Attrezzatura | Capi, ricami, campioni; strumenti e attrezzature. Un acquisto di scorte non equivale al costo dei prodotti venduti. |
| Operatività | Spedizioni, Software | Corrieri, abbonamenti del negozio e strumenti di lavoro. |
| Crescita | Marketing, Eventi, Trasferte | Campagne, foto, creator, partecipazioni a eventi e viaggi. |
| Persone e adempimenti | Stipendi, Tasse & Contributi | Valori storici conservati; niente rinomina automatica di Stipendi in compensi professionali. |
| Altre registrazioni | Fund Raising, Others e categorie personalizzate | Restano consultabili con i significati e i dati originali. |

Tre aggiunte approvate al catalogo dei suggerimenti: **Packaging**, **Commissioni**, **Servizi e consulenze**. Servono a distinguere scatole/materiali, spese bancarie o di pagamento e servizi professionali. Il catalogo attuale è già estensibile; non occorre riclassificare le vecchie righe per renderle selezionabili nelle nuove.

Etichette dei gruppi in italiano. La vecchia divisione fisso/variabile non occupa tredici riquadri prima del registro: categorie ordinate e ricercabili, dettaglio solo quando serve. Nessuna migrazione automatica di categorie o creazione retroattiva di costi.

Per la ditta individuale, **apporti/prelievi del titolare, prestiti e trasferimenti interni** richiedono un significato esplicito. Non si deducono da Fund Raising, dal beneficiario o dal segno dell'importo e non si presentano come ricavi/costi per abbellire un grafico. Un eventuale nuovo tipo di movimento è una tappa separata.

Tag per evento, collaborazione e collezione: utili da valutare dopo il nuovo registro, ma non necessari alla prima consegna e non supportati universalmente dai dati attuali. Nessun filtro tag fittizio.

## 7. Direzione visiva e skill

La direzione è una superficie operativa LuckyLap: carta bianca, verde racing, Barlow, numeri tabulari e controlli familiari. Più spazio e gerarchia fra le informazioni, meno pannelli contemporanei. Nessun restyling generico da banca digitale.

Useremo [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) fissata al commit `4f2dbb67e64969a9a30ab00742f2d55d66ddec2b` del 7 novembre 2026, licenza MIT. Sono stati letti [SKILL.md](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/4f2dbb67e64969a9a30ab00742f2d55d66ddec2b/.claude/skills/ui-ux-pro-max/SKILL.md), regole, catalogo grafici e indicazioni Next.js. Nessuna installazione o esecuzione di script remoti in questa ricerca. La revisione indipendente del documento non ha rilevato domande sostanziali bloccanti per pianificare la costruzione.

Uso previsto: ricerche mirate su moduli, filtri, navigazione, grafici finanziari e stack Next.js; confronto delle raccomandazioni con PRODUCT.md e DESIGN.md. Palette, font e librerie non vengono sostituiti automaticamente. Le guide della versione Next.js installata prevalgono sul catalogo generico della skill. La prima ipotesi è riutilizzare SVG e componenti già presenti, senza aggiungere una libreria di grafici solo per il restyling.

Revisione complementare con [Vercel Web Design Guidelines](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/web-design-guidelines/SKILL.md) e relative [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/434b7f91364665f2f733b310ec54809bf8f37937/command.md): etichette, focus, tastiera, ritorno alla lista, filtri nell'URL, tabelle e numeri. L'identità e le regole LuckyLap rimangono autorevoli.

## 8. Ordine di costruzione dopo l'approvazione

| Tappa | Risultato verificabile |
| --- | --- |
| **1. Disegno con Pro Max** | Composizione desktop/telefono di Panoramica, Movimenti e scheda; modulo breve; campioni sintetici di stati vuoti, errore e dati lunghi. Conferma prima dell'implementazione del flusso. |
| **2. Aggiungere, trovare, correggere** | Azione diretta, registro unico, ricerca e filtri coerenti, nuova voce, scheda con modifica/storico e ritorno conservato. È la base operativa dei grafici. |
| **3. Panoramica e grafici** | Apertura predefinita Panoramica, tre indicatori, due grafici, vista saldo secondaria e apertura delle righe che spiegano ogni valore. |
| **4. Rifinitura della sezione** | Da incassare e documenti/fonti ordinati, categorie approvate, testi brevi, responsive e accessibilità. |
| **5. Verifica e PR** | Test su flussi e calcoli, browser desktop/telefono e controlli del repository. Merge e produzione con gli OK previsti. |

La prima consegna completa comprende le tappe 2–4, anche se organizzate in commit o PR più piccole: non si presenta come finito un semplice restyling delle carte lasciando difficili inserimento e modifica.

Prima di scrivere nel repository: nuovo fetch, controllo degli altri branch e lavoro isolato da origin/main. Oggi il checkout ha modifiche Partner in corso, comprese guida e indice: eventuali interventi su file condivisi seguono AGENTS.md; l'indice ha la sua eccezione esplicita. Questo piano non autorizza a sovrascriverli.

## 9. Criteri di accettazione

- Dopo aver aperto Finance, periodo, conti e tre valori principali sono immediatamente leggibili, con il significato del saldo chiaro.
- «Nuovo movimento» apre il modulo in un'azione, senza attraversare registri commerciali.
- Cercare un movimento di un altro anno non porta a una falsa assenza: periodo visibile e ricerca su tutti i periodi in un'azione.
- Importi come `1234,56` e `1.234,56` trovano lo stesso valore; i campi coperti dalla ricerca sono dichiarati.
- Modifica, salvataggio e ritorno mantengono query, filtri e posizione; un link diretto apre la stessa voce dopo un ricaricamento.
- La barra o categoria selezionata apre esattamente i movimenti che compongono il valore mostrato.
- Righe, indicatori e grafici usano la stessa proiezione revisionata; conti, date e stato sono espliciti. Totali delle barre e indicatori coincidono al centesimo.
- Pending, futuri, trasferimenti, eliminati, rimborsi, incassi dei negozi e righe senza conto sono coperti da casi sintetici; zero, assenza di righe e errore non sono confusi.
- I nuovi percorsi non introducono una seconda entrata per un pagamento già registrato: i comandi di ordine e negozio rimangono quelli della fonte, e l'inserimento manuale conserva la verifica anti-duplicato. Nessuna nuova deduzione di conto o riclassificazione storica nascosta. Le sovrapposizioni preesistenti fra fonti non vengono risolte automaticamente: questa riconciliazione rimane un progetto distinto.
- Un errore di lettura non fa apparire totali Finance parziali. Password Finance, membership, sessione e chiusura dell'area restano efficaci.
- Un invio dall'esito incerto recupera lo stesso tentativo senza duplicarlo; conflitti di versione, recupero e modifiche non salvate sono gestiti.
- A 320 e 390 pixel inserimento, ricerca e modifica non richiedono di far scorrere lateralmente tutta la pagina; campi a 16 px, bersagli da 44 px, tastiera e focus accessibili.
- Prima della PR: typecheck, test, build, test:db e format:check; format prima di ogni commit. Se gli harness PostgreSQL 17 sono saltati localmente, esito dichiarato e relativo job CI verificato.

## Fuori dalla prima consegna

Cambio banca, API e Open Banking; nuovi pagamenti; calcolo fiscale o IVA dovuta; utile, margine per capo e valutazione delle scorte; OCR; ricorrenze automatiche; budget vincolanti; nuove anagrafiche fornitore; movimenti del titolare o riconciliazione automatica fra fonti. Sono sviluppi possibili da progettare sui dati necessari, non promesse implicite nel restyling.

## Decisioni già fissate e proposte da approvare

**Fissate da Tommi:** banca invariata; priorità saldo/entrate/spese; piano prima della costruzione; uso di UI/UX Pro Max.

**Proposte del piano:** tre destinazioni con Panoramica iniziale; azione Nuovo movimento diretta; scheda contestuale; due grafici principali con dettaglio dei movimenti; tre nuove categorie suggerite; costruzione delle tappe sopra. L'approvazione del piano conferma queste scelte; le regole di dati, permessi e produzione restano quelle del progetto.


## Decisioni durante la costruzione

UI/UX Pro Max è stata eseguita da una copia temporanea fissata allo SHA indicato, con Python standard e senza nuove dipendenze. Le ricerche su moduli e validazione hanno confermato errori inline e feedback di invio. I suggerimenti grafici fuori contesto (Sankey, candlestick, radar) sono stati scartati: barre dei flussi, categorie e saldo rimangono quelli approvati.

Tommi ha autorizzato esplicitamente le sole modifiche Finance nella guida condivisa con Partner. Le altre parti della guida sono conservate identiche alla base. L’anteprima locale usa esclusivamente dati sintetici. Il browser locale è disabilitato nelle impostazioni: la verifica visiva interattiva non viene dichiarata come eseguita.

Gli intervalli si applicano dopo aver compilato entrambe le date. Il testo di ricerca conserva gli spazi durante la digitazione; la normalizzazione riguarda il confronto. I range di molti anni sono raggruppati in non più di 120 intervalli, con date esatte e flussi conservati. Gli eliminati legacy e i tentativi incerti rimangono consultabili anche con il modulo chiuso.
