# Snapshot iniziale inventario Lucky Lap

Fonte autorevole indicata dall'utente: [LuckyLap_Gestione_inventario.xlsx](https://docs.google.com/spreadsheets/d/1yl89YStNLwRE4C3AVZjSCUoyjmIMepAl/edit).
Ultima modifica dichiarata da Drive: 2026-10-12T19:21:50.653Z.
La data di modifica del file non certifica la data della conta fisica. Nel JSON inventory_as_of_date resta null.

## Perimetro

Sono state lette soltanto le schede Anagrafica Prodotti, Varianti (SKU), Magazzini e Assortimento.
Il file contiene 9 modelli, 51 SKU, 4 codici location e 51 righe di assortimento.
I quattro codici location comprendono il magazzino, il negozio in conto vendita e i due soggetti esterni previsti dalla fonte; soltanto le due location con intestazione in Assortimento ricevono quantità.
Non sono stati importati righe Vendite, Produzione o Movimenti, ordini, documenti finance, indirizzi, referenti, contatti personali o note libere.
Le scatole e gli adesivi dedicati al packaging richiedono una futura anagrafica distinta. Non sono stati creati articoli o quantità sostitutivi.

## Fedeltà dei dati

Le quantità sono i valori già salvati nelle celle di Assortimento: non sono state ricalcolate formule e non sono stati ricostruiti movimenti.
SKU, modelli, colori, taglie e codici location conservano il testo della fonte.
Uno zero esplicito resta 0. Una cella priva di valore resta null.
I valori già salvati di Totale Rete, Obiettivo, Da Ordinare, Sotto Scorta, costi, prezzi e valorizzazioni sono copiati, senza ricalcolo.
Ogni record conserva foglio, riga e intervallo sorgente; ogni quantità per location conserva anche la cella.
Le colonne G:N sono prive di intestazione location e di quantità utilizzabili nelle righe SKU; sono registrate come colonne non assegnate.
Le righe 57:66 senza SKU sono spazi predisposti nel modello. Non diventano articoli, anche se alcune formule salvate riportano zero.
Le varianti e l'assortimento hanno lo stesso insieme di 51 SKU; non sono emersi identificativi duplicati o cache mancanti nelle celle necessarie all'estrazione.
Sono stati confrontati 102 valori di quantità per location fra celle sorgenti e record prodotti, senza differenze.
Questi controlli verificano la trascrizione, non riconciliano il magazzino fisico e non certificano la logica delle formule Excel.

## Utilizzo previsto e vincoli

Questo JSON è una fonte iniziale locale per la futura interfaccia. Non è una migrazione applicata a Supabase e non certifica saldi riconciliati.
Le quantità Shopify non sono state utilizzate né modificate.
La sezione vendite resta in sospeso: nessuna riga vendita o ordine deve essere ricostruita da questi saldi.
L'area finance attende i file autorizzati da Gherardo.
I costi di prodotto e le valorizzazioni presenti sono dati di inventario autorizzati; non sono stati importati saldi o movimenti finance.
Eventuali quantità future vanno concordate come nuove operazioni, senza riprodurre lo storico già incorporato nei saldi di questa fonte.
Il file originale su Drive non è stato modificato.
