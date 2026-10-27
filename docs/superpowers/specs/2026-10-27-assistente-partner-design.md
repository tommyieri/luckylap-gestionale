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

Tommaso vuole una ricerca prima di ogni email. Prima della prima email la ricerca è completa: l'assistente cerca sul web il contatto: sito, social, notizie recenti, prossimo evento con le date, persona giusta a cui scrivere e il suo nome, indirizzo email ancora valido. Parte dalla scheda del gestionale ma non si fida delle date e dei nomi già scritti: nei nove esempi studiati il 26 ottobre quasi ogni scheda era superata. Salva nel gestionale cosa ha trovato, con le fonti, e un fatto vero e recente da citare nel complimento iniziale. Se non trova un fatto vero da citare, l'email non parte e il contatto passa a Tommaso con il motivo. Prima di un sollecito o di una risposta la ricerca è breve: cosa è cambiato da allora (una novità da portare nel sollecito, un evento passato, una data spostata).

L'assistente può scrivere a un indirizzo trovato dalla ricerca e non ancora nel gestionale solo se è pubblicato dall'organizzazione stessa (il suo sito, le sue pagine ufficiali); lo salva nei recapiti del contatto con la fonte, così vale anche per «Non contattare». Mai indirizzi presi da siti che raccolgono contatti, mai caselle private non pubblicate dall'organizzazione.

### 2. Scelta della richiesta

Una sola richiesta per email, in base al tipo di contatto (decisione del 27 ottobre):

| Contatto | Richiesta |
|---|---|
| Club, brand, media | Parlare insieme di un progetto futuro, senza dire quale |
| Evento raggiungibile | Esserci con un piccolo banco |
| Negozio | Se venderebbero le nostre magliette |

Regole per gli eventi: gli eventi sono il canale migliore perché andiamo di persona a vendere. La produzione richiede un mese esatto dall'ordine alla consegna, quindi a meno di un mese dall'evento non si parla di capi dedicati, ma il banco si chiede lo stesso se si può andare a vendere. Un evento è raggiungibile se è in Italia o in un paese confinante (scelta di Claude, da confermare); un evento più lontano si tratta come un club: progetto futuro. Un evento raggiungibile ma lontano nel tempo riceve la richiesta del banco al momento giusto (vedi sotto). Se un evento risponde con i costi del banco, li valuta Tommaso (passaggio); se non c'è più posto o è troppo tardi, si propone una collaborazione o la presenza all'edizione successiva: non è un no.

L'assistente decide anche quando scrivere: se il momento giusto è più avanti (per esempio qualche mese prima della prossima edizione di un evento), salva la data per scrivere nelle sue tabelle (non in «Prossima azione», che sposterebbe il contatto di periodo e lo metterebbe nell'Oggi di tutti) e non scrive adesso. Salva la richiesta scelta e il motivo in una frase.

### 3. Scrittura

L'ordine di ogni prima email, approvato da Tommaso il 27 ottobre: complimento sincero e specifico, chi siamo (ragazzi di 22 anni di Milano appassionati di auto; disegniamo noi ogni auto e la facciamo ricamare in Italia su cotone biologico, senza loghi vistosi), cosa abbiamo già fatto, la voglia di fare qualcosa insieme, la richiesta, una sola domanda gentile, il grazie. Firma su tre righe: «Tommaso», il ruolo nella lingua dell'email («Fondatore», «Founder», «Gründer», «Fondateur», «Fundador») con «, LuckyLap», e «luckylap.com | Instagram @lucky.lap». Oggetto breve con il loro nome.

Fatti che si possono citare, da due a quattro per email: tra chi indossa le nostre magliette ci sono piloti di Formula 1 (mai nomi, mai «abbiamo venduto a»); siamo in un negozio nel centro di Milano a un minuto dal Duomo (mai il nome, mai «il nostro negozio»); 150 magliette su misura per il Porsche Club Toscana con il logo del club sulla manica; magliette arrivate in più di dieci paesi; siamo tutti di 22 anni. Con i Porsche Club e le comunità Porsche si nominano solo la 964 e la GT3RS, e si può dire che il nostro ricamatore lavora apposta per i Porsche Club.

Mai: conto vendita (in nessuna lingua: consignment, sale or return, Kommission, dépôt-vente…), «Made in Italy», schizzi, idee su misura, campioni, foto da mandare, magliette in regalo, prezzi, sconti, punti esclamativi, emoji, superlativi, case automobilistiche come partner, link diversi dalla home di luckylap.com (la pagina `/pages/porsche` non esisterà mai), allegati.

Lingua del destinatario (da `CONTESTO.md`): inglese britannico, tedesco con il Sie (in Svizzera senza ß), francese con il vous, italiano con il voi verso un'organizzazione e il Lei verso una persona; spagnolo con l'usted (scelta di Claude). Corpo tra 110 e 160 parole. Saluto con il nome della persona se la ricerca l'ha trovato, altrimenti un saluto neutro; in Austria con il titolo accademico se c'è.

I quattro testi del 27 ottobre (Milano AutoClassica, Porsche Club GB con il sollecito, Elferspot) sono il riferimento di tono, nella versione corretta dopo il parere di Luca. Due punti sono ancora aperti: nell'email a Elferspot le parole «mit dem Clublogo am Ärmel», e per Milano AutoClassica la giornata del 19 novembre.

### 4. Controllo prima dell'invio

Ogni email passa due controlli. Il primo è una seconda lettura di Claude con le regole davanti, che può solo approvare o rimandare indietro con il motivo. Il secondo è nel codice e non dipende dal modello:

- il contatto non è in «Non contattare», né per indirizzo né per dominio, e non ha detto no;
- non è già partita un'email per lo stesso contatto e lo stesso passo;
- nessuna parola vietata, in tutte le lingue;
- nessun segnaposto rimasto (parentesi quadre, «Nachname», «first name»);
- un solo punto interrogativo, nessun punto esclamativo;
- l'unico link è luckylap.com;
- la firma è quella giusta per la lingua e dice Tommaso;
- la versione delle regole con cui è stata scritta è quella in vigore: una bozza scritta con regole superate si riscrive;
- con un contatto Porsche non compaiono modelli diversi da 964 e GT3RS;
- lunghezza nei limiti.

