# Password delle aree riservate

La migrazione CLI `20261021133743_area_passwords.sql` aggiunge due password di area, `finance` e `audit` (CEO), mantenendo l’identità dei singoli account e le membership. Nessuna password viene inserita dalla migrazione. L’accesso usa la password dell’area e una concessione nel database per la sessione corrente; non richiede applicazioni di autenticazione o livello AAL2.

Finance è accessibile soltanto a founder oppure produzione/Finance con `finance_access` attivo. CEO è accessibile soltanto al founder. Membership e flag sono letti dal database; `user_metadata`, un ruolo dichiarato dal browser o AAL2 non concedono accesso.

## Contratto RPC

| Funzione | Ruolo SQL abilitato | Risultato |
| --- | --- | --- |
| `sensitive_area_status(p_area text)` | `authenticated` | Boolean: accesso valido per area, utente e sessione correnti. |
| `unlock_sensitive_area(p_area text, p_password text)` | `authenticated` | JSON con `status` e `expires_at`. |
| `lock_sensitive_area(p_area text)` | `authenticated` | Boolean; revoca soltanto il grant dell’area/sessione corrente. True anche se già assente, per utente eleggibile. |
| `configure_sensitive_password(p_area text, p_password text)` | `service_role` | Boolean true; configura o ruota la password. |

I soli valori area ammessi sono `finance` e `audit`. Per unlock, `status = unlocked` restituisce la scadenza del grant, otto ore dopo la verifica. `denied` restituisce `expires_at = null`; `locked` restituisce la fine del blocco temporaneo. Area, sessione o membership non valide producono false/denied, senza dettagli riservati. La password è confrontata esattamente, senza trim o normalizzazione; sono ammessi da 6 a 72 byte UTF-8.

Status, unlock e lock richiedono `auth.jwt().session_id` in formato UUID. Il helper privato `current_auth_session_id`, SECURITY DEFINER con search path vuoto, verifica inoltre la riga corrente in `auth.sessions`: stesso ID, stesso `auth.uid()` e `not_after` nullo oppure futuro. Cancellare o far scadere la sessione invalida l’area anche quando il vecchio access JWT è ancora formalmente valido. Nessuna tabella o policy dello schema Auth viene modificata.

La configurazione richiede sia il privilegio SQL `service_role` sia il claim JWT `role = service_role`; altrimenti fallisce con `42501 service_role_required`. Area o lunghezza password non valide danno `22023 invalid_area_password_configuration`. Il bootstrap locale umano deve chiamare questa RPC con parametri, senza mettere password in migrazioni, argomenti CLI, cronologia SQL o log. La chiave amministrativa rimane nel processo locale; non va in Vercel, variabili `NEXT_PUBLIC_*` o codice browser. La futura modifica della password da parte del founder avrà un flusso separato.

## Dati e protezioni

`private.sensitive_area_credentials` conserva solo area, hash bcrypt cost 10, UUID versione e data di rotazione. Usa `extensions.crypt` e `extensions.gen_salt('bf', 10)` del pgcrypto già installato nel progetto; il preflight verifica che le funzioni esistano. Non restituisce hash o versione alle RPC pubbliche.

`private.area_grants` lega `session_id`, `user_id`, area, versione della credenziale e scadenza. `private.area_password_attempts` conserva il contatore per utente/area, condiviso tra le sessioni dello stesso utente. Tutte le tabelle hanno RLS, nessuna policy client e nessun grant diretto a PUBLIC, anon, authenticated o service_role. Non hanno trigger nell’audit generale: password, hash e payload di controllo non finiscono in `audit_logs`.

Cinque errori in una finestra di quindici minuti causano un blocco di quindici minuti dal quinto errore. Durante il blocco anche la password corretta non sblocca; il blocco non viene prolungato da altri tentativi. Un successo azzera il contatore. Il risultato degli errori è JSON, non un’eccezione: così la transazione PostgREST conserva il contatore. Non esiste operation UUID per i tentativi: ogni invio è una nuova verifica.

Il contatore viene serializzato con lock di riga. Unlock prende prima un lock condiviso sulla credenziale, poi il lock del contatore; la rotazione aggiorna prima la credenziale, poi elimina tutti i grant e contatori dell’area. Il cambio di versione e la cancellazione invalidano anche gli sblocchi concorrenti della vecchia password. Le due aree rimangono indipendenti.

`private.can_finance()` e `private.can_audit()` ora richiamano questo stato; le policy e RPC esistenti che li usano continuano a proteggere i dati anche contro chiamate dirette alla Data API. Prima del bootstrap, entrambe le aree rimangono chiuse. Un grant ancora presente ma scaduto, associato a una sessione rimossa o a una versione precedente non autorizza l’accesso.

## Verifica eseguita

La suite `supabase/tests/area-passwords.mjs` ha superato **161 controlli su PostgreSQL 17.11 reale con pgcrypto reale**, usando soltanto dati sintetici e Auth/sessioni simulati. Il pgcrypto incluso in PGlite è stato anche verificato per la disponibilità di bcrypt cost 10, ma la prova principale usa processi PostgreSQL distinti.

```sh
node supabase/tests/area-passwords.mjs \
  /opt/homebrew/opt/postgresql@17/bin \
  /private/tmp/luckylap-pg17-client/node_modules/pg/lib/index.js
```

Sono verificati i cinque ruoli, outsider/inattivi/produzione senza flag, metadata e AAL senza bypass, RLS Finance esistente, sessioni separate, revoca della membership, sessioni cancellate/scadute/di un altro utente, scadenza del grant, rotazione/versione, limiti UTF-8, tentativi e cooldown, grant diretti negati, nessun secret nell’audit e configurazione riservata al service role.

La prova del 21 ottobre 2026, 13:36:39–13:36:43 UTC, ha usato tre backend reali: observer `18896`, A `18897`, B `18898`. Per due errori contemporanei dello stesso utente, B è stato osservato attivo in attesa Lock con A in `pg_blocking_pids`: il quarto errore è denied, il quinto locked e il contatore finale è 5. È stato osservato lo stesso blocco per rotazione contro unlock: dopo entrambi i commit, il grant della vecchia versione è invalido. Il cluster temporaneo è stato fermato e rimosso.

L’evidenza senza password/hash è in `.private/deployment-proof/area-passwords.json`, esclusa da Git e Vercel. La suite non accetta DSN esterni e non esegue operazioni cloud. La verifica JWT/PostgREST e logout Supabase reali dopo applicazione rimane separata. Riferimenti tecnici: [pgcrypto PostgreSQL 17](https://www.postgresql.org/docs/17/pgcrypto.html) e [funzioni Supabase](https://supabase.com/docs/guides/database/functions).
