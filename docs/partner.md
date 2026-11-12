# Partner nel gestionale

`/partner` raccoglie negozi, eventi, club, media e brand nelle quattro sezioni Eventi, Collab, Vendita e Club. Si apre su **Elenco** e permette di passare a **Pipeline**, **Calendario**, **Mappa** e **Andamento** con gli stessi filtri. La scheda di ogni contatto si apre a lato. **Programma email** porta alla pagina dedicata alle prime email. Tutti e cinque i membri possono consultare i contatti e usare i comandi Partner, secondo la decisione del founder del 21 ottobre 2026. Le modalità e i permessi specifici degli invii sono descritti in [Assistente Partner](partner-assistente.md).

I dati stanno nel database e li leggono solo i membri attivi. Ogni scrittura passa da un comando con `operation_id`, ricevuta e, dove serve, controllo di versione. La ricerca arriva dal repository `luckylap-partner` con un import preparato offline. Per gli stati e i testi salvati sui dispositivi c'è l'import dei file «Esporta» del vecchio sito, che però nessuno ha usato: il sito è spento dal 28 ottobre 2026 (vedi «GitHub Pages»).

Il nuovo impianto riprende il prototipo di Luca e usa i dati e i comandi già presenti nel gestionale. Le pagine qui sotto descrivono il comportamento attuale. Restano come riferimenti storici il riordino approvato il 2 novembre 2026, la spec `02-partner.md` e le correzioni di `00-sequenza.md` (§2, §4 P2, §5). [Progetto del riordino](superpowers/specs/2026-11-02-partner-riordino.md) e [piano della Tappa 1](superpowers/plans/2026-11-02-partner-riordino-tappa-1.md).

## Riordino: Tappa 1

Nel riordino del 2 novembre 2026, «Risposte» raccoglieva le attività di risposta già registrate dal team. La Tappa 1 usava i dati e i comandi esistenti e lasciava al worker d’invio i controlli, i limiti e la finestra delle prime email. Le viste correnti sono descritte in «Pagine».

La fase operativa è calcolata da stato commerciale, blocchi e lavoro dell'assistente; non aggiunge stati nel database. Le etichette commerciali sono «Scritto» (`contattato`), «Risposto» (`risposto`), «Primi contatti avviati» (`trattativa`), «Accordo fatto» (`chiuso`) e «Non interessato» (`no`). Per chi è ancora da contattare compaiono anche «Da verificare», «Fermo» con il motivo, «Serve Tommi», «Pronta», «In preparazione» e «Da scrivere», con la data quando disponibile. «Non contattare» precede tutte le altre fasi; un invio incerto conserva un avviso separato anche con una fase commerciale successiva.

«A chi tocca» deriva dall'ultima attività di invio o risposta registrata. Senza scambi registrati indica «A noi» per chi è ancora da contattare e «Da verificare» negli altri casi. «Per quando» usa prima la prossima azione, poi un sollecito realmente aperto, la data di scrittura dell'assistente o il periodo di contatto, con il significato della data. I dati operativi mancanti o non leggibili hanno un avviso proprio: le schede e i comandi esistenti restano disponibili.

## Base P2

- Una migrazione additiva, `supabase/migrations/20261022215908_partner_module.sql`: 9 tabelle pubbliche, 2 private, audit senza recapiti né testi, 10 comandi del team, import della ricerca riservato al proprietario del database. Nessuna tabella, funzione o policy esistente cambia.
- Pagine dentro il guscio comune: `/partner`, `/partner/dati`, `/partner/regole` e la route `/partner/lookbook/[code]` per i cinque PDF.
- Niente Storage: i lookbook stanno nel repository in `data/partner-lookbooks/` (decisione 20).
- Periodi calcolati da oggi, all'ora di Roma. Il 22 ottobre 2026 riproducono i conteggi del sito: 49, 63, 40, 11, 44.
- Le modifiche del team non si perdono: storico dei testi, import che aggiorna solo ciò che il team non ha toccato, «differenze da controllare» per il resto.
- Fuori da P2: solleciti automatici, date Partner nel calendario e Oggi (P5); frasi del Controllo CEO (P6); import in produzione (fatto il 22 ottobre, esiti in «Esiti in produzione»); spegnimento di GitHub Pages (fatto il 28 ottobre 2026, vedi «GitHub Pages»).

## Pagine

### `/partner`

La testata offre «Programma email» e «Aggiungi un contatto». I numeri iniziali seguono i contatti selezionati dai filtri e mostrano il totale, le prime email registrate negli ultimi 30 giorni, il tasso di risposta, i contatti con un prossimo passo nei prossimi 7 giorni e gli accordi fatti. Le cinque viste condividono le sezioni Tutti, Vendita, Eventi, Collab e Club. «Assistente e strumenti» apre la striscia dell’assistente, i collegamenti ad Assistente, Regole per scrivere e Dati Partner, i cinque lookbook e la data dell’ultimo import. Costi e configurazione sono in `/partner/assistente`.

| Vista | Cosa mostra |
| --- | --- |
| **Elenco** | Il contatto con CO, luogo e sezioni, fase, prossimo passo, proposta e responsabile. Si ordina per prossimo passo, priorità, ultima attività o nome. «Mostra altri contatti» aggiunge altre righe. |
| **Pipeline** | Le colonne Da contattare, Inviato, Risposto, In conversazione e Concluso. Le schede in «Non contattare» stanno in un gruppo separato. Trascinare una scheda apre una conferma. Il selettore «Fase» della scheda offre lo stesso cambio. |
| **Calendario** | Mese, Settimana e Lista dei fatti registrati e del lavoro in arrivo. In Lista si può scegliere un mese oppure tutto lo storico. |
| **Mappa** | Contatti per paese con selezione del paese e accesso alle schede. «Vedi i numeri per paese» offre la stessa consultazione tramite tabella. |
| **Andamento** | Invii e risposte registrati su 8 settimane, 6 mesi o 12 mesi, conteggi per fase, tempi di risposta, prossimi 14 giorni e ripartizioni filtrabili, con mappa di calore. |

#### Fasi, esiti e classificazioni

Le cinque fasi sono etichette di lettura sopra gli stati già salvati. «Inviato» corrisponde a `contattato`, «In conversazione» a `trattativa`. «Concluso» comprende gli esiti esistenti **Accordo fatto** (`chiuso`) e **Non interessato** (`no`). La conferma richiede di sceglierne uno e usa `set_partner_state` con la versione della scheda. In «Da contattare» i gruppi Serve intervento, Invio programmato e Serve una data descrivono il lavoro corrente dell’assistente e le stime disponibili. Il blocco «Non contattare» ha precedenza sulla fase e mantiene i suoi comandi.

Il prototipo presenta classificazioni ed esiti propri. Il gestionale usa le sezioni, la priorità e il tipo della scheda, oltre a formato email e sottotipo quando disponibili nella scelta dell’assistente associata a quel contatto. Il filtro Tipo usa il tipo della scheda quando manca il sottotipo. Un dato mancante resta da definire. Le nuove etichette e i gruppi sono calcolati in lettura. Questa consegna usa lo schema esistente e non applica migrazioni o riclassificazioni ai contatti storici.

Una scheda senza assegnazione esplicita mostra il nome con «(predefinito)» se c’è un solo founder attivo. Se manca un nome univoco mostra «Predefinito». È una lettura, quindi `owner_id` resta vuoto finché un membro non assegna la scheda. I filtri «Io» e per nome usano il responsabile effettivo. «Senza assegnazione esplicita» usa il valore salvato e comprende i contatti col riferimento predefinito. I destinatari dei solleciti e la selezione dell’assistente continuano a seguire i loro dati salvati.

#### Scheda laterale

Aprendo un contatto l’indirizzo prende `co=N`, mentre la vista e i filtri restano consultabili al ritorno. Le schede interne sono **In breve**, **Email**, **Registro**, **Ricerca**, **Recapiti** e **Dati e tag**. In breve mostra il prossimo passo, il responsabile, la prossima azione modificabile e l’ultima risposta registrata. Email contiene lo stato e la bozza dell’assistente. Registro raccoglie i comandi per annotare attività. Ricerca conserva fonti e contesto, Recapiti permette di modificare i canali e gestire «Non contattare», Dati e tag contiene il modulo della scheda e le differenze da controllare. Con «Accordo fatto», «Apri in Partner nel Team» è disponibile in In breve.

