# graphify

- When the user types `/graphify`, use the installed graphify skill at `~/.Codex/skills/graphify/SKILL.md` (or its installed equivalent) before doing anything else.

# Regole di lavoro per gli agenti (Claude e Codex)

## Chi lavora dove

- Su questo repository lavorano due agenti: Codex in `/Users/tommi/Documents/ChatGPT/Gestionale LuckyLap` e Claude in `/Users/tommi/luckylap-gestionale`.
- Un branch per ogni lavoro. Prima di iniziare: `git fetch`, poi crea il branch da `origin/main` aggiornato.
- Pubblica sempre il tuo branch su `origin`, anche a lavoro non finito: così l'altro agente lo vede.
- Mai due agenti sugli stessi file nello stesso momento.
- Se il lavoro tocca file già modificati in un altro branch aperto, fermati e chiedi a Tommi. Unica eccezione: `docs/README.md` (vedi «Lingua e documenti»).
- Per vedere i branch aperti: `git fetch`, poi `git branch -r`. Per vedere i file di un branch: `git diff --name-only origin/main...origin/<branch>`.
- Questo controllo vede solo i branch pubblicati su `origin`. Il lavoro non pubblicato dell'altro agente resta invisibile, e Claude non legge la cartella di Codex. Se devi toccare un file in comune (per esempio `package.json`, le migrazioni o questo file) e non trovi su `origin` il branch dell'altro agente, chiedi a Tommi prima di modificarlo.

## Serve l'OK di Tommi

- Senza un OK esplicito di Tommi in chat, non fare mai:
  - push su `main` o merge;
  - migrazioni applicate o scritture sul database di produzione (Supabase);
  - modifiche alle impostazioni di Supabase, Vercel o Shopify;
  - deploy di produzione.
- Aprire o aggiornare una pull request va bene, dopo i controlli della sezione seguente.

## Prima di aprire o aggiornare una pull request

Devono passare questi comandi, con le eccezioni scritte sotto. Riporta l'esito nella pull request.

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:db`
- `npm run format:check` (vedi «Formattazione»)

Se la build modifica `next-env.d.ts`, ripristinalo con `git checkout -- next-env.d.ts`.

In locale `npm run test:db` salta i cinque harness su PostgreSQL 17 reale (password delle aree, concorrenza, Shopify) se manca `LUCKYLAP_PG_BIN`. In CI li esegue il job «Concorrenza (PostgreSQL 17)». Se tocchi queste parti, imposta `LUCKYLAP_PG_BIN` verso la cartella `bin` di un PostgreSQL 17 già presente. Se non c'è, non installarlo: scrivi nella pull request quali harness sono stati saltati e controlla l'esito del job in CI.

Il merge resta comunque di Tommi.

## Formattazione

- Se `package.json` non ha ancora lo script `format:check`, il controllo non si applica: scrivi nella pull request che è stato saltato.
- Usa la configurazione Prettier del progetto, quando c'è.
- Un commit funzionale non riformatta file che non tocca.
- Se `format:check` segnala file che non hai toccato, non riformattarli: basta che siano formattati i file modificati nel tuo branch. Scrivi nella pull request quali file segnala.
- La riformattazione di tutto il repository va in un commit separato, di sola formattazione, con l'OK di Tommi.

## Il Mac resta pulito

- Niente installazioni globali o modifiche di sistema: niente Homebrew, `npm -g`, `pip` di sistema, file in `/opt/homebrew` o `/usr/local`, link OpenSSL, servizi persistenti.
- Dipendenze solo nel progetto, con versioni esatte.
- Strumenti esterni per i test solo in cartelle temporanee, cancellate alla fine.

## Dati

- Nei nuovi file, test e fixture: nessun dato personale o finanziario reale, solo dati sintetici. Niente email, telefoni, IBAN o importi reali. Niente export BudgetFlow.
- Eccezioni già presenti nel repository:
  - lo snapshot dell'inventario Drive, con costi e prezzi: `data/inventory-source.json` e `supabase/inventory-initial.sql`;
  - la casella aziendale `info@luckylap.com` in `README.md` e in `docs/deployment.md`.
- Queste eccezioni servono all'import dell'inventario e ai test SQL. Non toglierle e non ripulirle senza l'OK di Tommi. Non copiarne i valori in nuovi test o fixture.
- I segreti restano fuori dal repository: `.env` e `.env.local` non si committano.

## Decisioni del founder (21 ottobre 2026)

Valgono già:

- La password condivisa dai cinque account è voluta: non è un difetto da correggere.
- Hosting e backup restano come sono finché Tommi non decide.
- Nel prossimo modulo Partner tutti vedranno e faranno tutto.

Da fare, ognuna in un lavoro dedicato e solo con l'OK di Tommi. Oggi il codice fa ancora diversamente: non correggerlo di passaggio in altri lavori.

- Finance: ogni operazione dovrà essere modificabile, conservando lo storico. Oggi il registro è immutabile e si corregge con `void_finance_entry` (vedi `docs/finance-work.md`). `npm run test:db` verifica che resti immutabile.
- «Controllo CEO» dovrà mostrare solo un feed leggibile di cosa fanno i colleghi (per esempio «Luca ha aggiunto una call»). Oggi `/audit` mostra il registro tecnico dei trigger (vedi `docs/audit-workspace.md`).

## Lingua e documenti

- Documenti e testi dell'interfaccia in italiano.
- L'indice dei documenti è [docs/README.md](docs/README.md): aggiornalo quando aggiungi un documento.
- Per l'indice non serve fermarsi se è modificato anche in un altro branch. Aggiungi o cambia solo le righe dei tuoi documenti. Gli eventuali conflitti si risolvono al merge.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
