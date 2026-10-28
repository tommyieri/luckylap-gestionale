import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { hasControlCharacters } from "../partner/model";
import {
  parsePartnerAssistantChoice,
  partnerAssistantDecision,
  partnerAssistantEventMerch,
  partnerAssistantRequest,
} from "./choice";
import type { PartnerAssistantChoice, PartnerAssistantContactKind } from "./types";

// Solo dati sintetici: domini example.test, nomi inventati.
const today = "2026-10-27";

/** La risposta dell'estrazione: le chiavi snake_case dell'Appendice C, senza la richiesta. */
const validJson = {
  contact_kind: "club",
  porsche_community: true,
  reason_it: "Club con un raduno in primavera",
  write_now: true,
  write_on: "",
  recipient_email: "segreteria@pc-nord.example.test",
  recipient_email_source: "https://pc-nord.example.test/contatti",
  recipient_email_published_by_org: true,
  person_name: "Ada Prova",
  person_title: "Dr.",
  language: "en",
  register: "you",
  swiss: false,
  timezone: "Europe/London",
  fact_text: "Il club ha festeggiato trent'anni con un raduno",
  fact_date: "2026-09-12",
  fact_source: "https://pc-nord.example.test/news",
  event_name: "",
  event_starts_on: "",
  event_city: "",
  event_country: "",
  event_reachable: false,
  notes_it: "Segreteria aperta il martedì",
};
/** La stessa scelta, in camelCase, come la restituisce la lettura. */
const validChoice = {
  contactKind: "club",
  porscheCommunity: true,
  reasonIt: "Club con un raduno in primavera",
  writeNow: true,
  writeOn: "",
  recipientEmail: "segreteria@pc-nord.example.test",
  recipientEmailSource: "https://pc-nord.example.test/contatti",
  recipientEmailPublishedByOrg: true,
  personName: "Ada Prova",
  personTitle: "Dr.",
  language: "en",
  register: "you",
  swiss: false,
  timezone: "Europe/London",
  factText: "Il club ha festeggiato trent'anni con un raduno",
  factDate: "2026-09-12",
  factSource: "https://pc-nord.example.test/news",
  eventName: "",
  eventStartsOn: "",
  eventCity: "",
  eventCountry: "",
  eventReachable: false,
  notesIt: "Segreteria aperta il martedì",
} satisfies Omit<PartnerAssistantChoice, "request">;
const club: PartnerAssistantChoice = { ...validChoice, request: "merch_cobranding" };
/** Evento raggiungibile: stand. */
const ev: PartnerAssistantChoice = {
  ...club,
  contactKind: "evento",
  porscheCommunity: false,
  language: "it",
  register: "voi",
  timezone: "Europe/Rome",
  eventName: "Fiera Sintetica",
  eventStartsOn: "2026-11-17",
  eventCity: "Milano",
  eventCountry: "Italia",
  eventReachable: true,
  request: "stand_evento",
};
/** Evento lontano: magliette co-firmate. */
const farEvent: PartnerAssistantChoice = {
  ...ev,
  eventCity: "Austin",
  eventCountry: "Stati Uniti",
  eventReachable: false,
  request: "merch_cobranding",
};

