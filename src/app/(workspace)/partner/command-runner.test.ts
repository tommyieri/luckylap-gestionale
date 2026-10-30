import { beforeEach, describe, expect, it, vi } from "vitest";

// Il corpo comune delle Server Action di Partner con il vero executePartnerCommand: la posta
// dell'assistente si controlla dopo la verifica del membro. Client Supabase finto, dati sintetici.
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../../lib/runtime", () => ({ isLocalPreviewEnabled: () => false }));
vi.mock("../../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));

import { runPartnerCommandAction } from "./command-runner";

const USER = "70000000-0000-4000-8000-000000000901";
const OPERATION = "70000000-0000-4000-8000-000000009001";
const testCommand = {
  kind: "start_partner_assistant_test",
  operationId: OPERATION,
  payload: { schema_version: 1, drafts: 1, recipients: 2 },
};
const modeCommand = {
  kind: "set_partner_assistant_mode",
  operationId: OPERATION,
  payload: { schema_version: 1, mode: "invio", expected_version: 3 },
};

/** Un client con un utente collegato, membro attivo oppure no; ogni RPC è registrata. */
function fakeClient(member: boolean) {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const row = (table: string) =>
    table === "memberships"
      ? member
        ? { user_id: USER, role: "founder", active: true, finance_access: false }
        : null
      : { user_id: USER, display_name: "Fondatore sintetico" };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
    rpc,
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: row(table), error: null }),
      };
      return query;
    },
  };
  return { client, rpc };
}

const stubMail = (user: string) => {
  vi.stubEnv("PARTNER_MAIL_USER", user);
  vi.stubEnv("PARTNER_MAIL_PASSWORD", user ? "password-sintetica" : "");
  vi.stubEnv("PARTNER_TEST_TO", "prova1@example.test,prova2@example.test");
  for (const key of ["PARTNER_MAIL_FROM_NAME", "PARTNER_MAIL_SMTP_HOST", "PARTNER_MAIL_IMAP_HOST"])
    vi.stubEnv(key, "");
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockReset();
  vi.unstubAllEnvs();
});

describe("posta dell'assistente dopo la verifica del membro", () => {
  it("un non membro riceve l'errore di accesso, non l'informazione sulla posta", async () => {
    stubMail("");
    for (const command of [testCommand, modeCommand]) {
      const fake = fakeClient(false);
      mocks.createClient.mockResolvedValueOnce(fake.client);
      const result = await runPartnerCommandAction(
        command.kind as "start_partner_assistant_test",
        command,
      );
      expect(result, command.kind).toMatchObject({
        status: "rejected",
        code: "partner_access_required",
      });
      expect(JSON.stringify(result)).not.toMatch(/posta/i);
      expect(fake.rpc).not.toHaveBeenCalled();
    }
  });

  it("un membro senza la posta configurata: il rifiuto della posta, senza RPC", async () => {
    stubMail("");
    const fake = fakeClient(true);
    mocks.createClient.mockResolvedValueOnce(fake.client);
    await expect(
      runPartnerCommandAction("start_partner_assistant_test", testCommand),
    ).resolves.toMatchObject({
      status: "rejected",
      code: "partner_assistant_mail_not_configured",
    });
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("un membro con la posta e lo stesso numero di indirizzi di prova arriva alla RPC", async () => {
    stubMail("casella@luckylap.example.test");
    const fake = fakeClient(true);
    mocks.createClient.mockResolvedValueOnce(fake.client);
    await runPartnerCommandAction("start_partner_assistant_test", testCommand);
    expect(fake.rpc).toHaveBeenCalledExactlyOnceWith("start_partner_assistant_test", {
      p_operation_id: OPERATION,
      p_payload: testCommand.payload,
    });
  });
});
