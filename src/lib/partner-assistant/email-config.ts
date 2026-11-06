import { z } from "zod";
import { charCount, hasControlCharacters } from "../partner/model";

const MIN_WORDS = 110;
const MAX_WORDS = 160;
const TEXT_LIMIT = 1000;

// Controlla i campi senza cambiare il testo che entrerà nel prompt.
const text = z
  .string()
  .refine((value) => charCount(value) <= TEXT_LIMIT, `Usa al massimo ${TEXT_LIMIT} caratteri.`)
  .refine(
    (value) => value.isWellFormed() && !hasControlCharacters(value),
    "Il testo contiene caratteri non validi.",
  );
const instruction = text.refine((value) => /\S/u.test(value), "Scrivi un testo.");
const question = instruction.refine(
  (value) => value.split("?").length === 2,
  "Ogni domanda deve contenere un solo punto interrogativo.",
);
const version = z.number().int().min(1).max(2_147_483_647);
const words = z.number().int().min(1).max(MAX_WORDS);
const range = z
  .tuple([words, words])
  .refine(([min, max]) => min <= max, "Il minimo non può superare il massimo.");

const block = z.strictObject({
  nome: instruction,
  cosa_fa: instruction,
  fisse: z.array(instruction).min(1).max(32),
  bloccato: z.literal(false).optional(),
});

function uncountedBlock<const Id extends string>(id: Id) {
  return block.extend({ id: z.literal(id), parole: z.null() });
}

function countedBlock<const Id extends string>(id: Id) {
  return block.extend({ id: z.literal(id), parole: range });
}

const example = z.strictObject({
  destinatario: instruction,
  oggetto: instruction,
  saluto: instruction,
  hook: instruction,
  presentazione: instruction,
  correlazioni: instruction,
  proposta: instruction,
  cta: instruction,
  chiusura: instruction,
});

const notes = z.strictObject({
  oggetto: text.optional(),
  saluto: text.optional(),
  hook: text.optional(),
  presentazione: text.optional(),
  correlazioni: text.optional(),
  proposta: text.optional(),
  cta: text.optional(),
  chiusura: text.optional(),
});

const draftTrack = z.strictObject({ nome: instruction, quando: instruction, esempio: example });
const activeTrack = draftTrack.extend({ sottotipi: z.array(instruction).min(1).max(32) });
const possibility = z.strictObject({
  testo: instruction,
  quando: instruction,
  attiva: z.boolean(),
});
const attachment = z.strictObject({ attuale: instruction, possibile: instruction, nota: text });
const formatFields = z.strictObject({
  nome: instruction,
  breve: instruction,
  quando: instruction,
  proposta_principale: instruction,
});

function activeFormat<const Id extends string, const Code extends string>(id: Id, code: Code) {
  return formatFields.extend({
    id: z.literal(id),
    codice_proposta: z.literal(code),
    allegato: attachment.extend({ stato: z.literal("disattivato") }),
    possibilita: z.array(possibility.extend({ automatica: z.boolean() })).max(32),
    domande: z.array(question).min(1).max(32),
    filoni: z.strictObject({ A: activeTrack, B: activeTrack }),
    note: notes,
  });
}

const shop = activeFormat("negozio", "vendita_negozio").extend({
  filoni: z.strictObject({
    A: activeTrack,
    B: activeTrack.extend({ proposta_principale: instruction }),
  }),
});

const club = formatFields.extend({
  id: z.literal("club"),
  codice_proposta: z.literal("merch_cobranding"),
  allegato: attachment.extend({ stato: z.literal("attivo") }),
  modello_fisso: z.literal(true),
  v3: z.strictObject({
    nota: instruction,
    mappa: z
      .array(
        z.strictObject({
          blocco: z.enum([
            "saluto",
            "hook",
            "presentazione",
            "correlazioni",
            "proposta",
            "cta",
            "chiusura",
          ]),
          testo: instruction,
        }),
      )
      .length(7),
    osservazioni: z.array(instruction).min(1).max(32),
  }),
  struttura_alternativa: z.strictObject({
    stato: z.literal("spenta"),
    nota: instruction,
    possibilita: z.array(possibility).max(32),
    domande: z.array(question).min(1).max(32),
    filoni: z.strictObject({ A: draftTrack, B: draftTrack }),
  }),
});

function language<const Code extends string>(code: Code) {
  return z.strictObject({
    codice: z.literal(code),
    nome: instruction,
    registro: instruction,
    saluto: instruction,
    chiusura: instruction,
    cta: question,
    note: text,
  });
}

