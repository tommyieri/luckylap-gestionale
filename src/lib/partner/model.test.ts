import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PARTNER_APPROACHES,
  PARTNER_APPROACH_LABELS,
  PARTNER_MESSAGE_LIMITS,
  PARTNER_STAGES,
  PARTNER_STAGE_LABELS,
  charCount,
  hasControlCharacters,
  isPartnerApproach,
  isPartnerStage,
} from "./model";

const MIGRATIONS = join(__dirname, "../../../supabase/migrations");
const migration = readFileSync(
  join(
    MIGRATIONS,
    readdirSync(MIGRATIONS).find((name) => name.endsWith("_partner_module.sql")) ?? "",
  ),
  "utf8",
);
const sqlArray = (functionName: string) => {
  const body = migration.split(`create function private.${functionName}()`)[1] ?? "";
  return [...(/array\[([^\]]*)\]/.exec(body)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
    (match) => match[1],
  );
};

describe("valori di dominio Partner", () => {
  it("stati e approcci uguali a quelli della migrazione partner_module", () => {
    expect(sqlArray("partner_stages")).toEqual([...PARTNER_STAGES]);
    expect(sqlArray("partner_approaches")).toEqual([...PARTNER_APPROACHES]);
  });

  it("etichette italiane per ogni stato e approccio (spec 02 §1 e §5.6)", () => {
    expect(PARTNER_STAGES.map((stage) => PARTNER_STAGE_LABELS[stage])).toEqual([
      "Da contattare",
      "Contattato",
      "Ha risposto",
      "In trattativa",
      "Chiuso",
      "Non interessato",
    ]);
    expect(PARTNER_APPROACHES.map((approach) => PARTNER_APPROACH_LABELS[approach])).toEqual([
      "Vendita",
      "Presenza all’evento",
      "Collab",
      "Su misura",
      "Media",
    ]);
  });

  it("limiti dei testi dei messaggi come i check del database", () => {
    expect(PARTNER_MESSAGE_LIMITS).toEqual({
      subject: 300,
      body: 8000,
      follow_up: 4000,
      confirm_email: 4000,
    });
    for (const [field, max] of Object.entries(PARTNER_MESSAGE_LIMITS))
      expect(migration).toContain(`char_length(original_${field}) <= ${max}`);
  });

  it("riconosce solo stati e approcci dell'elenco", () => {
    expect(isPartnerStage("risposto")).toBe(true);
    expect(isPartnerStage("Risposto")).toBe(false);
    expect(isPartnerStage(null)).toBe(false);
    expect(isPartnerApproach("su_misura")).toBe(true);
    expect(isPartnerApproach("eventi")).toBe(false);
  });

  it("conta i caratteri come PostgreSQL e trova i caratteri di controllo", () => {
    expect(charCount("Grüße 🏁")).toBe(7);
    expect("🏁".length).toBe(2);
    expect(hasControlCharacters("riga\n\tsotto\r")).toBe(false);
    expect(hasControlCharacters("a\u0000b")).toBe(true);
    expect(hasControlCharacters("a\u007fb")).toBe(true);
    expect(hasControlCharacters("a\u000bb")).toBe(true);
  });
});
