import { beforeEach, describe, expect, it, vi } from "vitest";

// Server Action di /partner e /partner/dati (spec 02 §6, §7.1; 00-sequenza §1.5).
const mocks = vi.hoisted(() => ({
  preview: false,
  client: { marker: "client" },
  createClient: vi.fn(),
  execute: vi.fn(),
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
  recordPartnerActivity,
  removePartnerContact,
  resolvePartnerDifference,
  restorePartnerMessage,
  savePartner,
  savePartnerContact,
  savePartnerMessage,
  setPartnerDoNotContact,
  setPartnerState,
} from "./actions";
import { importPartnerDeviceFile, previewPartnerDeviceFile } from "./dati/actions";

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
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview = false;
  mocks.createClient.mockResolvedValue(mocks.client);
  mocks.execute.mockResolvedValue(success);
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
      expect(options).toEqual({ kind });
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
