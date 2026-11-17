# Prime email per eventi UE e Regno Unito

Decisione di Tommi del 17 novembre 2026. Dal **18 novembre, sul giorno di Roma**, le prime email hanno un massimo comune di **sei al giorno**, riservato agli eventi nell’Unione europea e nel Regno Unito con una proposta di stand. La scelta supera la precedente ripartizione di tre Club e tre altri contatti. La migrazione e la pubblicazione del codice richiedono l’OK di Tommi. Questo documento descrive la consegna preparata nel branch, senza attestarne l’attivazione.

## Selezione e approvazione

La sezione «Eventi» contiene anche sedi e negozi. Per entrare nel piano una bozza deve quindi avere un’approvazione editoriale esplicita del founder, dopo aver verificato che la proposta riguardi un evento reale futuro. Si conservano le fonti ufficiali consultate. Una data ancora da annunciare resta vuota.

L’approvazione riguarda la bozza corrente, la sua impronta, la versione della scheda, la scelta e la versione del recapito. La scelta deve indicare `contact_kind=evento`, `request=stand_evento` e un paese UE o Regno Unito. Il paese della scheda deve rientrare nello stesso perimetro. Una modifica a questi dati richiede una nuova approvazione. Svizzera, Monaco, Norvegia e dipendenze della Corona britannica sono fuori dal perimetro.

Il comando autenticato è `public.approve_partner_event_first_draft(operation_id, payload)`. Il payload contiene `schema_version=1`, `partner_id`, `draft_id`, `expected_partner_version`, `expected_sha256` e `official_sources` (da uno a dodici URL HTTPS). Il comando è riservato al founder e restituisce una ricevuta idempotente. La variante privata `approve_partner_event_first_draft_as_founder(actor_id, operation_id, payload)` permette lo stesso intervento amministrativo al proprietario del database, verificando che `actor_id` sia un founder attivo. Il servizio della posta non può approvare bozze.

La preparazione di una nuova prima email continua a usare le RPC esistenti per ricerca, scelta, scrittura e controllo. Una revisione del testo tramite «Sospendi e modifica» conserva ricerca e scelta, quindi una vecchia proposta co-firmata richiede anche la preparazione del nuovo contesto per lo stand.

## Invio e calendario

Il controllo del perimetro e dell’approvazione è ripetuto nello snapshot del piano, nella preparazione e nell’ultimo controllo prima di SMTP. Gli slot già preparati per un contatto escluso perdono validità. Una bozza preparata il 17 novembre per il giorno successivo deve già soddisfare la scelta nuova.

Prima del 18 novembre valgono le quote precedenti. Dal 18 sei eventi possono condividere la stessa finestra locale, con gli intervalli e le finestre già previsti. Il limite effettivo delle prime email è sei anche se il precedente campo numerico conservava un altro valore. La pagina Assistente mostra la scelta attiva e il Programma email usa la stessa ripartizione.

I solleciti mantengono il massimo separato di sei, le conversazioni, i paesi, le scansioni della casella e i controlli esistenti. La scelta delle nuove prime email lascia proseguire il seguito di Club, negozi e contatti fuori UE/Regno Unito.

## Verifiche

I test usano solo dati sintetici. Controllano sei eventi nella stessa finestra, esclusione delle bozze senza approvazione e dei paesi fuori perimetro, scadenza dell’approvazione quando cambiano scheda o recapito, quote precedenti e prosecuzione dei solleciti già avviati.
