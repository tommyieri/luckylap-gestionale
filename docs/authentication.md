# Accesso autenticato — prima integrazione

L’app mantiene due percorsi separati. `npm run dev` abilita l’anteprima locale soltanto in sviluppo e fuori da Vercel. In produzione l’anteprima è sempre disabilitata, anche se viene impostata la sua variabile. Senza configurazione Supabase, la pagina mostra il collegamento da completare e non carica l’inventario locale.

## Percorso di accesso

- `/auth/login` accetta email e password di un account già abilitato. Non esistono registrazione pubblica, invio di inviti o creazione di utenti nell’app.
- La Server Action autentica con Supabase Auth, verifica di nuovo `getUser()` e legge profilo e membership del medesimo utente sotto RLS. Una sessione Auth senza membership attiva non basta. I ruoli in `user_metadata` o `app_metadata` non autorizzano nulla.
- `/` ripete la verifica sul server prima di leggere prodotti, varianti, giacenze e provenienza dal database. Nessun fallback al JSON locale. Catalogo vuoto, relazioni incomplete, provenienza assente o pagina dati potenzialmente troncata impediscono il caricamento.
- `/auth/account` permette configurazione TOTP e verifica del codice. Le azioni verificano nuovamente membership e appartenenza del fattore prima di operare. `/finance` richiede il ruolo abilitato e `aal2` prima di leggere batch e movimenti sotto RLS; non importa file locali. Il controllo CEO richiede il ruolo founder e MFA; lo schema conserva il registro append-only.
- Il logout termina la sessione di questo browser (`scope: local`).

## Cookie, cache e richieste

`src/proxy.ts` copre `/`, `/auth/:path*`, `/finance/:path*`, `/team/:path*`, `/sales/:path*`, `/stock/:path*` e `/audit/:path*`, comprese le Server Actions sulle pagine di Auth. Aggiorna i cookie di sessione e applica sempre `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Pragma: no-cache` ed `Expires: 0`, riportando anche gli header di cache richiesti da `@supabase/ssr` quando scrive i cookie. Non usare cache CDN personalizzate su queste risposte.

L’autenticazione viene eseguita esclusivamente sul server: i cookie sono `HttpOnly`, `SameSite=Lax` e `Secure` in produzione. I Server Component hanno un client in sola lettura; solo le Server Actions optano esplicitamente per scrivere cookie. L’utility browser Supabase non è usata per autenticare gli utenti e non deve essere introdotta come alternativa senza rivedere questa architettura.

Le mutazioni di autenticazione usano Server Actions POST. Next.js 16.4.2 confronta Origin e Host/X-Forwarded-Host e rifiuta origini diverse; non abbiamo ampliato `serverActions.allowedOrigins`. Non esistono redirect forniti dall’utente. Gli errori restituiti al browser non espongono password, token o dettagli del database.

Riferimenti verificati: guide Next.js incluse nel pacchetto 16.4.2 (`authentication`, `data-security`, `proxy`, `cookies`) e documentazione ufficiale [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs), [sessioni SSR](https://supabase.com/docs/guides/auth/server-side/advanced-guide).

## Configurazione e limiti attuali

Servono soltanto `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`). Chiavi segrete e `service_role` sono rifiutate dalle utility dell’app. I permessi effettivi dipendono da RLS, non dalla segretezza della chiave pubblicabile.

Schema e inventario sono applicati, le registrazioni pubbliche sono disabilitate e i cinque account sono predisposti con ruoli nel database, senza password assegnate o inviti inviati. `/auth/confirm` e `/auth/password` implementano conferma esplicita di invito/recupero e scelta personale della password; configurazione email e verifica sul deploy restano distinte dalle prove API. Non esiste un limitatore in memoria dell’app; i limiti sono gestiti da Supabase Auth.

Il calendario, le attività e le note autenticati sono condivisi in `/team`; i dati locali dell’anteprima non vengono importati automaticamente. Finance offre lettura dei movimenti e degli originali, tutti da revisionare; non implementa approvazioni o scritture contabili automatiche. Le letture inventario rifiutano risultati di 1000 righe o più, per evitare troncamenti silenziosi del limite PostgREST: introdurre paginazione prima di superare questa soglia. Finance usa paginazione e conteggi esatti.

Test automatici coprono il rifiuto di membership inattive/non corrispondenti, i ruoli e il requisito `aal2`, validazione credenziali/configurazione, preservazione di zero/null e provenienza inventario. Le prove reali API/Auth/TOTP sono completate (52 controlli, account QA poi eliminato): `verifica-auth-cloud.md`. Restano distinte dalle prove dei cookie SSR, degli inviti e delle sessioni personali sul deploy; i test puri e PGlite non sostituiscono questi controlli.
