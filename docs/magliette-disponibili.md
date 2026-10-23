# Magliette disponibili

In cima a Magazzino › Giacenze (`/stock`) c'è il riquadro «Magliette disponibili»: per ognuna delle sei grafiche, quanti pezzi si possono vendere dal Magadzino. Sotto resta la tabella di sempre. Toccando una grafica, la tabella mostra solo quel modello.

## Le sei grafiche

Nome, modello e colori stanno in un solo file, `src/lib/inventory/tshirt-lines.ts` (`TSHIRT_LINES`), nell'ordine voluto da Tommi. I componenti non scrivono mai i nomi a mano.

| Riquadro | Modello del catalogo (`products.model`) | Colori | Su Shopify |
| --- | --- | --- | --- |
| 964 | `964` | Bianco, Blu | 964 T-Shirt |
| GT3RS | `GT3RS` | Bianco, Blu | GT3RS T-Shirt |
| Project’88 | `SENNA` | Bianco | Project 88 White T-shirt |
| F40 | `F40` | Bianco | F40 T-Shirt |
| 512TR | `TESTAROSSA` | Bianco | 512 TR T-Shirt |
| 300SL | `SL` | Azzurro | 300 SL T-Shirt |

Si contano solo le varianti attive di categoria T-shirt, con il modello e un colore della tabella. Cappellini («Cappellino 964») e sticker restano fuori, anche se portano lo stesso nome. Se nel catalogo arriva un colore nuovo, per esempio un GT3RS rosso, non entra nel conto finché non lo si aggiunge alla mappa. Un test controlla che modelli e colori esistano come T-shirt nel catalogo dell'inventario.

## Il numero

Il numero è il disponibile nel Magadzino (`MAG01`): fisico meno riservato, sommato su tutte le taglie e su tutti i colori. È lo stesso «Disponibile» di Rettifiche e della guida («Fisico meno riservato: quello che puoi vendere»). La colonna «Magadzino» della tabella mostra invece il fisico. I negozi in conto vendita e gli altri magazzini non contano.

- **Lettura.** `src/lib/inventory/magadzino-availability.ts` cerca la sede `MAG01`, poi legge la vista `operational_stock_availability` di quella sede, a pagine (`readTeamPages`), con i permessi del membro. Ogni riga deve essere coerente: disponibile = fisico − riservato, riservato mai sopra il fisico, fisico ignoto con riservato zero. Se una riga non torna, la lettura fallisce e non mostra numeri parziali. Nessuna migrazione: la vista esiste già.
- **Conteggio.** `countTshirtLines` in `tshirt-lines.ts`.
- **Dato mancante.** Se una variante non ha la riga nel Magadzino o ha il fisico ignoto, il riquadro dice «n.d.» e «Da verificare»: mai zero al posto di un dato che manca.
- **Zero.** Uno zero vero si vede attenuato, con la parola «Esaurita».
- **Lettura non riuscita.** Se la lettura del Magadzino non riesce, il riquadro lo dice e offre «Riprova»; la tabella resta.

Sotto il numero:

- con due colori, i pezzi per colore accanto al campione: «○ 20 · ● 19» (bianca, blu);
- con un colore solo, il suo nome: «○ Bianca», «● Azzurra»;
- le taglie a zero: «Manca L», «Mancano XS–M» (tre o più taglie di seguito diventano un intervallo), «Manca L blu» con due colori, «Bianca esaurita · manca L blu» quando un colore è finito.

## Il filtro

Ogni riquadro è un link a `/stock?modello=<modello>`, per esempio `/stock?modello=SENNA`. Dentro Giacenze il tocco filtra la tabella senza ricaricare la pagina. Aggiorna l'indirizzo con `history.replaceState`, che Next riporta in `useSearchParams`: il filtro sta solo nell'indirizzo, così anche la scheda «Giacenze» lo toglie. Il tocco toglie anche ricerca, categoria e disponibilità e, sul telefono, porta la tabella in vista. Senza JavaScript, oppure con Cmd, Ctrl o Maiusc, il link apre la pagina già filtrata dal server. Il riquadro scelto è segnato (verde chiaro, filetto d'inchiostro in alto, `aria-current`); toccarlo di nuovo toglie il filtro, come il pulsante con il nome della grafica e la «×» nella barra della tabella. Il filtro vale per ogni modello del catalogo, cappellini compresi, e per l'export CSV. Codice: `src/lib/inventory/model-filter.ts` (`parseModelParam`, `filterInventoryItems`).

## Icone

Le icone vengono dalle immagini pubbliche del negozio Shopify di LuckyLap, lette con GET da `/products.json` il 23 ottobre 2026. Non sono state usate API amministrative, credenziali o le foto private di «Grafica e foto».

- Cinque icone vengono dagli sticker delle stesse grafiche.
- Per il 300SL, che non ha uno sticker, l'icona è il ritaglio del ricamo sulla «300 SL T-Shirt».

Lavorazione:

- ritaglio quadrato centrato sulla grafica;
- linee ispessite di pochi pixel perché si leggano a 44 px;
- 96 e 192 px in WebP, in `public/tshirt-icons/`;
- fonti, handle e URL in `public/tshirt-icons/SOURCES.txt`.

Nella pagina l'icona è un chip ottagonale (`clip-path`, filetto da 1 px), con testo alternativo uguale al nome della grafica. Se una grafica non ha icona (`icon: null`), il chip mostra le iniziali («P8», «GT3») sul colore della maglietta.

## Anteprima locale

Con `npm run dev` (`isLocalPreviewEnabled()`) la tabella resta quella dello snapshot `data/inventory-source.json`. I riquadri usano invece numeri sintetici di `src/lib/inventory/tshirt-fixtures.ts`, e la pagina lo dice: «Anteprima locale: numeri sintetici, diversi da quelli della tabella». I numeri coprono ogni caso:

- F40 a zero;
- pezzi riservati;
- una sola taglia a zero;
- un intervallo di taglie a zero;
- un colore senza taglie a zero.

## Verifica

34 test Vitest nuovi:

- `src/lib/inventory/tshirt-lines.test.ts`: mappa, icone e fonti, conteggio (taglie e colori sommati, riservato tolto, solo `MAG01`, niente cappellini, sticker, varianti inattive o colori fuori mappa, zero contro dato mancante, righe doppie), frase delle taglie, nome accessibile, anteprima;
- `src/lib/inventory/model-filter.test.ts`: `?modello=`, indirizzi, filtro combinato, clic con i tasti;
- `src/lib/inventory/magadzino-availability.test.ts`: solo `MAG01`, righe incoerenti rifiutate, errori;
- `src/components/tshirt-availability.test.tsx`: ordine dei riquadri, link, zero attenuato, filtro attivo, iniziali, lettura non riuscita;
- `src/components/inventory-workspace.test.tsx`: riquadri sopra la tabella, filtro modello.

`src/lib/design-floor.test.ts` controlla anche i numeri del nuovo modulo CSS. Prova nel browser, in anteprima locale:

- 1280 × 800: tre colonne;
- 390 × 844: due colonne;
- nessuno scorrimento orizzontale, nessun testo sotto i 12 px, riquadri da 179 × 172 px sul telefono, nessun errore in console;
- il tocco filtra la tabella e aggiorna l'indirizzo.
