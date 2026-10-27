# Assistente Partner

L'assistente lavora i contatti del modulo Partner con Claude: cerca notizie su ogni contatto, sceglie la proposta, scrive la prima email e la controlla. Questo documento descrive la **prima consegna** («prepara», branch `claude/assistente-partner`, base `origin/main` a `3c58693`): ricerca e bozze salvate nel gestionale, **nessun invio**. Il perché di ogni scelta è nella [specifica](superpowers/specs/2026-10-27-assistente-partner-design.md), approvata da Tommaso il 27 ottobre 2026; i passi di lavoro sono nel [piano](superpowers/plans/2026-10-27-assistente-partner-consegna-1.md). Il resto del modulo è in [partner.md](partner.md).

Nell'interfaccia il founder è «Tommi»; le email sono firmate «Tommaso».

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

Fuori da questa consegna (seconda consegna, con un piano proprio): invio, lettura della casella, risposte, solleciti, passaggio a Tommi con email e attività in Oggi, riepilogo serale, modalità «prova» e «invio», origine `assistente` nel registro Partner e nel feed di Controllo CEO.

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
- **Blocco «Assistente»** nella scheda del contatto: stato del lavoro, motivo per cui l'assistente non lo prende, proposta e motivo, ricerca con le fonti, bozza in una sezione apribile e l'interruttore «Assistente su questo contatto: attivo / fermo» (diverso da «Non contattare»).
- La guida «Come si usa», parte «Partner», spiega tutto questo al team.

