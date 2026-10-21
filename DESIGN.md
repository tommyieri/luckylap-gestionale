---
name: LuckyLap Gestionale
description: Sistema visivo operativo del gestionale interno LuckyLap.
colors:
  green: "#1d4b07"
  green-dark: "#15370a"
  green-wash: "#e4ecdb"
  paper: "#ffffff"
  ink: "#121512"
  muted: "#5a6257"
  rule: "#c9cfc3"
  tint: "#f3f5f0"
  amber: "#875800"
  amber-wash: "#f8f1df"
  red: "#9b3b25"
typography:
  display:
    fontFamily: "BarlowCondensed, Barlow, sans-serif"
    fontSize: "38px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Barlow, Arial, sans-serif"
    fontSize: "29px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Barlow, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Barlow, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  table:
    fontFamily: "Barlow, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Barlow, Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  compact: "3px"
  tag: "4px"
  control: "5px"
  note: "6px"
  radius: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  control: "12px"
  md: "16px"
  panel-gap: "20px"
  lg: "24px"
  xl: "28px"
  wide: "32px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "#2e3827"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  search-input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 11px"
  navigation-item:
    textColor: "#d9e4d0"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  navigation-item-active:
    backgroundColor: "{colors.green-wash}"
    textColor: "{colors.green-dark}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  stock-status:
    textColor: "{colors.green}"
    typography: "{typography.label}"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.radius}"
    padding: "23px"
  inventory-row:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.table}"
    padding: "11px 17px"
  calendar-day:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
  calendar-day-selected:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
  product-detail:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    width: "456px"
    padding: "22px 30px 30px"
---

# Design System: LuckyLap Gestionale

## Overview

**Creative North Star: "LuckyLap operativo"**

L'identità riprende il progetto partner del brand: verde racing, superfici chiare, inchiostro scuro e Barlow. La cultura automobilistica emerge nel marchio condensato e inclinato; l'interfaccia di lavoro usa caratteri regolari e una gerarchia misurata.

Il gestionale privilegia quantità leggibili, separatori sottili e controlli familiari. Le superfici sono compatte e prevalentemente piatte. La navigazione scura dà un riferimento stabile, mentre il contenuto rimane chiaro e ordinato.

**Key Characteristics:**

- Verde racing come accento e riferimento di navigazione.
- Dati compatti con gerarchia tipografica e numeri allineati.
- Superfici chiare, bordi sottili e profondità limitata agli elementi sovrapposti.
- Navigazione laterale su desktop e menu apribile su telefono.

Rilievo dell'implementazione del 21 ottobre 2026: `src/app/globals.css`, `src/components/management-app.tsx` e schermate finali desktop, telefono e packaging. Le regole descrivono la prima anteprima locale; non attestano l'attivazione dei servizi condivisi.

## Colors

La palette associa un verde scuro netto a bianchi leggermente verdi e toni neutri caldi.

### Primary

- **Verde racing** (`green`): azioni principali, collegamenti, disponibilità e giorno selezionato nel calendario.
- **Verde scuro** (`green-dark`): sfondo della navigazione laterale e testo della voce selezionata.
- **Verde chiaro** (`green-wash`): voce selezionata, filtri attivi e piccoli stati interattivi.

### Neutral

- **Bianco** (`paper`): pannelli, tabella, barra superiore e dettaglio prodotto.
- **Inchiostro** (`ink`): titoli, quantità e testo principale.
- **Grigio verde** (`muted`): descrizioni, etichette e informazioni secondarie.
- **Bordo grigio verde** (`rule`): confini dei pannelli, separatori e campi.
- **Fondo chiaro** (`tint`): sfondo generale e aree di appoggio.

Ambra (`amber`, `amber-wash`) e rosso (`red`) sono colori di stato, rispettivamente per dati da verificare e quantità esaurite. Non costituiscono ulteriori accenti di brand. Gli stati di magazzino abbinano colore e testo: Disponibile, Esaurito, Da verificare.

**The State Labels Rule.** Accompagnare il colore di stato con una dicitura leggibile; preservare la distinzione tra zero e dato mancante.

I valori normativi sono nel frontmatter. Le rampe OKLCH nel sidecar sono sintetizzate per esplorazione nel pannello Impeccable, non sono una scala già applicata alla UI.

## Typography

