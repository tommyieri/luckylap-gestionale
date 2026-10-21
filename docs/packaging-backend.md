# Materiali packaging: contratto database

La migrazione `20261021125127_packaging_materials.sql`, creata con la CLI Supabase ufficiale `migration new`, aggiunge due comandi atomici sui registri già esistenti. Non contiene materiali, SKU, quantità o costi predefiniti. Non è stata applicata al cloud dall'autore di questo modulo.

I materiali sono `stock_items.kind = packaging` con dettaglio in `packaging_items`, distinti dalle varianti prodotto e dagli adesivi retail Shopify. La scatola contiene la T-shirt; il tipo `sticker` descrive l'adesivo della scatola. Nessuna distinta o consumo automatico per ordine è stato assunto.

## RPC pubbliche

Entrambe ricevono `(p_operation_id uuid, p_payload jsonb)` e restituiscono `{operation_id, stock_item_id, movement_id, replayed}`. `movement_id` è NULL se la creazione non include una conta. Wrapper SECURITY INVOKER, processori nello schema privato, membership corrente obbligatoria per tutti e cinque i ruoli, nessun DML diretto concesso ai client.

| RPC | Payload esatto |
| --- | --- |
| `create_packaging_material` | `schema_version: 1`, `sku` testo 1–120, `name` testo 1–240, `packaging_type: box/sticker/other`, `specifications: null/testo ≤2000`, `unit_cost_cents: null/intero 0–999999999999`, `location_id: uuid`, `initial_quantity: null/intero 0–1000000000`. Tutte le chiavi sono presenti; sconosciute rifiutate. |
| `initialize_packaging_count` | `schema_version: 1`, `stock_item_id: uuid`, `location_id: uuid`, `quantity: intero 0–1000000000`, `reason` testo 3–500. Solo materiale packaging attivo e saldo sconosciuto. |

SKU, nome, specifiche e causale vengono ripuliti degli spazi esterni; specifiche vuote diventano NULL. Lo SKU mantiene il formato dichiarato dall'utente. SKU già presente nel catalogo, anche se prodotto, viene rifiutato. Location esplicita e attiva obbligatoria.

La creazione salva anagrafica, dettaglio packaging e un saldo NULL nella location scelta. Se una conta è dichiarata, aggiunge un movimento opening nella stessa transazione: **zero dichiarato è valido**, quantità assente resta ignota senza movimento zero inventato. Il costo opzionale è convertito esattamente da centesimi interi a EUR con due decimali; NULL non diventa zero. Nessun prezzo di vendita, margine, spesa Finance o pagamento viene inventato.

La conta separata può inizializzare anche una location ancora senza saldo del materiale: crea NULL e poi opening sotto lock nella stessa transazione. Una quantità già nota, incluso zero, impedisce un'altra apertura con UUID diverso. Le variazioni successive usano `/stock` e `adjust_stock`; il loader stock include già entrambi i kind prodotto e packaging.

## Sicurezza e idempotenza

`stock_adjustments_enabled` deve essere true per **nuove** mutazioni. Il modulo non lo attiva. Le ricevute append-only nello schema privato contengono attore, tipo comando, digest SHA-256 del payload canonico ed esito. Stesso UUID/attore/tipo/payload restituisce la ricevuta prima del controllo del flag, quindi il retry è recuperabile anche dopo una disattivazione. Un altro payload, tipo o attore viene rifiutato. Ogni movimento fisico ha un UUID effetto separato, persistito nella ricevuta.

La membership è verificata prima del replay: se l'accesso o una validazione preliminare falliscono durante un retry, l'interfaccia deve conservare il tentativo come incerto. Per la conta, il recupero deve rimanere disponibile anche quando il modulo originale scompare perché la quantità è ormai nota. Non inviare un nuovo UUID per risolvere una risposta persa.

Errori macchina: `membership_required` e `stock_mutations_disabled` (42501), `invalid_payload`, `idempotency_conflict`, `known_stock`, `unknown_packaging`, `invalid_location` (22023), `sku_already_exists` (23505). Non esporre stack, query o parametri grezzi al browser. Le tabelle operative mantengono RLS e audit esistenti; la nuova tabella delle ricevute ha RLS, nessun grant client e blocco UPDATE/DELETE.

## Verifica locale

```sh
node supabase/tests/packaging-materials.mjs /private/tmp/luckylap-sql-validation/node_modules/@electric-sql/pglite/dist/index.js
```

**125 verifiche PASS** con fixture sintetiche e Auth simulato: tutti i ruoli, outsider/revoca, zero distinto da NULL, costo esatto o ignoto, anagrafica distinta dai prodotti, idempotenza e conflitti, flag, conta ripetuta, location mancante, campi alterati e rollback atomico di anagrafica/saldo/ricevuta quando fallisce il registro movimenti. Nessuna mutazione cloud, fonte Drive, vendita reale o abbonamento. Concorrenza su connessioni PostgreSQL reali e interfaccia integrata restano da verificare separatamente.
