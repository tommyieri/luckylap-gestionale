import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
import { financeDocumentAccess } from "./document-access";
const id = "10000000-0000-4000-8000-000000000001";
function fixture(role = "founder", grant: unknown = true, active = true) {
  const from = vi.fn((table: string) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      error: null,
      data:
        table === "memberships"
          ? { user_id: id, role, active, finance_access: role !== "logistics" }
          : { user_id: id, display_name: "Synthetic" },
    }),
  }));
  const db = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id, user_metadata: { role: "founder" } } },
        error: null,
      }),
      mfa: {
        getAuthenticatorAssuranceLevel: vi
          .fn()
          .mockResolvedValue({ data: { currentLevel: "aal2" }, error: null }),
      },
    },
    from,
    rpc: vi.fn().mockResolvedValue({ data: grant, error: null }),
  };
  mocks.create.mockResolvedValue(db);
  return db;
}
beforeEach(() => vi.clearAllMocks());
describe("private Finance document read guard", () => {
  it("requires a current Finance grant before allowing source document queries", async () => {
    const db = fixture();
    const access = await financeDocumentAccess();
    expect(access.allowed).toBe(true);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("sensitive_area_status", { p_area: "finance" });
    expect(db.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });
  it.each([
    { role: "founder", grant: false },
    { role: "logistics", grant: true },
    { role: "founder", grant: true, active: false },
  ])(
    "does not allow documents from MFA or metadata alone (%j)",
    async ({ role, grant, active }) => {
      const db = fixture(role, grant, active);
      expect((await financeDocumentAccess()).allowed).toBe(false);
      expect(
        db.from.mock.calls.every((call) => ["memberships", "profiles"].includes(call[0])),
      ).toBe(true);
    },
  );
});
