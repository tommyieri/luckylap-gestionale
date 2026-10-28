import { describe, expect, it } from "vitest";
import {
  partnerAssistantBodyDates,
  partnerAssistantSendRecheck,
  type PartnerAssistantRecheckChoice,
} from "./send-recheck";
import type { PartnerAssistantRequest } from "./types";

// Solo dati sintetici: nessun nome, indirizzo o testo vero.
type RecheckInput = Parameters<typeof partnerAssistantSendRecheck>[0];

const BODY = "Ciao, siamo LuckyLap. Ci piacerebbe conoscervi.";
const DRAFT_AT = "2026-10-28T09:00:00Z";

const club: RecheckInput = {
  choice: { contactKind: "club", request: "merch_cobranding", eventStartsOn: "" },
  body: BODY,
  draftCreatedAt: DRAFT_AT,
};
const withBody = (input: RecheckInput, body: string): RecheckInput => ({ ...input, body });
const event = (eventStartsOn: string, request: PartnerAssistantRequest): RecheckInput => ({
  choice: { contactKind: "evento", request, eventStartsOn } satisfies PartnerAssistantRecheckChoice,
  body: BODY,
  draftCreatedAt: DRAFT_AT,
});

describe("partnerAssistantBodyDates", () => {
  it.each([
    ["il 19 novembre", "2026-11-19"],
    ["am 19. November", "2026-11-19"],
    ["on 19th November 2026", "2026-11-19"],
    ["November 19, 2026", "2026-11-19"],
    ["el 19 de noviembre", "2026-11-19"],
    ["le 19 novembre", "2026-11-19"],
    ["2027-01-15", "2027-01-15"],
    ["19/11/2026", "2026-11-19"],
    ["19.11.2026", "2026-11-19"],
    ["il 3 gennaio", "2027-01-03"],
    ["am 5. Maerz", "2027-03-05"],
  ])("%s → %s", (t, d) => expect(partnerAssistantBodyDates(`… ${t} …`, "2026-10-28")).toEqual([d]));

  it("nessuna data, o una che non esiste: []", () => {
    expect(partnerAssistantBodyDates("Ciao, siamo LuckyLap.", "2026-10-28")).toEqual([]);
    expect(partnerAssistantBodyDates("il 31 novembre", "2026-10-28")).toEqual([]);
  });

  it("le altre forme dell'elenco: anno con «de», suffissi, mesi con accenti e maiuscole", () => {
    const body = [
      "el 2 de diciembre de 2026",
      "le 1er décembre",
      "il 1° marzo",
      "el 7º de mayo",
      "am 3. MÄRZ",
      "on the 22nd of nothing, December 23rd",
      "le 4 février 2027",
      "il 5 agosto 2027",
    ].join(" · ");
    expect(partnerAssistantBodyDates(body, "2026-10-28")).toEqual([
      "2026-12-02",
      "2026-12-01",
      "2027-03-01",
      "2027-05-07",
      "2027-03-03",
      "2026-12-23",
      "2027-02-04",
      "2027-08-05",
    ]);
  });

  it("le date nell'ordine del testo, una volta per ogni citazione, senza sovrapposizioni", () => {
    expect(
      partnerAssistantBodyDates(
        "Dal 3 gennaio 15 persone, poi il 2027-02-01 e di nuovo il 3 gennaio.",
        "2026-10-28",
      ),
    ).toEqual(["2027-01-03", "2027-02-01", "2027-01-03"]);
  });

  it("numeri che non sono date non contano", () => {
    expect(
      partnerAssistantBodyDates(
        "Nel 2026 novembre è vicino: 120 novembre, 19.30, v1.2.3, 11/19/2026, novembre 2027.",
        "2026-10-28",
      ),
    ).toEqual([]);
  });

  // Correzione giro 1: forme che Claude scrive davvero e che il primo giro non vedeva.
  it.each([
    ["on the 19th of November", ["2026-11-19"]],
    ["the 19th of November, 2026", ["2026-11-19"]],
    ["il 19 novembre del 2026", ["2026-11-19"]],
    ["el 19 de noviembre del 2026", ["2026-11-19"]],
    ["dal 19 al 21 novembre", ["2026-11-19", "2026-11-21"]],
    ["19-21 novembre", ["2026-11-19", "2026-11-21"]],
    ["19–21 novembre 2026", ["2026-11-19", "2026-11-21"]],
    ["am 19.-21. November", ["2026-11-19", "2026-11-21"]],
    ["vom 19. bis 21. November", ["2026-11-19", "2026-11-21"]],
    ["il 19 e 21 novembre", ["2026-11-19", "2026-11-21"]],
    ["il 19, 20 e 21 novembre", ["2026-11-19", "2026-11-20", "2026-11-21"]],
    ["du 19 au 21 novembre", ["2026-11-19", "2026-11-21"]],
    ["del 19 al 21 de noviembre", ["2026-11-19", "2026-11-21"]],
    ["the 19th–21st of November", ["2026-11-19", "2026-11-21"]],
    ["19 and 21 November 2027", ["2027-11-19", "2027-11-21"]],
    ["dal 30 dicembre al 2 gennaio", ["2026-12-30", "2027-01-02"]],
    ["19/11", ["2026-11-19"]],
    ["lunedì 19/11", ["2026-11-19"]],
    ["Montag, den 19.11.", ["2026-11-19"]],
    ["il 3/1", ["2027-01-03"]],
    ["19.11.26", ["2026-11-19"]],
    ["19/11/26", ["2026-11-19"]],
    ["Nov. 19", ["2026-11-19"]],
    ["Sept. 3, 2027", ["2027-09-03"]],
    ["19 Dec. 2026", ["2026-12-19"]],
    ["el 1ª de mayo", ["2027-05-01"]],
    ["2026-11-19T10:00", ["2026-11-19"]],
    ["mar. 19 novembre", ["2026-11-19"]],
    ["19/21 novembre", ["2026-11-19", "2026-11-21"]],
  ])("giro 1: %s → %j", (t, d) =>
    expect(partnerAssistantBodyDates(`… ${t} …`, "2026-10-28")).toEqual(d),
  );

  it("giro 1: i numeri puntati e le migliaia non diventano date senza anno", () => {
    expect(
      partnerAssistantBodyDates(
        "v1.2.3, 1.2.3, 5.000 persone, 1.500 km, 19.30, 12.50 €, 11/19/2026, 19.11.202, Nov 19.",
        "2026-10-28",
      ),
    ).toEqual([]);
  });

  // Correzione giro 2: il primo giorno di un intervallo che finisce con una data numerica, o con un
  // giorno della settimana o un articolo davanti al giorno dopo.
  it.each([
    ["dal 19 al 21/11", ["2026-11-19", "2026-11-21"]],
    ["19-21/11", ["2026-11-19", "2026-11-21"]],
    ["19 e 21/11/2026", ["2026-11-19", "2026-11-21"]],
    ["19.-21.11.2026", ["2026-11-19", "2026-11-21"]],
    ["vom 19. bis 21.11.", ["2026-11-19", "2026-11-21"]],
    ["19-21/11/26", ["2026-11-19", "2026-11-21"]],
    ["il 19, 20 e 21/11", ["2026-11-19", "2026-11-20", "2026-11-21"]],
    ["dal 30/12 al 2/1", ["2026-12-30", "2027-01-02"]],
    ["sabato 14 e domenica 15 novembre", ["2026-11-14", "2026-11-15"]],
    ["il 19 o il 21 novembre", ["2026-11-19", "2026-11-21"]],
    ["19th and the 21st of November", ["2026-11-19", "2026-11-21"]],
    ["Samstag, 14. und Sonntag, 15. November", ["2026-11-14", "2026-11-15"]],
    ["samedi 14 et dimanche 15 novembre", ["2026-11-14", "2026-11-15"]],
    ["el sábado 14 y el domingo 15 de noviembre", ["2026-11-14", "2026-11-15"]],
    ["l'8 e l'11 novembre", ["2026-11-08", "2026-11-11"]],
    ["sabato 14 e domenica 15/11", ["2026-11-14", "2026-11-15"]],
  ])("giro 2: %s → %j", (t, d) =>
    expect(partnerAssistantBodyDates(`… ${t} …`, "2026-10-28")).toEqual(d),
  );

  it("giro 2: orari, numeri puntati e date all'americana non diventano intervalli", () => {
    expect(
      partnerAssistantBodyDates(
        "dalle 10.30 alle 12.30, 10-12.30, 11/19/2026, 19.-21.11.202, 1-2.3.4, Nov 19 and 21.",
        "2026-10-28",
      ),
    ).toEqual([]);
  });

  it("senza anno: lo stesso giorno della bozza resta in quell'anno", () =>
    expect(partnerAssistantBodyDates("il 28 ottobre", "2026-10-28")).toEqual(["2026-10-28"]));
});

