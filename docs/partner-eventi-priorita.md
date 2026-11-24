# Prime email: eventi prima, altre proposte dopo l'esaurimento

La decisione del 23 novembre 2026 sostituisce il vincolo esclusivo degli eventi: gli eventi automobilistici verificati nell'Unione Europea e nel Regno Unito rimangono prioritari; dopo il loro effettivo esaurimento riprendono le altre proposte già previste. Il limite rimane **sei prime email complessive per giorno di quota Roma**, oltre al percorso separato dei solleciti.

Questa consegna prepara la modifica. La presenza del codice non attesta il rilascio: merge, migrazione e produzione richiedono l'approvazione prevista da `AGENTS.md`. La migrazione non attiva il fallback, non cambia crediti, interruttori, priorità delle schede o modalità dei solleciti.

## Quando si possono riprendere le altre categorie

Una coda vuota non prova che siano finiti gli eventi. La verifica deve comprendere il catalogo e una ricerca aggiornata presso fonti ufficiali. Un evento UE/UK con edizione futura nota e contatto utilizzabile impedisce l'attestazione anche se non esiste ancora una bozza pronta. Note e attività del team, responsabili, prossime azioni, recapiti bloccati e gestione manuale conservano le esclusioni ordinarie.

Il tag Eventi da solo non identifica una manifestazione: se la scelta corrente classifica espressamente la scheda come negozio, brand, media o club, quella scheda non prova l'esistenza di un evento. Un evento senza data futura resta da verificare e non diventa inviabile per il solo tag. Non si deve cambiare la classificazione per aggirare questi controlli.

Il founder registra una verifica con motivo, fonti HTTPS, giorno corrente e impronta del catalogo. La verifica dura al massimo **48 ore**, è legata a un founder ancora attivo e vale soltanto finché l'impronta coincide e non rimangono eventi contattabili. Nuovi candidati o modifiche pertinenti a schede e recapiti fermano il fallback. Il sistema non dichiara automaticamente che la ricerca sia completa.

La cronologia è append-only. Una revoca si registra come nuova verifica con `exhausted=false`; non si cancellano le prove precedenti. Non sono accettate modifiche dirette o cancellazioni della cronologia.

## Bozze e invii

- Gli eventi conservano l'approvazione specifica del founder, vincolata a bozza, versione, recapito, scelta e fonti, oltre al requisito di evento futuro UE/UK con proposta di stand.
- Le altre categorie richiedono una bozza creata dopo la verifica attiva, la versione corrente della scheda e una scelta autentica: club/merchandising, brand o media/collaborazione, negozio/vendita. Restano necessari i controlli ordinari su hash, revisione, firma, ricerca, recapito, hold, storico e calendario.
- Le vecchie bozze non evento già presenti non si sbloccano applicando la migrazione o registrando una verifica: devono essere ripreparate e ricontrollate.
- La validità della prova si controlla all'istante dello slot e di nuovo all'invio. Uno slot futuro oltre la scadenza non è valido; una verifica rinnovata richiede bozze successive alla nuova verifica.
- Le classi Club/altri possono occupare fino a sei posti se sono gli unici destinatari disponibili, ma condividono il limite complessivo di sei. Invii in corso, riusciti, incerti e prenotazioni di altri fusi concorrono alla stessa quota Roma.
- Finestre locali, festività, margini, distanza tra invii e congelamento della giornata già aperta rimangono. Uno slot scaduto non viene recuperato anticipando nuovi messaggi.

Le funzioni dei solleciti e le loro quote non cambiano. Questa consegna non corregge eventuali problemi di lettura IMAP.

Il Programma email riceve separatamente l'approvazione di ogni evento e la finestra della prova per le altre proposte. La previsione rispetta l'ora esatta di scadenza, il limite complessivo di sei e il medesimo intervallo `start <= istante < end` usato dal mittente. Una nuova scheda evento, una revoca o una versione non più corrente tolgono la finestra dalla lettura successiva. La previsione conserva i ricontrolli del contesto prima dell'invio.

## Contratto della verifica

La RPC `public.record_partner_event_exhaustion(operation_id, payload)` è disponibile soltanto ai founder attivi. Le altre utenze, `anon` e `service_role` non possono registrarla. L'helper privato `record_partner_event_exhaustion_as_founder` mantiene lo stesso controllo sul ruolo per i caricamenti autorizzati effettuati dal proprietario del database.

Il payload comprende `schema_version=1`, `checked_on` uguale al giorno Roma corrente, `expected_catalog_sha256`, `exhausted`, un `reason` di almeno 30 caratteri e da una a dodici `official_sources` HTTPS. L'impronta si legge con `private.partner_event_priority_catalog_sha256(giorno)`; i candidati ancora contattabili si contano con `private.partner_event_priority_pending(giorno)`. Un contesto cambiato restituisce `partner_event_catalog_changed`; un evento residuo restituisce `partner_events_still_contactable`.

La registrazione usa le ricevute idempotenti dell'Assistente. Ripetere lo stesso `operation_id` con lo stesso payload restituisce la ricevuta senza rinnovare la scadenza; riusarlo con un contenuto diverso è un conflitto. Per una nuova verifica serve un'operazione nuova. Nessuna attestazione viene creata dalla migrazione.

`read_partner_email_program` aggiunge `config.eventPriorityFrom` e, per ogni riga, `fallbackWindow` con `start` e `end` della prova attiva oppure `null`. La finestra compare soltanto per una nuova bozza non evento già ammessa dalla policy corrente; `eventApproved` resta esclusivamente l'approvazione editoriale degli eventi. `read_partner_assistant_send` espone `event_priority_from` per la descrizione del limite. I lettori mantengono il contratto precedente quando questi campi non sono ancora presenti.

Per gli eventi del nuovo regime la previsione richiede anche una data futura nota. `eventStartsOn` usa prima la data non vuota della scelta e poi quella della scheda, come il controllo del mittente; l'approvazione editoriale da sola non inventa una data.

## Ordine di rilascio

Dopo l'OK esplicito di Tommi: merge, deploy dell'applicazione con i nuovi lettori compatibili con il database precedente, applicazione della migrazione SQL, quindi smoke test di Assistente, Programma email e piano d'invio. L'ordine conta perché i vecchi parser severi rifiutano i nuovi campi. Non si registra alcuna attestazione di esaurimento durante il rilascio: serve una verifica effettiva del catalogo e delle fonti quando gli eventi contattabili saranno finiti.

## Verifiche locali

L'harness `supabase/tests/partner-eventi-priorita-fallback.mjs` usa PGlite, Auth simulata e dati sintetici. Verifica permessi, prove scadute o cambiate, candidati senza bozza, nuove bozze, priorità e perimetro eventi, revoca, quote miste e di un solo gruppo, invii incerti, fusi e congelamento degli slot. Si registra autonomamente in `npm run test:db`.
