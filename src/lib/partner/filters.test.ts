import { describe, expect, it } from "vitest";
import { partnerFixtureId, partnerSummaryFixture } from "./fixtures";
import {
  DEFAULT_PARTNER_VIEW,
  agreedCount,
  buildPartnerIndex,
  coQuery,
  filterPartners,
  parsePartnerView,
  partnerSearchMatch,
  partnerViewHref,
  partnerViewQuery,
  periodCounts,
  readRememberedView,
  rememberView,
  sectionCounts,
  totalsLine,
  upcomingEventStart,
  viewShowing,
  withoutFilters,
  type PartnerFilterContext,
  type PartnerView,
} from "./filters";
import type { PartnerBlock, PartnerContactLink, PartnerSection, PartnerSummary } from "./model";

// Spec 02 §5.3: filtri, conteggi e stato nell'indirizzo. Liste sintetiche.
const TODAY = "2026-10-22";
const ME = partnerFixtureId(901);
const OTHER = partnerFixtureId(902);

const list: PartnerSummary[] = [
  partnerSummaryFixture({
    co: 1,
    sections: ["vendita", "collab"],
    stage: "contattato",
    ownerId: ME,
  }),
  partnerSummaryFixture({ co: 2, sections: ["eventi"], stage: "chiuso", ownerId: OTHER }),
  partnerSummaryFixture({ co: 3, sections: ["collab"], stage: "no" }),
  partnerSummaryFixture({
    co: 12,
    name: "Düsseldorf Garage",
    city: "Düsseldorf",
    country: "Germania",
    sections: ["vendita"],
  }),
  partnerSummaryFixture({ co: 20, sections: ["eventi"], contactMonth: "2026-12-01" }),
  partnerSummaryFixture({ co: 21, sections: ["vendita", "eventi"], contactMonth: "2027-07-01" }),
];
const contact = (co: number, kind: "web" | "email", linkValue: string): PartnerContactLink => ({
  id: partnerFixtureId(1000 + co),
  partnerId: partnerFixtureId(co),
  kind,
  linkValue,
  label: "",
  verified: false,
  active: co !== 21,
  position: 0,
  version: 1,
});
const block = (fields: Partial<PartnerBlock>): PartnerBlock => ({
  id: partnerFixtureId(800),
  partnerId: null,
  domain: null,
  reason: "Motivo sintetico.",
  createdAt: "2026-10-20T10:00:00Z",
  ...fields,
});
const index = buildPartnerIndex({
  contacts: [
    contact(12, "web", "https://www.blocked.example.test/negozio"),
    contact(21, "email", "info@other.example.test"),
  ],
  differences: [
    {
      id: partnerFixtureId(700),
      partnerId: partnerFixtureId(20),
      origin: "file",
      field: "stage",
      variantId: null,
      contactId: null,
    },
    // Una differenza sui testi dei vecchi «Messaggi pronti»: non conta.
    {
      id: partnerFixtureId(701),
      partnerId: partnerFixtureId(1),
      origin: "research",
      field: "message",
      variantId: partnerFixtureId(200),
      contactId: null,
    },
  ],
  blocks: [
    block({ id: partnerFixtureId(801), partnerId: partnerFixtureId(3) }),
    block({ id: partnerFixtureId(802), domain: "blocked.example.test" }),
  ],
});
const context: PartnerFilterContext = { index, today: TODAY, memberId: ME };
const view = (fields: Partial<PartnerView>): PartnerView => ({
  ...DEFAULT_PARTNER_VIEW,
  ...fields,
});
const cos = (fields: Partial<PartnerView>) =>
  filterPartners(list, view(fields), context).map((p) => p.co);