describe("parsePartnerAssistantChoice", () => {
  it("scelta valida: la scelta in camelCase, senza la richiesta", () => {
    expect(parsePartnerAssistantChoice(validJson)).toEqual(validChoice);
  });

  it("fuso vuoto è ammesso", () => {
    expect(parsePartnerAssistantChoice({ ...validJson, timezone: "" })).toEqual({
      ...validChoice,
      timezone: "",
    });
  });

  it("email, fonti e date vuote sono ammesse", () => {
    const empty = {
      ...validJson,
      recipient_email: "",
      recipient_email_source: "",
      recipient_email_published_by_org: false,
      fact_date: "",
      fact_source: "",
    };
    expect(parsePartnerAssistantChoice(empty)).not.toBeNull();
  });

  it("evento con le date e un fuso con l'ora legale", () => {
    const event = {
      ...validJson,
      contact_kind: "evento",
      write_now: false,
      write_on: "2027-03-01",
      timezone: "America/Chicago",
      event_name: "Raduno Sintetico",
      event_starts_on: "2027-05-14",
      event_city: "Austin",
      event_country: "Stati Uniti",
    };
    expect(parsePartnerAssistantChoice(event)).toMatchObject({
      contactKind: "evento",
      writeOn: "2027-03-01",
      timezone: "America/Chicago",
      eventStartsOn: "2027-05-14",
    });
  });

  it("ammette tab e a capo nei testi, e 2000 caratteri contati come il database", () => {
    expect(
      parsePartnerAssistantChoice({ ...validJson, notes_it: "Riga uno\n\tRiga due\r\n" }),
    ).not.toBeNull();
    expect(
      parsePartnerAssistantChoice({ ...validJson, notes_it: "🏁".repeat(2000) }),
    ).not.toBeNull();
    expect(parsePartnerAssistantChoice({ ...validJson, notes_it: "🏁".repeat(2001) })).toBeNull();
  });

  it("rifiuta proprio i caratteri che rifiuta private.partner_text (lo specchio di model.ts)", () => {
    const codes = Array.from({ length: 0xa0 }, (_, code) => String.fromCodePoint(code));
    const rejected = codes.filter(
      (char) => parsePartnerAssistantChoice({ ...validJson, reason_it: `a${char}b` }) === null,
    );
    expect(rejected).toEqual(codes.filter(hasControlCharacters));
    // Non è un confronto vuoto: tab, a capo e ritorno a capo passano, DEL e i C0 no.
    expect(rejected).toHaveLength(30);
    expect(rejected).not.toContain("\t");
    expect(rejected).toContain("\u007f");
  });

  it.each([
    ["timezone", "Mars/Base"],
    ["timezone", " Europe/Rome"],
    // Intl accetta gli scarti, ma il fuso è un nome IANA.
    ["timezone", "+01:00"],
    ["write_on", "27/10/2026"],
    ["write_on", "2026-02-30"],
    ["event_starts_on", "2026-11"],
    // Fuori dall'intervallo di private.partner_date: il database rifiuterebbe la scelta.
    ["fact_date", "1998-05-01"],
    ["recipient_email", "non-una-email"],
    ["recipient_email", "Segreteria <segreteria@pc-nord.example.test>"],
    ["recipient_email", " segreteria@pc-nord.example.test"],
    ["recipient_email_source", "pc-nord.example.test/contatti"],
    ["fact_source", "javascript:alert(1)"],
    ["fact_source", "ftp://pc-nord.example.test/news"],
    ["fact_source", "https://pc-nord.example.test/news con spazi"],
    ["contact_kind", "altro"],
    ["language", "pt"],
    ["register", "tu"],
    ["porsche_community", "sì"],
    ["write_now", 1],
    ["notes_it", null],
    ["reason_it", "Campanello\u0007"],
    ["notes_it", "Zero\u0000"],
    ["person_name", "Ada \ud800"],
  ])("rifiuta %s = %j", (key, value) => {
    expect(parsePartnerAssistantChoice({ ...validJson, [key]: value })).toBeNull();
  });

  it("chiavi esatte: niente chiavi in più, nemmeno la richiesta, e nessuna mancante", () => {
    expect(parsePartnerAssistantChoice({ ...validJson, request: "collab_capsule" })).toBeNull();
    expect(parsePartnerAssistantChoice({ ...validJson, extra: "" })).toBeNull();
    const { notes_it: _, ...missing } = validJson;
    expect(parsePartnerAssistantChoice(missing)).toBeNull();
    expect(parsePartnerAssistantChoice(JSON.parse('{"__proto__": {}}'))).toBeNull();
  });

  it.each([[null], [[]], ["{}"], [42], [undefined]])("rifiuta %j", (value) => {
    expect(parsePartnerAssistantChoice(value)).toBeNull();
  });
});

describe("partnerAssistantRequest", () => {
  it("evento non raggiungibile: merch co-firmato", () => {
    expect(partnerAssistantRequest({ ...ev, eventReachable: false })).toBe("merch_cobranding");
  });

  it("evento raggiungibile: stand", () => {
    expect(partnerAssistantRequest(ev)).toBe("stand_evento");
  });

  it.each<[PartnerAssistantContactKind, string]>([
    ["club", "merch_cobranding"],
    ["brand", "collab_capsule"],
    ["media", "collab_capsule"],
    ["negozio", "vendita_negozio"],
  ])("%s → %s", (kind, request) => {
    expect(partnerAssistantRequest({ ...validChoice, contactKind: kind })).toBe(request);
    // Raggiungibile o no conta solo per gli eventi.
    expect(
      partnerAssistantRequest({ ...validChoice, contactKind: kind, eventReachable: true }),
    ).toBe(request);
  });
});

