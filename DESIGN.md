---
name: LuckyLap Gestionale
description: Sistema visivo operativo del gestionale interno LuckyLap, allineato al roadbook Partner.
colors:
  green: "#1d4b07"
  green-2: "#2b6311"
  green-dark: "#15370a"
  green-wash: "#e4ecdb"
  on-green: "#ffffff"
  on-green-2: "#cfdec2"
  paper: "#ffffff"
  ink: "#121512"
  ink-2: "#394037"
  muted: "#5a6257"
  rule: "#c9cfc3"
  rule-soft: "#e1e5dc"
  tint: "#f3f5f0"
  amber: "#875800"
  amber-wash: "#f6ead1"
  red: "#9b3b25"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, Helvetica Neue, Arial, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.01em"
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(28px, 4.2vw, 38px)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.005em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, Helvetica Neue, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.1
  navigation:
    fontFamily: "Barlow Condensed, Arial Narrow, Helvetica Neue, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.02em"
  numeric:
    fontFamily: "Barlow Condensed, Arial Narrow, Helvetica Neue, Arial, sans-serif"
    fontWeight: 600
    letterSpacing: "0.01em"
    fontFeature: "tnum"
  body:
    fontFamily: "Barlow, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  table:
    fontFamily: "Barlow, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Barlow Condensed, Arial Narrow, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.08em"
rounded:
  radius: "0px"
  control: "2px"
spacing:
  xs: "4px"
  sm: "8px"
  control: "12px"
  md: "16px"
  panel-gap: "20px"
  lg: "24px"
  wide: "32px"
  tap: "44px"
  tabs: "48px"
  topband: "52px"
  bottombar: "60px"
  sidebar: "232px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "{spacing.tap}"
  button-primary-hover:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "#2e3827"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "{spacing.tap}"
  search-input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "{spacing.tap}"
  sidebar:
    backgroundColor: "{colors.green}"
    textColor: "{colors.on-green}"
    width: "{spacing.sidebar}"
  navigation-item:
    textColor: "{colors.on-green-2}"
    typography: "{typography.navigation}"
    rounded: "{rounded.radius}"
    padding: "0 20px"
    height: "48px"
  navigation-item-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.navigation}"
    rounded: "{rounded.radius}"
    padding: "0 20px"
    height: "48px"
  tab:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    padding: "0 14px"
    height: "{spacing.tabs}"
  tab-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "0 14px"
    height: "{spacing.tabs}"
  bottom-bar:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    height: "{spacing.bottombar}"
  sheet-item:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.navigation}"
    padding: "0 12px"
    height: "52px"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.radius}"
    padding: "24px"
  panel-warning:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.radius}"
    padding: "24px"
  roadbook-row:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "12px 16px"
    height: "56px"
  roadbook-box-now:
    backgroundColor: "{colors.green}"
    textColor: "{colors.on-green}"
  roadbook-box-late:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.amber}"
  roadbook-box-done:
    backgroundColor: "{colors.green-wash}"
    textColor: "{colors.green}"
  stock-status:
    textColor: "{colors.green}"
    typography: "{typography.label}"
  inventory-row:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.table}"
    padding: "11px 17px"
  calendar-day-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.radius}"
  product-detail:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    width: "456px"
    padding: "22px 30px 30px"
---

# Design System: LuckyLap Gestionale

## Overview

**Creative North Star: "LuckyLap operativo"**

Il gestionale prende il mondo visivo del roadbook Partner: carta bianca, inchiostro verde-nero, filetti da 1 px, verde racing solo dove serve agire adesso, Barlow Condensed dritto per cifre, codici e titoli. È una superficie Operate: chi la usa deve fare un'operazione, spesso dal telefono, non leggere un racconto. Navigazione e controlli restano standard: barra laterale, schede, barra in basso, `dialog` nativo.

Ogni pagina per i membri vive nello stesso guscio (`src/components/workspace-frame.tsx`). La barra laterale verde è la testata del roadbook; le schede in alto sono la barra dei settori; il contenuto sta su carta. Dal guscio si arriva a ogni pagina in uno o due tocchi e si sa sempre dove si è. Struttura, mappa delle sezioni e regole per le pagine nuove: [layout condiviso](docs/workspace-layout.md).

**Key Characteristics:**

