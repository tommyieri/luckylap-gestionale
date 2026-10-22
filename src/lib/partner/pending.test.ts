import { describe, expect, it } from "vitest";
import { parsePartnerCommand, type PartnerCommand } from "./commands";
import { partnerFixtureId } from "./fixtures";
import {
  clearPendingPartner,
  pendingPartnerLines,
  pendingPartnerPrefix,
  recoverPendingPartner,
  storePendingPartner,
} from "./pending";

// Spec 02 §5.11: «Verifica» ripete lo stesso comando con lo stesso operation_id.
const USER = partnerFixtureId(901);
const NOW = new Date("2026-10-22T10:00:00Z");

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    store,
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}
const stateCommand = parsePartnerCommand(
  {
    kind: "set_partner_state",
    operationId: partnerFixtureId(9001),
    payload: {
      schema_version: 1,
      partner_id: partnerFixtureId(1),
      expected_version: 2,
      stage: "risposto",
    },
  },
  NOW,
) as PartnerCommand;
const activityCommand = parsePartnerCommand(
  {
    kind: "record_partner_activity",
    operationId: partnerFixtureId(9002),
    payload: {
      schema_version: 1,
      partner_id: partnerFixtureId(1),
      kind: "inviato",
      message_kind: "sollecito",
      occurred_on: "2026-10-21",
    },
  },
  NOW,
) as PartnerCommand;

describe("tentativi in sospeso", () => {
  it("salva e ritrova lo stesso comando, come ripetizione", () => {
    const storage = memoryStorage();
    expect(storePendingPartner(storage, USER, "stato:1", stateCommand)).toBe(true);
    const { entries, unreadable } = recoverPendingPartner(storage, USER, [], NOW);
    expect(unreadable).toBe(false);
    expect(entries).toEqual([
      {
        key: `${pendingPartnerPrefix(USER)}stato:1`,
        scope: "stato:1",
        command: { ...stateCommand, retry: true },
      },
    ]);
  });

  it("ogni utente vede solo i suoi; i moduli già aperti non si ripetono", () => {
    const storage = memoryStorage();
    storePendingPartner(storage, USER, "stato:1", stateCommand);
    storePendingPartner(storage, partnerFixtureId(902), "stato:1", stateCommand);
    expect(recoverPendingPartner(storage, partnerFixtureId(903), [], NOW).entries).toEqual([]);
    expect(recoverPendingPartner(storage, USER, ["stato:1"], NOW).entries).toEqual([]);
    clearPendingPartner(storage, USER, "stato:1");
    expect(recoverPendingPartner(storage, USER, [], NOW).entries).toEqual([]);
    expect(storage.store.size).toBe(1);
  });

  it("voci illeggibili segnalate, mai ripetute", () => {
    const storage = memoryStorage();
    storage.setItem(`${pendingPartnerPrefix(USER)}rotto`, "{non json");
    storage.setItem(
      `${pendingPartnerPrefix(USER)}manomesso`,
      JSON.stringify({ kind: "set_partner_state", operationId: "x", payload: {} }),
    );
    expect(recoverPendingPartner(storage, USER, [], NOW)).toEqual({
      entries: [],
      unreadable: true,
    });
  });

  it("un invio di ieri resta ripetibile oggi", () => {
    const storage = memoryStorage();
    storePendingPartner(storage, USER, "registro:1", activityCommand);
    const tomorrow = new Date("2026-10-23T10:00:00Z");
    expect(recoverPendingPartner(storage, USER, [], tomorrow).entries).toHaveLength(1);
  });

  it("storage assente o bloccato: niente eccezioni", () => {
    const blocked = {
      get length(): number {
        throw new Error("bloccato");
      },
      key: () => null,
      getItem: () => null,
      setItem: () => {
        throw new Error("pieno");
      },
      removeItem: () => {
        throw new Error("bloccato");
      },
    };
    expect(storePendingPartner(blocked, USER, "x", stateCommand)).toBe(false);
    expect(storePendingPartner(null, USER, "x", stateCommand)).toBe(false);
    expect(() => clearPendingPartner(blocked, USER, "x")).not.toThrow();
    expect(recoverPendingPartner(blocked, USER, [], NOW)).toEqual({
      entries: [],
      unreadable: true,
    });
    expect(recoverPendingPartner(undefined, USER, [], NOW)).toEqual({
      entries: [],
      unreadable: false,
    });
  });

  it("righe leggibili senza id né codici", () => {
    const lines = pendingPartnerLines(stateCommand, { co: 12, name: "Garage Sintetico" });
    expect(lines).toEqual(["Contatto: CO 012 · Garage Sintetico", "Stato: Ha risposto"]);
    expect(pendingPartnerLines(activityCommand, null)).toEqual([
      "Registro: Sollecito inviato",
      "Giorno: 21/10/2026",
    ]);
    for (const line of [...lines, ...pendingPartnerLines(activityCommand, null)])
      expect(line).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});
