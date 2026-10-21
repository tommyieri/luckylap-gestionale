# Finance: conti, andamento e categorie

La panoramica `/finance` legge le importazioni BudgetFlow, il lavoro Finance e gli incassi del conto vendita con la sessione dell’utente. Mantiene i controlli esistenti di identità, membership, ruolo e password Finance; ogni query usa RLS. Una lettura fallita o incompleta impedisce la visualizzazione dell’intera panoramica. Non usa chiavi amministrative, dati locali o cache condivise.

## Regole del calcolo

- Gli importi dell’export sono convertiti dal testo in centesimi `bigint`, senza arrotondamenti in virgola mobile. Anche somme, saldi e categorie rimangono interi. Nel grafico la conversione in `Number` riguarda esclusivamente coordinate comprese nell’area di disegno.
- Il saldo dai movimenti comprende righe non pending con data non successiva a oggi. BudgetFlow conserva il giorno dichiarato nell’export; osservazioni live e incassi conto vendita usano il giorno effettivo in Europe/Rome.
- Non è aggiunto alcun saldo iniziale. Il grafico annuale riporta i movimenti degli anni precedenti; i mesi successivi a oggi non vengono mostrati come consuntivi. Il mese corrente è parziale. I saldi non implicano revisione o riconciliazione bancaria: le importazioni rimangono da verificare.
- Pending rimane separato, anche quando la stessa riga ha data futura. L’opzione dei futuri aggiunge soltanto una proiezione tratteggiata delle righe future non pending, senza modificare i saldi consuntivi.
- Una riga di trasferimento con conto di origine e destinazione applica l’importo con il segno originale al primo conto e l’opposto al secondo. Il trasferimento non alimenta le categorie di entrata/costo. Non si creano trasferimenti a partire da gateway o descrizioni.
- Le voci manuali non annullate hanno il segno determinato dal tipo entrata/uscita. Un account esplicito alimenta il conto indicato; l’assenza di conto rimane da attribuire. Non sono deduplicate automaticamente fonti diverse: rimane la conferma di verifica nel modulo di inserimento.
- I pagamenti di ordine dichiarati con metodo `cash` e gli incassi conto vendita `cash` alimentano Cash una sola volta. Del conto vendita entra l’incasso realmente registrato, senza sommare nuovamente lordo o credito del 60%.
- Gli altri pagamenti, capture Shopify e rimborsi rimangono da attribuire quando il conto non è noto. Il gateway non viene interpretato come conto Revolut. `sale_observed`, annulli commerciali, fatti Finance collegati ai pagamenti, dettagli fiscali e transazioni descrittive non sono sommati ai conti.

## Interfaccia

La selezione dei conti controlla grafico, categorie e registro. Anno e mese filtrano le categorie; il registro può disattivare il filtro del periodo e consultare pending, futuri e movimenti senza conto. Un clic su una categoria apre i movimenti corrispondenti. Le categorie senza righe rimangono visibili con zero movimenti; eventuali categorie originali diverse sono conservate separatamente.

Il catalogo suggerito contiene esattamente 13 categorie:

| Gruppo | Categorie |
| --- | --- |
| Income | Collab; Fund Raising; Others; Vendite |
| Fixed Cost | Software; Stipendi; Tasse & Contributi |
| Variable Cost | Attrezzatura; Eventi; Marketing; Produzione; Spedizioni; Trasferte |

Il modulo mantiene conto e categoria facoltativi e permette una categoria personalizzata. Non modifica il contratto di validazione o i comandi Finance. La tabella dei dati esatti accompagna il grafico SVG e rimane accessibile da tastiera; i dettagli BudgetFlow conservano i campi originali e la provenienza.

## Verifica

Test sintetici coprono centesimi oltre la precisione aggregata di `Number`, pending/futuri, riporto annuale, trasferimenti, voci annullate, conto sconosciuto, incassi cash, Shopify senza conto, assenza di doppio conteggio dei fatti, incassi conto vendita, giorno Europe/Rome e categorie. Il nuovo loader è testato per negazione prima della query e letture incomplete. Non sono salvati dati finanziari reali nelle fixture Git.

La modifica non richiede migrazioni o scritture sul database. La scelta dei pattern di conti/categorie e del filtro temporale si basa sulle schermate fornite e sulla descrizione ufficiale di [Budget Flow](https://budget-flow.app/); grafica e componenti seguono il sistema LuckyLap.
