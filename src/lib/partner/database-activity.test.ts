import { describe, expect, it } from "vitest";
import { buildPartnerDatabaseRows } from "./database";
import {
  buildPartnerCalendarItems,
  partnerCalendarMonday,
  partnerCalendarOverlaps,
  partnerCalendarWeekNumber,
  partnerDatabaseActivitySeries,
  partnerDatabaseBreakdown,
  partnerDatabaseForecast,
  partnerDatabaseKpis,
  partnerDatabaseResponseTimes,
} from "./database-activity";
import { partnerFixtureWorkspace } from "./fixtures";
import type { PartnerSummary } from "./model";
import type { PartnerWorkActivity, PartnerWorkData } from "./work";

const today = "2026-11-12";
const base = partnerFixtureWorkspace(today);
const partners: PartnerSummary[] = base.partners.slice(0, 4).map((partner, index) => ({
  ...partner,
  co: 9801 + index,
  name: `Contatto sintetico ${index + 1}`,
  stage: "da_contattare" as const,
  ownerId: null,
  researchRemovedAt: null,
  nextAction: null,
  nextActionOn: null,
  applicationDeadline: null,
  eventStartsOn: null,
  eventEndsOn: null,
}));

function activity(
  index: number,
  kind: PartnerWorkActivity["kind"],
  occurredAt: string,
  patch: Partial<PartnerWorkActivity> = {},
): PartnerWorkActivity {
  return {
    id: `${index}-${kind}-${occurredAt}`,
    partnerId: partners[index].id,
    kind,
    occurredAt,
    createdBy: base.members[0].id,
    origin: "team",
    channel: kind === "inviato" ? "email" : null,
    messageKind: kind === "inviato" ? "primo" : null,
    ...patch,
  };
}

function scope(activities: PartnerWorkActivity[], changes: Partial<PartnerWorkData> = {}) {
  const work: PartnerWorkData = {
    assistantStatus: "ready",
    jobs: [],
    toggles: [],
    replies: [],
    followUps: [],
    activities,
    ...changes,
  };
  return { ...base, partners, blocks: [], work };
}

