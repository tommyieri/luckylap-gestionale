# Product · site-kind other

**Deal:** hero `product`, pairing `Mona Sans`, palette brand `#f6f5f0 / #17382e / #006400`, nav `nav-mega`, footer `footer-columns`, close `close-photo`, ritmo `dark-band`, pulsanti `pill`, momento `photo-chapters`. Il verde riprende il logo LuckyLap, mentre la carta chiara lascia spazio a fotografie e ricami. La palette retail estratta inizialmente, `warm-paper-walnut`, è stata sostituita con i colori del brand per il conflitto con il logo verde. Il marchio vero sostituisce il segno `arc` estratto dal dealer.

## Lettura del brand

Landing di abbigliamento per appassionati di automobili, con linguaggio editoriale e fotografico: un guardaroba che funziona anche come archivio di silhouette riconoscibili.

La richiesta di Tommi è una preview particolare e diversa dal sito attuale. La libertà di composizione viene da questo brief; restano reali prodotti, fotografie, marchio e fatti. L'originalità vive nella scala dei ricami, nella selezione delle icone e nel rapporto tra capo e cultura automobilistica.

## Fatti e fonti

- LuckyLap unisce abbigliamento, design e passione automobilistica. Il nome richiama il giro in cui precisione, emozione e armonia coincidono. Fonte: [storia ufficiale](https://luckylap.com/pages/about-us).
- Le silhouette automobilistiche diventano ricami discreti su capi quotidiani. Il catalogo comprende 300 SL, 964, Project 88, 512 TR, GT3 RS e F40. Fonti: [collezioni ufficiali](https://luckylap.com/pages/collections) e catalogo letto attraverso il plugin Shopify.
- Le schede 964 e GT3 RS descrivono cotone biologico pettinato, vestibilità regular unisex, disegni originali LuckyLap e ricamo a macchina in Italia. Queste caratteristiche si attribuiscono solo ai capi verificati. Fonti: [964](https://luckylap.com/products/964-tshirt), [GT3 RS](https://luckylap.com/products/gt3rs-tshirt).
- La descrizione ufficiale più recente parla di curiosità per forme e storie delle automobili, anche senza possedere il modello rappresentato. Fonte: [LinkedIn ufficiale](https://www.linkedin.com/company/luckylapit/).
- Il testo "ricamato a mano" ancora presente sulla homepage è incoerente con le schede prodotto e non viene ripreso. Non si estende la lavorazione italiana al luogo di produzione dell'intero capo.
- Nessun prezzo o altro importo reale è salvato nella preview. Le azioni commerciali raggiungono le pagine reali dello store.
- Nessuna recensione, cifra di vendita, certificazione o storia di cliente viene inventata.

## Voce

**Registro:** prodotto protagonista, con nomi propri e misura. Parliamo a chi riconosce le forme delle auto; frasi concrete, lessico automobilistico comprensibile, dettagli di prodotto al posto di dichiarazioni di status. Niente promesse di esclusività, lusso o lavorazioni non confermate.

L'h1 nomina l'abbigliamento e chi lo indossa. I titoli identificano il soggetto; le azioni dicono cosa si apre. "Lifestyle in Pole Position" resta il motto originale del brand quando serve al racconto.

## Piano per schermate

1. `hero`: abbigliamento per appassionati, hero `product`, coppia di fotografie vere e prodotto a scala grande. Tipo immagine: uso. Una schermata desktop e telefono, azione visibile prima dello scroll.
2. `collezione`: scegliere una silhouette dal catalogo con un explorer azionato dall'utente; il cambiamento di scelta cambia davvero foto, modello e collegamento. Tipo immagine: prodotto. Una schermata desktop; su telefono la sezione cresce quanto serve al contenuto, senza tagli.
3. `mondo`: `photo-chapters` con tre scene reali: cultura automobilistica a Monza, origine del progetto, dettaglio del capo. Fotografie previste dal sito About: `IMG_1244.webp`, `ll_founders.jpg` e la fotografia della firma ricamata. Tipo immagine: uso, contesto e persone. Tre schermate quando il momento è attivo; contenuto statico leggibile con movimento ridotto. Le tre fotografie si usano qui una volta sola.
4. `dettagli`: dettaglio del filo e del cotone, con una fotografia diversa dalle precedenti. Tipo immagine: parti. Una schermata desktop. La banda verde scuro `.ground-inverse` è nella sezione precedente, coerente con `dark-band`.
5. `footer.closing`: chiusura `close-photo` su una fotografia vera distinta, più directory `footer-columns` nella stessa sezione. Una schermata desktop; due gruppi su telefono se il contenuto lo richiede.

## Sistema e runtime

La skill è [Taste Skill 2.5.1](https://github.com/leonxlnx/taste-skill), letta dalla copia temporanea `/tmp/luckylap-taste-kit/skills/taste-skill`.

File runtime copiati dalla skill senza modifiche funzionali:

- `assets/system.css`, `assets/system.js`.
- `assets/ui/cards.css`, `assets/ui/ui.js`.
- `assets/layout/layout.css`, `assets/layout/layout.js`.
- `assets/motion/motion.css`, `assets/motion/motion.js`.
- `assets/moments/moments.js`, `assets/moments/lib.js`.
- `assets/moments/photo-chapters/moment.css`, `moment.js`, `meta.json`.

Nessuna libreria fotografica, scena WebGL o raccolta di render della skill è copiata nel progetto. Le fotografie sono del brand. Il file `ui.js` serve agli import del sistema anche se la pagina non monta frammenti software.

Token emessi da `start.mjs brand`:

```css
:root {
  --p-bg: #f6f5f0;
  --p-surface: #eaebe5;
  --p-ink: #17382e;
  --p-muted: #556b62;
  --p-accent: #006400;
  --p-accent-ink: #f6f5f0;
  --p-action: #006400;
  --p-action-ink: #f6f5f0;
  --p-inv-bg: #17382e;
  --p-inv-surface: #26443a;
  --p-inv-ink: #f6f5f0;
  --p-inv-muted: #a3aea6;
  --p-inv-accent: #f6f5f0;
  --p-inv-accent-ink: #17382e;
  --p-inv-action: #f6f5f0;
  --p-inv-action-ink: #17382e;
  --font-display: "Mona Sans", system-ui, sans-serif;
  --font-text: "Mona Sans", system-ui, sans-serif;
  --display-weight: 400;
  --display-tracking: -0.03em;
  --display-tracking-xl: -0.04em;
  --display-stretch: 104%;
  --ly-scale: 0.96;
}
```

## Montaggio del momento

Il modello è `assets/moments/_demo/in-page.html` nella skill. La sezione ospita il momento, la `.wrap.mo-ph` contiene la testata e la lista ordinata. Ogni capitolo ha un'immagine distinta, h3 e un paragrafo. Non impostare `--h` o `data-screen` sulla sezione: il runtime calcola tre schermate per tre capitoli.

```html
<section class="section" id="cultura" data-moment="photo-chapters" aria-labelledby="cultura-h">
  <div class="wrap mo-ph">
    <div class="mo-ph__head">
      <h2 id="cultura-h">Titolo della sezione</h2>
      <p>Una frase che introduce le tre scene reali.</p>
    </div>
    <ol class="mo-ph__list">
      <li class="mo-ph__ch">
        <figure class="mo-ph__pic">
          <img src="media/foto-del-brand.webp" alt="Descrizione del soggetto reale" width="1600" height="1067" />
        </figure>
        <h3>Il soggetto del capitolo</h3>
        <p>Una frase breve basata su un fatto verificato.</p>
      </li>
      <!-- Altri due capitoli con fotografie distinte. -->
    </ol>
  </div>
</section>
```

Nel `<head>` montare le precondizioni della skill e i preload:

```html
<script>
  document.documentElement.classList.add("mo-js");
  setTimeout(() => document.documentElement.classList.add("mo-safe"), 2500);
</script>
<link rel="modulepreload" href="assets/moments/moments.js" />
<link rel="modulepreload" href="assets/moments/lib.js" />
<link rel="modulepreload" href="assets/moments/photo-chapters/moment.js" />
```

`system.js` importa e attende già il loader dei momenti; non aggiungere un secondo caricamento. Caricare dopo il sistema `motion/motion.js` e `layout/layout.js`. Su schermi alti almeno 600 px il momento funziona anche sul telefono; con movimento ridotto, JavaScript assente o modulo fallito, il contenuto resta leggibile in forma statica.

## Verifica prevista

Il finish gate è armato per `index.html`, kind `product`, categoria `abbigliamento automotive`, azione principale `Vedi la collezione`. Prima della consegna: copy lint, consistency a 1440/1024/820/768/390, layout check, screenshot desktop e telefono, performance e gate. Profilo Chrome dedicato nella cartella temporanea o `.taste-skill` della preview. Nessuna modifica alle verifiche della skill per superarle.
