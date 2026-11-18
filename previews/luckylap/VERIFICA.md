GATE: PASS

Verifica della preview LuckyLap del 18 novembre 2026. Nessun FAIL aperto nel gate finale; due falsi positivi documentati sotto. La pagina è un prototipo locale, con acquisti e disponibilità demandati allo store esistente.

## Risultati

| Controllo | Esito |
| --- | --- |
| Taste finish gate, versione finale | PASS a 1440×900 e 390×844; controllo di overflow anche a 320 px |
| Layout e stress dei titoli | Nessun rilievo a 1440×900, 1024×768, 820×1180, 768×1024 e 390×844 |
| Screenshot | Acquisiti ai cinque viewport; ispezione visiva di hero, selettore, fotografie e dettagli |
| Copy lint | 0 FAIL, 0 WARN |
| JavaScript | `node --check` superato |
| Collegamenti esterni | 15 destinazioni dello shop e del profilo ufficiale, risposte HTTP 200 |
| Selettore | Tutti e quattro i modelli aggiornano foto, `srcset`, nome, testo, alt e collegamenti |
| Richieste concorrenti | Prevale l'ultima scelta; un risultato precedente non sovrascrive il modello corrente |
| Errore della foto | Stato precedente conservato; radio ripristinato, messaggio leggibile e rimosso dopo il recupero |
| Menu | Stato e nome accessibile, pagina sottostante inerte, ciclo del focus e chiusura dal collegamento di salto |
| Fallback | Il gate ha letto dieci schermate senza JavaScript e con movimento ridotto; nessun contenuto nascosto |
| Formattazione | `npm run format` e `npm run format:check`, prima del commit |

La logica delle interazioni è stata verificata anche con un harness temporaneo Node VM e DOM simulato, poi eliminato. La geometria, il caricamento degli asset, il percorso del focus e la resa visiva sono stati verificati nel browser della skill. Il controllo completo iniziale ai cinque viewport ha individuato i problemi poi corretti; gli ultimi gate controllano desktop e telefono, mentre le verifiche di geometria comprendono anche i tablet.

## Prestazioni della versione finale

`perf.mjs`: **0 FAIL**. Risultati misurati dal browser locale della skill:

- Trasferimento: 1042,6 KiB su desktop e 531 KiB sul telefono.
- Nessuna richiesta fallita, nessuna immagine senza dimensioni dichiarate, nessun contesto WebGL.
- Spostamento del layout misurato: 0,000.
- Foto responsive, font locali, nessuna libreria di animazione aggiuntiva.

Restano quattro WARN: il logo è caricato subito anche nel footer e il Mac risultava occupato durante le due misurazioni. I tempi di rendering sono misure relative locali, non una promessa di prestazioni su una rete reale. Il peso e il numero delle richieste sono misurati; non viene dichiarato un punteggio Lighthouse.

## Due eccezioni del verificatore

1. `overlap-text`: il radio con `appearance: none` disegna sfondo e bordo del controllo; il testo del label è su un livello superiore, resta interamente visibile e ha il proprio focus. La sovrapposizione è parte del controllo, non un testo coperto.
2. `off-grid`: il testo dentro il primo radio ha padding. Il gruppo e il primo bordo partono dalla linea della pagina; il testo interno non costituisce una nuova colonna.

I 23 WARN non bloccanti del gate comprendono soprattutto il movimento previsto di `photo-chapters`, i margini interni dei controlli, le euristiche inglesi applicate al testo italiano, la ripetizione dell'azione fra header e hero e le proporzioni fotografiche. La scala delle foto resta all'interno delle cornici con ritaglio; nessun overflow della pagina è stato rilevato nel controllo a 320 px. Le segnalazioni non sono state nascoste e il codice della skill non è stato alterato per superarle.

## Provenienza e limiti

Taste Skill 2.5.1, commit `f6b76575f949707b4e3c37cd86cb44b0b98643e8`, dal [repository richiesto](https://github.com/leonxlnx/taste-skill). Runtime originale conservato in `assets`, con licenza MIT; escluso dalla riformattazione per mantenerlo identico alla fonte. Anche cache e risultati locali dei controlli sono esclusi dal formatter e da Git.

Kind `product`, site-kind `other`; colori LuckyLap, Mona Sans, hero `product`, menu `nav-mega`, chiusura `close-photo`, footer a colonne e momento fotografico `photo-chapters`. La voce usa silhouette e dettagli del capo al posto di dichiarazioni di status. La [direzione](DIREZIONE.md) conserva fatti, motivazioni e fonti.

Tutte le immagini sono asset ufficiali del brand. Non ci sono fotografie sostitutive, testimonianze, numeri di vendita, prezzi inventati o form con invio simulato. Il ritaglio mobile 964 e le riduzioni WebP sono preparazioni tecniche dello stesso materiale originale. Il dominio canonico resta assente perché questa è una preview locale con `noindex`.

La preview non modifica route o componenti del gestionale. Non è stata aperta una pull request; `typecheck`, test applicativi, build Next.js e harness del database non sono stati eseguiti per questa consegna statica. Nessuna migrazione, modifica alle impostazioni dei servizi o pubblicazione di produzione è stata effettuata.