**Display Font:** Barlow Condensed, registrato nel CSS come `BarlowCondensed`, con Barlow e sans-serif di riserva. Il marchio usa il file Bold Italic locale.

**Body Font:** Barlow, con Arial e sans-serif di riserva. I pesi locali disponibili sono 400, 500, 600 e 700, con `font-display: swap`.

L'inclinazione è riservata al marchio e al monogramma del brand. Titoli e dati conservano forme regolari. Gli SKU usano Barlow di corpo minore, non un carattere monospaziato.

### Hierarchy

- **Display:** marchio nella navigazione; le proprietà sono nel token `display`.
- **Headline:** titolo della pagina; si riduce a 27 px sotto 980 px e a 26 px sotto 430 px.
- **Title:** titolo dei pannelli; rimane più contenuto del titolo di pagina.
- **Body:** testo generale. Descrizioni e contenuti operativi ricorrono anche a corpi di 11–13 px.
- **Table:** righe dei prodotti; SKU secondario a 9 px, intestazioni a 10 px.
- **Label:** metadati e stati. Le etichette dei gruppi di navigazione sono maiuscole, a 9 px con spaziatura di 0,1 em.

**The Aligned Numbers Rule.** Quantità e importi usano cifre tabulari; le colonne numeriche della tabella sono allineate a destra.

## Layout

La barra laterale è fissa e larga 232 px sul desktop, con riduzioni a 210 px e 200 px nei passaggi intermedi. La barra superiore è alta 68 px. Il contenuto ha una larghezza massima di 1620 px, margini automatici e padding laterale ordinario di 38 px. La pagina inizia con titolo e azione, seguiti da un riepilogo orizzontale, strumenti di ricerca e tabella.

I pannelli ricorrono a una distanza di 20 px; i controlli usano intervalli più stretti di 7–12 px. L'implementazione combina i passi dello schema di spaziatura con aggiustamenti locali osservati, per esempio padding di 23 px nei pannelli e di 34 px sopra il contenuto.

Sotto 760 px la barra laterale diventa un menu apribile con sfondo oscurato. La barra superiore scende a 58 px, nasconde la data e conserva sezione attiva e indicazione locale. Il contenuto ha padding di 20 px, ridotto a 15 px sotto 430 px. La ricerca occupa la larghezza disponibile e i filtri vanno a capo.

La tabella mobile mostra prodotto/SKU, taglia e quantità centrale; in conto vendita mostra invece la quantità affidata. Colore, prezzi e altri dettagli restano nel pannello prodotto. Il riepilogo mantiene quattro valori. I contenitori di tabella gestiscono lo scorrimento senza allargare l'intera pagina.

Calendario e agenda sono affiancati con proporzioni 1,65:1 sul desktop e diventano una colonna sotto 1250 px. Le colonne di attività e note seguono la stessa riduzione a una colonna. I breakpoint effettivi sono registrati nel sidecar.

## Elevation & Depth

Pannelli e tabelle sono piatti: si distinguono tramite fondo, bordo e spaziatura. La navigazione scura e le campiture verdi chiare definiscono il contesto senza ombre diffuse. Le ombre compaiono soltanto nel dettaglio prodotto sovrapposto e nel messaggio di conferma.

### Shadow Vocabulary

- **Dettaglio prodotto:** ombra laterale (`-12px 0 40px #12200720`); accompagna il pannello ancorato al margine destro e un backdrop scuro trasparente.
- **Conferma temporanea:** ombra breve (`0 7px 24px #10200830`); separa il messaggio dal contenuto sottostante.

**The Flat Panels Rule.** Conservare bordi e campiture come separazione ordinaria dei pannelli; usare le ombre osservate per gli elementi sovrapposti.

Il dettaglio entra lateralmente in 0,2 s con `cubic-bezier(.16,1,.3,1)`. Le transizioni cromatiche durano 0,16 s con `ease-out`. La preferenza `prefers-reduced-motion: reduce` disattiva animazioni e transizioni.

## Shapes

I pannelli hanno angoli lievemente arrotondati con il token `radius`; i controlli impiegano `control`, i piccoli cartellini `compact` o `tag`. I bordi sono perlopiù di 1 px. La forma rimane rettangolare, con pochi cerchi riservati a indicatori di stato e campioni colore.

