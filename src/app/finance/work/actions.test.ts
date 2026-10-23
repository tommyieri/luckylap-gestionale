import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), execute: vi.fn(), cache: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.cache }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/finance-work/server", () => ({ executeFinanceWork: mocks.execute }));
import { runFinanceWork } from "./actions";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.mockReset();
  mocks.client.mockResolvedValue({ session: "synthetic" });
});
describe("salvataggio manuale e aggiornamento viste", () => {
  it("mantiene la ricevuta confermata e tenta tutte le viste anche se la prima cache fallisce", async () => {
    const receipt = {
      status: "success",
      message: "Registrazione confermata",
      receipt: { operationId: "sintetico" },
    };
    mocks.execute.mockResolvedValue(receipt);
    mocks.cache.mockImplementationOnce(() => {
      throw Error("cache");
    });
    expect(await runFinanceWork({ same: "frozen command" })).toBe(receipt);
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ writable: true });
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(
      { session: "synthetic" },
      { same: "frozen command" },
    );
    expect(mocks.cache.mock.calls).toEqual([["/finance"], ["/finance/work"], ["/"], ["/audit"]]);
  });
  it("non invalida su rifiuto e conserva l’incertezza se il comando non conferma l’esito", async () => {
    const rejected = { status: "rejected", code: "stale_version", message: "Rileggi" };
    mocks.execute.mockResolvedValue(rejected);
    expect(await runFinanceWork({})).toBe(rejected);
    expect(mocks.cache).not.toHaveBeenCalled();
    mocks.execute.mockRejectedValue(Error("network"));
    expect(await runFinanceWork({})).toMatchObject({ status: "uncertain" });
    expect(mocks.cache).not.toHaveBeenCalled();
  });
});