L’elenco legge una proiezione dei dati operativi. Il dettaglio, con testi e recapiti completi, viene letto all’apertura da `/partner/scheda` o dalla pagina server con `co` già nell’indirizzo. La route verifica la membership attiva e la corrispondenza della sessione e usa una risposta privata senza cache. Per cambiare scheda o uscire da un modulo con modifiche pendenti occorre prima salvarle o annullarle. Conferma, versioni, ricevute e recupero riusano i comandi Partner.

Registro: «Segna inviato», «Segna sollecito inviato», «Registra una risposta», «Chiamata», «Incontro», «Nota», con giorno, canale e testo. I due invii registrano `kind = 'inviato'` con `message_kind` `primo` o `sollecito`, lo stesso comando `record_partner_activity` che usavano i pulsanti del vecchio blocco «Messaggi pronti», con l'approccio scelto della scheda. Con il contatto in «Non contattare» invii, chiamate e incontri sono spenti. Se il registro ha un invio dello stesso tipo degli ultimi 10 minuti la pagina chiede conferma. La conferma del Registro indica quando scade il sollecito, se presente. Mostra le attività dalla più recente, le prime 20 e poi «Mostra tutte»; il dettaglio ne legge al massimo 100. Le attività dell'assistente indicano «dall'assistente» (vedi «Oggi, solleciti ed esiti»).

Registrare una risposta con il comando del Registro, oppure con «Ha risposto» in Oggi, chiude il sollecito collegato. Il cambio di fase in «Risposto» agisce sullo stato. Il testo delle risposte registrate appare come testo semplice nella scheda, anche quando il contatto è già in conversazione, con accordo o non interessato. Il filtro «Risposte registrate» trova i contatti che hanno una risposta nel registro.

**Niente più «Messaggi pronti»** (31 ottobre 2026, decisione di Tommi). La scheda aveva il blocco «Messaggi pronti»: le 218 varianti della ricerca di ottobre, tutte firmate «Tommi», con conto vendita e lookbook allegato. Tommi le ha scambiate due volte per email che stavano per partire. Le prime email le scrive e le manda l'assistente: è la «Bozza dell'email» del blocco «Assistente» ([partner-assistente.md](partner-assistente.md)). Quindi:

- il blocco non è più nella scheda. Il componente resta in `src/components/partner/partner-messages.tsx`, non montato, con il motivo in testa. Per rimetterlo non basta rimontarlo in `partner-details.tsx`: i passi sono nello stesso commento;
- «Segna inviato» e «Segna sollecito inviato» sono nel Registro, per ogni contatto;
- la riga non ha più l'etichetta «Messaggio pronto» o «N messaggi pronti»;
- le differenze sui testi (`field = 'message'`) non si mostrano nella scheda e non contano nell'avviso «Mostrale», nel filtro «Da controllare» e nell'etichetta della riga: non c'è più un posto dove risolverle. Il 31 ottobre in produzione erano zero. Possono ancora nascere: dal prossimo import della ricerca, su una variante con un testo del team, e da un file «Esporta» con testi diversi;
- lacuna nota: il conteggio delle differenze aperte di `/partner/dati` («N differenze da controllare. Mostrale») le conta ancora. Lo legge `loadPartnerData` in `src/lib/partner/server.ts`, che questo lavoro non tocca. Se ce n'è una, il numero non scende mai e «Mostrale» apre un elenco senza quella differenza. Per toglierla basta escludere `field = 'message'` in quella query, con l'OK di Tommi;
- l'anteprima di un file «Esporta» dice che i testi diversi restano quelli del gestionale, senza rimandare a «Da controllare». Anche la conferma dopo l'import ci rimanda solo per gli stati: «2 differenze: restano i valori del gestionale. Quelle sugli stati sono in «Da controllare».», senza l'ultima frase se sono tutte sui testi. Il database risponde solo con il totale, stati e testi insieme: quante sono sugli stati lo dice l'anteprima appena controllata. Senza anteprima (un import verificato dopo un ricaricamento della pagina) la conferma dice «Quelle sugli stati, se ci sono, sono in «Da controllare».»;
- `/partner/dati` non mostra più quanti messaggi ha portato l'import;
- testi, storico, comandi e import delle varianti non cambiano: i dati restano nel database.

Il sollecito dopo 7 giorni lo scrive Tommi, partendo dalla «Bozza dell'email» mandata, che resta nella scheda. Poi lo segna con «Segna sollecito inviato». Il progetto delle risposte e dei solleciti automatici resta fuori dalla Tappa 1.

#### Calendario Partner e Programma email

Il Calendario di Partner raggruppa per giorno di Roma invii e risposte del Registro, solleciti aperti, azioni del team, eventi con accordo e scadenze di candidatura dei contatti aperti. Gli eventi su più giorni compaiono nell’intervallo della scheda. Le voci registrate o importate restano consultabili nella lista «Tutto lo storico». Per le registrazioni dal vecchio sito vale la data del file e compare la dicitura «vecchio sito». La data può rappresentare un’esportazione anziché il momento effettivo dello scambio. Uno stato impostato da solo non aggiunge una voce al Registro.

Le prime email future sono voci «Prima email prevista · stima». Arrivano dalle previsioni disponibili del Programma email per i contatti ancora da contattare, con i controlli del programma. L’interfaccia segnala quando le stime o i dati del Registro sono indisponibili. Il pulsante **Programma email** apre `/partner/email` con la sezione corrente. Lì si consultano motivazioni, bozze e orari e si rivede il testo con i comandi esistenti. Gli impegni effettivi del Team seguono la regola di «Accordo fatto e calendario» qui sotto. [Programma email Partner](partner-programma-email.md).

#### Mappa e Andamento

La mappa usa `public/partner/confini.json`, ricavato esclusivamente dall’asset cartografico allegato da Luca. L’allegato indica Natural Earth come fonte dei confini, senza indicare la versione del dataset. Il file contiene 185 forme con identificatori univoci, tracciati e centri, con Cipro riunita sotto `CY`. L’asset contiene soltanto geometria. I conteggi arrivano dai contatti visibili al membro attivo e raggruppano i nomi di paese riconosciuti. I valori non riconosciuti restano consultabili come «Paese da verificare». La tabella per paese resta disponibile anche se i confini non si caricano. [Condizioni d’uso di Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/).

Andamento usa le voci registrate e il perimetro dei filtri. Il tasso di risposta conta i contatti con almeno una risposta successiva a un invio sul totale dei contatti con invii registrati. In assenza di invii il tasso è indisponibile. I tempi di risposta usano le coppie invio e risposta con ordine verificabile e lasciano fuori le date importate dai file. La previsione dei prossimi 14 giorni distingue prime email stimate, solleciti e azioni del team. Selezionando una ripartizione si apre l’Elenco con il relativo filtro. I grafici hanno una tabella di valori.

### `/partner/dati`

- **Ricerca**: ultimo import (data, commit, contatori), import precedenti, differenze aperte con il link al filtro «Da controllare». Il numero conta anche le differenze sui testi, che il filtro non mostra (lacuna nota, vedi «Niente più «Messaggi pronti»»).
- **File del vecchio sito**: scelta del file, «Controlla il file» (anteprima senza scritture), poi «Importa». Elenco dei file già importati.
- **Lookbook**: i cinque PDF con dimensione e «Scarica». Nessun caricamento: una nuova versione arriva con un aggiornamento del gestionale (vedi «Lookbook»).

### `/partner/regole`

`CONTESTO.md` dell'ultimo import (`partner_research_imports.context_md`) come solo testo: titoli, punti elenco, paragrafi; le tabelle restano a spaziatura fissa. Nessun HTML dal file.

### `/partner/lookbook/[code]`

`route.ts`, solo `GET`. Prima verifica il membro, poi il codice. Solo i cinque codici (`negozi`, `eventi`, `collab`, `porsche_club`, `club`) diventano un percorso su disco.

| Caso | Risposta |
| --- | --- |
| Membro, codice valido | 200, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="LuckyLap-Lookbook-<Titolo>.pdf"`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` |
| Non membro | 401 |
| Codice sconosciuto o file non valido | 404 |
| Verifica dell'accesso non riuscita | 503 |

### Stati, titoli e anteprima