- Barra laterale verde ferma sul desktop; sul telefono fascia verde che scorre e barra in basso fissa.
- Righe quadrate, filetti sottili, nessuna ombra sui pannelli.
- Due voci: Barlow Condensed per nomi, numeri, codici, titoli e menu; Barlow per frasi e controlli.
- Testo leggibile sul telefono: minimo 12 px, corrente e campi a 16 px, bersagli da 44 px.

I token normativi sono in `:root` di `src/app/globals.css`, ripresi nel frontmatter. `.impeccable/design.json` estende questo documento con metadati, movimento e frammenti dei componenti, riallineati al codice dopo P7. Le rampe tonali del pannello Impeccable sono campioni sintetici dichiarati, non nuovi colori dell’interfaccia.

## Colors

Verde racing pieno solo per la testata e per ciò che è adesso o fatto; il resto è inchiostro su carta.

### Primary

- **Verde racing** (`green`): fondo della barra laterale e della fascia del telefono, casella «adesso» delle righe roadbook, collegamenti, anello di focus. Altrove il verde è testo, filetto da 1 px o campitura chiara, mai un fondo pieno. In Finance identifica anche gli importi in entrata, insieme al segno «+».
- **Verde secondo** (`green-2`): filetti dentro la testata verde.
- **Verde scuro** (`green-dark`): testo verde più scuro su fondi chiari, dove serve più contrasto.
- **Verde chiaro** (`green-wash`): stato «fatto», filtri attivi e piccoli stati interattivi.
- **Testo su verde** (`on-green`, `on-green-2`): marchio e voce al passaggio del mouse; voci inattive e testo secondario della testata (contrasto circa 7:1).

### Neutral

- **Carta** (`paper`): fondo della pagina, delle schede, della barra in basso, dei pannelli e della voce di menu attiva.
- **Inchiostro** (`ink`, `ink-2`): titoli, quantità, testo principale; pulsante principale, scheda attiva, giorno scelto e toast. `ink-2` per paragrafi e voci inattive delle schede (oltre 10:1 su carta).
- **Grigio verde** (`muted`): etichette e informazioni secondarie.
- **Filetti** (`rule`, `rule-soft`): confini di pannelli, righe e campi; barre dei segnaposto di caricamento.
- **Fondo chiaro** (`tint`): passaggio del mouse sulle righe e avvisi neutri.

### Stato

- **Ambra** (`amber`, `amber-wash`): solo tempo e attenzione (in ritardo, dato da verificare, pannello di avviso), sempre con il suo wash.
- **Rosso** (`red`): errori e impossibilità, per esempio un'operazione fallita o una variante esaurita; nei movimenti Finance indica le uscite, insieme al segno «−». Trasferimenti e importi nulli restano neutri.

**The Ink Inversion Rule.** La selezione è inversione d'inchiostro, non verde: voce attiva della barra laterale in carta sul verde, voce attiva del foglio «Altro», giorno scelto e pulsante principale in inchiostro su carta.

**The State Labels Rule.** Accompagnare il colore di stato con una dicitura leggibile; preservare la distinzione tra zero e dato mancante.

## Typography

**Display Font:** Barlow Condensed dritto (500, 600, 700; woff2 latin e latin-ext presi dal roadbook Partner), con Arial Narrow, Helvetica Neue, Arial e sans-serif di riserva. Token `--f-cond`.

**Body Font:** Barlow (400, 500, 600, 700, TTF locali), con Helvetica Neue, Arial e sans-serif di riserva. Token `--f-body`.

**Character:** due voci, come nel roadbook. Il Condensed dritto porta nomi, numeri, codici, etichette, titoli, schede e voci di menu; Barlow porta le frasi e tutto ciò che si preme. Niente corsivo, neanche nel marchio.

### Hierarchy

- **Display** (Condensed 700, 30 px nella barra laterale, 24 px nella fascia del telefono): marchio «LuckyLap».
- **Headline** (Condensed 700, `--text-title`, `clamp(28px, 4.2vw, 38px)`): `h1` di ogni pagina e dei pannelli di stato. È il nome della voce di menu.
- **Title** (Condensed 700, 24 px): titoli dei riquadri di Oggi e del foglio «Altro»; 20 px nei titoli delle righe roadbook.
- **Navigation** (Condensed 600, 18 px, 0.02em): voci della barra laterale e del foglio; 17 px nelle schede, 13 px nella barra in basso.
- **Numeric** (`.num`, Condensed 600, cifre tabellari): quantità, importi, date, ore, SKU, numeri d'ordine.
- **Body** (Barlow 400, 16 px, 1.5): testo corrente, paragrafi sotto i titoli, avvisi, campi.
- **Table** (Barlow 400, 14 px): celle e testo secondario.
- **Label** (`.label`, Condensed 600, 12 px, 0.08em, maiuscolo): etichette brevi e metadati.

