import { centsLabel, type FinanceWorkCommand } from "./model";

/*
 * Riepilogo leggibile di un invio Finance rimasto da verificare (docs: 06 R4). Data in italiano,
 * importo in euro, descrizione o motivo: mai l'id della voce né l'operation_id, che restano in
 * «Codice per l’assistenza».
 */

const day = new Intl.DateTimeFormat("it-IT", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** «22 ott 2026» da `2026-10-22`; `null` se non è un giorno valido. */
export function financeDayLabel(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const instant = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(instant) ? day.format(instant) : null;
}

export function financeWorkAttemptSummary(command: FinanceWorkCommand): {
  title: string;
  lines: string[];
} {
  const p = command.payload;
  if (command.kind === "void_finance_entry")
    return {
      title: "Annullamento da verificare",
      lines: [`Motivo: ${typeof p.reason === "string" ? p.reason.trim() : "non leggibile"}`],
    };
  const lines: string[] = [];
  const date = financeDayLabel(p.entry_date);
  lines.push(`Data: ${date ?? "non leggibile"}`);
  if (typeof p.amount_cents === "number")
    lines.push(
      `${p.entry_type === "expense" ? "Uscita" : "Entrata"}: ${centsLabel(p.amount_cents)}`,
    );
  if (typeof p.description === "string") lines.push(p.description.trim());
  return { title: "Voce Finance da verificare", lines };
}
