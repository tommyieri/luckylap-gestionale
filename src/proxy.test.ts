import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";

/*
 * Ogni pagina dell'app passa dal proxy: rinnovo della sessione e header `no-store`
 * (docs: 06-revisione-pre-invio R6). Una pagina nuova con un primo segmento nuovo
 * fa fallire questo test finché il segmento non entra nel `matcher`.
 */
const APP = join(__dirname, "app");

function pageDirectories(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  return [
    ...(entries.some((entry) => entry.isFile() && /^page\.(tsx|ts|jsx|js)$/.test(entry.name))
      ? [directory]
      : []),
    ...entries
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => pageDirectories(join(directory, entry.name))),
  ];
}

/** Segmenti dell'URL: via i gruppi `(…)`, le cartelle private `_…` restano escluse. */
const urlSegments = (directory: string) =>
  relative(APP, directory)
    .split(sep)
    .filter((segment) => segment && !/^\(.+\)$/.test(segment));

const pages = pageDirectories(APP).filter(
  (directory) =>
    !relative(APP, directory)
      .split(sep)
      .some((part) => part.startsWith("_")),
);
const firstSegments = [
  ...new Set(
    pages.map((directory) => urlSegments(directory)[0]).filter((segment) => segment !== undefined),
  ),
].filter((segment) => segment !== "api");
const matcher = config.matcher as string[];

describe("matcher del proxy", () => {
  it("copre ogni primo segmento che ha una pagina", () => {
    expect(firstSegments.length).toBeGreaterThan(5);
    for (const segment of firstSegments) expect(matcher).toContain(`/${segment}/:path*`);
  });

  it("toglie i gruppi di route: le pagine di (workspace) contano con il loro URL", () => {
    const grouped = pages.filter((directory) => directory.includes(`${sep}(workspace)`));
    expect(grouped.length).toBeGreaterThan(10);
    for (const directory of grouped) {
      const segments = urlSegments(directory);
      expect(segments.join("/")).not.toMatch(/[()]/);
      if (segments.length) expect(matcher).toContain(`/${segments[0]}/:path*`);
    }
    expect(firstSegments).toEqual(expect.arrayContaining(["partner", "stock", "auth", "guida"]));
  });

  it("copre la home `/`, che è Oggi", () => {
    expect(pages.some((directory) => urlSegments(directory).length === 0)).toBe(true);
    expect(matcher).toContain("/");
  });
});
