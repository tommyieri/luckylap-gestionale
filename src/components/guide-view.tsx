import type { ReactNode } from "react";
import Link from "next/link";
import {
  Handshake,
  House,
  LockKeyhole,
  Package,
  ShieldCheck,
  ShoppingBag,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { mobileSplit, visibleSections, type IconName, type SectionId } from "../lib/navigation";
import roadbook from "./roadbook.module.css";
import styles from "./guide-view.module.css";

/**
 * «Come si usa» (docs: workspace-layout.md, «La guida»). Testo fisso, scritto sull'app
 * com'è oggi: quando una pagina cambia nome, scopo o pulsanti, si aggiorna anche qui.
 * La guida descrive le sezioni per il lavoro quotidiano e l'apertura di Finance.
 */
export type GuideAccess = { finance: boolean; ceo: boolean };

const ICONS: Record<IconName, LucideIcon> = {
  House,
  ShoppingBag,
  Package,
  Handshake,
  UsersRound,
  Wallet,
  ShieldCheck,
};

/** Una frase per ogni sezione descritta nella guida. */
export const SECTION_TEXT: Partial<Record<SectionId, string>> = {
  oggi: "Il lavoro del giorno: agenda, email automatiche, Partner da seguire, ordini da preparare e magazzino.",
  vendite: "Le vendite di LuckyLap, dirette e nei negozi.",
  magazzino:
    "Le magliette che abbiamo, quelle nei negozi, quelle da correggere, i riordini e il materiale per spedire.",
  partner:
    "Negozi, eventi, club, media e brand da contattare, con lo stato e il registro di ogni contatto.",
  team: "Il lavoro di tutti i giorni del team.",
  finance: "Saldo dai movimenti, entrate, uscite e somme da incassare dai negozi.",
};

/** Una frase per scheda: il test vuole tutte le schede della mappa. */
export const TAB_TEXT: Record<string, string> = {
  "/sales": "Vendite dirette ed Etsy, consegne e incassi. Gli ordini Shopify arrivano da soli.",
  "/consignment":
    "Le vendite dei negozi in conto vendita: il resoconto del mese, la fattura e il pagamento.",
  "/stock": "Ogni variante con le quantità del Magadzino e dei negozi, costi e prezzi.",
  "/stock/rettifiche": "Correggi una quantità in magazzino, sempre con la causale.",
  "/stock/conto-vendita":
    "Le magliette in ogni negozio: la conta, gli ordini e le consegne dal Magadzino.",
  "/packaging": "Scatole e adesivi: una scatola e un adesivo per ogni T-shirt consegnata.",
  "/stock/riassortimento":
    "I riordini di magliette, dalla discussione su cosa riordinare all’arrivo in mano nostra, che le carica nel Magadzino.",
  "/team":
    "Il calendario del mese (un pallino sui giorni con impegni), le cose da fare, le note e le idee. Qui c’è anche «Partner nel Team».",
  "/development": "I prodotti nuovi, dall’idea al campione fino al prodotto pronto.",
  "/assets": "Loghi, grafiche, foto e video del brand, da scaricare o da aggiungere.",
};

/** Le nove parti della guida, nell'ordine dell'indice. */
export const GUIDE_PARTS = [
  { id: "guida-accesso", title: "Entrare e uscire", short: "Entrare e uscire" },
  { id: "guida-oggi", title: "Oggi", short: "Oggi" },
  { id: "guida-menu", title: "Il menu", short: "Il menu" },
  { id: "guida-operazioni", title: "Le operazioni più comuni", short: "Operazioni comuni" },
  { id: "guida-partner", title: "Partner", short: "Partner" },
  {
    id: "guida-conto-vendita",
    title: "Conto vendita e resoconto del mese",
    short: "Conto vendita",
  },
  { id: "guida-finance", title: "Finance", short: "Finance" },
  { id: "guida-telefono", title: "Sul telefono", short: "Sul telefono" },
  { id: "guida-aiuto", title: "Se qualcosa non va", short: "Se qualcosa non va" },
] as const;
type PartId = (typeof GUIDE_PARTS)[number]["id"];

/**
 * Le operazioni di tutti i giorni (06, «Come si usa», punti 3 e 4): dove si fanno, con i
 * pulsanti veri, e chi le fa di solito. Ogni riga porta alla pagina giusta.
 */
export const OPERATIONS: { title: string; href: string; text: string; who?: string }[] = [
  {
    title: "Registrare una vendita",
    href: "/sales#new-sale",
    text: "In Vendite apri «Nuova vendita»: canale, articoli, quantità e prezzo, poi «Registra vendita». Gli ordini Shopify arrivano da soli.",
  },
  {
    title: "Segnare una consegna",
    href: "/sales",
    text: "In Vendite apri l’ordine, poi «Registra una consegna» e «Conferma uscita fisica».",
    who: "Ettore",
  },
  {
    title: "Segnare un incasso",
    href: "/sales",
    text: "In Vendite apri l’ordine e premi «Dichiara incasso ricevuto». Registra un pagamento già arrivato: non addebita niente.",
  },
  {
    title: "Segnare i capi prodotti",
    href: "/sales#sales-production",
    text: "In Vendite, «Produzione da completare»: scrivi quanti capi sono pronti e premi «Registra capi pronti». Lo possono fare Tommi e Gabriele.",
    who: "Gabriele",
  },
  {
    title: "Correggere una quantità in magazzino",
    href: "/stock/rettifiche",
    text: "In Magazzino, Rettifiche: scegli SKU e magazzino, scrivi quanti capi aggiungere o togliere e la causale, poi «Registra rettifica».",
    who: "Ettore",
  },
  {
    title: "Aggiornare scatole e adesivi",
    href: "/packaging",
    text: "In Magazzino, Packaging: «Modifica quantità» sul materiale, scrivi quanti ne hai contati e la causale, poi «Conferma quantità».",
    who: "Ettore",
  },
  {
    title: "Riordinare le magliette",
    href: "/stock/riassortimento",
    text: "In Magazzino, Riassortimento: «Nuovo riordine», poi «Modifica quantità» per noi, per il negozio e per il cliente («Proponi quantità» guarda giacenza e obiettivo). Tocca un passo per spostarlo; «In mano nostra» carica le magliette nel Magadzino dopo la conferma, e «Prepara la consegna» apre la consegna al negozio già compilata.",
    who: "Tommi",
  },
  {
    title: "Conto vendita: registrare le vendite del mese",
    href: "/consignment",
    text: "In Vendite, Conto vendita: apri il negozio e premi «Registra le vendite di …» con il mese. Tutti i passi sono più sotto, in «Conto vendita e resoconto del mese».",
    who: "Tommi",
  },
  {
    title: "Conto vendita: contare il negozio e consegnare",
    href: "/stock/conto-vendita",
    text: "In Magazzino, Conto vendita: apri il negozio. «Conta in negozio» (o «Correggi la conta») per le magliette che ci sono; «Nuovo ordine» per quelle da portare.",
    who: "Tommi",
  },
  {
    title: "Aggiungere una call o un’attività",
    href: "/team",
    text: "In Team, Calendario e attività: «Aggiungi appuntamento» per una call o una consegna, «Aggiungi attività» per una cosa da fare.",
    who: "Luca",
  },
  {
    title: "Caricare una foto",
    href: "/assets",
    text: "In Team, Grafica e foto: in «Aggiungi un contenuto» scegli il file e premi «Carica originale».",
  },
  {
    title: "Vedere quante magliette puoi vendere",
    href: "/stock",
    text: "In Magazzino, Giacenze: in cima «Magliette disponibili» dice, grafica per grafica, quanti pezzi puoi vendere dal Magadzino. Tocca una grafica e la tabella mostra solo quella.",
  },
  {
    title: "Aprire una scheda prodotto",
    href: "/stock",
    text: "In Magazzino, Giacenze: tocca una riga e si apre il «Dettaglio prodotto», con taglia, quantità, costo e prezzi.",
  },
  {
    title: "Seguire un prodotto nuovo",
    href: "/development",
    text: "In Team, Nuovi prodotti: «Crea scheda prodotto» per un’idea nuova, «Modifica scheda» per cambiarne la fase, «Aggiungi foto» per le foto dei campioni dal telefono o dal computer.",
    who: "Gabriele",
  },
  {
    title: "Partner: segnare un invio o un sollecito",
    href: "/partner",
    text: "Apri il contatto. Nel «Registro» premi «Segna inviato», poi «Registra». Per il sollecito premi «Segna sollecito inviato», poi «Registra». I passi sono più sotto, in «Partner».",
    who: "Luca",
  },
];

/**
 * I riquadri di Oggi, con i titoli veri di `today-tiles.tsx`: il conto vendita solo a chi
 * apre Finance, come in `today-sheet.tsx`.
 */
export const TODAY_TILES: { title: string; text: string; finance?: true }[] = [
  {
    title: "Agenda",
    text: "Gli appuntamenti di oggi e il numero delle tue attività in scadenza oggi o in ritardo. Apri il riepilogo per vedere le attività.",
  },
  {
    title: "Email automatiche di oggi",
    text: "Le email già inviate e quelle programmate oggi dal gestionale, separate fra altri contatti, Club e solleciti. Apri «Vedi destinatari e orari» per il dettaglio.",
  },
  {
    title: "Partner da seguire personalmente",
    text: "I contatti e i solleciti manuali che richiedono il tuo intervento. Apri il riepilogo per vedere le schede e i solleciti con «Ha risposto». Le email automatiche sono nel riquadro «Email automatiche di oggi».",
  },
  {
    title: "Ordini da preparare",
    text: "Le vendite con capi ancora da consegnare, dalla meno recente.",
  },
  {
    title: "Magazzino",
    text: "Le varianti esaurite nel Magadzino e le quantità ancora da contare.",
  },
  {
    title: "Conto vendita da regolare",
    text: "I resoconti dei negozi da fatturare o da incassare. Con Finance chiusa ti chiede di aprirla.",
    finance: true,
  },
];

/** Parole del gestionale, con i nomi delle colonne di Giacenze e Rettifiche. */
const WORDS: [string, string][] = [
  ["Fisico", "I capi che ci sono davvero in magazzino. In Vendite: «pronto fisico»."],
  ["Riservato", "Già promesso a un ordine."],
  ["Disponibile", "Fisico meno riservato: quello che puoi vendere."],
  ["Da produrre", "Capi venduti che non sono ancora pronti."],
  ["n.d.", "Quantità non nota. Non vuol dire zero."],
  ["In negozio", "Le magliette nei negozi in conto vendita; «—» finché il negozio non è contato."],
  ["Rettifica", "Una correzione della quantità, con la causale: il motivo scritto in breve."],
];

const SHOP_STEPS: [string, string][] = [
  [
    "Conta in negozio",
    "In Magazzino, Conto vendita: la prima volta conta le magliette, taglia per taglia. Finché il negozio non è contato, il resoconto resta chiuso.",
  ],
  [
    "Registra le vendite del mese",
    "In Vendite, Conto vendita: a inizio mese il negozio manda su WhatsApp le magliette vendute nel mese prima. Premi «Registra le vendite di …», scrivile taglia per taglia e premi «Salva resoconto»: escono da sole dal negozio. Nessuna vendita? Salva con zero.",
  ],
  [
    "Da fatturare",
    "Il gestionale calcola l’incasso del negozio e la quota da fatturare, con le condizioni del negozio: per esempio prezzo del sito più 10 € e 60% a LuckyLap.",
  ],
  [
    "Fattura e pagamento",
    "«Segna fattura emessa» e «Registra pagamento» servono con Finance aperta. Lo stato (Da fatturare, Da pagare, Pagata) lo vedono tutti.",
  ],
  [
    "Nuovo ordine",
    "In Magazzino, Conto vendita: il negozio chiede magliette nuove, scrivi l’ordine. Quando le porti, premi «Consegnato»: escono dal Magadzino ed entrano in negozio.",
  ],
];

const PEOPLE: [string, string][] = [
  ["Tommi", "Accesso e password, errori, conto vendita e tutto quello che non sai a chi chiedere."],
  ["Gabriele", "Produzione, capi pronti e nuovi prodotti."],
  ["Ettore", "Consegne, packaging e rettifiche."],
  ["Gherardo", "Finance."],
  ["Luca", "Partner."],
];

/** «A, B e C». */
const list = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} e ${items.at(-1)}` : (items[0] ?? "");

function Part({ id, children }: { id: PartId; children: ReactNode }) {
  const part = GUIDE_PARTS.find((item) => item.id === id)!;
  return (
    <section id={id} className={styles.part} aria-labelledby={`${id}-titolo`}>
      <h2 id={`${id}-titolo`} className={styles.partTitle}>
        {part.title}
      </h2>
      {children}
    </section>
  );
}

export function GuideView({ access, preview = false }: { access: GuideAccess; preview?: boolean }) {
  const visible = visibleSections({ status: "member", displayName: "", ...access }).filter(
    (section) => section.id !== "ceo",
  );
  const { bar, altro } = mobileSplit(visible);
  return (
    <div className={styles.page}>
      <div className="page-heading">
        <div>
          <h1>Come si usa</h1>
          <p>Il gestionale in due minuti: dove trovi le cose e cosa fare se qualcosa non va.</p>
        </div>
      </div>
      {preview && (
        <p className={styles.notice} role="status">
          Anteprima locale: la guida del team.
        </p>
      )}
      <div className={styles.layout}>
        <nav aria-label="In questa guida" className={styles.index}>
          <ol className={styles.indexList}>
            {GUIDE_PARTS.map((part) => (
              <li key={part.id}>
                <a href={`#${part.id}`} className={styles.indexLink}>
                  {part.short}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className={styles.text}>
          <Part id="guida-accesso">
            <ul className={styles.points}>
              <li>
                Entri con la tua email e la password comune del team. Ogni cosa che registri resta
                firmata con il tuo nome.
              </li>
              <li>
                Per uscire premi «Esci»: in fondo al menu sul computer, in «Altro» sul telefono. Su
                un dispositivo che non è tuo, esci sempre.
              </li>
              <li>Password dimenticata o accesso che non funziona: scrivi a Tommi.</li>
            </ul>
          </Part>

          <Part id="guida-oggi">
            <p className={styles.lead}>
              Dopo l’accesso si apre Oggi: il lavoro del giorno, in riquadri. Ogni riquadro ha in
              alto il link alla sua pagina.
            </p>
            <dl className={styles.terms}>
              {TODAY_TILES.filter((tile) => !tile.finance || access.finance).map((tile) => (
                <div key={tile.title}>
                  <dt>{tile.title}</dt>
                  <dd>{tile.text}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.after}>
              La prima volta, sopra i riquadri trovi «Prima volta qui?», che porta a questa guida.
              Premi «Ho capito» e su questo browser non torna.
            </p>
          </Part>

          <Part id="guida-menu">
            <p className={styles.lead}>
              Sul computer il menu è a sinistra, sul telefono in basso. Le sezioni con più pagine
              hanno le schede in alto. Qui trovi le sezioni per il lavoro di tutti i giorni:
            </p>
            <ul className={styles.menu}>
              {visible.map((section) => {
                const Icon = ICONS[section.icon];
                return (
                  <li key={section.id} className={styles.menuRow}>
                    <div className={styles.menuSpine}>
                      <Icon size={22} strokeWidth={1.6} aria-hidden />
                    </div>
                    <div className={styles.menuBody}>
                      <p className={styles.rowHead}>
                        <Link href={section.href} prefetch={false} className={styles.rowLink}>
                          {section.label}
                        </Link>
                        {section.requires && (
                          <span className={styles.locked}>
                            <LockKeyhole size={14} strokeWidth={1.8} aria-hidden />
                            con password
                          </span>
                        )}
                      </p>
                      <p className={styles.rowText}>{SECTION_TEXT[section.id]}</p>
                      {section.tabs.length > 0 && (
                        <ul className={styles.tabs}>
                          {section.tabs.map((tab) => (
                            <li key={tab.href}>
                              <Link href={tab.href} prefetch={false} className={styles.tabLink}>
                                {tab.label}
                              </Link>
                              <span className={styles.tabText}>{TAB_TEXT[tab.href]}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className={styles.after}>
              Finance è visibile a tutti i membri. Per entrare serve la password Finance.
            </p>
            <h3 className={styles.subTitle}>Parole che trovi spesso</h3>
            <dl className={styles.terms}>
              {WORDS.map(([word, meaning]) => (
                <div key={word}>
                  <dt>{word}</dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
          </Part>

          <Part id="guida-operazioni">
            <p className={styles.lead}>
              Dove si fa e quale pulsante premere. Accanto c’è chi lo fa di solito.
            </p>
            <ul className={styles.ops}>
              {OPERATIONS.map((operation) => (
                <li key={operation.title}>
                  <p className={styles.rowHead}>
                    <Link href={operation.href} prefetch={false} className={styles.opLink}>
                      {operation.title}
                    </Link>
                    {operation.who && <span className={styles.who}>di solito {operation.who}</span>}
                  </p>
                  <p className={styles.rowText}>{operation.text}</p>
                </li>
              ))}
            </ul>
          </Part>

          <Part id="guida-partner">
            <ul className={styles.points}>
              <li>
                Partner si apre su «Elenco». Le sezioni Eventi, Collab, Vendita e Club restano
                disponibili in tutte le viste, anche sul telefono. Ogni riga mostra nome, numero CO,
                fase, prossimo passo, proposta e responsabile. In Club ci sono i Porsche Club fuori
                dall’Italia e i club Ferrari e Mercedes.
              </li>
              <li>
                Cerca per nome, città, paese o CO. In «Altri filtri», sotto «Lavoro», trovi «Da
                seguire» e «Risposte registrate». Per vedere gli accordi scegli «Accordo fatto» in
                «Fase». Puoi combinare questi filtri con il periodo e ritrovarli dallo stesso
                indirizzo.
              </li>
              <li>
                Usa «Pipeline» per vedere i contatti per fase, «Mappa» per esplorarli per paese e
                «Andamento» per leggere i numeri degli invii e delle risposte registrati. Cambia la
                fase dalla scheda o trascina una scheda nella Pipeline e conferma. Per «Concluso…»
                scegli «Accordo fatto» o «Non interessato».
              </li>
              <li>
                In «Calendario» scegli «Mese», «Settimana» o «Lista» per vedere invii e risposte
                registrati, solleciti, azioni, eventi e scadenze. Le prime email previste sono
                stime. Le registrazioni del vecchio sito riportano la data del file. Apri «Programma
                email» per consultare gli orari e le bozze delle prime email.
              </li>
              <li>
                Tocca un contatto per aprire la scheda laterale. «In breve» mostra il prossimo
                passo. Le altre schede sono «Email», «Registro», «Ricerca», «Recapiti» e «Dati e
                tag». Quando gli scrivi tu, nel «Registro» premi «Segna inviato», poi «Registra».
                Quando mandi il sollecito, premi «Segna sollecito inviato», poi «Registra».
              </li>
              <li>
                Quando ti risponde, premi «Registra una risposta» nel «Registro», poi «Registra». In
                Oggi trovi anche «Ha risposto». Usa il Registro per annotare la risposta e chiudere
                il sollecito anche quando la fase è già «Risposto». «Inviato», «Risposto», «In
                conversazione» e «Concluso» descrivono il rapporto. Il prossimo passo riporta il
                lavoro dell’assistente e il motivo di un eventuale fermo.
              </li>
              <li>
                Quando registri «Segna inviato» o «Segna sollecito inviato», si crea per te
                un’attività «Sollecito · nome del contatto». Scade dopo 7 giorni: la conferma ti
                dice il giorno. La trovi in Oggi, in «Partner da seguire personalmente», e tra le
                attività del Team.
              </li>
              <li>
                Il sollecito si chiude quando registri la risposta, anche con «Ha risposto» in Oggi,
                con un nuovo invio, con lo stato «Accordo fatto» o «Non interessato» e con «Metti
                tra i non contattare». Vale anche per i file «Esporta» dei dispositivi: un
                «Contattato» del file crea il sollecito per chi carica il file, 7 giorni dopo la
                data dell’esportazione (può essere già in ritardo); «Risposto» o «Accordo fatto» lo
                chiudono.
              </li>
              <li>
                Quando una scheda passa ad «Accordo fatto», le sue date di evento e candidatura
                possono comparire nel calendario del Team come giornate intere. Il Calendario di
                Partner mostra anche scadenze e stime di lavoro, da consultare prima dell’accordo.
              </li>
              <li>
                In Team, «Partner nel Team» porta un contatto nel lavoro del team: l’evento nel
                calendario, un progetto per Produzione, l’attività per aprire un conto vendita e le
                vendite fatte all’evento. Con «Accordo fatto», da «In breve» premi «Apri in Partner
                nel Team» per aprire quel contatto. «Collega l’evento» funziona anche se l’evento è
                già passato.
              </li>
              <li>
                Tutti vedono e possono fare tutto. «Seguito da» indica chi se ne occupa. Il nome
                seguito da «(predefinito)» è il riferimento mostrato per i contatti senza
                assegnazione esplicita.
              </li>
              <li>
                Apri «Assistente e strumenti» per la striscia dell’assistente, i lookbook, le regole
                importate con la ricerca e «Dati Partner».
              </li>
            </ul>
            <h3 className={styles.subTitle}>L’assistente</h3>
            <ul className={styles.points}>
              <li>
                L’assistente cerca notizie sui contatti «Da contattare», sceglie una proposta e
                scrive la prima email. In «Prepara» scrive solo le bozze: le leggi nella scheda del
                contatto.
              </li>
              <li>
                Per i contatti della sezione Club l’assistente non cerca notizie e non scrive: la
                prima email è il testo per i club approvato da Tommi, nella lingua del club e con il
                suo nome. Nomina i modelli che abbiamo della marca del club (964 e GT3 RS, F40 e 512
                TR, 300 SL) e dice che possiamo disegnare qualsiasi auto. Claude la rilegge con le
                regole prima che parta; se trova un problema, il club passa a Tommi.
              </li>
              <li>
                In «Invio» l’assistente manda le prime email dalla casella aziendale, nei giorni
                feriali tra le 9 e le 16 dell’ora del contatto. Il piano del giorno distribuisce gli
                invii fra le 9:00 e le 15:55; un piano nato dopo le 9 usa il tempo rimasto e con un
                solo invio usa il centro dell’intervallo disponibile. Gli orari si leggono nel
                Programma email e nella pagina Assistente, sia locali sia di Roma. Un orario mancato
                non viene recuperato con una raffica di email. Le quote si contano sul giorno di
                Roma: al massimo 6 prime email, 3 Club e 3 altri, senza trasferire i posti
                inutilizzati, più 6 solleciti con un limite separato. Stessa data locale e stessa
                finestra UTC formano un gruppo, anche con fusi di nomi diversi: per esempio Roma,
                Parigi e Berlino quando gli orari coincidono.
              </li>
              <li>
                Prima Tommi fa una prova con «Manda la prova» e la conferma con «La prova è arrivata
                in posta in arrivo». Senza la prova confermata «Invio» non si può scegliere. «Prova»
                e «Invio» li sceglie solo Tommi.
              </li>
              <li>
                I solleciti automatici nascono in «osserva», senza invii: i promemoria di Tommi
                restano validi. Quando Tommi attiva l’invio dei solleciti, possono partire fino a
                quattro messaggi a 7, 17, 45 e 90 giorni, solo con bozza approvata e controlli della
                posta prima dell’invio. Una possibile risposta ferma il ciclo; un fuori ufficio
                riconosciuto con data certa lo rinvia. L’assistente non risponde alle persone. Se lo
                manda a mano, Tommi parte dalla «Bozza dell'email» mandata nella scheda e nel
                «Registro» preme «Segna sollecito inviato», poi «Registra».
              </li>
              <li>
                In «Assistente e strumenti» la striscia dell’assistente dice cosa sta facendo,
                quante bozze sono pronte o quante email ha mandato oggi. «Apri l'assistente» porta
                alla sua pagina, con modalità, costi, regole e verifiche.
              </li>
              <li>
                Nella scheda del contatto, apri «Email» per la bozza. L’email che l’assistente manda
                è la «Bozza dell'email» nella scheda. Quando la bozza perde validità, resta
                leggibile con il motivo e il contatto aspetta una nuova bozza valida.
              </li>
              <li>
                Per fermarlo del tutto premi «Ferma l'assistente» nella striscia, oppure «Spento»
                nella sua pagina: lo può fare chiunque. «Prepara» lo rimette al lavoro, senza
                mandare email.
              </li>
              <li>
                Per un solo contatto, nel blocco «Assistente» premi «Ferma su questo contatto»;
                «Riattiva su questo contatto» glielo ridà. Fermarlo non è «Metti tra i non
                contattare».
              </li>
              <li>
                Quando non riesce a finire un contatto lo passa a Tommi: nella pagina
                dell’assistente è in «Da vedere», con il motivo. «Ridai all'assistente» lo rimette
                in coda. Se nella casella c’è già uno scambio recente con quell’indirizzo, o se non
                è sicuro che l’email sia partita, il contatto resta a Tommi.
              </li>
              <li>
                Con «Manda per primo», nel blocco «Assistente», Tommi fa partire un contatto prima
                degli altri.
              </li>
              <li>
                Le regole con cui scrive sono nella sua pagina, in «Regole»: si cambiano con «Scrivi
                una nuova versione». «Regole per scrivere» in «Assistente e strumenti» apre il
                contesto importato con la ricerca, destinato al team.
              </li>
            </ul>
            <p className={styles.actions}>
              <Link href="/partner" prefetch={false} className="button button-secondary">
                Apri Partner
              </Link>
              <Link href="/partner/email" prefetch={false} className="button button-secondary">
                Apri il Programma email
              </Link>
              <Link href="/partner/assistente" prefetch={false} className="button button-secondary">
                Apri l'assistente
              </Link>
              <Link href="/team/partner" prefetch={false} className="button button-secondary">
                Apri Partner nel Team
              </Link>
            </p>
          </Part>

          <Part id="guida-conto-vendita">
            <p className={styles.lead}>
              I negozi tengono le nostre magliette e ci pagano quelle che vendono. Il conto vendita
              ha due pagine: in Magazzino, «Conto vendita» per le magliette in negozio (conta,
              ordini e consegne); in Vendite, «Conto vendita» per il resoconto del mese, la fattura
              e il pagamento.
            </p>
            <ol className={roadbook.list}>
              {SHOP_STEPS.map(([title, text], index) => (
                <li key={title} className={roadbook.row}>
                  <div className={roadbook.spine}>
                    <span className={roadbook.spineValue}>{index + 1}</span>
                  </div>
                  <div className={roadbook.body}>
                    <span className={roadbook.title}>{title}</span>
                    <span className={styles.rowText}>{text}</span>
                  </div>
                </li>
              ))}
            </ol>
            <p className={styles.after}>
              Hai sbagliato un numero? Si corregge tutto e resta lo storico. Le magliette del
              negozio si cambiano solo dal conto vendita, non dalle Rettifiche.
            </p>
            <p className={styles.actions}>
              <Link href="/consignment" prefetch={false} className="button button-secondary">
                Apri le vendite del negozio
              </Link>
              <Link
                href="/stock/conto-vendita"
                prefetch={false}
                className="button button-secondary"
              >
                Apri il magazzino del negozio
              </Link>
            </p>
          </Part>

          <Part id="guida-finance">
            <dl className={styles.terms}>
              <div>
                <dt>Finance</dt>
                <dd>
                  Saldo dai movimenti, entrate, uscite e somme da incassare dai negozi. La apre chi
                  conosce la password Finance.
                </dd>
              </div>
            </dl>
            <p className={styles.after}>
              Costi e margini dei prodotti invece sono nel Magazzino e li vedono tutti: è voluto.
            </p>
            {access.finance ? (
              <div className={styles.box} data-guide="finance">
                <h3 className={styles.subTitle}>Aprire e chiudere Finance</h3>
                <p>
                  Tocca Finance nel menu e inserisci la password Finance. Resta aperta su questo
                  dispositivo fino a 8 ore dall’apertura. Prima di lasciare un dispositivo
                  condiviso, premi «Chiudi Finance» in cima alle pagine Finance, oppure chiudila da
                  «Account e sicurezza».
                </p>
                <h3 className={styles.subTitle}>Panoramica, Movimenti e Da incassare</h3>
                <p>
                  Finance si apre sulla Panoramica: saldo dai movimenti, entrate e uscite, con il
                  periodo e i conti scelti. Il saldo viene dalle registrazioni e non è verificato
                  con la banca. Voci future e in sospeso sono separate; quelle senza conto si
                  trovano in «Da attribuire». Tocca un valore o una barra per vedere i movimenti che
                  lo compongono.
                </p>
                <p>
                  In Movimenti cerca per descrizione, categoria, conto o importo. Controlla il
                  periodo: «Tutti i periodi» cerca anche negli altri anni; senza risultati trovi
                  «Cerca in tutti i periodi». In «Altri filtri» scegli stato e fonte.
                </p>
                <h3 className={styles.subTitle}>Aggiungere un movimento</h3>
                <p>
                  «Nuovo movimento» apre subito il modulo: Uscita o Entrata, importo senza segno,
                  data, descrizione, conto e categoria. Usa la virgola per i centesimi. Conto e
                  categoria sono facoltativi: «Da attribuire» e «Da classificare» li lasciano da
                  completare. Puoi anche scrivere un conto o una categoria personalizzati.
                </p>
                <p>
                  La data parte da oggi e non può essere futura: per una scadenza usa un promemoria
                  nel Calendario. Controlla che il movimento non sia già presente, conferma e premi
                  «Registra uscita» o «Registra entrata». «Registra e aggiungi un’altra» prepara il
                  modulo successivo solo dopo un salvataggio confermato.
                </p>
                <h3 className={styles.subTitle}>Correggere un movimento</h3>
                <p>
                  In Movimenti apri una riga: nella scheda correggi i dati con «Salva correzione»,
                  elimini il movimento o apri lo storico per tornare a una versione di prima. La
                  motivazione è facoltativa: lo storico dice comunque chi ha cambiato cosa e quando.
                  Chiudendo la scheda ritrovi ricerca e filtri. In «Altri filtri» lo stato
                  «Modificati» mostra i movimenti corretti.
                </p>
                <p>
                  Gli incassi delle vendite e i rimborsi Shopify non si eliminano da Finance: si
                  correggono soltanto. Se la vendita è sbagliata, annullala in Vendite con «Annulla
                  registrazione», oppure registra il reso con «Registra reso».
                </p>
                <p>
                  Un movimento eliminato esce dai saldi ma non si perde: in Movimenti scegli lo
                  stato «Eliminati · recuperabili», apri la scheda e ripristina una versione dallo
                  storico.
                </p>
                <h3 className={styles.subTitle}>Da incassare e documenti</h3>
                <p>
                  Da incassare mostra i residui dei resoconti dei negozi. Registra il pagamento dal
                  resoconto: non aggiungere anche un’entrata manuale. «Documenti e fonti» raccoglie
                  importazioni e dati originali, con il collegamento ai documenti.
                </p>
                <p className={styles.actions}>
                  <Link
                    href="/auth/area/finance"
                    prefetch={false}
                    className="button button-secondary"
                  >
                    Apri Finance
                  </Link>
                  <Link href="/finance/work" prefetch={false} className="button button-secondary">
                    Nuovo movimento
                  </Link>
                  <Link href="/auth/account" prefetch={false} className="button button-secondary">
                    Account e sicurezza
                  </Link>
                </p>
              </div>
            ) : (
              <p className={styles.after}>
                Per aprire Finance serve la password Finance.{" "}
                <Link href="/finance/work" prefetch={false}>
                  Apri Finance per aggiungere un movimento.
                </Link>
              </p>
            )}
          </Part>

          <Part id="guida-telefono">
            <ul className={styles.points}>
              <li>
                In basso trovi {list(bar.map((section) => section.label))}. In «Altro» ci sono{" "}
                {list([
                  ...altro.map((section) => section.label),
                  "questa guida",
                  "«Account e sicurezza»",
                  "«Esci»",
                ])}
                .
              </li>
              <li>
                Mentre scrivi in un campo la barra in basso si nasconde, così non copre quello che
                scrivi.
              </li>
              <li>
                Per aprirlo come un’app, aggiungilo alla schermata Home: su iPhone, in Safari, premi
                «Condividi» e poi «Aggiungi alla schermata Home».
              </li>
            </ul>
          </Part>

          <Part id="guida-aiuto">
            <ul className={styles.points}>
              <li>
                Un invio da verificare vuol dire che la connessione si è interrotta mentre salvavi.
                Premi «Verifica lo stesso invio» e non rifare l’operazione da capo: la registreresti
                due volte.
              </li>
              <li>
                Se il riquadro dice che il tentativo non si ripete, controlla che l’operazione non
                sia già nell’elenco, poi premi «Scarta questo tentativo». Scartare non cancella
                niente: libera solo il modulo.
              </li>
              <li>Non vedi una modifica appena fatta da un collega: ricarica la pagina.</li>
              <li>
                Un riquadro di Oggi dice «Non riesco a leggere…»: premi «Riprova» in quel riquadro.
                Gli altri riquadri restano.
              </li>
              <li>
                Una pagina dice «Qualcosa non ha funzionato.»: premi «Riprova». Se succede ancora,
                manda a Tommi il codice scritto sotto e l’ora.
              </li>
              <li>
                In Vendite compare un caso Shopify da verificare: avvisa Tommi e non registrare a
                mano lo stesso ordine.
              </li>
            </ul>
            <h3 className={styles.subTitle}>A chi chiedere</h3>
            <dl className={styles.terms}>
              {PEOPLE.map(([name, topics]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{topics}</dd>
                </div>
              ))}
            </dl>
          </Part>
        </div>
      </div>
    </div>
  );
}
