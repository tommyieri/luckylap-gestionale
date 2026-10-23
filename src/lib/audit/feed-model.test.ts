import { describe, expect, it } from "vitest";
import {
  ACTIVITY_AREAS,
  activityAreaLabel,
  activityQueryFromSearch,
  activityCursorHref,
  activityItemFromDatabase,
  safeActivityHref,
} from "./feed-model";
import { previewActivityFeed } from "./fixtures";
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
  it("senza filtri chiede tutti, founder compreso («Tutti»)", () => {
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
    "/team",
    `/team#evento-${id}`,
    `/team#attivita-${id}`,
    `/team#nota-${id}`,
    "/sales",
    `/sales#order-${id}`,
    "/consignment",
    "/consignment/NEG01",
    "/consignment/NEG01/resoconto/2026-10",
    "/stock",
    "/stock/rettifiche",
    "/stock/riassortimento",
    `/stock/riassortimento/${id}`,
    "/packaging",
    "/finance",
    `/finance#movimento-shop_payment-${id}`,
    `/finance#movimento-manual-${id}`,
    `/finance#movimento-budgetflow-${id}`,
    `/finance#movimento-payment-${id}`,
    `/finance#movimento-refund-${id}`,
    `/finance#movimento-consignment-${id}`,
    "/partner",
    "/partner?co=12#lead-12",
    "/development",
    `/development#progetto-${id}`,
    "/assets",
    `/assets#contenuto-${id}`,
    "/auth/account",
  ])("accetta il link della decisione 17 %s", (href) => expect(safeActivityHref(href)).toBe(href));
  it.each([
    "https://example.invalid",
    "//example.invalid",
    "/auth/login",
    "/team?secret=token",
    "/team#x<script>",
    `/TEAM#evento-${id}`,
    `/sales#evento-${id}`,
    `/stock#articolo-${id}`,
    "/stock/rettifiche/1",
    "/stock/riassortimento/1",
    `/stock/riassortimento/${id}/x`,
    "/consignment/neg01",
    "/consignment/NEG01/resoconto/2026-13",
    "/consignment/NEG01/conta",
    `/finance#movimento-altro-${id}`,
    "/finance#movimento-manual-A0000000-0000-4000-8000-00000000000B",
    "/partner?co=12#lead-13",
    "/partner?co=0#lead-0",
    `/assets#asset-${id}`,
    "/packaging#material-x",
  ])("non accetta href arbitrari %s", (href) => expect(safeActivityHref(href)).toBeNull());
  it("ha l’area «Conto vendita» distinta da Vendite", () => {
    expect(ACTIVITY_AREAS).toContain("consignment");
    expect(activityAreaLabel("consignment")).toBe("Conto vendita");
    expect(activityAreaLabel("sales")).toBe("Vendite");
    expect(activityQueryFromSearch({ area: "consignment" }).area).toBe("consignment");
  });
  it("l’anteprima locale usa solo link ammessi e frasi delle ultime 24 ore", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    const page = previewActivityFeed(now, { actor: null, area: null, before: null });
    expect(page.items.length).toBeGreaterThan(10);
    for (const entry of page.items) {
      expect(
        activityItemFromDatabase({
          id: entry.id,
          occurred_at: entry.occurredAt,
          actor_id: entry.actorId,
          actor_name: entry.actorName,
          area: entry.area,
          message: entry.message,
          href: entry.href,
        }).href,
      ).toBe(entry.href);
      expect(now.getTime() - Date.parse(entry.occurredAt)).toBeLessThan(24 * 3600 * 1000);
      if (!entry.message.includes("da fatturare")) expect(entry.message).not.toMatch(/€|\d+,\d{2}/);
    }
    expect(
      previewActivityFeed(now, { actor: "system", area: null, before: null }).items.every(
        (entry) => entry.actorId === null,
      ),
    ).toBe(true);
    expect(
      previewActivityFeed(now, { actor: null, area: "consignment", before: null }).items,
    ).toHaveLength(1);
  });
  it("usa l’ancora reale dei progetti Sviluppo", () => {
    expect(safeActivityHref(`/development#progetto-${id}`)).toBe(`/development#progetto-${id}`);
    expect(safeActivityHref(`/development#project-${id}`)).toBeNull();
  });
});
