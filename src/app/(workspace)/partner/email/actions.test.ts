import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preview: false,
  createClient: vi.fn(),
  verified: vi.fn(),
  loadDetail: vi.fn(),
  revalidate: vi.fn(),
  rpc: vi.fn(),
  abortSignal: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../../../../lib/runtime", () => ({ isLocalPreviewEnabled: () => mocks.preview }));
vi.mock("../../../../lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock("../../../../lib/auth/server", () => ({ verifiedMember: mocks.verified }));
vi.mock("../../../../lib/partner/email-program-server", () => ({
  loadPartnerEmailDetail: mocks.loadDetail,
}));
import { mutatePartnerEmail, readPartnerEmail } from "./actions";

const id = (n: number) => `93000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const client = { rpc: mocks.rpc };
const member = (role = "founder") => ({
  status: "member",
  member: { userId: id(1), displayName: "Membro Sintetico", role, financeAccess: false },
});
const command = (kind: "begin" | "save" | "cancel") => ({
  kind,
  operationId: id(2),
  payload:
    kind === "begin"
      ? {
          schema_version: 1,
          job_id: id(3),
          expected_draft_id: id(4),
          expected_sha256: "a".repeat(64),
        }
      : kind === "save"
        ? {
            schema_version: 1,
            hold_id: id(5),
            expected_hold_version: 1,
            expected_draft_id: id(4),
            expected_sha256: "a".repeat(64),
            subject: "Presentazione di LuckyLap",
            body: "Presentazione del brand e valore concreto per la comunità.",
          }
        : { schema_version: 1, hold_id: id(5), expected_hold_version: 1, expected_draft_id: id(4) },
});
const receipt = (kind: "begin" | "save" | "cancel", replayed = false) => ({
  id: id(3),
  version: 2,
  replayed,
  ...(kind === "begin"
    ? { holdId: id(5), holdVersion: 1 }
    : kind === "save"
      ? { draftId: id(6), sha256: "b".repeat(64), status: "pronta", holdClosed: true }
      : { cancelled: true, resumeState: "pronta" }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.preview = false;
  mocks.createClient.mockResolvedValue(client);
  mocks.verified.mockResolvedValue(member());
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal });
  mocks.abortSignal.mockResolvedValue({ data: receipt("begin"), error: null });
  mocks.loadDetail.mockResolvedValue({ kind: "draft", id: id(4), subject: "Testo sintetico" });
});
afterEach(() => vi.restoreAllMocks());

describe("accesso alle azioni delle email", () => {
  it("in anteprima non crea client né legge o modifica il database", async () => {
    mocks.preview = true;
    expect((await readPartnerEmail({ kind: "draft", id: id(4) })).status).toBe("rejected");
    expect((await mutatePartnerEmail(command("begin"))).status).toBe("rejected");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.verified).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.loadDetail).not.toHaveBeenCalled();
  });

  it.each(["signed-out", "denied", "unavailable"])(
    "rigetta %s su letture e modifiche",
    async (status) => {
      mocks.verified.mockResolvedValue({ status });
      expect((await readPartnerEmail({ kind: "draft", id: id(4) })).status).toBe("rejected");
      expect((await mutatePartnerEmail(command("begin"))).status).toBe("rejected");
      expect(mocks.verified).toHaveBeenCalledTimes(2);
      expect(mocks.createClient).toHaveBeenNthCalledWith(1, { writable: true });
      expect(mocks.createClient).toHaveBeenNthCalledWith(2, { writable: true });
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.loadDetail).not.toHaveBeenCalled();
    },
  );

  it.each(["production", "logistics", "finance", "consultant"])(
    "%s può leggere, ma non modificare",
    async (role) => {
      mocks.verified.mockResolvedValue(member(role));
      expect((await readPartnerEmail({ kind: "draft", id: id(4) })).status).toBe("success");
      await expect(mutatePartnerEmail(command("begin"))).resolves.toEqual({
        status: "rejected",
        message: "Questa modifica è riservata a Tommi.",
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("verifica nuovamente il membro in ogni azione e non divulga errori di accesso", async () => {
    await readPartnerEmail({ kind: "draft", id: id(4) });
    mocks.verified.mockRejectedValueOnce(new Error("Dettaglio riservato dell'accesso"));
    const result = await mutatePartnerEmail(command("begin"));
    expect(result.status).toBe("rejected");
    expect(result.message).not.toContain("Dettaglio riservato");
    expect(mocks.verified).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("readPartnerEmail", () => {
  it.each(["draft", "sent", "job"])(
    "legge %s solo dopo aver verificato il membro",
    async (kind) => {
      const result = await readPartnerEmail({ kind, id: id(4) });
      expect(result).toEqual({
        status: "success",
        detail: { kind: "draft", id: id(4), subject: "Testo sintetico" },
      });
      expect(mocks.loadDetail).toHaveBeenCalledExactlyOnceWith(client, kind, id(4));
      expect(mocks.verified.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.loadDetail.mock.invocationCallOrder[0],
      );
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    [],
    3,
    {},
    { kind: "raw", id: id(4) },
    { kind: "draft", id: "invalid" },
    { kind: "draft", id: id(4), raw: true },
  ])("rigetta richieste non valide senza leggere", async (input) => {
    expect((await readPartnerEmail(input)).status).toBe("rejected");
    expect(mocks.verified).toHaveBeenCalledTimes(1);
    expect(mocks.loadDetail).not.toHaveBeenCalled();
  });

  it("non restituisce errori grezzi della sorgente", async () => {
    mocks.loadDetail.mockRejectedValueOnce(new Error("Messaggio privato della sorgente"));
    await expect(readPartnerEmail({ kind: "draft", id: id(4) })).resolves.toEqual({
      status: "rejected",
      message: "Email non disponibile. Ricarica e riprova.",
    });
  });
});

describe("mutatePartnerEmail", () => {
  it.each(["begin", "save", "cancel"] as const)(
    "%s usa la sua RPC e rilegge tutte le pagine interessate",
    async (kind) => {
      mocks.abortSignal.mockResolvedValueOnce({ data: receipt(kind), error: null });
      const timeout = vi.spyOn(AbortSignal, "timeout");
      const input = command(kind);
      const result = await mutatePartnerEmail(input);
      expect(result.status).toBe("success");
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(`${kind}_partner_email_edit`, {
        p_operation_id: input.operationId,
        p_payload: input.payload,
      });
      expect(mocks.verified.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.rpc.mock.invocationCallOrder[0],
      );
      expect(timeout).toHaveBeenCalledWith(10_000);
      expect(mocks.abortSignal.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
      expect(mocks.revalidate.mock.calls).toEqual([
        ["/partner/email"],
        ["/partner"],
        ["/partner/assistente"],
      ]);
    },
  );

  it("riconosce una ricevuta ripetuta senza avviare operazioni aggiuntive", async () => {
    mocks.abortSignal.mockResolvedValueOnce({ data: receipt("save", true), error: null });
    expect((await mutatePartnerEmail(command("save"))).status).toBe("success");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("annullare può richiedere una verifica, senza promettere la ripartenza dell'invio", async () => {
    mocks.abortSignal.mockResolvedValueOnce({
      data: { ...receipt("cancel"), resumeState: "serve_tommaso" },
      error: null,
    });
    const result = await mutatePartnerEmail(command("cancel"));
    expect(result.status).toBe("success");
    expect(result.message).not.toContain("riprende");
  });

  it.each([
    null,
    {},
    { ...command("begin"), kind: "send" },
    { ...command("begin"), operationId: "invalid" },
    {
      ...command("save"),
      payload: { ...command("save").payload, subject: "Oggetto\nBcc: altro@example.test" },
    },
  ])("rigetta comandi non validi senza RPC", async (input) => {
    expect((await mutatePartnerEmail(input)).status).toBe("rejected");
    expect(mocks.verified).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each([
    ["begin", null],
    ["begin", { ...receipt("begin"), id: "invalid" }],
    ["begin", { ...receipt("begin"), version: 0 }],
    ["begin", { ...receipt("begin"), replayed: "false" }],
    ["begin", { ...receipt("begin"), holdId: null }],
    ["begin", { ...receipt("begin"), holdVersion: -1 }],
    ["save", { ...receipt("save"), draftId: "invalid" }],
    ["save", { ...receipt("save"), sha256: "invalid" }],
    ["save", { ...receipt("save"), status: "in_invio" }],
    ["save", { ...receipt("save"), holdClosed: false }],
    ["cancel", { ...receipt("cancel"), cancelled: false }],
    ["cancel", { ...receipt("cancel"), resumeState: "in_invio" }],
  ] as const)("considera incerto un esito %s incompleto", async (kind, data) => {
    mocks.abortSignal.mockResolvedValueOnce({ data, error: null });
    expect((await mutatePartnerEmail(command(kind))).status).toBe("uncertain");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each(["40001", "42501", "22023", "55000"])(
    "traduce l'errore %s senza inoltrare messaggi grezzi",
    async (code) => {
      mocks.abortSignal.mockResolvedValueOnce({
        data: null,
        error: { code, message: "Messaggio privato della sorgente" },
      });
      const result = await mutatePartnerEmail(command("save"));
      expect(result.status).toBe("rejected");
      expect(result.message).not.toContain("Messaggio privato");
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it("un errore sconosciuto mantiene incerto il salvataggio", async () => {
    mocks.abortSignal.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "Errore interno riservato" },
    });
    const result = await mutatePartnerEmail(command("save"));
    expect(result.status).toBe("uncertain");
    expect(result.message).not.toContain("Errore interno");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("un timeout di rete non promette che la modifica sia stata annullata", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(controller.signal);
    mocks.abortSignal.mockImplementationOnce(
      (signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("rete riservata"))),
        ),
    );
    const request = mutatePartnerEmail(command("save"));
    await vi.waitFor(() => expect(mocks.abortSignal).toHaveBeenCalledTimes(1));
    controller.abort();
    const result = await request;
    expect(result.status).toBe("uncertain");
    expect(result.message).not.toContain("rete riservata");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
