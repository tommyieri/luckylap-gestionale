import { describe, expect, it } from "vitest";
import {
  PARTNER_LOOKBOOK_CODES,
  PARTNER_LOOKBOOK_MAX_BYTES,
  isPdfBytes,
  partnerLookbookFile,
  partnerLookbookFileName,
  partnerLookbookHeaders,
  partnerLookbookTitle,
} from "./lookbook";
import {
  PARTNER_DATA_PATH,
  PARTNER_RULES_PATH,
  coFromLeadHash,
  partnerHref,
  partnerLeadAnchor,
  partnerLookbookHref,
} from "./links";

// Spec 02 §2.2, §5.10; 00-sequenza §5, 02-2 (PDF nel repository, niente Storage).
describe("lookbook", () => {
  it("cinque codici con titoli e nomi dei file come nel sito Partner", () => {
    expect(PARTNER_LOOKBOOK_CODES).toEqual(["negozi", "eventi", "collab", "porsche_club", "club"]);
    expect(PARTNER_LOOKBOOK_CODES.map(partnerLookbookTitle)).toEqual([
      "Stockists",
      "Events",
      "Collaborations",
      "Porsche Clubs",
      "Clubs",
    ]);
    expect(PARTNER_LOOKBOOK_CODES.map(partnerLookbookFileName)).toEqual([
      "LuckyLap-Lookbook-Stockists.pdf",
      "LuckyLap-Lookbook-Events.pdf",
      "LuckyLap-Lookbook-Collaborations.pdf",
      "LuckyLap-Lookbook-Porsche-Clubs.pdf",
      "LuckyLap-Lookbook-Clubs.pdf",
    ]);
  });

  it("percorso nel repository solo per i cinque codici: nessun altro testo arriva al disco", () => {
    expect(partnerLookbookFile("negozi")).toBe("data/partner-lookbooks/negozi.pdf");
    expect(partnerLookbookFile("porsche_club")).toBe("data/partner-lookbooks/porsche_club.pdf");
    for (const code of ["../.env", "negozi.pdf", "NEGOZI", "", "negozi/../club", null, 3])
      expect(partnerLookbookFile(code)).toBeNull();
  });

  it("riconosce un PDF dai primi byte «%PDF-»", () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(isPdfBytes(encode("%PDF-1.7\n…"))).toBe(true);
    expect(isPdfBytes(encode("%PDF"))).toBe(false);
    expect(isPdfBytes(encode("<html>%PDF-1.7"))).toBe(false);
    expect(isPdfBytes(new Uint8Array())).toBe(false);
  });

  it("risposta sempre come allegato, privata e senza indovinare il tipo", () => {
    expect(partnerLookbookHeaders("porsche_club", 2048)).toEqual({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="LuckyLap-Lookbook-Porsche-Clubs.pdf"',
      "Content-Length": "2048",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    expect(PARTNER_LOOKBOOK_MAX_BYTES).toBe(4 * 1024 * 1024);
  });
});

describe("indirizzi di Partner", () => {
  it("partnerHref apre il contatto per CO, con la sua ancora", () => {
    expect(partnerHref({ co: 12 })).toBe("/partner?co=12#lead-12");
    expect(partnerHref({ co: 99999 })).toBe("/partner?co=99999#lead-99999");
    expect(partnerHref({ co: 0 })).toBe("/partner");
    expect(partnerHref({ co: 1.5 })).toBe("/partner");
    expect(partnerLeadAnchor(7)).toBe("lead-7");
  });

  it("legge il CO dall'ancora dei link senza «co»", () => {
    expect(coFromLeadHash("#lead-12")).toBe(12);
    expect(coFromLeadHash("lead-3")).toBe(3);
    for (const hash of ["#lead-0", "#lead-012", "#lead-100000", "#lead-1x", "#co-1", ""])
      expect(coFromLeadHash(hash)).toBeNull();
  });

  it("lookbook, dati e regole", () => {
    expect(partnerLookbookHref("negozi")).toBe("/partner/lookbook/negozi");
    expect(() => partnerLookbookHref("altro" as "negozi")).toThrow(RangeError);
    expect(PARTNER_DATA_PATH).toBe("/partner/dati");
    expect(PARTNER_RULES_PATH).toBe("/partner/regole");
  });
});
