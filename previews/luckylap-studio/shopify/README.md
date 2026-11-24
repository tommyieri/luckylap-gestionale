# LuckyLap Studio — tema Shopify

Tema Online Store 2.0 preparato per l’installazione nella libreria temi come copia non pubblicata. Il file da caricare è `luckylap-studio.zip`. La cartella `theme/` contiene i sorgenti modificabili.

Il tema comprende home, header e footer a gruppi di sezioni, collezione, prodotto, carrello, pagina, contatti, ricerca, elenco delle collezioni, errore 404 e pagina password. La home riprende la direzione visiva della preview: verde LuckyLap, scelta del modello, catalogo, dettaglio del ricamo, futura maglieria, fondatori e opportunità per club, eventi e negozi.

## Installazione nella libreria

1. In Shopify aprire **Negozio online → Temi → Importa tema → Carica file ZIP** e scegliere `luckylap-studio.zip`. Non pubblicarlo durante questa prova.
2. Aprire **Personalizza** sulla copia aggiunta alla libreria. Collegare il menu del negozio in Header e i menu del footer. I collegamenti predefiniti usano le collezioni e le pagine già presenti, quando disponibili.
3. In Home controllare i prodotti del selettore 964 / F40 / GT3 RS, il prodotto della fotografia principale e la collezione da mostrare. I riferimenti iniziali sono gli handle pubblici verificati: `964-tshirt`, `f40-tshirt`, `gt3rs-tshirt`. Se un handle cambia, scegliere di nuovo il prodotto dall’editor.
4. Controllare immagini, testi, collegamenti e ordine delle sezioni. Foto di hero, ricamo e fondatori e logo sono già inclusi nel pacchetto; gli `image_picker` permettono di sostituirli dall’editor.
5. Nel template Prodotto selezionare la pagina **Guida taglie** corretta. Il contenuto è quello della pagina scelta: il tema non inventa misure e non sostituisce i dati presenti in Shopify.
6. Prima della pubblicazione associare alle varianti le fotografie bianche/navy corrette in Shopify, in particolare per `964-tshirt` e `gt3rs-tshirt`: le varianti consultate non espongono tutte una foto associata. Finché manca l’associazione, il tema ripristina la foto generale e mostra una nota esplicita; non deduce il colore dal nome del file. Questo pacchetto non modifica il catalogo.
7. Per la pagina Contatti, assegnare il template `page.contact` alla pagina desiderata. Il modulo usa il form contatto nativo Shopify. Le destinazioni delle email dipendono dalle impostazioni del negozio.
8. Verificare la copia del tema con i compiti di collaudo descritti sotto. La pubblicazione dello store richiede la decisione esplicita del founder prevista dalle regole del progetto.

L’installazione del tema non crea prodotti, pagine, collezioni, lingue, menu o configurazioni di spedizione. I nomi dei menu possono variare nella lingua dell’amministrazione Shopify.

## Che cosa è modificabile

- Testi, immagini e destinazioni delle sezioni della home.
- Prodotti del selettore e collezione in evidenza, numero di prodotti e filtri T-shirt / cappellini.
- Logo, navigazione, menu del footer e collegamento all’Instagram ufficiale `@lucky.lap`.
- Colori globali e caratteri: Mona Sans locale, con licenza inclusa, oppure un carattere selezionato da Shopify.
- Guida taglie e dettagli aggiuntivi della scheda prodotto, pulsanti accelerati opzionali, note del carrello.
- App block nella pagina prodotto e nella pagina generica.

Le etichette dell’interfaccia sono disponibili in italiano e inglese (`locales/it.json`, `locales/en.default.json`). La lingua viene scelta dalle lingue pubblicate del negozio: il tema non attiva nuovi mercati. I testi inseriti come impostazioni dall’editor e le descrizioni dei prodotti restano contenuti del negozio, da tradurre con il normale flusso Shopify.

## Catalogo, carrello e pagamenti

Prodotti, varianti, prezzi, valuta, disponibilità, immagini e regole di quantità arrivano dagli oggetti Liquid del negozio al momento della visita. Il tema non contiene un listino salvato, quantità simulate, nuove offerte o date di lancio. Mantiene i nomi effettivi delle varianti, comprese eventuali traduzioni presenti nel catalogo.

