import { describe, expect, it } from "vitest";
import type { PartnerAssistantSendStatus, PartnerAssistantStatus } from "../partner/assistant";
import type { PartnerSendPlan, PartnerSendPlanSlot } from "../partner/send-plan";
import {
  automaticMailDay,
  type AutomaticMailMessage,
  type AutomaticMailPartner,
} from "./automatic-mail-model";

const id = (n: number) => `83000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-11-10T10:00:00Z");
const partner = (n: number, template = false): AutomaticMailPartner => ({
  id: id(n),
  co: 950 + n,
  name: `Contatto sintetico ${n}`,
  template,
  timezone: "Europe/Rome",
});
const slot = (n: number, changes: Partial<PartnerSendPlanSlot> = {}): PartnerSendPlanSlot => ({
  id: id(n + 100),
  kind: "primo",
  partnerId: id(n),
  co: 950 + n,
  name: `Contatto sintetico ${n}`,
  timezone: "Europe/Rome",
  localDay: "2026-11-10",
  plannedAt: "2026-11-10T12:00:00Z",
  expiresAt: "2026-11-10T12:05:00Z",
  status: "scheduled",
  reason: null,
  ...changes,
});
const message = (n: number, changes: Partial<AutomaticMailMessage> = {}): AutomaticMailMessage => ({
  id: id(n + 200),
  partnerId: id(n),
  kind: "primo",
  status: "inviato",
  sendDay: "2026-11-10",
  sentAt: "2026-11-10T08:02:00Z",
  createdAt: "2026-11-10T08:01:00Z",
  template: false,
  timezone: "Europe/Rome",
  reason: null,
  ...changes,
});
const plan = (slots: PartnerSendPlanSlot[] = []): PartnerSendPlan => ({
  day: "2026-11-10",
  generatedAt: "2026-11-10T10:00:00Z",
  mode: "invio",
  slots,
});
const assistant = {
  mode: "invio",
  configured: true,
  pausedReason: "credito",
} as PartnerAssistantStatus;
const send = {
  stopReason: null,
  dayStoppedOn: null,
  envMailboxOk: true,
  backoffUntil: null,
} as PartnerAssistantSendStatus;
const build = (changes: Partial<Parameters<typeof automaticMailDay>[0]> = {}) =>
  automaticMailDay({
    plan: plan(),
    partners: [],
    messages: [],
    assistant,
    send,
    followupMode: "invio",
    now,
    ...changes,
  });

describe("riepilogo degli invii automatici di Oggi", () => {
  it("mostra zero candidati quando il piano è vuoto, con i limiti separati come regola", () => {
    const data = build();
    expect(data.totals).toEqual({ sent: 0, sending: 0, scheduled: 0, skipped: 0, uncertain: 0 });
    expect(data.groups.map((group) => [group.key, group.limit, group.rows.length])).toEqual([
      ["other", 3, 0],
      ["club", 3, 0],
      ["followup", 6, 0],
    ]);
    expect(data.state).toBe("automatic");
  });
  it("riconcilia piano e messaggi senza contare due volte lo stesso invio", () => {
    const data = build({
      partners: [partner(1), partner(2, true), partner(3)],
      plan: plan([slot(1), slot(2), slot(3, { kind: "sollecito" })]),
      messages: [
        message(1),
        message(3, { kind: "sollecito", status: "incerto", reason: "invio_incerto" }),
      ],
    });
    expect(data.groups.map((group) => group.counts)).toEqual([
      { sent: 1, sending: 0, scheduled: 0, skipped: 0, uncertain: 0 },
      { sent: 0, sending: 0, scheduled: 1, skipped: 0, uncertain: 0 },
      { sent: 0, sending: 0, scheduled: 0, skipped: 0, uncertain: 1 },
    ]);
    expect(data.totals.sent).toBe(1);
    expect(data.groups[0].rows[0]).toMatchObject({
      co: 951,
      href: "/partner?co=951#lead-951",
      localTime: "09:02",
    });
  });
  it("classifica il già inviato dalla bozza storica, anche se la sezione attuale cambia", () => {
    const data = build({
      partners: [partner(1, false)],
      messages: [message(1, { template: true })],
    });
    expect(data.groups[1].counts.sent).toBe(1);
    expect(data.groups[0].counts.sent).toBe(0);
    expect(data.groups[1].rows[0].plannedAt).toBeNull();
  });
  it("conserva gli esiti reali oltre il limite e non nasconde invii effettivi duplicati", () => {
    const data = build({
      partners: [partner(1)],
      messages: [
        message(1),
        message(1, {
          id: id(299),
          sentAt: "2026-11-10T09:02:00Z",
          createdAt: "2026-11-10T09:01:00Z",
        }),
      ],
    });
    expect(data.groups[0].counts.sent).toBe(2);
    expect(data.groups[0].rows).toHaveLength(2);
  });
  it("orari scaduti e saltati restano separati dai candidati programmati", () => {
    const data = build({
      partners: [partner(1)],
      plan: plan([
        slot(1, {
          id: id(101),
          status: "expired",
          reason: "slot_scaduto",
          plannedAt: "2026-11-10T08:00:00Z",
        }),
        slot(1, { id: id(102) }),
      ]),
    });
    expect(data.totals).toEqual({ sent: 0, sending: 0, scheduled: 1, skipped: 1, uncertain: 0 });
    expect(data.groups[0].rows[0].reasonLabel).toContain("Orario superato");
  });
  it("non attribuisce arbitrariamente un invio a uno di più orari della stessa scheda", () => {
    const data = build({
      partners: [partner(1)],
      messages: [message(1)],
      plan: plan([
        slot(1, {
          id: id(101),
          status: "expired",
          reason: "slot_scaduto",
          plannedAt: "2026-11-10T08:00:00Z",
        }),
        slot(1, { id: id(102) }),
      ]),
    });
    expect(data.totals).toEqual({ sent: 1, sending: 0, scheduled: 0, skipped: 1, uncertain: 0 });
    expect(data.groups[0].rows.find((row) => row.status === "sent")?.plannedAt).toBeNull();
  });
  it("un tentativo scartato non cancella l'esito che ha consumato quota", () => {
    const data = build({
      partners: [partner(1)],
      plan: plan([slot(1)]),
      messages: [
        message(1),
        message(1, {
          id: id(299),
          status: "scartato",
          sentAt: null,
          createdAt: "2026-11-10T09:01:00Z",
          reason: "smtp_temporaneo",
        }),
      ],
    });
    expect(data.totals.sent).toBe(1);
    expect(data.totals.skipped).toBe(1);
  });
  it("il giorno di quota è Roma, l'ora dei dettagli è quella attestata del destinatario", () => {
    const data = build({
      partners: [partner(1)],
      plan: plan([
        slot(1, {
          timezone: "America/Los_Angeles",
          localDay: "2026-11-09",
          plannedAt: "2026-11-09T23:55:00Z",
          expiresAt: "2026-11-10T00:00:00Z",
        }),
      ]),
    });
    expect(data.day).toBe("2026-11-10");
    expect(data.groups[0].rows[0]).toMatchObject({
      localDay: "2026-11-09",
      localTime: "15:55",
      timezone: "America/Los_Angeles",
    });
  });
  it("non inventa orari locali per lo storico senza un fuso attestato", () => {
    const data = build({
      partners: [{ ...partner(1), timezone: null }],
      messages: [message(1, { timezone: null })],
    });
    expect(data.groups[0].rows[0]).toMatchObject({
      localDay: null,
      localTime: null,
      timezone: null,
      plannedAt: null,
    });
  });
  it.each([{ assistant: null }, { send: null }, { send: { ...send, envMailboxOk: null } }])(
    "letture di stato incomplete non diventano una conferma automatica",
    (change) => {
      expect(build(change).state).toBe("unreadable");
    },
  );
  it("la pausa credito non ferma le bozze pronte, i veri fermi della posta sì", () => {
    expect(build().state).toBe("automatic");
    expect(build({ send: { ...send, stopReason: "casella" } }).state).toBe("paused");
    expect(build({ send: { ...send, dayStoppedOn: "2026-11-10" } }).state).toBe("paused");
    expect(build({ send: { ...send, backoffUntil: "2026-11-10T11:00:00Z" } }).state).toBe("paused");
    expect(
      build({ plan: { ...plan(), mode: "prova" }, assistant: { ...assistant, mode: "prova" } })
        .state,
    ).toBe("inactive");
  });
  it("dati di un altro giorno, collegamenti mancanti o uno stato inviato senza messaggio falliscono", () => {
    expect(() => build({ now: new Date("2026-11-11T09:00:00Z") })).toThrow();
    expect(() => build({ plan: plan([slot(1)]) })).toThrow();
    expect(() =>
      build({ partners: [partner(1)], plan: plan([slot(1, { status: "sent" })]) }),
    ).toThrow();
    expect(() => build({ partners: [partner(1)], messages: [message(1), message(1)] })).toThrow();
  });
});