describe("calendario e andamento Partner", () => {
  it("unisce storico, stime, scadenze e date dell’accordo senza creare invii", () => {
    const workspace = scope(
      [
        activity(0, "inviato", "2024-03-01T11:00:00Z", { origin: "file" }),
        activity(0, "inviato", "2026-11-12T11:00:00Z", {
          messageKind: "sollecito",
          origin: "assistente",
        }),
        activity(0, "nota", "2026-11-12T14:00:00Z"),
      ],
      {
        followUps: [
          {
            id: "task",
            partnerId: partners[0].id,
            dueAt: "2026-11-12T23:30:00Z",
            assignedTo: null,
          },
        ],
      },
    );
    workspace.partners = [
      {
        ...partners[0],
        stage: "contattato",
        nextAction: "Controlla il materiale",
        nextActionOn: "2026-11-14",
      },
      { ...partners[1], stage: "chiuso", eventStartsOn: "2026-11-30", eventEndsOn: "2026-12-02" },
      { ...partners[2], applicationDeadline: "2026-11-26" },
      {
        ...partners[3],
        stage: "no",
        eventStartsOn: "2026-11-20",
        applicationDeadline: "2026-11-22",
      },
    ];
    const estimates = [{ partnerId: partners[2].id, day: "2026-11-15" }];
    const rows = buildPartnerDatabaseRows(workspace, today, estimates);
    const items = buildPartnerCalendarItems(rows, workspace.work, estimates, today);
    expect(items.map((item) => [item.day, item.kind])).toEqual([
      ["2024-03-01", "inviata"],
      ["2026-11-12", "inviata"],
      ["2026-11-13", "sollecito"],
      ["2026-11-14", "azione"],
      ["2026-11-15", "prevista"],
      ["2026-11-26", "scadenza"],
      ["2026-11-30", "evento"],
    ]);
    expect(items[0]).toMatchObject({
      origin: "file",
      label: expect.stringContaining("vecchio sito"),
    });
    expect(items[1].label).toBe("Sollecito inviato");
    expect(items.at(-1)?.endDay).toBe("2026-12-02");
    expect(partnerCalendarOverlaps(items.at(-1)!, "2026-12-01", "2026-12-01")).toBe(true);
    expect(partnerCalendarOverlaps(items.at(-1)!, "2026-12-03", "2026-12-31")).toBe(false);
  });

  it("calcola il tasso sui contatti con invio, non sulle righe di risposta", () => {
    const workspace = scope([
      activity(0, "inviato", "2026-10-14T11:00:00Z"),
      activity(0, "inviato", "2026-11-04T11:00:00Z", { messageKind: "sollecito" }),
      activity(0, "risposta", "2026-11-06T11:00:00Z"),
      activity(0, "risposta", "2026-11-07T11:00:00Z"),
      activity(1, "inviato", "2026-11-05T11:00:00Z", { channel: "dm" }),
      activity(2, "risposta", "2026-11-06T11:00:00Z"),
      activity(3, "inviato", "2026-11-13T11:00:00Z"),
    ]);
    const rows = buildPartnerDatabaseRows(workspace, today, []);
    const items = buildPartnerCalendarItems(rows, workspace.work, [], today);
    expect(partnerDatabaseKpis(rows, items, today)).toMatchObject({
      contacts: 4,
      sent: 2,
      replied: 1,
      replyRate: 0.5,
      firstEmails30: 1,
    });
    expect(partnerDatabaseKpis([rows[2]], items, today)).toMatchObject({
      sent: 0,
      replied: 0,
      replyRate: null,
    });
  });

  it("misura dall’ultimo invio e scarta tempi importati o simultanei", () => {
    const workspace = scope([
      activity(0, "inviato", "2026-10-30T11:00:00Z"),
      activity(0, "inviato", "2026-11-04T11:00:00Z", { messageKind: "sollecito" }),
      activity(0, "risposta", "2026-11-06T11:00:00Z"),
      activity(0, "inviato", "2026-11-08T11:00:00Z"),
      activity(0, "risposta", "2026-11-08T11:00:00Z"),
      activity(1, "inviato", "2026-11-08T11:00:00Z", { origin: "file" }),
      activity(1, "risposta", "2026-11-09T11:00:00Z"),
    ]);
    const rows = buildPartnerDatabaseRows(workspace, today, []);
    const items = buildPartnerCalendarItems(rows, workspace.work, [], today);
    expect(partnerDatabaseResponseTimes(items, today)).toMatchObject({
      sample: 1,
      average: 2,
      buckets: [{ count: 0 }, { count: 1 }, { count: 0 }, { count: 0 }, { count: 0 }],
    });
  });

  it("usa i giorni di Roma, i lunedì ISO e il periodo corrente parziale", () => {
    const workspace = scope([
      activity(0, "inviato", "2026-11-01T23:30:00Z"),
      activity(0, "risposta", "2026-11-12T18:00:00Z"),
    ]);
    const rows = buildPartnerDatabaseRows(workspace, today, []);
    const items = buildPartnerCalendarItems(rows, workspace.work, [], today);
    const weeks = partnerDatabaseActivitySeries(items, today, "8s");
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-2)).toMatchObject({
      from: "2026-11-02",
      to: "2026-11-08",
      sent: 1,
      replied: 0,
      partial: false,
    });
    expect(weeks.at(-1)).toMatchObject({
      from: "2026-11-09",
      to: today,
      sent: 0,
      replied: 1,
      partial: true,
    });
    expect(partnerDatabaseActivitySeries(items, today, "12m").at(-1)).toMatchObject({
      from: "2026-11-01",
      to: today,
      sent: 1,
      replied: 1,
    });
    expect(partnerCalendarWeekNumber(partnerCalendarMonday("2027-01-01"))).toBe(53);
  });

  it("mantiene distinti i contatti con più sezioni negli spaccati", () => {
    const workspace = scope([activity(0, "inviato", "2026-11-04T11:00:00Z")]);
    workspace.partners = [{ ...partners[0], sections: ["vendita", "eventi"] }];
    const rows = buildPartnerDatabaseRows(workspace, today, []);
    const items = buildPartnerCalendarItems(rows, workspace.work, [], today);
    const results = partnerDatabaseBreakdown(rows, items, today, "sezione");
    expect(
      results.map(({ value, contacts, sent, replyRate }) => [value, contacts, sent, replyRate]),
    ).toEqual([
      ["eventi", 1, 1, 0],
      ["vendita", 1, 1, 0],
    ]);
    expect(partnerDatabaseKpis(rows, items, today).contacts).toBe(1);
  });

  it("mantiene i periodi entro le date supportate dal calendario Partner", () => {
    expect(partnerDatabaseActivitySeries([], "2000-01-01", "8s")).toEqual([
      expect.objectContaining({ from: "2000-01-01", to: "2000-01-01", partial: true }),
    ]);
    expect(partnerDatabaseActivitySeries([], "2100-12-31", "6m").at(-1)).toMatchObject({
      from: "2100-12-01",
      to: "2100-12-31",
    });
    expect(partnerDatabaseForecast([], "2100-12-31").map((point) => point.day)).toEqual([
      "2100-12-31",
    ]);
  });
});
