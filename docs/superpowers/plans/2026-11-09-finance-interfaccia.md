# Finance leggibile: piano di implementazione

> Per gli agenti: eseguire il piano nel worktree dedicato, con test mirati prima dei cambiamenti e revisione indipendente finale. Metodo: esecuzione coordinata con attività delegate su file distinti; nessuna nuova conferma del progetto è necessaria dopo l'«ok costruisci» di Tommi.

**Obiettivo:** Panoramica iniziale, registro unico, inserimento e correzione diretti, grafici verificabili.

**Architettura:** conservare letture complete, RLS e comandi delle fonti. Una proiezione pura gestisce periodo, filtri e aggregati della nuova UI; gli editor esistenti diventano incorporabili in un pannello contestuale. La pagina server fornisce dati revisionati, identità e anteprima sintetica, senza nuove tabelle.

**Stack:** Next.js 16.4.2, React 19.3.1, TypeScript, CSS modules, SVG, Vitest. Nessuna nuova dipendenza.

**Specifica approvata:** [Finance: proposta di interfaccia](../specs/2026-11-09-finance-interfaccia.md).

## Vincoli globali

- Italiano; Barlow, verde racing e token di DESIGN.md. Controlli almeno 44px, campi 16px, mobile 320/390px.
- Nessuna banca/API, migrazione, produzione o chiave amministrativa. Fonti e storico immutabili; somme bigint.
- I dati senza conto rimangono separati dai totali per conto. Trasferimenti, pending, futuri ed eliminati restano distinti; niente utile, IVA o margine inventato.
- Il lavoro Partner usa già guida e relativi test: non modificarli. docs/README.md consente aggiunte limitate ai nostri documenti. La PR Finance #6 è già merged; il branch remoto residuo non è lavoro concorrente.
- Ogni worker possiede solo i file assegnati, non formatta tutto il repository e non committa. Root esegue format, controlli, commit e push al termine delle integrazioni.

## Interfacce condivise

`src/lib/finance/workspace.ts` esporta:

```ts
type FinanceView = {
  tab: "overview" | "movements" | "receivables" | "sources";
  period: "month" | "previous" | "year" | "custom" | "all";
  from: string; to: string; // giorni ISO validi, derivati dal preset
  account: string; // "" = tutti, "__unallocated" = senza conto
  query: string;
  direction: "all" | "income" | "expense" | "transfer";
  category: string;
  state: "posted" | "all" | "pending" | "future" | "unallocated" | "edited" | "deleted";
  source: "" | FinanceMovement["source"];
  batchId: string;
  movementId: string | null;
  newEntry: "income" | "expense" | null;
};
type FinanceFlowBucket = {
  key: string; label: string; from: string; to: string;
  incoming: bigint; outgoing: bigint; closing: bigint | null; count: number;
};
type FinanceSummary = {
  closing: bigint | null; asOf: string;
  incoming: bigint; outgoing: bigint; net: bigint; count: number;
  unallocatedCount: number;
  buckets: FinanceFlowBucket[];
  expenses: { category: string; cents: bigint; count: number }[];
};
parseFinanceView(params: URLSearchParams | Record<string, string | string[] | undefined>, today: string): FinanceView;
financeViewHref(view: FinanceView): string; // sempre /finance?... con valori canonici
filterFinanceMovements(rows: readonly RevisedMovement<FinanceMovement>[], view: FinanceView,
  options?: { originalById?: ReadonlyMap<string, FinanceTransaction>; deletedIds?: ReadonlySet<string> }): RevisedMovement<FinanceMovement>[];
financeWorkspaceSummary(dashboard: FinanceDashboard, view: FinanceView): FinanceSummary;
```

La summary dipende solo da periodo e conto, non da ricerca/stato del registro. Stato iniziale overview, month, tutti i conti, posted. Parametri italiani: vista, periodo, dal, al, conto, q, tipo, categoria, stato, fonte, lotto, movimento, nuovo. Saldo fino a min(fine periodo, oggi), con riporto storico; nessun saldo per conto inesistente/senza conto. I trasferimenti includono entrambe le gambe nel saldo, mai nei flussi. Bucket settimanali per intervalli brevi, mensili per anno/intervalli lunghi; ogni bucket mantiene esattamente l'intervallo per il drill-down. Ricerca importi normalizzata, testo con confronto italiano; filtri per conto vedono anche la destinazione di un trasferimento.

