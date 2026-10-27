import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PARTNER_ASSISTANT_CHECK_CODES,
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

// Le tre prime email d'esempio delle regole v1 (sezione «Esempi di tono»), lette dalla migrazione e
// mai copiate qui: hanno nomi veri. Oggetto senza etichetta, corpo dal saluto alla formula di
// chiusura, firma nella loro lingua. I casi costruiti a mano usano solo nomi sintetici.
const migration = readFileSync(
  new URL("../../../supabase/migrations/20261027133105_assistente_partner.sql", import.meta.url),
  "utf8",
);
const rulesV1 = /\$regole\$([\s\S]*?)\$regole\$/u.exec(migration)?.[1] ?? "";
const LANGUAGES: Record<string, PartnerAssistantLanguage> = {
  italiano: "it",
  inglese: "en",
  tedesco: "de",
};
type RuleExample = { label: string; draft: CheckedDraft; porsche: boolean };
const ruleExamples: RuleExample[] = (rulesV1.split("\n## Esempi di tono")[1] ?? "")
  .split("\n## ")[0]!
  .split("\n### ")
  .slice(1)
  .map((section) => {
    const [heading = "", ...rest] = section.split("\n");
    const [subjectLine = "", ...body] = rest.join("\n").trim().split("\n");
    const language = LANGUAGES[/in (\p{L}+)$/u.exec(heading)?.[1] ?? ""] ?? "it";
    const request = /`([a-z_]+)`/u.exec(heading)?.[1] ?? "";
    return {
      label: `${request}, ${language}`,
      draft: {
        language,
        subject: subjectLine.replace(/^(?:Oggetto|Subject|Betreff): /u, ""),
        body: body.join("\n"),
        signature: partnerAssistantSignature(language, PHONE),
        rulesVersion: 1,
      },
      // «comunità Porsche», «shop Porsche»: il titolo dell'esempio dice se lo è.
      porsche: /Porsche/u.test(heading),
    };
  });
const example = (index: number): CheckedDraft => ruleExamples[index]!.draft;

/** Proposta e lingua, comunità Porsche, parole del corpo, nell'ordine delle regole. */
const EXAMPLES: [string, CheckedDraft, boolean, number][] = ruleExamples.map(
  ({ label, draft, porsche }, index) => [label, draft, porsche, [149, 158, 150][index]!],
);

describe("gli esempi delle regole, letti dalla migrazione", () => {
  it("sono tre, con oggetto, corpo e lingua", () => {
    expect(ruleExamples.map(({ label, porsche }) => [label, porsche])).toEqual([
      ["stand_evento, it", false],
      ["merch_cobranding, en", true],
      ["collab_capsule, de", true],
    ]);
    for (const { draft } of ruleExamples) {
      expect(draft.subject).not.toMatch(/^(?:Oggetto|Subject|Betreff)/u);
      expect(draft.subject).toContain("LuckyLap");
      expect(draft.body.split("\n").length).toBeGreaterThan(5);
      expect(draft.body).not.toContain("###");
    }
  });
});

