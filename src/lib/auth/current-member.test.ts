import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  config: vi.fn(),
  createClient: vi.fn(),
  verify: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  rethrow: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../runtime", () => ({ isLocalPreviewEnabled: mocks.preview }));
vi.mock("../supabase/config", () => ({ getSupabasePublicConfig: mocks.config }));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("./server", () => ({ verifiedMember: mocks.verify }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, unstable_rethrow: mocks.rethrow }));

import { currentMember, requireMember } from "./current-member";
import { readNavAccess } from "../navigation-server";

const verified = {
  userId: "00000000-0000-4000-8000-000000000001",
  displayName: "Membro di prova",
  role: "consultant" as const,
  financeAccess: false,
};
const client = { from: vi.fn(), auth: {} };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview.mockReturnValue(false);
  mocks.config.mockReturnValue({ url: "https://example.test", publishableKey: "sb_publishable_x" });
  mocks.createClient.mockResolvedValue(client);
  mocks.verify.mockResolvedValue({ status: "member", member: verified });
});

describe("currentMember", () => {
  it("in anteprima locale non crea nessun client e non legge la configurazione", async () => {
    mocks.preview.mockReturnValue(true);
    await expect(currentMember()).resolves.toEqual({ status: "preview" });
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("senza configurazione Supabase dà unconfigured senza creare il client", async () => {
    mocks.config.mockImplementation(() => {
      throw new Error("Supabase non configurato");
    });
    await expect(currentMember()).resolves.toEqual({ status: "unconfigured" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("dà unavailable se la verifica lancia, passando prima l'errore a Next", async () => {
    const failure = new Error("rete");
    mocks.verify.mockRejectedValue(failure);
    await expect(currentMember()).resolves.toEqual({ status: "unavailable" });
    expect(mocks.rethrow).toHaveBeenCalledWith(failure);
  });

  it("dà unavailable se il client non si crea", async () => {
    mocks.createClient.mockRejectedValue(new Error("cookie"));
    await expect(currentMember()).resolves.toEqual({ status: "unavailable" });
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("lascia passare gli errori interni di Next", async () => {
    const internal = Object.assign(new Error("interno"), { digest: "DYNAMIC_SERVER_USAGE" });
    mocks.verify.mockRejectedValue(internal);
    mocks.rethrow.mockImplementationOnce((error: unknown) => {
      throw error;
    });
    await expect(currentMember()).rejects.toBe(internal);
  });

  it("per un membro dà il membro verificato e lo stesso client della verifica", async () => {
    const result = await currentMember();
    expect(result).toEqual({ status: "member", member: verified, supabase: client });
    expect(mocks.createClient).toHaveBeenCalledWith();
    expect(mocks.verify).toHaveBeenCalledWith(client);
  });

  it.each(["signed-out", "denied", "unavailable"] as const)(
    "riporta lo stato %s senza membro né client",
    async (status) => {
      mocks.verify.mockResolvedValue({ status });
      await expect(currentMember()).resolves.toEqual({ status });
    },
  );
});

describe("requireMember", () => {
  it("senza sessione reindirizza a /auth/login", async () => {
    mocks.verify.mockResolvedValue({ status: "signed-out" });
    await expect(requireMember()).rejects.toThrow("REDIRECT /auth/login");
    expect(mocks.redirect).toHaveBeenCalledWith("/auth/login");
  });

  it.each(["denied", "unavailable"] as const)(
    "con stato %s non reindirizza: decide la pagina",
    async (status) => {
      mocks.verify.mockResolvedValue({ status });
      await expect(requireMember()).resolves.toEqual({ status });
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it("per un membro restituisce membro e client", async () => {
    await expect(requireMember()).resolves.toEqual({
      status: "member",
      member: verified,
      supabase: client,
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("readNavAccess", () => {
  it.each(["founder", "production", "finance", "logistics", "consultant"] as const)(
    "mostra le due aree nel menu al membro verificato %s senza leggere dati riservati",
    async (role) => {
      mocks.verify.mockResolvedValue({
        status: "member",
        member: { ...verified, role, financeAccess: false },
      });
      await expect(readNavAccess()).resolves.toEqual({
        status: "member",
        displayName: "Membro di prova",
        finance: true,
        ceo: true,
      });
      expect(mocks.verify).toHaveBeenCalledExactlyOnceWith(client);
      expect(client.from).not.toHaveBeenCalled();
    },
  );
  it.each(["signed-out", "denied", "unavailable"] as const)(
    "con stato %s non reindirizza e non espone il menu riservato",
    async (status) => {
      mocks.verify.mockResolvedValue({ status });
      await expect(readNavAccess()).resolves.toEqual({
        status: status === "unavailable" ? "unavailable" : "outside",
      });
      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(client.from).not.toHaveBeenCalled();
    },
  );
  it("in anteprima dà l'accesso di anteprima senza chiamate", async () => {
    mocks.preview.mockReturnValue(true);
    await expect(readNavAccess()).resolves.toEqual({ status: "preview" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
