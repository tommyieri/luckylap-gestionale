# Rettifiche del magazzino condiviso

La pagina `/stock/rettifiche` (scheda «Rettifiche» della sezione Magazzino) consente a tutti i membri attivi di consultare le quantità fisiche, riservate e disponibili e di registrare variazioni di scorta motivate. Fino al 22 ottobre 2026 stava su `/stock`, che ora è la scheda «Giacenze» con l'inventario completo (vedi [layout condiviso](workspace-layout.md)). Riprende Barlow, verde racing e componenti compatti del sistema visivo LuckyLap, con modulo e disponibilità affiancati sul desktop e in una colonna sul telefono.

## Operazione

Si scelgono esplicitamente uno SKU e un magazzino. Si scelgono solo le sedi di tipo «Magazzino»: la merce del negozio si conta e si cambia da [Conto vendita](consignment.md), e una rettifica da qui falserebbe il resoconto mensile. La lettura tiene solo i magazzini e non legge le disponibilità delle altre sedi; la Server Action rifiuta ogni altra sede con il codice `shop_location` («Le quantità del negozio si cambiano da Conto vendita.») prima della RPC, e il database rifiuta comunque i movimenti `adjustment` sulle sedi «Negozio Conto Vendita» (trigger `reject_shop_adjustment`). Nella colonna «In negozio» delle Giacenze (`/stock`) c'è la somma dei negozi attivi già contati, «—» finché nessun negozio è stato contato. La tabella del luogo scelto permette ricerca e selezione dell'articolo; la stessa scelta è disponibile nel menu nativo. Le tre quantità restano distinte. Saldo assente o NULL è mostrato come «Da verificare» e blocca le rettifiche: non viene convertito in zero e non si inventa una conta iniziale.

Il modulo invia **un delta**, non un saldo assoluto: aggiunta o sottrazione di un intero tra 1 e 1.000.000.000, con causale da 3 a 500 caratteri. Non invia il saldo visto nella pagina, un ruolo, un costo o l'autore. Un controllo UI intercetta sottrazioni già incompatibili con le riserve; l'autorità finale è la RPC PostgreSQL `adjust_stock`, che ricontrolla membership attuale, articolo/location, saldo noto e vincolo fisico ≥ riservato sotto lock.

Le rettifiche restano controllate da `app_settings.stock_adjustments_enabled`. Questa implementazione non modifica il flag e non registra alcun movimento reale. Con flag disattivato rimangono consultabili selezioni e quantità; il modulo di scrittura è disabilitato. Una vendita o il ricevimento della produzione collegata a un ordine devono usare i rispettivi comandi, per mantenere collegati ordine, riserve e fatti Finance.

## Autorizzazione e lettura completa

Ogni caricamento e ogni Server Action verificano `getUser()` contro Auth e membership attuale nel database. Tutti i cinque ruoli attivi possono rettificare; non serve accesso Finance e nessuna query tocca tabelle Finance. La pagina è dinamica e gestisce esplicitamente dati mancanti, accesso non verificato e letture incomplete.

Catalogo e location usano paginazione per UUID con conteggio esatto tramite `readTeamPages`, 200 righe per pagina, massimo 10.000 per collezione. La disponibilità usa lo stesso cursore per articolo separatamente in ciascuna location; non tratta una chiave composita come se fosse un ID univoco. Pagine troncate, conteggi cambiati, duplicati, riferimenti mancanti o quantità incoerenti fanno fallire la lettura: non viene mostrato un inventario parziale come completo. I saldi assenti restano invece esplicitamente ignoti.

## Retry senza doppio movimento

Prima dell'invio, la scheda conserva in `sessionStorage` UUID operazione e payload esatto, con chiave separata per utente. Gli input rimangono congelati mentre un esito è incerto, anche dopo ricaricamento. «Verifica lo stesso invio» conserva UUID, SKU, location, delta e causale.

La Server Action cerca prima il movimento append-only per operation ID, sotto RLS. Solo una corrispondenza esatta di autore attuale, tipo adjustment, SKU, location, delta e causale conferma il retry. Questo consente di recuperare una risposta persa anche se il flag è stato disattivato nel frattempo. Una corrispondenza diversa è conflitto e mantiene il riferimento da verificare.

La RPC esistente controlla il flag prima della propria ricerca idempotente. Se il movimento non è leggibile e il flag è ora disattivato, non si può provare l'esito precedente: il tentativo resta incerto e congelato, con istruzione esplicita di verificarlo con Tommi. Un cambio di membership o errore di lettura durante un retry non viene scambiato per prova che l'operazione originaria non sia avvenuta. Errori SQL e parametri grezzi non raggiungono il browser.

Dopo una ricevuta confermata vengono invalidate `/stock` (giacenze), `/` (Oggi) e `/sales`; il client rilegge la route corrente, cioè `/stock/rettifiche`. La Server Action resta in `src/app/stock/actions.ts`. Un errore di aggiornamento del rendering non cancella una ricevuta già confermata e non genera automaticamente un nuovo UUID.

## Verifica

**56 test superati** nei file `src/lib/stock/model.test.ts` e `src/lib/stock/server.test.ts`: delta e limiti, causali, campi proibiti, zero/NULL, proiezioni incoerenti, tutti i ruoli operativi, membership prima di ogni azione, flag disattivato, ricevuta identica recuperata, conflitti, retry con accesso revocato, errori sanitizzati, invalidazione, letture complete, sedi del negozio escluse e rifiutate (`shop_location`).

TypeScript superato sia sui sorgenti sia su una copia locale indipendente con le stesse dipendenze installate. Il controllo nella cartella Documents ha richiesto più tempo per i moduli scaricati da iCloud, poi si è concluso con codice zero. Nessuna modifica è stata fatta alla copia runtime principale. I test di azione usano mock del confine Supabase: la logica SQL di rettifica e il vincolo riserve hanno inoltre verifiche database dedicate nella suite vendite. Restano alla verifica finale del progetto build integrata e interazione browser.
