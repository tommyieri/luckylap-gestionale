# Filmato hero LuckyLap

Loop di 24 secondi, sei segmenti di quattro secondi: GT3 RS navy → 300 SL azzurra → 964 bianca → F40 bianca → 512 TR bianca → Project ’88 bianca → ritorno alla GT3 RS.

Il filmato usa basi fotografiche scontornate con il solo ricamo frontale rimosso, dettagli del ricamo e disegni originali del brand. Il disegno viene portato fuori dal capo come livello animato. Sette contorni corrispondenti rendono il passaggio tra modelli; sono semplificazioni per la breve trasformazione, non vettoriali di produzione certificati. I filtri SVG isolano i colori dei dettagli senza modificare gli originali. Non è una ripresa reale né una simulazione fisica del filo.

`cars.js` descrive i contorni. `film.js` costruisce una timeline GSAP deterministica, ferma e riproducibile a qualsiasi istante. `build-project.mjs` raccoglie i soli asset necessari in una cartella di produzione esterna e genera il progetto HyperFrames. GSAP e MorphSVGPlugin sono utilizzati durante l’export; la pagina pubblica carica soltanto l’MP4.

## Rigenerare

Con Node, FFmpeg, Chrome e HyperFrames 0.9.94 disponibili, dalla radice del repository:

```sh
node previews/luckylap-studio/video/build-project.mjs /percorso/esterno/desktop
node previews/luckylap-studio/video/build-project.mjs /percorso/esterno/mobile --mobile
```

Dalla rispettiva cartella esterna:

```sh
npx --yes hyperframes@0.9.94 check
npx --yes hyperframes@0.9.94 preview --background
npx --yes hyperframes@0.9.94 render --fps 30 --quality delivery --output hero.mp4
ffprobe -v error -show_format -show_streams hero.mp4
```

Usare una cache npm temporanea dedicata se gli strumenti non sono già installati nel progetto; non installare pacchetti globali. Non pubblicare il progetto HyperFrames su servizi esterni durante l’export. L’anteprima di produzione offre anche il montaggio modificabile; verificare i sei modelli, i passaggi e il loop prima di sostituire gli MP4 della pagina.

Desktop: 1920×1080. Mobile: 1080×1920, con posizione e traiettoria dedicate. Niente audio o testi incorporati. I poster sono fotogrammi iniziali degli stessi file. La home gestisce autonomia, pausa, risparmio dati e movimento ridotto.

## Provenienza e limiti

Gli asset sono elencati in `../ASSET.md` e i prompt dei livelli in `../PROMPT-ANIMAZIONE.json`. Le licenze GSAP sono in `../vendor/README.md`. Non conservare nel progetto di produzione dati di clienti, ordini, credenziali o listini.
