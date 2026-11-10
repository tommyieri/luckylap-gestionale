import { describe, it, expect } from "vitest";
import {
  parsePartnerWork,
  partnerWorkFromOperationalRows,
  preparationWork,
  type PartnerOperationalRows,
} from "./work-model";
import type { SalesOrder, SalesLine } from "../sales/model";
const id = "00000000-0000-4000-8000-000000000001";
const order = (quantity: number, fulfilled: number, cancelled: number): SalesOrder => ({
  id,
  operationId: id,
  source: "manual_declaration",
  channel: "cash",
  reference: null,
  occurredAt: "2026-10-22T10:00Z",
  totalCents: 0,
  cancelledCents: 0,
  refundDueCents: 0,
  paymentState: "paid",
  fulfillmentState: "partial",
  orderState: "open",
  lines: [{ quantity, fulfilled, cancelled } as SalesLine],
});

const workId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const viewer = workId(900);
const day = "2026-11-10";
const operationalPartner = (n: number, extra: Record<string, unknown> = {}) => ({
  id: workId(n),
  co: n,
  name: `Contatto sintetico ${n}`,
  stage: "da_contattare",
  contact_month: "2026-11-01",
  owner_id: null,
  next_action: null,
  next_action_on: null,
  research_removed_at: null,
  ...extra,
});
const operationalRows = (extra: Partial<PartnerOperationalRows> = {}): PartnerOperationalRows => ({
  partners: [],
  profiles: [],
  blocks: [],
  domains: [],
  activities: [],
  links: [],
  tasks: [],
  jobs: [],
  toggles: [],
  ...extra,
});
const manualWork = (rows: PartnerOperationalRows, first = true, followups = true) =>
  partnerWorkFromOperationalRows(rows, day, viewer, { first, followups });