Se un controllo fallisce l'email non parte. L'assistente riscrive una volta; al secondo errore il contatto passa a Tommaso.

### 5. Invio

- Dalla casella aziendale attraverso il server IONOS, solo dopo la sistemazione dello spam.
- Testo semplice, niente allegati, niente immagini, niente tracciamento delle aperture, un destinatario per volta.
- Copia nella cartella «Posta inviata» della casella, così Tommaso la vede anche dal suo programma di posta.
- Ritmo: 5 prime email al giorno nella prima settimana, poi tra 10 e 15. I solleciti hanno un loro limite giornaliero; le risposte non hanno limite ma seguono le regole contro le catene (vedi «Regole di sicurezza»).
- Orari: prime email e solleciti nei giorni feriali tra le 9 e le 12 nel fuso del destinatario, meglio da martedì a giovedì; risposte tra le 9 e le 18.

### 6. Risposte

L'assistente legge la casella ogni pochi minuti e considera solo le email che rispondono a una sua conversazione o che arrivano da un indirizzo o dominio di un contatto Partner. Tutto il resto della casella (ordini, clienti, fornitori) non lo tocca: non lo legge oltre l'intestazione, non lo segna come letto, non lo sposta.

Per ogni risposta:

- **risposta automatica** (fuori ufficio, cambio indirizzo): non conta come risposta; se indica una data di rientro, il sollecito slitta;
- **indirizzo non valido**: il contatto torna da studiare per trovare un altro indirizzo, e lo segnala nel riepilogo;
- **no**: un grazie breve e gentile, stato «Non interessato», nessun altro messaggio; a «stop» o «remove» nemmeno il grazie, e l'indirizzo va in «Non contattare»;
- **non ora**: un grazie breve, una nuova data nel gestionale e nessun sollecito fino ad allora;
- **evento senza posto o troppo tardi**: come sopra per gli eventi, collaborazione o edizione successiva;
- **interesse generico o domande semplici** a cui le regole rispondono: risposta naturale, breve, nella loro lingua, entro un giorno lavorativo, con gli stessi controlli della prima email;
- **qualcosa di concreto** (costi, prezzi, quantità, date, una call o un incontro, un ordine, una richiesta di campioni, i nomi dei piloti, condizioni, contratti) o qualunque cosa a cui le regole non rispondono: l'assistente non risponde e passa la conversazione a Tommaso subito, con un riassunto e una proposta di risposta che lui può usare o cambiare.

Se Tommaso o qualcun altro risponde a mano in una conversazione, l'assistente si ferma su quel contatto. Se ne accorge dalla posta inviata della casella oppure, se la persona ha risposto da un altro programma o servizio, dalla risposta successiva del contatto, che cita un messaggio nostro che l'assistente non ha scritto.

### 7. Solleciti

Se non rispondono, un sollecito gentile nella stessa conversazione dopo due-tre settimane, poi un secondo, al massimo due; ognuno porta una cosa nuova e corta (40-90 parole). Dopo il secondo, il contatto resta «Contattato» senza prossimo passo automatico. Le date si spostano per gli eventi (per esempio, dopo il mercatino di Natale del Porsche Club GB).

### 8. Passaggio a Tommaso

Quando una conversazione diventa concreta, o in uno dei casi di blocco sopra, il contatto passa a Tommaso: stato e responsabile cambiano nel gestionale, compare nella lista «Per te» e Tommaso riceve subito un'email con il riassunto e la proposta di risposta. Da lì in poi l'assistente non scrive più a quel contatto finché Tommaso non glielo ridà.

### 9. Gestionale e riepilogo

Ogni passo lascia traccia nel gestionale, con l'assistente come autore riconoscibile: ricerca e fonti, richiesta e motivo, ogni email inviata e ricevuta con il testo completo, i controlli superati o falliti, lo stato, il prossimo passo con la data, il costo. Ogni sera alle 19 Tommaso riceve un riepilogo: email partite, risposte arrivate, passaggi a lui, problemi, spesa del giorno e credito rimasto.

## Credito e tempi

Il credito Anthropic (100 USD, 92,05 rimasti il 27 ottobre) scade il 5 novembre 2026. Tommaso ha chiesto di non porre limiti di spesa: il credito va usato. Quindi:

- nessun tetto di spesa interno; si usa Opus 5.5 in ogni passo che scrive o decide;
- il lavoro costoso, cioè ricerca e bozza, va fatto prima del 5 novembre per tutti i contatti che conviene preparare;
- la spesa si registra comunque, chiamata per chiamata, per sapere quanto costa un contatto;
- quando il credito finisce l'assistente non si rompe: smette di studiare e di scrivere, e ogni risposta in arrivo passa direttamente a Tommaso;
- il credito rimasto non si legge con la chiave API: la configurazione tiene il credito di partenza, inserito a mano, e la pagina mostra quello meno la spesa registrata. Il numero esatto resta quello della Console.

Dopo il 5 novembre l'assistente ha bisogno di nuovo credito per tutto quello che scrive: solleciti, risposte, ricerche da rifare, prime email dei contatti preparati più tardi. Il 27 ottobre Tommaso ha deciso di non ricaricare per ora: si guarda come funziona e poi si decide; se ricarica, decide anche un tetto mensile da mettere nella configurazione. Quindi, finché non ricarica:

- prima del 5 novembre si preparano ricerca, prima email e seconda lettura, tutte già approvate;
- le prime email pronte partono con il ritmo previsto finché la loro ricerca ha meno di 21 giorni, con tutti i controlli nel codice; dopo restano nel gestionale;
- niente solleciti e niente risposte scritte dall'assistente: ogni risposta in arrivo passa a Tommaso con la conversazione;
- l'assistente continua a leggere la casella, a registrare e a mandare il riepilogo serale, che non richiedono Claude.

