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
const tabs = () => renderToStaticMarkup(<WorkspaceTabs />);
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

  it("consultant su /sales: nessuna voce verso Finance o Controllo CEO", () => {
    pathname = "/sales";
    for (const html of [sidebar(consultant), bottomBar(consultant)]) {
      expect(html).not.toContain('href="/finance"');
      expect(html).not.toContain('href="/audit"');
    }
    expect(count(navPart(sidebar(consultant)), /<a /g)).toBe(5);
    expect(linkTo(sidebar(consultant), "/sales")).toContain('aria-current="true"');
  });

  it("prima della verifica: le 5 sezioni aperte a tutti, nessun piede", () => {
    const side = sidebar({ status: "pending" });
    expect(count(navPart(side), /<a /g)).toBe(5);
    expect(side).not.toContain("Esci");
    expect(side).not.toContain("/auth/account");
    expect(side).not.toContain("Anteprima locale");
  });

  it("fuori dal team: solo il marchio, nessuna voce e nessuna barra in basso", () => {
    const side = sidebar({ status: "outside" });
    expect(side).not.toContain("<nav");
    expect(hrefs(side)).toEqual(["/"]);
    expect(side).toContain("LuckyLap");
    expect(bottomBar({ status: "outside" })).toBe("");
  });

  it("anteprima locale: tutte le sezioni, «Anteprima locale» e niente «Esci»", () => {
    const side = sidebar({ status: "preview" });
    expect(count(navPart(side), /<a /g)).toBe(7);
    expect(side).toContain("Anteprima locale");
    expect(side).toContain("Dati solo su questo browser");
    expect(side + bottomBar({ status: "preview" })).not.toContain("Esci");
  });

  it("membro: nome, «Account e sicurezza» e il modulo «Esci»", () => {
    const side = sidebar(founder);
    expect(side).toContain("Tommi");
    expect(side).toMatch(/<a[^>]*href="\/auth\/account"[^>]*>Account e sicurezza<\/a>/);
    expect(side).toMatch(/<form[^>]*>.*<button[^>]*>Esci<\/button><\/form>/);
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

  it("mette Team, Finance, Controllo CEO, account ed «Esci» nel foglio", () => {
    const html = bottomBar(founder);
    const sheet = html.slice(html.indexOf("<dialog"));
    expect(sheet).toContain('id="altro"');
    expect(hrefs(sheet)).toEqual(["/team", "/finance", "/audit", "/auth/account"]);
    expect(sheet).toMatch(/<button[^>]*>Esci<\/button>/);
    expect(sheet).toContain("Chiudi");
  });
});

describe("schede della sezione", () => {
  it("su /stock/rettifiche: tre schede di Magazzino, Rettifiche corrente", () => {
    pathname = "/stock/rettifiche";
    const html = tabs();
    expect(html).toContain('aria-label="Pagine di Magazzino"');
    expect(count(html, /<a /g)).toBe(3);
    expect(hrefs(html)).toEqual(["/stock", "/stock/rettifiche", "/packaging"]);
    expect(linkTo(html, "/stock/rettifiche")).toContain('aria-current="page"');
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
