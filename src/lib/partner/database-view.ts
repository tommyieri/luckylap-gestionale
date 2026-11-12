import { isMonthStart } from "./dates";
import {
  PARTNER_QUERY_MAX,
  PARTNER_STATUS_FILTER_LABELS,
  PARTNER_VIEW_SECTIONS,
  parsePartnerView,
  partnerSearchMatch,
  type PartnerViewSection,
} from "./filters";
import { PARTNER_PRIORITIES, type PartnerPriority } from "./model";
import { partnerPeriod, type PartnerPeriodNumber } from "./periods";
import type { PartnerDatabaseRow } from "./database";

export const PARTNER_DATABASE_VIEWS = {
  elenco: "Elenco",
  pipeline: "Pipeline",
  calendario: "Calendario",
  mappa: "Mappa",
  andamento: "Andamento",
} as const;

export const PARTNER_DATABASE_PHASE_FILTERS = {
  tutti: "Tutte le fasi",
  da_contattare: "Da contattare",
  intervento: "Serve intervento",
  programmato: "Invio programmato",
  data: "Serve una data",
  contattato: "Inviato",
  risposto: "Risposto",
  trattativa: "In conversazione",
  chiuso: "Concluso",
  accordo: "Accordo fatto",
  non_interessato: "Non interessato",
  non_contattare: "Non contattare",
} as const;

export const PARTNER_DATABASE_WORK_FILTERS = {
  tutti: "Tutto il lavoro",
  da_seguire: "Da seguire",
  risposte: "Risposte registrate",
  da_controllare: "Differenze da controllare",
  da_fare: "Contatti aperti",
} as const;

export const PARTNER_DATABASE_ORDERS = {
  passo: "Prossimo passo",
  priorita: "Priorità",
  attivita: "Ultima attività",
  nome: "Nome",
} as const;

export type PartnerDatabaseView = {
  screen: keyof typeof PARTNER_DATABASE_VIEWS;
  section: PartnerViewSection;
  phase: keyof typeof PARTNER_DATABASE_PHASE_FILTERS;
  work: keyof typeof PARTNER_DATABASE_WORK_FILTERS;
  period: PartnerPeriodNumber | null;
  owner: string;
  country: string;
  priority: PartnerPriority | "";
  format: string;
  subtype: string;
  query: string;
  order: keyof typeof PARTNER_DATABASE_ORDERS;
  month: string;
  calendarMode: "mese" | "settimana" | "lista";
  allHistory: boolean;
  co: number | null;
};

type Params = URLSearchParams | Record<string, string | string[] | undefined>;
function fromRecord<T extends Record<string, string>>(values: T, value: string, fallback: keyof T) {
  return Object.hasOwn(values, value) ? (value as keyof T) : fallback;
}

