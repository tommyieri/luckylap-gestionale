# LuckyLap — prima versione locale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fornire una prima versione locale navigabile del gestionale con inventario Drive e calendario interno, rispettando sospensione Vendite/Finance e assenza di abbonamenti.

**Architecture:** Next.js con TypeScript, componenti accessibili e stile coerente con il progetto Partner. Snapshot inventario locale con provenienza, separato dalle future operazioni autenticate su Supabase. Modalità anteprima esplicita soltanto in sviluppo locale; configurazione mancante chiude l’accesso in produzione.

**Tech Stack:** Next.js, React, TypeScript, CSS, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-gestionale-luckylap-design.md`.

## Global Constraints

- Inventario autorevole: LuckyLap_Gestione_inventario.xlsx su Drive; quantità Shopify escluse.
- Vendite sospese, Finance in attesa dei file di Gherardo.
- Tutti vedono costi/margini e possono applicare sconti/rettifiche; Finance solo founder/Gabriele/Gherardo, Controllo solo founder.
- Packaging: scatole per magliette e adesivi dedicati, distinti dagli sticker Shopify.
- Conto vendita 60/40, 60 a LuckyLap, prezzo negozio +10 EUR rispetto al web.
- Calendario interno. Nessun abbonamento. Nessun deploy commerciale Vercel Hobby.
- Drive sola lettura e limitato alle fonti autorizzate. Nessuna modifica al repository Partner.

## Review Focus

- Scorte: zero, valori mancanti e valori salvati non ricalcolati devono conservare il significato della fonte.
- Sicurezza: anteprima locale e configurazione Supabase mancante non devono diventare un login fittizio o accesso a dati riservati.
- Calendario: orari Europe/Rome, date storiche non trasformate in appuntamenti e nessun evento inventato presentato come reale.
- Importazione: record stabili e fonte/cella mantengono verificabile lo snapshot; nessuna riga Vendite inclusa.
- Accessibilità: navigazione da tastiera, responsive, focus, etichette e stati vuoti utili.

## Task 1 — Snapshot inventario autorizzato

**Files:** `data/inventory-source.json`, `data/inventory-source-notes.md`, `src/lib/inventory.ts`, `src/lib/inventory.test.ts`.

**Interfaces:** il JSON conserva metadata fonte e record delle sole schede autorizzate. `loadInventory()` normalizza in `InventoryItem[]`, mantenendo `quantity: number | null`, magazzino e cella sorgente. Lo schema effettivo del JSON va verificato prima di scrivere il caricatore.

- [x] Leggere le quattro schede inventario autorizzate in sola lettura e salvare dati locali con riferimenti alle celle. Nessuna riga vendita o correzione Shopify.
- [x] Scrivere test per zero vs mancante, record senza SKU, quantità per sede e totale senza doppio conteggio.
- [x] Eseguire i test per osservare il fallimento prima del caricatore.
- [x] Implementare caricatore e filtri tipizzati, senza ricalcolo della disponibilità storica.
- [x] Eseguire i test e controllare un campione contro le celle di origine.

## Task 2 — Applicazione e moduli operativi locali

**Files:** `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/components/management-app.tsx`, `src/lib/team.ts`, `src/lib/team.test.ts`.

**Interfaces:** `canAccessModule(memberId, module)` restituisce il diritto applicativo; `InventoryItem` proviene da Task 1. La UI riceve snapshot e metadata dal server, con sezioni determinate dal percorso interno.

- [x] Impostare il progetto e i comandi `dev`, `build`, `test`, `typecheck`.
- [x] Scrivere test dei permessi per tutte le cinque persone: Finance/Controllo ristretti e costi/margini/sconti/rettifiche condivisi.
- [x] Implementare navigazione, home, magazzino con ricerca/filtri e scheda prodotto, packaging senza quantità inventate e sezioni di attesa per Vendite e Finance.
- [x] Implementare calendario e note locali chiaramente distinti dai dati di produzione; nessun invito esterno o sincronizzazione Google Calendar.
- [x] Mantenere l'anteprima riconoscibile e i dati Finance assenti.
- [x] Verificare `npm test`, `npm run typecheck` e `npm run build`.

## Task 3 — Predisposizione Supabase e tracciamento

**Files:** `.env.example`, `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `supabase/migrations/202610210001_initial_schema.sql`, `README.md`.

**Interfaces:** nessuna credenziale reale nel repository. Account autenticato e membership governano RLS; audit generato dal database. Il client di anteprima non può richiedere dati con privilegi amministrativi.

- [x] Definire schema per membership, inventario, movimenti, calendario, attività, note, asset e registro operazioni; Finance/Vendite restano predisposizioni senza dati importati.
- [x] Impostare policy per utenti invitati, privilegi operativi condivisi, Finance riservato e audit solo founder.
- [x] Aggiungere client Supabase e gestione esplicita della configurazione mancante.
- [x] Documentare avvio locale, import origine, configurazione Free, limiti e verifiche che richiedono database reale. Nessun deploy o attivazione account.

## Task 4 — Verifica e consegna

**Files:** eventuali correzioni ai file precedenti, `docs/verification.md`, immagini di revisione locali.

- [x] Eseguire test, controllo TypeScript e build.
- [x] Avviare il server locale e verificare desktop e telefono, navigazione, ricerca inventario, calendario e stati vuoti in una sola passata.
- [x] Correggere insieme i difetti riscontrati e confermare in un'ultima passata.
- [x] Richiedere revisione indipendente dei permessi e dell'aderenza ai vincoli, indicando le verifiche non eseguibili senza Supabase configurato.
- [x] Consegnare anteprima e sorgenti, distinguendo ciò che funziona in locale dall'attivazione multiutente ancora da completare.

## Estensione richiesta successivamente — repository, Auth e Finance

Il founder ha consegnato tre fonti Finance e richiesto un nuovo repository privato. Questa estensione non riattiva il modulo Vendite e non autorizza abbonamenti.

- [x] Creare e verificare `tommyieri/luckylap-gestionale` come privato, con remote dedicato.
- [x] Analizzare gli allegati in sola lettura, conservando provenienza, input mancanti e conflitti in staging escluso da Git/deploy.
- [ ] Integrare login personale su invito, membership DB, logout, MFA e caricamento inventario da Supabase senza fallback locale in produzione.
- [ ] Preparare migrazione/import Finance idempotente e revisione dei duplicati, con test di isolamento e fixture sintetiche.
- [ ] Eseguire revisione mirata e verifiche finali del codice esteso, poi pubblicare il codice nel repository privato.
- [ ] Collegare il progetto Supabase Free effettivo, applicare e verificare schema/import con sessioni reali. Dipende dal collegamento del plugin da parte del founder.
- [ ] Pubblicare su una destinazione compatibile: Vercel Hobby non consente l’uso aziendale, nessun upgrade o abbonamento autorizzato.
