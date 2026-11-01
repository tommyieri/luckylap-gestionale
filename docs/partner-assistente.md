# Assistente Partner

L'assistente lavora i contatti del modulo Partner con Claude: cerca notizie su ogni contatto, sceglie la proposta, scrive la prima email e la controlla. Dalla consegna 2a la manda anche. Questo documento descrive:

- la **prima consegna** («prepara», branch `claude/assistente-partner`, base `origin/main` a `3c58693`, pull request #22): ricerca e bozze salvate nel gestionale, nessun invio. È in produzione dal 28 ottobre 2026;
- la **consegna 2a** («invio», branch `claude/assistente-partner-invio`): l'assistente manda le prime email già pronte e approvate, prima in prova verso le caselle di Tommaso e poi ai contatti. Vedi «Seconda consegna, parte 1 (2a): l'invio»;
- la **modalità modello per i club** (branch `claude/assistente-modello-club`): per i contatti della sezione Club la prima email è il testo fisso approvato da Tommaso e Claude fa solo la seconda lettura. Vedi «Modalità modello per i club».

Il perché di ogni scelta è nella [specifica](superpowers/specs/2026-10-27-assistente-partner-design.md), approvata da Tommaso il 27 ottobre 2026. I passi di lavoro sono nei piani: [prima consegna](superpowers/plans/2026-10-27-assistente-partner-consegna-1.md) e [consegna 2a](superpowers/plans/2026-10-28-assistente-partner-consegna-2a.md). Il resto del modulo è in [partner.md](partner.md).

Nell'interfaccia il founder è «Tommi»; le email sono firmate «Tommaso».

## Stato al 30 ottobre 2026

- Le tre migrazioni della prima consegna sono in produzione dal 28 ottobre 2026 e non si modificano più.
- La migrazione della consegna 2a, `supabase/migrations/20261030114722_assistente_partner_invio.sql`, è in produzione dal 30 ottobre 2026 (versione cloud `20261030114722`), applicata da Claude prima del merge con la procedura delle impronte. I dati esistenti sono rimasti identici; gli esiti sono in [verification.md](verification.md). Gli harness e i test la cercano per suffisso (`_assistente_partner_invio.sql`).
- Il merge della consegna 2a viene dopo la migrazione: la sequenza è in «Avvio della consegna 2a».

## Cosa fa la prima consegna

Ogni due minuti pg_cron chiama la route `POST /api/integrations/partner-assistant/worker`. La route risponde subito `202` e, dopo la risposta (`after()`), fa **un solo passo di un solo contatto**, con un tempo massimo di 270 secondi (`maxDuration` 300). Lo stato resta nel database tra un passo e l'altro, e un solo passo lungo gira alla volta: se un lavoro ha già la lease, il giro dopo trova l'assistente «occupato» e non fa niente.

I passi di un contatto sono quattro, ognuno con una chiamata a Claude Opus 5.5 (`claude-opus-5-5`, thinking adattivo):

1. **Ricerca**: sul web (`web_search`, `web_fetch`), con le fonti. Parte dalla scheda ma non si fida di date e nomi già scritti.
2. **Estrazione**: dalla ricerca, in campi fissi (output strutturato), il tipo di contatto, la lingua e la forma di cortesia, la persona giusta, il fuso, il fatto da citare con la fonte, il prossimo evento e il momento giusto per scrivere. Poi il codice sceglie la proposta da un elenco chiuso e decide: scrivere adesso, aspettare una data (`attesa`) o passare il contatto a Tommi (manca un fatto vero o il fuso).
3. **Scrittura**: oggetto e corpo; la firma la compone il codice. Poi i controlli nel codice: parole vietate in tutte le lingue (conto vendita compreso), segnaposto, un solo `?`, nessun `!` né emoji, unico link `https://luckylap.com`, nessun telefono nel corpo, firma giusta per la lingua, solo 964 e GT3 RS con i contatti Porsche, corpo tra 110 e 160 parole. Una bozza che non passa si riscrive una volta; alla seconda il contatto passa a Tommi.
4. **Controllo**: una seconda lettura di Claude con le regole davanti, che approva o rimanda indietro. Una bozza scritta con regole superate torna in scrittura senza chiamare Claude.

Alla fine il lavoro è «Bozza pronta»: il team la legge nella scheda del contatto, nel blocco «Assistente». La bozza va sempre all'email attiva del gestionale (prima la verificata); un indirizzo diverso trovato dalla ricerca resta una proposta scritta nel blocco.

L'assistente prende solo contatti «Da contattare», senza «Seguito da», senza prossima azione, non tolti dalla ricerca, non in «Non contattare», con l'interruttore della scheda assente o attivo, con un'email attiva e senza attività del team o dei file «Esporta». Prima quelli pianificati entro due mesi, poi per priorità (alta, media, bassa), per mese e per CO. Se il team cambia il contatto durante un passo (lo segue, lo ferma, lo mette in «Non contattare», cambia l'email), il passo non avanza.

Errori e tentativi:

- credito finito (402, `billing_error`, 400 con «credit balance»): pausa di tutto l'assistente, nessun tentativo consumato; la striscia e la pagina lo dicono;
- chiave o permessi rifiutati (401, 403) ed errori di configurazione (404, oppure un 400 che dice che il modello o una funzione non è disponibile): pausa per errore di Claude, nessun tentativo consumato;
- Claude sovraccarico, al limite di velocità o non raggiungibile (429, 529, 5xx, connessione caduta anche a metà risposta): attesa di dieci minuti per tutto l'assistente. Se la chiamata non aveva ancora speso, nessun tentativo consumato; se aveva già speso (token in uscita o una ripresa), si consuma un tentativo e l'attesa per tutti resta: così un contatto non spende all'infinito;
- risposta di Claude rotta, rifiutata, troncata o interrotta dal nostro timer: un tentativo consumato; al terzo il contatto va a «Serve Tommi» e la coda continua;
- ogni altro errore dell'API (per esempio un 400 «prompt is too long» o un 413): un tentativo consumato, come una risposta rotta.

Fuori dalla prima consegna: l'invio, le modalità «prova» e «invio» e l'origine `assistente` nel registro Partner arrivano con la consegna 2a (sotto). Restano per la consegna 2b: lettura della casella, risposte, solleciti dell'assistente, passaggio a Tommi con un riassunto e una risposta suggerita, riepilogo serale e le frasi dell'assistente nel feed di Controllo CEO.

## Parere di Luca e decisioni del 27 ottobre

Il 27 ottobre pomeriggio Luca, il consulente, ha riletto i testi; Tommaso ha detto «procedi con il resto». In breve (dettagli nella specifica, «Parere di Luca»):

- una **proposta concreta per tipo** di contatto, scelta dal codice: merch co-firmato (club ed eventi che non possiamo raggiungere, `merch_cobranding`), capsule insieme (brand e media, `collab_capsule`), stand all'evento (eventi raggiungibili, `stand_evento`), vendita in negozio (negozi, `vendita_negozio`); niente prezzi, numeri o commissioni;
- **mai l'età** nelle email;
- il link è `https://luckylap.com`, con lo schema, così è cliccabile;
- la prima email chiede garbatamente un **recapito telefonico** e lascia il **numero di Tommaso nella firma**, su quattro righe;
- nella seconda consegna: fino a **quattro solleciti**, a 7, 17, 45 e 90 giorni dalla prima email, e **ogni prima risposta di una persona passa subito a Tommaso**, con un riassunto e una proposta di risposta: l'assistente non risponde da solo.

Le regole di scrittura in vigore sono un testo versionato nel database (versione 1: Appendice A del piano) e si cambiano dalla pagina dell'assistente, senza deploy.

## Dove si vede nel gestionale

