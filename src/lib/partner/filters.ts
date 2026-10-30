// Partner: filtri, conteggi e stato nell'indirizzo (spec 02 §5.3). Funzioni pure.
//
// `/partner?periodo=1&sezione=eventi&stato=da_fare&chi=io&q=porsche&co=12`: un link apre la
// stessa vista. Valori non validi: si usano i default, senza errore. Periodo, sezione e ricerca
// lavorano nel browser sui dati già caricati; i conteggi delle celle dei periodi applicano tutti
// i filtri tranne il periodo, come nel sito.
import { partnerDomain } from "./contacts";
import { partnerLeadAnchor, PARTNER_PATH } from "./links";
import {
  PARTNER_SECTIONS,
  PARTNER_STAGES,
  PARTNER_STAGE_LABELS,
  isPartnerCo,
  isPartnerId,
  isVisibleVariant,
  type PartnerBlock,
  type PartnerContactLink,
  type PartnerOpenDifference,
  type PartnerSection,
  type PartnerStage,
  type PartnerSummary,
  type PartnerVariantSummary,
} from "./model";
import { PARTNER_PERIOD_NUMBERS, partnerPeriod, type PartnerPeriodNumber } from "./periods";

export const PARTNER_VIEW_SECTIONS = ["tutti", ...PARTNER_SECTIONS] as const;
export type PartnerViewSection = (typeof PARTNER_VIEW_SECTIONS)[number];
export const PARTNER_STATUS_FILTERS = [
  "da_fare",
  "tutti",
  ...PARTNER_STAGES,
  "non_contattare",
  "da_controllare",
] as const;
export type PartnerStatusFilter = (typeof PARTNER_STATUS_FILTERS)[number];
export const PARTNER_STATUS_FILTER_LABELS: Record<PartnerStatusFilter, string> = {
  da_fare: "Da fare",
  tutti: "Tutti",
  ...PARTNER_STAGE_LABELS,
  non_contattare: "Non contattare",
  da_controllare: "Da controllare",
};
/** `tutti`, `io`, `nessuno` oppure l'id di un membro. */
export type PartnerOwnerFilter = "tutti" | "io" | "nessuno" | (string & {});
export const PARTNER_QUERY_MAX = 80;

export type PartnerView = {
  periodo: PartnerPeriodNumber;
  sezione: PartnerViewSection;
  stato: PartnerStatusFilter;
  chi: PartnerOwnerFilter;
  q: string;
  /** Contatto con i dettagli aperti. */
  co: number | null;
  /**
   * «Ci siamo»: solo gli accordi fatti (stato `chiuso`), di ogni periodo e sezione, con gli
   * eventi in arrivo per primi. Nell'indirizzo è `vista=ci_siamo`.
   */
  accordi: boolean;
};
export const DEFAULT_PARTNER_VIEW: PartnerView = {
  periodo: 1,
  sezione: "tutti",
  stato: "da_fare",
  chi: "tutti",
  q: "",
  co: null,
  accordi: false,
};
/** Valore di `vista` nell'indirizzo per «Ci siamo». */
export const PARTNER_AGREED_VIEW = "ci_siamo";

type Params =
  URLSearchParams | Record<string, string | string[] | undefined> | ReadonlyMap<string, string>;
const param = (params: Params, key: string): string | undefined => {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  if (params instanceof Map) return params.get(key);
  const value = (params as Record<string, string | string[] | undefined>)[key];
  return Array.isArray(value) ? value[0] : value;
};
const oneOf = <T extends string>(list: readonly T[], value: string | undefined) =>
  value !== undefined && (list as readonly string[]).includes(value) ? (value as T) : null;

/**
 * Vista dall'indirizzo. `explicit` dice se periodo e sezione c'erano davvero: se no, il client
 * usa gli ultimi salvati nel browser. Con `memberIds`, un `chi` che non è un membro torna a `tutti`.
 */
