# Provenienza degli asset

Verifica in lettura del 24 novembre 2026. I nove prodotti sono stati riscontrati nel catalogo Shopify collegato. Immagini, marchio e materiali editoriali provengono dallo store ufficiale LuckyLap; i derivati locali sono riutilizzati dalla preview precedente. La presenza nello store conferma la provenienza, non certifica che ogni immagine sia uno scatto fotografico senza elaborazioni.

## Catalogo

Tutti i file indicati sono in `media/`. Per ciascun prefisso esistono l'immagine principale `.webp`, la miniatura `-thumb.webp` e la vista aggiuntiva `-detail.webp`. Quest'ultima può mostrare un ricamo, un capo piegato o una vista laterale: non è sempre una macro. Collegamenti, alternative testuali e dimensioni sono riportati in `catalog.js`.

| Prodotto | Prefisso locale | Pagina ufficiale |
| --- | --- | --- |
| 964 T-shirt | `964-tee` | [964](https://luckylap.com/products/964-tshirt) |
| GT3 RS T-shirt | `gt3rs-tee` | [GT3 RS](https://luckylap.com/products/gt3rs-tshirt) |
| F40 T-shirt | `f40-tee` | [F40](https://luckylap.com/products/f40-tshirt) |
| 512 TR T-shirt | `512tr-tee` | [512 TR](https://luckylap.com/products/512tr-tshirt) |
| Project ’88 T-shirt | `project88-tee` | [Project ’88](https://luckylap.com/products/project-88-white-t-shirt) |
| 300 SL T-shirt | `300sl-tee` | [300 SL](https://luckylap.com/products/300-sl-t-shirt) |
| 964 cappellino navy | `964-cap` | [964 Cap](https://luckylap.com/products/964-cap-navy-blue) |
| Signature 3D verde | `signature-cap` | [Signature 3D](https://luckylap.com/products/signature-3d-cap-green) |
| Pole Position rosa | `pole-position-cap` | [Pole Position](https://luckylap.com/products/pole-position-cap-pink) |

**F40:** la sorgente ufficiale della vista aggiuntiva ha il nome `ChatGPT_Image_8_mag_2026_21_54_40.png`. Questo nome segnala una provenienza da approfondire: non presentare `f40-tee-detail.webp` come fotografia documentale o prova certificata della lavorazione. Non sono stati generati nuovi prodotti per questa preview.

## Materiali editoriali e marchio

Le tre immagini editoriali sono presenti nella [pagina About ufficiale](https://luckylap.com/pages/about-us):

| File locale | Contenuto | Originale sullo store |
| --- | --- | --- |
| `world-lifestyle.webp` | T-shirt GT3 RS navy indossata | [IMG_7068.jpg](https://luckylap.com/cdn/shop/files/IMG_7068.jpg?v=1753733469) |
| `world-founders.webp` | Fondatori con capi LuckyLap | [ll_founders.jpg](https://luckylap.com/cdn/shop/files/ll_founders.jpg?v=1779123766) |
| `world-monza.webp` | Vettura da gara nel contesto di Monza | [IMG_1244.webp](https://luckylap.com/cdn/shop/files/IMG_1244.webp?v=1782493034) |

`logo-original.png` corrisponde al [PNG del marchio usato dallo store](https://luckylap.com/cdn/shop/files/Donna_Stroupe_1db9c773-a32d-4114-ba6c-716e6e11fb58.png?v=1742859432): 1563 × 1563 pixel, con trasparenza effettiva verificata. I file `logo-square*.webp` sono derivati locali. Non è stato individuato un SVG ufficiale pubblico.

La maglieria futura non ha immagini prodotto in questa consegna. Nessun mockup viene presentato come fotografia di un maglione disponibile.

## Font e icone

- `mona-400.ttf` e `mona-500.ttf`: [Mona Sans](https://github.com/github/mona-sans), distribuito localmente con licenza SIL Open Font License 1.1, conservata in `media/LICENSE-MonaSans.txt`.
- `icons.svg`: simboli derivati da [Lucide](https://lucide.dev/). La licenza ISC e le attribuzioni MIT applicabili alle icone derivate da Feather sono conservate in `LICENZA-ICONE.txt`.

Nessun prezzo, giacenza o data di lancio è attestato da questo manifest.

## Livelli della scena animata, 25 novembre

- animation-shirt-navy.webp e animation-shirt-white.webp: livelli elaborati con lo strumento integrato ImageGen dalle rispettive foto prodotto ufficiali, rimozione del ricamo frontale e scontorno per la sola composizione animata. Originali prodotto conservati. Conversione WebP con alpha; prompt in PROMPT-ANIMAZIONE.json. Non rappresentano nuovi capi senza ricamo acquistabili.
- gt3rs-originale-drive.png e f40-originale-drive.png: disegni raster originali del brand, copiati senza ritocchi da LuckyLap/Grafiche/Auto. Sono riferimenti autorizzati del founder; fonte e SHA nel dossier esterno ORIGINALI-RICAMI-DRIVE.md.
- embroidery-morph.js contiene sette contorni normalizzati e semplificati per il passaggio animato. Sono distinti dagli originali e dalle fotografie del ricamo.
- Gli estremi usano i dettagli ufficiali GT3 RS e F40 con maschera alpha a runtime. Il dettaglio F40 mantiene la nota di provenienza già indicata sopra.

## Filmato con sei modelli

- `animation-shirt-blue.webp`, `animation-shirt-964-white.webp`, `animation-shirt-project88.webp`: livelli ImageGen ricavati dalle immagini ufficiali delle rispettive T-shirt, con rimozione del solo ricamo frontale e del fondo. Conservano la firma sulla manica. Sono livelli di composizione; le foto prodotto del catalogo restano separate. La 512 TR usa la base bianca con firma rossa già preparata per la F40.
- `orig-964-drive.png` e `orig-512tr-drive.png`: copie identiche degli originali `911.png` e `TR.png` della cartella Drive Grafiche/Auto. `orig-project88-senna-drive.jpg` è la copia identica di `SENNA.jpeg`, originale a colori su fondo bianco, non trasparente. Fonte, dimensioni e hash sono registrati nel dossier esterno `originali-video/FONTI.json`. Per la 300 SL non è stato trovato un disegno separato; il filmato usa il dettaglio ufficiale `300sl-tee-detail.webp`.
- `video/cars.js`: sette parti per ciascuno dei sei modelli, normalizzate e semplificate soltanto per il breve morph intermedio. GT3/F40 riprendono la precedente geometria; gli altri quattro sono disegnati dai riferimenti. Non sono originali certificati per ricamo.
- `hero-ricami.mp4` e `hero-ricami-mobile.mp4`: composizioni locali HyperFrames, rispettivamente orizzontale e verticale, senza audio o testi incorporati. Il materiale del brand è animato per livelli; il distacco e il rientro sono effetti di compositing. I due file `hero-ricami*-poster.webp` sono fotogrammi degli stessi filmati.

I tentativi Higgsfield non hanno prodotto video: entrambi i collegamenti hanno rifiutato l’avvio per requisito di piano. Prompt, quote e risposte sono nel dossier privato; non attribuire a Higgsfield gli MP4 locali.
