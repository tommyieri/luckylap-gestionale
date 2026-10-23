import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadActivityFeed } from "./feed-server";
const id = "10000000-0000-4000-8000-000000000001";
const member = {
  userId: id,
  displayName: "Founder sintetico",
  role: "founder" as const,
  financeAccess: false,
};
const query = { actor: null, area: null, before: null };
const row = {
  id,
  occurred_at: "2026-10-22T10:00:00.000001Z",
  actor_id: null,
  actor_name: "Automazioni",
  area: "sales",
  message: "Il sistema ha ricevuto un ordine Shopify.",
  href: "/sales",
};
const payload = {
  items: [row],
  actors: [{ id: "system", name: "Automazioni" }],
  next_cursor: null,
};
const rpc = vi.fn();
const client = { rpc, from: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: payload, error: null });
});
describe("confine server del feed CEO", () => {
  it("non interroga dati per ruolo diverso o area bloccata", async () => {
    await expect(
      loadActivityFeed(client as never, { ...member, role: "consultant" }, true, query),
    ).rejects.toThrow();
    await expect(loadActivityFeed(client as never, member, false, query)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });
  it("usa solo la RPC soggetta al gate database corrente", async () => {
    const result = await loadActivityFeed(client as never, member, true, query);
    expect(result.items[0].actorId).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("ceo_activity_feed", {
      p_actor: null,
      p_area: null,
      p_before_at: null,
      p_before_id: null,
      p_limit: 50,
    });
  });
  it("non converte una negazione o una lettura parziale in feed vuoto", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Private SQL" } });
    await expect(loadActivityFeed(client as never, member, true, query)).rejects.toThrow(
      /non disponibile/,
    );
    rpc.mockResolvedValueOnce({
      data: { ...payload, items: [{ ...row, new_data: {} }] },
      error: null,
    });
    await expect(loadActivityFeed(client as never, member, true, query)).rejects.toThrow();
  });
  it("rifiuta duplicati, cursori incoerenti e actor menu alterato", async () => {
    for (const data of [
      { ...payload, items: [row, row] },
      { ...payload, next_cursor: { occurred_at: row.occurred_at, id } },
      {
        ...payload,
        actors: [{ id: "system", name: "Automazioni", email: "synthetic@example.invalid" }],
      },
    ]) {
      rpc.mockResolvedValueOnce({ data, error: null });
      await expect(loadActivityFeed(client as never, member, true, query)).rejects.toThrow();
    }
  });
});
