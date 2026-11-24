# Fallback Partner: recupero e guardia prima del catalogo

Il controllo introdotto per riprendere le altre proposte poteva leggere il catalogo degli eventi anche senza alcuna attestazione di esaurimento. La funzione SQL combinava più condizioni con `AND`: quell'ordine non garantisce una valutazione anticipata della prova. La lettura della coda ripeteva il controllo per ogni candidato, rallentando il Programma email e i claim del mittente.

## Le due migrazioni

1. `20261124095231_partner_fallback_recupero_temporaneo.sql` è il recupero temporaneo già applicato in produzione con l'autorizzazione al rilascio. In una transazione blocca in modalità SHARE la tabella delle attestazioni, verifica che sia vuota e sostituisce soltanto `partner_event_fallback_check` con un ritorno `NULL`. Se esiste una sola attestazione, rifiuta l'operazione. Gli eventi conservano il loro percorso; le altre proposte restano ferme.
2. `20261124095335_partner_fallback_guardia_rapida.sql` prepara la verifica permanente in PL/pgSQL. Prima legge l'ultima attestazione e controlla valore nullo, revoca, creazione futura, scadenza esatta, decorrenza e founder ancora attivo. Soltanto dopo legge il catalogo una volta, riusando lo stesso JSON per impronta e contatti residui. L'applicazione di questa seconda migrazione richiede l'OK sul risultato verificato.

Nel percorso collettivo, il ranking materializza una sola verifica del fallback e conserva ordine, regimi e guardie operative. Il Programma email riusa la prova già letta per determinare l'idoneità delle righe. Prima di richiamare il controllo completo della policy, un `CASE` esclude lavori senza bozza, bozze precedenti alla prova o future ed eventi. Le poche bozze nuove delle altre categorie conservano il controllo originale della policy. Il contratto JSON non cambia.

Signature, tipo restituito, attributo STABLE, security invoker, search path e grants della funzione restano invariati. Il controllo conserva la semantica dell'ultima attestazione, anche se revocata, futura o scaduta; l'inizio è incluso e la scadenza esclusa. `p_at=NULL` restituisce `NULL`.

Non cambiano l'approvazione del founder per gli eventi, il requisito delle nuove bozze non evento, il limite di sei prime email complessive, i solleciti, il calendario o il congelamento degli slot. Nessuna delle due migrazioni registra attestazioni, avvia worker o invia messaggi.

## Prove

Il nuovo harness `partner-fallback-fast-guard.mjs` usa PGlite e dati sintetici. Un catalogo con contatore riproduce due letture nella vecchia funzione con zero attestazioni; il recupero e il fix non lo chiamano. Una prova valida richiede una sola lettura. Un secondo stub che solleva un'eccezione rende verificabile l'assenza di chiamate prima delle guardie, senza affidarsi al tempo trascorso.

Lo stesso harness carica in memoria le 119 regressioni già esistenti, senza modificarne il file, applicando le due migrazioni in ordine. Aggiunge un benchmark del vero `read_partner_email_program` e della coda su 850 candidati sintetici: il catalogo non deve essere chiamato. Le fixture del benchmark sono annullate con un savepoint. La durata viene riportata, senza una soglia temporale instabile.

Il benchmark comprende anche una prova valida, il catalogo vero e cinque eventi futuri gestiti manualmente. Prima della condivisione della prova, 850 candidati richiedevano circa 45,9 secondi in PGlite. Dopo la modifica, lo stesso caso richiedeva circa 0,6 secondi; 850 lavori senza bozza circa 5,1 secondi. Senza attestazioni il tempo osservato era circa 0,4 secondi. Le verifiche controllano l'idoneità delle 850 schede e l'assenza di finestre fallback per i lavori senza bozza, senza imporre soglie di tempo.

Dopo il recupero, le sole letture di produzione con timeout di 15 secondi hanno restituito 798 righe: circa 5,1 secondi per un giorno e 4,3 secondi per quattordici giorni, inclusa la chiamata al connettore. I parser TypeScript reali e il forecast sono passati su entrambi i payload. La previsione comprendeva soltanto eventi, nessuna finestra di fallback e al massimo sei prime email per giorno. Queste durate sono osservazioni, non una garanzia di prestazioni.

I payload reali rimangono nell'area privata del rilascio, fuori dal repository e dalle fixture. La verifica non ha richiamato planner, worker o SMTP. La seconda migrazione resta distinta dal recupero già applicato e dalla successiva approvazione di produzione.
