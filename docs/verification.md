# Verifiche LuckyLap

Stato del 23 ottobre 2026, dal branch `claude/revisione-pre-invio` (P7, revisione prima dell'invio). Prove applicative, SQL sintetico, PostgreSQL concorrente e Auth cloud sono conteggiati separatamente. Le sezioni «Avvio del 21 ottobre 2026» restano come verbale dell'avvio: i numeri di allora non sono quelli di oggi.

## Test di oggi

Eseguiti il 23 ottobre 2026 nel worktree di P7, con dati sintetici e senza accessi al cloud.

| Comando | Esito |
| --- | --- |
| `npm test` | 1.468 test in 122 file, tutti superati |
| `npm run test:db` senza `LUCKYLAP_PG_BIN` | 15 harness PGlite superati, 2.904 controlli; i 6 harness su PostgreSQL 17 risultano saltati |
| `npm run test:db` con `LUCKYLAP_PG_BIN` (PostgreSQL 17.11 locale) | in più 6 harness PostgreSQL 17 superati, 939 controlli: 21 harness, 3.843 controlli in tutto |

`npm run typecheck`, `npm run build` e `npm run format:check` passano prima di ogni commit (regole in `AGENTS.md`). I cluster PostgreSQL usa e getta del runner si fermano e si cancellano alla fine; nessun servizio resta attivo.

Controlli per harness:

| Harness | Modalità | Controlli | Cosa prova |
| --- | --- | --- | --- |
| `validate-local.mjs` | PGlite | 207 | schema iniziale e inventario |
| `finance-imports.mjs` | PGlite | 152 | import Finance da BudgetFlow |
| `sales-ecosystem.mjs` | PGlite | 445 | vendite, riserve, produzione, consegna |
| `finance-documents.mjs` | PGlite | 25 | documenti Finance privati |
| `packaging-materials.mjs` | PGlite | 125 | scatole e adesivi |
| `packaging-automation.mjs` | PGlite | 73 | consumo automatico del packaging |
| `assets-development.mjs` | PGlite | 109 | contenuti del brand e sviluppo prodotti |
| `finance-work.mjs` | PGlite | 177 | registrazioni Finance manuali |
| `shopify-catalog.mjs` | PGlite | 103 | catalogo commerciale Shopify |
| `shopify-receiver.mjs` | PGlite | 163 | ricevitore delle notifiche Shopify |
| `shopify-scheduler.mjs` | PGlite | 173 | recupero ogni minuto (Cron, Vault e pg_net simulati) |
| `consignment.mjs` | PGlite | 145 | conto vendita precedente |
| `consignment-monthly.mjs` | PGlite | 613 | conto vendita semplice: negozi, conta, resoconto mensile, pagamenti, ordini |
| `partner.mjs` | PGlite | 343 | Partner: sicurezza, import della ricerca, comandi, file dei dispositivi, generatore |
| `review-handoff.mjs` | PGlite | 51 | archivio dei contenuti in «Grafica e foto» |
| `sales-concurrency.mjs` | PostgreSQL 17 | 39 | vendite concorrenti ([evidenze](verifica-concorrenza.md)) |
| `packaging-concurrency.mjs` | PostgreSQL 17 | 6 | packaging con worker sovrapposti |
| `area-passwords.mjs` | PostgreSQL 17 | 161 | password di Finance e Controllo CEO ([contratto](area-passwords-backend.md)) |
| `shopify-scheduler-concurrency.mjs` | PostgreSQL 17 | 15 | recupero Shopify con connessioni sovrapposte |
| `shopify-ecosystem.mjs` | PostgreSQL 17 | 702 | ordini Shopify, worker e coda |
| `consignment-concurrency.mjs` | PostgreSQL 17 | 16 | conto vendita con comandi concorrenti |

Auth è simulato in tutti gli harness: questi controlli non sostituiscono le prove su Auth cloud. In CI il job «Concorrenza (PostgreSQL 17)» esegue anche i sei harness su PostgreSQL reale.

## Produzione, 22 ottobre 2026

Procedura per ogni migrazione (piano di lavoro, §1.3): impronte in sola lettura prima, applicazione con il testo esatto del file, rinomina del file alla versione assegnata dal cloud, impronte di nuovo.

| Migrazione | Versione cloud | Testo salvato |
| --- | --- | --- |
| `consignment_monthly` (Conto vendita) | `20261022215046` | uguale al file, md5 `e8034a44547da0dffd076cb383e05fa6` |
| `partner_module` (Partner) | `20261022215908` | uguale al file, md5 `c4326206389828d3fbef17e2a2ebc70e` |

- Impronte delle tabelle di magazzino (giacenze, movimenti, sedi) identiche prima e dopo entrambe le migrazioni. Per il conto vendita anche `packaging_consumptions` e le tabelle del conto vendita precedente; `consignment_shops` ha la riga di NEG01, non ancora contato ([dettagli](consignment.md), «Produzione»).
- Import della ricerca Partner il 22 ottobre 2026, dal commit `f6ad90c`: 207 contatti; 119 Vendita, 80 Eventi, 73 Collab; 218 varianti; recapiti attivi 165 email, 148 telefoni, 170 Instagram, 143 moduli, 19 pagine brand, 205 siti; 49 contatti nel periodo 1; zero differenze aperte; zero righe di audit con email o recapiti. Import `e471ff5e-d63e-4a58-8793-2bfa0991aee2`, SHA-256 normalizzato `49bc4bc3f870012a1e4dde3c9c25260354eaecd73b92469429211ea89055d68d` ([dettagli](partner.md), «Esiti in produzione»).
- La sede centrale `MAG01` resta «Magadzino»: è il nome voluto dal founder e nessuna migrazione lo cambia.

Ancora da fare per P7, prima del merge, in quest'ordine:

1. Rebase di questo branch su `origin/main`, poi CI di nuovo verde. La pull request #3 di Codex è su `main` dal 23 ottobre (merge `b24690f`) e porta quattro migrazioni più recenti di `20261022220100_archivio_contenuti.sql`, fino a `20261023091633_shop_payment_finance.sql`. Il rebase viene **prima** della migrazione: il piano (§1.3, passo 2) vuole che l'ultima versione in cloud sia l'ultima del repository, e senza rebase non può esserlo. Tra le migrazioni non c'è dipendenza: quelle della pull request #3 non toccano `assets` né le funzioni usate dall'archivio.
2. La parte B, qui sotto.
3. Applicare in produzione `archivio_contenuti`, con impronta di `assets` prima e dopo. Il file prende la versione cloud, che sarà successiva a `20261023091633`, e la tabella «Produzione» qui sopra riceve la sua riga ([archivio](assets-development.md), «Archivio dei contenuti»).
4. Prove visive della parte B a 1280 e 390 px (piano di lavoro, §1.4); quelle della parte A sono in «Prove visive della parte A».
5. CI verde, compreso il job «Concorrenza (PostgreSQL 17)».

Parte B: file che sono anche nella pull request #3, da toccare solo dopo il rebase.

- `sales-workspace.tsx`: passare `names` (articolo, ordine, riga) a `SalesPendingRecovery` e ai cinque `SalesCommandForm`. Oggi un invio da verificare dice «Riga 1» al posto dell'articolo, e «Ordine» con 8 caratteri del codice anche per gli ordini che nell'elenco hanno il loro riferimento (06 R4; i componenti accettano già `names`).
- `sales-workspace.tsx`, testi di 06 R10: «N capi · N fabbisogni», «I fatti osservati non equivalgono…», «Origine tecnica…», «Valore / costo / margine iniziali». Poi togliere le due voci di `KNOWN_LEFTOVERS` in `src/lib/ui-copy.test.ts`.
- «Chiudi Finance» in `/finance` e «Chiudi» in Controllo CEO (06 R12). Oggi Finance si chiude solo da «Account e sicurezza» e da `/auth/area/finance`.
- Riquadro «Prima volta qui?» su Oggi (`today-sheet.tsx`).
- Calendario: all'inizio solo gli appuntamenti futuri, con «N passati nascosti» (06 R16, `team-workspace.tsx`).
- Feed di Controllo CEO: la frase per l'archivio dei contenuti. Oggi un'archiviazione si leggerebbe «ha aggiornato un contenuto».
- `AGENTS.md`, «Decisioni del founder»: Finance modificabile e Controllo CEO come feed sono fatti; la frase sull'immutabilità diventa quella di 04 §4.

Nota per la pull request: in `AGENTS.md` P7 cambia anche una parola fuori da «Decisioni del founder», nella sezione dei test: «i cinque harness» diventa «gli harness». Gli harness su PostgreSQL 17 oggi sono sei, e con la pull request #3 sono di più.

Finance modificabile, collegamenti Partner e Oggi completo, Controllo CEO come feed (P4–P6) sono su `main` dalla pull request #3, ma questo branch non li contiene ancora: le loro migrazioni e i loro test non fanno parte di questi numeri.

## Prove visive della parte A

Anteprima locale (`npm run dev`, dati sintetici), a 1280 × 800 e 390 × 844, il 23 ottobre 2026. In ogni pagina: nessuno scorrimento orizzontale, nessun testo sotto 12 px, bersagli da almeno 44 px sul telefono.

- `/guida`: otto parti, indice a destra sul computer e su due colonne in cima sul telefono, «Le operazioni più comuni» con link e pulsanti veri.
- `/auth/account`: ha il ramo dell'anteprima (account sintetico, aree chiuse, nessuna scrittura).
- Invio da verificare: `/sales`, `/stock/rettifiche`, `/packaging` e `/finance/work` non hanno un ramo dell'anteprima (non sono pagine nuove: piano di lavoro, §1.5). La prova si fa con una pagina temporanea, mai committata e cancellata subito dopo, che monta il vero `SalesCommandForm` con un tentativo illeggibile messo a mano in `sessionStorage` (chiave `luckylap.sales.pending:<utente>:new-sale`) e i casi di `PendingAttempt`. Esito: data italiana, codice nascosto in «Codice per l’assistenza»; un tentativo bloccato non mostra «Verifica lo stesso invio» e ha «Scarta questo tentativo» come azione principale; dopo «Sì, scarta il tentativo» la chiave sparisce da `sessionStorage` e il riquadro si chiude. Il resto lo coprono i test dei componenti (`sales-command-form`, `sales-pending-recovery`, `stock-adjustment-form`, `packaging-workspace`, `finance-work-form`).

## Avvio del 21 ottobre 2026

### Dati reali

Supabase Free `annvatqnllkbrtufmgnl`: dodici migrazioni applicate. Inventario confrontato su tutte le 102 celle: 9 prodotti, 51 SKU, 214 capi centrali e zero nel negozio. Il founder conferma nessun nuovo movimento dall’avvio. Catalogo Shopify completo: 60 varianti attive, 51 SKU fisici mappati e 9 sticker retail separati, prezzi coerenti; nessuna quantità commerciale utilizzata come stock fisico.

BudgetFlow: 144 righe non revisionate, un pending e due date future. Tre documenti Finance e sei grafiche originali scaricati dallo Storage privato e confrontati per dimensioni, byte e SHA-256. Nessun costo attuale, scrittura approvata o vendita ricavato automaticamente dagli allegati. Drive, Shopify e repository Partner non modificati. Nessun abbonamento o trial attivato.

Ultima verifica cloud dopo la pulizia dei test: cinque membership reali, 214 capi, zero ordini, zero movimenti successivi all’apertura, zero registrazioni Finance manuali e zero operazioni conto vendita. Le credenziali sintetiche delle aree e tutti gli account QA sono stati eliminati.

### Applicazione e SQL

**724 test applicativi su 60 file, TypeScript e build Next.js completati**, inclusa compilazione TypeScript. Coprono inventario, Auth, team, audit, vendite, packaging, documenti, lavoro Finance, contenuti, sviluppo, ricevitore Shopify e conto vendita. Le pagine riservate sono dinamiche.

**1.651 controlli SQL sintetici PGlite**: schema/inventario 207, import Finance 152, vendite 445, documenti Finance 25, packaging 125, contenuti/sviluppo 109, lavoro Finance 177, catalogo Shopify 103, ricevitore Shopify 163, conto vendita 145. Auth è simulato in questi harness; questi controlli non dimostrano la concorrenza reale.

Su **PostgreSQL 17.11 reale**, processi e connessioni distinte:

- **39 controlli, sette casi concorrenti**: ultimo capo venduto una volta, UUID ripetuto senza duplicati, riserve e deficit coerenti, rettifica contro riserva, rollback e rilascio dei lock. [Evidenze](verifica-concorrenza.md).
- **161 controlli delle password di area**: sessioni reali/assenti/scadute, ruoli, nessun bypass AAL2, blocco dei tentativi concorrenti e invalidazione dei grant dopo rotazione. Cluster temporanei fermati e rimossi, nessun servizio persistente. [Contratto e prove](area-passwords-backend.md).

### Auth e isolamento cloud

**248 controlli reali Auth/REST/Storage** sul nuovo modello con password di area: sette ruoli/scenari, Finance solo per i tre ruoli autorizzati, CEO solo founder, configurazione negata ai client, documenti privati, seconda sessione dello stesso utente ancora bloccata, revoca membership immediata e grant inutilizzabile dopo logout anche con il vecchio JWT. Nessuna scrittura operativa di prova. I sette account QA sono stati cancellati e l’assenza verificata.

I precedenti 52 controlli TOTP in `verifica-auth-cloud.md` documentano il modello storico, sostituito su richiesta del founder. L’app attuale non richiede un autenticatore per Finance/CEO. Il founder ha poi configurato personalmente le tre password; cinque identità confermate, due aree configurate e nuovo login reale verificati. Nessun valore è stato letto o conservato dall’assistente.

Registrazione pubblica disabilitata, redirect Auth limitati al dominio LuckyLap. Nessuna chiave privata nel repository o frontend. Le credenziali tecniche del worker sono riservate al server Vercel di produzione; gli accessi del team usano sessione e RLS. RLS, ruolo e membership correnti restano obbligatori anche conoscendo la password di un’area. Le tabelle private senza policy client sono intenzionalmente non accessibili. Il controllo password compromesse non è stato attivato con un upgrade.

### Interfaccia e pubblicazione

QA con fixture sintetiche a 1280 e 390 px: inventario, Finance import, team/calendario, audit, vendite, rettifiche stock, packaging, contenuti, sviluppo e lavoro Finance. Round aggiuntivo: conto vendita desktop/mobile, proiezione Finance, password Finance mobile e account desktop. Nessun overflow orizzontale mobile, scala 1. Una vecchia cache dev rendeva il server Finance precedente al client: riavvio del solo dev server e verifica SSR/client hanno risolto, senza cambi ai sorgenti. Nessun nuovo errore console dopo il riavvio. Route QA rimosse con verifica 404.

Impeccable e UI UX Pro Max usati per la direzione visiva. Il detector Impeccable è stato eseguito una volta senza risultati. La prima finish review non sostituisce i controlli multiutente successivi.

Sorgenti nel workspace; esecuzione e build nella copia esplicita `/private/tmp/luckylap-preview-01a15dda` per evitare i file dataless di Documents. Nessun nuovo accesso Drive per aggirare il problema.

Destinazione: team Vercel LuckyLap, progetto `luckylap`, https://luckylap.vercel.app. Commit `f7b18cd` pubblicato: stato READY, alias, login anonimo senza dati e cache privata verificati. Vendite, sconti e rettifiche attivati con cutover `2026-10-21T14:06:47.976341+00:00`; nessuna vendita reale inserita. Verificati nel browser il registro attivo con 214 capi, i sei originali grafici caricati e il redirect di Finance al proprio gate per la sessione ancora bloccata. App Shopify installata, grant verificato e segreti server configurati. Reader, worker e interfaccia sono pubblicati; configurazione attiva, sei webhook riconfermati senza duplicati e scheduler ogni minuto con prime consegne reali HTTP 200. Worker autorizzato 200 con coda vuota; bearer/HMAC errati 401, payload firmato invalido 400 senza inserimenti. Zero ordini nella finestra del cutover. Non è stata simulata una vendita in produzione; la prova con un primo ordine reale rimane distinta dai test sintetici locali. Il backend ha superato 702 controlli su PostgreSQL reale, inclusi 445 controlli manuali preesistenti, 256 nuovi e una conferma di regressione. Le 102 celle cloud corrispondono esattamente all’apertura Drive, con 214 capi e zero ordini nello snapshot indipendente delle 14:46 UTC. [Verifica cloud Shopify](verifica-shopify-cloud.md). [Stato cloud](deployment.md).

Scheduler: 173 controlli SQL con Cron/Vault/pg_net stand-in, più 15 controlli di concorrenza su PostgreSQL 17 reale e quattro contese osservate tra backend. Questi test non sono una prova di consegna HTTP; quest’ultima è stata poi verificata separatamente sul cloud (Cron succeeded e pg_net HTTP 200). [Worker e limiti](shopify-worker.md), [confine pg_net](verifica-pg-net.md).

Verifica visuale del deploy `f7b18cd` nella sessione reale del founder: Vendite mostra collegamento Shopify «Attivo», 214 capi pronti, zero riserve/fabbisogni/ordini e una sola sede selezionabile per le vendite manuali, Magadzino. Nessun invio commerciale di prova. Screenshot conservato soltanto tra le evidenze locali private.

[Verifica indipendente del collegamento live](verifica-shopify-live.md): dettagli delle 102 celle, permessi, conteggi e recupero dopo le risposte transitorie.
