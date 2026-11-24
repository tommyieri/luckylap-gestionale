# Stato delle verifiche della preview

24 novembre 2026. **Lavoro in corso:** sviluppo grafico fermato su indicazione del founder per dare precedenza all’analisi del team AI. Questa pagina non attesta una consegna definitiva o una pubblicazione.

Eseguiti sulla preview locale: navigazione home/catalogo/schede, scelta modello, taglia e colore, foto White verificate per 964 e GT3 RS, aggiunta alla borsa locale, quantità, rimozione, ricerca, menu mobile, Escape e ritorno del focus. Controllata l’assenza di overflow orizzontale nei viewport 320, 390, 768, 1024 e 1440 px. Nessun permalink di checkout è stato aperto durante questa prova. Nessun ordine o pagamento.

La revisione indipendente ha chiesto una descrizione neutra rispetto al colore, l’allineamento della miniatura alla variante e focus visibile sul verde. Correzioni applicate ai sorgenti; ricattura finale e verdetto successivo ancora da completare. Le catture full-page non caricano necessariamente tutte le immagini lazy: rimane da portare la sezione fondatori nel viewport e verificarla prima della consegna definitiva.

Tema nativo: validazione locale su 45 file e 14 controlli JavaScript con dati sintetici, come descritto in shopify/README.md. Dopo l’ultima modifica alla CSS, il pacchetto va rigenerato. Nessun tema caricato o provato installato tramite Shopify; il connettore richiede autenticazione per i file del tema.

Controlli del repository eseguiti dopo aver installato le dipendenze nelle versioni del lockfile del progetto: typecheck passato; npm test passato (277 file, 6098 test); npm run test:db passato con PGlite (46 harness, 7916 controlli). I 23 harness PostgreSQL 17 sono saltati perché non è impostato LUCKYLAP_PG_BIN; le parti di database non sono state modificate da questo lavoro. npm run format e format:check passati. npm run build non eseguito in questa fase interrotta: nessuna PR aperta e nessuna attestazione di release.

Il gate headless completo di Taste Skill non è stato eseguito. Le verifiche dichiarate hanno il solo perimetro sopra descritto. L’audit tecnico del sito pubblicato appartiene al dossier di analisi del team e non misura il redesign.
