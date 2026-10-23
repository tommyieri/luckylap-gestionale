import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
import { financeDocumentAccess } from "./document-access";
const id = "10000000-0000-4000-8000-000000000001";
function fixture(
  role = "founder",
  grant: unknown = true,
  active = true,
  signedIn = true,
  member = true,
) {
  const from = vi.fn((table: string) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      error: null,
      data:
        table === "memberships"
          ? member
            ? { user_id: id, role, active, finance_access: false }
            : null
          : { user_id: id, display_name: "Synthetic" },
    }),
  }));
  const db = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: signedIn ? { id, user_metadata: { role: "founder" } } : null },
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
  it.each(["founder", "production", "finance", "logistics", "consultant"])(
    "requires a fresh Finance grant for document access by %s regardless of its legacy flag",
    async (role) => {
      const db = fixture(role, true);
      const access = await financeDocumentAccess();
      expect(access.allowed).toBe(true);
      expect(db.rpc).toHaveBeenCalledExactlyOnceWith("sensitive_area_status", {
        p_area: "finance",
      });
      expect(db.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
      db.rpc.mockResolvedValue({ data: false, error: null });
      expect((await financeDocumentAccess()).allowed).toBe(false);
      expect(db.rpc).toHaveBeenCalledTimes(2);
    },
  );
  it.each([
    ...["founder", "production", "finance", "logistics", "consultant"].map((role) => ({
      role,
      grant: false,
    })),
    { role: "founder", grant: true, active: false },
    { role: "consultant", grant: true, signedIn: false },
    { role: "finance", grant: true, member: false },
  ])(
    "does not allow documents from metadata or an old grant alone (%j)",
    async ({
      role,
      grant,
      active,
      signedIn,
      member,
    }: {
      role: string;
      grant: unknown;
      active?: boolean;
      signedIn?: boolean;
      member?: boolean;
    }) => {
      const db = fixture(role, grant, active, signedIn, member);
      expect((await financeDocumentAccess()).allowed).toBe(false);
      expect(
        db.from.mock.calls.every((call) => ["memberships", "profiles"].includes(call[0])),
      ).toBe(true);
      if (active === false || signedIn === false || member === false)
        expect(db.rpc).not.toHaveBeenCalled();
    },
  );
});
