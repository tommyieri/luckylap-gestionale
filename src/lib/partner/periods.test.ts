import { describe, expect, it } from "vitest";
import { addDays, daysBetween, longDay, monthLong, romeDay, shortDay } from "./dates";
import { partnerSummaryFixture } from "./fixtures";
import {
  eventTiming,
  formatEventRange,
  monthBox,
  nextActionTiming,
  partnerPeriod,
  partnerPeriods,
  partnerToday,
  plannedMonth,
  periodForOffset,
} from "./periods";

// Spec 02 §5.2: periodi calcolati da oggi, giorno di Roma. Liste sintetiche.
const TODAY = "2026-10-22";

/** 207 contatti con la stessa distribuzione di mesi della ricerca del 21 ottobre 2026. */
function researchLikeList() {
  const months: [string, number][] = [
    ["2026-09-01", 2],
    ["2026-10-01", 20],
    ["2026-11-01", 27],
    ["2026-12-01", 40],
    ["2027-01-01", 23],
    ["2027-02-01", 25],
    ["2027-03-01", 15],
    ["2027-04-01", 5],
    ["2027-05-01", 3],
    ["2027-06-01", 3],
    ["2027-07-01", 30],
    ["2027-09-01", 10],
    ["2028-01-01", 4],
  ];
  let co = 0;
  return months.flatMap(([contactMonth, n]) =>
    Array.from({ length: n }, () => partnerSummaryFixture({ co: (co += 1), contactMonth })),
  );
}