- `metadata.title`: «Partner», «Dati Partner», «Regole per scrivere».
- Stati comuni con `AccessPanel` e `WorkspacePanel`. La lettura anagrafica usa `readTeamPages` con conteggi esatti. Se fallisce, la pagina mostra «Partner non disponibile» con «Ricarica». Attività, assistente e stime hanno avvisi propri quando indisponibili.
- Le tre pagine hanno il loro `loading.tsx` con le righe scheletro.
- Errori dei comandi accanto al controllo, con i testi di spec 02 §5.11 (`src/lib/partner/commands.ts`, `PARTNER_ERROR_MESSAGES`). Esito incerto: «Salvataggio non confermato. Verifica prima di riprovare.»; il tentativo resta in `sessionStorage` (chiave `luckylap.partner.pending:<utente>:…`) e «Verifica» lo ripete con lo stesso `operation_id`, mostrato con `src/components/pending-attempt.tsx`.
- **Anteprima locale** (`npm run dev`, `isLocalPreviewEnabled()`): le tre pagine leggono i sei contatti sintetici di `src/lib/partner/fixtures.ts`, con le date calcolate da oggi, e mostrano «Anteprima locale: dati sintetici, salvataggio disattivato.». Le Server Action rispondono «Anteprima locale: salvataggio disattivato.» senza chiamare Supabase. Mai su Vercel né con `NODE_ENV=production` (`src/lib/partner/read.test.ts`).

## Periodi, filtri e indirizzo

L’apertura predefinita è Elenco, con tutte le sezioni, tutte le fasi e tutti i periodi. Fase, Responsabile e Paese sono accanto alla ricerca. «Altri filtri» raccoglie Lavoro, Priorità, Periodo di contatto, Formato email e Tipo, con le opzioni ricavate dai dati disponibili. In Lavoro si trovano «Da seguire», «Risposte registrate», «Differenze da controllare» e «Contatti aperti». I filtri si combinano. «Togli i filtri» ripristina l’insieme completo nella vista corrente. I conteggi di sezione tengono conto degli altri filtri e un contatto con più sezioni compare nel conteggio di ciascuna.

Il giorno corrente è quello di Roma, calcolato sul server e passato al client. I cinque periodi di contatto restano disponibili in `src/lib/partner/periods.ts`.

- Mese pianificato = mese di `next_action_on` se c'è, altrimenti `contact_month`. `k` = mesi dal mese corrente.
- Periodo 1 `k ≤ 1` (compresi i mesi passati), 2 `2–3`, 3 `4–5`, 4 `6–8`, 5 `k ≥ 9`.
- Celle e titoli seguono il mese: il 22 ottobre 2026 «Adesso», «Dic – Gen», «Feb – Mar», «Apr – Giu», «Da lug 2027»; il 10 dicembre 2026 «Adesso», «Feb – Mar», «Apr – Mag», «Giu – Ago», «Da set 2027», con il titolo «Adesso, entro gennaio».
- Mezzanotte di Roma: `2026-10-31T23:30:00Z` è già novembre.
| Parametro | Valori | Predefinito |
| --- | --- | --- |
| `vista` | `elenco`, `pipeline`, `calendario`, `mappa`, `andamento` | `elenco` |
| `sezione` | `tutti`, `vendita`, `eventi`, `collab`, `club` | `tutti` |
| `fase`, `lavoro` | Fasi, gruppi e filtri di lavoro definiti in `database-view.ts` | `tutti` |
| `periodo` | 1–5 | Tutti |
| `chi` | `tutti`, `io`, `nessuno` o id di un membro | `tutti` |
| `paese`, `priorita`, `formato`, `sottotipo` | Paese per codice, priorità, formato email e tipo disponibili | Vuoti |
| `q` | Fino a 80 caratteri. Nome, città, paese, tipo o CO | Vuoto |
| `ordine` | `passo`, `priorita`, `attivita`, `nome` | `passo` |
| `mese`, `calendario`, `storico` | Mese `AAAA-MM`, modalità `mese`, `settimana` o `lista`, storico `tutto` | Mese corrente e modalità `mese` |
| `co` | Numero della scheda aperta | Nessuno |

`parsePartnerDatabaseView` legge lo stato dall’indirizzo e `partnerDatabaseHref` lo riscrive quando cambia. La navigazione del browser ripristina il contesto. Il vecchio `vista=ci_siamo` apre Elenco con fase Accordo fatto. `vista=da_seguire`, `vista=risposte` e il precedente `stato` vengono letti come filtri compatibili. Il collegamento `/partner?co=12#lead-12` continua ad aprire la scheda. Funziona anche la sola ancora `#lead-12` usata dai link storici, e l’apertura della scheda conserva i filtri dell’indirizzo.

## Accordo fatto e calendario

Decisione di Tommi del 23 ottobre 2026: nel calendario del team e nell'agenda di Oggi vanno solo gli eventi a cui partecipiamo davvero.

- Lo stato con chiave `chiuso` si chiama «Accordo fatto» (`PARTNER_STAGE_LABELS`): ci andiamo, c'è una collab o un accordo. La chiave nel database, nei file «Esporta» e nei comandi resta `chiuso`.
- **Regola**: le date di una scheda (evento e scadenza della candidatura) diventano un appuntamento di giornata intera solo con «Accordo fatto»; con ogni altro stato no. Prima bastava che lo stato non fosse «Non interessato».
- Migrazione additiva `supabase/migrations/20261023113212_partner_dates_only_agreed.sql` (applicata in produzione il 23 ottobre 2026 come versione cloud 20261023113212: tolti i 54 appuntamenti automatici delle schede senza accordo, restano i 3 eventi inseriti a mano). Sostituisce `private.sync_partner_work_dates` (stessa firma, `security definer`, `search_path` vuoto, nessun grant) con la condizione `stage <> 'chiuso'` al posto di `stage = 'no'`, e `private.partner_work_command` con un solo controllo in più. Le regole di sicurezza restano: un appuntamento con vendite collegate (`partner_event_sales`) o modificato dal team non si cancella e il collegamento passa a «Scelta richiesta» (`needs_review`); quelli che il team ha scelto di tenere («Mantieni modifiche manuali») non si toccano. In più: se l'appuntamento di una scheda senza accordo non c'è già più, il collegamento si azzera senza chiedere una scelta.
- **Pulizia in produzione**: alla fine la migrazione ripassa ogni scheda con un collegamento `dates`. Gli appuntamenti automatici delle schede senza accordo, non toccati e senza vendite, si cancellano: il 23 ottobre 2026 erano 54, creati dal backfill di `20261023091627_partner_work_links`. Nel Controllo CEO risultano eliminati da «Il sistema».
- Cambi di stato: «Accordo fatto» con date future crea l'appuntamento; togliere l'accordo lo cancella, salvo vendite o modifiche del team (allora «Scelta richiesta»). Un accordo su un evento già passato non crea niente.
- «Collega l'evento» in `/team/partner` è attivo solo con «Accordo fatto»; il comando rifiuta le altre schede con `partner_work_not_agreed` («Prima segna l’accordo fatto nella scheda Partner: in calendario vanno solo gli eventi a cui partecipiamo.») e le schede senza date con `partner_work_date_required` («Mancano le date dell’evento: aggiungile nella scheda Partner.»). Dal 23 ottobre 2026 (`20261023140414_partner_oggi_fixes`) crea l'appuntamento anche se l'evento è già passato, così le vendite si possono collegare; la sincronizzazione automatica continua a saltare le date passate senza appuntamento. «Usa date Partner» su una scheda senza accordo toglie l'appuntamento, o si ferma con `partner_work_event_has_sales` se ha vendite.
- **Accordi fatti**. In Elenco o Pipeline scegli «Accordo fatto» in Fase. L’URL storico `/partner?vista=ci_siamo` apre Elenco con questo filtro. Da In breve puoi aprire la scheda corrispondente in Partner nel Team.
- Verifiche: `supabase/tests/partner-dates-agreed.mjs` (PGlite, 76 controlli: stato di produzione con la regola vecchia, pulizia, cambi di stato, comandi, firme e permessi); `finance-ecosystem-integration.mjs` segna «Accordo fatto» prima di collegare la vendita all'evento. `partner-work-links.mjs` applica anche questa migrazione e `20261023140414_partner_oggi_fixes`; `partner-work-concurrency.mjs` prova ancora la sola migrazione P5.

## Sezione Club

Decisione di Tommi del 30 ottobre 2026: una sezione per i club di appassionati, a cui proporre magliette co-firmate con il logo del club ricamato. Nell'esempio operativo si citano soltanto le collaborazioni con Porsche Club in Italia, senza nomi dei singoli club né quantità delle commesse precedenti.

