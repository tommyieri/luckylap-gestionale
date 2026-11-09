import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), execute: vi.fn(), cache: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.cache }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/finance-work/server", () => ({ executeFinanceWork: mocks.execute }));
import { runFinanceWork } from "./actions";
const actorId = "00000000-0000-4000-8000-000000000010";
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
    expect(await runFinanceWork({ same: "frozen command" }, actorId)).toBe(receipt);
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ writable: true });
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(
      { session: "synthetic" },
      { same: "frozen command" },
      actorId,
    );
    expect(mocks.cache.mock.calls).toEqual([["/finance"], ["/finance/work"], ["/"], ["/audit"]]);
  });
  it("non invalida su rifiuto e conserva l’incertezza se il comando non conferma l’esito", async () => {
    const rejected = { status: "rejected", code: "stale_version", message: "Rileggi" };
    mocks.execute.mockResolvedValue(rejected);
    expect(await runFinanceWork({}, actorId)).toBe(rejected);
    expect(mocks.cache).not.toHaveBeenCalled();
    mocks.execute.mockRejectedValue(Error("network"));
    expect(await runFinanceWork({}, actorId)).toMatchObject({ status: "uncertain" });
    expect(mocks.cache).not.toHaveBeenCalled();
  });
});

describe("identità del modulo manuale", () => {
  it.each([undefined, null, "", "synthetic-invalid", 42])(
    "non esegue il comando con attore invalido %s",
    async (invalid) => {
      expect(await runFinanceWork({}, invalid as unknown as string)).toMatchObject({
        status: "uncertain",
      });
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mocks.cache).not.toHaveBeenCalled();
    },
  );
});
