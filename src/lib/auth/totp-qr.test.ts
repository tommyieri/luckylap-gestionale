import { describe, expect, it } from "vitest";
import { totpQrDataUri } from "./totp-qr";

describe("Supabase TOTP QR contract", () => {
  it("preserves the SVG data URI supplied by the SDK without nesting it", () => {
    const uri = 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
    expect(totpQrDataUri(uri)).toBe(uri);
  });
  it("rejects remote URLs and malformed payloads", () => {
    expect(totpQrDataUri("https://example.com/qr.svg")).toBeNull();
    expect(totpQrDataUri("data:image/svg+xml;utf-8,")).toBeNull();
    expect(totpQrDataUri(null)).toBeNull();
  });
});
