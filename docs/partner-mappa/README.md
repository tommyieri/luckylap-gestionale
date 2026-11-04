# Mappa funzionale Partner

Analisi del codice `origin/main` al commit `7a629ea`, 4 novembre 2026. Descrive il percorso dal database dei contatti alla prima email automatica e al seguito commerciale manuale, con aree, azioni, responsabilità, tempi e dati in ingresso/uscita.

## Aprire i risultati

- [Grafo interattivo](grafo.html): percorso principale, sei aree, 93 funzioni e 158 collegamenti orientati. Selezionando un nodo si vedono **chi, quando, come, ingresso, uscita e fonti**. «Aree e azioni» consente di cercare qualsiasi funzione; «Chi, quando, come» riassume i ruoli; «Dati e tracciabilità» descrive il contenuto delle schede e delle tabelle collegate.
- [Schermata HTML](schermata.html): ricostruzione autonoma di Partner e Programma email, con contatti sintetici, filtri, dettagli e revisione locale delle bozze. Assistente, Dati e Regole sono sintesi navigabili. Non è un export del DOM della produzione; i valori e i testi di esempio non rappresentano la coda reale. Le modifiche restano in memoria e si perdono ricaricando.
- [Dati del grafo](graph.json): formato orientato con `nodes`, `links`, comunità, fonti e campi operativi. `implemented: false` identifica il progetto futuro, distinto dal comportamento attivo.
- [Rapporto del grafo](GRAPH_REPORT.md): integrità, nodi centrali, collegamenti trasversali, comunità e limiti dell’estrazione.

I due HTML si aprono direttamente nel browser e non richiedono un server o librerie da scaricare. I riferimenti alle fonti su GitHub richiedono rete e accesso al repository. Il link dal grafo alla schermata funziona mantenendo i file nella stessa cartella. Questi documenti non vengono serviti dal gestionale e non cambiano l’interfaccia dell’applicazione.

## Percorso attuale

1. **Database completo.** `partners` conserva identità, segmentazione, ricerca, date e lavoro commerciale. `partner_contacts` conserva separatamente i recapiti. Registro, import, differenze e blocchi completano la scheda. La ricerca è consultabile nella scheda; gli aggiornamenti avvengono attraverso gli import.
2. **Team.** Tutti i cinque membri possono consultare e gestire il CRM: Vendita, Eventi, Collab e Club; viste Da seguire, Risposte, Tutti i contatti e Accordi fatti. Le viste calcolano fase, «A chi tocca» e «Per quando» dai dati salvati.
3. **Idoneità.** Una scheda completa non entra necessariamente nell’invio automatico: servono stato Da contattare, email attiva e utilizzabile, assenza di blocchi, responsabile e prossima azione non impostati e nessuna relazione già avviata che la escluda. Il database ricontrolla le condizioni durante il processo. Il recapito trovato sul web non sostituisce automaticamente l’email della scheda.
4. **Preparazione.** Per i Club senza sezione Eventi il codice compone il modello approvato v3, adattando nome, lingua e marca; Claude svolge la seconda lettura. Gli altri contatti, compresi i Club che sono anche Eventi, passano per ricerca con fonti, estrazione, scelta deterministica della proposta e del momento, scrittura, controlli e seconda lettura. Una data di attesa `write_on` indica la ripresa della preparazione.
5. **Programma email.** Mostra destinatario, motivo e testo, bozze da preparare o da rivedere e invii già registrati. La previsione viene calcolata su tutta la coda prima dei filtri, con passo stimato di otto minuti. Non prenota una partenza. Tommi può sospendere una singola bozza, modificarla e salvarne una nuova revisione approvata; firma e frase di uscita restano separate. Non può promettere l’annullamento di un SMTP già avviato.
6. **Prima dell’invio.** Il tick ogni due minuti tenta prima l’invio o le copie arretrate, poi un passo di preparazione soltanto se il passo d’invio è inattivo. Il database governa modalità, quote, fusi e calendario; il worker verifica bozza, regole, versione della scheda e del recapito, ricerca con meno di 21 giorni, date e sospensioni. IMAP cerca conversazioni con quell’indirizzo negli ultimi 365 giorni: se ne trova, passa a Tommi.
7. **Invio.** Prima Prova e conferma del founder; poi modalità Invio. Prime email reali lunedì–venerdì, 09:30–11:00 nel fuso del destinatario, con margine finale di 90 secondi, feste note e pausa 21 dicembre–7 gennaio. La copertura del calendario termina il 31 gennaio 2027: oltre quella data le finestre restano chiuse finché aggiornate. Cinque prime email al giorno per i primi sette giorni dal primo invio reale, poi limite configurato, predefinito dieci; capacità ripartita tra Club modello e altri. Intervallo reale casuale di 4–11 minuti. Dal 4 novembre i Club modello possono allegare il PDF verificato appropriato; gli altri contatti restano senza allegato.
8. **Esito.** Il messaggio definitivo viene salvato e verificato prima di una singola chiamata SMTP. Se accettato, il lavoro diventa `inviata`, la scheda «Scritto», il registro riceve l’attività dell’assistente e nasce un promemoria a sette giorni assegnato a `handoff_to`, normalmente Tommi. La copia IMAP in Posta inviata è separata: recuperare una copia mancante non rispedisce l’email. Accettazione SMTP non certifica la consegna nella inbox. Un esito incerto richiede una verifica umana, senza nuovo tentativo automatico.
9. **Seguito manuale.** Tommi legge la risposta nella casella e scrive/invia solleciti e ulteriori email. Il team registra risposte e attività e aggiorna prossime azioni ed esiti. «Segna inviato» e «Segna sollecito inviato» registrano un messaggio già spedito: non inviano posta. Registrare una risposta chiude il promemoria collegato; cambiare soltanto lo stato in «Risposto» non lo chiude. Gli accordi alimentano i collegamenti al Team e le date nel calendario, con protezione delle modifiche manuali e delle vendite collegate.

