import { describe, expect, it } from "vitest";
import seed from "../../../data/partner-email-config-v1.json";
import { checkPartnerAssistantDraft, partnerAssistantSignature } from "./checks";
import { partnerEmailConfigFixedFieldsMatch, partnerEmailConfigSchema } from "./email-config";

const initial = partnerEmailConfigSchema.parse(seed);
const config = () => structuredClone(initial);

describe("Configurazione della prima email Partner", () => {
  it("carica tutto il seed, incluso il modello Club e la proposta del Negozio B", () => {
    expect(initial).toEqual(seed);
    expect(initial.formati[4].filoni.B.proposta_principale).toBe(
      "Sviluppare insieme una grafica dedicata all’officina, pensata per i suoi clienti.",
    );
    expect(initial.formati[5].struttura_alternativa.stato).toBe("spenta");
  });

  it("conserva le istruzioni esatte e lascia modificare il budget dentro 110–160", () => {
    const input = config();
    input.tono = "  Scrivi così.\r\n\tMantieni «queste parole».  ";
    input.formati[2].note.hook = "\n  Nota solo per Brand.  \n";
    input.formati[3].note = {};
    input.blocchi[2].parole[0] = 21;
    input.blocchi[6].parole[1] = 19;
    expect(partnerEmailConfigSchema.parse(input)).toEqual(input);
    expect(partnerEmailConfigFixedFieldsMatch(initial, input)).toBe(true);
  });

  it("rifiuta una somma minima sotto 110 o una massima sopra 160", () => {
    const minimum = config();
    minimum.blocchi[2].parole[0] = 19;
    const maximum = config();
    maximum.blocchi[6].parole[1] = 21;
    for (const input of [minimum, maximum]) {
      const result = partnerEmailConfigSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual(["blocchi"]);
    }
  });

  it.each(["Vi interessa collaborare", "Vi interessa? Rispondete?"])(
    "rifiuta la domanda senza un solo punto interrogativo (%s)",
    (value) => {
      const input = config();
      input.formati[2].domande = [value];
      expect(partnerEmailConfigSchema.safeParse(input).success).toBe(false);
    },
  );

  it("rifiuta chiavi sconosciute, istruzioni troppo lunghe e l'attivazione della struttura Club", () => {
    expect(partnerEmailConfigSchema.safeParse({ ...config(), extra: true }).success).toBe(false);
    expect(
      partnerEmailConfigSchema.safeParse({ ...config(), tono: "a".repeat(1001) }).success,
    ).toBe(false);
    const input = config();
    const formats = input.formati.map((format) =>
      format.id === "club"
        ? { ...format, struttura_alternativa: { ...format.struttura_alternativa, stato: "attiva" } }
        : format,
    );
    expect(partnerEmailConfigSchema.safeParse({ ...input, formati: formats }).success).toBe(false);
  });

  it("riconosce i campi fissi anche quando JSONB cambia l'ordine delle chiavi", () => {
    const reordered = config();
    const { attuale, possibile, nota, stato } = reordered.formati[5].allegato;
    reordered.formati[5].allegato = { stato, nota, possibile, attuale };
    reordered.meta.versione += 1;
    expect(partnerEmailConfigFixedFieldsMatch(initial, reordered)).toBe(true);

    const changes = [
      (input: typeof initial) => (input.blocchi[2].fisse[0] = "Regola alterata."),
      (input: typeof initial) => (input.formati[0].possibilita[0].quando = "Sempre."),
      (input: typeof initial) => (input.formati[2].filoni.A.esempio.hook = "Esempio alterato."),
      (input: typeof initial) => (input.formati[5].v3.mappa[0].testo = "Modello alterato."),
    ];
    for (const change of changes) {
      const input = config();
      change(input);
      expect(partnerEmailConfigFixedFieldsMatch(initial, input)).toBe(false);
    }
  });

  it("mantiene i dieci esempi del seed conformi ai controlli di contenuto correnti", () => {
    const phone = "+390000000000";
    const signature = partnerAssistantSignature("it", phone);
    for (const format of initial.formati) {
      if (format.id === "club") continue;
      for (const [track, { esempio }] of Object.entries(format.filoni)) {
        const body = [
          esempio.saluto,
          esempio.hook,
          esempio.presentazione,
          esempio.correlazioni,
          esempio.proposta,
          esempio.cta,
          esempio.chiusura,
        ].join("\n\n");
        const label = `${format.nome}, filone ${track}`;
        expect(body.match(/\?/gu), label).toHaveLength(1);
        expect(
          checkPartnerAssistantDraft(
            { subject: esempio.oggetto, body, signature, language: "it", rulesVersion: 1 },
            { phone, porscheCommunity: false, currentRulesVersion: 1, names: [] },
          ),
          label,
        ).toEqual({ ok: true });
      }
    }
  });
});
