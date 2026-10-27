import { describe, expect, it } from "vitest";
import {
  checkPartnerAssistantDraft,
  partnerAssistantBodyWords,
  partnerAssistantDraftSha256,
  partnerAssistantSignature,
  type PartnerAssistantCheckCode,
} from "./checks";
import type { PartnerAssistantDraft, PartnerAssistantLanguage } from "./types";

// Solo il telefono finto: il numero vero arriva da PARTNER_ASSISTANT_PHONE e non entra mai nel
// repository.
const PHONE = "+39 000 000 0000";

type CheckedDraft = Pick<
  PartnerAssistantDraft,
  "language" | "subject" | "body" | "signature" | "rulesVersion"
>;

// Le tre prime email dell'Appendice A (regole v1, «Esempi di tono»), carattere per carattere:
// oggetto senza etichetta, corpo dal saluto alla formula di chiusura, firma nella loro lingua.
const autoClassica: CheckedDraft = {
  language: "it",
  subject: "LuckyLap a Milano AutoClassica",
  body: [
    "Buongiorno,",
    "complimenti per il programma della sedicesima edizione: ci ha fatto davvero piacere scoprire il MAC Next Generation Hub, che avvicina la nostra generazione alle auto classiche.",
    "Sono Tommaso di LuckyLap: siamo un gruppo di giovani appassionati di auto, a Milano. Disegniamo noi ogni maglietta e ogni auto che ricamiamo in Italia su cotone biologico, in puro stile quiet luxury.",
    "Le nostre magliette sono già in vendita in centro, a un minuto dal Duomo, e su https://luckylap.com. Tra chi le indossa ci sono piloti di Formula 1.",
    "Abbiamo tanta voglia di esserci con uno stand dedicato, curato nei dettagli e in linea con l'evento.",
    "Sarebbe un'offerta in più per i vostri visitatori, e il ricamo si apprezza dal vivo.",
    "Avreste ancora spazio per noi in fiera?",
    "Vi chiedo gentilmente un recapito telefonico per approfondire insieme: il mio numero lo trovate qui sotto.",
    "Grazie mille e buon lavoro per queste settimane.",
    "Un cordiale saluto,",
  ].join("\n"),
  signature: [
    "Tommaso",
    "Fondatore, LuckyLap",
    PHONE,
    "https://luckylap.com | Instagram @lucky.lap",
  ].join("\n"),
  rulesVersion: 1,
};
const porscheClubGb: CheckedDraft = {
  language: "en",
  subject: "Porsche Club GB and LuckyLap",
  body: [
    "Good morning,",
    "Many congratulations on the Club's 65th anniversary. The members-only watch, limited to 100, was a lovely touch.",
    "I'm Tommaso from LuckyLap – we're a group of young car enthusiasts in Milan. We design every T-shirt and draw every car ourselves, the 964 and the GT3 RS among them, and have them embroidered in Italy on organic cotton, in true quiet-luxury style.",
    "Our T-shirts have travelled to more than ten countries, and for the Porsche Club Toscana we made 150 bespoke ones with the club's crest on the sleeve. The collection is at https://luckylap.com.",
    "We'd love to do the same with the Club: co-branded T-shirts with your crest embroidered alongside our cars.",
    "It would give you an exclusive piece to offer or sell to your members and at events, and we'd look after design, embroidery and delivery.",
    "Would the Club be open to that?",
    "I'd be grateful for a number so we can talk it through; mine is just below.",
    "Many thanks, and warm wishes from Milan,",
  ].join("\n"),
  signature: [
    "Tommaso",
    "Founder, LuckyLap",
    PHONE,
    "https://luckylap.com | Instagram @lucky.lap",
  ].join("\n"),
  rulesVersion: 1,
};
const elferspot: CheckedDraft = {
  language: "de",
  subject: "Elferspot und LuckyLap",
  body: [
    "Guten Tag,",
    "Ihre Capsule „Clubsport“ mit Jay Blanc hat uns wirklich gefallen: Man spürt darin, wie sehr Sie die Porsche-Kultur leben.",
    "Ich bin Tommaso von LuckyLap: Wir sind eine Gruppe junger Autobegeisterter aus Mailand. Wir entwerfen jedes Shirt und zeichnen jedes Auto selbst, etwa den 964 oder den GT3 RS, und lassen sie in Italien auf Bio-Baumwolle sticken, ganz im Quiet-Luxury-Stil.",
    "Für den Porsche Club Toscana haben wir eigens 150 Shirts mit dem Clublogo am Ärmel angefertigt. Unsere Kollektion finden Sie unter https://luckylap.com.",
    "Wir hätten große Lust, gemeinsam mit Elferspot eine limitierte Capsule zu entwerfen.",
    "Für Ihren Shop und Ihre Community wäre das ein neues Produkt, das Ihren Namen auch zu denen bringt, die unsere Shirts in mehr als zehn Ländern tragen.",
    "Wäre das grundsätzlich etwas für Sie?",
    "Gern bespreche ich das mit Ihnen am Telefon; über Ihre Nummer würde ich mich freuen, meine finden Sie unten.",
    "Herzlichen Dank für Ihre Zeit.",
    "Freundliche Grüße aus Mailand",
  ].join("\n"),
  signature: [
    "Tommaso",
    "Gründer, LuckyLap",
    PHONE,
    "https://luckylap.com | Instagram @lucky.lap",
  ].join("\n"),
  rulesVersion: 1,
};

