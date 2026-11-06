import { describe, expect, it } from "vitest";
import seed from "../../../data/partner-email-config-v1.json";
import type { PartnerSection } from "../partner/model";
import { PARTNER_ASSISTANT_EVENT_MERCH, partnerAssistantEventMerch } from "./choice";
import type { PartnerAssistantExtractedChoice } from "./choice";
import { partnerEmailConfigSchema } from "./email-config";
import {
  parsePartnerEmailTrackChoice,
  partnerEmailTrackCandidates,
  resolvePartnerEmailChoice,
} from "./email-config-choice";
import type { PartnerEmailResolvedChoice } from "./email-config-choice";
import { partnerEmailEligiblePossibilities } from "./email-config-eligibility";
import { composeWriterPrompt } from "./email-config-prompt";
import type { PartnerAssistantChoice, PartnerAssistantContactKind } from "./types";

const initial = partnerEmailConfigSchema.parse(seed);

function extracted(
  contactKind: PartnerAssistantContactKind,
  eventReachable = false,
): PartnerAssistantExtractedChoice {
  return {
    contactKind,
    porscheCommunity: false,
    reasonIt: "Contatto sintetico per la prova.",
    writeNow: true,
    writeOn: "",
    recipientEmail: "",
    recipientEmailSource: "",
    recipientEmailPublishedByOrg: false,
    personName: "",
    personTitle: "",
    language: "it",
    register: "voi",
    swiss: false,
    timezone: "Europe/Rome",
    factText: "La scheda di prova annuncia un nuovo appuntamento.",
    factDate: "2026-11-06",
    factSource: "https://example.test/notizia",
    eventName: "Manifestazione Demo",
    eventStartsOn: "2026-12-01",
    eventCity: "",
    eventCountry: "",
    eventReachable,
    notesIt: "",
  };
}

type FormatCase = {
  name: string;
  sections: PartnerSection[];
  source: PartnerAssistantContactKind;
  reachable?: boolean;
  expected: [
    PartnerEmailResolvedChoice["format"],
    PartnerAssistantContactKind,
    PartnerAssistantChoice["request"],
  ];
};

const cases: FormatCase[] = [
  {
    name: "Eventi prima di Club",
    sections: ["club", "eventi"],
    source: "club",
    reachable: true,
    expected: ["evento_vicino", "evento", "stand_evento"],
  },
  {
    name: "Club v3 prima di Vendita e Collab",
    sections: ["collab", "vendita", "club"],
    source: "brand",
    expected: ["club", "club", "merch_cobranding"],
  },
  {
    name: "Vendita prima di Collab",
    sections: ["collab", "vendita"],
    source: "brand",
    expected: ["negozio", "negozio", "vendita_negozio"],
  },
  {
    name: "Collab con media estratto",
    sections: ["collab"],
    source: "media",
    expected: ["media", "media", "collab_capsule"],
  },
  {
    name: "Collab con brand estratto",
    sections: ["collab"],
    source: "brand",
    expected: ["brand", "brand", "collab_capsule"],
  },
  {
    name: "Eventi con negozio estratto",
    sections: ["eventi"],
    source: "negozio",
    expected: ["evento_lontano", "evento", "merch_cobranding"],
  },
  {
    name: "Collab con altro tipo estratto",
    sections: ["collab"],
    source: "club",
    expected: ["brand", "brand", "collab_capsule"],
  },
  {
    name: "Nessuna sezione e brand estratto",
    sections: [],
    source: "brand",
    expected: ["brand", "brand", "collab_capsule"],
  },
  {
    name: "Nessuna sezione e Club estratto",
    sections: [],
    source: "club",
    expected: [null, "club", "merch_cobranding"],
  },
];

