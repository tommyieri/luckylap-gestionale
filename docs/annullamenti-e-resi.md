# Annullamenti e resi dalle vendite

La pagina `/sales` distingue le registrazioni manuali inserite per errore dai resi di merce realmente consegnata. Entrambi i comandi sono disponibili ai membri del team, con la normale sessione personale. Finance conserva i propri accessi riservati.

## Annullare una registrazione errata

Aprire la vendita e scegliere **Annulla registrazione**. L’anteprima mostra capi e packaging effettivamente scaricati e l’effetto Finance da escludere. Occorrono una motivazione e la conferma che merce e packaging non siano realmente usciti e che l’eventuale incasso sia stato registrato per errore.

Una sola transazione:

- restituisce soltanto le quantità scaricate, con nuovi movimenti di compensazione;
- libera le riserve e chiude il fabbisogno ancora aperto, conservando la produzione già completata;
- restituisce soltanto il packaging consumato e chiude deficit e recuperi della registrazione;
- esclude gli incassi collegati tramite revisioni Finance, preservando fonti, versioni e ricevute;
- segna la registrazione come annullata e ne impedisce la riattivazione accidentale.

Le registrazioni annullate sono escluse dal filtro iniziale e restano consultabili con **Registrazioni annullate** o **Tutti gli ordini**. Non si eliminano le righe storiche. Una vendita con un reso reale già registrato non può essere annullata come errore.

## Registrare un reso reale

Aprire una vendita manuale con merce consegnata e scegliere **Registra reso**. Selezionare le quantità rientrate, indicare il conto del rimborso, la data italiana e una motivazione. L’importo proviene dal prezzo della vendita, dopo gli sconti: non è un importo libero.

Il founder ha scelto di registrare **rientro e rimborso insieme**. La conferma attesta che entrambi siano già avvenuti: il gestionale non invia bonifici e non addebita carte. Il comando registra l’uscita nel conto indicato e riporta i capi in magazzino nella stessa transazione.

Scatole e adesivi partono da zero. Si ricaricano soltanto le quantità dichiarate rientrate e riutilizzabili, entro il packaging effettivamente consumato e non già restituito. La mancanza di packaging non genera automaticamente nuove scatole o nuovi adesivi.

Sono consentiti resi parziali e successivi entro i capi consegnati e non già resi. Gli arrotondamenti sono cumulativi: l’ultimo reso chiude esattamente il valore residuo, anche dopo annullamenti parziali. Il rimborso non può superare l’incasso effettivo disponibile per la vendita. Dopo il reso non compare un nuovo credito artificiale verso il cliente.

Finance riceve una sola uscita, categoria **Vendite**, collegata al reso. Le successive correzioni Finance con storico aggiornano anche lo stato effettivo dell’ordine. La scheda vendita mostra quantità e valore commerciale resi e valore residuo.

## Fonte e tentativi incerti

Gli ordini Shopify restano gestiti nella fonte: i comandi manuali di questa pagina non modificano Shopify. Il conto vendita continua a usare il proprio modulo.

Ogni conferma conserva UUID e dati prima dell’invio. Se l’esito è incerto si verifica lo stesso tentativo: non si ricreano rientri, incassi o rimborsi. Se vendita, scorte o incassi cambiano dopo l’anteprima, il controllo versione richiede di rileggere i dati.

I comandi verificano appartenenza al team e sessione attiva anche dopo attese sui blocchi. Le revisioni dei rimborsi e il vecchio annullo Finance condividono il blocco dell’ordine, con nuova verifica dell’accesso prima di scrivere.

## Implementazione e verifica

Migrazioni, da applicare nell’ordine:

1. `20261023121917_manual_sale_cancellation.sql`;
2. `20261023121923_manual_sale_returns.sql`.

Applicate sul progetto Supabase LuckyLap con queste versioni cloud; i file conservano il testo SQL verificato. Non attivano abbonamenti, non importano movimenti e non annullano vendite esistenti durante l’applicazione. Il ritorno a una versione precedente richiede una migrazione successiva; i movimenti già registrati restano nello storico.

Gli harness `manual-sale-cancellation.mjs` e `manual-sale-returns.mjs` sono autoregistrati in `npm run test:db`. Usano PostgreSQL 17 locale e soli dati sintetici per transazioni, permessi, sessioni scadute, replay, centesimi e contese con Finance. Nessun accesso cloud nei test.

