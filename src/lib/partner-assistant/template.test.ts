import { describe, expect, it } from "vitest";
import { checkPartnerAssistantDraft, partnerAssistantBodyWords } from "./checks";
import {
  composePartnerAssistantTemplate,
  PARTNER_ASSISTANT_TEMPLATE_REASON,
  PARTNER_ASSISTANT_TEMPLATE_REGISTER,
  PARTNER_ASSISTANT_TEMPLATES,
  partnerAssistantTemplateClubName,
  partnerAssistantTemplateLanguage,
  partnerAssistantTemplateBrand,
  partnerAssistantTemplatePorsche,
  partnerAssistantTemplateBlocked,
  partnerAssistantTemplateSignature,
  partnerAssistantTemplateTimezone,
  partnerAssistantUsesTemplate,
} from "./template";
import type { PartnerAssistantLanguage } from "./types";

const phone = "+39 000 000 0001";
const BRANDS = ["porsche", "ferrari", "mercedes", null] as const;
const partner = (fields: {
  name?: string;
  city?: string;
  country?: string;
  typeLabel?: string;
  lang?: string;
}) => ({
  name: fields.name ?? "Porsche Club Sintetico",
  city: fields.city ?? "",
  country: fields.country ?? "Germania",
  typeLabel: fields.typeLabel ?? "Porsche Club",
  research: fields.lang === undefined ? {} : { lang: fields.lang },
});