/** Nome, bozza, comunità Porsche, parole del corpo. */
const EXAMPLES: [string, CheckedDraft, boolean, number][] = [
  ["Milano AutoClassica", autoClassica, false, 149],
  ["Porsche Club GB", porscheClubGb, true, 158],
  ["Elferspot", elferspot, true, 150],
];

const valid = autoClassica;
const context = { porscheCommunity: false, currentRulesVersion: 1, phone: PHONE };
function fails(
  draft: CheckedDraft,
  overrides: Partial<typeof context> = {},
): PartnerAssistantCheckCode[] {
  const result = checkPartnerAssistantDraft(draft, { ...context, ...overrides });
  return result.ok ? [] : result.failures;
}
/** L'esempio valido con una riga in più prima del grazie: 149 parole più quelle della riga. */
function withBody(line: string): CheckedDraft {
  const lines = valid.body.split("\n");
  lines.splice(-2, 0, line);
  return { ...valid, body: lines.join("\n") };
}
function withGreeting(greeting: string): CheckedDraft {
  const [, ...rest] = valid.body.split("\n");
  return { ...valid, body: [greeting, ...rest].join("\n") };
}
/** Un corpo valido di `words` parole, con saluto, una sola domanda e chiusura. */
function bodyOf(words: number): string {
  return ["Buongiorno,", `${"parola ".repeat(words - 1)}fiera?`, "Un saluto,"].join("\n");
}
const twoQuestions = withBody("Vi andrebbe di sentirci?");
const shortBody = { ...valid, body: bodyOf(40) };

describe("bozze dell'assistente Partner: i casi validi", () => {
  it.each(EXAMPLES)("l'esempio %s passa", (_, d, porsche) =>
    expect(
      checkPartnerAssistantDraft(d, {
        porscheCommunity: porsche,
        currentRulesVersion: 1,
        phone: PHONE,
      }),
    ).toEqual({ ok: true }),
  );
  it.each(EXAMPLES)("l'esempio %s ha le parole attese", (_, d, __, words) =>
    expect(partnerAssistantBodyWords(d.body)).toBe(words),
  );
});

