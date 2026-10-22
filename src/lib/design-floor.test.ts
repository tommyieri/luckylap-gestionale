import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Pavimento di stile del gestionale (docs: 01-layout §7 e §11.2). Legge tutti i `.css` di
 * `src`, anche quelli che arriveranno con le altre tappe: testo mai sotto 12 px, campi a
 * 16 px (sotto i 16 px iOS ingrandisce la pagina al tocco), righe quadrate, token e
 * caratteri del roadbook dichiarati una volta sola in `globals.css`, pulsanti da 44 px e
 * numeri in Barlow Condensed.
 */
const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const GLOBALS = join(SRC, "app", "globals.css");

type Declaration = { property: string; value: string };
type Rule = { file: string; selector: string; media: string[]; declarations: Declaration[] };
type Stylesheet = { rules: Rule[]; fontFaces: Declaration[][] };

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesIn(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}
const posix = (path: string) => path.split(sep).join("/");

/** Divide `text` su `separator` fuori da virgolette e parentesi. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function declarationsOf(body: string): Declaration[] {
  return splitTopLevel(body, ";").flatMap((part) => {
    const colon = part.indexOf(":");
    if (colon < 0) return [];
    return [
      {
        property: part.slice(0, colon).trim().toLowerCase(),
        value: part
          .slice(colon + 1)
          .trim()
          .replace(/\s+/g, " "),
      },
    ];
  });
}

/** Parser minimo: regole, blocchi @media/@supports/@layer/@container annidati, @font-face. */
function parseCss(source: string, file: string): Stylesheet {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  const sheet: Stylesheet = { rules: [], fontFaces: [] };
  function walk(start: number, end: number, media: string[]) {
    let index = start;
    let preludeStart = start;
    let quote: string | null = null;
    while (index < end) {
      const char = text[index];
      if (quote) {
        if (char === "\\") index++;
        else if (char === quote) quote = null;
        index++;
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === ";")
        preludeStart = index + 1; // @import, @charset
      else if (char === "{") {
        const prelude = text.slice(preludeStart, index).trim().replace(/\s+/g, " ");
        let depth = 1;
        let cursor = index + 1;
        let inner: string | null = null;
        for (; cursor < end && depth > 0; cursor++) {
          const next = text[cursor];
          if (inner) {
            if (next === "\\") cursor++;
            else if (next === inner) inner = null;
          } else if (next === '"' || next === "'") inner = next;
          else if (next === "{") depth++;
          else if (next === "}") depth--;
        }
        if (depth !== 0) throw new Error(`${file}: graffa non chiusa dopo «${prelude}»`);
        const bodyStart = index + 1;
        const bodyEnd = cursor - 1;
        if (/^@(media|supports|layer|container)\b/i.test(prelude)) {
          walk(bodyStart, bodyEnd, [...media, prelude]);
        } else if (/^@font-face$/i.test(prelude)) {
          sheet.fontFaces.push(declarationsOf(text.slice(bodyStart, bodyEnd)));
        } else if (!prelude.startsWith("@")) {
          sheet.rules.push({
            file,
            selector: prelude,
            media,
            declarations: declarationsOf(text.slice(bodyStart, bodyEnd)),
          });
        }
        index = cursor;
        preludeStart = cursor;
        continue;
      } else if (char === "}") {
        throw new Error(`${file}: graffa chiusa in più`);
      }
      index++;
    }
  }
  walk(0, text.length, []);
  return sheet;
}

const cssFiles = filesIn(SRC)
  .filter((path) => path.endsWith(".css"))
  .sort();
const sheets = new Map(
  cssFiles.map((path) => [
    posix(relative(SRC, path)),
    parseCss(readFileSync(path, "utf8"), posix(relative(SRC, path))),
  ]),
);
const globals = sheets.get("app/globals.css")!;
const allRules = [...sheets.values()].flatMap((sheet) => sheet.rules);
const selectorParts = (selector: string) => splitTopLevel(selector, ",");
const describeRule = (rule: Rule, declaration: Declaration) =>
  `${rule.file}: ${[...rule.media, rule.selector].join(" › ")} { ${declaration.property}: ${declaration.value} }`;

/** Token di `:root` in testa a globals.css (non quelli dentro le media query). */
const rootTokens = new Map(
  globals.rules
    .filter((rule) => rule.selector === ":root" && rule.media.length === 0)
    .flatMap((rule) => rule.declarations)
    .filter((declaration) => declaration.property.startsWith("--"))
    .map((declaration) => [declaration.property, declaration.value]),
);

