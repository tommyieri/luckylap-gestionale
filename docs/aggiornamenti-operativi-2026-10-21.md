# Aggiornamenti operativi — 21 ottobre 2026

## Inventario e condivisione

T-shirt prima dei cappellini. Ogni modello mantiene il proprio ordine e separa prima le varianti blu, poi quelle bianche; le taglie seguono XS, S, M, L, XL, XXL. Raggruppamento, vista piatta e CSV usano lo stesso ordinamento.

Calendario, attività, note e idee sono condivisi tra i cinque membri. Partecipanti e assegnatari indicano responsabilità, senza limitare la visibilità. Il calendario include Evento e un tipo personalizzato; il formato dei dettagli resta compatibile con gli appuntamenti precedenti.

## Packaging

Due materiali: Scatola T-shirt (30 × 22,5 × 2,5 cm) e Adesivo per scatola, con apertura autorizzata di 100 unità ciascuno in Magadzino. Il costo resta assente fino a un dato reale. La conta manuale conserva causale e registro.

Per ogni T-shirt da preparare si riservano una scatola e un adesivo. Alla consegna, o alla vendita LCM, i materiali vengono consumati una sola volta, anche con consegne parziali e notifiche ripetute. Cappellini e trasferimenti non consumano materiali. Un rimborso non rimette automaticamente in stock una confezione usata. Le carenze packaging sono visibili e non devono impedire la registrazione di un movimento reale di magliette o Finance. L’attivazione è distinta dallo storico.

## Finance

Riferimento studiato: [Budget Flow](https://budget-flow.app/), con conti, categorie raggruppate, selezione del periodo e grafico dei saldi. Il gestionale mantiene palette e tipografia LuckyLap.

Categorie richieste dalle foto: Income — Collab, Fund Raising, Others, Vendite; Fixed Cost — Software, Stipendi, Tasse & Contributi; Variable Cost — Attrezzatura, Eventi, Marketing, Produzione, Spedizioni, Trasferte. Le categorie senza movimenti restano disponibili.

I saldi vengono calcolati dai movimenti importati e dalle successive operazioni attribuite a un conto, con importi esatti in centesimi. Pending e date future sono separati dal consuntivo; i trasferimenti non diventano entrate o costi. I movimenti delle fonti restano consultabili e conservano il proprio stato di revisione.

Le dichiarazioni di contanti alimentano Cash. Incassi Shopify, bonifici o rimborsi privi di un conto esplicito restano da attribuire: il gateway non prova un accredito Revolut. Non si sommano una vendita, il suo incasso e la stessa osservazione Finance come tre entrate. Le protezioni e i permessi Finance restano invariati; vengono rimossi i testi che elencano chi conosce le password.

## Verifiche di rilascio

Il parser conserva e riconosce anche i timestamp originali BudgetFlow con fuso compatto (`+0100`), insieme al formato con due punti. Tutte le 144 righe reali attraversano il parser e il modello del riepilogo; i due saldi dei conti e il totale coincidono esattamente con le fonti e con i punti di ottobre del grafico. Una riga pending e due future restano separate dal consuntivo. La verifica dei dati reali usa un file temporaneo redatto esterno al repository, mai una fixture versionata.

Il packaging è attivo nel progetto Supabase LuckyLap dal 21 ottobre, migrazione `20261021164548`. La conta cloud è 100 scatole e 100 adesivi, nessun deficit; inventario prodotti ancora 214 pezzi. Nessun dato commerciale di prova è stato scritto sul cloud.

Verifica integrata del rilascio: 777 test applicativi in 70 file, typecheck e build produzione riusciti. Controlli visivi desktop e a 390 px su Finance, packaging, Team e inventario; nessun overflow pagina. La prima verifica ha rilevato e risolto una discrepanza di hydration nei testi SVG, con regressione dedicata. La successiva navigazione non produce nuovi errori. I filtri per categoria, il campo tipo appuntamento libero e la conta espandibile funzionano nell’anteprima isolata. Le prove visuali Finance usano dati reali con beneficiari, note e tag redatti, senza aprire le autorizzazioni della produzione.
