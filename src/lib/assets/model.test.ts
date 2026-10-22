import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  assetStoragePath,
  isBrandStoragePath,
  MAX_ASSET_BYTES,
  parseBrandLink,
  parseUploadDescriptor,
  uploadContentType,
  type UploadDescriptor,
} from "./model";
import { verifyAssetBytes } from "./file-validation";

const uid = "00000000-0000-4000-8000-000000000001";
const op = "00000000-0000-4000-8000-000000000002";
const descriptor = (name: string, mime: string, bytes: Uint8Array): UploadDescriptor => ({
  operationId: op,
  originalName: name,
  mime,
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
});
describe("brand asset upload boundary", () => {
  it("uses a user/operation/safe-name path and preserves original name outside the object path", () => {
    const input = descriptor("Lògò 2026.PNG", "image/png", Uint8Array.of(1));
    expect(assetStoragePath(uid, input)).toBe(`${uid}/${op}/logo-2026.png`);
    expect(parseUploadDescriptor(input).originalName).toBe("Lògò 2026.PNG");
    expect(isBrandStoragePath(`system/${op}/logo.png`)).toBe(true);
    expect(isBrandStoragePath(`system/${op}/../../finance/file.png`)).toBe(false);
    expect(() => assetStoragePath(uid, { ...input, originalName: "../logo.png" })).toThrow();
  });
  it("rejects oversize files, MIME mismatches and unsafe links", () => {
    const input = descriptor("logo.png", "image/png", Uint8Array.of(1));
    expect(() => parseUploadDescriptor({ ...input, size: MAX_ASSET_BYTES + 1 })).toThrow(/25 MB/);
    expect(() => parseUploadDescriptor({ ...input, mime: "text/html" })).toThrow();
    for (const link of [
      "http://example.test",
      "javascript:alert(1)",
      "https://a:b@example.test",
      "https://example.test/\nfoo",
    ])
      expect(() => parseBrandLink(link)).toThrow();
    expect(parseBrandLink("https://drive.google.com/file/d/synthetic/view")).toContain(
      "https://drive.google.com/",
    );
  });
  it.each([
    ["image.png", "image/png", Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)],
    ["image.jpg", "image/jpeg", Uint8Array.of(255, 216, 255, 224)],
    ["image.webp", "image/webp", Buffer.from("RIFF0000WEBP")],
    [
      "clip.mp4",
      "video/mp4",
      Uint8Array.of(0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0),
    ],
    [
      "clip.webm",
      "video/webm",
      Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d),
    ],
    ["logo.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
  ] as const)("checks the signature of %s", (name, mime, bytes) => {
    const input = descriptor(name, mime, bytes);
    expect(() => verifyAssetBytes(bytes, input)).not.toThrow();
    expect(() => verifyAssetBytes(Uint8Array.of(1, 2, 3), input)).toThrow();
  });
  it("rejects signed-but-wrong bytes and keeps SVG out of inline Storage content types", () => {
    const html = Buffer.from("<html>not png</html>");
    expect(() => verifyAssetBytes(html, descriptor("fake.png", "image/png", html))).toThrow(
      /formato dichiarato/,
    );
    const svg = descriptor("logo.svg", "image/svg+xml", Buffer.from("<svg/>"));
    expect(uploadContentType(svg)).toBe("application/octet-stream");
    const entity = Buffer.from('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>');
    expect(() =>
      verifyAssetBytes(entity, descriptor("logo.svg", "image/svg+xml", entity)),
    ).toThrow();
  });
});