/** Dimensione minima in px di un valore di `font-size`; `null` se non si può verificare. */
function minimumPx(raw: string): number | "inherit" | null {
  const value = raw.replace(/\s*!important$/i, "").trim();
  if (value === "inherit") return "inherit";
  const variable = value.match(/^var\((--[\w-]+)\)$/);
  if (variable) {
    const token = rootTokens.get(variable[1]);
    return token === undefined ? null : minimumPx(token);
  }
  const clamp = value.match(/^clamp\((.+)\)$/);
  if (clamp) return minimumPx(splitTopLevel(clamp[1], ",")[0] ?? "");
  const length = value.match(/^(\d*\.?\d+)(px|rem)$/);
  if (length) return Number(length[1]) * (length[2] === "rem" ? 16 : 1);
  return null;
}

/** La dimensione scritta nella scorciatoia `font`, oppure `null` se non ne scrive una. */
function shorthandSize(raw: string): string | null {
  const value = raw.replace(/\s*!important$/i, "").trim();
  if (value === "inherit") return "inherit";
  if (/^(initial|unset|revert|revert-layer)$/.test(value)) return null;
  const size = value.match(
    /(?:^|\s)(\d*\.?\d+(?:px|rem|em|%)|var\(--text-[\w-]+\)|clamp\([^)]*\))(?:\s*\/\s*\S+)?\s+\S/,
  );
  return size ? size[1] : "?";
}

/** Ogni dimensione di testo scritta in una regola, dalla proprietà o dalla scorciatoia. */
function fontSizes(rule: Rule): { declaration: Declaration; size: string }[] {
  return rule.declarations.flatMap((declaration) => {
    if (declaration.property === "font-size") return [{ declaration, size: declaration.value }];
    if (declaration.property === "font") {
      const size = shorthandSize(declaration.value);
      return size === null ? [] : [{ declaration, size }];
    }
    return [];
  });
}

