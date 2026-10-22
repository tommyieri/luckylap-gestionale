# Partner nel gestionale

`/partner` è il roadbook del progetto Partner dentro il gestionale: negozi, eventi, club, media e brand da contattare, divisi per periodo e sezione, con il numero CO, il contatto principale, i messaggi modificabili con lo storico, lo stato e i lookbook da allegare. Tutti e cinque i membri vedono e fanno tutto (decisione del founder del 21 ottobre 2026).

I dati stanno nel database e li leggono solo i membri attivi. Ogni scrittura passa da un comando con `operation_id`, ricevuta e, dove serve, controllo di versione. La ricerca arriva dal repository `luckylap-partner` con un import preparato offline; gli stati e i testi salvati sui dispositivi arrivano dai file «Esporta» del vecchio sito.

Questo documento descrive la tappa P2 (branch `claude/tappa-4-partner`). Fonti: spec `02-partner.md` con le correzioni di `00-sequenza.md` (§2, §4 P2, §5), che prevalgono.

## In breve

- Una migrazione additiva, `supabase/migrations/20261022215908_partner_module.sql`: 9 tabelle pubbliche, 2 private, audit senza recapiti né testi, 10 comandi del team, import della ricerca riservato al proprietario del database. Nessuna tabella, funzione o policy esistente cambia.
- Pagine dentro il guscio comune: `/partner`, `/partner/dati`, `/partner/regole` e la route `/partner/lookbook/[code]` per i cinque PDF.
- Niente Storage: i lookbook stanno nel repository in `data/partner-lookbooks/` (decisione 20).
- Periodi calcolati da oggi, all'ora di Roma. Il 22 ottobre 2026 riproducono i conteggi del sito: 49, 63, 40, 11, 44.
- Le modifiche del team non si perdono: storico dei testi, import che aggiorna solo ciò che il team non ha toccato, «differenze da controllare» per il resto.
- Fuori da P2: solleciti automatici, date Partner nel calendario e Oggi (P5); frasi del Controllo CEO (P6); import in produzione (fatto il 22 ottobre, esiti in «Esiti in produzione»); spegnimento di GitHub Pages (dopo P5 e la frase di Tommi).

## Pagine

### `/partner`

`src/app/(workspace)/partner/page.tsx`, componenti in `src/components/partner/`. Dall'alto:

1. `h1` «Partner» e la riga dei totali per sezione.
2. Sezioni Tutti, Vendita, Eventi, Collab con il conteggio.
3. Barra dei cinque periodi, ferma in alto con `top: var(--ws-sticky-top)`. «Adesso» scelta è in verde pieno.
4. Ricerca («Cerca nome, città o CO»), select «Stato» e «Seguito da».
5. Avviso ambra delle differenze da controllare, con «Mostrale».
6. Titolo e nota del periodo, lista ordinata per CO. Ogni riga ha l'ancora `id="lead-{co}"`.
7. Piede: «Aggiungi un contatto», i cinque lookbook, i link a `/partner/dati` e `/partner/regole`, la riga dell'ultimo import letta dal database («Ricerca del 21 ottobre 2026, importata il … (commit f6ad90c).»).

