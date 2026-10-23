import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { WorkspaceBottomBar, WorkspaceSidebar, WorkspaceTabs } from "./workspace-nav";
import type { NavAccess } from "../lib/navigation";

const signOut = vi.fn();
const founder: NavAccess = { status: "member", displayName: "Tommi", finance: true, ceo: true };
const consultant: NavAccess = {
  status: "member",
  displayName: "Membro di prova",
  finance: false,
  ceo: false,
};

const sidebar = (access: NavAccess) =>
  renderToStaticMarkup(<WorkspaceSidebar access={access} signOut={signOut} />);
const bottomBar = (access: NavAccess) =>
  renderToStaticMarkup(<WorkspaceBottomBar access={access} signOut={signOut} />);
const tabs = (access: NavAccess = founder) =>
  renderToStaticMarkup(<WorkspaceTabs access={access} />);
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;
/** Link dentro la `nav` delle sezioni (non il marchio, non il piede, non il foglio «Altro»). */
const navPart = (html: string) => html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
/** Tag di apertura del primo link verso `href`, qualunque sia l'ordine degli attributi. */
const linkTo = (html: string, href: string) =>
  [...html.matchAll(/<a\b[^>]*>/g)]
    .map((match) => match[0])
    .find((tag) => tag.includes(`href="${href}"`)) ?? "";

beforeEach(() => {
  pathname = "/";
});

describe("barra laterale", () => {
  it("founder su /finance/work: 7 sezioni, Finance accesa, una sola pagina corrente", () => {
    pathname = "/finance/work";
    const side = sidebar(founder);
    expect(count(navPart(side), /<a /g)).toBe(7);
    expect(linkTo(side, "/finance")).toContain('aria-current="true"');
    const all = side + tabs() + bottomBar(founder);
    expect(count(all, /aria-current="page"/g)).toBe(1);
    expect(linkTo(tabs(), "/finance/work")).toContain('aria-current="page"');
    expect(tabs()).toMatch(/aria-current="page"[^>]*>Registrazioni</);
    // «Altro» acceso: Finance è nel foglio sul telefono.
    expect(bottomBar(founder)).toMatch(/<button[^>]*data-active=""[^>]*aria-haspopup="dialog"/);
    expect(bottomBar(founder)).toContain("Sezione attuale: Finance");
  });

  it("consultant su /sales: vede Finance e Controllo CEO protette da password", () => {
    pathname = "/sales";
    for (const html of [sidebar(consultant), bottomBar(consultant)]) {
      const links = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]);
      for (const href of ["/finance", "/audit"])
        expect(links.find((link) => link.includes(`href="${href}"`))).toContain("(con password)");
    }
    expect(count(navPart(sidebar(consultant)), /<a /g)).toBe(7);
    expect(linkTo(sidebar(consultant), "/sales")).toContain('aria-current="true"');
  });

  it("prima della verifica: le 5 sezioni aperte a tutti, nessun piede", () => {
    const side = sidebar({ status: "pending" });
    expect(count(navPart(side), /<a /g)).toBe(5);
    expect(side).not.toContain("Esci");
    expect(side).not.toContain("/auth/account");
    expect(side).not.toContain("/guida");
    expect(side).not.toContain("Anteprima locale");
  });

  it("fuori dal team: solo il marchio, nessuna voce e nessuna barra in basso", () => {
    const side = sidebar({ status: "outside" });
    expect(side).not.toContain("<nav");
    expect(hrefs(side)).toEqual(["/"]);
    expect(side).toContain("LuckyLap");
    expect(bottomBar({ status: "outside" })).toBe("");
  });

  it("anteprima locale: tutte le sezioni, «Anteprima locale», l'account e niente «Esci»", () => {
    const side = sidebar({ status: "preview" });
    const sheet = bottomBar({ status: "preview" });
    expect(count(navPart(side), /<a /g)).toBe(7);
    expect(side).toContain("Anteprima locale");
    expect(side).toContain("Dati solo su questo browser");
    expect(side).toMatch(/<a[^>]*href="\/auth\/account"[^>]*>Account e sicurezza<\/a>/);
    expect(hrefs(sheet.slice(sheet.indexOf("<dialog")))).toContain("/auth/account");
    expect(side + sheet).not.toContain("Esci");
  });

  it("membro: nome, «Come si usa», «Account e sicurezza» e il modulo «Esci»", () => {
    const side = sidebar(founder);
    expect(side).toContain("Tommi");
    expect(side).toMatch(/<a[^>]*href="\/guida"[^>]*>Come si usa<\/a>/);
    expect(side).toMatch(/<a[^>]*href="\/auth\/account"[^>]*>Account e sicurezza<\/a>/);
    expect(side).toMatch(/<form[^>]*>.*<button[^>]*>Esci<\/button><\/form>/);
    const foot = side.slice(side.indexOf("Come si usa"));
    expect(foot.indexOf("Come si usa")).toBeLessThan(foot.indexOf("Account e sicurezza"));
    expect(foot.indexOf("Account e sicurezza")).toBeLessThan(foot.indexOf("Esci"));
  });

  it("anche chi non entra in Finance e Controllo CEO ha la guida nel piede", () => {
    expect(linkTo(sidebar(consultant), "/guida")).not.toBe("");
    expect(linkTo(sidebar({ status: "unavailable" }), "/guida")).not.toBe("");
  });

  it("su /guida accende la guida nel piede, non le sezioni, e la fascia dice «Come si usa»", () => {
    pathname = "/guida";
    const side = sidebar(founder);
    expect(linkTo(side, "/guida")).toContain('aria-current="page"');
    expect(linkTo(side, "/auth/account")).not.toContain("aria-current");
    expect(navPart(side)).not.toContain("aria-current");
    expect(side).toMatch(/aria-hidden="true">· <\/span>Come si usa/);
    expect(tabs()).toBe("");
  });

  it("segna le aree con password e accende l'account sulle sue pagine", () => {
    pathname = "/auth/password";
    const side = sidebar(founder);
    expect(count(side, /\(con password\)/g)).toBe(2);
    expect(linkTo(side, "/auth/account")).toContain('aria-current="page"');
    expect(navPart(side)).not.toContain("aria-current");
  });
});

