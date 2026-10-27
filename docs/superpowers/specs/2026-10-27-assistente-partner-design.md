# Assistente Partner: specifica

Tommaso vuole che i contatti del modulo Partner vengano lavorati da un assistente basato su Claude, che vive nel gestionale. L'assistente studia ogni contatto, scrive e invia la prima email, gestisce le risposte e i solleciti, tiene aggiornato il gestionale e passa a Tommaso le trattative concrete. Tommaso supervisiona e chiude gli accordi. Questa specifica raccoglie le decisioni prese con lui tra il 26 e il 27 ottobre 2026; i testi delle email sono in attesa del parere di Luca, il consulente, e le regole di scrittura restano modificabili senza ricostruire nulla.

Stato: da approvare. Base: `origin/main` a `3c58693`. Nell'interfaccia il founder è «Tommi»; le email sono firmate «Tommaso».

## Intento

Oggi nel modulo Partner ci sono circa 200 contatti tra club, eventi, negozi, brand e media, tutti ancora «Da contattare». Scrivere a ognuno a mano, con una ricerca fresca e un testo nella sua lingua, non sta nel tempo del team. Il contatto diretto funziona (Porsche Club Toscana, 150 magliette) e gli eventi sono il canale migliore, perché andiamo di persona e la gente tocca le magliette.

L'obiettivo di questa fase è il tasso di risposta: farci rispondere e aprire una conversazione, non vendere nella prima email. Il successo è una casella che riceve risposte vere, un gestionale che racconta cosa è successo con ogni contatto senza che nessuno lo debba ricostruire, e Tommaso che entra solo quando c'è da decidere o da chiudere.

## Obiettivi

- Per ogni contatto con email: ricerca fresca, scelta della richiesta, prima email personalizzata nella lingua del destinatario, inviata da sola.
- Risposte lette e gestite in modo naturale, senza insistere, finché la conversazione diventa concreta; allora passa a Tommaso.
- Al massimo due solleciti, nella stessa conversazione, poi stop.
- Tutto registrato nel gestionale: ricerca, richiesta e motivo, email inviate e ricevute, stato, prossimo passo.
- Un riepilogo serale a Tommaso e una lista «Per te» con quello che aspetta lui.
- Il credito Anthropic usato bene prima che scada il 5 novembre, con la spesa registrata e visibile.

## Non obiettivi

- Contatti senza email: moduli web, Instagram, telefono. L'assistente non li tocca in questa fase.
- La ricerca mondiale sui Porsche Club: è un lavoro separato, che passerà dall'import esistente.
- Chiudere accordi, dare prezzi, condizioni, quantità o date di consegna, promettere magliette in regalo: lo fa Tommaso.
- Dogana, IVA, contratti: si affrontano dopo un OK del contatto.

## Anti-obiettivi

Sarebbe un fallimento anche se tecnicamente funzionasse:

- email che finiscono in spam, o che fanno finire in spam la casella aziendale;
- un'email che parla di conto vendita, in qualunque lingua;
- un'email con un fatto inventato, un nome sbagliato o un segnaposto rimasto (`[first name]`);
- due email uguali allo stesso contatto, o un'email a chi è in «Non contattare» o ha detto no;
- tono da venditore, insistenza, più di due solleciti;
- una trattativa concreta che resta all'assistente invece di arrivare a Tommaso;
- un credito che finisce senza che nessuno se ne accorga, o che scade senza essere usato;
- azioni dell'assistente che nel gestionale sembrano fatte da una persona.

## Come lavora l'assistente, contatto per contatto

### 1. Ricerca

Prima di ogni prima email l'assistente cerca sul web il contatto: sito, social, notizie recenti, prossimo evento con le date, persona giusta a cui scrivere e il suo nome, indirizzo email ancora valido. Parte dalla scheda del gestionale ma non si fida delle date e dei nomi già scritti: nei nove esempi studiati il 26 ottobre quasi ogni scheda era superata. Salva nel gestionale cosa ha trovato, con le fonti, e un fatto vero e recente da citare nel complimento iniziale. Se non trova un fatto vero da citare, l'email non parte e il contatto passa a Tommaso con il motivo.