describe("filtri della lista", () => {
  it("per sezione, nel periodo scelto e in ordine di CO", () => {
    expect(cos({ sezione: "tutti" })).toEqual([1, 12]);
    expect(cos({ sezione: "vendita", stato: "tutti" })).toEqual([1, 12]);
    expect(cos({ sezione: "eventi", stato: "tutti" })).toEqual([2]);
    expect(cos({ sezione: "collab", stato: "tutti" })).toEqual([1, 3]);
    expect(cos({ periodo: 2, stato: "tutti" })).toEqual([20]);
    expect(cos({ periodo: 5, sezione: "eventi" })).toEqual([21]);
  });

  it("«da fare» esclude Accordo fatto e Non interessato; uno stato preciso tiene solo quello", () => {
    expect(cos({ stato: "da_fare" })).toEqual([1, 12]);
    expect(cos({ stato: "tutti" })).toEqual([1, 2, 3, 12]);
    expect(cos({ stato: "chiuso" })).toEqual([2]);
    expect(cos({ stato: "no" })).toEqual([3]);
    expect(cos({ stato: "contattato" })).toEqual([1]);
  });

  it("«non contattare» per contatto e per dominio, anche di un recapito rimosso", () => {
    expect(cos({ stato: "non_contattare" })).toEqual([3, 12]);
    expect(index.blocks.get(partnerFixtureId(12))?.domain).toBe("blocked.example.test");
    // Il recapito rimosso di CO 21 non è bloccato: il suo dominio non è nella lista.
    expect(index.blocks.has(partnerFixtureId(21))).toBe(false);
    const removed = buildPartnerIndex({
      contacts: [contact(21, "email", "info@other.example.test")],
      differences: [],
      blocks: [block({ domain: "other.example.test" })],
    });
    expect(removed.blocks.has(partnerFixtureId(21))).toBe(true);
  });

  it("«da controllare» mostra i contatti con differenze aperte, non quelle sui testi vecchi", () => {
    expect(cos({ periodo: 2, stato: "da_controllare" })).toEqual([20]);
    // CO 1 ha solo una differenza `message`: non c'è più un posto dove risolverla.
    expect(cos({ stato: "da_controllare" })).toEqual([]);
    expect(index.differences.has(partnerFixtureId(1))).toBe(false);
    expect([...index.differences.keys()]).toEqual([partnerFixtureId(20)]);
  });

  it("«Seguito da»: io, nessuno, un membro", () => {
    expect(cos({ chi: "io", stato: "tutti" })).toEqual([1]);
    expect(cos({ chi: "nessuno", stato: "tutti" })).toEqual([3, 12]);
    expect(cos({ chi: OTHER, stato: "tutti" })).toEqual([2]);
    expect(
      filterPartners(list, view({ chi: "io" }), { ...context, memberId: null }).map((p) => p.co),
    ).toEqual([]);
  });

  it("ricerca per nome, città, paese, tipo e CO, senza accenti", () => {
    expect(cos({ q: "dusseldorf" })).toEqual([12]);
    expect(cos({ q: "GERMANIA" })).toEqual([12]);
    for (const q of ["12", "CO 12", "CO012", "co 012"]) expect(cos({ q })).toEqual([12]);
    expect(coQuery("CO012")).toBe(12);
    expect(coQuery("negozio 12")).toBeNull();
    expect(partnerSearchMatch(list[0], "")).toBe(true);
    expect(cos({ q: "nessun risultato" })).toEqual([]);
  });

  it("i conteggi delle celle applicano tutti i filtri tranne il periodo", () => {
    expect(periodCounts(list, view({}), context)).toEqual({ 1: 2, 2: 1, 3: 0, 4: 0, 5: 1 });
    expect(periodCounts(list, view({ periodo: 3, sezione: "eventi" }), context)).toEqual({
      1: 0,
      2: 1,
      3: 0,
      4: 0,
      5: 1,
    });
    expect(periodCounts(list, view({ stato: "tutti", chi: "nessuno" }), context)).toEqual({
      1: 2,
      2: 1,
      3: 0,
      4: 0,
      5: 1,
    });
  });

  it("sezioni contate su tutti i contatti, con la riga sotto il titolo", () => {
    const counts = sectionCounts(list);
    expect(counts).toEqual({ tutti: 6, vendita: 3, eventi: 3, collab: 2, club: 0 });
    expect(totalsLine({ tutti: 207, vendita: 119, eventi: 80, collab: 73, club: 0 })).toBe(
      "207 contatti · 119 Vendita · 80 Eventi · 73 Collab · 0 Club. Lo stesso posto può stare in più sezioni.",
    );
  });

  it("la sezione Club si conta e si filtra come le altre", () => {
    const club = { ...list[0], co: 99, sections: ["eventi", "club"] as PartnerSection[] };
    const counts = sectionCounts([...list, club]);
    expect(counts.club).toBe(1);
    expect(counts.eventi).toBe(4);
    expect(parsePartnerView({ sezione: "club" }).view.sezione).toBe("club");
    expect(
      filterPartners([...list, club], view({ periodo: 1, sezione: "club" }), context).map(
        (partner) => partner.co,
      ),
    ).toEqual([99]);
  });

  it("un link a un contatto nascosto dai filtri cambia solo ciò che serve", () => {
    const start = view({ periodo: 1, sezione: "vendita", stato: "da_fare", chi: "io", q: "x" });
    expect(viewShowing(start, list[4], context)).toEqual({
      periodo: 2,
      sezione: "tutti",
      stato: "da_fare",
      chi: "tutti",
      q: "",
      co: 20,
      accordi: false,
    });
    expect(viewShowing(view({ sezione: "collab" }), list[2], context)).toMatchObject({
      sezione: "collab",
      stato: "tutti",
      co: 3,
    });
    expect(withoutFilters(start)).toEqual({ ...start, stato: "da_fare", chi: "tutti", q: "" });
  });
});

