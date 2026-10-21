# Collegamento cloud LuckyLap — 21 ottobre 2026

## Destinazione

- GitHub privato: https://github.com/tommyieri/luckylap-gestionale, produzione da `main`.
- Vercel collegato al plugin: account `info@luckylap.com`, team **LuckyLap**, slug `luckylap`, ID `team_xyCg61r8Hj3dKO2xPn5I2otJ`.
- Progetto **luckylap**, ID `prj_t61F8J9JGAGhOXXItWaAGvxzp8jE`, dominio https://luckylap.vercel.app.
- Supabase **luckylap-gestionale**, ref `annvatqnllkbrtufmgnl`, organizzazione **LuckyLapCRM**, Irlanda, piano **Free**. Vercel **Hobby**. Nessun trial o abbonamento attivato.

Vercel contiene il codice e le due variabili pubbliche di collegamento Supabase. Database, Auth, audit e Storage privato sono in Supabase. Nessuna chiave amministrativa è nel repository, nel browser o nelle variabili Vercel. I futuri segreti del collegamento Shopify saranno esclusivamente server e richiederanno una configurazione separata; oggi il ricevitore risponde indisponibile senza tale configurazione.

Il primo progetto di prova personale `luckylap-gestionale.vercel.app` non è la destinazione operativa. Non usarlo per accessi o istruzioni al team. Non è stato eliminato.

## Import e accessi

Dodici migrazioni applicate, con versioni locali identiche a quelle registrate dal cloud. Inventario: 9 prodotti, 51 SKU, 102 celle, 214 capi centrali e zero in negozio; confronto esatto con la fonte Drive autorizzata. Il founder conferma nessun movimento successivo. Catalogo commerciale Shopify: 60 varianti attive, 51 mappate per SKU e 9 sticker retail separati; nessuna quantità Shopify letta o importata.

BudgetFlow: 144 righe immutabili non revisionate, un pending e due date future. Tre originali Finance e sei originali grafici sono in bucket privati, verificati per byte e SHA-256. Nessun ordine storico o movimento fisico generato dagli import.

Cinque identità personali con ruoli nel database. Il founder ha completato il primo accesso. La scelta più recente prevede password operativa comune di almeno sei caratteri, password condivisa Finance e password CEO separata, senza TOTP obbligatorio. La configurazione iniziale attende l’inserimento umano in una schermata locale privata. Finance resta limitata a founder, produzione e Finance; audit al founder. Ogni sblocco è legato alla sessione Auth corrente e scade dopo otto ore. Nessuna email inviata; registrazione pubblica disabilitata.

## Avvio operativo

Vendite manuali, sconti e rettifiche stock sono ancora disabilitati; `sales_started_at` è nullo. L’attivazione avverrà dopo il deploy verificato, fissando un timestamp esatto e mantenendo le 214 unità di apertura. La conferma del founder sull’assenza di nuovi movimenti è già acquisita.

Packaging, conto vendita, contenuti, sviluppo e lavoro Finance sono implementati e verificati; la pubblicazione del nuovo avanzamento deve essere controllata sul dominio del team LuckyLap. Il conto vendita usa prezzo sito +10 EUR, nessuno sconto, quote commerciali 60/40 e incasso distinto dalla vendita.

Shopify: ricevitore idempotente applicato, coda durabile in `awaiting_app`; nessun ordine Shopify ancora applicato. Servono app interna installata, segreti server e worker completo prima di attivare sottoscrizioni. Il plugin dell’assistente non è una credenziale permanente dell’app. [Procedura ufficiale](shopify-app-setup.md).

## Verifica della pubblicazione

Controllare commit, stato READY e alias con il plugin Vercel. Verificare login anonimo, `private, no-store`, route QA assenti e assenza di dati riservati nell’HTML. Poi verificare il percorso con sessione reale senza inserire movimenti di prova nel magazzino.

Le tabelle private di ricevute, outbox, code e credenziali hanno RLS senza policy client intenzionalmente. Nessun grant permissivo viene aggiunto per eliminare gli avvisi informativi. La protezione Supabase contro password compromesse richiede un piano superiore e non è stata attivata. [Evidenze e limiti](verification.md).