### 2. Scelta della richiesta

Una sola richiesta per email, in base al tipo di contatto (decisione del 27 ottobre):

| Contatto | Richiesta |
|---|---|
| Club, brand, media | Parlare insieme di un progetto futuro, senza dire quale |
| Evento raggiungibile | Esserci con un piccolo banco |
| Negozio | Se venderebbero le nostre magliette |

Regole per gli eventi: la produzione richiede un mese esatto dall'ordine alla consegna, quindi a meno di un mese dall'evento non si parla di capi dedicati. Gli eventi sono il canale migliore perché andiamo di persona a vendere. Un evento è raggiungibile se è in Italia o in un paese confinante e mancano almeno tre settimane (decisione mia, da confermare). Un evento lontano nel tempo o nello spazio si tratta come un club: progetto futuro o prossima edizione. Per Milano AutoClassica, se rispondono con i costi del banco li valuta Tommaso; se non c'è più posto si propone una collaborazione o la presenza all'edizione successiva.

L'assistente decide anche quando scrivere: se il momento giusto è più avanti (per esempio qualche mese prima della prossima edizione di un evento), fissa la data nel gestionale e non scrive adesso. Salva la richiesta scelta e il motivo in una frase.

### 3. Scrittura

L'ordine di ogni prima email, approvato da Tommaso il 27 ottobre: complimento sincero e specifico, chi siamo (ragazzi di 22 anni di Milano appassionati di auto; disegniamo noi ogni auto e la facciamo ricamare in Italia su cotone biologico, senza loghi vistosi), cosa abbiamo già fatto, la voglia di fare qualcosa insieme, la richiesta, una sola domanda gentile, il grazie. Firma «Tommaso / Fondatore, LuckyLap / luckylap.com | Instagram @lucky.lap». Oggetto breve con il loro nome.

Fatti che si possono citare, da due a quattro per email: tra chi indossa le nostre magliette ci sono piloti di Formula 1 (mai nomi, mai «abbiamo venduto a»); siamo in un negozio nel centro di Milano a un minuto dal Duomo (mai il nome, mai «il nostro negozio»); 150 magliette su misura per il Porsche Club Toscana con il logo del club sulla manica; magliette arrivate in più di dieci paesi; siamo tutti di 22 anni. Con i Porsche Club e le comunità Porsche si nominano solo la 964 e la GT3RS, e si può dire che il nostro ricamatore lavora apposta per i Porsche Club.

Mai: conto vendita (in nessuna lingua: consignment, sale or return, Kommission, dépôt-vente…), «Made in Italy», schizzi, idee su misura, campioni, foto da mandare, magliette in regalo, prezzi, sconti, punti esclamativi, emoji, superlativi, case automobilistiche come partner, link diversi dalla home di luckylap.com (la pagina `/pages/porsche` non esisterà mai), allegati.

Lingua del destinatario: inglese britannico, tedesco con il Sie (in Svizzera senza ß), francese con il vous, spagnolo con l'usted, italiano con il voi verso un'organizzazione e il Lei verso una persona. Corpo tra 110 e 160 parole. Saluto con il nome della persona se la ricerca l'ha trovato, altrimenti un saluto neutro; in Austria con il titolo accademico se c'è.

I quattro testi di esempio approvati (Milano AutoClassica, Porsche Club GB con il sollecito, Elferspot) sono il riferimento di tono.

### 4. Controllo prima dell'invio

Ogni email passa due controlli. Il primo è una seconda lettura di Claude con le regole davanti, che può solo approvare o rimandare indietro con il motivo. Il secondo è nel codice e non dipende dal modello:

- il contatto non è in «Non contattare», né per indirizzo né per dominio, e non ha detto no;
- non è già partita un'email per lo stesso contatto e lo stesso passo;
- nessuna parola vietata, in tutte le lingue;
- nessun segnaposto rimasto (parentesi quadre, «Nachname», «first name»);
- un solo punto interrogativo, nessun punto esclamativo;
- l'unico link è luckylap.com;
- la firma è quella giusta e dice Tommaso;
- con un contatto Porsche non compaiono modelli diversi da 964 e GT3RS;
- lunghezza nei limiti.