- **Striscia** in cima a `/partner`: modalità, bozze pronte e spesa, con «Apri l'assistente» e «Ferma l'assistente». Spento, in pausa, non configurato o non leggibile: fondo ambra con la parola scritta.
- **Pagina** `/partner/assistente` (link «Assistente» nel piede di Partner): stato e ultimi eventi, modalità e credito di partenza, coda, spesa, «Da vedere» (i contatti passati a Tommi, con «Ridai all'assistente») e regole, con le versioni. «Da vedere» e i conteggi In coda, In attesa della data, Bozza pronta e Serve Tommi contano solo i contatti che l'assistente può ancora prendere: un contatto fermato nella scheda, seguito dal team o non più «Da contattare» esce da lì. «Fermati dal team» conta invece i contatti con l'interruttore fermo. Credito e regole partono dalla versione letta: se un collega le cambia nel frattempo, il campo si riallinea al valore salvato e il proprio resta visibile a parte.
- **Blocco «Assistente»** nella scheda del contatto: stato del lavoro, motivo per cui l'assistente non lo prende, proposta e motivo, ricerca con le fonti, bozza in una sezione apribile («Bozza dell'email») e l'interruttore «Assistente su questo contatto: attivo / fermo» (diverso da «Non contattare»).
- Con la consegna 2a la striscia, la pagina e il blocco mostrano anche prova, invii, limite, variabili e accessi: vedi «Seconda consegna, parte 1 (2a): l'invio», «Nell'interfaccia».
- La guida «Come si usa», parte «Partner», spiega tutto questo al team.

