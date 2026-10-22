# Indice dei documenti

Tutti i documenti della cartella `docs/`, divisi per area. Quando aggiungi un documento, aggiungilo anche qui.

Fuori da questa cartella: [regole per gli agenti](../AGENTS.md), [prodotto](../PRODUCT.md), [design](../DESIGN.md) e [README del progetto](../README.md).

I documenti segnati «in parte superato» raccontano decisioni o versioni precedenti: non sono regole attuali. Per lo stato attuale valgono il [README del progetto](../README.md), [deployment.md](deployment.md) e [authentication.md](authentication.md).

Alcuni documenti scritti prima del modello attuale chiedono ancora una sessione `aal2` (MFA) per Finance e Controllo CEO. Oggi queste aree si aprono con le loro password: vale [authentication.md](authentication.md).

## Piano e aggiornamenti

- [Piano approvato, versione 0.3](2026-10-21-piano-gestionale-luckylap.md): decisioni iniziali del founder, 21 ottobre 2026. In parte superato: vendite e Shopify sono attivi dal 21 ottobre e l'app è pubblicata su Vercel Hobby. Stato attuale in [deployment.md](deployment.md).
- [Aggiornamenti operativi del 21 ottobre](aggiornamenti-operativi-2026-10-21.md): ordinamento dell'inventario, condivisione, packaging, Finance e verifiche di rilascio.
- [Specifica iniziale](superpowers/specs/2026-10-21-gestionale-luckylap-design.md): finalità, persone e moduli previsti all'inizio. In parte superata: vendite e Finance oggi sono attivi. Stato attuale nel [README del progetto](../README.md) e in [deployment.md](deployment.md).
- [Piano della prima versione locale](superpowers/plans/2026-10-21-prima-versione-locale.md): piano di implementazione della prima versione navigabile, con inventario Drive e calendario interno. In parte superato: prevedeva vendite e Finance sospesi.

## Accesso e sicurezza

- [Accesso del team e password delle aree](authentication.md): login con la password comune del workspace e password separate per Finance e CEO.
- [Inviti e password del team](inviti-account.md): conferma degli inviti e scelta della password per gli account creati dal founder.
- [Password delle aree riservate](area-passwords-backend.md): migrazione e funzioni RPC delle password per le aree Finance e audit (CEO).
- [Controllo riservato al founder](audit-workspace.md): pagina `/audit`, registro in sola lettura delle modifiche salvate nel database. In parte superato: chiede ancora una sessione `aal2`. Per l'accesso vale [authentication.md](authentication.md).

## Magazzino e packaging

- [Rettifiche del magazzino condiviso](stock-interface.md): pagina `/stock/rettifiche` per consultare le quantità e registrare variazioni motivate.
- [Packaging T-shirt nel database](packaging-backend.md): scatole e adesivi, prenotazioni, consumo alla consegna e rettifiche.
- [Interfaccia packaging](packaging-interface.md): pagina `/packaging` semplificata, con due materiali, carenze e modifica della quantità.

## Vendite e Shopify

