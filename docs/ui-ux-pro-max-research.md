# UI UX Pro Max: verifica per l'anteprima LuckyLap

Ricerca eseguita il 21 ottobre 2026 dalla fonte canonica [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill). Provenienza: MIT, Copyright (c) 2024 Next Level Builder; [licenza originale](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/LICENSE).

Script e soli CSV necessari recuperati in una directory temporanea, dopo lettura di `SKILL.md` e verifica degli script. Nessuna installazione globale, nessun dato privato nelle query, nessuna persistenza del design system generato.

Comandi eseguiti con `python3` e percorso assoluto dello script temporaneo:

```text
search.py "inventory operations dashboard" --design-system --density 8 -p "LuckyLap"
search.py "loading error boundary" --stack nextjs --full
search.py "keyboard focus modal" --domain ux --full
```

Match verificato: `Inventory & Stock Management`, regola specifica senza fallback, stile `flat-design`. Indicazioni pertinenti: gerarchia netta, superfici semplici, spaziatura compatta (8/12/16/24/32 px), controlli con focus visibile e contrasto del testo almeno 4,5:1, movimento riducibile. La densità non giustifica bersagli difficili da toccare.

Il pattern commerciale `Feature-Rich Showcase` non è pertinente al gestionale. Palette suggerita e Fira non vengono adottate: restano Racing Green `#1d4b07`, bianco, ink e Barlow del brand.

Le ricerche mirate confermano feedback di caricamento/errore e focus non nascosto da header o overlay. Il CSV Next.js riguarda 16.2; il progetto usa 16.4.2. Per eventuali error boundary verificare la API corrente: [loading.tsx](https://nextjs.org/docs/app/api-reference/file-conventions/loading) e [error.tsx](https://nextjs.org/docs/app/api-reference/file-conventions/error), che documenta `retry()`.

Riferimento metodologico: [SKILL.md ufficiale](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/ui-ux-pro-max/SKILL.md). Nessuna modifica alla UI effettuata da questa ricerca.
