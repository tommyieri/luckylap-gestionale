# Invii Partner distribuiti nella giornata

Nuova consegna del 9 novembre 2026, branch `codex/partner-invii-distribuiti`. Il documento descrive il codice del branch e non attesta l'applicazione delle migrazioni o l'attivazione in produzione.

Gli invii veri, prime email e solleciti, usano una finestra **9:00–16:00 nell'ora del destinatario**. Il database sceglie i candidati idonei e prepara un piano condiviso dai due percorsi. Gli orari del piano sono quelli controllati dal worker; la pagina non crea un secondo calendario in TypeScript.

## Gruppi, orari e quote

Un gruppo comprende i destinatari con la **stessa data locale e la stessa finestra effettiva in UTC**. Non si divide per il solo nome del fuso: Roma, Parigi e Berlino condividono il gruppo quando gli intervalli coincidono. Un fuso con un'altra finestra effettiva forma un gruppo distinto. L'ora legale viene risolta dal fuso IANA e dal calendario SQL, senza spostamenti inventati dal browser.

Per ogni gruppo pianificato prima dell'apertura, gli orari sono distribuiti regolarmente dalle **9:00 alle 15:55 locali**. Con un solo invio si usa il centro dell'intervallo, **12:27:30**. Per esempio, dodici invii nello stesso gruppo hanno circa 37 minuti e 44 secondi di distanza. Un piano che nasce dopo le 9 usa invece il tempo residuo, da almeno **due minuti dopo la preparazione fino alle 15:55**: anche il centro per un solo invio si calcola su quel tempo, quindi non è sempre 12:27:30. Il target finale delle 15:55 conserva spazio per i controlli: l'ultimo avvio deve comunque rispettare il termine delle 15:58:30 e il margine di 90 secondi prima delle 16:00.

Le quote restano sul **giorno di Roma**, anche se il destinatario ha un'altra data locale:

- al massimo **6 prime email**, con quote rigide di **3 Club e 3 altri**, senza trasferire posti inutilizzati;
- fino a **6 solleciti aggiuntivi**, con contatore separato e senza sottolimiti Club/altri.

Una quota è un massimo, non un obiettivo da raggiungere usando contatti non idonei. Il tetto di venti bozze Club pronte continua a riguardare la scorta, non gli invii. Nessun piano consente di superare fermo, quota, idoneità o verifiche della posta.

Uno slot perso non viene recuperato con una raffica di invii. Dopo l'apertura gli altri slot del gruppo restano agli orari assegnati anche quando uno salta: non si anticipano per riempire un buco. La lettura mostra gli slot correnti, compresi quelli scaduti o saltati e il loro eventuale motivo; non li presenta come già inviati. Gli slot sostituiti da una ripianificazione non duplicano le righe del piano corrente. Non si usa più l'intervallo casuale di 4–11 minuti per gli invii veri; resta un **intervallo minimo condiviso di due minuti dall'esito reale**, oltre a lease, fermi e controlli. **Le prove conservano il percorso precedente e il loro intervallo di 4–11 minuti.**

Gli stessi massimi di 3 prime Club, 3 altre prime e 6 solleciti valgono anche per il singolo gruppo locale: attraversare la mezzanotte di Roma non raddoppia gli invii di quella finestra. Il rientro da un fuori ufficio certo viene confrontato con il giorno locale del destinatario, senza anticiparlo quando Roma è già al giorno successivo.

## Cosa si vede

Il **Piano d'invio del giorno** compare nel Calendario email e nella pagina Assistente. Per ciascun invio mostra contatto e CO, prima email o sollecito, ora e data locale, ora di Roma, ultimo orario utile e stato. I collegamenti «Oggi» e «Domani» aprono il relativo piano nel Calendario. L'orario programmato resta subordinato ai controlli prima dei byte SMTP e alla disponibilità del worker; non certifica consegna né assenza di risposte.

La RPC membro `read_partner_send_plan(p_day)` legge soltanto il piano già salvato. Espone `day`, `generated_at`, `mode` e `slots`; ogni slot contiene `id`, `kind`, `partner_id`, `co`, `name`, `timezone`, `local_day`, `planned_at`, `expires_at`, `status` e `reason`. Nessun indirizzo, intestazione, MIME o token entra nel pannello. La lettura non materializza slot e non invia messaggi. Un piano senza righe resta distinto da una RPC assente, errore o DTO non valido: in questi ultimi casi il pannello dice che gli orari non sono leggibili, senza interrompere le altre sezioni.

La coda del Calendario mantiene le previsioni delle **sole prime email per giorno stimato a Roma**, con quote, calendario, freschezza e stato della bozza. Non assegna più ore a passi di otto minuti. Le ore si leggono esclusivamente nel piano salvato; il dettaglio e la revisione del testo delle prime email restano disponibili. Questo pannello non aggiunge un editor dei solleciti.

Restano giorni feriali, feste conosciute, blackout dal 21 dicembre al 7 gennaio e guardia di copertura al **31 dicembre 2027**, con lo stesso perimetro nazionale del [calendario verificato](partner-calendario-2027.md). I solleciti conservano modalità separata, fuori ufficio con data certa, ricerca fresca, approvazione editoriale e due verifiche della casella: vedi [Solleciti automatici](partner-solleciti-automatici.md).
