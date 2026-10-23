# Layout condiviso e navigazione

Tutte le pagine per i membri hanno lo stesso guscio: barra laterale verde sul desktop, fascia verde e barra in basso sul telefono, schede in alto quando una sezione ha più pagine. Questo documento descrive come è fatto e le regole per chi aggiunge pagine.

## Gruppo di route

- Le pagine per i membri stanno in `src/app/(workspace)/`. Le parentesi non entrano negli URL: `src/app/(workspace)/sales/page.tsx` risponde su `/sales`.
- Il gruppo ha un solo layout, `src/app/(workspace)/layout.tsx`, che delega a `WorkspaceFrame` (`src/components/workspace-frame.tsx`). Il layout radice `src/app/layout.tsx` tiene `html`, `body`, il modello dei titoli («%s · LuckyLap») e il `viewport` con `viewportFit: "cover"`, che rende disponibili le `env(safe-area-inset-*)`. `<html>` ha `data-scroll-behavior="smooth"`: Next 16 toglie lo scorrimento morbido di `globals.css` solo durante i cambi di pagina, così la pagina nuova parte subito dalla cima con la fascia verde in vista; le ancore nella stessa pagina restano morbide.
- Restano **fuori** dal gruppo:
  - `/auth/login` e `/auth/confirm`, per chi non è ancora entrato, con `AuthShell`;
  - le route `/api/integrations/shopify/*` e i download `/assets/files/[id]` e `/finance/documents/[id]` (`route.ts` non usa layout);
  - tutte le `actions.ts`, che restano nei percorsi di prima (`src/app/sales/actions.ts`, `src/app/team/actions.ts`…): componenti e test le importano per percorso. Una cartella con solo `actions.ts` non è una route, quindi non c'è conflitto di URL.
- `loading.tsx`, `error.tsx` e `not-found.tsx` del gruppo si vedono dentro il guscio: il menu resta. Le versioni radice (`src/app/loading.tsx`, `error.tsx`, `not-found.tsx`, `global-error.tsx`) coprono ciò che sta fuori dal gruppo. Next precarica su ogni pagina il CSS dei confini radice: per questo `AuthShell` e le pagine radice `not-found` ed `error` usano solo le classi `.setup-*` di `globals.css`, senza moduli CSS (lo controlla `workspace-routes.test.ts`). Tutte in italiano. Le pagine di errore hanno «Riprova» e «Vai a Oggi» (verso `/`) e mostrano solo il `digest` («Codice per Tommi: …»), mai `error.message`. `error.tsx` riceve `retry` (Next 16.4), non `reset`.

### Il guscio non è un cancello

- `WorkspaceFrame` non fa `await` in cima: legge l'accesso per il menu dentro tre `Suspense` (barra laterale, schede e barra in basso), così il contenuto non aspetta il menu. Finché la lettura non arriva, il menu mostra le cinque sezioni aperte a tutti e nessun piede, e le schede compaiono solo per quelle sezioni.
- I layout non si ricaricano tra una pagina e l'altra e non fermano i segmenti figli. Per questo **ogni pagina verifica da sola** sessione, membership e password d'area. Il menu è solo una guida: l'autorità resta nelle pagine e nella RLS.
- `src/lib/auth/current-member.ts`: `currentMember()` fa una sola verifica per richiesta (`cache` di React) e torna `preview`, `unconfigured`, `signed-out`, `denied`, `unavailable` oppure `member` con membro e client Supabase. `requireMember()` fa lo stesso e porta a `/auth/login` solo se manca la sessione. Li usano il menu (`readNavAccess` in `src/lib/navigation-server.ts`, che passa al client solo nome e permessi) e le pagine nuove: Oggi, `/stock`, `/partner`.
- **Risposte HTTP.** Con `loading.tsx` (del gruppo e radice) la risposta parte subito in streaming e lo stato 200 è già inviato quando la pagina decide. Per questo il `redirect("/auth/login")` di una pagina senza sessione e `notFound()` (per esempio `/auth/area/xyz`) arrivano dentro il flusso, non come 307 o 404 (guida Next «loading», «Status codes»): il router del browser porta al login o mostra «Pagina non trovata.»; senza JavaScript un `<meta http-equiv="refresh">` porta a `/auth/login`. Prima del controllo arrivano solo il guscio vuoto e «Caricamento…», nessun dato; la pagina inesistente ha `noindex`. Per un controllo da fuori, per esempio dopo un deploy, non aspettarti un 307: la risposta di `/` senza cookie contiene `NEXT_REDIRECT;replace;/auth/login` e il meta refresh, oppure si apre l'indirizzo in un browser e si controlla che arrivi su `/auth/login`. Un 307 vero richiederebbe un redirect nel proxy, che questa tappa lascia alle pagine.
- I link di menu e schede hanno `prefetch={false}`: ogni prefetch passerebbe dal proxy, che chiama Supabase Auth. `loading.tsx` dà comunque un riscontro immediato al tocco.

