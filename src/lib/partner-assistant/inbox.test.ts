import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { runPartnerAssistantInbox } from "./inbox";
import type { PartnerInboxStore } from "./inbox-store";
import type { PartnerInboxMailboxResult } from "./inbox-mailbox";

const id = (n: number) => `94000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const config = {
  workerSecret: "synthetic-worker-secret-0000000000000",
  anthropicApiKey: "sk-ant-synthetic-0000000000000000",
  supabaseUrl: "https://synthetic.supabase.co",
  supabaseSecretKey: "sb_secret_synthetic-partner",
  phone: "+39 000 000 0000",
};
const mail = {
  user: "mail@brand.example.test",
  password: "synthetic-password",
  fromName: "Nome sintetico",
  smtpHost: "smtp.example.test",
  imapHost: "imap.example.test",
  testTo: [],
  domain: "brand.example.test",
};
const yes = <T>(value: T) => ({ ok: true, value }) as const;
const complete: PartnerInboxMailboxResult = {
  status: "complete",
  batch: {
    folder: { path: "INBOX", uid_validity: "42", expected_last_uid: 0, last_uid: 10 },
    messages: [],
  },
};
function setup() {
  const events: string[] = [];
  const store: PartnerInboxStore = {
    claim: vi.fn(async () => {
      events.push("claim");
      return yes({
        status: "claimed" as const,
        lease_token: id(1),
        activated_at: "2026-11-18T10:00:00Z",
        cursors: [{ path: "INBOX" as const, uid_validity: null, last_uid: 0 }],
        candidates: [],
      });
    }),
    record: vi.fn(async () => {
      events.push("record");
      return yes({ status: "recorded" as const, registered: 1, review: 0, ignored: 0 });
    }),
    release: vi.fn(async () => {
      events.push("release");
      return yes({ status: "done" as const });
    }),
  };
  const checkMailbox = vi.fn(async () => {
    events.push("scan");
    return complete;
  });
  const run = () =>
    runPartnerAssistantInbox(config, mail, new AbortController().signal, {
      store,
      checkMailbox,
      uuid: () => id(2),
    });
  return { store, checkMailbox, events, run };
}
describe("importazione delle risposte IONOS", () => {
  it("salva messaggi e cursore nello stesso batch, quindi rilascia la lease", async () => {
    const t = setup();
    expect(await t.run()).toEqual({ status: "observed" });
    expect(t.events).toEqual(["claim", "scan", "record", "release"]);
    expect(t.store.claim).toHaveBeenCalledWith(id(2), 60, expect.any(AbortSignal));
    expect(t.store.record).toHaveBeenCalledWith(id(1), complete.batch, expect.any(AbortSignal));
    expect(t.store.release).toHaveBeenCalledWith(id(1), "inbox_osservata", expect.any(AbortSignal));
  });
  it("quando il controllo non è dovuto non apre IMAP", async () => {
    const t = setup();
    vi.mocked(t.store.claim).mockResolvedValue(yes({ status: "idle", reason: "non_dovuta" }));
    expect(await t.run()).toEqual({ status: "idle" });
    expect(t.checkMailbox).not.toHaveBeenCalled();
    expect(t.store.record).not.toHaveBeenCalled();
    expect(t.store.release).not.toHaveBeenCalled();
  });
  it("una lettura parziale non avanza il cursore e libera la lease come incerta", async () => {
    const t = setup();
    t.checkMailbox.mockResolvedValue({ status: "uncertain", reason: "inbox_lettura_incompleta" });
    expect(await t.run()).toEqual({ status: "uncertain" });
    expect(t.store.record).not.toHaveBeenCalled();
    expect(t.store.release).toHaveBeenCalledWith(id(1), "inbox_incerta", expect.any(AbortSignal));
  });
  it("un errore di persistenza lascia la scansione da ripetere", async () => {
    const t = setup();
    vi.mocked(t.store.record).mockResolvedValue({ ok: false });
    expect(await t.run()).toEqual({ status: "uncertain" });
    expect(t.store.release).toHaveBeenCalledWith(id(1), "inbox_incerta", expect.any(AbortSignal));
  });
  it("una lease persa non viene trattata come registrazione riuscita", async () => {
    const t = setup();
    vi.mocked(t.store.record).mockResolvedValue(yes({ status: "lease_persa" }));
    expect(await t.run()).toEqual({ status: "uncertain" });
  });
  it("se la scansione lancia un errore il rilascio avviene comunque", async () => {
    const t = setup();
    t.checkMailbox.mockRejectedValue(new Error("synthetic_error"));
    expect(await t.run()).toEqual({ status: "uncertain" });
    expect(t.store.record).not.toHaveBeenCalled();
    expect(t.store.release).toHaveBeenCalledOnce();
  });
  it("il rilascio fallito impedisce al chiamante di proseguire con gli invii", async () => {
    const t = setup();
    vi.mocked(t.store.release).mockResolvedValue({ ok: false });
    expect(await t.run()).toEqual({ status: "uncertain" });
  });
});
