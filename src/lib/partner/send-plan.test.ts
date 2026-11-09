import { describe, expect, it } from "vitest";
import { parsePartnerSendPlan, partnerSendPlanDay } from "./send-plan";

const id = (n: number) => `82000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const slot = () => ({
  id: id(1),
  kind: "primo",
  partner_id: id(2),
  co: 951,
  name: "Club sintetico",
  timezone: "Europe/Paris",
  local_day: "2026-11-09",
  planned_at: "2026-11-09T08:00:00Z",
  expires_at: "2026-11-09T08:05:00Z",
  status: "scheduled",
  reason: null,
});
const row = () => ({
  day: "2026-11-09",
  generated_at: "2026-11-09T07:30:00Z",
  mode: "invio",
  slots: [slot()],
});

describe("piano d'invio SQL", () => {
  it("il giorno di lettura ammette solo ISO reali fra oggi meno trenta e oggi più due", () => {
    const today = "2026-11-09";
    for (const day of ["2026-10-10", today, "2026-11-10", "2026-11-11"])
      expect(partnerSendPlanDay(day, today)).toBe(day);
    for (const value of [
      undefined,
      null,
      [],
      "",
      "domani",
      "2026-11-9",
      "2026-02-30",
      "2026-10-09",
      "2026-11-12",
    ])
      expect(partnerSendPlanDay(value, today)).toBe(today);
  });
  it("conserva gli orari del database e normalizza solo i nomi delle chiavi", () => {
    const source = row();
    expect(parsePartnerSendPlan(source)).toEqual({
      day: source.day,
      generatedAt: source.generated_at,
      mode: "invio",
      slots: [
        {
          id: id(1),
          kind: "primo",
          partnerId: id(2),
          co: 951,
          name: "Club sintetico",
          timezone: "Europe/Paris",
          localDay: source.day,
          plannedAt: slot().planned_at,
          expiresAt: slot().expires_at,
          status: "scheduled",
          reason: null,
        },
      ],
    });
    expect(source).toEqual(row());
  });
  it("un piano vuoto è leggibile, un piano mancante non è vuoto", () => {
    expect(parsePartnerSendPlan({ ...row(), slots: [] })?.slots).toEqual([]);
    expect(parsePartnerSendPlan(null)).toBeNull();
  });
  it("accetta giorno locale diverso da Roma e stati senza attribuire nuovi permessi", () => {
    const raw = {
      ...slot(),
      kind: "sollecito",
      timezone: "Pacific/Auckland",
      local_day: "2026-11-10",
      planned_at: "2026-11-09T20:00:00Z",
      expires_at: "2026-11-09T20:05:00Z",
      status: "expired",
      reason: "slot_scaduto",
    };
    expect(parsePartnerSendPlan({ ...row(), mode: "osserva", slots: [raw] })).toBeNull();
    expect(parsePartnerSendPlan({ ...row(), slots: [raw] })?.slots[0]).toMatchObject({
      kind: "sollecito",
      localDay: "2026-11-10",
      status: "expired",
    });
  });
  it.each(["sending", "sent", "uncertain", "skipped", "expired"])("legge lo stato %s", (status) => {
    expect(
      parsePartnerSendPlan({ ...row(), slots: [{ ...slot(), status }] })?.slots[0].status,
    ).toBe(status);
  });
  it.each([
    { id: "bad" },
    { co: 0 },
    { kind: "prova" },
    { status: "active" },
    { timezone: "Fuso inventato" },
    { local_day: "2026-11-10" },
    { planned_at: "2026-11-10T08:00:00Z" },
    { expires_at: slot().planned_at },
    { planned_at: "2026-02-30T08:00:00Z" },
    { reason: "testo libero con recapiti" },
    { name: "" },
    { address: "inventato@example.test" },
    { raw: "Dati non richiesti" },
  ])("rifiuta la riga incoerente o estranea %j senza un piano parziale", (change) => {
    expect(
      parsePartnerSendPlan({ ...row(), slots: [slot(), { ...slot(), id: id(3), ...change }] }),
    ).toBeNull();
  });
  it("rifiuta duplicati, troncamenti e campi inattesi nello snapshot", () => {
    expect(parsePartnerSendPlan({ ...row(), slots: [slot(), slot()] })).toBeNull();
    expect(parsePartnerSendPlan({ ...row(), slots: Array(2001).fill(slot()) })).toBeNull();
    expect(parsePartnerSendPlan({ ...row(), token: "non richiesto" })).toBeNull();
  });
});