## Mappa delle sezioni

Una sola fonte: `src/lib/navigation.ts`, funzioni pure senza React né icone.

| Sezione | Link | Schede | Chi la vede | Telefono |
| --- | --- | --- | --- | --- |
| Oggi | `/` | — | tutti | barra |
| Vendite | `/sales` | Ordini `/sales`, Conto vendita `/consignment` | tutti | barra |
| Magazzino | `/stock` | Giacenze `/stock`, Rettifiche `/stock/rettifiche`, Conto vendita `/stock/conto-vendita`, Riassortimento `/stock/riassortimento`, Packaging `/packaging` | tutti | barra |
| Partner | `/partner` | — | tutti | barra |
| Team | `/team` | Calendario e attività `/team`, Nuovi prodotti `/development`, Grafica e foto `/assets` | tutti | «Altro» |
| Finance | `/finance` | Panoramica `/finance`, Registrazioni `/finance/work`, Documenti `/finance/documents` | tutti | «Altro» |
| Controllo CEO | `/audit` | — | tutti | «Altro» |

- Fuori dalle sezioni (`ACCOUNT_LINKS`): «Come si usa» (`/guida`), «Account e sicurezza» (`/auth/account`, accesa anche da `/auth/password` e `/auth/verify`) ed «Esci». Sul desktop stanno nel piede della barra laterale, sul telefono in «Altro». Ogni voce ha un nome breve (`band`) per la fascia verde del telefono: «Come si usa» e «Account».
- Tutti i membri vedono le sette sezioni, comprese Finance e Controllo CEO con il lucchetto. Le schede Finance compaiono anche prima dell’apertura dell’area; pagine, RPC e RLS richiedono la password corretta nella sessione corrente. In anteprima locale 7; senza sessione o con account non abilitato nessuna; con verifica in corso o non riuscita le 5 aperte a tutti.
- **Prefisso più lungo.** Un `href` combacia se il percorso è uguale o continua con `/`; `/` combacia solo con `/`. Vince l'`href` più lungo tra schede, sezioni e `also`. Così `/stock/rettifiche` accende Rettifiche, `/stock/conto-vendita/NEG01/conta` accende Conto vendita di Magazzino, `/consignment/NEG01` quello di Vendite e `/sales-old` non accende niente.
- **Conto vendita in due sezioni.** Le due schede hanno lo stesso nome e `href` diversi: in Vendite `/consignment` (vendite del negozio, resoconto mensile, fattura e pagamenti), in Magazzino `/stock/conto-vendita` (magliette in negozio, conta, ordini e consegne, impostazioni). Le schede di Magazzino mettono prima le magliette (Giacenze e Rettifiche del Magadzino, Conto vendita, Riassortimento) e in fondo il materiale per spedire (Packaging). Vedi [Conto vendita](consignment.md), «Pagine».
- `also`: percorsi senza scheda che accendono la sezione. Finance ha `/auth/area/finance`, Controllo CEO `/auth/area/audit`.
- Ogni `href` compare una volta sola. L'`href` di una sezione con schede è la sua prima scheda. Le schede compaiono solo con almeno due pagine.
- Ordine fisso. Finance e Controllo CEO stanno in fondo e non spostano le altre voci.
- `aria-current`: la scheda attiva ha `"page"`; la voce di sezione ha `"page"` se la sezione non ha schede, altrimenti `"true"`.

## Struttura visiva