Il risultato da guardare per decidere è il tasso di risposta alle prime email.

Stima con i prezzi pubblici di Opus 5.5 (4 USD per milione di token in ingresso, 20 in uscita, 0,01 USD a ricerca web): tra 0,6 e 1,2 USD per contatto tra ricerca, scrittura e seconda lettura. Il credito basta quindi per preparare circa 80-150 contatti, non tutti i 165 che hanno un'email.

Il 27 ottobre, nel database di produzione, i 207 contatti sono tutti «Da contattare» e nessuna attività è registrata; 165 hanno un'email attiva. Per mese di contatto pianificato, quelli con email sono 12 in ottobre, 31 in novembre, 8 in dicembre, 41 in gennaio 2027 e 73 più avanti.

Ordine di uso del credito prima del 5 novembre:

1. ricerca e prima email per i 51 contatti pianificati tra ottobre e dicembre, priorità alta per prima;
2. ricerca per i contatti pianificati nel 2027: se il momento non dipende da una data (club, brand, media, negozi senza stagione), l'assistente li anticipa e prepara la prima email; se dipende da un evento, salva la data giusta per scrivere e la bozza si fa più avanti;
3. se avanza credito, la ricerca mondiale sui Porsche Club (fuori da questa specifica: decide Tommaso).

Una ricerca più vecchia di 21 giorni al momento dell'invio si rifà (scelta di Claude), e serve credito.

Per arrivare in tempo il lavoro si divide in due consegne. La prima (entro il 31 ottobre) porta dati, identità, worker e la modalità «prepara»: ricerca e bozze salvate nel gestionale, nessun invio. La seconda porta invio, lettura della casella, solleciti, passaggio a Tommaso e riepilogo. Le due consegne passano ciascuna dai controlli di AGENTS.md e dall'OK di Tommi.

## Avvio

1. **Spam.** Prima di qualunque invio automatico si sistema la casella aziendale: intestazioni di un'email finita in spam, inoltro disattivato se passa dai server IONOS in lista nera, record DMARC proprio con indirizzo per i rapporti, nessun allegato pesante. Lo fa Tommaso con una guida passo per passo.
2. **OK di Tommi** per merge, migrazione, creazione del profilo tecnico, variabili d'ambiente, attivazione di Fluid compute se serve, accensione dello scheduler (AGENTS.md).
3. **Parere di Luca** incorporato nelle regole. La modalità «prepara» può partire prima; «prova» e «invio» no.
4. **Contatti già avviati.** Gli stati del vecchio sito Partner vivono nei browser e arrivano nel gestionale solo con i file «Esporta» (`docs/partner.md`): prima del lancio tutti i file vanno caricati, e i rapporti già in corso (negozi in conto vendita, accordi) vanno segnati come fermi per l'assistente. Altrimenti l'assistente può riscrivere a chi è già stato contattato da un'altra casella o da Instagram.
5. **Modalità «prepara»**: ricerca e bozze per i contatti, nessun invio. Il team può leggere tutto nel gestionale.
6. **Modalità «prova»** per un giorno: tutte le email partono verso un indirizzo di prova di Tommaso, con l'oggetto che inizia per «[Prova]». Serve a leggerle nella posta vera e a controllare che non finiscano in spam.
7. **Modalità «invio»**: 5 email al giorno nella prima settimana, poi tra 10 e 15.

Solo Tommaso (ruolo founder) passa l'assistente a «prova» o a «invio», e solo dopo i passi 1-4. Chiunque del team può fermarlo o rimetterlo in «prepara».

Milano AutoClassica va scritta entro venerdì 30 ottobre, prima che l'assistente sia pronto. Proposta di Claude: Tommaso la manda a mano, con il testo sistemato dopo il parere di Luca. Quando l'assistente si accende, la trova nella posta (vedi «Conversazioni già esistenti») e la passa a Tommaso, che può ridargliela per i solleciti. Se Tommaso registra l'invio con «Segna inviato», il gestionale gli crea come oggi un sollecito a 7 giorni: quando ridà il contatto all'assistente, quel promemoria si chiude e i solleciti li fa l'assistente.

## Come è fatto

Questa parte è per chi costruisce. Base: `origin/main` a `3c58693`. Riferimenti: `docs/partner.md`, `docs/shopify-worker.md`, `docs/audit-workspace.md`, `docs/workspace-layout.md`.

### Dove gira

