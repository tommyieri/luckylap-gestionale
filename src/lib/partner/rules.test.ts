import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { partnerRuleBlocks, plainMarkdown } from "./rules";

// Spec 02 §5.9: CONTESTO.md come testo semplice, senza HTML dal file.
describe("regole per scrivere i messaggi", () => {
  it("titoli, punti elenco, paragrafi e tabelle a spaziatura fissa", () => {
    expect(
      partnerRuleBlocks(
        [
          "# Regole",
          "",
          "Testo **in grassetto** con un [link](https://example.test/regole).",
          "che continua.",
          "",
          "## Tono",
          "- Frasi brevi.",
          "* Niente superlativi,",
          "  anche nei solleciti.",
          "",
          "| Lingua | Firma |",
          "| --- | --- |",
          "| it | Il team |",
          "---",
          "#### Dettaglio",
        ].join("\n"),
      ),
    ).toEqual([
      { kind: "heading", level: 2, text: "Regole" },
      { kind: "paragraph", text: "Testo in grassetto con un link. che continua." },
      { kind: "heading", level: 3, text: "Tono" },
      { kind: "list", items: ["Frasi brevi.", "Niente superlativi, anche nei solleciti."] },
      { kind: "table", text: "| Lingua | Firma |\n| --- | --- |\n| it | Il team |" },
      { kind: "heading", level: 4, text: "Dettaglio" },
    ]);
  });

  it("l'HTML resta testo: nessun tag viene interpretato", () => {
    const blocks = partnerRuleBlocks('<script>alert("x")</script>\n- <b>punto</b>');
    expect(blocks).toEqual([
      { kind: "paragraph", text: '<script>alert("x")</script>' },
      { kind: "list", items: ["<b>punto</b>"] },
    ]);
    expect(plainMarkdown("`codice` e __forte__")).toBe("codice e forte");
  });

  it("legge il CONTESTO.md sintetico dell'harness senza perdere righe", () => {
    const text = readFileSync(
      join(__dirname, "../../../supabase/tests/fixtures/partner/CONTESTO.md"),
      "utf8",
    );
    const blocks = partnerRuleBlocks(text);
    expect(blocks.length).toBeGreaterThan(2);
    expect(blocks[0].kind).toBe("heading");
    expect(partnerRuleBlocks("")).toEqual([]);
    expect(partnerRuleBlocks("\r\n\r\n")).toEqual([]);
  });
});
