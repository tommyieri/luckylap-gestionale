import { describe, expect, it } from "vitest";
import { isLocalPreviewEnabled } from "./runtime";

describe("anteprima locale senza accesso pubblico implicito", () => {
  it("resta chiusa senza flag esplicito", () => {
    expect(isLocalPreviewEnabled({})).toBe(false);
  });
  it("abilita solo l'anteprima esplicitamente configurata", () => {
    expect(isLocalPreviewEnabled({ LUCKYLAP_LOCAL_PREVIEW: "true" })).toBe(true);
  });
  it("non espone l'inventario su Vercel nemmeno con flag anteprima", () => {
    expect(isLocalPreviewEnabled({ LUCKYLAP_LOCAL_PREVIEW: "true", VERCEL: "1" })).toBe(false);
  });
  it("non abilita un'anteprima senza autenticazione nel runtime di produzione", () => {
    expect(isLocalPreviewEnabled({ LUCKYLAP_LOCAL_PREVIEW: "true", NODE_ENV: "production" })).toBe(false);
  });
});