`FinanceMovementPanel` riceve `movement`, `actorId`, `names`, `readOnly`, `onClose`, `onDirtyChange`; legge lo storico attraverso una nuova server action `loadFinanceEditor(actorId, source, sourceId)` che riverifica sessione e area Finance prima della lettura. Esito discriminato `revision | shop_payment | unavailable`. Il pannello usa gli editor esistenti con `embedded`, `onDirtyChange` e `onSaved` facoltativi; i vecchi ingressi rimangono funzionanti.

`FinanceNewMovement` riceve `actorId`, `today`, `accounts`, `direction`, `readOnly`, `onSaved`, `onDirtyChange`. Usa `FinanceWorkForm` e `financeEntryForm` già esistenti. `onSaved` si chiama solo con ricevuta confermata; il record usa lo scope di recovery `record` esistente. Il form mantiene la conferma anti-duplicato. Salva e aggiungi un'altra è una scelta esplicita.

## Attività 1: modello di lettura e categorie

File: nuovi `src/lib/finance/workspace.ts`, `workspace.test.ts`; modifica `categories.ts` e relativo test se presente.

- [x] Test RED: default e roundtrip URL, date invalide/bisestili, periodi, importi italiani, conti origine/destinazione, fonti e categorie personalizzate, eliminati/modificati.
- [x] Implementare le interfacce sopra con aggregati bigint, nessuna scrittura o mutazione degli array. Testare saldo storico e fuori periodo, uscite lorde della categoria con entrata di rimborso, unallocated, doppie gambe, pending/future.
- [x] Etichette gruppi italiane e suggerimenti Packaging, Commissioni, Servizi e consulenze; valori storici conservati.
- [x] Verifica mirata GREEN e consegna delle firme effettive a root.

## Attività 2: scheda e correzione contestuali

File: nuovi `src/app/finance/editor-actions.ts`, relativo test, `src/components/finance/finance-movement-panel.tsx`, relativo test e CSS; modifica `finance-revision-editor.tsx`, `finance-shop-payment-editor.tsx`, `finance-revision-editor.module.css` e test editor pertinenti. Nessun altro file.

- [x] Test RED: lettura rifiutata prima delle query su area chiusa/attore cambiato, tipo/id invalido, preview senza letture; dispatch P3 distinto.
- [x] Implementare loader della scheda con controlli equivalenti alle route già esistenti; nomi solo dall'actor/snapshot autorizzati.
- [x] Rendere editor incorporabili: titolo coerente, riepilogo corrente, modifica e storico richiudibile con differenze leggibili; preservare tentativi/CAS/elimina-ripristina e limiti payment/refund.
- [x] Gestire dirty e successo con callback; pannello nativo dialog, Escape/chiusura protetti e focus restituito alla riga. Prevenire risposte tardive del loader su scheda cambiata.
- [x] GREEN mirato; nessun cambiamento alle azioni di scrittura o regole DB.

## Attività 3: nuova voce diretta

File: nuovo `src/components/finance/finance-new-movement.tsx`, test e CSS; modifica `finance-work-form.tsx` e test pertinenti. Nessun altro file.

- [x] Test RED sul modulo breve: sei campi, direzione e importo italiano, account/categoria facoltativi, nuova voce su conferma, salvataggio incerto non crea un nuovo tentativo, preview disabilitata.
- [x] Aggiungere callback opzionali di dirty/successo e controllo del testo anti-duplicato a FinanceWorkForm, preservando compatibilità dei chiamanti esistenti.
- [x] Modulo dedicato: default oggi, Uscita/Entrata, input importo, descrizione, conto e categoria; feedback vicino al campo e richiesta chiara di verifica duplicati.
- [x] «Registra e aggiungi un'altra» funziona solo dopo esito certo; GREEN mirato.

## Attività 4: navigazione, registro e panoramica

File: `finance-imports-view.tsx` diventa adattatore dei dati; nuovi componenti in `src/components/finance/` per workspace, registro, panoramica e fonti con CSS/test dedicati. Modifica pagina `/finance` e preview; compatibilità route `/finance/work` senza rimuovere i vecchi comandi.

