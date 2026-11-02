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
import type { PartnerWorkData, PartnerWorkView } from "./work";

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
  lavoro: "tutti",
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
      lavoro: "tutti",
    });
    expect(viewShowing(view({ sezione: "collab" }), list[2], context)).toMatchObject({
      sezione: "collab",
      stato: "tutti",
      co: 3,
    });
    expect(withoutFilters(start)).toEqual({ ...start, stato: "tutti", chi: "tutti", q: "" });
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

  it("solo lo stato «Accordo fatto», in ogni periodo e nella sezione scelta", () => {
    expect(cos({ periodo: 5, sezione: "vendita", stato: "no" })).toEqual([30, 35]);
    expect(cos({ sezione: "eventi", stato: "no" })).toEqual([32, 31, 33]);
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
      lavoro: "tutti",
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
  it("distingue le viste operative dai link di archivio esistenti", () => {
    expect(parsePartnerView({}).view.lavoro).toBe("da_seguire");
    expect(parsePartnerView({ periodo: "4" }).view.lavoro).toBe("tutti");
    expect(parsePartnerView({ vista: "risposte", periodo: "4" }).view.lavoro).toBe("risposte");
    expect(parsePartnerView({ vista: "tutti" }).view.lavoro).toBe("tutti");
    expect(parsePartnerView({ vista: "da_seguire", periodo: "4" }).view.lavoro).toBe("da_seguire");
    for (const lavoro of ["da_seguire", "risposte", "tutti"] as const) {
      const original = view({ lavoro });
      expect(parsePartnerView(new URLSearchParams(partnerViewQuery(original))).view).toEqual(
        original,
      );
    }
    const { lavoro: _legacy, ...legacy } = view({});
    expect(partnerViewQuery(legacy)).toBe("periodo=1&sezione=tutti&vista=tutti");
  });

  it("legge l'indirizzo completo", () => {
    const { view: parsed, explicit } = parsePartnerView(
      new URLSearchParams("periodo=3&sezione=eventi&stato=da_controllare&chi=io&q=porsche&co=12"),
    );
    expect(parsed).toEqual({
      lavoro: "tutti",
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
    expect(partnerViewQuery(DEFAULT_PARTNER_VIEW)).toBe("periodo=1&sezione=tutti&vista=da_seguire");
    expect(partnerViewHref(original)).toBe(`/partner?${query}#lead-7`);
    expect(partnerViewHref(DEFAULT_PARTNER_VIEW)).toBe(
      "/partner?periodo=1&sezione=tutti&vista=da_seguire",
    );
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

describe("viste del lavoro Partner", () => {
  const workView = (fields: Partial<PartnerWorkView> = {}): PartnerWorkView => ({
    phase: "to_write",
    label: "Da scrivere",
    reason: null,
    turn: "A noi",
    dueOn: null,
    dueLabel: "Data da confermare",
    motivation: "Proposta sintetica",
    warning: null,
    needsAction: true,
    sortPriority: 5,
    ...fields,
  });
  const work: PartnerWorkData = {
    assistantStatus: "ready",
    jobs: [],
    toggles: [],
    activities: [],
    replies: [2, 3, 20, 21].map((co) => ({
      id: partnerFixtureId(2000 + co),
      partnerId: partnerFixtureId(co),
      kind: "risposta",
      occurredAt: "2026-10-22T10:00:00Z",
      createdBy: ME,
      origin: "team",
      channel: "email",
      body: "Risposta sintetica registrata dal team.",
    })),
    followUps: [],
  };
  const workViews = new Map<string, PartnerWorkView>([
    [partnerFixtureId(1), workView({ needsAction: false })],
    [partnerFixtureId(12), workView({ dueOn: "2026-11-01" })],
    [partnerFixtureId(20), workView({ sortPriority: 1, dueOn: "2026-10-23" })],
    [partnerFixtureId(21), workView({ sortPriority: 1, dueOn: "2026-10-22" })],
  ]);
  const operationalContext = { ...context, work, workViews };
  const results = (fields: Partial<PartnerView>, ctx = operationalContext) =>
    filterPartners(list, view(fields), ctx).map((partner) => partner.co);

  it("Da seguire ignora il periodo e ordina per urgenza, scadenza e CO", () => {
    expect(results({ lavoro: "da_seguire", periodo: 3 })).toEqual([21, 20, 12]);
    expect(results({ lavoro: "da_seguire", sezione: "vendita" })).toEqual([21, 12]);
    expect(results({ lavoro: "da_seguire", stato: "contattato" })).toEqual([]);
    const tied = new Map(workViews);
    tied.set(partnerFixtureId(20), workView({ sortPriority: 1, dueOn: "2026-10-22" }));
    expect(results({ lavoro: "da_seguire" }, { ...operationalContext, workViews: tied })).toEqual([
      20, 21, 12,
    ]);
  });

  it("senza dati operativi Da seguire conserva i contatti aperti in ogni periodo", () => {
    expect(
      filterPartners(list, view({ lavoro: "da_seguire", periodo: 3 }), context).map(
        (partner) => partner.co,
      ),
    ).toEqual([1, 12, 20, 21]);
    const { lavoro: _legacy, ...legacy } = view({});
    expect(filterPartners(list, legacy, context).map((partner) => partner.co)).toEqual([1, 12]);
  });

  it("Da seguire conserva invii incerti e risposte urgenti anche dopo accordo o no", () => {
    const urgent = new Map(workViews);
    urgent.set(
      partnerFixtureId(2),
      workView({
        phase: "closed",
        label: "Accordo fatto",
        warning: "Invio da verificare: controlla in Posta inviata.",
        sortPriority: 0,
      }),
    );
    urgent.set(
      partnerFixtureId(3),
      workView({ phase: "no", label: "Non interessato", turn: "A noi", sortPriority: 1 }),
    );
    const ctx = { ...operationalContext, workViews: urgent };
    expect(results({ lavoro: "da_seguire" }, ctx)).toEqual([2, 21, 20, 3, 12]);
    expect(results({ lavoro: "da_seguire", stato: "chiuso" }, ctx)).toEqual([2]);
    expect(results({ lavoro: "da_seguire", stato: "no" }, ctx)).toEqual([3]);
    urgent.set(partnerFixtureId(2), workView({ phase: "closed", needsAction: false }));
    expect(results({ lavoro: "da_seguire" }, ctx)).toEqual([21, 20, 3, 12]);
  });

  it("Da controllare mostra le differenze future anche senza altra azione urgente", () => {
    const quiet = new Map(workViews);
    quiet.set(partnerFixtureId(20), workView({ needsAction: false }));
    const ctx = { ...operationalContext, workViews: quiet };
    expect(results({ lavoro: "da_seguire", stato: "da_controllare", periodo: 3 }, ctx)).toEqual([
      20,
    ]);
    expect(
      results({ lavoro: "da_seguire", stato: "da_controllare", sezione: "vendita" }, ctx),
    ).toEqual([]);
    expect(
      results({ lavoro: "da_seguire", stato: "da_controllare", sezione: "eventi" }, ctx),
    ).toEqual([20]);
    expect(
      viewShowing(
        view({ lavoro: "da_seguire", stato: "da_controllare", periodo: 3, sezione: "eventi" }),
        list[4],
        ctx,
      ),
    ).toMatchObject({
      lavoro: "da_seguire",
      stato: "da_controllare",
      periodo: 3,
      sezione: "eventi",
      co: 20,
    });
  });

  it("Risposte include anche accordi e no, senza filtro di periodo o stato", () => {
    const dialogue = { ...list[4], stage: "trattativa" as const };
    expect(
      filterPartners(
        [...list.filter((partner) => partner.co !== 20), dialogue],
        view({ lavoro: "risposte", periodo: 5, stato: "contattato" }),
        operationalContext,
      ).map((partner) => partner.co),
    ).toEqual([2, 3, 20, 21]);
    expect(results({ lavoro: "risposte", sezione: "eventi" })).toEqual([2, 20, 21]);
    expect(results({ lavoro: "risposte", chi: OTHER })).toEqual([2]);
    expect(results({ lavoro: "risposte", q: "CO 20" })).toEqual([20]);
    expect(
      filterPartners(list, view({ lavoro: "risposte" }), context).map((partner) => partner.co),
    ).toEqual([]);
  });

  it("i link diretti conservano la vista se mostra il contatto, altrimenti aprono Tutti", () => {
    expect(
      viewShowing(view({ lavoro: "risposte", periodo: 4 }), list[4], operationalContext),
    ).toMatchObject({ lavoro: "risposte", periodo: 4, co: 20 });
    expect(
      viewShowing(
        view({ lavoro: "risposte", sezione: "eventi", stato: "no", chi: OTHER, q: "x" }),
        list[0],
        operationalContext,
      ),
    ).toMatchObject({
      lavoro: "tutti",
      sezione: "tutti",
      stato: "tutti",
      chi: "tutti",
      q: "",
      periodo: 1,
      co: 1,
    });
    expect(
      viewShowing(view({ lavoro: "da_seguire", periodo: 4 }), list[4], operationalContext),
    ).toMatchObject({ lavoro: "da_seguire", periodo: 4, co: 20 });
    expect(
      viewShowing(view({ lavoro: "da_seguire", periodo: 4 }), list[0], operationalContext),
    ).toMatchObject({ lavoro: "tutti", periodo: 1, co: 1 });
    const agreed = viewShowing(
      view({ accordi: true, sezione: "vendita" }),
      list[1],
      operationalContext,
    );
    expect(agreed).toMatchObject({ accordi: true, sezione: "tutti", co: 2 });
    expect(filterPartners(list, agreed, operationalContext).map((partner) => partner.co)).toContain(
      2,
    );
  });

  it("Togli i filtri conserva la vista e rimuove il filtro stato dalle risposte e dall'archivio", () => {
    for (const lavoro of ["risposte", "tutti"] as const)
      expect(withoutFilters(view({ lavoro, stato: "no", co: 12 }))).toMatchObject({
        lavoro,
        stato: "tutti",
        co: null,
      });
    expect(withoutFilters(view({ lavoro: "da_seguire", stato: "no" }))).toMatchObject({
      lavoro: "da_seguire",
      stato: "da_fare",
    });
  });
});
