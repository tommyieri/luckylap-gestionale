import { describe, expect, it } from "vitest";
import { partnerFixtureId, partnerSummaryFixture } from "./fixtures";
import {
  DEFAULT_PARTNER_VIEW,
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
  viewShowing,
  withoutFilters,
  type PartnerFilterContext,
  type PartnerView,
} from "./filters";
import type { PartnerBlock, PartnerContactLink, PartnerSummary } from "./model";

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
  variants: [],
  differences: [
    {
      id: partnerFixtureId(700),
      partnerId: partnerFixtureId(20),
      origin: "file",
      field: "stage",
      variantId: null,
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

  it("«da fare» esclude Chiuso e Non interessato; uno stato preciso tiene solo quello", () => {
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
      variants: [],
      differences: [],
      blocks: [block({ domain: "other.example.test" })],
    });
    expect(removed.blocks.has(partnerFixtureId(21))).toBe(true);
  });

  it("«da controllare» mostra i contatti con differenze aperte", () => {
    expect(cos({ periodo: 2, stato: "da_controllare" })).toEqual([20]);
    expect(cos({ stato: "da_controllare" })).toEqual([]);
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
    expect(counts).toEqual({ tutti: 6, vendita: 3, eventi: 3, collab: 2 });
    expect(totalsLine({ tutti: 207, vendita: 119, eventi: 80, collab: 73 })).toBe(
      "207 contatti · 119 Vendita · 80 Eventi · 73 Collab. Lo stesso posto può stare in più sezioni.",
    );
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
    });
    expect(viewShowing(view({ sezione: "collab" }), list[2], context)).toMatchObject({
      sezione: "collab",
      stato: "tutti",
      co: 3,
    });
    expect(withoutFilters(start)).toEqual({ ...start, stato: "da_fare", chi: "tutti", q: "" });
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