- [x] RED sui tre ingressi e default Panoramica, azione diretta, registro a descrizione in primo piano, ricerca fuori anno, ritorno dalla scheda e deeplink, fonti consultabili.
- [x] Collegare dati revisionati e movimenti eliminati già ricostruiti dall'adattatore; query/filtri e selezione nell'URL, navigazione avanti/indietro, chiusura senza perdita della posizione. Modifiche non salvate protette.
- [x] Panoramica: tre indicatori con periodo/conti, warning contestuale senza conto, barre flussi e categorie, switch linea saldo e tabella accessibile; tutti i link grafico riproducono il sottoinsieme esatto, cancellando filtri incompatibili.
- [x] Da incassare usa il componente server esistente. Fonti e documenti hanno ingresso secondario; BudgetFlow originale e metadati consultabili, nessun campo finanziario riscritto.
- [x] Preview sintetica con entrate/uscite, storico, pending, futuri, trasferimenti e righe senza conto; nessun dato reale.
- [x] GREEN mirato, integrazione con attività 1–3 e controllo tipi.

## Attività 5: revisione e consegna

- [x] Documenti Finance, specifica e piano aggiornati; indice con sole nostre righe. Guida aggiornata solo nella parte Finance con consenso esplicito di Tommi, Partner intatto; vecchi link compatibili.
- [x] Revisione indipendente su permessi nuovi loader, somme e drill-down, recovery scritture, navigazione/dirty/mobile.
- [x] Eseguire typecheck, npm test, build, test:db, format e format:check. Ripristinare next-env.d.ts se cambia.
- [ ] Verifica UI desktop/telefono se browser disponibile; se la preferenza resta disattivata, dichiarare il limite e fornire anteprima senza aggirare l'impostazione.
- [ ] Commit formattati, push e PR con risultati e limiti; attendere check CI, nessun merge/deploy di produzione.

## Fuochi della revisione

1. Una categoria con entrate e uscite non può ridurre di nascosto il grafico delle spese lorde.
2. Un trasferimento verso il conto selezionato alimenta il saldo con il segno opposto e resta escluso dai flussi.
3. Un caricamento tardivo della scheda o un cambio account non può mostrare/salvare la voce precedente.
4. Navigazione indietro, Escape, ricarica e salvataggio devono preservare contesto e recovery senza duplicare tentativi.
5. Periodi senza dati, anni diversi, righe future/in sospeso/senza conto ed eliminati devono avere esiti distinti e verificabili.


## Stato di esecuzione

Attività 1–4 completate. Attività 5: controlli locali completati; pubblicazione e verifica CI in corso. Dettagli e revisione indipendente nel ledger locale `.superpowers/sdd/finance-interfaccia/`. La nuova voce mantiene il divieto preesistente di date future. Il guard dell’attore viene aggiunto al comando manuale prima di ogni RPC; le ricevute e i contratti DB restano invariati.

Il checkout originale Partner non è stato modificato. Le sole sezioni Finance di guida e test sono state autorizzate da Tommi e verificate rispetto alla base. Browser disabilitato: copertura dei percorsi tramite test sintetici di rendering e ciclo di vita; nessuna prova visuale interattiva dichiarata.


## Verifica locale finale (9 novembre 2026)

- `npm run typecheck`: superato.
- `npm test`: 260 file, 5.737 test superati.
- `npm run build`: superato; `next-env.d.ts` ripristinato.
- `LUCKYLAP_PG_BIN=/opt/homebrew/opt/postgresql@17/bin npm run test:db`: 61 harness superati, nessuno saltato. PGlite: 39 harness e 7.352 controlli. PostgreSQL 17: 22 harness e 2.561 controlli. Dati sintetici e cluster temporanei, nessun accesso al database di produzione.
- `npm run format` e `npm run format:check`: superati prima del commit.
- Revisione indipendente: tutti i rilievi sostanziali risolti. Test di regressione per digitazione multi-parola, eliminati legacy, range ampi, dirty e salvataggi tardivi, recovery e cambio attore.
- Browser: disabilitato nelle impostazioni, verifica interattiva desktop/telefono non eseguita.


I controlli finali sopra sono stati ripetuti dopo il rebase su `493678a` (PR #50 Partner). Le parti Partner di guida, test, indice e DESIGN sono identiche a quel main; solo Finance cambia in questa consegna.
