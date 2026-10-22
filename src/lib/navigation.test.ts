import { describe, expect, it } from "vitest";
import { isSensitiveAreaEligible, MEMBER_ROLES, type VerifiedMember } from "./auth/model";
import {
  ACCOUNT_LINKS,
  SECTIONS,
  locate,
  matchesPath,
  mobileSplit,
  navAccessFrom,
  visibleSections,
  type NavAccess,
} from "./navigation";

const member = (role: VerifiedMember["role"], financeAccess: boolean): VerifiedMember => ({
  userId: "00000000-0000-4000-8000-000000000001",
  displayName: "Membro di prova",
  role,
  financeAccess,
});
const ids = (access: NavAccess) => visibleSections(access).map((section) => section.id);
const allHrefs = () => [
  ...SECTIONS.flatMap((section) => [
    section.href,
    ...section.tabs.map((tab) => tab.href),
    ...(section.also ?? []),
  ]),
  ...ACCOUNT_LINKS.flatMap((link) => [link.href, ...link.match]),
];

describe("mappa delle sezioni", () => {
  it("ha al massimo 7 sezioni, nell'ordine fisso con Finance e Controllo CEO in fondo", () => {
    expect(SECTIONS.length).toBeLessThanOrEqual(7);
    expect(SECTIONS.map((section) => section.id)).toEqual([
      "oggi",
      "vendite",
      "magazzino",
      "partner",
      "team",
      "finance",
      "ceo",
    ]);
  });

  it("ha id, href ed etichette di sezione unici", () => {
    for (const key of ["id", "href", "label"] as const)
      expect(new Set(SECTIONS.map((section) => section[key])).size).toBe(SECTIONS.length);
  });

  it("non ripete nessun href di scheda in tutta la mappa e non usa quelli dell'account", () => {
    const tabs = SECTIONS.flatMap((section) => section.tabs.map((tab) => tab.href));
    expect(new Set(tabs).size).toBe(tabs.length);
    const account = ACCOUNT_LINKS.flatMap((link) => [link.href, ...link.match]);
    for (const href of tabs) expect(account).not.toContain(href);
    const sectionsWithoutTabs = SECTIONS.filter((section) => !section.tabs.length).map(
      (section) => section.href,
    );
    for (const href of sectionsWithoutTabs) expect(tabs).not.toContain(href);
  });

  it("usa come href di una sezione con schede la sua prima scheda", () => {
    for (const section of SECTIONS.filter((item) => item.tabs.length))
      expect(section.href).toBe(section.tabs[0].href);
  });

  it("mostra le schede solo con almeno due pagine, con etichette uniche nella sezione", () => {
    for (const section of SECTIONS) {
      expect(section.tabs.length === 0 || section.tabs.length >= 2).toBe(true);
      expect(new Set(section.tabs.map((tab) => tab.label)).size).toBe(section.tabs.length);
    }
  });

  it("ha esattamente 4 sezioni nella barra in basso, nessuna con permessi", () => {
    const bar = SECTIONS.filter((section) => section.mobile === "bar");
    expect(bar.map((section) => section.id)).toEqual(["oggi", "vendite", "magazzino", "partner"]);
    expect(bar.every((section) => !section.requires)).toBe(true);
  });

  it("ha solo percorsi interni relativi, senza link a GitHub", () => {
    for (const href of allHrefs()) {
      expect(href.startsWith("/")).toBe(true);
      expect(href.startsWith("//")).toBe(false);
      expect(href).not.toMatch(/github|https?:/);
    }
  });

  it("tiene Partner senza schede con l'icona Handshake e le aree con password in also", () => {
    const partner = SECTIONS.find((section) => section.id === "partner")!;
    expect(partner).toMatchObject({ href: "/partner", icon: "Handshake", tabs: [] });
    expect(SECTIONS.find((section) => section.id === "finance")).toMatchObject({
      requires: "finance",
      also: ["/auth/area/finance"],
    });
    expect(SECTIONS.find((section) => section.id === "ceo")).toMatchObject({
      label: "Controllo CEO",
      requires: "ceo",
      also: ["/auth/area/audit"],
    });
  });

  it("mette «Account e sicurezza» fuori dalle sezioni", () => {
    expect(ACCOUNT_LINKS).toEqual([
      {
        href: "/auth/account",
        label: "Account e sicurezza",
        match: ["/auth/account", "/auth/password", "/auth/verify"],
      },
    ]);
  });

  it("non si può modificare per sbaglio", () => {
    expect(Object.isFrozen(SECTIONS)).toBe(true);
    expect(Object.isFrozen(SECTIONS[2].tabs)).toBe(true);
    expect(Object.isFrozen(SECTIONS[2].tabs[0])).toBe(true);
    expect(Object.isFrozen(ACCOUNT_LINKS[0].match)).toBe(true);
  });
});

