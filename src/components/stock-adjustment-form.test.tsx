import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/stock/actions", () => ({ adjustStock: vi.fn() }));
vi.mock("@/lib/stock/model", () => import("../lib/stock/model"));
import { stockAttemptLines } from "./stock-adjustment-form";
import type { StockSnapshot } from "../lib/stock/model";

const item = "00000000-0000-4000-8000-000000000001",
  location = "00000000-0000-4000-8000-000000000002",
  operationId = "00000000-0000-4000-8000-000000000003";
const snapshot = {
  enabled: true,
  loadedAt: "2026-10-22T08:00:00Z",
  items: [{ id: item, sku: "SYN-GT3-BLU-M", name: "GT3 Blu M", active: true }],
  locations: [{ id: location, code: "MAG01", name: "Magadzino", active: true }],
  availability: [],
} as unknown as StockSnapshot;

describe("rettifica da verificare", () => {
  it("riassume articolo, sede, variazione e causale senza id", () => {
    const lines = stockAttemptLines(
      { operationId, itemId: item, locationId: location, delta: 3, reason: "Conta sintetica" },
      snapshot,
    );
    expect(lines).toEqual([
      "SYN-GT3-BLU-M · GT3 Blu M",
      "Sede: Magadzino",
      "Variazione: +3 unità",
      "Causale: Conta sintetica",
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/00000000-/);
  });
  it("se articolo o sede non ci sono più lo dice, senza mostrare l'id", () => {
    const lines = stockAttemptLines(
      { operationId, itemId: operationId, locationId: operationId, delta: -2, reason: "Reso" },
      snapshot,
    );
    expect(lines.slice(0, 3)).toEqual([
      "Articolo non più nell’elenco",
      "Sede non più tra i magazzini",
      "Variazione: -2 unità",
    ]);
    expect(JSON.stringify(lines)).not.toContain(operationId);
  });
});
