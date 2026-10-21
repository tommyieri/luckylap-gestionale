import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), verify: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.verify }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { saveDevelopment } from "../../app/development/actions";
const id = "00000000-0000-4000-8000-000000000001";
const form = (values: Record<string, string>) => {
  const result = new FormData();
  Object.entries({ id, name: "Prototipo sintetico", stage: "idea", ...values }).forEach(
    ([key, value]) => result.set(key, value),
  );
  return result;
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({ status: "member" });
});
describe("development Server Actions", () => {
  it("checks current membership before mutation", async () => {
    const db = { rpc: vi.fn() };
    mocks.create.mockResolvedValue(db);
    mocks.verify.mockResolvedValue({ status: "denied" });
    expect((await saveDevelopment({}, form({}))).error).toMatch(/account abilitato/);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("passes the exact expected version and preserves drafts on conflict", async () => {
    const db = {
      rpc: vi
        .fn()
        .mockResolvedValue({ data: null, error: { code: "40001", message: "Private diagnostic" } }),
    };
    mocks.create.mockResolvedValue(db);
    const result = await saveDevelopment(
      {},
      form({ version: "2", brief: "Testo da conservare", stage: "sampling" }),
    );
    expect(db.rpc).toHaveBeenCalledWith(
      "save_development_project",
      expect.objectContaining({ p_expected_version: 2, p_brief: "Testo da conservare" }),
    );
    expect(result.error).toMatch(/altro membro/);
    expect(result.values?.brief).toBe("Testo da conservare");
    expect(JSON.stringify(result)).not.toContain("Private diagnostic");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