const FIELD = /(^|[\s>+~(])(input|select|textarea)(?=$|[\s.:#[>+~)])/;
const ONLY_ELEMENTS = /^(button|input|select|textarea)$/;

const EXPECTED_TOKENS: Record<string, string> = {
  "--paper": "#ffffff",
  "--ink": "#121512",
  "--ink-2": "#394037",
  "--muted": "#5a6257",
  "--rule": "#c9cfc3",
  "--rule-soft": "#e1e5dc",
  "--tint": "#f3f5f0",
  "--green": "#1d4b07",
  "--green-2": "#2b6311",
  "--green-dark": "#15370a",
  "--green-wash": "#e4ecdb",
  "--on-green": "#ffffff",
  "--on-green-2": "#cfdec2",
  "--amber": "#875800",
  "--amber-wash": "#f6ead1",
  "--red": "#9b3b25",
  "--f-cond": '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif',
  "--f-body": 'Barlow, "Helvetica Neue", Arial, sans-serif',
  "--text-xs": "12px",
  "--text-sm": "14px",
  "--text-md": "16px",
  "--text-lg": "18px",
  "--text-xl": "24px",
  "--text-title": "clamp(28px, 4.2vw, 38px)",
  "--tap": "44px",
  "--tap-row": "40px",
  "--radius": "0px",
  "--radius-control": "2px",
  "--sidebar-width": "232px",
  "--topband-h": "52px",
  "--tabs-h": "48px",
  "--bottombar-h": "60px",
  "--ws-fixed-bottom": "0px",
  "--ws-sticky-top": "0px",
  "--gutter": "max(16px, env(safe-area-inset-left, 0px))",
  "--gutter-r": "max(16px, env(safe-area-inset-right, 0px))",
  "--ease": "cubic-bezier(0.16, 1, 0.3, 1)",
};
/** Token di stile: i moduli li usano e non li ridichiarano mai (00-sequenza, T-6). */
const STYLE_TOKEN =
  /^--(paper|ink|ink-2|muted|rule|rule-soft|tint|green|green-\w+|on-green|on-green-2|amber|amber-wash|red|f-cond|f-body|text-\w+|tap|tap-row|radius|radius-control|ease)$/;

/** Selettori numerici di 01 §7.2: quantità, importi, date, ore e codici in Condensed. */
const NUMERIC_SELECTORS: Record<string, string[]> = {
  "app/globals.css": [
    ".num",
    ".summary-cell > strong",
    ".quantity",
    ".price",
    ".product-name span",
    ".size-tag",
    ".detail-quantities strong",
    ".appointment-time",
  ],
  "components/stock-workspace.module.css": [".table td", ".quantities dd"],
  "components/packaging-workspace.module.css": [".quantities dd"],
  "components/consignment-shop.module.css": [
    ".totalNumber",
    ".figureValue",
    ".paymentAmount",
    ".financeAmount",
    ".financeTotalValue",
  ],
  "components/sales-workspace.module.css": [".total strong", ".orderSummary strong"],
  "components/finance.module.css": [".amount", ".detailAmount", ".balanceTotal > strong"],
  "components/finance-work.module.css": [".amount"],
  "components/shopify-sync-health.module.css": [".counts dd"],
};

describe("pavimento di stile dei CSS di src", () => {
  it("nessun testo sotto i 12 px", () => {
    expect(cssFiles.length).toBeGreaterThan(15);
    const problems = allRules.flatMap((rule) =>
      fontSizes(rule).flatMap(({ declaration, size }) => {
        const px = minimumPx(size);
        if (px === "inherit") return [];
        if (px === null) return [`${describeRule(rule, declaration)} (valore non verificabile)`];
        return px < 12 ? [describeRule(rule, declaration)] : [];
      }),
    );
    expect(problems).toEqual([]);
  });

  it("ogni regola su input, select o textarea porta i campi a 16 px", () => {
    const base = globals.rules.find(
      (rule) => rule.media.length === 0 && rule.selector === "input, select, textarea",
    );
    expect(base?.declarations).toContainEqual({ property: "font-size", value: "var(--text-md)" });
    const fieldRules = allRules.filter((rule) =>
      selectorParts(rule.selector).some((part) => FIELD.test(part)),
    );
    expect(fieldRules.length).toBeGreaterThan(10);
    const problems = fieldRules.flatMap((rule) =>
      fontSizes(rule).flatMap(({ declaration, size }) => {
        const px = minimumPx(size);
        // Solo le regole di base sugli elementi possono ereditare: la regola seguente le porta a 16 px.
        if (px === "inherit")
          return selectorParts(rule.selector).every((part) => ONLY_ELEMENTS.test(part))
            ? []
            : [`${describeRule(rule, declaration)} (eredita una dimensione minore)`];
        return px === null || px < 16 ? [describeRule(rule, declaration)] : [];
      }),
    );
    expect(problems).toEqual([]);
  });

  it("righe quadrate: angoli solo 0, 1px, 2px, 50% o var(--radius…)", () => {
    const allowed = /^(0|0px|1px|2px|50%|var\(--radius(-[\w-]+)?\))$/;
    const problems = allRules.flatMap((rule) =>
      rule.declarations
        .filter((declaration) => /^border(-[a-z]+)*-radius$/.test(declaration.property))
        .filter((declaration) =>
          declaration.value
            .replace(/\s*!important$/i, "")
            .split(/\s*\/\s*|\s+/)
            .some((part) => !allowed.test(part)),
        )
        .map((declaration) => describeRule(rule, declaration)),
    );
    expect(problems).toEqual([]);
  });

  it("globals.css dichiara i token del roadbook e il contratto delle barre fisse", () => {
    for (const [token, value] of Object.entries(EXPECTED_TOKENS)) {
      expect(rootTokens.get(token), token).toBe(value);
    }
    const root = globals.rules.find((rule) => rule.selector === ":root" && !rule.media.length);
    expect(root?.declarations).toContainEqual({ property: "color-scheme", value: "light" });
    const phone = globals.rules.filter((rule) =>
      rule.media.some((media) => media.replace(/\s/g, "") === "@media(max-width:760px)"),
    );
    const onPhone = (selector: string) =>
      phone.filter((rule) => rule.selector === selector).flatMap((rule) => rule.declarations);
    expect(onPhone(":root")).toContainEqual({
      property: "--ws-fixed-bottom",
      value: "calc(var(--bottombar-h) + env(safe-area-inset-bottom, 0px))",
    });
    expect(onPhone("body:has(:is(input, textarea, select):focus)")).toContainEqual({
      property: "--ws-fixed-bottom",
      value: "0px",
    });
    const body = globals.rules.find((rule) => rule.selector === "body" && !rule.media.length);
    expect(body?.declarations).toEqual(
      expect.arrayContaining([
        { property: "background", value: "var(--paper)" },
        { property: "font-size", value: "var(--text-md)" },
        { property: "font-variant-numeric", value: "tabular-nums" },
      ]),
    );
  });

  it("nessun modulo ridichiara i token di stile", () => {
    const problems = [...sheets.entries()]
      .filter(([file]) => file !== "app/globals.css")
      .flatMap(([, sheet]) =>
        sheet.rules.flatMap((rule) =>
          rule.declarations
            .filter((declaration) => STYLE_TOKEN.test(declaration.property))
            .map((declaration) => describeRule(rule, declaration)),
        ),
      );
    expect(problems).toEqual([]);
  });

  it("sei @font-face Barlow Condensed dritti: 500, 600 e 700, latin e latin-ext", () => {
    const condensed = globals.fontFaces.filter((face) =>
      face.some((d) => d.property === "font-family" && d.value === '"Barlow Condensed"'),
    );
    expect(condensed).toHaveLength(6);
    const found = condensed
      .map((face) => {
        const get = (property: string) => face.find((d) => d.property === property)?.value;
        expect(get("font-style")).toBe("normal");
        expect(get("font-display")).toBe("swap");
        expect(get("unicode-range")).toBeTruthy();
        return `${get("font-weight")} ${get("src")}`;
      })
      .sort();
    expect(found).toEqual(
      ["500", "600", "700"]
        .flatMap((weight) =>
          ["latin", "latin-ext"].map(
            (subset) =>
              `${weight} url("/fonts/barlow-condensed-${weight}-${subset}.woff2") format("woff2")`,
          ),
        )
        .sort(),
    );
  });

  it("ogni carattere citato da globals.css esiste in public/fonts", () => {
    const urls = globals.fontFaces.flatMap((face) =>
      face
        .filter((d) => d.property === "src")
        .flatMap((d) => [...d.value.matchAll(/url\("?([^")]+)"?\)/g)].map((match) => match[1])),
    );
    expect(urls.length).toBeGreaterThanOrEqual(10);
    for (const url of urls) {
      expect(url, url).toMatch(/^\/fonts\/[\w.-]+$/);
      expect(existsSync(join(ROOT, "public", url)), url).toBe(true);
    }
    expect(urls.some((url) => /italic/i.test(url))).toBe(false);
  });

  it("pulsanti da 44 px: .button e .icon-button", () => {
    const declarationsOfSelector = (selector: string) =>
      globals.rules
        .filter((rule) => !rule.media.length && rule.selector === selector)
        .flatMap((rule) => rule.declarations);
    expect(declarationsOfSelector(".button")).toEqual(
      expect.arrayContaining([
        { property: "min-height", value: "var(--tap)" },
        // Anche un'etichetta corta («Oggi» del calendario) resta un bersaglio da 44 px.
        { property: "min-width", value: "var(--tap)" },
      ]),
    );
    expect(declarationsOfSelector(".icon-button")).toEqual(
      expect.arrayContaining([
        { property: "min-height", value: "var(--tap)" },
        { property: "min-width", value: "var(--tap)" },
      ]),
    );
    const shrunk = allRules.flatMap((rule) =>
      selectorParts(rule.selector).some((part) => /(^|\s)\.(button|icon-button)$/.test(part))
        ? rule.declarations
            .filter((d) => /^min-(height|width)$/.test(d.property) && d.value !== "var(--tap)")
            .map((d) => describeRule(rule, d))
        : [],
    );
    expect(shrunk).toEqual([]);
  });

  it("numeri, importi e codici in Barlow Condensed", () => {
    const num = globals.rules.find((rule) => rule.selector === ".num" && !rule.media.length);
    expect(num?.declarations).toContainEqual({
      property: "font-variant-numeric",
      value: "tabular-nums",
    });
    const missing = Object.entries(NUMERIC_SELECTORS).flatMap(([file, selectors]) => {
      const sheet = sheets.get(file);
      expect(sheet, file).toBeDefined();
      return selectors.filter(
        (selector) =>
          !sheet!.rules.some(
            (rule) =>
              !rule.media.length &&
              selectorParts(rule.selector).includes(selector) &&
              rule.declarations.some(
                (d) => d.property === "font-family" && d.value === "var(--f-cond)",
              ),
          ),
      );
    });
    expect(missing).toEqual([]);
  });
});
