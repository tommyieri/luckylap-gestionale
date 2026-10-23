import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_LINKS, SECTIONS } from "./navigation";

/*
 * Guardia del guscio condiviso (docs: 01-layout §11.2 e §14). Legge il file system:
 * ogni pagina per i membri sta nel gruppo `(workspace)`, nessuna pagina ha più una
 * testata propria, un link indietro o un `<main>`, e ogni voce del menu porta a una
 * pagina che esiste. Controlla anche le ancore statiche di 00-sequenza, decisione 18.
 */
const SRC = join(__dirname, "..");
const APP = join(SRC, "app");
const GROUP = join(APP, "(workspace)");
const COMPONENTS = join(SRC, "components");

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesIn(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}
const posix = (path: string) => path.split(sep).join("/");
const read = (path: string) => readFileSync(path, "utf8");

const pages = filesIn(APP)
  .filter((path) => /(^|[/\\])page\.(tsx|ts|jsx|js)$/.test(path))
  .map((path) => posix(relative(APP, path)));
/** Codice dell'interfaccia (test esclusi: possono citare le stringhe vietate). */
const sources = [...filesIn(GROUP), ...filesIn(COMPONENTS)].filter(
  (path) => /\.(tsx|ts)$/.test(path) && !/\.test\.(tsx|ts)$/.test(path),
);
const sourceName = (path: string) => posix(relative(SRC, path));

/** URL di ogni pagina del gruppo, con i segmenti dinamici `[x]` come jolly. */
const groupRoutes = pages
  .filter((page) => page.startsWith("(workspace)/"))
  .map((page) =>
    page
      .replace(/^\(workspace\)\//, "")
      .replace(/(^|\/)page\.(tsx|ts|jsx|js)$/, "")
      .split("/")
      .filter(Boolean),
  );
const hasGroupPage = (href: string) => {
  const segments = href.split("/").filter(Boolean);
  return groupRoutes.some(
    (route) =>
      route.length === segments.length &&
      route.every((part, index) => /^\[[^\]]+\]$/.test(part) || part === segments[index]),
  );
};

describe("pagine nel gruppo (workspace)", () => {
  it("ogni page.tsx di src/app sta nel gruppo, tranne login e conferma", () => {
    expect(pages.length).toBeGreaterThan(15);
    const outside = pages.filter((page) => !page.startsWith("(workspace)/"));
    expect(outside.sort()).toEqual(["auth/confirm/page.tsx", "auth/login/page.tsx"]);
  });

  it("nessuna pagina delle sezioni resta fuori dal gruppo", () => {
    const sections = [
      "team",
      "sales",
      "stock",
      "packaging",
      "consignment",
      "finance",
      "audit",
      "assets",
      "development",
      "partner",
    ];
    for (const section of sections) {
      expect(pages.filter((page) => page.startsWith(`${section}/`))).toEqual([]);
      expect(pages).toContain(`(workspace)/${section}/page.tsx`);
    }
  });

  it("ogni voce del menu, scheda, percorso dell'account e `also` ha la sua pagina", () => {
    const hrefs = [
      ...SECTIONS.flatMap((section) => [
        section.href,
        ...section.tabs.map((tab) => tab.href),
        ...(section.also ?? []),
      ]),
      ...ACCOUNT_LINKS.flatMap((link) => [link.href, ...link.match]),
    ];
    expect(hrefs.length).toBeGreaterThan(15);
    for (const href of hrefs) expect(hasGroupPage(href), href).toBe(true);
  });
});

describe("niente testate proprie nelle pagine", () => {
  const forbidden = [
    "Torna al workspace",
    "Torna al magazzino",
    'href="https://github.com/tommyieri/luckylap-partner"',
    // Sopratitoli in maiuscolo e nomi d'area diversi dal menu (06 R17).
    "OPERAZIONI CONDIVISE",
    "FINANCE DEL BRAND",
    "FINANCE / DOCUMENTI ORIGINALI",
    "Controllo founder",
    "Sviluppo prodotti",
    "Contenuti del brand",
  ];

  it("nessun file del gruppo o dei componenti contiene link indietro o vecchi nomi", () => {
    expect(sources.length).toBeGreaterThan(40);
    const found = sources.flatMap((path) => {
      const text = read(path);
      return forbidden
        .filter((value) => text.includes(value))
        .map((value) => [sourceName(path), value]);
    });
    expect(found).toEqual([]);
  });

  it("nessuna pagina del gruppo importa AuthShell", () => {
    const found = sources
      .filter((path) => path.startsWith(GROUP) && /AuthShell|auth-shell/.test(read(path)))
      .map(sourceName);
    expect(found).toEqual([]);
  });

  it("AuthShell e le pagine radice not-found ed error non importano moduli CSS", () => {
    // Next precarica su ogni pagina il CSS dei confini radice: un modulo qui pesa ovunque.
    const files = [
      join(COMPONENTS, "auth-shell.tsx"),
      join(APP, "not-found.tsx"),
      join(APP, "error.tsx"),
      join(APP, "global-error.tsx"),
    ];
    const found = files.filter((path) => /\.module\.css["']/.test(read(path))).map(sourceName);
    expect(found).toEqual([]);
  });

  it("solo il guscio e AuthShell aprono <main>", () => {
    const found = sources.filter((path) => /<main\b/.test(read(path))).map(sourceName);
    expect(found.sort()).toEqual(["components/auth-shell.tsx", "components/workspace-frame.tsx"]);
  });

  it("solo il guscio ha il collegamento «Vai al contenuto»", () => {
    const found = sources.filter((path) => read(path).includes("skip-link")).map(sourceName);
    expect(found).toEqual(["components/workspace-frame.tsx"]);
  });
});

describe("ancore statiche (00-sequenza, decisione 18)", () => {
  /** Un `<li>` con `id={`prefisso-${…}`}`: il feed del Controllo CEO ci punta. */
  const anchor = (prefix: string) =>
    new RegExp(`<li\\b[^>]*\\bid=\\{\`${prefix}-\\$\\{[^}]+\\}\`\\}`);
  const cases: [string, string][] = [
    ["components/team-calendar.tsx", "evento"],
    ["components/team-workspace.tsx", "attivita"],
    ["components/team-workspace.tsx", "nota"],
    ["components/brand-assets-view.tsx", "contenuto"],
    ["components/development-view.tsx", "progetto"],
  ];

  it.each(cases)("%s mette l'ancora %s- sulla riga", (file, prefix) => {
    expect(read(join(SRC, file))).toMatch(anchor(prefix));
  });

  it("ogni prefisso compare una volta sola, solo nel suo componente", () => {
    for (const [file, prefix] of cases) {
      const owners = sources.filter((path) => anchor(prefix).test(read(path))).map(sourceName);
      expect(owners).toEqual([file]);
    }
  });
});