const valid = example(0);
const context = {
  porscheCommunity: false,
  currentRulesVersion: 1,
  phone: PHONE,
  names: [] as string[],
};
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
        names: [],
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
    expect(fails({ ...valid, subject: "Mitgliederrabatt für Club Sintetico" })).toEqual([
      "parola_vietata",
    ]));
  it.each([
    "22 anni",
    "we're all 22",
    "we’re all 22",
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
    "aperto dalle 18 alle 22",
    "all 22 cars on display",
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
    expect(fails({ ...valid, body: valid.body.replace("?", ".") })).toEqual(["domande"]));
  it("¿ non conta come domanda", () =>
    expect(fails({ ...valid, body: valid.body.replace(/^(.*\?)$/mu, "¿$1") })).toEqual([]));
  it("esclamativo ed emoji nell'oggetto", () => {
    expect(fails({ ...valid, subject: "LuckyLap a Fiera Sintetica!" })).toEqual(["esclamativo"]);
    expect(fails({ ...valid, subject: "LuckyLap a Fiera Sintetica 🏎️" })).toEqual(["emoji"]);
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
    "Boxster",
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
        { ...example(1), subject: "Club Sintetico, the 911 and LuckyLap" },
        {
          porscheCommunity: true,
        },
      ),
    ).toEqual(["modello_porsche"]));
  it.each([
    "964",
    "GT3 RS",
    "GT3RS",
    "Elfer",
    "nel 1993",
    "targato Milano",
    "una targa ricordo",
    "la carrera de Le Mans",
  ])("%s è ammesso", (m) =>
    expect(fails(withBody(`… ${m} …`), { porscheCommunity: true })).toEqual([]),
  );
  it("senza comunità Porsche i modelli non contano", () =>
    expect(fails(withBody("… la 993 e la Carrera …"))).toEqual([]));
});

describe("nome del contatto e modelli Porsche", () => {
  const club = { porscheCommunity: true, names: ["Porsche 356 Club Sintetico"] };
  const named = { ...valid, subject: "Porsche 356 Club Sintetico e LuckyLap" };
  it("il nome della scheda nell'oggetto passa, anche con un modello dentro", () =>
    expect(fails(named, club)).toEqual([]));
  it("il nome dell'evento nel corpo passa", () =>
    expect(
      fails(withBody("… al Raduno Carrera Sintetico …"), {
        porscheCommunity: true,
        names: ["Club Sintetico", "Raduno Carrera Sintetico"],
      }),
    ).toEqual([]));
  it("un modello fuori dal nome resta vietato", () =>
    expect(fails({ ...withBody("… la 993 …"), subject: named.subject }, club)).toEqual([
      "modello_porsche",
    ]));
  it("solo le occorrenze esatte del nome", () =>
    expect(fails({ ...valid, subject: "Porsche 356 club sintetico e LuckyLap" }, club)).toEqual([
      "modello_porsche",
    ]));
  it("senza nomi il nome con un modello non passa", () =>
    expect(fails(named, { porscheCommunity: true })).toEqual(["modello_porsche"]));
  it("un nome vuoto non toglie niente", () =>
    expect(fails(named, { porscheCommunity: true, names: ["", " "] })).toEqual([
      "modello_porsche",
    ]));
  it("il nome non vale per gli altri controlli", () =>
    expect(
      fails(
        { ...valid, subject: "Club Sintetico Rabatt e LuckyLap" },
        { names: ["Club Sintetico Rabatt"] },
      ),
    ).toEqual(["parola_vietata"]));
});

describe("oggetto su una riga", () => {
  it.each([
    ["a capo", "LuckyLap\na Fiera Sintetica"],
    ["ritorno a capo", "LuckyLap\ra Fiera Sintetica"],
    ["tab", "LuckyLap\ta Fiera Sintetica"],
  ])("oggetto con un %s", (_, subject) =>
    expect(fails({ ...valid, subject })).toEqual(["oggetto"]),
  );
  it("il corpo va a capo come sempre", () => expect(fails(valid)).toEqual([]));
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
        {
          ...withBody("Tommi! Tommi! 🏁 [nome]"),
          subject: "LuckyLap\na Fiera Sintetica",
          signature: "Tommi",
        },
        { currentRulesVersion: 2 },
      ),
    ).toEqual([
      "parola_vietata",
      "segnaposto",
      "esclamativo",
      "emoji",
      "firma",
      "oggetto",
      "regole_superate",
    ]));
  it("l'elenco dei codici", () =>
    expect(PARTNER_ASSISTANT_CHECK_CODES).toEqual([
      "parola_vietata",
      "segnaposto",
      "domande",
      "esclamativo",
      "emoji",
      "link",
      "telefono",
      "firma",
      "modello_porsche",
      "lunghezza",
      "oggetto",
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
