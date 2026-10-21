# Verifica della prima versione LuckyLap

Verifica del 21 ottobre 2026. Questo documento distingue l'anteprima locale, il codice predisposto per il cloud e le prove che richiedono servizi reali.

## Inventario e vincoli

- Fonte iniziale: solo quattro schede autorizzate di LuckyLap_Gestione_inventario.xlsx. 9 modelli, 51 SKU e 102 valori di quantità confrontati con le celle salvate, senza differenze.
- Valori salvati senza ricalcolo: 214 pezzi centrali e zero nel negozio censito. Non costituiscono una conta fisica certificata. Valori mancanti distinti da zero.
- Quantità Shopify escluse; nessuna modifica a Drive, Shopify o repository Partner. Nessun ordine o scarico ricostruito dalle fonti Finance.
- Packaging: due tipologie distinte con quantità e costi da inserire. Il costo storico aggregato presente nel tracker Finance non viene ripartito o usato per inventare scorte.
- Nessun servizio a pagamento attivato o deploy effettuato. Nuovo repository GitHub privato creato e verificato tramite API.

## Applicazione locale

TypeScript, 60 test su dieci file e build Next.js finale completati con esito positivo, incluse Auth e vista Finance. La pagina principale è dinamica, non prerenderizzata con i dati dello snapshot.

Verifica in browser desktop 1440×1000 e telefono 390×844:

- Ricerca dello SKU, filtri, dettaglio prodotto con quantità/costi/listini e chiusura tramite Escape.
- Calendario interno con creazione ed eliminazione di un appuntamento di prova; nessun invito o sincronizzazione esterna.
- Nota nella prima scheda e attività nella seconda: entrambi conservati e aggiornati. Un evento storage obsoleto non ripristina una vecchia nota. Dati locali corrotti non vengono sovrascritti.
- Menu mobile, navigazione e tabella compatta: innerWidth, clientWidth, scrollWidth e visualViewport tutti a 390 px, scala 1.
- Packaging riconoscibile; Vendite senza dati e Finance senza dati reali. Nessun errore o warning nella console finale.
- Appuntamenti, attività e note di prova eliminati al termine; archivio locale vuoto.

La produzione avviata con il flag anteprima e VERCEL impostati restituisce la schermata di configurazione e non contiene SKU o riferimenti allo snapshot.

Auth e vista Finance completate nel codice: **60 test su dieci file**, typecheck e build finale verdi. `/`, `/auth/login`, `/auth/account` e `/finance` sono dinamiche. Senza configurazione, le quattro risposte di produzione non espongono lo SKU campione o dati Finance e includono `private, no-store`. Revisione indipendente Auth approvata dopo correzione del QR TOTP: il test di regressione ha osservato la doppia codifica e verifica ora l'URI nativo del SDK. Login, cookie/refresh e challenge TOTP reali rimangono da provare con Supabase configurato.

Revisione indipendente del codice approvata dopo le correzioni alla guardia e al salvataggio tra schede. Impeccable: detector eseguito una volta, zero risultati; finish review finale **ship per la prima anteprima locale**, con conferma desktop/mobile e packaging. Non equivale a un'approvazione del servizio multiutente in produzione.

## Database predisposto

La prima migrazione e l'import inventario hanno completato 207 controlli in PostgreSQL embedded PGlite, inclusa la versione con provenienza documentale completa. Ruoli, membership, MFA e claim Auth sono simulati. Verificate quantità, isolamento Finance/audit, permessi operativi, rettifiche con causale e retry idempotenti.

Non sono test reali di Supabase Auth, PostgREST, Storage, inviti email, cookie SSR o concorrenza fra connessioni. Migrazioni e import non sono stati applicati a un progetto cloud. Per i controlli residui consultare `docs/backend.md`.

## Fonti Finance ricevute successivamente

Tre originali letti senza modifica; hash invariati dopo l'estrazione. Estratti e report riservati in `.private/finance-staging/`, esclusi da Git e deploy mediante `.gitignore` e `.vercelignore`. Nessun dato reale in fixture, bundle browser, localStorage o pagina Finance dell'anteprima.

BudgetFlow: 144 righe, nessun ID nativo o duplicato esatto; un pending e due date future. COGS: codici legacy da mappare, input mancanti preservati. PDF: divergenze conservate come elementi di riconciliazione. Le somme dei movimenti non vengono presentate come saldi bancari, fatturato o utile.

Pipeline offline: **152 controlli PGlite sintetici** superati e revisione indipendente approvata. Il confronto con i byte CSV ha rilevato note multilinea appiattite nel primo staging: creato un nuovo staging fedele, preservando quello precedente e tutti gli originali. Generato SQL riservato con permessi locali 0600, senza applicazione cloud. Import owner-only, idempotenza sullo stesso file e rifiuto integrale degli export sovrapposti; nessuna riga alimenta automaticamente contabilità approvata, Vendite o scorte. Dettagli in `docs/finance-import.md`.

## Ambiente di esecuzione

La cartella Documents ha reso alcuni file temporaneamente dataless tramite sincronizzazione cloud. Per evitare falsi errori e blocchi, test, build e server locale usano una copia fuori da Documents: `/private/tmp/luckylap-preview-01a15dda`. I sorgenti modificati rimangono nel workspace e vengono copiati in modo esplicito nel runtime. La copia offline dell'inventario è stata verificata; nessuna nuova lettura o modifica del Drive per risolvere il problema locale.

## Attivazione ancora necessaria

Collegamento al progetto Supabase Free scelto, applicazione delle migrazioni dopo verifica della destinazione, import riservati, inviti ai cinque account e prove con sessioni reali. Calendario e note sono ancora locali; rettifiche e sconti hanno il contratto database ma non un flusso operativo attivo nell'interfaccia. La vista Finance richiede importazione effettiva e prove con sessioni reali; audit CEO e Storage richiedono ancora le rispettive interfacce e integrazioni. Vercel Hobby è personale non commerciale: il deploy aziendale richiede una destinazione compatibile con il vincolo di nessun abbonamento.

Vista Finance: revisione indipendente approvata e conferma visiva desktop 1440×1000 / telefono 390×844 con sole fixture sintetiche. Verificati filtro per data futura, dettaglio originale, note multilinea nella struttura accessibile, chiusura Escape, assenza di errori console e larghezza mobile 390 con scala 1. La route temporanea QA è stata rimossa; HTTP404 confermato sia in sviluppo sia nella build di produzione. Nessun bypass o dato di prova è incluso nel repository finale.