describe("parole vietate", () => {
  it("conto vendita ripreso dalla ricerca importata", () =>
    expect(fails(withBody("…possiamo valutare un conto vendita…"))).toEqual(["parola_vietata"]));
  it.each([
    "consignment",
    "sale-or-return",
    "sale or return",
    "Kommission",
    "Kommissionsware",
    "dépôt-vente",
    "en depósito",
    "Made in Italy",
    "Tommi",
    "40 €",
    "$40",
    "£40",
    "40 EUR",
    "40 USD",
    "uno sconto",
    "sconti",
    "a discount",
    "Rabatt",
    "une remise",
    "un descuento",
    "un campione",
    "campioni",
    "a sample",
    "samples",
    "des échantillons",
    "un échantillon",
  ])("rifiuta %s", (w) => expect(fails(withBody(`… ${w} …`))).toEqual(["parola_vietata"]));
  // Le parole vietate valgono anche in fondo a un composto: il confine a sinistra c'è solo per
  // «remise», «en depósito» e l'età, dove una parola comune finisce con quella vietata.
  it.each([
    "Mitgliederrabatt",
    "Mengenrabatt",
    "Sonderrabatt",
    "Händlerrabatt",
    "handmade in Italy",
    "Handmade in Italy",
    "Verkaufskommission",
    "un supersconto",
    "maxisconti",
    "a superdiscount",
    "un superdescuento",
    "Produktsamples",
    "reconsignment",
  ])("rifiuta il composto %s", (w) =>
    expect(fails(withBody(`… ${w} …`))).toEqual(["parola_vietata"]),
  );
  it("rifiuta il composto anche nell'oggetto", () =>
    expect(fails({ ...valid, subject: "Mitgliederrabatt für Porsche Club GB" })).toEqual([
      "parola_vietata",
    ]));
  it.each([
    "22 anni",
    "we're all 22",
    "alle 22 Jahre alt",
    "mit 22 Jahren",
    "22 years old",
    "nous avons tous 22 ans",
    "tenemos todos 22 años",
    "tutti di 22",
    "twenty-two",
    "twenty two",
  ])("età: %s", (w) => expect(fails(withBody(`… ${w} …`))).toEqual(["parola_vietata"]));
  it("anche nell'oggetto", () =>
    expect(fails({ ...valid, subject: "Tommi e LuckyLap" })).toEqual(["parola_vietata"]));
  it.each([
    "Tommaso",
    "tommi",
    "leur heure en Europe",
    "Neuroni e USDA",
    "la premise",
    "tienen depósito",
    "122 anni",
    "alle 220",
    "Halle 22",
    "l'Europe et leur équipe",
  ])("%s non è vietato", (w) => expect(fails(withBody(`… ${w} …`))).toEqual([]));
});

describe("segnaposto", () => {
  it("«todo» spagnolo non è un segnaposto", () =>
    expect(fails(withBody("… todo el equipo …"))).toEqual([]));
  it("segnaposto", () => expect(fails(withGreeting("Dear [first name],"))).toEqual(["segnaposto"]));
  it.each(["{{nome}}", "[Nome]", "first name", "Last Name", "Nachname", "Vorname", "XXX", "TODO"])(
    "rifiuta %s",
    (w) => expect(fails(withBody(`… ${w} …`))).toEqual(["segnaposto"]),
  );
  it("anche nell'oggetto", () =>
    expect(fails({ ...valid, subject: "LuckyLap a [evento]" })).toEqual(["segnaposto"]));
  it.each(["xxx", "XXXL", "Vornamen"])("%s non è un segnaposto", (w) =>
    expect(fails(withBody(`… ${w} …`))).toEqual([]),
  );
});

