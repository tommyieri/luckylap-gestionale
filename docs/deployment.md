# Collegamento cloud LuckyLap — 21 ottobre 2026

## Destinazione

- GitHub privato: https://github.com/tommyieri/luckylap-gestionale, produzione da `main`.
- Vercel collegato al plugin: account `info@luckylap.com`, team **LuckyLap**, slug `luckylap`, ID `team_xyCg61r8Hj3dKO2xPn5I2otJ`.
- Progetto **luckylap**, ID `prj_t61F8J9JGAGhOXXItWaAGvxzp8jE`, dominio https://luckylap.vercel.app.
- Supabase **luckylap-gestionale**, ref `annvatqnllkbrtufmgnl`, organizzazione **LuckyLapCRM**, Irlanda, piano **Free**. Vercel **Hobby**. Nessun trial o abbonamento attivato.

Vercel contiene codice, due variabili pubbliche Supabase e le variabili tecniche Shopify riservate al server di produzione. Database, Auth, audit e Storage privato sono in Supabase. La chiave privata Supabase è usata soltanto dal worker tecnico isolato, insieme a Client ID/secret Shopify e bearer distinto; non raggiunge repository, browser o ambienti preview. Le richieste del team continuano a usare sessioni personali e RLS.

Il primo progetto di prova personale `luckylap-gestionale.vercel.app` non è la destinazione operativa. Non usarlo per accessi o istruzioni al team. Non è stato eliminato.

## Import e accessi

Quindici migrazioni applicate, con versioni locali identiche a quelle registrate dal cloud. Inventario: 9 prodotti, 51 SKU, 102 celle, 214 capi in Magadzino e zero in LCM; confronto esatto con la fonte Drive autorizzata. Il founder conferma nessun movimento successivo. Magadzino e LCM sono le sole sedi attive; online, POS, contanti, eventi e vendite dirette usano Magadzino. I vecchi codici di apertura restano stabili per preservare le fonti. Catalogo commerciale Shopify: 60 varianti attive, 51 mappate per SKU e 9 sticker retail separati; nessuna quantità Shopify letta o importata.

BudgetFlow: 144 righe immutabili non revisionate, un pending e due date future. Tre originali Finance e sei originali grafici sono in bucket privati, verificati per byte e SHA-256. Nessun ordine storico o movimento fisico generato dagli import.

Cinque identità personali con ruoli nel database. Il founder ha completato il primo accesso. La scelta più recente prevede password operativa comune di almeno sei caratteri, password condivisa Finance e password CEO separata, senza TOTP obbligatorio. Il founder ha completato personalmente la configurazione alle 14:04:51 UTC: tutti e cinque gli account sono confermati e le due password di area presenti, senza valori nei file o nei log. Il nuovo accesso reale del founder è stato verificato. Il server locale temporaneo è stato fermato e i vecchi file con inviti eliminati. Finance resta limitata a founder, produzione e Finance; audit al founder. Ogni sblocco è legato alla sessione Auth corrente e scade dopo otto ore. Nessuna email inviata; registrazione pubblica disabilitata.

## Avvio operativo

Vendite manuali, sconti e rettifiche stock attivi. Cutover esatto `2026-10-21T14:06:47.976341+00:00` (16:06:47 Europe/Rome). Prima dell’attivazione sono state verificate 214 unità in 102 celle, zero ordini e zero movimenti successivi all’apertura; l’operazione non ha modificato queste quantità. La conferma del founder sull’assenza di nuovi movimenti era già acquisita. La pagina reale Vendite mostra registrazione condivisa attiva e i moduli abilitati.

Packaging, conto vendita, contenuti, sviluppo e lavoro Finance sono implementati e verificati; il nuovo avanzamento è pubblicato e controllato sul dominio del team LuckyLap. Il conto vendita usa prezzo sito +10 EUR, nessuno sconto, quote commerciali 60/40 e incasso distinto dalla vendita.

Shopify: app interna LuckyLap Gestionale creata e installata, versione `luckylap-internal-1`, API 2026-10 e soli scope `read_products`, `read_orders`. Grant client credentials verificato con successo e durata di 24 ore; nessun token salvato. Credenziali permanenti configurate sul server Vercel corretto. Quindici migrazioni applicate e verificate; worker attivo dal deploy `f7b18cd`, configurazione database abilitata. Sei sottoscrizioni dell’app interna riletture senza duplicati, con soli riferimenti e date nel payload. Il controllo della finestra dal cutover ha trovato zero ordini; nessuno storico è stato importato. Scheduler Supabase ogni minuto, job proprietario postgres e destinazione fissa: primi due avvii reali riusciti, entrambi con risposta HTTP 200 e nessun timeout. Probe di sicurezza: bearer errato 401, HMAC errato 401, payload firmato non valido 400, worker autorizzato 200 con coda vuota. Nessun ordine o movimento artificiale inserito. La sede Shopify maGadzino è mappata a Magadzino per online e POS. Nessun ordine applicato nello snapshot di verifica. [Procedura](shopify-app-setup.md), [motore](shopify-ecosystem.md), [worker](shopify-worker.md).

## Pubblicazione verificata

Deploy `dpl_GCizPkhf1xFxWvnwdGZcRpPKS4aK`, commit `f7b18cd873a6d1d234aeeed8af2ccd564eb15e0b`: READY e alias `luckylap.vercel.app` confermati tramite plugin. Le dieci verifiche HTTP su inventario, Finance, packaging, conto vendita, contenuti, sviluppo, password aree e audit mostrano login anonimo con `private, no-store`; la route QA risponde 404. Nessun dato sintetico o riservato esposto.

Controllare commit, stato READY e alias con il plugin Vercel. Verificare login anonimo, `private, no-store`, route QA assenti e assenza di dati riservati nell’HTML. Poi verificare il percorso con sessione reale senza inserire movimenti di prova nel magazzino.

L’advisor del 21 ottobre dopo quindici migrazioni mantiene avvisi informativi sulle tabelle private di ricevute, outbox, code, scheduler e credenziali con RLS senza policy client intenzionalmente. Nessun grant permissivo viene aggiunto per eliminare gli [avvisi informativi](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). La [protezione contro password compromesse](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) richiede un piano superiore e non è stata attivata. [Evidenze e limiti](verification.md).

Il bearer tecnico transita nella coda pg_net: resta leggibile agli amministratori SQL/ruoli infrastrutturali, un limite documentato del provider. Il progetto esclude net dalla Data API (probe reale 406/PGRST106), non ha login SQL personalizzati e non espone wrapper pubblici verso queue o Vault. [Verifica pg_net](verifica-pg-net.md).

La connessione reale, i sei webhook e lo scheduler sono verificati. Non è stato creato un ordine fittizio sul negozio per simulare un evento commerciale: il primo ordine reale darà la prima conferma completa sul traffico di produzione. I casi non riconciliabili restano da verificare senza inventare scarichi, incassi o rientri.

Nel controllo esteso delle 15:10 UTC risultano 11 avvii Cron riusciti, con 9 risposte worker HTTP 200 e 2 HTTP 503 fail closed prima della presa di qualsiasi job (claimed=0). I due tick successivi sono tornati HTTP 200; coda e ordini sono rimasti vuoti. Il recupero al minuto successivo è attivo; questi episodi non vengono presentati come sincronizzazioni completate.
