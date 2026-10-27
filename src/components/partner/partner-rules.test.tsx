import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PartnerRuleText, PartnerRulesView } from "./partner-rules";
import { partnerFixtureRules } from "../../lib/partner/fixtures";

// Il renderer delle regole è uno solo: /partner/regole e le regole dell'assistente lo condividono.
const TODAY = "2026-10-22";
const TEXT = [
  "# Titolo",
  "",
  "Un paragrafo con **enfasi**.",
  "",
  "## Sezione",
  "",
  "- primo",
  "- secondo",
  "",
  "### Dettaglio",
  "",
  "| Lingua | Firma |",
  "| --- | --- |",
  "",
  "#### Quarto livello",
].join("\n");

/** Ogni blocco come «tag testo», nell'ordine della pagina. */
const blocks = (html: string) =>
  [...html.matchAll(/<(h[1-6]|p|ul|li|pre)\b[^>]*>([^<]*)/g)].map(([, tag, text]) =>
    `${tag} ${text}`.trim(),
  );

describe("PartnerRuleText", () => {
  it("un elemento per ogni tipo di blocco, titoli al livello del file", () => {
    expect(blocks(renderToStaticMarkup(<PartnerRuleText text={TEXT} />))).toEqual([
      "h2 Titolo",
      "p Un paragrafo con enfasi.",
      "h3 Sezione",
      "ul",
      "li primo",
      "li secondo",
      "h4 Dettaglio",
      "pre | Lingua | Firma |\n| --- | --- |",
      "h4 Quarto livello",
    ]);
  });

  it("headingShift abbassa i titoli di un livello, fino a h4; il resto non cambia", () => {
    expect(blocks(renderToStaticMarkup(<PartnerRuleText text={TEXT} headingShift={1} />))).toEqual([
      "h3 Titolo",
      "p Un paragrafo con enfasi.",
      "h4 Sezione",
      "ul",
      "li primo",
      "li secondo",
      "h4 Dettaglio",
      "pre | Lingua | Firma |\n| --- | --- |",
      "h4 Quarto livello",
    ]);
  });

  it("un tag nel testo resta testo", () => {
    const html = renderToStaticMarkup(<PartnerRuleText text={"<b>grassetto</b>"} />);
    expect(html).toBe("<p>&lt;b&gt;grassetto&lt;/b&gt;</p>");
  });
});

describe("PartnerRulesView", () => {
  it("/partner/regole mostra CONTESTO.md con lo stesso renderer, titoli al livello del file", () => {
    const rules = partnerFixtureRules(TODAY)!;
    const html = renderToStaticMarkup(
      <PartnerRulesView rules={rules} today={TODAY} preview={false} />,
    );
    expect(html).toContain(renderToStaticMarkup(<PartnerRuleText text={rules.contextMd} />));
    expect(blocks(html).filter((block) => /^h[1-6] /.test(block))).toEqual([
      "h1 Regole per scrivere",
      "h2 Regole sintetiche per i messaggi",
      "h3 Tono",
      "h3 Firma",
    ]);
  });
});
