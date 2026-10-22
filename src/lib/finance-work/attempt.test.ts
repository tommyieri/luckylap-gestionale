import { describe, expect, it } from "vitest";
import { financeDayLabel, financeWorkAttemptSummary } from "./attempt";
import { manualCommand, workId } from "./fixtures";
import type { FinanceWorkCommand } from "./model";

describe("riepilogo di un invio Finance da verificare", () => {
  it("una voce manuale: data italiana, uscita in euro, descrizione", () => {
    const summary = financeWorkAttemptSummary(manualCommand() as FinanceWorkCommand);
    expect(summary).toEqual({
      title: "Voce Finance da verificare",
      lines: ["Data: 21 ott 2026", "Uscita: 12,34 €", "Synthetic user-declared expense"],
    });
    expect(JSON.stringify(summary)).not.toMatch(/2026-10-21|1234|"expense"/);
  });
  it("un annullamento mostra il motivo, mai l'id della voce", () => {
    const summary = financeWorkAttemptSummary({
      operationId: workId(91),
      kind: "void_finance_entry",
      payload: { schema_version: 1, entry_id: workId(1), reason: " Doppione sintetico " },
    });
    expect(summary).toEqual({
      title: "Annullamento da verificare",
      lines: ["Motivo: Doppione sintetico"],
    });
    expect(JSON.stringify(summary)).not.toContain(workId(1));
  });
  it("una data che non è un giorno resta «non leggibile»", () => {
    expect(financeDayLabel("2026-02-30")).toBe("2 mar 2026");
    expect(financeDayLabel("ieri")).toBeNull();
    expect(financeDayLabel(20261021)).toBeNull();
  });
});
