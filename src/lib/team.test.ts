import { describe, expect, it } from "vitest";
import { canAccessModule, TEAM } from "./team";

describe("permessi dei cinque membri LuckyLap", () => {
  it("consente a tutti costi, margini, sconti e rettifiche", () => {
    expect(TEAM).toHaveLength(5);
    for (const member of TEAM) {
      for (const area of ["costs", "margins", "discounts", "stock-adjustments"]) {
        expect(canAccessModule(member.id, area)).toBe(true);
      }
    }
  });
  it("limita Finance a founder, Gabriele e Gherardo", () => {
    expect(
      TEAM.filter((member) => canAccessModule(member.id, "finance")).map((member) => member.id),
    ).toEqual(["founder", "gabriele", "gherardo"]);
  });
  it("riserva Controllo al founder", () => {
    expect(
      TEAM.filter((member) => canAccessModule(member.id, "control")).map((member) => member.id),
    ).toEqual(["founder"]);
  });
  it("non concede diritti a identità sconosciute", () => {
    expect(canAccessModule("non-invitato", "inventory")).toBe(false);
    expect(canAccessModule("non-invitato", "finance")).toBe(false);
  });
});
