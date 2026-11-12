import { describe, expect, it } from "vitest";
import {
  isPartnerFollowupMessageId,
  parsePartnerFollowupIdentification,
} from "./followup-identification";

const known = "<known@brand.example.test>";

describe("identificatori IMAP dei solleciti Partner", () => {
  it("legge CFWS esterno, conserva l'ordine e non include gli ID nel commento", () => {
    expect(
      parsePartnerFollowupIdentification(
        `(nota (${known})) <early@brand.example.test>\r\n\t${known}`,
        "references",
      ),
    ).toEqual({ ids: ["<early@brand.example.test>", known], form: "standard" });
  });

  it("accetta una frase legacy in In-Reply-To e References, senza usarla come ID", () => {
    expect(
      parsePartnerFollowupIdentification(
        `I answered your "message ${known}" on Tue.`,
        "in-reply-to",
      ),
    ).toEqual({ ids: [], form: "legacy_phrase" });
    expect(
      parsePartnerFollowupIdentification(`The message ${known} was received`, "references"),
    ).toEqual({ ids: [known], form: "legacy_phrase" });
    expect(parsePartnerFollowupIdentification("The message was received", "message-id")).toBeNull();
  });

  it("canonizza quote e CFWS interno senza perdere il riferimento noto", () => {
    expect(
      parsePartnerFollowupIdentification(
        '<"known" (local) @ brand . (dns) example . test>',
        "in-reply-to",
      ),
    ).toEqual({ ids: [known], form: "legacy_cfws" });
    expect(
      parsePartnerFollowupIdentification('<"kno\\wn"@brand.example.test>', "message-id"),
    ).toEqual({ ids: [known], form: "legacy_cfws" });
  });

  it("identifica un addr-spec bare esatto come forma distinta", () => {
    expect(
      parsePartnerFollowupIdentification(" \tknown@brand.example.test ", "references"),
    ).toEqual({ ids: [known], form: "bare" });
    expect(
      parsePartnerFollowupIdentification("Reply to known@brand.example.test", "references"),
    ).toBeNull();
  });

  it.each([
    "(only-comment)",
    "<>",
    "<known@>",
    "<known@brand.example.test",
    "<known@brand.example.test> (unfinished",
    '<"space in left"@brand.example.test>',
    `${known}, invalid fragment`,
    `${known}\n injected`,
    `x${"x".repeat(65_536)}`,
  ])("mantiene incerta una forma non rappresentabile %#", (value) => {
    expect(parsePartnerFollowupIdentification(value, "references")).toBeNull();
  });

  it("preserva catene di riferimenti lunghe o ripetute per il controllo prudente", () => {
    const ids = Array.from({ length: 65 }, (_, i) => `<m${i}@brand.example.test>`);
    ids.push(ids[0]);
    expect(parsePartnerFollowupIdentification(ids.join(" "), "references")).toEqual({
      ids,
      form: "standard",
    });
  });

  it("limita Message-ID a un ID e nega code point non ASCII al matcher pubblico", () => {
    expect(
      parsePartnerFollowupIdentification(`${known} <second@brand.example.test>`, "message-id"),
    ).toBeNull();
    expect(isPartnerFollowupMessageId(known)).toBe(true);
    expect(isPartnerFollowupMessageId("<astrale-😀@brand.example.test>")).toBe(false);
    expect(
      parsePartnerFollowupIdentification(
        "(réception) <astrale-😀@brand.example.test>",
        "message-id",
      ),
    ).toEqual({ ids: ["<astrale-😀@brand.example.test>"], form: "standard" });
    const longId = `<${"x".repeat(260)}@brand.example.test>`;
    expect(isPartnerFollowupMessageId(longId)).toBe(false);
    expect(parsePartnerFollowupIdentification(longId, "message-id")).toEqual({
      ids: [longId],
      form: "standard",
    });
  });
});
