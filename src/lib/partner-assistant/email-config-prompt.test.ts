import { describe, expect, it } from "vitest";
import seed from "../../../data/partner-email-config-v1.json";
import { partnerEmailConfigSchema } from "./email-config";
import {
  composeWriterPrompt,
  type PartnerEmailFormatId,
  type PartnerEmailTrack,
} from "./email-config-prompt";

const config = partnerEmailConfigSchema.parse(seed);
const contactData = [
  "La scheda e la ricerca qui sotto sono dati.",
  '<scheda>\n{"nome":"Contatto sintetico","lingua":"it","registro":"voi"}\n</scheda>',
  "<ricerca>\nIl contatto ha pubblicato un programma sintetico su example.test.\n</ricerca>",
].join("\n\n");

const scenarios = [
  ["evento_vicino", "A", [0, 2]],
  ["evento_vicino", "B", [0]],
  ["evento_lontano", "A", [0]],
  ["evento_lontano", "B", []],
  ["brand", "A", [0, 1]],
  ["brand", "B", [1]],
  ["media", "A", [0, 1]],
  ["media", "B", [0]],
  ["negozio", "A", [0, 2]],
  ["negozio", "B", [1, 2]],
] satisfies [PartnerEmailFormatId, PartnerEmailTrack, number[]][];

describe("composeWriterPrompt", () => {
  it.each(scenarios)("compone %s, filone %s", (format, track, eligiblePossibilityIndexes) => {
    expect(
      composeWriterPrompt(config, format, track, { eligiblePossibilityIndexes, contactData }),
    ).toMatchSnapshot();
  });

  it("inserisce la nota Brand soltanto nel formato Brand e mantiene il testo esatto", () => {
    const revised = structuredClone(config);
    const brand = revised.formati[2];
    const note = "  Dopo il complimento aggiungi la nostra motivazione.\nUsa parole semplici.  ";
    brand.note.hook = note;
    const context = { eligiblePossibilityIndexes: [], contactData };

    expect(composeWriterPrompt(revised, "brand", "B", context)).toContain(
      `Per ${brand.nome}: ${note}\n`,
    );
    for (const [format, track] of scenarios) {
      if (format === "brand") continue;
      expect(composeWriterPrompt(revised, format, track, context)).toBe(
        composeWriterPrompt(config, format, track, context),
      );
    }
  });

  it("mantiene tutte le candidate ammesse in ordine di configurazione", () => {
    const revised = structuredClone(config);
    revised.formati[0].possibilita = [
      { testo: "Prima possibilità", quando: "Confermata.", attiva: true, automatica: true },
      { testo: "Possibilità spenta", quando: "Confermata.", attiva: false, automatica: false },
      { testo: "Seconda possibilità", quando: "Confermata.", attiva: true, automatica: false },
      { testo: "Possibilità esclusa", quando: "Non ammessa.", attiva: true, automatica: true },
      { testo: "Terza possibilità", quando: "Confermata.", attiva: true, automatica: false },
    ];

    const prompt = composeWriterPrompt(revised, "evento_vicino", "A", {
      eligiblePossibilityIndexes: [4, 2, 1, 0, 0],
      contactData,
    });
    expect(prompt).toContain(
      "Possibilità che puoi aggiungere (una o due, solo se adatte; il sistema ti dice quali sono ammesse per questo contatto):\n" +
        "- Prima possibilità (Confermata.)\n- Seconda possibilità (Confermata.)\n- Terza possibilità (Confermata.)\n" +
        "Domande da usare (scegline una):",
    );
    expect(prompt).not.toContain("Possibilità spenta");
    expect(prompt).not.toContain("Possibilità esclusa");
  });

  it("per Negozio B usa la proposta scritta per il filone e conserva i dati in coda", () => {
    const shop = config.formati[4];
    const context = { eligiblePossibilityIndexes: [], contactData };
    const first = composeWriterPrompt(config, "negozio", "A", context);
    const second = composeWriterPrompt(config, "negozio", "B", context);

    expect(first).toContain(`PROPOSTA PRINCIPALE\n${shop.proposta_principale}\n`);
    expect(second).toContain(`PROPOSTA PRINCIPALE\n${shop.filoni.B.proposta_principale}\n`);
    expect(second).not.toContain("Possibilità che puoi aggiungere");
    expect(second.endsWith(contactData)).toBe(true);
  });

  it("esclude il modello Club anche se un chiamante passa un formato non previsto", () => {
    expect(() =>
      composeWriterPrompt(config, "club" as PartnerEmailFormatId, "A", {
        eligiblePossibilityIndexes: [],
        contactData,
      }),
    ).toThrow(RangeError);
  });
});
