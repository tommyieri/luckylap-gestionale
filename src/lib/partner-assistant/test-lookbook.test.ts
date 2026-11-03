import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadPartnerAssistantTestLookbook } from "./test-lookbook";
import {
  PARTNER_ASSISTANT_TEST_LOOKBOOKS,
  type PartnerAssistantTestLookbook,
} from "./test-lookbook-metadata";

const codes = ["porsche_club", "club"] as const;
const pdfs = {} as Record<(typeof codes)[number], Buffer<ArrayBuffer>>;

beforeAll(async () => {
  // Gli asset distribuiti dal repository, senza copiarli in nuove fixture o modificarli.
  const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  for (const code of codes)
    pdfs[code] = await original.readFile(
      join(process.cwd(), "data", "partner-lookbooks", `${code}.pdf`),
    );
});
beforeEach(() => vi.mocked(readFile).mockReset());

describe("lookbook della prova Club", () => {
  it.each(codes)(
    "legge soltanto il file %s e ne verifica dimensione, firma e SHA-256",
    async (code) => {
      vi.mocked(readFile).mockResolvedValueOnce(pdfs[code]);
      const expected = PARTNER_ASSISTANT_TEST_LOOKBOOKS[code];
      const loaded = await loadPartnerAssistantTestLookbook(expected);
      expect(readFile).toHaveBeenCalledExactlyOnceWith(
        join(process.cwd(), "data", "partner-lookbooks", `${code}.pdf`),
      );
      const { content, ...metadata } = loaded;
      expect(metadata).toEqual(expected);
      expect(content).toBe(pdfs[code]);
      expect(loaded.content.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(loaded.content.byteLength).toBe(expected.bytes);
      expect(createHash("sha256").update(loaded.content).digest("hex")).toBe(expected.sha256);
    },
  );

  it.each([
    { ...PARTNER_ASSISTANT_TEST_LOOKBOOKS.club, code: "../../segreti" },
    { ...PARTNER_ASSISTANT_TEST_LOOKBOOKS.club, code: "https://file.example.test/club.pdf" },
    { ...PARTNER_ASSISTANT_TEST_LOOKBOOKS.club, path: "/tmp/club.pdf" },
    { ...PARTNER_ASSISTANT_TEST_LOOKBOOKS.club, url: "https://file.example.test/club.pdf" },
    { ...PARTNER_ASSISTANT_TEST_LOOKBOOKS.club, sha256: "f".repeat(64) },
    { ...PARTNER_ASSISTANT_TEST_LOOKBOOKS.club, bytes: 1 },
  ])("rifiuta metadati o percorsi diversi prima di leggere file", async (value) => {
    await expect(
      loadPartnerAssistantTestLookbook(value as PartnerAssistantTestLookbook),
    ).rejects.toThrow();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("file con gli stessi byte di dimensione ma impronta diversa: fallimento chiuso", async () => {
    const changed = Buffer.from(pdfs.club);
    changed[changed.length - 1] ^= 1;
    vi.mocked(readFile).mockResolvedValueOnce(changed);
    await expect(
      loadPartnerAssistantTestLookbook(PARTNER_ASSISTANT_TEST_LOOKBOOKS.club),
    ).rejects.toThrow("non corrisponde");
  });

  it("dimensione diversa o firma non PDF: fallimento chiuso", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from("%PDF-1.4\nPDF sintetico\n"));
    await expect(
      loadPartnerAssistantTestLookbook(PARTNER_ASSISTANT_TEST_LOOKBOOKS.club),
    ).rejects.toThrow("non corrisponde");
    const notPdf = Buffer.from(pdfs.club);
    notPdf[0] = 0;
    vi.mocked(readFile).mockResolvedValueOnce(notPdf);
    await expect(
      loadPartnerAssistantTestLookbook(PARTNER_ASSISTANT_TEST_LOOKBOOKS.club),
    ).rejects.toThrow("non corrisponde");
  });

  it("file mancante: l'errore non diventa un allegato vuoto", async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error("File sintetico non disponibile"));
    await expect(
      loadPartnerAssistantTestLookbook(PARTNER_ASSISTANT_TEST_LOOKBOOKS.porsche_club),
    ).rejects.toThrow();
  });
});
