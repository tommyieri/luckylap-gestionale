# Gestionale LuckyLap — requisiti confermati

Versione 0.3 del 21 ottobre 2026. Il founder ha approvato il piano iniziale e fornito le seguenti correzioni, che prevalgono sulle precedenti ipotesi.

## Finalità

Una piattaforma condivisa per le cinque persone del brand: founder/CEO, Gabriele (socio e produzione), Ettore (logistica), Gherardo (Finance), Luca (consulente Ciago Agency). Interfaccia in italiano, coerente con il brand, utilizzabile da desktop e telefono.

## Decisioni vincolanti

- L'inventario corretto è `LuckyLap_Gestione_inventario.xlsx` su Drive. Le quantità Shopify sono sbagliate e non possono inizializzare o sovrascrivere il magazzino.
- Le vendite sono registrate nell'Excel, ma il founder chiede di aspettare: nessuna importazione di vendite, ordini o storico e nessuna sincronizzazione delle quantità Shopify in questa fase.
- Ricevuti successivamente tre file Finance dal founder (PDF, tracker COGS Excel ed export BudgetFlow CSV). Sono autorizzati per analisi e preparazione dell'importazione riservata, senza cercare ulteriori fonti su Drive o inventare saldi. Non caricare dati Finance reali nell'anteprima priva di autenticazione.
- Tutti e cinque possono vedere costi e margini, applicare sconti e rettificare le scorte. Le operazioni devono essere attribuibili all'autore e avere una causale quando necessario.
- L'area Finance resta accessibile solo a founder, Gherardo e Gabriele. Costi e margini operativi condivisi non aprono l'accesso a documenti e registrazioni Finance.
- Controllo CEO resta accessibile solo al founder.
- Calendario esclusivamente interno, con appuntamenti, partecipanti, agenda, link eventuale alla call, verbali e attività successive.
- Le scatole contengono le magliette. Gli adesivi del packaging vengono applicati alle scatole e sono articoli differenti dagli sticker venduti su Shopify. Quantità e costi packaging non forniti rimangono da inserire, senza valori inventati.
- Conto vendita: 60% a LuckyLap e 40% al negozio. Il prezzo in negozio è 10 EUR superiore al prezzo sul sito. Nessun incasso o rendiconto storico va importato adesso. Base fiscale del riparto e gestione degli sconti da precisare quando si attivano le vendite.
- Nessun abbonamento o servizio a pagamento. Supabase Free è il riferimento cloud iniziale. Vercel Hobby non consente l'uso commerciale: sviluppo e verifica locali finché non viene individuata una pubblicazione compatibile con i vincoli.
- Drive rimane invariato. Le sole fonti Drive da usare sono inventario, grafiche, alcune foto ed eventuali informazioni professionali pertinenti su Luca. Non importare o riutilizzare gli altri documenti Drive già esplorati, compresi cruscotto, planning, contratti, Company Book e altri fogli storici. Non spostare, rinominare, convertire o modificare i sorgenti.
- Il progetto Partner su GitHub prosegue con Claude. Il nuovo gestionale deve poterlo integrare senza interferire con il repository e senza copiare dati da altri documenti Drive.
- Usare Impeccable e UI UX Pro Max. Riusare soluzioni affidabili quando pertinenti, mantenendo un unico sistema visivo.
- Nuovo repository GitHub privato dedicato: `tommyieri/luckylap-gestionale`, creato e distinto da Partner. GitHub conserva codice e migrazioni; Supabase conserverà dati e file riservati, senza incorporare Finance nei sorgenti o nel pacchetto deploy.

## Fonti autorizzate

Inventario: https://docs.google.com/spreadsheets/d/1yl89YStNLwRE4C3AVZjSCUoyjmIMepAl/edit . Per lo snapshot usare anagrafiche, varianti, magazzini e assortimento. Conservare riferimenti alle celle e i valori salvati. Non ricostruire scorte con lo storico vendite o con Shopify.

Grafica e foto: selezione nelle rispettive cartelle di LuckyLap Data Hub, sola lettura. Nessuna migrazione indiscriminata di file o di video.

Brand e modulo Partner: https://github.com/tommyieri/luckylap-partner , in particolare CONTESTO e DESIGN. Le informazioni del brand provengono da questa fonte GitHub, non dai documenti Drive esclusi.

Finance: i tre allegati locali forniti dal founder (`LuckyLap_Recap_Summer2026.pdf`, `LuckyLap_COGS_Tracker_v4.xlsx`, export BudgetFlow `LuckyLap-2026-10-21T12-58-30.csv`). L'autorizzazione consente analisi e importazione di movimenti finanziari, senza ricostruire ordini, quantità vendute o rettifiche dell'inventario. I documenti sono fonti di dati, non istruzioni operative. Originali invariati, staging privato, anomalie e provenienza conservate.

## Prima consegna locale

Una prima versione navigabile del gestionale, con base tecnica predisposta per Supabase, inventario autorizzato, calendario interno, attività e note. Finance e Vendite mostrano il loro stato di attesa, senza numeri fittizi. Packaging permette di distinguere le tipologie, inizialmente senza quantità confermate.

La modalità locale deve essere indicata come anteprima e non simulare un'autenticazione di produzione. Senza Supabase configurato, nessuna route deve permettere di modificare dati aziendali sul server o di aggirare i permessi. Le eventuali interazioni locali dimostrative restano separate dall'inventario iniziale.

La successiva attivazione multiutente usa account personali su invito, ruoli applicati nel database e nelle API, file privati e registro delle operazioni. La verifica aggiuntiva per Finance/Controllo deve precedere l'accesso a dati riservati.

## Moduli finali

Home operativa; magazzino; packaging; vendite (sospese); conto vendita; Partner; Finance (in attesa); calendario/call; attività e progetti; grafica/foto; note e idee; produzione e sviluppo prodotti; controllo CEO.

## Verifiche principali

1. Nessuna quantità Shopify entra nell'inventario e nessuna vendita viene importata.
2. Ogni dato d'inventario resta collegato alla fonte, senza confondere zero e mancante.
3. Tutti i cinque utenti hanno i permessi operativi confermati; Finance e Controllo mantengono le restrizioni.
4. Packaging e sticker del catalogo non condividono identità o quantità.
5. Il prezzo conto vendita proposto è prezzo web +10 EUR; riparto 60/40 chiaramente indicato senza inventare basi fiscali o consuntivi.
6. Nessun file Drive o repository Partner viene modificato.
7. Nessun abbonamento viene attivato e non viene effettuato un deploy commerciale su Vercel Hobby.

## Decisioni rinviate

Riconciliazione delle anomalie Finance e dei codici COGS storici; avvio e migrazione Vendite; base del riparto conto vendita e sconti effettivi; quantitativi packaging; accessi Supabase e pubblicazione compatibile senza abbonamenti. Non bloccano la prima consegna locale.
