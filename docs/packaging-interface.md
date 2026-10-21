# Packaging condiviso

La pagina `/packaging` gestisce materiali reali usati per confezionare le T-shirt: scatole, adesivi applicati sulle scatole e altri materiali. Gli adesivi del packaging sono distinti dagli sticker venduti su Shopify. Non vengono inseriti materiali, SKU, costi o quantità predefiniti.

## Accesso e letture

La pagina e ciascuna azione verificano `Auth.getUser()` e la membership attiva nel database tramite `verifiedMember`. Tutti i ruoli attivi possono leggere costi operativi, creare materiali e dichiarare la prima conta. La verifica della pagina non sostituisce quella dell’azione. Le letture usano la sessione dell’utente e le policy RLS; non usano credenziali privilegiate né interrogano Finance.

Il loader legge `stock_items` di tipo `packaging`, `packaging_items` e tutti i magazzini con paginazione per chiave e conteggio esatto. Le disponibilità vengono lette per magazzino e gruppi di massimo 100 materiali, con cursore `stock_item_id`. Un errore, un elenco troncato, metadati mancanti o riferimenti incoerenti interrompono la lettura. Nessun elenco parziale viene mostrato.

Una combinazione materiale/magazzino senza saldo significa quantità sconosciuta. La vista la rappresenta con `onHand: null`, mai con zero. Uno zero esplicitamente contato resta zero. Non si sommano quantità sconosciute per produrre totali apparentemente certi.

## Operazioni

**Nuovo materiale:** nome, SKU interno inserito dall’utente, tipo, specifiche facoltative, costo unitario facoltativo, magazzino esplicito e conta iniziale facoltativa. Il campo quantità vuoto conserva il dato sconosciuto; `0` è una conta dichiarata. Il costo vuoto resta da inserire; `0` è un costo dichiarato pari a zero.

**Conta iniziale:** materiale e magazzino espliciti, quantità intera compresa tra 0 e 1.000.000.000, causale da 3 a 500 caratteri. È consentita soltanto quando il saldo è sconosciuto. Per un saldo già noto il collegamento porta a `/stock`, dove le rettifiche successive applicano un delta al registro esistente.

Gli importi in euro vengono convertiti in centesimi partendo dalla stringa, senza moltiplicare un valore decimale in virgola mobile. Sono accettati punto o virgola decimale, con al massimo due cifre; vengono rifiutati separatori delle migliaia, esponenti, valori negativi e oltre 9.999.999.999,99 euro.

Le azioni invocano esclusivamente:

- `create_packaging_material(p_operation_id, p_payload)`
- `initialize_packaging_count(p_operation_id, p_payload)`

Il payload ha `schema_version: 1`, struttura esatta e nessun ruolo o autore fornito dal client. Le RPC verificano membership, ricevuta idempotente e flag `stock_adjustments_enabled`. Il flag disattivato blocca ogni nuova scrittura. Un tentativo identico già registrato può comunque recuperare la sua ricevuta.

Il consumo del packaging non è automatico in questa versione. Non si presume una scatola o un adesivo per ogni vendita e non si scrivono movimenti Shopify.

## Recupero di risposte perse

Prima di inviare, il client congela UUID, tipo di comando e payload completo in `sessionStorage`, sotto una chiave separata per utente. Un lock sincrono impedisce che due submit o retry nello stesso tick creino riferimenti o richieste distinti prima del rendering React. Se l’archiviazione non è disponibile non invia la mutazione. I moduli restano bloccati mentre un’operazione non è confermata; la pagina presenta il riferimento e tutti i dati del tentativo con **Verifica lo stesso invio**.

Il recupero resta visibile anche se la conta risulta ora nota, il materiale è stato creato o il flag è stato disattivato dopo l’invio originale. Il retry conserva lo stesso UUID e payload. Non viene generata una seconda operazione per risolvere un esito dubbio.

Errori di rete, risposte incomplete o errori di membership, flag e validazione durante un retry mantengono l’esito incerto, perché possono precedere la verifica della ricevuta. Un conflitto di idempotenza conserva il riferimento e richiede verifica del registro. Un esito positivo confermato sopravvive a errori di revalidazione della UI. Dopo successo vengono rilette `/packaging`, `/stock` e `/`.

## Interfaccia e verifica

La pagina estende il sistema visivo esistente: verde racing, Barlow, superfici bianche, bordi sottili e composizione condivisa con le rettifiche. Riusa il CSS stock e aggiunge soltanto il selettore delle operazioni, le istruzioni dei campi e il filtro per magazzino. Nessun nuovo token o cambiamento a `DESIGN.md`.

I 45 test del modulo verificano centesimi esatti, valori mancanti/zero, limiti dei comandi, integrità delle letture, controllo membership per ogni azione, accesso di tutti i ruoli operativi, mapping sicuro degli errori, retry conservativi, ricevute, revalidazione e doppi submit/retry nello stesso tick. I test sono sintetici e non mutano il cloud. TypeScript supera il controllo nel runtime locale. Il root ha verificato la UI a 1280 e 390 px, senza overflow né errori console. Queste verifiche non sostituiscono la prova integrata REST delle RPC.
