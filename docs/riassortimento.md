# Riassortimento

La scheda «Riassortimento» di Magazzino (`/stock/riassortimento`) segue i riordini di magliette: cosa riordinare, a che punto sono, cosa entra nel Magadzino quando arrivano e cosa va consegnato al negozio. Nessuna sezione nuova nel menu: è la quarta scheda di Magazzino, dopo Packaging.

Migrazione: `supabase/migrations/20261023160000_riassortimento.sql`. Import dei due riordini in corso: `supabase/imports/20261023_riassortimento.sql`.

## Come funziona

| Tema | Regola |
| --- | --- |
| Riordine | Titolo (unico, maiuscole a parte), note, negozio facoltativo per «per il negozio». Il magazzino «per noi» è il Magadzino (`MAG01`), scelto alla creazione. |
| Righe | Una per destinazione, modello, colore e taglia. «Per noi» e «per il negozio» vogliono la variante attiva del catalogo; «per il cliente» accetta anche una taglia che non è a catalogo (XXXL), con modello e colore a catalogo. |
| Per il negozio | Solo T-shirt e solo le taglie del negozio: per la libreria di Milano S, M, L, XL. Nell'interfaccia «Per LCM»: le iniziali del nome del negozio quando ha almeno tre parole («Libreria Concessionaria Milano» → «LCM»), altrimenti il nome intero. |
| Per il cliente | Ordini speciali: non entrano mai in magazzino né su Shopify. |
| Stati | 1 «Discussione su cosa riordinare», 2 «Ordine magliette a Marco», 3 «Dal ricamatore», 4 «Da Antonella», 5 «In mano nostra». Fra i primi quattro si va avanti e indietro liberamente; ogni passaggio resta nello storico con chi, quando e una nota facoltativa. |
| Arrivo | «In mano nostra» apre la conferma: per noi e per il negozio, per modello e taglia. Una conferma carica nel Magadzino i pezzi **per noi e per il negozio** (movimenti `restock_receipt`, causale «Riassortimento: <titolo>»), una volta sola. |
| Dopo l'arrivo | Le quantità sono ferme: per cambiarle si annulla prima l'arrivo (lo dice anche la pagina). Titolo e note si cambiano sempre. |
| Annulla arrivo | Toglie dal Magadzino gli stessi pezzi (movimenti `restock_receipt_reversal`) solo se sono ancora tutti liberi (giacenza meno riserve), e solo se nessun ordine del negozio legato al riordine è aperto o consegnato e la parte del negozio non è segnata a mano. Il riordine torna allo stato di prima dell'arrivo. |
| Consegna al negozio | «Da consegnare a LCM» elenca i pezzi per il negozio. «Prepara la consegna a LCM» apre il nuovo ordine del Conto vendita già compilato (`/consignment/NEG01/ordini/nuovo?riordine=<id>`); salvato l'ordine, si apre «Consegnato» già compilato (`?consegna=1`) e la consegna si conferma come sempre. L'ordine resta legato al riordine (`consignment_orders.restock_order_id`): la parte del negozio è «Consegnate» quando le consegne degli ordini legati coprono i pezzi. «Segna come già consegnate» è il segno a mano per una consegna registrata con un ordine non legato; non sposta magliette. |
| Discussione | In «Modifica quantità», per noi, ogni casella mostra la giacenza del Magadzino e l'obiettivo (`product_variants.central_target_quantity`), i pezzi già in arrivo con gli altri riordini e i capi da produrre per le vendite; le taglie sotto l'obiettivo sono in ambra. «Proponi quantità» scrive, per noi, obiettivo meno giacenza meno i pezzi già in arrivo (mai sotto zero), modificabile. |

### Perché all'arrivo entrano anche i pezzi del negozio

La consegna del Conto vendita sposta le magliette dal magazzino di partenza del negozio (il Magadzino) al negozio, con `transfer_out` e `transfer_in`. Se all'arrivo entrassero solo i pezzi «per noi», la consegna toglierebbe dal Magadzino pezzi che non ci sono mai entrati e la giacenza sarebbe sbagliata. Per questo entrano tutti i pezzi fisici (per noi e per il negozio) e quelli del negozio escono con la consegna: dopo la consegna nel Magadzino restano esattamente i pezzi «per noi». È lo stesso conto del file di produzione («Dopo = Oggi + In arrivo + Produzione − Consegna al negozio»). Esempio: il riordine di settembre carica 81 pezzi (64 + 17); dopo la consegna a Milano il Magadzino ha +64, il negozio +17, le 4 XXXL mai in magazzino (lo prova l'harness).

## Pagine

