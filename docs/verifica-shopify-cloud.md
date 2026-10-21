# Verifica indipendente Shopify — sola lettura

Progetto `annvatqnllkbrtufmgnl`, 21 ottobre 2026, snapshot delle 14:46:18 UTC. Nessuna scrittura SQL, modifica di account, lettura di credenziali o operazione sul negozio in questa verifica.

Le migration remote `20261021144441_shopify_sales_core` e `20261021144451_shopify_canonical_worker` risultano applicate. Gli hash SHA-256 del corpo di 11 funzioni cloud coincidono esattamente con le due migration locali immutabili: apply, validazione canonica, confronto timestamp, claim, finish, salute sync, entrambe le guardie core/località, comandi manuali condivisi e ricevitore dei sei topic.

## Dati conservati

| Controllo reale | Risultato |
| --- | ---: |
| Giacenza fisica totale | 214 |
| Celle stock / celle sconosciute | 102 / 0 |
| Membri attivi | 5 |
| Righe Finance importate | 144 |
| Scritture Finance manuali approvate | 0 |
| Ordini / righe / pagamenti / rimborsi | 0 / 0 / 0 / 0 |
| Fatti commerciali / riserve / fabbisogni produzione | 0 / 0 / 0 |
| Movimenti stock diversi da opening | 0 |
| Inbox / read-job / lease / identità / effetti Shopify | tutti 0 |

`manual_sales_enabled=true` e cutover `2026-10-21T14:06:47.976341Z` risultano preservati. Al momento della lettura la configurazione amministrativa del negozio era già presente, con località centrale esplicita ed `enabled=false`. Questa è una fotografia temporale: l'attivazione successiva è un'operazione distinta del responsabile.

Confrontate anche tutte le 102 coppie SKU/località, oltre al totale: ogni singola quantità coincide con l'estrazione autorizzata originale del Drive. Nessun saldo è cambiato e nessun valore sconosciuto è diventato zero.

## Permessi e vincoli

- Le quattro RPC di lavoro sono eseguibili soltanto da `service_role`; anon e authenticated non possono chiamare né wrapper né processore privato. Wrapper pubblici invoker, processori privati definer, tutti con search_path vuoto.
- Il getter di salute è eseguibile soltanto da authenticated; il corpo verificato controlla membership attiva e limita l'output a contatori e revisioni operative.
- Le tre nuove tabelle di dettaglio Finance hanno RLS attiva, SELECT autenticata subordinata a `private.can_finance()`, nessun DML client e nessun SELECT anon. Anche il ruolo servizio non ha accesso diretto a queste tabelle: il worker passa dalle RPC.
- Le sei nuove tabelle private hanno RLS senza policy e nessun privilegio diretto SELECT/INSERT/UPDATE/DELETE per anon, authenticated o service_role.
- Verificati i constraint di provenienza/autore tecnico NULL, i nuovi stati pagamento, il collegamento refund e i trigger di protezione su righe, pagamenti, riserve, fatti, località e ledger. Il trigger AFTER INSERT del read-job crea la lease; inbox/read-job restano append-only.

Sono controlli di metadati/grant e conteggi sul database cloud. Non sostituiscono un login JWT reale, una vendita effettiva o una consegna webhook di Shopify. La logica transazionale e le corse tra worker hanno invece 702 controlli locali PASS su PostgreSQL 17 reale, documentati in [shopify-ecosystem.md](./shopify-ecosystem.md).

## Advisor letti

Nessun nuovo warning relativo allo schema Shopify. Le 16 segnalazioni informative RLS senza policy riguardano tabelle private intenzionalmente chiuse e senza grant ([descrizione Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). Rimane il warning Auth preesistente sulla verifica delle password compromesse; nessuna impostazione Auth o abbonamento è stata cambiata ([descrizione Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)).

L'advisor performance segnala 18 FK della baseline senza indice dedicato; nessuna appartiene alle nuove tabelle Shopify. I 24 indici inutilizzati includono strutture nuove ancora prive di ordini. Non sono stati rimossi indici né modificato lo schema ([FK](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [indici inutilizzati](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)).

Evidenza locale senza dati Finance grezzi: `.private/deployment-proof/shopify-cloud-read-only.json` (conteggi, grant, hash, advisor; fuori Git).
