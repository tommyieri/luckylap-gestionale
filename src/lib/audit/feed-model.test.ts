import { describe, expect, it } from "vitest";
import {
  activityQueryFromSearch,
  activityCursorHref,
  activityItemFromDatabase,
  safeActivityHref,
} from "./feed-model";
const id = "10000000-0000-4000-8000-000000000001";
const item = {
  id,
  occurred_at: "2026-10-22T10:00:00.000001Z",
  actor_id: id,
  actor_name: "Collega sintetico",
  area: "team",
  message: "Collega sintetico ha aggiunto una call: Prova sintetica.",
  href: `/team#evento-${id}`,
};
describe("contratto feed CEO", () => {
  it("conserva microsecondi e filtri nel cursore", () => {
    const query = activityQueryFromSearch({
      actor: "system",
      area: "team",
      beforeAt: item.occurred_at,
      beforeId: id,
    });
    expect(query.before?.occurredAt).toBe(item.occurred_at);
    const href = activityCursorHref(query.before, query);
    expect(href).toContain("beforeAt=2026-10-22T10%3A00%3A00.000001Z");
    expect(href).toContain("actor=system");
    expect(href).toContain("area=team");
    expect(activityCursorHref(null, query)).toBe("/audit?actor=system&area=team");
  });
  it("interpreta assenza di filtri come altri collaboratori e automazioni", () => {
    expect(activityQueryFromSearch({})).toEqual({ actor: null, area: null, before: null });
    expect(activityCursorHref(null, activityQueryFromSearch({}))).toBe("/audit");
  });
  it.each([
    { actor: "not-an-id" },
    { area: "credentials" },
    { actor: [id, id] },
    { beforeId: id },
    { beforeAt: "2026-02-31T00:00:00Z", beforeId: id },
  ])("rifiuta filtri/cursori non validi %j", (value) =>
    expect(() => activityQueryFromSearch(value)).toThrow(),
  );
  it("proietta solo il DTO autorizzato", () => {
    expect(activityItemFromDatabase(item)).toEqual({
      id,
      occurredAt: item.occurred_at,
      actorId: id,
      actorName: item.actor_name,
      area: "team",
      message: item.message,
      href: item.href,
    });
    expect(() =>
      activityItemFromDatabase({ ...item, old_data: { email: "synthetic@example.invalid" } }),
    ).toThrow();
  });
  it.each([
    "https://example.invalid",
    "//example.invalid",
    "/auth/login",
    "/team?secret=token",
    "/team#x<script>",
  ])("non accetta href arbitrari %s", (href) => expect(safeActivityHref(href)).toBeNull());
  it("usa l’ancora reale dei progetti Sviluppo", () => {
    expect(safeActivityHref(`/development#progetto-${id}`)).toBe(`/development#progetto-${id}`);
    expect(safeActivityHref(`/development#project-${id}`)).toBeNull();
  });
});
