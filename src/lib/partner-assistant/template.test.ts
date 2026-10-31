import { describe, expect, it } from "vitest";
import { checkPartnerAssistantDraft, partnerAssistantBodyWords } from "./checks";
import {
  composePartnerAssistantTemplate,
  PARTNER_ASSISTANT_TEMPLATE_REASON,
  PARTNER_ASSISTANT_TEMPLATE_REGISTER,
  PARTNER_ASSISTANT_TEMPLATES,
  partnerAssistantTemplateClubName,
  partnerAssistantTemplateLanguage,
  partnerAssistantTemplatePorsche,
  partnerAssistantTemplateSignature,
  partnerAssistantTemplateTimezone,
  partnerAssistantUsesTemplate,
} from "./template";
import type { PartnerAssistantLanguage } from "./types";

const phone = "+39 000 000 0001";
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
  it("cinque lingue, una domanda, nessun punto esclamativo, tra 180 e 260 parole", () => {
    for (const language of Object.keys(PARTNER_ASSISTANT_TEMPLATES) as PartnerAssistantLanguage[]) {
      const text = PARTNER_ASSISTANT_TEMPLATES[language];
      const body = text.body("Porsche Club Sintetico");
      expect(body.match(/\?/gu)).toHaveLength(1);
      expect(body).not.toMatch(/[!¡]/u);
      expect(body).toContain("Porsche Club Sintetico");
      expect(body).toContain("150");
      expect(text.subject("Porsche Club Sintetico")).toContain("Porsche Club Sintetico");
      const words = partnerAssistantBodyWords(body);
      expect(words).toBeGreaterThanOrEqual(180);
      expect(words).toBeLessThanOrEqual(260);
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

  it("usa il modello solo un contatto della sezione Club", () => {
    expect(partnerAssistantUsesTemplate({ partner: { sections: ["club"] } } as never)).toBe(true);
    expect(
      partnerAssistantUsesTemplate({ partner: { sections: ["collab", "club"] } } as never),
    ).toBe(true);
    expect(partnerAssistantUsesTemplate({ partner: { sections: ["collab"] } } as never)).toBe(
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
    expect(PARTNER_ASSISTANT_TEMPLATES.fr.body("Amicale Porsche")).toContain(
      "avec l'Amicale Porsche.",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.es.subject("Escudería Madrid")).toBe(
      "Camisetas para los socios de la Escudería Madrid",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.es.body("Club Porsche Madrid")).toContain(
      "hacerlo con el Club Porsche Madrid.",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.de.subject("Porsche Club Wien")).toBe(
      "T-Shirts für die Mitglieder des Porsche Club Wien",
    );
    expect(PARTNER_ASSISTANT_TEMPLATES.de.body("Interessengemeinschaft 190 SL")).toContain(
      "mit der Interessengemeinschaft 190 SL umsetzen",
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
    expect(tz("Canada", "Calgary (Alberta)")).toBe("America/Edmonton");
    expect(tz("Canada", "Montréal (QC)")).toBe("America/Toronto");
    expect(tz("Canada", "Victoria (BC)")).toBe("America/Vancouver");
    expect(tz("Australia", "West Perth (WA)")).toBe("Australia/Perth");
    expect(tz("Australia", "Melbourne (VIC)")).toBe("Australia/Melbourne");
    expect(tz("Australia", "Canberra (ACT)")).toBe("Australia/Sydney");
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
    });
    expect(swiss.body).not.toContain("ß");
    expect(composePartnerAssistantTemplate(partner({ country: "Atlantide" }), phone)).toBeNull();
  });
});
