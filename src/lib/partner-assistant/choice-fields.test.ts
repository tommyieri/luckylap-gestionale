// Senza il mock di server-only, che nei test non è installato: un modulo che carica lo store non si
// importa. La lettura della scelta e i prompt devono restare moduli puri, senza lo store.
import { describe, expect, it } from "vitest";

describe("chiavi e campi della scelta in un modulo puro", () => {
  it("choice.ts e prompts.ts si caricano senza lo store", async () => {
    await expect(import("./choice")).resolves.toHaveProperty("parsePartnerAssistantChoice");
    await expect(import("./prompts")).resolves.toHaveProperty("writeCall");
  });

  it("lo store invece non si carica senza server-only: il test qui sopra prova qualcosa", async () => {
    await expect(import("./store")).rejects.toThrow();
  });

  it("le 23 chiavi dell'Appendice C, senza la richiesta, e la loro lettura", async () => {
    const { PARTNER_ASSISTANT_CHOICE_KEYS, partnerAssistantChoiceFields } =
      await import("./choice-fields");
    expect(PARTNER_ASSISTANT_CHOICE_KEYS).toHaveLength(23);
    expect(PARTNER_ASSISTANT_CHOICE_KEYS).not.toContain("request");
    expect(partnerAssistantChoiceFields({ contact_kind: "club" })).toBeNull();
  });
});