Il prodotto invia il form nativo Shopify con l’ID della variante selezionata. Il carrello usa il form Shopify, gli aggiornamenti delle quantità e i collegamenti di rimozione nativi. Il pulsante di checkout è un invio del carrello con `name="checkout"`: apre il checkout ospitato da Shopify e i metodi di pagamento già configurati nel negozio. Nessun campo carta, fornitore di pagamento o checkout parallelo è implementato dal tema.

I selettori avanzati sono un miglioramento progressivo: senza JavaScript rimane la selezione nativa della variante. Le combinazioni inesistenti vengono disabilitate, gli esauriti non possono essere inviati e il server Shopify ricontrolla disponibilità e quantità alla richiesta reale. Per prodotti futuri con più di 250 varianti andrà aggiornato il selettore al percorso Shopify per cataloghi ad alto numero di varianti; il catalogo LuckyLap verificato rientra nel percorso implementato.

I riferimenti a spedizione e resi puntano alle policy effettive del negozio, quando presenti. Il tema non promette soglie, prezzi o tempi di consegna non confermati. Le descrizioni esistenti dei prodotti e il contenuto delle pagine non vengono riscritti dall’installazione.

## Fatti di prodotto

Per le T-shirt i testi editoriali parlano di ricamo a macchina realizzato in Italia su cotone biologico; non estendono l’origine del ricamo alla produzione dell’intero capo. La sezione **Maglieria futura** usa esclusivamente per i maglioni futuri le informazioni approvate dal founder: **100% lana, Made in Italy**. Non presenta un prodotto già acquistabile, un prezzo o una data inventata. I link di acquisto derivano soltanto dal catalogo Shopify.

## Verifiche eseguite e limiti

- Validazione full-app con il validatore Liquid/tema della skill Shopify: schema dei settings, sezioni, template, traduzioni e riferimenti. Telemetria disattivata con `OPT_OUT_INSTRUMENTATION=true`; nessun prompt trasmesso.
- Controllo sintattico Node del JavaScript e dello script di confezionamento.
- Quattordici controlli browser sul JavaScript effettivo con soli dati sintetici: esaurito iniziale, fallback nativo, ID della variante, prezzo mostrato, min/step/max quantità, combinazione inesistente, ritorno a esaurito, cambio combinazione valida, rimozione dei vincoli precedenti, deep link, immagine associata, ripristino della foto generale con nota, galleria, scelta del prodotto e filtro catalogo.
- Integrità ZIP controllata dopo la creazione.

Il test browser sintetico non invia il modulo al carrello e non dimostra che Shopify abbia accettato il tema caricato o processato un pagamento. Non è stata eseguita una prova end-to-end sul tema installato: l’accesso al tema via connettore richiede nuovamente autenticazione. Nessun tema è stato caricato, pubblicato o modificato nello store tramite questo lavoro.

Prima della pubblicazione, nella copia non pubblicata controllare: home desktop/mobile, menu, filtri, prezzi e varianti, variante esaurita, guida taglie, aggiunta del capo, aggiornamento/rimozione dal carrello, policy, lingua e raggiungimento del checkout. Non inserire recapiti o effettuare pagamenti di prova senza un’autorizzazione distinta.

## Ricreare il pacchetto

Dalla radice del repository:

```sh
node previews/luckylap-studio/shopify/package-theme.mjs
```

Lo script ricopia la CSS corrente della preview adattando i percorsi dei font, sincronizza le sole immagini editoriali e i font autorizzati e crea lo ZIP con le directory Shopify alla radice. Il JavaScript della preview non viene copiato: nel tema viene utilizzato `assets/theme.js`, che conserva form e checkout nativi.

Per validare i sorgenti usare il `validate.mjs` della skill Shopify installata, in modalità `--api liquid --theme-path … --files …`, con l’elenco di tutti i file del tema. Dopo modifiche ai sorgenti rigenerare e ricontrollare lo ZIP; i documenti di questa cartella e lo script di packaging non entrano nell’archivio.

## Riferimenti ufficiali

- [Architettura dei temi](https://shopify.dev/docs/storefronts/themes/architecture).
- [Varianti e deep link](https://shopify.dev/docs/storefronts/themes/product-merchandising/variants).
- [Carrello e checkout nativi](https://shopify.dev/docs/storefronts/themes/architecture/templates/cart).
- [Prestazioni dei temi](https://shopify.dev/docs/storefronts/themes/best-practices/performance).
