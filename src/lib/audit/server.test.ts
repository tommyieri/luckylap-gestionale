import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerifiedMember } from "../auth/model";
vi.mock("server-only", () => ({}));
import { loadAuditMetadata } from "./server";

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const stamp = "2026-10-21T11:46:40.813337+00:00";
const founder: VerifiedMember = {
  userId: id(1),
  displayName: "Founder sintetico",
  role: "founder",
  financeAccess: true,
};
const row = (index: number, actor: string | null = null) => ({
  id: id(index),
  occurred_at: stamp,
  actor_id: actor,
  table_name: "finance_import_transactions",
  operation: "INSERT",
  record_key: { id: id(index) },
});
type Reply = { data: unknown[] | null; error: unknown; count: number | null };
function client(...replies: Reply[]) {
  const calls: { table: string; methods: { name: string; args: unknown[] }[] }[] = [];
  const db = {
    from: vi.fn((table: string) => {
      const call = { table, methods: [] as { name: string; args: unknown[] }[] };
      calls.push(call);
      const reply = replies.shift();
      const query: Record<string, unknown> = {};
      for (const name of ["select", "order", "limit", "or", "in"])
        query[name] = (...args: unknown[]) => {
          call.methods.push({ name, args });
          return query;
        };
      query.then = (
        resolve: (value: Reply | undefined) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(reply).then(resolve, reject);
      return query;
    }),
  };
  return { supabase: db as unknown as SupabaseClient, calls, from: db.from };
}

describe("founder audit read boundary", () => {
  it.each(["production", "finance", "logistics", "consultant"] as const)(
    "does not query logs or actor profiles for role %s",
    async (role) => {
      const db = client();
      await expect(
        loadAuditMetadata(db.supabase, { ...founder, role }, true, null),
      ).rejects.toThrow(/founder/);
      expect(db.from).not.toHaveBeenCalled();
    },
  );
  it("does not query without a verified CEO area grant", async () => {
    const db = client();
    await expect(loadAuditMetadata(db.supabase, founder, false, null)).rejects.toThrow();
    expect(db.from).not.toHaveBeenCalled();
  });
  it("selects metadata only and labels null actors as system operations", async () => {
    const db = client({ data: [row(1)], error: null, count: 1 });
    const result = await loadAuditMetadata(db.supabase, founder, true, null);
    expect(db.calls[0].methods.find((method) => method.name === "select")?.args).toEqual([
      "id,occurred_at,actor_id,table_name,operation,record_key",
      { count: "exact" },
    ]);
    expect(JSON.stringify(db.calls)).not.toMatch(/old_data|new_data/);
    expect(result.entries[0].actorName).toBe("Operazione di sistema");
    expect(db.from).toHaveBeenCalledTimes(1);
  });
  it("fetches only the names of operators visible on this page", async () => {
    const db = client(
      { data: [row(1, id(2))], error: null, count: 1 },
      { data: [{ user_id: id(2), display_name: "Operatore sintetico" }], error: null, count: 1 },
    );
    const result = await loadAuditMetadata(db.supabase, founder, true, null);
    expect(result.entries[0].actorName).toBe("Operatore sintetico");
    expect(db.calls[1].methods).toContainEqual({
      name: "select",
      args: ["user_id,display_name", { count: "exact" }],
    });
    expect(db.calls[1].methods).toContainEqual({ name: "in", args: ["user_id", [id(2)]] });
  });
  it("uses a tuple cursor without truncating microseconds or relying on offsets", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => row(100 - index));
    const db = client({ data: rows, error: null, count: 51 });
    const cursor = { occurredAt: stamp, id: id(101) };
    const result = await loadAuditMetadata(db.supabase, founder, true, cursor);
    expect(result.entries).toHaveLength(50);
    expect(result.nextCursor).toEqual({ occurredAt: stamp, id: id(51) });
    expect(db.calls[0].methods).toContainEqual({
      name: "or",
      args: [`occurred_at.lt.${stamp},and(occurred_at.eq.${stamp},id.lt.${id(101)})`],
    });
    expect(db.calls[0].methods.map((method) => method.name)).not.toContain("range");
  });
  it("rejects a lowered API limit or private query errors without returning partial data", async () => {
    for (const reply of [
      { data: [row(1)], error: null, count: 2 },
      { data: null, error: { message: "Private database diagnostic" }, count: null },
    ]) {
      const db = client(reply);
      await expect(loadAuditMetadata(db.supabase, founder, true, null)).rejects.toThrow(
        /Registro non disponibile/,
      );
    }
  });
});