describe("visibleSections per ruolo", () => {
  const cases: [VerifiedMember["role"], boolean, number][] = [
    ["consultant", false, 5],
    ["consultant", true, 5],
    ["logistics", false, 5],
    ["logistics", true, 5],
    ["production", false, 5],
    ["production", true, 6],
    ["finance", false, 5],
    ["finance", true, 6],
    ["founder", false, 7],
    ["founder", true, 7],
  ];

  it("copre tutti i ruoli esistenti", () => {
    expect(new Set(cases.map(([role]) => role))).toEqual(new Set(MEMBER_ROLES));
  });

  it.each(cases)("%s con finance_access=%s vede %i sezioni", (role, financeAccess, count) => {
    const access = navAccessFrom({ status: "member", member: member(role, financeAccess) });
    const visible = ids(access);
    expect(visible).toHaveLength(count);
    expect(visible.slice(0, 5)).toEqual(["oggi", "vendite", "magazzino", "partner", "team"]);
    if (count === 6) expect(visible[5]).toBe("finance");
  });

  it.each(cases)(
    "%s con finance_access=%s segue isSensitiveAreaEligible",
    (role, financeAccess) => {
      const verified = member(role, financeAccess);
      const access = navAccessFrom({ status: "member", member: verified });
      expect(access).toMatchObject({
        status: "member",
        finance: isSensitiveAreaEligible(verified, "finance"),
        ceo: isSensitiveAreaEligible(verified, "audit"),
      });
      expect(ids(access).includes("finance")).toBe(isSensitiveAreaEligible(verified, "finance"));
      expect(ids(access).includes("ceo")).toBe(isSensitiveAreaEligible(verified, "audit"));
    },
  );

  it("in attesa e con verifica non disponibile mostra le 5 sezioni aperte a tutti", () => {
    expect(ids({ status: "pending" })).toEqual(["oggi", "vendite", "magazzino", "partner", "team"]);
    expect(ids({ status: "unavailable" })).toEqual(ids({ status: "pending" }));
  });

  it("in anteprima mostra tutte e 7 le sezioni, fuori dal team nessuna", () => {
    expect(ids({ status: "preview" })).toHaveLength(7);
    expect(ids({ status: "outside" })).toEqual([]);
  });

  it("restituisce una lista nuova, che non tocca la mappa", () => {
    const visible = visibleSections({ status: "preview" });
    visible.pop();
    expect(SECTIONS).toHaveLength(7);
  });
});

describe("navAccessFrom", () => {
  it.each([
    ["preview", "preview"],
    ["unconfigured", "unavailable"],
    ["unavailable", "unavailable"],
    ["signed-out", "outside"],
    ["denied", "outside"],
    ["qualcosa-di-nuovo", "unavailable"],
  ])("da %s dà %s", (status, expected) => {
    expect(navAccessFrom({ status })).toEqual({ status: expected });
  });

  it("dà al menu solo nome e permessi, mai il client o l'id del membro", () => {
    const access = navAccessFrom({
      status: "member",
      member: member("founder", false),
      supabase: { segreto: true },
    } as { status: string; member: VerifiedMember });
    expect(access).toEqual({
      status: "member",
      displayName: "Membro di prova",
      finance: true,
      ceo: true,
    });
  });

  it("tratta un membro senza dati come verifica non disponibile", () => {
    expect(navAccessFrom({ status: "member" })).toEqual({ status: "unavailable" });
  });
});

describe("locate", () => {
  it.each([
    ["/", "oggi", null],
    ["/sales", "vendite", "Ordini"],
    ["/consignment", "vendite", "Conto vendita"],
    ["/consignment/NEG01", "vendite", "Conto vendita"],
    ["/consignment/NEG01/conta", "vendite", "Conto vendita"],
    ["/stock", "magazzino", "Giacenze"],
    ["/stock/rettifiche", "magazzino", "Rettifiche"],
    ["/packaging", "magazzino", "Packaging"],
    ["/partner", "partner", null],
    ["/partner/x", "partner", null],
    ["/team", "team", "Calendario e attività"],
    ["/development", "team", "Nuovi prodotti"],
    ["/assets", "team", "Grafica e foto"],
    ["/finance", "finance", "Panoramica"],
    ["/finance/work", "finance", "Registrazioni"],
    ["/finance/documents", "finance", "Documenti"],
    ["/audit", "ceo", null],
    ["/auth/area/finance", "finance", null],
    ["/auth/area/audit", "ceo", null],
    ["/auth/account", "account", null],
    ["/auth/password", "account", null],
    ["/auth/verify", "account", null],
    ["/stock/", "magazzino", "Giacenze"],
  ])("%s → %s, scheda %s", (pathname, section, tab) => {
    const location = locate(pathname);
    expect(location.section).toBe(section);
    expect(location.tab?.label ?? null).toBe(tab);
  });

  it.each(["/sales-old", "/auth/login", "/auth/confirm", "/auth/area/xyz", "/sconosciuto", ""])(
    "%s non accende nessuna sezione",
    (pathname) => {
      expect(locate(pathname)).toEqual({ section: null, tab: null });
    },
  );

  it("dà la stessa scheda della mappa, così il confronto per identità funziona", () => {
    const magazzino = SECTIONS.find((section) => section.id === "magazzino")!;
    expect(locate("/stock/rettifiche").tab).toBe(magazzino.tabs[1]);
  });

  it("confronta i prefissi solo a confine di segmento", () => {
    expect(matchesPath("/", "/")).toBe(true);
    expect(matchesPath("/", "/sales")).toBe(false);
    expect(matchesPath("/sales", "/sales/1")).toBe(true);
    expect(matchesPath("/sales", "/salesforce")).toBe(false);
  });
});

describe("mobileSplit", () => {
  it("mette Team, Finance e Controllo CEO in «Altro» per chi vede tutto", () => {
    const { bar, altro } = mobileSplit(visibleSections({ status: "preview" }));
    expect(bar.map((section) => section.id)).toEqual(["oggi", "vendite", "magazzino", "partner"]);
    expect(altro.map((section) => section.id)).toEqual(["team", "finance", "ceo"]);
  });

  it("lascia in «Altro» solo Team a chi non entra in Finance e Controllo CEO", () => {
    const access = navAccessFrom({ status: "member", member: member("consultant", true) });
    const { bar, altro } = mobileSplit(visibleSections(access));
    expect(bar).toHaveLength(4);
    expect(altro.map((section) => section.id)).toEqual(["team"]);
  });
});
