// Partner: dalle righe lette al modello della pagina (spec 02 §6). Funzioni pure.
//
// Il server legge le righe sotto RLS (server.ts) e le passa qui; l'anteprima locale passa le
// righe sintetiche di fixtures.ts. Stesso percorso, stessi controlli: righe non valide,
// riferimenti a contatti che non ci sono o doppioni danno PartnerReadError, mai dati parziali.
import {
  partnerAssistantContactFrom,
  type PartnerAssistantContactView,
  type PartnerAssistantRows,
} from "./assistant";
import { partnerDomain } from "./contacts";
import {
  PARTNER_APPROACHES,
  PartnerReadError,
  isPartnerId,
  parsePartnerActivity,
  parsePartnerBlock,
  parsePartnerContact,
  parsePartnerContactLink,
  parsePartnerDetailRow,
  parsePartnerDeviceImport,
  parsePartnerDifference,
  parsePartnerOpenDifference,
  parsePartnerResearchImport,
  parsePartnerRevision,
  parsePartnerSummary,
  parsePartnerVariant,
  parsePartnerVariantSummary,
  type PartnerBlock,
  type PartnerContact,
  type PartnerDetail,
  type PartnerDeviceImport,
  type PartnerMember,
  type PartnerResearchImport,
  type PartnerRevision,
  type PartnerVariantDetail,
  type PartnerWorkspace,
} from "./model";

const ensure = (condition: unknown): void => {
  if (!condition) throw new PartnerReadError();
};
const unique = <T>(items: readonly T[], key: (item: T) => unknown) => {
  ensure(new Set(items.map(key)).size === items.length);
  return items;
};
const approachOrder = (approach: string) =>
  (PARTNER_APPROACHES as readonly string[]).indexOf(approach);
/** Istanti in ordine decrescente: PostgREST scrive «+00:00», le fixture «Z». */
const newest = (a: string, b: string) => Date.parse(b) - Date.parse(a);

/** Membri con il nome, attivi o no, in ordine alfabetico. */
export function partnerMembersFromRows(
  profiles: readonly unknown[],
  memberships: readonly unknown[],
): PartnerMember[] {
  const record = (value: unknown) => {
    ensure(value !== null && typeof value === "object" && !Array.isArray(value));
    return value as Record<string, unknown>;
  };
  const active = new Set(
    memberships.map((value) => {
      const row = record(value);
      ensure(isPartnerId(row.user_id) && row.active === true);
      return row.user_id as string;
    }),
  );
  const members = profiles.map((value) => {
    const row = record(value);
    ensure(isPartnerId(row.user_id) && typeof row.display_name === "string");
    const name = (row.display_name as string).trim();
    ensure(name.length >= 1 && name.length <= 120);
    return { id: row.user_id as string, name, active: active.has(row.user_id as string) };
  });
  unique(members, (member) => member.id);
  ensure([...active].every((user) => members.some((member) => member.id === user)));
  return members.sort((a, b) => a.name.localeCompare(b.name, "it") || a.id.localeCompare(b.id));
}

export type PartnerWorkspaceRows = {
  partners: readonly unknown[];
  contacts: readonly unknown[];
  variants: readonly unknown[];
  differences: readonly unknown[];
  blocks: readonly unknown[];
  profiles: readonly unknown[];
  memberships: readonly unknown[];
  /** Ultimo import della ricerca, se c'è. */
  lastImport: unknown;
};

