# Catalogo commerciale Shopify

La migrazione `20261021131250_shopify_catalog.sql`, creata con `supabase@2.121.0 migration new shopify_catalog`, aggiunge `public.shopify_catalog_variants`. Contiene identità, descrizioni e prezzi osservati su Shopify. L’inventario fisico continua a provenire dal conteggio Drive e dai successivi movimenti del gestionale.

La chiave primaria è `(shop_domain, variant_gid)`. I campi sono `shop_domain`, `variant_gid`, `product_gid`, `sku`, `product_title`, `product_type`, `status`, `price_cents`, `currency_code`, `source_updated_at`, `observed_at` e `stock_item_id`. Il dominio è il nome canonico minuscolo `*.myshopify.com`; i GID distinguono Product e ProductVariant. Gli stati ammessi sono `ACTIVE`, `DRAFT`, `ARCHIVED`. Gli SKU sono esatti, non vuoti e senza spazi aggiunti. La valuta è vincolata a EUR e il prezzo è un intero non negativo in centesimi.

Un indice univoco impedisce due varianti `ACTIVE` con lo stesso SKU nello stesso shop. Un altro impedisce due collegamenti allo stesso articolo fisico nello stesso shop, anche per varianti archiviate: prima di sostituire un’identità, l’import amministrativo deve rimuovere esplicitamente il vecchio collegamento. Lo stesso GID o articolo può esistere in uno shop diverso.

`stock_item_id` è opzionale. Quando presente, il trigger verifica che l’articolo esista, sia `kind = product` e abbia lo stesso SKU, rispettando maiuscole e minuscole. Un prodotto sconosciuto rimane con `stock_item_id = NULL`; ciò non significa giacenza zero. Una modifica amministrativa futura dello SKU fisico richiede di riconciliare anche questo collegamento. Gli adesivi venduti su Shopify non vengono classificati come adesivi del packaging.

Non esistono colonne per quantità Shopify, disponibilità o inventario. Nessun trigger del catalogo modifica `stock_items`, `stock_balances`, `stock_movements`, ordini, pagamenti o Finance. Questa migrazione non implementa ancora lettura degli ordini o webhook Shopify.

## Accesso

RLS consente `SELECT` ai membri attivi correnti di tutti e cinque i ruoli, anche con `aal1`. Un utente autenticato esterno, una membership disattivata o un’identità mancante non vede righe; `user_metadata` non concede accesso. La revoca della membership ha effetto sulla richiesta successiva.

I client non hanno INSERT, UPDATE, DELETE, TRUNCATE, grant di colonna o RPC di scrittura, incluso il founder. Sono revocati anche gli eventuali grant automatici preesistenti a `PUBLIC`, `anon` e `service_role`; soltanto `authenticated` riceve `SELECT`. L’import si esegue come owner SQL amministrativo, senza distribuire chiavi privilegiate al browser o aggiungere endpoint di scrittura.

La separazione tra grant e RLS segue la [documentazione Supabase sull’accesso alla Data API](https://supabase.com/docs/guides/api/securing-your-api). Il changelog e la documentazione correnti sono stati consultati prima della migrazione.

## Import amministrativo

Il manifest privato autorizzato `.private/shopify-catalog.json` contiene 60 varianti attive in EUR, osservate il 21 ottobre 2026. La verifica locale del manifest contro la sorgente inventario autorizzata ha restituito:

- 60 GID e 60 SKU distinti;
- 51 SKU fisici abbinati esattamente, nessuno mancante;
- 51 prezzi coincidenti con i listini Drive;
- 9 varianti commerciali senza abbinamento fisico, tutte di tipo `Sticker`;
- nessun campo quantità nel manifest delle varianti.

Questi conteggi descrivono i file verificati, non attestano un import cloud. Il coordinatore ha verificato separatamente la completezza della ricerca Shopify e applica/importa il catalogo.

Per ogni variante, usare `shop.myshopifyDomain`, `variant.id`, `variant.product.id`, `variant.sku`, titolo/tipo/stato del prodotto, `variant.updatedAt` come `source_updated_at` e `retrievedAt` come `observed_at`. Convertire il prezzo decimale con aritmetica esatta in centesimi, rifiutando frazioni di centesimo e valute diverse da EUR. Cercare l’eventuale articolo `kind = product` mediante SKU esatto; in assenza di corrispondenza usare NULL. Non creare articoli per ottenere un abbinamento.

Eseguire l’import in una transazione owner e usare `(shop_domain, variant_gid)` per eventuali aggiornamenti, confrontando i timestamp della sorgente per evitare di sovrascrivere osservazioni più recenti. Riconciliare esplicitamente varianti non più attive; l’assenza in una lista parziale non prova una cancellazione. Conservare il manifest fuori da Git e dal bundle Vercel. La migrazione non incorpora dati di produzione. Ogni INSERT/UPDATE/DELETE owner produce un record audit con attore NULL (sistema), chiave composta shop/GID, eventuale articolo fisico e dati prima/dopo; la funzione trigger non è eseguibile dai client.

## Verifica

`supabase/tests/shopify-catalog.mjs` esegue **103 controlli** su PostgreSQL incorporato con Auth simulato: cinque ruoli e livelli di autenticazione, utenti esterni/disattivati, revoca immediata, no anon, nessuna scrittura client o grant ereditato, vincoli di identità/valuta/prezzo, abbinamenti sconosciuti o errati, audit di import/aggiornamento/rimozione e assenza di effetti sulle scorte. Il test abilita appositamente grant di default permissivi prima della migrazione per controllare che vengano rimossi.

La prova locale non sostituisce la verifica JWT/PostgREST e gli advisor dopo l’applicazione nel progetto. Nessuna operazione cloud viene eseguita dal test.
