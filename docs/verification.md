# Verifiche LuckyLap

Stato del 21 ottobre 2026. Prove applicative, SQL sintetico, PostgreSQL concorrente e Auth cloud sono conteggiati separatamente.

## Dati reali

Supabase Free `annvatqnllkbrtufmgnl`: dodici migrazioni applicate. Inventario confrontato su tutte le 102 celle: 9 prodotti, 51 SKU, 214 capi centrali e zero nel negozio. Il founder conferma nessun nuovo movimento dall’avvio. Catalogo Shopify completo: 60 varianti attive, 51 SKU fisici mappati e 9 sticker retail separati, prezzi coerenti; nessuna quantità commerciale utilizzata come stock fisico.

BudgetFlow: 144 righe non revisionate, un pending e due date future. Tre documenti Finance e sei grafiche originali scaricati dallo Storage privato e confrontati per dimensioni, byte e SHA-256. Nessun costo attuale, scrittura approvata o vendita ricavato automaticamente dagli allegati. Drive, Shopify e repository Partner non modificati. Nessun abbonamento o trial attivato.

Ultima verifica cloud dopo la pulizia dei test: cinque membership reali, 214 capi, zero ordini, zero movimenti successivi all’apertura, zero registrazioni Finance manuali e zero operazioni conto vendita. Le credenziali sintetiche delle aree e tutti gli account QA sono stati eliminati.

## Applicazione e SQL

**723 test applicativi su 60 file, TypeScript e build Next.js completati**, inclusa compilazione TypeScript. Coprono inventario, Auth, team, audit, vendite, packaging, documenti, lavoro Finance, contenuti, sviluppo, ricevitore Shopify e conto vendita. Le pagine riservate sono dinamiche.

**1.651 controlli SQL sintetici PGlite**: schema/inventario 207, import Finance 152, vendite 445, documenti Finance 25, packaging 125, contenuti/sviluppo 109, lavoro Finance 177, catalogo Shopify 103, ricevitore Shopify 163, conto vendita 145. Auth è simulato in questi harness; questi controlli non dimostrano la concorrenza reale.

Su **PostgreSQL 17.11 reale**, processi e connessioni distinte:

- **39 controlli, sette casi concorrenti**: ultimo capo venduto una volta, UUID ripetuto senza duplicati, riserve e deficit coerenti, rettifica contro riserva, rollback e rilascio dei lock. [Evidenze](verifica-concorrenza.md).
- **161 controlli delle password di area**: sessioni reali/assenti/scadute, ruoli, nessun bypass AAL2, blocco dei tentativi concorrenti e invalidazione dei grant dopo rotazione. Cluster temporanei fermati e rimossi, nessun servizio persistente. [Contratto e prove](area-passwords-backend.md).

## Auth e isolamento cloud

**248 controlli reali Auth/REST/Storage** sul nuovo modello con password di area: sette ruoli/scenari, Finance solo per i tre ruoli autorizzati, CEO solo founder, configurazione negata ai client, documenti privati, seconda sessione dello stesso utente ancora bloccata, revoca membership immediata e grant inutilizzabile dopo logout anche con il vecchio JWT. Nessuna scrittura operativa di prova. I sette account QA sono stati cancellati e l’assenza verificata.

I precedenti 52 controlli TOTP in `verifica-auth-cloud.md` documentano il modello storico, sostituito su richiesta del founder. L’app attuale non richiede un autenticatore per Finance/CEO. Il founder ha poi configurato personalmente le tre password; cinque identità confermate, due aree configurate e nuovo login reale verificati. Nessun valore è stato letto o conservato dall’assistente.

Registrazione pubblica disabilitata, redirect Auth limitati al dominio LuckyLap. Nessuna chiave privata nel repository o frontend. Le credenziali tecniche del worker sono riservate al server Vercel di produzione; gli accessi del team usano sessione e RLS. RLS, ruolo e membership correnti restano obbligatori anche conoscendo la password di un’area. Le tabelle private senza policy client sono intenzionalmente non accessibili. Il controllo password compromesse non è stato attivato con un upgrade.

## Interfaccia e pubblicazione

QA con fixture sintetiche a 1280 e 390 px: inventario, Finance import, team/calendario, audit, vendite, rettifiche stock, packaging, contenuti, sviluppo e lavoro Finance. Round aggiuntivo: conto vendita desktop/mobile, proiezione Finance, password Finance mobile e account desktop. Nessun overflow orizzontale mobile, scala 1. Una vecchia cache dev rendeva il server Finance precedente al client: riavvio del solo dev server e verifica SSR/client hanno risolto, senza cambi ai sorgenti. Nessun nuovo errore console dopo il riavvio. Route QA rimosse con verifica 404.

Impeccable e UI UX Pro Max usati per la direzione visiva. Il detector Impeccable è stato eseguito una volta senza risultati. La prima finish review non sostituisce i controlli multiutente successivi.

Sorgenti nel workspace; esecuzione e build nella copia esplicita `/private/tmp/luckylap-preview-01a15dda` per evitare i file dataless di Documents. Nessun nuovo accesso Drive per aggirare il problema.

Destinazione: team Vercel LuckyLap, progetto `luckylap`, https://luckylap.vercel.app. Commit `6e079b1` pubblicato: stato READY, alias, login anonimo senza dati e cache privata verificati. Vendite, sconti e rettifiche attivati con cutover `2026-10-21T14:06:47.976341+00:00`; nessuna vendita reale inserita. Verificati nel browser il registro attivo con 214 capi, i sei originali grafici caricati e il redirect di Finance al proprio gate per la sessione ancora bloccata. App Shopify installata, grant verificato e segreti server configurati. Reader, worker e interfaccia sono implementati e verificati; applicazione live e scheduler restano da confermare dopo il nuovo deploy. Il backend ha superato 702 controlli su PostgreSQL reale, inclusi 445 controlli manuali preesistenti, 256 nuovi e una conferma di regressione. Le 102 celle cloud corrispondono esattamente all’apertura Drive, con 214 capi e zero ordini nello snapshot indipendente delle 14:46 UTC. [Verifica cloud Shopify](verifica-shopify-cloud.md). [Stato cloud](deployment.md).
