import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  read: vi.fn(),
  execute: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/sales-cancellation/server", () => ({
  readSaleCancellationPreview: mocks.read,
  executeSaleCancellation: mocks.execute,
}));
import { previewSaleCancellation, cancelSaleRegistration } from "./actions";
const id = "93000000-0000-4000-8000-000000000001",
  input = { synthetic: true };
const success = {
  status: "success",
  orderId: id,
  replayed: false,
  message: "Operazione sintetica confermata",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ syntheticClient: true });
  mocks.read.mockResolvedValue({ status: "ready", preview: { orderId: id } });
  mocks.execute.mockResolvedValue(success);
});
describe("azioni server cancellation", () => {
  it("anteprima usa client del chiamante senza invalidare pagine", async () => {
    expect(await previewSaleCancellation(input)).toMatchObject({ status: "ready" });
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.read).toHaveBeenCalledWith({ syntheticClient: true }, input);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("successo e replay invalidano tutti i moduli collegati usando client scrivibile", async () => {
    for (const replayed of [false, true]) {
      mocks.revalidate.mockClear();
      mocks.execute.mockResolvedValue({ ...success, replayed });
      expect(await cancelSaleRegistration(input)).toEqual({ ...success, replayed });
      expect(mocks.client).toHaveBeenLastCalledWith({ writable: true });
      expect(mocks.execute).toHaveBeenLastCalledWith({ syntheticClient: true }, input);
      expect(mocks.revalidate.mock.calls.map((c) => c[0])).toEqual([
        "/sales",
        "/stock",
        "/packaging",
        "/finance",
        "/finance/work",
        "/",
        "/audit",
      ]);
    }
  });
  it("un fallimento della cache non trasforma un successo confermato in esito incerto", async () => {
    mocks.revalidate.mockImplementation(() => {
      throw Error("PRIVATE-CACHE-DETAIL");
    });
    expect(await cancelSaleRegistration(input)).toEqual(success);
    expect(mocks.revalidate).toHaveBeenCalledTimes(7);
  });
  it.each(["rejected", "uncertain"])("nessuna invalidazione per %s", async (status) => {
    const result = {
      status,
      message: "Risposta sintetica",
      ...(status === "rejected" ? { code: "invalid_payload" } : {}),
    };
    mocks.execute.mockResolvedValue(result);
    expect(await cancelSaleRegistration(input)).toEqual(result);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("nasconde dettagli interni conservando l'incertezza dell'invio", async () => {
    mocks.client.mockRejectedValueOnce(Error("PRIVATE-CLIENT-DETAIL"));
    const p = await previewSaleCancellation(input);
    expect(p).toMatchObject({ status: "rejected", code: "unavailable" });
    expect(JSON.stringify(p)).not.toContain("PRIVATE-CLIENT-DETAIL");
    mocks.execute.mockRejectedValueOnce(Error("PRIVATE-SERVER-DETAIL"));
    const result = await cancelSaleRegistration(input);
    expect(result.status).toBe("uncertain");
    expect(JSON.stringify(result)).not.toContain("PRIVATE-SERVER-DETAIL");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
