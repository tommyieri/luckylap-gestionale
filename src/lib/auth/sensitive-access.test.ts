import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { verifiedSensitiveAccess } from "./sensitive-access";
import { lockSensitiveArea, unlockSensitiveArea } from "./sensitive-actions";
import type { VerifiedMember } from "./model";
const id = "10000000-0000-4000-8000-000000000001";
const member: VerifiedMember = {
  userId: id,
  displayName: "Synthetic Founder",
  role: "founder",
  financeAccess: true,
};
const password = "abcdef";
function fixture(
  options: {
    role?: string;
    active?: boolean;
    signedIn?: boolean;
    grant?: unknown;
    finance?: boolean;
  } = {},
) {
  const rpc = vi.fn().mockResolvedValue({ data: options.grant ?? true, error: null });
  const getUser = vi.fn().mockResolvedValue({
    data: {
      user:
        options.signedIn === false
          ? null
          : { id, user_metadata: { role: "founder", area_unlocked: true } },
    },
    error: null,
  });
  const auth = {
    getUser,
    mfa: {
      getAuthenticatorAssuranceLevel: vi
        .fn()
        .mockResolvedValue({ data: { currentLevel: "aal2" }, error: null }),
    },
  };
  const from = vi.fn((table: string) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      error: null,
      data:
        table === "memberships"
          ? {
              user_id: id,
              role: options.role ?? "founder",
              active: options.active ?? true,
              finance_access: options.finance ?? true,
            }
          : { user_id: id, display_name: "Synthetic Founder" },
    }),
  }));
  return { client: { auth, from, rpc } as unknown as SupabaseClient, rpc, from, auth };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());
describe("fresh session password grants", () => {
  it.each(["logistics", "consultant"] as const)(
    "requires a fresh password grant regardless of the former %s role restriction",
    async (role) => {
      const f = fixture({ grant: false });
      expect(
        await verifiedSensitiveAccess(
          f.client,
          { ...member, role, financeAccess: false },
          "finance",
        ),
      ).toBe(false);
      expect(f.rpc).toHaveBeenCalledExactlyOnceWith("sensitive_area_status", { p_area: "finance" });
    },
  );
  it("rechecks DB status on every call and does not use aal2 to bypass a closed gate", async () => {
    const f = fixture();
    f.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    expect(await verifiedSensitiveAccess(f.client, member, "finance")).toBe(true);
    expect(await verifiedSensitiveAccess(f.client, member, "finance")).toBe(false);
    expect(f.rpc).toHaveBeenCalledTimes(2);
    expect(f.rpc).toHaveBeenLastCalledWith("sensitive_area_status", { p_area: "finance" });
    expect(f.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });
  it.each([
    { data: "aal2", error: null },
    { data: null, error: null },
    { data: true, error: { message: "private detail" } },
  ])("fails closed on invalid status or errors (%j)", async (reply) => {
    const f = fixture();
    f.rpc.mockResolvedValue(reply);
    await expect(verifiedSensitiveAccess(f.client, member, "audit")).rejects.toThrow(
      "Verifica dell’area riservata non disponibile.",
    );
  });
});
describe("shared area password commands", () => {
  it("authenticates the current user and membership before sending the exact password to one RPC", async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({
      data: { status: "unlocked", expires_at: "2026-10-21T20:00:00Z" },
      error: null,
    });
    const result = await unlockSensitiveArea(f.client, "finance", password);
    expect(result).toEqual({ status: "unlocked", area: "finance" });
    expect(JSON.stringify(result)).not.toContain(password);
    expect(f.auth.getUser).toHaveBeenCalledOnce();
    expect(f.from.mock.calls.map((call) => call[0])).toEqual(["memberships", "profiles"]);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("unlock_sensitive_area", {
      p_area: "finance",
      p_password: password,
    });
    expect(f.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });
  it.each([{ signedIn: false }, { active: false }])(
    "does not unlock for missing or revoked access (%j)",
    async (options) => {
      const f = fixture(options);
      expect((await unlockSensitiveArea(f.client, "finance", password)).status).toBe("error");
      expect(f.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(["founder", "production", "finance", "logistics", "consultant"] as const)(
    "lets active %s unlock either area with the correct password and no Finance flag",
    async (role) => {
      const f = fixture({ role, finance: false });
      f.rpc.mockResolvedValue({
        data: { status: "unlocked", expires_at: "2026-10-21T20:00:00Z" },
        error: null,
      });
      for (const area of ["finance", "audit"] as const) {
        expect(await unlockSensitiveArea(f.client, area, password)).toEqual({
          status: "unlocked",
          area,
        });
        expect(f.rpc).toHaveBeenLastCalledWith("unlock_sensitive_area", {
          p_area: area,
          p_password: password,
        });
      }
    },
  );
  it.each(["other", "https://hostile.test", "/finance?next=https://hostile.test", null])(
    "rejects non-allowlisted destinations (%j)",
    async (area) => {
      const f = fixture();
      expect((await unlockSensitiveArea(f.client, area, password)).status).toBe("error");
      expect(f.auth.getUser).not.toHaveBeenCalled();
    },
  );
  it.each(["abcde", "x".repeat(73), "🙂".repeat(19), "🙂".repeat(3), new Blob([password]), null])(
    "rejects password bounds/types (%j)",
    async (value) => {
      const f = fixture();
      const result = await unlockSensitiveArea(f.client, "finance", value);
      expect(result.status).toBe("error");
      expect(f.rpc).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(password);
    },
  );
  it.each(["denied", "locked"])(
    "returns a safe %s message without submitted values",
    async (status) => {
      const f = fixture();
      f.rpc.mockResolvedValue({
        data: { status, expires_at: status === "locked" ? "2026-10-21T12:15:00Z" : null },
        error: null,
      });
      const result = await unlockSensitiveArea(f.client, "finance", password);
      expect(result.status).toBe("error");
      expect(JSON.stringify(result)).not.toContain(password);
    },
  );
  it.each([
    { status: "unlocked", expires_at: null },
    { status: "unlocked", expires_at: "2026-10-21T11:00:00Z" },
    { status: "unlocked", expires_at: "bad" },
  ])("does not redirect after an incomplete or expired grant (%j)", async (data) => {
    const f = fixture();
    f.rpc.mockResolvedValue({ data, error: null });
    expect((await unlockSensitiveArea(f.client, "finance", password)).status).toBe("error");
  });
  it("does not expose backend error diagnostics or echoed password properties", async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({
      data: { status: "unlocked", expires_at: "2026-10-21T20:00:00Z", password },
      error: null,
    });
    expect(JSON.stringify(await unlockSensitiveArea(f.client, "finance", password))).not.toContain(
      password,
    );
    f.rpc.mockResolvedValue({ data: null, error: { message: `private ${password}` } });
    expect(JSON.stringify(await unlockSensitiveArea(f.client, "finance", password))).not.toMatch(
      /private|abcdef/,
    );
  });
  it("locks only the current member session and accepts the idempotent true response", async () => {
    const f = fixture();
    expect(await lockSensitiveArea(f.client, "audit")).toEqual({ status: "locked", area: "audit" });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("lock_sensitive_area", { p_area: "audit" });
  });
  it("does not claim a lock after revocation or a failed DB response", async () => {
    const revoked = fixture({ active: false });
    expect((await lockSensitiveArea(revoked.client, "finance")).status).toBe("error");
    expect(revoked.rpc).not.toHaveBeenCalled();
    const f = fixture({ grant: false });
    expect((await lockSensitiveArea(f.client, "finance")).status).toBe("error");
  });
});
