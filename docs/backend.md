# Backend Supabase LuckyLap — predisposizione v1

Schema e import sono applicati al progetto Supabase Free `annvatqnllkbrtufmgnl`. I cinque account personali sono predisposti senza password o email inviate. Inventario e Finance leggono dati reali sotto RLS; calendario, attività e note hanno una route condivisa `/team`. Login/JWT/TOTP/REST hanno superato 52 controlli reali con un account QA separato, poi eliminato. Stato infrastruttura e limiti in `docs/deployment.md`; verifica in `docs/verifica-auth-cloud.md`.

La migrazione `supabase/migrations/20261021114636_initial_schema.sql` crea lo schema, non utenti o dati finance. `supabase/inventory-initial.sql` è un import separato, già applicato una sola volta come owner dopo revisione. Deriva soltanto da `data/inventory-source.json`: 9 modelli, 51 SKU, 4 anagrafiche location, 102 quantità per MAG01/NEG01. I valori sono cache Excel; non certificano una conta fisica. Packaging resta vuoto, le location esterne non ricevono saldi inventati, uno zero rimane zero e una quantità sconosciuta rimane `NULL`.

## Dati e permessi

| Dati/azione | Accesso dell'app autenticata |
| --- | --- |
| Catalogo, prezzi, costi e margini, packaging, location, saldi e movimenti | Lettura per ogni membro attivo |
| Calendario, attività, note, metadati degli asset | Lettura e collaborazione per ogni membro attivo |
| Nome del proprio profilo | Aggiornamento del solo `display_name` |
| Ruolo, appartenenza, flag finance, configurazione e catalogo | Scrittura solo owner/amministrazione server futura; nessun grant ai client |
| Rettifiche stock | Ogni membro attivo, solo tramite `adjust_stock`, quando il flag è abilitato |
| Regole di sconto locali | Ogni membro attivo quando il flag è abilitato; nessun effetto su Shopify |
| Finance | Founder oppure ruolo production/finance con `finance_access=true`, sempre con sessione `aal2` |
| Audit | Soltanto founder attivo con sessione `aal2`; nessuna scrittura diretta dai client |
| Utente anonimo, autenticato senza membership, membership disattivata | Nessun dato operativo e nessuna scrittura |

I cinque ruoli sono `founder`, `production`, `logistics`, `finance`, `consultant`. La fonte dell'autorizzazione è `memberships`, interrogata nel database a ogni richiesta. Non si leggono ruoli da `user_metadata` o da campi profilo modificabili. Anche un account Auth creato accidentalmente senza invito non riceve accesso senza una membership attiva. La membership non si crea automaticamente all'iscrizione.

Il flag finance consente di limitare l'accesso esplicito a Gabriele (`production`) e Gherardo (`finance`), oltre al founder. Aggiungere un futuro membro production non gli concede automaticamente accesso finance. Il nome visualizzato non ha alcun effetto sui permessi.

Le impostazioni iniziali disabilitano rettifiche e sconti. La regola commerciale predisposta è maggiorazione conto vendita di **10 EUR**, quota brand **60%** e negozio **40%**. Non sono state introdotte ipotesi IVA, fiscali, contabili o calcoli di fatturazione. Il campo `margin_eur` è soltanto prezzo di listino meno costo unitario della fonte, senza imposte, commissioni o altri costi.

## Attivazione locale facoltativa