const technicalNotes = z.strictObject({
  risoluzione_formato: z.strictObject({
    nota: instruction,
    regole: z
      .array(
        z.strictObject({
          ordine: z.number().int().positive(),
          se: instruction,
          allora: instruction,
        }),
      )
      .min(1)
      .max(32),
  }),
  scelta_filone: z.strictObject({
    regola: instruction,
    campi_nuovi: z.array(instruction).min(1).max(32),
  }),
  regole_da_preservare: z
    .array(
      z.strictObject({
        testo: instruction,
        fonte: instruction,
        tipo: z.enum(["Codice", "Prompt", "Base"]),
      }),
    )
    .min(1)
    .max(64),
  modifiche: z
    .array(
      z.strictObject({
        id: instruction,
        titolo: instruction,
        prima: instruction,
        dopo: instruction,
        dove: instruction,
      }),
    )
    .max(64),
});

export const partnerEmailConfigSchema = z
  .strictObject({
    meta: z.strictObject({
      titolo: instruction,
      versione: version,
      data: z.iso.date(),
      base_codice: z.string().regex(/^[a-f0-9]{7,40}$/u),
      limite_totale: z.tuple([z.literal(MIN_WORDS), z.literal(MAX_WORDS)]),
      conteggio: instruction,
    }),
    tono: instruction,
    regole_fisse_generali: z.array(instruction).min(1).max(32),
    blocchi: z.tuple([
      uncountedBlock("oggetto"),
      uncountedBlock("saluto"),
      countedBlock("hook"),
      countedBlock("presentazione"),
      countedBlock("correlazioni"),
      countedBlock("proposta"),
      countedBlock("cta"),
      uncountedBlock("chiusura"),
      uncountedBlock("firma").extend({ bloccato: z.literal(true) }),
    ]),
    formati: z.tuple([
      activeFormat("evento_vicino", "stand_evento"),
      activeFormat("evento_lontano", "merch_cobranding"),
      activeFormat("brand", "collab_capsule"),
      activeFormat("media", "collab_capsule"),
      shop,
      club,
    ]),
    lingue: z.tuple([
      language("it"),
      language("en"),
      language("de"),
      language("fr"),
      language("es"),
    ]),
    lingue_nota: instruction,
    per_il_tecnico: technicalNotes,
    storico: z
      .array(
        z.strictObject({
          versione: version,
          data: instruction,
          nota: text,
          modifiche: z.array(instruction).max(64),
        }),
      )
      .min(1)
      .max(128),
  })
  .superRefine((config, context) => {
    let min = 0;
    let max = 0;
    for (const { parole } of config.blocchi) {
      if (parole === null) continue;
      min += parole[0];
      max += parole[1];
    }
    if (min < MIN_WORDS || max > MAX_WORDS) {
      context.addIssue({
        code: "custom",
        path: ["blocchi"],
        message: `I blocchi sommano ${min}–${max} parole. La somma deve rientrare tra ${MIN_WORDS} e ${MAX_WORDS} parole.`,
      });
    }
  });

export type PartnerEmailConfig = z.infer<typeof partnerEmailConfigSchema>;

function fixedFields(config: PartnerEmailConfig) {
  const { versione: _versione, ...meta } = config.meta;
  return {
    meta,
    regole_fisse_generali: config.regole_fisse_generali,
    lingue: config.lingue,
    lingue_nota: config.lingue_nota,
    per_il_tecnico: config.per_il_tecnico,
    storico: config.storico,
    blocchi: config.blocchi.map((item) =>
      item.bloccato
        ? item
        : { id: item.id, nome: item.nome, fisse: item.fisse, bloccato: item.bloccato },
    ),
    formati: config.formati.map((format) => {
      if (format.id === "club") return format;
      const { A, B } = format.filoni;
      return {
        id: format.id,
        nome: format.nome,
        breve: format.breve,
        quando: format.quando,
        codice_proposta: format.codice_proposta,
        allegato: format.allegato,
        filoni: {
          A: { esempio: A.esempio, sottotipi: A.sottotipi },
          B: { esempio: B.esempio, sottotipi: B.sottotipi },
        },
        condizioni_automatiche: format.possibilita
          .filter((option) => option.automatica)
          .map((option) => option.quando),
      };
    }),
  };
}

/** L'ordine delle chiavi di un oggetto può cambiare nel passaggio in JSONB. */
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
    );
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null)
    return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
  );
}

/** Confronta due configurazioni già validate prima di salvare una nuova versione. */
export function partnerEmailConfigFixedFieldsMatch(
  before: PartnerEmailConfig,
  after: PartnerEmailConfig,
): boolean {
  return sameJson(fixedFields(before), fixedFields(after));
}