| Indirizzo | Contenuto |
| --- | --- |
| `/stock/riassortimento` | Elenco come righe roadbook: passo (1–5, o «fatto»), titolo, «Da Antonella dal 23 ottobre», totali per destinazione, i cinque passi in piccolo; filtri «In corso» e «Arrivati»; «Nuovo riordine». |
| `/stock/riassortimento/<id>` | Riordine: «A che punto è» (cinque passi, si tocca un passo per spostarlo con conferma; «In mano nostra» apre la conferma dell'arrivo), numeri per destinazione, «Arrivo in magazzino» con «Annulla arrivo», «Da consegnare a LCM», «Quantità» (tabella in lettura; «Modifica quantità» una destinazione alla volta, taglie in colonna, barra «Salva quantità» in basso), «Note», «Storico». |

Sul telefono (390 px) la tabella in lettura e la griglia di modifica stanno nella larghezza: sette colonne di taglie, campi da 44 px e 16 px, nessuno scorrimento orizzontale della pagina (la tabella ha comunque la prima colonna ferma se un giorno servisse scorrere). I passi diventano una lista.

Invii incerti come negli altri moduli: ogni comando si congela in `sessionStorage` (`luckylap.restock.pending:<utente>`) prima dell'invio, con blocco del doppio clic; un esito incerto resta in cima alla pagina con `pending-attempt.tsx` e blocca le altre scritture finché «Verifica lo stesso invio» non lo chiarisce.

Anteprima locale (`npm run dev`, `isLocalPreviewEnabled()`, spenta con `VERCEL=1` e con `NODE_ENV=production`): riordini sintetici di `src/lib/restock/fixtures.ts` sullo stesso catalogo sintetico del Conto vendita; il salvataggio è disattivato.

## Database

### Tabelle

Quattro tabelle nuove, RLS attiva, sola lettura per i membri (`private.is_member()`), niente ad `anon`, nessuna scrittura dai client, trigger `audit_change`.

| Tabella | Contenuto |
| --- | --- |
| `restock_orders` | Titolo, note, stato (`discussion`, `supplier`, `embroiderer`, `quality`, `in_hand`), chi e quando ha cambiato stato, magazzino, negozio, segno a mano della consegna al negozio, versione (CAS). |
| `restock_lines` | Destinazione (`warehouse`, `shop`, `customer`), prodotto, colore, taglia, variante (assente solo per il cliente fuori catalogo), pezzi. |
| `restock_state_events` | Storico degli stati, solo aggiunte. |
| `restock_arrivals` | Arrivo: pezzi per destinazione, stato di prima; annullo con chi, quando e riferimento. Un solo arrivo aperto per riordine (indice unico parziale). |

Ricevute dei comandi in `private.restock_receipts` (solo aggiunte): un replay identico restituisce il risultato originale, lo stesso UUID con dati diversi dà `idempotency_conflict`.

### Comandi

Sei RPC `(p_operation_id uuid, p_payload jsonb) returns jsonb`, `schema_version: 1`, wrapper `security invoker` e processore `private` `security definer` con `search_path` vuoto, `EXECUTE` solo ad `authenticated`. Ognuno: membership; chiavi esatte; ricevuta; riga del riordine bloccata con la versione attesa (`stale_version`).

| RPC | Effetti |
| --- | --- |
| `save_restock_order` | Crea il riordine (id = UUID dell'invio, stato «Discussione», primo passo dello storico) o cambia titolo, note e negozio. Il negozio si cambia solo prima dell'arrivo e senza righe per il negozio. |
| `set_restock_lines` | Sostituisce tutte le righe (al massimo 600), solo prima dell'arrivo; cambia solo le righe diverse. |
| `move_restock_order` | Uno dei quattro stati prima dell'arrivo, con nota. |
| `receive_restock_order` | «In mano nostra»: `expected_pieces` è il numero confermato a schermo. Carica per noi e per il negozio nel magazzino del riordine; una variante mai entrata parte da una giacenza di 0; una giacenza ignota rifiuta (`unknown_stock`). Richiede `stock_adjustments_enabled`. |
| `undo_restock_arrival` | Annulla l'arrivo (vedi sopra). Richiede `stock_adjustments_enabled`. |
| `set_restock_shop_done` | Segno a mano «consegnate al negozio», o lo toglie. |

Errori (SQLSTATE `22023`, tranne `membership_required` e `stock_mutations_disabled` `42501`, `title_taken` `23505`), tradotti in `RESTOCK_MESSAGES` (`src/lib/restock/server.ts`): `stale_version`, `restock_not_found`, `title_taken`, `invalid_location`, `shop_has_lines`, `restock_received`, `restock_not_received`, `no_shop`, `invalid_tshirt`, `size_not_in_shop`, `unknown_variant`, `unknown_stock`, `restock_stock_used`, `shop_order_linked` (con il numero dell'ordine del negozio), `idempotency_conflict`, `invalid_payload`. Un codice fuori dalla mappa resta incerto.

### Conto vendita

- `private.save_consignment_order` accetta la chiave facoltativa `restock_order_id`, solo per un ordine nuovo e solo se il riordine è «In mano nostra» per lo stesso negozio (`restock_not_ready`). Senza la chiave canonico e ricevuta sono identici a prima. La consegna (`ship_consignment_order`) non cambia.
- Taglie del negozio: vedi [Conto vendita](consignment.md), «Taglie del negozio».

### Movimenti e feed

- Tipi di movimento nuovi `restock_receipt` e `restock_receipt_reversal`, con `source.restock_order_id` e `source.restock_arrival_id`; in Giacenze e Rettifiche si vedono le quantità aggiornate.
- Controllo CEO: frasi nell'area Magazzino con il link al riordine, per esempio «Ettore ha portato il riordine «Settembre» a «Da Antonella»», «Tommi ha caricato in Magadzino il riordine «Riordine settembre 2026»: 64 pezzi per noi e 17 per Libreria Concessionaria Milano», «… ha annullato l’arrivo del riordine «…»: 81 pezzi tolti da Magadzino», «… ha cambiato le quantità del riordine «…»», «Il sistema ha importato 2 riordini». Le taglie del negozio: «Il sistema ha impostato le taglie di <negozio>: S, M, L, XL». Le quattro funzioni del feed sono quelle di `20261023143400_ceo_feed_fixes.sql` con `create or replace`, cambiate solo dove serve (24 ore e privacy invariate). Nel browser il feed accetta anche i link `/stock/riassortimento` e `/stock/riassortimento/<id>`.

## Produzione

La migrazione va applicata **prima** del merge: il codice legge `consignment_shops.sizes`, `consignment_orders.restock_order_id` e le tabelle nuove anche nelle pagine del Conto vendita. Cosa cambia:

1. Quattro tabelle nuove, `private.restock_receipts`, sei comandi con i wrapper, funzioni di supporto e un trigger `consignment_size_allowed` su conta, resoconto, ordini e consegne al negozio.
2. Due colonne nuove: `consignment_shops.sizes` (NULL = tutte le taglie) e `consignment_orders.restock_order_id` (NULL per tutti gli ordini esistenti). Un indice su `stock_movements` per i movimenti di un arrivo.
3. Una sola riga aggiornata: `consignment_shops.sizes = {S,M,L,XL}` per il negozio `NEG01` di tipo «Negozio Conto Vendita» con «milano» nel nome, solo se era ancora NULL. Passa dal trigger di audit (una riga di `audit_logs` dal sistema). Se il nome non contiene «milano» non cambia niente: va controllato dopo l'applicazione.
4. `create or replace` di `private.count_consignment_stock`, `private.save_consignment_order` e delle quattro funzioni del feed.
5. Nessun saldo, movimento o riga esistente cambia (lo provano gli harness).

Poi l'import, come proprietario del database: `supabase/imports/20261023_riassortimento.sql`. Inserisce due riordini «Da Antonella» con il founder attivo come autore e un passo di storico «Importato dal file di produzione»: «Riordine settembre 2026» (85 pezzi: 64 per noi, 17 per Milano, 4 XXXL per il cliente) e «Pezzi in controllo da Antonella» (36 per noi). Nessun movimento di magazzino, nessuna conta del negozio. Idempotente per titolo; scrive solo le tre tabelle dei riordini e le loro righe di audit; se manca il founder, il Magadzino, il negozio di Milano o una variante non scrive niente.

## Verifica

- `supabase/tests/riassortimento.mjs`, PGlite (riga `// test-db: pglite minimo 264`): migrazione (una sola riga cambiata, nel registro), permessi (anon, chi non è nel team, chi non è più attivo, scritture dirette), comandi, replay e conflitti, CAS, stati avanti e indietro, arrivo una volta sola, per il cliente mai in magazzino, giacenza di partenza 0 e giacenza ignota, ordine del negozio legato e consegna, annullo solo con i pezzi liberi, segno a mano, taglie del negozio nel conto vendita (conta, ordini, consegne, magliette riportate), frasi del feed, import (85/64/17/4 e 36, idempotente, solo le tabelle dei riordini) e il conto finale: dopo la consegna a Milano il Magadzino ha +64.
- `supabase/tests/riassortimento-concurrency.mjs`, PostgreSQL 17 reale (`// test-db: postgres minimo 24`): catena completa delle migrazioni e import; due arrivi concorrenti, lo stesso invio ripetuto, annullo contro una rettifica sull'ultimo pezzo nei due ordini, annullo contro l'ordine del negozio legato nei due ordini; il feed di Controllo CEO con la password CEO vera.
- Vitest: `src/lib/restock/*.test.ts` (modello, letture, server), `src/components/restock-*.test.tsx`, `src/app/(workspace)/stock/riassortimento/*.test.ts(x)` (azione e pagine, anteprima spenta con `VERCEL=1` e `NODE_ENV=production`), più i test del Conto vendita aggiornati alle taglie del negozio.
