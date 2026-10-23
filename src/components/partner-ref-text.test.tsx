import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PartnerRefText } from "./partner-ref-text";

const html = (text: string) => renderToStaticMarkup(<PartnerRefText text={text} />);

describe("PartnerRefText", () => {
  it("il percorso della scheda diventa il link «Apri la scheda»", () => {
    const out = html("Partner CO 6 · /partner?co=6#lead-6");
    expect(out).toContain('href="/partner?co=6#lead-6"');
    expect(out).toContain("Apri la scheda");
    expect(out).toContain("Partner CO 6 · ");
    expect(out).not.toContain(">/partner?co=6");
  });

  it("tiene il testo prima e dopo il percorso", () => {
    const out = html("Verificare condizioni. Partner CO 12 · /partner?co=12#lead-12 Grazie");
    expect(out.startsWith("Verificare condizioni. Partner CO 12 · ")).toBe(true);
    expect(out).toContain('href="/partner?co=12#lead-12"');
    expect(out.endsWith(" Grazie")).toBe(true);
  });

  it("senza percorso, o con CO diversi tra query e ancora, il testo resta testo", () => {
    expect(html("Chiamare il negozio")).toBe("Chiamare il negozio");
    expect(html("/partner?co=6#lead-7")).toBe("/partner?co=6#lead-7");
    expect(html("/partner?co=6#lead-60")).toBe("/partner?co=6#lead-60");
  });
});