export function parsePartnerView(
  params: Params,
  options: { memberIds?: Iterable<string> } = {},
): { view: PartnerView; explicit: { periodo: boolean; sezione: boolean } } {
  const periodText = param(params, "periodo");
  const periodo = PARTNER_PERIOD_NUMBERS.find((n) => String(n) === periodText) ?? null;
  const sezione = oneOf(PARTNER_VIEW_SECTIONS, param(params, "sezione"));
  const stato = oneOf(PARTNER_STATUS_FILTERS, param(params, "stato"));
  const who = param(params, "chi");
  const members = options.memberIds
    ? new Set([...options.memberIds].map((id) => id.toLowerCase()))
    : null;
  const chi =
    who === "tutti" || who === "io" || who === "nessuno"
      ? who
      : who !== undefined && isPartnerId(who) && (members?.has(who.toLowerCase()) ?? true)
        ? who.toLowerCase()
        : "tutti";
  const q = [...(param(params, "q") ?? "").replace(/\s+/g, " ").trim()]
    .slice(0, PARTNER_QUERY_MAX)
    .join("")
    .trim();
  const coText = param(params, "co");
  const co = coText !== undefined && /^[1-9][0-9]{0,4}$/.test(coText) ? Number(coText) : null;
  return {
    view: {
      periodo: periodo ?? DEFAULT_PARTNER_VIEW.periodo,
      sezione: sezione ?? DEFAULT_PARTNER_VIEW.sezione,
      stato: stato ?? DEFAULT_PARTNER_VIEW.stato,
      chi,
      q,
      co: co !== null && isPartnerCo(co) ? co : null,
      accordi: param(params, "vista") === PARTNER_AGREED_VIEW,
    },
    explicit: { periodo: periodo !== null, sezione: sezione !== null },
  };
}

/**
 * Testo della query, senza «?»: periodo e sezione sempre (così un link apre la stessa vista
 * anche su un altro browser), gli altri filtri solo se diversi dal default.
 */
export function partnerViewQuery(view: PartnerView): string {
  const params = new URLSearchParams();
  params.set("periodo", String(view.periodo));
  params.set("sezione", view.sezione);
  if (view.stato !== DEFAULT_PARTNER_VIEW.stato) params.set("stato", view.stato);
  if (view.chi !== DEFAULT_PARTNER_VIEW.chi) params.set("chi", view.chi);
  if (view.q !== "") params.set("q", view.q);
  if (view.accordi) params.set("vista", PARTNER_AGREED_VIEW);
  if (view.co !== null) params.set("co", String(view.co));
  return params.toString();
}

/** `/partner?periodo=1&sezione=tutti&co=12#lead-12`. */
export function partnerViewHref(view: PartnerView): string {
  const query = partnerViewQuery(view);
  return `${PARTNER_PATH}?${query}${view.co !== null ? `#${partnerLeadAnchor(view.co)}` : ""}`;
}

// ---------------------------------------------------------------------------
// Indice e corrispondenze
// ---------------------------------------------------------------------------

export type PartnerIndex = {
  /** Recapiti per contatto, per posizione (anche i rimossi: servono al blocco per dominio). */
  contacts: ReadonlyMap<string, PartnerContactLink[]>;
  /** Varianti da mostrare per contatto, nell'ordine degli approcci. */
  variants: ReadonlyMap<string, PartnerVariantSummary[]>;
  /** Differenze aperte per contatto. */
  differences: ReadonlyMap<string, PartnerOpenDifference[]>;
  /** Blocco che vale per il contatto: il suo, altrimenti quello del suo dominio. */
  blocks: ReadonlyMap<string, PartnerBlock>;
};

const APPROACH_ORDER = ["vendita", "evento", "collab", "su_misura", "media"];
function group<T extends { partnerId: string }>(rows: readonly T[]) {
  const map = new Map<string, T[]>();
  for (const item of rows) {
    const list = map.get(item.partnerId);
    if (list) list.push(item);
    else map.set(item.partnerId, [item]);
  }
  return map;
}

/**
 * Come private.partner_blocked: riga attiva del contatto, oppure dominio del suo sito o della sua
 * email (anche di un recapito rimosso, non cancellato) in una riga attiva.
 */
export function buildPartnerIndex(workspace: {
  contacts: readonly PartnerContactLink[];
  variants: readonly PartnerVariantSummary[];
  differences: readonly PartnerOpenDifference[];
  blocks: readonly PartnerBlock[];
}): PartnerIndex {
  const contacts = group([...workspace.contacts].sort((a, b) => a.position - b.position));
  const variants = group(
    workspace.variants
      .filter((variant) => isVisibleVariant(variant))
      .sort((a, b) => APPROACH_ORDER.indexOf(a.approach) - APPROACH_ORDER.indexOf(b.approach)),
  );
  const differences = group(workspace.differences);
  const blocks = new Map<string, PartnerBlock>();
  const byDomain = new Map<string, PartnerBlock>();
  for (const block of workspace.blocks) {
    if (block.partnerId !== null) blocks.set(block.partnerId, block);
    if (block.domain !== null) byDomain.set(block.domain, block);
  }
  if (byDomain.size > 0)
    for (const [partnerId, list] of contacts) {
      if (blocks.has(partnerId)) continue;
      for (const contact of list) {
        if (contact.kind !== "web" && contact.kind !== "email") continue;
        const block = byDomain.get(partnerDomain(contact.linkValue) ?? "");
        if (block) {
          blocks.set(partnerId, block);
          break;
        }
      }
    }
  return { contacts, variants, differences, blocks };
}

