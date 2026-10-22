# P4, P5 e P6 — stato del ramo Codex

Aggiornamento: 22 ottobre 2026. Base `1b916c2`, ramo `codex/p4-p6-finance-collegamenti-ceo`.

Tommi ha confermato che Claude continua P2/P3 e che Codex deve avanzare sulle parti indipendenti. Questo ramo è una **bozza con dipendenze**, non una versione da unire o distribuire adesso.

## Parti pronte

- P4: registro append-only delle correzioni, eliminazione recuperabile, storico e ripristino per BudgetFlow, manuale, pagamenti, rimborsi e vecchi incassi conto vendita. Fonte immutabile, versione attesa, ricevuta legata all’autore e allo stesso invio.
- Editor autonomo `/finance/movimento?source_kind=…&source_id=…`, con verifica Finance e autore, fonte originale, motivazione e cronologia. Un tentativo relativo a un altro movimento rimanda alla propria fonte prima del retry.
- Proiezione unica per saldi e grafici pronta per il collegamento finale. Il nuovo incasso del residuo usa la stessa proiezione delle correzioni, anche nel vecchio conto vendita. Shopify senza correzioni conserva il proprio stato osservato.
- Vendite legge il saldo dichiarato efficace; un link a un ordine oltre la prima pagina apre l’ordine corretto. Nessun importo di conto Finance viene esposto al Team.
- P5: invio Partner → sollecito a sette giorni; risposta o chiusura → sollecito concluso. Import storici esclusi. Date Partner → calendario condiviso di giornata intera, con cambio d’ora a Roma e modifiche manuali preservate.
- `/team/partner`: eventi, progetto assegnato a Produzione, attività di apertura conto vendita e associazione di vendite già registrate agli eventi. Sedi estere subordinate alla verifica del commercialista; nessuna regola fiscale inventata.
- Oggi: contatti da fare, solleciti, agenda, ordini da preparare e magazzino; ogni riquadro fallisce in modo indipendente senza numeri parziali.
- P6: feed CEO italiano, per giorno, autore e area, con link alle fonti. Gli artefatti della stessa azione sono raggruppati prima della paginazione; le azioni manuali indipendenti rimangono distinte. Password e controllo founder invariati; registro tecnico conservato nel database.

## Da integrare dopo la consegna P3

Questi file di proprietà di Claude non sono stati modificati: schermate Finance, dashboard originale, moduli e calcoli nuovi del conto vendita, Partner e giacenze.

1. Collegare `loadFinanceRevisionContext` e `revisedFinanceDashboard` alle nuove schermate Finance; saldi, grafici, categorie e registro devono consumare la stessa proiezione.
2. Aggiungere i link di modifica/storico a ogni riga, filtro recupero eliminati compreso.
3. Per `shop_payment`, usare esclusivamente `update_consignment_payment` e lo storico P3, senza un secondo registro monetario. Verificare insieme i campi Finance e la proiezione degli incassi.
4. Adeguare il reader Finance del vecchio conto vendita al residuo efficace; la vecchia somma degli importi originali non basta dopo una correzione.
5. Montare il riquadro Oggi «Conto vendita da regolare» usando l’adapter P3 e una verifica Finance corrente; nessun importo nel markup degli altri membri.
6. Verificare il ramo integrato con i commit definitivi P2/P3 e ripetere i soli controlli interessati dalle modifiche.

## Dipendenze delle migrazioni

Le migrazioni P4 e P6 nuove non modificano quelle già applicate. P5 `20261022200101_partner_work_links.sql` è generata con Supabase CLI e ordinata subito dopo le dipendenze pubblicate P2 `20261022200000` e P3 `20261022200100`. Non applicarla senza il modulo Partner. Gli harness isolati usano un contratto sintetico minimo quando P2 non è ancora nel ramo; sono stati provati anche contro la migrazione P2 effettiva in sola lettura.

Nessun merge, deploy, cambiamento delle impostazioni o scrittura Supabase di produzione è stato eseguito. Nessuna modifica Drive, abbonamento o comunicazione esterna.
