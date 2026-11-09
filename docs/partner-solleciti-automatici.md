# Solleciti automatici Partner

Funzione preparata nel branch `codex/partner-solleciti-automatici`, il 9 novembre 2026. Questo documento descrive il codice della nuova consegna: **non ne attesta il rilascio o l'attivazione in produzione**. L'applicazione della migrazione e l'accensione dell'invio richiedono l'OK di Tommi. Il piano della consegna 2b resta uno storico; per questo percorso valgono le regole qui sotto.

## Ciclo e modalità

Il ciclo parte da una prima email vera dell'assistente con esito «inviato». Non parte da prove, invii incerti o messaggi registrati a mano. Prevede al massimo **quattro solleciti, a 7, 17, 45 e 90 giorni dalla prima email**, con almeno 7 giorni di calendario, sul giorno di Roma, dall'ultimo invio reale del ciclo. Una partenza ritardata sposta in avanti la scadenza successiva quando serve a conservare questa distanza. La scadenza è il primo giorno utile: finestre, feste, quote e controlli possono rimandare l'invio.

La nuova configurazione dei solleciti è separata da quella delle prime email e nasce in **«osserva»**. Solo il founder può cambiarla, con una versione attesa e una ricevuta dell'operazione.

| Modalità | Comportamento |
| --- | --- |
| Spento | Il percorso dei solleciti non prende conversazioni. |
| Osserva | Controlla la posta e segnala i casi da verificare. Nessun sollecito parte; i promemoria manuali di Tommi restano validi. |
| Invio | Può inviare un sollecito dovuto con bozza valida, dopo i due controlli della casella e l'autorizzazione finale del database. La modalità generale dell'assistente deve essere «Invio». |

La preparazione Anthropic può restare in pausa per credito: questo percorso non chiama Claude e non usa credito Anthropic. Una risposta o un altro segnale dubbio ferma i solleciti su quella conversazione e richiede il controllo di Tommi. L'assistente **non risponde automaticamente alle persone**. «Possibile risposta» comprende anche messaggi ambigui e scambi che non si riescono ad attribuire con certezza.

Per la decisione di Tommi del 9 novembre, un messaggio fuori ufficio riconosciuto dalle intestazioni di risposta automatica e con **data di rientro certa, completa di anno**, rinvia il sollecito a quella data e mantiene il ciclo attivo. Il riconoscimento copre italiano, inglese, tedesco, francese e spagnolo; non interpreta una data generica del testo come rientro. Sono riconosciuti solo messaggi completi in testo semplice con struttura supportata: altri formati o contenuti non compresi richiedono il controllo di Tommi. Alla ripresa valgono comunque tutti i controlli della posta, le quote e il calendario. Una data assente, impossibile o ambigua lascia il caso fermo per Tommi. Un fuori ufficio riconosciuto con rientro già raggiunto non blocca da solo il ciclo; la scansione continua a cercare eventuali altre risposte. Una risposta umana non viene ignorata perché contiene anche una data.

## Preparazione editoriale di Codex

Ogni sollecito richiede una bozza specifica preparata da Codex, con ricerca fresca, fonti ufficiali e seconda lettura del testo prima del salvataggio. Il controllo ricorrente di questa preparazione va attivato dopo il rilascio; la presenza del codice non lo rende già operativo. La coda di preparazione contiene i cicli attivi dovuti entro il giorno successivo e privi di una bozza valida.

La preparazione confronta prima email, eventuali solleciti precedenti e informazioni verificate al momento della scrittura. Non ripresenta un evento passato come futuro, non inventa fatti nuovi e non copia istruzioni operative dalle fonti esterne. Se non ci sono elementi affidabili per scrivere, la bozza resta da preparare: non si sostituisce una verifica con un fatto inventato.

Le bozze vengono salvate con ricerca, fonti, versione della scheda, del recapito e delle regole, numero del sollecito e impronta del testo. L'approvazione è editoriale del founder, con `prepared_by=codex` e `approval_source=founder_edit`: **non viene attribuita a Claude una lettura che non ha fatto**. Le RPC di salvataggio ammettono solo il founder; il servizio della posta legge e invia soltanto il materiale già approvato.

