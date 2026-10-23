import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { TshirtAvailability } from "./tshirt-availability";
import { loadInventory } from "../lib/inventory";
import { previewMagadzinoAvailability } from "../lib/inventory/tshirt-fixtures";
import { countTshirtLines, type TshirtLineCount } from "../lib/inventory/tshirt-lines";

const { items } = loadInventory();
const lines = countTshirtLines(items, previewMagadzinoAvailability(items));
const html = (activeModel: string | null = null, value: TshirtLineCount[] | null = lines) =>
  renderToStaticMarkup(
    <TshirtAvailability lines={value} activeModel={activeModel} preview={false} />,
  );
const tiles = (markup: string) => [...markup.matchAll(/<a [^>]*>/g)].map((match) => match[0]);
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("riquadri «Magliette disponibili»", () => {
  it("titolo e sei riquadri nell'ordine della mappa, ognuno un link al filtro", () => {
    const markup = html();
    expect(markup).toContain(">Magliette disponibili</h2>");
    expect(tiles(markup).map((tag) => attr(tag, "href"))).toEqual([
      "/stock?modello=964",
      "/stock?modello=GT3RS",
      "/stock?modello=SENNA",
      "/stock?modello=F40",
      "/stock?modello=TESTAROSSA",
      "/stock?modello=SL",
    ]);
    expect(markup.match(/<img [^>]*>/g)?.map((tag) => attr(tag, "alt"))).toEqual([
      "964",
      "GT3RS",
      "Project’88",
      "F40",
      "512TR",
      "300SL",
    ]);
    expect(markup).toContain(
      'srcSet="/tshirt-icons/964-96.webp 96w, /tshirt-icons/964-192.webp 192w"',
    );
  });

  it("numero grande, conteggi per colore con due colori e taglie a zero", () => {
    const t = text(html());
    // Numeri sintetici dell'anteprima: 964 bianca 20 e blu 19, L blu a zero.
    expect(t).toContain("964 39 20 · 19 Manca L blu");
    expect(t).toContain("GT3RS 18 6 · 12 Mancano XS, L, XXL bianca");
    expect(t).toContain("Project’88 27 Bianca");
    expect(t).toContain("512TR 6 Bianca Mancano XS–M");
    expect(t).toContain("300SL 8 Azzurra Mancano XL, XXL");
  });

  it("lo zero si vede attenuato e con la parola «Esaurita»", () => {
    const markup = html();
    const states = tiles(markup).map((tag) => attr(tag, "data-state"));
    expect(states).toEqual([
      "available",
      "available",
      "available",
      "empty",
      "available",
      "available",
    ]);
    expect(text(markup)).toContain("F40 0 Bianca Esaurita");
    expect(attr(tiles(markup)[3], "aria-label")).toBe(
      "F40: 0 disponibili. Esaurita. Tocca per vederla nella tabella.",
    );
  });

  it("il riquadro del filtro attivo è segnato e toglie il filtro", () => {
    const active = tiles(html("senna"));
    expect(active.map((tag) => attr(tag, "aria-current") ?? null)).toEqual([
      null,
      null,
      "true",
      null,
      null,
      null,
    ]);
    expect(attr(active[2], "href")).toBe("/stock");
    expect(attr(active[2], "aria-label")).toContain("Filtro attivo");
  });

  it("senza icona: le iniziali sul colore della maglietta", () => {
    const noIcon = lines.map((count) =>
      count.line.key === "300sl" ? { ...count, line: { ...count.line, icon: null } } : count,
    );
    const markup = html(null, noIcon);
    expect(markup).toContain('data-swatch="sky"><span');
    expect(markup).toContain('role="img" aria-label="300SL">300</span>');
    expect(markup.match(/<img /g)).toHaveLength(5);
  });

  it("lettura non riuscita: un avviso con «Riprova», nessun numero", () => {
    const markup = html(null, null);
    expect(markup).toContain('role="status"');
    expect(text(markup)).toContain("Le magliette disponibili non si leggono adesso.");
    expect(text(markup)).toContain("Riprova");
    expect(tiles(markup)).toEqual([]);
  });

  it("anteprima: lo dice sopra i riquadri", () => {
    const markup = renderToStaticMarkup(
      <TshirtAvailability lines={lines} activeModel={null} preview />,
    );
    expect(text(markup)).toContain("Anteprima locale: numeri sintetici");
  });
});
