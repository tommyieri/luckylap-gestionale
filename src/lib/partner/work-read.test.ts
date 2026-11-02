import { describe, expect, it } from "vitest";
import { partnerAssistantFixtureRows, partnerFixtureId, partnerFixtureRows } from "./fixtures";
import { PartnerReadError } from "./model";
import { partnerWorkFromRows, type PartnerWorkRows } from "./work-read";

const TODAY = "2026-11-02";
const fixture = () => {
  const rows = partnerFixtureRows(TODAY);
  const assistant = partnerAssistantFixtureRows(TODAY);
  const data: PartnerWorkRows = {
    assistantStatus: "ready",
    jobs: assistant.jobs,
    toggles: assistant.switches,
    activities: rows.activities,
    replies: rows.activities.filter((a) => a.kind === "risposta"),
    links: [],
    tasks: [],
  };
  const ids = rows.partners.map((p) => p.id);
  return { data, ids, activities: rows.activities };
};

describe("righe operative Partner", () => {
  it("rifiuta duplicati, risposte senza attività e riferimenti ad altre schede", () => {
    const { data, ids } = fixture();
    expect(() =>
      partnerWorkFromRows({ ...data, activities: [...data.activities, data.activities[0]] }, ids),
    ).toThrow(PartnerReadError);
    expect(() =>
      partnerWorkFromRows(
        {
          ...data,
          replies: data.replies.map((a) => ({
            ...(a as object),
            partner_id: partnerFixtureId(99999),
          })),
        },
        ids,
      ),
    ).toThrow(PartnerReadError);
    expect(() => partnerWorkFromRows({ ...data, replies: [] }, ids)).toThrow(PartnerReadError);
    expect(() =>
      partnerWorkFromRows(
        {
          ...data,
          replies: data.replies.map((a) => ({
            ...(a as object),
            occurred_at: "2026-11-02T12:00:00Z",
          })),
        },
        ids,
      ),
    ).toThrow(PartnerReadError);
  });

  it("non conserva testi delle note e tiene solo il testo delle risposte confermate", () => {
    const { data, ids } = fixture();
    const result = partnerWorkFromRows(data, ids);
    expect(result.activities.every((a) => !("body" in a))).toBe(true);
    expect(result.replies.every((a) => a.kind === "risposta" && typeof a.body === "string")).toBe(
      true,
    );
    expect(partnerWorkFromRows(data, ids)).toEqual(result);
  });

  it("l'errore proprio dell'assistente non cancella il registro né diventa assistente assente", () => {
    const { data, ids } = fixture();
    const result = partnerWorkFromRows(
      {
        ...data,
        jobs: data.jobs.map((j) => ({ ...(j as object), status: "nuovo_stato_sconosciuto" })),
      },
      ids,
    );
    expect(result.assistantStatus).toBe("error");
    expect(result.activities).toHaveLength(data.activities.length);
    expect(result.replies).toHaveLength(data.replies.length);
    expect(result.jobs).toEqual([]);
  });

  it("un sollecito deve appartenere alla stessa scheda dell'attività e citare il suo task", () => {
    const { data, ids, activities } = fixture();
    const activity = activities[0];
    const task = { id: partnerFixtureId(8800), due_at: null, status: "todo", assigned_to: null };
    const link = {
      id: partnerFixtureId(8801),
      partner_id: activity.partner_id,
      kind: "follow_up",
      task_id: task.id,
      activity_id: activity.id,
    };
    const valid = { ...data, links: [link], tasks: [task] };
    expect(partnerWorkFromRows(valid, ids).followUps).toEqual([
      { id: task.id, partnerId: activity.partner_id, dueAt: null, assignedTo: null },
    ]);
    expect(() => partnerWorkFromRows({ ...valid, tasks: [] }, ids)).toThrow(PartnerReadError);
    expect(() =>
      partnerWorkFromRows(
        {
          ...valid,
          links: [{ ...link, partner_id: ids.find((id) => id !== activity.partner_id) }],
        },
        ids,
      ),
    ).toThrow(PartnerReadError);
    expect(() =>
      partnerWorkFromRows(
        { ...valid, links: [link, { ...link, id: partnerFixtureId(8802) }] },
        ids,
      ),
    ).toThrow(PartnerReadError);
    expect(
      partnerWorkFromRows({ ...valid, tasks: [{ ...task, status: "done" }] }, ids).followUps,
    ).toEqual([]);
  });
});