- **Chi c'è.** Porsche Club, registri e community Porsche fuori dall'Italia (in Italia Tommi ha già i contatti); club Ferrari e Mercedes-Benz in Italia e all'estero. Anche i cinque club della ricerca del 21 ottobre (Ferrari Owners' Club GB, TIPEC, Gull Wing Group, Porsche Club GB, Porsche Club Deutschland) stanno in Club, oltre che nelle loro sezioni.
- **Interfaccia.** Pulsante «Club» con il conteggio accanto alle altre sezioni, disponibile in tutte le viste. L’indirizzo `/partner?sezione=club` apre l’Elenco filtrato. La casella «Club» si modifica in «Dati e tag» nella scheda.
- **Database.** Migrazione additiva `supabase/migrations/20261031180505_partner_sezione_club.sql`: il vincolo `partners_sections_check` ammette `club` e fino a quattro sezioni distinte; `private.partner_sections` (comandi del team e import della ricerca) le rimette nell'ordine canonico vendita, eventi, collab, club. Stessa firma e stessi permessi: nessun ruolo client la esegue. I contatti esistenti non cambiano. In produzione dal 31 ottobre 2026, dopo il merge della pull request #27 (esiti in [verification.md](verification.md), «Sezione Club, 31 ottobre 2026»).
- **Ricerca.** Nel repository Partner, `research/2026-10-30_club.json`, letto da `tools/build_data.py` (`add_clubs`). Entrano i verdetti «includi» e «borderline» (questi con priorità Riserva e il motivo nelle note); gli «escludi» restano solo nel file, con il motivo: fornitore o partner di abbigliamento dichiarato, merchandising obbligatorio della casa, club inattivo, nessun recapito. Un'email entra solo se la verifica l'ha trovata scritta su una fonte ufficiale del club. Un club già nel piano (stesso sito o stesso nome) prende la sezione Club senza diventare un contatto nuovo. L'import segue «In produzione, passo per passo»: fatto il 31 ottobre 2026 con 647 club (esiti in «Import dei club, 31 ottobre 2026»).
- **Assistente.** Per un club l'assistente sceglie già la proposta `merch_cobranding` («magliette co-firmate, con il loro logo ricamato accanto alle nostre auto, come nelle collaborazioni con Porsche Club in Italia») e con i Porsche Club usa solo 964 e GT3 RS. Ogni club importato con un'email entra nella sua coda come gli altri contatti «Da contattare»: va deciso prima dell'import se lasciarli all'assistente, con la spesa e i limiti d'invio di [partner-assistente.md](partner-assistente.md).
- **Test.** `supabase/tests/partner-club.mjs` (PGlite, 56 controlli): prima lo stato di produzione, che rifiuta la sezione; poi la migrazione con i dati identici, il vincolo, la funzione e i permessi, `save_partner` con un contatto nuovo e con Club aggiunto, e l'import del generatore vero con un club nuovo e uno che prende Club in più. Vitest: conteggi, riga dei totali e filtro `sezione=club`, costanti confrontate con la migrazione.

## Database

### Tabelle