Scala del testo: `--text-xs` 12, `--text-sm` 14, `--text-md` 16, `--text-lg` 18, `--text-xl` 24 px. Nessun testo sotto 12 px; `input`, `select` e `textarea` a 16 px a ogni larghezza, così iOS non ingrandisce la pagina. Lo controlla `src/lib/design-floor.test.ts`.

**The Aligned Numbers Rule.** Quantità e importi usano cifre tabulari (`font-variant-numeric: tabular-nums` è già sul `body`); le colonne numeriche delle tabelle sono allineate a destra.

**The No Eyebrow Rule.** Niente sopratitoli in maiuscolo sopra i titoli: il menu dice già dove si è.

## Layout

- **Desktop (oltre 760 px).** Barra laterale ferma a sinistra, larga 232 px (210 sotto 1250, 200 sotto 1000). A destra la colonna del contenuto: schede ferme in alto (48 px) quando la sezione ha più pagine, poi `main` largo al massimo 1280 px, con margini di 24 px (32 oltre 1250).
- **Telefono (fino a 760 px).** Fascia verde di 52 px con marchio e sezione attiva, che scorre via con la pagina. Restano ferme solo le schede. Barra fissa in basso di 60 px più la safe area, nascosta mentre un campo ha il focus. Margini laterali `--gutter` (almeno 16 px, rispettano la safe area); `main` lascia in fondo lo spazio della barra.
- **Barre delle pagine.** Le barre fisse in basso usano `bottom: var(--ws-fixed-bottom)`, quelle ferme in alto `top: var(--ws-sticky-top)`: così non finiscono sotto la barra di navigazione o sotto le schede.
- **Ritmo.** Pannelli a 16–20 px di distanza, controlli a 8–12 px, bersagli da 44 px.
- **Oggi.** Due colonne oltre 1000 px (Agenda a sinistra, proporzione 1,25:1), una sotto.
- **Tabelle.** Sul telefono le tabelle scorrono nel loro contenitore: la pagina non scorre mai in orizzontale. La tabella del magazzino mostra prodotto e SKU, taglia e quantità centrale; il resto è nel dettaglio prodotto.
- Scala z-index: schede 10, barra laterale 20, barra in basso 30, barre fisse delle pagine 35, toast 40. I `dialog` stanno nel top layer.

## Elevation & Depth

Il sistema è piatto: pannelli, righe e testata si distinguono con fondo, filetti e spaziatura. Nessuna ombra su pannelli, righe, menu o schede.

### Shadow Vocabulary

- **Dettaglio prodotto:** ombra laterale (`-12px 0 40px #12200720`) sul pannello ancorato al margine destro, con un backdrop scuro trasparente.
- **Conferma temporanea:** ombra breve (`0 7px 24px #10200830`) sul toast in inchiostro.

**The Flat Panels Rule.** Bordi e campiture separano i pannelli; le ombre restano solo agli elementi sovrapposti.

Movimento: colori in 160 ms, foglio «Altro» in 260 ms, dettaglio prodotto in 200 ms, sempre con `--ease` (`cubic-bezier(0.16, 1, 0.3, 1)`). Con `prefers-reduced-motion: reduce` niente animazioni né transizioni.

## Shapes

Righe quadrate, come nel roadbook. Pannelli, righe, schede, voci di menu, foglio «Altro» e cartellini hanno angoli a 0 (`--radius`). I controlli (pulsanti, campi, select) hanno 2 px (`--radius-control`). Il 50% resta a pallini di stato e campioni colore. Nessun altro raggio: lo controlla `src/lib/design-floor.test.ts`.

I filetti sono da 1 px; 1,5 px d'inchiostro aprono le liste roadbook e la testata del foglio «Altro»; 3 px d'inchiostro segnano la scheda attiva (sotto) e la voce attiva della barra in basso (sopra). Gli stati selezionati cambiano campitura o filetto, non geometria.

