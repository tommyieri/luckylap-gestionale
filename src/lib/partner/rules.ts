// Partner: «Regole per scrivere i messaggi» da CONTESTO.md dell'ultimo import (spec 02 §5.9).
//
// Il file diventa blocchi di testo semplice: righe con # sono titoli, righe con - o * punti
// elenco, le tabelle restano testo a spaziatura fissa, il resto paragrafi. Nessun HTML dal file:
// la pagina mostra solo testo, quindi un tag nel file resta un tag scritto.

export type PartnerRuleBlock =
  | { kind: "heading"; level: 2 | 3 | 4; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; text: string }
  | { kind: "paragraph"; text: string };

/** Toglie i segni di enfasi e i link Markdown più comuni, lasciando il testo leggibile. */
export function plainMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((?:[^)\s]+)\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function partnerRuleBlocks(markdown: string): PartnerRuleBlock[] {
  const blocks: PartnerRuleBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let table: string[] = [];
  const flush = () => {
    if (paragraph.length)
      blocks.push({ kind: "paragraph", text: plainMarkdown(paragraph.join(" ")) });
    if (list.length) blocks.push({ kind: "list", items: list });
    if (table.length) blocks.push({ kind: "table", text: table.join("\n") });
    paragraph = [];
    list = [];
    table = [];
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (line.trim() === "" || /^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flush();
    } else if (heading) {
      flush();
      const level = Math.min(4, Math.max(2, heading[1].length + 1)) as 2 | 3 | 4;
      blocks.push({ kind: "heading", level, text: plainMarkdown(heading[2].replace(/#+$/, "")) });
    } else if (/^\s*\|/.test(line)) {
      if (paragraph.length || list.length) {
        const kept = table;
        table = [];
        flush();
        table = kept;
      }
      table.push(line.trim());
    } else if (item) {
      if (paragraph.length || table.length) flush();
      list.push(plainMarkdown(item[1]));
    } else if (list.length && /^\s{2,}\S/.test(raw)) {
      // Continuazione del punto precedente.
      list[list.length - 1] = `${list[list.length - 1]} ${plainMarkdown(line)}`;
    } else {
      if (list.length || table.length) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}
