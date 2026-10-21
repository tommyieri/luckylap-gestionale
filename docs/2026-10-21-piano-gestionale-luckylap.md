# Gestionale LuckyLap — piano approvato e aggiornamenti

Versione 0.3 del 21 ottobre 2026. Il founder ha approvato la proposta e confermato le correzioni seguenti. Questa versione sostituisce le precedenti ipotesi sull’autorità delle scorte, sui permessi e sull’importazione Drive.

## Decisioni confermate

- L’inventario autorevole è LuckyLap_Gestione_inventario.xlsx su Drive. Le quantità Shopify sono errate e non verranno usate per inizializzare il magazzino.
- Le vendite vengono registrate nell’Excel, ma restano sospese nel nuovo gestionale: nessuna importazione o sincronizzazione in questa fase.
- Ricevuti i tre file Finance dal founder: riepilogo PDF, tracker COGS Excel ed export BudgetFlow CSV. Analisi e preparazione dell'importazione riservate; nessun dato reale viene esposto nell'anteprima senza accessi.
- Costi e margini visibili a tutti e cinque. Tutti possono applicare sconti e rettificare le scorte, con tracciamento dell’operazione.
- Area Finance accessibile a founder, Gabriele e Gherardo; Controllo CEO solo al founder.
- Calendario interno con call, agenda, verbali e attività successive.
- Packaging distinto dal catalogo: scatole per le magliette e adesivi specifici da applicare sulle scatole. Gli sticker Shopify sono un altro prodotto.
- Conto vendita: 60% a LuckyLap, 40% al negozio; prezzo in negozio pari al prezzo web più 10 EUR.
- Nessun abbonamento. Supabase Free e sviluppo locale; Vercel Hobby esclude l’uso commerciale, quindi nessuna pubblicazione aziendale su quel piano.
- Drive rimane invariato. Sono autorizzati solo inventario, grafiche, alcune foto ed eventuali informazioni professionali su Luca. Gli altri documenti Drive esplorati non saranno importati o riutilizzati.
- Il progetto Partner prosegue con Claude nel suo repository. Il gestionale mantiene la possibilità di integrarlo senza modificare il lavoro corrente.
- Creato il nuovo repository privato `tommyieri/luckylap-gestionale`. GitHub contiene il codice, Vercel ospiterà l'app quando il piano sarà compatibile, Supabase conserverà database/accessi/file. Nessuna chiave riservata nel frontend o nel repository.

## Prima parte utilizzabile

Struttura del gestionale, magazzino con inventario Excel, packaging distinto, calendario interno, attività e note. Finance e Vendite mostrano chiaramente il loro stato di attesa. Prima consegna in anteprima locale; l’accesso multiutente richiede poi Supabase configurato e verifica dei permessi reali.

## Documenti operativi

- [Requisiti confermati](superpowers/specs/2026-10-21-gestionale-luckylap-design.md).
- [Piano di implementazione della prima versione locale](superpowers/plans/2026-10-21-prima-versione-locale.md).

Non si modificano Drive, Shopify o il repository Partner e non vengono attivati servizi a pagamento.
