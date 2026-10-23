# Vendite e produzione condivise

La route `/sales` collega l’interfaccia alle cinque RPC del [nucleo transazionale](./sales-ecosystem-backend.md). Non importa vendite storiche, non legge ordini Shopify e non attiva flag o servizi. Nessuna chiave Admin o service role viene usata dalle pagine o dalle azioni.

## Accesso e lettura

Pagina e Server Actions verificano l’identità con `getUser()` e l’appartenenza corrente in `memberships`/`profiles`. Tutti i membri attivi leggono ordini, costi fotografati, margini sui capi, riserve e fabbisogni. I permessi non derivano dai metadata del browser. Il ricevimento produzione richiede anche ruolo DB founder/production; gli altri quattro comandi sono disponibili ai membri attivi, secondo le regole del backend.

Le letture usano il client Supabase della sessione e rispettano RLS. Ogni tabella/vista è letta con ordinamento stabile, pagine da 200 righe e conteggio esatto, con limite di 100.000 righe per sorgente. Una pagina troncata, conteggi cambiati, identificativi duplicati, righe orfane o proiezioni incoerenti bloccano l’intera schermata e chiedono di ricaricare. La lista ordini mostra 20 risultati per pagina e permette ricerca per riferimento/SKU/ID e filtro delle operazioni aperte.

La UI distingue pronto fisico, riservato, disponibile e da produrre. Il mancante rimane «Da verificare». Costi ignoti non diventano zero. I margini sono differenza fra valore dei capi e costo disponibile, prima di IVA, spedizioni e commissioni: non sono utile o saldo di conto. Righe incasso dettagliate e fatti Finance non vengono selezionati da questa route; sono visibili solo gli stati operativi autorizzati.

Le nove letture sono separate e non costituiscono uno snapshot MVCC unico: i controlli fra proiezioni rifiutano le incoerenze rilevabili durante aggiornamenti concorrenti. Un’interfaccia che richieda letture atomiche per grandi volumi dovrà aggiungere una RPC di sola lettura con la stessa autorizzazione. Le scritture restano sempre atomiche nel core PostgreSQL.

## Operazioni

- **Nuova vendita:** da una a 50 righe SKU distinte, magazzino esplicito, quantità, prezzo unitario e sconto totale di riga. Canali: diretta, Etsy, altro manuale. Etsy richiede riferimento; per altri canali si chiede l’ID se disponibile. Shopify e Shopify POS non sono canali manuali.
- **Consegna:** «Da preparare» riserva pronto e apre fabbisogno per il residuo; «Consegnata adesso» richiede disponibilità pronta e scarica il fisico. Le consegne successive possono essere parziali, fino alle quantità riservate.
- **Produzione:** Tommi/Gabriele dichiarano capi realmente completati; ricevimento e riserva sull’ordine avvengono insieme. Nessuna produzione o promessa di consegna viene completata automaticamente.
- **Annullo:** soltanto quantità non consegnate. Riduce fabbisogni aperti e libera riserve. Il rimborso dovuto compare esplicitamente, senza inventare un pagamento in uscita o un reso fisico.
- **Incasso:** dichiarazione di un incasso già ricevuto, intero e coerente con il dovuto. Metodo contanti, bonifico, carta esterna a Shopify o altro. Nessun addebito, riconciliazione bancaria o incasso parziale viene eseguito dal form.

Gli input euro accettano virgola o punto decimale e massimo due cifre, senza separatori delle migliaia; conversione con BigInt e centesimi interi. Il server ricalcola/valida tutto tramite RPC e fotografa il costo dal catalogo: il browser non decide costi, ruoli o totali autorevoli. Gli orari sono sempre Europe/Rome, indipendenti dal fuso del dispositivo. Ore locali inesistenti o ambigue al cambio legale/solare vengono rifiutate esplicitamente.

## Avvio e recupero degli invii

`manual_sales_enabled=false` o cutover assente mantengono il salvataggio disabilitato. I moduli restano compilabili per verificare prezzi e disponibilità, senza inviare una nuova operazione. L’interfaccia mostra lo stato letto dal DB e la data di avvio; non può abilitarli.

Prima di inviare si genera un UUID e si conserva l’intero comando in `sessionStorage`, con chiave per utente e modulo. In caso di risposta incompleta o interruzione i dati sono congelati: «Verifica lo stesso invio» riusa UUID e payload originali. Una risposta certa di rifiuto permette la correzione; un conflitto di idempotenza resta esplicito e bloccante. Nessuna ripetizione di rete genera silenziosamente una nuova chiave. Il riquadro è `src/components/pending-attempt.tsx`, con il riepilogo di `src/lib/sales/attempt.ts`: data all’ora di Roma, canale con la sua etichetta, ordine, capi ed euro; il codice tecnico solo in «Codice per l’assistenza». Un tentativo illeggibile o in conflitto non potrà mai riuscire: «Scarta questo tentativo», dopo una conferma, libera il modulo senza cancellare niente negli ordini.

Il recupero generale mantiene accessibili i tentativi anche quando l’operazione è già stata completata e il modulo consegna/incasso/produzione scompare dopo una rilettura. Le richieste incerte possono recuperare una ricevuta anche con flag disattivato: il DB consente replay esatti e rifiuta nuovi effetti. Solo un successo completo elimina il marker, oppure un rifiuto certo diverso dal conflitto. Un accesso revocato, un errore di configurazione o una validazione che precede la ricerca della ricevuta non dimostrano il fallimento dell’originale: durante il recupero mantengono il tentativo incerto e conservato. Errori SQL, stack e payload Finance non vengono mostrati.

Il marker protegge nella stessa scheda e nei suoi ricaricamenti; chiudere la scheda o cancellare i dati del browser può eliminarlo. Prima di reinserire un’operazione dopo tale perdita occorre cercarla nel registro. Riferimento esterno e vincoli backend aggiungono deduplicazione quando esistono. Non sono presenti token Auth nel marker; i dati appartengono alla richiesta operativa del membro corrente.

## Verifica

44 test Vitest aggiuntivi: centesimi, input ambigui, limiti, canali non ammessi, timestamp, fusi/DST, sconti motivati, SKU duplicati, composizione multi-riga, conteggi/pagine, riserve/fabbisogni/valori, packaging escluso dai totali capi, membership corrente, ruoli produzione, blocco flag, RPC singola con UUID/payload conservati, errori riservati e recupero di tentativi il cui modulo non esiste più. Regressioni specifiche conservano l’UUID in recupero dopo revoca di membership, guardie DB precedenti alla ricevuta e lettura impostazioni non riuscita. Typecheck passato. I test Auth/RPC sono simulati: non registrano operazioni nel cloud e non sostituiscono i test concorrenti del database reale.

Lo stile riusa DESIGN.md, Barlow e i token esistenti; nessun nuovo contesto o detector Impeccable eseguito. Le guide Next installate su Server Actions e `revalidatePath`, più la documentazione corrente Supabase RPC, sono state consultate prima dell’implementazione.

QA visuale svolta dal root con fixture sintetiche: desktop 1280 px e telefono 390 px, scala 1, larghezza documento 390 px, nessun errore o avviso console. Verificati in UI 6 capi × 40,01 EUR − 7,27 EUR di sconto riga = 232,79 EUR, margine capi 153,59 EUR; con 4 disponibili il fabbisogno è 2. Dettaglio ordine, costi e margine coerenti. Prova privata: `.private/deployment-proof/sales-mobile.png`. La route temporanea esisteva soltanto nel runtime locale, è stata rimossa dopo la prova e restituisce 404; nessuna route QA viene distribuita.