describe("testo fisso per i club", () => {
  it("cinque lingue, una domanda, nessun punto esclamativo, tra 180 e 260 parole, con ogni marca", () => {
    for (const language of Object.keys(PARTNER_ASSISTANT_TEMPLATES) as PartnerAssistantLanguage[]) {
      for (const brand of BRANDS) {
        const text = PARTNER_ASSISTANT_TEMPLATES[language];
        const body = text.body("Porsche Club Sintetico", brand);
        expect(body.match(/\?/gu)).toHaveLength(1);
        expect(body).not.toMatch(/[!¡]/u);
        expect(body).toContain("Porsche Club Sintetico");
        expect(body).toContain("150");
        expect(text.subject("Porsche Club Sintetico")).toContain("Porsche Club Sintetico");
        const words = partnerAssistantBodyWords(body);
        expect(words, `${language} ${brand}`).toBeGreaterThanOrEqual(180);
        expect(words, `${language} ${brand}`).toBeLessThanOrEqual(260);
      }
    }
  });

  it("i modelli che abbiamo già, della marca del club, e qualsiasi auto vogliano", () => {
    const models: Record<PartnerAssistantLanguage, [string, string, string]> = {
      it: ["la 964 e la GT3 RS", "la F40 e la 512 TR", "la 300 SL"],
      en: ["the 964 and the GT3 RS", "the F40 and the 512 TR", "the 300 SL"],
      de: ["den 964 und den GT3 RS", "den F40 und den 512 TR", "den 300 SL"],
      fr: ["la 964 et la GT3 RS", "la F40 et la 512 TR", "la 300 SL"],
      es: ["el 964 y el GT3 RS", "el F40 y el 512 TR", "el 300 SL"],
    };
    const anyCar: Record<PartnerAssistantLanguage, string> = {
      it: "qualsiasi auto vogliate",
      en: "any car you would like",
      de: "jedes Auto gestalten, das Sie sich wünschen",
      fr: "n'importe quelle voiture de votre choix",
      es: "cualquier automóvil que deseen",
    };
    for (const language of Object.keys(models) as PartnerAssistantLanguage[]) {
      const body = (brand: (typeof BRANDS)[number]) =>
        PARTNER_ASSISTANT_TEMPLATES[language].body("Club", brand);
      const [porsche, ferrari, mercedes] = models[language];
      expect(body("porsche")).toContain(porsche);
      expect(body("ferrari")).toContain(ferrari);
      expect(body("mercedes")).toContain(mercedes);
      for (const brand of ["porsche", "ferrari", "mercedes"] as const)
        expect(body(brand)).toContain(anyCar[language]);
      expect(body("porsche")).not.toMatch(/F40|512 TR|300 SL/u);
      expect(body("ferrari")).not.toMatch(/964|GT3|300 SL/u);
      expect(body("mercedes")).not.toMatch(/964|GT3|F40|512 TR/u);
      expect(body(null)).not.toMatch(/964|GT3|F40|512 TR|300 SL/u);
    }
    expect(PARTNER_ASSISTANT_TEMPLATES.it.body("Club", "mercedes")).toContain(
      "Le grafiche le disegno personalmente: in collezione abbiamo già la 300 SL, ma possiamo disegnare qualsiasi auto vogliate. Ci appoggiamo",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.it.body("Club", null)).toContain(
      "Le grafiche le disegno personalmente, quindi possiamo partire dal modello che preferite. Ci appoggiamo",
    );
  });

  it("la bozza composta passa i controlli con ogni marca, Porsche compresa", () => {
    const clubs: [string, string, string][] = [
      ["Porsche Club Sintetico", "Porsche Club", "Germania"],
      ["Ferrari Club Sintetico", "Club Ferrari", "Spagna"],
      ["Mercedes-Benz Club Sintetico", "Club Mercedes-Benz", "Francia"],
      ["Gull Wing Group Sintetico (club 300 SL)", "Club e registri", "Stati Uniti"],
    ];
    for (const [name, typeLabel, country] of clubs) {
      const composed = composePartnerAssistantTemplate(
        { ...partner({ name, country }), typeLabel },
        phone,
      )!;
      const result = checkPartnerAssistantDraft(
        { ...composed, rulesVersion: 3 },
        {
          porscheCommunity: composed.porscheCommunity,
          currentRulesVersion: 3,
          phone,
          names: [name, partnerAssistantTemplateClubName(name)],
          template: true,
        },
      );
      expect(result, name).toEqual({ ok: true });
    }
  });

  it("la bozza composta passa i controlli in ogni lingua, anche con un nome lungo", () => {
    const cases: [string, string][] = [
      ["Italia", "italiano"],
      ["Regno Unito", "inglese britannico"],
      ["Germania", "tedesco"],
      ["Francia", "Français"],
      ["Spagna", "spagnolo"],
    ];
    for (const [country, lang] of cases) {
      const name = "Porsche Club of America – Gold Coast Region of South Florida (PCA GCR)";
      const composed = composePartnerAssistantTemplate(partner({ name, country, lang }), phone)!;
      const result = checkPartnerAssistantDraft(
        { ...composed, rulesVersion: 3 },
        {
          porscheCommunity: composed.porscheCommunity,
          currentRulesVersion: 3,
          phone,
          names: [name, partnerAssistantTemplateClubName(name)],
          template: true,
        },
      );
      expect(result, country).toEqual({ ok: true });
    }
  });

  it("nessun doppio punto dopo «Inc.» o «r.y.»; maiuscola dopo il saluto in francese e spagnolo", () => {
    for (const language of Object.keys(PARTNER_ASSISTANT_TEMPLATES) as PartnerAssistantLanguage[]) {
      expect(
        PARTNER_ASSISTANT_TEMPLATES[language].body("Porsche Club NSW Inc.", "porsche"),
      ).not.toContain("..");
      expect(PARTNER_ASSISTANT_TEMPLATES[language].body("Porsche Club NSW", "porsche")).toMatch(
        /Porsche Club NSW\.|Porsche Club NSW umsetzen/u,
      );
    }
    expect(PARTNER_ASSISTANT_TEMPLATES.fr.body("Club", null).split("\n")[2]).toMatch(
      /^Je suis Tommaso/u,
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.es.body("Club", null).split("\n")[2]).toMatch(
      /^Soy Tommaso/u,
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.es.body("Club", null)).toContain("para los Porsche Club");
  });

  it("firma con il cognome, ruolo nella lingua del club", () => {
    expect(partnerAssistantTemplateSignature("fr", phone)).toBe(
      [
        "Tommaso Ieri",
        "Fondateur, LuckyLap",
        phone,
        "https://luckylap.com | Instagram @lucky.lap",
      ].join("\n"),
    );
  });

  it("registro per lingua, come lo vuole il database", () => {
    expect(PARTNER_ASSISTANT_TEMPLATE_REGISTER).toEqual({
      it: "voi",
      en: "you",
      de: "sie",
      fr: "vous",
      es: "usted",
    });
  });

  it("la frase della scelta riconosce le bozze del modello", () => {
    expect(
      PARTNER_ASSISTANT_TEMPLATE_REASON.test(
        "Testo fisso per i club, versione 1, approvato da Tommaso.",
      ),
    ).toBe(true);
    expect(PARTNER_ASSISTANT_TEMPLATE_REASON.test("Club con un raduno in primavera")).toBe(false);
  });

  it("usa il modello un contatto della sezione Club che non è anche un evento", () => {
    expect(partnerAssistantUsesTemplate({ partner: { sections: ["club"] } } as never)).toBe(true);
    expect(
      partnerAssistantUsesTemplate({ partner: { sections: ["collab", "club"] } } as never),
    ).toBe(true);
    expect(
      partnerAssistantUsesTemplate({
        partner: { sections: ["eventi", "collab", "club"] },
      } as never),
    ).toBe(false);
    expect(partnerAssistantUsesTemplate({ partner: { sections: ["collab"] } } as never)).toBe(
      false,
    );
  });

  it("la rete Scuderia Ferrari Club è fuori dal testo per i club", () => {
    expect(partnerAssistantTemplateBlocked({ name: "Scuderia Ferrari Club Madrid" })).toBe(true);
    expect(partnerAssistantTemplateBlocked({ name: "Ferrari Club Nederland" })).toBe(false);
    expect(partnerAssistantTemplateBlocked({ name: "Antonio Giovinazzi Official Fan Club" })).toBe(
      false,
    );
  });
});

