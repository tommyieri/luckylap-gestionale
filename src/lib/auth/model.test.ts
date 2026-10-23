import { describe, expect, it } from "vitest";
import {
  memberFromDatabase,
  parseCredentials,
  canReadSensitiveArea,
  MEMBER_ROLES,
  type SensitiveArea,
} from "./model";

describe("trusted membership", () => {
  const row = { user_id: "verified-user", role: "production", active: true, finance_access: true };
  const profile = { user_id: "verified-user", display_name: "Gabriele" };
  it("requires matching active membership and profile from the database", () => {
    expect(memberFromDatabase("verified-user", row, profile)?.role).toBe("production");
    expect(memberFromDatabase("another-user", row, profile)).toBeNull();
    expect(memberFromDatabase("verified-user", { ...row, active: false }, profile)).toBeNull();
    expect(memberFromDatabase("verified-user", { ...row, role: "admin" }, profile)).toBeNull();
    expect(memberFromDatabase("verified-user", null, profile)).toBeNull();
    expect(
      memberFromDatabase("verified-user", row, { ...profile, user_id: "another-user" }),
    ).toBeNull();
  });
  it("requires an explicit area grant for every active role, never an assurance string", () => {
    const member = memberFromDatabase("verified-user", row, profile)!;
    for (const role of MEMBER_ROLES) {
      for (const area of ["finance", "audit"] as const) {
        for (const financeAccess of [true, false]) {
          const current = { ...member, role, financeAccess };
          expect(canReadSensitiveArea(current, area, false)).toBe(false);
          expect(canReadSensitiveArea(current, area, true)).toBe(true);
          expect(canReadSensitiveArea(current, area, "aal2" as unknown as boolean)).toBe(false);
        }
      }
    }
    expect(canReadSensitiveArea(member, "other" as SensitiveArea, true)).toBe(false);
  });
});

describe("password sign-in input", () => {
  it("validates bounds without changing the password", () => {
    expect(parseCredentials(" name@example.com ", " keep spaces ")).toEqual({
      email: "name@example.com",
      password: " keep spaces ",
    });
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
