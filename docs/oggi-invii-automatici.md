# Oggi: invii automatici e attività personali

La homepage raccoglie gli invii del gestionale in **Email automatiche di oggi**. È una sola attività del sistema, senza pulsanti di invio o caselle da completare. Il riepilogo distingue prime email agli altri contatti, prime email ai Club e solleciti. I destinatari, le schede e gli orari locali si aprono con «Vedi destinatari e orari»; il calendario email conserva il piano completo.

I numeri provengono dal piano salvato e dagli esiti effettivi delle email automatiche, sul giorno di Roma. Non vengono ricavati dai limiti: se non ci sono solleciti idonei, il riepilogo mostra zero solleciti. Gli invii saltati e quelli con esito incerto restano riconoscibili e non sono presentati come email inviate. Una risposta manuale dalla casella non entra nei contatori delle prime email o dei solleciti automatici.

Le tre quote rimangono **3 prime email agli altri contatti, 3 ai Club e fino a 6 solleciti aggiuntivi**. La classificazione delle prime email segue il modello della bozza; se una bozza storica non è più leggibile, il riepilogo segnala l’errore anziché dedurre il gruppo dalle sezioni attuali. Nessuna lettura della homepage crea appuntamenti, prepara messaggi o avvia il worker. Restano la finestra 9–16 del destinatario e tutti i controlli ordinari della posta.

Lo stato dell’invio è distinto dalla preparazione: la pausa per credito Claude non spegne le bozze già pronte. Modalità disattiva, fermo della casella, attesa e dati non leggibili hanno testi espliciti. Una lettura incompleta non diventa un programma con zero email.

## Agenda e lavoro da fare

Gli appuntamenti restano visibili in Agenda. Le attività personali sono raccolte in un solo elenco richiudibile, con conteggio e numero di arretrati. L’elenco conserva tutti i compiti, compresi i controlli delle possibili risposte creati dal gestionale.

**Partner da seguire personalmente** contiene i contatti e i solleciti ancora manuali, con un riepilogo chiuso inizialmente. Le letture operative sono complete e paginate: i conteggi si calcolano dopo il filtro; soltanto le righe visibili nel dettaglio sono limitate alle prime otto per elenco.

Un primo contatto esce da questa lista soltanto quando l’assistente è configurato in invio, il lavoro è in coda, in attesa o pronto e la scheda non ha assegnatario, prossima azione, data manuale o attività del team. Un assistente spento sul contatto o dati dell’assistente non leggibili conservano il contatto nella lista personale.

Con i solleciti automatici attivi, i vecchi promemoria legati con certezza a un primo invio dell’assistente non vengono più mostrati come email da mandare a mano. I promemoria del team, le provenienze non attribuibili e i normali compiti di controllo restano accessibili. Questo filtro cambia soltanto la presentazione: non chiude attività, non riapre conversazioni ferme e non modifica i dati.

## Verifiche

I test di `src/lib/today/automatic-mail-*.test.ts` verificano riconciliazione del piano con gli esiti, classificazione, quote, date e fusi, letture incomplete e modalità. Quelli di `work-model` e `work-server` verificano conteggi completi, attività manuali, provenienze dei promemoria e fallback conservativi. I test dei componenti controllano riepilogo unico, dettagli chiusi, collegamenti e conservazione delle attività personali.
