import { createHash } from "node:crypto";
import type { PartnerSection } from "../partner/model";
import { PARTNER_ASSISTANT_EVENT_MERCH, partnerAssistantEventMerch } from "./choice";
import type { PartnerEmailConfig } from "./email-config";
import type { PartnerEmailFormatId, PartnerEmailTrack } from "./email-config-prompt";
import type { PartnerAssistantChoice } from "./types";

const ALWAYS = "Sempre.";
const NEAR_EVENT =
  "Solo se la data esatta è nota e mancano più di 31 giorni (regola attuale del codice).";
const DISTANT_EVENT = "Obbligatorio se mancano 31 giorni o meno (regola attuale del codice).";
const SHOP_DESIGN = "Sempre; obbligatoria come accenno se la scheda ha anche Collab.";
const SHOP_SELECTION = "Nella variante B, dove la grafica dedicata è la proposta principale.";
const BUILT_IN_CONDITIONS = new Set([
  ALWAYS,
  NEAR_EVENT,
  DISTANT_EVENT,
  SHOP_DESIGN,
  SHOP_SELECTION,
]);

export type PartnerEmailConditionCandidate = {
  id: string;
  format: PartnerEmailFormatId;
  index: number;
  purpose: string;
  option: string;
  condition: string;
};

/** Memorizza l'esito per il testo esatto della possibilità e della condizione. */
export type PartnerEmailConditionEvidence = {
  format: PartnerEmailFormatId;
  conditionHash: string;
};

function hashCondition(option: string, condition: string): string {
  return createHash("sha256")
    .update(JSON.stringify([option, condition]), "utf8")
    .digest("hex");
}

export function partnerEmailConditionCandidates(
  config: PartnerEmailConfig,
): PartnerEmailConditionCandidate[] {
  const candidates: PartnerEmailConditionCandidate[] = [];
  for (const format of config.formati) {
    if (format.id === "club") continue;
    format.possibilita.forEach((option, index) => {
      if (!option.attiva || option.automatica || BUILT_IN_CONDITIONS.has(option.quando)) return;
      candidates.push({
        id: `${format.id}:${index}`,
        format: format.id,
        index,
        purpose: `${format.nome}: ${format.quando}`,
        option: option.testo,
        condition: option.quando,
      });
    });
  }
  return candidates;
}

/** Schema del solo campo aggiunto all'estrazione, quando ci sono condizioni da verificare. */
export function partnerEmailConditionEvidenceSchema(
  candidates: readonly PartnerEmailConditionCandidate[],
) {
  return {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["candidate_id", "excerpt"],
      properties: {
        candidate_id: { type: "string", enum: candidates.map((candidate) => candidate.id) },
        excerpt: { type: "string" },
      },
    },
  };
}

function isQuote(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.isWellFormed() &&
    value.length <= 1000 &&
    value.trim().length >= 12 &&
    /\p{L}/u.test(value) &&
    !/^https?:\/\/\S+$/iu.test(value.trim())
  );
}

/** Conferma che la prova citata esista nella ricerca. Claude valuta il significato della prova. */
export function parsePartnerEmailConditionEvidence(
  raw: unknown,
  candidates: readonly PartnerEmailConditionCandidate[],
  researchText: string,
): PartnerEmailConditionEvidence[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const accepted = new Map<string, PartnerEmailConditionEvidence>();
  for (const item of raw) {
    if (
      typeof item !== "object" ||
      item === null ||
      Object.keys(item).length !== 2 ||
      !Object.hasOwn(item, "candidate_id") ||
      !Object.hasOwn(item, "excerpt")
    )
      continue;
    const { candidate_id, excerpt } = item as Record<string, unknown>;
    if (typeof candidate_id !== "string" || !isQuote(excerpt) || !researchText.includes(excerpt))
      continue;
    const candidate = byId.get(candidate_id);
    if (!candidate || BUILT_IN_CONDITIONS.has(candidate.condition)) continue;
    const conditionHash = hashCondition(candidate.option, candidate.condition);
    accepted.set(`${candidate.format}:${conditionHash}`, {
      format: candidate.format,
      conditionHash,
    });
  }
  return [...accepted.values()];
}

type EligibilityContext = {
  choice: Pick<PartnerAssistantChoice, "contactKind" | "eventStartsOn" | "request">;
  today: string;
  sections: readonly PartnerSection[];
  evidence?: readonly PartnerEmailConditionEvidence[];
};

/** Indici ammessi nella configurazione corrente, nell'ordine in cui sono scritti. */
export function partnerEmailEligiblePossibilities(
  config: PartnerEmailConfig,
  format: PartnerEmailFormatId,
  track: PartnerEmailTrack,
  { choice, today, evidence = [] }: EligibilityContext,
): number[] {
  const configured = config.formati.find((candidate) => candidate.id === format);
  if (!configured || configured.id === "club") return [];
  const merch = partnerAssistantEventMerch(choice, today);
  const verified = new Set(
    evidence.filter((entry) => entry.format === format).map((entry) => entry.conditionHash),
  );
  const eligible: number[] = [];
  configured.possibilita.forEach((option, index) => {
    if (!option.attiva) return;
    const condition = option.quando;
    const admitted = option.automatica
      ? (format === "evento_vicino" &&
          condition === NEAR_EVENT &&
          merch === PARTNER_ASSISTANT_EVENT_MERCH.allowed) ||
        (format === "evento_lontano" &&
          condition === DISTANT_EVENT &&
          merch === PARTNER_ASSISTANT_EVENT_MERCH.nextEdition)
      : condition === ALWAYS ||
        (format === "negozio" &&
          ((condition === SHOP_DESIGN && track === "A") ||
            (condition === SHOP_SELECTION && track === "B"))) ||
        (!BUILT_IN_CONDITIONS.has(condition) &&
          verified.has(hashCondition(option.testo, condition)));
    if (admitted) eligible.push(index);
  });
  return eligible;
}

/** Nella variante B la proposta principale soddisfa già la condizione della grafica dedicata. */
export function partnerEmailMandatoryShopPossibility(
  config: PartnerEmailConfig,
  track: PartnerEmailTrack,
  sections: readonly PartnerSection[],
): number | undefined {
  if (track !== "A" || !sections.includes("vendita") || !sections.includes("collab")) return;
  const shop = config.formati.find((format) => format.id === "negozio");
  const index = shop?.possibilita.findIndex(
    (option) => option.attiva && !option.automatica && option.quando === SHOP_DESIGN,
  );
  return index === -1 ? undefined : index;
}