describe("«Ci siamo»: gli accordi fatti", () => {
  const agreed: PartnerSummary[] = [
    partnerSummaryFixture({ co: 30, stage: "chiuso", contactMonth: "2027-05-01" }),
    partnerSummaryFixture({
      co: 31,
      stage: "chiuso",
      sections: ["eventi"],
      eventStartsOn: "2026-12-05",
      eventEndsOn: "2026-12-06",
    }),
    partnerSummaryFixture({
      co: 32,
      stage: "chiuso",
      sections: ["eventi"],
      eventStartsOn: "2026-11-02",
      eventEndsOn: null,
    }),
    partnerSummaryFixture({
      co: 33,
      stage: "chiuso",
      sections: ["eventi"],
      eventStartsOn: "2026-09-01",
      eventEndsOn: "2026-09-02",
    }),
    partnerSummaryFixture({
      co: 34,
      stage: "trattativa",
      sections: ["eventi"],
      eventStartsOn: "2026-11-01",
    }),
    partnerSummaryFixture({ co: 35, stage: "chiuso", ownerId: ME, name: "Garage Accordo" }),
  ];
  const agreedContext: PartnerFilterContext = {
    index: buildPartnerIndex({ contacts: [], differences: [], blocks: [] }),
    today: TODAY,
    memberId: ME,
  };
  const cos = (fields: Partial<PartnerView>) =>
    filterPartners(agreed, view({ accordi: true, ...fields }), agreedContext).map((p) => p.co);

  it("solo lo stato «Accordo fatto», di ogni periodo, sezione e stato scelto", () => {
    expect(cos({ periodo: 5, sezione: "vendita", stato: "no" })).toEqual([32, 31, 30, 33, 35]);
    expect(agreedCount(agreed)).toBe(5);
  });

  it("prima gli eventi in arrivo per data, poi gli altri per CO (anche gli eventi passati)", () => {
    expect(cos({})).toEqual([32, 31, 30, 33, 35]);
    expect(upcomingEventStart(agreed[2], TODAY)).toBe("2026-11-02");
    expect(upcomingEventStart(agreed[3], TODAY)).toBeNull();
    expect(upcomingEventStart(agreed[3], "2026-09-02")).toBe("2026-09-01");
  });

  it("«Seguito da» e ricerca valgono anche qui", () => {
    expect(cos({ chi: "io" })).toEqual([35]);
    expect(cos({ q: "accordo" })).toEqual([35]);
  });

  it("nell'indirizzo è vista=ci_siamo, andata e ritorno", () => {
    const original = view({ accordi: true, periodo: 2, sezione: "eventi" });
    const query = partnerViewQuery(original);
    expect(query).toBe("periodo=2&sezione=eventi&vista=ci_siamo");
    expect(parsePartnerView(new URLSearchParams(query)).view).toEqual(original);
    expect(parsePartnerView({ vista: "altro" }).view.accordi).toBe(false);
  });

  it("un link a un contatto senza accordo esce da «Ci siamo»", () => {
    const start = view({ accordi: true, q: "nessuno" });
    expect(viewShowing(start, agreed[4], agreedContext)).toMatchObject({
      accordi: false,
      co: 34,
    });
    expect(viewShowing(start, agreed[1], agreedContext)).toMatchObject({
      accordi: true,
      q: "",
      co: 31,
    });
  });
});

