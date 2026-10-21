# LuckyLap Gestionale

Gestionale interno per il team LuckyLap. Codice nel repository GitHub privato, app su Vercel e dati in Supabase. Inventario fisico e disponibilità commerciale Shopify restano distinti.

## Cloud

- Repository privato: https://github.com/tommyieri/luckylap-gestionale
- Vercel: account **info@luckylap.com**, team **LuckyLap**, progetto **luckylap**. Dominio verificato: https://luckylap.vercel.app
- Supabase: progetto **luckylap-gestionale**, ref `annvatqnllkbrtufmgnl`, organizzazione LuckyLapCRM, piano Free.
- Nessun abbonamento, trial o componente a pagamento attivato. Stato e limiti: [deployment](docs/deployment.md).

Il collegamento dell'app usa solo URL e chiave pubblicabile Supabase. RLS protegge i dati; nessuna chiave amministrativa è inclusa nel repository, nel bundle o nelle variabili Vercel. `.private/` e le credenziali locali sono escluse anche dal deploy.

## Accessi e dati

Cinque accessi personali predisposti per Tommi, Gabriele, Ettore, Gherardo e Luca. Finance è riservata a Tommi, Gabriele e Gherardo con MFA; controllo CEO al solo founder con MFA. Nessuna registrazione pubblica. Inviti ancora da distribuire: gli account iniziali non hanno password assegnate e non sono state inviate email.

Inventario iniziale: 9 modelli, 51 SKU e 102 celle verificate contro l'Excel Drive autorizzato. 214 capi centrali, zero nel negozio censito. I valori salvati nel file non sono una nuova conta fisica certificata. Nessuna quantità Shopify sovrascrive questi dati. I movimenti operativi successivi passano dal registro del gestionale.

Finance: 144 righe BudgetFlow importate, tutte da verificare. Il CSV, il COGS Tracker Excel e il recap PDF originali sono conservati nello Storage privato e scaricabili soltanto con i permessi Finance e MFA. Le fonti storiche non modificano scorte o costi attuali, e non diventano automaticamente vendite o scritture contabili approvate.

Il calendario interno, le attività e le note condivise sono in `/team`; l'anteprima locale mantiene i propri appunti sul browser, senza importarli automaticamente. Le scritture verificano sessione e membership corrente. La sezione Finance è in `/finance`, gli originali in `/finance/documents`.

Il motore delle vendite collega ordine, incasso dichiarato, riserve, produzione e consegna in transazioni idempotenti. Rimane disabilitato fino alla verifica dell'interfaccia e alla definizione della data di avvio. Nessuno storico vendite è stato importato. Shopify richiede ancora un'applicazione permanente: il parser delle notifiche è predisposto, il collegamento live non è attivo.

Packaging: scatole T-shirt e adesivi delle scatole sono materiali distinti dagli sticker Shopify; quantità e costi non sono stati inventati. Conto vendita: 60% LuckyLap / 40% negozio, listino sito +10 EUR; il riparto fiscale resta da definire prima di automatizzarlo. Il progetto Partner continua separatamente con Claude: https://github.com/tommyieri/luckylap-partner

Nessun originale Drive, quantità Shopify o file del repository Partner è stato modificato.

## Sviluppo locale

Richiede Node.js 20.9 o successivo. Dipendenze e lockfile sono fissati.

```sh
npm ci
npm run dev
```

Aprire http://127.0.0.1:3000 . Il comando abilita l'anteprima locale, esclusivamente in sviluppo e fuori da Vercel, e lega il server a 127.0.0.1. In produzione l'app richiede Supabase e un account abilitato; non ripiega sullo snapshot JSON locale.

Per usare il database in locale, copiare `.env.example` in `.env.local` e configurare URL e chiave pubblicabile del progetto. Non inserire chiavi segrete nelle variabili `NEXT_PUBLIC_`.

```sh
npm test
npm run typecheck
npm run build
```

I test SQL embedded usano PGlite come dipendenza esterna, dati sintetici e Auth simulato. I report distinguono queste prove dai controlli reali Auth/JWT/MFA/REST e dalla concorrenza PostgreSQL su più connessioni, ancora da verificare prima delle vendite reali.

## Documentazione

- [Accesso e MFA](docs/authentication.md), [inviti e password](docs/inviti-account.md)
- [Verifica import cloud](docs/verifica-import-cloud.md), [verifica Auth cloud](docs/verifica-auth-cloud.md)
- [Finance](docs/finance-import.md), [backend](docs/backend.md)
- [Contratto ecosistema vendite](docs/ecosistema-vendite.md), [motore transazionale](docs/sales-ecosystem-backend.md)
- [Team condiviso](docs/team-workspace.md), [Shopify](docs/shopify-bridge.md)
- [Design](DESIGN.md), [ricerca UI UX Pro Max](docs/ui-ux-pro-max-research.md)

Font Barlow di Jeremy Tribby, SIL Open Font License in `public/fonts/`. Icone Lucide, ISC.