describe("Oggi: il lavoro manuale resta distinto dalle email automatiche", () => {
  it("conserva una data manuale anche senza etichetta della prossima azione", () => {
    const work = manualWork(
      operationalRows({
        partners: [operationalPartner(1, { next_action_on: day }), operationalPartner(2)],
        jobs: [1, 2].map((n) => ({ partner_id: workId(n), status: "pronta" })),
      }),
    );
    expect(work.contactCount).toBe(1);
    expect(work.contacts).toMatchObject([{ co: 1, action: null, dueOn: day }]);
  });

  it("nasconde solo i lavori automatici affidati all'assistente, conserva proprietari, azioni e verifiche", () => {
    const rows = operationalRows({
      partners: [
        operationalPartner(1),
        operationalPartner(2),
        operationalPartner(3),
        operationalPartner(4),
        operationalPartner(5, { owner_id: viewer }),
        operationalPartner(6, { next_action: "Preparare una proposta", next_action_on: day }),
        operationalPartner(7),
        operationalPartner(8),
        operationalPartner(9),
        operationalPartner(10),
        operationalPartner(11),
      ],
      profiles: [{ user_id: viewer, display_name: "Persona sintetica" }],
      jobs: [
        "in_coda",
        "attesa",
        "pronta",
        "serve_tommaso",
        "pronta",
        "pronta",
        "pronta",
        "pronta",
        "inviata",
        "pronta",
        "pronta",
      ].map((status, index) => ({ partner_id: workId(index + 1), status })),
      toggles: [{ partner_id: workId(7), active: false }],
      activities: [
        { id: workId(801), partner_id: workId(8), kind: "nota", origin: "team" },
        { id: workId(802), partner_id: workId(10), kind: "inviato", origin: "file" },
        { id: workId(803), partner_id: workId(11), kind: "nuovo_tipo", origin: "sconosciuta" },
      ],
    });
    const work = manualWork(rows);
    expect(work.contactCount).toBe(8);
    expect(work.contacts.map((contact) => contact.co)).toEqual([6, 4, 5, 7, 8, 9, 10, 11]);
    expect(work.contacts.find((contact) => contact.co === 5)?.owner).toBe("Persona sintetica");
    expect(manualWork(rows, false).contactCount).toBe(11);
  });

  it("un errore o formato superato dell'assistente non cancella le attività manuali", () => {
    const rows = operationalRows({
      partners: [operationalPartner(1)],
      jobs: [{ partner_id: workId(1), status: "pronta" }],
    });
    expect(manualWork({ ...rows, jobs: null }).contactCount).toBe(1);
    expect(manualWork({ ...rows, toggles: null }).contactCount).toBe(1);
    expect(
      manualWork({ ...rows, toggles: [{ partner_id: workId(1), active: "true" }] }).contactCount,
    ).toBe(1);
    expect(
      manualWork({ ...rows, jobs: [{ partner_id: workId(1), status: "nuovo_stato" }] })
        .contactCount,
    ).toBe(1);
  });

  it("conteggia e ordina tutti i manuali prima di scegliere le prime otto righe", () => {
    const rows = operationalRows({
      partners: Array.from({ length: 25 }, (_, index) => operationalPartner(index + 1)),
      jobs: Array.from({ length: 12 }, (_, index) => ({
        partner_id: workId(index + 1),
        status: "pronta",
      })),
    });
    const work = manualWork(rows);
    expect(work.contactCount).toBe(13);
    expect(work.contacts.map((contact) => contact.co)).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("mantiene la regola dei periodi e i blocchi diretti o per dominio senza esporre recapiti", () => {
    const rows = operationalRows({
      partners: [
        operationalPartner(1),
        operationalPartner(2),
        operationalPartner(3),
        operationalPartner(4, { contact_month: "2027-01-01" }),
        operationalPartner(5, {
          stage: "risposto",
          next_action: "Preparare i dettagli",
          next_action_on: day,
        }),
        operationalPartner(6, { stage: "chiuso", next_action_on: day }),
        operationalPartner(7, { research_removed_at: "2026-11-08T10:00:00Z" }),
      ],
      blocks: [
        { id: workId(701), partner_id: workId(1), domain: null },
        { id: workId(702), partner_id: null, domain: "blocked.example.test" },
      ],
      domains: [
        {
          id: workId(703),
          partner_id: workId(2),
          kind: "email",
          link_value: "persona@blocked.example.test",
        },
      ],
    });
    const work = manualWork(rows);
    expect(work.contacts.map((contact) => contact.co)).toEqual([5, 3]);
    expect(JSON.stringify(work)).not.toContain("blocked.example.test");
  });

  it("toglie soltanto i vecchi promemoria originati dall'assistente quando i solleciti sono attivi", () => {
    const rows = operationalRows({
      partners: [operationalPartner(1)],
      activities: [
        { id: workId(601), partner_id: workId(1), kind: "inviato", origin: "assistente" },
        { id: workId(602), partner_id: workId(1), kind: "inviato", origin: "team" },
        { id: workId(603), partner_id: workId(1), kind: "inviato", origin: "file" },
        { id: workId(604), partner_id: workId(1), kind: "risposta", origin: "assistente" },
        { id: workId(605), partner_id: workId(1), kind: "inviato", origin: "sconosciuta" },
      ],
      tasks: Array.from({ length: 8 }, (_, index) => ({
        id: workId(501 + index),
        title: `Attività sintetica ${index + 1}`,
        due_at: "2026-11-10T08:00:00Z",
        status: "todo",
        assigned_to: viewer,
      })),
      links: Array.from({ length: 7 }, (_, index) => ({
        id: workId(401 + index),
        task_id: workId(501 + index),
        partner_id: workId(1),
        kind: "follow_up",
        activity_id: index < 5 ? workId(601 + index) : index === 5 ? null : workId(699),
      })),
    });
    const work = manualWork(rows);
    // L'ottavo task senza link è un'attività ordinaria dell'Agenda, non un sollecito Partner.
    expect(work.reminderCount).toBe(6);
    expect(work.reminders.map((reminder) => reminder.id)).toEqual(
      [502, 503, 504, 505, 506, 507].map(workId),
    );
    expect(manualWork(rows, true, false).reminderCount).toBe(7);
  });

  it("i promemoria manuali oltre gli otto automatici non spariscono, e il giorno segue Roma", () => {
    const rows = operationalRows({
      partners: [operationalPartner(1)],
      activities: [
        { id: workId(601), partner_id: workId(1), kind: "inviato", origin: "assistente" },
      ],
      tasks: Array.from({ length: 22 }, (_, index) => ({
        id: workId(501 + index),
        title: `Attività sintetica ${index + 1}`,
        due_at: index === 21 ? "2026-11-10T23:00:00Z" : "2026-11-10T22:59:59Z",
        status: index === 20 ? "done" : "todo",
        assigned_to: viewer,
      })),
      links: Array.from({ length: 22 }, (_, index) => ({
        id: workId(401 + index),
        task_id: workId(501 + index),
        partner_id: workId(1),
        kind: "follow_up",
        activity_id: index < 10 ? workId(601) : null,
      })),
    });
    const work = manualWork(rows);
    expect(work.reminderCount).toBe(10);
    expect(work.reminders.map((reminder) => reminder.id)).toEqual(
      Array.from({ length: 8 }, (_, index) => workId(511 + index)),
    );
  });
});
describe("Oggi lavoro operativo", () => {
  it("subtracts delivered and cancelled quantities without hiding an unpaid order", () => {
    expect(preparationWork([order(10, 3, 2), order(4, 4, 0)])).toMatchObject({
      orderCount: 1,
      quantity: 5,
      orders: [{ quantity: 5 }],
    });
  });
  it("rejects inconsistent quantities instead of showing a reassuring zero", () => {
    expect(() => preparationWork([order(2, 3, 0)])).toThrow();
  });
  it("counts the whole set while limiting readable links", () => {
    expect(
      preparationWork(Array.from({ length: 12 }, (_, i) => ({ ...order(1, 0, 0), id: String(i) }))),
    ).toMatchObject({ orderCount: 12, quantity: 12 });
    expect(preparationWork(Array.from({ length: 12 }, () => order(1, 0, 0))).orders).toHaveLength(
      8,
    );
  });
  it("accepts empty complete work and rejects truncated or malformed data", () => {
    expect(
      parsePartnerWork({ contact_count: 0, contacts: [], reminder_count: 0, reminders: [] }),
    ).toEqual({ contactCount: 0, contacts: [], reminderCount: 0, reminders: [] });
    expect(() =>
      parsePartnerWork({ contact_count: 1, contacts: [], reminder_count: 0, reminders: [] }),
    ).toThrow();
  });
  it("projects allowlisted fields and rejects a false calendar date", () => {
    const raw = {
      contact_count: 1,
      contacts: [
        {
          id,
          co: 42,
          name: "Synthetic partner",
          next_action: "Chiamare",
          next_action_on: "2026-10-22",
          owner_name: null,
          private_contact: "secret",
        },
      ],
      reminder_count: 0,
      reminders: [],
    };
    expect(JSON.stringify(parsePartnerWork(raw))).not.toContain("secret");
    expect(() =>
      parsePartnerWork({
        ...raw,
        contacts: [{ ...raw.contacts[0], next_action_on: "2026-02-30" }],
      }),
    ).toThrow();
  });
  it("reads the reminder's partner for «Ha risposto», and tolerates its absence", () => {
    const reminder = {
      id,
      co: 42,
      title: "Sollecito · Synthetic partner",
      due_at: "2026-10-20T22:00:00+00:00",
    };
    const parse = (extra: Record<string, unknown>) =>
      parsePartnerWork({
        contact_count: 0,
        contacts: [],
        reminder_count: 1,
        reminders: [{ ...reminder, ...extra }],
      }).reminders[0].partnerId;
    expect(parse({ partner_id: "00000000-0000-4000-8000-000000000042" })).toBe(
      "00000000-0000-4000-8000-000000000042",
    );
    expect(parse({})).toBeNull();
    expect(() => parse({ partner_id: "not-a-uuid" })).toThrow();
  });
});