Se un controllo fallisce l'email non parte. L'assistente riscrive una volta; al secondo errore il contatto passa a Tommaso.

### 5. Invio

- Dalla casella aziendale (vedi `docs/deployment.md`) attraverso il server IONOS, solo dopo la sistemazione dello spam.
- Testo semplice, niente allegati, niente immagini, niente tracciamento delle aperture, un destinatario per volta.
- Copia nella cartella «Posta inviata» della casella, così Tommaso la vede anche dal suo programma di posta.
- Ritmo: 5 email al giorno nella prima settimana, poi tra 10 e 15. I solleciti e le risposte non contano nel limite.
- Orari: giorni feriali tra le 9 e le 12 nel fuso del destinatario, meglio da martedì a giovedì.

### 6. Risposte

L'assistente legge la casella ogni pochi minuti e considera solo le email che rispondono a una sua conversazione o che arrivano da un indirizzo o dominio di un contatto Partner. Tutto il resto della casella (ordini, clienti, fornitori) non lo tocca: non lo legge oltre l'intestazione, non lo segna come letto, non lo sposta.

Per ogni risposta:

- **risposta automatica** (fuori ufficio, cambio indirizzo): non conta come risposta; se indica una data di rientro, il sollecito slitta;
- **indirizzo non valido**: il contatto torna da studiare per trovare un altro indirizzo, e lo segnala nel riepilogo;
- **no o non ora**: un grazie breve e gentile, stato «No» o nuova data, nessun altro messaggio;
- **interesse generico o domande semplici** a cui le regole rispondono: risposta naturale, breve, nella loro lingua, entro un giorno lavorativo, con gli stessi controlli della prima email;
- **qualcosa di concreto** (costi, prezzi, quantità, date, una call o un incontro, un ordine, una richiesta di campioni, i nomi dei piloti, condizioni, contratti) o qualunque cosa a cui le regole non rispondono: l'assistente non risponde e passa la conversazione a Tommaso subito, con un riassunto e una proposta di risposta che lui può usare o cambiare.

Se Tommaso o qualcun altro risponde a mano in una conversazione, l'assistente se ne accorge dalla posta inviata e si ferma su quel contatto.

### 7. Solleciti

Se non rispondono, un sollecito gentile nella stessa conversazione dopo due-tre settimane, poi un secondo, al massimo due; ognuno porta una cosa nuova e corta (40-90 parole). Dopo il secondo, il contatto resta «Contattato» senza prossimo passo automatico. Le date si spostano per gli eventi (per esempio, dopo il mercatino di Natale del Porsche Club GB).

### 8. Passaggio a Tommaso

Quando una conversazione diventa concreta, o in uno dei casi di blocco sopra, il contatto passa a Tommaso: stato e responsabile cambiano nel gestionale, compare nella lista «Per te» e Tommaso riceve subito un'email con il riassunto e la proposta di risposta. Da lì in poi l'assistente non scrive più a quel contatto finché Tommaso non glielo ridà.

### 9. Gestionale e riepilogo

Ogni passo lascia traccia nel gestionale, con l'assistente come autore riconoscibile: ricerca e fonti, richiesta e motivo, ogni email inviata e ricevuta con il testo completo, i controlli superati o falliti, lo stato, il prossimo passo con la data, il costo. Ogni sera alle 19 Tommaso riceve un riepilogo: email partite, risposte arrivate, passaggi a lui, problemi, spesa del giorno e credito rimasto.

## Credito e tempi

Il credito Anthropic (100 USD) scade il 5 novembre 2026. Tommaso ha chiesto di non porre limiti di spesa: il credito va usato. Quindi:

- nessun tetto di spesa interno; si usa Opus 5.5 in ogni passo che scrive o decide;
- il lavoro costoso, cioè ricerca e bozza, va fatto prima del 5 novembre per tutti i contatti che conviene preparare;
- la spesa si registra comunque, chiamata per chiamata, per sapere quanto costa un contatto;
- quando il credito finisce l'assistente non si rompe: smette di studiare e di scrivere, e ogni risposta in arrivo passa direttamente a Tommaso.

