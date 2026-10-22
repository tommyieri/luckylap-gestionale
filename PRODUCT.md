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
- Conto vendita 60/40 a favore LuckyLap, prezzo in negozio +10 EUR sul web. La merce del negozio si conta e si cambia solo da Conto vendita; il resoconto del mese dice quanto fatturare, e in Finance entra solo il pagamento del negozio. Nuovo negozio, fattura e pagamenti solo con Finance aperta; il resto per tutti.
- Partner: tutti e cinque vedono e fanno tutto, Luca compreso.
- Il magazzino centrale si chiama «Magadzino»; «Magazzino» è la sezione del menu.
- Calendario interno, senza sincronizzazione Google Calendar o inviti esterni automatici.
- Drive sola lettura: inventario, grafiche, alcune foto ed eventuali informazioni professionali su Luca; nessun altro documento importato.
- Nessun abbonamento. L'app è oggi su Vercel Hobby, piano che Vercel riserva all'uso non commerciale: l'hosting resta così finché Tommi non decide (vedi `AGENTS.md`).

## Stato della consegna

App pubblicata su Vercel con dati in Supabase: cinque account personali, permessi nel database (RLS), password separate per Finance e Controllo CEO. Moduli collegati: Oggi (`/`), magazzino (`/stock`), rettifiche (`/stock/rettifiche`), vendite e ordini Shopify (`/sales`), conto vendita (`/consignment`), packaging (`/packaging`), Partner (`/partner`), calendario, attività e note (`/team`), Finance (`/finance`), grafiche (`/assets`), nuovi prodotti (`/development`), Controllo CEO (`/audit`). Ogni pagina ha lo stesso menu: al massimo sette sezioni, senza le aree in cui la persona non può entrare. La guida «Come si usa» (`/guida`) spiega l'app in sette parti brevi, con i nomi veri di sezioni e pulsanti; sta nel piede del menu e in «Altro».

- **Partner** è dentro il gestionale: i 207 contatti della ricerca, importati il 22 ottobre 2026, con periodi, sezioni, messaggi modificabili con storico, stati, registro e lookbook.
- **Conto vendita** è semplice: negozi, conta in negozio, resoconto del mese da fatturare, pagamenti in Finance, ordini del negozio.
- **In lavorazione** (branch di Codex, non ancora unito): movimenti Finance modificabili con storico, collegamenti tra Partner, Team e Oggi, Controllo CEO come feed leggibile di cosa fa il team. Oggi il registro Finance si corregge annullando la voce e `/audit` mostra il registro tecnico.

L'anteprima locale, con lo snapshot dell'inventario, le note sul browser e dati sintetici per le altre pagine, resta solo per lo sviluppo.

## Esiti attesi

Ritrovare uno SKU con quantità e fonte verificabili. Separare centrale e merce affidata. Preparare call e appuntare decisioni. Sapere quali funzioni sono operative e quali attendono dati o attivazione. Usare l'app sia alla scrivania sia sul telefono.

Specifica iniziale, in parte superata: `docs/superpowers/specs/2026-10-21-gestionale-luckylap-design.md`. Indice di tutti i documenti: `docs/README.md`.
