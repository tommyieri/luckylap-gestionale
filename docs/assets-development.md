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

## Archivio dei contenuti

Un contenuto caricato per sbaglio si toglie dalla libreria con «Archivia», in fondo alla scheda. Il riquadro spiega: «Il contenuto sparisce dalla libreria per tutti. Puoi ripristinarlo da “Mostra archiviati”.» L’interruttore «Mostra archiviati» elenca solo i contenuti archiviati, con la data e il pulsante «Ripristina». Non si cancella niente: nome, descrizione, percorso, file nel bucket e metadati restano come sono, e il file resta scaricabile dai membri.

Migrazione `20261023115001_archivio_contenuti.sql`, solo aggiunte:

- `public.assets` ha due colonne nuove, `archived_at` e `archived_by`, nulle per tutte le righe esistenti. Il vincolo `assets_archive_pair` le vuole sempre insieme.
- I client non hanno permessi di scrittura su `assets`: le due colonne cambiano solo con `public.set_brand_asset_archived(operation_id, payload)`, wrapper `security invoker` di una funzione privata `security definer`. Payload: `{"schema_version": 1, "asset_id": "<uuid>", "archived": true | false}`.
- La funzione ricontrolla la membership attiva (`42501 asset_access_required`), il payload e il contenuto (`22023 invalid_asset_payload`, `asset_not_found`). Archiviare un contenuto già archiviato, o ripristinarne uno attivo, non cambia niente e restituisce lo stato attuale.
- Ricevuta per operation ID in `private.asset_command_receipts` (append-only): lo stesso invio ripetuto restituisce l’esito di allora con `replayed: true`; lo stesso ID con un altro payload o da un altro membro dà `23505 asset_idempotency_conflict`. Dopo un errore, lo stesso pulsante («Archivia il contenuto» o «Ripristina») ripete lo stesso ID finché la pagina resta aperta. Se invece si ricarica la pagina, come chiede il messaggio d'errore, l'ID è nuovo: il comando non cambia niente se il contenuto è già nello stato chiesto.
- Il trigger `audit_change` già presente su `assets` registra autore, prima e dopo di ogni cambio. Un comando senza effetto non scrive audit. Oggi l'archiviazione compare solo nel registro tecnico di `/audit`. Il feed di Controllo CEO della pull request #3 la leggerebbe come «… ha aggiornato un contenuto»: la frase dedicata («… ha archiviato un contenuto») si aggiunge al catalogo del feed nella parte B di P7, dopo il rebase su `main`.

La Server Action `setBrandAssetArchived` ricontrolla il membro, invia il comando e traduce gli errori in italiano, senza dettagli tecnici. Un esito che non corrisponde alla richiesta non viene confermato.

In anteprima locale (`npm run dev`) la pagina mostra cinque contenuti sintetici, uno archiviato, con le scritture spente. Il ramo non si attiva su Vercel né con `NODE_ENV=production`.

Per tornare indietro su un contenuto basta «Ripristina». Un ripristino in blocco, dal proprietario del database: `update public.assets set archived_at = null, archived_by = null where archived_at is not null;` (resta nell’audit).

Produzione: applicata il 23 ottobre 2026 come versione cloud `20261023115001`, con il testo salvato uguale al file (md5 `249f4b462c330c8e2f6f7cf3ac42882f`). Prima e dopo: 6 contenuti, impronta delle colonne esistenti identica (md5 `24b6a3fe4394d1da6b2bc7321b116fe9`), `archived_at` e `archived_by` nulli su tutte le righe; il comando è `security definer` con `search_path` vuoto, eseguibile da `authenticated` e non da `anon`. L’harness la cerca per suffisso.

## Sviluppo prodotti

`product_development_projects` contiene nome, brief, fase, data obiettivo, referente attivo, autore e versione. Fasi: idea, design, campionatura, produzione, pronto e archiviato. Tutti i membri attivi possono creare, leggere, aggiornare e archiviare. Non è esposta eliminazione permanente.

`public.save_development_project` ricontrolla membership e referente. Creare con UUID e `expected_version = NULL` è idempotente per autore e stesso payload iniziale. Ogni aggiornamento richiede la versione letta; se un altro membro ha modificato la scheda, il database rifiuta la sovrascrittura con `40001`. Il modulo conserva il testo e richiede di aggiornare/controllare i dati correnti. L’archiviazione è un aggiornamento versionato, registrato nell’audit. La fase “Pronto” non crea SKU, movimenti o scorte.

## Foto dei nuovi prodotti

Ogni scheda di `/development` ha la parte «Foto»: miniature quadrate in una striscia che scorre in orizzontale, «Aggiungi foto» e la foto in grande. Tutti i membri attivi aggiungono, spostano e tolgono le foto, come per il resto delle schede.