Il corpo ha **40–90 parole**, escludendo la prima riga del saluto, l'ultima di chiusura, firma e frase di uscita. Contiene una sola domanda di collaborazione. Restano i controlli delle prime email su parole vietate, segnaposto, firma, lingua, modelli Porsche e link. Per i Club la firma conserva il cognome previsto dal percorso della prima email. Non si aggiungono prezzi, condizioni commerciali, richieste di telefono, chiamate o appuntamenti. Il riferimento al singolo caso Porsche Club Toscana e alla commessa delle 150 magliette resta escluso. Sono le indicazioni aggiornate di Luca, non la vecchia richiesta di un recapito telefonico del piano iniziale.

L'oggetto è quello della prima email con un solo `Re:`. Il messaggio resta nello stesso thread: `In-Reply-To` punta al primo Message-ID e `References` conserva i Message-ID noti, con quello iniziale al primo posto. Corpo, firma e frase di uscita localizzata sono composti dal codice. **Nessun PDF, lookbook o altro allegato accompagna un sollecito**, anche quando la prima email Club aveva il suo PDF. Il testo non deve promettere un allegato assente. Solo testo semplice, nessuna immagine o tracciamento.

Il validatore TypeScript controlla il testo e il MIME; non dimostra da solo la freschezza della ricerca, la verità dei fatti o una seconda lettura. La preparazione editoriale deve verificarli realmente.

## Controlli prima dei byte SMTP

Il percorso usa la stessa lease della casella e lo stesso intervallo tra gli invii delle prime email, senza due invii concorrenti. I contatori giornalieri delle due categorie restano separati. Un giro prende una sola conversazione. La lettura ordinaria viene ripianificata dopo 30 minuti; una verifica incerta rinvia il controllo e non autorizza l'invio.

1. Lo scanner apre la casella in sola lettura e scandisce tutte le cartelle selezionabili, comprese posta in arrivo, inviata, spam e archivi disponibili. Confronta gli indirizzi verificati e i Message-ID della conversazione. Non interpreta l'assenza di dati come assenza di risposte.
2. Un risultato completo e senza segnali da controllare produce una prova breve nel database. Il database la lega a lease, conversazione, versione e bozza. Solo allora si prepara il MIME immutabile del sollecito.
3. Dopo il login SMTP, **prima della chiamata che consegna i byte**, lo scanner rilegge completamente la casella. Questa seconda prova deve essere nuova, successiva alla preparazione e legata anche a quel MIME. La prima prova non può sostituirla.
4. L'autorizzazione finale ricontrolla prova ancora valida, contatto, recapito e relative versioni, regole, stato del ciclo, modalità, data dovuta, finestre, intervallo e quote. Una prova dura 30 secondi; dati o contesti superati impediscono la partenza.
5. Dopo l'esito, il database registra una sola volta invio e numero del sollecito. Solo un invio riuscito chiude i promemoria manuali del ciclo. Dopo il quarto il ciclo termina. Gli stessi byte del MIME vengono copiati nella posta inviata dal percorso ordinario.

Cartella mancante o cambiata durante la lettura, limite di scansione superato, ricerca interrotta, connessione dubbia, risposta possibile, stop, rimbalzo o invio manuale impediscono l'invio automatico. Il solo fuori ufficio con data certa segue il rinvio descritto sopra. Contatto assegnato al team, prossima azione, stato commerciale diverso, assistente fermato, «Non contattare», recapito cambiato o cancellato bloccano il ciclo. Una bozza con contesto o ricerca superati deve essere preparata di nuovo.

Se l'esito SMTP è **incerto**, la conversazione si ferma e quel messaggio non viene ritentato. Anche un processo interrotto durante l'invio viene recuperato come incerto. Gli errori della casella e i rimbalzi condividono i fermi e le attese già previsti per le prime email.

## Quote e calendario

