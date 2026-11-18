# Preview LuckyLap V2

Una seconda proposta più interattiva: un guardaroba scenico con prodotti reali, viste ravvicinate e un abbinamento personale. La pagina è in italiano e resta una preview locale separata dallo store.

## Avvio

Dalla radice del repository, senza installare dipendenze:

```sh
python3 -m http.server 4174 --bind 127.0.0.1 --directory previews/luckylap-v2
```

Aprire [la seconda preview](http://127.0.0.1:4174). Per fermare il server, premere Ctrl+C nel terminale. La pagina va servita via HTTP: l'apertura diretta del file HTML non carica correttamente i moduli JavaScript.

## Cosa provare

- Trascinare il capo verso destra o sinistra, usare le frecce oppure scegliere una miniatura.
- Passare fra T-shirt e cappellini: il catalogo contiene sei T-shirt e tre cappellini dello store.
- Aprire **Da vicino**, esplorare la fotografia con zoom e trascinamento, quindi tornare a **Il capo**.
- Usare le frecce della tastiera sul capo; nella vista ravvicinata usare anche più e meno per lo zoom ed Escape per tornare alla vista completa.
- Scegliere una T-shirt e un cappellino, aprire **La tua selezione**, sostituire o rimuovere un articolo e aprire i prodotti nello shop.
- Entrare nel mondo LuckyLap e cambiare i tre capitoli fotografici.
- Aprire **Maglieria · In arrivo** per vedere come viene accolto il prossimo ampliamento del catalogo.

Le animazioni rispondono alle azioni del visitatore. Con la preferenza di movimento ridotto, i cambi restano utilizzabili senza le transizioni animate. Se JavaScript non è disponibile, rimangono il capo iniziale e un collegamento diretto al guardaroba nello shop.

## Selezione e acquisti

La selezione conserva al massimo un capo per categoria nel browser del visitatore. Se si sceglie un altro articolo della stessa categoria, quello precedente viene sostituito. Se lo storage locale non è disponibile, la selezione funziona in memoria per la sessione della pagina.

Non è un carrello: taglia, disponibilità e acquisto si gestiscono nelle schede reali di Shopify. La preview non raccoglie email, non crea ordini, non effettua chiamate autenticate allo store e non scrive nel database del gestionale.

La maglieria è soltanto una categoria futura, indicata dall'utente. Non vengono presentati maglioni, varianti o schede prodotto inventati.

## File principali

- `index.html`: scena iniziale, controlli e dialoghi.
- `style.css`: composizione desktop e telefono, stati del capo e movimento ridotto.
- `main.js`: cambio prodotto, viste ravvicinate, selezione locale e dialoghi.
- `catalog.js`: categorie, nove prodotti e riferimenti agli asset ufficiali, senza prezzi o giacenze.
- `media/`: foto prodotto, miniature, dettagli, immagini del brand, marchio e font locali.

## Fonti e materiali

Il catalogo è stato letto attraverso il plugin Shopify. Le immagini e i nomi sono quelli dello store ufficiale:

- T-shirt: [964](https://luckylap.com/products/964-tshirt), [F40](https://luckylap.com/products/f40-tshirt), [Project ’88](https://luckylap.com/products/project-88-white-t-shirt), [300 SL](https://luckylap.com/products/300-sl-t-shirt), [512 TR](https://luckylap.com/products/512tr-tshirt), [GT3 RS](https://luckylap.com/products/gt3rs-tshirt).
- Cappellini: [964 Navy](https://luckylap.com/products/964-cap-navy-blue), [Signature 3D Green](https://luckylap.com/products/signature-3d-cap-green), [Pole Position Pink](https://luckylap.com/products/pole-position-cap-pink).
- Racconto e fotografie del brand: [About LuckyLap](https://luckylap.com/pages/about-us).
- Direzione progettuale: [Taste Skill](https://github.com/leonxlnx/taste-skill) e installazione `design-taste-frontend`.

Le foto sono WebP reali, ridimensionate e senza metadati. Le proporzioni e i colori dei capi sono conservati; nessun prodotto è stato generato o ritoccato creativamente per questa proposta. Mona Sans è servito localmente con la licenza in `media/LICENSE-MonaSans.txt`.

Il brief, le scelte di interazione e gli adattamenti della skill sono in [DIREZIONE.md](DIREZIONE.md). Gli esiti dei controlli effettivi sono in [VERIFICA.md](VERIFICA.md).

Questa consegna non pubblica un tema Shopify, non cambia le impostazioni dei servizi e non costituisce un deploy di produzione. `noindex` mantiene la preview fuori dal percorso di indicizzazione previsto per lo store.
