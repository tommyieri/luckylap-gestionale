# Riferimenti generici nelle email Partner

Correzione preparata nel branch `codex/partner-riferimenti-generici`, il 9 novembre 2026. Il documento descrive la causa e i requisiti della consegna: **non attesta l'applicazione delle migrazioni, il rilascio o una revisione delle bozze in produzione**.

Nelle email si possono citare alcune collaborazioni con **Porsche Club in Italia**, senza nominare i singoli club coinvolti o il numero di magliette delle commesse precedenti. Il divieto del caso Porsche Club Toscana e delle 150 magliette riguarda tutte le categorie di destinatari, comprese le prime email generiche, gli eventi e i solleciti.

## Perché una vecchia bozza poteva restare in coda

Le regole originarie contenevano quel caso tra i fatti utilizzabili da tutti i contatti, nella proposta per gli eventi lontani e negli esempi di scrittura. Il prompt corrente contiene già un'indicazione prioritaria che vieta nomi dei singoli club e quantità. Questa indicazione modifica le nuove chiamate di scrittura e controllo; non modifica da sola il corpo di una bozza già approvata.

La revisione del 2 novembre riguardava soltanto le bozze pronte del modello Club versione 2. Le bozze generiche preesistenti non erano candidate di quella migrazione. Anche il reintegro dal lotto approvato del 6 novembre è riservato ai Club: ricompone il modello versione 3 e ne confronta testo, lingua, fuso e allegato con il lotto. Non sostituisce tutte le vecchie bozze generiche del database.

Il vecchio controllo delle prime email verificava parole vietate, firma, modelli, lunghezza e altri vincoli, senza un blocco specifico su questo riferimento. Il ricontrollo ordinario prima dell'invio verificava soprattutto date e proposta dell'evento. Una bozza generica già pronta poteva quindi conservare il testo precedente pur superando ancora quelle verifiche. La modifica alla nota descrittiva della sezione Club corregge una fonte operativa visibile; quella nota non viene usata come prompt dal worker.

## Controlli della correzione

La guardia condivisa TypeScript riconosce il nome ritirato e le quantità della commessa nelle cinque lingue, anche scritte in lettere. Il controllo delle prime email usa `parola_vietata`; i solleciti conservano `prova_sociale`. Il nome ufficiale del destinatario può comparire come identità, ma non esenta la quantità. Anniversari, date e numeri diversi non sono trattati come quantità della commessa.

Il sender controlla anche una vecchia bozza già approvata prima di aprire la casella. Un riferimento vietato produce `riferimento_superato`: per un primo invio reale il lavoro passa a «Serve Tommi», conservando la bozza, senza riscritture a credito. Le copie arretrate di email già inviate proseguono con il percorso esistente.

Il database esclude il testo vietato dagli snapshot del piano e controlla oggetto e corpo canonici sia all'inserimento di un messaggio pronto sia al passaggio all'invio. Questo protegge anche bozze salvate manualmente o importate da altri percorsi: una bozza può esistere da correggere, ma non diventa inviabile. Il MIME viene composto dal codice e conserva le guardie di immutabilità esistenti; la nuova guardia non interpreta i PDF né introduce un secondo decodificatore MIME.

La correzione non riscrive automaticamente l'intera email per sostituire una frase: dati, fatti e proposta richiedono la verifica editoriale. Per le undici bozze pronte interessate, la revisione sostituisce soltanto il riferimento alla vecchia commessa con quello generale ai Porsche Club in Italia, nella lingua originaria.

## Revisioni e storico

Le correzioni delle bozze ancora modificabili devono creare **nuove revisioni append-only**, con nuova impronta e approvazione attribuita a chi l'ha realmente eseguita. La ricerca e la sua età non vengono presentate come nuove soltanto perché è cambiato il testo. Il puntatore del lavoro può passare alla revisione corrente soltanto dopo le verifiche su scheda, recapito, regole e stato dell'invio.

Le email già inviate e i relativi MIME restano immutabili. Non si corregge retroattivamente il messaggio ricevuto e non lo si rimanda per applicare questa correzione. Un invio in corso o incerto non viene trasformato in una bozza da ritentare. Le vecchie regole, specifiche e migrazioni restano documenti storici, non esempi operativi vigenti.

## PDF e pagina approvata

L'audit locale del 9 novembre ha confrontato i cinque PDF canonici in `data/partner-lookbooks/` e i due PDF Club correnti scaricati: il testo estraibile non contiene il nome specifico né la quantità vietata. I metadati dei due allegati Club correnti coincidono con byte e impronte dei file canonici. Le vecchie impronte restano riconoscibili nello storico delle prove; il caricatore dei nuovi allegati richiede quelle correnti.

La pagina approvata del 6 novembre contiene 581 righe: 570 corpi, di cui 558 Club e 12 generici, più 11 righe senza corpo. Nessuno dei 570 corpi contiene il riferimento vietato. Questo controllo riguarda il file locale: non prova che tutte le bozze già presenti nel database siano state sostituite da quel lotto. I testi reali, i recapiti e le firme non vengono riportati nel repository.
