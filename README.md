# LuckyLap Gestionale

Gestionale interno per il team LuckyLap. Codice nel repository GitHub privato, app su Vercel e dati in Supabase. Inventario fisico e disponibilità commerciale Shopify restano distinti.

## Cloud

- Repository privato: https://github.com/tommyieri/luckylap-gestionale
- Vercel: account **info@luckylap.com**, team **LuckyLap**, progetto **luckylap**. Dominio verificato: https://luckylap.vercel.app
- Supabase: progetto **luckylap-gestionale**, ref `annvatqnllkbrtufmgnl`, organizzazione LuckyLapCRM, piano Free.
- Nessun abbonamento, trial o componente a pagamento attivato. Stato e limiti: [deployment](docs/deployment.md).

L’accesso del team usa URL e chiave pubblicabile Supabase, con RLS e sessioni personali. Il worker Shopify isolato usa credenziali tecniche riservate alle variabili server Vercel di produzione; nessuna chiave privata raggiunge il browser o il repository. `.private/` e le credenziali locali sono escluse dal deploy.

## Accessi e dati

Cinque identità personali per Tommi, Gabriele, Ettore, Gherardo e Luca. La scelta del founder prevede una password operativa comune di almeno sei caratteri, una seconda password condivisa per Finance e una separata per il controllo CEO, senza autenticatore obbligatorio. Finance resta riservata a Tommi, Gabriele e Gherardo; CEO al founder. Le tre password sono state scelte e configurate dal founder, senza conservarle in file o log. Tutti e cinque gli account risultano confermati. Nessuna registrazione pubblica o email inviata. Il founder ha completato il primo accesso.

Inventario iniziale: 9 modelli, 51 SKU e 102 celle verificate contro l'Excel Drive autorizzato. 214 capi in **Magadzino**, zero in **LCM**. Sono le sole due sedi attive: online, POS, contanti, eventi ed Etsy attingono a Magadzino; LCM segue il conto vendita. I valori salvati nel file non sono una nuova conta fisica certificata. Nessuna quantità Shopify sovrascrive questi dati. I movimenti operativi successivi passano dal registro del gestionale.

Finance: 144 righe BudgetFlow importate, tutte da verificare. Il CSV, il COGS Tracker Excel e il recap PDF originali sono conservati nello Storage privato e scaricabili soltanto con i permessi Finance e lo sblocco dell’area. Le fonti storiche non modificano scorte o costi attuali, e non diventano automaticamente vendite o scritture contabili approvate.

Ogni pagina per i membri ha lo stesso menu, filtrato per permesso: barra laterale sul desktop, barra in basso sul telefono ([layout condiviso](docs/workspace-layout.md)). La home `/` è Oggi, con l'agenda del giorno e i segnali del magazzino. Le giacenze sono in `/stock`, le rettifiche in `/stock/rettifiche`. Il calendario interno, le attività e le note condivise sono in `/team`; l'anteprima locale mantiene i propri appunti sul browser, senza importarli automaticamente. Le scritture verificano sessione e membership corrente. La sezione Finance è in `/finance`, gli originali in `/finance/documents`.

Il motore delle vendite collega ordine, incasso dichiarato, riserve, produzione e consegna in transazioni idempotenti. Il founder ha confermato nessun movimento successivo ai 214 capi di apertura. Vendite, sconti e rettifiche sono attivi dal 21 ottobre 2026 alle 16:06:47 Europe/Rome, dopo pubblicazione e verifica. Nessuno storico vendite è stato importato. L’app interna LuckyLap Gestionale è stata creata e installata sul negozio con i soli permessi `read_products` e `read_orders`. Il motore Shopify comprende lettura canonica, token a scadenza, coda, retry, riserve, produzione, incassi e rimborsi. Il collegamento live e il recupero automatico ogni minuto sono attivi; prove cloud registrate nel [deployment](docs/deployment.md).

Packaging: scatole T-shirt e adesivi delle scatole sono materiali distinti dagli sticker Shopify; quantità e costi non sono stati inventati. Conto vendita: 60% LuckyLap / 40% negozio, listino sito +10 EUR; nessuno sconto in negozio, quote commerciali e incassi separati. Queste quote non sono una determinazione fiscale. I moduli sono in `/packaging` e `/consignment`; `/assets` contiene sei originali grafici privati, `/development` segue i nuovi prodotti e `/finance/work` distingue fatti delle vendite, incassi e registrazioni manuali. Partner è una sezione del gestionale, `/partner`: per ora la pagina rimanda al roadbook online, finché il modulo non entra nel gestionale con la sua tappa.

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

I test SQL embedded usano PGlite come dipendenza esterna, dati sintetici e Auth simulato. Le prove reali Auth/REST/Storage e PostgreSQL su più connessioni sono documentate separatamente in [verifiche](docs/verification.md).

## Documentazione

- [Accesso e password delle aree](docs/authentication.md), [inviti e password](docs/inviti-account.md)
- [Verifica import cloud](docs/verifica-import-cloud.md), [verifica Auth cloud](docs/verifica-auth-cloud.md)
- [Finance](docs/finance-import.md), [backend](docs/backend.md)
- [Contratto ecosistema vendite](docs/ecosistema-vendite.md), [motore transazionale](docs/sales-ecosystem-backend.md)
- [Team condiviso](docs/team-workspace.md), [Shopify](docs/shopify-bridge.md)
- [Design](DESIGN.md), [ricerca UI UX Pro Max](docs/ui-ux-pro-max-research.md)

Font Barlow di Jeremy Tribby, SIL Open Font License in `public/fonts/`. Icone Lucide, ISC.