describe("nome del club nel testo", () => {
  it("senza l'ultima parentesi", () => {
    expect(partnerAssistantTemplateClubName("Porsche Club GB – Chiltern (R21)")).toBe(
      "Porsche Club GB – Chiltern",
    );
    expect(
      partnerAssistantTemplateClubName("Porsche Club Korea (사단법인 포르쉐 클럽 코리아)"),
    ).toBe("Porsche Club Korea");
    expect(partnerAssistantTemplateClubName("Mercedes-Benz Club (Victoria) Incorporated")).toBe(
      "Mercedes-Benz Club (Victoria) Incorporated",
    );
    expect(partnerAssistantTemplateClubName("(PCS)")).toBe("(PCS)");
  });

  it("articoli e preposizioni giusti", () => {
    expect(PARTNER_ASSISTANT_TEMPLATES.it.subject("Ferrari Club Italia")).toBe(
      "Magliette dedicate ai soci del Ferrari Club Italia",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.it.subject("Associazione Pagoda")).toBe(
      "Magliette dedicate ai soci della Associazione Pagoda",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.it.subject("Unimog Club Italia")).toBe(
      "Magliette dedicate ai soci dell'Unimog Club Italia",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.fr.subject("Club Porsche Alsace")).toBe(
      "Des t-shirts pour les membres du Club Porsche Alsace",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.fr.subject("Amicale Porsche")).toBe(
      "Des t-shirts pour les membres de l'Amicale Porsche",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.fr.body("Amicale Porsche", "porsche")).toContain(
      "avec l'Amicale Porsche.",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.es.subject("Escudería Madrid")).toBe(
      "Camisetas para los socios de la Escudería Madrid",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.es.body("Club Porsche Madrid", "porsche")).toContain(
      "hacerlo con el Club Porsche Madrid.",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.de.subject("Porsche Club Wien")).toBe(
      "T-Shirts für die Mitglieder des Porsche Club Wien",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.de.body("Interessengemeinschaft 190 SL", null)).toContain(
      "mit der Interessengemeinschaft 190 SL umsetzen",
    );
    expect(
      PARTNER_ASSISTANT_TEMPLATES.de.subject("Mercedes-Benz Interessengemeinschaft e.V."),
    ).toBe("T-Shirts für die Mitglieder der Mercedes-Benz Interessengemeinschaft e.V.");
    expect(PARTNER_ASSISTANT_TEMPLATES.de.subject("Porsche 356 IG Deutschland e.V.")).toBe(
      "T-Shirts für die Mitglieder der Porsche 356 IG Deutschland e.V.",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.de.subject("Ostschweizerischer Porsche Club")).toBe(
      "T-Shirts für die Mitglieder des Ostschweizerischen Porsche Club",
    );
    expect(
      PARTNER_ASSISTANT_TEMPLATES.de.body("Württembergischer Porsche Club e.V.", "porsche"),
    ).toContain("mit dem Württembergischen Porsche Club e.V. umsetzen");
    expect(PARTNER_ASSISTANT_TEMPLATES.de.subject("Porsche Club Wien")).toBe(
      "T-Shirts für die Mitglieder des Porsche Club Wien",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.fr.subject("Section SL – Club Mercedes-Benz France")).toBe(
      "Des t-shirts pour les membres de la Section SL – Club Mercedes-Benz France",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.fr.body("Section SL", null)).toContain(
      "avec la Section SL.",
    );
  });
});

