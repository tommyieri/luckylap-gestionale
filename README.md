# LuckyLap Gestionale

Prima versione locale del gestionale interno LuckyLap. L'inventario proviene esclusivamente dall'Excel autorizzato su Drive; le quantità Shopify non vengono utilizzate.

## Avvio

Richiede Node.js 20.9 o successivo.

```sh
npm ci
npm run dev
```

Aprire http://127.0.0.1:3000 . Il comando abilita esplicitamente l'anteprima locale e lega il server a 127.0.0.1.

L'anteprima non è un accesso multiutente. Inventario e costi sono uno snapshot iniziale; gli appuntamenti e gli appunti salvati nel browser non sono ancora condivisi con il team. Nessun invito, call o messaggio viene inviato a servizi esterni.

Senza `LUCKYLAP_LOCAL_PREVIEW=true` l'app non espone lo snapshot. Il flag è disabilitato in produzione e su Vercel anche se impostato, e la guardia viene valutata a ogni richiesta. La configurazione Supabase e l'attivazione dell'accesso multiutente richiedono la verifica delle policy sul database.

## Dati e moduli

- Fonte: `data/inventory-source.json`, trascrizione delle quattro schede di inventario autorizzate. Provenienza e celle sorgenti sono conservate.
- Dettagli estrazione: `data/inventory-source-notes.md`. Quantità salvate Excel senza ricalcolo; zero e valori mancanti restano distinti.
- Vendite sospese: non sono stati importati ordini, righe vendita o incassi.
- I tre file Finance forniti il 21 ottobre sono stati analizzati in locale; l'importazione riservata è pronta offline. Non sono serviti dall'anteprima né inclusi nel repository; nessun saldo viene simulato.
- Packaging distinto: scatole per T-shirt e adesivi per scatole non sono gli sticker del catalogo Shopify. Le quantità sono da inserire.
- Costi e margini operativi visibili a tutti; tutti i membri potranno applicare sconti e rettifiche quando il backend sarà attivo. Finance solo founder, Gabriele e Gherardo; audit solo founder.
- Conto vendita: regola commerciale 60% LuckyLap / 40% negozio e prezzo negozio = prezzo web + 10 EUR. Base fiscale e consuntivi rinviati all'attivazione Vendite.

Nessun sorgente Drive, quantità Shopify o file del repository Partner è stato modificato. Nessun documento Drive al di fuori del perimetro autorizzato è incluso nell'app. La cartella `.private/` contiene eventuali estrazioni Finance locali ed è esclusa da Git insieme alle credenziali.

## Verifica

```sh
npm test
npm run typecheck
npm run build
```

I test applicativi non sostituiscono la verifica delle policy RLS su un database Supabase effettivo. Consultare `docs/backend.md` per configurazione, bootstrap e controlli di sicurezza da eseguire prima dell'uso multiutente. `docs/authentication.md` descrive login personale, membership e MFA già implementati, ancora da collegare e verificare sul progetto reale. L'inventario autenticato legge soltanto il database; non usa lo snapshot locale come ripiego.

## Infrastruttura

Nessun abbonamento attivato. Supabase Free è il piano cloud previsto; controllare quote e sospensione per inattività prima dell'uso operativo. Foto e file si caricheranno direttamente su Storage privato; evitare una copia indiscriminata dei media.

Vercel Hobby è limitato all'uso personale non commerciale e non è utilizzato per pubblicare questo gestionale aziendale. Il sorgente è predisposto per Vercel, ma la pubblicazione richiede una soluzione compatibile con i vincoli economici e contrattuali del progetto.

Font Barlow di Jeremy Tribby, licenza SIL Open Font License, conservata in `public/fonts/`. Icone Lucide, licenza ISC.

## Progetto

- Decisioni confermate: `docs/superpowers/specs/2026-10-21-gestionale-luckylap-design.md`.
- Piano operativo: `docs/superpowers/plans/2026-10-21-prima-versione-locale.md`.
- Progetto Partner: https://github.com/tommyieri/luckylap-partner . Continua a essere sviluppato separatamente con Claude.
- Repository dedicato e privato: https://github.com/tommyieri/luckylap-gestionale . GitHub conserva il codice; i futuri dati operativi e file riservati appartengono a Supabase.

La route `/finance` è predisposta per leggere da Supabase le importazioni riservate dopo login, membership autorizzata e MFA. Offre ricerca, filtri e dettagli dei movimenti; tutti restano da revisionare. Senza configurazione non carica alcuna copia locale. L’import effettivo è ancora da applicare: `docs/finance-import.md`.