- **Desktop (oltre 760 px).** Barra laterale verde, ferma, larga 232 px (210 sotto 1250, 200 sotto 1000). Marchio «LuckyLap» in Barlow Condensed 700 dritto, link a `/`. Voci in Condensed 600, alte 48 px; la voce attiva è in inversione d'inchiostro, carta sul verde. Finance e Controllo CEO hanno il lucchetto, con il testo nascosto «(con password)». Nel piede: nome, «Come si usa», «Account e sicurezza», «Esci»; in anteprima «Anteprima locale · Dati solo su questo browser», «Come si usa» e «Account e sicurezza», senza «Esci».
- **Schede.** Striscia ferma in alto, alta 48 px, fondo carta e filetto d'inchiostro sotto. La scheda attiva ha il filetto d'inchiostro da 3 px. Se non ci stanno scorrono in orizzontale, e quella attiva viene portata in vista.
- **Contenuto.** `<main id="contenuto">`, largo al massimo 1280 px, margini 24 px (32 oltre 1250 px). Il collegamento «Vai al contenuto» è il primo elemento della pagina.
- **Telefono (fino a 760 px).** La barra laterale diventa una fascia verde alta 52 px con marchio e sezione attiva: scorre via con la pagina. Restano ferme solo le schede. In basso una barra fissa di 60 px più la safe area: Oggi, Vendite, Magazzino, Partner, «Altro».
- **«Altro».** Pulsante con `aria-haspopup="dialog"`; si accende quando la pagina attiva è nel foglio. Il foglio è un `dialog` nativo aperto con `showModal()`, ancorato in basso: Team, Finance e Controllo CEO se visibili, poi «Come si usa», «Account e sicurezza» ed «Esci». Si chiude con Esc, con un tocco sullo sfondo, con «Chiudi» e a ogni cambio di pagina; il focus torna su «Altro».
- **Tastiera aperta.** Mentre un campo ha il focus la barra in basso si nasconde, così non copre il campo.
- La barra in basso sta dopo `main` nel DOM: con la tastiera si arriva prima al contenuto. In stampa menu, schede e barra in basso sono nascosti.
- Scala z-index: schede 10, barra laterale 20, barra in basso 30, barre fisse delle pagine 35, toast 40. I `dialog` stanno nel top layer.

## Regole per le pagine nuove

- Ogni pagina per i membri va in `src/app/(workspace)/…`. I file nuovi (per esempio `actions.ts` di una pagina nuova) stanno accanto alla pagina, dentro il gruppo. Le `actions.ts` e `route.ts` esistenti non si spostano.
- La pagina deve essere raggiunta dalla mappa di `src/lib/navigation.ts`: come sezione, come scheda, in `also`, oppure perché continua un `href` già presente (`/stock/conto-vendita/NEG01` accende già Conto vendita di Magazzino, senza nessuna voce nuova).
- Se apre un nuovo primo segmento di URL, va nel `matcher` di `src/proxy.ts`.
- Niente testata propria, niente link indietro («Torna al workspace»), niente collegamento di salto, niente `<main>`: li ha il guscio. Niente `AuthShell` dentro il gruppo.
- Stati (configurazione mancante, accesso negato, area chiusa, errore) con `WorkspacePanel` (`src/components/workspace-panel.tsx`): titolo, testo, azioni in `PanelActions`, `tone="warning"` per gli avvisi. «Riprova» con `RefreshButton`. Le pagine che usano `requireMember()` hanno gli stati comuni in `AccessPanel`. Nei pannelli, «Esci» compare solo nello stato «Account non abilitato»: per tutto il resto è nel menu.
- Titoli: `metadata.title` è solo il nome della voce («Partner»), il modello aggiunge « · LuckyLap». L'`h1` è il nome della sezione sulla sua prima pagina e il nome della scheda sulle altre; sulle pagine fuori dalle schede è uguale a `metadata.title` («Password», «Apri Finance»). Niente sopratitoli in maiuscolo.
- Una pagina del gruppo che chiama `notFound()` restituisce `title: "Pagina non trovata"` da `generateMetadata` per quel caso, come `/auth/area/[area]`: il `not-found.tsx` del gruppo non può esportare metadati, e senza titolo il browser direbbe «LuckyLap · Gestionale».
- Righe e liste con `src/components/roadbook.module.css`: colonna di controllo a sinistra (ora, giorno o numero in Condensed), casella verde piena solo per «adesso», ambra per il ritardo, verde chiaro per il fatto.
- Invii dall'esito incerto con `src/components/pending-attempt.tsx`: data italiana all'ora di Roma, righe leggibili, codice tecnico solo in «Codice per l’assistenza», «Scarta» solo per i tentativi che non potranno riuscire (illeggibili o in conflitto). Per questi la verifica non compare: il riquadro dice che il tentativo non si ripete e «Scarta questo tentativo» è l'azione principale, sempre con la conferma in linea.
- Una cartella del gruppo può avere i suoi `loading.tsx`, `error.tsx` e `not-found.tsx`: si vedono dentro il guscio.