Dentro il gestionale, sullo schema del worker Shopify: pg_cron chiama con pg_net una route Vercel protetta da un bearer in Vault; la route decide il lavoro solo dal database. Tutto si copia con nomi propri (job, segreto Vault, funzioni `configure_*` e `dispatch_*`, flag d'ambiente), così lo spegnimento e la rotazione restano indipendenti da Shopify.

Differenze rispetto a Shopify:

- I passi sono lunghi (una ricerca può durare minuti). La route risponde subito e lavora in `after()`, come `src/lib/shopify/receiver-trigger.ts`, con un tempo massimo del passo imposto da un timer proprio ben sotto `maxDuration` (come il timer da 45 secondi di `src/lib/shopify/worker.ts`: in `receiver-trigger.ts` il segnale non si interrompe mai da solo); `maxDuration` a 300 secondi, il massimo di Vercel Hobby con Fluid compute. Lo stato di Fluid compute non è nel repository: se non è attivo, lo attiva Tommi (impostazione Vercel, serve il suo OK). In ogni caso un passo interrotto riprende dal punto salvato, senza effetti doppi. Un solo contatto e un solo passo per invocazione, lo stato salvato nel database tra un passo e l'altro, e un solo passo lungo alla volta.
- Due job: uno ogni 3-5 minuti per la casella (breve), uno ogni 5-10 minuti per i passi sui contatti. Il riepilogo serale parte dallo stesso schema.
- Le regole di calendario stanno nella funzione SQL che assegna il lavoro, non nel TypeScript: finestra d'ufficio del destinatario, limite giornaliero contato sul giorno di Roma, intervallo casuale tra due invii, solleciti come lavori futuri. pg_cron gira in UTC: le ore si calcolano con `at time zone`.
- Un registro delle esecuzioni nel database (inizio, fine, passo, esito, codice, costo) e un indicatore «ultimo giro»: i log di Vercel Hobby durano un'ora e con la risposta immediata pg_net non dice più nulla.
- Un tetto ai tentativi: oltre il terzo, il lavoro va a Tommaso.
- Le chiavi (Anthropic, IONOS, Supabase) restano solo nelle variabili server di Vercel: in pg_net e in Vault va solo il bearer. L'assistente usa una chiave segreta Supabase sua, distinta da quella del worker Shopify, così le due si ruotano e si revocano separatamente.
- La lista ammessa delle RPC ha limiti propri di dimensione e di tempo: quelli del worker Shopify (64 KB e 4 secondi) sono troppo stretti per ricerche con fonti e conversazioni.

Interruttori: variabile d'ambiente (fallimento chiuso, come `worker-config.ts`), riga di configurazione nel database con la modalità (`spento`, `prepara`, `prova`, `invio`), scheduler. Il flag si controlla prima di ogni chiamata a Claude o al server di posta, non solo alla fine.

### Identità

L'assistente ha un profilo tecnico proprio, «Assistente», senza membership: un utente Auth creato con gli strumenti Admin (indirizzo non instradabile `.invalid` come la prova QA in `docs/verifica-auth-cloud.md`, password casuale che nessuno conserva; mai `auth.users` via SQL, `docs/backend.md`), più una riga in `profiles`. Senza membership non entra nell'app, non apre aree con password e non compare tra gli assegnatari del Team; le FK verso `profiles` restano valide. Una riga di configurazione privata indica il profilo dell'assistente e quello di Tommaso (per i passaggi), senza UUID nel codice.

Le RPC del worker sono nuove, `security definer`, eseguibili solo da `service_role`, con la guardia sul ruolo e sul flag. Dentro, attività, ricevute e audit devono risultare dell'assistente, e l'unico modo è che `auth.uid()` restituisca il suo id: i trigger di audit (`audit_change`, `audit_change_keys`) e le ricevute lo leggono da lì, e passare l'attore agli helper non basta. Verificato in sola lettura il 27 ottobre: in produzione `auth.uid()` legge `request.jwt.claim.sub` e poi `request.jwt.claims->>'sub'`; ogni RPC imposta entrambi all'id dell'assistente con `set_config(..., true)`, conservando il claim `role`. Gli harness simulano `auth.uid()` con uno stub, quindi serve anche un test sulla definizione reale. Le ricevute dell'assistente stanno in una tabella propria: il vincolo `command_kind` di quelle esistenti ammette solo i dieci comandi di oggi.

I comandi del team sull'assistente (accendere, fermare, cambiare modalità, interruttore per contatto, modifica delle regole) sono invece comandi dei membri, come quelli Partner (`authenticated`, `partner_actor()`, ricevute idempotenti), con il controllo del ruolo founder per «prova» e «invio».

I comandi Partner esistenti non si toccano, salvo il rifiuto di un invio manuale su un contatto seguito dall'assistente (vedi «Regole di sicurezza»). Il worker usa solo le sue RPC, con una lista ammessa come `src/lib/shopify/worker-store.ts`; la nuova migrazione toglie a `service_role` la scrittura diretta sulle tabelle `public.partners` e `public.partner_*`: verificato in sola lettura il 27 ottobre, oggi può inserire righe in `partners` e `partner_activities` scavalcando comandi e «Non contattare».

### Dati

Una migrazione additiva (le tabelle nuove in `public` ricevono da Supabase permessi predefiniti per `anon`, `authenticated` e `service_role`: vanno revocati esplicitamente, compreso `service_role`), nello stile del modulo Partner (funzioni private, wrapper, ricevute idempotenti con `operation_id`, append-only dove si registra la storia, `audit_change_keys` senza testi né indirizzi):

- **configurazione**: riga unica con modalità, profili, limiti giornalieri, indirizzo per i riepiloghi letto dall'ambiente;
- **conversazioni**: una per contatto, con stato (`attiva`, `in_attesa`, `passata`, `ferma`, `chiusa`), solleciti inviati (vincolo 0-2), ultimo invio, ultima risposta, data del prossimo sollecito, versione;
- **messaggi**: inviati e ricevuti, testo completo, oggetto, indirizzi, `Message-ID` unico, `In-Reply-To`, `References`, cartella e UID IMAP, tipo (primo, sollecito, risposta, ricevuto), stato di invio (`pronto`, `in_invio`, `inviato`, `incerto`), versione delle regole usata, esito dei controlli;
- **note dell'assistente**: ricerca con fonti, richiesta scelta e motivo, passaggio a Tommaso con riassunto e proposta di risposta, modello e costo. La ricerca dell'assistente non va in `partners.research`, che ogni import della ricerca sovrascrive;
- **esecuzioni e costi**: una riga per chiamata a Claude con token, ricerche web e costo calcolato;
- **cursore della casella**: `UIDVALIDITY` e ultimo UID letto per cartella.

Nel modulo esistente cambiano solo:

- `partner_activities.origin` accetta anche `assistente` (un solo nome, ovunque: vincolo, trigger, tipi e parser TypeScript, feed). Ogni email dell'assistente lascia una riga di registro (`inviato` con `primo` o `sollecito` per quelle in uscita, `risposta` per quelle in arrivo), così stati e storia restano quelli di oggi. Per una risposta in uscita dentro una conversazione `message_kind` non ha oggi un valore adatto: va aggiunto (per esempio `risposta`). Il testo completo resta nelle tabelle dell'assistente, non nel registro (limite di 4000 caratteri);
- la funzione del trigger dei solleciti, `private.partner_work_activity_trigger()` (ultima versione in `20261023140414_partner_oggi_fixes.sql`): oggi esce subito per ogni origine diversa da `team` e `file`; con origine `assistente` deve chiudere i solleciti del team come per le altre origini ma non crearne di nuovi (i solleciti li gestisce l'assistente), e il controllo «invio più recente» deve contare anche l'assistente. Dopo il `create or replace` va ripetuta la revoca a `service_role`;
- la lettura di Oggi (`partner_today`, nella sua ultima definizione) non mostra tra i «Contatti da fare» quelli seguiti dall'assistente, così nessuno li contatta a mano in parallelo;
- i parser dell'interfaccia (`src/lib/partner/model.ts`, `read.ts`) accettano la nuova origine. Il deploy dell'app va fatto prima che il worker scriva, altrimenti la scheda del contatto si rompe;
- il feed «Controllo CEO»: le funzioni da modificare sono quelle dell'ultima migrazione che le ridefinisce (`20261023184200_foto_nuovi_prodotti.sql`), non le versioni precedenti, altrimenti si perdono le frasi di riassortimento e foto. Con l'attore dell'assistente le frasi diventano «L'assistente ha scritto a Nome (CO n)», «… ha ricevuto una risposta da …», «… ha passato a Tommi la conversazione con …». Il soggetto si lega all'id configurato, non al nome visualizzato. Una transazione per contatto, così il feed non fonde gli invii. Oggi il feed nasconde la chiusura dei solleciti del team solo quando l'origine è `team`: con l'origine `assistente` ogni promemoria chiuso comparirebbe come «ha completato un'attività», quindi va nascosto anche quello. Test in `supabase/tests/ceo-activity-feed.mjs`;

Stati del contatto: l'assistente porta un contatto a «Contattato» con il primo invio e a «Ha risposto» con la prima risposta. Oggi lo fa `record_partner_activity` chiamando `apply_partner_stage`, e lo stesso comando rifiuta i contatti in «Non contattare» (errore 55000): le RPC dell'assistente devono rifare entrambe le cose. Non imposta mai «In trattativa», «Accordo fatto» o «Non interessato» da solo: «Accordo fatto» crea eventi in calendario e le trattative le decide Tommaso. Unica eccezione: un no esplicito porta a «Non interessato», con il motivo nel registro.

Il passaggio a Tommaso imposta `owner_id` sul suo profilo, la prossima azione («Rispondere a …») con la data di oggi, crea un'attività assegnata a lui con scadenza oggi (così compare nella sua Oggi) e porta la conversazione in `passata`. L'attività ha `created_by` esplicito (il default è `auth.uid()`), e si collega al contatto con un `partner_work_links` di tipo esistente, `follow_up`: un tipo nuovo romperebbe il parser di `src/lib/work-links/model.ts`.

L'assistente ha bisogno di due scritture che oggi esistono solo come comandi dei membri: salvare un recapito nuovo trovato dalla ricerca (senza `research_slot`, come i recapiti aggiunti dal team) e mettere un indirizzo in «Non contattare». Per «Non contattare» serve anche una funzione privata che riceva l'indirizzo davvero usato: `partner_blocked` riceve un contatto e confronta i domini di tutti i suoi recapiti, senza eccezioni per i domini generici, e lo stesso indirizzo su due contatti diversi oggi non risulta bloccato. L'import della ricerca può cambiare o disattivare un'email che il team non ha toccato: il messaggio salva l'indirizzo davvero usato.

L'assistente prende solo contatti «Da contattare», senza «Seguito da» e senza attività del team, nel loro periodo (la regola di `partnerDueToday` in `src/lib/partner/periods.ts`, anticipata solo come detto in «Credito e tempi»). Salta quelli con `research_removed_at`, quelli bloccati (`partner_blocked`, controllato anche sul dominio dell'indirizzo davvero usato), quelli senza email attiva e i rapporti già in corso (negozi in conto vendita, accordi «Ci siamo»): per questi, prima del lancio, il team li segna con «Assistente su questo contatto: fermo». Preferisce le email verificate. Per un dominio di posta generico (gmail, outlook…) il confronto si fa sull'indirizzo intero, non sul dominio.

Subito prima di ogni invio, sotto lock, ricontrolla stato, blocchi, conversazione e indirizzo: un import della ricerca o un file «Esporta» caricato nel frattempo può aver cambiato il contatto. L'import della ricerca non tocca mai stato, responsabile, prossima azione, registro e «Non contattare», ma sostituisce `research` e può cambiare i recapiti.

Il compito assegnato a Tommaso nel passaggio non contiene testi né indirizzi dell'email: la tabella `tasks` copia la riga intera nel registro di audit.

### Posta

- Librerie Node: nodemailer per l'invio, imapflow per la casella, mailparser per leggere i messaggi; versioni esatte, pubblicate da almeno due settimane, runtime `nodejs` (le route Edge non fanno SMTP).
- **Invio**: il messaggio si compone una volta sola con il suo `Message-ID`, si salva come `pronto`, passa a `in_invio`, va via SMTP (porta 465 o 587, TLS), poi si copia in «Posta inviata» con IMAP APPEND (la cartella si trova dal flag `\Sent`). Se l'esito dell'invio è incerto non si ritenta mai da soli: si cerca il `Message-ID` nella posta inviata, e se non si trova la conversazione passa a Tommaso. Su «450 limite di invio» si aspetta.
- **Lettura**: IMAP a ogni giro, senza connessioni lunghe; si leggono solo le intestazioni dei messaggi nuovi (cursore per UID), senza segnarli come letti (`BODY.PEEK`), senza spostarli né cancellarli. Si scarica il corpo solo dei messaggi che rispondono a una conversazione dell'assistente (`In-Reply-To`/`References`) o che arrivano da un indirizzo di un contatto. Tutto il resto della casella resta com'è e non arriva mai a Claude: la casella aziendale è anche l'account di servizi come Vercel e riceve accessi e codici. I testi in arrivo si ripuliscono dai caratteri di controllo prima di salvarli.
- **Risposte a mano**: anche «Posta inviata» si legge; un messaggio in una conversazione dell'assistente con un `Message-ID` che l'assistente non ha creato significa che ha risposto una persona, e l'assistente si ferma su quel contatto.
- **Conversazioni già esistenti**: prima della prima email a un contatto, l'assistente cerca nella posta inviata e ricevuta degli ultimi 12 mesi messaggi verso o da quell'indirizzo o dominio. Se ne trova, non scrive e passa il contatto a Tommaso con la conversazione: le email vecchie possono essere scritte con regole superate (conto vendita, allegati). Se Tommaso gli ridà il contatto, l'assistente continua quella conversazione con i solleciti (il caso di Milano AutoClassica).
- **Riconoscimenti**: risposte automatiche (`Auto-Submitted`, `X-Autoreply`, oggetti tipici) e avvisi di mancata consegna (rapporti DSN che citano un nostro `Message-ID`) non contano come risposte.

### Casella aziendale e Gmail

Tommaso usa la casella aziendale da Gmail. Il DNS pubblico, controllato il 27 ottobre: MX su IONOS; SPF `v=spf1 include:_spf-eu.ionos.com ~all`, cioè solo i server IONOS; DKIM con le chiavi IONOS (`s1-ionos`, `s2-ionos`), nessuna chiave Google; DMARC preso da IONOS, `p=none`, senza indirizzo per i rapporti. Due server di inoltro IONOS (`mout-xforward`) risultano nella lista Spamhaus SBL, i server di invio normali no.

Ne seguono tre cose da verificare nel pannello IONOS e in Gmail prima di costruire la parte di posta:

- **Da dove parte la posta.** Se Gmail manda «come» la casella aziendale dai propri server, SPF e DKIM non valgono per il dominio e DMARC fallisce: è la causa più probabile dello spam. Se la manda attraverso il server SMTP di IONOS, va bene.
- **Come arriva la posta in Gmail.** Un inoltro da IONOS passa dai server in lista Spamhaus, e le risposte dei contatti possono finire nello spam di Gmail. Una lettura POP da Gmail può cancellare i messaggi dalla casella IONOS.
- **Cosa resta nella casella IONOS.** L'assistente legge IONOS via IMAP: le risposte devono restare lì (inoltro con copia conservata, oppure POP che lascia una copia sul server). Le risposte che Tommaso manda da Gmail finiscono nella posta inviata di Gmail, non in quella di IONOS: per accorgersene vale la seconda strada descritta in «Risposte» (la risposta successiva del contatto cita un messaggio che l'assistente non ha scritto).

