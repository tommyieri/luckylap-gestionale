import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadActivityFeed } from "./feed-server";
const id = "10000000-0000-4000-8000-000000000001";
const NIL = "00000000-0000-0000-0000-000000000000";
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
  it.each(["founder", "production", "finance", "logistics", "consultant"] as const)(
    "non interroga il feed per %s senza la password verificata nella sessione",
    async (role) => {
      await expect(
        loadActivityFeed(client as never, { ...member, role }, false, query),
      ).rejects.toThrow();
      expect(rpc).not.toHaveBeenCalled();
      expect(client.from).not.toHaveBeenCalled();
    },
  );
  it.each(["founder", "production", "finance", "logistics", "consultant"] as const)(
    "legge il feed per %s solo tramite la RPC che riconferma il gate database",
    async (role) => {
      expect(
        (await loadActivityFeed(client as never, { ...member, role }, true, query)).items[0]
          .message,
      ).toBe(row.message);
      expect(rpc).toHaveBeenCalledExactlyOnceWith("ceo_activity_feed", {
        p_actor: null,
        p_area: null,
        p_before_at: null,
        p_before_id: null,
        p_limit: 50,
      });
      expect(client.from).not.toHaveBeenCalled();
    },
  );
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
  it("accetta il cursore di confine solo su una pagina corta e mai dopo le sue righe", async () => {
    const boundary = { occurred_at: "2026-10-22T09:00:00.000001Z", id: NIL };
    rpc.mockResolvedValueOnce({ data: { ...payload, next_cursor: boundary }, error: null });
    expect((await loadActivityFeed(client as never, member, true, query)).nextCursor).toEqual({
      occurredAt: boundary.occurred_at,
      id: NIL,
    });
    rpc.mockResolvedValueOnce({
      data: { ...payload, items: [], next_cursor: boundary },
      error: null,
    });
    expect((await loadActivityFeed(client as never, member, true, query)).items).toEqual([]);
    for (const next_cursor of [
      { occurred_at: "2026-10-22T11:00:00.000001Z", id: NIL },
      { occurred_at: boundary.occurred_at, id },
    ]) {
      rpc.mockResolvedValueOnce({ data: { ...payload, next_cursor }, error: null });
      await expect(loadActivityFeed(client as never, member, true, query)).rejects.toThrow();
    }
    const full = Array.from({ length: 50 }, (_, index) => ({
      ...row,
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    rpc.mockResolvedValueOnce({
      data: {
        ...payload,
        items: full,
        next_cursor: { occurred_at: row.occurred_at, id: full[49].id },
      },
      error: null,
    });
    expect((await loadActivityFeed(client as never, member, true, query)).nextCursor?.id).toBe(
      full[49].id,
    );
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
