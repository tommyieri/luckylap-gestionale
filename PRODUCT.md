# LuckyLap Gestionale

<!-- impeccable:product-schema 1 -->

## Platform

web

## Prodotto e persone

Gestionale interno in italiano per cinque persone del brand LuckyLap: founder/CEO, Gabriele produzione, Ettore logistica, Gherardo Finance, Luca consulente Ciago Agency. Una piattaforma condivisa per trovare dati e materiali, gestire scorte, organizzare call e attività, sviluppare prodotti e seguire i partner.

## Mondo visivo autorevole

Il progetto GitHub `tommyieri/luckylap-partner` è la fonte per identità e sistema visivo: car culture essenziale, verde racing, bianco, inchiostro, font Barlow. Il gestionale è una superficie Operate: chiarezza, densità controllata, controlli familiari e dati leggibili prevalgono sulla decorazione.

## Regole del prodotto

- Fonte scorte: apertura dall'Excel inventario autorizzato su Drive, poi registro movimenti del gestionale; mai Shopify.
- Vendite attive dal 21 ottobre 2026, manuali e da Shopify; nessuno storico importato. Finance conserva lo storico importato da BudgetFlow e i movimenti del gestionale, leggibili dai membri che aprono l’area con la password Finance.
- Costi/margini e operazioni di sconto/rettifica accessibili a tutti i membri.
- Finance e Controllo CEO compaiono nel menu di tutti i membri. Ogni membro attivo può aprire ciascuna area con la relativa password corretta, senza un ulteriore filtro di ruolo.
- Finance: ogni movimento si corregge, si elimina e si ripristina, con motivazione e storico. Le fonti restano immutabili; le modifiche sono revisioni append-only con storico.
- Controllo CEO: solo un feed leggibile di cosa fa il team; il registro tecnico resta nel database.
- Packaging separato: scatole per T-shirt e adesivi per scatole, diversi dagli sticker Shopify.
- Conto vendita 60/40 a favore LuckyLap, prezzo in negozio +10 EUR sul web. La merce del negozio si conta e si cambia solo da Conto vendita; il resoconto del mese dice quanto fatturare, e in Finance entra solo il pagamento del negozio. Nuovo negozio, fattura e pagamenti solo con Finance aperta; il resto per tutti.
- Partner: tutti e cinque vedono e fanno tutto, Luca compreso.
- Il magazzino centrale si chiama «Magadzino»; «Magazzino» è la sezione del menu.
- Calendario interno, senza sincronizzazione Google Calendar o inviti esterni automatici.
- Drive sola lettura: inventario, grafiche, alcune foto ed eventuali informazioni professionali su Luca; nessun altro documento importato.
- Nessun abbonamento. L'app è oggi su Vercel Hobby, piano che Vercel riserva all'uso non commerciale: l'hosting resta così finché Tommi non decide (vedi `AGENTS.md`).

## Stato della consegna

App pubblicata su Vercel con dati in Supabase: cinque account personali, permessi nel database (RLS), password separate per Finance e Controllo CEO. Moduli collegati: Oggi (`/`), magazzino (`/stock`), rettifiche (`/stock/rettifiche`), vendite e ordini Shopify (`/sales`), conto vendita (`/consignment`), packaging (`/packaging`), Partner (`/partner`), calendario, attività e note (`/team`), Partner nel Team (`/team/partner`), Finance (`/finance`), grafiche (`/assets`), nuovi prodotti (`/development`), Controllo CEO (`/audit`). Ogni pagina ha lo stesso menu: sette sezioni visibili a tutti i membri; Finance e Controllo CEO chiedono la propria password per entrare. La guida «Come si usa» (`/guida`) spiega l'app in nove parti brevi, con i nomi veri di sezioni e pulsanti; sta nel piede del menu e in «Altro».

- **Partner** è dentro il gestionale: i 207 contatti della ricerca, importati il 22 ottobre 2026, con periodi, sezioni, messaggi modificabili con storico, stati, registro e lookbook.
- **Conto vendita** è semplice: negozi, conta in negozio, resoconto del mese da fatturare, pagamenti in Finance, ordini del negozio.
- **Oggi** è il primo schermo: agenda, contatti e solleciti Partner, ordini da preparare, magazzino e, per chi può aprire Finance, il conto vendita da regolare. La prima volta «Prima volta qui?» porta alla guida.
- **Finance modificabile** (dal 23 ottobre 2026, pull request #3): «Modifica / storico» su ogni movimento, eliminati recuperabili, «Chiudi Finance» in cima alle pagine.
- **Collegamenti**: «Segna inviato» crea un sollecito a 7 giorni per chi ha inviato; le date Partner entrano nel calendario; «Partner nel Team» (`/team/partner`) porta un contatto in calendario, produzione o conto vendita.
- **Controllo CEO** (dal 23 ottobre 2026) è il feed di cosa fa il team, per giorno, con filtri per persona e area e «Chiudi Controllo CEO». Problemi noti da decidere con Tommi in `docs/verification.md`.

L'anteprima locale, con lo snapshot dell'inventario, le note sul browser e dati sintetici per le altre pagine, resta solo per lo sviluppo.

## Contesto di lavoro

Un unico gestionale su GitHub, Vercel e Supabase riunisce vendite, pronto fisico, packaging, Partner, Team e Finance. Il pronto fisico deriva dalla conta autorizzata; il vendibile commerciale e i fatti degli ordini arrivano da Shopify. Il conto vendita conserva separati conta, resoconto da fatturare e incasso effettivo. I file Finance e la ricerca Partner importati restano fonti tracciabili.

## Evidenze disponibili

- Mappa delle sezioni e dei permessi: `src/lib/navigation.ts`; ruoli e accessi alle aree: `src/lib/auth/model.ts`.
- Flussi e guida del team: `src/components/guide-view.tsx`, `src/components/today/`, `docs/verification.md` e indice `docs/README.md`.
- Identità già implementata: caratteri locali e fonti in `public/fonts/`, token in `src/app/globals.css`, guscio in `src/components/workspace-shell.module.css`. `DESIGN.md` e `.impeccable/design.json` descrivono queste sorgenti; non sono una proposta di nuova identità.

## Principi di prodotto

- Registrare i fatti una volta e aggiornare i moduli collegati, conservando provenienza e storico.
- Tenere distinti pronto fisico, disponibilità commerciale Shopify e merce affidata ai negozi.
- Rendere condiviso il lavoro operativo e applicare nel database i permessi delle aree riservate.
- Mostrare un esito verificabile e recuperare lo stesso tentativo quando una risposta manca.
- Consentire le operazioni e la lettura anche dal telefono, con termini italiani e i nomi reali delle sezioni.

## Esiti attesi

Ritrovare uno SKU con quantità e fonte verificabili. Separare centrale e merce affidata. Preparare call e appuntare decisioni. Sapere quali funzioni sono operative e quali attendono dati o attivazione. Usare l'app sia alla scrivania sia sul telefono.

Specifica iniziale, in parte superata: `docs/superpowers/specs/2026-10-21-gestionale-luckylap-design.md`. Indice di tutti i documenti: `docs/README.md`.
