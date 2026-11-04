# Rapporto del grafo Partner

Stato del codice: `origin/main` al commit `7a629ea`, 4 novembre 2026. Analisi funzionale dei tre documenti Partner, verificata nei sorgenti. Nessun dato o accesso operativo alla produzione.

**93 nodi, 158 archi orientati, 8 comunità rilevate.** 0 relazioni della stessa coppia sono state aggregate conservandone le evidenze.

## Integrità

Nessun nodo mancante, arco senza estremi o autoanello. Ogni relazione indica origine e livello di evidenza. La distinzione automatica/manuale è descritta nei campi operativi dei nodi. Il nodo sul progetto futuro è marcato `implemented: false`; non è una fase attiva.

## Nodi centrali

- **Partner: elenco operativo**: 14 collegamenti in ingresso e uscita.
- **Comandi e ricevute**: 10 collegamenti in ingresso e uscita.
- **Registro attività**: 9 collegamenti in ingresso e uscita.
- **Scheda contatto**: 8 collegamenti in ingresso e uscita.
- **Serve Tommi e verifica umana**: 8 collegamenti in ingresso e uscita.
- **Database contatti completo**: 7 collegamenti in ingresso e uscita.
- **Recapiti e canali**: 7 collegamenti in ingresso e uscita.

## Collegamenti da leggere insieme

- Assegnare responsabile o prossima azione esclude dalle prime email automatiche: CRM e coda sono collegati.
- Sospensione, revisione, versione del recapito e ultima guardia SMTP proteggono lo stesso testo.
- Invio riuscito, registro e promemoria sono distinti dalla copia IMAP e dal seguito manuale.
- Club modello e altri contatti condividono l’invio ma hanno preparazioni e quote differenti.

## Comunità e coesione

Le comunità sono calcolate sul grafo; le sei aree dell’interfaccia sono invece una classificazione funzionale curata. La coesione numerica è il risultato dell’algoritmo, non una valutazione della qualità del prodotto.

- Preparazione delle email: 18 nodi; coesione 0.209150.
- Contatti e lavoro del team: 18 nodi; coesione 0.235294.
- Calendario e revisione: 13 nodi; coesione 0.205128.
- Contatti e lavoro del team: 12 nodi; coesione 0.181818.
- Esiti e seguito manuale: 11 nodi; coesione 0.254545.
- Calendario e revisione: 10 nodi; coesione 0.200000.
- Esiti e seguito manuale: 6 nodi; coesione 0.400000.
- Preparazione delle email: 5 nodi; coesione 0.500000.

## Domande esplorabili

- Da quali condizioni una scheda completa viene esclusa dall’invio?
- Quale testo parte se Tommi modifica una bozza già pronta?
- Che cosa succede dopo un’accettazione SMTP, e che cosa resta manuale?

## Limiti e documenti storici

La mappa descrive ciò che il codice implementa; non certifica migrazioni applicate, configurazione, credito, consegna nella inbox o record correnti in produzione. I paragrafi storici della documentazione sono stati confrontati con le sezioni recenti e con il codice: i Club modello possono allegare il PDF dal 4 novembre; le risposte e i solleciti automatici restano futuri. Nella scheda prevale l’ordine dei componenti attuali. La nota sulle differenze storiche dei messaggi in Dati Partner resta un limite documentato.

## Token e costo

L’estrazione semantica è stata svolta dagli agenti della sessione senza API esterne dedicate. Le chiamate di collaborazione non espongono i conteggi token: **consumo e costo non rilevabili da questa interfaccia**. Gli zeri nei file intermedi sono segnaposto e non misurazioni. Non sono stati eseguiti benchmark di risparmio token.

## Fonti

- [Partner nel gestionale](../partner.md)
- [Assistente Partner](../partner-assistente.md)
- [Programma email Partner](../partner-programma-email.md)
- I singoli nodi e le singole relazioni in [graph.json](graph.json) indicano file e righe.
