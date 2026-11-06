import type { PartnerEmailConfig } from "./email-config";

type ActiveFormat = Exclude<PartnerEmailConfig["formati"][number], { id: "club" }>;
export type PartnerEmailFormatId = ActiveFormat["id"];
export type PartnerEmailTrack = "A" | "B";

export type PartnerEmailPromptContext = {
  /** Indici nella lista delle possibilità di questo formato e di questa versione, ammessi dal chiamante. */
  eligiblePossibilityIndexes: readonly number[];
  /** Scheda, scelta e ricerca già delimitate ed escapate come dati dal chiamante. */
  contactData: string;
};

const EXAMPLE_BLOCKS = [
  "oggetto",
  "saluto",
  "hook",
  "presentazione",
  "correlazioni",
  "proposta",
  "cta",
  "chiusura",
] as const;

/** Compone il testo della vista «Il testo che riceve l'assistente» per un formato attivo. */
export function composeWriterPrompt(
  config: PartnerEmailConfig,
  formato: PartnerEmailFormatId,
  filone: PartnerEmailTrack,
  contesto: PartnerEmailPromptContext,
): string {
  const format = config.formati.find(
    (candidate): candidate is ActiveFormat => candidate.id !== "club" && candidate.id === formato,
  );
  if (!format) throw new RangeError("Formato email non disponibile per la composizione.");

  const track = format.filoni[filone];
  const primary =
    format.id === "negozio" && filone === "B"
      ? format.filoni.B.proposta_principale
      : format.proposta_principale;
  const eligible = new Set(contesto.eligiblePossibilityIndexes);
  const possibilities = format.possibilita.filter(
    (option, index) => option.attiva && eligible.has(index),
  );
  const lines = [
    `PRIMA EMAIL · ${format.nome} · filone ${filone}: ${track.nome}`,
    "",
    "TONO",
    config.tono,
    "",
    "PROPOSTA PRINCIPALE",
    primary,
  ];
  if (possibilities.length) {
    lines.push(
      "Possibilità che puoi aggiungere (una o due, solo se adatte; il sistema ti dice quali sono ammesse per questo contatto):",
      ...possibilities.map((option) => `- ${option.testo} (${option.quando})`),
    );
  }
  lines.push(
    "Domande da usare (scegline una):",
    ...format.domande.map((question) => `- ${question}`),
    "",
    "QUANDO SI USA QUESTO FILONE",
    track.quando,
    "",
    "SCRIVI LA MAIL IN QUESTO ORDINE, UN PARAGRAFO PER BLOCCO",
  );

  config.blocchi.forEach((block, index) => {
    if (block.bloccato) {
      lines.push("", `${index}. ${block.nome}: non scriverlo, lo aggiunge il sistema.`);
      return;
    }
    const range = block.parole ? ` (${block.parole[0]}–${block.parole[1]} parole)` : "";
    lines.push("", `${index}. ${block.nome}${range}`, block.cosa_fa);
    const note = format.note[block.id];
    if (note) lines.push(`Per ${format.nome}: ${note}`);
    lines.push(`Regole fisse: ${block.fisse.join(" ")}`);
  });

  lines.push(
    "",
    "REGOLE GENERALI FISSE",
    ...config.regole_fisse_generali.map((rule) => `- ${rule}`),
    "",
    "ESEMPIO DEL RISULTATO (dati inventati, non copiarlo)",
    ...EXAMPLE_BLOCKS.map((block) => track.esempio[block]),
    "",
    "DATI DEL CONTATTO (inseriti dal sistema): fatto e fonte, data della ricerca, lingua, forma di cortesia, destinatario, nome, giorni all'evento, possibilità ammesse.",
  );
  if (contesto.contactData) lines.push("", contesto.contactData);
  return lines.join("\n");
}