export function partnerWorkspaceFromRows(rows: PartnerWorkspaceRows): PartnerWorkspace {
  const partners = rows.partners.map(parsePartnerSummary);
  unique(partners, (partner) => partner.co);
  unique(partners, (partner) => partner.id);
  const ids = new Set(partners.map((partner) => partner.id));
  const owned = <T extends { id: string; partnerId: string | null }>(items: T[]) => {
    ensure(items.every((item) => item.partnerId === null || ids.has(item.partnerId)));
    unique(items, (item) => item.id);
    return items;
  };
  const variants = owned(rows.variants.map(parsePartnerVariantSummary));
  unique(variants, (variant) => `${variant.partnerId}|${variant.approach}`);
  return {
    partners: partners.sort((a, b) => a.co - b.co),
    contacts: owned(rows.contacts.map(parsePartnerContactLink)),
    variants,
    differences: owned(rows.differences.map(parsePartnerOpenDifference)),
    blocks: owned(rows.blocks.map(parsePartnerBlock)),
    members: partnerMembersFromRows(rows.profiles, rows.memberships),
    lastImport:
      rows.lastImport === null || rows.lastImport === undefined
        ? null
        : parsePartnerResearchImport(rows.lastImport),
  };
}

/** Domini di sito ed email di un contatto: per cercare i blocchi per dominio. */
export function partnerDomainsOf(contacts: readonly unknown[]): string[] {
  const domains = new Set<string>();
  for (const value of contacts) {
    const contact = parsePartnerContactLink(value);
    if (contact.kind !== "web" && contact.kind !== "email") continue;
    const domain = partnerDomain(contact.linkValue);
    if (domain) domains.add(domain);
  }
  return [...domains];
}

export type PartnerDetailRows = {
  partner: unknown;
  contacts: readonly unknown[];
  variants: readonly unknown[];
  /** Ultime revisioni di ogni variante, con il conteggio totale. */
  revisions: readonly { variantId: string; rows: readonly unknown[]; count: number }[];
  /** Revisioni correnti più vecchie delle ultime lette. */
  currentRevisions: readonly unknown[];
  activities: readonly unknown[];
  activityCount: number;
  differences: readonly unknown[];
  /** Blocchi attivi del contatto e dei suoi domini. */
  blocks: readonly unknown[];
  /** File dei dispositivi citati da registro e differenze. */
  deviceImports: readonly unknown[];
  /** Righe dell'assistente; `null` se non si sono lette (per esempio prima delle migrazioni). */
  assistant: PartnerAssistantRows | null;
};

/**
 * Il blocco dell'assistente ha un controllo proprio: `null` vuol dire solo «stato non leggibile»,
 * cioè righe non lette o non valide (anche un valore sconosciuto, come una proposta fuori elenco),
 * e la scheda resta leggibile. Un contatto senza lavoro né interruttore ha righe lette e vuote: il
 * blocco c'è, con l'interruttore attivo e `job: null`, così chi lo mostra non confonde i due casi.
 */
function assistantOf(
  partnerId: string,
  contacts: readonly PartnerContact[],
  rows: PartnerAssistantRows | null,
): PartnerAssistantContactView | null {
  if (rows === null) return null;
  try {
    return partnerAssistantContactFrom({ ...rows, partnerId, contacts });
  } catch {
    return null;
  }
}