export type PartnerFilterContext = {
  index: PartnerIndex;
  /** Giorno di Roma «AAAA-MM-GG». */
  today: string;
  /** Membro della sessione, per `chi=io`. */
  memberId: string | null;
};

/** Minuscolo e senza accenti: «dusseldorf» trova «Düsseldorf». */
export function searchText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** CO cercato: «12», «CO 12», «CO012», «co 012» → 12. */
export function coQuery(q: string): number | null {
  const match = /^(?:co\s*)?0*([1-9][0-9]{0,4})$/i.exec(q.trim());
  return match ? Number(match[1]) : null;
}

export function partnerSearchMatch(partner: PartnerSummary, q: string): boolean {
  const query = searchText(q);
  if (query === "") return true;
  const co = coQuery(query);
  if (co !== null && partner.co === co) return true;
  return searchText(
    `${partner.name} ${partner.city} ${partner.country} ${partner.typeLabel}`,
  ).includes(query);
}

function statusMatch(partner: PartnerSummary, stato: PartnerStatusFilter, index: PartnerIndex) {
  switch (stato) {
    case "tutti":
      return true;
    case "da_fare":
      return partner.stage !== "chiuso" && partner.stage !== "no";
    case "non_contattare":
      return index.blocks.has(partner.id);
    case "da_controllare":
      return (index.differences.get(partner.id)?.length ?? 0) > 0;
    default:
      return partner.stage === (stato as PartnerStage);
  }
}

function ownerMatch(partner: PartnerSummary, chi: PartnerOwnerFilter, memberId: string | null) {
  if (chi === "tutti") return true;
  if (chi === "nessuno") return partner.ownerId === null;
  if (chi === "io") return memberId !== null && partner.ownerId === memberId;
  return partner.ownerId !== null && partner.ownerId.toLowerCase() === chi.toLowerCase();
}

export function partnerMatches(
  partner: PartnerSummary,
  view: PartnerView,
  context: PartnerFilterContext,
  options: { ignorePeriod?: boolean } = {},
): boolean {
  if (view.accordi)
    return (
      partner.stage === "chiuso" &&
      ownerMatch(partner, view.chi, context.memberId) &&
      partnerSearchMatch(partner, view.q)
    );
  if (view.sezione !== "tutti" && !partner.sections.includes(view.sezione as PartnerSection))
    return false;
  if (!options.ignorePeriod && partnerPeriod(partner, context.today) !== view.periodo) return false;
  return (
    statusMatch(partner, view.stato, context.index) &&
    ownerMatch(partner, view.chi, context.memberId) &&
    partnerSearchMatch(partner, view.q)
  );
}

/** Evento non ancora finito, giorno di Roma «AAAA-MM-GG»: è (o sarà) nel calendario del team. */
export function upcomingEventStart(partner: PartnerSummary, today: string): string | null {
  const start = partner.eventStartsOn;
  if (start === null) return null;
  return (partner.eventEndsOn ?? start) >= today ? start : null;
}

/**
 * Contatti della vista, per CO. In «Ci siamo» prima gli eventi in arrivo, per data, poi gli
 * altri accordi per CO.
 */
export function filterPartners(
  partners: readonly PartnerSummary[],
  view: PartnerView,
  context: PartnerFilterContext,
): PartnerSummary[] {
  const visible = partners.filter((partner) => partnerMatches(partner, view, context));
  if (!view.accordi) return visible.sort((a, b) => a.co - b.co);
  const key = (partner: PartnerSummary) => upcomingEventStart(partner, context.today) ?? "9999";
  return visible.sort((a, b) => key(a).localeCompare(key(b)) || a.co - b.co);
}

/** Accordi fatti: il numero sul pulsante «Ci siamo». */
export const agreedCount = (partners: readonly PartnerSummary[]): number =>
  partners.filter((partner) => partner.stage === "chiuso").length;

