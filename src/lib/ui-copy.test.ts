import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Guardia dei testi (docs: 06-revisione-pre-invio, R3 e R10, sezione «Test»). Cerca in tutti i
 * .ts e .tsx di `src`, test compresi: i resti dell'anteprima e il gergo sostituito non devono
 * tornare, nemmeno nelle fixture. «Magadzino» non è in elenco: è il nome voluto della sede
 * centrale MAG01 (AGENTS.md, «Decisioni del founder»).
 */
const SRC = join(__dirname, "..");
const SELF = join(__dirname, "ui-copy.test.ts");

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesIn(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}
const name = (path: string) => relative(SRC, path).split(sep).join("/");
const files = filesIn(SRC)
  .filter((path) => /\.(tsx|ts)$/.test(path) && path !== SELF)
  .map((path) => ({ path: name(path), text: readFileSync(path, "utf8") }));

/** Stringa vietata e testo che l'ha sostituita. */
const FORBIDDEN: [RegExp, string][] = [
  [/\bv0\.1\b/, "nessuna versione nel menu (R3)"],
  [/Riferimento fonte/, "«Da dove vengono i numeri» (R3)"],
  [/contenitore privato/, "«archivio privato del team» (R10)"],
  [/richiede pulizia amministrativa/, "«resta nell’archivio privato. Avvisa Tommi…» (R10)"],
  [/Collegamento HTTPS/, "«Link» (R10)"],
  [/Consumi da riconciliare/, "«Scatole e adesivi da scalare» (R10)"],
  [/Riferimento: /, "il codice va in «Codice per l’assistenza» (R4)"],
  [/Origine tecnica/, "«Arriva da Shopify…» (R10)"],
  [/I fatti osservati non equivalgono/, "«Questi numeri non sono il saldo della banca.» (R10)"],
  [/\bfabbisogni\b/, "«N capi da produrre» (R10)"],
  [/Valore \/ costo \/ margine iniziali/, "«Prezzo, costo e margine» (R10)"],
];

describe("testi dell'interfaccia", () => {
  it("legge davvero i sorgenti", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((file) => file.path === "components/guide-view.tsx")).toBe(true);
  });

  it("nessun resto dell'anteprima e nessun termine sostituito in src", () => {
    const found = FORBIDDEN.flatMap(([pattern, replacement]) =>
      files
        .filter((file) => pattern.test(file.text))
        .map((file) => `${file.path}: ${pattern.source} → ${replacement}`),
    );
    expect(found).toEqual([]);
  });
});