describe("barra in basso e foglio «Altro»", () => {
  it("ha 4 link più il pulsante «Altro» che apre un dialog", () => {
    pathname = "/stock";
    const html = bottomBar(founder);
    const nav = navPart(html);
    expect(count(nav, /<a /g)).toBe(4);
    expect(hrefs(nav)).toEqual(["/", "/sales", "/stock", "/partner"]);
    expect(nav).toMatch(
      /<button[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"[^>]*aria-controls="altro"/,
    );
    expect(linkTo(nav, "/stock")).toContain('aria-current="true"');
    expect(nav).not.toContain("data-active");
  });

  it("mette Team, Finance, Controllo CEO, la guida, l'account ed «Esci» nel foglio", () => {
    const html = bottomBar(founder);
    const sheet = html.slice(html.indexOf("<dialog"));
    expect(sheet).toContain('id="altro"');
    expect(hrefs(sheet)).toEqual(["/team", "/finance", "/audit", "/guida", "/auth/account"]);
    expect(sheet).toMatch(/<button[^>]*>Esci<\/button>/);
    expect(sheet).toContain("Chiudi");
  });
});

describe("la guida sul telefono", () => {
  it("su /guida «Altro» è acceso e la guida è la pagina corrente del foglio", () => {
    pathname = "/guida";
    const html = bottomBar(consultant);
    expect(html).toMatch(/<button[^>]*data-active=""[^>]*aria-haspopup="dialog"/);
    expect(html).toContain("Sezione attuale: Come si usa");
    const sheet = html.slice(html.indexOf("<dialog"));
    expect(hrefs(sheet)).toEqual(["/team", "/finance", "/audit", "/guida", "/auth/account"]);
    expect(linkTo(sheet, "/guida")).toContain('aria-current="page"');
    expect(count(html, /aria-current="page"/g)).toBe(1);
  });
});

describe("schede della sezione", () => {
  it("su /stock/rettifiche: quattro schede di Magazzino, Rettifiche corrente", () => {
    pathname = "/stock/rettifiche";
    const html = tabs();
    expect(html).toContain('aria-label="Pagine di Magazzino"');
    expect(count(html, /<a /g)).toBe(4);
    expect(hrefs(html)).toEqual([
      "/stock",
      "/stock/rettifiche",
      "/packaging",
      "/stock/riassortimento",
    ]);
    expect(linkTo(html, "/stock/rettifiche")).toContain('aria-current="page"');
    expect(count(html, /aria-current/g)).toBe(1);
  });

  it("su un riordine: la scheda Riassortimento è quella corrente", () => {
    pathname = "/stock/riassortimento/95000000-0000-4000-8000-000000000001";
    const html = tabs();
    expect(linkTo(html, "/stock/riassortimento")).toContain('aria-current="page"');
    expect(count(html, /aria-current/g)).toBe(1);
  });

  it("nessuna striscia di schede per le sezioni con una sola pagina o fuori dalla mappa", () => {
    for (pathname of ["/partner", "/partner/x", "/", "/audit", "/auth/area/audit", "/sconosciuto"])
      expect(tabs()).toBe("");
    // La password di Finance accende la sezione: schede visibili, nessuna corrente.
    pathname = "/auth/area/finance";
    expect(tabs()).toContain('aria-label="Pagine di Finance"');
    expect(tabs()).not.toContain("aria-current");
  });

  it("tutti i membri vedono le schede, anche prima di aprire l’area", () => {
    // Anche un consulente vede i collegamenti: ogni pagina verifica la password sul server.
    for (pathname of ["/auth/area/finance", "/finance", "/finance/work"]) {
      expect(count(tabs(consultant), /<a /g)).toBe(3);
      expect(tabs(consultant)).toContain('href="/finance/work"');
    }
    // Prima della verifica: niente schede di Finance, sì quelle delle sezioni aperte a tutti.
    pathname = "/finance/work";
    expect(tabs({ status: "pending" })).toBe("");
    expect(tabs({ status: "unavailable" })).toBe("");
    expect(tabs({ status: "outside" })).toBe("");
    pathname = "/stock/rettifiche";
    expect(count(tabs({ status: "pending" }), /<a /g)).toBe(4);
    expect(count(tabs(consultant), /<a /g)).toBe(4);
    expect(tabs({ status: "outside" })).toBe("");
  });

  it("su /consignment/NEG01 accende Vendite e la scheda Conto vendita", () => {
    pathname = "/consignment/NEG01";
    expect(linkTo(tabs(), "/consignment")).toContain('aria-current="page"');
    expect(linkTo(sidebar(founder), "/sales")).toContain('aria-current="true"');
  });
});

describe("collegamenti", () => {
  it("usa solo href relativi, mai verso github.com", () => {
    const paths = ["/", "/finance/work", "/stock", "/team", "/auth/account", "/partner"];
    for (pathname of paths) {
      const html = sidebar(founder) + bottomBar(founder) + tabs() + sidebar({ status: "preview" });
      for (const href of hrefs(html)) expect(href).toMatch(/^\/(?!\/)/);
      expect(html).not.toContain("github.com");
    }
  });

  it("mostra la sezione attiva nella fascia del telefono", () => {
    pathname = "/packaging";
    expect(sidebar(founder)).toContain("Magazzino");
    expect(sidebar(founder)).toMatch(/aria-hidden="true">· <\/span>Magazzino/);
    pathname = "/sconosciuto";
    expect(sidebar(founder)).not.toContain("· </span>");
  });
});