export function partnerDetailFromRows(co: number, rows: PartnerDetailRows): PartnerDetail {
  const partner = parsePartnerDetailRow(rows.partner);
  ensure(partner.co === co);
  const mine = <T extends { partnerId: string | null }>(items: T[]) => {
    ensure(items.every((item) => item.partnerId === partner.id));
    return items;
  };
  const contacts = mine(rows.contacts.map(parsePartnerContact)).sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.position - b.position ||
      -newest(a.createdAt, b.createdAt),
  );
  unique(contacts, (contact) => contact.id);
  const variants = mine(rows.variants.map(parsePartnerVariant));
  unique(variants, (variant) => variant.approach);
  unique(variants, (variant) => variant.id);
  const differences = mine(rows.differences.map(parsePartnerDifference));
  const activities = mine(rows.activities.map(parsePartnerActivity));
  ensure(Number.isSafeInteger(rows.activityCount) && rows.activityCount >= activities.length);
  const imports: PartnerDeviceImport[] = rows.deviceImports.map(parsePartnerDeviceImport);
  const byOperation = new Map(imports.map((item) => [item.operationId, item]));
  const byId = new Map(imports.map((item) => [item.id, item]));
  const extra = rows.currentRevisions.map(parsePartnerRevision);

  const details: PartnerVariantDetail[] = variants.map((variant) => {
    const set = rows.revisions.find((item) => item.variantId === variant.id);
    ensure(set && Number.isSafeInteger(set.count) && set.count >= set.rows.length);
    const revisions = set!.rows.map(parsePartnerRevision);
    ensure(revisions.every((revision) => revision.variantId === variant.id));
    revisions.sort((a, b) => b.revisionNo - a.revisionNo);
    const current: PartnerRevision | null =
      variant.currentRevisionId === null
        ? null
        : (revisions.find((revision) => revision.id === variant.currentRevisionId) ??
          extra.find(
            (revision) =>
              revision.id === variant.currentRevisionId && revision.variantId === variant.id,
          ) ??
          null);
    ensure((variant.currentRevisionId === null) === (current === null));
    ensure(current === null || current.texts !== null);
    return {
      ...variant,
      current: current?.texts ?? variant.original,
      currentRevision: current,
      revisions,
      revisionCount: set!.count,
    };
  });

  const blocks = new Map<string, PartnerBlock>();
  const domains = new Set(partnerDomainsOf(rows.contacts));
  for (const block of rows.blocks.map(parsePartnerBlock)) {
    ensure(block.partnerId === partner.id || (block.domain !== null && domains.has(block.domain)));
    blocks.set(block.id, block);
  }

  return {
    partner,
    contacts,
    variants: details.sort((a, b) => approachOrder(a.approach) - approachOrder(b.approach)),
    activities: activities
      .sort((a, b) => newest(a.occurredAt, b.occurredAt) || b.id.localeCompare(a.id))
      .map((activity) => {
        if (activity.origin !== "file") return activity;
        const source = byOperation.get(activity.operationId);
        ensure(source);
        return { ...activity, device: source!.device };
      }),
    activityCount: rows.activityCount,
    differences: differences.map((difference) => {
      if (difference.deviceImportId === null) return difference;
      const source = byId.get(difference.deviceImportId);
      ensure(source);
      return { ...difference, device: source!.device, fileExportedAt: source!.exportedAt };
    }),
    blocks: [...blocks.values()],
    assistant: assistantOf(partner.id, contacts, rows.assistant),
  };
}

export type PartnerDataSnapshot = {
  /** Ultimi import della ricerca, dal più recente. */
  imports: PartnerResearchImport[];
  /** File dei dispositivi importati, dal più recente. */
  deviceImports: PartnerDeviceImport[];
  openDifferences: number;
  members: PartnerMember[];
};

export function partnerDataFromRows(rows: {
  imports: readonly unknown[];
  deviceImports: readonly unknown[];
  openDifferences: number;
  profiles: readonly unknown[];
  memberships: readonly unknown[];
}): PartnerDataSnapshot {
  ensure(Number.isSafeInteger(rows.openDifferences) && rows.openDifferences >= 0);
  const imports = rows.imports.map(parsePartnerResearchImport);
  unique(imports, (item) => item.id);
  const deviceImports = rows.deviceImports.map(parsePartnerDeviceImport);
  unique(deviceImports, (item) => item.id);
  return {
    imports: imports.sort((a, b) => newest(a.appliedAt, b.appliedAt) || b.id.localeCompare(a.id)),
    deviceImports: deviceImports.sort(
      (a, b) => newest(a.importedAt, b.importedAt) || b.id.localeCompare(a.id),
    ),
    openDifferences: rows.openDifferences,
    members: partnerMembersFromRows(rows.profiles, rows.memberships),
  };
}

export type PartnerRules = { import: PartnerResearchImport; contextMd: string };

export function partnerRulesFromRow(row: unknown): PartnerRules | null {
  if (row === null || row === undefined) return null;
  ensure(typeof row === "object" && !Array.isArray(row));
  const record = row as Record<string, unknown>;
  ensure(typeof record.context_md === "string" && record.context_md.length <= 100000);
  return { import: parsePartnerResearchImport(record), contextMd: record.context_md as string };
}
