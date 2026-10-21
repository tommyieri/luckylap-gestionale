# Accesso del team e password delle aree

L’app mantiene due percorsi separati. `npm run dev` abilita l’anteprima locale soltanto in sviluppo e fuori da Vercel. In produzione l’anteprima è sempre disabilitata, anche se viene impostata la sua variabile. Senza configurazione Supabase, la pagina mostra il collegamento da completare e non carica l’inventario locale.

## Percorso di accesso

- `/auth/login` accetta l’email personale del collaboratore e la password del workspace condivisa dai cinque membri. Il modello richiesto usa una password base di sei caratteri; la validazione ammette almeno 6 caratteri e massimo 72 byte UTF-8 senza alterare il valore. Le cinque identità restano separate per attribuire attività e permessi. Non esistono registrazione pubblica, invio di inviti o creazione di utenti nell’app.
- La Server Action autentica con Supabase Auth, verifica di nuovo `getUser()` e legge profilo e membership del medesimo utente sotto RLS. Una sessione Auth senza membership attiva non basta. I ruoli in `user_metadata` o `app_metadata` non autorizzano nulla.
- `/` ripete la verifica sul server prima di leggere prodotti, varianti, giacenze e provenienza dal database. Nessun fallback al JSON locale. Catalogo vuoto, relazioni incomplete, provenienza assente o pagina dati potenzialmente troncata impediscono il caricamento.
- `/auth/account` mostra le aree ammesse dal ruolo e il loro stato corrente; permette apertura e chiusura per questa sessione. Non offre configurazione di app di autenticazione.
- `/auth/area/finance` richiede la password aggiuntiva Finance, condivisa da Tommi, Gabriele e Gherardo; il ruolo DB deve comunque essere founder oppure production/finance con flag Finance attivo. `/auth/area/audit` richiede la password CEO scelta da Tommi e accetta soltanto il founder. Ogni area ha una password distinta da quella del workspace.
- L’apertura è registrata nel database per utente, sessione Auth e area, fino a otto ore. `sensitive_area_status` controlla lo stato corrente; non vengono memorizzati flag di sblocco in cookie applicativi, localStorage, React context o metadata utente. AAL/MFA non apre queste aree e non sostituisce la loro password. `lock_sensitive_area` chiude soltanto l’area nella sessione corrente.
- Il logout termina la sessione di questo browser (`scope: local`).

## Cookie, cache e richieste

`src/proxy.ts` copre `/`, `/auth/:path*`, `/finance/:path*`, `/team/:path*`, `/sales/:path*`, `/stock/:path*` e `/audit/:path*`, comprese le Server Actions sulle pagine di Auth. Aggiorna i cookie di sessione e applica sempre `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Pragma: no-cache` ed `Expires: 0`, riportando anche gli header di cache richiesti da `@supabase/ssr` quando scrive i cookie. Non usare cache CDN personalizzate su queste risposte.

L’autenticazione viene eseguita esclusivamente sul server: i cookie sono `HttpOnly`, `SameSite=Lax` e `Secure` in produzione. I Server Component hanno un client in sola lettura; solo le Server Actions optano esplicitamente per scrivere cookie. L’utility browser Supabase non è usata per autenticare gli utenti e non deve essere introdotta come alternativa senza rivedere questa architettura.

Le mutazioni di autenticazione usano Server Actions POST. Next.js 16.4.2 confronta Origin e Host/X-Forwarded-Host e rifiuta origini diverse; non abbiamo ampliato `serverActions.allowedOrigins`. Non esistono redirect forniti dall’utente. Gli errori restituiti al browser non espongono password, token o dettagli del database.

Riferimenti verificati: guide Next.js incluse nel pacchetto 16.4.2 (`authentication`, `data-security`, `proxy`, `cookies`) e documentazione ufficiale [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs), [sessioni SSR](https://supabase.com/docs/guides/auth/server-side/advanced-guide).

## Configurazione e limiti attuali

Per accesso del team e aree servono soltanto `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`). Chiavi segrete e `service_role` sono rifiutate dalle utility delle sessioni utente. La configurazione amministrativa delle password avviene separatamente dal frontend; le password Finance/CEO sono verificate dal database e non diventano variabili Vercel. Il receiver Shopify usa un client tecnico server distinto, descritto in `shopify-receiver.md`, che non autorizza gli utenti nelle aree riservate.

Schema e inventario sono applicati, le registrazioni pubbliche sono disabilitate e i cinque account hanno ruoli nel database. Il 21 ottobre 2026 alle 14:04:51 UTC il titolare ha completato personalmente la configurazione: password operativa comune sulle cinque identità confermate, password Finance e password CEO distinte. Nessuna password conservata in file o log e nessuna email inviata. Accesso reale del founder successivamente verificato sul deploy. `/auth/confirm` e `/auth/password` mantengono conferma esplicita di invito/recupero e aggiornamento del solo account corrente. Eventuali fattori TOTP già configurati rimangono protetti durante il cambio password tramite `/auth/verify`; non viene proposto nuovo enrollment e non sono richiesti per Finance/CEO.

Le Server Actions dei gate verificano nuovamente `getUser()` e membership prima delle RPC. Area e destinazioni sono un’allowlist fissa: Finance torna a `/finance`, CEO a `/audit`; nessun `next` o URL inviato dall’utente. Password e dettagli degli errori DB non vengono restituiti. Il campo password viene svuotato dopo la risposta e non viene salvato nello storage del browser. Tentativi falliti e blocco temporaneo sono gestiti atomicamente dal database; non da un contatore in memoria Vercel.

Il calendario, le attività e le note autenticati sono condivisi in `/team`; i dati locali dell’anteprima non vengono importati automaticamente. Finance offre fonti importate, originali e registro manuale, oltre ai fatti delle vendite e ai crediti/regolamenti conto vendita, senza contabilizzazione fiscale o saldi bancari inventati. Fonti e fatti diversi non vengono sommati duplicandoli. Le letture private richiedono il grant Finance attuale e usano RLS, paginazione e conteggi esatti; il registro CEO richiede il proprio grant.

Test automatici coprono membership inattive/non corrispondenti, ruoli, password da sei caratteri e limite UTF-8, grant DB riletto senza cache, rifiuto di `aal2` come bypass, apertura/chiusura, errori riservati, download Finance e preservazione dei retry incerti dopo revoca. Le precedenti 52 prove API/Auth/TOTP in `verifica-auth-cloud.md` documentano la prima implementazione, non il modello attuale. Le prove DB dei nuovi gate e la verifica delle sessioni sul deploy sono distinte dai test unitari con Auth simulato.
