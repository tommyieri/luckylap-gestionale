// Partner: valori di dominio condivisi da pagina, Server Action e parser (spec 02 §1, §2.2).
// Stessi valori dei check della migrazione partner_module. Funzioni pure, nessun import di React.

export const PARTNER_STAGES = [
  "da_contattare",
  "contattato",
  "risposto",
  "trattativa",
  "chiuso",
  "no",
] as const;
export type PartnerStage = (typeof PARTNER_STAGES)[number];
export const PARTNER_STAGE_LABELS: Record<PartnerStage, string> = {
  da_contattare: "Da contattare",
  contattato: "Contattato",
  risposto: "Ha risposto",
  trattativa: "In trattativa",
  chiuso: "Chiuso",
  no: "Non interessato",
};

export const PARTNER_APPROACHES = ["vendita", "evento", "collab", "su_misura", "media"] as const;
export type PartnerApproach = (typeof PARTNER_APPROACHES)[number];
export const PARTNER_APPROACH_LABELS: Record<PartnerApproach, string> = {
  vendita: "Vendita",
  evento: "Presenza all’evento",
  collab: "Collab",
  su_misura: "Su misura",
  media: "Media",
};

/** I quattro testi modificabili di una variante, con i limiti di partner_message_variants. */
export const PARTNER_MESSAGE_FIELDS = ["subject", "body", "follow_up", "confirm_email"] as const;
export type PartnerMessageField = (typeof PARTNER_MESSAGE_FIELDS)[number];
export const PARTNER_MESSAGE_LIMITS: Record<PartnerMessageField, number> = {
  subject: 300,
  body: 8000,
  follow_up: 4000,
  confirm_email: 4000,
};

/** Codice del contatto nella ricerca (`L014`, `n111`): source_key nel database. */
export const PARTNER_SOURCE_KEY = /^[A-Za-z0-9]{1,20}$/;
export const PARTNER_NAME_MAX = 240;

export const isPartnerStage = (value: unknown): value is PartnerStage =>
  typeof value === "string" && (PARTNER_STAGES as readonly string[]).includes(value);
export const isPartnerApproach = (value: unknown): value is PartnerApproach =>
  typeof value === "string" && (PARTNER_APPROACHES as readonly string[]).includes(value);

/** Lunghezza in caratteri come char_length di PostgreSQL (punti di codice, non unità UTF-16). */
export function charCount(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

/** Caratteri rifiutati da private.partner_text: controllo tranne tab, a capo e ritorno a capo. */
export function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
