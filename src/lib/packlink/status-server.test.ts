import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
vi.mock("../finance-work/server", () => ({ financeWorkAccess: vi.fn() }));
import { financeWorkAccess } from "../finance-work/server";
import { readPacklinkSyncStatus } from "./status-server";
const snapshot = {
  configured: true,
  enabled: true,
  last_attempt_at: "2030-02-03T10:00:00Z",
  last_success_at: "2030-02-03T10:00:00Z",
  outcome: "applied",
  reason: null,
  counts: { inserted: 1, replayed: 2, ignored: 0 },
};
const setup = () => {
  const rpc = vi.fn().mockResolvedValue({ data: snapshot, error: null });
  return { rpc, client: { rpc } as unknown as SupabaseClient };
};
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());
describe("Packlink health access", () => {
  it("does not report an active runtime when its flag is on but a credential is missing", async () => {
    const s = setup();
    vi.mocked(financeWorkAccess).mockResolvedValue({ status: "authorized", member: {} } as never);
    vi.stubEnv("PACKLINK_WORKER_ENABLED", "true");
    vi.stubEnv("PACKLINK_API_KEY", "synthetic_packlink_api_key");
    vi.stubEnv("PACKLINK_WORKER_SECRET", "synthetic_packlink_worker_secret_32_chars");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_synthetic_server_key");
    expect(await readPacklinkSyncStatus(s.client)).toMatchObject({ snapshot: { enabled: true } });
    vi.stubEnv("PACKLINK_API_KEY", "");
    expect(await readPacklinkSyncStatus(s.client)).toMatchObject({ snapshot: { enabled: false } });
  });
  it("requires the current Finance area grant before the status RPC", async () => {
    const s = setup();
    vi.mocked(financeWorkAccess).mockResolvedValue({ status: "area-locked" });
    expect(await readPacklinkSyncStatus(s.client, true)).toEqual({ status: "unavailable" });
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it("uses the authenticated client and respects a paused server runtime", async () => {
    const s = setup();
    vi.mocked(financeWorkAccess).mockResolvedValue({ status: "authorized", member: {} } as never);
    expect(await readPacklinkSyncStatus(s.client, false)).toMatchObject({
      status: "ready",
      snapshot: { enabled: false },
    });
    expect(s.rpc).toHaveBeenCalledWith("get_packlink_sync_status");
  });
  it("fails closed on database errors without exposing their message", async () => {
    const s = setup();
    vi.mocked(financeWorkAccess).mockResolvedValue({ status: "authorized", member: {} } as never);
    s.rpc.mockResolvedValue({ data: null, error: { message: "synthetic private error" } });
    expect(await readPacklinkSyncStatus(s.client, true)).toEqual({ status: "unavailable" });
  });
});
