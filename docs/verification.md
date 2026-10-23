# Verifiche LuckyLap

Stato del 23 ottobre 2026, dal branch `claude/revisione-pre-invio` (P7, revisione prima dell'invio). Il branch contiene la parte A, il merge di `origin/main` a `b24690f` (commit `5af0f1a`: la pull request #3 di Codex, cioè P4 Finance modificabile, P5 collegamenti e Oggi, P6 feed di Controllo CEO) e la parte B fino alla guida e ai documenti. Da allora `origin/main` è andato avanti a `3acbad3`, con due pull request che questo branch non contiene ancora:

- **#6** di Codex (`da96128`, «Finance: movimenti più leggibili»): solo `finance-imports-view.tsx`, il suo test e `finance.module.css`, che P7 non tocca.
- **#7** di un'altra sessione Claude (`claude/calendario-partecipiamo`, merge `3acbad3` alle 11:36 UTC): calendario del Team a mese, che sostituisce la lista con «Mostra anche passati»; lo stato Partner `chiuso` si chiama «Accordo fatto»; le date Partner entrano nel calendario solo con «Accordo fatto», con la migrazione `20261023113212_partner_dates_only_agreed.sql`, già applicata in produzione con questa versione cloud. Tocca nove file che anche questo branch cambia: `README.md`, `docs/README.md`, `docs/partner.md`, `docs/team-workspace.md`, `docs/workspace-layout.md`, `src/components/team-workspace.tsx`, `team-workspace.module.css`, `team-workspace.test.tsx` e `supabase/tests/finance-ecosystem-integration.mjs`.

Prove applicative, SQL sintetico, PostgreSQL concorrente e Auth cloud sono conteggiati separatamente. Le sezioni «Avvio del 21 ottobre 2026» restano come verbale dell'avvio: i numeri di allora non sono quelli di oggi.

## Test di oggi

Eseguiti il 23 ottobre 2026 nel worktree di P7, dopo il merge di `origin/main` a `3acbad3` (pull request #6 e #7), con dati sintetici e senza accessi al cloud.

| Comando | Esito |
| --- | --- |
| `npm test` | 1.680 test in 159 file, tutti superati |
| `npm run test:db` senza `LUCKYLAP_PG_BIN` | 18 harness PGlite superati, 3.094 controlli; gli 11 harness su PostgreSQL 17 risultano saltati |
| `npm run test:db` con `LUCKYLAP_PG_BIN` (PostgreSQL 17.11 locale) | in più 11 harness PostgreSQL 17 superati, 1.302 controlli: 29 harness, 4.396 controlli in tutto |

`npm run typecheck`, `npm run build` e `npm run format:check` passano prima di ogni commit (regole in `AGENTS.md`). Ogni harness ha eseguito esattamente il suo minimo. I cluster PostgreSQL usa e getta del runner si fermano e si cancellano alla fine; nessun servizio resta attivo.

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
| `finance-revisions.mjs` | PGlite | 72 | revisioni Finance: fonti immutabili, versioni, eliminazione e ripristino, permessi |
| `partner-work-links.mjs` | PGlite | 42 | solleciti dopo l'invio, date Partner nel calendario, riquadro Partner di Oggi |
| `partner.mjs` | PGlite | 343 | Partner: sicurezza, import della ricerca, comandi, file dei dispositivi, generatore |
| `review-handoff.mjs` | PGlite | 51 | archivio dei contenuti in «Grafica e foto» |
| `partner-dates-agreed.mjs` | PGlite | 76 | date Partner nel calendario solo con «Accordo fatto», pulizia degli appuntamenti automatici |
| `sales-concurrency.mjs` | PostgreSQL 17 | 39 | vendite concorrenti ([evidenze](verifica-concorrenza.md)) |
| `packaging-concurrency.mjs` | PostgreSQL 17 | 6 | packaging con worker sovrapposti |
| `area-passwords.mjs` | PostgreSQL 17 | 161 | password di Finance e Controllo CEO ([contratto](area-passwords-backend.md)) |
| `shopify-scheduler-concurrency.mjs` | PostgreSQL 17 | 15 | recupero Shopify con connessioni sovrapposte |
| `shopify-ecosystem.mjs` | PostgreSQL 17 | 702 | ordini Shopify, worker e coda |
| `ceo-activity-feed.mjs` | PostgreSQL 17 | 121 | feed di Controllo CEO con la password CEO vera |
| `consignment-concurrency.mjs` | PostgreSQL 17 | 16 | conto vendita con comandi concorrenti |
| `finance-ecosystem-integration.mjs` | PostgreSQL 17 | 95 | catena completa delle migrazioni: Shopify, residui, conto vendita, feed, Partner |
| `finance-revisions-concurrency.mjs` | PostgreSQL 17 | 32 | revisioni Finance concorrenti |
| `partner-work-concurrency.mjs` | PostgreSQL 17 | 82 | collegamenti Partner e solleciti concorrenti |
| `shop-payment-finance-concurrency.mjs` | PostgreSQL 17 | 33 | pagamenti dei negozi corretti da Finance, concorrenti |

Auth è simulato in tutti gli harness: questi controlli non sostituiscono le prove su Auth cloud. In CI il job «Concorrenza (PostgreSQL 17)» esegue anche gli undici harness su PostgreSQL reale.

## Produzione, 22 ottobre 2026

Procedura per ogni migrazione (piano di lavoro, §1.3): impronte in sola lettura prima, applicazione con il testo esatto del file, rinomina del file alla versione assegnata dal cloud, impronte di nuovo.

| Migrazione | Versione cloud | Testo salvato |
| --- | --- | --- |
| `consignment_monthly` (Conto vendita) | `20261022215046` | uguale al file, md5 `e8034a44547da0dffd076cb383e05fa6` |
| `partner_module` (Partner) | `20261022215908` | uguale al file, md5 `c4326206389828d3fbef17e2a2ebc70e` |

- Impronte delle tabelle di magazzino (giacenze, movimenti, sedi) identiche prima e dopo entrambe le migrazioni. Per il conto vendita anche `packaging_consumptions` e le tabelle del conto vendita precedente; `consignment_shops` ha la riga di NEG01, non ancora contato ([dettagli](consignment.md), «Produzione»).
- Import della ricerca Partner il 22 ottobre 2026, dal commit `f6ad90c`: 207 contatti; 119 Vendita, 80 Eventi, 73 Collab; 218 varianti; recapiti attivi 165 email, 148 telefoni, 170 Instagram, 143 moduli, 19 pagine brand, 205 siti; 49 contatti nel periodo 1; zero differenze aperte; zero righe di audit con email o recapiti. Import `e471ff5e-d63e-4a58-8793-2bfa0991aee2`, SHA-256 normalizzato `49bc4bc3f870012a1e4dde3c9c25260354eaecd73b92469429211ea89055d68d` ([dettagli](partner.md), «Esiti in produzione»).
- La sede centrale `MAG01` resta «Magadzino»: è il nome voluto dal founder e nessuna migrazione lo cambia.

## Produzione, 23 ottobre 2026: P4–P6

Codex ha applicato le quattro migrazioni della pull request #3 il 23 ottobre 2026 alle 09:16 UTC, dopo l'OK di Tommi. I file del repository hanno i nomi delle versioni cloud.

| Migrazione | Versione cloud |
| --- | --- |
| `ceo_activity_feed` (P6, feed di Controllo CEO) | `20261023091605` |
| `finance_revisions` (P4, revisioni Finance) | `20261023091616` |
| `partner_work_links` (P5, solleciti, date e collegamenti Partner) | `20261023091627` |
| `shop_payment_finance` (P4, pagamenti dei negozi in Finance) | `20261023091633` |

Dopo le quattro migrazioni:

- l'impronta del magazzino (md5 `b0221490182f06a20df8875a4310713f`) e i 104 movimenti di magazzino sono invariati;
- i contatti Partner sono ancora 207;
- `finance_movement_revisions` ha zero righe: nessuna correzione Finance è stata fatta;
- le sole righe nuove sono 54 appuntamenti del calendario e 54 righe di `partner_work_links`, create dal riporto delle date Partner, con le loro 108 righe di audit.

Più tardi, lo stesso giorno, la migrazione della pull request #7 (`20261023113212_partner_dates_only_agreed`) ha tolto in produzione i 54 appuntamenti automatici delle schede senza «Accordo fatto»; restano i 3 eventi inseriti a mano (esiti nel `docs/partner.md` di `main`, «Accordo fatto e calendario»). Oggi l'ultima versione in cloud è `20261023113212`.

## Produzione, 23 ottobre 2026: P7

| Migrazione | Versione cloud | Testo salvato |
| --- | --- | --- |
| `archivio_contenuti` (archivio di Grafica e foto) | `20261023115001` | uguale al file, md5 `249f4b462c330c8e2f6f7cf3ac42882f` |

Prima e dopo: 6 contenuti, impronta delle colonne esistenti di `assets` identica (md5 `24b6a3fe4394d1da6b2bc7321b116fe9`), nessun contenuto archiviato. `set_brand_asset_archived` è `security definer` con `search_path` vuoto; la esegue `authenticated`, non `anon`. Avvisi di sicurezza: solo quelli informativi già noti.

## Revisione prima dell'invio (P7): fatto e da fare

Parte A (prima del merge di P4–P6): guida «Come si usa» in `ACCOUNT_LINKS`, «Magadzino» rimesso dove era stato cambiato, migrazione dell'archivio dei contenuti (`20261023115001_archivio_contenuti.sql`, applicata in produzione il 23 ottobre), «Invio da verificare» con `pending-attempt.tsx` nei moduli manuali di Vendite, Rettifiche, Packaging e Finance, testi senza gergo, guardia `ui-copy.test.ts`. Poi il merge di `origin/main` a `b24690f` (`5af0f1a`) al posto del rebase previsto: stesso risultato, nessun commit riscritto.

Parte B, fatto (ogni commit con tutti i controlli verdi):

- Oggi: riquadro «Prima volta qui?» verso «Come si usa» (`a3ef382`).
- «Chiudi Finance» in cima a tutte le pagine Finance e «Chiudi Controllo CEO» in `/audit`, solo dopo la verifica dell'area aperta (`beffa36`).
- Calendario del Team: all'inizio solo i prossimi, con «N passati nascosti» (`1727c02`). Superato dal calendario a mese della pull request #7: nel merge di `main` vale la griglia del mese.
- Vendite: gli invii da verificare dicono ordine e articolo, testi senza gergo, guardia dei testi completa (`42a5d09`, `bbbbb9e`); «eliminata» negli invii Finance da verificare (`e5dbcd3`); due correzioni degli harness (`8d6f694`, `8465fcc`).
- Guida aggiornata a P4–P6: Oggi, solleciti Partner e «Partner nel Team», correzioni Finance, feed CEO; test che controlla i nomi citati (`9d38b88`).
- Documenti: `AGENTS.md` («Decisioni del founder»), `README.md`, `PRODUCT.md`, `DESIGN.md` (`598ad10`); `audit-workspace.md`, `finance-work.md`, `finance-dashboard.md`, `team-workspace.md`, indice e avviso in `partner.md` (`187549e`); questo documento.

Fatto il 23 ottobre: merge di `origin/main` a `3acbad3` (pull request #6 e #7). Il calendario a mese sostituisce la lista e il commit `1727c02`; la guida, `README.md`, `docs/team-workspace.md`, `docs/workspace-layout.md` e questo documento seguono la regola «Accordo fatto»; tutti i controlli verdi con i numeri qui sopra.

Da fare prima del merge, in quest'ordine:

1. Prove visive della parte B a 1280 × 800 e 390 × 844 (piano di lavoro, §1.4): `/guida`, «Prima volta qui?» su `/`, `/finance` con «Chiudi Finance», `/team` con il calendario a mese, `/assets` con «Mostra archiviati», un invio da verificare su `/sales`, `/auth/account`.
2. ~~Applicare in produzione `archivio_contenuti`~~: fatto (sezione «Produzione, 23 ottobre 2026: P7»).
3. Pull request con gli esiti, CI verde compreso il job «Concorrenza (PostgreSQL 17)», poi merge.
4. Messaggio di benvenuto per WhatsApp pronto per Tommi, senza password.

Resta fuori da P7, perché chiede una migrazione nuova: la frase del feed per archiviare e ripristinare un contenuto (oggi «ha aggiornato un contenuto»). È nei problemi noti, punto 12.

Nota per la pull request: in `AGENTS.md` P7 cambia anche una parola fuori da «Decisioni del founder», nella sezione dei test: «i cinque harness» diventa «gli harness». Gli harness su PostgreSQL 17 oggi sono undici.

## Problemi noti dopo P4-P6

Trovati il 23 ottobre 2026 da revisori indipendenti e confermati da verifiche contrarie, nel lavoro di Codex della pull request #3 (già su `main` e in produzione). P7 non li corregge: sono un promemoria per Tommi, da decidere uno per uno.

1. **Importi nel feed CEO.** Le frasi di Finance mostrano importi e categorie, anche degli incassi. La decisione 16 e la correzione 04-6 del piano li escludono. `/audit` chiede solo la password CEO.
2. **Feed lento con la crescita.** A ogni apertura il feed ricalcola tutto il registro. Su una copia locale PostgreSQL 17: circa 7.500 righe di audit in 6 s, 9.500 in 11 s, oltre il limite di 8 s di Supabase. Oggi la produzione ha circa 2.200 righe.
3. **Import in tante righe.** Un'operazione di massa dà una riga per record: l'import Partner 207 righe, quello dell'inventario 214. Dovrebbe essere una frase per operazione.
4. **Link, aree e sottotitolo del feed.** Diversi dalla decisione 17: il conto vendita sta sotto «Vendite» e porta a `/sales`, i link Finance non hanno l'ancora del movimento. Il sottotitolo non è quello della decisione 5. Le azioni del founder sono nascoste all'inizio.
5. **File dei dispositivi senza solleciti.** Le righe Partner caricate dai file «Esporta» (`origin = 'file'`) non creano né chiudono solleciti, contro la decisione 30. Da decidere con Tommi **prima** che carichi i file dei dispositivi.
6. **Solleciti doppi in Oggi.** Ogni sollecito in scadenza compare due volte, in «Agenda» e in «Contatti e solleciti», contro la decisione 9 e la correzione 05-11.
7. **Conteggi diversi tra Oggi e Partner.** I «contatti da fare» di Oggi arrivano al mese in corso; «Adesso» in Partner arriva alla fine del mese prossimo (decisione 33). I numeri non coincidono.
8. **Pezzi mancanti di P5.** Mancano «Ha risposto» in Oggi, la data del sollecito nella conferma di «Segna inviato» e il blocco «Esito» nella scheda Partner (decisione 10, correzione 05-7).
9. **Incassi eliminabili.** Finance permette di eliminare gli incassi delle vendite e i rimborsi Shopify, che la spec 04 (B.1) voleva non eliminabili. Una correzione cambia anche lo stato del pagamento in Vendite.
10. **Percorsi come testo.** Attività e appuntamenti creati da Partner mostrano «/partner?co=12#lead-12» come testo, non come link.
11. **«Collega l'evento» con date passate.** Per un contatto con l'evento già passato fallisce, con un messaggio che non spiega il motivo.
12. **Minori.** In Finance mancano il filtro «Modificati» e la riga «Modificato da X · data»; la motivazione è sempre obbligatoria; due funzioni di trigger hanno un `EXECUTE` che non serve; alcune chiavi esterne non hanno indice; il feed non ha una frase per archiviare e ripristinare un contenuto (l'archivio della parte A si legge come un aggiornamento generico).

## Prove visive della parte A

Anteprima locale (`npm run dev`, dati sintetici), a 1280 × 800 e 390 × 844, il 23 ottobre 2026. In ogni pagina: nessuno scorrimento orizzontale, nessun testo sotto 12 px, bersagli da almeno 44 px sul telefono.

- `/guida`: otto parti (oggi nove, con «Oggi»: da riprovare nella parte B), indice a destra sul computer e su due colonne in cima sul telefono, «Le operazioni più comuni» con link e pulsanti veri.
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
