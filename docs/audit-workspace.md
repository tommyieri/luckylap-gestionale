# Controllo riservato al founder

La route `/audit` offre una vista in sola lettura delle modifiche registrate dai trigger del database. L’accesso richiede un utente verificato con membership attiva `founder` e sessione `aal2`.

La pagina controlla identità e ruolo prima di richiedere l’assurance della sessione e prima di leggere il registro. Il loader ripete il controllo founder/aal2: per gli altri ruoli non esegue query su audit o nomi degli operatori. Le RLS `private.can_audit()` già applicate al database restano l’autorità finale. Il Proxy deve includere `/audit/:path*` per cookie aggiornati e intestazioni `no-store`.

La query legge esclusivamente `id`, `occurred_at`, `actor_id`, `table_name`, `operation` e `record_key`. Non richiede `old_data` o `new_data`. Dal `record_key` vengono mantenuti soltanto UUID delle chiavi `id`, `user_id`, `stock_item_id` e `location_id`; nessun contenuto arbitrario del JSON passa alla vista. Degli operatori sono letti soltanto ID e nome, limitando la ricerca agli attori dei record mostrati. Un `actor_id` nullo viene indicato come “Operazione di sistema”, senza attribuirlo a un dipendente.

Il registro mostra 50 elementi per pagina, con ordinamento decrescente per coppia `occurred_at, id` e cursore verso le modifiche precedenti. Il timestamp del cursore conserva la precisione PostgreSQL fino ai microsecondi: non viene normalizzato con `Date.toISOString`, che potrebbe saltare elementi nello stesso millisecondo. I parametri sono validati prima di costruire il filtro PostgREST; nessuna interpolazione di testo libero raggiunge il filtro. Conteggio e limite effettivo sono verificati per rifiutare pagine troncate.

I pulsanti “Più recenti” e “Modifiche precedenti” rileggono il database nella sessione corrente; questa versione non applica modifiche o cancellazioni dal registro. Gli orari sono mostrati in `Europe/Rome`.

Il registro traccia creazioni, modifiche ed eliminazioni dei dati condivisi, comprese le operazioni di sistema/importazione. Non traccia automaticamente letture di pagine, presenze o login. Il dettaglio dei contenuti modificati non è esposto; potrà richiedere una vista dedicata e una verifica separata.

I test sintetici coprono esclusione delle query per ruoli non founder/aal1, colonne selezionate, rimozione dei payload non ammessi, lookup ristretto dei nomi, attore di sistema, cursori con microsecondi, input non valido e pagine incomplete. Le prove con sessioni/JWT reali e i cinque ruoli sono documentate separatamente in `docs/verifica-auth-cloud.md`, incluso il blocco audit per ruoli diversi dal founder o senza aal2 e la revoca della membership.

Il coordinatore ha verificato la resa visiva con soli metadati sintetici a 1280 px e 390 px: scala mobile 1 e nessun overflow. La prova mobile riservata è `.private/deployment-proof/audit-mobile.png`. La fixture `/qa-audit`, presente soltanto nella copia temporanea, è stata rimossa e risponde 404.
