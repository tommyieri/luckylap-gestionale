# Programma email Partner

Richiesta di Tommi del 4 novembre 2026: vedere i destinatari, il testo e il motivo delle prime email dell'assistente, con una previsione per oggi, domani, dopodomani, due settimane e un mese. Le sezioni Vendita, Eventi, Collab e Club restano disponibili; la capacità si divide sempre tra Club del modello e altri contatti. Durante il lavoro gli invii restano attivi, come richiesto da Tommi.

## Calendario

La pagina `/partner/email` legge uno snapshot coerente della coda e del calendario effettivo del database. Le fasce rispettano fuso del destinatario, fine settimana, feste conosciute, pausa natalizia e copertura del calendario. La previsione usa la quota del giorno di Roma, il passaggio da cinque a dieci dopo la prima settimana, la divisione tra i due flussi e la precedenza effettiva delle bozze. Un contatto Club che è anche un evento resta nel flusso degli altri contatti.

Le previsioni si calcolano sull'intera coda prima dei filtri visivi. Nascondere una sezione non ne libera i posti. Per gli intervalli casuali si assume un passo di otto minuti: date e ore future sono stime aggiornabili, non appuntamenti prenotati. Una conversazione trovata nella casella, un rimbalzo o una modifica alle schede può ancora cambiare il programma.

Le righe senza testo pronto restano visibili come «Da preparare», «In attesa» o «Da rivedere». La lista comprende anche i contatti idonei per cui non esiste ancora un lavoro, letti senza crearne uno: nome e scheda restano visibili anche durante la pausa per credito, senza testo o data inventati. La lettura rifiuta esplicitamente uno snapshot che superi 2.000 destinatari complessivi o 2.000 messaggi nel periodo, invece di troncarlo. `write_on` è la ripresa della preparazione, non una prenotazione SMTP. La pausa per credito blocca nuove bozze, mentre quelle pronte continuano a essere inviate. Le email già partite mostrano il testo effettivo del messaggio registrato e l'ora dell'invio; le prove sono riconoscibili e si possono escludere. Non si mostrano raw MIME o PDF codificati.

## Modifica del testo

Tommi apre un'email e sceglie «Sospendi e modifica». Il database prende una sospensione editoriale persistente per quella bozza, con verifica della versione. La sospensione non cambia l'interruttore del contatto né il resto della coda; resta anche se la scheda del browser viene chiusa. Riaprendo la bozza si ritrova la modifica aperta; il comando «Annulla modifica» riprende il testo precedente solo se il contesto è ancora valido.

«Salva il testo da inviare» crea una revisione append-only con approvazione umana, conserva la ricerca originale e la sua scadenza, aggiorna il puntatore del lavoro e toglie la sospensione nella stessa transazione. La firma e la frase di uscita restano separate dal corpo modificabile. Nessuna ricerca o seconda lettura di Claude è richiesta da una modifica del founder.

La presa del lavoro, la preparazione del MIME e l'ultimo controllo prima di SMTP rispettano la sospensione e il puntatore corrente. Un messaggio vecchio soltanto preparato viene scartato. Quando SMTP è già stato avviato, il comando di modifica viene rifiutato: non è possibile promettere l'annullamento di un messaggio che potrebbe essere già partito. Le prove ancora pendenti bloccano la modifica delle bozze che utilizzano.

Una revisione umana che diventa obsoleta torna alla revisione di Tommi e non viene sovrascritta automaticamente dal modello. La cancellazione definitiva del contatto elimina anche le sospensioni collegate e non consente a un vecchio token di ricreare il testo.

## Tono delle prossime email

La presentazione parte da LuckyLap, dai prodotti, dalla proposta concreta e dal suo valore per il destinatario. La policy di scrittura e controllo supera le vecchie richieste di recapito, chiamata o appuntamento; la domanda finale è facoltativa. La firma aziendale resta disponibile. Le bozze già pronte non vengono riscritte né invalidate in blocco: Tommi le legge e può salvarne la versione desiderata dal calendario.

Questa consegna non aggiunge solleciti o risposte automatiche: il promemoria dopo sette giorni resta un'attività manuale.
