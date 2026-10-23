import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidate: vi.fn(),
  client: vi.fn(),
  execute: vi.fn(),
  preview: vi.fn(() => false),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../../../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("../../../../lib/restock/server", () => ({ executeRestockCommand: mocks.execute }));
vi.mock("../../../../lib/runtime", () => ({ isLocalPreviewEnabled: mocks.preview }));

import { runRestockCommand } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.revalidate.mockReset();
  mocks.preview.mockReturnValue(false);
  mocks.client.mockResolvedValue({ db: true });
});

describe("runRestockCommand", () => {
  it("usa il client scrivibile e, dopo un successo, rilegge riordini, magazzino, Oggi, conto vendita e feed", async () => {
    const result = { status: "success", message: "Riordine salvato." };
    mocks.execute.mockResolvedValue(result);
    expect(await runRestockCommand({ any: true })).toBe(result);
    expect(mocks.client).toHaveBeenCalledWith({ writable: true });
    expect(mocks.execute).toHaveBeenCalledWith({ db: true }, { any: true });
    expect(mocks.revalidate.mock.calls).toEqual([
      ["/stock/riassortimento", "layout"],
      ["/stock", undefined],
      ["/stock/rettifiche", undefined],
      ["/", undefined],
      ["/sales", undefined],
      ["/consignment", "layout"],
      ["/stock/conto-vendita", "layout"],
      ["/audit", undefined],
    ]);
  });

  it("un errore della cache non cambia l'esito confermato; un rifiuto non rilegge niente", async () => {
    mocks.execute.mockResolvedValue({ status: "success", message: "ok" });
    mocks.revalidate.mockImplementation(() => {
      throw Error("cache");
    });
    expect((await runRestockCommand({})).status).toBe("success");
    expect(mocks.revalidate).toHaveBeenCalledTimes(8);
    mocks.revalidate.mockReset();
    mocks.execute.mockResolvedValue({ status: "rejected", code: "stale_version", message: "x" });
    expect((await runRestockCommand({})).status).toBe("rejected");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("connessione interrotta: esito incerto", async () => {
    mocks.client.mockRejectedValue(Error("rete"));
    expect((await runRestockCommand({})).status).toBe("uncertain");
  });

  it("anteprima locale: nessun invio", async () => {
    mocks.preview.mockReturnValue(true);
    expect(await runRestockCommand({})).toEqual({
      status: "rejected",
      code: "preview",
      message: "Anteprima locale: il salvataggio è disattivato.",
    });
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