describe("lingua, fuso e comunità Porsche", () => {
  it("la lingua dalla ricerca, poi dal paese; le lingue senza testo diventano inglese", () => {
    expect(
      partnerAssistantTemplateLanguage(partner({ country: "Svizzera", lang: "Français" })),
    ).toBe("fr");
    expect(
      partnerAssistantTemplateLanguage(partner({ country: "Svizzera", lang: "italiano" })),
    ).toBe("it");
    expect(partnerAssistantTemplateLanguage(partner({ country: "Svizzera" }))).toBe("de");
    expect(
      partnerAssistantTemplateLanguage(partner({ country: "Paesi Bassi", lang: "olandese" })),
    ).toBe("en");
    expect(partnerAssistantTemplateLanguage(partner({ country: "Messico", lang: "" }))).toBe("es");
    expect(
      partnerAssistantTemplateLanguage(partner({ country: "Giappone", lang: "giapponese" })),
    ).toBe("en");
    expect(
      partnerAssistantTemplateLanguage(partner({ country: "Canada", lang: "inglese (canadese)" })),
    ).toBe("en");
  });

  it("fuso per paese, e per stato negli Stati Uniti, in Canada e in Australia", () => {
    const tz = (country: string, city = "", name = "Club") =>
      partnerAssistantTemplateTimezone({ country, city, name });
    expect(tz("Germania")).toBe("Europe/Berlin");
    expect(tz("Regno Unito")).toBe("Europe/London");
    expect(tz("Atlantide")).toBeNull();
    expect(tz("Stati Uniti", "Brea (CA)")).toBe("America/Los_Angeles");
    expect(tz("Stati Uniti", "Tampa, FL")).toBe("America/New_York");
    expect(tz("Stati Uniti", "Dakota del Nord e del Sud (Sioux Falls, Rapid City, Fargo)")).toBe(
      "America/Chicago",
    );
    expect(tz("Stati Uniti", "Albany/Saratoga (NY) e Berkshire (MA)")).toBe("America/New_York");
    // «in», «la», «al» minuscole sono parole italiane, non Indiana, Louisiana o Alabama.
    expect(tz("Stati Uniti", "Chico (California); soci in 25 paesi")).toBe("America/Los_Angeles");
    expect(tz("Stati Uniti", "Sede in centro, la sera al circolo")).toBe("America/Chicago");
    expect(tz("Stati Uniti", "", "Arizona Region – Porsche Club of America")).toBe(
      "America/Phoenix",
    );
    expect(tz("Stati Uniti", "Washington, DC")).toBe("America/New_York");
    expect(tz("Stati Uniti", "Spokane, WA (e North Idaho)")).toBe("America/Los_Angeles");
    expect(tz("Stati Uniti", "Evansville / Newburgh (Indiana)")).toBe("America/Chicago");
    expect(tz("Stati Uniti", "Chattanooga (TN)")).toBe("America/New_York");
    expect(
      tz("Stati Uniti", "Palm Beach nord / Treasure Coast (Stuart, Fort Pierce, Sebring)"),
    ).toBe("America/New_York");
    expect(tz("Canada", "Calgary (Alberta)")).toBe("America/Edmonton");
    expect(tz("Canada", "Montréal (QC)")).toBe("America/Toronto");
    expect(tz("Canada", "Victoria (BC)")).toBe("America/Vancouver");
    expect(tz("Australia", "West Perth (WA)")).toBe("Australia/Perth");
    expect(tz("Australia", "Melbourne (VIC)")).toBe("Australia/Melbourne");
    expect(tz("Australia", "Canberra (ACT)")).toBe("Australia/Sydney");
  });

  it("la marca dal nome o dal tipo; Porsche per prima, Mercedes anche dalla 300 SL", () => {
    const brand = (name: string, typeLabel = "Club e registri") =>
      partnerAssistantTemplateBrand({ name, typeLabel });
    expect(brand("PCA Gold Coast", "Porsche Club")).toBe("porsche");
    expect(brand("Porsche 356 IG Deutschland e.V.")).toBe("porsche");
    expect(brand("Ferrari Owners' Club Sintetico")).toBe("ferrari");
    expect(brand("Fan club Sintetico", "Fan club Ferrari")).toBe("ferrari");
    expect(brand("SL-Club Pagode", "Club Mercedes-Benz")).toBe("mercedes");
    expect(brand("Mercedes-Benz SLR.CLUB e.V.")).toBe("mercedes");
    expect(brand("Gull Wing Group International (club 300 SL)")).toBe("mercedes");
    expect(brand("Club Sintetico", "Registro Mercedes-Benz")).toBe("mercedes");
    expect(brand("Unimog Club Italia")).toBeNull();
    expect(brand("Club 300SLR")).toBeNull();
  });

  it("Porsche dal nome o dal tipo", () => {
    expect(
      partnerAssistantTemplatePorsche({ name: "PCA Gold Coast", typeLabel: "Porsche Club" }),
    ).toBe(true);
    expect(
      partnerAssistantTemplatePorsche({ name: "SL-Club Pagode", typeLabel: "Club Mercedes-Benz" }),
    ).toBe(false);
  });

  it("la bozza composta porta lingua, registro, fuso e Svizzera", () => {
    const swiss = composePartnerAssistantTemplate(
      partner({ name: "Porsche Club Zürich", country: "Svizzera", city: "Zurigo" }),
      phone,
    )!;
    expect(swiss).toMatchObject({
      language: "de",
      register: "sie",
      timezone: "Europe/Zurich",
      swiss: true,
      porscheCommunity: true,
      brand: "porsche",
    });
    expect(swiss.body).not.toContain("ß");
    expect(composePartnerAssistantTemplate(partner({ country: "Atlantide" }), phone)).toBeNull();
  });
});
