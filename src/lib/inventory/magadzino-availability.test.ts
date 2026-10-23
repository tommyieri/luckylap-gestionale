import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { loadMagadzinoAvailability } from "./magadzino-availability";

const MAG = "00000000-0000-4000-8000-0000000000a1";
const ITEM_A = "00000000-0000-4000-8000-0000000000b1";
const ITEM_B = "00000000-0000-4000-8000-0000000000b2";
type Reply = { data: unknown; error: unknown; count?: number | null };

/** Client finto: ogni `from` risponde con la prossima risposta e registra filtri e ordine. */
function client(replies: Reply[]) {
  const calls: { table: string; steps: [string, unknown[]][] }[] = [];
  const supabase = {
    from(table: string) {
      const reply = replies.shift() ?? { data: null, error: { code: "UNEXPECTED" } };
      const call = { table, steps: [] as [string, unknown[]][] };
      calls.push(call);
      const builder: Record<string, unknown> = {
        then: (resolve: (value: Reply) => unknown) => resolve(reply),
      };
      for (const name of ["select", "eq", "order", "limit", "gt"])
        builder[name] = (...args: unknown[]) => {
          call.steps.push([name, args]);
          return builder;
        };
      return builder;
    },
  };
  return { supabase: supabase as unknown as SupabaseClient, calls };
}
const row = (stockItemId: string, onHand: number | null, reserved: number) => ({
  stock_item_id: stockItemId,
  location_id: MAG,
  on_hand: onHand,
  reserved,
  available: onHand === null ? null : onHand - reserved,
});

describe("lettura del Magadzino per le magliette disponibili", () => {
  it("legge solo la sede MAG01 dalla vista della disponibilità, con fisico e riservato", async () => {
    const { supabase, calls } = client([
      { data: [{ id: MAG, code: "MAG01" }], error: null },
      { data: [row(ITEM_A, 5, 2), row(ITEM_B, null, 0)], error: null, count: 2 },
    ]);
    await expect(loadMagadzinoAvailability(supabase)).resolves.toEqual([
      { stockItemId: ITEM_A, locationCode: "MAG01", onHand: 5, reserved: 2 },
      { stockItemId: ITEM_B, locationCode: "MAG01", onHand: null, reserved: 0 },
    ]);
    expect(calls.map((call) => call.table)).toEqual([
      "stock_locations",
      "operational_stock_availability",
    ]);
    expect(calls[0].steps).toContainEqual(["eq", ["code", "MAG01"]]);
    expect(calls[1].steps).toContainEqual(["eq", ["location_id", MAG]]);
    expect(calls[1].steps).toContainEqual(["order", ["stock_item_id"]]);
  });

  it("senza una sola sede MAG01 non mostra numeri", async () => {
    for (const data of [[], [{ id: MAG }, { id: ITEM_A }]]) {
      const { supabase } = client([{ data, error: null }]);
      await expect(loadMagadzinoAvailability(supabase)).rejects.toThrow(
        "Disponibilità del Magadzino non leggibile.",
      );
    }
  });

  it("rifiuta righe incoerenti: disponibile sbagliato, riservato oltre il fisico, altra sede", async () => {
    const bad = [
      { ...row(ITEM_A, 5, 2), available: 5 },
      { ...row(ITEM_A, 1, 0), reserved: 2, available: -1 },
      { ...row(ITEM_A, null, 0), available: 0 },
      { ...row(ITEM_A, 3, 0), location_id: ITEM_B },
      { ...row(ITEM_A, 3, 0), on_hand: 2.5 },
    ];
    for (const value of bad) {
      const { supabase } = client([
        { data: [{ id: MAG, code: "MAG01" }], error: null },
        { data: [value], error: null, count: 1 },
      ]);
      await expect(loadMagadzinoAvailability(supabase), JSON.stringify(value)).rejects.toThrow();
    }
  });

  it("un errore della vista non diventa una lista vuota", async () => {
    const { supabase } = client([
      { data: [{ id: MAG, code: "MAG01" }], error: null },
      { data: null, error: { code: "42501" }, count: null },
    ]);
    await expect(loadMagadzinoAvailability(supabase)).rejects.toThrow();
  });
});
