# LuckyLap Gestionale

Gestionale interno per il team LuckyLap. Codice nel repository GitHub privato, app su Vercel e dati in Supabase. Inventario fisico e disponibilità commerciale Shopify restano distinti.

## Cloud

- Repository privato: https://github.com/tommyieri/luckylap-gestionale
- Vercel: account **info@luckylap.com**, team **LuckyLap**, progetto **luckylap**. Dominio verificato: https://luckylap.vercel.app
- Supabase: progetto **luckylap-gestionale**, ref `annvatqnllkbrtufmgnl`, organizzazione LuckyLapCRM, piano Free.
- Nessun abbonamento, trial o componente a pagamento attivato. Stato e limiti: [deployment](docs/deployment.md).

L’accesso del team usa URL e chiave pubblicabile Supabase, con RLS e sessioni personali. Il worker Shopify isolato usa credenziali tecniche riservate alle variabili server Vercel di produzione; nessuna chiave privata raggiunge il browser o il repository. `.private/` e le credenziali locali sono escluse dal deploy.

## Accessi e dati

Cinque identità personali per Tommi, Gabriele, Ettore, Gherardo e Luca. La scelta del founder prevede una password operativa comune di almeno sei caratteri, una seconda password condivisa per Finance e una separata per il controllo CEO, senza autenticatore obbligatorio. Finance e Controllo CEO sono visibili a tutti i membri; chi conosce la relativa password corretta può aprire l’area, indipendentemente dal ruolo. Le tre password sono state scelte e configurate dal founder, senza conservarle in file o log. Tutti e cinque gli account risultano confermati. Nessuna registrazione pubblica o email inviata. Il founder ha completato il primo accesso.

Inventario iniziale: 9 modelli, 51 SKU e 102 celle verificate contro l'Excel Drive autorizzato. 214 capi in **Magadzino**, zero in **LCM**. Sono le sole due sedi attive: online, POS, contanti, eventi ed Etsy attingono a Magadzino; LCM segue il conto vendita. I valori salvati nel file non sono una nuova conta fisica certificata. Nessuna quantità Shopify sovrascrive questi dati. I movimenti operativi successivi passano dal registro del gestionale.

Finance: 144 righe BudgetFlow importate, tutte da verificare. Il CSV, il COGS Tracker Excel e il recap PDF originali sono conservati nello Storage privato e scaricabili soltanto con i permessi Finance e lo sblocco dell’area. Le fonti storiche non modificano scorte o costi attuali, e non diventano automaticamente vendite o scritture contabili approvate.

Ogni pagina per i membri ha lo stesso menu, filtrato per permesso: barra laterale sul desktop, barra in basso sul telefono ([layout condiviso](docs/workspace-layout.md)). La guida «Come si usa» (`/guida`) sta nel piede del menu e in «Altro». La home `/` è Oggi: agenda del giorno, contatti e solleciti Partner, ordini da preparare, magazzino e, per chi può aprire Finance, il conto vendita da regolare. La prima volta il riquadro «Prima volta qui?» porta alla guida. Le giacenze sono in `/stock`, le rettifiche in `/stock/rettifiche`. Il calendario interno (a mese, con un pallino sui giorni con impegni), le attività e le note condivise sono in `/team`; le date Partner entrano come giornate intere solo con «Accordo fatto»; «Partner nel Team» (`/team/partner`) collega i contatti al lavoro del team. L'anteprima locale mostra dati sintetici, senza salvare. Le scritture verificano sessione e membership corrente. La sezione Finance è in `/finance`, gli originali in `/finance/documents`; in cima a ogni pagina Finance c'è «Chiudi Finance», in Controllo CEO «Chiudi Controllo CEO».

Il motore delle vendite collega ordine, incasso dichiarato, riserve, produzione e consegna in transazioni idempotenti. Il founder ha confermato nessun movimento successivo ai 214 capi di apertura. Vendite, sconti e rettifiche sono attivi dal 21 ottobre 2026 alle 16:06:47 Europe/Rome, dopo pubblicazione e verifica. Nessuno storico vendite è stato importato. L’app interna LuckyLap Gestionale è stata creata e installata sul negozio con i soli permessi `read_products` e `read_orders`. Il motore Shopify comprende lettura canonica, token a scadenza, coda, retry, riserve, produzione, incassi e rimborsi. Il collegamento live e il recupero automatico ogni minuto sono attivi; prove cloud registrate nel [deployment](docs/deployment.md).