describe("punteggiatura e simboli", () => {
  it("domande, esclamativi ed emoji", () => {
    expect(fails(twoQuestions)).toEqual(["domande"]);
    expect(fails(withBody("¡Hola!"))).toEqual(["esclamativo"]);
    expect(fails(withBody("🏁"))).toEqual(["emoji"]);
  });
  it("nessuna domanda", () =>
    expect(fails({ ...valid, body: valid.body.replace("in fiera?", "in fiera.") })).toEqual([
      "domande",
    ]));
  it("¿ non conta come domanda", () =>
    expect(fails({ ...valid, body: valid.body.replace("Avreste", "¿Avreste") })).toEqual([]));
  it("esclamativo ed emoji nell'oggetto", () => {
    expect(fails({ ...valid, subject: "LuckyLap a Milano AutoClassica!" })).toEqual([
      "esclamativo",
    ]);
    expect(fails({ ...valid, subject: "LuckyLap a Milano AutoClassica 🏎️" })).toEqual(["emoji"]);
  });
});

describe("link", () => {
  it.each(["Gent.ma", "Dott.ssa", "Sig.ra", "z.B.", "1.000"])("%s non è un link", (w) =>
    expect(fails(withBody(`… ${w} …`))).toEqual([]),
  );
  it("link diversi da luckylap.com", () =>
    expect(fails(withBody("vedi www.altro.example.test"))).toEqual(["link"]));
  it("link con https e punto finale", () =>
    expect(fails(withBody("… su https://luckylap.com."))).toEqual([]));
  it("pagina interna del sito", () =>
    expect(fails(withBody("… https://luckylap.com/pages/porsche …"))).toEqual(["link"]));
  it.each([
    "luckylap.com",
    "www.luckylap.com",
    "https://www.luckylap.com/",
    "(https://luckylap.com),",
    "luckylap.com;",
  ])("%s è la home", (w) => expect(fails(withBody(`… ${w} …`))).toEqual([]));
  it.each([
    "http://luckylap.com",
    "https://altro.example.test",
    "altro.com",
    "Altro.IT",
    "shop.altro.de/prodotti",
    "luckylap.com/pages/porsche",
    "www.luckylap.com/collections",
    "https://luckylap.com.altro.it",
  ])("%s non è ammesso", (w) => expect(fails(withBody(`… ${w} …`))).toEqual(["link"]));
  it("anche nell'oggetto", () =>
    expect(fails({ ...valid, subject: "LuckyLap e altro.it" })).toEqual(["link"]));
});

describe("telefono", () => {
  it("numero nel corpo", () =>
    expect(fails(withBody("… chiamami al +39 000 000 0000 …"))).toEqual(["telefono"]));
  it.each(["+390000000000", "000 0000 000", "00000000"])("rifiuta %s", (w) =>
    expect(fails(withBody(`… ${w} …`))).toEqual(["telefono"]),
  );
  it("una data non è un numero di telefono", () =>
    expect(fails(withBody("… il 2026-11-19 …"))).toEqual([]));
  it.each(["0000000", "150 magliette in 10 paesi", "1.000.000"])("%s non è un telefono", (w) =>
    expect(fails(withBody(`… ${w} …`))).toEqual([]),
  );
});

describe("firma", () => {
  it("firma sbagliata", () => expect(fails({ ...valid, signature: "Tommi" })).toEqual(["firma"]));
  it("firma in un'altra lingua", () =>
    expect(fails({ ...valid, signature: partnerAssistantSignature("en", PHONE) })).toEqual([
      "firma",
    ]));
  it("firma con un altro numero", () =>
    expect(fails(valid, { phone: "+39 000 000 0001" })).toEqual(["firma"]));
  it("firma tedesca", () =>
    expect(partnerAssistantSignature("de", "+39 000 000 0000")).toBe(
      "Tommaso\nGründer, LuckyLap\n+39 000 000 0000\nhttps://luckylap.com | Instagram @lucky.lap",
    ));
  it.each([
    ["it", "Fondatore"],
    ["en", "Founder"],
    ["de", "Gründer"],
    ["fr", "Fondateur"],
    ["es", "Fundador"],
  ] as [PartnerAssistantLanguage, string][])("firma in %s: %s", (language, role) =>
    expect(partnerAssistantSignature(language, PHONE).split("\n")).toEqual([
      "Tommaso",
      `${role}, LuckyLap`,
      PHONE,
      "https://luckylap.com | Instagram @lucky.lap",
    ]),
  );
});

