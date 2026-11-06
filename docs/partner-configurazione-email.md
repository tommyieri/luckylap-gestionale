# Configurazione delle prime email Partner

Il Passo 1 introduce lo storico delle istruzioni scritte da Luca per la struttura delle prime email. La [versione 1](../data/partner-email-config-v1.json) conserva il documento di partenza e rende esplicita la scelta approvata per Negozio B: nel filone per officine e restauratori la grafica dedicata è la proposta principale, con la selezione di magliette tra le possibilità secondarie. L'alternativa a blocchi per i Club resta spenta.

## Versioni e permessi

`partner_email_config_versions` conserva una riga per versione, con configurazione, nota, autore e data. La tabella è separata da `partner_assistant_rules`, il cui comando di salvataggio può rimettere in lavorazione bozze già pronte. Le migrazioni creano la tabella, importano la versione 1 e aggiungono il riferimento nelle bozze generiche. La migrazione di import riproduce il JSON della versione 1 e l'harness SQL verifica che i contenuti coincidano.

La lettura è riservata ai membri attivi. Il salvataggio passa da `savePartnerEmailConfig`, che verifica la sessione e il ruolo founder prima di usare il client server dell'assistente. La RPC è accessibile al ruolo di servizio e ricontrolla la membership dell'autore. La versione attesa protegge da modifiche concorrenti e l'identificativo dell'operazione rende sicuro ripetere un salvataggio con lo stesso contenuto dopo una risposta incerta. Il database assegna il numero della nuova versione e lo riporta anche nel campo `meta.versione`.

Zod controlla la struttura sia al salvataggio sia quando si legge una versione. Il testo delle istruzioni passa senza ritocchi, compresi gli spazi e le righe a capo. I controlli includono il limite per campo, una domanda con un solo punto interrogativo e la somma dei budget dei blocchi entro 110–160 parole. I campi fissi, il modello Club e gli esempi scritti a mano sono protetti anche al salvataggio.

## Collegamento alle bozze

`partner_assistant_drafts.config_version` identifica la versione usata per una bozza generica e `config_day` registra il giorno di preparazione a Roma. I due campi vengono salvati insieme alla bozza e alla ricevuta. La revisione legge quella versione e valuta le possibilità con la data della bozza. La riscrittura dopo una bocciatura riprende la stessa versione e ricalcola le possibilità per la nuova data di preparazione. Il riferimento è distinto da `rules_version`. Le bozze storiche senza configurazione seguono la revisione prevista al momento della loro preparazione.

Il Passo 2 compone tono, proposta, domande, blocchi ed esempio nello stesso ordine dell'anteprima di Luca. Per le possibilità legate alla ricerca, l'estrazione richiede una citazione letterale del fatto che conferma la condizione. Il gestionale controlla che la citazione sia presente nella ricerca e conserva solo un'impronta della possibilità e della condizione. Una possibilità nuova o modificata richiede quindi una nuova conferma.

La presentazione segue il blocco «Chi siamo» di Luca. Per un evento raggiungibile lo stand è la proposta principale e la maglietta co-firmata è facoltativa se la data è nota e mancano più di 31 giorni. L'esempio Evento lontano A propone la maglietta senza descrivere un soggetto grafico. Per Brand, la presentazione della capsule agli eventi resta spenta e l'esempio Brand B indica i rispettivi canali.

## Formato e filone

Il formato segue la prima sezione applicabile nell'ordine Eventi, Club, Vendita, Collab. La raggiungibilità distingue i due formati Evento. Collab usa Media quando la ricerca identifica un media e Brand negli altri casi. Se la ricerca indica un tipo diverso da quello della sezione, l'assistente salva e mostra la discordanza nella scheda. Club senza Eventi usa il modello fisso Club v3.

Durante l'estrazione, Claude sceglie il filone A o B e motiva la scelta con un fatto della ricerca. Se un sottotipo appartiene a un solo filone, prevale quel filone. La nota di scelta conserva formato, filone, motivazione e versione della configurazione. Quando salva la bozza, il sistema aggiunge alla cronologia una nuova nota con le possibilità segnalate da Claude e le confronta con la bozza in revisione. Le scelte storiche senza filone conservano il percorso precedente.

Prima della prima bozza, se cambia la versione della configurazione o la sezione richiede un formato diverso, il lavoro rifà la scelta. Riusa la ricerca se è ancora valida secondo le regole dell'assistente. Le bozze che hanno già una versione continuano a usarla per revisione e riscrittura.

Il pulsante proposto «Riscrivi le bozze pronte con la nuova versione» è una funzione facoltativa da discutere a parte. Ogni salvataggio della configurazione produce una versione destinata alle nuove preparazioni. Per ripristinare il testo di una versione precedente si può salvarne il contenuto come nuova versione, conservando la cronologia. Le migrazioni sono additive e la rimozione dello schema richiederebbe una migrazione successiva, dopo aver verificato che nessuna bozza lo referenzi.