Le pagine mostrano i dati del caricamento e funzionano anche in anteprima senza database. Prima delle migrazioni (funzione o tabella mancante: codici `PGRST202`, `PGRST205`, `42883`, `42P01`, con un oggetto dell'assistente, `partner_assistant`, nel messaggio) l'assistente è «non attivo»: striscia e blocco non si mostrano e la pagina dell'assistente dice «Assistente non ancora attivo.». Se invece la lettura non riesce per un altro motivo, striscia e blocco dicono in ambra «stato non leggibile». In tutti e due i casi il resto di Partner resta com'è.

## Tabelle e RPC

Tre migrazioni additive:

| Migrazione | Contenuto |
| --- | --- |
| `20261028122704_assistente_partner.sql` | Tabelle, regole versione 1, comandi del team, lettura dello stato |
| `20261028122956_assistente_partner_worker.sql` | Coda, RPC del worker, revoca a `service_role` delle scritture dirette sulle tabelle Partner |
| `20261028123036_assistente_partner_scheduler.sql` | Scheduler ogni due minuti (pg_cron, pg_net, Vault) |

Tabelle in `public`, leggibili dai membri del team (RLS `member_read`) e scritte solo dalle RPC:

- `partner_assistant_rules`: le regole di scrittura, una riga per versione, append-only;
- `partner_assistant_contacts`: l'interruttore per contatto (attivo o fermo), con audit su contatto, stato e versione;
- `partner_assistant_jobs`: un lavoro per contatto, con stato (`in_coda`, `attesa`, `pronta`, `serve_tommaso`), passo, lease, tentativi (al massimo 3), riscritture (al massimo 1), data per scrivere e motivo;
- `partner_assistant_notes`: ricerca con le fonti, scelta e controllo, append-only. La ricerca dell'assistente non va in `partners.research`, che ogni import sovrascrive;
- `partner_assistant_drafts`: le bozze, append-only, con il recapito (`contact_id`, non l'indirizzo copiato), la versione della scheda e delle regole e l'impronta SHA-256 di oggetto, corpo e firma.

Tabelle in `private`, non leggibili da nessun ruolo client: `partner_assistant_config` (riga unica con modalità, profilo dell'assistente e di Tommi, credito di partenza, pausa, attesa, ultimo giro), `partner_assistant_runs` (una riga per chiamata a Claude: token, ricerche web, costo), `partner_assistant_events` (registro delle esecuzioni, solo codici), `partner_assistant_receipts` (ricevute idempotenti) e `partner_assistant_scheduler_state` (puntatore al segreto in Vault).

Nessun testo, indirizzo o segreto finisce nei log, nelle risposte HTTP, negli eventi o nelle colonne con audit. La cancellazione definitiva di un recapito («Cancella il dato») cancella anche note e bozze del contatto e passa il lavoro a Tommi con il motivo «dato cancellato» (un lavoro che era già di Tommi tiene il suo motivo): non lo rimette in coda dall'inizio, così una ricerca rifatta non risalva il dato cancellato. Lo si ridà all'assistente con «Ridai all'assistente» in «Da vedere», se il contatto è ancora tra quelli che l'assistente può prendere, oppure dalla scheda fermando e riattivando l'interruttore «Assistente su questo contatto»; in entrambi i casi riparte dalla ricerca.

RPC dei membri (`authenticated`, con `partner_actor()` e ricevute per `operation_id`): `set_partner_assistant_mode`, `set_partner_assistant_contact`, `save_partner_assistant_rules` e `read_partner_assistant_status`. «Prova» e «Invio» li sceglie solo il founder: nella prima consegna erano rifiutati, con la migrazione della 2a sono ammessi («Invio» solo con la prova confermata).

RPC del worker, eseguibili solo da `service_role`, ognuna con la guardia sul ruolo: `claim_partner_assistant_step`, `context_partner_assistant_step`, `checkpoint_partner_assistant_step`, `record_partner_assistant_call`, i quattro `complete_partner_assistant_research`, `_choice`, `_draft`, `_review`, `fail_partner_assistant_step` e `pause_partner_assistant`. Dentro, `auth.uid()` restituisce il profilo dell'assistente, che risulta autore di note, bozze e ricevute; anche i trigger di audit lo leggono da lì. Il worker le chiama con una lista ammessa (`src/lib/partner-assistant/store.ts`), solo POST, al massimo 1 MiB e 10 secondi per chiamata. `configure_partner_assistant` e `configure_partner_assistant_scheduler` si usano solo all'avvio.

Codice: `src/lib/partner-assistant/` (configurazione, trasporto, controlli, prompt, client Claude, costi, worker), `src/app/api/integrations/partner-assistant/worker/route.ts`, `src/lib/partner/assistant.ts` (letture ed etichette), i componenti `partner-assistant-*.tsx` e la pagina `src/app/(workspace)/partner/assistente/`.

## Modalità

| Modalità | Cosa fa | Chi la sceglie |
| --- | --- | --- |
| Spento | Non cerca, non scrive e non manda. È il valore dopo la migrazione. | Chiunque del team |
| Prepara | Ricerca e bozze, nessun invio. Toglie anche la pausa e l'attesa. | Chiunque del team, dopo la configurazione |
| Prova | Ricerca e bozze come in «Prepara»; in più le email di «Manda la prova», solo verso gli indirizzi di prova di Tommi, con l'oggetto e il testo delle email vere | Solo Tommi, con la posta configurata |
| Invio | Ricerca e bozze come in «Prepara»; in più le prime email ai contatti, nella finestra d'invio | Solo Tommi, con la posta configurata e la prova confermata |

Il dettaglio di «Prova» e «Invio» è in «Seconda consegna, parte 1 (2a): l'invio».

## Variabili d'ambiente

Le inserisce Tommi in Vercel, solo in produzione. Negli ambienti preview non ci sono: lì l'assistente resta spento e la route risponde `503`.

| Variabile server | Scopo |
| --- | --- |
| `PARTNER_ASSISTANT_ENABLED` | Accensione: vale solo `true`. Assente o con un altro valore, la route risponde `503` senza fare niente. |
| `PARTNER_ASSISTANT_SECRET` | Bearer del worker, da 32 a 256 caratteri URL safe; lo stesso valore va in Vault con `configure_partner_assistant_scheduler`. |
| `ANTHROPIC_API_KEY` | Chiave dell'API Anthropic (`sk-ant-…`). |
| `PARTNER_ASSISTANT_SUPABASE_SECRET_KEY` | Chiave segreta Supabase propria dell'assistente (`sb_secret_…`), diversa da `SUPABASE_SECRET_KEY` del worker Shopify, così le due si ruotano e si revocano separatamente. |
| `PARTNER_ASSISTANT_PHONE` | Numero di Tommaso per la firma, con il prefisso internazionale (`+39 …`, da 8 a 15 cifre, spazi singoli). Senza un numero valido l'assistente resta spento. Il numero non entra mai nel repository. |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del progetto, già presente; lo stesso controllo del worker Shopify. |

Se una variabile manca o non ha il formato giusto, l'assistente resta spento: nessun valore predefinito lo accende. Nessuna delle chiavi ha il prefisso `NEXT_PUBLIC_`, compare nel repository, nei log o nelle risposte.

Le variabili della posta (`PARTNER_MAIL_*` e `PARTNER_TEST_TO`) servono solo a «Prova» e «Invio»: sono in «Seconda consegna, parte 1 (2a): l'invio», «Variabili».

## Come si ferma

- **Dal gestionale**, chiunque del team: «Ferma l'assistente» nella striscia, oppure «Spento» nella pagina. Lo spegnimento vale anche con una versione vecchia della pagina; il credito invece si salva solo dalla versione in vigore, anche con «Spento», così non sovrascrive quello di un collega. L'assistente ricontrolla la modalità a ogni giro e subito prima di ogni chiamata a Claude: un passo con la chiamata già partita può ancora salvare il suo risultato, poi non ne parte un altro.
- **Su un solo contatto**: «Ferma su questo contatto» nel blocco «Assistente» della scheda. Non è «Non contattare»: il contatto resta contattabile dal team.
- **Pausa automatica**: con il credito finito o un errore di Claude l'assistente si mette in pausa da solo. Dopo una ricarica si aggiunge l'importo al credito di partenza in «Modalità» («Salva il credito e riparti»); dopo un errore si preme «Prepara».
- **Solo gli invii** (consegna 2a): «Prepara» ferma gli invii e lascia andare ricerca e bozze; «Spento» ferma tutto. Gli invii si fermano anche da soli, con la casella che rifiuta la password o con le email rifiutate dal server di posta: li riprende Tommi con «Riprendi l'invio» (vedi «Esiti SMTP e fermi»).
- **Dal server**, con l'OK di Tommi: `PARTNER_ASSISTANT_ENABLED` diverso da `true` (la route risponde `503`), oppure `configure_partner_assistant_scheduler(null, false)` dal client tecnico, che toglie il job, il puntatore e il segreto dell'assistente in Vault e lascia com'è lo scheduler Shopify.

## Spesa

La pagina dell'assistente, in «Spesa», mostra la spesa totale, quella di oggi (giorno di Roma) e il credito rimasto stimato: il credito di partenza inserito a mano, ricariche comprese, meno la spesa registrata. Il credito vero non si legge con la chiave API: il numero esatto è nella Console Anthropic.

Ogni chiamata a Claude lascia una riga in `private.partner_assistant_runs`, anche quando il passo poi fallisce: passo, modello, token in ingresso e in uscita, token della cache, ricerche web, esito e costo calcolato con i prezzi pubblici di Opus 5.5 (4 USD per milione di token in ingresso, 20 in uscita, 0,01 USD per ricerca web). Dal SQL Editor, in sola lettura:

```sql
select (created_at at time zone 'Europe/Rome')::date as giorno, count(*) as chiamate,
  sum(web_searches) as ricerche, sum(cost_usd) as usd
from private.partner_assistant_runs group by 1 order by 1;
```

Il credito Anthropic scade il 5 novembre 2026: la stima della specifica è tra 0,6 e 1,2 USD per contatto, tra ricerca, scrittura e seconda lettura.

## Avvio della prima consegna

Tutta la sequenza richiede l'OK di Tommi in chat, passo per passo (`AGENTS.md`): merge, migrazioni, profilo tecnico, chiavi, variabili, impostazioni Vercel e accensione dello scheduler.

**Il merge su `main` è il deploy di produzione**: Vercel pubblica `main` appena arriva il merge ([deployment.md](deployment.md)). Per questo Fluid compute, migrazioni e variabili vanno fatti **prima del merge**, e il merge è un passo della sequenza, non il primo. Se Fluid compute non è attivo, Vercel rifiuta il deploy della route con `maxDuration` 300 e da quel momento nessun merge su `main` arriva in produzione, nemmeno le correzioni degli altri moduli.

1. **Utente tecnico «Assistente».** Crearlo con gli strumenti Admin di Supabase Auth, mai con SQL su `auth.users`: indirizzo non instradabile nel dominio `.invalid` (come l'account QA di [verifica-auth-cloud.md](verifica-auth-cloud.md)), password casuale che nessuno conserva. Poi la sua riga in `profiles`, con il nome «Assistente», **senza membership**: così non entra nell'app e non compare tra gli assegnatari.
2. **Chiave segreta Supabase propria** dell'assistente, distinta da quella del worker Shopify.
3. **Vercel e Anthropic, prima del merge.** Controllare che Fluid compute sia attivo, con funzioni fino a 300 secondi (se non lo è, lo attiva Tommi), e il tier dell'account Anthropic in Console, che dà i limiti di velocità.
4. **Migrazioni, prima del merge.** Applicare le tre migrazioni con la procedura di [verification.md](verification.md) («Produzione, 22 ottobre 2026»: impronte in sola lettura prima, testo esatto del file, rinomina alla versione cloud, impronte dopo). Sono additive: il codice già in produzione non le usa. Se il merge arrivasse prima, la pagina non si rompe (l'assistente risulta «non attivo» e striscia e blocco non si vedono), ma è meglio non contarci.
5. **Variabili, prima del merge.** Inserire in Vercel produzione le variabili della tabella sopra, compreso `PARTNER_ASSISTANT_PHONE` con il numero che sceglie Tommaso.
6. **Merge su `main`.** Con i passi 3, 4 e 5 fatti, Tommi fa il merge della pull request: è il deploy di produzione. Poi controllare che il deploy su Vercel sia riuscito.
7. **Configurazione.** Dal client tecnico, con la chiave dell'assistente: `configure_partner_assistant(<assistente>, <Tommi>)` (profilo dell'assistente senza membership e profilo di Tommi con ruolo founder), poi `configure_partner_assistant_scheduler(<segreto>, true)` con lo stesso valore di `PARTNER_ASSISTANT_SECRET`. Il segreto non si incolla nel SQL Editor, in chat o nei log.
8. **Contatti già avviati.** Segnare «Assistente su questo contatto: fermo» sui rapporti già avviati (negozi in conto vendita, accordi), così l'assistente non riscrive a chi è già stato contattato. Non ci sono file «Esporta» da caricare: il 28 ottobre 2026 Tommi ha confermato che nessuno aveva usato il vecchio sito, che ora è spento ([partner.md](partner.md), «GitHub Pages»).
9. **Prepara.** Prima, controllare di nuovo in Console Anthropic il tier e il credito. Poi, dalla pagina dell'assistente, inserire il credito di partenza (quello della Console) e scegliere «Prepara».

Dopo l'avvio: il primo giro aggiorna «Ultimo giro» nella pagina; gli eventi dicono passo ed esito di ogni contatto.

## Test

- `npm test`: configurazione, trasporto, controlli in ogni lingua con le parole vietate, prompt, client Claude con errori e costi, worker con Claude e database finti, comandi, letture, pagina, striscia, blocco e guida. Solo dati sintetici.
- `npm run test:db`: `assistente-partner.mjs`, `assistente-partner-worker.mjs` e `assistente-partner-scheduler.mjs` su PGlite, `assistente-partner-concurrency.mjs` su PostgreSQL 17 (due giri sovrapposti: uno solo prende il lavoro). Minimi e numeri in [verification.md](verification.md).
- I test della consegna 2a sono in «Seconda consegna, parte 1 (2a): l'invio», «Test».

Fixture: domini `example.test`, schede con CO da 951 in su, profilo dell'assistente sintetico. Nessuna chiamata vera a Claude, a Supabase o a un server di posta.

## Seconda consegna, parte 1 (2a): l'invio

Branch `claude/assistente-partner-invio`, base `origin/main` a `c4577bd` (il merge della pull request #22), [piano](superpowers/plans/2026-10-28-assistente-partner-consegna-2a.md). L'assistente manda dalla casella aziendale IONOS le prime email già pronte e approvate: prima una prova verso le caselle di Tommaso, confermata da lui, poi l'invio vero ai contatti, lento, nella finestra 9:30-11:00 del destinatario, mai due volte allo stesso contatto. Il piano completo della consegna 2 (`superpowers/plans/2026-10-28-assistente-partner-consegna-2.md`) resta la fonte dei nomi per la 2b.

L'email che l'assistente manda è la «Bozza dell'email» del blocco «Assistente». Dal 31 ottobre 2026 la scheda non ha più il blocco «Messaggi pronti» con i testi vecchi della ricerca di ottobre, e «Segna inviato» e «Segna sollecito inviato» sono nel Registro (vedi [partner.md](partner.md), pagina `/partner`). Finché la 2b non manda i solleciti, Tommi scrive il sollecito a 7 giorni partendo dalla «Bozza dell'email» mandata, che resta nel blocco «Assistente», e lo segna nel Registro con «Segna sollecito inviato», poi «Registra».

### Che cosa fa

- **Il giro.** Il passo d'invio gira nel giro di oggi (route `/worker`, pg_cron ogni due minuti): nessuna route né scheduler nuovi, niente da riconfigurare in Vault. A ogni giro il worker registra quali variabili sono valide, poi prova un passo d'invio senza Claude. Solo se non c'era niente da mandare fa il passo con Claude della prima consegna. La preparazione con Claude continua anche in «Prova» e «Invio».
- **Un'email alla volta.** Il lock della casella è una lease nel database (300 secondi). Il passo d'invio ha 120 secondi: controllo dei 12 mesi, composizione, SMTP, copia in «Posta inviata».
- **Prova e invio.** Tommi sceglie «Prova», preme «Manda la prova» e, se le email sono arrivate in posta in arrivo, «La prova è arrivata in posta in arrivo». Senza la prova confermata «Invio» si rifiuta.
- **Dopo una prima email vera:** la scheda passa a «Contattato»; il registro ha una riga «Inviato» via email con l'origine `assistente` («29 ott · dall'assistente · Inviato via email»); il lavoro diventa «Email inviata» (`inviata`, terminale nella 2a); nasce «Sollecito · <nome>» a 7 giorni, assegnato a Tommi (`handoff_to` della configurazione), come dopo «Segna inviato». Il sollecito lo manda Tommi; l'assistente non manda solleciti.
- **Testo.** Il testo approvato, la firma e la frase di uscita della lingua, aggiunta dal sistema. Testo semplice, un solo destinatario.
- **Controlli prima di ogni invio:** l'impronta del testo approvato, le regole in vigore, il recapito, l'età della ricerca, le date (ricontrollo all'invio) e la posta degli ultimi 12 mesi con quell'indirizzo.
- **Fermi automatici** con la casella che rifiuta la password, con le email rifiutate e con gli errori temporanei ripetuti.
- **Variabili e accessi** nella pagina dell'assistente, senza mai i valori.

### Che cosa non fa (va nella 2b)

- Non legge la casella: niente risposte, rimbalzi letti dalla posta, risposte automatiche, parole di stop, «Da smistare», rapporti DMARC. Le risposte arrivano a Tommaso nella casella aziendale, come oggi. IMAP serve solo al controllo dei 12 mesi e alla copia in «Posta inviata».
- Niente solleciti dell'assistente, passaggi con riassunto e risposta suggerita, riepilogo serale, tetto orario dei passaggi, `daily_followup_limit`.
- Niente ritocchi a Oggi e a «Segna inviato»; nel feed di Controllo CEO l'invio si legge come «Assistente ha registrato un invio Partner: …», con il nome del profilo.
- Niente ricontrollo `controlli_falliti` all'invio, «Ridai all'assistente» dopo un passaggio e salto del controllo dei 12 mesi.
- Restano per dopo anche il difetto delle fonti e del conteggio delle ricerche, l'esempio del Porsche Club GB nelle regole e nodemailer 10.1.4 (installabile dal 1° novembre).

### Tabelle e RPC

Una sola migrazione, additiva: `supabase/migrations/20261030114722_assistente_partner_invio.sql` (in produzione dal 30 ottobre 2026, vedi «Stato al 30 ottobre 2026»). Le migrazioni della prima consegna non cambiano.

- **Colonne nuove.** Configurazione: `daily_first_limit` (predefinito 10, da 1 a 15), `test_confirmed_at`, `test_confirmed_by`. Interruttore per contatto: `send_priority` (da 0 a 9). Lavori: stato `inviata`. Registro Partner (`partner_activities`): origine `assistente`.
- **Tabelle nuove.**
  - `public.partner_assistant_messages`: una riga per email preparata, di prova o vera. La leggono i membri, la scrivono solo le RPC. Lo stato va solo avanti: `pronto`, poi `in_invio`, poi `inviato`, `incerto`, `respinto` o `scartato`. Un indice unico tiene una sola prima email vera viva per contatto («mai due volte»); le prove non contano. Il messaggio MIME è solo ASCII, con la sua impronta SHA-256.
  - `private.partner_assistant_test_runs`: le prove avviate da Tommi.
  - `private.partner_assistant_mail_state`, riga unica: lease della casella, ultimo esito, fermo, attese, contatori dei rifiuti del giorno, variabili e ultimi accessi SMTP e IMAP.
  - `private.partner_assistant_holidays`, `private.partner_assistant_countries` e `private.partner_assistant_timezones`: feste, nomi dei paesi e nomi dei fusi.
- **Ora.** Ogni decisione di calendario, limite e intervallo usa `private.partner_assistant_now()`, cioè `now()` (gli harness la fissano). Il giorno si conta sull'ora di Roma.
- **Comandi di Tommi** (`authenticated`, solo il founder, con ricevuta per `operation_id`): `start_partner_assistant_test` («Manda la prova»), `confirm_partner_assistant_test` («La prova è arrivata in posta in arrivo»), `set_partner_assistant_send_priority` («Manda per primo», «Togli la precedenza»), `resume_partner_assistant_send` («Riprendi l'invio»), `set_partner_assistant_settings` (il limite).
- **Ridefinite**, con la stessa firma e le stesse risposte, così il codice della prima consegna regge la migrazione: `set_partner_assistant_mode` («Prova» e «Invio» al founder, «Invio» solo con la prova confermata), `set_partner_assistant_contact` (un contatto con `conversazione_esistente` o `invio_incerto` resta a Tommi), `save_partner_assistant_rules` (un messaggio in invio, inviato o incerto e un lavoro `inviata` non tornano in scrittura), `claim_partner_assistant_step` e `checkpoint_partner_assistant_step` (girano anche in «Prova» e «Invio»), la classifica della preparazione (prima `send_priority`), la cancellazione definitiva e il trigger dei solleciti (origine `assistente`).
- **RPC del worker** (solo `service_role`): `claim_partner_assistant_send`, `skip_partner_assistant_send`, `prepare_partner_assistant_send`, `start_partner_assistant_send`, `finish_partner_assistant_send`, `record_partner_assistant_append`, `pause_partner_assistant_send`, `release_partner_assistant_send`, `record_partner_assistant_environment`. Prendono sempre per prima la riga della casella, poi configurazione, scheda e lavoro. Gli esiti attesi sono righe (`idle`, `lease_persa`, `rifiutato`, `stop`), mai eccezioni.
- **Lettura** per i membri: `read_partner_assistant_send`, senza indirizzi né valori delle variabili.
- **Giro morto.** Un messaggio `pronto` trovato senza lease diventa `scartato`; un `in_invio` diventa `incerto`, il contatto passa a Tommi con `invio_incerto` e il prossimo invio aspetta 4-11 minuti.
- **Cancellazione definitiva** di un recapito: cancella anche i messaggi del contatto. Un invio vero già partito o forse partito resta, senza indirizzo né testi e con l'impronta dell'indirizzo, così la guardia «mai due volte» regge. Se il contatto aveva un invio in corso o incerto, il lavoro passa a Tommi con `invio_incerto`; un lavoro `inviata` resta tale.

Codice: `src/lib/partner-assistant/mail-config.ts` (variabili), `mail-compose.ts` (testo e MIME), `smtp.ts`, `imap.ts`, `send-recheck.ts` (date), `send-types.ts`, `send-store.ts`, `send.ts` (il passo d'invio), `worker.ts`; nell'app `src/lib/partner/commands.ts`, `assistant.ts`, `server.ts`, `model.ts` e i componenti `partner-assistant-*.tsx`. Dipendenze nuove, a versione esatta: `nodemailer` 10.1.1 e `imapflow` 2.4.2.

### Modalità e prova

- «Prova» e «Invio» li sceglie solo Tommi, e solo con la posta configurata sul server: altrimenti la pagina dice «La posta dell'assistente non è configurata.».
- **«Manda la prova»** (in «Prova»): Tommi sceglie 1, 2 o 3 bozze; il sistema prende le prime della coda d'invio e salta quelle di eventi già iniziati. Ogni bozza parte verso ogni indirizzo di `PARTNER_TEST_TO` (da 1 a 5): con 1 bozza e 4 indirizzi, 4 email. Una email ogni 4-11 minuti, al massimo 15 al giorno, a qualunque ora: la prova non aspetta la finestra del destinatario.
- Oggetto e testo sono quelli dell'email vera, senza «[Prova]». La prova non tocca la scheda: niente «Contattato», niente registro, niente sollecito.
- In prova il controllo dei 12 mesi gira sull'indirizzo vero del contatto, solo come verifica: l'evento `prova_casella_vuota`, `prova_casella_trovata` o `prova_casella_incerta` dice se la ricerca nella casella funziona.
- Una prova alla volta: finché la prova di prima ha email da mandare, «Manda la prova» risponde «La prova di prima non è ancora finita: aspetta che partano le sue email.».
- **«La prova è arrivata in posta in arrivo»** registra data e autore. Vale solo per l'ultima prova, con un'email partita nelle ultime 24 ore; poi resta valida, anche dopo un ritorno a «Prepara».

### Finestra d'invio

- Lunedì-venerdì, dalle 9:30 incluse alle 11:00 escluse nell'ora del contatto. Il fuso è quello della scelta; se manca o non è valido vale `Europe/Rome`. I fusi validi sono quelli di PostgreSQL al momento della migrazione (tabella `partner_assistant_timezones`).
- Un invio comincia solo se la finestra è aperta anche 90 secondi dopo: niente invii a ridosso delle 11:00.
- Niente feste nazionali del paese della scheda (`partners.country`), dal 29 ottobre 2026 al 31 gennaio 2027:

  | Paese | Feste |
  | --- | --- |
  | Italia | 1° novembre, 8 dicembre |
  | Austria | 1° novembre, 8 dicembre |
  | Francia | 1° novembre, 11 novembre |
  | Spagna | 1° novembre, 6 dicembre, 8 dicembre |
  | Belgio | 1° novembre, 11 novembre |
  | Regno Unito, Germania, Svizzera, Paesi Bassi | nessuna nel periodo |

  Il paese si riconosce dal nome in italiano, in inglese o nella sua lingua (per esempio «Regno Unito», «UK», «England»). Un paese che l'elenco non conosce non ha feste: l'invio parte e gli eventi lo segnalano una volta per contatto (`paese_senza_calendario`).
- Nessun invio dal 21 dicembre al 7 gennaio.
- Dopo il 31 gennaio 2027 la finestra resta chiusa in ogni paese finché una migrazione non aggiunge le feste nuove.
- La pagina mostra la finestra di Roma («Finestra aperta fino alle 11:00, ora di Roma» o «Prossima finestra: …»). I contatti nel Regno Unito partono dalle 10:30 di Roma.

### Limiti

- Nei primi 7 giorni di calendario dal primo invio vero (giorno di Roma): al massimo 5 prime email al giorno.
- Dopo: `daily_first_limit`, predefinito 10. Tommi lo cambia nella pagina, sezione «Limite»: il campo «Prime email al giorno dopo la prima settimana, da 1 a 15» e «Salva» (`set_partner_assistant_settings`). Gli altri vedono solo la frase «Dopo la prima settimana: al massimo N prime email al giorno.».
- Tra due invii, di prova o veri, un intervallo casuale tra 4 e 11 minuti.
- In «Prova» al massimo 15 email al giorno.
- In «Invio» si manda solo con una ricerca di meno di 21 giorni; altrimenti il lavoro torna alla ricerca.

### Ordine della coda

1. `send_priority`, più alta prima: «Manda per primo» dà 9. La precedenza vale anche nella coda della preparazione con Claude, così la bozza di quel contatto arriva prima.
2. La data dell'evento della scelta, più vicina prima; senza data in fondo.
3. La ricerca più vecchia.
4. La priorità della scheda: alta, media, bassa.
5. Il CO.

Prima di scegliere il candidato, il claim pulisce le righe che lo precedono: ricerca di 21 giorni o più (torna alla ricerca), recapito cambiato o regole superate (torna in scrittura), evento già iniziato (a Tommi, `bozza_scaduta`), indirizzo che l'assistente non usa (a Tommi, `indirizzo_non_valido`), stesso indirizzo con una prima email vera dell'assistente negli ultimi 365 giorni da un'altra scheda (a Tommi, `conversazione_esistente`).

### Il messaggio e la frase di uscita

Il corpo è il testo della bozza, una riga vuota, la firma, una riga vuota e la frase di uscita della lingua e del registro della scelta. La frase la aggiunge il sistema: non conta nelle parole del corpo e non entra nell'impronta della bozza approvata. I testi stanno solo in `src/lib/partner-assistant/mail-compose.ts`: Luca li può ritoccare con una pull request, senza migrazione.

| Lingua | Frase di uscita |
| --- | --- |
| Italiano, voi | Se non è il momento, o preferite non ricevere altre email, scrivetemelo pure: non vi ricontatterò. |
| Italiano, lei | Se non è il momento, o preferisce non ricevere altre email, me lo scriva pure: non la ricontatterò. |
| Inglese | If the timing isn't right, or you'd rather not hear from me again, just let me know and I won't write again. |
| Tedesco | Falls es gerade nicht passt oder Sie keine weiteren E-Mails wünschen, schreiben Sie mir einfach, dann melde ich mich nicht mehr. |
| Francese | Si ce n'est pas le bon moment, ou si vous préférez ne plus recevoir d'e-mails de ma part, dites-le-moi simplement : je ne vous écrirai plus. |
| Spagnolo | Si no es el momento, o prefiere no recibir más correos, dígamelo sin problema: no volveré a escribirle. |

Il messaggio: `From: "Tommaso | LuckyLap" <casella>` (il nome da `PARTNER_MAIL_FROM_NAME`, se c'è), un solo destinatario e mai Cc o Bcc, solo testo semplice, niente allegati, immagini, tracciamento o `X-Mailer`, `Message-ID` del codice (`<uuid@dominio della casella>`). Il messaggio si compone una volta sola: gli stessi byte vanno a SMTP e alla copia in «Posta inviata». La SQL controlla che il testo sia quello approvato, più firma e frase: se non lo è, l'email non parte e il contatto passa a Tommi (`impronta`).

### Ricontrollo delle date

Solo in «Invio», sulla prima email, al momento dell'invio:

- l'evento della scelta è già iniziato: il contatto passa a Tommi (`bozza_scaduta`), perché una bozza nuova con la stessa scelta finirebbe allo stesso punto;
- la riga della maglietta co-firmata è diversa tra il giorno della bozza e quello dell'invio, oppure una data citata nel corpo, futura quando la bozza è stata scritta, non lo è più: l'assistente riscrive la bozza una volta, se non è in pausa per il credito; la seconda volta passa a Tommi.

Le date del corpo si riconoscono in italiano, inglese, tedesco, francese e spagnolo, in parole e in cifre. «Manda la prova» salta le bozze di eventi già iniziati.

### Controllo dei 12 mesi

Prima di ogni invio vero l'assistente cerca nella casella, in sola lettura, i messaggi da, a o in copia all'indirizzo del contatto negli ultimi 365 giorni: posta in arrivo, «Posta inviata» e spam.

- Trovato: niente invio, il contatto passa a Tommi con «Conversazione recente nella casella» (`conversazione_esistente`), e scrive lui.
- «Non so» (la casella non risponde, manca una cartella o non è univoca, la ricerca fallisce o risponde vuoto da una connessione non più valida): niente invio, e gli invii aspettano 15 minuti (`casella_incerta`) senza un nuovo accesso alla casella. Il passo con Claude intanto continua.
- In più il database non manda una seconda prima email allo stesso indirizzo da un'altra scheda negli ultimi 365 giorni (un club e il suo evento), anche prima che la copia sia in «Posta inviata».

### Esiti SMTP e fermi

SMTP `smtp.ionos.it` (o `PARTNER_MAIL_SMTP_HOST`), porta 587 con STARTTLS obbligatorio; IMAP `imap.ionos.it` (o `PARTNER_MAIL_IMAP_HOST`), porta 993 con TLS. L'SMTP va per fasi (connessione, accesso, invio): la fase in cui cade un errore dice se l'email può essere partita.

| Esito | Quando | Cosa succede |
| --- | --- | --- |
| Inviata | Il server risponde 250 e accetta il destinatario | Scheda, registro, lavoro «Email inviata», sollecito per Tommi, copia in «Posta inviata» |
| Errore temporaneo | Un `4.x.x` o il 450 di IONOS («send limit»), in ogni fase | Si riprova al giro dopo. Al terzo nello stesso giorno gli invii si fermano fino al giorno dopo |
| Non partita | Connessione o accesso falliti senza un codice del server, oppure un `5xx` in connessione, accesso o al mittente senza `5.7.x` né «spam» | Il lavoro resta pronto; conta come un errore temporaneo |
| Password rifiutata | Accesso SMTP o IMAP rifiutato | Fermo «casella» finché Tommi preme «Riprendi l'invio» |
| Bloccata | `5.7.x` o «spam» in connessione, accesso o al mittente | Fermo «rimbalzi»; il lavoro resta pronto |
| Respinta | Un `5xx` al destinatario o al testo | `5.1.x`: il contatto passa a Tommi (`indirizzo_non_valido`); altri codici: `invio_rifiutato`. Con `5.7.x` o «spam» fermo subito; due rifiuti definitivi nello stesso giorno: fermo «rimbalzi» |
| Incerta | Un errore senza codice durante l'invio (connessione caduta, scadenza), oppure il destinatario accettato senza un 250 | Il contatto passa a Tommi (`invio_incerto`): mai un secondo tentativo |

Nella pagina il fermo si legge in «Invii»; la striscia lo dice in ambra. Il fermo di oggi si toglie da solo il giorno dopo.

### «Riprendi l'invio»

Il pulsante compare nella pagina, in «Invii», solo a Tommi e solo con un fermo «casella» o «rimbalzi». Toglie il fermo, anche quello di oggi, l'attesa e i contatori del giorno (evento `invio_ripreso`). Prima di premerlo si guarda la causa: con la password cambiata, la variabile nuova in Vercel e un deploy; con le email rifiutate, «Ultime email» e la casella.

### Variabili

Le inserisce Tommi in Vercel, solo in produzione; negli ambienti preview non ci sono. Una variabile cambiata vale dal deploy successivo.

| Variabile server | Regola |
| --- | --- |
| `PARTNER_MAIL_USER` | La casella aziendale, un indirizzo valido. Obbligatoria. |
| `PARTNER_MAIL_PASSWORD` | La password della casella: da 1 a 512 caratteri ASCII stampabili. Obbligatoria. |
| `PARTNER_MAIL_FROM_NAME` | Facoltativa. Il nome del mittente, fino a 80 caratteri, senza `<`, `>`, `@`, virgolette, barra rovesciata o a capo. Senza: «Tommaso \| LuckyLap». |
| `PARTNER_TEST_TO` | Gli indirizzi di prova, da 1 a 5, separati da virgole, tutti diversi. Senza: «Manda la prova» non si può usare, quindi nemmeno «Invio». |
| `PARTNER_MAIL_SMTP_HOST` | Facoltativa. Solo il nome del server, in minuscolo, senza schema né porta. Senza: `smtp.ionos.it`. |
| `PARTNER_MAIL_IMAP_HOST` | Facoltativa. Come sopra. Senza: `imap.ionos.it`. |

Le porte sono fisse (587 e 993). Il fallimento è chiuso: con una variabile mancante o scritta male, anche `PARTNER_TEST_TO`, la posta risulta non configurata, «Prova» e «Invio» non sono disponibili e l'assistente lavora solo in «Prepara». Nessun valore va nei log, nelle risposte HTTP o negli eventi.

Il riquadro **«Variabili e accessi»** della pagina dell'assistente le fa controllare a tutti senza mostrarne i valori né le lunghezze: «Variabili dell'assistente: valide» o «mancanti o nel formato sbagliato»; «Casella: …»; «Indirizzi di prova: validi, N indirizzi»; «Controllate dal worker alle …» (lo scrive il worker a ogni giro); «Ultimo accesso SMTP» e «Ultimo accesso IMAP» («mai provato», «riuscito alle 9:41», «non riuscito alle 9:41 (smtp_eauth)»). Sotto: «Una variabile cambiata in Vercel vale dal deploy successivo.».

### Nell'interfaccia

- **Striscia**: «Assistente in invio · 3 email oggi su 5 · 12,30 USD spesi», «Assistente in prova · 4 email di prova oggi · …». In ambra, con la parola scritta: invii fermi, fermi per oggi, posta non configurata, stato degli invii non leggibile.
- **Pagina**, nell'ordine: Stato, Modalità, Prova (solo in «Prova»), Invii (in «Prova» e «Invio»), Limite, Coda, Spesa, Variabili e accessi, Da vedere, Regole. «Invii» ha «Oggi: 3 email su 5», la finestra (solo in «Invio»), il prossimo invio, fermi e attese, «Bozze pronte da inviare», l'elenco «Manda per primo» e «Ultime email» (ora, CO, nome, prova o no, stato, oggetto; mai indirizzi).
- **Blocco «Assistente» della scheda**: «Email inviata dall'assistente il …» (o incerta, o respinta), lo stato «Email inviata» con «il sollecito dopo 7 giorni lo manda Tommi», e per Tommi «Manda per primo» o «Togli la precedenza».
- **«Da vedere»**: «Ridai all'assistente» non c'è per «Conversazione recente nella casella» e «Invio incerto»: ridarli costerebbe una ricerca nuova e finirebbe allo stesso punto.
- **Registro e «Segna inviato»**: la riga dell'assistente si legge «dall'assistente»; «Segna inviato» chiede conferma anche dopo un invio dell'assistente degli ultimi 10 minuti.

### Test

- `npm test`: variabili della posta, composizione e frasi di uscita, SMTP per fasi ed esiti, casella IMAP con i «non so», date del corpo e ricontrollo, store e passo d'invio con store, SMTP e casella finti, route del worker, comandi, letture, striscia, pagina, blocco e guida. Solo dati sintetici, nessuna chiamata vera.
- `npm run test:db`: `assistente-partner-invio-comandi.mjs` (PGlite: dati, guardie, registro e comandi), `assistente-partner-invio.mjs` (PGlite: calendario, coda, RPC d'invio, lettura; l'ora fissata in ogni transazione) e `assistente-partner-invio-concurrency.mjs` (PostgreSQL 17: due giri, lock con i comandi del team, tempi del claim). Minimi e numeri in [verification.md](verification.md).
- Cinque casi segnati «Fuoco» nei test: lo stesso indirizzo su due schede; un indirizzo scritto male; una persona che ferma l'assistente, segna «Non contattare» o salva regole nuove tra la preparazione e l'SMTP; il processo che muore dopo l'SMTP; la casella che risponde «non so».

### Avvio della consegna 2a

Ogni passo con l'OK di Tommi in chat (`AGENTS.md`). Prima: la pull request con tutti i comandi verdi e il job CI «Concorrenza (PostgreSQL 17)» verde. Lo scheduler non cambia. Decisione di Tommaso: prova **venerdì 30 ottobre**; i primi **5 invii veri lunedì 2 novembre dalle 9:30**, con Milano AutoClassica per prima, poi gli eventi con la data più vicina (l'ordine della coda); dopo, l'assistente torna in «Prepara».

Venerdì 30 ottobre: prova.

1. **Verifiche in sola lettura.** La configurazione dell'assistente (modalità, profilo tecnico, `handoff_to`); quanti lavori sono `pronta` (per lunedì ne servono almeno 5); i valori di `partners.country` tra i contatti con email, confrontati con l'elenco delle feste; il lavoro di Milano AutoClassica (stato e passo).
2. **Variabili in Vercel produzione, prima del merge.** `PARTNER_MAIL_USER`, `PARTNER_MAIL_PASSWORD` e `PARTNER_TEST_TO` con gli indirizzi di prova di Tommaso su Gmail, Outlook e iCloud più quello di mail-tester; le facoltative se servono. Nessuna negli ambienti preview.
3. **Migrazione in produzione, prima del merge.** La applica Claude con la procedura delle impronte ([verification.md](verification.md), «Produzione, 28 ottobre 2026»): impronte md5 in sola lettura prima (`partners`, `partner_contacts`, `partner_activities`, `tasks`, `partner_work_links`, `profiles`, `memberships`, le tabelle `partner_assistant_*`, la riga di configurazione, `cron.job`); applicazione con il testo esatto del file; md5 del testo salvato uguale al file; impronte dopo, identiche salvo quanto previsto (tabelle nuove, colonne nuove, vincoli di origine e di stato, funzioni ridefinite); avvisi di sicurezza solo quelli noti. Poi rinomina del file alla versione cloud, commit e push del branch. Il codice della prima consegna regge la migrazione.
4. **Merge su `main`** (è il deploy), con la CI verde dopo la rinomina. Controllare il deploy su Vercel, un giro del worker («Ultimo giro» nella pagina) e «Variabili e accessi»: tutto «valide», «Indirizzi di prova: validi, N indirizzi» con il numero giusto. Se qualcosa non è valido si corregge quella variabile e si rifà il deploy.
5. **Milano AutoClassica per prima.** Dalla sua scheda Tommi preme «Manda per primo». La sua bozza si prepara per prima, se non è già pronta, ed è la prima scelta da «Manda la prova». Se il controllo dei 12 mesi trova una conversazione recente, passa a Tommi e la scrive lui.
6. **Prova.** Tommi sceglie «Prova», poi «Manda la prova» con una bozza (quella di AutoClassica, se è pronta): con 4 indirizzi partono 4 email, una ogni 4-11 minuti, in 25-45 minuti circa. Controllare: le email in posta in arrivo, non in spam, su Gmail, Outlook e iCloud; il voto di mail-tester (almeno 9/10); la copia in «Posta inviata»; negli eventi `prova_casella_vuota` o `prova_casella_trovata`; in «Variabili e accessi» gli ultimi accessi SMTP e IMAP riusciti. Con `prova_casella_incerta` o un fermo per la casella ci si ferma e si decide con Tommi: senza quella ricerca nessuna email vera parte.
7. **Conferma.** Solo con tutte le email in posta in arrivo e mail-tester ad almeno 9/10, Tommi preme «La prova è arrivata in posta in arrivo», entro 24 ore dalla prova. Altrimenti si resta in «Prova» o in «Prepara» e si decide con lui. Fino a lunedì nessuno sceglie «Invio»: la modalità del fine settimana («Spento», «Prepara» o «Prova») la decide Tommi, e in nessuna delle tre partono email ai contatti.

Lunedì 2 novembre: i primi 5 invii veri.

8. **Prima delle 9:30, in sola lettura.** Il lavoro di Milano AutoClassica è `pronta` e ha ancora la precedenza; i lavori `pronta` sono almeno 5. Se la bozza di AutoClassica non è pronta, si decide con Tommi se aspettarla prima di scegliere «Invio».
9. **Invio, dalle 9:30.** Tommi sceglie «Invio»: la prova confermata venerdì vale ancora. Nella prima settimana partono al massimo 5 prime email al giorno, ognuna tra le 9:30 e le 11 dell'ora del contatto, una ogni 4-11 minuti: AutoClassica per prima, poi gli eventi con la data più vicina. I contatti nel Regno Unito partono dalle 10:30 di Roma.
10. **Ritorno a «Prepara».** Alla quinta email partita (pagina: «Oggi: 5 email su 5») Tommi sceglie «Prepara», oppure lo fa Claude con il suo OK in chat. L'assistente resta in «Prepara» finché Tommaso non è sicuro che le email non finiscano in spam: la prova, mail-tester e le prime risposte. Poi Tommi riaccende «Invio» per gli altri contatti; la prova confermata resta valida. Senza questo passo martedì 3 novembre partirebbero altre 5 email da sole.
11. **Dopo.** Nella pagina «Ultime email» e i fermi; in «Posta inviata» le copie; nella Oggi di Tommi, da lunedì 9 novembre, «Sollecito · <nome>» per ogni prima email; le risposte arrivano nella casella come sempre. «Ferma l'assistente» resta a disposizione di tutti.

## Modalità modello per i club

Decisione di Tommi del 31 ottobre 2026: ai club l'assistente non fa ricerca, estrazione e scrittura con Claude, che costavano tra 0,33 e 0,41 USD a contatto. La prima email è il testo fisso approvato da Tommaso, con il nome del club, nella lingua del club; Claude fa solo la seconda lettura. Lo stesso giorno l'assistente è stato messo su «Spento», con 602 club in coda alla ricerca.

- **Chi.** I contatti con `club` tra le sezioni ([partner.md](partner.md), «Sezione Club») che non sono anche un evento: un evento ha date e una proposta sua (oggi è il caso di «Porsche Club GB – Christmas at the Clubhouse») e resta sul percorso con Claude, come tutti gli altri contatti. I club della rete Scuderia Ferrari Club passano a Tommi con `rete_scuderia_ferrari`, senza bozza: il loro regolamento vieta magliette di terzi con il nome o il logo del club. Gli altri club Ferrari ricevono il testo (decisione di Tommi del 1° novembre 2026).
- **Il testo.** In `src/lib/partner-assistant/template.ts`, versione 1 del 31 ottobre 2026: italiano (la versione accorciata della bozza di Tommaso), inglese britannico, tedesco con il «Sie», francese con il «vous», spagnolo; le altre lingue ricevono l'inglese. L'oggetto ha il nome del club; nel testo il nome è senza l'ultima parentesi della scheda («Porsche Club GB – Chiltern (R21)» diventa «Porsche Club GB – Chiltern»), con l'articolo giusto. La firma ha il cognome: «Tommaso Ieri», il ruolo, il telefono e `https://luckylap.com | Instagram @lucky.lap`. Il testo cita le collaborazioni con alcuni Porsche Club in Italia, le 150 magliette del Porsche Club Toscana, il ricamificio che ha lavorato per i Porsche Club e i modelli da uomo e da donna, confermati da Tommaso. Per cambiarlo si modifica il file, si alza `PARTNER_ASSISTANT_TEMPLATE_VERSION` e si apre una pull request: non c'è un editor nella pagina. Una bozza al controllo che non è più quella che il testo in vigore comporrebbe torna in scrittura e si ricompone, senza Claude; le bozze già «pronta» (al più 20) partono con il testo con cui sono state lette, a meno di salvare una nuova versione delle regole, che le rimette in scrittura.
- **Lingua e fuso.** La lingua viene dalla lingua scritta nella ricerca importata (`research.lang`, per esempio «tedesco» o «Français»), poi dal paese. Svizzera e Liechtenstein scrivono il tedesco senza «ß». Il fuso viene dal paese; per Stati Uniti, Canada, Australia e Brasile dallo stato scritto nella città o nel nome (i nomi senza maiuscole, le sigle solo in maiuscolo e come parola isolata), altrimenti un fuso centrale. Un paese senza fuso nell'elenco passa a Tommi con `fuso_mancante`.
- **Il percorso.** A ogni passo prima del controllo (ricerca, estrazione o scrittura, compresi i ritorni indietro per ricerca scaduta, regole nuove o recapito cambiato) il worker compone la bozza, fa i controlli del codice (firma con il cognome, da 180 a 260 parole, nome del club fuori dai controlli sulle parole) e chiama `complete_partner_assistant_template`, senza Claude e senza costi. In una transazione la RPC scrive una nota di ricerca sostitutiva (con il segno `template` e la versione), una nota «scelta» composta dal database (club, `merch_cobranding`, lingua, registro, fuso, decisione «scrivi») e la bozza, con l'impronta ricalcolata; il lavoro va al controllo. Sezione, email, scheda o regole cambiate a metà passo danno `contesto_cambiato`, senza tentativi consumati. Se un contatto smette di usare il modello (tolto dalla sezione Club o diventato anche un evento) e il lavoro torna a estrazione o scrittura con le note del modello, la presa del lavoro lo riporta alla ricerca senza note né bozza: Claude non scrive mai sopra le note del modello, e la seconda lettura per i club vale solo per i contatti che usano ancora il modello. Al controllo la chiamata è `templateReviewCall`: il system resta il testo delle regole (la cache è comune), il messaggio dice che cosa delle regole non vale per un testo fisso e quali fatti sono confermati, con la scheda e la bozza, effort medio. Approvata: «Bozza pronta», poi l'invio come per gli altri contatti. Bocciata: a Tommi con `modello_bocciato`, mai una riscrittura (il testo tornerebbe uguale). Controlli del codice falliti: a Tommi con `modello_controlli`.
- **Il tetto.** Con 20 o più bozze del modello pronte da inviare (contatti ancora idonei, come nella coda d'invio), la presa del lavoro salta i club prima del controllo; i lavori già al controllo continuano. Così la seconda lettura si paga solo per le email che partono a breve e le bozze non arrivano ai 21 giorni della ricerca scaduta.
- **Nell'interfaccia.** Il blocco «Assistente» della scheda mostra «Testo per i club» al posto di «Ricerca del …» e, nella bozza, «Composta … dal testo per i club», con «controllata da Claude» solo per le bozze pronte o inviate («in attesa della seconda lettura», «bocciata nella seconda lettura» o «non ha passato i controlli del codice e Claude non l'ha letta» negli altri casi). La pagina dell'assistente ha gli esiti «Bozza dal testo per i club, senza ricerca», `modello_controlli` e `modello_bocciato` e i motivi relativi. La guida ne parla nella parte «L'assistente».
- **Migrazione.** `supabase/migrations/20261101012650_assistente_partner_modello.sql`, additiva: `private.partner_assistant_lock_any_step` (la guardia dei complete con più passi), `private.partner_assistant_uses_template` (Club e non evento), `private.partner_assistant_is_template`, `complete_partner_assistant_template` (privata e wrapper, solo `service_role`), e `complete_partner_assistant_review` e `claim_partner_assistant_step` sostituite con lo stesso comportamento per gli altri contatti. In produzione dal 1° novembre 2026 (versione cloud `20261101012650`), applicata da Claude prima del merge della pull request #31, con l'OK di Tommi («Sì, procedi») e la procedura delle impronte; esiti in [verification.md](verification.md), «Modalità modello per i club, 1° novembre 2026». L'assistente è rimasto spento: la modalità lavora solo quando Tommi lo riaccende.
- **Spesa.** Solo la seconda lettura, senza ricerca sul web: qualche centesimo a club.
- **Allegati.** La prima email resta solo testo, come tutto l'invio: un PDF a sconosciuti da una casella nuova peggiora la consegna. I lookbook «Porsche Clubs» e «Clubs» (`/partner/dati`) li manda Tommi a chi risponde.

### Test della modalità modello

- `npm test`: `template.test.ts` (cinque lingue, una domanda, da 180 a 260 parole, controlli superati in ogni lingua, firma, articoli e preposizioni anche in tedesco e francese con nomi veri, niente doppio punto dopo «Inc.», nomi con parentesi, lingua dalla ricerca o dal paese, fusi per stato senza scambiare «in», «la» o «al» per sigle, Svizzera, club che sono eventi, rete Scuderia Ferrari Club), i casi dei club nel worker (nessuna chiamata a Claude prima del controllo, fuso mancante, email mancante, checkpoint fermo, seconda lettura per i club, testo cambiato, note del modello su un contatto che non usa più il modello, evento, Scuderia Ferrari Club), store, prompt, etichette, blocco della scheda e guida.
- `npm run test:db`: `assistente-partner-modello.mjs` (PGlite, 109 controlli: permessi, le tre righe nella stessa transazione, ricevuta e ripetizione, contesto riletto, bocciatura a Tommi, approvazione e coda d'invio, regole cambiate, contesto cambiato, payload non validi, controlli falliti, passo sbagliato e lease persa, bozza di Claude con la riscrittura di prima, tetto delle 20 bozze pronte contato solo sui contatti idonei, note del modello di un contatto tolto dalla sezione Club che ripartono dalla ricerca, club diventato anche evento). In locale anche `assistente-partner-invio.mjs` con la migrazione nuova applicata: 429 controlli, stesso esito.
- Prova sui 652 club importati il 31 ottobre: ogni bozza ha un fuso e passa i controlli del codice; 411 in inglese, 166 in tedesco, 32 in spagnolo, 30 in francese, 13 in italiano.
- Revisione indipendente prima della pull request (SQL, codice e testi, con verifica avversaria): corretti i 15 problemi confermati; restano da sistemare nei dati i nomi «Ferrari Owners' Club Belgio» (nome del paese in italiano), «Pagodentreff.de» e «Mercedes-Benz SLR.CLUB e.V.» (un dominio nel nome), e da decidere «Luftgekühlt», che non è un club.