Nel pannello IONOS, visto in sola lettura il 27 ottobre con l'accesso di Tommaso:

- la casella è una Mail Basic da 2 GB, occupata per 0,14 GB: la posta resta su IONOS;
- nessun reindirizzamento e nessuna risposta automatica sulla casella, nessun indirizzo di solo inoltro: Gmail quindi legge la posta da IONOS (probabilmente con POP3), non la riceve per inoltro;
- antispam IONOS attivo al livello medio: i messaggi che IONOS giudica spam finiscono nella cartella spam della casella, che una lettura POP3 da Gmail non scarica. L'assistente deve leggere anche quella cartella, per le conversazioni sue;
- autenticazione a due fattori non configurata;
- server: IMAP `imap.ionos.it` porta 993 (SSL), SMTP `smtp.ionos.it` porta 587 (TLS), POP3 `pop.ionos.it` porta 995;
- record DNS in più rispetto a quelli già detti: una terza chiave DKIM IONOS e le chiavi DKIM di Shopify Email, quindi le email di marketing di Shopify sono già autenticate.

Resta da vedere in Gmail («Account e importazione») da quale server parte la posta inviata come casella aziendale e se la lettura POP3 lascia una copia su IONOS.

Ogni modifica a DNS, inoltri o impostazioni della casella la decide Tommaso, una per una.