Supabase CLI, Docker e `psql` non erano installati durante la preparazione. Non sono stati installati e non è stato avviato un database Supabase. Per una prova locale successiva, installare prima Docker e la [CLI ufficiale](https://supabase.com/docs/guides/local-development/cli/getting-started). La configurazione del progetto è già in `supabase/config.toml`; non serve eseguire `supabase init` sullo stesso percorso.

```sh
npx supabase start
npx supabase db reset
```

`db reset` elimina e ricrea il database **locale**: usarlo solo su un ambiente di prova sacrificabile. Applica la migrazione, ma non importa automaticamente l'inventario perché il seed è disabilitato. Dopo la revisione del file, l'owner può applicare `supabase/inventory-initial.sql` nel SQL Editor locale oppure con `psql` contro l'indirizzo locale mostrato dalla CLI. L'intero import è una transazione e rifiuta un catalogo/registro già popolato. Non va usato per sovrascrivere saldi dopo l'avvio operativo.

Il generatore non si connette a servizi e permette di ricostruire il file dall'attuale snapshot:

```sh
node supabase/generate-inventory-import.mjs > supabase/inventory-initial.sql
```

Per una futura attivazione cloud, scegliere prima un progetto Supabase Free e verificarne i limiti correnti. La creazione del progetto e l'applicazione remota delle migrazioni richiedono una decisione successiva. Non eseguire `db push` prima di scegliere e verificare il progetto di destinazione.

## Bootstrap degli utenti e MFA

1. Disabilitare signup pubblici e accessi anonimi anche nel pannello Auth del progetto cloud; la configurazione locale già li disabilita. Non pubblicare un form di registrazione.
2. Invitare i membri con gli strumenti amministrativi Supabase. L'invito Auth richiede un amministratore fidato; non viene implementato nel browser. Usare UUID effettivi degli utenti invitati.
3. Nel SQL Editor come owner, inserire prima i profili e poi le membership. Non creare `auth.users` tramite SQL in produzione e non copiare identità o email di esempio come dati reali.
4. Assegnare al proprio UUID `founder`. Per Gabriele usare `production, finance_access=true`; per Gherardo `finance, finance_access=true`. Per gli altri ruoli lasciare `finance_access=false`.
5. Registrare e verificare un fattore MFA TOTP per i tre utenti autorizzati a Finance. La sessione deve raggiungere `aal2`; registrare soltanto il fattore senza completare la challenge non basta. Anche il founder ad `aal1` non legge Finance o Audit.
6. Verificare i casi della matrice seguente prima di inserire dati sensibili o abilitare scritture nell'app.

Esempio strutturale da completare manualmente con UUID reali, da eseguire soltanto come owner. I placeholder non sono UUID eseguibili:

```sql
begin;
insert into public.profiles(user_id, display_name)
values ('<UUID_FOUNDER>', '<NOME_FOUNDER>');
insert into public.memberships(user_id, role)
values ('<UUID_FOUNDER>', 'founder');
-- Ripetere con gli UUID invitati: Gabriele/production e Gherardo/finance,
-- impostando finance_access=true esclusivamente per questi due membri.
commit;
```

Non esiste una route per promuovere utenti. Il founder è un ruolo applicativo, non una chiave amministrativa del database: dal proprio client non può modificare membership o disabilitare l'audit. Gli interventi amministrativi passano dall'owner o da un futuro server amministrativo separato, mai da chiavi esposte nel frontend.

## Client e autenticazione nell'app

Copiare `.env.example` in `.env.local` e compilare soltanto URL di progetto e chiave pubblicabile `sb_publishable_...`. `.env.local` è ignorato da Git. I client rifiutano configurazione mancante, URL non valido o chiavi diverse da quelle pubblicabili. Per le chiavi locali, verificare nella versione CLI installata la disponibilità delle chiavi pubblicabili: questa predisposizione rifiuta anche la vecchia chiave anon JWT, senza ripiegare su credenziali amministrative.

- `createSupabaseBrowserClient()` in `src/lib/supabase/client.ts`: utility con chiave pubblicabile, non utilizzata per Auth nell'architettura attuale. I token Auth restano in cookie HttpOnly e non vengono letti dal browser JavaScript.
- `createSupabaseServerClient({ writable?: boolean })` in `src/lib/supabase/server.ts`: nuova istanza per richiesta, `await cookies()`, API `getAll/setAll`. I Server Component leggono soltanto; le Server Actions optano esplicitamente per scrivere cookie.
- `src/proxy.ts`: rinnova e restituisce i cookie, inoltra gli header richiesti dal SDK e impone `private, no-store` su tutte le pagine attuali dell'app e di Auth. Non aggiungere cache CDN su queste risposte.

Login/logout password, Proxy e configurazione/verifica TOTP sono implementati. Pagine e azioni verificano `auth.getUser()` e membership DB; `getSession()` e metadata utente non autorizzano accessi. Le Server Actions usano il controllo Origin/Host di Next.js, senza ampliare allowedOrigins. Mancano prove con sessioni reali, inviti/accettazione inviti, recupero password e verifica dei limiti di tentativi Auth. Le mutazioni operative condivise richiederanno la propria validazione e verifica d'accesso prima di collegarle all'interfaccia.

Non è presente alcun client `service_role`, chiave segreta, fallback amministrativo o endpoint per inviti. Le sessioni sono gestite attraverso `@supabase/ssr`; non è implementata una gestione token manuale. Non aggiungere `private` agli schemi esposti da PostgREST o al suo extra search path. Le funzioni privilegiate risiedono in `private`, hanno `search_path=''` e nomi tabella qualificati. L'unica RPC stock esposta è un wrapper `security invoker` che chiama una funzione privata con controlli espliciti sull'utente.

## Rettifiche e audit

La RPC `adjust_stock` accetta `p_operation_id` UUID, `p_stock_item_id`, `p_location_id`, `p_quantity_delta` intero e `p_reason` (3–500 caratteri dopo trim). Generare `operation_id` una volta per operazione logica e riutilizzarlo nei retry. La ripetizione da parte dello stesso utente con payload identico restituisce lo stesso movimento; riutilizzarlo con payload diverso viene rifiutato.

Un advisory lock transazionale serializza lo stesso identificativo. Il trigger prende un lock sulla riga saldo, controlla disponibilità e saldo non negativo e aggiorna saldo e registro nella stessa transazione. Un saldo sconosciuto non può essere rettificato come se fosse zero. La prima conta deve essere registrata come movimento `opening` dall'owner; i client possono inserire soltanto rettifiche attraverso la RPC. I saldi e i movimenti non hanno grant diretti di inserimento/aggiornamento/cancellazione per gli utenti app. Movimenti e audit rifiutano anche UPDATE/DELETE mediante trigger.

I trigger di audit registrano automaticamente autore, tabella, operazione, chiave e stato prima/dopo dei dati modificati. Non esiste una RPC di scrittura audit esposta. Gli snapshot audit possono contenere dati Finance e quindi l'intera tabella è riservata al founder ad `aal2`. Gli asset condivisi non sono una collocazione per documenti Finance; `finance_document_path` è nella tabella Finance protetta. Il bucket `finance-documents` è privato, con policy SELECT per Finance + MFA e documenti immutabili. I tre originali ricevuti sono stati caricati tramite Storage API e riscaricati per il confronto byte per byte. Non esistono link pubblici ai documenti.

Queste misure coprono escalation dal browser, abuso di ruoli nei metadati, signup senza appartenenza, scrittura stock senza registro, retry duplicati e lettura Finance/Audit da ruoli ordinari. Non proteggono da un owner/database administrator o da credenziali infrastrutturali compromesse: i ruoli privilegiati possono bypassare RLS o alterare schema/trigger. Backup, accesso al pannello, chiavi server e log infrastrutturali richiedono controlli operativi separati.

## Verifiche e limiti

`supabase/tests/validate-local.mjs` esegue la migrazione e l'import in PostgreSQL embedded PGlite, con schema Auth e claim **simulati**. PGlite è stato installato solo in `/tmp/luckylap-sql-validation`, fuori dalle dipendenze dell'app. Il comando usato è:

```sh
node supabase/tests/validate-local.mjs /tmp/luckylap-sql-validation/node_modules/@electric-sql/pglite/dist/index.js
```

Il test accetta come terzo argomento un percorso alternativo dello snapshot JSON, utile quando la copia nel workspace è temporaneamente offloaded da iCloud. L'ultima verifica della versione finale ha usato `/private/tmp/luckylap-inventory-source.json`, copia offline identica verificata, e ha completato tutti i 207 controlli.

Il test confronta tutte le 102 quantità con lo snapshot e controlla matrice ruoli/MFA, accesso anonimo e non membri, revoca membership, assenza di grant per promozioni/stock/audit, sconti abilitati/disabilitati e rettifiche con retry, causale e quantità non valide. I dati Finance creati dal test sono fixture sintetiche esclusivamente nel database in memoria, eliminato alla fine; non sono presenti nella migrazione o nell'import.

Eseguiti con esito positivo **207 controlli** PostgreSQL embedded e `npm run typecheck`. Questo controllo non sostituisce test runtime Supabase: non verifica emissione/validazione JWT, challenge TOTP, cookie SSR, inviti email, PostgREST/GraphQL, Storage, refresh sessione o concorrenza con più connessioni reali. Prima dell'attivazione eseguire almeno:

| Verifica con sessioni reali | Risultato atteso |
| --- | --- |
| Anonimo e account Auth senza membership | Nessun dato, RPC negata |
| Cinque ruoli attivi | Costi/margini e inventario visibili |
| Founder, Gabriele, Gherardo ad `aal1` | Finance e audit assenti |
| Founder, Gabriele, Gherardo ad `aal2` | Finance visibile; audit solo founder |
| Logistics, consultant, production senza flag, anche con `aal2` | Finance e audit assenti |
| Modifica di `user_metadata.role` | Nessuna variazione permessi |
| Modifica diretta di membership, saldi, movimenti e audit | Negata |
| Due rettifiche concorrenti, saldo al limite | Saldo coerente, nessun valore negativo |
| Due chiamate concorrenti con stesso `operation_id` | Un solo movimento e una sola variazione saldo |
| Disattivazione membership con token ancora valido | Accesso operativo revocato alla richiesta successiva |
| Login/logout, token scaduto e MFA nel browser reale | Cookie aggiornati, nessun contenuto sensibile in cache pubbliche |

Riferimenti primari consultati: [client SSR Supabase](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [RLS e MFA](https://supabase.com/docs/guides/database/postgres/row-level-security), [sicurezza delle funzioni SQL](https://supabase.com/docs/guides/database/functions), [funzioni private nelle policy](https://supabase.com/docs/guides/troubleshooting/do-i-need-to-expose-security-definer-functions-in-row-level-security-policies-iI0uOw).