- **Aggiungere.** «Aggiungi foto» apre la scelta dei file (`accept="image/*"`, più file insieme): sul telefono offre fotocamera e galleria, sul computer i file. JPEG, PNG, WebP e HEIC fino a 25 MB l’una, al massimo 10 per volta e 60 per progetto. I file che non vanno restano in elenco con il motivo («supera 25 MB», «non è una foto in un formato accettato»); gli altri partono, ognuno con la sua percentuale.
- **Vedere.** Toccando una miniatura la foto si apre in grande in un `dialog` nativo: «Chiudi» (anche Esc o lo sfondo), precedente e successiva (anche con le frecce), «Scarica originale», «Sposta prima» e «Sposta dopo».
- **Togliere.** «Rimuovi», poi «Sì, rimuovi la foto». La foto sparisce dal progetto per tutti; il file resta nell’archivio privato del team.

### Dove stanno

Una foto è un contenuto di `public.assets`, nello stesso bucket privato `brand-assets`, con gli stessi limiti, lo stesso percorso `utente/operazione/nome-sicuro.estensione` e la stessa route `/assets/files/[id]` (redirect a un URL firmato per 60 secondi). Il collegamento al progetto è una riga di `public.product_development_photos(id, project_id, asset_id, position, created_by, created_at)`: un contenuto sta in un solo progetto (`asset_id` unico), le posizioni sono uniche per progetto. Così le foto contano come contenuti del team, ma non si mescolano alla libreria: il contenuto porta `source = {"kind": "development_photo", "development_project_id": …}` e «Grafica e foto» lo tiene fuori dall’elenco principale. Le foto dei progetti compaiono solo con il filtro Tipo «Nuovi prodotti», senza «Archivia»: si aggiungono e si tolgono dalla scheda.

### Caricamento

Lo stesso percorso dei caricamenti della libreria. Il browser calcola l’SHA-256, la Server Action `prepareDevelopmentPhotoUploads` firma un caricamento per foto (senza sovrascrittura) e i byte vanno direttamente a Storage, con l’avanzamento letto da `XMLHttpRequest`. Poi `finalizeDevelopmentPhotos` rilegge ogni oggetto, controlla dimensione, SHA-256 e firma del formato, e registra tutte le foto dell’invio con un solo comando. Se una foto non supera la verifica non parte niente: quella foto resta fuori con il motivo, le altre ripartono con un operation ID nuovo. Dopo una risposta incerta compare il riquadro «Foto da verificare» (`pending-attempt.tsx`): l’invio è conservato in `sessionStorage` (solo i descrittori, mai file o token) e «Verifica lo stesso invio» lo ripete con lo stesso ID. Una rimozione incerta mostra «Rimozione da verificare» nella foto in grande, con lo stesso ID.

### HEIC

Il bucket accetta oggi PNG, JPEG, WebP, MP4, WebM e `application/octet-stream`, non `image/heic`. Sul telefono il problema di solito non si pone: con `accept="image/*"` Safari per iPhone converte in JPEG le foto della galleria e della fotocamera. Da un Mac, o da un browser che non converte, arriva un file `.heic`: si accetta e si conserva com’è, caricato come `application/octet-stream` (come gli SVG), con `content_type` `image/heic` nei metadati. Non serve cambiare il bucket. La verifica dei byte controlla la scatola `ftyp` con una marca HEIF (`heic`, `heix`, `mif1`…). In pagina il browser prova a mostrarla: Safari ci riesce, Chrome e Firefox no, e al posto dell’immagine rotta compare un riquadro con il nome del file; nella foto in grande, il riquadro invita a scaricare l’originale. La libreria resta senza HEIC: `register_brand_asset` non cambia.

### Migrazione `20261023184200_foto_nuovi_prodotti.sql`

Nessuna riga esistente viene scritta. Di esistente cambiano solo il vincolo dei tipi di `public.assets` (allargato) e tre funzioni del feed; il resto è nuovo:

