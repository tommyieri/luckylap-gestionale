import { PARTNER_ASSISTANT_FORMAT_LABELS } from "./assistant";
import { instantDay, isCalendarDay } from "./dates";
import { buildPartnerIndex } from "./filters";
import { PARTNER_APPROACH_LABELS, type PartnerSummary, type PartnerWorkspace } from "./model";
import { partnerWorkView, type PartnerWorkData, type PartnerWorkView } from "./work";

export const PARTNER_DATABASE_STAGE_LABELS = {
  da_contattare: "Da contattare",
  contattato: "Inviato",
  risposto: "Risposto",
  trattativa: "In conversazione",
  chiuso: "Concluso",
} as const;

export const PARTNER_DATABASE_GROUP_LABELS = {
  intervento: "Serve intervento",
  programmato: "Invio programmato",
  data: "Serve una data",
  accordo: "Accordo fatto",
  non_interessato: "Non interessato",
} as const;

export type PartnerDatabaseRow = {
  partner: PartnerSummary;
  work: PartnerWorkView;
  stage: keyof typeof PARTNER_DATABASE_STAGE_LABELS;
  group: keyof typeof PARTNER_DATABASE_GROUP_LABELS | null;
  blocked: boolean;
  countryCode: string | null;
  ownerId: string | null;
  ownerLabel: string;
  proposal: string;
  format: string | null;
  subtype?: string | null;
  lastActivity: string | null;
  firstSent: string | null;
  firstReply: string | null;
  next: { label: string; day: string | null; estimated: boolean; who: string | null };
};

export type PartnerDatabaseEstimate = { partnerId: string; day: string };

export function partnerDatabaseFormatLabel(format: string | null) {
  if (!format || format === "sconosciuto") return "Da definire";
  if (format === "club") return "Club";
  return (
    PARTNER_ASSISTANT_FORMAT_LABELS[format as keyof typeof PARTNER_ASSISTANT_FORMAT_LABELS] ??
    format
  );
}

const proposals = {
  evento_vicino: "Stand all’evento",
  evento_lontano: "Capo co-firmato a distanza",
  brand: "Capsule a due firme",
  media: "Capsule editoriale",
  negozio: "Collaborazione con il negozio",
  club: "Collezione per i soci",
} as const;

// I nomi di Intl includono anche regioni sovranazionali e codici dismessi.
// La mappa usa soltanto i codici ISO 3166-1 alpha-2 assegnati.
const countryCodes = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
    "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
    "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

const countryLabels = new Intl.DisplayNames("it", { type: "region", fallback: "none" });
const englishCountryLabels = new Intl.DisplayNames("en", { type: "region", fallback: "none" });
const normalizeCountry = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("it")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const countryAliases = new Map<string, string | null>();
for (const code of countryCodes) {
  for (const label of [countryLabels.of(code), englishCountryLabels.of(code)]) {
    if (!label) continue;
    const alias = normalizeCountry(label);
    if (countryAliases.has(alias) && countryAliases.get(alias) !== code)
      countryAliases.set(alias, null);
    else countryAliases.set(alias, code);
  }
}
for (const [name, code] of Object.entries({
  UK: "GB",
  "Gran Bretagna": "GB",
  "Great Britain": "GB",
  Inghilterra: "GB",
  England: "GB",
  Deutschland: "DE",
  Österreich: "AT",
  Schweiz: "CH",
  Suisse: "CH",
  España: "ES",
  Belgique: "BE",
  België: "BE",
  Olanda: "NL",
  Nederland: "NL",
  USA: "US",
  "Stati Uniti d'America": "US",
  "United States of America": "US",
  "Principato di Monaco": "MC",
  "Repubblica di San Marino": "SM",
}))
  countryAliases.set(normalizeCountry(name), code);

export function partnerCountryCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return countryCodes.has(code) ? code : (countryAliases.get(normalizeCountry(value)) ?? null);
}

export function partnerCountryName(code: string | null): string {
  return code && countryCodes.has(code) ? (countryLabels.of(code) ?? code) : "Paese da verificare";
}

function groupByPartner<T extends { partnerId: string }>(items: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.partnerId);
    if (group) group.push(item);
    else groups.set(item.partnerId, [item]);
  }
  return groups;
}

function datesFor(activities: PartnerWorkData["activities"]) {
  let lastActivity: string | null = null;
  let firstSent: string | null = null;
  let firstReply: string | null = null;
  for (const { kind, occurredAt } of activities) {
    const time = Date.parse(occurredAt);
    if (lastActivity === null || time > Date.parse(lastActivity)) lastActivity = occurredAt;
    if (kind === "inviato" && (firstSent === null || time < Date.parse(firstSent)))
      firstSent = occurredAt;
    if (kind === "risposta" && (firstReply === null || time < Date.parse(firstReply)))
      firstReply = occurredAt;
  }
  return { lastActivity, firstSent, firstReply };
}

