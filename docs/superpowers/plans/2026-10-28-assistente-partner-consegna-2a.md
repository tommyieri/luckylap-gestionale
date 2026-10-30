# Assistente Partner, consegna 2a («solo invio»): piano di implementazione

> **Per gli agenti che eseguono:** SKILL RICHIESTA: superpowers:subagent-driven-development (consigliata) oppure superpowers:executing-plans, un compito alla volta, nell'ordine da 1 a 9 (prima il database, poi posta, ricontrollo delle date e worker, poi interfaccia, poi documenti e avvio). I passi usano le caselle (`- [ ]`).

**Obiettivo:** l'assistente manda dalla casella IONOS, già dal 29 ottobre 2026, le prime email già pronte e approvate: prima una «prova» realistica verso le caselle di Tommaso, confermata da lui, poi l'«invio» vero ai contatti, lento, nella finestra 9:30-11:00 del destinatario, mai due volte allo stesso contatto.

**Architettura:** una sola migrazione nuova, `_assistente_partner_invio.sql`, porta tabelle, comandi del team e le RPC del passo d'invio; calendario, limiti, ordine della coda e ogni controllo di sicurezza stanno nella SQL, con l'ora letta da un solo helper. Il passo d'invio gira nello stesso giro del worker di oggi (route `/worker`, pg_cron ogni 2 minuti, nessuno scheduler nuovo): a ogni giro il worker prova prima un passo d'invio senza Claude (lock della casella come lease nel database, una connessione IMAP per il controllo dei 12 mesi e la copia in «Posta inviata», un SMTP con `SMTPConnection`, una fase alla volta); solo se non c'era niente da inviare fa il passo con Claude di oggi. Il messaggio si compone una volta sola con `MailComposer`; gli stessi byte vanno a SMTP e ad APPEND. A ogni giro il worker registra anche quali gruppi di variabili sono validi e l'esito degli ultimi accessi SMTP e IMAP, senza valori, e la pagina li mostra.

**Stack:** Next.js 16.4.2 (route Node, `after`), Supabase Postgres 17, `@anthropic-ai/sdk` 0.133.0 (invariato), `nodemailer` 10.1.1 e `imapflow` 2.4.2, vitest, harness PGlite e PostgreSQL 17.

**Specifica:** `docs/superpowers/specs/2026-10-27-assistente-partner-design.md` (approvata il 27 ottobre 2026), sezioni «5. Invio», «Avvio», «Posta», «Casella aziendale e spam», «Regole di sicurezza», «Variabili d'ambiente», «Test e verifica». Vincolanti, e qui riportati dentro i compiti: il perimetro della 2a (`/private/tmp/claude-501/-Users-tommi-Library-Application-Support-Claude-scratch-workspaces-3b468909-fef5-4c8f-a8d1-245b3087754a-22c2e86f-8b2c-4faf-a259-8139f1c0e937-scratch-2026-10-26-a410b5/739b74e3-498d-44d7-a872-f6305936c2bc/scratchpad/consegna-2/perimetro-2a.md`) e le decisioni del controllore e di Tommaso (`…/consegna-2/decisioni.md`, stessa cartella), comprese le sezioni «pomeriggio» e «sera». Dove si contraddicono vale il perimetro della 2a, che è l'ultima decisione: avvio il 29 ottobre (prova alle 8:30, invio dalle 9:30) al posto del calendario del 5 e del 9 novembre (D5) e dell'invio a mano della «sera». Il piano completo della consegna 2 (`docs/superpowers/plans/2026-10-28-assistente-partner-consegna-2.md`, 25 compiti) è la fonte dei nomi e dei disegni ripresi qui; la 2b lo riprenderà adattato.

**Scadenza:** costruita stanotte, in produzione domattina (Appendice C).

## Vincoli globali