- `public.assets`: il vincolo `assets_content_type_check` accetta anche `image/heic` e `image/heif`; le righe di oggi lo rispettano già. Un trigger `development_photo_archive_guard` impedisce di archiviare un contenuto finché è collegato a un progetto: si toglie con il comando del progetto.
- `storage.objects`: la policy di inserimento `development_photos_heic_insert` per i percorsi `.heic` e `.heif` del bucket, con lo stesso schema delle altre. Nessun update o delete: valgono le policy restrittive di oggi.
- `public.product_development_photos`: RLS, sola lettura ai membri attivi, nessuna scrittura per i client, `audit_change`. Il trigger `development_photo_guard` vuole un contenuto attivo, di tipo foto, con il segno di quel progetto; progetto e contenuto di una riga non cambiano.
- `private.development_photo_receipts`: ricevute append-only per operation ID.
- Tre comandi `security definer` con `search_path` vuoto e wrapper `security invoker` (EXECUTE solo ad `authenticated`): `add_development_photos(operation_id, {"schema_version": 1, "project_id", "photos": [{"asset_id", "storage_path", "original_file_name", "content_type", "file_size_bytes", "sha256"}]})`, `remove_development_photo(operation_id, {"schema_version": 1, "project_id", "asset_id"})` e `move_development_photo(operation_id, {"schema_version": 1, "project_id", "asset_id", "position"})`. Ricontrollano membership (`42501 development_access_required`), payload, percorso dell’utente, oggetto nel bucket con MIME e dimensione firmati, limite di 60 foto. Lo stesso invio ripetuto restituisce l’esito di allora con `replayed: true`; lo stesso ID con un altro payload, un altro membro o un altro comando dà `23505 development_photo_idempotency_conflict`. Il progetto bloccato mette in fila gli invii concorrenti.
- Togliere una foto cancella il collegamento e archivia il contenuto (`archived_at`, `archived_by`): nome, percorso, file nel bucket e metadati restano. Non si cancella niente da Storage. Il contenuto archiviato si vede in «Grafica e foto» con «Nuovi prodotti» e «Mostra archiviati».
- Controllo CEO: `activity_feed_keys`, `activity_feed_parent` e `activity_feed_window` di `20261023164150_riassortimento` con `create or replace`, cambiate solo dove serve. Le righe delle foto e dei loro contenuti hanno per padre il progetto e diventano una frase per transazione: «Gabriele ha aggiunto 2 foto al progetto «Collab X»», «… ha tolto una foto dal progetto …», «… ha riordinato le foto del progetto …», area Nuovi prodotti, link alla scheda. Stesse 24 ore e stessa privacy: il nome del progetto passa da `activity_feed_text`.

Per tornare indietro: la migrazione non tocca righe esistenti; le foto aggiunte restano contenuti normali del bucket.

### Anteprima locale

Con `npm run dev` la pagina mostra tre progetti sintetici e cinque immagini segnaposto disegnate per l’anteprima (`public/anteprima/nuovi-prodotti`, nessuna foto vera; il file `.heic` contiene solo l’intestazione del formato e mostra il riquadro con il nome). «Aggiungi foto», «Rimuovi» e lo spostamento funzionano solo nella pagina, con un avanzamento simulato: niente rete e niente Supabase. I moduli delle schede restano spenti. Il ramo non si attiva su Vercel né con `NODE_ENV=production` (lo controlla `src/app/(workspace)/development/page.test.tsx`).

## Verifica e limiti

La suite `supabase/tests/review-handoff.mjs` (PGlite, minimo 51 controlli) prova l’archivio: migrazione sopra contenuti esistenti senza toccarli, archivio e ripristino per ogni ruolo attivo, rifiuto di esterni, account non attivi e anonimi, payload non validi, ricevute e replay, scritture dirette rifiutate, audit con autore.

La suite `supabase/tests/foto-nuovi-prodotti.mjs` (PGlite, minimo 208 controlli) prova le foto dei progetti: migrazione sopra contenuti e progetti esistenti senza toccarli, policy HEIC, aggiunta per ogni ruolo attivo, rifiuto di esterni, account non attivi e anonimi, payload non validi, oggetti mancanti o con MIME diverso, limite di 60, ricevute e replay, spostamento, rimozione con archivio, guardie sui collegamenti, scritture dirette, audit con autore, libreria senza le foto dei progetti e frasi del feed di Controllo CEO.

Le foto si leggono dalla route privata, che a ogni lettura riscarica e riverifica il file: per una striscia di foto pesanti la prima apertura può essere lenta. Le miniature sono pigre (`loading="lazy"`); non ci sono miniature ridotte lato server.

La suite `supabase/tests/assets-development.mjs` esegue PostgreSQL locale con Auth e metadata Storage simulati: ruoli, RLS, percorsi, no-upsert/no-delete, replay, autore, referente attivo, aggiornamenti concorrenti e audit. I test Vitest coprono estensioni/MIME/firme, hash/dimensioni, azioni e download privati. Il test di download sopra 4,5 MB conferma una risposta di redirect senza corpo binario.

I test locali non sostituiscono una prova reale delle signed-upload capability e delle policy Storage dopo creazione del bucket. Il coordinatore applica la migrazione, crea il bucket e importa i soli asset autorizzati. `/assets` e `/development` sono nel matcher del Proxy, per cookie aggiornati e intestazioni `no-store`: lo controlla `src/proxy.test.ts`. I metadati usano paginazione a cursore e rifiutano letture troncate; il limite attuale è 10.000 elementi per tabella.

QA visiva completata dal coordinatore su desktop 1280 px e mobile 390 px: libreria vuota e schede/modifica sviluppo leggibili, nessun overflow orizzontale, scala 1 e console senza errori. Le fixture temporanee `/qa-assets` e `/qa-development` sono state eliminate e rispondono 404; server QA chiuso.