### Regole di sicurezza

- **Prova separata dal reale.** I messaggi di prova non creano attività, stati o conversazioni e non contano per i doppioni. La modalità si salva sul messaggio quando nasce e il messaggio parte solo se è ancora quella in vigore; in prova il destinatario deve essere l'indirizzo di prova.
- **Casella protetta.** Al primo errore di accesso alla casella (per esempio una password cambiata) l'assistente si ferma del tutto e non ritenta finché una persona non lo riaccende: troppi tentativi bloccherebbero la posta di tutti. Le cartelle si aprono in sola lettura; l'unica scrittura è la copia in «Posta inviata». Da valutare con Tommi: funzioni Vercel in una regione europea, più vicine a Supabase in Irlanda e meno sospette per IONOS (impostazione di Vercel, serve il suo OK).
- **Un indirizzo, una conversazione.** I doppioni si controllano sull'indirizzo normalizzato, non solo sul contatto: al massimo una conversazione attiva per indirizzo, e per dominio non generico, in 90 giorni (un club e il suo evento possono avere lo stesso indirizzo). «Non contattare» accetta anche un indirizzo intero; oggi accetta solo contatto o dominio.
- **Destinatari.** Si scrive solo a un'email attiva del gestionale o, nelle risposte, al mittente reale della conversazione se è lo stesso indirizzo o lo stesso dominio non generico. Mai Cc, mai «rispondi a tutti», mai un indirizzo indicato dentro un'email o una pagina web: diventa una proposta per Tommaso.
- **Doppioni lato server.** Il comando che registra le attività rifiuta un invio manuale su un contatto seguito dall'assistente, non basta nascondere il pulsante. L'assistente scrive su `partners` solo ai cambi di stato, per non far fallire i comandi del team per conflitto di versione.
- **Niente catene.** Al massimo una risposta dell'assistente per conversazione ogni 24 ore e tre messaggi di fila senza l'intervento di una persona, poi la conversazione passa a Tommaso. L'assistente risponde un'ora dopo l'ultima email ricevuta e rifà la bozza se ne è arrivata un'altra. Non risponde a messaggi con il flag `\Answered`, con `Precedence: bulk` o `auto_reply`, `List-Id`, `X-Auto-Response-Suppress`, né a mailer-daemon. Una risposta arrivata più di due giorni lavorativi prima passa a Tommaso.
- **Bozze vecchie.** La bozza salva la versione della scheda, il recapito e la versione delle regole. All'invio si ricontrollano recapito, «Non contattare», stato, la regola degli eventi alla data di invio e che ogni data citata sia ancora futura. Se qualcosa non torna la bozza si scarta e il contatto torna in coda.
- **Rimbalzi.** Solo un rifiuto `5.1.x` significa indirizzo sbagliato. Un rifiuto `5.7.x` (politica o spam), `4.x.x` ripetuti, la parola «spam» o due rimbalzi definitivi nello stesso giorno fermano tutti gli invii e avvisano Tommaso. A «stop» o «remove» non si risponde: l'indirizzo va subito in «Non contattare».
- **Aggancio delle risposte.** Prima `In-Reply-To` e `References`, poi l'indirizzo esatto, poi il dominio solo se una sola scheda ha una conversazione attiva; i casi ambigui vanno a Tommaso «da smistare». Le email di passaggio, di riepilogo e di prova non portano riferimenti alle conversazioni dei contatti, e l'assistente ignora le risposte a queste email.
- **Errori dell'API.** Credito finito (402): pausa di tutto l'assistente, non un tentativo fallito per contatto. 429, 529, errori 5xx e timeout: attesa per tutti, senza consumare tentativi. Streaming con un timeout sotto i 270 secondi, nessun ritentativo automatico dell'SDK, `max_uses` sugli strumenti web. Una seconda lettura fallita non vale come approvazione: l'invio richiede un'approvazione registrata con l'impronta del testo.
- **Istruzioni dentro email e pagine.** Testi ricevuti e pagine web sono dati, mai istruzioni. Classificazione e risposte girano senza strumenti e con i soli dati di quel contatto; l'output è strutturato con un'azione scelta da un elenco chiuso; indirizzi e azioni li decide il codice. Se qualcuno chiede se scrive una persona o un programma, l'assistente non risponde e passa a Tommaso (gli obblighi di trasparenza dell'AI Act valgono da agosto 2026: da verificare).
- **Esito incerto.** La risposta `250` del server si salva subito, in una transazione propria; prima della copia in «Posta inviata» si cerca il `Message-ID`, per non fare copie doppie.
- **Fusi e calendario.** Con la ricerca si salva il fuso del destinatario (nome IANA validato): senza fuso non si invia. «Oggi» e il riepilogo si calcolano in `Europe/Rome`, con un job orario che guarda l'ora di Roma. Risposte solo tra le 9 e le 18 del destinatario. Nessun invio tra il 21 dicembre e il 7 gennaio né nelle feste nazionali del destinatario. Le date di rientro ambigue si ignorano.
- **Dati personali.** Il filtro della casella è nel codice: i messaggi che non riguardano Partner non arrivano a Claude né ai log. Gli errori di posta si salvano come codici, senza testi o indirizzi. La cancellazione definitiva dei recapiti (`erased_at`) vale anche per i messaggi e le note dell'assistente.
- **Ripartenza.** Anche i solleciti hanno un limite giornaliero: dopo un fermo, quelli scaduti si ridistribuiscono a partire da oggi. Se cambia `UIDVALIDITY` si riparte da `UIDNEXT`, scartando per `Message-ID` i messaggi già visti.
- **Passaggi a Tommaso.** Al massimo qualche email di passaggio all'ora; le altre vanno nel riepilogo.

