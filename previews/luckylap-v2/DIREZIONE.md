# LuckyLap V2: un guardaroba da esplorare

Kind `product`, site-kind `other`. Una scena di abbigliamento per appassionati di automobili, con linguaggio editoriale e interazioni guidate dai gesti del visitatore.

## La richiesta che guida questa versione

La seconda proposta deve essere più audace, riconoscibile come LuckyLap e interessante anche senza scorrere una sequenza di sezioni. Il visitatore deve poter scegliere, avvicinarsi al prodotto e comporre un abbinamento. Il catalogo comprende oggi T-shirt e cappellini; l'utente ha indicato l'arrivo della maglieria fra circa un mese.

La V2 usa un unico guardaroba scenico. Il capo resta al centro e le azioni cambiano ciò che si vede. Il mondo del brand si apre come un ambiente fotografico, senza aggiungere un lungo manifesto verticale.

## Lettura del brand

Il punto distintivo è riconoscere una passione attraverso un piccolo ricamo: la silhouette sul petto, una firma, un richiamo automobilistico discreto. Il legame con i motori vive nei soggetti e nelle forme dei prodotti, non in una simulazione di gara.

Il nome LuckyLap richiama l'istante in cui precisione, emozione e armonia coincidono. Questi valori suggeriscono movimenti brevi e controllati: il capo risponde al gesto, cambia direzione e si ferma nella propria posizione. Non servono telemetria inventata, numeri decorativi, audio automatico o un ingresso da saltare.

Fonti del racconto: [storia ufficiale](https://luckylap.com/pages/about-us), [collezioni](https://luckylap.com/pages/collections) e schede prodotto lette attraverso il plugin Shopify. Il testo evita promesse di lavorazioni manuali o di produzione dell'intero capo non confermate dalle fonti.

## Taste Skill e scelte deliberate

La guida è [Taste Skill 2.5.1](https://github.com/leonxlnx/taste-skill), insieme alle indicazioni dell'installazione `design-taste-frontend`.

- `DESIGN_VARIANCE: 9`: composizione ampia, identificativo dell'icona a scala grande, capo e testo nello stesso spazio.
- `MOTION_INTENSITY: 8`: cambi di capo, passaggio al dettaglio, trascinamento e riscontro della selezione. Il movimento segue un'azione, senza autoplay.
- `VISUAL_DENSITY: 3`: poche parole, un prodotto protagonista e controlli raccolti ai bordi della scena.

Il brief dell'utente supera deliberatamente lo scaffold a sezioni verticali e la moderazione generale del movimento prevista per i prodotti nella versione 2.5. Questa proposta usa categorie e viste azionate dall'utente, trascinamento e dialoghi. Non replica il percorso della V1 o i suoi momenti di scorrimento.

Restano validi i principi della skill: materiale reale del brand, una grammatica visiva coerente, tipografia leggibile, azioni comprensibili, feedback immediato, navigazione da tastiera, alternativa touch e rispetto del movimento ridotto. Non viene dichiarato un superamento automatico del gate generale della skill: i controlli effettivamente eseguiti sono riportati in [VERIFICA.md](VERIFICA.md).

## Sistema visivo

Il marchio è la firma originale LuckyLap. Il verde rimane il riferimento riconoscibile dell'interfaccia; i fondi neutri riprendono quelli delle immagini prodotto, senza applicare blend o tinte che cambino il bianco dei capi.

Il grigio dei mockup è `#dadada`; la T-shirt 300 SL usa il proprio fondo `#e5e5e5`. Il cambiamento resta dentro la stessa famiglia neutra. Mona Sans, nei pesi locali 400 e 500, tiene insieme titoli, controlli e descrizioni.

L'identificativo automobilistico grande è il nome del prodotto, non una statistica. L'ellisse di fondo richiama il giro del marchio senza presentarsi come un circuito reale o una specifica tecnica.

## Interazioni

1. **Sfoglia il guardaroba.** Trascinamento orizzontale, frecce e pulsanti con miniature cambiano il prodotto reale. Cambiano insieme fotografia, identificativo, descrizione, colore e collegamento allo shop. Le famiglie sono T-shirt e cappellini; non si costruiscono combinazioni di grafica e capo inesistenti.
2. **Guarda da vicino.** Il comando apre una seconda fotografia ufficiale dello stesso prodotto o della sua famiglia. Zoom e spostamento permettono di esplorarla. Il testo identifica il soggetto effettivo: per esempio, la 512 TR mostra il capo piegato e il cappellino 964 una vista laterale. Non si promettono rotazioni a 360 gradi o retro che non esistono negli asset.
3. **Componi un abbinamento.** La selezione conserva un capo per categoria. Scegliere un altro prodotto della stessa famiglia sostituisce quello precedente. Il visitatore può rimuovere i capi e aprire le rispettive schede Shopify per taglia e disponibilità.
4. **Apri il mondo LuckyLap.** Un dialogo contiene tre capitoli fotografici: cultura dei motori, origine del progetto e vita quotidiana. Il cambio di capitolo segue un comando del visitatore.
5. **Scopri il prossimo capitolo.** La voce Maglieria apre un annuncio breve. Non contiene prodotti simulati, fotografie attribuite a maglioni LuckyLap, prezzi o date di lancio inventate.

La selezione usa lo storage locale del browser, con un'alternativa in memoria se lo storage non è disponibile. Non è un carrello e non invia ordini. Il collegamento allo shop apre il prodotto reale.

## Crescita del catalogo

`catalog.js` separa le categorie dai prodotti. I record contengono nome, famiglia, descrizione, immagini, etichette della vista e URL pubblico; non includono prezzi o giacenze.

Sono presenti sei T-shirt e tre cappellini verificati. `knitwear` è una categoria `soon`, senza record di prodotto. Al lancio della maglieria serviranno schede e immagini reali, l'attivazione della categoria e la revisione dei testi e del percorso di selezione. La struttura scenica può restare la stessa.

## Provenienza degli asset

Le immagini provengono dal catalogo Shopify e dal sito ufficiale LuckyLap. Le nove schede e i relativi collegamenti sono stati verificati in lettura. Nessun asset rappresenta un prodotto inventato per la proposta.

Le immagini sono state ricodificate in WebP, ridimensionate mantenendo le proporzioni e private dei metadati. Le viste principali sono larghe 960 px, le miniature 240 px e i dettagli arrivano a 1200 px di larghezza quando l'originale lo consente. Non sono stati effettuati ritocchi creativi ai capi.

Le fotografie del mondo LuckyLap arrivano dalla pagina About. Logo e alcuni materiali già ottimizzati sono riutilizzati dalla prima preview. I font locali conservano la licenza SIL Open Font License in `media/LICENSE-MonaSans.txt`.

La preview resta separata dallo store e dal gestionale. L'implementazione della scena è locale, con CSS e JavaScript nativi; non richiede nuove dipendenze o modifiche ai servizi di produzione.
