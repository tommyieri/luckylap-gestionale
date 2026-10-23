import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.verify }));
import { executePartnerWork, readPartnerWorkLinks } from "./server";
const actorId = "10000000-0000-4000-8000-000000000001",
  partnerId = "20000000-0000-4000-8000-000000000001",
  operationId = "30000000-0000-4000-8000-000000000001";
const command = {
  operationId,
  actorId,
  payload: { schema_version: 1, kind: "project", partner_id: partnerId },
};
const receipt = {
  operation_id: operationId,
  partner_id: partnerId,
  kind: "project",
  target_id: partnerId,
  replayed: false,
};
const client = (data: unknown = receipt, error: unknown = null) => ({
  rpc: vi.fn().mockResolvedValue({ data, error }),
  from: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({
    status: "member",
    member: { userId: actorId, role: "consultant" },
  });
});
describe("accesso e invii dei collegamenti Partner", () => {
  it("verifica la membership prima di ogni lettura o invio", async () => {
    mocks.verify.mockResolvedValue({ status: "denied" });
    const db = client();
    expect(await readPartnerWorkLinks(db as never)).toEqual({ status: "denied" });
    expect(await executePartnerWork(db as never, command)).toMatchObject({
      status: "rejected",
      code: "partner_work_access_required",
    });
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each(["founder", "production", "logistics", "finance", "consultant"])(
    "consente %s, senza inviare un attore dichiarato al database",
    async (role) => {
      mocks.verify.mockResolvedValue({ status: "member", member: { userId: actorId, role } });
      const db = client();
      expect(await executePartnerWork(db as never, command)).toMatchObject({ status: "success" });
      expect(db.rpc).toHaveBeenCalledExactlyOnceWith("create_partner_work", {
        p_operation_id: operationId,
        p_payload: command.payload,
      });
    },
  );
  it("rifiuta un cambio account e mantiene incerti i retry senza autorizzazione", async () => {
    mocks.verify.mockResolvedValue({
      status: "member",
      member: { userId: partnerId, role: "founder" },
    });
    const db = client();
    expect(await executePartnerWork(db as never, command)).toMatchObject({ status: "rejected" });
    expect(await executePartnerWork(db as never, { ...command, retry: true })).toMatchObject({
      status: "uncertain",
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("distingue CAS, conflitto del riferimento e ricevuta non correlata senza dettagli SQL", async () => {
    for (const [code, message] of [
      ["40001", "partner_work_changed"],
      ["23505", "partner_work_idempotency_conflict"],
      ["22023", "partner_work_not_agreed"],
    ]) {
      const result = await executePartnerWork(
        client(null, { code, message, details: "private SQL" }) as never,
        command,
      );
      expect(result).toMatchObject({ status: "rejected", code: message });
      expect(JSON.stringify(result)).not.toContain("private SQL");
    }
    expect(
      await executePartnerWork(client({ ...receipt, operation_id: partnerId }) as never, command),
    ).toMatchObject({ status: "uncertain" });
    expect(
      await executePartnerWork(
        client(null, { code: "42501", message: "partner_work_access_required" }) as never,
        { ...command, retry: true },
      ),
    ).toMatchObject({ status: "uncertain" });
  });
  it("richiede pagine complete, non filtra i proprietari e seleziona solo le colonne necessarie", async () => {
    const selects: string[] = [],
      filters: string[] = [];
    const db = client();
    db.from.mockImplementation(() => ({
      select: (columns: string) => {
        selects.push(columns);
        const query = {
          order: vi.fn(() => query),
          limit: vi.fn(() => query),
          gt: (column: string) => {
            filters.push(column);
            return query;
          },
          then: (resolve: (value: unknown) => void) => resolve({ data: [], count: 0, error: null }),
        };
        return query;
      },
    }));
    expect(await readPartnerWorkLinks(db as never)).toMatchObject({
      status: "ready",
      snapshot: { partners: [], links: [] },
    });
    expect(selects.join(",")).not.toMatch(/contact|email|phone|research|source_snapshot|owner_id/);
    expect(filters).toEqual([]);
    db.from.mockImplementation(() => {
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
        then: (resolve: (value: unknown) => void) => resolve({ data: [], count: 1, error: null }),
      };
      return query;
    });
    await expect(readPartnerWorkLinks(db as never)).rejects.toThrow(/completa/);
  });
  it("legge oltre 200 associazioni con cursore composto senza perdere gli ordini dello stesso evento", async () => {
    const eventId = "40000000-0000-4000-8000-000000000001";
    const ids = Array.from(
      { length: 201 },
      (_, index) => `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const rows: Record<string, Record<string, unknown>[]> = {
      partners: [
        {
          id: partnerId,
          co: 42,
          name: "Partner sintetico",
          sections: ["eventi"],
          event_starts_on: null,
          event_ends_on: null,
          application_deadline: null,
          stage: "trattativa",
        },
      ],
      partner_work_links: [],
      sales_orders: ids.map((id) => ({
        id,
        external_reference: null,
        occurred_at: "2028-03-26T12:00:00Z",
        channel: "direct",
      })),
      partner_event_sales: ids.map((id) => ({
        event_id: eventId,
        order_id: id,
        partner_id: partnerId,
      })),
    };
    const cursors: string[] = [];
    const db = client();
    db.from.mockImplementation((table: string) => {
      let after: string | null = null,
        composed: string | null = null,
        limit = 0;
      const query = {
        select: () => query,
        order: () => query,
        limit: (value: number) => {
          limit = value;
          return query;
        },
        gt: (_column: string, value: string) => {
          after = value;
          return query;
        },
        or: (value: string) => {
          cursors.push(value);
          composed = /order_id.gt.([0-9a-f-]{36})/.exec(value)![1];
          return query;
        },
        then: (resolve: (value: unknown) => unknown) => {
          const page = rows[table].filter(
            (row) =>
              (!after || String(row.id) > after) && (!composed || String(row.order_id) > composed),
          );
          return Promise.resolve({
            data: page.slice(0, limit),
            count: page.length,
            error: null,
          }).then(resolve);
        },
      };
      return query;
    });
    const result = await readPartnerWorkLinks(db as never);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Lettura non pronta");
    expect(result.snapshot.orders).toHaveLength(201);
    expect(result.snapshot.eventSales).toHaveLength(201);
    expect(cursors).toEqual([
      `event_id.gt.${eventId},and(event_id.eq.${eventId},order_id.gt.${ids[199]})`,
    ]);
  });
});
