import { describe, expect, it } from "vitest";
import { itemsByDay, monthOf } from "./calendar";
import { TEAM_PREVIEW_NOTICE, teamFixtureSnapshot, teamLocalPreview } from "./fixtures";
import { isTeamId } from "./model";

const now = new Date("2026-10-23T08:00:00Z");

describe("anteprima locale di /team", () => {
  it("mai su Vercel né con NODE_ENV=production, né senza il flag", () => {
    expect(teamLocalPreview(now, { LUCKYLAP_LOCAL_PREVIEW: "true", VERCEL: "1" })).toBeNull();
    expect(
      teamLocalPreview(now, { LUCKYLAP_LOCAL_PREVIEW: "true", NODE_ENV: "production" }),
    ).toBeNull();
    expect(
      teamLocalPreview(now, {
        LUCKYLAP_LOCAL_PREVIEW: "true",
        VERCEL: "1",
        NODE_ENV: "production",
      }),
    ).toBeNull();
    expect(teamLocalPreview(now, {})).toBeNull();
    const preview = teamLocalPreview(now, {
      LUCKYLAP_LOCAL_PREVIEW: "true",
      NODE_ENV: "development",
    });
    expect(preview?.loadedAt).toBe("2026-10-23T08:00:00.000Z");
    expect(preview?.snapshot.events.length).toBeGreaterThan(0);
    expect(TEAM_PREVIEW_NOTICE).toBe("Anteprima locale: dati sintetici, salvataggio disattivato.");
  });

  it("dati sintetici validi: id, persone di prova, link example.test", () => {
    const snapshot = teamFixtureSnapshot("2026-10-23");
    for (const row of [
      ...snapshot.events,
      ...snapshot.tasks,
      ...snapshot.notes,
      ...snapshot.members,
    ])
      expect(isTeamId(row.id)).toBe(true);
    expect(snapshot.members.every((member) => member.name.endsWith(" Prova"))).toBe(true);
    const text = JSON.stringify(snapshot);
    expect(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)).toBeNull();
    for (const url of text.match(/https?:\/\/[^\s"]+/g) ?? [])
      expect(new URL(url).hostname).toMatch(/(^|\.)example\.test$/);
  });

  it("il mese corrente ha sempre qualcosa, oggi compreso, qualunque sia oggi", () => {
    for (const today of ["2026-10-23", "2026-12-31", "2027-03-01"]) {
      const snapshot = teamFixtureSnapshot(today);
      const items = itemsByDay(snapshot.events, snapshot.tasks, monthOf(today));
      expect(items.get(today)?.length, today).toBeGreaterThan(0);
    }
  });
});