| Tabella | Contenuto |
| --- | --- |
| `public.partners` | La scheda: `co` stabile e unico (1–99999, mai riusato), `source_key` della ricerca (`L001`, `n111`; nullo per i contatti del team), sezioni, priorità, `contact_month`, date dell'evento, scadenza candidatura, canale preferito, testi della ricerca in `research` (sola lettura), `research_base` per il confronto a tre vie, `stage`, `owner_id`, prossima azione, approccio scelto, `research_removed_at`, `version`. |
| `public.partner_contacts` | Recapiti per tipo (`email`, `phone`, `whatsapp`, `instagram`, `form`, `brand_page`, `web`): testo intero in `value`, valore pulito per il pulsante in `link_value` (formato stretto per tipo), `verified`, `active`, cancellazione in `erased_at`, `research_slot` e `research_value` per gli import. |
| `public.partner_message_variants` | Una variante per contatto e approccio: canale, lingua, destinatari, lookbook, quattro testi originali della ricerca, note per il team, `current_revision_id` (nullo = vale l'originale), `original_changed_at`. |
| `public.partner_message_revisions` | Storico dei testi del team, append-only: `edit`, `restore`, `file`. |
| `public.partner_activities` | Registro di tutto ciò che il team fa su un contatto, append-only. Una riga per contatto e operazione (`unique (operation_id, partner_id)`). Copia nome e CO del momento. Origine `team`, `file` (file «Esporta») o, dalla consegna 2a dell'assistente, `assistente`. |
| `public.partner_do_not_contact` | Lista «non contattare», per contatto o per dominio. |
| `public.partner_research_imports` | Un import della ricerca applicato, append-only: commit, data, contatori, `CONTESTO.md`. Nessun dato di contatto. |
| `public.partner_device_imports` | Un file «Esporta» importato, append-only: SHA-256 del file, dispositivo, data di esportazione, contatori. |
| `public.partner_import_differences` | Differenze da controllare: valore del team e valore in arrivo, al massimo una aperta per contatto, campo, variante e recapito. |
| `private.partner_command_receipts` | Ricevute dei comandi, append-only, come `private.finance_work_receipts`. |
| `private.partner_import_staging` | Lotti dell'import della ricerca in transito; si cancellano quando l'import è applicato. |

### Accesso e audit

- Tabelle pubbliche: RLS attiva, solo `select` per `authenticated` con la policy `member_read` (`private.is_member()`). Nessun grant di scrittura: si scrive solo con i comandi. Tabelle private: RLS attiva, nessun grant, nemmeno a `service_role`.
- `EXECUTE` tolto a ogni funzione del modulo, poi concesso a `authenticated` solo sui comandi (wrapper pubblico `security invoker` e funzione privata `security definer`, entrambi con `search_path = ''`).
- Audit con il trigger nuovo `private.audit_change_keys(colonne…)`: in `audit_logs` vanno solo le colonne elencate nel trigger, più `_changed` negli `UPDATE`; `record_key` porta `id`, `partner_id`, `variant_id`. Le colonne sono quelle di spec 02 §2.3, senza le righe dei lookbook.
- Mai nell'audit: `value`, `link_value`, `label`, `research`, `research_base`, `to_text`, `cc_text`, i testi dei messaggi, `body`, `next_action`, `reason`, `team_value`, `incoming_value`, `context_md`.
- Append-only con `private.reject_ledger_mutation()`: revisioni, registro, import della ricerca, import dei file, ricevute.

### Comandi del team

Ogni comando è `public.<nome>(p_operation_id uuid, p_payload jsonb)` e segue gli stessi passi: membro attivo (`auth.uid()` e `private.is_member()`), payload con le sole chiavi ammesse e `schema_version = 1`, ricevuta (stessa operazione e stesso payload: risultato salvato con `"replayed": true`; payload, comando o autore diversi: `23505`), riga bloccata e versione attesa, scrittura e una riga di registro con lo stesso `operation_id`. L'autore è sempre `auth.uid()`: il client non lo passa mai.

| Comando | Effetto | Registro |
| --- | --- | --- |
| `set_partner_state` | Stato, responsabile (membro attivo o nessuno), prossima azione con data, approccio scelto | una riga: `stato`, altrimenti `responsabile`, `prossima_azione`, `approccio` |
| `save_partner` | Contatto nuovo del team (CO = massimo + 1 sotto un lock) o modifica della scheda | `nuovo` o `scheda` |
| `record_partner_activity` | `inviato`, `risposta`, `chiamata`, `incontro`, `nota`; giorno da oggi a 365 giorni fa. `inviato` porta Da contattare → Scritto; `risposta` porta Da contattare o Scritto → Risposto. Le chiavi nel database restano quelle esistenti. Contatto bloccato: `inviato`, `chiamata`, `incontro` danno `55000` | il tipo richiesto, con stato prima e dopo |
| `save_partner_message` | Nuova revisione `edit`, o variante nuova del team. Testi uguali all'originale: come il ripristino | `messaggio` o `ripristino` |
| `restore_partner_message` | Torna all'originale della ricerca (revisione `restore`) | `ripristino` |
| `save_partner_contact` | Recapito nuovo o modificato; senza un valore utilizzabile dal pulsante: `partner_contact_unusable` | `recapito` |
| `remove_partner_contact` | Rimuove (recuperabile) o cancella il dato (definitivo, anche dalle differenze e dai destinatari dei messaggi del contatto; l'import non lo ripristina più) | `recapito` |
| `set_partner_do_not_contact` | Mette o toglie il blocco; con `include_domain` blocca anche il dominio del sito | `non_contattare` |
| `resolve_partner_difference` | «Tieni il nostro» o «Usa il nuovo», con le validazioni del comando corrispondente | `differenza` |
| `import_partner_device_file` | Import di un file «Esporta» (sotto) | una riga per contatto toccato |

Più una lettura senza scritture, `public.preview_partner_device_file(p_payload jsonb)`, con le stesse regole dell'import.

Un contatto è bloccato se ha una riga attiva sua, oppure se il dominio del suo sito o della sua email è in una riga attiva (`private.partner_blocked`).

`private.apply_partner_stage(p_partner_id, p_stage, p_actor, p_operation_id, p_log default true)` cambia lo stato, azzera `stage_from_file_at` e incrementa `version`. Con `p_log` scrive la riga `stato`; i comandi che scrivono una loro riga (`set_partner_state`, `record_partner_activity`, l'import dei file, `resolve_partner_difference`) passano `false` e registrano stato prima e dopo nella loro. Così ogni operazione dà una sola riga per contatto (decisione 11). P5 la chiama con quattro argomenti da `record_partner_outcome`.

Codici d'errore (messaggio = codice): `42501 partner_access_required`; `22023 invalid_partner_payload`, `partner_not_found`, `partner_owner_inactive`, `partner_contact_unusable`, `partner_contact_erased`, `partner_message_no_original`, `partner_difference_closed`, `partner_domain_unavailable`, `partner_not_blocked`, `partner_co_exhausted`; `40001 partner_changed`; `23505 partner_idempotency_conflict`; `55000 partner_do_not_contact`. Import della ricerca: `22023 invalid_partner_research`, `partner_batch_altered`, `partner_batch_conflict`, `partner_import_incomplete`.

## Import della ricerca

Il repository `luckylap-partner` resta il laboratorio: la skill `messaggi` scrive `research/bozze/varianti.json` e `CONTESTO.md`, `tools/build_data.py` rigenera `site/data/partners.json`. I testi della ricerca non si modificano dal gestionale: si correggono lì e si reimportano.

### Generatore offline

`supabase/generate-partner-import.mjs`. Nessuna rete, nessuna connessione al database, nessuna credenziale.

```bash
node supabase/generate-partner-import.mjs --partner-repo "<checkout di luckylap-partner>" \
  --output-dir .private/partner-import --batch-bytes 40000
```

- Rifiuta un repository che non è la radice di un checkout git, che ha modifiche non committate o in cui mancano i tre file committati: il commit deve identificare i dati.
- Controlla che le varianti di `partners.json` e di `varianti.json` coincidano; se no, chiede di rilanciare `python3 tools/build_data.py`.
- Normalizza e valida come spec 02 §3. Un contatto senza mese prende il mese dal periodo e dalla data `generated` (`subito` +1, `dicembre_gennaio` +2, `febbraio_marzo` +4, `aprile_giugno` +6, `secondo_semestre_2027` +9). Il campo `draft` non si importa; un `draft` senza varianti ferma il generatore.
- Scrive, con data della ricerca e inizio di `normalized_sha256` nel nome:
  - `…-01.sql`, `…-02.sql` …: `select private.stage_partner_research(…, '<sha del lotto>');`, ognuno al massimo di `--batch-bytes` byte;
  - `…-apply.sql`: `select private.apply_partner_research('<sha>', array[…]);` con lo SHA-256 di ogni lotto;
  - `….report.json`: conteggi per sezione, periodo, mese, canale, recapiti per tipo, varianti per approccio, codici dei recapiti senza valore pulito e dei contatti senza mese, SHA-256 dei lotti. Nessun recapito e nessun testo.
- Cartella `0700`, file `0600` creati in modo esclusivo; rifiuta una cartella dentro un repository git se non è ignorata (`.private/` lo è). Su stdout e stderr solo conteggi e codici.

Per provarlo sui dati sintetici serve un repository git usa e getta: copiare `supabase/tests/fixtures/partner` in una cartella temporanea, `git init`, `git add .`, `git commit`, poi lanciare il generatore con `--output-dir` in un'altra cartella temporanea. Risultato atteso: 6 contatti, 8 varianti, 1 lotto, 2 recapiti senza valore pulito, 2 contatti senza mese. L'harness `partner.mjs` lo fa nel gruppo del generatore.

### Regole nel database

`private.stage_partner_research(testo, sha_atteso)` registra un lotto solo se lo SHA-256 del testo ricevuto è quello scritto dal generatore nel file: un testo alterato nel trasporto dà `partner_batch_altered` e non scrive niente. Poi verifica intestazione e contatti e restituisce lo SHA-256 del testo. Lo stesso lotto ripetuto non ha effetto; lo stesso indice con un testo diverso dà errore.

`private.apply_partner_research(normalized_sha256, sha_dei_lotti[])` applica tutto in una transazione, sotto il lock `luckylap.partner.import`, solo se ci sono tutti i lotti con gli SHA-256 attesi. Lo stesso import già applicato restituisce il resoconto con `"replayed": true`.

- **Scheda**, confronto a tre vie su `name`, `city`, `country`, `type_label`, `sections`, `priority`, `contact_month`, `event_starts_on`, `event_ends_on`, `preferred_channel` tra base (`research_base`), valore attuale e valore in arrivo: se il team non l'ha toccato prende il nuovo; se l'hanno cambiato entrambi allo stesso modo non succede niente; se l'hanno cambiato in modo diverso resta quello del team e nasce (o si aggiorna) una differenza. `research` si sostituisce sempre.
- **Recapiti**, per tipo: nuovi inseriti; cancellati mai ripristinati, nemmeno nei destinatari delle varianti (il resoconto li elenca: vanno tolti anche dal repository Partner); non toccati dal team aggiornati o disattivati se spariti; rimossi o modificati dal team con un valore nuovo diverso: differenza.
- **Varianti**: nuove inserite; originali sempre aggiornati; se vale un testo del team resta quello, con `original_changed_at` e una differenza `message`; sparite dalla ricerca: `research_removed_at`. Dai destinatari («A», «Cc») in arrivo si tolgono le voci con un recapito cancellato che la ricerca riporta ancora.
- **Contatti**: nuovi con CO successivo, nell'ordine dei lotti (periodo del sito, poi il suo CO), stato Da contattare; assenti dalla ricerca: `research_removed_at`, niente si cancella; tornati: azzerato.
- Una riga in `partner_research_imports` con i contatori; i lotti in transito si cancellano.

Le due funzioni sono `security invoker` e senza grant: le esegue solo il proprietario del database.

### In produzione, passo per passo

Autorizzato da Tommi il 22 ottobre (00-sequenza §1.1). Lo fa Claude con il connettore Supabase (`execute_sql`, proprietario del database), dopo l'applicazione della migrazione (00-sequenza §1.3), il merge e il deploy `READY`. Nessun grant nuovo.

1. Repository Partner pulito (`git status --porcelain` vuoto); annotare il commit.
2. Nel worktree di P2: `node supabase/generate-partner-import.mjs --partner-repo "<percorso luckylap-partner>" --output-dir .private/partner-import --batch-bytes 40000`.
3. Per ogni `…-NN.sql`, in ordine: `execute_sql` con il testo esatto del file. Risposta attesa: `staged: true` e `payload_sha256` uguale allo SHA del lotto nel resoconto (`batches[].sha256`). Lo stesso lotto rimandato risponde `staged: false` senza effetti. Errore `partner_batch_altered`: il testo è arrivato alterato e non è stato registrato; rileggere il file e rimandarlo così com'è. Nessun altro SQL di scrittura.
4. `…-apply.sql` con `execute_sql`. Conservare il resoconto restituito (contatori, `new_codes`, `blocked_codes`, `erased_skipped`: `{source_key, slot}` per i recapiti cancellati che la ricerca riporta, `{source_key, approach}` per le varianti a cui sono stati tolti dai destinatari).
5. Verifiche in sola lettura (sotto).
6. `rm` dei `.sql` generati: contengono tutti i recapiti. Resta solo il `.report.json` in `.private/`.

Un lotto alterato non entra mai nella tabella di transito: lo SHA-256 atteso viaggia nello stesso file, quindi rimandare il file basta e non serve nessun'altra scrittura. Se il trasporto dei lotti non funziona: fermarsi e dirlo, senza aprire grant nuovi (00-sequenza §6, rischio 2).

### Verifica dei conteggi

Valori attesi per la ricerca del 21 ottobre 2026 (commit `f6ad90c`, spec 02 §8): 207 contatti; 119 Vendita, 80 Eventi, 73 Collab; 218 varianti; recapiti attivi 165 email, 148 telefoni, 170 Instagram, 143 moduli, 19 pagine brand, 205 siti; 49 contatti nel periodo 1 se si verifica in ottobre o novembre 2026; zero differenze aperte. In ogni caso sezioni e recapiti devono coincidere con `by_section` e `contacts_by_slot` del resoconto del generatore.

```sql
select count(*) as contatti from public.partners;
select s as sezione, count(*) from public.partners, unnest(sections) s group by s order by s;
select count(*) as varianti from public.partner_message_variants;
select kind, count(*) from public.partner_contacts where active group by kind order by kind;
select count(*) as periodo_1 from public.partners
  where coalesce(date_trunc('month', next_action_on)::date, contact_month)
    <= (date_trunc('month', (now() at time zone 'Europe/Rome')::date) + interval '1 month')::date;
select count(*) as differenze_aperte from public.partner_import_differences where status = 'open';
select count(*) as lotti_in_transito from private.partner_import_staging;
-- Audit senza recapiti: entrambe zero.
select count(*) as audit_con_chiocciola from public.audit_logs
  where table_name like 'partner%'
    and strpos(coalesce(old_data::text, '') || coalesce(new_data::text, ''), '@') > 0;
select count(*) as audit_con_recapiti from public.audit_logs a
  join public.partner_contacts c on c.link_value is not null
  where a.table_name like 'partner%'
    and strpos(coalesce(a.old_data::text, '') || coalesce(a.new_data::text, ''), c.link_value) > 0;
```

Se `audit_con_chiocciola` non è zero, controllare la riga: l'unico testo libero dell'audit è il nome del contatto.

Queste letture sono state provate su PGlite con i sei contatti sintetici, applicando i file del generatore come farebbe `execute_sql`.

### Esiti in produzione

Migrazione applicata il 22 ottobre 2026 con versione cloud `20261022215908`; il testo salvato coincide con il file (md5 `c4326206389828d3fbef17e2a2ebc70e`). Impronte di giacenze, movimenti e sedi identiche prima e dopo. Tabelle Partner create con RLS, vuote fino all'import.

Import della ricerca applicato il 22 ottobre 2026, dalla ricerca del commit `f6ad90c` del repository Partner:

| Voce | Valore |
| --- | --- |
| Import (`partner_research_imports.id`) | `e471ff5e-d63e-4a58-8793-2bfa0991aee2` |
| SHA-256 normalizzato | `49bc4bc3f870012a1e4dde3c9c25260354eaecd73b92469429211ea89055d68d` |
| Contatti | 207 |
| Per sezione | 119 Vendita, 80 Eventi, 73 Collab |
| Varianti dei messaggi | 218 |
| Recapiti attivi per tipo | 165 email, 148 telefoni, 170 Instagram, 143 moduli, 19 pagine brand, 205 siti |
| Periodo 1 (verifica di ottobre 2026) | 49 contatti |
| Differenze aperte | 0 |
| Righe di audit Partner con una chiocciola o con un recapito | 0 e 0 |

Tutti i valori coincidono con quelli attesi in «Verifica dei conteggi».

### Import dei club, 31 ottobre 2026

Autorizzato da Tommi il 31 ottobre 2026 («Sì, tutti i 647»), dopo la migrazione della sezione Club. Ricerca del commit `1221aba` del repository Partner (branch `claude/sezione-club`, pull request [luckylap-partner#2](https://github.com/tommyieri/luckylap-partner/pull/2)).

| Voce | Valore |
| --- | --- |
| Import (`partner_research_imports.id`) | `50553ef0-f1e3-427a-8a6f-908e7a17b67a` |
| SHA-256 normalizzato | `b76d94c09fbf36caa7c269577d521c3f06989a0f5d4dceb560c1dd67b96493a9` |
| Lotti | 74, al massimo 40000 byte |
| Contatti | 854: 647 nuovi (CO da 208 a 854), 5 aggiornati, nessuno tolto |
| Per sezione | 119 Vendita, 80 Eventi, 73 Collab, 652 Club |
| Club per priorità | 76 alta, 222 media, 354 Riserva |
| Varianti dei messaggi | 218, nessuna cambiata |
| Recapiti attivi per tipo | 772 email, 420 telefoni, 320 Instagram, 265 moduli, 19 pagine brand, 807 siti |
| Club con un'email attiva | 609 |
| Periodo 1 (verifica del 31 ottobre 2026) | 695 contatti |
| Differenze aperte | 0 |
| Righe di audit Partner con una chiocciola o con un recapito | 0 e 0 |

I 5 contatti aggiornati sono i club già nel piano (CO 1, 86, 94, 137, 152), che prendono la sezione Club; i 202 altri contatti di prima sono identici. Il nuovo `CONTESTO.md` (9097 caratteri, `/partner/regole`) non parla più della schermata su GitHub Pages e nomina i file dei club.

**Correzione del 1° novembre 2026.** Con l'OK di Tommi («Sì, sistemali»), Luftgekühlt (CO 738) passa dalla sezione Club a Collab: è un brand di eventi e abbigliamento, senza soci, e la ricerca stessa propone una collaborazione (una capsule co-firmata), non una fornitura. Scritta da Claude con `private.partner_write_fields`, la stessa funzione dei comandi del team, senza autore (come l'import): versione 2, una riga di audit, nessun'altra riga cambiata (impronte di schede, recapiti, varianti, registro, differenze e tabelle dell'assistente uguali prima e dopo). Ora le sezioni sono 119 Vendita, 80 Eventi, 74 Collab, 651 Club. Un import futuro della stessa ricerca la lascia in Collab: per il confronto a tre vie la sezione in arrivo è uguale alla base, quindi vale quella della scheda. Gli altri tre nomi che la revisione della modalità modello aveva segnalato sono quelli ufficiali e restano come sono: «Ferrari Owners' Club Belgio» (registro delle imprese belga, n. 0414.486.443), «Pagodentreff.de» (Impressum e sito della community) e «Mercedes-Benz SLR.CLUB e.V.» (Impressum, registro delle associazioni di Osnabrück, VR 201690).

Trasporto dei lotti: una riga di un lotto arriva a 40000 caratteri, che Read e il terminale non mostrano per intero. Ogni lotto è stato spezzato in pezzi di 1200 caratteri uniti con `||` dentro la stessa chiamata a `private.stage_partner_research`, con lo stesso SHA-256 atteso scritto dal generatore: il database riceve lo stesso testo e lo verifica. Prima la prova completa su PGlite (74 lotti, import applicato, 854 contatti); poi in produzione 74 lotti registrati al primo tentativo, impronta degli SHA in transito uguale al resoconto, `…-apply.sql` con il testo del file. I `.sql` sono stati cancellati; resta solo il `.report.json` in `.private/`.

## File del vecchio sito («Esporta»)

Il pulsante «Esporta stati e testi di questo dispositivo» del vecchio sito scaricava `luckylap-partner-AAAA-MM-GG-telefono.json` o `…-computer.json`. Lo stato del sito viveva nel browser di ogni dispositivo: il gestionale non può leggerlo, serve il file.

- **Parser** (`src/lib/partner/device-file.ts`, nel browser e di nuovo sul server): `formato` `luckylap-partner-export`, `versione` 1, `esportato` ISO, `dispositivo` `telefono` o `computer`; chiavi dei contatti e dei testi nel formato del sito; stati, approcci e testi dentro i limiti; al massimo 900 KB e 2000 voci per mappa; chiavi `__proto__`, `constructor`, `prototype` rifiutate; `vista` ignorata, qualunque valore abbia. Lo SHA-256 dei byte del file è la sua identità.
- **Anteprima**: «Controlla il file» calcola il piano senza scrivere: stati, testi e approcci da applicare, differenze, voci ignorate, contatti sconosciuti, nomi diversi (solo avviso), file già importato.
- **Import**: lo stesso piano, in una transazione, sotto il lock `luckylap.partner.device`. Lo stesso file già importato restituisce il resoconto di allora.

Regole, mai sopra il lavoro del team:

- **Stato**: `da_contattare` nel file è ignorato. Si applica se nel gestionale è Da contattare e nessun membro ha mai cambiato lo stato, oppure se lo stato viene da un file esportato prima. Un file più vecchio è «superato». Altrimenti resta il valore del gestionale e nasce una differenza `stage`. Quando si applica, `stage_from_file_at` = data di esportazione.
- **Testi**, per contatto e approccio: si applicano come revisione `file` se vale l'originale o una revisione `file` più vecchia; uguali all'originale o al testo in uso: ignorati; altrimenti differenza `message`. Variante inesistente: «sconosciuto».
- **Approccio**: si applica se nel gestionale è vuoto o viene da un file più vecchio; altrimenti ignorato.
- **Registro**: una riga per contatto toccato, `origin = 'file'`, `occurred_at` = data di esportazione, autore chi carica il file. Stato Contattato → `inviato` (primo messaggio, canale della variante o del canale preferito); Ha risposto e In trattativa → `risposta`; Accordo fatto (chiave `chiuso`, come nel file) e Non interessato → `stato`; solo testi → `messaggio`; solo approccio → `approccio`.

Quando: era previsto dopo il rilascio di P5, così gli invii importati creano i solleciti (decisione 30). Non è servito: il 28 ottobre 2026 Tommi ha confermato che nessuno ha usato il vecchio sito e che non c'era nessun contatto segnato, quindi non ci sono file da caricare (in produzione `partner_device_imports` è vuota). Il sito ora è spento e il pulsante «Esporta» non è più online (vedi «GitHub Pages»). L'import resta in `/partner/dati` per un file già scaricato.

**Solleciti dai file** (dal 23 ottobre 2026, `20261023140414_partner_oggi_fixes`; prima le righe `origin = 'file'` non creavano né chiudevano solleciti). Un «Contattato» del file crea «Sollecito · <nome>» per chi ha caricato il file (`partner_device_imports.imported_by`, lo stesso autore della riga), con scadenza alla mezzanotte di Roma di 7 giorni dopo la data dell'esportazione: con un file vecchio è già in ritardo. «Ha risposto», «In trattativa», «Accordo fatto» e «Non interessato» dal file chiudono il sollecito aperto con un invio precedente all'esportazione. Valgono le regole del team: un solo sollecito aperto per contatto, niente se c'è un invio o una risposta più recenti, niente per «Accordo fatto», «Non interessato» e «Non contattare». Un file non crea niente se il registro ha già un invio o una risposta della stessa data o più recenti, e lo stesso file caricato di nuovo restituisce il resoconto di allora: nessun doppione. Le righe dei file importati prima della migrazione restano senza sollecito (nessun recupero all'indietro).

## Lookbook

- I cinque PDF stanno in `data/partner-lookbooks/` (`negozi.pdf`, `eventi.pdf`, `collab.pdf`, `porsche_club.pdf`, `club.pdf`), copiati da `luckylap-partner/site/lookbook/`. Titoli fissi: Stockists, Events, Collaborations, Porsche Clubs, Clubs.
- `next.config.ts` li include nella traccia della sola route (`outputFileTracingIncludes` per `/partner/lookbook/[code]`).
- Ogni file resta sotto 4 MB: il limite delle risposte Vercel è 4,5 MB (`src/lib/partner/lookbook.test.ts`).
- Nuova versione di un lookbook: sostituire il file con lo stesso nome, aggiornare la dimensione in `PARTNER_LOOKBOOK_BYTES` (`src/lib/partner/lookbook.ts`; il test la confronta con il file), controllare che resti sotto 4 MB, poi pull request come ogni modifica.

## Privacy

- Nessun recapito o testo in `audit_logs`, che è append-only (sopra). Il registro non copia recapiti; le ricevute conservano solo l'impronta del payload e il risultato (id, versioni, contatori).
- I recapiti escono dal database solo verso i membri, sotto RLS. La lista di `/partner` legge dei recapiti solo valore pulito ed etichetta; il testo intero arriva solo nel dettaglio.
- Il generatore non stampa recapiti né testi. I `.sql` generati contengono tutti i recapiti: restano in `.private/` (ignorata da git) solo il tempo dell'import, poi si cancellano.
- «Cancella il dato» toglie valore, valore pulito ed etichetta del recapito, anche dalle differenze e dai destinatari («A», «Cc») dei messaggi dello stesso contatto, e gli import successivi non lo ripristinano. Nei destinatari si toglie ogni voce (separate da virgola, punto e virgola o a capo) che contiene lo stesso indirizzo, anche scritto in altro modo: maiuscole, spazi nel numero, prefisso internazionale, `www.` o `/` finale. Se lo stesso dato compare nei testi della ricerca (per esempio in «Come contattarli») o nel corpo di un messaggio, va tolto nel repository Partner: il prossimo import sostituisce `research` e gli originali.
- Fixture e test usano solo dati sintetici: domini `example.test`, numeri `+39 000 000 00xx`.
- Luca, consulente esterno, vede tutti i contatti per decisione del founder.

## GitHub Pages

Il sito Partner su GitHub Pages mostrava contatti, recapiti e messaggi a chiunque avesse il link. La spec 02 §9 chiedeva di spegnerlo del tutto, non solo di svuotarlo: è spento dal 28 ottobre 2026.

- **Perché prima del previsto.** La decisione 31 voleva prima il rilascio di P5, l'import dei file di tutti i dispositivi e la frase di Tommi «Ho esportato da tutti i dispositivi». Il 28 ottobre Tommi ha confermato che nessuno aveva usato il sito e che non c'era nessun contatto segnato: niente da esportare. Ha chiesto di spegnerlo subito.
- **Cosa è stato fatto.** `gh api -X DELETE repos/tommyieri/luckylap-partner/pages`. Il workflow «Pubblica su GitHub Pages» del repository Partner è disabilitato. Nel repository Partner, sul branch `claude/partner-nel-gestionale`, la pull request [luckylap-partner#1](https://github.com/tommyieri/luckylap-partner/pull/1) toglie `.github/workflows/pages.yml` e aggiorna `README.md`, `PRODUCT.md`, `CONTESTO.md`, `.impeccable/surfaces/site-index-html.md` e la skill `messaggi` («Rigenerare e importare nel gestionale»). Il merge è di Tommi.
- **Dopo il merge nel repository Partner.** `/partner/regole` mostra ancora il `CONTESTO.md` dell'import del 22 ottobre (commit `f6ad90c`), che parla della schermata pubblicata su GitHub Pages e dei lookbook «scaricabili dalla schermata». Il testo nuovo arriva solo con un nuovo import della ricerca (vedi «In produzione, passo per passo»). L'import scrive nel database di produzione: serve l'ok esplicito di Tommi.
- **Verifica del 28 ottobre.** Rispondono 404 la pagina, `data/partners.json`, `app.js`, gli stili, i font e i cinque lookbook, anche con la cache saltata. La CDN ha servito le copie in cache per circa dieci minuti dopo lo spegnimento. Anche `gh api repos/tommyieri/luckylap-partner/pages` risponde 404. Il repository è privato (`gh repo view tommyieri/luckylap-partner --json visibility`).
- **Non riaccenderlo.** Tornerebbe a mostrare contatti e recapiti a chiunque abbia il link. Il repository Partner resta privato e intero, come laboratorio della ricerca (vedi «Import della ricerca»).

## Test

Le verifiche della nuova interfaccia coprono la proiezione di fasi, esiti e assegnazioni, i filtri e i collegamenti precedenti, l’origine delle voci del calendario e i calcoli di Andamento. I test della guida verificano i nomi delle viste, il Programma email e i comandi della scheda. L’anteprima locale usa contatti sintetici e scritture disattivate.

- **Vitest** (`npm test`): 168 test in 14 file; la suite passa da 948 a 1116.
  - `src/lib/partner/`: `periods` (11), `filters` (15), `model` (15), `contacts` (16), `device-file` (23), `lookbook` (7), `commands` (21), `pending` (6), `read` (8, anteprima compresa), `rules` (3), `server` (18).
  - `src/app/(workspace)/partner/`: `actions.test.ts` (6), `lookbook/[code]/route.test.ts` (5).
  - `src/components/partner/partner-workspace.test.tsx` (14, con `/partner/dati`).
- **PGlite** `supabase/tests/partner.mjs`, registrato con la riga `// test-db: pglite minimo 343`: 343 controlli in cinque gruppi, ognuno su un database nuovo con i dati sintetici di `supabase/tests/fixtures/partner/` (repository Partner finto con sei contatti, più due file «Esporta»):
  1. schema e sicurezza: RLS, grant, funzioni e `search_path`, tabelle append-only, esterni e inattivi senza accesso;
  2. import della ricerca: CO in ordine, ripetizione, lotti mancanti o diversi, confronto a tre vie, recapiti, varianti, contatti usciti e tornati, audit senza recapiti né testi;
  3. comandi del team: versioni, ricevute, conflitti, stati, registro con una sola riga per contatto e operazione;
  4. file dei dispositivi: anteprima senza scritture, regole su stati, testi e approcci, ripetizione;
  5. generatore: lotti, limiti, errori, e la riga di comando su un repository git usa e getta, con stdout senza recapiti.
- Nessun harness su PostgreSQL reale: i casi critici sono garantiti da vincoli, versioni e ricevute (spec 02 §1, punto 8).

## Scelte rispetto alla spec 02

Correzioni di 00-sequenza §5 e scelte di questa tappa:

- Migrazione `20261022215908_partner_module.sql` (02-1): il nome nasceva come `20261022200000` e ha preso la versione cloud dopo l'applicazione (00-sequenza §1.3); l'harness la cerca per suffisso.
- Lookbook senza Storage (02-2): niente bucket, policy, tabella `partner_lookbooks`, `register_partner_lookbook`, caricamento in `/partner/dati` né attività `lookbook`. I PDF stanno nel repository; la route risponde 200 con il file invece di 303 verso un link firmato. Le tabelle pubbliche sono 9 e `partner_activities.partner_id` è `not null` (02-3).
- `private.apply_partner_stage` con `p_operation_id` obbligatorio e `p_log` (02-4).
- Generatore con `--batch-bytes` al posto dei lotti da 20 contatti; `draft` non importato (02-9).
- `normalized_sha256` è lo SHA-256 dei dati normalizzati (intestazione, `CONTESTO.md` e contatti), non della concatenazione degli SHA-256 dei lotti: ogni lotto contiene `normalized_sha256`, quindi quella definizione sarebbe circolare. L'integrità dei lotti resta garantita: `apply_partner_research` confronta lo SHA-256 di ogni lotto con l'elenco del file apply.
- Una ricevuta riusata da un altro comando o da un altro utente dà `23505`, come un payload diverso.
- Codici d'errore in più per casi che la spec non nomina (`partner_owner_inactive`, `partner_contact_erased`, `partner_message_no_original`, `partner_difference_closed`, `partner_domain_unavailable`, `partner_not_blocked`, `partner_co_exhausted`, e per l'import `partner_batch_altered`), tutti `22023` con un testo italiano.
- Minimo dell'harness 343, il numero reale dei controlli (regola del runner), al posto di 155 (02-13); senza il gruppo Storage.
- Barra dei periodi con `--ws-sticky-top` (02-6); casella CO in `src/components/partner/` (02-7); titoli «Partner», «Dati Partner», «Regole per scrivere» (02-5); riga del piede letta dal database (02-12).

## Lettura dell’elenco

Nel confronto con le sei schede sintetiche del test server, lo snapshot della lista passa da 13 a 12 letture e da 15.383 a 13.228 byte di JSON. La misura esclude dettaglio, stato generale dell’assistente e previsioni. I corpi delle risposte e l’indice delle varianti sono letti nella scheda. Il Programma email calcola le stime sulla coda intera e le consegna alla pagina quando sono pronte.

## Oggi, solleciti ed esiti

Correzioni del 23 ottobre 2026 ai collegamenti di P5 ([verifiche](verification.md), «Problemi noti dopo P4-P6», punti 5, 6, 7, 8 e 11). Migrazione additiva `supabase/migrations/20261023140414_partner_oggi_fixes.sql`.

- **Contatti da fare in Oggi** (`private.partner_today`, decisione 33): la regola di «Adesso». Mese pianificato (mese della prossima azione, altrimenti mese di contatto) entro il mese prossimo e stato «Da contattare», più i contatti non chiusi e non «Non interessato» con la prossima azione di oggi o già passata. Fuori i contatti da non contattare e quelli tolti dalla ricerca. La stessa regola in TypeScript è `partnerDueToday` (`src/lib/partner/periods.ts`, con `partnerPeriod`). I contatti sintetici di `supabase/tests/fixtures/partner-today/adesso.json` danno 7 sia in `read_partner_today` (harness `partner-oggi-fixes.mjs`) sia in `partnerDueToday` (`periods.test.ts`). Il confronto precedente con 11 contatti si riferiva alla vista «Tutti i contatti» della Tappa 1 con periodo «Adesso» e stato «Da fare».
- **Solleciti in Oggi**: solo in «Contatti e solleciti», non più anche in «Agenda» (decisione 9, 05-11). L'agenda legge `partner_work_links` (`kind = 'follow_up'`) per le sue attività e toglie i solleciti (`src/lib/today/server.ts`). Ogni sollecito ha «Ha risposto» (`src/components/today/today-reply-button.tsx`): chiama `recordPartnerActivity` con `kind = 'risposta'`, il trigger chiude il sollecito, poi «Risposta registrata. Sollecito chiuso.». Esito incerto: «Verifica lo stesso invio», con lo stesso `operation_id` in `sessionStorage` (chiave `luckylap.partner.pending:<utente>:oggi-risposta-…`, che `/partner` ritrova). I comandi Partner che aprono o chiudono solleciti rileggono anche `/` e `/team`.
- **Prime email dell'assistente** (consegna 2a, migrazione `_assistente_partner_invio.sql`, [partner-assistente.md](partner-assistente.md)): quando l'assistente manda una prima email vera, la scheda passa a «Scritto» (chiave `contattato`) e il registro ha una riga `inviato` con origine `assistente`, canale email, autore il profilo dell'assistente. Il trigger dei solleciti accetta anche questa origine: nasce «Sollecito · <nome>» a 7 giorni, come dopo «Segna inviato», assegnato a Tommi (`handoff_to` della configurazione dell'assistente), con l'assistente come autore del compito e del collegamento. Il sollecito lo manda Tommi: lo trova nella sua Oggi, in «Contatti e solleciti», lo scrive partendo dalla «Bozza dell'email» mandata (finché non lo farà l'assistente, consegna 2b) e lo segna con «Segna sollecito inviato» nel Registro. Per «invio o risposta più recente» l'origine `assistente` conta come `team`; le regole di chiusura non cambiano. «Segna inviato» chiede conferma anche dopo un invio dell'assistente degli ultimi 10 minuti, con «dall'assistente» al posto del nome. Le prove dell'assistente non toccano la scheda né il registro.
- **Data nella conferma**: dopo «Segna inviato» e «Segna sollecito inviato» il server rilegge il sollecito nato da quell'attività (`src/lib/partner/follow-up.ts`) e aggiunge «Sollecito per te giovedì 29 ottobre.». Senza sollecito (contatto chiuso o da non contattare) o con la lettura non riuscita, la conferma resta quella, senza data.
- **Accordo fatto e lavoro del team**. «Apri in Partner nel Team» nella scheda In breve porta a `/team/partner?co=N` con il contatto già scelto (`partnerTeamWorkHref` in `src/lib/partner/links.ts`). Da lì si crea un evento in calendario, un progetto per Produzione o un’attività per aprire un conto vendita.
- **«Collega l'evento» con date passate**: vedi «Accordo fatto e calendario».

## Collegamenti con le altre tappe

- **P5, Collegamenti e Oggi.** Usa `partners`, `partner_activities` (anche le righe `origin = 'file'`), `private.partner_blocked`, `private.apply_partner_stage` con quattro argomenti, `partnerHref({ co })` e la Server Action `recordPartnerActivity`, a cui aggiunge la data del sollecito. Il trigger dei solleciti e il riquadro di Oggi sono suoi.
- **P6, Controllo CEO.** Le tabelle Partner scrivono l'audit con `private.audit_change_keys`, non con `private.audit_change`: il controllo di copertura deve riconoscere entrambi. `record_key` porta `partner_id` e `variant_id`. Frasi da spec 02 §10, link con `partnerHref({ co })`.
- **P7.** Ha scritto qui gli esiti dell'import in produzione («Esiti in produzione»).
