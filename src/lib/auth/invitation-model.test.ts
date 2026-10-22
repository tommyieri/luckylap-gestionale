import { describe, expect, it } from "vitest";
import { parseInvitation, validateNewPassword } from "./invitation-model";

describe("invitation input boundary", () => {
  it.each(["invite", "recovery"])("accepts only the explicit %s flow", (type) => {
    expect(parseInvitation("a".repeat(56), type)).toEqual({ token_hash: "a".repeat(56), type });
  });
  it.each(["email", "signup", "magiclink", "email_change", "sms", "INVITE", null, ["invite"]])(
    "rejects other OTP types",
    (type) => {
      expect(parseInvitation("a".repeat(64), type)).toBeNull();
    },
  );
  it.each([
    null,
    ["a".repeat(64)],
    "a".repeat(31),
    "a".repeat(257),
    " a".repeat(32),
    "<script>".repeat(8),
    "x?next=https://example.test",
    "a".repeat(32) + "\n",
  ])("rejects malformed hashes without normalizing them", (hash) => {
    expect(parseInvitation(hash, "invite")).toBeNull();
  });
});

describe("new password validation", () => {
  it("keeps an exact passphrase including spaces and accepts the boundaries", () => {
    for (const password of [
      "a".repeat(6),
      "a".repeat(72),
      "🙂".repeat(18),
      "  A long passphrase  ",
    ]) {
      expect(validateNewPassword(password, password)).toEqual({ ok: true, password });
    }
  });
  it.each([
    "a".repeat(5),
    "a".repeat(73),
    "🙂".repeat(19),
    "🙂".repeat(3),
    " ".repeat(6),
    null,
    new Blob(["secret"]),
  ])("rejects invalid lengths or types", (password) => {
    expect(validateNewPassword(password, password).ok).toBe(false);
  });
  it("requires an exact confirmation without returning the submitted values on errors", () => {
    const password = "Synthetic-test-passphrase";
    const result = validateNewPassword(password, password + " ");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(password);
    expect(validateNewPassword(password, null).ok).toBe(false);
  });
});
