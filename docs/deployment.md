# Collegamento cloud LuckyLap — 21 ottobre 2026

## Destinazione effettiva

- GitHub privato: https://github.com/tommyieri/luckylap-gestionale, produzione da `main`.
- Vercel autorizzato dal plugin: account `info@luckylap.com`, team **LuckyLap**, slug `luckylap`, ID `team_xyCg61r8Hj3dKO2xPn5I2otJ`.
- Progetto Vercel **luckylap**, ID `prj_t61F8J9JGAGhOXXItWaAGvxzp8jE`. Dominio di progetto verificato `luckylap.vercel.app`; verificare il deploy corrente prima di comunicare l’attivazione di nuove funzionalità.
- Supabase **luckylap-gestionale**, progetto `annvatqnllkbrtufmgnl`, organizzazione **LuckyLapCRM**, regione Irlanda. Piano **Free**. Vercel è sul piano **Hobby**; nessun trial o abbonamento attivato.

Vercel contiene il codice dell’app e due sole variabili di collegamento Supabase: URL e chiave pubblicabile. Il database, Auth, l’audit e lo Storage privato rimangono in Supabase. Nessuna chiave amministrativa nel codice, nel browser o nelle variabili di Vercel.

Il primo deploy di prova è stato creato dalla sessione personale del browser prima che fosse indicato l’account brand. La destinazione operativa è esclusivamente il progetto del team LuckyLap sopra identificato. Non usare il vecchio indirizzo `luckylap-gestionale.vercel.app` per inviti o istruzioni al team. Il vecchio progetto non è stato eliminato perché è una rimozione definitiva separata.

## Dati applicati

Le cinque migrazioni locali riportano le versioni effettivamente assegnate dal tool cloud, mantenendo identici i contenuti SQL revisionati. L’import iniziale ha 9 modelli, 51 SKU e 102 celle di scorta: 214 centrali e zero in negozio. Tutte le celle sono state confrontate esattamente con la fonte autorizzata.

BudgetFlow: un batch, 144 righe immutabili, tutte `unreviewed`, con pending e date future conservati. Nessun ordine storico o movimento di scorte ricavato dai file Finance. I tre originali ricevuti sono nel bucket privato `finance-documents`; ogni download è stato confrontato byte per byte con il file locale e con il suo SHA-256. Catalogo documenti e download richiedono Finance + MFA e usano la sessione dell’utente.

Cinque account personali predisposti senza password o email inviate. I ruoli sono nel database, non nei metadati modificabili dell’utente. Finance è concessa solo a founder, Gabriele e Gherardo; audit solo al founder; entrambe richiedono `aal2`. Registrazione pubblica disabilitata, verificata anche tramite `/auth/v1/settings`.

## Avvio operativo

Il nucleo vendite è applicato, ma `manual_sales_enabled=false` e `sales_started_at=null`: nessuna vendita reale è stata registrata. La conferma della data di apertura e degli ordini eventualmente già inclusi nello stock è necessaria per evitare doppi scarichi. Shopify rimane da collegare tramite una credenziale applicativa permanente: il plugin dell’assistente non fornisce automaticamente tale credenziale al gestionale.

Gli inviti non sono stati inviati. Il server email standard Supabase ha limiti di destinatari e frequenza: configurare un mittente esistente o scegliere esplicitamente la distribuzione dei link personali prima di usare l’onboarding con l’intero team. Non attivare provider a pagamento. I token locali di preparazione non vanno pubblicati o inseriti in Git.

## Verifiche e limiti

L’accesso anonimo REST a inventario e Finance restituisce `401 / 42501`; le pagine protette del primo deploy mostrano login e `private, no-store`. Il Security Advisor dopo le nuove migrazioni segnala solo l’assenza intenzionale di policy per due tabelle private senza grant client e la protezione password compromesse non attiva. RLS resta attiva: nessuna policy permissiva aggiunta per nascondere avvisi. Il controllo password compromesse va valutato entro le funzioni disponibili sul piano scelto, senza upgrade automatici.

I test embedded usano dati sintetici e Auth simulato; da soli non provano la concorrenza fra connessioni PostgreSQL. Le prove reali Auth/JWT/MFA sono documentate separatamente quando completate. Per i file Finance e il confronto inventario: `verifica-import-cloud.md`.
