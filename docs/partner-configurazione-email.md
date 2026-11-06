# Configurazione delle prime email Partner

Il Passo 1 introduce lo storico delle istruzioni scritte da Luca per la struttura delle prime email. La [versione 1](../data/partner-email-config-v1.json) conserva il documento di partenza e rende esplicita la scelta approvata per Negozio B: nel filone per officine e restauratori la grafica dedicata è la proposta principale, con la selezione di magliette tra le possibilità secondarie. L'alternativa a blocchi per i Club resta spenta.

## Versioni e permessi

`partner_email_config_versions` conserva una riga per versione, con configurazione, nota, autore e data. La tabella è separata da `partner_assistant_rules`, il cui comando di salvataggio può rimettere in lavorazione bozze già pronte. Le migrazioni creano la tabella, importano la versione 1 e aggiungono il riferimento nelle bozze generiche. La migrazione di import riproduce il JSON della versione 1 e l'harness SQL verifica che i contenuti coincidano.

La lettura è riservata ai membri attivi. Il salvataggio passa da `savePartnerEmailConfig`, che verifica la sessione e il ruolo founder prima di usare il client server dell'assistente. La RPC è accessibile al ruolo di servizio e ricontrolla la membership dell'autore. La versione attesa protegge da modifiche concorrenti e l'identificativo dell'operazione rende sicuro ripetere un salvataggio con lo stesso contenuto dopo una risposta incerta. Il database assegna il numero della nuova versione e lo riporta anche nel campo `meta.versione`.

Zod controlla la struttura sia al salvataggio sia quando si legge una versione. Il testo delle istruzioni passa senza ritocchi, compresi gli spazi e le righe a capo. I controlli includono il limite per campo, una domanda con un solo punto interrogativo e la somma dei budget dei blocchi entro 110–160 parole. I campi fissi, il modello Club e gli esempi scritti a mano sono protetti anche al salvataggio.

## Collegamento alle bozze

`partner_assistant_drafts.config_version` può riferirsi alla versione usata per una bozza generica. Il riferimento viene salvato nella stessa transazione della bozza e della ricevuta. Le bozze prodotte con il flusso attuale lasciano il campo vuoto. Dal Passo 2, chi compone una nuova bozza generica indicherà la versione effettivamente usata, così scrittura, riscrittura e revisione potranno riprendere lo stesso contenuto. Il riferimento è distinto da `rules_version`.

Il pulsante proposto «Riscrivi le bozze pronte con la nuova versione» è una funzione facoltativa da discutere a parte. Ogni salvataggio della configurazione produce una versione destinata alle nuove preparazioni. Per ripristinare il testo di una versione precedente si può salvarne il contenuto come nuova versione, conservando la cronologia. Le migrazioni sono additive e la rimozione dello schema richiederebbe una migrazione successiva, dopo aver verificato che nessuna bozza lo referenzi.
