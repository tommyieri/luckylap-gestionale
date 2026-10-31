# Workspace condiviso del team

La route `/team` raccoglie calendario/call, attività e note reali del database Supabase. Non carica dati dimostrativi e non importa automaticamente il contenuto di `localStorage`. Dal 23 ottobre 2026 (pull request #3, P5) contiene anche le date e i solleciti che arrivano da Partner, e da `/team` si apre «Partner nel Team» (`/team/partner`).

## Operazioni disponibili

- Calendario: griglia del mese, creazione, modifica ed eliminazione di appuntamenti, partecipanti del team, descrizione e link HTTP(S) facoltativo (vedi «Calendario a mese»).
- Attività: creazione e modifica con descrizione, assegnatario e giorno di scadenza facoltativi; stato, completamento, riapertura ed eliminazione.
- Note e idee: creazione ed eliminazione, con collegamento facoltativo a un’attività esistente. Eliminando l’attività, la nota rimane e il database azzera il collegamento.

Tutte queste informazioni sono condivise tra i membri attivi, secondo le RLS già applicate. Sono riutilizzate le tabelle `calendar_events`, `tasks` e `notes`; le operazioni manuali del Team non hanno richiesto migrazioni. Non vengono inviati messaggi, email o inviti, e non viene collegato alcun calendario esterno.

Le Server Actions verificano nuovamente l’utente tramite `getUser` e la membership corrente prima di ogni operazione, anche se l’input non è valido. Non usano chiavi di servizio. Il chiamante non può impostare `created_by` o altri campi esclusi dai grant esistenti. I nuovi assegnatari e partecipanti sono verificati rispetto alle membership attive; un collegamento a una nota deve riferirsi a un’attività leggibile nella stessa sessione. Le policy del database restano l’autorità finale, inclusa una revoca intervenuta tra verifica e scrittura.

La route è dinamica e la sua integrazione deve includere `/team/:path*` nel Proxy che applica le intestazioni `no-store`. Dopo una correzione riuscita vengono invalidati `/team`, Oggi, Controllo CEO, Partner e Partner nel Team; il pulsante Aggiorna rilegge i dati degli altri membri. Le altre schede già aperte richiedono ancora un aggiornamento della pagina.

## Da Partner

Migrazione `20261023091627_partner_work_links.sql`, tabella `partner_work_links`: collega una scheda Partner a un'attività, a un appuntamento o a un progetto.

- **Solleciti.** Quando qualcuno segna nell'app un invio Partner («Segna inviato» o «Segna sollecito inviato» nel Registro della scheda, riga `partner_activities` con `origin = 'team'` e `kind = 'inviato'`), un trigger crea l'attività «Sollecito · <nome>», assegnata a chi ha inviato, con scadenza alla mezzanotte di Roma di 7 giorni dopo; la conferma nella scheda dice il giorno («Sollecito per te giovedì 29 ottobre.»). Dal 23 ottobre 2026 (`20261023140414_partner_oggi_fixes.sql`) vale anche per i file «Esporta» dei dispositivi (`origin = 'file'`): un «Contattato» del file crea il sollecito per chi ha caricato il file, 7 giorni dopo la data dell'esportazione (può essere già in ritardo), e «Risposto», «In trattativa», «Accordo fatto» o «Non interessato» dal file lo chiudono. Non succede se il contatto è chiuso, non interessato o tra i non contattare, né se esiste già un invio o una risposta più recenti (per un file: della stessa data o più recenti, così un nuovo import non crea doppioni). Un nuovo invio, «Ha risposto» (nella scheda o in Oggi), lo stato «Accordo fatto» o «Non interessato» e «Non contattare» chiudono i solleciti aperti. Resta un solo sollecito aperto per contatto: ogni invio chiude i precedenti sotto il lock della riga del contatto. In Oggi i solleciti stanno solo in «Contatti e solleciti», con «Ha risposto», e non nell'agenda.
- **Date nel calendario.** Le date di evento e di scadenza della candidatura di una scheda Partner con stato «Accordo fatto» diventano appuntamenti di giornata intera («Evento partner», «Scadenza candidatura»), e si aggiornano quando cambia la scheda; senza accordo non entrano in calendario (migrazione `20261023113212_partner_dates_only_agreed.sql`). Le date già passate non vengono create a posteriori in automatico: solo «Collega l’evento» le mette in calendario. Se qualcuno modifica a mano l'appuntamento, il collegamento chiede una scelta in «Partner nel Team» invece di sovrascriverlo. Alla prima migrazione erano nati così 54 appuntamenti per schede senza accordo; la migrazione del 23 ottobre li ha tolti (vedi [verifiche](verification.md)).
- **Partner nel Team** (`/team/partner`, `src/components/partner-work-links.tsx`): si sceglie un contatto per nome o CO e si vedono date, collegamenti e solleciti. `/team/partner?co=12` apre già il contatto 12: ci porta il riquadro «Esito» della scheda Partner con «Accordo fatto». «Collega l’evento» crea l'appuntamento anche per un evento già passato, così si collegano le vendite; senza accordo dice «Prima segna l’accordo fatto nella scheda Partner…», senza date «Mancano le date dell’evento…». In anteprima locale la pagina mostra i contatti sintetici di `/partner`, senza collegamenti e senza salvataggi (`src/lib/work-links/preview.ts`). Pulsanti: «Collega l’evento», «Mantieni modifiche manuali» o «Usa date Partner», «Crea progetto per Produzione» (in Nuovi prodotti, assegnato a Produzione), «Crea attività di apertura» (conto vendita; per sedi estere serve prima la verifica del commercialista), «Collega vendita all’evento». Ogni comando passa da `create_partner_work`, con ricevuta e riquadro «Invio da verificare». Da Oggi ci si arriva con «Collega un esito Partner al lavoro del team».
- Il riferimento alla scheda è scritto nel testo dell'attività o dell'appuntamento («Partner CO 12 · /partner?co=12#lead-12»). Nel calendario e nella lista delle attività il percorso diventa il link «Apri la scheda» (`src/components/partner-ref-text.tsx`).

## Calendario a mese

`src/components/team-calendar.tsx`, regole pure in `src/lib/team/calendar.ts`. Sostituisce la lista con «Mostra anche passati».

- Griglia del mese con le settimane da lunedì, nomi italiani di mesi e giorni, «Mese precedente», «Mese successivo» e «Oggi» per tornare al giorno corrente. Oggi ha il filetto verde sotto il numero; il giorno scelto è in inversione d'inchiostro.
- Un pallino nero sui giorni con almeno un impegno: gli appuntamenti segnano ogni giorno di Roma che coprono (giornata intera e più giorni compresi; la fine a mezzanotte non segna il giorno dopo), le attività il giorno di scadenza.
- Toccare un giorno mostra i suoi impegni sotto la griglia (telefono) o accanto (desktop): orario («10:00–10:45», «Giornata intera»), tipo, partecipanti, descrizione, «Apri il link della call», «Modifica» ed «Elimina»; per le attività sono disponibili anche «Completa»/«Riapri». Il modulo «Nuovo appuntamento» resta sotto il calendario. Cambiando mese si apre oggi, se è nel mese, altrimenti il primo giorno con qualcosa.
- «Modifica» apre i campi già compilati nella stessa pagina. «Salva modifiche» aggiorna l’elemento esistente; «Annulla» chiude senza salvare. Se cambia la data, il calendario mostra il nuovo giorno e mese. Togliendo la scadenza a un’attività, questa rimane nell’elenco Attività. Le attività si possono modificare anche da quell’elenco.
- Ogni giorno è un pulsante con `aria-pressed` e un'etichetta come «23 ottobre, 2 impegni, oggi»; `aria-current="date"` su oggi. Le frecce spostano il giorno (anche nel mese accanto) e il fuoco lo segue; solo il giorno scelto è nella sequenza del tasto Tab.
- I link `/team#evento-<id>` (Oggi, Controllo CEO, Partner nel Team) aprono il mese e il giorno d'inizio dell'evento e lo evidenziano in verde chiaro. Le ancore `#attivita-<id>` e `#nota-<id>` restano sulle liste.
- Telefono a 390 px: celle di almeno 47 × 52 px, nessuno scorrimento orizzontale, testo da 12 px in su, campi a 16 px.
- Gli appuntamenti Partner entrano qui solo con lo stato «Accordo fatto» (vedi [partner.md](partner.md), «Accordo fatto e calendario»). Oggi resta una lista breve del giorno e legge lo stesso calendario.

## Anteprima locale

Con `npm run dev` (`isLocalPreviewEnabled()`, sempre spenta su Vercel e con `NODE_ENV=production`) `/team` mostra il calendario, le attività e le note sintetici di `src/lib/team/fixtures.ts`, con le date calcolate da oggi, e l'avviso «Anteprima locale: dati sintetici, salvataggio disattivato.». Le Server Action rispondono «Anteprima locale: salvataggio disattivato.» senza creare il client Supabase. Lo provano `src/lib/team/fixtures.test.ts` e `src/lib/team/actions.test.ts`. La vecchia anteprima su `localStorage` (`LocalPreviewWorkspace`) è stata tolta.

## Orari e collegamenti

Gli input `datetime-local` vengono interpretati esplicitamente in `Europe/Rome`, indipendentemente dal fuso del browser o del server. Gli istanti sono salvati come timestamp UTC e mostrati nel fuso italiano.

- Un orario inesistente nel passaggio all’ora legale viene rifiutato.
- Un orario ripetuto nel passaggio all’ora solare richiede la scelta esplicita della prima o seconda occorrenza.
- La modifica di un orario ripetuto precompila l’occorrenza che corrisponde all’istante già salvato. Se l’orario rimane invariato, vengono conservati anche secondi e precisione del timestamp originale.
- Per «Giornata intera» si inseriscono il primo e l’ultimo giorno inclusi; il database mantiene la fine esclusiva alla mezzanotte successiva, anche nei cambi dell’ora.
- Il campo scadenza delle attività rappresenta un giorno, non un’ora di consegna: viene memorizzato a mezzogiorno nel fuso italiano e visualizzato come data.
- Gli input accettano anni 2000–2100, coerentemente con gli attributi dei moduli.

Partecipanti, descrizione e link della call vengono salvati nella colonna `calendar_events.description` come JSON con `format: luckylap-team-event` e `version: 1`. Le descrizioni precedenti in testo semplice restano leggibili. Metadata con formato noto ma versione o contenuto non validi vengono segnalati come dettagli non leggibili. I link vengono validati come HTTP(S) senza credenziali e aperti con `noopener noreferrer`; non vengono recuperati dal server.

## Concorrenza e limiti

Il completamento/riapertura di un’attività include nello `UPDATE` lo stato che l’utente ha letto: una scheda obsoleta non sovrascrive uno stato già cambiato da un collaboratore. L’utente riceve un errore esplicito e ricarica la pagina.

Ogni lettura usa cursori sull’ID e il conteggio esatto delle righe successive, evitando gli spostamenti di OFFSET quando un elemento precedente viene eliminato. Una pagina troncata, un conteggio residuo cambiato durante la lettura, duplicati o righe non valide impediscono la visualizzazione di uno snapshot parziale. Il limite esplicito è 10.000 righe per tabella; oltre tale dimensione serviranno viste filtrate/paginate per periodo. Le letture delle diverse tabelle non costituiscono un’unica transazione: una relazione appena rimossa da un altro membro può essere temporaneamente indicata come non disponibile fino all’aggiornamento.

Gli INSERT esistenti non concedono la colonna `id`. Questa versione lascia al database la generazione degli UUID, disabilita il modulo durante l’invio e non esegue retry automatici. Se la risposta a una scrittura è incerta, mostra: “Ricarica la pagina prima di riprovare, per verificare se la modifica è già presente”. **Le creazioni non hanno ancora una garanzia di idempotenza tra invii distinti.** Per aggiungerla serve una migrazione dedicata e revisionata che abiliti una chiave operazione/UUID, con controllo del payload nei replay; non va simulata con una sola ricerca preliminare soggetta a race.

La modifica di appuntamenti e attività conserva ID, autore e collegamenti: non elimina e ricrea la riga. L’azione confronta i dati letti all’apertura con quelli correnti e aggiunge allo `UPDATE` un confronto atomico di tutti i campi originali. Se un collega cambia o elimina l’elemento nel frattempo, la scrittura viene rifiutata e i campi compilati restano disponibili. Un salvataggio senza cambiamenti non genera un nuovo aggiornamento. Partecipanti e assegnatari non più attivi già presenti si possono mantenere o rimuovere, ma non aggiungere a una nuova assegnazione.

I trigger esistenti registrano le modifiche nel feed CEO. Gli eventi Partner modificati manualmente continuano a richiedere la scelta «Mantieni modifiche manuali» o «Usa date Partner». L’eliminazione resta confermata con un secondo controllo in pagina.

## Verifica

La modifica è verificata nei test di modello, Server Actions, campi precompilati e calendario. Le prove coprono versioni obsolete, corse tra lettura e aggiornamento, operazioni senza cambiamenti, descrizioni precedenti, membri inattivi già selezionati, giorni interi e cambio dell’ora. L’esito del salvataggio raggiunge il calendario anche quando il refresh rimuove il modulo dal vecchio giorno. L’anteprima sintetica è stata provata a 1280×900 e 390×844 con il browser nel fuso di New York: orari di Roma corretti, annullamento e ripristino, dati conservati dopo l’errore, campi delle attività e assenza di scorrimenti orizzontali. Prove riservate in `.private/deployment-proof/calendar-edit-browser.json` e nelle due immagini `calendar-edit-desktop.png` e `calendar-edit-mobile.png`. Non sono state effettuate scritture sul database di produzione.

I collegamenti Partner sono provati da `supabase/tests/partner-work-links.mjs` (PGlite) e `partner-work-concurrency.mjs` (PostgreSQL 17); il calendario che parte dai prossimi da `src/components/team-workspace.test.tsx`. Numeri in [verifiche](verification.md). Il resto di questa sezione è il verbale del primo rilascio.

I test aggiunti coprono autorizzazione di ogni Server Action, grant di inserimento rispettati, assegnatari/partecipanti attivi, relazioni mancanti, aggiornamenti concorrenti, errori di permesso, risposte incerte senza diagnostica privata, letture complete con cursori, limiti del JSON serializzato, URL, date non valide e i due cambi d’ora italiani del 2026. I form vengono rimontati sul risultato dell’azione per preservare anche i select dopo un errore, senza interferire con il reset di React 19. Typecheck e build Next.js 16.4.2 sono eseguiti nella copia stabile fuori da iCloud.

Il controllo visivo è stato eseguito dal coordinatore su una fixture sintetica nella copia locale temporanea a 1280×720 e 390×844: scala mobile 1 e nessun overflow orizzontale. Le prove restano riservate in `.private/deployment-proof/team-desktop.png` e `team-mobile.png`. La fixture è stata poi rimossa e `/qa-team` risponde 404; nessuna route di test o riga dimostrativa viene pubblicata nel repository. La route `/team` senza configurazione è stata verificata via HTTP: mostra lo stato di setup e non espone moduli o dati. Login, MFA e scritture cloud con account reali richiedono il bootstrap degli utenti; i test delle Actions usano client e membership simulati.

Il layout estende il sistema esistente in `DESIGN.md`: Barlow, verde LuckyLap, superfici chiare, liste operative e moduli con etichette visibili, feedback, pending e conferma eliminazione. Nessun nuovo contesto visivo o detector viene eseguito e i file di design esistenti non sono modificati.
