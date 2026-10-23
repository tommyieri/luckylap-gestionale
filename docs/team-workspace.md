# Workspace condiviso del team

La route `/team` raccoglie calendario/call, attività e note reali del database Supabase. Non carica dati dimostrativi e non importa automaticamente il contenuto di `localStorage`.

## Operazioni disponibili

- Calendario: griglia del mese, creazione ed eliminazione di appuntamenti, partecipanti del team, descrizione e link HTTP(S) facoltativo (vedi «Calendario a mese»).
- Attività: creazione con descrizione, assegnatario attivo e giorno di scadenza facoltativi; completamento, riapertura ed eliminazione.
- Note e idee: creazione ed eliminazione, con collegamento facoltativo a un’attività esistente. Eliminando l’attività, la nota rimane e il database azzera il collegamento.

Tutte queste informazioni sono condivise tra i membri attivi, secondo le RLS già applicate. Sono riutilizzate le tabelle `calendar_events`, `tasks` e `notes`; non servono nuove migrazioni per queste operazioni. Non vengono inviati messaggi, email o inviti, e non viene collegato alcun calendario esterno.

Le Server Actions verificano nuovamente l’utente tramite `getUser` e la membership corrente prima di ogni operazione, anche se l’input non è valido. Non usano chiavi di servizio. Il chiamante non può impostare `created_by` o altri campi esclusi dai grant esistenti. Assegnatari e partecipanti sono verificati rispetto alle membership attive; un collegamento a una nota deve riferirsi a un’attività leggibile nella stessa sessione. Le policy del database restano l’autorità finale, inclusa una revoca intervenuta tra verifica e scrittura.

La route è dinamica e la sua integrazione deve includere `/team/:path*` nel Proxy che applica le intestazioni `no-store`. Dopo una modifica riuscita viene invalidato `/team`; il pulsante Aggiorna rilegge i dati degli altri membri. Questa versione non promette aggiornamenti Realtime né modifica istantanea delle altre schede già aperte.

## Calendario a mese

`src/components/team-calendar.tsx`, regole pure in `src/lib/team/calendar.ts`. Sostituisce la lista con «Mostra anche passati».

- Griglia del mese con le settimane da lunedì, nomi italiani di mesi e giorni, «Mese precedente», «Mese successivo» e «Oggi» per tornare al giorno corrente. Oggi ha il filetto verde sotto il numero; il giorno scelto è in inversione d'inchiostro.
- Un pallino nero sui giorni con almeno un impegno: gli appuntamenti segnano ogni giorno di Roma che coprono (giornata intera e più giorni compresi; la fine a mezzanotte non segna il giorno dopo), le attività il giorno di scadenza.
- Toccare un giorno mostra i suoi impegni sotto la griglia (telefono) o accanto (desktop): orario («10:00–10:45», «Giornata intera»), tipo, partecipanti, descrizione, «Apri il link della call» ed «Elimina»; per le attività «Completa»/«Riapri» ed «Elimina». Il modulo «Nuovo appuntamento» resta sotto il calendario. Cambiando mese si apre oggi, se è nel mese, altrimenti il primo giorno con qualcosa.
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
- Il campo scadenza delle attività rappresenta un giorno, non un’ora di consegna: viene memorizzato a mezzogiorno nel fuso italiano e visualizzato come data.
- Gli input accettano anni 2000–2100, coerentemente con gli attributi dei moduli.

Partecipanti, descrizione e link della call vengono salvati nella colonna `calendar_events.description` come JSON con `format: luckylap-team-event` e `version: 1`. Le descrizioni precedenti in testo semplice restano leggibili. Metadata con formato noto ma versione o contenuto non validi vengono segnalati come dettagli non leggibili. I link vengono validati come HTTP(S) senza credenziali e aperti con `noopener noreferrer`; non vengono recuperati dal server.

## Concorrenza e limiti

Il completamento/riapertura di un’attività include nello `UPDATE` lo stato che l’utente ha letto: una scheda obsoleta non sovrascrive uno stato già cambiato da un collaboratore. L’utente riceve un errore esplicito e ricarica la pagina.

Ogni lettura usa cursori sull’ID e il conteggio esatto delle righe successive, evitando gli spostamenti di OFFSET quando un elemento precedente viene eliminato. Una pagina troncata, un conteggio residuo cambiato durante la lettura, duplicati o righe non valide impediscono la visualizzazione di uno snapshot parziale. Il limite esplicito è 10.000 righe per tabella; oltre tale dimensione serviranno viste filtrate/paginate per periodo. Le letture delle diverse tabelle non costituiscono un’unica transazione: una relazione appena rimossa da un altro membro può essere temporaneamente indicata come non disponibile fino all’aggiornamento.

Gli INSERT esistenti non concedono la colonna `id`. Questa versione lascia al database la generazione degli UUID, disabilita il modulo durante l’invio e non esegue retry automatici. Se la risposta a una scrittura è incerta, mostra: “Ricarica la pagina prima di riprovare, per verificare se la modifica è già presente”. **Le creazioni non hanno ancora una garanzia di idempotenza tra invii distinti.** Per aggiungerla serve una migrazione dedicata e revisionata che abiliti una chiave operazione/UUID, con controllo del payload nei replay; non va simulata con una sola ricerca preliminare soggetta a race.

L’area consente creazione/eliminazione e stato attività; la modifica del contenuto di elementi già creati non è ancora esposta. L’eliminazione è confermata con un secondo controllo in pagina ed è registrata dal trigger audit esistente.

## Verifica

I test aggiunti coprono autorizzazione di ogni Server Action, grant di inserimento rispettati, assegnatari/partecipanti attivi, relazioni mancanti, aggiornamenti concorrenti, errori di permesso, risposte incerte senza diagnostica privata, letture complete con cursori, limiti del JSON serializzato, URL, date non valide e i due cambi d’ora italiani del 2026. I form vengono rimontati sul risultato dell’azione per preservare anche i select dopo un errore, senza interferire con il reset di React 19. Typecheck e build Next.js 16.4.2 sono eseguiti nella copia stabile fuori da iCloud.

Il controllo visivo è stato eseguito dal coordinatore su una fixture sintetica nella copia locale temporanea a 1280×720 e 390×844: scala mobile 1 e nessun overflow orizzontale. Le prove restano riservate in `.private/deployment-proof/team-desktop.png` e `team-mobile.png`. La fixture è stata poi rimossa e `/qa-team` risponde 404; nessuna route di test o riga dimostrativa viene pubblicata nel repository. La route `/team` senza configurazione è stata verificata via HTTP: mostra lo stato di setup e non espone moduli o dati. Login, MFA e scritture cloud con account reali richiedono il bootstrap degli utenti; i test delle Actions usano client e membership simulati.

Il layout estende il sistema esistente in `DESIGN.md`: Barlow, verde LuckyLap, superfici chiare, liste operative e moduli con etichette visibili, feedback, pending e conferma eliminazione. Nessun nuovo contesto visivo o detector viene eseguito e i file di design esistenti non sono modificati.
