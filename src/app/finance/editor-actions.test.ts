import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  client: vi.fn(),
  member: vi.fn(),
  gate: vi.fn(),
  revision: vi.fn(),
  shop: vi.fn(),
  names: vi.fn(),
}));
vi.mock("../../lib/runtime", () => ({ isLocalPreviewEnabled: mocks.preview }));
vi.mock("../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("../../lib/auth/server", () => ({ verifiedMember: mocks.member }));
vi.mock("../../lib/auth/sensitive-access", () => ({ verifiedSensitiveAccess: mocks.gate }));
vi.mock("../../lib/finance-revisions/server", () => ({
  loadFinanceRevisionHistory: mocks.revision,
}));
vi.mock("../../lib/finance-revisions/shop-payment-server", () => ({
  loadShopPaymentFinanceHistory: mocks.shop,
}));
vi.mock("../../lib/finance-revisions/names-server", () => ({
  readFinanceProfileNames: mocks.names,
}));
import { loadFinanceEditor } from "./editor-actions";
const actor = "98000000-0000-4000-8000-000000000001";
const sourceId = "98000000-0000-4000-8000-000000000002";
const db = {};
const member = { userId: actor, displayName: "Membro sintetico", role: "ceo", financeAccess: true };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.preview.mockReturnValue(false);
  mocks.client.mockResolvedValue(db);
  mocks.member.mockResolvedValue({ status: "member", member });
  mocks.gate.mockResolvedValue(true);
  mocks.revision.mockResolvedValue({ original: "fonte sintetica", revisions: [] });
  mocks.shop.mockResolvedValue({ paymentId: sourceId });
  mocks.names.mockResolvedValue({ [actor]: "Membro sintetico" });
});
function noRead() {
  expect(mocks.revision).not.toHaveBeenCalled();
  expect(mocks.shop).not.toHaveBeenCalled();
  expect(mocks.names).not.toHaveBeenCalled();
}
describe("caricamento della scheda Finance", () => {
  it("non crea client e non legge dati in anteprima", async () => {
    mocks.preview.mockReturnValue(true);
    expect((await loadFinanceEditor(actor, "manual", sourceId)).kind).toBe("unavailable");
    expect(mocks.client).not.toHaveBeenCalled();
    noRead();
  });
  it.each([
    ["invalid", "manual", sourceId],
    [actor, "profiles", sourceId],
    [actor, "manual", "invalid"],
  ])("rifiuta input non valido prima di ogni query: %s %s %s", async (id, source, target) => {
    expect((await loadFinanceEditor(id, source, target)).kind).toBe("unavailable");
    expect(mocks.client).not.toHaveBeenCalled();
    noRead();
  });
  it.each(["signed-out", "denied", "unavailable"])(
    "rifiuta sessione %s prima dello storico e dei nomi",
    async (status) => {
      mocks.member.mockResolvedValue({ status });
      expect((await loadFinanceEditor(actor, "manual", sourceId)).kind).toBe("unavailable");
      expect(mocks.gate).not.toHaveBeenCalled();
      noRead();
    },
  );
  it("rifiuta il cambio account prima del gate e delle letture", async () => {
    mocks.member.mockResolvedValue({ status: "member", member: { ...member, userId: sourceId } });
    expect((await loadFinanceEditor(actor, "manual", sourceId)).kind).toBe("unavailable");
    expect(mocks.gate).not.toHaveBeenCalled();
    noRead();
  });
  it.each([false, null])("rifiuta area chiusa/non verificabile: %s", async (state) => {
    mocks.gate.mockResolvedValue(state);
    expect((await loadFinanceEditor(actor, "manual", sourceId)).kind).toBe("unavailable");
    noRead();
  });
  it("verifica prima la sessione/password e legge con il client del chiamante", async () => {
    const result = await loadFinanceEditor(actor, "consignment", sourceId);
    expect(result.kind).toBe("revision");
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.gate).toHaveBeenCalledWith(db, member, "finance");
    expect(mocks.gate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.revision.mock.invocationCallOrder[0],
    );
    expect(mocks.gate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.names.mock.invocationCallOrder[0],
    );
    expect(mocks.revision).toHaveBeenCalledExactlyOnceWith(db, {
      sourceKind: "consignment_settlement",
      sourceId,
    });
    expect(mocks.names).toHaveBeenCalledExactlyOnceWith(db);
    expect(result).toMatchObject({ names: { [actor]: "Membro sintetico" } });
  });
  it("usa lo storico P3 per shop_payment senza leggerlo come revisione generica", async () => {
    expect((await loadFinanceEditor(actor, "shop_payment", sourceId)).kind).toBe("shop_payment");
    expect(mocks.shop).toHaveBeenCalledExactlyOnceWith(db, sourceId);
    expect(mocks.revision).not.toHaveBeenCalled();
  });
  it("non restituisce uno storico parziale o dettagli privati se una lettura fallisce", async () => {
    mocks.names.mockRejectedValue(new Error("dettaglio riservato sintetico"));
    const result = await loadFinanceEditor(actor, "manual", sourceId);
    expect(result.kind).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("dettaglio riservato");
  });
});
