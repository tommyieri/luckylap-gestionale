import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Lookbook solo per i membri, sempre come allegato (00-sequenza §4 P2 e §5, 02-2).
const mocks = vi.hoisted(() => ({
  preview: false,
  access: { status: "member" } as { status: string },
  createClient: vi.fn(),
  verifiedMember: vi.fn(),
}));
vi.mock("../../../../../lib/runtime", () => ({ isLocalPreviewEnabled: () => mocks.preview }));
vi.mock("../../../../../lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock("../../../../../lib/auth/server", () => ({ verifiedMember: mocks.verifiedMember }));

import { GET } from "./route";
import {
  PARTNER_LOOKBOOK_BYTES,
  PARTNER_LOOKBOOK_CODES,
  PARTNER_LOOKBOOK_MAX_BYTES,
  partnerLookbookFile,
} from "../../../../../lib/partner/lookbook";

const get = (code: string) =>
  GET(new Request(`http://localhost/partner/lookbook/${code}`), {
    params: Promise.resolve({ code }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview = false;
  mocks.createClient.mockResolvedValue({});
  mocks.verifiedMember.mockImplementation(async () => mocks.access);
  mocks.access = { status: "member" };
});

describe("GET /partner/lookbook/[code]", () => {
  it("chi non è del team riceve 401, prima di sapere se il codice esiste", async () => {
    for (const status of ["signed-out", "denied"]) {
      mocks.access = { status };
      for (const code of ["negozi", "altro"]) {
        const response = await get(code);
        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(await response.text()).toBe("Accesso al team richiesto.");
      }
    }
    mocks.verifiedMember.mockRejectedValueOnce(new Error("rete"));
    expect((await get("negozi")).status).toBe(503);
    mocks.access = { status: "unavailable" };
    expect((await get("negozi")).status).toBe(503);
  });

  it("codice sconosciuto: 404, nessun percorso arriva al disco", async () => {
    for (const code of ["altro", "NEGOZI", "negozi.pdf", "..%2F.env", "../package", ""]) {
      const response = await get(code);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Lookbook non disponibile.");
    }
  });

  it("membro: 200 con il PDF come allegato, privato, senza cache né tipo indovinato", async () => {
    const response = await get("porsche_club");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="LuckyLap-Lookbook-Porsche-Clubs.pdf"',
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(String(response.headers.get("Content-Length"))).toBe(String(bytes.byteLength));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(mocks.verifiedMember).toHaveBeenCalledTimes(1);
  });

  it("anteprima locale: niente Supabase, il PDF arriva lo stesso", async () => {
    mocks.preview = true;
    const response = await get("negozi");
    expect(response.status).toBe(200);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.verifiedMember).not.toHaveBeenCalled();
  });

  it("i cinque PDF iniziano con %PDF-, stanno sotto 4 MB e hanno la dimensione dichiarata", () => {
    for (const code of PARTNER_LOOKBOOK_CODES) {
      const bytes = readFileSync(join(process.cwd(), partnerLookbookFile(code)!));
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(bytes.byteLength).toBeLessThan(PARTNER_LOOKBOOK_MAX_BYTES);
      expect(bytes.byteLength).toBe(PARTNER_LOOKBOOK_BYTES[code]);
    }
  });
});