### Claude

- SDK ufficiale `@anthropic-ai/sdk`, versione esatta. Opus 5.5 (`claude-opus-5-5`) con thinking adattivo per ricerca, scelta, scrittura, seconda lettura e risposte; per i compiti meccanici (riconoscere una risposta automatica, estrarre campi) chi costruisce può usare un modello più piccolo.
- Ricerca con gli strumenti server `web_search` e `web_fetch` (versioni del 2026-02-09), in testo libero con le fonti; poi una seconda chiamata estrae i campi con output strutturato (JSON schema), perché output strutturato e citazioni non stanno nella stessa richiesta.
- Ogni chiamata si ricostruisce dai dati del database: niente blocchi di thinking riportati tra un passo e l'altro. L'eccezione è `pause_turn`: si riprende nella stessa invocazione e, se non basta, si salva il contenuto così com'è, thinking compreso.
- Le regole di scrittura sono un testo nel database, versionato e append-only, che il team modifica dalla pagina dell'assistente: le correzioni di Luca e di Tommaso entrano senza deploy. La prima versione nasce dalle decisioni di questa specifica. Ogni email registra la versione usata. Il testo va nel system prompt con il prompt caching. I controlli nel codice (parole vietate, segnaposto, link, firma) restano nel codice. La pagina `/partner/regole` resta quella di `CONTESTO.md`, che è superato su più punti (firma, conto vendita, allegati, solleciti a 7-10 giorni): la pagina dell'assistente mostra le regole in vigore e lo dice.
- I testi del 27 ottobre (AutoClassica, Porsche Club GB con sollecito, Elferspot), corretti dopo il parere di Luca, entrano nelle regole come esempi di tono, senza dati personali.
- Le varianti di messaggio importate (218, scritte con le regole vecchie, anche con il conto vendita) l'assistente non le usa e non le manda.
- `usage` di ogni risposta si salva con il numero di ricerche web. Se l'API risponde che il credito è finito, l'assistente si mette in pausa da solo: niente nuove ricerche o email, le risposte in arrivo passano a Tommaso, e la striscia lo dice.

### Interfaccia

Nel modulo Partner, senza nuove voci di menu (decisioni sul layout in `docs/workspace-layout.md` e `DESIGN.md`):