## La guida «Come si usa»

`/guida` (`src/app/(workspace)/guida/page.tsx`) è la guida breve per i cinque del team, in nove parti: entrare e uscire, Oggi, il menu, le operazioni più comuni, Partner, conto vendita e resoconto del mese, Finance e Controllo CEO, telefono, cosa fare se qualcosa non va e a chi chiedere. Non è un'ottava sezione: sta in `ACCOUNT_LINKS`, prima di «Account e sicurezza». Su Oggi il riquadro «Prima volta qui?» (`src/components/today/guide-intro.tsx`) porta qui; «Ho capito» lo chiude e la scelta resta nel browser (chiave `luckylap-guida-vista-v1:<id utente>`, letta e scritta dentro `try/catch`: senza storage il riquadro torna alla visita dopo).

- Il testo è fisso, in `src/components/guide-view.tsx`, e descrive l'app com'è oggi, con i nomi veri di sezioni, schede e pulsanti. Quando una pagina cambia nome, scopo o pulsanti, si aggiorna anche la guida.
- «Oggi» elenca i riquadri con i loro titoli veri (`TODAY_TILES`): Agenda, Contatti e solleciti, Ordini da preparare, Magazzino e, solo per chi può aprire Finance, Conto vendita da regolare, come in `today-sheet.tsx`.
- «Il menu» elenca le sezioni che la persona vede (`visibleSections`), con una frase per sezione (`SECTION_TEXT`) e per scheda (`TAB_TEXT`). Una sezione o una scheda nuova della mappa senza la sua frase fa fallire `guide-view.test.tsx`.
- «Le operazioni più comuni» (`OPERATIONS`) unisce i punti 3 e 4 della spec 06: una riga per operazione, con il link alla pagina, i nomi veri dei pulsanti e chi la fa di solito («di solito Ettore»). Al posto di un riquadro per persona: così ognuno trova il suo lavoro nello stesso elenco. Quando cambia il nome di un pulsante citato, si aggiorna anche questa riga.
- «Parole che trovi spesso» usa i nomi delle colonne di Giacenze e Rettifiche: Fisico, Riservato, Disponibile.
- Partner: «Segna inviato» e «Segna sollecito inviato» creano un sollecito a 7 giorni per chi ha inviato, solo per gli invii segnati nell'app (il trigger di `20261023091627_partner_work_links.sql` guarda solo `origin = 'team'`); le date Partner entrano nel calendario; «Partner nel Team» (`/team/partner`).
- Finance e Controllo CEO: tutti leggono cosa sono e chi li apre. Il riquadro «Aprire e chiudere Finance», con i link a `/auth/area/finance` e `/auth/area/audit`, compare per tutti i membri; ogni area richiede la propria password. Dentro: «Chiudi Finance» in cima alle pagine Finance, «Correggere un movimento» («Modifica / storico», motivazione, storico, «Eliminati · recuperabili») e i filtri del feed e «Chiudi Controllo CEO», dopo l’apertura dell’area.
- La guida cita pulsanti e riquadri di altre pagine. `guide-view.test.tsx` («i nomi citati esistono davvero») legge i componenti e la migrazione dei solleciti: se un nome citato cambia, il test fallisce e la guida si aggiorna insieme.
- Il magazzino centrale si chiama «Magadzino» anche nella guida; «Magazzino» è la sezione.
- Telefono: indice in cima su due colonne, parti una sotto l'altra. Computer: indice fermo a destra. Testo a 16 px, righe al massimo di 72 caratteri.

## Token e caratteri

I token stanno in `:root` di `src/app/globals.css`. Nessun modulo CSS li ridichiara.

