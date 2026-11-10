import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ plan: vi.fn(), assistant: vi.fn(), send: vi.fn() }));
vi.mock("../partner/send-plan-server", () => ({ loadPartnerSendPlan: mocks.plan }));
vi.mock("../partner/server", () => ({
  loadPartnerAssistantStatus: mocks.assistant,
  loadPartnerAssistantSend: mocks.send,
}));
import { loadAutomaticFollowupMode, loadAutomaticMailTile } from "./automatic-mail-server";

const id = (n: number) => `84000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-11-10T10:00:00Z");
const day = "2026-11-10";
const plan = () => ({
  day,
  generatedAt: "2026-11-10T10:00:00Z",
  mode: "invio",
  slots: [
    {
      id: id(10),
      partnerId: id(1),
      co: 951,
      name: "Club sintetico",
      kind: "primo",
      timezone: "Europe/Rome",
      localDay: day,
      plannedAt: "2026-11-10T12:00:00Z",
      expiresAt: "2026-11-10T12:05:00Z",
      status: "scheduled",
      reason: null,
    },
  ],
});
const followup = () => ({
  id: id(9),
  status: "active",
  reason: null,
  version: 1,
  followups_sent: 0,
  next_due_on: day,
  last_checked_at: null,
  next_check_at: "2026-11-10T10:00:00Z",
  mode: "invio",
});
type Tables = Record<string, Record<string, unknown>[]>;
const tables = (): Tables => ({
  partner_assistant_messages: [],
  partners: [{ id: id(1), co: 951, name: "Club sintetico", sections: ["club"] }],
  partner_assistant_jobs: [{ partner_id: id(1), draft_id: id(2), choice_note_id: id(3) }],
  partner_assistant_drafts: [{ id: id(2), research_note_id: id(4), choice_note_id: null }],
  partner_assistant_notes: [
    { id: id(3), kind: "scelta", template: null, timezone: "Europe/Rome" },
    { id: id(4), kind: "ricerca", template: "true", timezone: null },
  ],
});
function database(
  source = tables(),
  options: { truncated?: boolean; rpcData?: unknown; rpcError?: unknown } = {},
) {
  const selections: { table: string; columns: string }[] = [];
  const from = vi.fn((table: string) => {
    let picked = [...(source[table] ?? [])];
    let columns = "";
    let exact = false;
    let anchor = false;
    const query = {
      select: vi.fn((value: string, opts?: { count: string }) => {
        columns = value;
        exact = opts?.count === "exact";
        anchor = table === "partner_assistant_messages" && value === "partner_id";
        selections.push({ table, columns: value });
        return query;
      }),
      eq: vi.fn((_column: string, _value: unknown) => query),
      order: vi.fn((_column: string, _options?: unknown) => query),
      limit: vi.fn((_limit: number) => query),
      in: vi.fn((column: string, wanted: string[]) => {
        picked = picked.filter((row) => wanted.includes(row[column] as string));
        return query;
      }),
      abortSignal: vi.fn(async (_signal: AbortSignal) => ({
        data: anchor ? [{ partner_id: id(1) }] : picked,
        error: null,
        count: exact
          ? picked.length + (options.truncated && table === "partner_assistant_messages" ? 1 : 0)
          : null,
      })),
    };
    return query;
  });
  const rpc = vi.fn((_name: string, _payload: unknown) => ({
    abortSignal: vi.fn(async () => ({
      data: options.rpcData === undefined ? followup() : options.rpcData,
      error: options.rpcError ?? null,
    })),
  }));
  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc, selections };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.plan.mockResolvedValue(plan());
  mocks.assistant.mockResolvedValue({ mode: "invio", configured: true, pausedReason: "credito" });
  mocks.send.mockResolvedValue({
    stopReason: null,
    dayStoppedOn: null,
    envMailboxOk: true,
    backoffUntil: null,
  });
});

describe("lettura RLS degli invii automatici della home", () => {
  it("usa il giorno di Roma e gli helper esistenti, con sole proiezioni operative", async () => {
    const db = database();
    const result = await loadAutomaticMailTile(db.client, now);
    expect(mocks.plan).toHaveBeenCalledExactlyOnceWith(db.client, day);
    expect(mocks.assistant).toHaveBeenCalledExactlyOnceWith(db.client);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(db.client);
    expect(result).toMatchObject({
      status: "ok",
      data: {
        state: "automatic",
        followupMode: "invio",
        totals: { scheduled: 1 },
        groups: [
          { key: "other", counts: { scheduled: 0 } },
          { key: "club", counts: { scheduled: 1 } },
          { key: "followup", counts: { scheduled: 0 } },
        ],
      },
    });
    expect(db.selections.map((item) => item.table)).not.toContain("partner_assistant_followups");
    for (const { columns } of db.selections) {
      expect(columns).not.toMatch(
        /(?:^|,)(?:body|subject|signature|raw|to_address|address_sha256|content)(?:,|$)/u,
      );
      expect(columns).not.toContain("*");
    }
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("read_partner_followup", {
      p_partner_id: id(1),
    });
  });
  it("usa la bozza del messaggio per classificare un invio già avvenuto", async () => {
    const source = tables();
    source.partner_assistant_notes[1].template = "false";
    source.partner_assistant_drafts.push({
      id: id(6),
      research_note_id: id(7),
      choice_note_id: null,
    });
    source.partner_assistant_notes.push({
      id: id(7),
      kind: "ricerca",
      template: "true",
      timezone: null,
    });
    source.partner_assistant_messages = [
      {
        id: id(5),
        partner_id: id(1),
        draft_id: id(6),
        kind: "primo",
        send_status: "inviato",
        send_day: day,
        sent_at: "2026-11-10T08:02:00Z",
        created_at: "2026-11-10T08:01:00Z",
        outcome: "inviato",
      },
    ];
    const result = await loadAutomaticMailTile(database(source).client, now);
    expect(result).toMatchObject({
      status: "ok",
      data: {
        totals: { sent: 1, scheduled: 0 },
        groups: [
          { key: "other", counts: { sent: 0 } },
          { key: "club", counts: { sent: 1 } },
          { key: "followup", counts: { sent: 0 } },
        ],
      },
    });
  });
  it("una lettura troncata non diventa un conteggio parziale o zero", async () => {
    expect(
      await loadAutomaticMailTile(database(tables(), { truncated: true }).client, now),
    ).toEqual({ status: "error" });
    mocks.plan.mockResolvedValueOnce(null);
    expect(await loadAutomaticMailTile(database().client, now)).toEqual({ status: "error" });
    const source = tables();
    source.partners = [];
    expect(await loadAutomaticMailTile(database(source).client, now)).toEqual({ status: "error" });
  });
  it("senza la bozza storica non deduce Club o altri dalle sezioni attuali", async () => {
    const source = tables();
    source.partners[0].sections = ["collab"];
    source.partner_assistant_messages = [
      {
        id: id(5),
        partner_id: id(1),
        draft_id: null,
        kind: "primo",
        send_status: "inviato",
        send_day: day,
        sent_at: "2026-11-10T08:02:00Z",
        created_at: "2026-11-10T08:01:00Z",
        outcome: "inviato",
      },
    ];
    const result = await loadAutomaticMailTile(database(source).client, now);
    expect(result).toEqual({ status: "error" });
  });
  it("un MIME pronto prima di start non consuma quote e non rompe il riepilogo", async () => {
    const source = tables();
    source.partner_assistant_messages = [
      {
        id: id(5),
        partner_id: id(1),
        draft_id: id(2),
        kind: "primo",
        send_status: "pronto",
        send_day: day,
        sent_at: null,
        created_at: "2026-11-10T09:59:00Z",
        outcome: null,
      },
    ];
    expect(await loadAutomaticMailTile(database(source).client, now)).toMatchObject({
      status: "ok",
      data: { totals: { sent: 0, sending: 0, scheduled: 1, uncertain: 0 } },
    });
  });
  it("non conferma lo stato automatico se la configurazione non è leggibile", async () => {
    mocks.send.mockRejectedValueOnce(new Error("dettaglio riservato"));
    expect(await loadAutomaticMailTile(database().client, now)).toMatchObject({
      status: "ok",
      data: { state: "unreadable", totals: { scheduled: 1 } },
    });
  });
  it("lo stato FU sconosciuto rimane esplicito senza nascondere i conteggi validi", async () => {
    const result = await loadAutomaticMailTile(database(tables(), { rpcData: null }).client, now);
    expect(result).toMatchObject({
      status: "ok",
      data: { followupMode: "unknown", totals: { scheduled: 1 } },
    });
  });
  it("helper FU riusabile: con un partner noto fa una sola RPC e nessuna query alla tabella privata", async () => {
    const db = database();
    expect(await loadAutomaticFollowupMode(db.client, id(1))).toBe("invio");
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("read_partner_followup", {
      p_partner_id: id(1),
    });
    expect(
      await loadAutomaticFollowupMode(
        database(tables(), { rpcError: { message: "privato" } }).client,
        id(1),
      ),
    ).toBe("unknown");
    expect(
      await loadAutomaticFollowupMode(
        database(tables(), { rpcData: { ...followup(), mode: "auto" } }).client,
        id(1),
      ),
    ).toBe("unknown");
  });
});
