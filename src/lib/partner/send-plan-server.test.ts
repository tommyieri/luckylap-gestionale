import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadPartnerSendPlan } from "./send-plan-server";

const data = { day: "2026-11-09", generated_at: "2026-11-09T07:30:00Z", mode: "invio", slots: [] };
function database(value: unknown = data, error: unknown = null) {
  const abortSignal = vi.fn(async (_signal: AbortSignal) => ({ data: value, error }));
  const rpc = vi.fn(() => ({ abortSignal }));
  return { client: { rpc } as unknown as SupabaseClient, rpc, abortSignal };
}
describe("lettura isolata del piano", () => {
  it("usa il client membro, il giorno richiesto e un segnale con timeout", async () => {
    const db = database();
    expect(await loadPartnerSendPlan(db.client, data.day)).toEqual({
      day: data.day,
      generatedAt: data.generated_at,
      mode: "invio",
      slots: [],
    });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("read_partner_send_plan", { p_day: data.day });
    expect(db.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });
  it("non chiama la RPC per un giorno impossibile", async () => {
    const db = database();
    expect(await loadPartnerSendPlan(db.client, "2026-02-30")).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...data, day: "2026-11-10" }, { ...data, raw: "riservato" }])(
    "dati mancanti o di un altro giorno non diventano un piano vuoto",
    async (value) => {
      expect(await loadPartnerSendPlan(database(value).client, data.day)).toBeNull();
    },
  );
  it("errori e RPC mancante restano confinati e non espongono dettagli", async () => {
    expect(
      await loadPartnerSendPlan(
        database(data, { code: "PGRST202", message: "riservato" }).client,
        data.day,
      ),
    ).toBeNull();
    const db = database();
    db.abortSignal.mockRejectedValueOnce(new Error("rete riservata"));
    expect(await loadPartnerSendPlan(db.client, data.day)).toBeNull();
  });
});
