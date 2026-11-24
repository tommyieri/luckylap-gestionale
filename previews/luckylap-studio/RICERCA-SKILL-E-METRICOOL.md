# LuckyLap: ricerca su design, agenti e Instagram

Aggiornamento: 24 novembre 2026. Questo documento distingue la preview realizzata dalle analisi ancora da svolgere.

## Stato del lavoro

La preview comprende nove prodotti. Il pacchetto nativo per Shopify è in preparazione: non va presentato come già installato o pubblicato. Non disponiamo ancora delle analytics Instagram del profilo corretto, **@lucky.lap**; non abbiamo quindi misurato rendimento dei contenuti, crescita o conversioni di quel profilo.

I fatti confermati dal founder guidano i testi: T-shirt con ricami eseguiti a macchina in Italia; maglieria in arrivo, 100% lana Made in Italy. Il ricamo italiano non autorizza a definire italiana l’intera produzione delle T-shirt. Date, disponibilità e prezzi mancanti non vengono inventati.

## Perché Taste, Impeccable e codice nativo

[Taste Skill](https://github.com/leonxlnx/taste-skill) aiuta a dare una direzione precisa: categoria comprensibile nella prima schermata, fotografie dei prodotti, pochi inviti all’azione e un sistema coerente di spazi e caratteri. Le sue [regole sui testi](https://raw.githubusercontent.com/leonxlnx/taste-skill/main/skills/taste-skill/references/copy.md) escludono recensioni e prove inventate. Il [layout a schermate intere](https://raw.githubusercontent.com/leonxlnx/taste-skill/main/skills/taste-skill/references/layout-v4.md) resta una scelta estetica da adattare quando taglierebbe catalogo, carrello o testo ingrandito. Nomi e prezzi rimangono visibili dentro le schede prodotto; i contatti reali sostituiscono gli esempi fittizi previsti per brief incompleti.

[Impeccable](https://github.com/pbakaus/impeccable) completa la direzione con gerarchia, chiarezza, accessibilità, responsive e verifica visiva. Serve soprattutto a controllare che la personalità del brand aiuti a capire e acquistare.

Il pacchetto Shopify usa **Liquid, template JSON, sezioni modificabili, CSS e JavaScript nativi**: è l’[architettura ufficiale dei temi](https://shopify.dev/docs/storefronts/themes/architecture). Evita di introdurre un secondo storefront da mantenere per ottenere animazioni e interazioni. Le [anteprime dei temi](https://shopify.dev/docs/storefronts/themes/tools/cli) consentono di provare il lavoro prima della pubblicazione.

Il movimento deve spiegare una scelta o confermare un’azione: cambio foto, selezione variante, apertura del carrello. Le animazioni non essenziali rispettano la preferenza di movimento ridotto, secondo la [guida W3C](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions). Una verifica visiva CUA non equivale al superamento degli eventuali script headless della skill: si riportano soltanto controlli realmente eseguiti.

## Strumenti utili dopo la preview

- [Agency Agents](https://github.com/msitarzewski/agency-agents): istruzioni per specialisti di brand, contenuti, UX e revisione. Utili per assegnare compiti; non collegano automaticamente gli account e richiedono adattamento a LuckyLap.
- [Playwright](https://github.com/microsoft/playwright-mcp): prove ripetibili dei percorsi di navigazione e acquisto, con evidenze dei passaggi e classificazione degli errori.
- [Lighthouse](https://github.com/GoogleChrome/lighthouse) e [axe-core](https://github.com/dequelabs/axe-core): prestazioni e problemi di accessibilità verificabili. I punteggi non misurano desiderabilità o vendite.
- [Microsoft Clarity](https://github.com/microsoft/clarity): sessioni e mappe di calore di visitatori reali, se attivato e configurato. Ha un’[integrazione Shopify ufficiale](https://learn.microsoft.com/en-us/clarity/third-party-integrations/shopify); la copertura del checkout va verificata sul piano effettivo.

Cento agenti producono cento esecuzioni di test, non cento clienti rappresentativi. Un fallimento può dipendere dal sito oppure dall’agente. Le simulazioni generano ipotesi; dati reali e confronti con persone verificano interesse, fiducia e motivi di abbandono.

## Collegare e analizzare @lucky.lap

Collegare il profilo **Business o Creator** a una Pagina Facebook e autorizzare Metricool tramite la procedura ufficiale, con i permessi necessari. Il founder effettua l’accesso: nessuna password da inviare in chat. La connessione tramite Facebook offre analytics più complete, comprese le Stories; le due modalità di collegamento mantengono storici separati. [Requisiti Metricool](https://help.metricool.com/access-to-instagram-from-metricool-connection-types-and-differences-kcsrb).

La prima connessione mostra normalmente i 30 giorni precedenti. I piani a pagamento possono richiedere una sincronizzazione aggiuntiva, nei limiti delle API. Follower storici e Stories non tracciati non vengono ricostruiti. [Limiti dello storico](https://help.metricool.com/historical-data-available-5zavf).

Prima dell’analisi raccogliere i dati disponibili in Insights e gli export esistenti; Metricool offre CSV dalle liste Analytics e report nell’area Reporting. [Guida ufficiale](https://help.metricool.com/instagram-analytics-shows-no-data-kbmcu). Confrontare formati, copertura, salvataggi, condivisioni e azioni sul profilo, distinguendo organico e sponsorizzato. Collegare poi i risultati a vendite dirette, partner, eventi e conto vendita nel gestionale: è il prossimo studio, non una conclusione già misurata.