**“Ultima mail”**: oggi non esiste una sequenza automatica completa di solleciti, risposte e chiusura della trattativa. La prima email è il termine del percorso automatico corrente; le successive dipendono dall’azione umana e dalle risposte ricevute. La mappa le include nel seguito manuale, senza inventare date o un numero massimo di messaggi.

## Fonti e limiti

Fonti funzionali: [Partner](../partner.md), [Assistente](../partner-assistente.md), [Programma email](../partner-programma-email.md). I nodi rimandano anche a componenti, funzioni e migrazioni precise del repository. La verifica incrociata dà precedenza al codice e alle sezioni più recenti rispetto ai paragrafi storici: per esempio gli allegati Club dal 4 novembre e l’ordine effettivo dei blocchi della scheda.

La pagina Regole per scrivere mostra il contesto importato; la configurazione e le regole versionate dell’assistente sono dati distinti. Le vecchie varianti «Messaggi pronti» rimangono nel database, ma non costituiscono le bozze dell’assistente e il loro blocco non compare nella scheda.

Non sono stati letti contatti, credenziali o messaggi reali. L’analisi non verifica lo stato delle migrazioni applicate o delle impostazioni attive in produzione. La ricostruzione usa solo dati sintetici e non esegue comandi operativi.

La lacuna documentata nel conteggio delle differenze sui vecchi messaggi in Dati Partner non viene corretta da questa consegna. Risposte importate dalla casella, smistamento e solleciti automatici restano progetto futuro.

## Verifica dei risultati

Integrità del grafo: 93 identificatori univoci, estremi presenti per tutti i 158 archi, direzioni conservate, nessun autoanello. Tutti i nodi hanno chi, quando, come, ingresso, uscita e fonti. Estrazione documentale con graphify e controllo incrociato nei sorgenti; nessuna estrazione AST dell’intero repository.

Controlli eseguiti: integrità del grafo, fonti presenti nel repository e sintassi degli script incorporati; apertura senza server dei due HTML; navigazione delle sei aree e ricerca delle funzioni; filtri, dettagli, salvataggio e annullamento della revisione locale di una bozza; blocco della chiusura con testo non salvato; dialogo su telefono. Nessuna richiesta di rete durante l’uso e nessun errore in console. Larghezze verificate: 320, 760 e 1440 pixel, senza fuoriuscite orizzontali della pagina; il grafo dettagliato mantiene lo scorrimento interno e lo zoom. Formattazione con `npm run format` e `npm run format:check`. Non viene aperta una pull request e non viene modificato codice applicativo; build e suite applicative/database non sono richieste per questi file documentali.