describe("partnerAssistantEventMerch", () => {
  it("null se il contatto non è un evento", () => {
    expect(partnerAssistantEventMerch(club, today)).toBeNull();
    expect(partnerAssistantEventMerch({ ...club, eventStartsOn: "2027-05-14" }, today)).toBeNull();
  });

  it("stand a tre settimane: niente maglietta", () => {
    expect(partnerAssistantEventMerch({ ...ev, eventStartsOn: "2026-11-17" }, today)).toBe(
      "Maglietta co-firmata: non proporla",
    );
  });

  it("stand a due mesi: maglietta", () => {
    expect(partnerAssistantEventMerch({ ...ev, eventStartsOn: "2026-12-27" }, today)).toBe(
      "Maglietta co-firmata: puoi proporla",
    );
  });

  it.each([
    // 31 giorni sono ancora un mese; 32 sono più di un mese.
    ["2026-11-27", "Maglietta co-firmata: non proporla"],
    ["2026-11-28", "Maglietta co-firmata: puoi proporla"],
    ["", "Maglietta co-firmata: non proporla"],
    ["2026-10-20", "Maglietta co-firmata: non proporla"],
  ])("stand con l'evento il %j: %s", (eventStartsOn, line) => {
    expect(partnerAssistantEventMerch({ ...ev, eventStartsOn }, today)).toBe(line);
  });

  it.each([
    ["2026-12-27", "Maglietta co-firmata: puoi proporla"],
    ["2026-11-28", "Maglietta co-firmata: puoi proporla"],
    ["", "Maglietta co-firmata: puoi proporla"],
    ["2026-11-27", "Maglietta co-firmata: per la prossima edizione"],
    ["2026-11-17", "Maglietta co-firmata: per la prossima edizione"],
  ])("evento lontano il %j: %s", (eventStartsOn, line) => {
    expect(partnerAssistantEventMerch({ ...farEvent, eventStartsOn }, today)).toBe(line);
  });

  it("conta i giorni dalla data che riceve", () => {
    expect(partnerAssistantEventMerch({ ...ev, eventStartsOn: "2026-12-27" }, "2026-11-30")).toBe(
      "Maglietta co-firmata: non proporla",
    );
  });
});

describe("partnerAssistantDecision", () => {
  const noFact = { ...validChoice, factText: "" };

  it("senza fatto: blocca", () => {
    expect(partnerAssistantDecision(noFact, today)).toEqual({
      kind: "blocca",
      reason: "fatto_mancante",
    });
    expect(partnerAssistantDecision({ ...validChoice, factText: "  \n" }, today)).toEqual({
      kind: "blocca",
      reason: "fatto_mancante",
    });
  });

  it("senza fuso: blocca", () => {
    expect(partnerAssistantDecision({ ...validChoice, timezone: "" }, today)).toEqual({
      kind: "blocca",
      reason: "fuso_mancante",
    });
  });

  it("senza fatto e senza fuso: prima il fatto", () => {
    expect(partnerAssistantDecision({ ...noFact, timezone: "" }, today)).toEqual({
      kind: "blocca",
      reason: "fatto_mancante",
    });
  });

  it("più avanti: attendi fino al giorno indicato", () => {
    const later = { ...validChoice, writeNow: false, writeOn: "2027-03-01" };
    expect(partnerAssistantDecision(later, today)).toEqual({
      kind: "attendi",
      writeOn: "2027-03-01",
    });
  });

  // Il fatto e il fuso servono per scrivere, non per aspettare: a quel giorno la ricerca si rifà.
  it.each([
    ["senza fatto", { factText: "" }],
    ["senza fuso", { timezone: "" }],
    ["senza fatto e senza fuso", { factText: "", timezone: "" }],
  ])("%s ma da scrivere più avanti: attendi", (_, missing) => {
    const later = { ...validChoice, ...missing, writeNow: false, writeOn: "2027-03-01" };
    expect(partnerAssistantDecision(later, today)).toEqual({
      kind: "attendi",
      writeOn: "2027-03-01",
    });
  });

  it("senza fatto e con un giorno già passato: blocca", () => {
    expect(
      partnerAssistantDecision({ ...noFact, writeNow: false, writeOn: "2026-10-01" }, today),
    ).toEqual({ kind: "blocca", reason: "fatto_mancante" });
  });

  it.each([
    ["adesso", { writeNow: true, writeOn: "" }],
    ["adesso, anche con un giorno", { writeNow: true, writeOn: "2027-03-01" }],
    ["non adesso ma senza giorno", { writeNow: false, writeOn: "" }],
    ["non adesso con il giorno di oggi", { writeNow: false, writeOn: today }],
    ["non adesso con un giorno passato", { writeNow: false, writeOn: "2026-10-01" }],
  ])("%s: scrivi", (_, when) => {
    expect(partnerAssistantDecision({ ...validChoice, ...when }, today)).toEqual({
      kind: "scrivi",
    });
  });
});
