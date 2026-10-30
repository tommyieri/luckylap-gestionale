import { beforeEach, describe, expect, it, vi } from "vitest";

// Server Action di /partner e /partner/dati (spec 02 §6, §7.1; 00-sequenza §1.5).
const mocks = vi.hoisted(() => ({
  preview: false,
  client: { marker: "client" },
  createClient: vi.fn(),
  execute: vi.fn(),
  /** La RPC del finto executePartnerCommand: dopo il controllo della posta. */
  rpc: vi.fn(),
  preview_: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../../lib/runtime", () => ({ isLocalPreviewEnabled: () => mocks.preview }));
vi.mock("../../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("../../../lib/partner/server", () => ({
  executePartnerCommand: mocks.execute,
  previewPartnerDeviceFile: mocks.preview_,
}));

import {
  confirmPartnerAssistantTest,
  recordPartnerActivity,
  removePartnerContact,
  resolvePartnerDifference,
  restorePartnerMessage,
  resumePartnerAssistantSend,
  savePartner,
  savePartnerAssistantRules,
  savePartnerContact,
  savePartnerMessage,
  setPartnerAssistantContact,
  setPartnerAssistantMode,
  setPartnerAssistantSendPriority,
  setPartnerAssistantSettings,
  setPartnerDoNotContact,
  setPartnerState,
  startPartnerAssistantTest,
} from "./actions";
import { importPartnerDeviceFile, previewPartnerDeviceFile } from "./dati/actions";
import { parsePartnerCommand, type PartnerCommand } from "../../../lib/partner/commands";

const command = { kind: "set_partner_state", operationId: "x", payload: {} };
const success = { status: "success", message: "Salvato." };
const ACTIONS = [
  [setPartnerState, "set_partner_state"],
  [savePartner, "save_partner"],
  [recordPartnerActivity, "record_partner_activity"],
  [savePartnerMessage, "save_partner_message"],
  [restorePartnerMessage, "restore_partner_message"],
  [savePartnerContact, "save_partner_contact"],
  [removePartnerContact, "remove_partner_contact"],
  [setPartnerDoNotContact, "set_partner_do_not_contact"],
  [resolvePartnerDifference, "resolve_partner_difference"],
  [importPartnerDeviceFile, "import_partner_device_file"],
  [setPartnerAssistantMode, "set_partner_assistant_mode"],
  [setPartnerAssistantContact, "set_partner_assistant_contact"],
  [savePartnerAssistantRules, "save_partner_assistant_rules"],
  [startPartnerAssistantTest, "start_partner_assistant_test"],
  [confirmPartnerAssistantTest, "confirm_partner_assistant_test"],
  [setPartnerAssistantSendPriority, "set_partner_assistant_send_priority"],
  [resumePartnerAssistantSend, "resume_partner_assistant_send"],
  [setPartnerAssistantSettings, "set_partner_assistant_settings"],
] as const;
const ASSISTANT_ACTIONS = [
  setPartnerAssistantMode,
  setPartnerAssistantContact,
  savePartnerAssistantRules,
  startPartnerAssistantTest,
  confirmPartnerAssistantTest,
  setPartnerAssistantSendPriority,
  resumePartnerAssistantSend,
  setPartnerAssistantSettings,
];

/** Casella e indirizzi di prova sintetici (example.test): tre indirizzi di prova. */
const MAIL = {
  PARTNER_MAIL_USER: "casella@luckylap.example.test",
  PARTNER_MAIL_PASSWORD: "password-sintetica",
  PARTNER_TEST_TO: "prova1@example.test,prova2@example.test,prova3@example.test",
};
const stubMail = (values: Partial<Record<keyof typeof MAIL, string>>) => {
  for (const key of Object.keys(MAIL) as (keyof typeof MAIL)[]) vi.stubEnv(key, values[key] ?? "");
  // Vuoti: valgono i predefiniti, qualunque cosa ci sia nell'ambiente di chi lancia i test.
  for (const key of ["PARTNER_MAIL_FROM_NAME", "PARTNER_MAIL_SMTP_HOST", "PARTNER_MAIL_IMAP_HOST"])
    vi.stubEnv(key, "");
};
const OPERATION = "70000000-0000-4000-8000-000000009000";
const modeCommand = (mode: string) => ({
  kind: "set_partner_assistant_mode",
  operationId: OPERATION,
  payload: { schema_version: 1, mode, expected_version: 3 },
});
const testCommand = (recipients: number) => ({
  kind: "start_partner_assistant_test",
  operationId: OPERATION,
  payload: { schema_version: 1, drafts: 2, recipients },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  stubMail(MAIL);
  mocks.preview = false;
  mocks.createClient.mockResolvedValue(mocks.client);
  // Come executePartnerCommand per un membro: il comando letto passa dal controllo della posta
  // (precheck), poi va alla RPC. L'ordine con la verifica del membro è in command-runner.test.ts.
  mocks.execute.mockImplementation(
    async (
      _client: unknown,
      value: unknown,
      now: Date,
      options: { precheck?: (command: PartnerCommand) => unknown },
    ) => {
      const parsed = parsePartnerCommand(value, now);
      const early = parsed && options.precheck ? options.precheck(parsed) : null;
      if (early) return early;
      mocks.rpc(parsed?.kind);
      return success;
    },
  );
});

describe("Server Action dei comandi Partner", () => {
  it("ognuna passa il comando al server con il solo tipo che le spetta, con i cookie scrivibili", async () => {
    for (const [action, kind] of ACTIONS) {
      mocks.execute.mockClear();
      await expect(action(command)).resolves.toEqual(success);
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      const [client, value, now, options] = mocks.execute.mock.calls[0];
      expect(client).toBe(mocks.client);
      expect(value).toBe(command);
      expect(now).toBeInstanceOf(Date);
      expect(options).toEqual({ kind, precheck: expect.any(Function) });
    }
    expect(mocks.createClient).toHaveBeenCalledWith({ writable: true });
  });

  it("dopo un salvataggio rilegge /partner; l'import del file anche /partner/dati", async () => {
    await savePartnerMessage(command);
    expect(mocks.revalidatePath.mock.calls).toEqual([["/partner"]]);
    mocks.revalidatePath.mockClear();
    await importPartnerDeviceFile(command);
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/partner"],
      ["/partner/dati"],
      ["/"],
      ["/team"],
    ]);
  });

  it("i comandi che aprono o chiudono solleciti rileggono anche Oggi e il Team", async () => {
    for (const action of [setPartnerState, recordPartnerActivity, setPartnerDoNotContact]) {
      mocks.revalidatePath.mockClear();
      await action(command);
      expect(mocks.revalidatePath.mock.calls).toEqual([["/partner"], ["/"], ["/team"]]);
    }
  });

  it("i comandi dell'assistente rileggono /partner e /partner/assistente", async () => {
    for (const action of ASSISTANT_ACTIONS) {
      mocks.revalidatePath.mockClear();
      await action(command);
      expect(mocks.revalidatePath.mock.calls).toEqual([["/partner"], ["/partner/assistente"]]);
    }
  });

  it("40001 rilegge la pagina; gli altri rifiuti e gli esiti incerti no", async () => {
    mocks.execute.mockResolvedValueOnce({
      status: "rejected",
      code: "partner_changed",
      message: "…",
      refresh: true,
    });
    await savePartnerMessage(command);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/partner");
    mocks.revalidatePath.mockClear();
    mocks.execute.mockResolvedValueOnce({
      status: "rejected",
      code: "partner_do_not_contact",
      message: "…",
      refresh: false,
    });
    await recordPartnerActivity(command);
    mocks.execute.mockResolvedValueOnce({ status: "uncertain", message: "…" });
    await recordPartnerActivity(command);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("«Prova» e «Invio» senza la posta dell'assistente: rifiuto senza RPC", async () => {
    const notConfigured = {
      status: "rejected",
      code: "partner_assistant_mail_not_configured",
      message:
        "La posta dell'assistente non è configurata: «Prova» e «Invio» non sono disponibili.",
      refresh: false,
    };
    for (const missing of [
      { ...MAIL, PARTNER_MAIL_USER: "" },
      { ...MAIL, PARTNER_MAIL_PASSWORD: "" },
      { ...MAIL, PARTNER_MAIL_USER: "non-un-indirizzo" },
    ]) {
      stubMail(missing);
      for (const mode of ["invio", "prova"])
        await expect(setPartnerAssistantMode(modeCommand(mode)), mode).resolves.toEqual(
          notConfigured,
        );
      await expect(startPartnerAssistantTest(testCommand(3))).resolves.toEqual(notConfigured);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    // «Spento» e «Prepara» non mandano email: passano anche senza posta.
    for (const mode of ["spento", "prepara"]) {
      mocks.rpc.mockClear();
      await expect(setPartnerAssistantMode(modeCommand(mode))).resolves.toEqual(success);
      expect(mocks.rpc, mode).toHaveBeenCalledTimes(1);
    }
  });

  it("«Manda la prova»: senza indirizzi di prova o con un numero diverso, rifiuto senza RPC", async () => {
    stubMail({ ...MAIL, PARTNER_TEST_TO: "" });
    await expect(startPartnerAssistantTest(testCommand(1))).resolves.toMatchObject({
      status: "rejected",
      code: "partner_assistant_mail_not_configured",
      refresh: false,
    });
    // Senza indirizzi di prova «Prova» si può scegliere: la casella c'è.
    await expect(setPartnerAssistantMode(modeCommand("prova"))).resolves.toEqual(success);
    mocks.execute.mockClear();
    mocks.rpc.mockClear();
    mocks.revalidatePath.mockClear();
    stubMail(MAIL);
    await expect(startPartnerAssistantTest(testCommand(2))).resolves.toEqual({
      status: "rejected",
      code: "partner_assistant_test_to_changed",
      message: "Gli indirizzi di prova sono cambiati: ricarica la pagina e riprova.",
      refresh: false,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    await expect(startPartnerAssistantTest(testCommand(3))).resolves.toEqual(success);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("start_partner_assistant_test");
    expect(mocks.execute.mock.calls.at(-1)?.[1]).toEqual(testCommand(3));
    await expect(setPartnerAssistantMode(modeCommand("invio"))).resolves.toEqual(success);
  });

  it("«Verifica lo stesso invio»: la ripetizione va alla ricevuta, non alla posta di adesso", async () => {
    stubMail({ ...MAIL, PARTNER_MAIL_USER: "" });
    await expect(
      setPartnerAssistantMode({ ...modeCommand("invio"), retry: true }),
    ).resolves.toEqual(success);
    stubMail(MAIL);
    await expect(startPartnerAssistantTest({ ...testCommand(2), retry: true })).resolves.toEqual(
      success,
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("un errore imprevisto diventa «Salvataggio non confermato», mai un'eccezione", async () => {
    mocks.createClient.mockRejectedValueOnce(new Error("cookie"));
    await expect(setPartnerState(command)).resolves.toEqual({
      status: "uncertain",
      message: "Salvataggio non confermato. Verifica prima di riprovare.",
    });
    mocks.execute.mockRejectedValueOnce(new Error("rete"));
    await expect(savePartner(command)).resolves.toMatchObject({ status: "uncertain" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("anteprima locale: nessuna chiamata a Supabase, salvataggio disattivato", async () => {
    mocks.preview = true;
    // L'anteprima viene prima del controllo della posta.
    stubMail({});
    await expect(setPartnerAssistantMode(modeCommand("invio"))).resolves.toMatchObject({
      code: "preview",
    });
    await expect(startPartnerAssistantTest(testCommand(2))).resolves.toMatchObject({
      code: "preview",
    });
    for (const [action] of ACTIONS)
      await expect(action(command)).resolves.toEqual({
        status: "rejected",
        code: "preview",
        message: "Anteprima locale: salvataggio disattivato.",
        refresh: false,
      });
    await expect(previewPartnerDeviceFile({})).resolves.toMatchObject({
      status: "rejected",
      code: "preview",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.preview_).not.toHaveBeenCalled();
  });

  it("«Controlla il file» passa dal server con la sessione; un errore non importa niente", async () => {
    mocks.preview_.mockResolvedValueOnce({ status: "ready", preview: { marker: true } });
    await expect(previewPartnerDeviceFile({ file: 1 })).resolves.toEqual({
      status: "ready",
      preview: { marker: true },
    });
    expect(mocks.preview_).toHaveBeenCalledWith(mocks.client, { file: 1 });
    mocks.createClient.mockRejectedValueOnce(new Error("cookie"));
    await expect(previewPartnerDeviceFile({})).resolves.toEqual({
      status: "rejected",
      code: "unavailable",
      message: "Controllo del file non disponibile. Riprova tra poco: niente è stato importato.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
