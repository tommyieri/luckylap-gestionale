import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { confirmInvitation, readPasswordAccess, setMemberPassword } from "./invitation-server";

const hash = "a".repeat(64);
const password = "Synthetic-only-password";
function fixture(options: { member?: boolean; signedIn?: boolean; aal?: "aal1" | "aal2"; next?: "aal1" | "aal2"; factor?: boolean } = {}) {
  const auth = {
    verifyOtp: vi.fn().mockResolvedValue({ error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: options.signedIn === false ? null : { id: "synthetic-user", user_metadata: { role: "founder" } } }, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: { id: "synthetic-user" } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: options.aal ?? "aal1", nextLevel: options.next ?? "aal1" }, error: null }),
      listFactors: vi.fn().mockResolvedValue({ data: { all: options.factor ? [{ id: "factor", status: "verified", factor_type: "totp" }] : [] }, error: null }),
    },
  };
  const from = vi.fn((table: string) => {
    const builder = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ error: null, data: table === "memberships"
        ? options.member === false ? null : { user_id: "synthetic-user", role: "logistics", active: true, finance_access: false }
        : { user_id: "synthetic-user", display_name: "Synthetic member" } }),
    };
    return builder;
  });
  return { client: { auth, from } as unknown as SupabaseClient, auth, from };
}

describe("server invitation confirmation", () => {
  it("exchanges only the allowed token and verifies Auth identity plus current DB membership", async () => {
    const f = fixture();
    expect(await confirmInvitation(f.client, hash, "invite")).toEqual({ status: "confirmed" });
    expect(f.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: hash, type: "invite" });
    expect(f.auth.getUser).toHaveBeenCalledOnce();
    expect(f.from.mock.calls.map(row => row[0]).sort()).toEqual(["memberships", "profiles"]);
    expect(f.auth.updateUser).not.toHaveBeenCalled();
  });
  it("supports recovery through the same explicit exchange", async () => {
    const f = fixture();
    expect((await confirmInvitation(f.client, hash, "recovery")).status).toBe("confirmed");
    expect(f.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: hash, type: "recovery" });
  });
  it("does not exchange invalid token input", async () => {
    const f = fixture();
    expect((await confirmInvitation(f.client, hash, "email")).status).toBe("error");
    expect(f.auth.verifyOtp).not.toHaveBeenCalled();
  });
  it("clears a successful session when the DB membership is missing regardless of metadata", async () => {
    const f = fixture({ member: false });
    expect((await confirmInvitation(f.client, hash, "invite")).status).toBe("error");
    expect(f.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("never exposes raw OTP errors or tokens", async () => {
    const f = fixture();
    f.auth.verifyOtp.mockResolvedValue({ error: { message: `Private server detail ${hash}` } });
    const result = await confirmInvitation(f.client, hash, "invite");
    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain(hash);
    expect(JSON.stringify(result)).not.toContain("Private server detail");
    expect(f.auth.getUser).not.toHaveBeenCalled();
  });
});

describe("server password setup", () => {
  it("sets only password on the authenticated current member then signs out locally", async () => {
    const f = fixture();
    expect(await setMemberPassword(f.client, password, password)).toEqual({ status: "updated-signed-out" });
    expect(f.auth.getUser).toHaveBeenCalledOnce();
    expect(f.auth.updateUser).toHaveBeenCalledWith({ password });
    expect(f.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(f.auth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(f.auth.signOut.mock.invocationCallOrder[0]);
  });
  it.each([{ signedIn: false }, { member: false }])("requires both verified user and membership at mutation time", async options => {
    const f = fixture(options);
    expect((await setMemberPassword(f.client, password, password)).status).toBe("error");
    expect(f.auth.updateUser).not.toHaveBeenCalled();
  });
  it("requires MFA when next AAL demands it", async () => {
    const f = fixture({ next: "aal2" });
    expect(await setMemberPassword(f.client, password, password)).toEqual({ status: "mfa-required" });
    expect(f.auth.updateUser).not.toHaveBeenCalled();
  });
  it("requires a fresh existing factor even if cached next AAL is stale", async () => {
    const f = fixture({ factor: true });
    expect((await readPasswordAccess(f.client)).status).toBe("mfa-required");
    expect((await setMemberPassword(f.client, password, password)).status).toBe("mfa-required");
    expect(f.auth.updateUser).not.toHaveBeenCalled();
  });
  it("allows a verified aal2 session", async () => {
    const f = fixture({ factor: true, aal: "aal2", next: "aal2" });
    expect((await setMemberPassword(f.client, password, password)).status).toBe("updated-signed-out");
  });
  it("fails closed on unavailable factors/AAL and does not update", async () => {
    const f = fixture();
    f.auth.mfa.listFactors.mockResolvedValue({ data: null, error: { message: "private" } });
    expect((await setMemberPassword(f.client, password, password)).status).toBe("error");
    expect(f.auth.updateUser).not.toHaveBeenCalled();
  });
  it("validates password and confirmation before contacting Auth", async () => {
    const f = fixture();
    expect((await setMemberPassword(f.client, "short", "short")).status).toBe("error");
    expect(f.auth.getUser).not.toHaveBeenCalled();
    expect(f.auth.updateUser).not.toHaveBeenCalled();
  });
  it("does not claim success or sign out when password update fails", async () => {
    const f = fixture();
    f.auth.updateUser.mockResolvedValue({ data: { user: null }, error: { message: `Private ${password}` } });
    const result = await setMemberPassword(f.client, password, password);
    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain(password);
    expect(f.auth.signOut).not.toHaveBeenCalled();
  });
  it("distinguishes saved password from a failed sign-out instead of encouraging another password write", async () => {
    const f = fixture();
    f.auth.signOut.mockResolvedValue({ error: { message: "private" } });
    expect(await setMemberPassword(f.client, password, password)).toEqual({ status: "updated-session-open" });
  });
});
