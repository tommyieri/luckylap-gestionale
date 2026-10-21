# Verifica reale Auth, MFA e REST

Eseguita il **21 ottobre 2026, 14:16–14:17 Europe/Rome**, sul progetto Supabase `annvatqnllkbrtufmgnl`. **52 verifiche superate**, più un controllo indipendente finale della pulizia.

È stato creato un solo account QA temporaneo con indirizzo nel dominio `example.invalid`, password casuale e conferma amministrativa. Non sono stati usati o modificati i cinque account del team, non sono state inviate email o inviti. Profilo e membership temporanei sono stati variati serialmente per provare i permessi; le prove non hanno creato vendite, movimenti fisici, costi o righe Finance e non hanno modificato feature flag o cutover.

Sono stati usati l'SDK Supabase già installato e fissato dal progetto e chiamate HTTPS effettive ad Auth/PostgREST. Nessun mock JWT, ruolo Postgres simulato o sostituzione di MFA. Le chiavi amministrative sono rimaste lato server; password, access token, refresh token, seed TOTP, codici e QR non sono stati stampati né salvati nei risultati.

| Prova reale | Esito |
| --- | --- |
| Login con password, sessione iniziale aal1 e validazione server `getUser()` | Superata. |
| Founder, produzione, Finance, logistica e consulenza a aal1 | Stock operativo leggibile; Finance, metadati dei documenti Finance e audit restituiscono zero righe tramite RLS. |
| Enrollment TOTP, challenge e verifica con codice generato localmente secondo TOTP | Sessione reale aal2 ottenuta; livello confermato dall'SDK e JWT validato da Auth. |
| Founder, produzione e Finance a aal2 | Accesso alle righe Finance importate e ai tre documenti consentito secondo membership/grant. |
| Logistica e consulenza a aal2 | Finance e documenti restano inaccessibili. MFA da sola non concede il ruolo. |
| Produzione a aal2 senza `finance_access` | Finance resta inaccessibile. |
| Audit a aal2 | Visibile solo al founder; tutti gli altri ruoli ricevono zero righe. |
| Refresh della sessione MFA | Superato; nuova sessione aal2 validata da Auth. |
| Revoca membership con JWT già emesso e invariato | Stock, Finance e audit diventano immediatamente inaccessibili. `getUser()` continua a identificare l'account: autenticazione e autorizzazione applicativa sono distinte. |
| Logout `scope: local` | Sessione SDK rimossa e refresh token respinto dal server con HTTP 400, `refresh_token_not_found`. |
| Pulizia account QA | Membership, profilo e utente Auth eliminati nell'ordine; nessun errore FK e nessuna disattivazione di trigger. |

Le letture dei dati applicativi sono state richieste con `HEAD`, conteggio esatto e selezione dei soli identificativi, senza trasferire righe, descrizioni o contenuti Finance. Una lettura negata da RLS può restituire HTTP 200 con conteggio zero: il risultato non è stato interpretato come accesso consentito ai dati.

Il token osservato aveva durata di **3.600 secondi**. Il logout revoca il refresh della sessione, ma un access token già emesso può restare valido fino alla scadenza; qui il blocco immediato dei dati è stato provato revocando la membership corrente nel database. Non si afferma che il solo logout invalidi immediatamente tutti gli access token emessi.

Un secondo controllo server, dopo la pulizia, ha confermato HTTP 404 `user_not_found` per l'esatto UUID creato dalla prova e conteggio zero per quel medesimo UUID in `memberships` e `profiles`. Gli eventi audit append-only relativi al QA sono stati conservati. I risultati sanitizzati sono locali in `.private/qa-auth-result.json`, esclusi dal repository.

Questa verifica copre Auth, JWT, MFA e RLS attraverso il servizio REST reale. Non sostituisce le prove browser dei cookie SSR, reset password/inviti, schermate del gestionale, concorrenza vendite su più connessioni, download dei file o collegamento Shopify. Non attiva abbonamenti o flussi operativi.

Riferimenti: [MFA Supabase](https://supabase.com/docs/guides/auth/auth-mfa), [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
