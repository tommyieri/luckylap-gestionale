import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidate: vi.fn(),
  client: vi.fn(),
  execute: vi.fn(),
  legacy: vi.fn(),
  preview: vi.fn(() => false),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("../../lib/consignment/shop-server", () => ({ executeShopCommand: mocks.execute }));
vi.mock("../../lib/consignment/server", () => ({ executeConsignmentCommand: mocks.legacy }));
vi.mock("../../lib/runtime", () => ({ isLocalPreviewEnabled: mocks.preview }));

import { runShopCommand, runConsignmentCommand } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.revalidate.mockReset();
  mocks.preview.mockReturnValue(false);
  mocks.client.mockResolvedValue({ db: true });
});

describe("runShopCommand", () => {
  it("usa il client scrivibile e, dopo un successo, rilegge conto vendita, Oggi, magazzino, packaging e Finance", async () => {
    const result = { status: "success", message: "Conta salvata." };
    mocks.execute.mockResolvedValue(result);
    expect(await runShopCommand({ any: true })).toBe(result);
    expect(mocks.client).toHaveBeenCalledWith({ writable: true });
    expect(mocks.execute).toHaveBeenCalledWith({ db: true }, { any: true });
    expect(mocks.revalidate.mock.calls).toEqual([
      ["/consignment", "layout"],
      ["/stock/conto-vendita", "layout"],
      ["/", undefined],
      ["/stock", undefined],
      ["/packaging", undefined],
      ["/finance", undefined],
      ["/finance/work", undefined],
      ["/audit", undefined],
      ["/sales", undefined],
    ]);
  });

  it("un errore della cache non cambia l'esito confermato", async () => {
    mocks.execute.mockResolvedValue({ status: "success", message: "ok" });
    mocks.revalidate.mockImplementation(() => {
      throw Error("cache");
    });
    expect((await runShopCommand({})).status).toBe("success");
    expect(mocks.revalidate).toHaveBeenCalledTimes(9);
  });

  it("anche il recupero precedente conserva la ricevuta e tenta le altre viste se la prima cache fallisce", async () => {
    const receipt = { status: "success", message: "Ricevuta precedente confermata" };
    mocks.legacy.mockResolvedValue(receipt);
    mocks.revalidate.mockImplementationOnce(() => {
      throw Error("cache");
    });
    expect(await runConsignmentCommand({ retry: true })).toBe(receipt);
    expect(mocks.revalidate).toHaveBeenCalledWith("/audit");
    expect(mocks.revalidate).toHaveBeenCalledWith("/finance");
    expect(mocks.revalidate).toHaveBeenCalledWith("/sales");
  });
  it("rifiuto: niente da rileggere; connessione interrotta: esito incerto", async () => {
    mocks.execute.mockResolvedValue({ status: "rejected", code: "stale_version", message: "x" });
    await runShopCommand({});
    expect(mocks.revalidate).not.toHaveBeenCalled();
    mocks.execute.mockRejectedValue(Error("rete"));
    expect((await runShopCommand({})).status).toBe("uncertain");
  });

  it("in anteprima locale non scrive niente", async () => {
    mocks.preview.mockReturnValue(true);
    expect(await runShopCommand({})).toMatchObject({ status: "rejected", code: "preview" });
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