Le pagine mostrano i dati del caricamento e funzionano anche in anteprima senza database. Prima delle migrazioni (funzione o tabella mancante: codici `PGRST202`, `PGRST205`, `42883`, `42P01`, con un oggetto dell'assistente, `partner_assistant`, nel messaggio) l'assistente è «non attivo»: striscia e blocco non si mostrano e la pagina dell'assistente dice «Assistente non ancora attivo.». Se invece la lettura non riesce per un altro motivo, striscia e blocco dicono in ambra «stato non leggibile». In tutti e due i casi il resto di Partner resta com'è.

## Tabelle e RPC

Tre migrazioni additive:

| Migrazione | Contenuto |
| --- | --- |
| `20261027133105_assistente_partner.sql` | Tabelle, regole versione 1, comandi del team, lettura dello stato |
| `20261027140533_assistente_partner_worker.sql` | Coda, RPC del worker, revoca a `service_role` delle scritture dirette sulle tabelle Partner |
| `20261027145939_assistente_partner_scheduler.sql` | Scheduler ogni due minuti (pg_cron, pg_net, Vault) |

Tabelle in `public`, leggibili dai membri del team (RLS `member_read`) e scritte solo dalle RPC:

- `partner_assistant_rules`: le regole di scrittura, una riga per versione, append-only;
- `partner_assistant_contacts`: l'interruttore per contatto (attivo o fermo), con audit su contatto, stato e versione;
- `partner_assistant_jobs`: un lavoro per contatto, con stato (`in_coda`, `attesa`, `pronta`, `serve_tommaso`), passo, lease, tentativi (al massimo 3), riscritture (al massimo 1), data per scrivere e motivo;
- `partner_assistant_notes`: ricerca con le fonti, scelta e controllo, append-only. La ricerca dell'assistente non va in `partners.research`, che ogni import sovrascrive;
- `partner_assistant_drafts`: le bozze, append-only, con il recapito (`contact_id`, non l'indirizzo copiato), la versione della scheda e delle regole e l'impronta SHA-256 di oggetto, corpo e firma.

Tabelle in `private`, non leggibili da nessun ruolo client: `partner_assistant_config` (riga unica con modalità, profilo dell'assistente e di Tommi, credito di partenza, pausa, attesa, ultimo giro), `partner_assistant_runs` (una riga per chiamata a Claude: token, ricerche web, costo), `partner_assistant_events` (registro delle esecuzioni, solo codici), `partner_assistant_receipts` (ricevute idempotenti) e `partner_assistant_scheduler_state` (puntatore al segreto in Vault).

Nessun testo, indirizzo o segreto finisce nei log, nelle risposte HTTP, negli eventi o nelle colonne con audit. La cancellazione definitiva di un recapito («Cancella il dato») cancella anche note e bozze del contatto e passa il lavoro a Tommi con il motivo «dato cancellato» (un lavoro che era già di Tommi tiene il suo motivo): non lo rimette in coda dall'inizio, così una ricerca rifatta non risalva il dato cancellato. Lo si ridà all'assistente dalla scheda, con l'interruttore «Assistente su questo contatto», e allora riparte dalla ricerca.

RPC dei membri (`authenticated`, con `partner_actor()` e ricevute per `operation_id`): `set_partner_assistant_mode`, `set_partner_assistant_contact`, `save_partner_assistant_rules` e `read_partner_assistant_status`. «Prova» e «Invio» li sceglie solo il founder e in questa consegna sono rifiutati.

RPC del worker, eseguibili solo da `service_role`, ognuna con la guardia sul ruolo: `claim_partner_assistant_step`, `context_partner_assistant_step`, `checkpoint_partner_assistant_step`, `record_partner_assistant_call`, i quattro `complete_partner_assistant_research`, `_choice`, `_draft`, `_review`, `fail_partner_assistant_step` e `pause_partner_assistant`. Dentro, `auth.uid()` restituisce il profilo dell'assistente, che risulta autore di note, bozze e ricevute; anche i trigger di audit lo leggono da lì. Il worker le chiama con una lista ammessa (`src/lib/partner-assistant/store.ts`), solo POST, al massimo 1 MiB e 10 secondi per chiamata. `configure_partner_assistant` e `configure_partner_assistant_scheduler` si usano solo all'avvio.

Codice: `src/lib/partner-assistant/` (configurazione, trasporto, controlli, prompt, client Claude, costi, worker), `src/app/api/integrations/partner-assistant/worker/route.ts`, `src/lib/partner/assistant.ts` (letture ed etichette), i componenti `partner-assistant-*.tsx` e la pagina `src/app/(workspace)/partner/assistente/`.

## Modalità

| Modalità | Cosa fa | Chi la sceglie |
| --- | --- | --- |
| Spento | Non cerca e non scrive. È il valore dopo la migrazione. | Chiunque del team |
| Prepara | Ricerca e bozze, nessun invio. Toglie anche la pausa e l'attesa. | Chiunque del team, dopo la configurazione |
| Prova | Email solo verso l'indirizzo di prova di Tommi (seconda consegna) | Solo Tommi |
| Invio | Email ai contatti (seconda consegna) | Solo Tommi |

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

## Come si ferma

- **Dal gestionale**, chiunque del team: «Ferma l'assistente» nella striscia, oppure «Spento» nella pagina. Lo spegnimento vale anche con una versione vecchia della pagina; il credito invece si salva solo dalla versione in vigore, anche con «Spento», così non sovrascrive quello di un collega. L'assistente ricontrolla la modalità a ogni giro e subito prima di ogni chiamata a Claude: un passo con la chiamata già partita può ancora salvare il suo risultato, poi non ne parte un altro.
- **Su un solo contatto**: «Ferma su questo contatto» nel blocco «Assistente» della scheda. Non è «Non contattare»: il contatto resta contattabile dal team.
- **Pausa automatica**: con il credito finito o un errore di Claude l'assistente si mette in pausa da solo. Dopo una ricarica si aggiunge l'importo al credito di partenza in «Modalità» («Salva il credito e riparti»); dopo un errore si preme «Prepara».
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

## Avvio

Tutta la sequenza richiede l'OK di Tommi in chat, passo per passo (`AGENTS.md`): merge, migrazioni, profilo tecnico, chiavi, variabili, impostazioni Vercel e accensione dello scheduler.

**Il merge su `main` è il deploy di produzione**: Vercel pubblica `main` appena arriva il merge ([deployment.md](deployment.md)). Per questo Fluid compute, migrazioni e variabili vanno fatti **prima del merge**, e il merge è un passo della sequenza, non il primo. Se Fluid compute non è attivo, Vercel rifiuta il deploy della route con `maxDuration` 300 e da quel momento nessun merge su `main` arriva in produzione, nemmeno le correzioni degli altri moduli.

1. **Utente tecnico «Assistente».** Crearlo con gli strumenti Admin di Supabase Auth, mai con SQL su `auth.users`: indirizzo non instradabile nel dominio `.invalid` (come l'account QA di [verifica-auth-cloud.md](verifica-auth-cloud.md)), password casuale che nessuno conserva. Poi la sua riga in `profiles`, con il nome «Assistente», **senza membership**: così non entra nell'app e non compare tra gli assegnatari.
2. **Chiave segreta Supabase propria** dell'assistente, distinta da quella del worker Shopify.
3. **Vercel e Anthropic, prima del merge.** Controllare che Fluid compute sia attivo, con funzioni fino a 300 secondi (se non lo è, lo attiva Tommi), e il tier dell'account Anthropic in Console, che dà i limiti di velocità.
4. **Migrazioni, prima del merge.** Applicare le tre migrazioni con la procedura di [verification.md](verification.md) («Produzione, 22 ottobre 2026»: impronte in sola lettura prima, testo esatto del file, rinomina alla versione cloud, impronte dopo). Sono additive: il codice già in produzione non le usa. Se il merge arrivasse prima, la pagina non si rompe (l'assistente risulta «non attivo» e striscia e blocco non si vedono), ma è meglio non contarci.
5. **Variabili, prima del merge.** Inserire in Vercel produzione le variabili della tabella sopra, compreso `PARTNER_ASSISTANT_PHONE` con il numero che sceglie Tommaso.
6. **Merge su `main`.** Con i passi 3, 4 e 5 fatti, Tommi fa il merge della pull request: è il deploy di produzione. Poi controllare che il deploy su Vercel sia riuscito.
7. **Configurazione.** Dal client tecnico, con la chiave dell'assistente: `configure_partner_assistant(<assistente>, <Tommi>)` (profilo dell'assistente senza membership e profilo di Tommi con ruolo founder), poi `configure_partner_assistant_scheduler(<segreto>, true)` con lo stesso valore di `PARTNER_ASSISTANT_SECRET`. Il segreto non si incolla nel SQL Editor, in chat o nei log.
8. **Contatti già avviati.** Caricare in «Dati Partner» i file «Esporta» di tutti i dispositivi del vecchio sito ([partner.md](partner.md)) e segnare «Assistente su questo contatto: fermo» sui rapporti già avviati (negozi in conto vendita, accordi), così l'assistente non riscrive a chi è già stato contattato.
9. **Prepara.** Prima, controllare di nuovo in Console Anthropic il tier e il credito. Poi, dalla pagina dell'assistente, inserire il credito di partenza (quello della Console) e scegliere «Prepara».

Dopo l'avvio: il primo giro aggiorna «Ultimo giro» nella pagina; gli eventi dicono passo ed esito di ogni contatto.

## Test

- `npm test`: configurazione, trasporto, controlli in ogni lingua con le parole vietate, prompt, client Claude con errori e costi, worker con Claude e database finti, comandi, letture, pagina, striscia, blocco e guida. Solo dati sintetici.
- `npm run test:db`: `assistente-partner.mjs`, `assistente-partner-worker.mjs` e `assistente-partner-scheduler.mjs` su PGlite, `assistente-partner-concurrency.mjs` su PostgreSQL 17 (due giri sovrapposti: uno solo prende il lavoro). Minimi e numeri in [verification.md](verification.md).

Fixture: domini `example.test`, schede con CO da 951 in su, profilo dell'assistente sintetico. Nessuna chiamata vera a Claude, a Supabase o a un server di posta.