describe("Formato della prima email Partner", () => {
  it.each(cases)("$name", ({ sections, source, reachable, expected }) => {
    const fromResearch = extracted(source, reachable);
    const { format, choice, extractedKind, discordance } = resolvePartnerEmailChoice(
      sections,
      fromResearch,
    );
    expect([format, choice.contactKind, choice.request]).toEqual(expected);
    expect(extractedKind).toBe(source);
    expect(choice).toEqual({ ...fromResearch, contactKind: expected[1], request: expected[2] });
    if (source === choice.contactKind) {
      expect(discordance).toBeNull();
    } else {
      expect(discordance).toContain(`«${source}»`);
      expect(discordance).toContain(`«${choice.contactKind}»`);
    }
  });

  it("applica i controlli d'evento al contatto riclassificato e conserva i fatti estratti", () => {
    const choice = { ...extracted("negozio"), porscheCommunity: true };
    const result = resolvePartnerEmailChoice(["eventi"], choice);
    expect(result.choice.porscheCommunity).toBe(true);
    expect(result.choice.factText).toBe(choice.factText);
    expect(partnerAssistantEventMerch(result.choice, "2026-11-06")).toBe(
      PARTNER_ASSISTANT_EVENT_MERCH.nextEdition,
    );
  });
});

describe("Filone della prima email Partner", () => {
  it("offre le condizioni dei cinque formati scritti da Claude, senza il Club v3", () => {
    const candidates = partnerEmailTrackCandidates(initial);
    expect(candidates.map(({ format }) => format)).toEqual([
      "evento_vicino",
      "evento_lontano",
      "brand",
      "media",
      "negozio",
    ]);
    expect(candidates.find(({ format }) => format === "negozio")?.tracks.B).toEqual({
      name: initial.formati[4].filoni.B.nome,
      quando: initial.formati[4].filoni.B.quando,
      sottotipi: ["officina_restauro"],
    });
  });

  it("sceglie il filone Negozio B per il sottotipo univoco e compone la grafica come principale", () => {
    const reason = "Il lavoro verificato sui restauri si presta a una grafica dedicata.";
    const track = parsePartnerEmailTrackChoice(
      { track: "A", subtype: "officina_restauro", reason },
      initial,
      "negozio",
    );
    expect(track).toEqual({ track: "B", subtype: "officina_restauro", reason });
    if (track === null) throw new Error("Scelta di prova non valida.");
    const sections = ["vendita", "collab"] as const;
    const { choice } = resolvePartnerEmailChoice(sections, extracted("brand"));
    const eligible = partnerEmailEligiblePossibilities(initial, "negozio", track.track, {
      choice,
      sections,
      today: "2026-11-06",
    });
    const prompt = composeWriterPrompt(initial, "negozio", track.track, {
      eligiblePossibilityIndexes: eligible,
      contactData: "",
    });
    expect(eligible).toEqual([1]);
    expect(prompt).toContain(
      `\nPROPOSTA PRINCIPALE\n${initial.formati[4].filoni.B.proposta_principale}\n`,
    );
  });

  it("mantiene il filone motivato da Claude per sottotipo condiviso o ignoto", () => {
    const reason = "La ricerca documenta la partecipazione regolare della community.";
    const overlap = { track: "B", subtype: "accessori_auto", reason };
    expect(parsePartnerEmailTrackChoice(overlap, initial, "brand")).toEqual(overlap);
    expect(parsePartnerEmailTrackChoice({ ...overlap, subtype: "" }, initial, "brand")).toEqual({
      ...overlap,
      subtype: null,
    });
  });

  it("sostituisce un motivo che nomina il filone errato per un sottotipo univoco", () => {
    expect(
      parsePartnerEmailTrackChoice(
        { track: "B", subtype: "rivista", reason: "Il filone B descrive bene la rivista." },
        initial,
        "media",
      ),
    ).toEqual({
      track: "A",
      subtype: "rivista",
      reason: "Il sottotipo riconosciuto è previsto soltanto dal filone A.",
    });
  });

  it.each([
    { track: "C", subtype: "", reason: "Motivo." },
    { track: "B", subtype: "officina_restauri", reason: "Motivo." },
    { track: "B", subtype: "rivista", reason: "Motivo." },
    { track: "B", subtype: "", reason: " " },
    { track: "B", subtype: "", reason: "Prima riga.\nSeconda riga." },
    { track: "B", subtype: "", reason: "x".repeat(501) },
    { track: "B", reason: "Motivo." },
    { track: "B", subtype: "", reason: "Motivo.", extra: true },
  ])("rifiuta una scelta del filone invalida", (raw) => {
    expect(parsePartnerEmailTrackChoice(raw, initial, "negozio")).toBeNull();
  });
});