Stima con i prezzi pubblici di Opus 5.5 (4 USD per milione di token in ingresso, 20 in uscita, 0,01 USD a ricerca web): tra 0,6 e 1,2 USD per contatto tra ricerca, scrittura e seconda lettura. Il credito basta quindi per preparare circa 80-150 contatti, non tutti i 165 che hanno un'email.

Ordine di uso del credito prima del 5 novembre:

1. ricerca e prima email per i contatti da scrivere adesso (periodo «Adesso» e priorità alta per primi);
2. per gli altri, una ricerca più leggera che aggiorna nomi, indirizzi, date della prossima edizione e il momento giusto per scrivere;
3. se avanza credito, la ricerca mondiale sui Porsche Club (fuori da questa specifica: decide Tommaso).

Una ricerca più vecchia di 21 giorni al momento dell'invio si rifà, con il credito che ci sarà allora.

Per arrivare in tempo il lavoro si divide in due consegne. La prima (entro il 31 ottobre) porta dati, identità, worker e la modalità «prepara»: ricerca e bozze salvate nel gestionale, nessun invio. La seconda porta invio, lettura della casella, solleciti, passaggio a Tommaso e riepilogo. Le due consegne passano ciascuna dai controlli di AGENTS.md e dall'OK di Tommi.

## Avvio

1. **Spam.** Prima di qualunque invio automatico si sistema la casella aziendale (vedi `docs/deployment.md`): intestazioni di un'email finita in spam, inoltro disattivato se passa dai server IONOS in lista nera, record DMARC proprio con indirizzo per i rapporti, nessun allegato pesante. Lo fa Tommaso con una guida passo per passo.
2. **OK di Tommi** per merge, migrazione, creazione del profilo tecnico, variabili d'ambiente e accensione dello scheduler (AGENTS.md).
3. **Modalità «prepara»**: ricerca e bozze per i contatti, nessun invio. Il team può leggere tutto nel gestionale.
4. **Modalità «prova»** per un giorno: tutte le email partono verso un indirizzo di prova di Tommaso, con l'oggetto che inizia per «[Prova]». Serve a leggerle nella posta vera e a controllare che non finiscano in spam.
5. **Modalità «invio»**: 5 email al giorno nella prima settimana, poi tra 10 e 15.

Milano AutoClassica non aspetta l'assistente: il testo è pronto e Tommaso lo manda a mano entro venerdì 30 ottobre. Quando l'assistente si accende, trova quella conversazione nella posta inviata e la prende in carico (vedi «Conversazioni già esistenti»).

## Come è fatto

Questa parte è per chi costruisce. Base: `origin/main` a `3c58693`. Riferimenti: `docs/partner.md`, `docs/shopify-worker.md`, `docs/audit-workspace.md`, `docs/workspace-layout.md`.

### Dove gira