describe("modelli Porsche", () => {
  it.each(["F40", "993", "Carrera", "Cayman"])("%s con un club Porsche", (m) =>
    expect(fails(withBody(`… la ${m} …`), { porscheCommunity: true })).toEqual(["modello_porsche"]),
  );
  it.each([
    "512 TR",
    "512TR",
    "300 SL",
    "Project 88",
    "911",
    "911er",
    "930",
    "959",
    "991",
    "992",
    "996",
    "997",
    "356",
    "718",
    "boxster",
    "Macan",
    "Cayenne",
    "Taycan",
    "Panamera",
    "Speedster",
    "Targa",
  ])("rifiuta %s", (m) =>
    expect(fails(withBody(`… la ${m} …`), { porscheCommunity: true })).toEqual(["modello_porsche"]),
  );
  it("anche nell'oggetto", () =>
    expect(
      fails(
        { ...porscheClubGb, subject: "Porsche Club GB, the 911 and LuckyLap" },
        {
          porscheCommunity: true,
        },
      ),
    ).toEqual(["modello_porsche"]));
  it.each(["964", "GT3 RS", "GT3RS", "Elfer", "nel 1993", "targato Milano"])("%s è ammesso", (m) =>
    expect(fails(withBody(`… ${m} …`), { porscheCommunity: true })).toEqual([]),
  );
  it("senza comunità Porsche i modelli non contano", () =>
    expect(fails(withBody("… la 993 e la Carrera …"))).toEqual([]));
});

describe("lunghezza", () => {
  it("lunghezza fuori dai 110-160", () => expect(fails(shortBody)).toEqual(["lunghezza"]));
  it.each([109, 161])("%i parole non passano", (n) =>
    expect(fails({ ...valid, body: bodyOf(n) })).toEqual(["lunghezza"]),
  );
  it.each([110, 160])("%i parole passano", (n) =>
    expect(fails({ ...valid, body: bodyOf(n) })).toEqual([]),
  );
  it("senza saluto e chiusura, e con le parole fatte di lettere o cifre", () => {
    expect(partnerAssistantBodyWords("Ciao,\nuna due – tre +39 1.000\nA presto,")).toBe(5);
    expect(partnerAssistantBodyWords("\nCiao,\n\nuna due\n\nA presto,\n\n")).toBe(2);
    expect(partnerAssistantBodyWords("Ciao,\nA presto,")).toBe(0);
  });
});

describe("regole e insieme dei controlli", () => {
  it("regole superate", () =>
    expect(fails({ ...valid, rulesVersion: 1 }, { currentRulesVersion: 2 })).toEqual([
      "regole_superate",
    ]));
  it("riporta ogni controllo fallito, una volta, nell'ordine dei codici", () =>
    expect(
      fails(
        { ...withBody("Tommi! Tommi! 🏁 [nome]"), signature: "Tommi" },
        { currentRulesVersion: 2 },
      ),
    ).toEqual([
      "parola_vietata",
      "segnaposto",
      "esclamativo",
      "emoji",
      "firma",
      "regole_superate",
    ]));
});

describe("impronta della bozza", () => {
  it("sha256 di oggetto, corpo e firma separati da una riga vuota", () => {
    expect(partnerAssistantDraftSha256({ subject: "a", body: "b", signature: "c" })).toBe(
      "12f8580f598888bc1579dc0ea62275fcf70ffdbefcab8df6b5df8a5bf5c4bb82",
    );
    expect(partnerAssistantDraftSha256({ subject: "Grüße", body: "b", signature: "c" })).toBe(
      "44c6570163608e4d960798fd4a5e4a57050e8014fdb93bd09d488ea8ad46f4e9",
    );
  });
});
