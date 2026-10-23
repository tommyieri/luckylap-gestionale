import { describe, expect, it } from "vitest";
import { followUpConfirmation } from "./follow-up";

const me = "00000000-0000-4000-8000-000000000001";

describe("conferma con la data del sollecito", () => {
  it("dice il giorno di Roma della scadenza, a chi tocca", () => {
    // Mezzanotte di Roma del 29 ottobre 2026 (ora solare): 23:00 UTC del 28.
    const followUp = { dueAt: "2026-10-28T23:00:00.000Z", assignedTo: me };
    expect(followUpConfirmation(followUp, me)).toBe("Sollecito per te giovedì 29 ottobre.");
    expect(followUpConfirmation({ ...followUp, assignedTo: null }, me)).toBe(
      "Sollecito giovedì 29 ottobre.",
    );
  });
  it("in ora legale la mezzanotte di Roma è alle 22:00 UTC del giorno prima", () => {
    expect(followUpConfirmation({ dueAt: "2027-04-01T22:00:00.000Z", assignedTo: me }, me)).toBe(
      "Sollecito per te venerdì 2 aprile.",
    );
  });
});
