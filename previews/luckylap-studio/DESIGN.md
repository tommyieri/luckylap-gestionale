---
name: LuckyLap Studio
description: Silhouette automobilistiche, ricamo e guardaroba quotidiano.
colors:
  green: "#173d2a"
  green-hover: "#24563c"
  paper: "#f4f5f1"
  white: "#fff"
  ink: "#14231c"
  muted: "#58625b"
  rule: "#d8ddd5"
  wash: "#e7ebe3"
  hero-muted: "#d5dfd3"
  error: "#9b3426"
typography:
  display:
    fontFamily: "Mona, Arial, sans-serif"
    fontSize: "clamp(54px, 5.6vw, 86px)"
    fontWeight: 500
    lineHeight: 1.04
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Mona, Arial, sans-serif"
    fontSize: "clamp(32px, 4.2vw, 62px)"
    fontWeight: 500
    lineHeight: 1.06
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Mona, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Mona, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  square: "0"
spacing:
  gutter: "clamp(22px, 4.1vw, 72px)"
  gutter-mobile: "22px"
  section-top: "100px"
  section-bottom: "110px"
  section-mobile: "65px"
  grid-column: "22px"
  grid-row: "38px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "15px 24px"
  button-primary-hover:
    backgroundColor: "{colors.green-hover}"
  button-light:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.green}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "15px 24px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "15px 24px"
---

# Design System: LuckyLap Studio

## Overview

**Creative North Star: "Il ricamo prende forma"**

Uno showroom luminoso e preciso: verde bosco, carta chiara, fotografie ampie e silhouette riconoscibili. Il capo resta il riferimento materiale; il ricamo occupa un campo piccolo e discreto sul petto. Il logo originale è un asset da preservare.

Questo documento descrive esclusivamente il preview pubblico LuckyLap Studio. Il sistema visivo del gestionale resta indipendente.

**Key Characteristics:**

- Verde profondo e superfici cartacee.
- Titoli ampi, peso medio e ritmo arioso.
- Fotografia del prodotto e movimento controllato dal visitatore.

## Colors

### Primary

Verde bosco per campiture immersive, azioni principali e selezioni; la variante più chiara accompagna l’hover. Sulle campiture verdi, carta e verde pallido distinguono titoli e testo secondario.

### Neutral

Carta per lo sfondo, bianco per gli accenti luminosi, inchiostro per la lettura. Grigio vegetale per metadati, lavatura chiara per superfici secondarie, regola sottile per separatori. Il rosso errore appartiene agli stati di errore.

## Typography

Mona Sans è servita localmente con il nome CSS `Mona`, con Arial come fallback. Testo corrente regolare, titoli e azioni a peso medio; titoli compatti, con spaziatura negativa e righe bilanciate. Il titolo della scena su mobile usa `clamp(37px, 10.7vw, 50px)`; le descrizioni restano brevi e leggibili.

## Layout

Contenitore massimo di 1600px e margini fluidi; sezioni scandite da grandi pause verticali. Il catalogo passa da tre a due colonne a 850px; su mobile mantiene due colonne con intervalli ridotti. A 850px la navigazione diventa menu, a 600px cambiano impaginazione e densità.

La scena iniziale ha uno stage alto 100svh, minimo 650px desktop e 620px mobile. Il percorso animato occupa 285svh desktop e 255svh sotto 600px; CTA e collegamento alla collezione restano disponibili.

## Elevation & Depth

La gerarchia nasce da contrasto tonale, fotografie e spazio. Le schede prodotto sono piane. Soltanto il capo isolato riceve un’ombra diffusa; i dialoghi usano uno sfondo oscurato.

## Shapes

Pulsanti, campi e superfici hanno angoli netti. Bordi sottili e fotografie quadrate danno ordine senza cornici decorative.

## Components

Azioni piene verdi, chiare su verde, oppure contornate. Hover breve con sollevamento di 2px; focus visibile di 2px, distanziato di 5px. Filtri e selettori espongono lo stato premuto; i dialoghi hanno chiusura esplicita. La ricerca è un campo con sola linea inferiore.

La scena GSAP 3.15.1 segue lo scroll: la GT3 RS esce dalla T-shirt, sette parti SVG corrispondenti diventano F40 e rientrano nel capo bianco. Agli estremi compaiono dettagli fotografici ufficiali isolati tramite filtri SVG; i contorni normalizzati intermedi non sono vettori certificati del ricamo. Le basi dei capi sono asset elaborati. Non simulare una tessitura fisica del filo. Preferenza di movimento ridotto, comando dedicato e assenza delle librerie producono una presentazione statica selezionabile.

## Do's and Don'ts

### Do:

- **Do** conservare logo originale, palette e discrezione del ricamo sul capo.
- **Do** mantenere focus visibile, controlli accessibili e alternativa statica.

### Don't:

- **Don't** avviare automaticamente la trasformazione: il visitatore la controlla scorrendo.
- **Don't** presentare i contorni animati come tracciati originali esatti del prodotto.