La riga: casella CO con il mese pianificato, nome e priorità, etichette (sezioni, date dell'evento, follower, messaggi pronti, «Seguito da», prossima azione, «Non contattare», «Da controllare», «Fuori dalla ricerca»), percorso breve e pulsanti del canale preferito, select dello stato che salva subito. Un contatto bloccato non ha pulsanti.

I dettagli si aprono con `?co=N` (navigazione vera: il server legge il dettaglio di quel contatto) e mostrano, in quest'ordine: differenze, «Fuori dalla ricerca», responsabile e prossima azione, messaggi, registro, testi della ricerca, recapiti, attenzione e fonti, scheda modificabile, «Non contattare».

Messaggi: un pulsante per approccio, testata con canale, lingua e lookbook, campi modificabili con «Copia il testo», «Salva il testo» e «Annulla le modifiche», versioni con «Ripristina l'originale», avviso quando la ricerca cambia un originale mentre vale il testo del team, «Apri l'email con il testo» (`mailto:` con il corpo solo fino a 1800 caratteri), «Segna inviato» e «Segna sollecito inviato». Se il registro ha un invio degli ultimi 10 minuti la pagina chiede conferma («Già segnato inviato alle 10:42 da Luca. Segnare di nuovo?»).

Registro: «Ha risposto», «Chiamata», «Incontro», «Nota» (e «Segna inviato» per chi non ha messaggi), con giorno, canale e testo. Mostra le attività dalla più recente, le prime 20 e poi «Mostra tutte»; il dettaglio ne legge al massimo 100.

### `/partner/dati`

- **Ricerca**: ultimo import (data, commit, contatori), import precedenti, differenze aperte con il link al filtro «Da controllare».
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
- Stati comuni con `AccessPanel` e `WorkspacePanel`. Lettura non riuscita: «Partner non disponibile. Ricarica la pagina tra poco; nessun dato parziale viene mostrato.» con «Ricarica». Le letture sono complete o non c'è nulla: `readTeamPages`, conteggi esatti verificati.
- Le tre pagine hanno il loro `loading.tsx` con le righe scheletro.
- Errori dei comandi accanto al controllo, con i testi di spec 02 §5.11 (`src/lib/partner/commands.ts`, `PARTNER_ERROR_MESSAGES`). Esito incerto: «Salvataggio non confermato. Verifica prima di riprovare.»; il tentativo resta in `sessionStorage` (chiave `luckylap.partner.pending:<utente>:…`) e «Verifica» lo ripete con lo stesso `operation_id`, mostrato con `src/components/pending-attempt.tsx`.
- **Anteprima locale** (`npm run dev`, `isLocalPreviewEnabled()`): le tre pagine leggono i sei contatti sintetici di `src/lib/partner/fixtures.ts`, con le date calcolate da oggi, e mostrano «Anteprima locale: dati sintetici, salvataggio disattivato.». Le Server Action rispondono «Anteprima locale: salvataggio disattivato.» senza chiamare Supabase. Mai su Vercel né con `NODE_ENV=production` (`src/lib/partner/read.test.ts`).

## Periodi, filtri e indirizzo

`src/lib/partner/periods.ts`, `dates.ts`, `filters.ts`. Oggi è il giorno di Roma, calcolato sul server e passato al client.

- Mese pianificato = mese di `next_action_on` se c'è, altrimenti `contact_month`. `k` = mesi dal mese corrente.
- Periodo 1 `k ≤ 1` (compresi i mesi passati), 2 `2–3`, 3 `4–5`, 4 `6–8`, 5 `k ≥ 9`.
- Celle e titoli seguono il mese: il 22 ottobre 2026 «Adesso», «Dic – Gen», «Feb – Mar», «Apr – Giu», «Da lug 2027»; il 10 dicembre 2026 «Adesso», «Feb – Mar», «Apr – Mag», «Giu – Ago», «Da set 2027», con il titolo «Adesso, entro gennaio».
- Mezzanotte di Roma: `2026-10-31T23:30:00Z` è già novembre.
- I conteggi delle celle applicano tutti i filtri tranne il periodo.

Indirizzo: `/partner?periodo=1&sezione=eventi&stato=da_fare&chi=io&q=porsche&co=12`.

| Parametro | Valori | Predefinito |
| --- | --- | --- |
| `periodo` | 1–5 | 1, o l'ultimo usato nel browser |
| `sezione` | `tutti`, `vendita`, `eventi`, `collab` | `tutti`, o l'ultima usata |
| `stato` | `da_fare` (tutti tranne Chiuso e Non interessato), `tutti`, uno dei 6 stati, `non_contattare`, `da_controllare` | `da_fare` |
| `chi` | `tutti`, `io`, `nessuno`, id di un membro | `tutti` |
| `q` | al massimo 80 caratteri: nome, città, paese, tipo, CO («12», «CO 12», «CO012») | vuoto |
| `co` | contatto con i dettagli aperti | nessuno |

Valori non validi tornano ai predefiniti, senza errore. Filtri, periodo, sezione e ricerca lavorano nel browser e aggiornano l'indirizzo. Ultimo periodo e ultima sezione restano in `localStorage` (`luckylap.partner.vista.v1`) quando l'indirizzo non li indica. Un link `#lead-12` senza `co` apre il contatto 12. Il link canonico è `partnerHref({ co })` di `src/lib/partner/links.ts`: `/partner?co=12#lead-12`.

## Database

### Tabelle

| Tabella | Contenuto |
| --- | --- |
| `public.partners` | La scheda: `co` stabile e unico (1–99999, mai riusato), `source_key` della ricerca (`L001`, `n111`; nullo per i contatti del team), sezioni, priorità, `contact_month`, date dell'evento, scadenza candidatura, canale preferito, testi della ricerca in `research` (sola lettura), `research_base` per il confronto a tre vie, `stage`, `owner_id`, prossima azione, approccio scelto, `research_removed_at`, `version`. |
| `public.partner_contacts` | Recapiti per tipo (`email`, `phone`, `whatsapp`, `instagram`, `form`, `brand_page`, `web`): testo intero in `value`, valore pulito per il pulsante in `link_value` (formato stretto per tipo), `verified`, `active`, cancellazione in `erased_at`, `research_slot` e `research_value` per gli import. |
| `public.partner_message_variants` | Una variante per contatto e approccio: canale, lingua, destinatari, lookbook, quattro testi originali della ricerca, note per il team, `current_revision_id` (nullo = vale l'originale), `original_changed_at`. |
| `public.partner_message_revisions` | Storico dei testi del team, append-only: `edit`, `restore`, `file`. |
| `public.partner_activities` | Registro di tutto ciò che il team fa su un contatto, append-only. Una riga per contatto e operazione (`unique (operation_id, partner_id)`). Copia nome e CO del momento. |
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
| `record_partner_activity` | `inviato`, `risposta`, `chiamata`, `incontro`, `nota`; giorno da oggi a 365 giorni fa. `inviato` porta Da contattare → Contattato; `risposta` porta Da contattare o Contattato → Ha risposto. Contatto bloccato: `inviato`, `chiamata`, `incontro` danno `55000` | il tipo richiesto, con stato prima e dopo |
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

## File del vecchio sito («Esporta»)

Il pulsante «Esporta stati e testi di questo dispositivo» del sito scarica `luckylap-partner-AAAA-MM-GG-telefono.json` o `…-computer.json`. Lo stato del sito vive nel browser di ogni dispositivo: il gestionale non può leggerlo, serve il file.

- **Parser** (`src/lib/partner/device-file.ts`, nel browser e di nuovo sul server): `formato` `luckylap-partner-export`, `versione` 1, `esportato` ISO, `dispositivo` `telefono` o `computer`; chiavi dei contatti e dei testi nel formato del sito; stati, approcci e testi dentro i limiti; al massimo 900 KB e 2000 voci per mappa; chiavi `__proto__`, `constructor`, `prototype` rifiutate; `vista` ignorata, qualunque valore abbia. Lo SHA-256 dei byte del file è la sua identità.
- **Anteprima**: «Controlla il file» calcola il piano senza scrivere: stati, testi e approcci da applicare, differenze, voci ignorate, contatti sconosciuti, nomi diversi (solo avviso), file già importato.
- **Import**: lo stesso piano, in una transazione, sotto il lock `luckylap.partner.device`. Lo stesso file già importato restituisce il resoconto di allora.

Regole, mai sopra il lavoro del team:

- **Stato**: `da_contattare` nel file è ignorato. Si applica se nel gestionale è Da contattare e nessun membro ha mai cambiato lo stato, oppure se lo stato viene da un file esportato prima. Un file più vecchio è «superato». Altrimenti resta il valore del gestionale e nasce una differenza `stage`. Quando si applica, `stage_from_file_at` = data di esportazione.
- **Testi**, per contatto e approccio: si applicano come revisione `file` se vale l'originale o una revisione `file` più vecchia; uguali all'originale o al testo in uso: ignorati; altrimenti differenza `message`. Variante inesistente: «sconosciuto».
- **Approccio**: si applica se nel gestionale è vuoto o viene da un file più vecchio; altrimenti ignorato.
- **Registro**: una riga per contatto toccato, `origin = 'file'`, `occurred_at` = data di esportazione, autore chi carica il file. Stato Contattato → `inviato` (primo messaggio, canale della variante o del canale preferito); Ha risposto e In trattativa → `risposta`; Chiuso e Non interessato → `stato`; solo testi → `messaggio`; solo approccio → `approccio`.

Quando: dopo il rilascio di P5, così gli invii importati creano i solleciti (decisione 30). Claude chiede a Tommi di premere «Esporta» su ogni dispositivo e browser e di caricare i file in `/partner/dati`.

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

Il sito Partner su GitHub Pages espone contatti, recapiti e messaggi a chiunque abbia il link. Va spento del tutto, non solo svuotato (spec 02 §9).

Quando: solo dopo il rilascio di P5, l'import dei file di tutti i dispositivi e la frase di Tommi «Ho esportato da tutti i dispositivi» (decisione 31). Poi, nel repository Partner (branch `claude/partner-nel-gestionale`): via `.github/workflows/pages.yml`, «Rigenerare e importare nel gestionale» nella skill `messaggi`, `README.md` e `PRODUCT.md` aggiornati; merge; `gh api -X DELETE repos/tommyieri/luckylap-partner/pages`; verifica che l'indirizzo risponda 404; verifica che il repository sia privato (`gh repo view tommyieri/luckylap-partner --json visibility`). Se è pubblico: dirlo a Tommi, non cambiarlo da soli.

## Test

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

## Collegamenti con le altre tappe

- **P5, Collegamenti e Oggi.** Usa `partners`, `partner_activities` (anche le righe `origin = 'file'`), `private.partner_blocked`, `private.apply_partner_stage` con quattro argomenti, `partnerHref({ co })` e la Server Action `recordPartnerActivity`, a cui aggiunge la data del sollecito. Il trigger dei solleciti e il riquadro di Oggi sono suoi.
- **P6, Controllo CEO.** Le tabelle Partner scrivono l'audit con `private.audit_change_keys`, non con `private.audit_change`: il controllo di copertura deve riconoscere entrambi. `record_key` porta `partner_id` e `variant_id`. Frasi da spec 02 §10, link con `partnerHref({ co })`.
- **P7.** Ha scritto qui gli esiti dell'import in produzione («Esiti in produzione»).