- una striscia in cima a `/partner`, sul modello «Area aperta»: «Assistente acceso · 4 email oggi · 12,30 USD spesi» con il pulsante «Ferma l'assistente». Spento o in errore: fondo ambra con la parola scritta;
- una pagina `/partner/assistente` (link nel piede accanto a «Regole per scrivere»): modalità, coda, invii del giorno, ultimo giro, errori, spesa, regole in vigore. Da qui chiunque del team ferma l'assistente o lo rimette in «prepara», e modifica le regole; solo Tommaso (ruolo founder) lo passa a «prova» o «invio»;
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
| `PARTNER_ASSISTANT_SUPABASE_SECRET_KEY` | Chiave segreta Supabase propria dell'assistente (`sb_secret_…`), distinta da quella del worker Shopify; con `NEXT_PUBLIC_SUPABASE_URL` già presente |
| `PARTNER_MAIL_USER`, `PARTNER_MAIL_PASSWORD` | Casella aziendale |
| `PARTNER_MAIL_SMTP_HOST`, `PARTNER_MAIL_IMAP_HOST` | Server IONOS: `smtp.ionos.it` (587, TLS) e `imap.ionos.it` (993, SSL), dal pannello IONOS |
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
- `package.json` (le nuove dipendenze) e le migrazioni sono file in comune con l'altro agente: prima di toccarli, il controllo dei branch aperti previsto da AGENTS.md. Il 27 ottobre l'unico branch aperto con lavoro non unito è di Codex e tocca solo Finance.

## Lasciato a chi costruisce

Nomi di tabelle, funzioni e file; prompt; divisione in moduli; intervallo esatto dei job; scelta del modello per i compiti meccanici; i dettagli dei claim, purché il feed mostri «L'assistente»; formato del riepilogo serale; aspetto dei blocchi nuovi entro `DESIGN.md`.

## Rischi noti

- Consenso per le email commerciali: in Italia, Germania e Spagna la legge chiede un consenso anche verso le aziende; dopo la segnalazione del 26 ottobre Tommaso ha deciso di scrivere a tutti i paesi. L'assistente rispetta subito ogni richiesta di non essere ricontattati.
- Vercel Hobby è per uso non commerciale e non garantisce il servizio, come Supabase Free. Hosting e backup restano come sono finché Tommi non decide (AGENTS.md).
- Un blocco della casella IONOS per spam fermerebbe anche la posta normale: per questo ritmo lento, testo semplice e modalità prova.
- Le email e le risposte salvate nel modulo Partner le vedono tutti e cinque, Luca compreso.
- Limiti di velocità dell'account Anthropic (tier) non noti: da controllare in Console.
- Questa specifica supera la regola di P5 «Nessuna email o notifica esterna automatica» (`2026-10-22-p4-p6-design.md`), per decisione di Tommaso.

## Scelte fatte da Claude, da controllare

Tommaso non le ha decise esplicitamente: sono le scelte di Claude più vicine a quello che ha detto, da confermare o cambiare.

1. L'assistente ha un profilo tecnico «Assistente» senza membership, invece di scrivere a nome di Tommaso: così nel gestionale e nel feed si distingue sempre dalle persone.
2. Le regole di scrittura stanno nel database, versionate e modificabili dalla pagina dell'assistente; ogni email registra la versione usata.
3. Evento «raggiungibile»: in Italia o in un paese confinante.
4. Due consegne, la prima entro il 31 ottobre, per usare il credito prima del 5 novembre.
5. L'assistente non mette mai «In trattativa» o «Accordo fatto»: lo decide Tommaso. Un no esplicito porta a «Non interessato», dopo un grazie breve.
6. Nel passaggio a Tommaso l'assistente non risponde e prepara una proposta di risposta; Tommaso risponde dal suo programma di posta, e l'assistente se ne accorge dalla posta inviata o dalla risposta successiva del contatto.
7. Chiunque del team può fermare l'assistente; solo Tommaso lo manda in prova o in invio.
8. Una ricerca più vecchia di 21 giorni al momento dell'invio si rifà.
9. Senza un fatto vero e recente da citare, la prima email non parte e il contatto passa a Tommaso.
10. Modalità prova per un giorno prima del lancio, con le email verso un indirizzo di Tommaso.
11. Un contatto con una conversazione già esistente negli ultimi 12 mesi passa a Tommaso invece di ricevere una prima email.
12. Riepilogo alle 19, ora di Roma; dopo tre tentativi falliti un lavoro passa a Tommaso.
13. I contatti pianificati per il 2027 che non dipendono da una data (club, brand, media, negozi senza stagione) si anticipano, così il credito si usa prima che scada; quelli legati a un evento restano al loro momento.
14. I numeri di lavoro (corpo tra 110 e 160 parole, solleciti tra 40 e 90, orari 9-12 da martedì a giovedì, risposta entro un giorno lavorativo, un limite giornaliero separato per i solleciti) vengono dalla ricerca sulle email a freddo del 26 ottobre, non da una decisione di Tommaso.
15. I contatti senza email restano fuori: le API ufficiali di Instagram e WhatsApp non permettono messaggi a freddo, e i moduli web li compila meglio una persona.
16. L'assistente scrive a indirizzi trovati dalla ricerca solo se pubblicati dall'organizzazione, e li salva nei recapiti.
17. L'assistente prende solo contatti senza «Seguito da» e senza attività del team; gli altri li lascia alle persone.
18. Le regole di sicurezza sono scelte di Claude, in particolare: una sola conversazione per indirizzo in 90 giorni, nessun invio dal 21 dicembre al 7 gennaio, una risposta dell'assistente ogni 24 ore per conversazione, e la domanda «scrive una persona o un programma?» passata sempre a Tommaso.

## Domande per Tommaso

1. **Credito dopo il 5 novembre.** Risposta del 27 ottobre: per ora non si ricarica; si guarda come funziona e poi si decide. Vedi «Credito e tempi».
2. **Casella aziendale.** Risposta del 27 ottobre: Tommaso usa la casella da Gmail, ma non è chiaro come sia collegata (inoltro da IONOS o lettura POP da Gmail, e da quale server parte la posta). Si controlla insieme nel pannello IONOS e nelle impostazioni di Gmail, come primo passo della sistemazione dello spam. Vedi «Casella aziendale e Gmail».
3. **Milano AutoClassica.** La manda Tommaso a mano entro venerdì 30 ottobre, dalla casella aziendale? Ancora aperta.