Dentro il gestionale, sullo schema del worker Shopify: pg_cron chiama con pg_net una route Vercel protetta da un bearer in Vault; la route decide il lavoro solo dal database. Tutto si copia con nomi propri (job, segreto Vault, funzioni `configure_*` e `dispatch_*`, flag d'ambiente), così lo spegnimento e la rotazione restano indipendenti da Shopify.

Differenze rispetto a Shopify:

- I passi sono lunghi (una ricerca può durare minuti). La route risponde subito e lavora in `after()` con un `AbortController` proprio, come `src/lib/shopify/receiver-trigger.ts`; `maxDuration` a 300 secondi, il massimo di Vercel Hobby con Fluid compute (da confermare nelle impostazioni del progetto). Un solo contatto e un solo passo per invocazione, lo stato salvato nel database tra un passo e l'altro, e un solo passo lungo alla volta.
- Due job: uno ogni 3-5 minuti per la casella (breve), uno ogni 5-10 minuti per i passi sui contatti. Il riepilogo serale parte dallo stesso schema.
- Le regole di calendario stanno nel claim SQL, non nel TypeScript: finestra d'ufficio del destinatario, limite giornaliero contato sul giorno di Roma, intervallo casuale tra due invii, solleciti come lavori futuri. pg_cron gira in UTC: le ore si calcolano con `at time zone`.
- Un registro delle esecuzioni nel database (inizio, fine, passo, esito, codice, costo) e un indicatore «ultimo giro»: i log di Vercel Hobby durano un'ora e con la risposta immediata pg_net non dice più nulla.
- Un tetto ai tentativi: oltre il terzo, il lavoro va a Tommaso.
- Le chiavi (Anthropic, IONOS, Supabase) restano solo nelle variabili server di Vercel: in pg_net e in Vault va solo il bearer.

Interruttori: variabile d'ambiente (fallimento chiuso, come `worker-config.ts`), riga di configurazione nel database con la modalità (`spento`, `prepara`, `prova`, `invio`), scheduler. Il flag si controlla prima di ogni chiamata a Claude o al server di posta, non solo alla fine.

### Identità

L'assistente ha un profilo tecnico proprio, «Assistente», senza membership: un utente Auth creato con gli strumenti Admin (indirizzo non instradabile, nessuna password utilizzabile, come in `docs/backend.md`), più una riga in `profiles`. Senza membership non entra nell'app, non apre aree con password e non compare tra gli assegnatari del Team; le FK verso `profiles` restano valide. Una riga di configurazione privata indica il profilo dell'assistente e quello di Tommaso (per i passaggi), senza UUID nel codice.

Le RPC dell'assistente sono nuove, `security definer`, eseguibili solo da `service_role`, con la guardia sul ruolo e sul flag; dentro, attività, ricevute e audit risultano dell'assistente (per esempio impostando i claim della richiesta all'id dell'assistente, da provare su PostgreSQL 17, oppure passando l'attore esplicito agli helper `partner_log` e `apply_partner_stage`). I comandi Partner esistenti non si toccano. Il worker usa solo queste RPC, con una lista ammessa come `src/lib/shopify/worker-store.ts`; la nuova migrazione toglie a `service_role` la scrittura diretta sulle tabelle `public.partner_*`, dopo averla verificata in sola lettura.

### Dati

Una migrazione additiva, nello stile del modulo Partner (funzioni private, wrapper, ricevute idempotenti con `operation_id`, append-only dove si registra la storia, `audit_change_keys` senza testi né indirizzi):

- **configurazione**: riga unica con modalità, profili, limiti giornalieri, indirizzo per i riepiloghi letto dall'ambiente;
- **conversazioni**: una per contatto, con stato (`attiva`, `in_attesa`, `passata`, `ferma`, `chiusa`), solleciti inviati (vincolo 0-2), ultimo invio, ultima risposta, data del prossimo sollecito, versione;
- **messaggi**: inviati e ricevuti, testo completo, oggetto, indirizzi, `Message-ID` unico, `In-Reply-To`, `References`, cartella e UID IMAP, tipo (primo, sollecito, risposta, ricevuto), stato di invio (`pronto`, `in_invio`, `inviato`, `incerto`), versione delle regole usata, esito dei controlli;
- **note dell'assistente**: ricerca con fonti, richiesta scelta e motivo, passaggio a Tommaso con riassunto e proposta di risposta, modello e costo. La ricerca dell'assistente non va in `partners.research`, che ogni import della ricerca sovrascrive;
- **esecuzioni e costi**: una riga per chiamata a Claude con token, ricerche web e costo calcolato;
- **cursore della casella**: `UIDVALIDITY` e ultimo UID letto per cartella.

Nel modulo esistente cambiano solo:

- `partner_activities.origin` accetta anche `assistente`. Ogni email dell'assistente lascia una riga di registro (`inviato` con `primo` o `sollecito`, `risposta`), così stati e storia restano quelli di oggi;
- il trigger dei solleciti (`partner_oggi_fixes`): con origine `assistente` chiude i solleciti del team come oggi ma non ne crea di nuovi (i solleciti li gestisce l'assistente), e conta l'assistente nel controllo «invio più recente»;
- i parser dell'interfaccia (`src/lib/partner/model.ts`, `read.ts`) accettano la nuova origine. Il deploy dell'app va fatto prima che il worker scriva, altrimenti la scheda del contatto si rompe;
- il feed «Controllo CEO»: con l'attore dell'assistente le frasi diventano «L'assistente ha scritto a Nome (CO n)», «… ha ricevuto una risposta da …», «… ha passato a Tommi la conversazione con …». Il soggetto si lega all'id configurato, non al nome visualizzato. Una transazione per contatto, così il feed non fonde gli invii.

Stati del contatto: l'assistente porta un contatto a «Contattato» con il primo invio e a «Ha risposto» con la prima risposta, tramite il registro come oggi. Non imposta mai «In trattativa», «Accordo fatto» o «Non interessato» da solo: «Accordo fatto» crea eventi in calendario e le trattative le decide Tommaso. Unica eccezione: un no esplicito porta a «Non interessato», con il motivo nel registro.

Il passaggio a Tommaso imposta `owner_id` sul suo profilo, la prossima azione («Rispondere a …») con la data di oggi, crea un'attività assegnata a lui con scadenza oggi (così compare nella sua Oggi) e porta la conversazione in `passata`.

L'assistente salta i contatti con `research_removed_at`, quelli bloccati (`partner_blocked`, controllato anche sul dominio dell'indirizzo davvero usato) e quelli senza email attiva. Per un dominio di posta generico (gmail, outlook…) il confronto si fa sull'indirizzo intero, non sul dominio.

### Posta

- Librerie Node: nodemailer per l'invio, imapflow per la casella, mailparser per leggere i messaggi; versioni esatte, pubblicate da almeno due settimane, runtime `nodejs` (le route Edge non fanno SMTP).
- **Invio**: il messaggio si compone una volta sola con il suo `Message-ID`, si salva come `pronto`, passa a `in_invio`, va via SMTP (porta 465 o 587, TLS), poi si copia in «Posta inviata» con IMAP APPEND (la cartella si trova dal flag `\Sent`). Se l'esito dell'invio è incerto non si ritenta mai da soli: si cerca il `Message-ID` nella posta inviata, e se non si trova la conversazione passa a Tommaso. Su «450 limite di invio» si aspetta.
- **Lettura**: IMAP a ogni giro, senza connessioni lunghe; si leggono solo le intestazioni dei messaggi nuovi (cursore per UID), senza segnarli come letti (`BODY.PEEK`), senza spostarli né cancellarli. Si scarica il corpo solo dei messaggi che rispondono a una conversazione dell'assistente (`In-Reply-To`/`References`) o che arrivano da un indirizzo di un contatto. Tutto il resto della casella resta com'è.
- **Risposte a mano**: anche «Posta inviata» si legge; un messaggio in una conversazione dell'assistente con un `Message-ID` che l'assistente non ha creato significa che ha risposto una persona, e l'assistente si ferma su quel contatto.
- **Conversazioni già esistenti**: prima della prima email a un contatto, l'assistente cerca nella posta inviata e ricevuta degli ultimi 12 mesi messaggi verso o da quell'indirizzo. Se trova una nostra email senza risposta la adotta come primo invio (con la sua data, per i solleciti); se trova una conversazione con risposte, passa il contatto a Tommaso.
- **Riconoscimenti**: risposte automatiche (`Auto-Submitted`, `X-Autoreply`, oggetti tipici) e avvisi di mancata consegna (rapporti DSN che citano un nostro `Message-ID`) non contano come risposte.

### Claude

- SDK ufficiale `@anthropic-ai/sdk`, versione esatta. Opus 5.5 (`claude-opus-5-5`) con thinking adattivo per ricerca, scelta, scrittura, seconda lettura e risposte; per i compiti meccanici (riconoscere una risposta automatica, estrarre campi) chi costruisce può usare un modello più piccolo.
- Ricerca con gli strumenti server `web_search` e `web_fetch` (versioni del 2026-02-09), in testo libero con le fonti; poi una seconda chiamata estrae i campi con output strutturato (JSON schema), perché output strutturato e citazioni non stanno nella stessa richiesta. Gestire `pause_turn` riprendendo il turno al giro successivo.
- Ogni chiamata si ricostruisce dai dati del database: niente blocchi di thinking riportati tra un passo e l'altro.
- Le regole di scrittura stanno in un testo versionato nel repository (decisione mia: le modifiche di Luca e di Tommaso si fanno con una pull request, e ogni email registra la versione usata), nel system prompt con il prompt caching. La pagina `/partner/regole` resta quella di `CONTESTO.md`, che è superato su più punti (firma, conto vendita, allegati, solleciti a 7-10 giorni): la nuova pagina dell'assistente mostra le regole in vigore.
- I testi approvati del 27 ottobre (AutoClassica, Porsche Club GB con sollecito, Elferspot) entrano nelle regole come esempi di tono, senza dati personali.
- Le varianti di messaggio importate (218, scritte con le regole vecchie, anche con il conto vendita) l'assistente non le usa e non le manda.
- `usage` di ogni risposta si salva con il numero di ricerche web. Se l'API risponde che il credito è finito, l'assistente si mette in pausa da solo: niente nuove ricerche o email, le risposte in arrivo passano a Tommaso, e la striscia lo dice.

### Interfaccia

Nel modulo Partner, senza nuove voci di menu (decisioni sul layout in `docs/workspace-layout.md` e `DESIGN.md`):

- una striscia in cima a `/partner`, sul modello «Area aperta»: «Assistente acceso · 4 email oggi · 12,30 USD spesi» con il pulsante «Ferma l'assistente». Spento o in errore: fondo ambra con la parola scritta;
- una pagina `/partner/assistente` (link nel piede accanto a «Regole per scrivere»): modalità, coda, invii del giorno, ultimo giro, errori, spesa, regole in vigore. Si accende, si ferma e si cambia modalità da qui; chiunque del team può farlo, come tutto in Partner (decisione del 21 ottobre);
- nella scheda del contatto: un blocco «Assistente» con la ricerca (data e fonti), la richiesta scelta e il motivo, lo stato della conversazione, il prossimo passo, e l'interruttore «Assistente su questo contatto: attivo / fermo» (diverso da «Non contattare»); un blocco «Conversazione» con le email inviate e ricevute, la più recente in alto, il corpo in sezioni apribili;
- su un contatto seguito dall'assistente, il blocco Messaggi mostra un avviso e nasconde «Apri l'email con il testo» e «Segna inviato», per evitare doppi invii;
- una vista «Per te» accanto a «Ci siamo», con le conversazioni passate a Tommaso e la proposta di risposta da copiare;
- la guida «Come si usa» si aggiorna (il suo test controlla le frasi), e così i testi che oggi dicono «chiedilo a Claude nel repository Partner».

Ogni pagina nuova funziona anche in anteprima senza database. Le pagine non si aggiornano da sole: la striscia mostra i dati del caricamento.

### Notifiche

Nel gestionale non esistono notifiche. L'assistente usa la posta: un'email a Tommaso subito a ogni passaggio (riassunto, conversazione, proposta di risposta, link alla scheda) e il riepilogo serale alle 19 ora di Roma. L'indirizzo di Tommaso sta in una variabile d'ambiente, non nel codice. In più, l'attività assegnata a lui compare nella sua Oggi.

### Variabili d'ambiente (le inserisce Tommi in Vercel produzione)

| Variabile | Scopo |
|---|---|
| `PARTNER_ASSISTANT_ENABLED` | Accensione, vale solo `true` |
| `PARTNER_ASSISTANT_SECRET` | Bearer del worker, lo stesso in Vault |
| `ANTHROPIC_API_KEY` | Chiave dell'API Anthropic |
| `PARTNER_MAIL_USER`, `PARTNER_MAIL_PASSWORD` | Casella aziendale |
| `PARTNER_MAIL_SMTP_HOST`, `PARTNER_MAIL_IMAP_HOST` | Server IONOS (da verificare nel pannello: `.it` o `.com`) |
| `PARTNER_MAIL_FROM_NAME` | «Tommaso · LuckyLap» o simile |
| `PARTNER_REPORT_TO` | Indirizzo di Tommaso per passaggi e riepilogo |
| `PARTNER_TEST_TO` | Indirizzo per la modalità prova |

Nessun segreto negli ambienti preview: lì l'assistente resta spento e risponde 503.

### Test e verifica

- Fake iniettati per Claude, ricerca web, SMTP e IMAP, come le dipendenze del worker Shopify; messaggi MIME sintetici con domini `example.test`; nessun server di posta installato sul Mac.
- Harness PGlite per stati, code, limiti giornalieri, solleciti (mai più di due), blocchi e passaggi; PostgreSQL 17 per lease e invii concorrenti (doppio invio impossibile).
- Test dei controlli nel codice su ogni lingua, con le parole vietate.
- Prima del lancio, verifiche in sola lettura: privilegi di `service_role` sulle tabelle Partner, durata massima delle funzioni nel progetto Vercel, host IONOS, cartella «Posta inviata».
- I comandi di AGENTS.md prima di ogni pull request; nessuna email vera in test, fixture o documenti.

## Lasciato a chi costruisce

Nomi di tabelle, funzioni e file; prompt; divisione in moduli; intervallo esatto dei job; scelta del modello per i compiti meccanici; come rendere l'assistente autore nell'audit (claim o attore esplicito), purché il feed mostri «L'assistente»; formato del riepilogo serale; aspetto dei blocchi nuovi entro `DESIGN.md`.

## Rischi noti

- Consenso per le email commerciali: in Italia, Germania e Spagna la legge chiede un consenso anche verso le aziende; Tommaso ha deciso di scrivere a tutti (26 ottobre). L'assistente rispetta subito ogni richiesta di non essere ricontattati.
- Vercel Hobby è per uso non commerciale e non garantisce il servizio, come Supabase Free. Hosting e backup restano come sono finché Tommi non decide (AGENTS.md).
- Un blocco della casella IONOS per spam fermerebbe anche la posta normale: per questo ritmo lento, testo semplice e modalità prova.
- Le email e le risposte salvate nel modulo Partner le vedono tutti e cinque, Luca compreso.
- Limiti di velocità dell'account Anthropic (tier) non noti: da controllare in Console.
- Questa specifica supera la regola di P5 «Nessuna email o notifica esterna automatica» (`2026-10-22-p4-p6-design.md`), per decisione di Tommaso.

## Scelte fatte da Claude, da controllare

Tommaso non le ha decise esplicitamente; sono le scelte che mi sembrano più vicine a quello che ha detto.

1. L'assistente ha un profilo tecnico «Assistente» senza membership, invece di scrivere a nome di Tommaso: così nel gestionale e nel feed si distingue sempre dalle persone.
2. Le regole di scrittura stanno in un testo versionato nel repository: le correzioni di Luca e di Tommaso si fanno con una pull request, e ogni email registra la versione usata.
3. Evento «raggiungibile»: in Italia o in un paese confinante, con almeno tre settimane di anticipo.
4. Due consegne, la prima entro il 31 ottobre, per usare il credito prima del 5 novembre.
5. L'assistente non mette mai «In trattativa» o «Accordo fatto»: lo decide Tommaso. Un no esplicito porta a «Non interessato», dopo un grazie breve.
6. Nel passaggio a Tommaso l'assistente non risponde e prepara una proposta di risposta; Tommaso risponde dal suo programma di posta, e l'assistente se ne accorge dalla posta inviata.
7. Chiunque del team può fermare e riaccendere l'assistente, come tutto in Partner.
8. Una ricerca più vecchia di 21 giorni al momento dell'invio si rifà.
9. Senza un fatto vero e recente da citare, la prima email non parte e il contatto passa a Tommaso.
10. Modalità prova per un giorno prima del lancio, con le email verso un indirizzo di Tommaso.
11. Le conversazioni già esistenti degli ultimi 12 mesi si adottano invece di scrivere di nuovo.
12. Riepilogo alle 19, ora di Roma; dopo tre tentativi falliti un lavoro passa a Tommaso.
