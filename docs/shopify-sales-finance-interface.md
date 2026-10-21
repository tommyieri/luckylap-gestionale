# Ordini Shopify nelle viste operative e Finance

Le viste usano esclusivamente le proiezioni applicate dal processore canonico; non interrogano Shopify dal browser e non ricostruiscono ordini dal payload webhook. Dipendono dalle migrazioni `shopify_sales_core` e `shopify_canonical_worker` del backend. La loro pubblicazione deve seguire l'applicazione del relativo schema, comprese le tre tabelle Finance Shopify.

## Vendite e produzione

`sales_orders.source_kind` distingue `manual_declaration` da `shopify_canonical`. Il lettore accetta rispettivamente i canali manuali già esistenti e `shopify_web`/`shopify_pos`; richiede che ogni riga abbia la stessa provenienza dell'ordine. Conserva i cinque stati di pagamento Shopify (`unpaid`, `partially_paid`, `paid`, `partially_refunded`, `refunded`), lasciando invariati i due stati manuali.

Tutti i membri attivi leggono prezzi, sconti, costi e margini operativi con la stessa policy delle vendite manuali. Per Shopify il totale ordine può includere spedizione e imposte oltre al totale dei capi: il lettore continua a verificare esattamente l'identità economica di ogni riga, ma applica l'uguaglianza fra somma righe e totale ordine soltanto alle vendite manuali. Usa `BigInt` per prodotti, somme e formattazione dei centesimi; un costo sconosciuto resta sconosciuto.

L'interfaccia mostra fonte Shopify Online/POS, importazione automatica e origine tecnica dell'account. Il GID ordine nella reference viene presentato come “Ordine Shopify …”, mantenendo il riferimento originale nel modello. Non legge identità, job, snapshot o receipt privati.

Su un ordine Shopify sono assenti i moduli manuali di incasso, consegna e annullo, comprese le relative scope attive di recupero. Il database rimane l'autorità contro richieste manipolate e restituisce `external_order_managed_by_shopify`, riconosciuto dal server con un messaggio sicuro. La produzione resta riservata a founder/production: per ordini Shopify è disponibile anche quando la registrazione delle vendite manuali è spenta. Il server inoltra quel comando al database, che distingue la produzione esterna consentita da una nuova operazione manuale bloccata. I tentativi incerti continuano a usare UUID e payload congelati del modulo esistente.

Opzioni e disponibilità della pagina Vendite comprendono soltanto location di tipo `Magazzino` o `Negozio Conto Vendita`. Location `Esterno` non contribuiscono al pronto fisico di questa pagina; riferimenti a location completamente mancanti restano errori di lettura. Il backend deve mantenere lo stesso vincolo sulle nuove scritture: il filtro dell'interfaccia non sostituisce il controllo SQL. I nomi prodotto che includono già colore e taglia non ripetono il suffisso.

## Finance

Il loader Finance verifica nuovamente Auth, membership, ruolo e grant della password dell'area prima di leggere qualsiasi tabella protetta. Il loader Vendite non legge pagamenti, fatti commerciali, transazioni, rimborsi o dettagli fiscali Finance.

Il modello Finance mantiene quattro insiemi distinti:

- Vendite/annulli commerciali: fatti collegati all'ordine, con la loro provenienza.
- Incassi dichiarati: `order_payments.source_kind = manual_declaration`.
- Incassi Shopify osservati: `source_kind = shopify_observation`, metodo `shopify_observed`, riferimento uguale al GID della singola CAPTURE/SALE riuscita. Più capture dello stesso ordine rimangono più osservazioni.
- Rimborsi Shopify osservati: `shopify_refund_observations`, ciascuno collegato a una transazione REFUND riuscita e al proprio `commercial_facts.refund_id`.

I fatti di pagamento/rimborso vengono verificati contro le rispettive righe, senza renderli come un secondo incasso o rimborso. Ciascuna osservazione richiede una transazione corrispondente per ordine, ID, tipo, stato e importo; anche la verifica inversa rifiuta capture/refund riuscite prive della propria osservazione. Una AUTHORIZATION o un VOID resta un dettaglio della fonte, senza diventare pagamento.

`shopify_transaction_observations` e `shopify_order_financials` sono presentate in un dettaglio separato e richiudibile. Contengono riferimenti tecnici, gateway, parent, stato, date e valori fiscali originali/correnti. I valori nullable non diventano zero. Le query usano l'ordinamento stabile `order_id` e, per le transazioni, `transaction_gid`; tutte le tabelle vengono lette fino al conteggio esatto con il pager esistente.

Le sezioni non producono un totale misto fra vendita, dichiarazione, capture, rimborso e accredito. Un incasso osservato da Shopify non prova l'accredito sul conto. Un rimborso non registra un rientro fisico. Non vengono aggiunti movimenti bancari, contabilizzazioni IVA o scritture manuali automatiche.

## Verifica

87 test passati sui moduli Sales/Finance e sui due componenti: fonti e canali esterni, componenti aggiuntive del totale ordine, mismatch di provenienza, restrizione location, controlli manuali preservati, assenza dei controlli manuali per Shopify, produzione per i soli due ruoli, precisione al massimo centesimo dispari, due capture separate, refund, authorization/void, protezione del loader Finance e mancata lettura di tabelle Finance dal loader Sales. Test esclusivamente sintetici, senza ordini o mutazioni cloud. Typecheck integrato da rieseguire nel runtime allineato dal coordinatore.