- **Colori.** Carta `--paper`, inchiostro `--ink` e `--ink-2`, grigio `--muted`, filetti `--rule` e `--rule-soft`, fondo `--tint`. Verde racing `--green` (con `--green-2`, `--green-dark`, `--green-wash`), testo su verde `--on-green` e `--on-green-2`. Ambra `--amber` e `--amber-wash`, rosso `--red`.
- **Uso del colore.** Verde pieno solo per la testata (barra laterale e fascia), per ciò che è **adesso** e per ciò che è **fatto**. Altrove il verde è testo, filetto, anello di focus o `--green-wash`; le selezioni sono in inversione d'inchiostro, come il pulsante principale. Ambra solo per tempo e attenzione. Rosso solo per errori e impossibilità.
- **Caratteri.** `--f-body`: Barlow (TTF 400–700) per frasi e per tutto ciò che si preme. `--f-cond`: Barlow Condensed dritto (woff2 500, 600, 700, latin e latin-ext, presi dal roadbook Partner; fonti e impronte in `public/fonts/SOURCES.txt`) per nomi, numeri, codici, etichette, titoli, schede e voci di menu. Utility `.num` (Condensed 600, cifre tabellari) per quantità, importi, date, ore e SKU; `.label` per le etichette brevi.
- **Scala del testo.** `--text-xs` 12, `--text-sm` 14, `--text-md` 16, `--text-lg` 18, `--text-xl` 24 px, `--text-title` per l'`h1` di pagina (`clamp(28px, 4.2vw, 38px)`, Condensed 700).
- **Minimi.** Testo mai sotto 12 px; testo corrente e descrizioni a 16 px; campi (`input`, `select`, `textarea`) a 16 px a ogni larghezza, così iOS non ingrandisce la pagina; bersagli da 44 px (`--tap`): `.button` ha `min-height` e `min-width` da 44 px, così anche un'etichetta corta («Oggi») resta un bersaglio pieno. A 16 px una tendina non deve tagliare le sue opzioni: sotto 980 px i filtri del magazzino stanno almeno a 220 px, uno per riga se non ci stanno in due.
- **Forme.** Righe e pannelli quadrati (`--radius` è 0), 2 px solo ai controlli (`--radius-control`), 50% per pallini di stato e campioni colore.
- **Misure del guscio.** `--sidebar-width`, `--topband-h` 52, `--tabs-h` 48, `--bottombar-h` 60 px; margini laterali `--gutter` e `--gutter-r` (almeno 16 px, rispettano la safe area).
- **Movimento.** Colori in 160 ms, foglio «Altro» in 260 ms, tutto con `--ease`. Con `prefers-reduced-motion: reduce` niente animazioni né transizioni.
- **Superfici del browser.** Focus verde da 2 px con scarto di 2 px (bianco sulle testate verdi), selezione verde con testo bianco, barra di scorrimento sottile color `--rule`, cursore di testo verde.

## Barre fisse: `--ws-fixed-bottom` e `--ws-sticky-top`

- **In basso.** Ogni barra fissa in basso di una pagina (per esempio il resoconto del conto vendita o un editor) usa `bottom: var(--ws-fixed-bottom)` e z-index 35. Sul desktop vale 0. Sul telefono vale l'altezza della barra di navigazione più la safe area, così la barra della pagina sta sopra il menu; con un campo a fuoco torna a 0, insieme alla barra di navigazione che si nasconde. `main` ha già in fondo lo spazio `var(--ws-fixed-bottom)` più 24 px.
- **In alto.** Ogni barra `sticky` in alto di una pagina usa `top: var(--ws-sticky-top)`. Vale 0 senza schede e `var(--tabs-h)` quando la sezione ha le schede: la barra della pagina si ferma sotto di esse. Le ancore (`/team#calendario`) non finiscono sotto le schede.
- Pannelli a tutto schermo sul telefono: `dialog` nativo oppure z-index sopra 30.

## Anteprima locale

Con `npm run dev` l'anteprima locale (`isLocalPreviewEnabled()` in `src/lib/runtime.ts`, sempre spenta su Vercel e con `NODE_ENV=production`) non chiama Supabase.