describe("partnerAssistantSendRecheck", () => {
  it("data citata passata all'invio: bozza_scaduta", () =>
    expect(partnerAssistantSendRecheck(withBody(club, "… il 19 novembre …"), "2026-11-20")).toEqual(
      { ok: false, reason: "bozza_scaduta" },
    ));

  it("data citata uguale al giorno d'invio: bozza_scaduta", () =>
    expect(partnerAssistantSendRecheck(withBody(club, "… il 19 novembre …"), "2026-11-19").ok).toBe(
      false,
    ));

  it("evento già iniziato: bozza_scaduta", () =>
    expect(
      partnerAssistantSendRecheck(event("2026-11-09", "merch_cobranding"), "2026-11-10").ok,
    ).toBe(false));

  it("evento che inizia il giorno dell'invio: bozza_scaduta", () =>
    expect(partnerAssistantSendRecheck(event("2027-03-01", "stand_evento"), "2027-03-01")).toEqual({
      ok: false,
      reason: "bozza_scaduta",
    }));

  it("evento a più di un mese alla bozza, a un mese o meno all'invio: la riga cambia, bozza_scaduta", () =>
    expect(
      partnerAssistantSendRecheck(
        { ...event("2026-12-05", "merch_cobranding"), draftCreatedAt: "2026-10-20T09:00:00Z" },
        "2026-11-10",
      ).ok,
    ).toBe(false));

  it("evento lontano e date future: ok", () =>
    expect(
      partnerAssistantSendRecheck(
        { ...event("2027-03-01", "stand_evento"), draftCreatedAt: "2026-10-28T09:00:00Z" },
        "2026-10-29",
      ),
    ).toEqual({ ok: true }));

  it("club senza evento e senza date nel corpo: ok anche mesi dopo", () =>
    expect(partnerAssistantSendRecheck(club, "2027-03-10")).toEqual({ ok: true }));

  it("giorno della bozza contato a Roma: alle 23:30 UTC del 28 è già il 29, e «28 ottobre» è dell'anno dopo", () =>
    expect(
      partnerAssistantSendRecheck(
        { ...withBody(club, "… il 28 ottobre …"), draftCreatedAt: "2026-10-28T23:30:00Z" },
        "2026-10-30",
      ),
    ).toEqual({ ok: true }));

  it("una data passata su più date future basta per scartare", () =>
    expect(
      partnerAssistantSendRecheck(
        withBody(club, "Il 3 gennaio e il 19 novembre, poi il 2027-05-01."),
        "2026-11-25",
      ).ok,
    ).toBe(false));

  it("giro 1: il primo giorno di un intervallo già passato all'invio basta per scartare", () => {
    expect(
      partnerAssistantSendRecheck(
        withBody(club, "Ci vediamo dal 19 al 21 novembre."),
        "2026-11-20",
      ),
    ).toEqual({ ok: false, reason: "bozza_scaduta" });
    expect(
      partnerAssistantSendRecheck(withBody(club, "Ci vediamo il 19/11, alle 10."), "2026-11-20").ok,
    ).toBe(false);
  });

  it("giro 2: il primo giorno di un intervallo numerico o con il giorno della settimana basta per scartare", () => {
    expect(
      partnerAssistantSendRecheck(withBody(club, "Ci vediamo dal 19 al 21/11."), "2026-11-20"),
    ).toEqual({ ok: false, reason: "bozza_scaduta" });
    expect(
      partnerAssistantSendRecheck(
        withBody(club, "Ci vediamo sabato 14 e domenica 15 novembre."),
        "2026-11-14",
      ),
    ).toEqual({ ok: false, reason: "bozza_scaduta" });
    expect(
      partnerAssistantSendRecheck(withBody(club, "Ci vediamo dal 19 al 21/11."), "2026-11-18"),
    ).toEqual({ ok: true });
  });

  it("giro 1: una data già passata alla bozza, con l'anno, non scade (il fatto del complimento)", () => {
    for (const fact of [
      "Complimenti per il raduno del 12 ottobre 2026.",
      "Complimenti per il raduno del 12/10/2026.",
      "Congratulations on the rally on October 12, 2026.",
    ]) {
      expect(partnerAssistantSendRecheck(withBody(club, fact), "2026-10-28")).toEqual({ ok: true });
      expect(partnerAssistantSendRecheck(withBody(club, fact), "2026-11-05")).toEqual({ ok: true });
    }
  });

  it("giro 1: il giorno stesso della bozza conta ancora, anche con l'anno", () => {
    expect(
      partnerAssistantSendRecheck(withBody(club, "… il 28 ottobre 2026 …"), "2026-10-28").ok,
    ).toBe(false);
    expect(partnerAssistantSendRecheck(withBody(club, "… il 28/10/2026 …"), "2026-10-29").ok).toBe(
      false,
    );
  });

  it("giro 1: un fatto passato non salva una data futura alla bozza e passata all'invio", () =>
    expect(
      partnerAssistantSendRecheck(
        withBody(club, "Complimenti per il 12 ottobre 2026. Ci vediamo il 19 novembre 2026."),
        "2026-11-20",
      ),
    ).toEqual({ ok: false, reason: "bozza_scaduta" }));

  it("giorno d'invio o momento della bozza non validi: lancia, niente ok", () => {
    expect(() => partnerAssistantSendRecheck(club, "")).toThrow(RangeError);
    expect(() => partnerAssistantSendRecheck(club, "2026-11-31")).toThrow(RangeError);
    expect(() =>
      partnerAssistantSendRecheck({ ...club, draftCreatedAt: "ieri" }, "2026-10-29"),
    ).toThrow(RangeError);
  });
});