/** Conteggi delle cinque celle: tutti i filtri tranne il periodo. */
export function periodCounts(
  partners: readonly PartnerSummary[],
  view: PartnerView,
  context: PartnerFilterContext,
): Record<PartnerPeriodNumber, number> {
  const counts: Record<PartnerPeriodNumber, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const partner of partners)
    if (partnerMatches(partner, view, context, { ignorePeriod: true }))
      counts[partnerPeriod(partner, context.today)] += 1;
  return counts;
}

/** Conteggi dei pulsanti delle sezioni e della riga sotto il titolo: su tutti i contatti. */
export function sectionCounts(
  partners: readonly PartnerSummary[],
): Record<PartnerViewSection, number> {
  const counts: Record<PartnerViewSection, number> = {
    tutti: partners.length,
    vendita: 0,
    eventi: 0,
    collab: 0,
    club: 0,
  };
  for (const partner of partners) for (const section of partner.sections) counts[section] += 1;
  return counts;
}

/** «207 contatti · 119 Vendita · 80 Eventi · 73 Collab · 0 Club. Lo stesso posto può stare in più sezioni.» */
export function totalsLine(counts: Record<PartnerViewSection, number>): string {
  return `${counts.tutti} ${counts.tutti === 1 ? "contatto" : "contatti"} · ${counts.vendita} Vendita · ${counts.eventi} Eventi · ${counts.collab} Collab · ${counts.club} Club. Lo stesso posto può stare in più sezioni.`;
}

/**
 * Vista in cui il contatto si vede: per un link `?co=12` o `#lead-12` che arriva da un altro
 * periodo o da filtri che lo nascondono. Cambia solo ciò che serve.
 */
export function viewShowing(
  view: PartnerView,
  partner: PartnerSummary,
  context: PartnerFilterContext,
): PartnerView {
  const next: PartnerView = { ...view, co: partner.co };
  if (next.accordi) {
    if (partner.stage === "chiuso") {
      if (!ownerMatch(partner, next.chi, context.memberId)) next.chi = "tutti";
      if (!partnerSearchMatch(partner, next.q)) next.q = "";
      return next;
    }
    next.accordi = false;
  }
  next.periodo = partnerPeriod(partner, context.today);
  if (next.sezione !== "tutti" && !partner.sections.includes(next.sezione as PartnerSection))
    next.sezione = "tutti";
  if (!statusMatch(partner, next.stato, context.index)) next.stato = "tutti";
  if (!ownerMatch(partner, next.chi, context.memberId)) next.chi = "tutti";
  if (!partnerSearchMatch(partner, next.q)) next.q = "";
  return next;
}

/** Nessun filtro oltre a periodo e sezione: per «Togli i filtri». */
export const withoutFilters = (view: PartnerView): PartnerView => ({
  ...view,
  stato: DEFAULT_PARTNER_VIEW.stato,
  chi: DEFAULT_PARTNER_VIEW.chi,
  q: "",
  co: null,
});

// ---------------------------------------------------------------------------
// Ultimo periodo e ultima sezione nel browser
// ---------------------------------------------------------------------------

export const PARTNER_VIEW_STORAGE_KEY = "luckylap.partner.vista.v1";

/** Ultimi periodo e sezione salvati; `{}` se mancano, sono illeggibili o lo storage non c'è. */
export function readRememberedView(
  storage: Pick<Storage, "getItem"> | null | undefined,
): Partial<Pick<PartnerView, "periodo" | "sezione">> {
  try {
    const raw = storage?.getItem(PARTNER_VIEW_STORAGE_KEY);
    if (!raw || raw.length > 200) return {};
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object") return {};
    const record = value as Record<string, unknown>;
    const result: Partial<Pick<PartnerView, "periodo" | "sezione">> = {};
    const periodo = PARTNER_PERIOD_NUMBERS.find((n) => n === record.periodo);
    if (periodo !== undefined) result.periodo = periodo;
    const sezione = PARTNER_VIEW_SECTIONS.find((s) => s === record.sezione);
    if (sezione !== undefined) result.sezione = sezione;
    return result;
  } catch {
    return {};
  }
}

/** Salva periodo e sezione; non fa nulla se lo storage non è disponibile. */
export function rememberView(
  storage: Pick<Storage, "setItem"> | null | undefined,
  view: Pick<PartnerView, "periodo" | "sezione">,
): void {
  try {
    storage?.setItem(
      PARTNER_VIEW_STORAGE_KEY,
      JSON.stringify({ periodo: view.periodo, sezione: view.sezione }),
    );
  } catch {
    // Navigazione privata o spazio pieno: la vista resta solo nell'indirizzo.
  }
}