| Dove | Con anteprima locale |
| --- | --- |
| Menu | Tutte e 7 le sezioni, piede «Anteprima locale · Dati solo su questo browser» con «Come si usa» e «Account e sicurezza», niente «Esci». |
| `/` | Avviso «Anteprima locale: Oggi legge solo dal database.», riquadro «Prima volta qui?» (chiave `luckylap-guida-vista-v1:anteprima`) e riquadri «Non disponibile nell’anteprima locale.». Nessuna lettura. |
| `/stock` | Giacenze dallo snapshot `data/inventory-source.json`, con dettaglio prodotto ed export CSV; «Magliette disponibili» con i numeri sintetici di `src/lib/inventory/tshirt-fixtures.ts` (F40 a zero), detti nella pagina. |
| `/stock/riassortimento` | Riordini sintetici di `src/lib/restock/fixtures.ts` (uno per ogni momento: discussione, «Da Antonella», arrivato con la consegna al negozio da fare, consegnato), salvataggio disattivato. |
| `/team` | Calendario a mese, attività e note sintetici di `src/lib/team/fixtures.ts`, con l'avviso «Anteprima locale: dati sintetici, salvataggio disattivato.». Le Server Action rispondono «Anteprima locale: salvataggio disattivato.» senza chiamare Supabase. |
| `/guida` | La guida come la vede Tommi, con l'avviso «Anteprima locale: la guida come la vede Tommi, con Finance e Controllo CEO.». |
| Altre pagine | Senza configurazione Supabase mostrano lo stato «da collegare», dentro il guscio. |

## Test di guardia

Girano con `npm test`, senza browser:

- `src/lib/navigation.test.ts`: forma della mappa (al massimo 7 sezioni, nessun doppione, 4 sezioni nella barra in basso), voci per ruolo e `finance_access` uguali a `isSensitiveAreaEligible`, `locate` sui percorsi di tutte le pagine, `mobileSplit`.
- `src/components/workspace-nav.test.tsx`: barra laterale, barra in basso e schede per percorso e per stato di accesso (`aria-current`, voci nascoste, piede, «Altro» con `aria-haspopup="dialog"`, nessun link esterno nel menu).
- `src/lib/workspace-routes.test.ts`: ogni `page.tsx` sta nel gruppo, tranne login e conferma; ogni voce della mappa ha la sua pagina; nessun link indietro nelle pagine e nei componenti; nessun `AuthShell` nelle pagine del gruppo; `AuthShell` e le pagine radice `not-found` ed `error` senza moduli CSS; `<main>` solo nel guscio e in `AuthShell`, «Vai al contenuto» solo nel guscio; le ancore statiche (`evento-`, `attivita-`, `nota-` in Team, `contenuto-` in Grafica e foto, `progetto-` in Nuovi prodotti) esistono una volta sola.
- `src/proxy.test.ts`: ogni primo segmento con una pagina, tolti i gruppi `(…)`, è nel `matcher`; anche `/`.
- `src/components/guide-view.test.tsx` e `src/app/(workspace)/guida/page.test.tsx`: le nove parti della guida, i riquadri di Oggi (il conto vendita solo per Finance), una frase per ogni sezione e scheda della mappa, una riga e un link per ogni operazione comune, il riquadro Finance solo a chi può entrare, i nomi citati presenti nei loro componenti, niente parole tecniche, anteprima spenta con `VERCEL=1` e `NODE_ENV=production`.
- `src/lib/design-floor.test.ts`: in tutti i `.css` di `src` nessun testo sotto 12 px, campi a 16 px, angoli ammessi, token dichiarati solo in `globals.css`, i sei `@font-face` di Barlow Condensed con i file in `public/fonts`, `.button` (altezza e larghezza minime) e `.icon-button` da 44 px, numeri e codici in Condensed.
- `src/app/error-pages.test.tsx`, `src/components/pending-attempt.test.tsx`, `src/lib/auth/current-member.test.ts`, `src/lib/today/model.test.ts`: pagine di errore, invii da verificare, accesso corrente e regole di Oggi.

## Harness SQL nuovi

Un harness nuovo in `supabase/tests` si registra da solo, con una riga tra le prime 10 del file: `// test-db: pglite minimo N` oppure `// test-db: postgres minimo N` (N intero maggiore di 0). Non serve modificare `scripts/test-db.mjs`. Un file eseguibile senza riga e non elencato nel runner fa fallire `npm run test:db` («Harness non elencato»); un file elencato nel runner che ha anche la riga è un errore. Le regole complete sono nel commento in testa al runner.