- [Ecosistema vendite](ecosistema-vendite.md): contratto tra vendite, magazzino, produzione e Finance, con le fonti e il significato dei numeri.
- [Nucleo transazionale vendite](sales-ecosystem-backend.md): RPC `register_manual_sale` e ciclo produzione e consegna, ognuno in una sola transazione.
- [Vendite e produzione condivise](sales-interface.md): pagina `/sales` collegata alle RPC del nucleo transazionale.
- [Catalogo commerciale Shopify](catalog-shopify.md): tabella `shopify_catalog_variants` con varianti, prezzi e collegamento agli SKU fisici.
- [App interna Shopify](shopify-app-setup.md): preparazione e installazione dell'app «LuckyLap Gestionale» senza nuovi abbonamenti.
- [Collegamento Shopify](shopify-bridge.md): verifica della firma HMAC delle notifiche webhook in `src/lib/shopify/webhook.ts`.
- [Ricevitore Shopify e inbox](shopify-receiver.md): route `POST /api/integrations/shopify/webhook` che salva ricevuta e job.
- [Reader canonico Shopify](shopify-canonical-reader.md): lettura di un ordine tramite Admin GraphQL 2026-10, senza scritture.
- [Ordini Shopify e POS](shopify-ecosystem.md): migrazioni, provenienza degli ordini, inventario e worker duraturo.
- [Worker ordini Shopify](shopify-worker.md): route `POST /api/integrations/shopify/worker`, credenziali e pianificazione.
- [Ordini Shopify nelle viste](shopify-sales-finance-interface.md): come gli ordini Shopify compaiono in Vendite e in Finance.
- [Stato Shopify nella pagina Vendite](shopify-sync-health.md): blocco `ShopifySyncHealth` con stato della sincronizzazione e casi da verificare.

## Finance

- [Import Finance da BudgetFlow](finance-import.md): import riservato delle righe sorgente, tutte da revisionare, con il contratto di provenienza.
- [Conti, andamento e categorie](finance-dashboard.md): panoramica `/finance` e regole del calcolo dei saldi.
- [Fatti collegati e lavoro manuale](finance-work.md): pagina `/finance/work` con fatti delle vendite e registrazioni manuali.

## Conto vendita

- [Conto vendita](consignment.md): modulo `/consignment` con negozi, conta in negozio, resoconto mensile da fatturare (60% LuckyLap, 40% negozio), pagamenti in Finance e ordini del negozio.

## Partner

- [Partner nel gestionale](partner.md): pagina `/partner` con contatti, periodi, messaggi e stati, import della ricerca e dei file «Esporta», lookbook, privacy e GitHub Pages.

## Team, contenuti e sviluppo

- [Layout condiviso e navigazione](workspace-layout.md): guscio comune a tutte le pagine, mappa delle sezioni, token di stile e regole per le pagine nuove.
- [Guida «Come si usa»](workspace-layout.md#la-guida-come-si-usa): pagina `/guida` per i cinque del team e regole per tenerla allineata all'app.
- [Workspace condiviso del team](team-workspace.md): route `/team` con calendario e call, attività e note nel database.
- [Libreria del brand e sviluppo prodotti](assets-development.md): route `/assets` e `/development`, con bucket privato per gli originali.
- [Ricerca UI UX Pro Max](ui-ux-pro-max-research.md): fonte, licenza e comandi della ricerca usata per l'interfaccia.

## Verifiche

- [Verifiche LuckyLap](verification.md): riepilogo delle prove su dati reali, applicazione e SQL, Auth cloud e pubblicazione.
- [Verifica Auth, MFA e REST](verifica-auth-cloud.md): 52 prove reali sul progetto Supabase con un account QA temporaneo. Riguardano la prima implementazione, non il modello attuale: vedi [authentication.md](authentication.md).
- [Verifica della concorrenza](verifica-concorrenza.md): 39 controlli in 7 casi su PostgreSQL reale con connessioni distinte.
- [Verifica delle importazioni](verifica-import-cloud.md): controllo in sola lettura di inventario e BudgetFlow importati in Supabase.
- [Verifica pg_net](verifica-pg-net.md): confine di accesso alla coda `pg_net` dopo la migrazione dello scheduler, in sola lettura.
- [Verifica Shopify nel cloud](verifica-shopify-cloud.md): controllo indipendente in sola lettura di migrazioni e dati Shopify.
- [Verifica del collegamento Shopify attivo](verifica-shopify-live.md): verifica finale in sola lettura di dati, configurazione e scheduler.

## Backend e pubblicazione

- [Backend Supabase](backend.md): schema iniziale, import dell'inventario e permessi di accesso ai dati.
- [Collegamento cloud](deployment.md): GitHub, Vercel e Supabase, import, accessi e avvio operativo del 21 ottobre 2026.
