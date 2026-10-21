# Verifica delle importazioni in Supabase

Verifica read-only del 21 ottobre 2026 sul progetto `annvatqnllkbrtufmgnl`. Nessuna riga, autorizzazione o configurazione è stata modificata durante questi controlli.

## Inventario

Il confronto è stato eseguito tra tutte le coppie SKU/magazzino del database e lo snapshot locale dell'Excel indicato dall'utente come fonte autorevole, senza riaprire o modificare Drive.

| Controllo | Risultato reale |
| --- | --- |
| Prodotti / modelli | 9 |
| SKU prodotto | 51 |
| Magazzini in anagrafica | 4 |
| Celle di giacenza importate | 102 |
| Celle confrontate esattamente con la fonte | 102 su 102 |
| Differenze di quantità o identificatori | 0 |
| Quantità MAG01 | 214 |
| Quantità NEG01 | 0 |
| Giacenze negative o `null` nelle 102 celle presenti | 0 |
| Movimenti di apertura | 102 |
| Movimenti successivi all'apertura | 0 |
| Articoli di packaging inventati/importati | 0 |

Le due ubicazioni prive di colonne quantitative nella fonte restano solo anagrafiche. Le quantità dei due magazzini presenti coincidono cella per cella con i valori salvati nell'Excel; non è stata eseguita una nuova conta fisica né una sincronizzazione delle quantità di Shopify.

Snapshot confrontato: SHA-256 `e8b84adc0e0ecd508a09a30740637f59866f9f40c88a79ae60c2520a43c1c22c`. File Excel sorgente registrato nello snapshot: SHA-256 `5f7d07251c74bba829004f2e83bba00d029b47f12699f3e040afc049fa69200e`.

## BudgetFlow

| Controllo | Risultato reale |
| --- | --- |
| Batch importati | 1 |
| Righe sorgente | 144 |
| Righe `unreviewed` | 144 |
| Righe `pending` | 1 |
| Date successive al 21 ottobre 2026 | 2 |
| Flag di data futura registrati | 2 |
| Differenze nei fingerprint raw ed economici, per riga | 0 su 144 |
| Hash del CSV e del payload normalizzato rispetto all'import verificato locale | Entrambi corrispondenti |
| Registrazioni contabili in `finance_entries` | 0 |

I fingerprint sono stati confrontati con il payload rigenerato in sola lettura dal CSV originale e dallo staging verificato. Il generatore controlla anche la corrispondenza dei 14 campi originali di ogni riga. Nessun importo, descrizione, conto, nota o altro contenuto Finance è incluso in questo report.

Queste sono righe sorgente da revisionare: non rappresentano saldi bancari, utile, vendite del gestionale o registrazioni contabili approvate. Nessuna tabella ordini era presente al momento del controllo; nessun ordine storico è stato importato.

## Accessi e autorizzazioni

- Tutte le 19 tabelle `public` presenti al momento del controllo hanno RLS attiva.
- `anon` e `PUBLIC` non hanno privilegi sulle tabelle `public`; una lettura effettiva di `stock_balances` con ruolo SQL `anon` viene negata con `42501`.
- Con ruolo SQL `authenticated` e nessuna identità utente, inventario, import Finance, audit e membership restituiscono tutti zero righe. Le funzioni di autorizzazione restituiscono `false`.
- Le tabelle di import Finance concedono ad `authenticated` soltanto `SELECT`, subordinato alla policy `private.can_finance()`.
- La funzione di importazione BudgetFlow non è eseguibile da `anon` né da `authenticated`. La RPC di rettifica scorte è revocata ad `anon` e concessa ad `authenticated`, con controllo membership nel corpo della funzione.
- Le funzioni Finance e audit usano la membership attiva nel database e richiedono `aal2`; Finance ammette founder e ruoli production/finance con `finance_access`, audit il founder. Nessuna decisione di ruolo deriva da `user_metadata`.
- Al momento della verifica non esistono profili né membership applicative. Non sono stati creati utenti per questo controllo.

Questi controlli SQL non sostituiscono una prova completa con utenti reali, JWT emessi da Auth, login, TOTP e revoca della membership. Tali prove richiedono il bootstrap degli account autorizzati.

## Advisors e migrazioni

Il Security Advisor non restituisce segnalazioni. Il Performance Advisor restituisce soltanto informazioni:

- 14 foreign key senza indice di copertura; [riferimento Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
- 3 indici mai usati nel progetto appena popolato; [riferimento Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). Non sono stati eliminati indici utili alle query future.

Cronologia cloud al momento della verifica: `20261021114636 initial_schema` e `20261021114642 finance_imports`. Il tool ha assegnato queste versioni cloud; i due file locali sono stati successivamente allineati agli stessi timestamp dal coordinatore. Le migrazioni già applicate vanno conservate e le successive modifiche effettuate con nuove migrazioni.

Documentazione corrente consultata: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [MFA](https://supabase.com/docs/guides/auth/auth-mfa) e [changelog](https://supabase.com/changelog). Gli avvisi recenti su cifrari TLS obsoleti e aggiornamento PostgreSQL 17.11 non cambiano l'esito di questi controlli in sola lettura.


## Aggiornamenti successivi nello stesso giorno

Dopo questa verifica iniziale sono stati predisposti i cinque account personali e applicate le migrazioni vendite e documenti privati, senza registrare ordini o alterare le 214 scorte. I tre originali Finance sono stati caricati e confrontati byte per byte. Le prove reali Auth/MFA/REST sono in `verifica-auth-cloud.md`; la registrazione vendite resta disabilitata e la data di avvio non impostata.