- Copia di lavoro `/Users/tommi/lg-invio`, branch `claude/assistente-partner-invio` (oggi a `d584fb1`). `origin/main` è a `c4577bd`, il merge della PR #22, senza differenze da `d584fb1`: prima del compito 1 `git fetch` e `git rebase origin/main` (avanzamento veloce). Pull request propria verso `main`; il merge è di Tommi. Dopo ogni commit `git push -u origin claude/assistente-partner-invio`.
- Regole di `AGENTS.md`: niente push su `main`, niente migrazioni o scritture in produzione, niente impostazioni Supabase o Vercel senza l'OK di Tommi in chat. Prima di toccare `package.json`, `package-lock.json`, `next.config.ts` o le migrazioni: `git fetch`, `git branch -r`, `git diff --name-only origin/main...origin/<branch>` per ogni branch aperto (al 28 ottobre sera l'unico non unito è `origin/codex/finance-movimenti-leggibili`, che non tocca questi file). Se un altro branch li tocca, fermarsi e chiedere a Tommi.
- Le migrazioni `20261028122704_assistente_partner.sql`, `20261028122956_assistente_partner_worker.sql` e `20261028123036_assistente_partner_scheduler.sql` sono in produzione: **non si modificano**. Una sola migrazione nuova, `supabase/migrations/<ts>_assistente_partner_invio.sql`, creata con `npx supabase@2.121.0 migration new assistente_partner_invio`. Funzioni esistenti con `create or replace` (stessa firma, stessi grant); vincoli con nome automatico tolti con un blocco `do` che trova il nome in `pg_constraint` con `pg_get_constraintdef`, poi aggiunti con un nome esplicito.
- La migrazione alza di uno il minimo della riga `// test-db:` di `supabase/tests/finance-ecosystem-integration.mjs` (111 → 112), `manual-sale-cancellation.mjs` (113 → 114), `manual-sale-returns.mjs` (128 → 129) e `sensitive-area-members.mjs` (180 → 181). Sono harness PostgreSQL 17: in locale senza `LUCKYLAP_PG_BIN` risultano saltati, si guardano nel job CI «Concorrenza (PostgreSQL 17)».
- **Compatibilità con il codice in produzione.** La migrazione va in produzione prima del merge, quindi il worker e l'interfaccia della consegna 1 leggono per un po' il database nuovo. Per questo: le RPC esistenti ridefinite restituiscono esattamente le chiavi e i motivi di oggi (`read_partner_assistant_status` non si tocca); le letture nuove sono RPC nuove; i valori nuovi (stato `inviata` del lavoro, origine `assistente`, eventi con `step = 'invio'`, motivi nuovi) nascono solo dalle RPC d'invio, che chiama solo il worker nuovo, e solo in «prova» o «invio», che la SQL concede solo con una prova confermata e che l'interfaccia vecchia non sa scegliere.
- **Ordine dei lock.** Le RPC d'invio prendono per prima la riga `private.partner_assistant_mail_state` `for update` (il lock della casella), poi la configurazione `for share` dove serve, poi `partners` (`for share`, oppure `for update` dove si scrivono stato e registro), poi il lavoro `for update`. Tutte le altre funzioni restano come oggi: configurazione, poi `partners`, poi lavoro. **Nessuna funzione prende `mail_state` dopo la configurazione**: i comandi che toccano `mail_state` (solo «Riprendi l'invio») non prendono la configurazione. Un insieme di lavori si blocca in ordine di `partner_id`.
- **Ora.** Ogni decisione di calendario, limite e intervallo usa `private.partner_assistant_now()`, e così le date che le RPC d'invio scrivono e poi confrontano (`sent_at`, `appended_at`, `send_day`, `stopped_at`, `backoff_until`, `next_send_after`, `failures_day`, `env_checked_at`, `*_login_at`); le lease usano `clock_timestamp()`.
- **Finestra d'invio:** giorni feriali (lunedì-venerdì), dalle 9:30 incluse alle 11:00 escluse nell'ora del destinatario, con il fuso della scelta (`timezone`), oppure `Europe/Rome` se manca o non è valido; niente feste nazionali del paese della scheda (`partners.country`, Appendice B); nessun invio dal 21 dicembre al 7 gennaio (specifica, «Regole di sicurezza»).
- **Quanto:** 5 prime email vere al giorno nei primi 7 giorni di calendario dal primo invio vero (giorno di Roma), poi `daily_first_limit` (predefinito 10, da 1 a 15, che il founder cambia dalla pagina, Q10). Giorno contato sull'ora di Roma. Tra due invii (prova e invio) un intervallo casuale tra 4 e 11 minuti. In «prova» al massimo 15 messaggi al giorno, senza la finestra del destinatario.
- **Ordine della coda:** `send_priority` (più alta prima), poi la data dell'evento della scelta (`event_starts_on`, più vicina prima, senza data in fondo), poi la ricerca più vecchia, poi la priorità della scheda (alta, media, bassa), poi CO.
- **Età della ricerca:** in «invio» si manda solo con una ricerca di meno di 21 giorni; altrimenti la bozza resta e il lavoro torna alla ricerca.
- **Posta:** runtime `nodejs`. SMTP `smtp.ionos.it` (o `PARTNER_MAIL_SMTP_HOST`), porta 587 fissa, STARTTLS obbligatorio (`secure: false, requireTLS: true`); IMAP `imap.ionos.it` (o `PARTNER_MAIL_IMAP_HOST`), porta 993 fissa, TLS. Un destinatario, mai Cc o Bcc, solo testo semplice, niente allegati, immagini, tracciamento o `X-Mailer`. `From: "Tommaso | LuckyLap" <PARTNER_MAIL_USER>` (nome da `PARTNER_MAIL_FROM_NAME` se c'è). `Message-ID` del codice: `<uuid@dominio della casella>`. Oggetto e testo della prova identici all'invio vero, senza «[Prova]».
- **Corpo del messaggio:** testo della bozza, riga vuota, firma, riga vuota, frase di uscita della lingua e del registro della scelta (Appendice A), aggiunta dal sistema. **Nessuna dichiarazione di IA**: niente `ai_disclosure`, né in configurazione, né in tabelle, né nei testi, né nei test.
- **SMTP per fasi:** si usa `SMTPConnection` (`nodemailer/lib/smtp-connection`), non `createTransport`/`sendMail`: in 10.1.1 la chiusura della connessione, l'errore di socket e il timeout del socket portano `command: "CONN"` in ogni fase (`smtp-connection/index.js:202-206, 990, 1034`), quindi solo la fase in cui cade l'errore dice se l'email può essere partita.
- **Mitigazioni di nodemailer 10.1.1:** indirizzi passati come oggetti (`{ name, address }`), `envelope` esplicito, destinatario validato prima con la regex stretta `^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$` (al massimo 254 caratteri). Dipendenze installate con `npm install --save-exact --before=2026-10-14T23:59:59Z nodemailer@10.1.1 imapflow@2.4.2`. Niente `mailparser`, niente `@types/nodemailer`.
- **Segreti e dati:** nessun indirizzo, testo, password o risposta del server nei log, nelle risposte HTTP, negli eventi o nei codici di esito; gli errori di posta si salvano come codici `^[a-z][a-z0-9_]{0,79}$`. imapflow con `logger: false`, nodemailer con `logger: false`. Test e fixture solo con dati sintetici: domini `example.test` (`info@club-951.example.test`, `prova1@example.test`, `casella@luckylap.example.test`), telefono `+39 000 000 0000`, CO da 951 in su, persone `70000000-0000-4000-8000-…` (founder 901, consulente 902, assistente 990). Nessuna chiamata vera a Claude, Supabase, SMTP o IMAP.
- Interfaccia e documenti in italiano, frasi brevi. Nell'interfaccia il founder è «Tommi»; le email sono firmate «Tommaso».
- Prima di ogni commit `npm run format` (due volte) e `npm run format:check`. Prima della pull request: `npm run typecheck`, `npm test`, `npm run build` (se cambia `next-env.d.ts`, `git checkout -- next-env.d.ts`), `npm run test:db`, `npm run format:check`. Commit in italiano con il prefisso «Assistente Partner:» e la riga `Co-Authored-By` della sessione.
- Next.js 16.4.2: prima di toccare le route leggere `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` e `03-file-conventions/02-route-segment-config/maxDuration.md`.

## Dove la 2a è diversa dalla consegna 2 completa

1. **Nessuna lettura della casella.** Niente cursori, `match`, `record_partner_assistant_incoming`, classificazione, rimbalzi letti dalla posta, «Da smistare», passaggi, riepilogo, outbox, conversazioni. Le risposte arrivano a Tommaso in info@ come oggi. IMAP serve solo al controllo dei 12 mesi e alla copia in «Posta inviata».
2. **Modalità «prova» e «invio» con un comando di prova.** Al posto della prova continua (Q32 del piano completo, 3 al giorno, destinatario a rotazione), il founder preme «Manda la prova» con da 1 a 3 bozze pronte scelte dal sistema (le prime della coda): ogni bozza parte verso ogni indirizzo di `PARTNER_TEST_TO` (da 1 a 5), una email ogni 4-11 minuti, al massimo 15 al giorno. «La prova è arrivata in posta in arrivo» registra data e autore; senza, «Invio» si rifiuta.
3. **Promemoria per il team.** Dopo una prima email vera dell'assistente nasce lo stesso promemoria di sollecito a 7 giorni di «Segna inviato», assegnato a Tommaso (`handoff_to`). Il trigger del registro si allarga all'origine `assistente`. Niente solleciti dell'assistente.
4. **Frase di uscita dopo la firma**, testi dell'Appendice A, solo nel codice TypeScript (la SQL ne controlla la forma, non il testo: così Luca la può ritoccare con una pull request, senza migrazione).
5. **Controllo dei 12 mesi solo per indirizzo**, con una ricerca IMAP in sola lettura (EXAMINE) in posta in arrivo, `\Sent` e `\Junk`, messaggi da, a o in copia all'indirizzo da 365 giorni. Trovato: niente invio, il contatto passa a Tommaso (`conversazione_esistente`, «Conversazione recente nella casella»). Nessuna risposta, cartella mancante o errore: «non so», niente invio. In «prova» la stessa ricerca gira sull'indirizzo vero del contatto come verifica, senza effetti oltre a un evento.
6. **Una sola migrazione** (`_assistente_partner_invio.sql`) invece di cinque; nessun cambiamento allo scheduler, al feed di Controllo CEO, a Oggi o a «Segna inviato».
7. **Compatibilità con il worker vecchio** (vincoli globali): niente RPC esistenti con forma nuova.
8. **Esiti SMTP più semplici:** un `4.x.x` o il 450 di IONOS si riprova al giro dopo, e dopo tre nello stesso giorno gli invii si fermano fino al giorno dopo; un esito incerto passa subito a Tommaso (niente ricerca del `Message-ID` per risolverlo); credenziali rifiutate, `5.7.x`, «spam» o due rifiuti definitivi nello stesso giorno fermano gli invii finché Tommi preme «Riprendi l'invio». La fase decide: un errore senza codice in connessione o accesso è «non partito», durante l'invio è «incerto».
9. **Ricontrollo delle date all'invio ridotto alla prima email** (Q15, specifica «Bozze vecchie»): evento della scelta già iniziato, riga della maglietta co-firmata diversa tra il giorno della bozza e quello dell'invio, una data citata nel corpo non più futura. Senza il ricontrollo `controlli_falliti` del piano completo: la 2a ricontrolla l'impronta approvata, le regole, il recapito e le date.

## Scelte di questo piano (di Claude, da controllare)

1. Il passo d'invio sta nel giro di oggi (route `/worker`), prima del passo con Claude: niente route né job di cron nuovi, niente da riconfigurare in Vault. Un giro che manda (o copia in «Posta inviata») non fa il passo con Claude, così i due non superano insieme i 300 secondi.
2. Il lock della casella è una lease nella riga `private.partner_assistant_mail_state` (300 secondi, più lunga del budget del passo d'invio, 120 secondi): un lock di sessione non sopravvive tra due RPC di PostgREST. Un messaggio `pronto` o `in_invio` trovato senza lease attiva è di un giro morto: `pronto` diventa `scartato`, `in_invio` diventa `incerto` e il contatto passa a Tommaso.
3. Il lavoro, dopo la prima email vera, passa allo stato nuovo `inviata` (terminale nella 2a). La 2b deciderà come farne una conversazione.
4. Una guardia nel database in più rispetto al perimetro: un indirizzo che ha già ricevuto una prima email vera dall'assistente negli ultimi 365 giorni, da un'altra scheda, non riceve la seconda (il contatto passa a Tommaso con `conversazione_esistente`). Copre lo stesso indirizzo su due schede (un club e il suo evento) anche prima che la copia sia in «Posta inviata».
5. Un indirizzo della scheda che non passa la regex stretta (anche dopo `lower(btrim(...))`) non riceve email: il contatto passa a Tommaso con `indirizzo_non_valido`.
6. `send_priority` mette il contatto per primo anche nella coda di preparazione con Claude (`partner_assistant_ranking`), così la bozza di Milano AutoClassica arriva prima. Senza priorità l'ordine resta quello della consegna 1.
7. La preferenza martedì-giovedì di Q10 non entra nella 2a: il perimetro dice «giorni feriali». Domani è giovedì, venerdì 30 vale 5.
8. Il limite `daily_first_limit` si cambia dalla pagina con `set_partner_assistant_settings`, il nome del piano completo, qui con la sola chiave del limite (la 2b aggiunge le sue). Fino al 4 novembre vale comunque 5.
9. «Ricerca nella casella senza risposta» (`casella_incerta`) ferma gli invii per 15 minuti, così il worker non rifà un login a IONOS ogni 2 minuti. Vale anche per una copia arretrata in «Posta inviata» che non si chiude, senza lavoro (`skip` con `job_id` nullo); durante l'attesa il claim non ripropone gli arretrati, così il passo con Claude non resta fermo. Anche un SMTP fallito in connessione o accesso conta come i `4.x.x`.
10. Un rifiuto `5.1.x` all'invio non tocca il recapito (niente «da verificare»: è della 2b, Q21) e conta tra i rifiuti definitivi del giorno. «Ridai all'assistente» non riprende i lavori `conversazione_esistente` e `invio_incerto`: ridarli costerebbe una ricerca nuova e finirebbe allo stesso punto.
11. Il nome EHLO di SMTP è il dominio della casella (`name: mail.domain`), invece di `os.hostname()`, che su Vercel diventa `[127.0.0.1]`. La prova con mail-tester lo verifica.
12. Una cancellazione definitiva del recapito cancella anche i messaggi del contatto; se arriva tra `start` e `finish`, `finish` risponde `lease_persa` e niente si registra. Il lavoro però passa a Tommi con `invio_incerto`, non con `dato_cancellato`, se il contatto aveva un messaggio `invio` `in_invio` o `incerto`: l'email può essere partita, e l'interruttore non deve poterlo riprendere (scelta 10).
13. Le fasi SMTP: `connect` e `login` falliti senza un codice del server sono «non partito»; in `send` ogni errore senza codice, compresi la connessione caduta e il timeout del socket, è «incerto». Un `5xx` in `connect`, in `login` o al `MAIL FROM` non riguarda il contatto: con `5.7.x` o «spam» è `bloccato` (ferma tutto come lo spam, il lavoro resta `pronta`), altrimenti «non partito». L'SMTP ha una scadenza rigida (tempo rimasto meno 15 secondi); `finish`, `skip` e `release` dopo l'SMTP hanno 10 secondi propri fuori dal budget, perché un `250` arrivato tardi va registrato.
14. Variabili e accessi si registrano in `private.partner_assistant_mail_state`, non nella riga di configurazione: così non cambiano la sua versione (i comandi del team usano il CAS) e non toccano l'ordine dei lock. Il gruppo «assistente» lo calcola la pagina da sé: con quel gruppo non valido il worker risponde 503 e non può scrivere.
15. Ricontrollo delle date: un evento già iniziato passa subito a Tommi (`bozza_scaduta`), perché una riscrittura con la stessa scelta finirebbe allo stesso punto; una riga della maglietta cambiata o una data del corpo passata danno una riscrittura (`rewrites = 1`) se non c'è la pausa per credito, poi Tommi (scelta 19 del piano completo). Solo in «invio»: una prova con una bozza vecchia arriva solo a Tommaso. «Manda la prova» salta le bozze di eventi già iniziati.

## Fuori dalla 2a (va nella 2b)

Lettura della casella, risposte, rimbalzi letti dalla posta, risposte automatiche, parole di stop, «Da smistare», rapporti DMARC; solleciti dell'assistente, passaggi con riassunto e risposta suggerita, riepilogo serale, tetto orario dei passaggi; difetto delle fonti e del conteggio delle ricerche; nodemailer 10.1.4 (dal 1° novembre); esempio del Porsche Club GB nelle regole; frasi del feed di Controllo CEO per l'assistente (nella 2a il feed scrive «Assistente ha registrato un invio Partner: …», con il nome del profilo); ritocchi a Oggi, «Segna inviato» e Messaggi; `daily_followup_limit`; il ricontrollo `controlli_falliti` all'invio; «Ridai all'assistente dopo il passaggio» e il salto del controllo dei 12 mesi.

## Fuoco della revisione

Cinque casi che il perimetro implica e che rischiano di sfuggire. Ognuno ha il suo test nel compito indicato, segnato «Fuoco N».

1. **Lo stesso indirizzo su due schede** (un club e il suo evento): la seconda prima email non parte mai, nemmeno lo stesso giorno, prima che la copia sia in «Posta inviata». Test nel compito 2.
2. **Un indirizzo della scheda scritto male o con caratteri che la regex stretta non ammette** (`Info@Club-962.Example.Test`, `o'neil@club-963.example.test`, che `partner_link_value` accetta): si manda all'indirizzo minuscolo; quello che non passa la regex stretta non arriva mai a nodemailer e passa a Tommaso, anche oltre la ventesima riga della coda. Test nei compiti 2 e 3.
3. **Una persona ferma l'assistente, segna «Non contattare» o salva regole nuove tra la preparazione e l'SMTP**: non parte niente. Test nel compito 2 (PGlite e PostgreSQL 17) e nel compito 6.
4. **Il processo muore dopo l'SMTP e prima di `finish`, o la connessione cade durante l'invio**: il messaggio resta `in_invio` o diventa `incerto`, il contatto passa a Tommaso e nessuna seconda email parte. Test nei compiti 2, 3 e 6.
5. **La casella risponde «non so»** (ricerca `false` o `[]` da una connessione non più valida, `\Junk` non trovata, timeout, copia arretrata che non si chiude): nessun SMTP, una sola nuova prova dopo 15 minuti, nessun login ogni 2 minuti, e il passo con Claude intanto continua. Test nei compiti 2, 4 e 6.

## Mappa dei file

| File | Responsabilità | Compito |
|---|---|---|
| `supabase/migrations/<ts>_assistente_partner_invio.sql` | sezione 1: dati, guardie, trigger, comandi; sezione 2: calendario, coda, RPC d'invio, lettura | 1, 2 |
| `supabase/tests/assistente-partner-invio-comandi.mjs` | harness PGlite della sezione 1 | 1 |
| `supabase/tests/assistente-partner-invio.mjs` | harness PGlite della sezione 2 | 2 |
| `supabase/tests/assistente-partner-invio-concurrency.mjs` | harness PostgreSQL 17: due giri, lock | 2 |
| `src/lib/partner-assistant/mail-config.ts` | variabili della posta, fallimento chiuso, gruppi validi senza valori | 3 |
| `src/lib/partner-assistant/mail-compose.ts` | testo, frasi di uscita, `Message-ID`, MIME | 3 |
| `src/lib/partner-assistant/smtp.ts` | SMTP per fasi ed esiti | 3 |
| `src/lib/partner-assistant/imap.ts` | cartelle, controllo dei 12 mesi, copia in «Posta inviata» | 4 |
| `src/lib/partner-assistant/send-recheck.ts` | date del corpo e ricontrollo all'invio | 5 |
| `src/lib/partner-assistant/send-types.ts`, `send-store.ts`, `send.ts` | tipi, RPC ammesse, passo d'invio | 6 |
| `src/lib/partner-assistant/worker.ts` | il giro: variabili, poi l'invio, poi Claude | 6 |
| `src/lib/partner/commands.ts`, `assistant.ts`, `server.ts`, `model.ts`, `fixtures.ts`, `src/app/(workspace)/partner/actions.ts`, `command-runner.ts` | comandi, letture, registro nell'app | 7 |
| `src/components/partner/partner-assistant-strip.tsx`, `-view.tsx`, `-block.tsx`, `partner-context.tsx`, `partner-workspace.tsx`, le due `page.tsx` | interfaccia | 8 |
| `src/components/guide-view.tsx`, `docs/*` | guida, documenti, avvio | 9 |

---

### Compito 1: migrazione, sezione 1: dati, guardie, registro e comandi del team

**File:**
- Crea: `supabase/migrations/<ts>_assistente_partner_invio.sql` (`npx supabase@2.121.0 migration new assistente_partner_invio`), con commento in testa in italiano, tutto tra `begin;` e `commit;`, senza `create extension`, con la riga «Codici d'errore (messaggio = codice): …».
- Crea: `supabase/tests/assistente-partner-invio-comandi.mjs`
- Modifica: la riga 1 dei quattro harness di catena (vincoli globali, +1).

**Interfacce:**
- Consuma (consegna 1): `private.partner_assistant_config`, `public.partner_assistant_contacts`, `public.partner_assistant_jobs`, `public.partner_assistant_notes`, `public.partner_assistant_drafts`, `public.partner_assistant_rules`, `private.partner_assistant_events`, `private.partner_assistant_append_only()`, `private.partner_assistant_begin/finish(...)` (`20261028122704`, righe 224-252), `private.partner_assistant_eligible(uuid)`, `private.partner_assistant_service_required()`, `private.partner_assistant_as_actor()` (`20261028122956`); dal modulo Partner `private.partner_actor()`, `private.is_founder()`, `private.partner_payload/partner_bigint/partner_uuid/partner_check`, `private.partner_log(...)` (con `p_origin`), `private.apply_partner_stage(...)`, `private.partner_blocked(uuid)`.
- Produce, tabelle e colonne (permessi come `20261028122704` righe 566-585: le `public` con RLS, `revoke all … from public, anon, authenticated, service_role`, `grant select … to authenticated`, policy `member_read` con `(select private.is_member())`; le `private` con RLS e revocate a tutti):
  - `private.partner_assistant_config`: `daily_first_limit integer not null default 10` con vincolo `partner_assistant_config_daily_first_limit_check check (daily_first_limit between 1 and 15)`; `test_confirmed_at timestamptz`; `test_confirmed_by uuid references public.profiles(user_id)`.
  - `public.partner_assistant_contacts`: `send_priority smallint not null default 0` con `partner_assistant_contacts_send_priority_check check (send_priority between 0 and 9)`.
  - `public.partner_assistant_jobs`: lo stato ammette anche `inviata` (vincolo rinominato `partner_assistant_jobs_status_check`).
  - `public.partner_activities`: `partner_activities_origin_check check (origin in ('team','file','assistente'))`.
  - `private.partner_assistant_test_runs`: `id uuid pk default gen_random_uuid()`, `draft_ids uuid[] not null check (cardinality(draft_ids) between 1 and 3)`, `recipients smallint not null check (recipients between 1 and 5)`, `requested_by uuid not null references public.profiles(user_id)`, `requested_at timestamptz not null default now()`.
  - `private.partner_assistant_mail_state`, riga unica inserita dalla migrazione: `singleton boolean pk default true check (singleton)`, `id uuid not null unique default gen_random_uuid()` (l'`id` della risposta di «Riprendi l'invio»), `lease_token uuid`, `lease_expires_at timestamptz`, `last_tick_at timestamptz`, `last_outcome text check (last_outcome ~ '^[a-z][a-z0-9_]{0,79}$')`, `stop_reason text check (stop_reason in ('casella','rimbalzi'))`, `stopped_at timestamptz`, `next_send_after timestamptz`, `backoff_until timestamptz`, `failures_day date`, `soft_failures integer not null default 0 check (soft_failures >= 0)`, `hard_failures integer not null default 0 check (hard_failures >= 0)`, `day_stopped_on date`; variabili e accessi (perimetro, punto 7), tutte nulle finché il worker non le scrive: `env_checked_at timestamptz`, `env_mailbox_ok boolean`, `env_test_ok boolean`, `env_test_count smallint check (env_test_count between 0 and 5)`, `check ((env_test_ok and env_test_count between 1 and 5) or (not env_test_ok and env_test_count = 0) or (env_test_ok is null and env_test_count is null))`, `smtp_login_at timestamptz`, `smtp_login_code text check (smtp_login_code ~ '^[a-z][a-z0-9_]{0,79}$')`, `imap_login_at timestamptz`, `imap_login_code text` (stesso vincolo); `ok` vuol dire accesso riuscito.
  - `public.partner_assistant_messages`, con vincoli dal nome esplicito (la 2b li allargherà con `alter table`):
    - `id uuid pk default gen_random_uuid()`, `partner_id uuid not null references public.partners(id) on delete cascade`, `draft_id uuid not null references public.partner_assistant_drafts(id)`;
    - `kind text not null` (`partner_assistant_messages_kind_check`: solo `primo`), `mode text not null` (`…_mode_check`: `prova`, `invio`), `send_status text not null` (`…_status_check`: `pronto`, `in_invio`, `inviato`, `incerto`, `respinto`, `scartato`);
    - `test_run_id uuid references private.partner_assistant_test_runs(id)`, `test_index smallint check (test_index between 0 and 4)`, con `check ((mode = 'prova') = (test_run_id is not null and test_index is not null))`;
    - `message_id text not null unique check (message_id ~ '^<[0-9a-f-]{36}@[a-z0-9-]+(\.[a-z0-9-]+)+>$')`;
    - `to_address text not null check (char_length(to_address) <= 254 and to_address ~ '^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$')`;
    - `subject text not null` (1-300), `body text not null` (1-20.000: il testo composto, frase di uscita compresa), `raw text not null` con `check (octet_length(raw) <= 65536 and octet_length(raw) = char_length(raw))` (solo ASCII), `sha256 text not null` con `check (sha256 = encode(sha256(convert_to(raw, 'UTF8')), 'hex'))`;
    - `rules_version integer not null`, `lease_token uuid not null` (la lease della casella che l'ha preparato);
    - `send_day date` (giorno di Roma, obbligatorio per `in_invio`, `inviato`, `incerto`, `respinto`), `smtp_code smallint check (smtp_code between 200 and 599)`, `enhanced_code text check (enhanced_code ~ '^[245]\.[0-9]{1,3}\.[0-9]{1,3}$')`, `outcome text check (outcome ~ '^[a-z][a-z0-9_]{0,79}$')`, `sent_at timestamptz` (obbligatorio per `inviato` e `incerto`), `appended_at timestamptz` (solo con `inviato`);
    - `operation_id uuid not null unique`, `created_by uuid not null references public.profiles(user_id)`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`;
    - indice unico `partner_assistant_messages_one_first` su `(partner_id) where mode = 'invio' and kind = 'primo' and send_status in ('pronto','in_invio','inviato','incerto')` («mai due volte»); indice unico `partner_assistant_messages_one_test` su `(test_run_id, draft_id, test_index) where mode = 'prova' and send_status in ('pronto','in_invio','inviato','incerto')`; indici su `(to_address, created_at desc) where mode = 'invio'`, `(send_day) where send_day is not null`, `(partner_id, created_at desc)`, `(created_at desc)`.
- Produce, funzioni (`private`, `search_path = ''`; nessun grant salvo quelli indicati):
  - `private.partner_assistant_now() returns timestamptz stable`: `coalesce(nullif(current_setting('luckylap.partner_assistant.now', true), '')::timestamptz, now())`. Solo gli harness impostano il valore, nella transazione.
  - `private.partner_assistant_rome_day(p_at timestamptz) returns date immutable`: `(p_at at time zone 'Europe/Rome')::date`.
  - `private.partner_assistant_message_guard() returns trigger`, trigger `partner_assistant_messages_guard` `before update or delete`: `delete` solo con `luckylap.partner_assistant.erase = 'on'`; un `update` cambia solo `send_status` in avanti (`pronto → in_invio | scartato`; `in_invio → inviato | incerto | respinto | scartato`), `send_day`, `smtp_code`, `enhanced_code`, `outcome`, `sent_at`, `updated_at`, e `appended_at` da nullo a valorizzato su un `inviato`. Ogni altra modifica: `42501 partner_assistant_message_immutable`.
  - `private.partner_assistant_send_order() returns table (job_id uuid, partner_id uuid, co integer, draft_id uuid, research_at timestamptz, event_starts_on date, rank bigint)`, plpgsql (l'ordine arriva intatto, come `partner_assistant_queue`): i lavori `pronta` con bozza di contatti `partner_assistant_eligible`, numerati nell'ordine della coda dei vincoli globali (`coalesce(send_priority, 0) desc`, `nullif(scelta.content ->> 'event_starts_on', '')::date nulls last`, `ricerca.created_at`, `array_position(array['alta','media','bassa'], p.priority)`, `p.co`). La usano «Manda la prova» e il compito 2.
  - `create or replace private.partner_assistant_ranking(date)`: come `20261028122956` righe 89-100, con `coalesce((select s.send_priority from public.partner_assistant_contacts s where s.partner_id = p.id), 0) desc` come prima chiave (scelta 6).
  - `create or replace private.partner_assistant_erase(uuid)`: come oggi (`20261028122704` righe 192-206), con in più, per primi e con il flag acceso, `delete from public.partner_assistant_messages where partner_id = p_partner_id` (i messaggi puntano alle bozze senza `on delete`). Prima delle cancellazioni si guarda se la scheda ha un messaggio `mode = 'invio'` `in_invio` o `incerto`: in quel caso il motivo del lavoro diventa `invio_incerto` (anche se era già `serve_tommaso`), altrimenti resta la regola di oggi (scelta 12).
  - `create or replace private.partner_work_activity_trigger()`: l'ultima definizione (`20261023140414_partner_oggi_fixes.sql` righe 19-44) con tre cambiamenti, e poi la revoca di `20261023140414:147` ripetuta:
    - esce solo per origini diverse da `team`, `file`, `assistente`;
    - il controllo «invio o risposta più recente» conta `a.origin in ('team','assistente')`;
    - con origine `assistente` il promemoria «Sollecito · <nome>» va a `handoff_to` della configurazione (`assigned_to`; senza configurazione a `new.created_by`), con `created_by` del compito e del collegamento uguale a `new.created_by` (l'assistente); scadenza e descrizione come oggi.
  - `create or replace private.claim_partner_assistant_step(uuid, integer)` e `private.checkpoint_partner_assistant_step(uuid, uuid)`: copiate da `20261028122956` (righe 179-243 e 289-311) con `c.mode not in ('prepara','prova','invio')` al posto di `c.mode <> 'prepara'`; stesse risposte.
  - `create or replace private.set_partner_assistant_mode(uuid, jsonb)`: come oggi (`20261028122704` righe 261-305), salvo:
    - `prova` e `invio`: non founder → `42501 partner_assistant_founder_required` prima della ricevuta (come oggi); niente più `partner_assistant_mode_unavailable`;
    - dopo la configurazione `for update`: `prepara`, `prova` e `invio` senza `actor_id` o `handoff_to` → `55000 partner_assistant_not_configured`; `invio` con `test_confirmed_at` nullo → `55000 partner_assistant_test_required`;
    - `prepara`, `prova` e `invio` azzerano `paused_reason` e `backoff_until`; non toccano `mail_state`;
    - risultato `{id, version, mode, replayed}` come oggi.
  - `create or replace private.set_partner_assistant_contact(uuid, jsonb)`: come oggi, ma con `active = true` un lavoro `serve_tommaso` con `reason in ('conversazione_esistente','invio_incerto')` resta com'è (scelta 10).
  - `create or replace private.save_partner_assistant_rules(uuid, jsonb)`: come oggi (`20261028122704` righe 343-377), ma il predicato del requeue diventa `(j.status = 'pronta' or (j.step = 'controllo' and j.status not in ('serve_tommaso', 'inviata'))) and not exists (select 1 from public.partner_assistant_messages m where m.draft_id = j.draft_id and m.mode = 'invio' and m.send_status in ('pronto', 'in_invio', 'inviato', 'incerto'))`: un lavoro `inviata` resta al passo `controllo` e non deve tornare in scrittura.
- Produce, comandi del team (`(p_operation_id uuid, p_payload jsonb) returns jsonb`, `security definer`, attore `private.partner_actor()`, ricevuta con `partner_assistant_begin/finish`, wrapper `public` `security invoker`, `execute` solo ad `authenticated`):
  - `start_partner_assistant_test` («Manda la prova»): chiavi `schema_version, drafts, recipients`, `drafts` da 1 a 3, `recipients` da 1 a 5; founder (`42501 partner_assistant_founder_required`); configurazione `for share`, modalità `prova` (altrimenti `55000 partner_assistant_test_mode_required`); le prime `drafts` righe di `partner_assistant_send_order()` con `event_starts_on` nullo o dopo `partner_assistant_rome_day(partner_assistant_now())` (nessuna: `55000 partner_assistant_test_empty`); inserisce la riga in `test_runs` con le bozze in quell'ordine; evento `step = 'invio'`, `outcome = 'prova_avviata'`. Risultato `{id, test_run_id, drafts, recipients, replayed}` con `id = test_run_id` (`partnerCommandOutcome` vuole un `id`) e `drafts` = bozze davvero scelte.
  - `confirm_partner_assistant_test` («La prova è arrivata in posta in arrivo»): chiavi `schema_version, expected_version`; founder; configurazione `for update`, versione diversa → `40001 partner_changed`; senza un messaggio `mode = 'prova'` `inviato` → `55000 partner_assistant_test_missing`; `test_confirmed_at = now()`, `test_confirmed_by = attore`, `version + 1`. Risultato `{id, version, test_confirmed_at, replayed}`.
  - `set_partner_assistant_send_priority` («Manda per primo»): chiavi `schema_version, partner_id, send_priority` (0-9); founder; `partners` `for update` (non trovata: `22023 partner_not_found`); upsert su `partner_assistant_contacts` che conserva `active` e `reason` (riga nuova: `active = true`), `version + 1`, `updated_by`. Risultato `{id, partner_id, send_priority, version, replayed}`.
  - `resume_partner_assistant_send` («Riprendi l'invio»): chiavi `schema_version`; founder; solo `mail_state` `for update`: `stop_reason`, `stopped_at`, `backoff_until`, `day_stopped_on` nulli, `soft_failures` e `hard_failures` a 0; evento `step = 'invio'`, `outcome = 'invio_ripreso'`. Risultato `{id, status: 'ripreso', replayed}` con l'`id` di `mail_state`.
  - `set_partner_assistant_settings` (il limite dopo la prima settimana, Q10): chiavi `schema_version, expected_version, daily_first_limit` (da 1 a 15, altrimenti `22023 invalid_partner_payload`); founder; configurazione `for update`, versione diversa → `40001 partner_changed`; `daily_first_limit`, `version + 1`. Risultato `{id, version, daily_first_limit, replayed}`. La 2b ci aggiunge le sue chiavi come facoltative.
- Permessi: revoche e grant con un elenco esplicito di nomi, mai il ciclo `like '%partner_assistant%'` della M1.

- [ ] **Passo 1: scrivere l'harness che fallisce.** `assistente-partner-invio-comandi.mjs`, riga 1 `// test-db: pglite minimo 1`, con la struttura di `assistente-partner-worker.mjs` (righe 1-60 e il bootstrap 544-553). Catena per suffisso, in quest'ordine: i suffissi di `assistente-partner-worker.mjs:555-565`, poi `_assistente_partner_worker.sql`, poi `_assistente_partner_invio.sql`. Persone e profili come lì; `configure_partner_assistant(assistente, founder)` come `service_role`. Per prime si caricano le schede di `fixtures/partner-assistant/coda.json` (CO 951-970, come `assistente-partner-worker.mjs:591`) e si fa il controllo della classifica; tutti i contatti creati dopo hanno CO da 971 in su (`partners.co` è unico). Un helper `readyFirst(co, { tz, country, sendPriority, researchDaysAgo, eventStartsOn, email })` crea come proprietario scheda, recapito email (`info@club-<co>.example.test`), note `ricerca` e `scelta` (le 23 chiavi di `PARTNER_ASSISTANT_CHOICE_KEYS` più `request` e `decision`), bozza con l'impronta di `subject\n\nbody\n\nsignature`, nota `controllo` approvata con quell'impronta, e il lavoro `pronta` al passo `controllo`. `insertMessage` inserisce come proprietario e riempie `send_day` e `sent_at` dove lo stato li chiede. Controlli:

```js
ok(/^begin;$/m.test(sql) && /^commit;\s*$/m.test(sql)); eq(/create\s+extension/i.test(sql), false);
eq(/ai_disclosure/i.test(sql), false, "niente dichiarazione di IA");
// classifica, prima di ogni readyFirst: con priorità 0 l'ordine dei CO di coda.json è quello di oggi
const expectedOrder = fixture.partners.filter((p) => p.expected).sort((a, b) => a.expected - b.expected).map((p) => p.co);
const fixtureCos = new Set(fixture.partners.map((p) => p.co));
eq((await rankingCos("2026-10-27")).filter((co) => fixtureCos.has(co)), expectedOrder);
await setPriority(expectedOrder.at(-1), 9); eq((await rankingCos("2026-10-27"))[0], expectedOrder.at(-1)); await setPriority(expectedOrder.at(-1), 0);
eq(pick(await configRow(), ["daily_first_limit", "test_confirmed_at", "test_confirmed_by"]), { daily_first_limit: 10, test_confirmed_at: null, test_confirmed_by: null });
eq(pick(await mailState(), ["stop_reason", "lease_token", "soft_failures", "hard_failures", "day_stopped_on"]), { stop_reason: null, lease_token: null, soft_failures: 0, hard_failures: 0, day_stopped_on: null });
eq(pick(await mailState(), ["env_checked_at", "env_mailbox_ok", "env_test_ok", "env_test_count", "smtp_login_code", "imap_login_code"]), { env_checked_at: null, env_mailbox_ok: null, env_test_ok: null, env_test_count: null, smtp_login_code: null, imap_login_code: null });
ok((await mailState()).id);
await rejects(() => asOwner(`update private.partner_assistant_config set daily_first_limit = 16`), "23514");
await rejects(() => asOwner(`update public.partner_assistant_contacts set send_priority = 10`), "23514");
await rejects(() => asOwner(`update private.partner_assistant_mail_state set env_test_ok = true, env_test_count = 0`), "23514");
await setJob(p971, { status: "inviata" }); await rejects(() => setJob(p971, { status: "spedita" }), "23514");
await rejects(() => logAs(assistant, p971, { kind: "nota", origin: "robot" }), "23514");
// messaggi
const m = await insertMessage({ partner: p972, mode: "invio", send_status: "pronto" });
await rejects(() => insertMessage({ partner: p972, mode: "invio", send_status: "pronto" }), "23505"); // una sola prima email vera
await insertMessage({ partner: p972, mode: "prova", test_index: 0 }); // la prova non conta
await rejects(() => insertMessage({ partner: p973, raw: "Subject: è" }), "23514"); // raw solo ASCII
await rejects(() => insertMessage({ partner: p973, sha256: "0".repeat(64) }), "23514");
await rejects(() => insertMessage({ partner: p973, to_address: "Info@Club.example.test" }), "23514");
await rejects(() => asOwner(`update public.partner_assistant_messages set body = 'x' where id = '${m}'`), "42501");
await rejects(() => asOwner(`update public.partner_assistant_messages set send_status = 'inviato', sent_at = now(), send_day = current_date where id = '${m}'`), "42501", "partner_assistant_message_immutable"); // pronto → inviato salta in_invio
await asOwner(forward(m, "in_invio")); await asOwner(forward(m, "inviato"));
await rejects(() => asOwner(forward(m, "pronto")), "42501");
await rejects(() => asOwner(`delete from public.partner_assistant_messages where id = '${m}'`), "42501");
// modalità
await rejects(() => as("authenticated", consultant, () => cmd("set_partner_assistant_mode", { mode: "prova", expected_version: v() })), "42501");
eq((await as("authenticated", founder, () => cmd("set_partner_assistant_mode", { mode: "prova", expected_version: v() }))).mode, "prova");
await rejects(() => as("authenticated", founder, () => cmd("set_partner_assistant_mode", { mode: "invio", expected_version: v() })), "55000", "partner_assistant_test_required");
await asOwner(`update private.partner_assistant_config set paused_reason = 'credito'`);
await as("authenticated", founder, () => cmd("set_partner_assistant_mode", { mode: "prova", expected_version: v(), starting_credit_usd: 80.5 }));
eq((await configRow()).paused_reason, null, "prova toglie la pausa"); eq((await configRow()).starting_credit_usd, "80.50");
eq((await as("authenticated", consultant, () => cmd("set_partner_assistant_mode", { mode: "spento", expected_version: 1 }))).mode, "spento", "Spento vince anche con una versione vecchia");
// limite dopo la prima settimana
await rejects(() => cmd_consultant("set_partner_assistant_settings", { expected_version: v(), daily_first_limit: 8 }), "42501");
await rejects(() => cmd_founder("set_partner_assistant_settings", { expected_version: v(), daily_first_limit: 16 }), "22023");
await rejects(() => cmd_founder("set_partner_assistant_settings", { expected_version: v() - 1, daily_first_limit: 8 }), "40001");
const lim = await cmd_founder("set_partner_assistant_settings", { expected_version: v(), daily_first_limit: 8 });
eq([lim.daily_first_limit, (await configRow()).daily_first_limit, lim.version], [8, 8, v()]); ok(lim.id);
// Manda la prova
await rejects(() => cmd_founder("start_partner_assistant_test", { drafts: 2, recipients: 3 }), "55000", "partner_assistant_test_mode_required");
await setMode("prova");
await rejects(() => cmd_consultant("start_partner_assistant_test", { drafts: 2, recipients: 3 }), "42501");
await rejects(() => cmd_founder("start_partner_assistant_test", { drafts: 4, recipients: 3 }), "22023");
await rejects(() => cmd_founder("start_partner_assistant_test", { drafts: 1, recipients: 6 }), "22023");
await readyFirst(980); await readyFirst(981, { sendPriority: 9 }); await readyFirst(992, { sendPriority: 9, eventStartsOn: "2026-10-01" });
const run = await cmd_founder("start_partner_assistant_test", { drafts: 3, recipients: 3 });
eq(Object.keys(run).sort(), ["drafts", "id", "recipients", "replayed", "test_run_id"]); eq(run.id, run.test_run_id);
eq(run.drafts, 2); eq(await runDrafts(run.test_run_id), [draftOf(981), draftOf(980)], "send_priority prima, evento già iniziato escluso");
// conferma
await rejects(() => cmd_founder("confirm_partner_assistant_test", { expected_version: v() }), "55000", "partner_assistant_test_missing");
await insertMessage({ partner: p980, mode: "prova", test_run_id: run.test_run_id, test_index: 0, send_status: "inviato" });
await rejects(() => cmd_consultant("confirm_partner_assistant_test", { expected_version: v() }), "42501");
await rejects(() => cmd_founder("confirm_partner_assistant_test", { expected_version: v() - 1 }), "40001");
const conf = await cmd_founder("confirm_partner_assistant_test", { expected_version: v() });
ok(conf.test_confirmed_at); eq((await configRow()).test_confirmed_by, founder);
eq((await cmd_founder("set_partner_assistant_mode", { mode: "invio", expected_version: v() })).mode, "invio");
// priorità
await rejects(() => cmd_consultant("set_partner_assistant_send_priority", { partner_id: p982, send_priority: 9 }), "42501");
eq((await cmd_founder("set_partner_assistant_send_priority", { partner_id: p982, send_priority: 9 })).send_priority, 9);
eq((await switchRow(p982)).active, true, "riga nuova: attivo");
await setSwitch(p983, false); await cmd_founder("set_partner_assistant_send_priority", { partner_id: p983, send_priority: 9 });
eq((await switchRow(p983)).active, false, "la priorità non riaccende un contatto fermo");
// riprendi
await asOwner(`update private.partner_assistant_mail_state set stop_reason = 'rimbalzi', stopped_at = now(), hard_failures = 2, soft_failures = 3, day_stopped_on = current_date`);
await rejects(() => cmd_consultant("resume_partner_assistant_send", {}), "42501");
const resumed = await cmd_founder("resume_partner_assistant_send", {});
eq([resumed.status, resumed.id], ["ripreso", (await mailState()).id]);
eq(pick(await mailState(), ["stop_reason", "lease_token", "soft_failures", "hard_failures", "day_stopped_on"]), { stop_reason: null, lease_token: null, soft_failures: 0, hard_failures: 0, day_stopped_on: null });
eq((await lastEvent()).outcome, "invio_ripreso");
// giro dei passi in prova e invio
for (const mode of ["prova", "invio"]) { await setModeOwner(mode); eq((await claimStep()).status, "claimed"); await releaseStep(); }
await setModeOwner("spento"); eq((await claimStep()).reason, "spento"); eq(await checkpointReason(), "spento");
eq(Object.keys(await claimStepAfterSetMode("invio")).sort(), ["job", "status"], "stessa forma della consegna 1");
// interruttore e regole
await setJob(p984, { status: "serve_tommaso", reason: "conversazione_esistente" }); await setJob(p985, { status: "serve_tommaso", reason: "invio_incerto" }); await setJob(p986, { status: "serve_tommaso", reason: "troppi_tentativi" });
for (const p of [p984, p985, p986]) await cmd_consultant("set_partner_assistant_contact", { partner_id: p, active: true });
eq([(await job(p984)).status, (await job(p985)).status, (await job(p986)).status], ["serve_tommaso", "serve_tommaso", "in_coda"]);
await readyFirst(987); await readyFirst(988); await insertMessage({ partner: p987, mode: "invio", send_status: "pronto" });
await readyFirst(993); await insertMessage({ partner: p993, mode: "invio", send_status: "inviato" }); await setJob(p993, { status: "inviata" });
await cmd_consultant("save_partner_assistant_rules", { body: "Regole v2", expected_version: 1 });
eq((await job(p987)).status, "pronta", "un messaggio vivo protegge la bozza"); eq((await job(p988)).step, "scrittura");
eq([(await job(p993)).status, (await job(p993)).step], ["inviata", "controllo"], "un lavoro inviata non torna in scrittura");
// cancellazione definitiva
await readyFirst(989); await insertMessage({ partner: p989, mode: "invio", send_status: "pronto" }); await insertMessage({ partner: p989, mode: "prova", test_index: 1 });
await eraseContactOf(p989);
eq(await countRows(p989, ["messages", "drafts", "notes"]), 0); eq((await job(p989)).reason, "dato_cancellato");
await readyFirst(994); await insertMessage({ partner: p994, mode: "invio", send_status: "in_invio" }); await eraseContactOf(p994);
eq((await job(p994)).reason, "invio_incerto", "cancellata tra start e finish: l'email può essere partita");
await cmd_consultant("set_partner_assistant_contact", { partner_id: p994, active: true }); eq((await job(p994)).status, "serve_tommaso", "l'interruttore non la riprende");
// registro e promemoria per Tommi
await assistantFirstSend(p990, "2026-10-29T08:40:00Z"); // come finish: apply_partner_stage + partner_log(origin 'assistente') come assistente
const t = await followUpTask(p990);
eq([t.title, t.assigned_to, t.created_by, t.due_at], ["Sollecito · Club Sintetico 990", founder, assistant, "2026-11-04T23:00:00+00:00"]);
eq((await todayAs(founder, "2026-11-05")).reminders.map((r) => r.co), [990], "nell'Oggi di Tommi");
await teamSend(p991, "2026-10-29T09:00:00Z"); eq((await followUpTask(p991)).assigned_to, consultant, "invio del team: come oggi");
await teamBackdatedSend(p990, "2026-10-28T12:00:00Z"); eq(await followUpTaskCount(p990), 1, "l'invio dell'assistente è il più recente");
await teamReply(p990); eq((await followUpTask(p990)).status, "done", "una risposta chiude il promemoria");
await rerunOggiFixesCases(); // i casi di partner-oggi-fixes.mjs sulla definizione nuova: sollecito del file, invio retrodatato, chiusura con «Non contattare» e «chiuso»
// permessi
for (const f of ["start_partner_assistant_test", "confirm_partner_assistant_test", "set_partner_assistant_send_priority", "resume_partner_assistant_send", "set_partner_assistant_settings"]) {
  eq(await canExecute("authenticated", `public.${f}(uuid,jsonb)`), true); eq(await canExecute("anon", `public.${f}(uuid,jsonb)`), false); eq(await canExecute("service_role", `public.${f}(uuid,jsonb)`), false);
}
for (const r of ["anon", "authenticated", "service_role"]) eq(await canWrite(r, "public.partner_assistant_messages"), false);
eq(await canSelect("authenticated", "public.partner_assistant_messages"), true);
for (const t of ["partner_assistant_mail_state", "partner_assistant_test_runs"]) eq(await canSelect("authenticated", `private.${t}`), false);
eq(await canExecute("service_role", "private.partner_work_activity_trigger()"), false);
eq(await searchPathEmpty(NEW_AND_REPLACED_FUNCTIONS), true);
```

- [ ] **Passo 2:** `npm run test:db`. Atteso: FAIL su `assistente-partner-invio-comandi.mjs` (manca la migrazione).
- [ ] **Passo 3:** scrivere la sezione 1 della migrazione con tabelle, colonne, vincoli, funzioni e permessi delle Interfacce. Per le ridefinizioni copiare le ultime definizioni (prima `grep -l "function private.<nome>(" supabase/migrations/*.sql`: devono essere quelle citate) e cambiare solo dove indicato.
- [ ] **Passo 4:** `npm run test:db` → `PASS <n>` per l'harness nuovo, e passano invariati `assistente-partner.mjs`, `assistente-partner-worker.mjs`, `assistente-partner-scheduler.mjs`, `partner-oggi-fixes.mjs`. Portare la riga 1 al numero stampato e i quattro minimi di catena a 112, 114, 129, 181.
- [ ] **Passo 5:** commit (`Assistente Partner: dati e comandi della prova e dell'invio`), push.

### Compito 2: migrazione, sezione 2: calendario, coda e RPC d'invio

**File:**
- Modifica: `supabase/migrations/<ts>_assistente_partner_invio.sql` (sezione 2, stesso file: non è ancora in produzione)
- Crea: `supabase/tests/assistente-partner-invio.mjs` (PGlite), `supabase/tests/assistente-partner-invio-concurrency.mjs` (PostgreSQL 17)

**Interfacce:**
- Consuma: compito 1 (tabelle, `partner_assistant_now`, `partner_assistant_rome_day`, `partner_assistant_send_order`); consegna 1 (`partner_assistant_eligible`, `partner_assistant_begin/finish`, `partner_assistant_service_required`, `partner_assistant_as_actor`, `partner_log`, `apply_partner_stage`, `partner_blocked`).
- Produce, calendario e limiti (privati, nessun grant):
  - `private.partner_assistant_holidays(country_code text check (country_code ~ '^[A-Z]{2}$'), day date, primary key (country_code, day))` e `private.partner_assistant_countries(alias text primary key check (alias = lower(alias)), country_code text not null)`, con le righe dell'Appendice B.
  - `private.partner_assistant_country_code(p_country text) returns text`: l'alias di `lower(btrim(p_country))`, nullo se vuoto o sconosciuto.
  - `private.partner_assistant_valid_timezone(p_timezone text) returns boolean`, plpgsql: vero solo con `p_timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){1,2}$'` e `now() at time zone p_timezone` che non lancia (`exception when others`).
  - `private.partner_assistant_window_open(p_timezone text, p_country text, p_at timestamptz) returns boolean`: con il fuso (o `Europe/Rome` se non valido) l'ora locale `L = p_at at time zone fuso`; vero se `extract(isodow from L)` è tra 1 e 5, `L::time >= '09:30' and L::time < '11:00'`, la data locale è fuori dal 21 dicembre-7 gennaio e non è una festa di `partner_assistant_country_code(p_country)`.
  - `private.partner_assistant_next_window(p_at timestamptz) returns timestamptz`: `p_at` se la finestra di `Europe/Rome`, `Italia` è aperta; altrimenti il primo giorno, entro 40, alle 9:30 di Roma, dopo `p_at`, con la finestra aperta; nullo se nessuno.
  - `private.partner_assistant_address(p_value text) returns text immutable`: `lower(btrim(p_value))` se passa la regex stretta dei vincoli globali e sta in 254 caratteri, altrimenti nullo.
  - `private.partner_assistant_first_real_day() returns date`: il più vecchio `send_day` dei messaggi `invio` `primo` `inviato` o `incerto`.
  - `private.partner_assistant_first_limit(p_day date) returns integer`: 5 se non c'è ancora un primo invio vero o se `p_day <= primo + 6`; altrimenti `daily_first_limit`.
  - `private.partner_assistant_first_sent(p_day date) returns integer` (messaggi `invio` con `send_day = p_day` e stato `in_invio`, `inviato`, `incerto`) e `private.partner_assistant_test_sent(p_day date) returns integer` (lo stesso per `prova`).
  - `private.partner_assistant_mail_guard(p_lease_token uuid, p_strict boolean) returns boolean`: `select … from private.partner_assistant_mail_state for update`, poi vero se `lease_token = p_lease_token` e, con `p_strict`, `lease_expires_at > clock_timestamp()`. `finish` e `record_append` la chiamano con `p_strict = false` (il token basta: una lease nuova lo cambia).
  - `private.partner_assistant_count_failure(p_kind text) returns void` con `p_kind` tra `temporaneo`, `definitivo`, `spam`: con `failures_day` diverso da oggi (Roma) azzera i contatori e imposta il giorno; poi `temporaneo` → `soft_failures + 1`, al terzo `day_stopped_on = oggi` ed evento `fermo_oggi`; `definitivo` → `hard_failures + 1`, al secondo `stop_reason = 'rimbalzi'`; `spam` → subito `stop_reason = 'rimbalzi'`; con lo stop `stopped_at` ed evento `fermo_rimbalzi`.
- Produce, RPC del worker (private `security definer` + wrapper `public`, `execute` solo a `service_role`, ognuna apre con `partner_assistant_service_required()` e `partner_assistant_as_actor()`, esiti attesi come righe; tutte tranne `claim` e `record_partner_assistant_environment` controllano la lease con `mail_guard` e senza rispondono `{status: 'lease_persa'}`; eventi con `step = 'invio'`):
  - `claim_partner_assistant_send(p_worker_id uuid, p_lease_seconds integer, p_test_recipients integer) returns jsonb`. Argomenti: `p_lease_seconds` da 60 a 600, `p_test_recipients` da 0 a 5 (altrimenti `22023 invalid_partner_payload`). Nell'ordine:
    1. `mail_state` `for update`, `last_tick_at = clock_timestamp()`; configurazione `for share`;
    2. `idle` con `reason` = la modalità se è `spento` o `prepara`; `non_configurato` senza `actor_id` o `handoff_to`; `occupato` con una lease attiva;
    3. recupero dei giri morti (non c'è lease attiva): i messaggi `pronto` → `scartato` (`outcome = 'pronto_abbandonato'`); gli `in_invio` → `incerto` (`in_invio_abbandonato`, `sent_at = now`) e, per `invio`, il lavoro → `serve_tommaso` `invio_incerto`; evento `invio_abbandonato`. Prima le schede `for share`, poi i lavori `for update`, in ordine di `partner_id`;
    4. `appends`: al massimo 3 messaggi `inviato` (prova o invio) senza `appended_at` e con `sent_at` negli ultimi 7 giorni, `{message_row_id, message_id, raw, sent_at}`, solo con `stop_reason is distinct from 'casella'` e `(backoff_until is null or backoff_until <= partner_assistant_now())`: durante l'attesa gli arretrati non si ripropongono (Fuoco 5);
    5. i cancelli del candidato, nell'ordine: `stop_reason` → `fermo`; `day_stopped_on = oggi` → `fermo_oggi`; `backoff_until > now` → `attesa`; `next_send_after > now` → `intervallo`; capacità finita (`invio`: `first_sent(oggi) >= first_limit(oggi)`; `prova`: `test_sent(oggi) >= 15`) → `limite`;
    6. solo in **invio**, pulizia e candidato in una passata sull'ordine di `partner_assistant_send_order()`, senza limite di righe:
       - prima, senza lock, per ogni riga nell'ordine: il primo motivo definitivo dell'elenco sotto oppure nessuno, e se nessuno la finestra (fuso della scelta `content ->> 'timezone'`, `partners.country`). Il candidato è la prima riga senza motivo con la finestra aperta; si spostano **tutte** le righe con un motivo che vengono prima del candidato (tutte, se non c'è candidato);
       - poi le righe da spostare: schede `for share`, poi lavori `for update`, in ordine di `partner_id`, ricontrollando che siano ancora `pronta` con la stessa bozza, ognuna con un evento col motivo;
       - i motivi, nell'ordine:
         - ricerca di 21 giorni o più → `in_coda`, `ricerca`, puntatori, tentativi e riscritture azzerati (`ricerca_scaduta`);
         - recapito della bozza (`drafts.contact_id`) non più email attiva con `link_value` → `in_coda`, `scrittura`, `draft_id` nullo, `rewrites = 0` (`recapito_cambiato`);
         - `rules_version` della bozza sotto la versione più alta delle regole → `in_coda`, `scrittura` come `save_partner_assistant_rules` (`regole_superate`);
         - `event_starts_on` non nullo e `<= partner_assistant_rome_day(partner_assistant_now())` → `serve_tommaso` `bozza_scaduta` (Q15, scelta 15): un evento già iniziato non sale mai in testa alla coda;
         - `partner_assistant_address(link_value)` nullo → `serve_tommaso` `indirizzo_non_valido` (Fuoco 2): un candidato in invio non ha mai `address` nullo;
         - un messaggio `invio` di un'altra scheda allo stesso indirizzo, con stato `pronto`, `in_invio`, `inviato` o `incerto`, negli ultimi 365 giorni → `serve_tommaso` `conversazione_esistente` (Fuoco 1);
    7. candidato **invio**: quello del punto 6; nessuno → `fuori_finestra` se restano righe, altrimenti `vuota`. Candidato **prova**: dall'ultima riga di `test_runs`, le coppie (bozza nell'ordine del run, indice da 0 a `least(recipients, p_test_recipients) − 1`), bozza-prima: la prima coppia la cui bozza è ancora quella di un lavoro `pronta` e senza messaggi diversi da `scartato`; nessuna → `vuota`. Niente finestra, età della ricerca o date in prova;
    8. con un candidato: scheda `for share`, lavoro `for update skip locked` (preso: `vuota` a chi arriva secondo). Con un candidato o con i soli `appends`: nuova lease (`gen_random_uuid()`, scadenza `clock_timestamp() + p_lease_seconds`), perché `record_partner_assistant_append` la controlla.
    Risultato `{status: 'idle', reason}` (motivi: `spento`, `prepara`, `non_configurato`, `occupato`, `fermo`, `fermo_oggi`, `attesa`, `intervallo`, `limite`, `fuori_finestra`, `vuota`) quando non ci sono né `appends` né candidato; altrimenti `{status: 'claimed', lease_token, mode, appends, candidate}`, con `candidate` nullo o a chiavi esatte `{job_id, partner_id, co, name, mode, draft: {draft_id, language, subject, body, signature, sha256, rules_version, created_at}, choice: {contact_kind, request, event_starts_on}, register, address, test_run_id, test_index}`. `register` e `choice` dalla nota `scelta` (`event_starts_on` stringa vuota se manca, come in `choice.ts`); `address` = `partner_assistant_address` del recapito della bozza (in prova nullo se il recapito non c'è più); `test_run_id` e `test_index` nulli in invio.
  - `skip_partner_assistant_send(p_lease_token uuid, p_job_id uuid, p_reason text) returns jsonb`. `mail_guard` stretta, configurazione `for share`, poi scheda `for share` e lavoro `for update`:
    - `conversazione_esistente` → `serve_tommaso` con quel motivo (solo in invio; in prova solo l'evento);
    - `bozza_scaduta` (solo in invio, dal ricontrollo del compito 5): evento già iniziato → `serve_tommaso` `bozza_scaduta`; altrimenti con `rewrites = 0` e `paused_reason is distinct from 'credito'` → `in_coda`, `scrittura`, `draft_id` nullo, `rewrites = 1`, tentativi azzerati; altrimenti `serve_tommaso` `bozza_scaduta` (Q15, scelta 19 del piano completo);
    - `casella_incerta` → `backoff_until = now + 15 minuti` ed evento, il lavoro resta; è l'unico motivo che accetta `p_job_id` nullo (una copia arretrata che non si chiude).
    Il lavoro deve essere ancora `pronta` (altrimenti niente, solo l'evento). Gli argomenti si controllano prima della lease: altri motivi, o `p_job_id` nullo con un altro motivo, `22023`. Risultato `{status: 'done'}`.
  - `prepare_partner_assistant_send(p_lease_token uuid, p_operation_id uuid, p_payload jsonb) returns jsonb`. Chiavi `schema_version, job_id, draft_id, mode, test_run_id, test_index, message_id, to_address, subject, text, opt_out, raw, mailbox_check`, con `mailbox_check` tra `vuota`, `trovata`, `incerta`. `mail_guard` stretta, configurazione `for share`, scheda `for share`, lavoro `for update`, poi i controlli, nell'ordine, con il primo rifiuto come `reason`:
    - `modalita_cambiata`: `mode` diverso da quella in vigore, oppure coppia di prova incoerente (in prova `test_run_id`, `test_index` presenti e la bozza nel run; in invio nulli);
    - `fermo`: `stop_reason`, `day_stopped_on = oggi` o `backoff_until` futuro;
    - `bozza_cambiata`: il lavoro non è più `pronta` con `draft_id`;
    - `impronta`: l'impronta di `subject\n\nbody\n\nsignature` della bozza diversa dalla bozza o da una nota `controllo` approvata dopo la bozza; `subject` del payload diverso dall'oggetto della bozza; `text` diverso da `body || E'\n\n' || signature || E'\n\n' || opt_out`; `opt_out` fuori forma (`^[^\r\n<>@]{20,240}$`, senza `http` e senza cifre); `raw` senza la riga `E'\r\nMessage-ID: ' || message_id || E'\r\n'`;
    - solo in invio: `non_idoneo` (`partner_assistant_eligible`), `recapito_cambiato` (`to_address` diverso da `partner_assistant_address` del recapito attivo della bozza), `regole_superate`, `ricerca_scaduta` (21 giorni), `bozza_scaduta` (evento già iniziato, come al punto 6), `conversazione_esistente` (lo stesso indirizzo su un'altra scheda, come al punto 6), `casella` (`mailbox_check` diverso da `vuota`), `limite`, `finestra_chiusa`;
    - solo in prova: `destinatario_prova` (`to_address` uguale a un `lower(link_value)` di qualunque recapito Partner), `limite` (15 al giorno).
    Poi l'inserimento del messaggio `pronto` (`body = text`, `sha256` del `raw`, `lease_token`, `created_by` = assistente); una violazione di unicità diventa `doppione`. In prova un evento `prova_casella_<mailbox_check>`. Rifiuti che spostano il lavoro nella stessa transazione: `impronta`, `bozza_scaduta` e `conversazione_esistente` → `serve_tommaso` con quel motivo; `regole_superate` e `recapito_cambiato` → `in_coda`, `scrittura`; `ricerca_scaduta` → `in_coda`, `ricerca`. Risultato `{status: 'pronto', message_row_id}` oppure `{status: 'rifiutato', reason}`.
  - `start_partner_assistant_send(p_lease_token uuid, p_message_row_id uuid) returns jsonb`: `mail_guard` stretta, configurazione `for share` (aspetta un «Ferma l'assistente» in corso), scheda `for share` (aspetta un «Non contattare» in corso), lavoro `for update` (aspetta un `save_partner_assistant_rules` in corso). Messaggio `pronto` della lease; lavoro ancora `pronta` con `draft_id` del messaggio, altrimenti `bozza_cambiata`; modalità ancora quella del messaggio, nessun fermo; in invio anche `partner_assistant_eligible`, recapito invariato e finestra aperta. Va: `in_invio`, `send_day = oggi di Roma` → `{status: 'in_invio'}`. Non va: `scartato` con `outcome` = motivo → `{status: 'stop', reason}` (Fuoco 3).
  - `finish_partner_assistant_send(p_lease_token uuid, p_operation_id uuid, p_payload jsonb) returns jsonb`. Chiavi `schema_version, message_row_id, outcome, smtp_code, enhanced_code, spam, reason`: `outcome` tra `inviato`, `incerto`, `respinto`, `scartato`; con `scartato`, `reason` tra `smtp_temporaneo`, `smtp_non_partito`, `smtp_credenziali`, `smtp_bloccato`; altrimenti `reason` è un codice o nullo. Ricevuta `partner_assistant_begin/finish` (un secondo arrivo risponde `replayed`). `mail_guard` non stretta, scheda `for update`, lavoro `for update`; messaggio `in_invio` della lease, altrimenti (anche sparito) `{status: 'lease_persa'}`. Effetti:
    - sempre: stato, `smtp_code`, `enhanced_code`, `outcome = reason`; `sent_at = now` per `inviato` e `incerto`; dopo `inviato`, `incerto` e `respinto` `next_send_after = partner_assistant_now() + make_interval(secs => 240 + floor(random() * 421))`;
    - `inviato` in invio: `apply_partner_stage(scheda, 'contattato', assistente, op, false)` se è `da_contattare`, poi `partner_log(op, scheda, 'inviato', assistente, p_stage_before, p_stage_after, p_channel => 'email', p_message_kind => 'primo', p_body => '', p_origin => 'assistente')` (il trigger del compito 1 crea il promemoria per Tommi); lavoro `inviata`, senza lease né motivo;
    - `inviato` in prova: solo il messaggio ed evento `prova_inviata`; il lavoro resta `pronta`;
    - `incerto`: in invio il lavoro → `serve_tommaso` `invio_incerto`; mai un nuovo tentativo;
    - `respinto`: `enhanced_code` `5.7.x` o `spam` → `count_failure('spam')`; altrimenti `count_failure('definitivo')`; in invio il lavoro → `serve_tommaso` `indirizzo_non_valido` con `5.1.x`, `invio_rifiutato` con gli altri;
    - `scartato`: `smtp_temporaneo` e `smtp_non_partito` → `count_failure('temporaneo')`; `smtp_bloccato` → `count_failure('spam')`; `smtp_credenziali` → `stop_reason = 'casella'`, `stopped_at`, evento `fermo_casella`; il lavoro resta `pronta`.
    Risultato `{status: 'done', send_status, replayed}`.
  - `record_partner_assistant_append(p_lease_token uuid, p_message_row_id uuid, p_payload jsonb) returns jsonb`: chiavi `schema_version, found` (booleano: la copia c'era già); `mail_guard` non stretta, scheda `for share`; `appended_at = now` su un `inviato` senza copia. Risultato `{status: 'done'}`.
  - `pause_partner_assistant_send(p_lease_token uuid, p_reason text) returns jsonb`: solo `casella` (credenziali IMAP rifiutate): `stop_reason`, `stopped_at`, evento `fermo_casella`. Risultato `{status: 'done', stop_reason}`.
  - `release_partner_assistant_send(p_lease_token uuid, p_payload jsonb) returns jsonb`: chiavi `schema_version, outcome, smtp_login, imap_login`; `outcome` un codice, `smtp_login` e `imap_login` nulli (nessun accesso in questo giro) o codici (`ok` = accesso riuscito), altrimenti `22023`. Toglie la lease, `last_outcome = outcome`; un accesso non nullo scrive `<smtp|imap>_login_at = now()` e `<smtp|imap>_login_code`. Risultato `{status: 'done'}`.
  - `record_partner_assistant_environment(p_payload jsonb) returns jsonb` (perimetro, punto 7): senza lease, nessun altro lock che `mail_state` `for update`; chiavi `schema_version, mailbox_ok, test_ok, test_count` (booleani, `test_count` da 0 a 5, `test_ok` vero se e solo se `test_count` è da 1 a 5, altrimenti `22023`); scrive `env_mailbox_ok`, `env_test_ok`, `env_test_count`, `env_checked_at = now()`. Il worker la chiama a ogni giro dopo il controllo del bearer, anche senza posta. Risultato `{status: 'done'}`.
- Produce, lettura (`authenticated`, membro attivo con `private.partner_actor()`, altrimenti `42501 partner_access_required`, wrapper `public`): `read_partner_assistant_send() returns jsonb`, chiavi esatte:
  - `stop_reason, stopped_at, day_stopped_on, backoff_until, next_send_after, last_tick_at, last_outcome`;
  - `daily_first_limit, first_limit_today, first_sent_today, first_real_send_on, test_sent_today, test_limit` (15);
  - `test_confirmed_at, test_confirmed_by` (nome del profilo o nullo), `test_run: {requested_at, drafts, recipients, sent} | null` (l'ultimo; `sent` = suoi messaggi `inviato`);
  - `window_open_rome` (finestra di `Europe/Rome`, `Italia`), `next_window_rome`;
  - `ready` (righe di `send_order`);
  - `env_checked_at, env_mailbox_ok, env_test_ok, env_test_count, smtp_login_at, smtp_login_code, imap_login_at, imap_login_code` (mai valori delle variabili né lunghezze);
  - `recent`: gli ultimi 20 messaggi, il più recente prima, `{at, co, name, mode, status, subject}` con `at = coalesce(sent_at, created_at)`, senza indirizzi;
  - `priorities`: al massimo 50 `{co, name, send_priority}` con priorità maggiore di 0.

- [ ] **Passo 1: harness PGlite che fallisce.** `assistente-partner-invio.mjs`, riga 1 `// test-db: pglite minimo 1`, catena del compito 1, stessi helper (`readyFirst` e `insertMessage` compresi; qui senza `coda.json`, quindi CO da 951). Regole degli helper, perché ogni controllo dipende dall'ora e dalla lease:
  - `atTime(iso, fn)` apre la transazione con `set_config('luckylap.partner_assistant.now', iso, true)`. `claimAt(at, testRecipients = 0)`, `finishAt(at, …)` e gli altri `…At` fissano `lastAt = at`; **ogni** RPC d'invio senza ora esplicita (`prepare`, `start`, `finish`, `skip`, `release`, `recordAppend`, `recordEnv`) gira in `atTime(lastAt, …)`, mai con l'ora vera.
  - Le lease usano `clock_timestamp()` e durano 300 secondi veri: una lease «scade» (`expireLease()`) portando come proprietario `mail_state.lease_expires_at` nel passato; `release()` senza argomenti rilascia la lease tenuta.
  - `onlyQueue(...cos)`: come proprietario `partner_assistant_contacts.active = true` per quei CO e `false` per ogni altra scheda con un lavoro `pronta`, senza toccare i lavori. `candidateAt(at, co)`: rilascia la lease tenuta (o la fa scadere se è di un giro «morto» voluto), `onlyQueue(co)`, `claimAt(at)` e controlla che il candidato sia `co`.
  - `resetSendClock()`: come proprietario `next_send_after = null`. Ogni gruppo di casi «nello stesso giorno» comincia con `resetSendClock()` e usa orari espliciti, mai `nextOpen()`.
  - `nextOpen()` è il primo istante con la finestra di Roma aperta dopo `next_send_after` e dopo `lastAt`. `lastAt` parte da `2026-11-10T06:00:00Z`. `readyFirst(co)` senza opzioni usa `{ tz: "Europe/Rome", country: "Italia", researchDaysAgo: 1 }`, e le date che scrive (ricerca, bozza, nota `controllo`) contano da `lastAt`, mai dall'ora vera: così l'età della ricerca non dipende dal giorno in cui gira la CI.
  - `sendUntilStart(co, at)` fa `readyFirst(co)` se la scheda non c'è, `candidateAt(at, co)`, `prepare` con un controllo dei 12 mesi vuoto e `start`, e tiene la lease. `sendAll(co, { at, append = true })` fa `sendUntilStart`, `finish(inviato)`, `recordAppend` solo con `append`, poi sempre `release`.
  - `claimAt` non rilascia niente da sé (il caso `occupato` lo vuole): prima di un `claimAt` con una lease tenuta c'è un `release()` esplicito. `sendFirstsOn(day, n)` e `sendTests(n, day)` inseriscono come proprietario messaggi `inviato` già copiati (`appended_at` valorizzato).
  - Prima di attendere un `idle` dopo un `inviato`, la copia si segna con `recordAppend`: altrimenti il claim risponde `claimed` con gli `appends`.

  Controlli:

```js
const open = (tz, country, at) => fn(`private.partner_assistant_window_open('${tz}', '${country}', '${at}')`);
eq(await open("Europe/Rome", "Italia", "2026-11-10T08:29:00Z"), false); // 9:29
eq(await open("Europe/Rome", "Italia", "2026-11-10T08:30:00Z"), true);  // 9:30
eq(await open("Europe/Rome", "Italia", "2026-11-10T09:59:00Z"), true);  // 10:59
eq(await open("Europe/Rome", "Italia", "2026-11-10T10:00:00Z"), false); // 11:00
eq(await open("Europe/Rome", "Italia", "2026-10-29T08:30:00Z"), true, "giovedì 29 ottobre, ora solare");
eq(await open("Europe/London", "Regno Unito", "2026-11-10T09:30:00Z"), true); eq(await open("Europe/London", "Regno Unito", "2026-11-10T08:30:00Z"), false);
eq(await open("Europe/Rome", "Italia", "2026-10-31T09:00:00Z"), false, "sabato");
eq(await open("Europe/Rome", "Italia", "2026-12-08T09:00:00Z"), false); eq(await open("Europe/London", "Regno Unito", "2026-12-08T10:00:00Z"), true);
eq(await open("Europe/Paris", "Francia", "2026-11-11T09:00:00Z"), false); eq(await open("Europe/Rome", "Italia", "2026-11-11T09:00:00Z"), true);
eq(await open("Europe/Rome", "", "2026-12-08T09:00:00Z"), true, "senza paese nessuna festa");
eq(await open("", "Italia", "2026-11-10T08:30:00Z"), true, "senza fuso: Roma"); eq(await open("Mars/Base", "Italia", "2026-11-10T08:30:00Z"), true);
eq(await open("Europe/Rome", "Italia", "2026-12-21T09:00:00Z"), false); eq(await open("Europe/Rome", "Italia", "2027-01-07T09:00:00Z"), false); eq(await open("Europe/Rome", "Italia", "2027-01-08T09:00:00Z"), true);
eq(await code(" Regno Unito "), "GB"); eq(await code("germania"), "DE"); eq(await code("Narnia"), null);
eq(await holidayCounts(), { IT: 2, AT: 2, FR: 2, ES: 3, BE: 2 }); ok(await holidaysBetween("2026-10-29", "2027-01-31")); ok(await holidaysOutside("12-21", "01-07"));
eq(await nextWindow("2026-10-31T10:00:00Z"), "2026-11-02T08:30:00+00:00", "sabato: lunedì alle 9:30");
eq(await firstLimit("2026-10-29"), 5); await realFirstSent("2026-10-29", 5);
eq(await firstLimit("2026-11-04"), 5); eq(await firstLimit("2026-11-05"), 10); await setDailyLimit(15); eq(await firstLimit("2026-11-05"), 15); await resetSends(); await setDailyLimit(10);
// modalità
await setModeOwner("prepara"); eq((await claimAt("2026-11-10T08:30:00Z")).reason, "prepara"); await setModeOwner("spento"); eq((await claimAt("2026-11-10T08:30:00Z")).reason, "spento");
await confirmTestOwner(); await setModeOwner("invio");
await readyFirst(951); await readyFirst(952, { sendPriority: 9 });
eq((await claimAt("2026-11-10T06:00:00Z")).reason, "fuori_finestra", "7:00 a Roma");
const c = (await claimAt("2026-11-10T08:30:00Z")).candidate;
eq(c.co, 952, "send_priority prima"); eq(Object.keys(c).sort(), CANDIDATE_KEYS); eq(c.address, "info@club-952.example.test"); eq([c.test_run_id, c.test_index], [null, null]);
eq(Object.keys(c.choice).sort(), ["contact_kind", "event_starts_on", "request"]); ok(c.draft.created_at);
eq((await claimAt("2026-11-10T08:30:30Z")).reason, "occupato");
eq((await prepare(c, { mailbox_check: "trovata" })).reason, "casella", "in invio solo dopo un controllo vuoto");
const p = await prepare(c); eq(p.status, "pronto");
eq((await prepare(c, { message_id: newId(), operation_id: newOp() })).reason, "doppione");
eq((await start(p)).status, "in_invio");
eq((await finishAt("2026-11-10T08:31:00Z", p, { outcome: "inviato", smtp_code: 250 })).send_status, "inviato");
eq((await finish(p, { outcome: "inviato", smtp_code: 250 })).replayed, true);
eq((await partner(p952)).stage, "contattato"); eq((await job(p952)).status, "inviata");
eq((await activities(p952)).at(-1), { kind: "inviato", origin: "assistente", message_kind: "primo", channel: "email", body: "", stage_before: "da_contattare", stage_after: "contattato" });
eq((await followUpTask(p952)).assigned_to, founder); ok(between(await nextSendAfterMinutes("2026-11-10T08:31:00Z"), 4, 11));
await release({ outcome: "inviato", smtp_login: "ok", imap_login: "ok" });
eq(pick(await mailState(), ["smtp_login_code", "imap_login_code", "last_outcome"]), { smtp_login_code: "ok", imap_login_code: "ok", last_outcome: "inviato" }); ok((await mailState()).smtp_login_at);
const a = await claimAt("2026-11-10T08:32:00Z");
eq([a.status, a.candidate, a.appends.map((x) => x.message_row_id)], ["claimed", null, [p.message_row_id]], "copia in Posta inviata da fare, intervallo in corso");
await recordAppend(p, { found: false }); await release(); ok((await message(p)).appended_at);
eq((await claimAt("2026-11-10T08:33:00Z")).reason, "intervallo");
// impronta e testo dopo la firma: un contatto per caso, perché impronta passa il lavoro a Tommi
await readyFirst(953); const c953 = await candidateAt("2026-11-10T09:00:00Z", 953);
eq((await prepare(c953, { text: approvedText(c953) + "\n\nhttps://altro.example.test" })).reason, "impronta"); eq((await job(p953)).reason, "impronta");
await readyFirst(954); const c954 = await candidateAt("2026-11-10T09:05:00Z", 954);
eq((await prepare(c954, { subject: "[Prova] " + c954.draft.subject })).reason, "impronta", "l'oggetto è quello della bozza");
await readyFirst(959); const c959 = await candidateAt("2026-11-10T09:10:00Z", 959);
eq((await prepare(c959, { opt_out: "Chiama il 333 0000000" })).reason, "impronta", "frase di uscita fuori forma");
// Fuoco 3: fermi tra prepare e SMTP
await readyFirst(955); const q = await prepare(await candidateAt("2026-11-10T09:15:00Z", 955));
await setModeOwner("spento"); eq((await start(q)).status, "stop"); eq((await message(q)).send_status, "scartato"); await setModeOwner("invio");
await readyFirst(956); const r956 = await prepare(await candidateAt("2026-11-10T09:20:00Z", 956));
await dncAs(consultant, p956); eq((await start(r956)).status, "stop", "Non contattare dopo la preparazione");
await readyFirst(973); const r973 = await prepare(await candidateAt("2026-11-10T09:25:00Z", 973));
await switchOff(p973); eq((await start(r973)).status, "stop");
await readyFirst(974); const r974 = await prepare(await candidateAt("2026-11-10T09:30:00Z", 974));
await requeueJob(p974); eq(await start(r974), { status: "stop", reason: "bozza_cambiata" }, "regole nuove salvate dopo prepare");
// Fuoco 4: giro morto dopo start
await readyFirst(957); const u = await prepare(await candidateAt("2026-11-11T08:40:00Z", 957)); await start(u); await expireLease();
await claimAt("2026-11-11T09:00:00Z"); eq((await message(u)).send_status, "incerto"); eq((await message(u)).outcome, "in_invio_abbandonato");
eq((await job(p957)).reason, "invio_incerto"); await rejects(() => insertMessage({ partner: p957, mode: "invio", send_status: "pronto" }), "23505"); // mai una seconda prima email
await readyFirst(958); const w = await prepare(await candidateAt("2026-11-11T09:10:00Z", 958)); await expireLease();
await claimAt("2026-11-11T09:20:00Z"); eq((await message(w)).send_status, "scartato"); eq((await job(p958)).status, "pronta");
// Fuoco 1: stesso indirizzo su due schede, anche prima della copia in Posta inviata
await resetSendClock(); await readyFirst(960, { email: "info@raduno-960.example.test" }); await sendAll(960, { at: "2026-11-11T09:30:00Z", append: false });
await readyFirst(961, { email: "info@raduno-960.example.test" }); await onlyQueue(961); await claimAt("2026-11-11T09:45:00Z");
eq((await job(p961)).reason, "conversazione_esistente"); eq(await liveMessages(p961), 0);
await recordAppend(await lastMessage(p960), { found: false }); await release();
// Fuoco 2: indirizzi della scheda
await readyFirst(962, { email: "Info@Club-962.Example.Test" }); eq((await candidateAt(nextOpen(), 962)).address, "info@club-962.example.test"); await release();
await readyFirst(963, { email: "o'neil@club-963.example.test" }); await onlyQueue(963); await claimAt(nextOpen()); eq((await job(p963)).reason, "indirizzo_non_valido");
// pulizia, fino al candidato, oltre le prime 20 righe
await readyFirst(964, { researchDaysAgo: 22 }); await onlyQueue(964); await claimAt(nextOpen()); eq([(await job(p964)).status, (await job(p964)).step, (await job(p964)).draft_id], ["in_coda", "ricerca", null]);
await readyFirst(965); await deactivateDraftContact(p965); await onlyQueue(965); await claimAt(nextOpen()); eq((await job(p965)).step, "scrittura");
for (let co = 1001; co <= 1021; co++) await readyFirst(co, { tz: "America/Los_Angeles", researchDaysAgo: 10 }); // 21 righe con la finestra chiusa
await readyFirst(975, { email: "o'hara@club-975.example.test", researchDaysAgo: 5 }); await readyFirst(976, { researchDaysAgo: 1 });
await onlyQueue(...range(1001, 1021), 975, 976); await release();
eq((await claimAt(nextOpen())).candidate.co, 976); eq((await job(p975)).reason, "indirizzo_non_valido", "la ventitreesima riga è pulita prima del candidato");
// Q15: un evento già iniziato non parte e non sale in testa alla coda
await readyFirst(977, { eventStartsOn: "2026-11-09" }); await readyFirst(978, { eventStartsOn: "2026-12-20" }); await onlyQueue(977, 978); await release();
eq((await claimAt(nextOpen())).candidate.co, 978); eq([(await job(p977)).status, (await job(p977)).reason], ["serve_tommaso", "bozza_scaduta"]);
// limiti del giorno e capacità
await release(); await sendFirstsOn("2026-11-12", 5); eq((await claimAt("2026-11-12T09:30:00Z")).reason, "limite");
// esiti SMTP, tutti martedì 17 novembre
await resetSendClock(); await finish(await sendUntilStart(966, "2026-11-17T08:31:00Z"), { outcome: "respinto", smtp_code: 550, enhanced_code: "5.1.1", spam: false });
eq((await job(p966)).reason, "indirizzo_non_valido"); eq((await mailState()).hard_failures, 1);
await resetSendClock(); await finish(await sendUntilStart(967, "2026-11-17T08:40:00Z"), { outcome: "respinto", smtp_code: 554, enhanced_code: "5.5.0", spam: false });
eq((await mailState()).stop_reason, "rimbalzi", "due rifiuti definitivi nello stesso giorno"); await release(); eq((await claimAt("2026-11-17T08:50:00Z")).reason, "fermo"); await resumeAsFounder();
await resetSendClock(); await finish(await sendUntilStart(968, "2026-11-17T08:55:00Z"), { outcome: "respinto", smtp_code: 554, enhanced_code: "5.7.1", spam: true }); eq((await mailState()).stop_reason, "rimbalzi"); await resumeAsFounder();
for (const t of ["09:00", "09:05", "09:10"]) { await resetSendClock(); await finish(await sendUntilStart(969, `2026-11-17T${t}:00Z`), { outcome: "scartato", reason: "smtp_temporaneo", smtp_code: 450 }); }
eq((await job(p969)).status, "pronta", "4.x.x: si riprova"); await release(); eq((await claimAt("2026-11-17T09:20:00Z")).reason, "fermo_oggi"); ok((await claimAt("2026-11-18T08:30:00Z")).candidate);
await resetSendClock(); await finish(await sendUntilStart(970, "2026-11-18T08:40:00Z"), { outcome: "scartato", reason: "smtp_credenziali" }); eq((await mailState()).stop_reason, "casella"); await resumeAsFounder();
await resetSendClock(); await finish(await sendUntilStart(971, "2026-11-18T08:45:00Z"), { outcome: "incerto" }); eq((await job(p971)).reason, "invio_incerto");
await resetSendClock(); await finish(await sendUntilStart(979, "2026-11-18T08:50:00Z"), { outcome: "scartato", reason: "smtp_bloccato" });
eq((await mailState()).stop_reason, "rimbalzi"); eq((await job(p979)).status, "pronta", "bloccato non tocca il contatto"); await resumeAsFounder();
// Fuoco 5: «non so» della casella
await resetSendClock(); await readyFirst(972); await skip(await candidateAt("2026-11-18T09:00:00Z", 972), "casella_incerta"); await release();
eq((await claimAt("2026-11-18T09:10:00Z")).reason, "attesa"); ok((await claimAt("2026-11-18T09:16:00Z")).candidate);
await skip(await candidateAt("2026-11-18T09:17:00Z", 972), "conversazione_esistente"); eq((await job(p972)).reason, "conversazione_esistente");
await resetSendClock(); await sendAll(983, { at: "2026-11-18T09:20:00Z", append: false });
const ap = await claimAt("2026-11-18T09:35:00Z"); eq(ap.appends.length, 1);
await skip(null, "casella_incerta"); await release(); // copia arretrata non chiusa: attesa senza lavoro
eq((await claimAt("2026-11-18T09:45:00Z")).status, "idle", "in attesa niente appends: il passo con Claude può girare");
eq((await claimAt("2026-11-18T09:51:00Z")).appends.length, 1, "dopo 15 minuti la copia si riprova"); await release();
await rejects(() => skip(null, "conversazione_esistente"), "22023");
// Q15: bozza scaduta dal ricontrollo del compito 5
await resetSendClock(); await readyFirst(984); await skip(await candidateAt("2026-11-19T08:30:00Z", 984), "bozza_scaduta");
eq(pick(await job(p984), ["status", "step", "rewrites", "draft_id"]), { status: "in_coda", step: "scrittura", rewrites: 1, draft_id: null });
await readyFirst(985); await setJobOwner(p985, { rewrites: 1 }); await skip(await candidateAt("2026-11-19T08:35:00Z", 985), "bozza_scaduta");
eq([(await job(p985)).status, (await job(p985)).reason], ["serve_tommaso", "bozza_scaduta"], "la seconda volta a Tommi");
await asOwner(`update private.partner_assistant_config set paused_reason = 'credito'`); await readyFirst(986); await skip(await candidateAt("2026-11-19T08:40:00Z", 986), "bozza_scaduta");
eq((await job(p986)).reason, "bozza_scaduta", "senza credito niente riscrittura"); await asOwner(`update private.partner_assistant_config set paused_reason = null`); await release();
// prova, dopo gli invii veri: next_send_after non è nel futuro
await setModeOwner("prova"); await resetSendClock(); await readyFirst(980); await readyFirst(981); await onlyQueue(980, 981);
const run = await startTestAs(founder, { drafts: 2, recipients: 3 });
const t0 = (await claimAt("2026-11-19T20:00:00Z", 3)).candidate; eq([t0.co, t0.test_index], [980, 0], "prova: niente finestra"); ok(t0.address);
eq((await prepare(t0, { to_address: "info@club-981.example.test" })).reason, "destinatario_prova");
eq((await prepare(t0, { mode: "invio" })).reason, "modalita_cambiata");
const tp = await prepare(t0, { to_address: "prova1@example.test", mailbox_check: "trovata" }); eq(tp.status, "pronto", "in prova il controllo non blocca"); eq((await lastEvent()).outcome, "prova_casella_trovata");
await start(tp); await finish(tp, { outcome: "inviato", smtp_code: 250 }); await recordAppend(tp, { found: false }); await release();
eq((await job(p980)).status, "pronta"); eq((await partner(p980)).stage, "da_contattare"); eq(await activityCount(p980), 0); eq(await followUpTaskCount(p980), 0);
eq((await claimAt("2026-11-19T20:02:00Z", 3)).reason, "intervallo");
eq(await testPairsInOrder(run, 3), [[980, 1], [980, 2], [981, 0], [981, 1], [981, 2]]);
eq(await testPairsInOrder(run, 2), [[980, 1], [981, 0], [981, 1]], "indirizzi di prova scesi a 2: l'indice 2 non parte");
await requeueJob(p981); eq(await testPairsInOrder(run, 3), [[980, 1], [980, 2]], "bozza cambiata: la coppia non parte");
await sendTests(15, "2026-11-20"); eq((await claimAt("2026-11-20T15:00:00Z", 3)).reason, "limite");
// variabili e accessi
await recordEnv({ mailbox_ok: true, test_ok: true, test_count: 4 });
eq(pick(await sendAs(consultant), ["env_mailbox_ok", "env_test_ok", "env_test_count"]), { env_mailbox_ok: true, env_test_ok: true, env_test_count: 4 }); ok((await sendAs(consultant)).env_checked_at);
await rejects(() => recordEnv({ mailbox_ok: true, test_ok: true, test_count: 6 }), "22023"); await rejects(() => recordEnv({ mailbox_ok: true, test_ok: false, test_count: 2 }), "22023");
await rejects(() => release({ outcome: "fine", smtp_login: "Login OK", imap_login: null }), "22023");
// lettura
eq(Object.keys(await sendAs(consultant)).sort(), SEND_KEYS); eq(JSON.stringify((await sendAs(consultant)).recent).includes("@"), false);
eq((await sendAs(consultant)).priorities.map((x) => x.co), [952]); await rejects(() => sendAs(null), "42501");
// permessi
for (const f of SEND_RPC_SIGNATURES) { eq(await canExecute("service_role", `public.${f}`), true); eq(await canExecute("authenticated", `public.${f}`), false); }
eq(await canExecute("authenticated", "public.read_partner_assistant_send()"), true);
eq(await searchPathEmpty(SECTION_2_FUNCTIONS), true);
```

- [ ] **Passo 2: harness PostgreSQL 17 che fallisce.** `assistente-partner-invio-concurrency.mjs`, `// test-db: postgres minimo 1`, copia di `assistente-partner-concurrency.mjs` (cluster usa e getta, client `pg` sovrapposti, attese con `pg_blocking_pids`, catena delle righe 175-185 più `_assistente_partner_invio.sql`). L'ora è fissata in ogni client, mai quella della CI: un helper apre `begin; select set_config('luckylap.partner_assistant.now', '2026-11-10T09:00:00Z', true)` (martedì, 10:00 a Roma) e chiama la RPC d'invio nella stessa transazione esplicita; i contatti hanno `Europe/Rome` e `Italia`. Casi, ognuno con i suoi `eq`:
  1. due `claim_partner_assistant_send` insieme: uno `claimed`, l'altro `occupato`; una sola lease;
  2. due `prepare` dello stesso lavoro con due `Message-ID` (stessa lease): uno `pronto`, l'altro `rifiutato`/`doppione`; un solo messaggio vivo;
  3. `set_partner_do_not_contact` del team aperto sulla scheda: `start` aspetta (bloccato dal pid del team), al commit risponde `stop` e il messaggio è `scartato` (Fuoco 3);
  4. `set_partner_assistant_mode('spento')` aperto: `start` aspetta sulla configurazione, poi `stop`;
  5. `finish(inviato)` e `record_partner_activity(inviato)` del team sulla stessa scheda, avviati nei due ordini: nessun `40P01`, entrambi finiscono, una sola riga `inviato` per transazione;
  6. `claim_partner_assistant_send` e `claim_partner_assistant_step` insieme, con lavori scaduti e una pulizia da fare: nessun `40P01`, entrambi finiscono;
  7. `save_partner_assistant_rules` aperto dopo un `prepare` riuscito: `start` aspetta sul lavoro, al commit risponde `stop` con `bozza_cambiata` e nessun messaggio è `in_invio` (Fuoco 3).
- [ ] **Passo 3:** `npm run test:db` → FAIL sui due harness nuovi.
- [ ] **Passo 4:** scrivere la sezione 2 della migrazione.
- [ ] **Passo 5:** `npm run test:db` → PASS; il minimo dell'harness PGlite al numero stampato. L'harness PostgreSQL 17 senza `LUCKYLAP_PG_BIN` risulta saltato; il suo minimo vero si fissa nel compito 9 con l'esito della CI. `assistente-partner-invio-comandi.mjs` passa ancora.
- [ ] **Passo 6:** commit (`Assistente Partner: calendario, coda e RPC dell'invio`), push.

### Compito 3: dipendenze, configurazione della posta, composizione e SMTP

**File:**
- Modifica: `package.json`, `package-lock.json`
- Crea: `src/lib/partner-assistant/mail-config.ts`, `mail-config.test.ts`, `mail-compose.ts`, `mail-compose.test.ts`, `smtp.ts`, `smtp.test.ts`

**Interfacce:**
- Produce in `mail-config.ts` (`import "server-only"`):
  - `PARTNER_ASSISTANT_SMTP_PORT = 587`, `PARTNER_ASSISTANT_IMAP_PORT = 993`, `PARTNER_ASSISTANT_FROM_NAME_DEFAULT = "Tommaso | LuckyLap"`, `PARTNER_ASSISTANT_SMTP_HOST_DEFAULT = "smtp.ionos.it"`, `PARTNER_ASSISTANT_IMAP_HOST_DEFAULT = "imap.ionos.it"`;
  - `type PartnerAssistantMailEnvironment = { PARTNER_MAIL_USER?: string; PARTNER_MAIL_PASSWORD?: string; PARTNER_MAIL_FROM_NAME?: string; PARTNER_TEST_TO?: string; PARTNER_MAIL_SMTP_HOST?: string; PARTNER_MAIL_IMAP_HOST?: string }`;
  - `type PartnerAssistantMailConfig = { user: string; password: string; fromName: string; smtpHost: string; imapHost: string; testTo: string[]; domain: string }`;
  - `partnerAssistantMailAddress(value: string): string | null`: `trim`, minuscolo, la regex stretta dei vincoli globali, al massimo 254;
  - `partnerAssistantMailConfig(environment: PartnerAssistantMailEnvironment = <le sei variabili da process.env>): PartnerAssistantMailConfig | null`. `null` se: manca o non è valido l'utente; la password non rispetta `^[\x20-\x7e]{1,512}$`; un host presente non rispetta `^[a-z0-9-]+(\.[a-z0-9-]+)+$` (assente o vuoto: il predefinito); il nome presente non rispetta `^[^\x00-\x1f\x7f<>@"\\]{1,80}$` (assente o vuoto: il predefinito); `PARTNER_TEST_TO` presente con meno di 1 o più di 5 indirizzi separati da virgole, uno non valido o due uguali (assente o vuoto: `testTo = []`). `domain` = dominio dell'utente. Mai un log. È separata da `partnerAssistantConfig`: senza posta l'assistente lavora in «Prepara» (Q33). Un `PARTNER_TEST_TO` scritto male dà `null` anche alla casella (fallimento chiuso): la riga «Indirizzi di prova» della pagina dice quale correggere.
  - `type PartnerAssistantEnvironmentReport = { assistente: boolean; casella: boolean; prova: boolean; indirizziProva: number }` e `partnerAssistantEnvironmentReport(environment: PartnerAssistantEnvironment & PartnerAssistantMailEnvironment = <process.env>): PartnerAssistantEnvironmentReport` (perimetro, punto 7): `assistente` = `partnerAssistantConfig(environment) !== null`; `casella` = `partnerAssistantMailConfig({ ...environment, PARTNER_TEST_TO: undefined }) !== null`; `prova` = `PARTNER_TEST_TO` non vuoto e `partnerAssistantMailConfig(environment)` con `testTo` non vuoto; `indirizziProva` = `testTo.length` se `prova`, altrimenti 0. Solo booleani e il numero: nessun valore, nessuna lunghezza, mai un log.
- Produce in `mail-compose.ts` (senza `server-only` per le costanti; MailComposer solo dentro la funzione):
  - `PARTNER_ASSISTANT_OPT_OUT_LINES: Readonly<{ it_voi: string; it_lei: string; en: string; de: string; fr: string; es: string }>`, i testi dell'Appendice A così come sono;
  - `partnerAssistantOptOutLine(language: PartnerAssistantLanguage, register: PartnerAssistantRegister): string`: `it` con `lei` → `it_lei`, `it` con ogni altro registro → `it_voi`; le altre lingue la loro riga, qualunque sia il registro;
  - `partnerAssistantMessageText(input: { body: string; signature: string; optOut: string }): string` = `${body}\n\n${signature}\n\n${optOut}`;
  - `partnerAssistantMessageId(domain: string, uuid: string = randomUUID()): string` = `<${uuid}@${domain}>`;
  - `type PartnerAssistantOutgoing = { messageId: string; from: { name: string; address: string }; to: string; subject: string; text: string; date: Date }`;
  - `composePartnerAssistantMessage(message: PartnerAssistantOutgoing): Promise<string>`: `new MailComposer({ from: message.from, to: { name: "", address: message.to }, subject, text, messageId, date, newline: "\r\n", disableFileAccess: true, disableUrlAccess: true }).compile().build()`, poi la stringa; lancia se non è solo ASCII. Mai `html`, `headers`, `inReplyTo`, `references`, `attachments`.
- Produce in `smtp.ts` (`import "server-only"`), con `import SMTPConnection, { type SMTPConnectionOptions } from "nodemailer/lib/smtp-connection"` (vincoli globali, «SMTP per fasi»):
  - `type PartnerAssistantSmtpPhase = "connect" | "login" | "send"`;
  - `type PartnerAssistantSmtpOutcome = { kind: "inviato"; responseCode: 250 } | { kind: "credenziali"; code: string } | { kind: "temporaneo"; code: string; responseCode: number | null } | { kind: "respinto"; code: string; responseCode: number; enhanced: string | null; spam: boolean } | { kind: "bloccato"; code: string; responseCode: number; enhanced: string | null } | { kind: "non_partito"; code: string } | { kind: "incerto"; code: string }`;
  - `classifyPartnerAssistantSmtpError(error: unknown, phase: PartnerAssistantSmtpPhase): PartnerAssistantSmtpOutcome`, da `code`, `responseCode`, `command`, `response` e `rejectedErrors` (la 10.1.1 non ha `err.permanent`); `command` non decide mai da solo, perché `CONN` arriva in ogni fase:
    - `login` con `EAUTH` o `ENOAUTH` → `credenziali`;
    - `responseCode` 400-499 (421 e 450 compresi), in ogni fase → `temporaneo` (`code` = `smtp_limite` se `response` contiene «send limit», altrimenti `smtp_<responseCode>`);
    - `responseCode` 500-599 in `connect`, in `login` o con `command` `MAIL FROM`: `bloccato` se il codice esteso è `5.7.x` o `response` contiene «spam», altrimenti `non_partito`. Non riguarda mai il contatto;
    - `responseCode` 500-599 in `send` (`RCPT TO`, `DATA`) → `respinto`, `enhanced` dalla prima `\b5\.\d{1,3}\.\d{1,3}\b` di `response` o di `rejectedErrors[i].response`, `spam` se `/spam/i`;
    - senza `responseCode`: in `connect` e `login` → `non_partito`, qualunque `code` (`EDNS`, `ETLS`, `ECONNECTION`, `ESOCKET`, `ETIMEDOUT` di ogni tipo); in `send` → `incerto`, qualunque `code` o `command` (`SOCKET_TIMEOUT` e `ECONNECTION`/`CONN` compresi: la connessione può cadere dopo il punto finale).
    `code` sempre `smtp_<…>` in minuscolo, mai testo del server.
  - `type PartnerAssistantSmtpResult = { outcome: PartnerAssistantSmtpOutcome; login: string | null }`: `login` = `"ok"` se `login` è riuscito, il `code` dell'esito se `connect` o `login` sono falliti, `null` se la connessione non si è aperta (destinatario non valido);
  - `type PartnerAssistantSmtp = { send(input: { raw: string; from: string; to: string; signal: AbortSignal }): Promise<PartnerAssistantSmtpResult> }`;
  - `createPartnerAssistantSmtp(mail: PartnerAssistantMailConfig, createConnection: (options: SMTPConnectionOptions) => SMTPConnection = (options) => new SMTPConnection(options)): PartnerAssistantSmtp`. Una connessione per invio, opzioni `{ host: mail.smtpHost, port: 587, secure: false, requireTLS: true, tls: { servername: mail.smtpHost, minVersion: "TLSv1.2" }, name: mail.domain, connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000, dnsTimeout: 10_000, logger: false, debug: false }`. Nell'ordine, con la fase corrente in una variabile e un solo esito (il primo che arriva):
    - `conn.on("error", …)` prima di `connect`: in 10.1.1 gli errori di connessione e di socket arrivano come evento (`smtp-connection/index.js:905-929`), e durante `send` arrivano sia come evento sia alla callback; tutti si classificano con la fase in cui arrivano;
    - `connect(cb)`; poi, se `conn.allowsAuth` è falso, `non_partito` (`smtp_auth_assente`) senza `login` né `send`;
    - `login({ user: mail.user, pass: mail.password }, cb)`;
    - `send({ from, to: [to] }, raw, cb)`: `inviato` solo se `info.accepted` è `[to]` e `info.response` inizia con `250`; un rifiuto in `info.rejected` è `respinto`; accettato senza 250 è `incerto` (`smtp_risposta_incerta`);
    - `signal` interrotto: `conn.close()` e l'esito per fase, `non_partito` (`smtp_scadenza`) in `connect` e `login`, `incerto` (`smtp_scadenza`) in `send`;
    - `quit()` dopo l'esito e `close()` in `finally`.
    `to` che non passa `partnerAssistantMailAddress` → `non_partito` (`smtp_destinatario_non_valido`) senza aprire la connessione.

- [ ] **Passo 1: dipendenze.** Controllo dei branch (vincoli globali), poi `npm install --save-exact --before=2026-10-14T23:59:59Z nodemailer@10.1.1 imapflow@2.4.2`. `git diff package-lock.json`: solo voci nuove (e `split2` senza `"dev": true`). `npx tsc --noEmit` trova i tipi inclusi di entrambe.
- [ ] **Passo 2: test che falliscono** (`vi.mock("server-only", () => ({}))`; `MailComposer` vero, `SMTPConnection` finta che registra le chiamate in `conn.calls` e può fallire in una fase, come callback o come evento `error`; il test decodifica il quoted-printable con un helper locale):

```ts
const env = (over = {}) => ({ PARTNER_MAIL_USER: "casella@luckylap.example.test", PARTNER_MAIL_PASSWORD: "synthetic-password", ...over });
it("solo utente e password: i predefiniti", () => expect(partnerAssistantMailConfig(env())).toEqual({ user: "casella@luckylap.example.test", password: "synthetic-password", fromName: "Tommaso | LuckyLap", smtpHost: "smtp.ionos.it", imapHost: "imap.ionos.it", testTo: [], domain: "luckylap.example.test" }));
it("indirizzi di prova con spazi e maiuscole", () => expect(partnerAssistantMailConfig(env({ PARTNER_TEST_TO: " Prova1@Example.Test, prova2@example.test" }))?.testTo).toEqual(["prova1@example.test", "prova2@example.test"]));
it.each(["PARTNER_MAIL_USER", "PARTNER_MAIL_PASSWORD"])("senza %s: null", (k) => expect(partnerAssistantMailConfig({ ...env(), [k]: undefined })).toBeNull());
it.each([
  ["PARTNER_TEST_TO", "a@example.test,b@example.test,c@example.test,d@example.test,e@example.test,f@example.test"],
  ["PARTNER_TEST_TO", "a@example.test,a@example.test"], ["PARTNER_TEST_TO", "a;b@example.test"],
  ["PARTNER_MAIL_FROM_NAME", "Tommaso\r\nBcc: x"], ["PARTNER_MAIL_FROM_NAME", "x@y"], ["PARTNER_MAIL_SMTP_HOST", "smtp://smtp.ionos.it"],
  ["PARTNER_MAIL_PASSWORD", "è"], ["PARTNER_MAIL_USER", "casella"],
])("%s = %j: null", (k, v) => expect(partnerAssistantMailConfig(env({ [k]: v }))).toBeNull());
it.each(["info;bcc@club.example.test", "a<b@club.example.test", "\"a\"@club.example.test", "a b@club.example.test"])("indirizzo %s rifiutato", (v) => expect(partnerAssistantMailAddress(v)).toBeNull()); // Fuoco 2
it("maiuscole e spazi", () => expect(partnerAssistantMailAddress(" Info@Club-962.Example.Test ")).toBe("info@club-962.example.test")); // Fuoco 2
it("nessun log", () => { partnerAssistantMailConfig(env({ PARTNER_MAIL_PASSWORD: "" })); expect(consoleSpy).not.toHaveBeenCalled(); });
it("le sei frasi di uscita, byte per byte", () => expect(PARTNER_ASSISTANT_OPT_OUT_LINES).toEqual(APPENDIX_A));
it.each([["it", "voi", "it_voi"], ["it", "lei", "it_lei"], ["it", "you", "it_voi"], ["en", "you", "en"], ["de", "sie", "de"], ["de", "you", "de"], ["fr", "vous", "fr"], ["es", "usted", "es"]])("%s/%s → %s", (l, r, k) => expect(partnerAssistantOptOutLine(l, r)).toBe(APPENDIX_A[k]));
it("frasi senza ? né !, senza link né cifre né @", () => { for (const l of Object.values(PARTNER_ASSISTANT_OPT_OUT_LINES)) expect(l).toMatch(/^[^\r\n<>@0-9?!]{20,240}$/); });
it("testo", () => expect(partnerAssistantMessageText({ body: "B", signature: "S", optOut: "O" })).toBe("B\n\nS\n\nO"));
it("Message-ID", () => expect(partnerAssistantMessageId("luckylap.example.test", "11111111-1111-4111-8111-111111111111")).toBe("<11111111-1111-4111-8111-111111111111@luckylap.example.test>"));
it("MIME: CRLF, solo ASCII, text/plain utf-8, niente multipart, X-Mailer, In-Reply-To, References", async () => { const raw = await composePartnerAssistantMessage(first); expect(raw).not.toMatch(/(?<!\r)\n/); expect(raw).toMatch(/^[\x00-\x7f]*$/); expect(raw).toMatch(/Content-Type: text\/plain; charset=utf-8/); expect(raw).not.toMatch(/multipart|X-Mailer|In-Reply-To|References|^Cc:|^Bcc:/im); });
it("la riga che cerca la SQL", async () => expect(`\r\n${await composePartnerAssistantMessage(first)}`).toContain(`\r\nMessage-ID: ${first.messageId}\r\n`));
it("From con il nome, To con un solo indirizzo, Date passata", async () => { const raw = await composePartnerAssistantMessage(first); expect(raw).toMatch(/^From: .*Tommaso \| LuckyLap.*<casella@luckylap\.example\.test>/m); expect(raw).toMatch(/^To: <?info@club-951\.example\.test>?\r?$/m); expect(raw).toContain("Date: Thu, 29 Oct 2026 08:40:00 +0000"); });
it("oggetto con accenti in encoded word; corpo decodificato uguale al testo, frase in fondo", async () => { const raw = await composePartnerAssistantMessage({ ...first, subject: "Club Sintetico 951 e LuckyLap: un'idea per l'Österreich-Treffen" }); expect(raw).toMatch(/^Subject: =\?UTF-8\?/m); expect(decodeBody(raw)).toBe(first.text); expect(decodeBody(raw).endsWith(APPENDIX_A.it_voi)).toBe(true); });
it("gruppi di variabili senza valori", () => { expect(partnerAssistantEnvironmentReport({ ...assistantEnv, ...env({ PARTNER_TEST_TO: "a@example.test,b@example.test" }) })).toEqual({ assistente: true, casella: true, prova: true, indirizziProva: 2 }); expect(partnerAssistantEnvironmentReport({ ...assistantEnv, ...env({ PARTNER_TEST_TO: "a;b@example.test" }) })).toEqual({ assistente: true, casella: true, prova: false, indirizziProva: 0 }); expect(partnerAssistantEnvironmentReport(env({ PARTNER_MAIL_PASSWORD: "" }))).toEqual({ assistente: false, casella: false, prova: false, indirizziProva: 0 }); });
it("il rapporto non contiene valori", () => expect(JSON.stringify(partnerAssistantEnvironmentReport({ ...assistantEnv, ...env() }))).not.toMatch(/casella@|synthetic|sk-ant|sb_secret/));
it("opzioni della connessione e le fasi in ordine", async () => { await smtp.send(input); expect(factory).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.ionos.it", port: 587, secure: false, requireTLS: true, name: "luckylap.example.test", logger: false, debug: false })); expect(conn.calls).toEqual(["on:error", "connect", "login", "send", "quit", "close"]); expect(conn.send).toHaveBeenCalledWith({ from: "casella@luckylap.example.test", to: ["info@club-951.example.test"] }, input.raw, expect.any(Function)); });
it("inviato: accepted con il destinatario e 250; login ok", async () => expect(await smtp.send(input)).toEqual({ outcome: { kind: "inviato", responseCode: 250 }, login: "ok" }));
it("destinatario non valido: non_partito senza connessione", async () => { expect(await smtp.send({ ...input, to: "info;x@club.example.test" })).toEqual({ outcome: { kind: "non_partito", code: "smtp_destinatario_non_valido" }, login: null }); expect(factory).not.toHaveBeenCalled(); });
it("server senza AUTH dopo STARTTLS: non_partito, nessun login né send", …);
it.each([
  ["connect", { code: "ECONNECTION", command: "CONN" }, "non_partito"], ["connect", { code: "ETIMEDOUT", timeoutType: "SOCKET_TIMEOUT", command: "CONN" }, "non_partito"],
  ["connect", { code: "ETIMEDOUT", timeoutType: "GREETING_TIMEOUT", command: "CONN" }, "non_partito"], ["connect", { code: "EDNS", command: "CONN" }, "non_partito"],
  ["connect", { code: "ECONNECTION", responseCode: 421, command: "CONN", response: "421 busy" }, "temporaneo"],
  ["connect", { code: "EPROTOCOL", responseCode: 554, command: "CONN", response: "554 5.7.1 blocked as spam" }, "bloccato"],
  ["connect", { code: "EPROTOCOL", responseCode: 554, command: "CONN", response: "554 no service" }, "non_partito"],
  ["login", { code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" }, "credenziali"], ["login", { code: "ECONNECTION", command: "CONN" }, "non_partito"],
  ["send", { code: "ECONNECTION", command: "CONN" }, "incerto"], ["send", { code: "ETIMEDOUT", timeoutType: "SOCKET_TIMEOUT", command: "CONN" }, "incerto"],
  ["send", { code: "ESOCKET", command: "CONN" }, "incerto"],
  ["send", { code: "EENVELOPE", responseCode: 450, command: "RCPT TO", response: "450 Mail send limit exceeded." }, "temporaneo"],
  ["send", { code: "ECONNECTION", responseCode: 421, command: "CONN", response: "421 closing" }, "temporaneo"],
  ["send", { code: "EENVELOPE", responseCode: 550, command: "RCPT TO", response: "550 5.1.1 user unknown" }, "respinto"],
  ["send", { code: "EMESSAGE", responseCode: 554, command: "DATA", response: "554 5.7.1 rejected as spam" }, "respinto"],
  ["send", { code: "EENVELOPE", responseCode: 550, command: "MAIL FROM", response: "550 5.7.1 sender blocked" }, "bloccato"],
])("%s %o → %s", (phase, err, kind) => expect(classifyPartnerAssistantSmtpError(Object.assign(new Error("x"), err), phase).kind).toBe(kind)); // Fuoco 4
it("connessione caduta durante send, come evento error e come callback: un solo esito, incerto", …); // Fuoco 4
it("connect fallito con ECONNECTION/CONN: non_partito, login = smtp_econnection", …);
it("signal interrotto in send: close e incerto smtp_scadenza; in connect: non_partito smtp_scadenza", …);
it("450 limite: smtp_limite", () => expect(classify(e450, "send")).toMatchObject({ code: "smtp_limite" }));
it("5.1.1 e spam", () => { expect(classify(e550, "send")).toMatchObject({ enhanced: "5.1.1", spam: false }); expect(classify(e554spam, "send")).toMatchObject({ enhanced: "5.7.1", spam: true }); });
it("accettato senza 250: incerto", …);
it("nessun testo del server nei codici", () => expect(JSON.stringify(classify(e550, "send"))).not.toContain("user unknown"));
```

- [ ] **Passo 3:** `npx vitest run src/lib/partner-assistant/mail-config.test.ts src/lib/partner-assistant/mail-compose.test.ts src/lib/partner-assistant/smtp.test.ts` → FAIL.
- [ ] **Passo 4:** implementare.
- [ ] **Passo 5:** gli stessi test PASS, `npm run typecheck` PASS.
- [ ] **Passo 6:** commit (`Assistente Partner: configurazione della posta, composizione e SMTP`), push.

### Compito 4: casella IMAP

**File:**
- Crea: `src/lib/partner-assistant/imap.ts`, `imap.test.ts`

**Interfacce:**
- Consuma: `PartnerAssistantMailConfig`, `PARTNER_ASSISTANT_IMAP_PORT` (compito 3).
- Produce (`import "server-only"`):
  - `type PartnerAssistantFolders = { inbox: string; sent: string | null; junk: string | null }`;
  - `type PartnerAssistantImapError = { kind: "credenziali" | "attesa" | "fallito"; code: string }` e `classifyPartnerAssistantImapError(error: unknown): PartnerAssistantImapError`: `authenticationFailed === true` → `credenziali` (`imap_autenticazione`); `ETHROTTLE`, timeout (`CONNECT_TIMEOUT`, `GREETING_TIMEOUT`, `UPGRADE_TIMEOUT`, `ETIMEOUT`), `NoConnection`, `EConnectionClosed`, `ClosedAfterConnectText`, `ClosedAfterConnectTLS`, `ECONNREFUSED`, `ENOTFOUND`, `ECONNRESET`, `tlsFailed` → `attesa`; il resto → `fallito`. `code` = `imap_` più `code` o `serverResponseCode` in minuscolo, mai `response`;
  - `type PartnerAssistantMailbox = { folders(): Promise<PartnerAssistantFolders | null>; correspondence(folders: PartnerAssistantFolders, address: string, since: Date): Promise<boolean | null>; findMessageId(path: string, messageId: string): Promise<number[] | null>; append(path: string, raw: string, date: Date): Promise<boolean>; close(): Promise<void> }`;
  - `openPartnerAssistantMailbox(mail: PartnerAssistantMailConfig, create: (options: ImapFlowOptions) => ImapFlow = (o) => new ImapFlow(o)): Promise<{ ok: true; mailbox: PartnerAssistantMailbox } | { ok: false; error: PartnerAssistantImapError }>`. Valori fissati:
    - opzioni `{ host: mail.imapHost, port: 993, secure: true, servername: mail.imapHost, tls: { minVersion: "TLSv1.2" }, auth: { user: mail.user, pass: mail.password }, logger: false, disableAutoIdle: true, connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000 }`; `client.on("error", …)` prima di `connect()`; il client si crea qui, mai a livello di modulo (Fluid compute);
    - `folders()`: `list({ listOnly: true })`; `inbox = "INBOX"`, `sent` e `junk` dal `specialUse` `\Sent` e `\Junk` (anche riconosciuto dal nome da imapflow); un errore → `null`;
    - `correspondence(…)`: con `sent` o `junk` nulli → `null`; per `inbox`, `sent`, `junk`, dentro `getMailboxLock(path, { readOnly: true })` (EXAMINE) con `release()` in `finally` e `client.mailbox` controllato, `search({ since, or: [{ from: address }, { to: address }, { cc: address }] }, { uid: true })`; la prima cartella con almeno un UID → `true`; tutte vuote → `false`; un `false`, `undefined` o un'eccezione → `null` («non so», mai «non c'è»). In 2.4.2 una SEARCH non completata può risolvere `[]` (corrette in 2.4.3, 2.5.1 e 2.5.6, `librerie-posta.md` §2.2), quindi un `[]` vale «vuota» solo se: subito dopo ogni `search` `client.mailbox` non è falso e `client.mailbox.path === path`; dopo le tre cartelle `client.usable === true`, poi `await client.noop()` riesce e `client.usable` è ancora vero. Un controllo che non passa → `null`;
    - `findMessageId(path, id)`: nella stessa forma e con gli stessi controlli (`client.mailbox.path`, `usable`, `noop`), `search({ header: { "message-id": id } }, { uid: true })`; `false`/`undefined`/eccezione/controllo fallito → `null`;
    - `append(path, raw, date)`: `client.append(path, raw, ["\\Seen"], date)`; `false` o eccezione → `false`;
    - `close()`: `logout()`, e `close()` del client se il logout fallisce; mai un'eccezione.

- [ ] **Passo 1: test che falliscono**, con una classe finta che registra le chiamate e può fallire a comando:

```ts
it("opzioni, logger false e listener d'errore prima di connect", …);
it("credenziali rifiutate: credenziali, senza testo", async () => expect(await openPartnerAssistantMailbox(cfg, failing({ authenticationFailed: true, response: "NO casella@luckylap.example.test" }))).toEqual({ ok: false, error: { kind: "credenziali", code: "imap_autenticazione" } }));
it("ETHROTTLE e ECONNRESET: attesa", …);
it("cartelle da specialUse", async () => expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: "Posta inviata", junk: "Spam" }));
it("senza \\Junk: junk null e correspondence null, senza search", async () => { const f = await mbWithout("\\Junk").folders(); expect(f?.junk).toBeNull(); expect(await mbWithout("\\Junk").correspondence(f!, "info@club-951.example.test", since)).toBeNull(); expect(search).not.toHaveBeenCalled(); }); // Fuoco 5
it("EXAMINE in sola lettura nelle tre cartelle, release sempre", …);
it("ricerca da, a, in copia, da 365 giorni", async () => { await mb.correspondence(folders, "info@club-951.example.test", since); expect(search).toHaveBeenCalledWith({ since, or: [{ from: "info@club-951.example.test" }, { to: "info@club-951.example.test" }, { cc: "info@club-951.example.test" }] }, { uid: true }); });
it("trovato in spam: true", …); it("nessuna cartella con UID: false", …);
it.each([false, undefined, "throw"])("search %s: null", async (r) => expect(await mbSearching(r).correspondence(folders, addr, since)).toBeNull()); // Fuoco 5
it("search [] con la connessione non più usabile: null", async () => expect(await mbSearching([], { usable: false }).correspondence(folders, addr, since)).toBeNull()); // Fuoco 5
it("search [] e noop che lancia: null", async () => expect(await mbSearching([], { noop: "throw" }).correspondence(folders, addr, since)).toBeNull()); // Fuoco 5
it("search [] con client.mailbox falso o di un'altra cartella: null", …); // Fuoco 5
it("tre [] con mailbox giusta, usable e noop riuscito: false", …);
it("findMessageId [] con usable falso: null", …);
it("findMessageId false: null", …);
it("append con \\Seen e la data; false: false", …);
it("logout fallito: close, nessuna eccezione", …);
it("nessun console.* durante le chiamate", …);
```

- [ ] **Passo 2:** `npx vitest run src/lib/partner-assistant/imap.test.ts` → FAIL. **Passo 3:** implementare. **Passo 4:** PASS e `npm run typecheck`. **Passo 5:** commit (`Assistente Partner: casella IMAP per il controllo dei 12 mesi e la posta inviata`), push.

### Compito 5: ricontrollo delle date all'invio

**File:**
- Crea: `src/lib/partner-assistant/send-recheck.ts`, `send-recheck.test.ts`

**Interfacce:**
- Consuma: `partnerAssistantEventMerch` (`choice.ts:99-112`), `romeDay`, `daysBetween`, `isCalendarDay` (`src/lib/partner/dates.ts`), `PartnerAssistantChoice` (`types.ts`).
- Produce in `send-recheck.ts` (puro, senza `server-only`), dal compito 15 del piano completo ridotto alla prima email (Q15, specifica «Bozze vecchie»):
  - `partnerAssistantBodyDates(body: string, writtenOn: string): string[]`: le date ISO riconosciute nel corpo, nell'ordine. Formati: `AAAA-MM-GG`, `G/M/AAAA`, `G.M.AAAA`; `G [de] <mese> [[de] AAAA]` e `<mese> G[, AAAA]`, con suffissi `st|nd|rd|th|.|º|°`; i mesi in italiano, inglese, tedesco (anche `Maerz`), francese e spagnolo. Senza anno vale l'anno di `writtenOn`, più uno se la data viene prima di `writtenOn`. Una data che non esiste (31 novembre) non conta.
  - `type PartnerAssistantRecheckChoice = Pick<PartnerAssistantChoice, "contactKind" | "request" | "eventStartsOn">`;
  - `partnerAssistantSendRecheck(input: { choice: PartnerAssistantRecheckChoice; body: string; draftCreatedAt: string }, sendDay: string): { ok: true } | { ok: false; reason: "bozza_scaduta" }`. `writtenOn = romeDay(new Date(draftCreatedAt))`. `bozza_scaduta` se: `choice.eventStartsOn !== "" && choice.eventStartsOn <= sendDay`; oppure `partnerAssistantEventMerch(choice, writtenOn) !== partnerAssistantEventMerch(choice, sendDay)`; oppure una data di `partnerAssistantBodyDates(body, writtenOn)` non è dopo `sendDay`. Si guarda solo il corpo, non la firma.

- [ ] **Passo 1: test che falliscono:**

```ts
it.each([["il 19 novembre", "2026-11-19"], ["am 19. November", "2026-11-19"], ["on 19th November 2026", "2026-11-19"], ["November 19, 2026", "2026-11-19"], ["el 19 de noviembre", "2026-11-19"], ["le 19 novembre", "2026-11-19"], ["2027-01-15", "2027-01-15"], ["19/11/2026", "2026-11-19"], ["19.11.2026", "2026-11-19"], ["il 3 gennaio", "2027-01-03"], ["am 5. Maerz", "2027-03-05"]])("%s → %s", (t, d) => expect(partnerAssistantBodyDates(`… ${t} …`, "2026-10-28")).toEqual([d]));
it("nessuna data, o una che non esiste: []", () => { expect(partnerAssistantBodyDates("Ciao, siamo LuckyLap.", "2026-10-28")).toEqual([]); expect(partnerAssistantBodyDates("il 31 novembre", "2026-10-28")).toEqual([]); });
it("data citata passata all'invio: bozza_scaduta", () => expect(partnerAssistantSendRecheck(withBody(club, "… il 19 novembre …"), "2026-11-20")).toEqual({ ok: false, reason: "bozza_scaduta" }));
it("data citata uguale al giorno d'invio: bozza_scaduta", () => expect(partnerAssistantSendRecheck(withBody(club, "… il 19 novembre …"), "2026-11-19").ok).toBe(false));
it("evento già iniziato: bozza_scaduta", () => expect(partnerAssistantSendRecheck(event("2026-11-09", "merch_cobranding"), "2026-11-10").ok).toBe(false));
it("evento a più di un mese alla bozza, a un mese o meno all'invio: la riga cambia, bozza_scaduta", () => expect(partnerAssistantSendRecheck({ ...event("2026-12-05", "merch_cobranding"), draftCreatedAt: "2026-10-20T09:00:00Z" }, "2026-11-10").ok).toBe(false));
it("evento lontano e date future: ok", () => expect(partnerAssistantSendRecheck({ ...event("2027-03-01", "stand_evento"), draftCreatedAt: "2026-10-28T09:00:00Z" }, "2026-10-29")).toEqual({ ok: true }));
it("club senza evento e senza date nel corpo: ok anche mesi dopo", () => expect(partnerAssistantSendRecheck(club, "2027-03-10")).toEqual({ ok: true }));
it("giorno della bozza contato a Roma: alle 23:30 UTC del 28 è già il 29, e «28 ottobre» è dell'anno dopo", () => expect(partnerAssistantSendRecheck({ ...withBody(club, "… il 28 ottobre …"), draftCreatedAt: "2026-10-28T23:30:00Z" }, "2026-10-30")).toEqual({ ok: true }));
```

- [ ] **Passo 2:** `npx vitest run src/lib/partner-assistant/send-recheck.test.ts` → FAIL. **Passo 3:** implementare. **Passo 4:** PASS e `npm run typecheck`. **Passo 5:** commit (`Assistente Partner: ricontrollo delle date all'invio`), push.

### Compito 6: store e passo d'invio nel giro del worker

**File:**
- Crea: `src/lib/partner-assistant/send-types.ts`, `send-store.ts`, `send-store.test.ts`, `send.ts`, `send.test.ts`
- Modifica: `src/lib/partner-assistant/worker.ts` (solo `receivePartnerAssistantTick` e i suoi tipi), `worker.test.ts` (describe «route del worker»), `transport.test.ts`

**Interfacce:**
- Consuma: le RPC del compito 2 con le loro chiavi; compiti 3, 4 e 5; `createWorkerRpcFetch` e `boundedPhase` (`src/lib/shopify/worker-io.ts`); `PartnerAssistantConfig`, `PARTNER_ASSISTANT_RPC_TIMEOUT_MS`, `PARTNER_ASSISTANT_RPC_MAX_BYTES` (store della consegna 1); `romeDay` (`src/lib/partner/dates.ts`).
- Produce in `send-types.ts` (tipi camelCase, con il nome della migrazione in testa):
  - `PartnerAssistantSendMode = "prova" | "invio"`; `PartnerAssistantSendIdleReason` = i motivi di `claim` del compito 2;
  - `PartnerAssistantSendCandidate = { jobId; partnerId; co: number; name: string; mode; draft: { draftId; language: PartnerAssistantLanguage; subject; body; signature; sha256; rulesVersion: number; createdAt: string }; choice: PartnerAssistantRecheckChoice; register: PartnerAssistantRegister; address: string | null; testRunId: string | null; testIndex: number | null }`;
  - `PartnerAssistantPendingAppend = { messageRowId; messageId; raw; sentAt }`;
  - `PartnerAssistantSendClaim = { status: "idle"; reason: PartnerAssistantSendIdleReason } | { status: "claimed"; leaseToken: string; mode: PartnerAssistantSendMode; appends: PartnerAssistantPendingAppend[]; candidate: PartnerAssistantSendCandidate | null }`;
  - `PartnerAssistantMailboxCheck = "vuota" | "trovata" | "incerta"`;
  - `PartnerAssistantPrepareInput = { jobId; draftId; mode; testRunId: string | null; testIndex: number | null; messageId; toAddress; subject; text; optOut; raw; mailboxCheck }`, `PartnerAssistantPrepared = { status: "pronto"; messageRowId } | { status: "rifiutato"; reason: string }`;
  - `PartnerAssistantStart = { status: "in_invio" } | { status: "stop"; reason: string }`;
  - `PartnerAssistantFinishInput = { messageRowId; outcome: "inviato" | "incerto" | "respinto" | "scartato"; smtpCode: number | null; enhancedCode: string | null; spam: boolean; reason: string | null }`;
  - `PartnerAssistantSendSkipReason = "conversazione_esistente" | "bozza_scaduta" | "casella_incerta"`;
  - `PartnerAssistantReleaseInput = { outcome: string; smtpLogin: string | null; imapLogin: string | null }`, `PartnerAssistantEnvironmentInput = { mailboxOk: boolean; testOk: boolean; testCount: number }`.
- Produce in `send-store.ts` (`import "server-only"`):
  - `PARTNER_ASSISTANT_SEND_RPC_NAMES`, i nove nomi `claim_partner_assistant_send`, `skip_partner_assistant_send`, `prepare_partner_assistant_send`, `start_partner_assistant_send`, `finish_partner_assistant_send`, `record_partner_assistant_append`, `pause_partner_assistant_send`, `release_partner_assistant_send`, `record_partner_assistant_environment`;
  - `createPartnerAssistantSendFetch(config, fetcher = fetch)`: `createWorkerRpcFetch` con questa lista e i limiti di `store.ts` (10 secondi, 1 MiB in uscita e in entrata);
  - `type PartnerAssistantSendStore = { claim(workerId: string, leaseSeconds: number, testRecipients: number, signal: AbortSignal): Promise<StoreResult<PartnerAssistantSendClaim>>; skip(lease: string, jobId: string | null, reason: PartnerAssistantSendSkipReason, signal): Promise<StoreResult<{ status: "done" } | { status: "lease_persa" }>>; prepare(lease, operationId, input: PartnerAssistantPrepareInput, signal): Promise<StoreResult<PartnerAssistantPrepared | { status: "lease_persa" }>>; start(lease, messageRowId, signal): Promise<StoreResult<PartnerAssistantStart | { status: "lease_persa" }>>; finish(lease, operationId, input: PartnerAssistantFinishInput, signal): Promise<StoreResult<{ status: "done"; sendStatus: string; replayed: boolean } | { status: "lease_persa" }>>; recordAppend(lease, messageRowId, found: boolean, signal); pause(lease, signal); release(lease, input: PartnerAssistantReleaseInput, signal); recordEnvironment(input: PartnerAssistantEnvironmentInput, signal): Promise<StoreResult<{ status: "done" }>> }`;
  - `createPartnerAssistantSendStore(config: PartnerAssistantConfig): PartnerAssistantSendStore`: client separato come `store.ts` (righe 523-560), ogni payload con `schema_version: 1`, ogni risposta letta a chiavi esatte con elenchi chiusi (una chiave in più o in meno → `{ ok: false }`).
- Produce in `send.ts` (`import "server-only"`):
  - `PARTNER_ASSISTANT_SEND_BUDGET_MS = 120_000`, `PARTNER_ASSISTANT_SEND_LEASE_SECONDS = 300`, `PARTNER_ASSISTANT_SMTP_MIN_MS = 75_000`, `PARTNER_ASSISTANT_SMTP_MARGIN_MS = 15_000`, `PARTNER_ASSISTANT_SEND_RECORD_MS = 10_000`, `PARTNER_ASSISTANT_MAILBOX_DAYS = 365`;
  - `type PartnerAssistantSendDependencies = { store?: PartnerAssistantSendStore; smtp?: PartnerAssistantSmtp; openMailbox?: typeof openPartnerAssistantMailbox; clock?: () => number; now?: () => number; workerId?: () => string; uuid?: () => string }`. Due orologi: `clock` (predefinito `performance.now`, come `worker.ts:271`) misura solo il budget; `now` (predefinito `Date.now`) dà l'ora vera per `Date:`, per `since` e per il giorno di Roma del ricontrollo. Mai `clock` per una data;
  - `type PartnerAssistantSendRun = { status: "idle" | "complete" | "uncertain" | "stopped" }`;
  - `runPartnerAssistantSendStep(config: PartnerAssistantConfig, mail: PartnerAssistantMailConfig, parentSignal: AbortSignal, dependencies?: PartnerAssistantSendDependencies): Promise<PartnerAssistantSendRun>`. Timer proprio di `PARTNER_ASSISTANT_SEND_BUDGET_MS` su `clock`; ogni RPC fino a `start` dentro `boundedPhase` con `min(10 s, tempo rimasto)`, un'eccezione è `{ ok: false }`. `finish`, `skip` e `release` dopo l'SMTP hanno invece `PARTNER_ASSISTANT_SEND_RECORD_MS` propri, fuori dal budget (la funzione ha 300 secondi: 120 + 15 + 10 + 10 ci stanno). Nell'ordine:
    1. `claim(workerId, 300, mail.testTo.length)`: `{ ok: false }` → `uncertain`; `idle` → `idle`;
    2. solo in invio, con un candidato: `partnerAssistantSendRecheck({ choice, body: draft.body, draftCreatedAt: draft.createdAt }, romeDay(new Date(now())))`; `bozza_scaduta` → `skip(jobId, "bozza_scaduta")` e il candidato si lascia. Senza candidato né `appends` → `release` → `complete`, senza aprire la casella;
    3. una sola `openMailbox(mail)` (`imapLogin = "ok"` o il codice). `credenziali` → `pause` → `stopped`. Altro errore → `skip(candidate?.jobId ?? null, "casella_incerta")` anche senza candidato, poi `release(error.code)` → `complete`. Poi `folders()`: `null` come un errore di casella, con lo stesso `skip`;
    4. per ogni `append` arretrato, con `sent` trovato: `findMessageId(sent, messageId)`; `[]` → `append(sent, raw, new Date(sentAt))`, se riesce `recordAppend(found: false)`; un UID → `recordAppend(found: true)`. Un arretrato che non si chiude (`sent` nullo, `findMessageId` nullo, `append` falso) segna la casella come incerta: alla fine del giro, una volta sola, `skip(null, "casella_incerta")`, così il giro dopo non riapre IMAP per 15 minuti (Fuoco 5);
    5. con il candidato: in prova `to = mail.testTo[testIndex]` (fuori elenco → `release("prova_destinatario_mancante")`, nessun SMTP), in invio `to = address`; `partnerAssistantMailAddress(to)` nullo → `release("destinatario_non_valido")` (in invio non succede: il claim non dà mai `address` nullo);
    6. controllo dei 12 mesi: `correspondence(folders, address, new Date(now() − 365 giorni))` (in prova sull'indirizzo vero; con `address` nullo `incerta`). In invio: `null` → `skip("casella_incerta")`, fine; `true` → `skip("conversazione_esistente")`, fine. In prova il risultato diventa `mailboxCheck` e non ferma niente;
    7. tempo rimasto sotto `PARTNER_ASSISTANT_SMTP_MIN_MS` → `release("tempo_insufficiente")`, fine;
    8. `optOut = partnerAssistantOptOutLine(draft.language, register)`, `text = partnerAssistantMessageText(…)`, `messageId = partnerAssistantMessageId(mail.domain, uuid())`, `raw = composePartnerAssistantMessage({ messageId, from: { name: mail.fromName, address: mail.user }, to, subject: draft.subject, text, date: new Date(now()) })`; `prepare(...)`; `rifiutato` → fine;
    9. `start`; `stop` o `lease_persa` → fine, nessun SMTP;
    10. `smtp.send({ raw, from: mail.user, to, signal })` con `signal` che scade a tempo rimasto meno `PARTNER_ASSISTANT_SMTP_MARGIN_MS` (`smtpLogin` = il `login` del risultato), poi `finish` con l'esito tradotto: `inviato` → `{ outcome: "inviato", smtpCode: 250 }`; `credenziali` → `scartato` `smtp_credenziali`; `temporaneo` → `scartato` `smtp_temporaneo`; `non_partito` → `scartato` `smtp_non_partito`; `bloccato` → `scartato` `smtp_bloccato`; `respinto` → `respinto` con `smtpCode`, `enhancedCode`, `spam`, `reason = code`; `incerto` → `incerto` con `reason = code`. Un `finish` senza risposta certa → `uncertain`, mai un secondo SMTP;
    11. con `inviato`: `findMessageId(sent, messageId)`, `[]` → `append` e `recordAppend(false)`, un UID → `recordAppend(true)`, `null` o senza `sent` → lo riprende il giro dopo;
    12. `finally`: `mailbox.close()` e `release({ outcome: <esito>, smtpLogin, imapLogin })` (nulli gli accessi non provati in questo giro).
    Nei punti, «`release(x)`» vuol dire che il solo `release` del punto 12 porta `outcome = x`: mai due `release` nello stesso giro. Log solo `console.error("partner_assistant_send_bug", { phase, error: name })`, mai indirizzi, testi o risposte.
- Modifica in `worker.ts`: `receivePartnerAssistantTick(request, afterResponse, dependencies?: PartnerAssistantDependencies & { environment?: PartnerAssistantEnvironment & PartnerAssistantMailEnvironment; run?: typeof runPartnerAssistantStep; send?: typeof runPartnerAssistantSendStep; sendDependencies?: PartnerAssistantSendDependencies })`. Dentro `afterResponse`, nell'ordine: `recordEnvironment` con `partnerAssistantEnvironmentReport(environment)` (`mailboxOk = casella`, `testOk = prova`, `testCount = indirizziProva`), sullo store di `sendDependencies` o su `createPartnerAssistantSendStore(config)`, in `boundedPhase` di 10 secondi, a ogni giro, anche con la posta nulla, e un errore non ferma il giro (perimetro, punto 7); poi `const mail = partnerAssistantMailConfig(environment)`; con `mail`, `send(config, mail, signal, sendDependencies)`; il passo con Claude (`run`) parte solo se l'invio ha risposto `idle` o se `mail` è nullo. Stesse risposte HTTP di oggi (503, 401, 202): con 503 e 401 niente si registra; `runPartnerAssistantStep` non cambia.

- [ ] **Passo 1: test che falliscono.** `send-store.test.ts`: per ogni RPC la riga attesa → `ok` con il tipo camelCase; una chiave in più o in meno, un `status` fuori elenco, un `testIndex` 5, un `choice` senza `event_starts_on` → `{ ok: false }`; i payload portano `schema_version: 1` e le chiavi snake_case esatte del compito 2 (`skip` con `job_id` nullo, `release` con `smtp_login` e `imap_login`). `transport.test.ts`: lo store d'invio chiama solo i suoi nove percorsi, il worker solo i suoi dieci (un nome dell'altra lista → `worker_transport_invalid`). `send.test.ts`, con store, SMTP e casella finti che registrano le chiamate in un solo elenco, `clock` e `now` iniettati e diversi (`clock` parte da 0, `now` da `Date.parse("2026-10-29T08:40:00Z")`):

```ts
it("invio: l'ordine delle chiamate", async () => { await runSend(); expect(calls).toEqual(["claim", "open", "folders", "correspondence", "prepare", "start", "smtp", "finish:inviato", "findMessageId", "append", "recordAppend:false", "close", "release"]); });
it("Date: e since dall'ora vera, non dal clock del budget", async () => { await runSend(); expect(preparedRaw()).toContain("Date: Thu, 29 Oct 2026 08:40:00 +0000"); expect(correspondenceSince()).toEqual(new Date(Date.parse("2026-10-29T08:40:00Z") - 365 * 86_400_000)); });
it("prepare con il testo approvato più la frase di uscita, oggetto della bozza, mailboxCheck vuota", …);
it("bozza scaduta (data del corpo passata): skip bozza_scaduta, casella non aperta senza appends", async () => { await runSend({ candidate: withBody("… il 25 ottobre …", { createdAt: "2026-10-20T09:00:00Z" }) }); expect(calls).toEqual(["claim", "skip:bozza_scaduta", "release"]); });
it("conversazione trovata: skip conversazione_esistente, nessun prepare né SMTP", …);
it("ricerca null: skip casella_incerta, nessun SMTP", …); // Fuoco 5
it("IMAP credenziali: pause, nessun SMTP, stopped, release con imap_login imap_autenticazione", …);
it("IMAP ECONNRESET con candidato: skip casella_incerta, release con imap_econnreset", …); // Fuoco 5
it("solo appends e IMAP ECONNRESET: skip(null, casella_incerta), un solo login", async () => { await runSend({ candidate: null, appends: [pending], open: econnreset }); expect(calls).toEqual(["claim", "open", "skip:null:casella_incerta", "release"]); }); // Fuoco 5
it("append arretrato con findMessageId null: skip(null, casella_incerta) a fine giro, un solo login", …); // Fuoco 5
it("SMTP credenziali: finish scartato smtp_credenziali", …);
it("SMTP 450: finish scartato smtp_temporaneo", …);
it("SMTP 550 5.1.1: finish respinto con 5.1.1", …);
it("SMTP bloccato: finish scartato smtp_bloccato", …);
it("SMTP caduto durante send: finish incerto, niente append, niente secondo SMTP", …); // Fuoco 4
it("SMTP lento: il 250 arriva a budget finito e finish parte lo stesso, con i suoi 10 secondi", async () => { await runSend({ smtp: slow(PARTNER_ASSISTANT_SEND_BUDGET_MS) }); expect(calls).toContain("finish:inviato"); });
it("SMTP oltre la scadenza: signal interrotto prima della fine del budget", …);
it("start stop: nessun SMTP", …); // Fuoco 3
it("prepare rifiutato: nessuno start", …);
it("finish senza risposta dopo l'SMTP: uncertain, un solo SMTP", …); // Fuoco 4
it("tempo sotto 75 secondi: nessun prepare", …);
it("prova: destinatario testTo[testIndex], oggetto senza [Prova], controllo sull'indirizzo vero, trovato non blocca, nessun ricontrollo delle date", …);
it("prova con testIndex fuori da testTo: nessun SMTP", …);
it("appends: search null non chiude, [] appende, UID registra found true", …);
it("release porta gli accessi: smtp_login ok, imap_login ok", …);
it("Message-ID con il dominio della casella", …);
it("log senza indirizzi né testi", () => expect(consoleSpy.mock.calls.flat().join(" ")).not.toMatch(/@|Gentile|Dear/));
```

  `worker.test.ts`, describe «route del worker»: `recordEnvironment` a ogni giro dopo il 202, con `{ mailbox_ok, test_ok, test_count }` e senza valori, anche con la posta nulla; niente con 503 o 401; un errore di `recordEnvironment` non ferma l'invio né il passo con Claude; con la posta configurata e l'invio `idle`, parte anche il passo con Claude; con l'invio `complete`, `uncertain` o `stopped` no; senza posta l'invio non si chiama e il passo con Claude sì; 503, 401 e 202 come oggi.
- [ ] **Passo 2:** `npx vitest run src/lib/partner-assistant` → FAIL sui test nuovi. **Passo 3:** implementare. **Passo 4:** PASS, `npm run typecheck`, `npm run build` (se il bundle non risolve nodemailer o imapflow: controllo dei branch, poi `serverExternalPackages: ["nodemailer", "imapflow"]` in `next.config.ts`, e di nuovo `npm run build`). **Passo 5:** commit (`Assistente Partner: passo d'invio nel giro del worker`), push.

### Compito 7: comandi, letture e registro nell'app

**File:**
- Modifica: `src/lib/partner/commands.ts`, `commands.test.ts`, `src/app/(workspace)/partner/actions.ts`, `actions.test.ts`, `src/app/(workspace)/partner/command-runner.ts`
- Modifica: `src/lib/partner-assistant/types.ts` (solo `PartnerAssistantJobStatus`), `src/lib/partner/assistant.ts`, `assistant.test.ts`, `src/lib/partner/server.ts`, `server.test.ts`, `src/lib/partner/model.ts`, `model.test.ts`, `src/lib/partner/fixtures.ts`

**Interfacce:**
- Consuma: compiti 1 e 2 (chiavi e codici), compito 3 (`partnerAssistantMailConfig`).
- Produce in `commands.ts`:
  - cinque tipi in più in `PARTNER_COMMAND_KINDS` (diciotto): `start_partner_assistant_test`, `confirm_partner_assistant_test`, `set_partner_assistant_send_priority`, `resume_partner_assistant_send`, `set_partner_assistant_settings`, con i validatori delle chiavi del compito 1 (`drafts` 1-3, `recipients` 1-5, `send_priority` 0-9, `daily_first_limit` 1-15, `expected_version`);
  - frasi di successo: «Prova avviata: partono N email di prova, una ogni 4-11 minuti.» (N = `drafts × recipients` del risultato), «Prova confermata: ora si può scegliere «Invio».», «Precedenza d'invio salvata.», «Invii ripresi.», «Limite salvato: dopo la prima settimana partono al massimo N prime email al giorno.»;
  - `partnerCommandOutcome` (`commands.ts:967-976`): `needsVersion` falso anche per `start_partner_assistant_test` e `resume_partner_assistant_send`, che rispondono `{id, test_run_id, drafts, recipients, replayed}` e `{id, status, replayed}`: senza, l'esito sarebbe `null` e la pagina direbbe «esito da verificare»;
  - `PARTNER_CHANGED_MESSAGES.confirm_partner_assistant_test` e `.set_partner_assistant_settings` come quello di `set_partner_assistant_mode`;
  - in `PARTNER_ERROR_MESSAGES`, solo codici che una migrazione dei comandi alza davvero (il test di `commands.test.ts:676-693` li confronta in tutti e due i versi):

    | Codice | SQLSTATE | Messaggio |
    |---|---|---|
    | `partner_assistant_founder_required` | 42501 | «Solo Tommi può farlo.» |
    | `partner_assistant_test_required` | 55000 | «Prima di «Invio» serve una prova confermata da Tommi.» |
    | `partner_assistant_test_missing` | 55000 | «Nessuna email di prova è ancora partita.» |
    | `partner_assistant_test_mode_required` | 55000 | «La prova si manda con l'assistente in «Prova».» |
    | `partner_assistant_test_empty` | 55000 | «Non ci sono bozze pronte da mandare in prova.» |
    | `partner_assistant_mode_unavailable` | 22023 | resta (la M1 lo alza ancora), non più usato |

  - `PARTNER_ASSISTANT_ACTION_MESSAGES`, a parte, per i due rifiuti che nascono nell'azione e mai nella SQL: `partner_assistant_mail_not_configured` («La posta dell'assistente non è configurata: «Prova» e «Invio» non sono disponibili.») e `partner_assistant_test_to_changed` («Gli indirizzi di prova sono cambiati: ricarica la pagina e riprova.»);
  - il commento di `PARTNER_ASSISTANT_MODES` senza «seconda consegna».
- Produce in `actions.ts`: `startPartnerAssistantTest`, `confirmPartnerAssistantTest`, `setPartnerAssistantSendPriority`, `resumePartnerAssistantSend`, `setPartnerAssistantSettings`, ognuna con `runPartnerCommandAction(kind, command)`. Prima della RPC, dopo il controllo dell'anteprima, con i messaggi di `PARTNER_ASSISTANT_ACTION_MESSAGES`: `setPartnerAssistantMode` con `mode` `prova` o `invio` e `partnerAssistantMailConfig() === null` → rifiuto `partner_assistant_mail_not_configured` (`refresh: false`) senza RPC; `startPartnerAssistantTest` senza posta o con `testTo` vuoto → lo stesso rifiuto; `payload.recipients !== testTo.length` → `partner_assistant_test_to_changed`. In `command-runner.ts` i cinque tipi entrano in `ASSISTANT_KINDS`.
- Produce in `types.ts`: `PartnerAssistantJobStatus` con anche `"inviata"`.
- Produce in `assistant.ts`:
  - `PARTNER_ASSISTANT_JOB_STATUSES` con `inviata` («Email inviata» in `PARTNER_ASSISTANT_STATUS_LABELS`);
  - `PARTNER_ASSISTANT_EVENT_STEPS = [...PARTNER_ASSISTANT_STEPS, "invio"]`, usato per `lastEvents[].step` al posto di `PARTNER_ASSISTANT_STEPS` (gli eventi d'invio hanno `step = 'invio'`);
  - `PARTNER_ASSISTANT_REASON_LABELS` con `bozza_scaduta` («Bozza scaduta: l'evento è già iniziato o una data citata è passata. L'assistente la riscrive una volta, se c'è credito; poi decide Tommi.»), `conversazione_esistente` («Conversazione recente nella casella: nella posta degli ultimi 12 mesi c'è già uno scambio con questo indirizzo. L'assistente non scrive; decide Tommi.»), `invio_incerto` («Invio incerto: controlla in «Posta inviata» se l'email è partita. L'assistente non la rimanda.»), `indirizzo_non_valido` («Indirizzo non valido: il server di posta lo rifiuta, oppure è scritto in un modo che l'assistente non usa.»), `invio_rifiutato` («Il server di posta ha rifiutato l'email.»), `impronta` («Il testo da inviare non era quello approvato: l'email non è partita.»);
  - `PARTNER_ASSISTANT_EVENT_LABELS` con una frase per `prova_avviata`, `prova_inviata`, `prova_casella_vuota`, `prova_casella_trovata`, `prova_casella_incerta`, `invio_abbandonato`, `ricerca_scaduta`, `recapito_cambiato`, `regole_superate`, `bozza_scaduta`, `indirizzo_non_valido`, `conversazione_esistente`, `casella_incerta`, `fermo_casella`, `fermo_rimbalzi`, `fermo_oggi`, `invio_ripreso`;
  - `PARTNER_ASSISTANT_SEND_STATUS_LABELS`: `pronto` «Pronta», `in_invio` «In invio», `inviato` «Inviata», `incerto` «Incerta», `respinto` «Respinta», `scartato` «Non partita»; `PARTNER_ASSISTANT_STOP_LABELS`: `casella` «La casella ha rifiutato la password.», `rimbalzi` «Il server di posta ha rifiutato delle email.»;
  - `type PartnerAssistantSendStatus`, le chiavi di `read_partner_assistant_send` in camelCase (anche `envCheckedAt`, `envMailboxOk`, `envTestOk`, `envTestCount`, `smtpLoginAt`, `smtpLoginCode`, `imapLoginAt`, `imapLoginCode`); `partnerAssistantSendFrom(value: unknown): PartnerAssistantSendStatus` (chiavi esatte, date e numeri validi, `envTestCount` da 0 a 5 o nullo, codici `^[a-z][a-z0-9_]{0,79}$` o nulli, `recent` al massimo 20, altrimenti `PartnerReadError`);
  - `partnerAssistantLoginLine(at: string | null, code: string | null): string`: «mai provato», «riuscito alle 9:41» (`ok`), «non riuscito alle 9:41 (smtp_eauth)»;
  - `PartnerAssistantContactView` con anche `sendPriority: number` (0 senza riga) e `sends: { at: string; status: "inviato" | "incerto" | "respinto"; subject: string }[]` (al massimo 5, il più recente prima).
- Produce in `server.ts`: `loadPartnerAssistantSend(supabase): Promise<PartnerAssistantSendStatus>` con `guarded` e `read_partner_assistant_send`; `ASSISTANT_SWITCH_COLUMNS = "partner_id,active,send_priority,version"`; `ASSISTANT_MESSAGE_COLUMNS = "partner_id,mode,send_status,subject,sent_at,created_at"`, letti in `readPartnerAssistant` con `mode = 'invio'`, `send_status in (inviato, incerto, respinto)`, il più recente prima, 5.
- Produce in `model.ts`: `PartnerActivity.origin: "team" | "file" | "assistente"`, lettore `oneOf(["team","file","assistente"])`; in `partnerActivityLine` con origine `assistente` `who = "dall'assistente"` («29 ott · dall'assistente · Inviato via email»); in `recentSentActivity` la conferma dice «dall'assistente» invece del nome del profilo.
- Produce in `fixtures.ts`: `partnerAssistantFixture(today)` con anche `send: PartnerAssistantSendStatus` (due invii, un fermo nullo, una priorità); in `partnerFixtureDetail` una scheda con `sendPriority: 9` e una con un invio `inviato`.

- [ ] **Passo 1: test che falliscono:**
  - `Object.keys(VALID)` uguale ai diciotto tipi; validatori con i limiti (drafts 4, recipients 0, send_priority 10, daily_first_limit 0 e 16 → rifiutati);
  - `commands.test.ts`: `teamSql()` legge anche `_assistente_partner_invio.sql`, come `_assistente_partner.sql` (righe 33-45); nel test «ogni codice d'errore delle migrazioni dei comandi ha il suo messaggio» il filtro esclude anche `partner_assistant_message_immutable` (lo alza solo il trigger dei messaggi, che nessun comando del team tocca) e, nella sezione 2, i codici del worker che non arrivano mai alla pagina, come già per `research`; il test del messaggio di `partner_assistant_founder_required` (righe 627-633) passa a «Solo Tommi può farlo.»; nessuna voce di `PARTNER_ASSISTANT_ACTION_MESSAGES` è in `PARTNER_ERROR_MESSAGES`;
  - `partnerCommandOutcome` con `{ id, test_run_id, drafts: 2, recipients: 3, replayed: false }` per `start_partner_assistant_test` e con `{ id, status: "ripreso", replayed: false }` per `resume_partner_assistant_send` → `success`, non `null`; con `{ id, version, daily_first_limit: 8, replayed: false }` per `set_partner_assistant_settings` → «Limite salvato: dopo la prima settimana partono al massimo 8 prime email al giorno.»;
  - `setPartnerAssistantMode` `invio` senza posta: nessuna RPC, `partner_assistant_mail_not_configured`; `startPartnerAssistantTest` con `recipients: 2` e `PARTNER_TEST_TO` di tre indirizzi: `partner_assistant_test_to_changed`;
  - frase di «Manda la prova» con `drafts: 2, recipients: 3`: «Prova avviata: partono 6 email di prova, una ogni 4-11 minuti.»;
  - `partnerAssistantSendFrom` con la riga valida, con una chiave in più, con una data non valida, con `envTestCount` 6 e con un `smtpLoginCode` con testo del server;
  - `partnerAssistantLoginLine` nei tre casi;
  - lo stato con un evento `step: "invio"` si legge; un lavoro `inviata` si legge con la sua etichetta;
  - una riga del registro con origine `assistente` si legge e fa «dall'assistente»;
  - `readPartnerAssistant` porta `sendPriority` e `sends`; un errore sulla tabella dei messaggi dà `assistant: null` e la scheda resta leggibile;
  - le fixture passano i lettori.
- [ ] **Passo 2:** FAIL. **Passo 3:** implementare. **Passo 4:** `npm test`, `npm run typecheck` PASS. **Passo 5:** commit (`Assistente Partner: comandi e letture dell'invio nell'app`), push.

### Compito 8: interfaccia: striscia, pagina e scheda

**File:**
- Modifica: `src/components/partner/partner-assistant-strip.tsx`, `partner-assistant-view.tsx`, `partner-assistant-block.tsx` e i loro test
- Modifica: `src/components/partner/partner-context.tsx` (`founder: boolean` nel valore e tra le props del provider), `partner-workspace.tsx` (passa `founder`, `send`, `mailConfigured`), `partner-workspace.test.tsx`
- Modifica: `src/app/(workspace)/partner/page.tsx` (anche `loadPartnerAssistantSend(current.supabase).catch(() => null)`, `mailConfigured = partnerAssistantMailConfig() !== null`, `founder = current.member.role === "founder"`), `src/app/(workspace)/partner/assistente/page.tsx` (lo stesso, più `mail = { configured, testRecipients: config?.testTo.length ?? 0, assistantConfigured: partnerAssistantConfig() !== null }`: il gruppo «assistente» la pagina lo calcola da sé, scelta 14), `page.test.tsx`

**Interfacce:**
- Consuma: compito 7.
- Produce:
  - `PartnerAssistantStrip({ status, send, mailConfigured })`, con `send: PartnerAssistantSendStatus | null`. Testi:
    - «Invio»: «Assistente in invio · 3 email oggi su 5 · 12,30 USD spesi»;
    - «Prova»: «Assistente in prova · 4 email di prova oggi · 12,30 USD spesi»;
    - «Prepara» e «Spento»: come nella consegna 1.
    Fondo ambra, con la parola scritta, in «Prova» e «Invio» per: `stopReason` («Invii fermi: » + `PARTNER_ASSISTANT_STOP_LABELS` + « Tommi li riprende dalla pagina dell'assistente.»), `dayStoppedOn` di oggi («Invii fermi per oggi: errori temporanei del server di posta. Riprendono domani.»), `mailConfigured` falso («Posta dell'assistente non configurata: niente invii.»), `send` nullo («Stato degli invii non leggibile: ricarica la pagina tra poco.»). Mai indirizzi.
  - `PartnerAssistantView` riceve anche `send`, `founder`, `mail: { configured: boolean; testRecipients: number; assistantConfigured: boolean }`. Cambia:
    - **Modalità:** frasi nuove in `MODE_SENTENCES`: prova «manda le email di prova solo agli indirizzi di prova di Tommi, con l'oggetto e il testo delle email vere»; invio «manda le prime email ai contatti dalla casella aziendale, nei giorni feriali tra le 9:30 e le 11 dell'ora del contatto, una ogni 4-11 minuti». «Prova» e «Invio» attivi solo per il founder con la posta configurata; agli altri «Li sceglie solo Tommi.»; senza posta «La posta dell'assistente non è configurata.»; «Invio» disabilitato senza `testConfirmedAt`, con «Prima serve una prova confermata.». Il credito si salva in ogni modalità. Spariscono «Arrivano con la seconda consegna.» e «Per ora non manda niente».
    - **Prova** (in «Prova»): per il founder «Manda la prova» con la scelta 1, 2 o 3 bozze e la frase «Partono N × M email di prova, una ogni 4-11 minuti.» (`M = mail.testRecipients`; con 0 il pulsante è disabilitato con «Nessun indirizzo di prova configurato.»); l'ultima prova («Avviata alle 8:31 · 3 su 4 partite»); con una prova partita e senza conferma, «La prova è arrivata in posta in arrivo» (founder) con la nota «Premilo solo se le email sono in posta in arrivo, non in spam, in tutte le caselle.»; con la conferma «Prova confermata il 29 ottobre alle 9:12 da Tommi.».
    - **Invii** (in «Prova» e «Invio»): «Oggi: 3 email su 5» (in prova «Oggi: 4 email di prova su 15»); finestra («Finestra aperta fino alle 11:00, ora di Roma» oppure «Prossima finestra: lunedì 2 novembre alle 9:30, ora di Roma», con la nota «Per i contatti in altri fusi vale la loro ora.»); «Prossimo invio non prima delle 10:12»; fermo con il motivo e, per il founder, «Riprendi l'invio»; «In attesa fino alle 10:40: la casella non ha risposto.» con `backoffUntil`; «Bozze pronte da inviare: N»; «Manda per primo» con l'elenco `priorities`; «Ultime email» da `recent`: ora, CO e nome con il link alla scheda, «Prova» se lo è, stato con `PARTNER_ASSISTANT_SEND_STATUS_LABELS`, oggetto.
    - **Limite** (founder, in ogni modalità): «Dopo la prima settimana: al massimo N prime email al giorno» con un campo da 1 a 15 e «Salva», che chiama `setPartnerAssistantSettings` con `{ schema_version: 1, expected_version, daily_first_limit }`; agli altri la sola frase. Con la prima settimana in corso, la nota «Fino al <giorno> ne partono al massimo 5.».
    - **Variabili e accessi** (perimetro, punto 7; per tutti, mai valori né lunghezze): «Variabili dell'assistente: valide» o «mancanti o nel formato sbagliato» (da `mail.assistantConfigured`); «Casella: …» (da `envMailboxOk`); «Indirizzi di prova: validi, N indirizzi» o «mancanti o nel formato sbagliato» (da `envTestOk` e `envTestCount`); «Controllate dal worker alle 9:40» (`envCheckedAt`; nullo: «Il worker non le ha ancora controllate.»); «Ultimo accesso SMTP: …» e «Ultimo accesso IMAP: …» con `partnerAssistantLoginLine`. Sotto, una riga: «Una variabile cambiata in Vercel vale dal deploy successivo.».
    - **Da vedere:** «Ridai all'assistente» nascosto per `conversazione_esistente` e `invio_incerto`.
  - `PartnerAssistantBlock`: con `sends` la riga «Email inviata dall'assistente il 29 ottobre alle 9:41» (`incerto`: «Invio incerto il …: controlla in «Posta inviata».»; `respinto`: «Email respinta dal server il …»); lo stato `inviata` «Prima email inviata dall'assistente: il sollecito dopo 7 giorni lo manda Tommi.»; per il founder, finché il lavoro non è `inviata` né `serve_tommaso`, «Manda per primo» (`send_priority: 9`) oppure, con la priorità, «Questo contatto parte per primo appena la bozza è pronta.» e «Togli la precedenza» (`send_priority: 0`); la frase «Per ora l'assistente non manda niente.» sparisce.
  - In anteprima tutto si vede con le fixture e nessun comando parte.

- [ ] **Passo 1: test che falliscono** (`@testing-library`, come i test della consegna 1):
  - la striscia in «Invio», «Prova», fermo per la casella, fermo per oggi, posta non configurata, invii non leggibili; nessun `@` nel testo;
  - un consulente vede «Prova» e «Invio» disabilitati con «Li sceglie solo Tommi.»; il founder senza posta li vede disabilitati con la frase della posta;
  - il founder in «Prova» con 3 indirizzi sceglie 2 bozze: «Partono 2 × 3 email di prova» e `startPartnerAssistantTest` riceve `{ schema_version: 1, drafts: 2, recipients: 3 }`;
  - il founder senza conferma ha «Invio» disabilitato; «La prova è arrivata in posta in arrivo» chiama `confirmPartnerAssistantTest` con `expected_version`;
  - con `stopReason: "rimbalzi"` il founder vede «Riprendi l'invio» (chiama `resumePartnerAssistantSend`), il consulente no;
  - «Ultime email» con lo stato «Incerta» e il tag «Prova»; la finestra chiusa di sabato mostra «lunedì 2 novembre alle 9:30»;
  - il blocco della scheda con un invio mostra «Email inviata dall'assistente il …»; «Manda per primo» manda `send_priority: 9` solo per il founder;
  - credito salvato anche in «Invio»;
  - il founder cambia il limite a 8: `setPartnerAssistantSettings` riceve `{ schema_version: 1, expected_version, daily_first_limit: 8 }`; il consulente vede solo la frase;
  - «Variabili e accessi» con la casella valida, la prova non valida e un accesso SMTP fallito: «Indirizzi di prova: mancanti o nel formato sbagliato», «Ultimo accesso SMTP: non riuscito alle 9:41 (smtp_eauth)»; con `envCheckedAt` nullo «Il worker non le ha ancora controllate.»; nessun `@` e nessun valore delle fixture delle variabili nel testo;
  - nessun `<main>` né link vietati; `ui-copy.test.ts`, `design-floor.test.ts`, `workspace-routes.test.ts` passano.
- [ ] **Passo 2:** FAIL. **Passo 3:** implementare. **Passo 4:** `npm test`, `npm run typecheck` PASS. **Passo 5:** commit (`Assistente Partner: prova e invio nell'interfaccia`), push.

### Compito 9: guida, documenti, verifica finale e pull request

**File:**
- Modifica: `src/components/guide-view.tsx` (righe 446-490), `src/components/guide-view.test.tsx` (righe 261-266)
- Modifica: `docs/partner-assistente.md`, `docs/deployment.md` («Assistente Partner: variabili»), `docs/verification.md`, `docs/partner.md`, `docs/workspace-layout.md` (riga 80), `docs/README.md` (riga 67)
- Aggiunge al branch: questo piano (`docs/superpowers/plans/2026-10-28-assistente-partner-consegna-2a.md`). Il piano completo della consegna 2 resta fuori, per la 2b.

**Interfacce:**
- Consuma: tutti i compiti.
- Produce:
  - Guida, parte «L'assistente»: il test che vieta «l'assistente manda» diventa quello che controlla le frasi nuove, scritte così: «In «Invio» l’assistente manda le prime email dalla casella aziendale, nei giorni feriali tra le 9:30 e le 11 dell’ora del contatto.», «Prima Tommi fa una prova con «Manda la prova» e la conferma con «La prova è arrivata in posta in arrivo».», «Le risposte arrivano nella casella aziendale come sempre: l’assistente non le legge.», «Il sollecito dopo 7 giorni lo manda Tommi: lo trova nella sua Oggi.». Restano le frasi su come fermarlo.
  - `docs/partner-assistente.md`: sezione «Seconda consegna, parte 1 (2a): l'invio» con che cosa fa e che cosa no (le due liste di questo piano), tabelle e RPC della migrazione, modalità con la prova confermata, finestra, limiti e il campo del limite, ordine, frase di uscita, ricontrollo delle date, controllo dei 12 mesi, esiti SMTP per fase e fermi, «Riprendi l'invio», variabili e il riquadro «Variabili e accessi», test; la tabella delle modalità senza «(seconda consegna)»; la riga «Fuori da questa consegna» aggiornata; la sequenza di avvio dell'Appendice C.
  - `docs/deployment.md`: righe per `PARTNER_MAIL_USER`, `PARTNER_MAIL_PASSWORD`, `PARTNER_MAIL_FROM_NAME`, `PARTNER_TEST_TO`, `PARTNER_MAIL_SMTP_HOST`, `PARTNER_MAIL_IMAP_HOST`, con le regole del compito 3, la nota «una variabile cambiata vale dal deploy successivo» e il riquadro «Variabili e accessi» della pagina dell'assistente per controllarle senza vederne i valori.
  - `docs/verification.md`: sezione del branch con i comandi e i numeri, gli harness nuovi (`assistente-partner-invio-comandi.mjs` e `assistente-partner-invio.mjs` su PGlite, `assistente-partner-invio-concurrency.mjs` su PostgreSQL 17) con i minimi stampati, e i minimi di catena 112, 114, 129, 181.
  - `docs/partner.md`: origine `assistente` nel registro e il promemoria a Tommi dopo una prima email dell'assistente.
  - `docs/workspace-layout.md`, riga 80: «Per ora prepara solo bozze e non manda niente» diventa «Con «Invio» manda le prime email; le risposte restano nella casella».
  - `docs/README.md`, riga 67, dopo il piano della prima consegna: «, [Piano della consegna 2a (invio)](superpowers/plans/2026-10-28-assistente-partner-consegna-2a.md)»; e la riga 66 senza «nessun invio».

- [ ] **Passo 1:** aggiornare `guide-view.test.tsx` e vederlo fallire. **Passo 2:** guida. **Passo 3:** `npx vitest run src/components/guide-view.test.tsx` PASS. **Passo 4:** documenti. **Passo 5:** commit (`Assistente Partner: guida e documenti della consegna 2a`), push.
- [ ] **Passo 6:** `npm run format` due volte, `npm run format:check`, poi `npm run typecheck`, `npm test`, `npm run build` (`git checkout -- next-env.d.ts` se cambia), `npm run test:db`. Atteso: tutto PASS; gli harness PostgreSQL 17 saltati senza `LUCKYLAP_PG_BIN`.
- [ ] **Passo 7:** `grep -rnE "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(com|it|de|fr|es|ch|at|uk|net|org)" src supabase/tests docs/partner-assistente.md` sui file del branch: solo `example.test`, più la casella aziendale nei due file dove `AGENTS.md` la permette. `grep -rn "ai_disclosure\|\[Prova\]" src supabase/migrations --exclude='*.test.ts' --exclude='*.test.tsx'` non trova niente (i test li nominano per controllarne l'assenza).
- [ ] **Passo 8:** anteprima locale (`LUCKYLAP_LOCAL_PREVIEW=true`) di `/partner` (striscia), di una scheda (blocco «Assistente», registro) e di `/partner/assistente` (modalità, «Prova», «Invii»), da computer e a 390 px.
- [ ] **Passo 9:** pull request verso `main` con l'esito dei comandi, gli harness saltati, le scelte di questo piano e la sequenza dell'Appendice C. Il merge, la migrazione e le variabili restano di Tommi.
- [ ] **Passo 10:** con il job CI «Concorrenza (PostgreSQL 17)» verde, portare la riga 1 di `assistente-partner-invio-concurrency.mjs` da `minimo 1` al numero stampato in CI, scriverlo in `docs/verification.md`, `npm run format:check`, commit (`Assistente Partner: minimo dell'harness di concorrenza dell'invio`), push. Atteso: CI di nuovo verde, senza «Alzare il minimo».

---

## Appendice A: frasi di uscita (compito 3)

Aggiunte dal sistema dopo la firma, separate da una riga vuota; non contano nelle parole del corpo e non entrano nell'impronta della bozza approvata, solo in quella del messaggio composto. Le rivede Luca prima di «Invio» (una modifica è una pull request su `mail-compose.ts`, senza migrazione). Così come sono:

| Chiave | Testo |
|---|---|
| `it_voi` | Se non è il momento, o preferite non ricevere altre email, scrivetemelo pure: non vi ricontatterò. |
| `it_lei` | Se non è il momento, o preferisce non ricevere altre email, me lo scriva pure: non la ricontatterò. |
| `en` | If the timing isn't right, or you'd rather not hear from me again, just let me know and I won't write again. |
| `de` | Falls es gerade nicht passt oder Sie keine weiteren E-Mails wünschen, schreiben Sie mir einfach, dann melde ich mich nicht mehr. |
| `fr` | Si ce n'est pas le bon moment, ou si vous préférez ne plus recevoir d'e-mails de ma part, dites-le-moi simplement : je ne vous écrirai plus. |
| `es` | Si no es el momento, o prefiere no recibir más correos, dígamelo sin problema: no volveré a escribirle. |

## Appendice B: feste e paesi (compito 2)

Solo le feste nazionali dal 29 ottobre 2026 al 31 gennaio 2027, senza le date tra il 21 dicembre e il 7 gennaio (già senza invii), per i nove paesi del piano completo (Appendice B lì). Per il Regno Unito i giorni festivi di Inghilterra e Galles; per la Svizzera quelli di tutti i cantoni.

| Codice | Date |
|---|---|
| IT | 2026-11-01, 2026-12-08 |
| AT | 2026-11-01, 2026-12-08 |
| FR | 2026-11-01, 2026-11-11 |
| ES | 2026-11-01, 2026-12-06, 2026-12-08 |
| BE | 2026-11-01, 2026-11-11 |
| GB, DE, CH, NL | nessuna nel periodo |

Righe per paese (`holidayCounts` del test): IT 2, AT 2, FR 2, ES 3, BE 2.

Alias di `partners.country`, confrontati dopo `lower(btrim(...))`:

| Codice | Alias |
|---|---|
| IT | `italia`, `italy`, `it` |
| GB | `regno unito`, `gran bretagna`, `inghilterra`, `united kingdom`, `uk`, `england`, `gb` |
| DE | `germania`, `germany`, `deutschland`, `de` |
| AT | `austria`, `österreich`, `at` |
| CH | `svizzera`, `switzerland`, `schweiz`, `suisse`, `ch` |
| FR | `francia`, `france`, `fr` |
| ES | `spagna`, `spain`, `españa`, `es` |
| BE | `belgio`, `belgium`, `belgique`, `belgië`, `be` |
| NL | `paesi bassi`, `olanda`, `netherlands`, `nederland`, `nl` |

Un paese non in elenco non ha feste (e il controllo all'avvio lo segnala).

## Appendice C: sequenza di avvio di domattina (29 ottobre 2026)

Ogni passo con l'OK di Tommi in chat (`AGENTS.md`). Prima: la pull request ha tutti i comandi verdi e il job CI «Concorrenza (PostgreSQL 17)» verde. Lo scheduler non cambia: nessuna riconfigurazione di Vault o pg_cron. Decisione di Tommaso per oggi: **5 email in tutto, le più urgenti**, Milano AutoClassica per prima, poi gli eventi con la data più vicina (l'ordine della coda); poi l'assistente torna in «Prepara».

1. **Verifiche in sola lettura (dalle 7:30).** La configurazione dell'assistente è «Prepara» con il profilo tecnico e `handoff_to`; il numero di lavori `pronta` (servono almeno 5 per oggi); i valori distinti di `partners.country` tra i contatti con email, confrontati con l'Appendice B (un paese che manca non ha feste: Tommi lo accetta per oggi o si aggiunge con una migrazione piccola); il lavoro di Milano AutoClassica (stato e passo).
2. **Variabili in Vercel produzione, prima del merge:** `PARTNER_MAIL_USER` (la casella aziendale), `PARTNER_MAIL_PASSWORD`, `PARTNER_TEST_TO` con gli indirizzi di prova di Tommaso su Gmail, Outlook e iCloud più l'indirizzo di mail-tester di stamattina (da 1 a 5, separati da virgole); facoltative `PARTNER_MAIL_FROM_NAME` (senza vale «Tommaso | LuckyLap»), `PARTNER_MAIL_SMTP_HOST` e `PARTNER_MAIL_IMAP_HOST` (senza valgono `smtp.ionos.it` e `imap.ionos.it`). Nessuna negli ambienti preview. Una variabile cambiata dopo il deploy vale solo dal deploy successivo.
3. **Migrazione in produzione, prima del merge,** con la procedura di `docs/verification.md` («Produzione, 28 ottobre 2026»): impronte md5 in sola lettura prima (`partners`, `partner_contacts`, `partner_activities`, `tasks`, `partner_work_links`, `profiles`, `memberships`, le tabelle `partner_assistant_*`, la riga di configurazione, `cron.job`); applicazione con il testo esatto del file; md5 del testo salvato uguale al file; rinomina del file alla versione cloud, commit e push sul branch (i riferimenti per suffisso degli harness non cambiano); impronte dopo, identiche salvo quanto previsto (tabelle nuove, colonne nuove, vincoli di origine e di stato, funzioni ridefinite); avvisi di sicurezza solo quelli noti. Il codice della consegna 1 regge la migrazione (vincoli globali).
4. **Merge su `main`** (è il deploy), con la CI verde dopo la rinomina. Controllare il deploy su Vercel, un giro del worker («Ultimo giro» nella pagina) e il riquadro «Variabili e accessi»: tre gruppi «valide», «Indirizzi di prova: validi, N indirizzi» con il numero giusto. Se un gruppo non è valido, si corregge quella variabile e si rifà il deploy prima di andare avanti.
5. **Milano AutoClassica per prima, subito dopo il merge.** Dalla sua scheda Tommi preme «Manda per primo» (`send_priority` 9): è un dato, non codice. Con la priorità la sua bozza si prepara per prima (scelta 6), se non è già `pronta`, ed è anche la prima scelta da «Manda la prova». Se il controllo dei 12 mesi trova una conversazione recente, passa a Tommi con «Conversazione recente nella casella» e la scrive lui.
6. **Prova, alle 8:30.** Tommi sceglie «Prova», poi «Manda la prova» con **una** bozza (quella di AutoClassica, se è già pronta): con 4 indirizzi partono 4 email, una ogni 4-11 minuti, in 25-45 minuti circa (con tre bozze sarebbero 12 email e circa un'ora e mezza: finirebbero dentro la finestra d'invio). Controllare: le email in posta in arrivo, non in spam, su Gmail, Outlook e iCloud; il voto di mail-tester (almeno 9/10); la copia in «Posta inviata» della casella; negli eventi `prova_casella_vuota` o `prova_casella_trovata` (la ricerca dei 12 mesi funziona); in «Variabili e accessi» «Ultimo accesso SMTP: riuscito» e «Ultimo accesso IMAP: riuscito». Con `prova_casella_incerta` o un fermo per la casella ci si ferma e si decide con Tommi: senza quella ricerca nessuna email vera parte.
7. **Conferma.** Solo con tutte le caselle in posta in arrivo e il voto di mail-tester di almeno 9/10, Tommi preme «La prova è arrivata in posta in arrivo». Altrimenti si resta in «Prova» o in «Prepara» e si decide con lui.
8. **Invio, dalle 9:30.** Prima, in sola lettura, il lavoro di Milano AutoClassica è `pronta`: se non lo è, si decide con Tommi se aspettare la sua bozza prima di scegliere «Invio». Poi Tommi sceglie «Invio». Oggi al massimo 5 prime email, ognuna tra le 9:30 e le 11 dell'ora del contatto, una ogni 4-11 minuti: AutoClassica per prima, poi gli eventi con la data più vicina. I contatti nel Regno Unito partono dalle 10:30 di Roma.
9. **Ritorno a «Prepara».** Alla quinta email partita (pagina: «Oggi: 5 email su 5») Tommi sceglie «Prepara» dalla pagina, oppure lo fa Claude con il suo OK in chat. L'assistente resta in «Prepara» finché Tommi non è sicuro che le email non finiscono in spam: la prova del mattino, mail-tester e le prime risposte. Poi Tommi riaccende «Invio» per gli altri contatti, con il ritmo previsto; la prova confermata resta valida. Senza questo passo venerdì 30 partirebbero altre 5 email da sole.
10. **Dopo.** Nella pagina «Ultime email» e i fermi; in «Posta inviata» le copie; nella Oggi di Tommi, dopo 7 giorni, «Sollecito · <nome>» per ogni prima email; le risposte arrivano nella casella come sempre. «Ferma l'assistente» resta a disposizione di tutti.

## Autoverifica

1. **Copertura del perimetro.** Modalità «prova» e «invio» con il founder, la prova confermata e il rifiuto senza posta: compiti 1, 7, 8. Preparazione che continua in «prova» e «invio» (claim e checkpoint): compito 1. Coda in SQL con l'ora da un helper, idoneità, finestra 9:30-11:00, fusi, feste ridotte, limiti 5 e `daily_first_limit`, intervallo 4-11 minuti, età della ricerca, ordine con `send_priority`, pulizia fino al candidato: compito 2. Limite cambiato dalla pagina (Q10): compiti 1, 7, 8. Ricontrollo delle date all'invio (Q15, «Bozze vecchie»): compiti 2, 5, 6. Invio un passo alla volta con un lock della casella, MailComposer, intestazioni, testo semplice, firma e frase di uscita, controllo dei 12 mesi in EXAMINE con «non so» (anche con un `[]` da una connessione non valida), SMTP 587 STARTTLS per fasi con `envelope`, APPEND con `\Seen`, stati solo in avanti: compiti 1-4 e 6. Scheda «Contattato», riga `inviato` di origine `assistente`, promemoria a 7 giorni per Tommaso: compiti 1, 2, 7. Indice unico, regole nuove e cancellazione che non lo aggirano: compiti 1 e 2. Esiti SMTP (credenziali, 5.1.x, 5.7.x e spam, due definitivi, 4.x.x e 450 tre volte, incerto, connessione caduta durante l'invio): compiti 2, 3, 6. Prova con oggetto vero, 1-5 indirizzi, 1-3 bozze, 15 al giorno, senza effetti sulla scheda: compiti 1, 2, 6, 8. Variabili leggibili dalla pagina e ultimi accessi SMTP e IMAP, senza valori: compiti 1, 2, 3, 6, 7, 8. Interfaccia: compito 8. Dipendenze: compito 3. Test di unità, PGlite con l'ora fissata, PostgreSQL 17 con l'ora fissata e fake: compiti 1-8. Minimi di catena: compito 1. Documenti e avvio, con AutoClassica per prima e il ritorno a «Prepara» dopo le 5 email: compito 9 e Appendice C. Niente dichiarazione di IA: vincoli globali e controlli nei compiti 1 e 9.
2. **Passi.** Ogni passo di codice ha file, firma e valori; i corpi sono lasciati all'implementatore tranne dove la regola non è determinata dai test (ordine dei controlli di `prepare`, cancelli e pulizia di `claim`, fasi ed esiti SMTP, traduzione degli esiti in `finish`). Gli helper degli harness hanno regole scritte (ora, lease, coda) perché da quelle dipende ogni `eq`.
3. **Coerenza dei nomi.** `partner_assistant_send_order` (compito 1, con `event_starts_on`) è usata da `start_partner_assistant_test`, `claim_partner_assistant_send` e `read_partner_assistant_send`; i motivi `conversazione_esistente`, `invio_incerto`, `indirizzo_non_valido`, `invio_rifiutato`, `impronta`, `bozza_scaduta` sono gli stessi in SQL (compiti 1-2), nel ricontrollo (compito 5), nello `skip` (compito 6), nelle etichette (compito 7) e nell'interfaccia (compito 8); le nove RPC d'invio hanno gli stessi nomi in SQL, in `PARTNER_ASSISTANT_SEND_RPC_NAMES` e in `transport.test.ts`; `release` ha la stessa forma `(lease, payload)` in SQL, nello store e nell'harness; i motivi di `finish` `smtp_temporaneo`, `smtp_non_partito`, `smtp_credenziali`, `smtp_bloccato` corrispondono agli esiti `temporaneo`, `non_partito`, `credenziali`, `bloccato` di `smtp.ts`; `env_mailbox_ok`/`env_test_ok`/`env_test_count` vengono da `casella`/`prova`/`indirizziProva` del rapporto; `mailboxCheck` ha i tre valori `vuota`, `trovata`, `incerta` in SQL e in TypeScript; `p_test_recipients` arriva da `mail.testTo.length`; `set_partner_assistant_settings` ha le stesse chiavi nei compiti 1, 7 e 8.
4. **Fuoco della revisione.** I cinque casi hanno i loro test segnati nei compiti 2, 3, 4 e 6.
5. **Proporzione.** Nove compiti, un ciclo di test per ciascuno; i blocchi di codice sono test e valori fissati dal perimetro.