export function parsePartnerDatabaseView(
  params: Params,
  today: string,
  memberIds: readonly string[],
): PartnerDatabaseView {
  const get = (key: string) => {
    const value = params instanceof URLSearchParams ? params.get(key) : params[key];
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  };
  const legacy = parsePartnerView(params, { memberIds });
  const screen = fromRecord(PARTNER_DATABASE_VIEWS, get("vista"), "elenco");
  const explicitScreen = Object.hasOwn(PARTNER_DATABASE_VIEWS, get("vista"));
  let phase: PartnerDatabaseView["phase"] = fromRecord(
    PARTNER_DATABASE_PHASE_FILTERS,
    get("fase"),
    "tutti",
  );
  let work: PartnerDatabaseView["work"] = fromRecord(
    PARTNER_DATABASE_WORK_FILTERS,
    get("lavoro"),
    "tutti",
  );
  if (!explicitScreen) {
    if (legacy.view.accordi) phase = "accordo";
    else if (legacy.view.lavoro === "risposte") work = "risposte";
    else if (get("vista") === "da_seguire") work = "da_seguire";
    const status = legacy.view.accordi || legacy.view.lavoro === "risposte" ? "" : get("stato");
    if (status === "da_controllare") work = "da_controllare";
    else if (status === "da_fare" && work === "tutti") work = "da_fare";
    else if (status === "no") phase = "non_interessato";
    else if (status === "chiuso") phase = "accordo";
    else if (Object.hasOwn(PARTNER_STATUS_FILTER_LABELS, status) && status !== "tutti")
      phase = fromRecord(PARTNER_DATABASE_PHASE_FILTERS, status, phase);
  }
  const month = get("mese");
  const mode = get("calendario");
  const priority = get("priorita");
  const country = get("paese").toUpperCase();
  return {
    screen,
    section: legacy.view.sezione,
    phase,
    work,
    period:
      legacy.explicit.periodo &&
      (explicitScreen || (legacy.view.lavoro === "tutti" && !legacy.view.accordi))
        ? legacy.view.periodo
        : null,
    owner: legacy.view.chi,
    country: /^[A-Z]{2}$/.test(country) ? country : country === "SCONOSCIUTO" ? "sconosciuto" : "",
    priority: PARTNER_PRIORITIES.find((value) => value === priority) ?? "",
    format: get("formato").slice(0, 100),
    subtype: get("sottotipo").slice(0, 100),
    query: [...get("q")].slice(0, PARTNER_QUERY_MAX).join(""),
    order: fromRecord(PARTNER_DATABASE_ORDERS, get("ordine"), "passo"),
    month: isMonthStart(`${month}-01`) ? month : today.slice(0, 7),
    calendarMode: mode === "settimana" || mode === "lista" ? mode : "mese",
    allHistory: get("storico") === "tutto",
    co: legacy.view.co,
  };
}

export function partnerDatabaseHref(view: PartnerDatabaseView) {
  const params = new URLSearchParams({ vista: view.screen });
  const values = {
    sezione: view.section === "tutti" ? "" : view.section,
    fase: view.phase === "tutti" ? "" : view.phase,
    lavoro: view.work === "tutti" ? "" : view.work,
    periodo: view.period?.toString() ?? "",
    chi: view.owner === "tutti" ? "" : view.owner,
    paese: view.country,
    priorita: view.priority,
    formato: view.format,
    sottotipo: view.subtype,
    q: view.query,
    ordine: view.order === "passo" ? "" : view.order,
    mese: view.month,
    calendario: view.calendarMode === "mese" ? "" : view.calendarMode,
    storico: view.allHistory ? "tutto" : "",
    co: view.co?.toString() ?? "",
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  return `/partner?${params}`;
}

export function filterPartnerDatabase(
  rows: readonly PartnerDatabaseRow[],
  view: PartnerDatabaseView,
  today: string,
  memberId: string | null,
  differences: ReadonlySet<string>,
) {
  return rows.filter((row) => {
    const { partner } = row;
    if (view.section !== "tutti" && !partner.sections.includes(view.section)) return false;
    if (view.phase === "non_contattare" && !row.blocked) return false;
    if (view.phase !== "tutti" && view.phase !== "non_contattare") {
      if (
        (row.blocked && row.stage !== "chiuso") ||
        (view.phase !== row.stage && view.phase !== row.group)
      )
        return false;
    }
    if (view.work === "da_seguire" && !row.work.needsAction) return false;
    if (view.work === "risposte" && !row.firstReply) return false;
    if (view.work === "da_controllare" && !differences.has(partner.id)) return false;
    if (view.work === "da_fare" && (row.blocked || row.stage === "chiuso")) return false;
    if (view.period !== null && partnerPeriod(partner, today) !== view.period) return false;
    if (view.owner === "nessuno" && partner.ownerId !== null) return false;
    if (view.owner === "io" && (!memberId || row.ownerId !== memberId)) return false;
    if (!["tutti", "nessuno", "io"].includes(view.owner) && row.ownerId !== view.owner)
      return false;
    if (view.country && (row.countryCode ?? "sconosciuto") !== view.country) return false;
    if (view.priority && partner.priority !== view.priority) return false;
    if (view.format && (row.format ?? "sconosciuto") !== view.format) return false;
    if (view.subtype && (row.subtype ?? (partner.typeLabel || "sconosciuto")) !== view.subtype)
      return false;
    return partnerSearchMatch(partner, view.query);
  });
}
