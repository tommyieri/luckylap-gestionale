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

In locale `npm run test:db` salta gli harness su PostgreSQL 17 reale (password delle aree, concorrenza di vendite, packaging e conto vendita, Shopify) se manca `LUCKYLAP_PG_BIN`; il riepilogo li elenca come saltati. In CI li esegue il job «Concorrenza (PostgreSQL 17)». Se tocchi queste parti, imposta `LUCKYLAP_PG_BIN` verso la cartella `bin` di un PostgreSQL 17 già presente. Se non c'è, non installarlo: scrivi nella pull request quali harness sono stati saltati e controlla l'esito del job in CI.

Il merge resta comunque di Tommi.

## Formattazione

- Tutto il repository è formattato con Prettier: configurazione in `.prettierrc.json`, esclusioni in `.prettierignore`.
- `npm run format` formatta. `npm run format:check` controlla, e gira anche in CI.
- `npm run format` passa due volte su tutti i file: con alcune catene di metodi, per esempio `vi.fn().mockResolvedValue({ … })`, Prettier cambia ancora il file al secondo passaggio.
- Ogni commit deve lasciare il repository formattato: prima di ogni commit esegui `npm run format`, poi `npm run format:check`. Se il controllo segnala ancora file, ripeti `npm run format`.
- Il commit unico di riformattazione è elencato in `.git-blame-ignore-revs`. Per nasconderlo da `git blame`: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
- Gli hash in `.git-blame-ignore-revs` funzionano solo se arrivano su `main` identici. Una pull request che aggiunge un hash a questo file si unisce con «Create a merge commit», mai con «Squash and merge» o «Rebase and merge»: cambiano gli hash e `git blame` torna a mostrare la riformattazione, senza nessun errore. Se il branch viene ribasato prima del merge, scrivi nel file l'hash nuovo del commit di formattazione. Dopo il merge, `git merge-base --is-ancestor <hash> origin/main` deve uscire con 0.

### Branch iniziati prima della riformattazione

Un rebase diretto su `origin/main` dà conflitti in ogni file toccato. Non risolverli a mano: segui questi passi, con l'albero di lavoro pulito. `<style>` è l'hash elencato in `.git-blame-ignore-revs` su `origin/main` (`git show origin/main:.git-blame-ignore-revs`); `<style>^` è il commit precedente, quello che aggiunge Prettier.

1. `git fetch`, poi `git rebase <style>^`. Qui escono solo conflitti veri, con le modifiche arrivate su `main` prima della riformattazione: risolvili come al solito.
2. `npm ci`: il vecchio `node_modules` non ha Prettier.
3. `git rebase -X theirs --exec "npm run format && git commit -a --amend --no-edit --allow-empty" <style>`. Qui `-X theirs` è sicuro perché `<style>` cambia solo la formattazione, e `--exec` riformatta ogni commit del branch. Se il rebase si ferma su un file che il tuo branch cancella («deleted in … and modified in HEAD»): `git rm <file>`, poi `git rebase --continue`.
4. `git rebase origin/main`, e risolvi come al solito eventuali conflitti veri.
5. `npm run format:check`, poi `git diff --stat origin/main...HEAD`: devono comparire solo i file del tuo lavoro.
6. Ripubblica il branch con `git push --force-with-lease`.

Se qualcosa non torna, `git rebase --abort` e chiedi a Tommi.

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
- Nel modulo Partner (`/partner`) tutti vedono e fanno tutto, Luca compreso.
- Il magazzino centrale (`MAG01`) si chiama «Magadzino»: è il nome voluto, non un refuso, e non si rinomina. «Magazzino» resta la parola generica: sezione del menu, tipo di sede, «il nostro magazzino».

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
