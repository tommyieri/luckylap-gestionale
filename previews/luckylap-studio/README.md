# LuckyLap Studio: nuova anteprima dello shop

**Stato: anteprima ripresa sulla base dell’analisi e del nuovo brief del founder.** Home con sequenza del ricamo GT3 RS → F40, materiali operativi preparati e tema nativo confezionabile; nessuna pubblicazione nello store. Limiti e controlli in VERIFICHE.md.

Una proposta di redesign da esplorare prima della pubblicazione: home, cataloghi T-shirt e cappellini, nove schede prodotto, ricerca, borsa, storia del brand e percorso club/eventi/negozi. È un progetto autonomo nella cartella `previews/`; non cambia le pagine del gestionale.

## Aprire l’anteprima

Dalla radice del repository, con Node disponibile:

```sh
node previews/luckylap-studio/server.mjs
```

Aprire **http://127.0.0.1:4177**. Il server ascolta soltanto sul computer locale. Non serve installare dipendenze. La porta può essere cambiata con `LUCKYLAP_STUDIO_PORT`. Per chiuderlo usare Ctrl+C nel terminale che lo esegue. La cartella non va aggiunta alle route Next.js del gestionale.

Home, collezioni e pagine prodotto sono navigabili anche con URL diretti. La preview richiede JavaScript; senza JavaScript offre il collegamento allo shop attuale. I font e le immagini editoriali sono locali. Le immagini delle varianti bianche provengono dal CDN pubblico Shopify.

## Direzione proposta

Verde LuckyLap, fondo chiaro, logo originale, fotografia del prodotto indossato e titoli ampi. La scelta del modello è già nella prima schermata. Il dettaglio del ricamo dà sostanza al racconto; i fondatori e le collaborazioni completano il mondo del brand. La maglieria viene annunciata senza simulare prodotti già acquistabili.

Il movimento accompagna ingresso della home, cambio modello e apertura dei pannelli. Le preferenze di movimento ridotto disattivano animazioni e transizioni; non ci sono autoplay o scorrimenti forzati. I fatti di prodotto sono registrati in [PRODUCT.md](PRODUCT.md); direzione visiva e movimento in [DESIGN.md](DESIGN.md).

## Catalogo e borsa

Il server legge soltanto gli endpoint pubblici Shopify dei nove prodotti e conserva i risultati in memoria per tre minuti. Non utilizza credenziali né salva prezzi o inventario su disco. Se i dati non sono raggiungibili, la scheda propone lo shop ufficiale e il tentativo di ricaricamento. Il server non accetta richieste di scrittura.

La borsa salva in sessione soltanto prodotto, ID variante e quantità. Prezzi e disponibilità vengono riletti dal catalogo. “Continua su LuckyLap” apre un permalink nel negozio attuale con gli ID selezionati: disponibilità finale, spedizione e pagamento restano verificati da Shopify. Il test svolto non ha aperto tale link né eseguito ordini.

Per 964 e GT3 RS, le foto White non sono associate alle varianti nel catalogo pubblico. La preview usa due corrispondenze esplicite verificate visivamente tra immagini ufficiali e colori; sono in `server.mjs`, senza modificare Shopify. Il tema nativo segnala invece l’assenza di associazione: prima di pubblicarlo, collegare le foto alle varianti nel catalogo.

## Portarlo su Shopify

La cartella [shopify/](shopify/README.md) contiene un **tema nativo Online Store 2.0**, i sorgenti e lo script che produce il file ZIP da importare nella libreria temi. Non va caricata l’HTML della preview come pagina Shopify.

Il pacchetto include sezioni modificabili, schede prodotto e carrello nativi. Leggere la guida per assegnare menu, collezioni e guida taglie, verificare le fotografie delle varianti e provare la copia non pubblicata. L’accesso ai file del tema tramite il connettore richiede una nuova autenticazione: nessun tema è stato installato o pubblicato con questo lavoro.

```sh
node previews/luckylap-studio/shopify/package-theme.mjs
```

## Fonti, skill e controlli

- [Ricerca delle skill, agenti e collegamento Instagram/Metricool](RICERCA-SKILL-E-METRICOOL.md).
- [Verifiche e limiti della consegna](VERIFICHE.md).
- [Provenienza degli asset](ASSET.md).
- Licenze dei font in `media/LICENSE-MonaSans.txt` e delle icone in `LICENZA-ICONE.txt`.

Taste Skill è stato usato come riferimento insieme a Impeccable; il suo gate headless completo non è stato eseguito e non viene dichiarato superato. Sono documentati i controlli realmente svolti sul browser e sul tema.

## La nuova scena di ricamo

Il cliente controlla la sequenza con lo scroll: GT3 RS sul capo navy, distacco, passaggio fra sette contorni corrispondenti e F40 ricomposta sulla T-shirt bianca. Si può tornare indietro, passare direttamente al catalogo o ridurre il movimento. GSAP, ScrollTrigger e MorphSVGPlugin 3.15.1 sono serviti localmente; fonti e licenza in vendor/README.md. La transizione usa contorni normalizzati per l’animazione: non certifica il disegno digitale di una macchina da ricamo. Gli originali raster del brand sono conservati separati.

Per mostrare le condizioni approvate, avviare il server con LUCKYLAP_SHIPPING_POLICY_PATH verso un JSON privato esterno, con currency, rates (italy/europe/world) e freeShipping (minimumSubtotal/zones). Importi in centesimi. Senza configurazione il sito rimanda alle condizioni dello shop e non inventa tariffe. Nessuna cifra commerciale è salvata come listino nel codice. Lo stesso file può alimentare il packaging del tema; il richtext viene aggiunto soltanto nel file ZIP generato, senza modificare i settings sorgenti.
