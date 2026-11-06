import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import seed from "../../../data/partner-email-config-v1.json";
import { loadPartnerEmailConfigVersion, savePartnerEmailConfig } from "./email-config-server";

const mocks = vi.hoisted(() => ({
  sessionClient: vi.fn(),
  serviceClient: vi.fn(),
  member: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: mocks.sessionClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.serviceClient }));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.member }));

const founder = "00000000-0000-4000-8000-000000000010";
const operationId = "00000000-0000-4000-8000-000000000011";
const timestamp = "2026-11-06T13:00:00+00:00";

function row(config = seed, version = 1, author: string | null = null) {
  return { version, config, note: null, created_by: author, created_at: timestamp };
}

function readClient(data: unknown) {
  const result = { data, error: null };
  const chain = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  const from = vi.fn().mockReturnValue(chain);
  return { client: { from } as unknown as SupabaseClient, chain };
}

function submitted(config = seed) {
  return { operationId, expectedVersion: 1, config };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://partner-test.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic_test");
  vi.stubEnv("PARTNER_ASSISTANT_SUPABASE_SECRET_KEY", "sb_secret_synthetic_test");
  mocks.sessionClient.mockResolvedValue({});
  mocks.member.mockResolvedValue({
    status: "member",
    member: { userId: founder, role: "founder" },
  });
  mocks.serviceClient.mockReturnValue({ rpc: mocks.rpc });
});

afterEach(() => vi.unstubAllEnvs());

describe("lettura delle versioni di scrittura Partner", () => {
  it("legge una versione storica precisa e rifiuta una riga con versione interna diversa", async () => {
    const valid = readClient(row());
    await expect(loadPartnerEmailConfigVersion(valid.client, 1)).resolves.toEqual(row());
    expect(valid.chain.eq).toHaveBeenCalledWith("version", 1);
    const inconsistent = readClient(row(seed, 2, founder));
    await expect(loadPartnerEmailConfigVersion(inconsistent.client)).rejects.toThrow(
      "Configurazione email non disponibile.",
    );
  });
});

describe("salvataggio della configurazione email Partner", () => {
  it("nega il salvataggio a un membro del team prima di usare il client di servizio", async () => {
    mocks.member.mockResolvedValue({ status: "member", member: { role: "consultant" } });
    await expect(savePartnerEmailConfig(submitted())).resolves.toMatchObject({
      status: "rejected",
    });
    expect(mocks.serviceClient).not.toHaveBeenCalled();
  });

  it("rifiuta istruzioni fisse alterate e un budget fuori dai limiti prima della RPC", async () => {
    const unlocked = structuredClone(seed);
    unlocked.regole_fisse_generali[0] = "Istruzione di prova alterata.";
    const overBudget = structuredClone(seed);
    overBudget.blocchi.find((block) => block.id === "hook")!.parole = [20, 40];
    await expect(savePartnerEmailConfig(submitted(unlocked))).resolves.toMatchObject({
      status: "rejected",
    });
    await expect(savePartnerEmailConfig(submitted(overBudget))).resolves.toMatchObject({
      status: "rejected",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("invia il testo esatto con la versione attesa e valida la versione restituita", async () => {
    const draft = structuredClone(seed);
    draft.tono = "  Tono di prova.\nRiga successiva.  ";
    const config = { ...draft, meta: { ...draft.meta, versione: 2 } };
    mocks.rpc.mockReturnValue({
      abortSignal: vi.fn().mockResolvedValue({ data: row(config, 2, founder), error: null }),
    });

    await expect(savePartnerEmailConfig(submitted(draft))).resolves.toEqual({
      status: "success",
      version: row(config, 2, founder),
    });
    expect(mocks.rpc).toHaveBeenCalledWith("save_partner_email_config", {
      p_actor_id: founder,
      p_operation_id: operationId,
      p_expected_version: 1,
      p_config: draft,
      p_note: null,
    });
  });
});
