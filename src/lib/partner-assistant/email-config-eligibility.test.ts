import { describe, expect, it } from "vitest";
import seed from "../../../data/partner-email-config-v1.json";
import { partnerEmailConfigSchema } from "./email-config";
import {
  parsePartnerEmailConditionEvidence,
  partnerEmailConditionCandidates,
  partnerEmailConditionEvidenceSchema,
  partnerEmailEligiblePossibilities,
  partnerEmailMandatoryShopPossibility,
} from "./email-config-eligibility";
import type { PartnerEmailConditionEvidence } from "./email-config-eligibility";

const initial = partnerEmailConfigSchema.parse(seed);
const today = "2026-11-06";
const excerpt = "La rivista offre un abbonamento ai suoi lettori.";
const research = `La presentazione della rivista.\n${excerpt}\nhttps://example.test`;
const mediaContext = {
  today,
  sections: ["collab"] as const,
  choice: { contactKind: "media", request: "collab_capsule", eventStartsOn: "" } as const,
};

describe("Possibilità della prima email Partner", () => {
  it("chiede prove solo per condizioni attive da accertare con la ricerca", () => {
    const candidates = partnerEmailConditionCandidates(initial);
    const ids = ["evento_vicino:2", "brand:0", "media:0", "media:1", "negozio:2"];
    expect(candidates.map((candidate) => candidate.id)).toEqual(ids);
    expect(
      partnerEmailConditionEvidenceSchema(candidates).items.properties.candidate_id.enum,
    ).toEqual(ids);
  });

  it("scarta citazioni assenti o malformate e conserva solo il formato e l'hash della condizione", () => {
    const candidates = partnerEmailConditionCandidates(initial);
    const evidence = parsePartnerEmailConditionEvidence(
      [
        { candidate_id: "media:0", excerpt: "Annuncia un numero speciale." },
        { candidate_id: "media:0", excerpt: "https://example.test" },
        { candidate_id: "media:0", excerpt: "lettori" },
        { candidate_id: "media:0", excerpt, invalid: true },
        { candidate_id: "media:2", excerpt },
        { candidate_id: "media:1", excerpt },
        { candidate_id: "media:1", excerpt },
      ],
      candidates,
      research,
    );
    expect(evidence).toEqual([
      { format: "media", conditionHash: expect.stringMatching(/^[0-9a-f]{64}$/u) },
    ]);
    expect(partnerEmailEligiblePossibilities(initial, "media", "A", mediaContext)).toEqual([]);
    expect(
      partnerEmailEligiblePossibilities(initial, "media", "A", { ...mediaContext, evidence }),
    ).toEqual([1]);
    expect(parsePartnerEmailConditionEvidence(null, candidates, research)).toEqual([]);
  });

  it("riconosce una possibilità dopo un riordino e richiede una nuova prova se cambia il testo", () => {
    const updated = structuredClone(initial);
    const evidence = parsePartnerEmailConditionEvidence(
      [{ candidate_id: "media:1", excerpt }],
      partnerEmailConditionCandidates(initial),
      research,
    );
    const context = { ...mediaContext, evidence };
    const media = updated.formati[3];
    const option = media.possibilita.splice(1, 1)[0];
    media.possibilita.unshift({ ...option });
    expect(partnerEmailEligiblePossibilities(updated, "media", "B", context)).toEqual([0]);
    media.possibilita.push({ ...option, testo: "destinarla alla comunità della rivista" });
    expect(partnerEmailEligiblePossibilities(updated, "media", "B", context)).toEqual([0]);
    media.possibilita[0].attiva = false;
    expect(partnerEmailEligiblePossibilities(updated, "media", "B", context)).toEqual([]);
    media.possibilita[0].attiva = true;
    media.possibilita[0].quando += " Prima della pubblicazione.";
    expect(partnerEmailEligiblePossibilities(updated, "media", "B", context)).toEqual([]);
  });

  it.each([
    ["2026-12-08", [0], []],
    ["2026-12-07", [], [0]],
    ["", [], []],
  ] as const)("usa la soglia attuale per gli eventi con data %s", (date, near, distant) => {
    const context = { today, sections: ["eventi"] as const };
    expect(
      partnerEmailEligiblePossibilities(initial, "evento_vicino", "A", {
        ...context,
        choice: { contactKind: "evento", request: "stand_evento", eventStartsOn: date },
      }),
    ).toEqual(near);
    expect(
      partnerEmailEligiblePossibilities(initial, "evento_lontano", "B", {
        ...context,
        choice: { contactKind: "evento", request: "merch_cobranding", eventStartsOn: date },
      }),
    ).toEqual(distant);
  });

  it("distingue condizioni automatiche, prova esterna e tasto di attivazione", () => {
    const updated = structuredClone(initial);
    const [option] = updated.formati[0].possibilita;
    const context = {
      today,
      sections: ["eventi"] as const,
      choice: {
        contactKind: "evento",
        request: "stand_evento",
        eventStartsOn: "2026-12-08",
      } as const,
      evidence: [] as PartnerEmailConditionEvidence[],
    };
    option.attiva = false;
    expect(partnerEmailEligiblePossibilities(updated, "evento_vicino", "A", context)).toEqual([]);
    option.attiva = true;
    option.automatica = false;
    expect(partnerEmailConditionCandidates(updated).map((candidate) => candidate.id)).not.toContain(
      "evento_vicino:0",
    );
    expect(partnerEmailEligiblePossibilities(updated, "evento_vicino", "A", context)).toEqual([]);
  });

  it("per Negozio A ammette la grafica e per B ammette come opzione la selezione", () => {
    const context = {
      today,
      sections: ["vendita", "collab"] as const,
      choice: { contactKind: "negozio", request: "vendita_negozio", eventStartsOn: "" } as const,
    };
    expect(partnerEmailEligiblePossibilities(initial, "negozio", "A", context)).toEqual([0]);
    expect(partnerEmailEligiblePossibilities(initial, "negozio", "B", context)).toEqual([1]);
    expect(partnerEmailMandatoryShopPossibility(initial, "A", context.sections)).toBe(0);
    expect(partnerEmailMandatoryShopPossibility(initial, "B", context.sections)).toBeUndefined();
    expect(partnerEmailMandatoryShopPossibility(initial, "A", ["vendita"])).toBeUndefined();

    const updated = structuredClone(initial);
    updated.formati[4].possibilita[0].attiva = false;
    expect(partnerEmailMandatoryShopPossibility(updated, "A", context.sections)).toBeUndefined();
  });
});
