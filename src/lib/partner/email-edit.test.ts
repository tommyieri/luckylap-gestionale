import { describe, it, expect } from "vitest";
import { parsePartnerEmailEdit, partnerEmailDetailFrom, partnerEmailEditError } from "./email-edit";
import { partnerEmailFixtureDetail } from "./email-program-fixtures";
const id = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = {
  kind: "save",
  operationId: id(1),
  payload: {
    schema_version: 1,
    hold_id: id(2),
    expected_hold_version: 1,
    expected_draft_id: id(201),
    expected_sha256: "c".repeat(64),
    subject: "LuckyLap per il Club Esempio",
    body: "Buongiorno,\n\nUn prodotto pensato per i soci.\n\nUn saluto,",
  },
};
describe("revisione email: contratto del browser", () => {
  it("preserva il testo scelto, senza imporre domanda, telefono o firma nel corpo", () => {
    expect(parsePartnerEmailEdit(base)).toEqual(base);
  });
  it.each([
    { ...base, operationId: "errato" },
    { ...base, actorId: id(3) },
    { ...base, payload: { ...base.payload, body: "" } },
    { ...base, payload: { ...base.payload, subject: "oggetto\r\nBcc: example" } },
    { ...base, payload: { ...base.payload, body: "testo\u0007" } },
    { ...base, payload: { ...base.payload, body: "a".repeat(8001) } },
    { ...base, payload: { ...base.payload, expected_hold_version: 0 } },
    { ...base, payload: { ...base.payload, expected_sha256: "" } },
    { ...base, payload: { ...base.payload, signature: "Firma inventata" } },
  ])("rifiuta dati che non rispettano il contratto SQL", (value) => {
    expect(parsePartnerEmailEdit(value)).toBeNull();
  });
  it("ammette esattamente ottomila caratteri", () => {
    expect(
      parsePartnerEmailEdit({ ...base, payload: { ...base.payload, body: "a".repeat(8000) } }),
    ).not.toBeNull();
  });
  it("l'annullamento porta lo stesso hold e la versione della bozza", () => {
    expect(
      parsePartnerEmailEdit({
        kind: "cancel",
        operationId: id(4),
        payload: {
          schema_version: 1,
          hold_id: id(2),
          expected_hold_version: 1,
          expected_draft_id: id(201),
        },
      }),
    ).not.toBeNull();
  });
  it("non inoltra MIME o campi inattesi dal dettaglio al browser", () => {
    const detail = partnerEmailFixtureDetail("2026-11-04", "job", id(1))!;
    const parsed = partnerEmailDetailFrom({
      ...detail,
      raw: "PRIVATE MIME",
      secret: "PRIVATE",
      researchSources: ["https://club.example.test", { url: "javascript:alert(1)" }],
    });
    expect(parsed).not.toHaveProperty("raw");
    expect(parsed).not.toHaveProperty("secret");
    expect(parsed.researchSources).toEqual([
      { title: "https://club.example.test", url: "https://club.example.test" },
    ]);
  });
  it("un timeout non viene presentato come rifiuto certo o salvataggio riuscito", () => {
    expect(partnerEmailEditError({ message: "PRIVATE", code: "57014" })).toMatchObject({
      status: "uncertain",
    });
    expect(JSON.stringify(partnerEmailEditError({ message: "PRIVATE" }))).not.toContain("PRIVATE");
  });
});
