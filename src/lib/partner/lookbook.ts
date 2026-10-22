// Partner: i cinque lookbook (spec 02 §2.2; 00-sequenza decisione 20 e §5, 02-2).
//
// Niente Storage: i PDF stanno nel repository in data/partner-lookbooks/<codice>.pdf e li serve
// la route /partner/lookbook/[code], solo ai membri, sempre come allegato. Ogni file resta sotto
// 4 MB, sotto il limite di 4,5 MB delle risposte Vercel.
import { PARTNER_LOOKBOOK_CODES, isPartnerLookbookCode, type PartnerLookbookCode } from "./model";

export { PARTNER_LOOKBOOK_CODES, isPartnerLookbookCode, type PartnerLookbookCode };

export const PARTNER_LOOKBOOK_DIRECTORY = "data/partner-lookbooks";
export const PARTNER_LOOKBOOK_MAX_BYTES = 4 * 1024 * 1024;

/** Titoli fissi per codice, come nel sito Partner. */
export const PARTNER_LOOKBOOK_TITLES: Record<PartnerLookbookCode, string> = {
  negozi: "Stockists",
  eventi: "Events",
  collab: "Collaborations",
  porsche_club: "Porsche Clubs",
  club: "Clubs",
};

export const partnerLookbookTitle = (code: PartnerLookbookCode) => PARTNER_LOOKBOOK_TITLES[code];

/** «LuckyLap-Lookbook-Porsche-Clubs.pdf»: nome del file scaricato. */
export const partnerLookbookFileName = (code: PartnerLookbookCode) =>
  `LuckyLap-Lookbook-${PARTNER_LOOKBOOK_TITLES[code].replace(/ /g, "-")}.pdf`;

/**
 * Percorso relativo alla radice del progetto, `data/partner-lookbooks/negozi.pdf`. Solo per i
 * cinque codici: `null` per qualsiasi altro testo, così un parametro non arriva mai al disco.
 */
export function partnerLookbookFile(code: unknown): string | null {
  return isPartnerLookbookCode(code) ? `${PARTNER_LOOKBOOK_DIRECTORY}/${code}.pdf` : null;
}

/** I file PDF iniziano con «%PDF-». */
export function isPdfBytes(bytes: Uint8Array): boolean {
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return bytes.byteLength >= signature.length && signature.every((byte, i) => bytes[i] === byte);
}

/** Intestazioni della risposta 200: sempre allegato, mai in cache, tipo dichiarato. */
export function partnerLookbookHeaders(
  code: PartnerLookbookCode,
  byteLength: number,
): Record<string, string> {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${partnerLookbookFileName(code)}"`,
    "Content-Length": String(byteLength),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

/**
 * Dimensione di ogni PDF in data/partner-lookbooks, per /partner/dati senza leggere il disco
 * (la pagina non porta i PDF nella sua traccia). lookbook.test.ts la confronta con i file.
 */
export const PARTNER_LOOKBOOK_BYTES: Record<PartnerLookbookCode, number> = {
  negozi: 3051669,
  eventi: 2903389,
  collab: 2051682,
  porsche_club: 2592305,
  club: 2444810,
};

/** «2,9 MB». */
export function formatLookbookSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
