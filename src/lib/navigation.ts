import { isSensitiveAreaEligible, type VerifiedMember } from "./auth/model";

/**
 * Mappa unica delle sezioni del gestionale (docs: 01-layout §4).
 * Funzioni pure: nessun import React, lucide o server. Il menu è solo una
 * guida: l'autorità resta nelle pagine e nella RLS.
 */
export type SectionId = "oggi" | "vendite" | "magazzino" | "partner" | "team" | "finance" | "ceo";
export type IconName =
  "House" | "ShoppingBag" | "Package" | "Handshake" | "UsersRound" | "Wallet" | "ShieldCheck";
export type NavTab = { href: string; label: string };
export type NavSection = {
  id: SectionId;
  label: string;
  href: string;
  icon: IconName;
  /** Vuoto se la sezione ha una sola pagina. */
  tabs: NavTab[];
  /** Percorsi senza scheda che accendono la sezione. */
  also?: string[];
  requires?: "finance" | "ceo";
  mobile: "bar" | "altro";
};
export type NavAccess =
  /** Fallback di Suspense, prima della verifica. */
  | { status: "pending" }
  /** Workspace non configurato o verifica fallita. */
  | { status: "unavailable" }
  /** Non connesso o account non abilitato. */
  | { status: "outside" }
  /** Anteprima locale. */
  | { status: "preview" }
  | { status: "member"; displayName: string; finance: boolean; ceo: boolean };
export type AccountLink = {
  href: string;
  label: string;
  /** Nome breve nella fascia verde del telefono e accanto ad «Altro». */
  band: string;
  match: string[];
};
export type NavLocation = { section: SectionId | "account" | null; tab: NavTab | null };

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

/** Ordine fisso: Finance e Controllo CEO in fondo, così non spostano le altre voci. */
export const SECTIONS: readonly NavSection[] = deepFreeze<NavSection[]>([
  { id: "oggi", label: "Oggi", href: "/", icon: "House", tabs: [], mobile: "bar" },
  {
    id: "vendite",
    label: "Vendite",
    href: "/sales",
    icon: "ShoppingBag",
    tabs: [
      { href: "/sales", label: "Ordini" },
      { href: "/consignment", label: "Conto vendita" },
    ],
    mobile: "bar",
  },
  {
    id: "magazzino",
    label: "Magazzino",
    href: "/stock",
    icon: "Package",
    tabs: [
      { href: "/stock", label: "Giacenze" },
      { href: "/stock/rettifiche", label: "Rettifiche" },
      // Prima le magliette (Magadzino, negozi, riordini), poi il materiale per spedire.
      { href: "/stock/conto-vendita", label: "Conto vendita" },
      { href: "/stock/riassortimento", label: "Riassortimento" },
      { href: "/packaging", label: "Packaging" },
    ],
    mobile: "bar",
  },
  { id: "partner", label: "Partner", href: "/partner", icon: "Handshake", tabs: [], mobile: "bar" },
  {
    id: "team",
    label: "Team",
    href: "/team",
    icon: "UsersRound",
    tabs: [
      { href: "/team", label: "Calendario e attività" },
      { href: "/development", label: "Nuovi prodotti" },
      { href: "/assets", label: "Grafica e foto" },
    ],
    mobile: "altro",
  },
  {
    id: "finance",
    label: "Finance",
    href: "/finance",
    icon: "Wallet",
    tabs: [
      { href: "/finance", label: "Panoramica" },
      { href: "/finance/work", label: "Registrazioni" },
      { href: "/finance/documents", label: "Documenti" },
    ],
    also: ["/auth/area/finance"],
    requires: "finance",
    mobile: "altro",
  },
  {
    id: "ceo",
    label: "Controllo CEO",
    href: "/audit",
    icon: "ShieldCheck",
    tabs: [],
    also: ["/auth/area/audit"],
    requires: "ceo",
    mobile: "altro",
  },
]);

/**
 * Fuori dalle sezioni: piede della barra laterale (desktop) e foglio «Altro» (telefono).
 * Prima la guida «Come si usa», poi l'account.
 */
export const ACCOUNT_LINKS: readonly AccountLink[] = deepFreeze<AccountLink[]>([
  { href: "/guida", label: "Come si usa", band: "Come si usa", match: ["/guida"] },
  {
    href: "/auth/account",
    label: "Account e sicurezza",
    band: "Account",
    match: ["/auth/account", "/auth/password", "/auth/verify"],
  },
]);

/**
 * Accetta il risultato di `currentMember()` (o qualsiasi forma con `status`).
 * I permessi usano la regola esistente `isSensitiveAreaEligible`, senza copie.
 */
export function navAccessFrom(current: { status: string; member?: VerifiedMember }): NavAccess {
  switch (current.status) {
    case "preview":
      return { status: "preview" };
    case "signed-out":
    case "denied":
      return { status: "outside" };
    case "member":
      return current.member
        ? {
            status: "member",
            displayName: current.member.displayName,
            finance: isSensitiveAreaEligible(current.member, "finance"),
            ceo: isSensitiveAreaEligible(current.member, "audit"),
          }
        : { status: "unavailable" };
    default:
      // "unconfigured", "unavailable" e qualsiasi stato sconosciuto.
      return { status: "unavailable" };
  }
}

export function visibleSections(access: NavAccess): NavSection[] {
  switch (access.status) {
    case "outside":
      return [];
    case "preview":
      return [...SECTIONS];
    case "member":
      // Tutti i membri vedono le aree: l’apertura richiede la relativa password.
      return [...SECTIONS];
    default:
      // "pending" e "unavailable": solo le sezioni aperte a tutti.
      return SECTIONS.filter((section) => !section.requires);
  }
}

/** `/` combacia solo con `/`; gli altri `href` con il percorso uguale o che continua con `/`. */
export function matchesPath(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

type Candidate = { href: string; section: SectionId | "account"; tab: NavTab | null };
// A parità di lunghezza vince la scheda, così `/stock` accende «Giacenze».
const CANDIDATES: readonly Candidate[] = [
  ...SECTIONS.flatMap((section): Candidate[] => [
    ...section.tabs.map((tab) => ({ href: tab.href, section: section.id, tab })),
    { href: section.href, section: section.id, tab: null },
    ...(section.also ?? []).map((href) => ({ href, section: section.id, tab: null })),
  ]),
  ...ACCOUNT_LINKS.flatMap((link) =>
    link.match.map((href): Candidate => ({ href, section: "account", tab: null })),
  ),
]
  .map((candidate, order) => ({ candidate, order }))
  .sort((a, b) => b.candidate.href.length - a.candidate.href.length || a.order - b.order)
  .map(({ candidate }) => candidate);

/** Vince l'`href` più lungo tra schede, sezioni, `also` e percorsi dell'account. */
export function locate(pathname: string): NavLocation {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  const match = CANDIDATES.find((candidate) => matchesPath(candidate.href, path));
  return match ? { section: match.section, tab: match.tab } : { section: null, tab: null };
}

export function mobileSplit(sections: readonly NavSection[]): {
  bar: NavSection[];
  altro: NavSection[];
} {
  return {
    bar: sections.filter((section) => section.mobile === "bar"),
    altro: sections.filter((section) => section.mobile === "altro"),
  };
}