function nextStep(
  partner: PartnerSummary,
  work: PartnerWorkView,
  followUps: PartnerWorkData["followUps"],
  memberNames: ReadonlyMap<string, string>,
  ownerLabel: string,
  blocked: boolean,
  estimate: string | null,
): PartnerDatabaseRow["next"] {
  const step = (label: string, day: string | null = null, who: string | null = null) => ({
    label,
    day,
    who,
    estimated: false,
  });
  if (blocked) return step("Non contattare");
  if (partner.nextAction) return step(partner.nextAction, partner.nextActionOn, ownerLabel);
  if (partner.stage === "contattato" && followUps.length) {
    const due = followUps.reduce((first, candidate) =>
      candidate.dueAt && (!first.dueAt || Date.parse(candidate.dueAt) < Date.parse(first.dueAt))
        ? candidate
        : first,
    );
    return step(
      "Sollecito",
      due.dueAt ? instantDay(due.dueAt) : null,
      due.assignedTo ? (memberNames.get(due.assignedTo) ?? "Membro del team") : null,
    );
  }
  if (partner.stage === "da_contattare") {
    if (work.phase === "ready" && estimate)
      return { ...step("Prima email prevista", estimate, "Assistente"), estimated: true };
    if (work.phase === "scheduled")
      return step("Preparazione della prima email", work.dueOn, "Assistente");
    if (work.phase === "needs_tommi") return step("Serve intervento", null, ownerLabel);
    if (work.phase === "verify") return step("Da verificare");
    if (work.phase === "ready") return step("Bozza pronta");
    if (work.phase === "held") return step("Assistente fermo");
    if (work.phase === "preparing") return step("In preparazione", null, "Assistente");
  }
  if (partner.stage === "chiuso") return step("Concluso · Accordo fatto", partner.eventStartsOn);
  if (partner.stage === "no") return step("Concluso · Non interessato");
  return step("Nessun passo pianificato");
}

/** Una sola proiezione per elenco, pipeline e dettagli, sopra le letture già autorizzate. */
export function buildPartnerDatabaseRows(
  workspace: PartnerWorkspace,
  today: string,
  estimates: readonly PartnerDatabaseEstimate[],
  defaultOwnerId?: string | null,
): PartnerDatabaseRow[] {
  const { work } = workspace;
  const index = buildPartnerIndex(workspace);
  const members = new Map(workspace.members.map((member) => [member.id, member]));
  const memberNames = new Map(workspace.members.map((member) => [member.id, member.name]));
  const defaultId = defaultOwnerId && members.get(defaultOwnerId)?.active ? defaultOwnerId : null;
  const activities = groupByPartner(work?.activities ?? []);
  const followUps = groupByPartner(work?.followUps ?? []);
  const jobs = groupByPartner(work?.jobs ?? []);
  const toggles = groupByPartner(work?.toggles ?? []);
  const planned = new Map<string, string>();
  for (const { partnerId, day } of estimates) {
    const previous = planned.get(partnerId);
    if (isCalendarDay(day) && day >= today && (!previous || day < previous))
      planned.set(partnerId, day);
  }
  return workspace.partners.map((partner) => {
    const block = index.blocks.get(partner.id) ?? null;
    const partnerActivities = activities.get(partner.id) ?? [];
    const partnerFollowUps = followUps.get(partner.id) ?? [];
    const partnerJobs = jobs.get(partner.id) ?? [];
    const workView = partnerWorkView(partner, {
      today,
      work: work && {
        assistantStatus: work.assistantStatus,
        jobs: partnerJobs,
        toggles: toggles.get(partner.id) ?? [],
        activities: partnerActivities,
        replies: [],
        followUps: partnerFollowUps,
      },
      contacts: index.contacts.get(partner.id) ?? [],
      block,
      members: workspace.members,
    });
    const ownerId = partner.ownerId ?? defaultId;
    const ownerName = ownerId ? (memberNames.get(ownerId) ?? "Membro del team") : "Predefinito";
    const ownerLabel = defaultId && !partner.ownerId ? `${ownerName} (predefinito)` : ownerName;
    const estimate = planned.get(partner.id) ?? null;
    const next = nextStep(
      partner,
      workView,
      partnerFollowUps,
      memberNames,
      ownerLabel,
      !!block,
      estimate,
    );
    let group: PartnerDatabaseRow["group"] = null;
    if (partner.stage === "chiuso") group = "accordo";
    else if (partner.stage === "no") group = "non_interessato";
    else if (partner.stage === "da_contattare" && !block) {
      if (workView.phase === "needs_tommi" || workView.phase === "verify") group = "intervento";
      else if (workView.phase === "ready" && estimate) group = "programmato";
      else group = "data";
    }
    const format = partnerJobs[0]?.format ?? null;
    const proposal =
      format && Object.hasOwn(proposals, format)
        ? proposals[format as keyof typeof proposals]
        : partner.chosenApproach
          ? PARTNER_APPROACH_LABELS[partner.chosenApproach]
          : "Da definire";
    return {
      partner,
      work: workView,
      stage: partner.stage === "no" ? "chiuso" : partner.stage,
      group,
      blocked: !!block,
      countryCode: partnerCountryCode(partner.country),
      ownerId,
      ownerLabel,
      proposal,
      format,
      subtype: partnerJobs[0]?.subtype ?? null,
      ...datesFor(partnerActivities),
      next,
    };
  });
}
