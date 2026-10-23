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
  oggi: "Il lavoro del giorno: agenda, contatti e solleciti, ordini da preparare e magazzino.",
  vendite: "Le vendite di LuckyLap, dirette e nei negozi.",
  magazzino:
    "Le magliette che abbiamo, quelle da correggere, il materiale per spedire e i riordini.",
  partner: "Negozi, eventi, club, media e brand da contattare, con i messaggi già scritti.",
  team: "Il lavoro di tutti i giorni del team.",
  finance: "Conti, movimenti e documenti del brand.",
};

/** Una frase per scheda: il test vuole tutte le schede della mappa. */
export const TAB_TEXT: Record<string, string> = {
  "/sales": "Vendite dirette ed Etsy, consegne e incassi. Gli ordini Shopify arrivano da soli.",
  "/consignment": "I negozi che vendono le nostre magliette e il loro resoconto del mese.",
  "/stock": "Ogni variante con le quantità del Magadzino e dei negozi, costi e prezzi.",
  "/stock/rettifiche": "Correggi una quantità in magazzino, sempre con la causale.",
  "/packaging": "Scatole e adesivi: una scatola e un adesivo per ogni T-shirt consegnata.",
  "/stock/riassortimento":
    "I riordini di magliette, dalla discussione su cosa riordinare all’arrivo in mano nostra, che le carica nel Magadzino.",
  "/team":
    "Il calendario del mese (un pallino sui giorni con impegni), le cose da fare, le note e le idee. Qui c’è anche «Partner nel Team».",
  "/development": "I prodotti nuovi, dall’idea al campione fino al prodotto pronto.",
  "/assets": "Loghi, grafiche, foto e video del brand, da scaricare o da aggiungere.",
  "/finance": "Conti e movimenti, con i saldi. Ogni movimento si corregge e si ripristina.",
  "/finance/work": "Le voci aggiunte a mano, accanto a quelle che arrivano dalle vendite.",
  "/finance/documents": "I file originali ricevuti, in archivio privato.",
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
    title: "Conto vendita: resoconto del mese e nuovo ordine",
    href: "/consignment",
    text: "In Vendite, Conto vendita: apri il negozio. Tutti i passi sono più sotto, in «Conto vendita e resoconto del mese».",
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
    title: "Partner: cambiare lo stato e copiare il messaggio",
    href: "/partner",
    text: "Apri il contatto, premi «Copia il testo» e, dopo l’invio, «Segna inviato». I passi sono più sotto, in «Partner».",
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
    text: "Gli appuntamenti di oggi e le tue attività in scadenza oggi o in ritardo. I solleciti Partner non sono qui: stanno nel riquadro accanto.",
  },
  {
    title: "Contatti e solleciti",
    text: "I contatti Partner da sentire, gli stessi di «Adesso» in Partner: «Da contattare» entro il mese prossimo, più quelli con la prossima azione di oggi o già passata. Sotto, i tuoi solleciti di oggi o in ritardo, ognuno con «Ha risposto».",
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
    "La prima volta conta le magliette, taglia per taglia. Finché il negozio non è contato, il resoconto resta chiuso.",
  ],
  [
    "Registra il resoconto del mese",
    "A inizio mese scrivi quante magliette ha venduto il negozio nel mese prima, taglia per taglia, e premi «Salva resoconto». Nessuna vendita? Salva con zero.",
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
    "Il negozio chiede magliette nuove: scrivi l’ordine. Quando le porti, premi «Consegnato».",
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
                Ogni riga è un contatto da sentire, con il suo numero CO. In alto scegli la sezione
                (Vendita, Eventi, Collab) e il periodo: «Adesso» sono i contatti da sentire entro il
                mese prossimo.
              </li>
              <li>
                Tocca un contatto per aprirlo: trovi i messaggi già scritti. Premi «Copia il testo»,
                mandalo dalla tua email o dal tuo telefono, poi premi «Segna inviato».
              </li>
              <li>
                Quando ti risponde, «Ha risposto». Lo stato si cambia dalla tendina della riga e si
                salva subito.
              </li>
              <li>
                «Segna inviato» e «Segna sollecito inviato» creano per te un’attività «Sollecito ·
                nome del contatto», che scade dopo 7 giorni: la conferma ti dice il giorno. La trovi
                in Oggi, in «Contatti e solleciti», e tra le attività del Team.
              </li>
              <li>
                Il sollecito si chiude da solo con «Ha risposto», qui o in Oggi, con un nuovo invio,
                con lo stato «Accordo fatto» o «Non interessato» e con «Metti tra i non contattare».
                Vale anche per i file «Esporta» dei dispositivi: un «Contattato» del file crea il
                sollecito per chi carica il file, 7 giorni dopo la data dell’esportazione (può
                essere già in ritardo); «Risposto» o «Accordo fatto» lo chiudono.
              </li>
              <li>
                Quando una scheda passa ad «Accordo fatto», le sue date di evento e candidatura
                compaiono da sole nel calendario del Team, come giornate intere. Senza accordo non
                ci sono: in calendario va solo dove ci saremo. «Ci siamo» in Partner mostra gli
                accordi fatti.
              </li>
              <li>
                In Team, «Partner nel Team» porta un contatto nel lavoro del team: l’evento nel
                calendario, un progetto per Produzione, l’attività per aprire un conto vendita e le
                vendite fatte all’evento. Con «Accordo fatto» la scheda ha il riquadro «Esito»:
                «Apri in Partner nel Team» apre quel contatto. «Collega l’evento» funziona anche se
                l’evento è già passato.
              </li>
              <li>Tutti vedono e possono fare tutto. «Seguito da» dice chi se ne occupa.</li>
              <li>
                In fondo alla pagina ci sono i lookbook da allegare e le regole per scrivere i
                messaggi.
              </li>
            </ul>
            <p className={styles.actions}>
              <Link href="/partner" prefetch={false} className="button button-secondary">
                Apri Partner
              </Link>
              <Link href="/team/partner" prefetch={false} className="button button-secondary">
                Apri Partner nel Team
              </Link>
            </p>
          </Part>

          <Part id="guida-conto-vendita">
            <p className={styles.lead}>
              I negozi tengono le nostre magliette e ci pagano quelle che vendono. Da Vendite apri
              «Conto vendita», poi il negozio.
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
              negozio si cambiano solo da qui, non dalle Rettifiche.
            </p>
            <p className={styles.actions}>
              <Link href="/consignment" prefetch={false} className="button button-secondary">
                Apri Conto vendita
              </Link>
            </p>
          </Part>

          <Part id="guida-finance">
            <dl className={styles.terms}>
              <div>
                <dt>Finance</dt>
                <dd>
                  Conti, movimenti, registrazioni e documenti del brand. La apre chi conosce la
                  password Finance.
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
                <h3 className={styles.subTitle}>Correggere un movimento</h3>
                <p>
                  In Panoramica e in Registrazioni ogni movimento ha «Modifica / storico». Lì
                  correggi i dati con «Salva correzione», lo elimini o torni a una versione di prima
                  dallo storico. La motivazione è facoltativa: lo storico dice comunque chi ha
                  cambiato cosa e quando. In Panoramica lo stato «Modificati» mostra i movimenti
                  corretti.
                </p>
                <p>
                  Gli incassi delle vendite e i rimborsi Shopify non si eliminano da Finance: si
                  correggono soltanto. Se la vendita è sbagliata, annullala in Vendite con «Annulla
                  registrazione», oppure registra il reso con «Registra reso».
                </p>
                <p>
                  Un movimento eliminato esce dai saldi ma non si perde: in Panoramica scegli lo
                  stato «Eliminati · recuperabili» e premi «Ripristina / storico».
                </p>
                <p className={styles.actions}>
                  <Link
                    href="/auth/area/finance"
                    prefetch={false}
                    className="button button-secondary"
                  >
                    Apri Finance
                  </Link>
                  <Link href="/auth/account" prefetch={false} className="button button-secondary">
                    Account e sicurezza
                  </Link>
                </p>
              </div>
            ) : (
              <p className={styles.after}>Per aprire Finance serve la password Finance.</p>
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