describe("periodi da oggi", () => {
  it("il 22 ottobre 2026 riproduce i conteggi del sito: 49, 63, 40, 11, 44", () => {
    const list = researchLikeList();
    expect(list).toHaveLength(207);
    const counts = [1, 2, 3, 4, 5].map(
      (n) => list.filter((partner) => partnerPeriod(partner, TODAY) === n).length,
    );
    expect(counts).toEqual([49, 63, 40, 11, 44]);
  });

  it("celle, titoli e note del 22 ottobre 2026", () => {
    const periods = partnerPeriods(TODAY);
    expect(periods.map((period) => period.cell)).toEqual([
      "Adesso",
      "Dic – Gen",
      "Feb – Mar",
      "Apr – Giu",
      "Da lug 2027",
    ]);
    expect(periods.map((period) => period.title)).toEqual([
      "Adesso, entro novembre",
      "Dicembre e gennaio",
      "Febbraio e marzo",
      "Da aprile a giugno",
      "Da luglio 2027 in poi",
    ]);
    expect(periods[0].note).toBe(
      "Da contattare nelle prossime settimane, con i contatti rimasti indietro e le prossime azioni in scadenza.",
    );
    expect(periods[2].note).toBe(periods[1].note);
    expect(periods[4].note).toBe(
      "Mercati lontani e contatti che hanno bisogno di vendite già dimostrate.",
    );
    expect(periods.map((period) => [period.firstMonth, period.lastMonth])).toEqual([
      ["2026-10-01", "2026-11-01"],
      ["2026-12-01", "2027-01-01"],
      ["2027-02-01", "2027-03-01"],
      ["2027-04-01", "2027-06-01"],
      ["2027-07-01", null],
    ]);
  });

  it("cambio d'anno: il 10 dicembre 2026 le celle scorrono e il periodo 1 arriva a gennaio", () => {
    const periods = partnerPeriods("2026-12-10");
    expect(periods.map((period) => period.cell)).toEqual([
      "Adesso",
      "Feb – Mar",
      "Apr – Mag",
      "Giu – Ago",
      "Da set 2027",
    ]);
    expect(periods.map((period) => period.title)).toEqual([
      "Adesso, entro gennaio",
      "Febbraio e marzo",
      "Aprile e maggio",
      "Da giugno ad agosto",
      "Da settembre 2027 in poi",
    ]);
  });

  it("i mesi passati restano nel periodo 1, mai fuori dalla lista", () => {
    expect(partnerPeriod(partnerSummaryFixture({ contactMonth: "2025-01-01" }), TODAY)).toBe(1);
    expect(partnerPeriod(partnerSummaryFixture({ contactMonth: "2026-09-01" }), TODAY)).toBe(1);
    expect([-30, -1, 0, 1, 2, 3, 4, 5, 6, 8, 9, 40].map(periodForOffset)).toEqual([
      1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
    ]);
  });

  it("la prossima azione vince sul mese di contatto", () => {
    const later = partnerSummaryFixture({ contactMonth: "2027-07-01", nextActionOn: "2026-10-29" });
    expect(plannedMonth(later)).toBe("2026-10-01");
    expect(partnerPeriod(later, TODAY)).toBe(1);
    const postponed = partnerSummaryFixture({
      contactMonth: "2026-10-01",
      nextActionOn: "2027-02-15",
    });
    expect(plannedMonth(postponed)).toBe("2027-02-01");
    expect(partnerPeriod(postponed, TODAY)).toBe(3);
  });

  it("mezzanotte di Roma: 2026-10-31T23:30:00Z è già novembre", () => {
    expect(partnerToday(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
    expect(partnerToday(new Date("2026-10-31T22:30:00Z"))).toBe("2026-10-31");
    // In estate Roma è a UTC+2.
    expect(partnerToday(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    const december = partnerSummaryFixture({ contactMonth: "2026-12-01" });
    expect(partnerPeriod(december, partnerToday(new Date("2026-10-31T22:30:00Z")))).toBe(2);
    expect(partnerPeriod(december, partnerToday(new Date("2026-10-31T23:30:00Z")))).toBe(1);
  });

  it("casella del mese pianificato in maiuscolo", () => {
    expect(monthBox("2026-11-01")).toBe("NOV");
    expect(monthBox("2027-01-01")).toBe("GEN");
  });
});

describe("date dell'evento e prossima azione", () => {
  it("formatta le date come il sito", () => {
    expect(formatEventRange("2027-06-02", "2027-06-05")).toBe("2–5 giu 2027");
    expect(formatEventRange("2027-06-30", "2027-07-02")).toBe("30 giu – 2 lug 2027");
    expect(formatEventRange("2027-06-02", null)).toBe("2 giu 2027");
    expect(formatEventRange("2027-06-02", "2027-06-02")).toBe("2 giu 2027");
    expect(formatEventRange("2026-12-30", "2027-01-02")).toBe("30 dic 2026 – 2 gen 2027");
    expect(formatEventRange(null, null)).toBe("");
  });

  it("evento entro 60 giorni in ambra con i giorni mancanti, «Edizione passata» se finito", () => {
    const soon = eventTiming({ eventStartsOn: "2026-11-25", eventEndsOn: "2026-11-27" }, TODAY);
    expect(soon).toMatchObject({ soon: true, past: false, daysUntil: 34 });
    expect(soon?.label).toBe("25–27 nov 2026 · tra 34 giorni");
    expect(eventTiming({ eventStartsOn: TODAY, eventEndsOn: null }, TODAY)?.label).toBe(
      "22 ott 2026 · oggi",
    );
    const far = eventTiming({ eventStartsOn: "2027-06-02", eventEndsOn: "2027-06-05" }, TODAY);
    expect(far).toMatchObject({ soon: false, past: false, label: "2–5 giu 2027" });
    const past = eventTiming({ eventStartsOn: "2026-06-02", eventEndsOn: "2026-06-05" }, TODAY);
    expect(past).toMatchObject({
      past: true,
      soon: false,
      label: "Edizione passata · 2–5 giu 2026",
    });
    const ongoing = eventTiming({ eventStartsOn: "2026-10-20", eventEndsOn: "2026-10-24" }, TODAY);
    expect(ongoing).toMatchObject({
      ongoing: true,
      past: false,
      label: "20–24 ott 2026 · in corso",
    });
    expect(eventTiming({ eventStartsOn: null, eventEndsOn: null }, TODAY)).toBeNull();
  });

  it("prossima azione in ambra se scaduta", () => {
    expect(
      nextActionTiming({ nextAction: "sollecito", nextActionOn: "2026-10-29" }, TODAY),
    ).toEqual({
      label: "Prossima: sollecito · 29 ott",
      overdue: false,
    });
    expect(
      nextActionTiming({ nextAction: "sollecito", nextActionOn: "2026-10-21" }, TODAY)?.overdue,
    ).toBe(true);
    expect(nextActionTiming({ nextAction: null, nextActionOn: null }, TODAY)).toBeNull();
  });

  it("giorni del calendario senza ora legale", () => {
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(shortDay("2026-10-29")).toBe("29 ott");
    expect(longDay("2026-11-03", TODAY)).toBe("3 novembre");
    expect(longDay("2027-01-03", TODAY)).toBe("3 gennaio 2027");
    expect(monthLong("2026-11-01")).toBe("novembre 2026");
    expect(romeDay(new Date("2026-03-29T00:30:00Z"))).toBe("2026-03-29");
    expect(() => romeDay(new Date("non una data"))).toThrow(RangeError);
    expect(() => daysBetween("2026-02-30", TODAY)).toThrow(RangeError);
  });
});
