import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import {
  createPartnerInboxFetch,
  createPartnerInboxStore,
  readPartnerInboxClaim,
  validPartnerInboxBatch,
  type PartnerInboxBatch,
} from "./inbox-store";

const id = (n: number) => `94000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const config = {
  workerSecret: "synthetic-worker-secret-0000000000000",
  anthropicApiKey: "sk-ant-synthetic-0000000000000000",
  supabaseUrl: "https://synthetic.supabase.co",
  supabaseSecretKey: "sb_secret_synthetic-partner",
  phone: "+39 000 000 0000",
};
const signal = () => new AbortController().signal;
const claim = () => ({
  status: "claimed",
  lease_token: id(1),
  activated_at: "2026-11-18T10:00:00+00:00",
  cursors: [{ path: "INBOX", uid_validity: null, last_uid: 0 }],
  candidates: [
    {
      partner_id: id(2),
      co: 951,
      name: "Expo Sintetica 2027",
      addresses: ["person@event.example.test"],
      first_contact_at: "2026-11-17T10:00:00+00:00",
      last_contact_at: "2026-11-17T10:00:00+00:00",
      subject_alias: "expo sintetica",
    },
  ],
});
const batch = (): PartnerInboxBatch => ({
  folder: { path: "INBOX", uid_validity: "42", expected_last_uid: 0, last_uid: 7 },
  messages: [
    {
      message_id: "<synthetic@event.example.test>",
      from_address: "person@event.example.test",
      received_at: "2026-11-18T10:35:00.000Z",
      subject: "Expo Sintetica 2027",
      automatic: false,
      references: [],
      body_excerpt: "Testo sintetico.",
    },
  ],
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal });
});
describe("contratto della coda IONOS", () => {
  it("legge il cursore iniziale senza Message-ID SMTP obbligatori", () => {
    expect(readPartnerInboxClaim(claim())).toEqual(claim());
    const manual = claim();
    manual.candidates[0].addresses = [];
    manual.candidates[0].subject_alias = "expo sintetica";
    expect(readPartnerInboxClaim(manual)).not.toBeNull();
  });
  it("rifiuta candidati duplicati, date impossibili, cursori e campi sconosciuti", () => {
    const duplicate = claim();
    duplicate.candidates.push(duplicate.candidates[0]);
    expect(readPartnerInboxClaim(duplicate)).toBeNull();
    expect(readPartnerInboxClaim({ ...claim(), activated_at: "2026-02-30T10:00:00Z" })).toBeNull();
    expect(readPartnerInboxClaim({ ...claim(), cursors: [] })).toBeNull();
    expect(readPartnerInboxClaim({ ...claim(), send_allowed: true })).toBeNull();
  });
  it("non corregge implicitamente indirizzi o esiti inattesi", () => {
    const invalid = claim();
    invalid.candidates[0].addresses = ["NOT AN ADDRESS"];
    expect(readPartnerInboxClaim(invalid)).toBeNull();
    expect(readPartnerInboxClaim({ status: "idle", reason: "testo libero con email" })).toBeNull();
  });
  it("permette un reset UID con cursore nuovo inferiore e confronta il cursore precedente", () => {
    const reset = batch();
    reset.folder.expected_last_uid = 999;
    expect(validPartnerInboxBatch(reset)).toBe(true);
    expect(
      validPartnerInboxBatch({ ...reset, folder: { ...reset.folder, expected_last_uid: -1 } }),
    ).toBe(false);
  });
  it("limita i batch e gli estratti e vieta campi che possano autorizzare un invio", () => {
    const b = batch();
    expect(validPartnerInboxBatch(b)).toBe(true);
    expect(
      validPartnerInboxBatch({ ...b, messages: Array.from({ length: 51 }, () => b.messages[0]) }),
    ).toBe(false);
    expect(
      validPartnerInboxBatch({
        ...b,
        messages: [{ ...b.messages[0], body_excerpt: "x".repeat(2001) }],
      }),
    ).toBe(false);
    expect(
      validPartnerInboxBatch({
        ...b,
        messages: [{ ...b.messages[0], automatic: false, send_allowed: true } as never],
      }),
    ).toBe(false);
  });
  it("rifiuta Message-ID non validi e riferimenti autoreferenziali", () => {
    const b = batch();
    expect(
      validPartnerInboxBatch({
        ...b,
        messages: [{ ...b.messages[0], message_id: "synthetic@event.example.test" }],
      }),
    ).toBe(false);
    expect(
      validPartnerInboxBatch({
        ...b,
        messages: [{ ...b.messages[0], references: [b.messages[0].message_id] }],
      }),
    ).toBe(false);
  });
});
describe("RPC IONOS", () => {
  it("richiede una lease e manda il payload senza modificarlo", async () => {
    mocks.abortSignal.mockResolvedValueOnce({ data: claim(), error: null });
    const store = createPartnerInboxStore(config);
    expect(await store.claim(id(3), 60, signal())).toEqual({ ok: true, value: claim() });
    expect(mocks.rpc).toHaveBeenLastCalledWith("claim_partner_ionos_inbox", {
      p_worker_id: id(3),
      p_lease_seconds: 60,
    });
    const result = { status: "recorded", registered: 1, review: 0, ignored: 0 };
    mocks.abortSignal.mockResolvedValueOnce({ data: result, error: null });
    expect(await store.record(id(1), batch(), signal())).toEqual({ ok: true, value: result });
    expect(mocks.rpc).toHaveBeenLastCalledWith("record_partner_ionos_inbox", {
      p_lease_token: id(1),
      p_payload: batch(),
    });
  });
  it("rifiuta gli argomenti scorretti prima della rete", async () => {
    const store = createPartnerInboxStore(config);
    expect(await store.claim(id(3), 10, signal())).toEqual({ ok: false });
    expect(await store.record("invalid", batch(), signal())).toEqual({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("un errore DB o un successo con campi inattesi rimane incerto", async () => {
    const store = createPartnerInboxStore(config);
    mocks.abortSignal.mockResolvedValueOnce({ data: null, error: { message: "synthetic_error" } });
    expect(await store.record(id(1), batch(), signal())).toEqual({ ok: false });
    mocks.abortSignal.mockResolvedValueOnce({
      data: { status: "recorded", registered: 1, review: 0, ignored: 0, extra: true },
      error: null,
    });
    expect(await store.record(id(1), batch(), signal())).toEqual({ ok: false });
  });
  it("rilascia la lease con un codice fisso e riconosce la perdita", async () => {
    const store = createPartnerInboxStore(config);
    mocks.abortSignal.mockResolvedValueOnce({ data: { status: "done" }, error: null });
    expect(await store.release(id(1), "inbox_osservata", signal())).toEqual({
      ok: true,
      value: { status: "done" },
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith("release_partner_ionos_inbox", {
      p_lease_token: id(1),
      p_outcome: "inbox_osservata",
    });
    mocks.abortSignal.mockResolvedValueOnce({ data: { status: "lease_persa" }, error: null });
    expect(await store.release(id(1), "inbox_incerta", signal())).toEqual({
      ok: true,
      value: { status: "lease_persa" },
    });
  });
  it("il trasporto accetta soltanto le tre RPC e non segue redirect con credenziali", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ status: "done" }),
    );
    const guarded = createPartnerInboxFetch(config, fetcher);
    await expect(
      guarded("https://synthetic.supabase.co/rest/v1/rpc/send_email", {
        method: "POST",
        body: "{}",
        signal: signal(),
      }),
    ).rejects.toThrow("worker_transport_invalid");
    await guarded("https://synthetic.supabase.co/rest/v1/rpc/release_partner_ionos_inbox", {
      method: "POST",
      body: "{}",
      signal: signal(),
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
  });
});
