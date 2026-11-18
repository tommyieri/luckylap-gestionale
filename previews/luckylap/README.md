# Preview della landing LuckyLap

Prototipo statico in italiano, nato dallo studio del brand, del catalogo Shopify e della [Taste Skill 2.5.1](https://github.com/leonxlnx/taste-skill).

Per aprirlo dalla radice del repository, senza installare dipendenze:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory previews/luckylap
```

Poi aprire [la preview locale](http://127.0.0.1:4173). Per fermare il server, premere Ctrl+C nel terminale.

La pagina deve essere servita via HTTP: aprire direttamente il file HTML non permette al browser di caricare i moduli JavaScript.

## Cosa contiene

- Hero fotografico con il ricamo ingrandito e un capo indossato.
- Scelta interattiva tra 964, F40, Project ’88 e 300 SL: cambiano foto, descrizione e destinazione dello shop.
- Tre scene fotografiche del mondo LuckyLap, con scorrimento nativo e versione statica per movimento ridotto.
- Dettaglio del ricamo e informazioni verificate sulla lavorazione.
- Navigazione mobile, collegamenti alle pagine reali di acquisto e alternativa senza JavaScript.

Gli acquisti, le taglie e la disponibilità si consultano nello store esistente. La preview non effettua richieste autenticate, scritture Shopify, raccolta di email o transazioni. Non contiene prezzi, contatti personali, credenziali o dati di inventario. `noindex` impedisce di presentarla come pagina da indicizzare.

## Origine dei materiali

Le fotografie e il marchio provengono dal sito e dal catalogo ufficiali LuckyLap. Sono state ricodificate in WebP e private dei metadati senza ritocchi creativi. I ritagli avvengono nel layout tramite CSS; il dettaglio 964 ha anche un ritaglio mobile dedicato, ricavato dallo stesso originale per conservare la nitidezza. Le foto di campagna della homepage con indicazione di generazione artificiale non sono utilizzate.

- Foto indossata, founder e motorsport: [storia ufficiale](https://luckylap.com/pages/about-us).
- Ricami e fotografie prodotto: [964](https://luckylap.com/products/964-tshirt), [F40](https://luckylap.com/products/f40-tshirt), [Project ’88](https://luckylap.com/products/project-88-white-t-shirt), [300 SL](https://luckylap.com/products/300-sl-t-shirt), [GT3 RS](https://luckylap.com/products/gt3rs-tshirt).
- Logo: asset originale `Donna_Stroupe_1db9c773-a32d-4114-ba6c-716e6e11fb58.png` servito dallo store.
- Font: Mona Sans, distribuito con licenza SIL Open Font License in `media/LICENSE-MonaSans.txt`.
- Runtime di layout e movimento: Taste Skill, licenza MIT in `assets/LICENSE-taste-skill`.

Direzione, fatti e scelte: [DIREZIONE.md](DIREZIONE.md). Risultati dei controlli: [VERIFICA.md](VERIFICA.md).
