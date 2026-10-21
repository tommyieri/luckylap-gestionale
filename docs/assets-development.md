# Libreria del brand e sviluppo prodotti

Le route `/assets` e `/development` estendono il workspace condiviso. Richiedono `getUser` e membership attiva, usano la sessione del chiamante e RLS e non inviano inviti o email. Nessun file o contenuto viene preso automaticamente da Drive; i file sorgenti rimangono invariati.

## Migrazione e bucket

Migrazione generata con CLI ufficiale `supabase@2.121.0 migration new brand_assets_and_development`, dopo verifica versione/help: `20261021130138_brand_assets_and_development.sql`. Non modificare le migrazioni già applicate. Il bucket viene creato tramite Storage API, non inserendo righe SQL nella metadata Storage:

```json
{
  "id": "brand-assets",
  "name": "brand-assets",
  "public": false,
  "file_size_limit": 26214400,
  "allowed_mime_types": ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm", "application/octet-stream"]
}
```

Il limite è 25 MiB, indicato come 25 MB nell’interfaccia. Gli SVG sono caricati come `application/octet-stream`, conservando `image/svg+xml` nei metadati applicativi: si scaricano come allegati e non hanno anteprima.

Storage consente lettura ai membri attivi e inserimento soltanto nel percorso `auth.uid()/operationUUID/nome-sicuro.estensione`. Non concede aggiornamento/upsert o eliminazione. Le policy restrittive impediscono UPDATE e DELETE nel bucket anche se in futuro esistesse un’altra policy permissiva. I file sono immutabili per gli utenti del gestionale.

## Trasferimento e verifica degli originali

Il browser non riceve JWT di autenticazione. Le Server Actions verificano utente/membership e firmano un upload per un solo percorso, senza overwrite. Il client Supabase usato per il trasferimento ha persistenza, refresh e rilevamento sessione disattivati: usa soltanto chiave pubblicabile e capability di upload specifica. Secondo la [documentazione Supabase](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl), tale capability è valida per due ore; non è una sessione Auth.

I byte vanno direttamente a Storage, evitando il limite del corpo della richiesta Vercel. Nessun aumento del limite delle Server Actions è necessario. Dopo il trasferimento, una seconda Server Action rilegge l’oggetto e controlla dimensione, SHA-256, estensione, MIME e firma del formato prima di registrare la voce. PNG, JPEG, WebP, MP4, WebM e SVG sono supportati; SVG richiede UTF-8 e non ammette DOCTYPE/ENTITY. La verifica della firma non è una scansione antivirus né una decodifica completa dei codec.

La route `/assets/files/[id]` verifica nuovamente accesso e contenuto, quindi restituisce un piccolo redirect verso un URL Storage firmato per 60 secondi: neppure le risposte da 25 MB attraversano Vercel. Gli SVG richiedono anche il MIME Storage `application/octet-stream` e download forzato. I link firmati sono capability temporanee: un URL già emesso resta valido fino alla scadenza anche se nel frattempo una membership viene revocata. Le pagine e i redirect non sono memorizzabili nella cache condivisa.

Upload e inserimento dei metadati non sono un’unica transazione. In caso di errore, l’interfaccia conserva operation ID, percorso e manifest in `sessionStorage`, senza token o file; “Verifica e completa” ripete la verifica dell’oggetto e la registrazione idempotente. Anche i collegamenti HTTPS conservano prima dell’invio UUID, campi e URL del tentativo: dopo una risposta incerta o un reload, “Verifica e completa” ripete lo stesso payload. Il modulo di modifica non rimane attivo durante questo recupero e l’UUID cambia solo dopo un salvataggio confermato. Un errore non viene presentato come successo. Un file caricato ma non registrato rimane privato; pulizia/eliminazione richiedono amministrazione. “Nuovo caricamento” libera soltanto lo stato locale, senza cancellare o sovrascrivere l’oggetto precedente. Se il browser rifiuta lo storage locale, l’interfaccia invita a mantenere aperta la pagina.

I metadati sono registrati tramite `public.register_brand_asset`, wrapper di una funzione privata che ricontrolla membership, prefisso del percorso, esistenza/dimensione/MIME dell’oggetto e autore. La PK è l’UUID dell’operazione. Un replay identico dello stesso utente restituisce lo stesso elemento; payload o autore differenti vengono rifiutati. INSERT/UPDATE/DELETE diretti su `assets` sono revocati ai client. La verifica dei byte viene ripetuta anche in lettura, così una chiamata RPC diretta con dichiarazioni false non produce un’anteprima eseguibile.

## Import amministrativo degli asset autorizzati

I file importati dal coordinatore possono usare un percorso amministrativo come `system/<uuid>/<nome-sicuro.png>`, creato tramite API con credenziali amministrative. I campi sono:

`id`, `name`, `asset_type`, `description`, `storage_path`, `created_by = NULL`, `original_file_name`, `content_type`, `file_size_bytes`, `sha256`, `source`.

`source` conserva come JSON la fonte Drive, l’hash del file, la modifica della sorgente e un marker `drive_admin_import`. `created_by` nullo identifica un’operazione di sistema, senza attribuirla falsamente al founder; le RPC degli utenti impongono sempre `auth.uid()`. L’import owner non richiede modifiche agli account del team. Non inserire credenziali, file binari o manifest privati nel repository o nel bundle Vercel.

Le anteprime di PNG/JPEG/WebP usano la route privata, su fondo bianco; i loghi trasparenti rimangono leggibili. I video hanno controlli nativi e non vengono riprodotti automaticamente. I collegamenti esterni HTTPS si aprono nel servizio originale e non sono recuperati dal server.

## Sviluppo prodotti

`product_development_projects` contiene nome, brief, fase, data obiettivo, referente attivo, autore e versione. Fasi: idea, design, campionatura, produzione, pronto e archiviato. Tutti i membri attivi possono creare, leggere, aggiornare e archiviare. Non è esposta eliminazione permanente.

`public.save_development_project` ricontrolla membership e referente. Creare con UUID e `expected_version = NULL` è idempotente per autore e stesso payload iniziale. Ogni aggiornamento richiede la versione letta; se un altro membro ha modificato la scheda, il database rifiuta la sovrascrittura con `40001`. Il modulo conserva il testo e richiede di aggiornare/controllare i dati correnti. L’archiviazione è un aggiornamento versionato, registrato nell’audit. La fase “Pronto” non crea SKU, movimenti o scorte.

## Verifica e limiti

La suite `supabase/tests/assets-development.mjs` esegue PostgreSQL locale con Auth e metadata Storage simulati: ruoli, RLS, percorsi, no-upsert/no-delete, replay, autore, referente attivo, aggiornamenti concorrenti e audit. I test Vitest coprono estensioni/MIME/firme, hash/dimensioni, azioni e download privati. Il test di download sopra 4,5 MB conferma una risposta di redirect senza corpo binario.

I test locali non sostituiscono una prova reale delle signed-upload capability e delle policy Storage dopo creazione del bucket. Il coordinatore applica la migrazione, crea il bucket e importa i soli asset autorizzati. Le route devono entrare nel matcher del Proxy per cookie aggiornati e intestazioni `no-store`. I metadati usano paginazione a cursore e rifiutano letture troncate; il limite attuale è 10.000 elementi per tabella.

QA visiva completata dal coordinatore su desktop 1280 px e mobile 390 px: libreria vuota e schede/modifica sviluppo leggibili, nessun overflow orizzontale, scala 1 e console senza errori. Le fixture temporanee `/qa-assets` e `/qa-development` sono state eliminate e rispondono 404; server QA chiuso.
