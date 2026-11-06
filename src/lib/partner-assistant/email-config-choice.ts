import { charCount, hasControlCharacters, PARTNER_SECTION_LABELS } from "../partner/model";
import type { PartnerSection } from "../partner/model";
import { partnerAssistantRequest } from "./choice";
import type { PartnerAssistantExtractedChoice } from "./choice";
import type { PartnerEmailConfig } from "./email-config";
import type { PartnerEmailFormatId, PartnerEmailTrack } from "./email-config-prompt";
import type { PartnerAssistantChoice, PartnerAssistantContactKind } from "./types";

const SECTION_PRIORITY = ["eventi", "club", "vendita", "collab"] as const;

export type PartnerEmailResolvedChoice = {
  /** Null per un Club estratto senza la relativa sezione, che segue il percorso precedente. */
  format: PartnerEmailFormatId | "club" | null;
  choice: PartnerAssistantChoice;
  extractedKind: PartnerAssistantContactKind;
  discordance: string | null;
};

function kindForSection(
  section: PartnerSection | undefined,
  extractedKind: PartnerAssistantContactKind,
): PartnerAssistantContactKind {
  switch (section) {
    case "eventi":
      return "evento";
    case "club":
      return "club";
    case "vendita":
      return "negozio";
    case "collab":
      return extractedKind === "media" ? "media" : "brand";
    default:
      return extractedKind;
  }
}

/** La sezione decide il formato. Il tipo originale serve alla nota, quello effettivo ai controlli. */
export function resolvePartnerEmailChoice(
  sections: readonly PartnerSection[],
  extracted: PartnerAssistantExtractedChoice,
): PartnerEmailResolvedChoice {
  const section = SECTION_PRIORITY.find((candidate) => sections.includes(candidate));
  const extractedKind = extracted.contactKind;
  const contactKind = kindForSection(section, extractedKind);
  const request = partnerAssistantRequest({
    contactKind,
    eventReachable: extracted.eventReachable,
  });
  const choice = { ...extracted, contactKind, request };

  let format: PartnerEmailResolvedChoice["format"];
  if (contactKind === "evento") {
    format = extracted.eventReachable ? "evento_vicino" : "evento_lontano";
  } else if (contactKind === "club") {
    format = section === "club" ? "club" : null;
  } else {
    format = contactKind;
  }

  const discordance =
    section !== undefined && contactKind !== extractedKind
      ? `La ricerca indica il tipo «${extractedKind}». Prevale la sezione ${PARTNER_SECTION_LABELS[section]} e si applica il tipo «${contactKind}».`
      : null;
  return { format, choice, extractedKind, discordance };
}

type TrackDescription = { name: string; quando: string; sottotipi: readonly string[] };

export type PartnerEmailTrackCandidate = {
  format: PartnerEmailFormatId;
  name: string;
  tracks: Record<PartnerEmailTrack, TrackDescription>;
};

function describeTrack(track: {
  nome: string;
  quando: string;
  sottotipi: string[];
}): TrackDescription {
  return { name: track.nome, quando: track.quando, sottotipi: track.sottotipi };
}

/** Descrizioni dei filoni da mostrare a Claude durante l'estrazione, senza gli esempi. */
export function partnerEmailTrackCandidates(
  config: PartnerEmailConfig,
): PartnerEmailTrackCandidate[] {
  const candidates: PartnerEmailTrackCandidate[] = [];
  for (const format of config.formati) {
    if (format.id === "club") continue;
    candidates.push({
      format: format.id,
      name: format.nome,
      tracks: { A: describeTrack(format.filoni.A), B: describeTrack(format.filoni.B) },
    });
  }
  return candidates;
}

export const PARTNER_EMAIL_TRACK_CHOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["track", "subtype", "reason"],
  properties: {
    track: { type: "string", enum: ["A", "B"] },
    subtype: { type: "string" },
    reason: { type: "string" },
  },
};

export type PartnerEmailTrackChoice = {
  track: PartnerEmailTrack;
  subtype: string | null;
  reason: string;
};

const REASON_LIMIT = 500;
const TRACK_REFERENCE = /\b(?:filone|variante)\s+[«“"'(]?[AB]\b/iu;

/** Applica il filone del sottotipo univoco. Un sottotipo ignoto si esprime con una stringa vuota. */
export function parsePartnerEmailTrackChoice(
  raw: unknown,
  config: PartnerEmailConfig,
  format: PartnerEmailFormatId,
): PartnerEmailTrackChoice | null {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== PARTNER_EMAIL_TRACK_CHOICE_SCHEMA.required.length ||
    !PARTNER_EMAIL_TRACK_CHOICE_SCHEMA.required.every((key) => Object.hasOwn(raw, key))
  )
    return null;
  const { track, subtype, reason } = raw as Record<string, unknown>;
  if (
    (track !== "A" && track !== "B") ||
    typeof subtype !== "string" ||
    typeof reason !== "string" ||
    !/\S/u.test(reason) ||
    !reason.isWellFormed() ||
    /[\r\n\u2028\u2029]/u.test(reason) ||
    hasControlCharacters(reason) ||
    charCount(reason) > REASON_LIMIT
  )
    return null;

  const configured = config.formati.find((candidate) => candidate.id === format);
  if (!configured || configured.id === "club") return null;
  if (subtype === "") return { track, subtype: null, reason: reason.trim() };

  const inA = configured.filoni.A.sottotipi.includes(subtype);
  const inB = configured.filoni.B.sottotipi.includes(subtype);
  if (!inA && !inB) return null;
  if (inA && inB) return { track, subtype, reason: reason.trim() };

  const uniqueTrack = inA ? "A" : "B";
  return {
    track: uniqueTrack,
    subtype,
    reason:
      track !== uniqueTrack && TRACK_REFERENCE.test(reason)
        ? `Il sottotipo riconosciuto è previsto soltanto dal filone ${uniqueTrack}.`
        : reason.trim(),
  };
}
