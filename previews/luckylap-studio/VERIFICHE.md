# Verifiche della preview e limiti della consegna

Aggiornamento 25 novembre 2026. La home è una prima versione funzionante della sequenza GT3 RS → F40 controllata dallo scroll. È un’anteprima da rivedere insieme; nessuna pubblicazione o modifica di produzione.

## Browser e revisione

Controllati desktop 1440×900 e telefono 390×844; verificato anche il layout a 320×720. Scorrimento avanti e indietro, modello/CTA/prezzo coerenti, salto al catalogo, modalità statica, navigazione scheda, taglia M, borsa locale, quantità/rimozione, guida taglie aperta tramite link con sei righe. Le condizioni approvate dal founder si leggono da un file esterno al repository e compaiono in scheda e borsa. Nessun permalink esterno di checkout aperto durante questa fase, nessun pagamento o dato cliente inserito. Console browser senza errori rilevati.

Il revisore indipendente ha chiesto di correggere il morph intermedio mobile e ricatturare la borsa dopo l’apertura. Il passaggio composto è stato sostituito da sette contorni corrispondenti; acquisiti tre punti centrali per desktop e telefono. Verdetto finale: entrambi i rilievi risolti. È un verdetto circoscritto alle correzioni, non una certificazione completa di accessibilità o conversione. Le prime catture desktop denominate “fix” erano fuori fase e sono state sostituite con prove dal progresso verificato. La borsa finale ha opacità 1 e superficie piena.

Le preferenze di movimento ridotto sono implementate in CSS/JS; è stata provata la modalità statica del controllo. Non è stata modificata la preferenza del sistema operativo né eseguita una prova su telefono fisico. Le catture sono locali e ignorate da Git in .impeccable/review/2026-11-25/.

La revisione e la documentazione sono state affidate a subagenti indipendenti generici; gli agenti predefiniti Impeccable non sono esposti dal runtime. Il detector meccanico sui nuovi file scena non ha riportato rilievi. Non è stato eseguito il gate headless completo Taste Skill.

## Tema Shopify

Validazione completa del tema su 60 file senza errori o warning; sintassi JavaScript, riferimenti asset e adapter verificati. Conservati form prodotto, quantità, carrello e checkout Shopify nativi. La scena ha eventi di caricamento/scaricamento delle sezioni e fallback statico. Test dell’adapter e overlay ZIP svolti con dati sintetici. I livelli elaborati dell’animazione sono distinti dalle foto nelle schede prodotto.

Il tema non è stato caricato né collaudato installato. L’accesso ai file del tema nel connettore richiede nuovamente autenticazione. Le associazioni foto/varianti, menu, guida taglie, pagine e condizioni effettive dello shop richiedono il controllo nella copia non pubblicata, come descritto in shopify/README.md.

## Controlli del repository

- Typecheck passato.
- Test: 278 file e 6112 test passati con maxWorkers=2. La prima esecuzione contemporanea a build/PGlite aveva due timeout in test Partner preesistenti; la ripetizione a concorrenza limitata è passata senza modificare quei test.
- SQL: 46 harness PGlite, 7916 controlli passati. I 23 harness PostgreSQL 17 sono saltati perché manca LUCKYLAP_PG_BIN; nessuna parte transazionale SQL è modificata.
- Sonda permessi Shopify: 14 test sintetici Node/Vitest passati; quattro query validate Admin API 2026-10. Non eseguita con la credenziale interna in produzione.
- La build Next del gestionale ha compilato, controllato i tipi e generato le pagine; è terminata con codice 1 per SecurityFatalError sulla versione Next.js corrente. Il secondo tentativo ha restituito lo stesso avviso. Nessun aggiornamento dipendenze o disattivazione del controllo è stato applicato. Per questo non si attesta una build completa passata e non si apre una PR; il branch rimane una consegna in corso da revisionare. next-env.d.ts ripristinato dopo la build.
- Formattazione finale controllata prima del commit.

L’anteprima è un server Node indipendente e non usa Next.js. Il suo funzionamento non prova la salute della build del gestionale. La pubblicazione richiede ancora i controlli previsti dal progetto e l’OK del founder.
