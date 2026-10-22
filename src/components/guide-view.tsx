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
import {
  SECTIONS,
  mobileSplit,
  visibleSections,
  type IconName,
  type SectionId,
} from "../lib/navigation";
import roadbook from "./roadbook.module.css";
import styles from "./guide-view.module.css";

/**
 * «Come si usa» (docs: workspace-layout.md, «La guida»). Testo fisso, scritto sull'app
 * com'è oggi: quando una pagina cambia nome, scopo o pulsanti, si aggiorna anche qui.
 * Il menu descritto è quello della persona: Finance e Controllo CEO solo a chi li apre.
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

/** Una frase per sezione del menu (`SECTIONS`): il test vuole tutte le sezioni. */
export const SECTION_TEXT: Record<SectionId, string> = {
  oggi: "Il punto di partenza: cosa c’è in agenda e cosa manca in magazzino.",
  vendite: "Le vendite di LuckyLap, dirette e nei negozi.",
  magazzino: "Le magliette che abbiamo, quelle da correggere e il materiale per spedire.",
  partner: "Negozi, eventi, club, media e brand da contattare, con i messaggi già scritti.",
  team: "Il lavoro di tutti i giorni del team.",
  finance: "Conti, movimenti e documenti del brand.",
  ceo: "Cosa viene fatto sui dati condivisi, e da chi.",
};

/** Una frase per scheda: il test vuole tutte le schede della mappa. */
export const TAB_TEXT: Record<string, string> = {
  "/sales": "Vendite dirette ed Etsy, consegne e incassi. Gli ordini Shopify arrivano da soli.",
  "/consignment": "I negozi che vendono le nostre magliette e il loro resoconto del mese.",
  "/stock": "Ogni variante con le quantità del Magadzino e dei negozi, costi e prezzi.",
  "/stock/rettifiche": "Correggi una quantità in magazzino, sempre con la causale.",
  "/packaging": "Scatole e adesivi: una scatola e un adesivo per ogni T-shirt consegnata.",
  "/team": "Call, consegne e momenti di lavoro, cose da fare, note e idee.",
  "/development": "I prodotti nuovi, dall’idea al campione fino al prodotto pronto.",
  "/assets": "Loghi, grafiche, foto e video del brand, da scaricare o da aggiungere.",
  "/finance": "Conti e movimenti, con i saldi.",
  "/finance/work": "Le voci aggiunte a mano, accanto a quelle che arrivano dalle vendite.",
  "/finance/documents": "I file originali ricevuti, in archivio privato.",
};

/** Le sette parti della guida, nell'ordine dell'indice. */
export const GUIDE_PARTS = [
  { id: "guida-accesso", title: "Entrare e uscire", short: "Entrare e uscire" },
  { id: "guida-menu", title: "Il menu", short: "Il menu" },
  { id: "guida-partner", title: "Partner", short: "Partner" },
  {
    id: "guida-conto-vendita",
    title: "Conto vendita e resoconto del mese",
    short: "Conto vendita",
  },
  { id: "guida-finance", title: "Finance e Controllo CEO", short: "Finance e Controllo CEO" },
  { id: "guida-telefono", title: "Sul telefono", short: "Sul telefono" },
  { id: "guida-aiuto", title: "Se qualcosa non va", short: "Se qualcosa non va" },
] as const;
type PartId = (typeof GUIDE_PARTS)[number]["id"];

const WORDS: [string, string][] = [
  ["Pronti", "I capi che ci sono davvero in magazzino."],
  ["Riservati", "Già promessi a un ordine."],
  ["Disponibili", "Pronti meno riservati: quelli che puoi vendere."],
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
  const visible = visibleSections({ status: "member", displayName: "", ...access });
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
          Anteprima locale: la guida come la vede Tommi, con Finance e Controllo CEO.
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

          <Part id="guida-menu">
            <p className={styles.lead}>
              Sul computer il menu è a sinistra, sul telefono in basso. Le sezioni con più pagine
              hanno le schede in alto. Questo è il tuo menu:
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
            {!access.finance && (
              <p className={styles.after}>
                Finance e Controllo CEO non sono nel tuo menu: il tuo account non li apre.
              </p>
            )}
            {access.finance && !access.ceo && (
              <p className={styles.after}>Controllo CEO non è nel tuo menu: lo apre solo Tommi.</p>
            )}
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
                  Conti, movimenti, registrazioni e documenti del brand. La aprono Tommi, Gabriele e
                  Gherardo, con la password Finance.
                </dd>
              </div>
              <div>
                <dt>Controllo CEO</dt>
                <dd>
                  Cosa viene fatto sui dati condivisi, e da chi. Lo apre solo Tommi, con la password
                  CEO.
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
                  Tocca Finance nel menu e inserisci la password Finance. Resta aperta in questa
                  sessione fino a 8 ore. Prima di lasciare un dispositivo condiviso, chiudila da
                  «Account e sicurezza».
                </p>
                {access.ceo && <p>Controllo CEO funziona allo stesso modo, con la password CEO.</p>}
                <p className={styles.actions}>
                  <Link
                    href="/auth/area/finance"
                    prefetch={false}
                    className="button button-secondary"
                  >
                    Apri Finance
                  </Link>
                  {access.ceo && (
                    <Link
                      href="/auth/area/audit"
                      prefetch={false}
                      className="button button-secondary"
                    >
                      Apri Controllo CEO
                    </Link>
                  )}
                  <Link href="/auth/account" prefetch={false} className="button button-secondary">
                    Account e sicurezza
                  </Link>
                </p>
              </div>
            ) : (
              <p className={styles.after}>
                Il tuo account non apre Finance. Se ti serve un dato, chiedi a Gherardo o a Tommi.
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
              <li>Non vedi una modifica appena fatta da un collega: ricarica la pagina.</li>
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