La scelta finale di Tommi del 9 novembre 2026 è **6 prime email al giorno di Roma, al massimo 3 Club e 3 altri contatti, più un massimo separato di 6 solleciti al giorno**. Le quote delle prime email sono rigide: i posti di un gruppo restano vuoti se quel gruppo non ha candidati lavorabili. I sei solleciti aggiuntivi non hanno sottolimiti Club/altri e non consumano posti delle prime email; possono riguardare anche un solo gruppo. Questa scelta supera l'ipotesi precedente dello stesso giorno di includere entrambi i tipi entro sei invii totali. Il massimo teorico è quindi dodici invii reali, senza garantirne la partenza: finestre, intervallo e controlli possono ridurli. Il tetto di 20 Club pronte riguarda la scorta delle prime bozze, non il numero di invii del giorno.

Le prime email pronte e idonee hanno la precedenza, quando finestra e intervallo permettono di lavorarle. Ogni giro prova prima il loro percorso; passa ai solleciti soltanto se quel percorso non ha lavoro da eseguire (`idle`). Un invio, un esito incerto, un fermo o il recupero di una copia nella posta inviata chiudono il giro senza tentare un secondo invio. Non si aspetta il completamento di sei prime email quando mancano candidati idonei: una quota massima non garantisce che ci siano sei invii eseguibili.

Restano le finestre 9:30–11:00 dell'ora del destinatario, i giorni ammessi, le feste, l'intervallo casuale di 4–11 minuti e la sospensione dal 21 dicembre al 7 gennaio. **La nuova migrazione del calendario estende la copertura verificata fino al 31 dicembre 2027**, così anche il quarto sollecito delle prime email di novembre può trovare una finestra a febbraio. Dopo il 31 dicembre 2027 la finestra si chiude per ogni paese fino a una nuova estensione verificata. Restano finestra, margine e blackout originari; fonti e perimetro in [Calendario Partner 2027](partner-calendario-2027.md). La precedente scadenza del 31 gennaio appartiene al calendario della consegna 2a.

## Nella scheda contatto

Il blocco «Assistente» conserva la prima email e mostra separatamente i metadati del ciclo: modalità, solleciti inviati su quattro, prossima scadenza e ultima verifica della casella registrata. La data dell'ultimo controllo non certifica che l'esito fosse completo e senza risposte. Un ciclo fermo invita Tommi a controllare la conversazione, senza dichiarare che una persona abbia certamente risposto. Il rinvio certo mostra «Fuori ufficio: sollecito non prima del …»; una verifica incerta resta distinta da questo rinvio.

In «osserva» e «spento» il promemoria manuale resta visibile. Solo quando il nuovo stato è leggibile e la modalità dei solleciti è «invio» scompare la vecchia frase «il sollecito dopo 7 giorni lo manda Tommi». RPC assente, DTO superato o lettura fallita mostrano «Verifica dei solleciti non leggibile», senza nascondere la prima email o presumere un'automazione attiva. Il contatore «Prime email oggi» e il limite modificabile della pagina Assistente riguardano soltanto le prime email. Una nota indica i sei solleciti aggiuntivi e la necessità di attivarli; non viene mostrato un totale giornaliero dei solleciti, non presente nella risposta della RPC. Il Programma email e le viste delle prime email filtrano `kind=primo`, sia nello storico sia nei conteggi delle quote.

## Confini della verifica e configurazione

La verifica riguarda la casella configurata e i messaggi ancora disponibili nelle cartelle osservate, dall'inizio della conversazione. Non offre certezza sui messaggi cancellati definitivamente, su altre caselle o su alias non associati alla scheda. Non legge la mente del destinatario e non prova che un'email sia arrivata in posta in arrivo. Una risposta trovata ferma il percorso automatico; il seguito commerciale resta umano.

Non servono nuove variabili d'ambiente: si riusano la configurazione server dell'assistente e della posta. Nessun segreto o recapito entra in questa documentazione. Una modalità salvata nel database è distinta dall'effettiva autorizzazione SMTP, che viene ricontrollata per ogni messaggio.

Il codice principale è in `src/lib/partner-assistant/followup.ts`, `followup-store.ts`, `followup-mailbox.ts` e `followup-compose.ts`; le RPC e le prove sono nella migrazione `20261109104133_partner_solleciti_automatici.sql`. Lo stato della scheda passa da `read_partner_followup` al parser `src/lib/partner/followup-status.ts`. I test usano dati sintetici, caselle simulate e database locali; non attestano un rilascio o un invio reale.
