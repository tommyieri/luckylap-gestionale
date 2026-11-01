# Verifiche LuckyLap

Stato del 23 ottobre 2026, dal branch `claude/revisione-pre-invio` (P7, revisione prima dell'invio). Il branch contiene la parte A, il merge di `origin/main` a `b24690f` (commit `5af0f1a`: la pull request #3 di Codex, cioè P4 Finance modificabile, P5 collegamenti e Oggi, P6 feed di Controllo CEO) e la parte B fino alla guida e ai documenti. Da allora `origin/main` è andato avanti a `3acbad3`, con due pull request che questo branch non contiene ancora:

- **#6** di Codex (`da96128`, «Finance: movimenti più leggibili»): solo `finance-imports-view.tsx`, il suo test e `finance.module.css`, che P7 non tocca.
- **#7** di un'altra sessione Claude (`claude/calendario-partecipiamo`, merge `3acbad3` alle 11:36 UTC): calendario del Team a mese, che sostituisce la lista con «Mostra anche passati»; lo stato Partner `chiuso` si chiama «Accordo fatto»; le date Partner entrano nel calendario solo con «Accordo fatto», con la migrazione `20261023113212_partner_dates_only_agreed.sql`, già applicata in produzione con questa versione cloud. Tocca nove file che anche questo branch cambia: `README.md`, `docs/README.md`, `docs/partner.md`, `docs/team-workspace.md`, `docs/workspace-layout.md`, `src/components/team-workspace.tsx`, `team-workspace.module.css`, `team-workspace.test.tsx` e `supabase/tests/finance-ecosystem-integration.mjs`.

Prove applicative, SQL sintetico, PostgreSQL concorrente e Auth cloud sono conteggiati separatamente. Le sezioni «Avvio del 21 ottobre 2026» restano come verbale dell'avvio: i numeri di allora non sono quelli di oggi.

## Due lavori d'invio, 1° novembre 2026

Branch `claude/club-marca-alternanza`, base `origin/main` a `79fa76a` (merge della pull request #34). Testo per i club con i modelli della marca (versione 2) e limite del giorno diviso a metà tra i club e gli altri contatti. Dettagli in [partner-assistente.md](partner-assistente.md), «Due lavori d'invio».

| Comando | Esito |
| --- | --- |
| `npm run typecheck` | nessun errore |
| `npm test` | 4.238 test in 226 file, tutti superati (contati senza `.claude/worktrees`, dove un'altra sessione ha lasciato una copia del repository che vitest raccoglie due volte) |
| `npm run test:db` senza `LUCKYLAP_PG_BIN` | 30 harness PGlite superati, 5.828 controlli; i 19 harness su PostgreSQL 17 risultano saltati (li esegue il job CI «Concorrenza (PostgreSQL 17)») |
| `npm run build` | riuscita; `next-env.d.ts` ripristinato con `git checkout` |
| `npm run format:check` | nessun file da formattare |

**Produzione, 1° novembre 2026.** Claude ha applicato la migrazione prima del merge, con l'OK di Tommi in chat e la procedura delle impronte (sotto, «Produzione, 28 ottobre 2026»). Versione cloud `20261101102208`, testo salvato uguale al file (md5 `6aab9a80608a14870ff1bc1d02bf7e8a`); il file ha il nome della versione cloud. L'assistente era e resta in modalità «spento» durante la migrazione.

- **Funzioni prima:** le 162 funzioni Partner e Assistente in `public` e `private` che le migrazioni del repository creano su PGlite fino a `_assistente_partner_modello.sql` erano identiche in produzione (sorgente, `security definer`, `search_path`, permessi di `anon`, `authenticated` e `service_role`: impronta `9109e6d6024861b82ad09a5731b95ab4`). Fuori dal confronto, come il 1° novembre, `partner_assistant_address_sha256` e le quattro dello scheduler e del registro, che la migrazione non tocca.
- **Funzioni dopo:** le 164 funzioni (le 162 più `flow_sent` e `flow_share`) sono identiche a quelle che il branch crea su PGlite (impronta `781e97683e38e28eabc2ef20f7bed74d`). Cambia solo `claim_partner_assistant_send` (sorgente), con gli stessi permessi; nessun ruolo client esegue le due nuove.
- **Identiche prima e dopo** (impronte md5 di tutte le righe): `partners` (854), `partner_contacts` (2.603), `tasks` (1), `partner_assistant_jobs` (772), `partner_assistant_notes` (456), `partner_assistant_drafts` (115), `partner_assistant_rules` (3), `partner_assistant_contacts` (1), `partner_assistant_messages` (5, le prove del 30 ottobre), `private.partner_assistant_events` (578), la configurazione dell'assistente (salvo `last_tick_at`), `cron.job` (2 job), `audit_logs` (5.178 righe). Lo stato della casella è identico salvo `last_tick_at` ed `env_checked_at`, che il worker scrive a ogni giro: il giro delle 10:24 UTC, dopo la migrazione, è passato dalla nuova `claim_partner_assistant_send` senza errori.
- **Avvisi di sicurezza:** solo quelli già noti (tabelle `private` con RLS e senza policy, protezione dalle password trapelate disattivata).

Harness nuovo: `assistente-partner-due-lavori.mjs` (PGlite, minimo 41): permessi delle funzioni nuove e della claim, metà del limite con 5, 7 e 10, ordine della coda invariato, club scelto quando gli altri hanno le loro 3, posti dei club tenuti fuori finestra fino alla loro finestra, posti liberi a chi ha email pronte, ricerca scaduta che esce dalla coda nello stesso giro, email senza bozza, prima settimana e dopo, «Prepara». Con la claim di prima applicata sopra la migrazione l'harness fallisce al primo caso della quota (sceglie l'altro contatto al posto del club). In locale anche `assistente-partner-invio.mjs` con le migrazioni del club, del modello e dei due lavori applicate: 429 controlli, stesso esito.

## Modalità modello per i club, 1° novembre 2026

Pull request #31 (branch `claude/assistente-modello-club`), unita il 1° novembre 2026 con l'OK di Tommi («Sì, procedi»), a controlli verdi compreso «Concorrenza (PostgreSQL 17)». Dettagli in [partner-assistente.md](partner-assistente.md), «Modalità modello per i club».

**Produzione, 1° novembre 2026.** Claude ha applicato la migrazione prima del merge, con la procedura delle impronte (sotto, «Produzione, 28 ottobre 2026»). Versione cloud `20261101012650`, testo salvato uguale al file (md5 `2005c818e5fa5e235be852f583fc9bb1`); il file ha il nome della versione cloud. L'assistente era e resta in modalità «spento».

- **Funzioni prima:** le 158 funzioni Partner e Assistente in `public` e `private` che le migrazioni del repository creano su PGlite fino a `_partner_sezione_club.sql` erano identiche in produzione (sorgente, `security definer`, `search_path`, permessi di `anon`, `authenticated` e `service_role`: impronta `15f14aab0cab700c26e5cb1fd0d49cb8`). Fuori dal confronto solo le quattro dello scheduler e del registro, che la migrazione non tocca. Quindi `claim_partner_assistant_step` e `complete_partner_assistant_review` sostituite partono dalla versione in produzione.
- **Funzioni dopo:** le 163 funzioni (le 158 più `lock_any_step`, `uses_template`, `is_template` e `complete_partner_assistant_template` privata e wrapper) sono identiche a quelle che il branch crea su PGlite (impronta `da1eb6d009bb1e07a647d8b5864dd505`). Le nuove: solo `service_role` esegue la RPC del worker; nessun ruolo client esegue gli aiuti.
- **Identiche prima e dopo** (impronte md5 di tutte le righe): `partners` (854), `partner_contacts` (2.603), `partner_assistant_jobs` (772), `partner_assistant_notes` (456), `partner_assistant_drafts` (115), `partner_assistant_rules` (3), `private.partner_assistant_events` (578), `cron.job` (2 job), `audit_logs` (5.177 righe). La configurazione dell'assistente non cambia (modalità «spento», versione 10, ultimo aggiornamento il 31 ottobre alle 21:06 UTC), salvo `last_tick_at`, che la presa del lavoro aggiorna a ogni tick: il tick delle 01:28 UTC, dopo la migrazione, è passato dalla nuova `claim_partner_assistant_step` senza errori.
- **Avvisi di sicurezza:** solo quelli già noti (tabelle `private` con RLS e senza policy, protezione dalle password trapelate disattivata).

L'harness `assistente-partner-modello.mjs` cerca la migrazione per suffisso (`_assistente_partner_modello.sql`): la rinomina non cambia i suoi 109 controlli.

## Sezione Club, 31 ottobre 2026

Pull request #27 (branch `claude/partner-club`), unita il 31 ottobre 2026 con l'OK di Tommi («auto merge quando ha finito»: l'auto-merge di GitHub non è attivo sul repository, quindi merge diretto a controlli verdi, compreso «Concorrenza (PostgreSQL 17)»). Deploy di Vercel riuscito sul commit `2d28e7e`. Dettagli della sezione in [partner.md](partner.md), «Sezione Club».

**Produzione, 31 ottobre 2026.** Claude ha applicato la migrazione dopo il merge, con l'OK di Tommi («Sì, applicala»), con la procedura delle impronte (sotto, «Produzione, 28 ottobre 2026»). Versione cloud `20261031180505`, testo salvato uguale al file (md5 `a601a1eb344a0590175255950089ead1`); il file ha il nome della versione cloud. Tra il deploy e la migrazione la casella «Club» della scheda dava errore al salvataggio, senza toccare dati.

- **Identiche prima e dopo** (impronte md5 di tutte le righe): `partners` (207), `partner_contacts` (850), `partner_message_variants` (218), `partner_activities` (0), `partner_work_links` (54), `partner_research_imports` (2), `partner_import_differences` (0), `profiles` (6), `memberships` (5), `partner_assistant_jobs` (165), `partner_assistant_drafts` (115), `partner_assistant_rules` (3), `cron.job` (2 job), `audit_logs` (2.771 righe). L'assistente era in modalità «prepara».
- **Cambiato, come previsto:** il vincolo `partners_sections_check` ammette `club` e fino a quattro sezioni; `private.partner_sections` restituisce `{vendita,eventi,collab,club}` per le quattro sezioni in qualunque ordine. Proprietario, `search_path` vuoto e permessi della funzione invariati (`{postgres=X/postgres}`): `authenticated`, `anon` e `service_role` non la eseguono.
- **Avvisi di sicurezza:** solo quelli già noti (tabelle `private` con RLS e senza policy, protezione dalle password trapelate disattivata).

L'harness `partner-club.mjs` cerca la migrazione per suffisso (`_partner_sezione_club.sql`): la rinomina non cambia i suoi 56 controlli.

**Import dei club, 31 ottobre 2026.** Con l'OK di Tommi («Sì, tutti i 647»), dalla ricerca del commit `1221aba` del repository Partner: 854 contatti (647 club nuovi, 5 club già presenti aggiornati, nessuno tolto); 119 Vendita, 80 Eventi, 73 Collab, 652 Club; 218 varianti invariate; recapiti attivi 772 email, 420 telefoni, 320 Instagram, 265 moduli, 19 pagine brand, 807 siti; zero differenze aperte; zero righe di audit con email o recapiti. Import `50553ef0-f1e3-427a-8a6f-908e7a17b67a`, SHA-256 normalizzato `b76d94c09fbf36caa7c269577d521c3f06989a0f5d4dceb560c1dd67b96493a9` ([dettagli](partner.md), «Import dei club, 31 ottobre 2026»).

## Assistente Partner, consegna 2a (invio), 30 ottobre 2026

Dal branch `claude/assistente-partner-invio` (base `origin/main` a `c4577bd`), consegna 2a dell'assistente: prova e invio delle prime email dalla casella aziendale. Dati sintetici, nessun accesso al cloud, nessuna chiamata vera a Claude, Supabase, SMTP o IMAP. Una migrazione nuova, additiva: `supabase/migrations/20261030114722_assistente_partner_invio.sql`. Dettagli, variabili e avvio in [partner-assistente.md](partner-assistente.md), «Seconda consegna, parte 1 (2a): l'invio».

**Produzione, 30 ottobre 2026.** Claude ha applicato la migrazione prima del merge, con l'OK di Tommi, con la procedura delle impronte (sotto, «Produzione, 28 ottobre 2026»). Versione cloud `20261030114722`, testo salvato uguale al file (md5 `adbefa19a9195a2459a7195a44fa8a1f`); il file ha il nome della versione cloud.

- **Identiche prima e dopo** (impronte md5 di tutte le righe): `partners` (207), `partner_contacts` (850), `partner_message_variants` (218), `partner_activities` (0), `partner_work_links` (54), `profiles` (6), `memberships` (5), `partner_assistant_jobs` (165), `partner_assistant_contacts` (0), `partner_assistant_notes` (391), `partner_assistant_drafts` (61), `partner_assistant_rules` (1), `cron.job` (2 job), `private.partner_assistant_runs` (445 righe), `audit_logs` (2.763 righe).
- **Cambiato, come previsto:**
  - tabelle in `public` da 87 a 88 (`partner_assistant_messages`);
  - tabelle private nuove: stato della casella (1 riga), 598 fusi, feste, paesi e prove;
  - la riga di configurazione ha le colonne nuove (`daily_first_limit` 10, `test_confirmed_at` vuota). Modalità «spento», messa da Tommi il 29 ottobre.
- **Durante e dopo la migrazione** lo scheduler della consegna 1 ha continuato a girare senza errori.
- **Avvisi di sicurezza:** solo quelli già noti (tabelle `private` con RLS e senza policy, protezione dalle password trapelate disattivata).

Harness e test cercano la migrazione per suffisso (`_assistente_partner_invio.sql`): la rinomina non cambia i numeri qui sotto.

| Comando | Esito |
| --- | --- |
| `npm run typecheck` | nessun errore |
| `npm test` | 4.132 test in 224 file, tutti superati |
| `npm run test:db` senza `LUCKYLAP_PG_BIN` | 26 harness PGlite superati, 5.516 controlli; i 18 harness su PostgreSQL 17 risultano saltati |
| `npm run test:db` con `LUCKYLAP_PG_BIN` (PostgreSQL 17.11 locale) | in più 18 harness PostgreSQL 17 superati, 2.112 controlli: 44 harness, 7.628 controlli in tutto |
| `npm run build` | riuscita; `next-env.d.ts` ripristinato con `git checkout` |
| `npm run format:check` | nessun file da formattare |

Harness nuovi, con il minimo della riga `// test-db:` in testa:

| Harness | Modalità | Minimo | Cosa prova |
| --- | --- | --- | --- |
| `assistente-partner-invio-comandi.mjs` | PGlite | 275 | colonne e vincoli nuovi; guardia dei messaggi («mai due volte», stato solo in avanti, niente cancellazioni); modalità «Prova» e «Invio» del founder, «Invio» solo con la prova confermata; «Manda la prova» (una prova alla volta), conferma (solo l'ultima prova, con un invio nelle ultime 24 ore), «Manda per primo», «Riprendi l'invio», limite; interruttore e regole; cancellazione definitiva che tiene gli invii veri; sollecito per Tommi dopo una prima email dell'assistente; permessi |
| `assistente-partner-modello.mjs` | PGlite | 109 | modalità modello per i club: permessi della RPC nuova e degli aiuti, nota di ricerca sostitutiva, scelta e bozza nella stessa transazione, ricevuta e ripetizione, contesto riletto, bozza del modello bocciata a Tommi, approvazione e coda d'invio, regole cambiate, contesto cambiato, payload non validi, controlli falliti, passo sbagliato e lease persa, riscrittura invariata per le bozze di Claude, tetto delle 20 bozze pronte contato sui contatti idonei, note del modello che ripartono dalla ricerca, club diventato evento |
| `assistente-partner-invio.mjs` | PGlite | 429 | finestra, fusi (tabella dei fusi; claim sotto 1 secondo con 200 righe con fusi esteri), feste e paesi, margine di 90 secondi; limiti e intervallo; ordine della coda e pulizia fino al candidato; `prepare`, `start` e `finish` con impronta e frase di uscita; fermi tra preparazione e SMTP; giri morti; stesso indirizzo su due schede; indirizzi scritti male; esiti SMTP e fermi; «non so» della casella; ricontrollo delle date; prova; variabili e accessi; lettura; permessi. L'ora è fissata in ogni transazione |
| `assistente-partner-invio-concurrency.mjs` | PostgreSQL 17 | 60 | due claim insieme (una sola lease); due `prepare` dello stesso lavoro; «Non contattare», «Spento» e regole nuove aperti mentre `start` aspetta (poi `stop`); `finish` e «Segna inviato» del team sulla stessa scheda nei due ordini, senza deadlock; claim d'invio e claim del passo con Claude insieme; claim con 200 righe con fusi esteri sotto 1 secondo (57 ms; 7.019 ms prima della tabella dei fusi) |

Il minimo di `assistente-partner-invio-concurrency.mjs` era 1 durante la costruzione (compito 2 del piano); il 30 ottobre è salito a 60, il numero dei controlli eseguiti in locale con PostgreSQL 17.11. Il job CI «Concorrenza (PostgreSQL 17)» lo controlla alla pull request.

Gli harness PostgreSQL 17 che applicano tutta la catena contano un controllo per migrazione: con la migrazione nuova `finance-ecosystem-integration.mjs` passa a 112, `manual-sale-cancellation.mjs` a 114, `manual-sale-returns.mjs` a 129, `sensitive-area-members.mjs` a 181 (righe in testa aggiornate). Ogni harness ha eseguito esattamente il suo minimo.

Altri controlli:

- Nessun indirizzo email reale nei file del branch: in `src`, `supabase/tests` e `docs/partner-assistente.md` le righe aggiunte usano solo `example.test`.
- Nessuna dichiarazione di IA (`ai_disclosure`) e nessun «[Prova]» nel codice e nelle migrazioni, salvo i test che ne controllano l'assenza.
- Anteprima locale (`npm run dev`, dati sintetici), a 1024 px e a 390 px: `/partner` con la striscia, la scheda del contatto 6 (blocco «Assistente» con «Email inviata dall'assistente il 30 ottobre alle 9:41.» e «Prima email inviata dall'assistente: il sollecito dopo 7 giorni lo manda Tommi.»), `/partner/assistente` (Stato, Modalità, Limite, Coda, Spesa, Variabili e accessi, Da vedere, Regole) e `/guida` con la parte nuova dell'assistente. Nessuno scorrimento orizzontale a 390 px, nessun testo sotto 12 px in `/partner/assistente`, nessun errore nella console o nel server. Le fixture dell'anteprima hanno l'assistente in «Prepara»: le sezioni «Prova» e «Invii» le coprono i test dei componenti.

## Assistente Partner, 27 ottobre 2026

Dal branch `claude/assistente-partner` (base `origin/main` a `3c58693`), prima consegna dell'assistente («prepara»: ricerca e bozze, nessun invio), con dati sintetici e senza accessi al cloud. Tre migrazioni nuove, additive, applicate in produzione il 28 ottobre 2026 (sotto, «Produzione, 28 ottobre 2026»); i file hanno i nomi delle versioni cloud. Dettagli, variabili e sequenza di avvio in [partner-assistente.md](partner-assistente.md).

| Comando | Esito |
| --- | --- |
| `npm test` | 3.341 test in 216 file, tutti superati |
| `npm run test:db` senza `LUCKYLAP_PG_BIN` | 24 harness PGlite superati, 4.812 controlli; i 17 harness su PostgreSQL 17 risultano saltati |
| `npm run test:db` con `LUCKYLAP_PG_BIN` (PostgreSQL 17.11 locale) | in più 17 harness PostgreSQL 17 superati, 2.048 controlli: 41 harness, 6.860 controlli in tutto |

Harness nuovi, con il minimo della riga `// test-db:` in testa:

| Harness | Modalità | Minimo | Cosa prova |
| --- | --- | --- | --- |
| `assistente-partner.mjs` | PGlite | 320 | tabelle, regole versione 1, comandi del team (modalità, interruttore per contatto, regole), lettura dello stato, permessi, cancellazione di un recapito |
| `assistente-partner-worker.mjs` | PGlite | 576 | coda, RPC del worker, `auth.uid()` dell'assistente, tentativi e attese (anche l'attesa per tutti quando un'attesa consuma il tentativo), contatto che cambia durante un passo, bozze e seconda lettura, pausa, revoca a `service_role` delle scritture sulle tabelle Partner |
| `assistente-partner-scheduler.mjs` | PGlite | 196 | scheduler ogni due minuti (Cron, Vault e pg_net simulati), destinazione fissa, spegnimento, job Shopify invariato |
| `assistente-partner-concurrency.mjs` | PostgreSQL 17 | 51 | due giri sovrapposti: uno solo prende il lavoro, mai due lease attive, una lease scaduta conta un solo tentativo; ordine dei lock con i comandi del team (prima il contatto, poi il lavoro): l'interruttore confermato durante un passo dà `non_idoneo`, la cancellazione di un recapito non va in deadlock con `complete_*`, `fail` e giro |

Gli harness PostgreSQL 17 che applicano tutta la catena contano un controllo per migrazione: con le tre migrazioni nuove `finance-ecosystem-integration.mjs` passa a 111, `manual-sale-cancellation.mjs` a 113, `manual-sale-returns.mjs` a 128, `sensitive-area-members.mjs` a 180 (righe in testa aggiornate). Ogni harness ha eseguito esattamente il suo minimo. `npm run typecheck`, `npm run build` e `npm run format:check` passano. Restano per la pull request (compito 14 del piano): la prova visiva di `/partner` e `/partner/assistente` in anteprima a 1280 × 800 e 390 × 844, e il job «Concorrenza (PostgreSQL 17)» in CI.

## Conto vendita diviso, 23 ottobre 2026

Dal branch `claude/conto-vendita-diviso` (base `origin/main` a `79ffbff`, con la pull request #20), con dati sintetici e senza accessi al cloud. Nessuna migrazione: cambiano solo pagine, indirizzi e link. Dettagli in [consignment.md](consignment.md), «Pagine».

| Comando | Esito |
| --- | --- |
| `npm test` | 2.248 test in 196 file, tutti superati |
| `npm run test:db` senza `LUCKYLAP_PG_BIN` | 21 harness PGlite superati, 3.720 controlli; i 16 harness su PostgreSQL 17 risultano saltati (nessun file SQL toccato) |

File di test nuovo: `src/lib/consignment/redirects.test.ts` (17 test, indirizzi vecchi con lo strumento di test di Next). `npm run typecheck`, `npm run build` e `npm run format:check` passano.

Prova visiva sull'anteprima sintetica, a 1280 × 800 e 390 × 844: Magazzino › Conto vendita (elenco, negozio contato e da contare, conta e correzione, ordine, nuovo ordine, impostazioni, nuovo negozio), Vendite › Conto vendita (elenco, negozio contato e da contare, resoconto come modulo e come riepilogo) e gli indirizzi vecchi, che arrivano con un 307 alla pagina nuova con la scheda giusta accesa. In ogni pagina nessuno scorrimento orizzontale, nessun testo sotto 12 px, campi a 16 px, sul telefono bersagli da almeno 44 px, nessun errore nella console o nel server.

## Foto dei nuovi prodotti, 23 ottobre 2026

Dal branch `claude/foto-nuovi-prodotti` (base `origin/main` a `1687d20`), con dati sintetici e senza accessi al cloud. Dettagli in [assets-development.md](assets-development.md), «Foto dei nuovi prodotti».

| Comando | Esito |
| --- | --- |
| `npm test` | 2.207 test in 195 file, tutti superati (dopo il merge di `origin/main` a `a843a6c`) |
| `npm run test:db` senza `LUCKYLAP_PG_BIN` | 21 harness PGlite superati, 3.720 controlli; i 16 harness su PostgreSQL 17 risultano saltati |
| `npm run test:db` con `LUCKYLAP_PG_BIN` (PostgreSQL 17 locale) | in più 16 harness PostgreSQL 17 superati, 1.985 controlli: 37 harness, 5.705 controlli in tutto |

Harness nuovo: `foto-nuovi-prodotti.mjs` (PGlite, 208 controlli). Con la migrazione nuova `finance-ecosystem-integration.mjs` passa a 108, `manual-sale-cancellation.mjs` a 110, `manual-sale-returns.mjs` a 125, `sensitive-area-members.mjs` a 177 (righe in testa aggiornate). `riassortimento-concurrency.mjs` controllava che il riassortimento fosse l'ultima migrazione: ora controlla che sia nella catena (stesso numero di controlli). `npm run typecheck`, `npm run build` e `npm run format:check` passano.

Prova visiva sull'anteprima sintetica, a 1280 × 800 e 390 × 844: schede con la striscia «Foto», miniature e riquadro HEIC con il nome, foto in grande con precedente, successiva, frecce della tastiera, «Sposta prima» e «Sposta dopo», «Rimuovi» con la conferma, «Aggiungi foto» con un file valido, uno oltre 25 MB e un PDF (avanzamento, poi i due motivi in italiano), «Grafica e foto» con e senza il filtro «Nuovi prodotti». In ogni pagina nessuno scorrimento orizzontale della pagina, nessun testo sotto 12 px, campi a 16 px, bersagli da almeno 44 px, nessun errore nella console.

## Riassortimento, 23 ottobre 2026

Dal branch `claude/riassortimento` (base `origin/main` a `e187934`), con dati sintetici e senza accessi al cloud. Dettagli in [riassortimento.md](riassortimento.md).

| Comando | Esito |
| --- | --- |
| `npm test` | 2.122 test in 184 file, tutti superati (dopo il merge di `origin/main` a `6f72c2e`) |
| `npm run test:db` senza `LUCKYLAP_PG_BIN` | 20 harness PGlite superati, 3.512 controlli; i 16 harness su PostgreSQL 17 risultano saltati |
| `npm run test:db` con `LUCKYLAP_PG_BIN` (PostgreSQL 17 locale) | in più 16 harness PostgreSQL 17 superati, 1.981 controlli: 36 harness, 5.493 controlli in tutto |

Harness nuovi: `riassortimento.mjs` (PGlite, 264 controlli) e `riassortimento-concurrency.mjs` (PostgreSQL 17, 24 controlli). Gli harness che applicano tutta la catena delle migrazioni contano un controllo per migrazione: con la migrazione nuova `finance-ecosystem-integration.mjs` passa a 107, `manual-sale-cancellation.mjs` a 109, `manual-sale-returns.mjs` a 124, `sensitive-area-members.mjs` a 176 (righe in testa aggiornate). `npm run typecheck`, `npm run build` e `npm run format:check` passano.

Prova visiva sull'anteprima sintetica, a 1280 × 800 e 390 × 844: elenco dei riordini, un riordine in «Discussione» (con «Modifica quantità», «Proponi quantità» e la destinazione del negozio con le sole taglie S–XL), uno «Da Antonella» con la conferma dell'arrivo, uno arrivato con «Da consegnare» e il nuovo ordine del Conto vendita già compilato, la griglia del negozio e la conta in S–XL. In ogni pagina nessuno scorrimento orizzontale, nessun testo sotto 12 px, campi a 16 px, bersagli da almeno 44 px, nessun errore nella console o nel server.

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
| `finance-revisions.mjs` | PGlite | 86 | revisioni Finance: fonti immutabili, versioni, eliminazione e ripristino, incassi e rimborsi non eliminabili, permessi |
| `partner-work-links.mjs` | PGlite | 42 | solleciti dopo l'invio, date Partner nel calendario, riquadro Partner di Oggi |
| `partner.mjs` | PGlite | 343 | Partner: sicurezza, import della ricerca, comandi, file dei dispositivi, generatore |
| `review-handoff.mjs` | PGlite | 51 | archivio dei contenuti in «Grafica e foto» |
| `partner-dates-agreed.mjs` | PGlite | 76 | date Partner nel calendario solo con «Accordo fatto», pulizia degli appuntamenti automatici |
| `sales-concurrency.mjs` | PostgreSQL 17 | 39 | vendite concorrenti ([evidenze](verifica-concorrenza.md)) |
| `packaging-concurrency.mjs` | PostgreSQL 17 | 6 | packaging con worker sovrapposti |
| `area-passwords.mjs` | PostgreSQL 17 | 161 | password di Finance e Controllo CEO ([contratto](area-passwords-backend.md)) |
| `shopify-scheduler-concurrency.mjs` | PostgreSQL 17 | 15 | recupero Shopify con connessioni sovrapposte |
| `shopify-ecosystem.mjs` | PostgreSQL 17 | 702 | ordini Shopify, worker e coda |
| `ceo-activity-feed.mjs` | PostgreSQL 17 | 327 | feed di Controllo CEO con la password CEO vera: privacy, frasi, link, raggruppamenti, 24 ore |
| `ceo-activity-feed-scale.mjs` | PostgreSQL 17 | 28 | feed di Controllo CEO con oltre 24.000 righe più vecchie di 24 ore: tempi e indici |
| `consignment-concurrency.mjs` | PostgreSQL 17 | 16 | conto vendita con comandi concorrenti |
| `finance-ecosystem-integration.mjs` | PostgreSQL 17 | 95 | catena completa delle migrazioni: Shopify, residui, conto vendita, feed, Partner |
| `finance-revisions-concurrency.mjs` | PostgreSQL 17 | 32 | revisioni Finance concorrenti |
| `partner-work-concurrency.mjs` | PostgreSQL 17 | 82 | collegamenti Partner e solleciti concorrenti |
| `shop-payment-finance-concurrency.mjs` | PostgreSQL 17 | 33 | pagamenti dei negozi corretti da Finance, concorrenti |

Auth è simulato in tutti gli harness: questi controlli non sostituiscono le prove su Auth cloud. In CI il job «Concorrenza (PostgreSQL 17)» esegue anche gli undici harness su PostgreSQL reale.

## Produzione, 28 ottobre 2026: Assistente Partner

Claude ha applicato le tre migrazioni dell'assistente il 28 ottobre 2026, dopo l'OK di Tommi («si applicale»), con la procedura qui sotto: impronte prima, testo esatto del file, rinomina, impronte dopo. Le ha applicate prima del merge della pull request #22, come chiede l'avvio ([partner-assistente.md](partner-assistente.md), «Avvio»).

| Migrazione | Versione cloud | Testo salvato |
| --- | --- | --- |
| `assistente_partner` | `20261028122704` | uguale al file, md5 `5ad2329ff88ffd6314355328ee911c3f` |
| `assistente_partner_worker` | `20261028122956` | uguale al file, md5 `d360d6e1834d95947971a2138c864ec9` |
| `assistente_partner_scheduler` | `20261028123036` | uguale al file, md5 `d37d6d730080a89722621a61e3801285` |

- **Identiche prima e dopo.** Impronte md5 di tutte le righe di `partners` (207), `partner_contacts` (850), `partner_message_variants` (218), `partner_research_imports` (2), `profiles` (5) e `memberships` (5). Le altre tabelle Partner sono vuote. Anche `audit_logs` (2.424 righe) e `cron.job` (solo il job Shopify) sono invariati.
- **Cambiato, come previsto.**
  - Le tabelle in `public` passano da 80 a 85.
  - I privilegi di `service_role` sulle tabelle Partner passano da 63 a 27: niente più inserimenti, modifiche, cancellazioni e `truncate` sulle nove tabelle Partner.
  - La configurazione dell'assistente è «spento», senza utente tecnico. Le regole sono alla versione 1 e i lavori sono zero.
- **Avvisi di sicurezza.** Solo quelli già noti: tabelle `private` con RLS e senza policy (volute) e la protezione dalle password trapelate disattivata.

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

1. **Importi nel feed CEO.** Le frasi di Finance mostrano importi e categorie, anche degli incassi. La decisione 16 e la correzione 04-6 del piano li escludono. `/audit` chiede solo la password CEO. Risolto il 23 ottobre (`20261023143400_ceo_feed_fixes`, da applicare): nessun importo, categoria o descrizione Finance e nessun importo dei pagamenti; resta solo il «da fatturare» del resoconto mensile (decisione 16).
2. **Feed lento con la crescita.** A ogni apertura il feed ricalcola tutto il registro. Su una copia locale PostgreSQL 17: circa 7.500 righe di audit in 6 s, 9.500 in 11 s, oltre il limite di 8 s di Supabase. Oggi la produzione ha circa 2.200 righe. Risolto il 23 ottobre (`20261023143400_ceo_feed_fixes`): il feed legge solo le ultime 24 ore, a blocchi e con indici; prima pagina in circa 70 ms con 24.000 righe più vecchie (prima: 12.200 righe in 20,9 s).
3. **Import in tante righe.** Un'operazione di massa dà una riga per record: l'import Partner 207 righe, quello dell'inventario 214. Dovrebbe essere una frase per operazione. Risolto il 23 ottobre (`20261023143400_ceo_feed_fixes`): stessa transazione e stesso tipo, una frase con il numero («Il sistema ha importato 207 contatti in Partner»).
4. **Link, aree e sottotitolo del feed.** Diversi dalla decisione 17: il conto vendita sta sotto «Vendite» e porta a `/sales`, i link Finance non hanno l'ancora del movimento. Il sottotitolo non è quello della decisione 5. Le azioni del founder sono nascoste all'inizio. Risolto il 23 ottobre (`20261023143400_ceo_feed_fixes`): area «Conto vendita», link della decisione 17 e solo quelli nel browser, sottotitolo delle 24 ore, vista iniziale «Tutti» con il founder.
5. **File dei dispositivi senza solleciti.** Le righe Partner caricate dai file «Esporta» (`origin = 'file'`) non creano né chiudono solleciti, contro la decisione 30. Da decidere con Tommi **prima** che carichi i file dei dispositivi. Risolto il 23 ottobre (`20261023140414_partner_oggi_fixes`, da applicare): un «Contattato» del file crea il sollecito per chi carica il file, 7 giorni dopo l'esportazione; le risposte del file lo chiudono; nessun doppione ai nuovi import.
6. **Solleciti doppi in Oggi.** Ogni sollecito in scadenza compare due volte, in «Agenda» e in «Contatti e solleciti», contro la decisione 9 e la correzione 05-11. Risolto il 23 ottobre: l'agenda toglie le attività collegate come sollecito (`partner_work_links`, `follow_up`).
7. **Conteggi diversi tra Oggi e Partner.** I «contatti da fare» di Oggi arrivano al mese in corso; «Adesso» in Partner arriva alla fine del mese prossimo (decisione 33). I numeri non coincidono. Risolto il 23 ottobre (`20261023140414_partner_oggi_fixes`): Oggi usa la regola di «Adesso» (decisione 33), provata sugli stessi dati sintetici in SQL e con il codice di Partner.
8. **Pezzi mancanti di P5.** Mancano «Ha risposto» in Oggi, la data del sollecito nella conferma di «Segna inviato» e il blocco «Esito» nella scheda Partner (decisione 10, correzione 05-7). Risolto il 23 ottobre: «Ha risposto» in Oggi, «Sollecito per te …» nella conferma, «Esito» con il link a `/team/partner?co=N`.
9. **Incassi eliminabili.** Finance permette di eliminare gli incassi delle vendite e i rimborsi Shopify, che la spec 04 (B.1) voleva non eliminabili. Una correzione cambia anche lo stato del pagamento in Vendite. Risolto: da Finance si correggono e si ripristinano, non si eliminano (`20261023125727_finance_fixes.sql`); una vendita si annulla in Vendite.
10. **Percorsi come testo.** Risolto il 23 ottobre: in Team il percorso «/partner?co=12#lead-12» diventa il link «Apri la scheda». Nel database il testo resta quello.
11. **«Collega l'evento» con date passate.** Per un contatto con l'evento già passato fallisce, con un messaggio che non spiega il motivo. Risolto il 23 ottobre (`20261023140414_partner_oggi_fixes`): con l'accordo fatto l'evento entra in calendario anche se passato; messaggi chiari senza accordo o senza date.
12. **Minori.** In Finance mancano il filtro «Modificati» e la riga «Modificato da X · data»; la motivazione è sempre obbligatoria; due funzioni di trigger hanno un `EXECUTE` che non serve; alcune chiavi esterne non hanno indice; il feed non ha una frase per archiviare e ripristinare un contenuto (l'archivio della parte A si legge come un aggiornamento generico).
    - `EXECUTE` dei trigger del calendario e indici delle chiavi esterne di `partner_work_links` e `partner_event_sales`: risolti il 23 ottobre (`20261023140414_partner_oggi_fixes`).
    - Frase per archiviare e ripristinare un contenuto: risolta il 23 ottobre (`20261023143400_ceo_feed_fixes`), «… ha archiviato un contenuto: …» e «… ha ripristinato un contenuto: …» con il link `/assets#contenuto-<id>`.
    Parte Finance risolta: filtro «Modificati», riga «Modificato da X · data», motivazione facoltativa nell'app (il database la vuole ancora, l'app manda «Correzione»).

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