Il dettaglio prodotto è un pannello rettangolare a tutta altezza, aderente al margine destro, senza bordo né arrotondamento. I contenitori delle tabelle ritagliano le righe entro il perimetro arrotondato. Gli stati selezionati cambiano campitura, non geometria.

## Components

### Buttons

Controlli compatti con icona lineare e testo. Il primario usa verde racing e testo bianco, il secondario fondo bianco e bordo grigio verde. Il padding ordinario è di 9 × 14 px, l'altezza minima 38 px, il testo 12 px e il raggio quello di `control`. L'hover del primario scurisce il fondo; il secondario assume un verde molto chiaro. Il focus visibile globale usa un contorno verde di 3 px con offset di 3 px. I pulsanti disabilitati hanno opacità 0,5.

### Inputs / Fields

Campi chiari con bordo sottile, raggio `control`, testo operativo di 12 px e altezza minima 38 px. La ricerca combina icona, campo senza bordo interno e cancellazione contestuale. Il focus della ricerca agisce sul contenitore con bordo verde e contorno chiaro; gli altri campi conservano il contorno globale visibile. Le etichette rimangono distinte dai segnaposto.

### Navigation

Icone lineari e testo di 13 px, raggruppati da piccole etichette maiuscole. Ogni voce occupa almeno 41 px in altezza; la voce selezionata usa verde chiaro e testo verde scuro. L'hover delle altre voci schiarisce il fondo in modo contenuto. Sul telefono il menu include chiusura, focus contenuto nel pannello ed Escape.

### Chips / Status

Le etichette di disponibilità sono testo di 10 px con un punto di 5 px. La taglia è un piccolo cartellino chiaro con bordo e raggio `compact`. Il filtro per modello usa campitura verde chiaro quando attivo e comunica la selezione anche con `aria-pressed`. Questi elementi non assumono l'aspetto di grandi pillole promozionali.

### Cards / Containers

Pannelli bianchi, bordo sottile e raggio `radius`. Il pannello standard ha padding di 23 px; strumenti e tabella adottano spaziature proprie più compatte. Le intestazioni allineano titolo e metadati. I materiali di packaging usano una tabella semplice con voci, quantità e costo unitario; i dati assenti hanno una dicitura esplicita.

### Inventory Table

Intestazione verde molto chiara, gruppi per modello ancora più chiari e righe separate da linee sottili. Il prodotto dispone nome e SKU su due livelli; taglia al centro, numeri a destra, stato leggibile. L'hover schiarisce la riga e il focus del pulsante prodotto evidenzia l'intera riga. La variante compatta mobile conserva una gerarchia leggibile senza rimpicciolire l'interfaccia.

### Calendar

Griglia a sette colonne con celle rettangolari. Il giorno corrente è sottolineato; quello selezionato usa verde pieno e testo bianco. Un piccolo contatore comunica gli appuntamenti. L'agenda della data selezionata mostra orario, titolo e testo secondario in una colonna adiacente o sottostante.

### Product Detail

Pannello laterale nativo `dialog`, largo 456 px sul desktop e contenuto entro la larghezza disponibile. Presenta titolo e SKU, quantità in due riquadri, listino a righe e nota della fonte. La chiusura ha un pulsante dedicato, Escape e clic sul backdrop. Il focus iniziale va alla chiusura.

## Do's and Don'ts

### Do:

- **Do** riusare verde racing, Barlow e superfici chiare del brand.
- **Do** allineare quantità e importi con cifre tabulari, mantenendo nome e SKU su due livelli.
- **Do** accompagnare disponibilità e dati mancanti con testo leggibile oltre al colore.
- **Do** mantenere focus visibile, Escape negli overlay e movimento riducibile.
- **Do** adattare le colonne alla larghezza del telefono e lasciare i dettagli nel pannello prodotto.

### Don't:

- **Don't** sostituire palette e tipografia esistenti con quelle generiche dei kit di dashboard.
- **Don't** applicare ombre diffuse a ogni pannello o usare effetti decorativi che riducano la leggibilità dei dati.
- **Don't** usare il font condensato inclinato del marchio per tabelle o testo operativo.
- **Don't** affidare al solo colore gli stati di magazzino o rappresentare un dato mancante come zero.
- **Don't** forzare tutte le colonne desktop dentro la larghezza del telefono riducendo la scala dell'intera pagina.