## Components

### Navigation (barra laterale)

`<nav aria-label="Sezioni del gestionale">` su fondo verde. Marchio «LuckyLap» e «Gestionale» in Condensed, link a `/`. Al massimo sette voci (icona Lucide 20 px e testo Condensed 600 18 px), alte 48 px, quadrate, visibili a tutti i membri. Inattive in `on-green-2`; al passaggio del mouse fondo bianco all'8%. La voce attiva è in inversione: carta e inchiostro. Finance e Controllo CEO hanno il lucchetto da 14 px. Nel piede: nome del membro, «Come si usa», «Account e sicurezza», «Esci» (pulsante da 44 px con bordo `on-green-2`). Sul telefono la barra diventa la fascia verde con marchio e sezione attiva.

### Tabs

`<nav aria-label="Pagine di {sezione}">`, solo con almeno due pagine. Striscia ferma in alto, fondo carta e filetto d'inchiostro sotto. Link Condensed 600 17 px, alti 48 px; attivo in inchiostro con filetto da 3 px e `aria-current="page"`, inattivi in `ink-2`. Se non ci stanno scorrono in orizzontale senza barra di scorrimento.

### Bottom bar

Solo sul telefono, dopo `main` nel DOM. Fondo carta, filetto d'inchiostro sopra, cinque celle uguali: Oggi, Vendite, Magazzino, Partner, «Altro». Icona 22 px ed etichetta Condensed 600 13 px. Attiva in inchiostro, peso 700, filetto da 3 px sul bordo alto.

### Sheet («Altro»)

`dialog` nativo aperto con `showModal()`, ancorato in basso, largo quanto lo schermo, alto al massimo 80dvh, quadrato. Titolo «Altro» e «Chiudi»; righe da 52 px per Team, Finance e Controllo CEO per tutti i membri, poi «Come si usa», «Account e sicurezza» ed «Esci». La riga attiva è in inversione d'inchiostro. Si chiude con Esc, tocco sullo sfondo, «Chiudi» e a ogni cambio di pagina; il focus torna su «Altro».

### Panel (`WorkspacePanel`)

Stato di una pagina dentro il guscio: configurazione mancante, accesso negato, area chiusa, errore, pagina non trovata. Sezione quadrata con filetto da 1 px, larga al massimo 640 px, allineata a sinistra. `h1` in Headline, paragrafo 16 px in `ink-2`, azioni sotto (a tutta larghezza sul telefono). La variante di avviso ha fondo `amber-wash`, bordo e icona ambra. Nessun sopratitolo e nessun link indietro: il menu è sempre lì. Fuori dal gruppo (`/auth/login`, `/auth/confirm`) resta `AuthShell`.

### Roadbook rows

`src/components/roadbook.module.css`: lista aperta da un filetto d'inchiostro da 1,5 px; ogni riga è una griglia «colonna di controllo | contenuto | lato», alta almeno 56 px, con filetto `rule` sotto. La colonna di controllo (76 px, 56 sul telefono, filetto d'inchiostro a destra) porta l'ora o il giorno in Condensed 700 24 px, oppure una casella Condensed 600 13 px in maiuscolo: verde pieno se è adesso, ambra se è in ritardo, verde chiaro se è fatto. Titolo Condensed 700 20 px, meta 14 px. Il link del titolo copre tutta la riga.

### Pending attempt («Invio da verificare»)

