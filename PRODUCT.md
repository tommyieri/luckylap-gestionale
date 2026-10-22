# LuckyLap Gestionale

## Prodotto e persone

Gestionale interno in italiano per cinque persone del brand LuckyLap: founder/CEO, Gabriele produzione, Ettore logistica, Gherardo Finance, Luca consulente Ciago Agency. Una piattaforma condivisa per trovare dati e materiali, gestire scorte, organizzare call e attività, sviluppare prodotti e seguire i partner.

## Mondo visivo autorevole

Il progetto GitHub `tommyieri/luckylap-partner` è la fonte per identità e sistema visivo: car culture essenziale, verde racing, bianco, inchiostro, font Barlow. Il gestionale è una superficie Operate: chiarezza, densità controllata, controlli familiari e dati leggibili prevalgono sulla decorazione.

## Regole del prodotto

- Fonte scorte: apertura dall'Excel inventario autorizzato su Drive, poi registro movimenti del gestionale; mai Shopify.
- Vendite attive dal 21 ottobre 2026, manuali e da Shopify; nessuno storico importato. Finance: 144 righe BudgetFlow importate, tutte da verificare, visibili solo ai tre autorizzati.
- Costi/margini e operazioni di sconto/rettifica accessibili a tutti i membri.
- Finance soltanto founder, Gabriele, Gherardo; Controllo soltanto founder.
- Packaging separato: scatole per T-shirt e adesivi per scatole, diversi dagli sticker Shopify.
- Conto vendita 60/40 a favore LuckyLap, prezzo in negozio +10 EUR sul web.
- Calendario interno, senza sincronizzazione Google Calendar o inviti esterni automatici.
- Drive sola lettura: inventario, grafiche, alcune foto ed eventuali informazioni professionali su Luca; nessun altro documento importato.
- Nessun abbonamento. L'app è oggi su Vercel Hobby, piano che Vercel riserva all'uso non commerciale: l'hosting resta così finché Tommi non decide (vedi `AGENTS.md`).

## Stato della consegna

App pubblicata su Vercel con dati in Supabase: cinque account personali, permessi nel database (RLS), password separate per Finance e Controllo CEO. Moduli collegati: Oggi (`/`), magazzino (`/stock`), rettifiche (`/stock/rettifiche`), vendite e ordini Shopify (`/sales`), conto vendita (`/consignment`), packaging (`/packaging`), Partner (`/partner`), calendario, attività e note (`/team`), Finance (`/finance`), grafiche (`/assets`), nuovi prodotti (`/development`), Controllo CEO (`/audit`). Ogni pagina ha lo stesso menu: al massimo sette sezioni, senza le aree in cui la persona non può entrare. Partner dentro il gestionale: ha già la sua sezione, e fino alla tappa Partner la pagina rimanda al roadbook online. L'anteprima locale, con snapshot inventario e note sul browser, resta solo per lo sviluppo.

## Esiti attesi

Ritrovare uno SKU con quantità e fonte verificabili. Separare centrale e merce affidata. Preparare call e appuntare decisioni. Sapere quali funzioni sono operative e quali attendono dati o attivazione. Usare l'app sia alla scrivania sia sul telefono.

Specifica iniziale, in parte superata: `docs/superpowers/specs/2026-10-21-gestionale-luckylap-design.md`. Indice di tutti i documenti: `docs/README.md`.