describe("stato nell'indirizzo", () => {
  it("legge l'indirizzo completo", () => {
    const { view: parsed, explicit } = parsePartnerView(
      new URLSearchParams("periodo=3&sezione=eventi&stato=da_controllare&chi=io&q=porsche&co=12"),
    );
    expect(parsed).toEqual({
      periodo: 3,
      sezione: "eventi",
      stato: "da_controllare",
      chi: "io",
      q: "porsche",
      co: 12,
      accordi: false,
    });
    expect(explicit).toEqual({ periodo: true, sezione: true });
  });

  it("valori non validi: i default, senza errore", () => {
    const { view: parsed, explicit } = parsePartnerView({
      periodo: "9",
      sezione: "negozi",
      stato: "cancellato",
      chi: "qualcuno",
      q: "   ",
      co: "0",
    });
    expect(parsed).toEqual(DEFAULT_PARTNER_VIEW);
    expect(explicit).toEqual({ periodo: false, sezione: false });
    expect(parsePartnerView({ co: "100000" }).view.co).toBeNull();
    expect(parsePartnerView({ co: "12abc" }).view.co).toBeNull();
    expect(parsePartnerView({ co: ["7", "8"] }).view.co).toBe(7);
  });

  it("«chi» accetta l'id di un membro solo se è nel team", () => {
    expect(parsePartnerView({ chi: OTHER }).view.chi).toBe(OTHER);
    expect(parsePartnerView({ chi: OTHER }, { memberIds: [ME] }).view.chi).toBe("tutti");
    const lettered = "abcdef00-0000-4000-8000-0000000000aa";
    expect(
      parsePartnerView({ chi: lettered.toUpperCase() }, { memberIds: [lettered] }).view.chi,
    ).toBe(lettered);
    expect(parsePartnerView({ chi: "abcdef00" }).view.chi).toBe("tutti");
  });

  it("ricerca ridotta a 80 caratteri e a spazi singoli", () => {
    expect(parsePartnerView({ q: `  porsche   club ${"x".repeat(100)}` }).view.q).toHaveLength(80);
    expect(parsePartnerView({ q: "porsche   club" }).view.q).toBe("porsche club");
  });

  it("andata e ritorno: la query riletta dà la stessa vista", () => {
    const original = view({
      periodo: 4,
      sezione: "collab",
      stato: "risposto",
      chi: ME,
      q: "café 12",
      co: 7,
    });
    const query = partnerViewQuery(original);
    expect(parsePartnerView(new URLSearchParams(query)).view).toEqual(original);
    expect(partnerViewQuery(DEFAULT_PARTNER_VIEW)).toBe("periodo=1&sezione=tutti");
    expect(partnerViewHref(original)).toBe(`/partner?${query}#lead-7`);
    expect(partnerViewHref(DEFAULT_PARTNER_VIEW)).toBe("/partner?periodo=1&sezione=tutti");
  });

  it("ultimo periodo e ultima sezione nel browser, con lo storage che può mancare", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(readRememberedView(storage)).toEqual({});
    rememberView(storage, { periodo: 3, sezione: "eventi" });
    expect(readRememberedView(storage)).toEqual({ periodo: 3, sezione: "eventi" });
    store.set("luckylap.partner.vista.v1", '{"periodo":9,"sezione":"eventi"}');
    expect(readRememberedView(storage)).toEqual({ sezione: "eventi" });
    store.set("luckylap.partner.vista.v1", "non json");
    expect(readRememberedView(storage)).toEqual({});
    const broken = {
      getItem: () => {
        throw new Error("bloccato");
      },
      setItem: () => {
        throw new Error("bloccato");
      },
    };
    expect(readRememberedView(broken)).toEqual({});
    expect(() => rememberView(broken, { periodo: 1, sezione: "tutti" })).not.toThrow();
    expect(readRememberedView(null)).toEqual({});
  });
});
