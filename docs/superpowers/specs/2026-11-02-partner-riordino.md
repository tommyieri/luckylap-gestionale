# Partner: lavoro leggibile e risposte

Progetto approvato in chat il 2 novembre 2026. Questa specifica separa il risultato desiderato dalla prima consegna, che non cambia l'invio automatico esistente.

## Struttura approvata

Eventi, Collab, Vendita e Club restano sezioni permanenti, direttamente accessibili nella lista, nelle Risposte e nelle altre viste operative, anche sul telefono. «Tutti» raccoglie le sezioni. Una scheda può appartenere a più sezioni senza essere duplicata. Le viste Da seguire, Risposte, Tutti i contatti e Accordi fatti organizzano il lavoro dentro le sezioni.

Ogni contatto mostra chi è, tipo, motivo, per quando, fase e a chi tocca. La fase è calcolata, non salvata: Non contattare; Accordo fatto; Non interessato; Primi contatti avviati; Risposto; Scritto; Da verificare; Fermo con motivo; Serve Tommi; Pronta; In preparazione; Da scrivere il giorno indicato; Da scrivere. Vince prima il blocco, poi lo stage commerciale, poi lo stato del lavoro. Un invio incerto conserva sempre un avviso distinto.

«Da seguire» ordina per necessità di intervento, poi data e CO. «Risposte» legge il registro, anche quando la fase è trattativa, accordo fatto o non interessato, e ignora il periodo. Le sezioni restano applicabili. Un collegamento diretto deve poter aprire la scheda senza filtri che la nascondano. Una data deve avere un significato; non si inventano solleciti o turni di conversazione mancanti.

La scheda mette prima contesto e prossima azione, ultima risposta registrata e bozza visibile; seguono storico, ricerca e dati secondari richiudibili. Spesa, regole e diagnostica restano nella pagina Assistente. Il verde racing, Barlow e i controlli esistenti si mantengono.

## Prima consegna

Nessuna migrazione, nuova dipendenza, lettura IMAP, chiamata Claude o nuovo percorso d'invio. Le risposte sono soltanto quelle registrate manualmente. Non compaiono editor o pulsanti di approvazione che non funzionano. I permessi del team e i comandi esistenti restano quelli attuali.

La lista legge sotto RLS dati operativi già esistenti: lavori e interruttori assistente, attività e solleciti realmente aperti. Un errore di queste letture ha un esito proprio e non oscura il modulo o i comandi di arresto. I testi del registro si rendono come testo, senza HTML eseguibile. Anteprima e test usano solo dati sintetici.

Oggi, Partner nel Team e Come si usa devono usare gli stessi nomi e distinguere il cambio dello stage dall'attività «Registra una risposta», che chiude il sollecito. I link del feed CEO restano compatibili.

## Consegne successive, fuori da questa PR

Salvataggio completo delle risposte; importazione in sola lettura della casella con recupero iniziale; riassunti e proposte Claude facoltativi; bozze versionate, approvazione di Tommi e invio; attivazione dei casi reali con OK separati. Nessun testo esterno, indirizzo proposto o output di Claude può autorizzare automaticamente un contatto derivato.

## Verifica e rilascio

Ogni PR riporta typecheck, test, build, test:db e format:check. Prima di ogni commit format e format:check. Nessun merge, deploy, modifica a impostazioni o scrittura in produzione è autorizzato da questa approvazione progettuale.
