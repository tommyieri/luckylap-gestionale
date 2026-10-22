# Stato Shopify nella pagina Vendite

Il blocco server `ShopifySyncHealth` riceve soltanto la proiezione di `get_shopify_sync_status()`. Il loader verifica Auth e membership attiva prima della RPC; tutti i cinque ruoli possono consultarla senza entrare in Finance. Non legge tabelle private, importi, credenziali, payload, lease o receipt.

Contratto RPC: `configured`, `enabled`, `counters` (`pending`, `retry`, `processing`, `review`, `applied`, `ignored`, `lastAppliedAt`) e al massimo venti `reviews` (`orderGid`, `reason`, `observedAt`). Il parser rifiuta risposte espanse, parziali, contatori non interi, ID non Order e causali non sicure. Errori e dati incompleti producono “Stato non disponibile”, senza inventare una coda vuota.

L'interfaccia dichiara “Attivo” soltanto se il database è abilitato **e** `SHOPIFY_WORKER_ENABLED === "true"` sul server. Il flag privato non viene esposto al client. In vista restano solo «Ultimo aggiornamento» (`lastAppliedAt`, ora di Roma) e i casi da verificare; i sei contatori stanno chiusi in «Dettagli tecnici», perché contano aggiornamenti e notifiche, non vendite.

Sotto «Casi da verificare» la pagina dice cosa fare: «Se compare un caso, avvisa Tommi. Non registrare a mano lo stesso ordine.» Nell’app nessuno li risolve. Le causali dei casi da verificare diventano frasi italiane; un codice sconosciuto riceve un testo neutro e non viene stampato. Gli ID non sono visibili. Un link Admin viene generato soltanto da `SHOPIFY_SHOP_DOMAIN` canonico configurato e GID Order valido: `https://<shop>.myshopify.com/admin/orders/<id>`. In assenza di dominio valido non viene inventato alcun collegamento. L'apertura esterna usa `noopener noreferrer`.

La pagina Vendite passa il blocco server come slot al componente interattivo. Le vendite dirette, gli eventi e gli altri canali manuali hanno una sola sorgente selezionabile attiva di tipo `Magazzino`, preselezionata quando unica: **Magadzino**. **LCM** rimane nei dettagli di magazzino e nel flusso conto vendita; il validator del form rifiuta il suo uso per una nuova vendita manuale. I nomi derivano dal database.

Verifica sintetica: 112 test passati su Sales/Finance e health, inclusi tutti i ruoli, revoca membership, gating runtime/database, risposte inattese, niente dati riservati, link safe, precisione importi, sorgenti separate e rifiuto LCM per nuove vendite dirette. Nessuna modifica cloud o ordine di prova. QA visuale e typecheck integrato sono affidati al coordinatore nel runtime completo allineato.