Packaging: scatole T-shirt e adesivi delle scatole sono materiali distinti dagli sticker Shopify; quantità e costi non sono stati inventati. Il modulo è in `/packaging`.

Conto vendita (`/consignment`, scheda di Vendite): elenco dei negozi, conta della merce in negozio, resoconto del mese da fatturare, pagamenti e ordini del negozio. Quota 60% LuckyLap / 40% negozio, prezzo del sito +10 EUR; nessuno sconto in negozio. Il resoconto non è denaro: Finance lo mostra nel pannello «Conto vendita · da incassare» e nei saldi entra solo il pagamento del negozio. La merce del negozio si conta e si cambia solo da Conto vendita: le rettifiche da `/stock` sul negozio vengono rifiutate, anche dal database. Queste quote non sono una determinazione fiscale. [Conto vendita](docs/consignment.md).

Partner (`/partner`) è dentro il gestionale: 207 contatti della ricerca importati il 22 ottobre 2026, divisi per periodo e sezione, con stati, registro e lookbook. Le prime email le scrive l'assistente ([Assistente Partner](docs/partner-assistente.md)). Tutti e cinque vedono e fanno tutto. [Partner](docs/partner.md).

`/assets` («Grafica e foto») contiene sei originali grafici privati; un contenuto caricato per sbaglio si archivia e si ripristina, senza cancellare il file. `/development` segue i nuovi prodotti e `/finance/work` distingue fatti delle vendite, incassi e registrazioni manuali.

Dal 23 ottobre 2026 (pull request #3 di Codex, quattro migrazioni applicate in produzione):

- **Finance modificabile.** Ogni movimento si corregge, si elimina e si ripristina con «Modifica / storico», sempre con una motivazione. Le fonti restano immutabili; le modifiche sono revisioni append-only con storico. Un movimento eliminato esce dai saldi e si recupera dal filtro «Eliminati · recuperabili». [Revisioni Finance](docs/finance-revisions.md).
- **Collegamenti e Oggi.** «Segna inviato» in Partner crea per chi ha inviato un sollecito a 7 giorni nelle attività del Team; una risposta, un nuovo invio, lo stato «Accordo fatto» o «Non interessato» o «Non contattare» lo chiudono. Vale solo per gli invii segnati nell'app, non per le righe dei file dei dispositivi. Le date di eventi e candidature Partner entrano nel calendario. Oggi ha tutti i riquadri descritti sopra.
- **Controllo CEO** (`/audit`) è un feed leggibile di cosa fa il team, una frase per azione, per giorno, con filtri per persona e area. Il registro tecnico resta nel database. [Controllo CEO](docs/audit-workspace.md).

Problemi noti di questa parte, trovati in revisione il 23 ottobre e da decidere con Tommi: [verifiche](docs/verification.md), «Problemi noti dopo P4-P6».

Nessun originale Drive o quantità Shopify è stato modificato. Il repository Partner è cambiato solo il 28 ottobre 2026, per spegnere GitHub Pages ([Partner](docs/partner.md), «GitHub Pages»).

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
- [Finance](docs/finance-import.md), [revisioni Finance](docs/finance-revisions.md), [Controllo CEO](docs/audit-workspace.md), [backend](docs/backend.md)
- [Contratto ecosistema vendite](docs/ecosistema-vendite.md), [motore transazionale](docs/sales-ecosystem-backend.md)
- [Team condiviso](docs/team-workspace.md), [Shopify](docs/shopify-bridge.md)
- [Partner](docs/partner.md), [conto vendita](docs/consignment.md), [contenuti e sviluppo](docs/assets-development.md)
- [Layout condiviso e guida «Come si usa»](docs/workspace-layout.md), [verifiche](docs/verification.md)
- [Design](DESIGN.md), [ricerca UI UX Pro Max](docs/ui-ux-pro-max-research.md)
- [Indice di tutti i documenti](docs/README.md)

Font Barlow di Jeremy Tribby, SIL Open Font License in `public/fonts/`. Icone Lucide, ISC.
