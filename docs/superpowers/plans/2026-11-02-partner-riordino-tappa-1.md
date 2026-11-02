# Riordino Partner: piano della prima consegna

**Obiettivo:** rendere leggibile il lavoro Partner con quattro sezioni permanenti e una raccolta delle risposte già registrate.

**Specifica:** [Progetto approvato](../specs/2026-11-02-partner-riordino.md).

**Architettura:** letture aggiuntive delle tabelle esistenti, isolate dagli errori della lista base; fase derivata in una funzione pura; viste e filtri condivisi nell'indirizzo. Nessun cambiamento al worker o alle scritture.

**Vincoli:** AGENTS.md, italiano, dati sintetici, identità esistente, nessuna migrazione o dipendenza nuova. Branch da origin/main aggiornato e pubblicato.

## Attività

- [x] Dati e fase: `work.ts`, parser dedicati, `model.ts`, `server.ts`, fixture e test. Produce `workspace.work`, `partnerWorkView` e `comparePartnerWork`. RED/GREEN su precedenza, blocchi, invii incerti, dati mancanti, errori isolati e solleciti aperti.
- [x] Viste e lista: `filters.ts`, `partner-workspace.tsx`, `partner-row.tsx`, CSS e test. Consuma i dati del punto precedente. RED/GREEN su sezioni sempre disponibili, risposte fuori periodo e con stage avanzato, ordinamento, link diretti e navigazione preservata.
- [x] Scheda: `partner-details.tsx`, `partner-assistant-block.tsx` e test. RED/GREEN su bozza visibile prima della ricerca, ultima risposta, disclosure dei dati secondari e avviso prima degli effetti sull'idoneità dell'assistente.
- [x] Testi e collegamenti: guida, Oggi e Partner nel Team; striscia con invio e preparazione distinti, senza spesa sulla lista. Conserva i link supportati dal feed CEO e tutti i comandi esistenti.
- [x] Revisione indipendente, verifica browser desktop/telefono, cinque controlli di AGENTS.md e formattazione. Nessuna azione di produzione.

La consegna passa da commit sul branch pubblicato e pull request; merge e produzione restano a Tommi.

## Esito delle verifiche

Typecheck e build superati; 229 file di test, 4.284 test superati. `test:db`: 32 harness PGlite superati, 6.231 controlli; 19 harness PostgreSQL 17 saltati perché `LUCKYLAP_PG_BIN` non è configurato, da verificare nel job CI «Concorrenza (PostgreSQL 17)». Formattazione e revisione finale superate. Browser verificato a 1280, 390 e 320 pixel, con dati sintetici e scritture disattivate.

## Casi da verificare nella revisione finale

1. Una risposta non sparisce dietro periodo, stage o link diretto.
2. Un contatto multisezione resta una sola scheda e compare nelle sezioni pertinenti, anche negli accordi.
3. Un errore operativo mostra un avviso senza disattivare o nascondere l'interruttore dell'assistente.
4. Un invio incerto resta visibile con qualunque fase commerciale.
5. Da telefono testo lungo, destinatario e controlli restano leggibili, con focus e bersagli adeguati.
