# Risposte IONOS da moduli e invii manuali

Questa consegna estende la lettura della casella aziendale ai contatti già avviati dal team, anche quando il primo contatto è un modulo sul sito dell'evento. Il codice preparato non equivale all'attivazione: migrazione e rilascio in produzione richiedono l'OK di Tommi.

## Che cosa viene registrato

Lo scheduler esistente propone un giro ogni due minuti. Prima di tentare un invio, il worker legge in sola lettura i nuovi messaggi della cartella INBOX. Il percorso è indipendente dai cicli dei solleciti e non usa modelli o credito Anthropic.

La registrazione automatica richiede un precedente contatto nella scheda e un collegamento univoco. Può derivare dai riferimenti a un invio noto, dall'indirizzo email verificato o già associato a una risposta registrata oppure, per un modulo inviato nei 90 giorni precedenti, dal nome distintivo dell'evento presente nell'oggetto. Il solo dominio email e parole generiche come «Classic» non bastano. Se due schede sono compatibili, il caso va in revisione.

Quando una risposta da modulo identifica un nuovo referente, il suo recapito viene conservato con la provenienza IONOS. Questo non equivale a dichiararlo verificato sul sito e non lo iscrive agli invii automatici. Il collegamento già accertato permette di registrare anche i messaggi successivi dello stesso referente con un oggetto diverso. Le risposte da recapiti già associati non hanno il limite dei 90 giorni.

Una risposta umana riconosciuta aggiunge una voce al Registro e porta «Da contattare» o «Contattato» a «Risposto». Gli stati commerciali successivi e le chiusure vengono conservati. Un nuovo messaggio sullo stesso contatto aggiunge un nuovo sviluppo anche se la scheda è già in «Risposto».

Il Registro conserva mittente, data di ricezione, oggetto e, quando leggibile, un estratto limitato del testo. Il contenuto è trattato come testo, senza eseguire istruzioni presenti nell'email. Allegati e messaggio completo restano nella posta.

## Conferme automatiche e dubbi

Newsletter, messaggi fuori ufficio, notifiche di mancata consegna e conferme automatiche non sono risposte umane. Non devono far avanzare lo stato commerciale. Un caso pertinente ma non attribuibile con certezza richiede una verifica del team.

L'importazione non iscrive contatti all'assistente, non crea cicli automatici e non riattiva invii esclusi o sospesi. Le regole dei moduli gestiti personalmente dal founder restano valide: leggere una risposta e inviare un sollecito sono operazioni distinte.

## Continuità e duplicati

La lettura parte dall'attivazione della nuova funzione. Non rilegge automaticamente tutto lo storico, dove il team potrebbe avere già annotato le risposte a mano. Usa UID e UIDVALIDITY della cartella per recuperare i nuovi messaggi anche dopo una disconnessione o una ricostruzione della casella.

L'identificativo del messaggio impedisce di aggiungere due volte la stessa risposta, anche tra il nuovo importatore e il percorso storico dei solleciti. Il cursore avanza solo dopo una registrazione riuscita. Una lettura incompleta viene ritentata; non equivale a «nessuna risposta».

La lease della casella è condivisa con gli invii. Il worker rispetta il limite totale di 300 secondi: se la lettura ha già consumato il tempo necessario alla preparazione di una bozza, rimanda quella preparazione al giro successivo. Un avvio ogni due minuti non garantisce una registrazione entro due minuti in presenza di code, errori di rete o lease già occupata.

## Perimetro

La funzione riguarda la casella IONOS configurata e i messaggi ancora presenti in INBOX quando avviene il controllo. Gmail personale resta un canale distinto. Le verifiche per i solleciti conservano anche il loro controllo delle altre cartelle e dei riferimenti alla conversazione.

L'implementazione usa `inbox.ts`, `inbox-mailbox.ts`, `inbox-store.ts` e la migrazione `20261118112121_partner_ionos_inbox.sql`. Le nuove RPC sono riservate al servizio server. I test usano esclusivamente dati sintetici e database locali.

## Migrazione in produzione, 18 novembre 2026

Applicata con l'OK di Tommi prima del merge. Il database ha assegnato la versione `20261118112121`; il file è stato rinominato senza modificare il testo SQL. L'impronta MD5 del testo salvato in cloud coincide con quella del file: `2593c6b892587e44fb9b434129a6a099`.

Impronte di Partner, recapiti, attività, attività del team, configurazione e scheduler identiche prima e dopo la migrazione. Importata una ricevuta storica per evitare duplicati; cursore vuoto e data di attivazione ancora nulla, in attesa del primo giro del nuovo codice. Verificati i grant riservati al servizio e la compatibilità del percorso precedente.

Per il rilascio autorizzato, prima del deploy la soglia di lettura è stata impostata all'istante iniziale della migrazione, con cursore ancora vuoto e nessuna lease del nuovo importatore. Il primo giro comprenderà quindi anche le email ricevute durante il rilascio; non rileggerà quelle precedenti alla migrazione.
