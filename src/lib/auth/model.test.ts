import { describe, expect, it } from "vitest";
import { memberFromDatabase, parseCredentials, canReadSensitiveArea } from "./model";

describe("trusted membership", () => {
  const row = { user_id: "verified-user", role: "production", active: true, finance_access: true };
  const profile = { user_id: "verified-user", display_name: "Gabriele" };
  it("requires matching active membership and profile from the database", () => {
    expect(memberFromDatabase("verified-user", row, profile)?.role).toBe("production");
    expect(memberFromDatabase("another-user", row, profile)).toBeNull();
    expect(memberFromDatabase("verified-user", { ...row, active: false }, profile)).toBeNull();
    expect(memberFromDatabase("verified-user", { ...row, role: "admin" }, profile)).toBeNull();
    expect(memberFromDatabase("verified-user", null, profile)).toBeNull();
    expect(memberFromDatabase("verified-user", row, { ...profile, user_id: "another-user" })).toBeNull();
  });
  it("requires an explicit area grant and the current role, never an assurance string", () => {
    const member = memberFromDatabase("verified-user", row, profile)!;
    expect(canReadSensitiveArea(member, "finance", false)).toBe(false);
    expect(canReadSensitiveArea(member, "finance", true)).toBe(true);
    expect(canReadSensitiveArea(member, "finance", "aal2" as unknown as boolean)).toBe(false);
    expect(canReadSensitiveArea({ ...member, financeAccess: false }, "finance", true)).toBe(false);
    expect(canReadSensitiveArea({ ...member, role: "logistics" }, "finance", true)).toBe(false);
    expect(canReadSensitiveArea(member, "audit", true)).toBe(false);
    expect(canReadSensitiveArea({ ...member, role: "founder" }, "audit", true)).toBe(true);
  });
});

describe("password sign-in input", () => {
  it("validates bounds without changing the password", () => {
    expect(parseCredentials(" name@example.com ", " keep spaces ")).toEqual({ email: "name@example.com", password: " keep spaces " });
    expect(parseCredentials("no-address", "password")).toBeNull();
    expect(parseCredentials("name@example.com", "")).toBeNull();
    expect(parseCredentials("name@example.com", "a".repeat(5))).toBeNull();
    expect(parseCredentials("name@example.com", "a".repeat(6))?.password).toBe("a".repeat(6));
    expect(parseCredentials("name@example.com", "a".repeat(73))).toBeNull();
    expect(parseCredentials("name@example.com", "🙂".repeat(19))).toBeNull();
    expect(parseCredentials("name@example.com", "🙂".repeat(3))).toBeNull();
    expect(parseCredentials(new File([], "email"), "password")).toBeNull();
  });
});