`src/components/pending-attempt.tsx`: riquadro ambra (`amber-wash`, bordo `amber`) in cima al modulo quando un salvataggio non ha avuto una risposta certa. Titolo in Condensed 700 18 px ambra, una frase, righe leggibili (data italiana all'ora di Roma, nomi al posto dei codici). «Verifica lo stesso invio» è l'azione principale; «Scarta questo tentativo» compare solo per i tentativi che non potranno riuscire e chiede conferma in linea. Il codice tecnico resta chiuso in `<details>` «Codice per l’assistenza». Lo usano Vendite, Rettifiche, Packaging, Finance, Conto vendita e Partner.

### Oggi

`src/components/today/`: intestazione «Oggi» in Headline, con il giorno di Roma in Condensed 600 18 px e il nome della persona. Sopra i riquadri, finché la persona non preme «Ho capito», il riquadro «Prima volta qui?»: fondo `tint`, filetto `rule`, icona del libro in verde, titolo Condensed 700 18 px, «Apri «Come si usa»» principale e «Ho capito» secondario, a tutta larghezza sul telefono. Il server lo lascia nascosto, così non lampeggia per chi l'ha già chiuso. Poi i riquadri in griglia (layout «Oggi»): Agenda, Contatti e solleciti, Ordini da preparare, Magazzino e, solo per chi può aprire Finance, Conto vendita da regolare. Ogni riquadro ha il titolo in Condensed 700 24 px, il link alla sua pagina a destra (bersaglio da 44 px), una riga di conteggio aperta dal filetto d'inchiostro da 1,5 px e righe roadbook: casella «CO N», ora o quantità nella colonna di controllo, importo nel lato. Contatti, ordini e conto vendita mostrano al massimo otto voci, poi una riga che rimanda alla pagina. Ogni riquadro sta nel suo `Suspense`, con tre righe segnaposto alte come quelle vere; un errore resta nel suo riquadro, con `role="alert"` e «Riprova».

### Area aperta («Chiudi Finance»)

`SensitiveAreaSessionBar` (`src/components/auth-sensitive-area-form.tsx`): striscia in cima a ogni pagina Finance e a Controllo CEO, solo dopo che la pagina ha verificato l'area aperta. Lucchetto aperto verde, frase da 14 px in `ink-2` («Finance aperta su questo dispositivo, fino a 8 ore dall’apertura.»), pulsante secondario «Chiudi Finance» o «Chiudi Controllo CEO» sempre a destra, anche quando va a capo; filetto `rule-soft` sotto. In anteprima locale il pulsante è spento e la frase lo dice.

### Activity feed (Controllo CEO)

`src/components/audit-view.tsx`: filtri Persona e Area in un modulo GET su fondo `tint`, con «Applica filtri» e «Rimuovi filtri»; sotto, una nota da 14 px in `muted` (le tue attività escluse all'inizio, orari di Roma). Il feed è un pannello con filetto: intestazione «Attività» con il numero di righe della pagina, giorni con il titolo su fondo `tint`, righe in griglia «ora | frase | Apri elemento». Ora in cifre tabellari da 14 px; frase a 16 px in inchiostro, al massimo 75 caratteri per riga; area sotto, 12 px in `muted`; «Apri elemento» con la freccia, bersaglio da 44 px (sul telefono va sotto la frase). 50 righe per pagina, «Più recenti» e «Attività precedenti» in fondo. Nessun colore di stato: il feed si legge, non chiede azioni.

### Movimenti Finance

`src/components/finance-imports-view.tsx` e `src/components/finance.module.css`: nel registro la categoria è in primo piano, la descrizione sotto e il conto in piccolo. Importi in entrata verdi con «+», uscite rosse con «−»; testo accessibile e segno rendono la distinzione leggibile anche senza colore. Trasferimenti e zero sono neutri. Fonte e stato generico non occupano una colonna delle righe; dettagli, filtri, revisioni, stati in sospeso ed eliminati restano consultabili.

### Finance movement editor

`/finance/movimento?source_kind=…&source_id=…` (`src/components/finance-revision-editor.tsx`) e, per i pagamenti dei negozi, `/finance/incasso/<id>` (`finance-shop-payment-editor.tsx`). Pagina larga al massimo 1080 px: link «← Finance», `h1` «Movimento Finance» (o «Incasso conto vendita») e una riga di stato («Versione attiva · versione 2», «Eliminato dalla vista attiva»). Le sezioni si aprono con un filetto d'inchiostro da 2 px e il titolo in Condensed 24 px. «Correggi i dati»: campi su due colonne (una sotto 650 px), a 16 px e alti 44 px; «Motivazione della correzione» a tutta riga, obbligatoria; «Salva correzione» principale ed «Elimina movimento» secondario, con la conferma in linea su fondo `tint`. «Storico delle versioni»: una riga per versione, dalla più recente, titolo Condensed 18 px con «· attuale» o «· eliminata», autore e ora di Roma, riepilogo, motivazione e «Ripristina versione N» (a tutta larghezza sul telefono). Un invio incerto usa il riquadro «Invio da verificare». Nel registro della Panoramica ogni riga ha «Modifica / storico» (o «Ripristina / storico» tra gli eliminati), e una riga corretta dice «Versione N · Corretta»; le eliminate hanno la casella ambra «Eliminato · recuperabile».

### Guide («Come si usa»)

`/guida` è una pagina da leggere, non un modulo: testo a 16 px in righe di al massimo 72 caratteri, nove parti con titolo in Condensed 700 24 px. Sul computer l'indice sta fermo a destra (`top: var(--ws-sticky-top)` più 24 px); sotto 1100 px va in cima, su due colonne, e le parti scorrono una sotto l'altra. Le sezioni del menu e i cinque passi del conto vendita sono righe in stile roadbook, con la colonna di controllo a sinistra (i passi usano `roadbook.module.css`). Il riquadro per aprire e chiudere Finance si vede solo a chi può entrare.

### Buttons

Bersaglio da 44 px, testo Barlow 500 14 px, angolo da 2 px. Il principale è in inchiostro con testo carta (al passaggio `ink-2`); il secondario è bianco con bordo `rule` e fondo verde molto chiaro al passaggio. I pulsanti a icona sono 44 × 44 px. Focus verde da 2 px con scarto di 2 px (bianco sulle testate verdi). Disabilitati a opacità 0,5.

### Inputs / Fields

Campi chiari con bordo sottile, angolo da 2 px, testo a 16 px e altezza minima di 44 px. La ricerca combina icona, campo senza bordo interno e cancellazione da 44 px; il focus agisce sul contenitore con bordo e anello verdi. Le etichette restano distinte dai segnaposto. Cursore di testo verde.

### Chips / Status

Le etichette di disponibilità sono testo da 12 px con un pallino da 5 px: Disponibile in verde, Esaurito in rosso, Da verificare in ambra. La taglia è un cartellino quadrato con bordo chiaro. I filtri usano il verde chiaro quando sono attivi e comunicano la selezione anche con `aria-pressed`. Niente pillole promozionali.

### Inventory Table

Intestazione verde molto chiara, gruppi per modello ancora più chiari, righe separate da filetti sottili. Nome e SKU su due livelli; taglia al centro, numeri in Condensed a destra, stato leggibile. Il passaggio del mouse schiarisce la riga e il focus del pulsante prodotto evidenzia l'intera riga.

### Calendar

Griglia a sette colonne con celle quadrate. Il giorno corrente ha un filetto verde sotto il numero; quello scelto è in inversione d'inchiostro. Un piccolo contatore in verde chiaro indica gli appuntamenti.

### Product Detail

Pannello laterale nativo `dialog`, largo 456 px sul desktop e contenuto entro la larghezza disponibile. Titolo, SKU da copiare, quantità, costi e listini a righe, nota sulle rettifiche con il link a `/stock/rettifiche`. Si chiude con un pulsante dedicato, Escape e clic sullo sfondo; il focus iniziale va alla chiusura.

## Do's and Don'ts

### Do:

- **Do** usare il Condensed dritto per numeri, codici, date, ore, titoli e voci di menu, con cifre tabellari.
- **Do** tenere il verde pieno per testata, adesso e fatto; selezionare con l'inversione d'inchiostro.
- **Do** accompagnare disponibilità, ritardi e dati mancanti con testo leggibile oltre al colore.
- **Do** usare `WorkspacePanel` per gli stati e `roadbook.module.css` per le righe, con i token di `globals.css`.
- **Do** mantenere focus visibile, Escape negli overlay, bersagli da 44 px e movimento riducibile.
- **Do** adattare le colonne alla larghezza del telefono e lasciare i dettagli nel pannello prodotto.

### Don't:

- **Don't** sostituire palette e tipografia con quelle generiche dei kit di dashboard, né ridichiarare i token in un modulo CSS.
- **Don't** aggiungere testate proprie, link «Torna al workspace» o sopratitoli in maiuscolo: il guscio dice già dove si è.
- **Don't** usare il corsivo, nemmeno nel marchio, o angoli arrotondati su pannelli e righe.
- **Don't** applicare ombre a pannelli e righe o effetti decorativi che riducano la leggibilità dei dati.
- **Don't** scendere sotto 12 px di testo o sotto 16 px nei campi.
- **Don't** affidare al solo colore gli stati di magazzino o il verso dei movimenti Finance, né rappresentare un dato mancante come zero.
- **Don't** forzare tutte le colonne desktop dentro la larghezza del telefono riducendo la scala dell'intera pagina.
