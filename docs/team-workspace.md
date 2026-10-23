# Workspace condiviso del team

La route `/team` raccoglie calendario/call, attività e note reali del database Supabase. Non carica dati dimostrativi e non importa automaticamente il contenuto di `localStorage`. Dal 23 ottobre 2026 (pull request #3, P5) contiene anche le date e i solleciti che arrivano da Partner, e da `/team` si apre «Partner nel Team» (`/team/partner`).

## Operazioni disponibili

- Calendario: creazione ed eliminazione di appuntamenti, partecipanti del team, descrizione e link HTTP(S) facoltativo. All'inizio si vedono solo gli appuntamenti non ancora finiti, con «N passati nascosti»; «Mostra anche passati» li aggiunge (06 R16). Una giornata intera resta in vista fino alla mezzanotte di Roma.
- Attività: creazione con descrizione, assegnatario attivo e giorno di scadenza facoltativi; completamento, riapertura ed eliminazione.
- Note e idee: creazione ed eliminazione, con collegamento facoltativo a un’attività esistente. Eliminando l’attività, la nota rimane e il database azzera il collegamento.

Tutte queste informazioni sono condivise tra i membri attivi, secondo le RLS già applicate. Sono riutilizzate le tabelle `calendar_events`, `tasks` e `notes`; le operazioni manuali del Team non hanno richiesto migrazioni. Non vengono inviati messaggi, email o inviti, e non viene collegato alcun calendario esterno.

Le Server Actions verificano nuovamente l’utente tramite `getUser` e la membership corrente prima di ogni operazione, anche se l’input non è valido. Non usano chiavi di servizio. Il chiamante non può impostare `created_by` o altri campi esclusi dai grant esistenti. Assegnatari e partecipanti sono verificati rispetto alle membership attive; un collegamento a una nota deve riferirsi a un’attività leggibile nella stessa sessione. Le policy del database restano l’autorità finale, inclusa una revoca intervenuta tra verifica e scrittura.

La route è dinamica e la sua integrazione deve includere `/team/:path*` nel Proxy che applica le intestazioni `no-store`. Dopo una modifica riuscita viene invalidato `/team`; il pulsante Aggiorna rilegge i dati degli altri membri. Questa versione non promette aggiornamenti Realtime né modifica istantanea delle altre schede già aperte.

## Da Partner

Migrazione `20261023091627_partner_work_links.sql`, tabella `partner_work_links`: collega una scheda Partner a un'attività, a un appuntamento o a un progetto.

- **Solleciti.** Quando qualcuno segna nell'app un invio Partner («Segna inviato» o «Segna sollecito inviato», riga `partner_activities` con `origin = 'team'` e `kind = 'inviato'`), un trigger crea l'attività «Sollecito · <nome>», assegnata a chi ha inviato, con scadenza alla mezzanotte di Roma di 7 giorni dopo. Non succede se il contatto è chiuso, non interessato o tra i non contattare, né se esiste già un invio o una risposta più recenti. Un nuovo invio, «Ha risposto», lo stato «Chiuso» o «Non interessato» e «Non contattare» chiudono i solleciti aperti. Le righe che arrivano dai file dei dispositivi (`origin = 'file'`) non creano né chiudono solleciti.
- **Date nel calendario.** Le date di evento e di scadenza della candidatura di una scheda Partner diventano appuntamenti di giornata intera («Evento partner», «Scadenza candidatura»), e si aggiornano quando cambia la scheda. Le date già passate non vengono create a posteriori. Se qualcuno modifica a mano l'appuntamento, il collegamento chiede una scelta in «Partner nel Team» invece di sovrascriverlo. Alla migrazione sono nati così 54 appuntamenti.
- **Partner nel Team** (`/team/partner`, `src/components/partner-work-links.tsx`): si sceglie un contatto per nome o CO e si vedono date, collegamenti e solleciti. Pulsanti: «Collega l’evento», «Mantieni modifiche manuali» o «Usa date Partner», «Crea progetto per Produzione» (in Nuovi prodotti, assegnato a Produzione), «Crea attività di apertura» (conto vendita; per sedi estere serve prima la verifica del commercialista), «Collega vendita all’evento». Ogni comando passa da `create_partner_work`, con ricevuta e riquadro «Invio da verificare». Da Oggi ci si arriva con «Collega un esito Partner al lavoro del team».
- Il riferimento alla scheda è scritto nel testo dell'attività o dell'appuntamento («Partner CO 12 · /partner?co=12#lead-12»): oggi non è un link (problema noto, vedi [verifiche](verification.md)).

## Orari e collegamenti

Gli input `datetime-local` vengono interpretati esplicitamente in `Europe/Rome`, indipendentemente dal fuso del browser o del server. Gli istanti sono salvati come timestamp UTC e mostrati nel fuso italiano.

- Un orario inesistente nel passaggio all’ora legale viene rifiutato.
- Un orario ripetuto nel passaggio all’ora solare richiede la scelta esplicita della prima o seconda occorrenza.
- Il campo scadenza delle attività rappresenta un giorno, non un’ora di consegna: viene memorizzato a mezzogiorno nel fuso italiano e visualizzato come data.
- Gli input accettano anni 2000–2100, coerentemente con gli attributi dei moduli.

Partecipanti, descrizione e link della call vengono salvati nella colonna `calendar_events.description` come JSON con `format: luckylap-team-event` e `version: 1`. Le descrizioni precedenti in testo semplice restano leggibili. Metadata con formato noto ma versione o contenuto non validi vengono segnalati come dettagli non leggibili. I link vengono validati come HTTP(S) senza credenziali e aperti con `noopener noreferrer`; non vengono recuperati dal server.

## Concorrenza e limiti

Il completamento/riapertura di un’attività include nello `UPDATE` lo stato che l’utente ha letto: una scheda obsoleta non sovrascrive uno stato già cambiato da un collaboratore. L’utente riceve un errore esplicito e ricarica la pagina.

Ogni lettura usa cursori sull’ID e il conteggio esatto delle righe successive, evitando gli spostamenti di OFFSET quando un elemento precedente viene eliminato. Una pagina troncata, un conteggio residuo cambiato durante la lettura, duplicati o righe non valide impediscono la visualizzazione di uno snapshot parziale. Il limite esplicito è 10.000 righe per tabella; oltre tale dimensione serviranno viste filtrate/paginate per periodo. Le letture delle diverse tabelle non costituiscono un’unica transazione: una relazione appena rimossa da un altro membro può essere temporaneamente indicata come non disponibile fino all’aggiornamento.

Gli INSERT esistenti non concedono la colonna `id`. Questa versione lascia al database la generazione degli UUID, disabilita il modulo durante l’invio e non esegue retry automatici. Se la risposta a una scrittura è incerta, mostra: “Ricarica la pagina prima di riprovare, per verificare se la modifica è già presente”. **Le creazioni non hanno ancora una garanzia di idempotenza tra invii distinti.** Per aggiungerla serve una migrazione dedicata e revisionata che abiliti una chiave operazione/UUID, con controllo del payload nei replay; non va simulata con una sola ricerca preliminare soggetta a race.

L’area consente creazione/eliminazione e stato attività; la modifica del contenuto di elementi già creati non è ancora esposta. L’eliminazione è confermata con un secondo controllo in pagina ed è registrata dal trigger audit esistente.

## Verifica

I collegamenti Partner sono provati da `supabase/tests/partner-work-links.mjs` (PGlite) e `partner-work-concurrency.mjs` (PostgreSQL 17); il calendario che parte dai prossimi da `src/components/team-workspace.test.tsx`. Numeri in [verifiche](verification.md). Il resto di questa sezione è il verbale del primo rilascio.

I test aggiunti coprono autorizzazione di ogni Server Action, grant di inserimento rispettati, assegnatari/partecipanti attivi, relazioni mancanti, aggiornamenti concorrenti, errori di permesso, risposte incerte senza diagnostica privata, letture complete con cursori, limiti del JSON serializzato, URL, date non valide e i due cambi d’ora italiani del 2026. I form vengono rimontati sul risultato dell’azione per preservare anche i select dopo un errore, senza interferire con il reset di React 19. Typecheck e build Next.js 16.4.2 sono eseguiti nella copia stabile fuori da iCloud.

Il controllo visivo è stato eseguito dal coordinatore su una fixture sintetica nella copia locale temporanea a 1280×720 e 390×844: scala mobile 1 e nessun overflow orizzontale. Le prove restano riservate in `.private/deployment-proof/team-desktop.png` e `team-mobile.png`. La fixture è stata poi rimossa e `/qa-team` risponde 404; nessuna route di test o riga dimostrativa viene pubblicata nel repository. La route `/team` senza configurazione è stata verificata via HTTP: mostra lo stato di setup e non espone moduli o dati. Login, MFA e scritture cloud con account reali richiedono il bootstrap degli utenti; i test delle Actions usano client e membership simulati.

Il layout estende il sistema esistente in `DESIGN.md`: Barlow, verde LuckyLap, superfici chiare, liste operative e moduli con etichette visibili, feedback, pending e conferma eliminazione. Nessun nuovo contesto visivo o detector viene eseguito e i file di design esistenti non sono modificati.
