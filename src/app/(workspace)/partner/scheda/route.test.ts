import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ member: vi.fn(), detail: vi.fn() }));
vi.mock("../../../../lib/auth/current-member", () => ({ currentMember: mocks.member }));
vi.mock("../../../../lib/partner/server", () => ({ loadPartnerDetail: mocks.detail }));

import { GET } from "./route";

const actor = "97000000-0000-4000-8000-000000000001";
const other = "97000000-0000-4000-8000-000000000002";
const db = { sintetico: true };
function read(co = "2", user = actor) {
  return GET(new Request(`http://sintetico.invalid/partner/scheda?co=${co}&utente=${user}`));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.member.mockResolvedValue({ status: "member", member: { userId: actor }, supabase: db });
});

describe("Lettura puntuale della scheda Partner", () => {
  it("rifiuta CO non valido e non legge per conto di un altro utente", async () => {
    expect((await read("002")).status).toBe(400);
    expect(mocks.member).not.toHaveBeenCalled();
    expect((await read("2", other)).status).toBe(403);
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("legge una sola scheda con la sessione del membro e vieta la cache", async () => {
    const detail = { partner: { co: 2 } };
    mocks.detail.mockResolvedValue(detail);
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ detail });
    expect(mocks.detail).toHaveBeenCalledExactlyOnceWith(db, 2, { latestReply: true });
  });

  it("distingue un errore temporaneo da un CO mancante", async () => {
    mocks.detail.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("errore sintetico"));
    const missing = await read();
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ detail: null });
    const error = await read();
    expect(error.status).toBe(503);
    expect(await error.json()).toEqual({ detail: null });
  });
});
