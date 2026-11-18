# Verifica della preview LuckyLap V2

Controlli locali eseguiti il 18 novembre 2026 sulla preview statica, servita in HTTP su `127.0.0.1:4174`. Non attestano un rilascio dello store o del gestionale.

## Catalogo e materiali

- Nove prodotti verificati attraverso il plugin Shopify: sei T-shirt e tre cappellini. Collegamenti pubblici verificati in lettura.
- Immagini originali del catalogo e della pagina About, ottimizzate in WebP senza alterazioni creative dei capi. Nessuna fotografia di maglieria inventata.
- Nessun prezzo, disponibilità, recensione o dato cliente salvato nella preview.
- Logo originale, font locali con licenza SIL OFL e icone derivate dalla dipendenza Lucide già presente, con licenza ISC conservata.

## Prove funzionali in Chrome

Un percorso nel browser ha superato **45 asserzioni**: per tutti i nove prodotti sono stati controllati fotografia principale, nome, collegamento reale, seconda fotografia, etichetta della vista, zoom e centratura. Il percorso comprende anche scelta T-shirt e cappellino, sostituzione nella stessa categoria, due collegamenti allo shop, dialoghi e tre capitoli fotografici del brand.

Ulteriori controlli eseguiti:

- Trascinamento effettivo con il puntatore: passaggio da 964 a F40 e ritorno del capo nella posizione neutra.
- Trascinamento nel dettaglio: spostamento della foto, limiti del pan, comando più da tastiera ed Escape per tornare al capo.
- Persistenza: dopo il ricaricamento restano i due identificativi scelti. Rimozione e stato vuoto aggiornano contatore e storage.
- Dialoghi nativi: apertura modale, navigazione da tastiera, chiusura con Escape e ritorno del focus al comando iniziale.
- Errore controllato nella decodifica di una fotografia: il capo precedente rimane leggibile, compare il messaggio e il nuovo tentativo riesce.
- Revisione indipendente e harness asincrono temporaneo: richieste immagini obsolete ignorate, ultima intenzione preservata, errori tardivi ignorati, recupero dopo errore, interruzione dell'animazione al gesto, modificatori Ctrl/Cmd rispettati e drag annullato al cambio capo.
- Harness della preferenza di movimento ridotto: le transizioni vengono concluse e la selezione resta disponibile. Il CSS disattiva animazioni e transizioni per `prefers-reduced-motion: reduce`; la preferenza del sistema operativo non è stata cambiata.
- Nessun errore nella console nella verifica finale del caricamento. Un reset di connessione del server locale durante una ricarica precedente è stato risolto riavviando il server di preview; il file del logo è stato ricontrollato e decodificato nel browser.

## Layout

Controllati i formati 320×720, 390×844, 430×932, 768×1024, 1024×768, 1280×720, 1440×900 e 1920×1080. Verificate immagini e controlli in screenshot reali. Corrette le sovrapposizioni fra presentazione e scheda prodotto, il bordo dell'ellisse su tablet e l'espansione orizzontale dei nomi lunghi.

A 320 px sono stati provati tutti i nove prodotti: nessuna espansione del viewport. Su questo formato la scena può scorrere brevemente in verticale per conservare la dimensione dei testi e dei controlli. La lista delle miniature scorre nel proprio contenitore ed è utilizzabile anche con le frecce e da tastiera. A 390×844 la vista iniziale occupa una schermata.

## Skill e controlli automatici

- Taste Skill 2.5.1: `copy-lint.mjs index.html --kind product --json`, **nessun finding**. Ricontrollati manualmente anche i testi dinamici del catalogo e dei dialoghi.
- Preflight di `design-taste-frontend`: tema chiaro unico, verde del brand, immagini reali, nessun dato decorativo inventato, movimento motivato dai gesti, stato vuoto/caricamento/errore e percorso da tastiera.
- Lighthouse in modalità desktop e mobile: accessibilità **100**, buone pratiche **100**, SEO **63**. L'indicizzazione è bloccata deliberatamente da `noindex,nofollow`, perché questa è una preview. Il controllo utilizzato esclude il punteggio completo di performance; questi numeri non sono una certificazione delle prestazioni in produzione.
- `node --check` su `main.js` e `catalog.js`: superato.
- `npm run format` e `npm run format:check`: superati.
- `git diff --check`: superato prima del commit.

Come descritto in [DIREZIONE.md](DIREZIONE.md), il brief richiede un guardaroba azionato dal visitatore. Lo scaffold verticale e i limiti generali della motion della skill sono stati adattati a questa richiesta. Non è stato eseguito il gate completo di Taste e non viene dichiarato `GATE: PASS` per questa versione.

## Limiti della prova

La QA visuale e funzionale è avvenuta in Chrome desktop con emulazione delle dimensioni mobili e del touch. Safari, Firefox e dispositivi fisici non sono stati provati. Il fallback senza JavaScript è presente nel markup, ma non è stato verificato disabilitando JavaScript nel browser.

La selezione è locale e non sincronizzata con il carrello Shopify. Le schede reali gestiscono taglie, disponibilità e acquisto. Per attivare la maglieria serviranno schede e immagini reali e l'aggiornamento dei testi del percorso.

Nessuna modifica a codice applicativo, dipendenze o servizi di produzione. Le suite TypeScript, Vitest, build Next e database del gestionale non sono state eseguite per questa preview statica isolata. Non è stata aperta una pull request, effettuato un merge o avviato un deploy di produzione.
