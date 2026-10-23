import { describe, expect, it } from "vitest";
import { acknowledgePartnerWork, preservePartnerWork, readPendingPartnerWork } from "./pending";
const actorId = "10000000-0000-4000-8000-000000000001",
  partnerId = "20000000-0000-4000-8000-000000000001",
  operationId = "30000000-0000-4000-8000-000000000001";
const command = {
  operationId,
  actorId,
  payload: { schema_version: 1 as const, kind: "project" as const, partner_id: partnerId },
};
function storage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}
describe("tentativi Partner congelati per attore", () => {
  it("conserva prima dell’invio e permette soltanto il retry dello stesso payload", () => {
    const store = storage();
    preservePartnerWork(store, actorId, command);
    expect(readPendingPartnerWork(store, actorId)).toEqual(command);
    expect(preservePartnerWork(store, actorId, { ...command, retry: true })).toEqual({
      ...command,
      retry: true,
    });
    expect(() =>
      preservePartnerWork(store, actorId, { ...command, operationId: partnerId }),
    ).toThrow();
    expect(readPendingPartnerWork(store, actorId)).toEqual(command);
  });
  it("separa gli account e non libera un tentativo per una ricevuta differente", () => {
    const store = storage();
    preservePartnerWork(store, actorId, command);
    expect(readPendingPartnerWork(store, partnerId)).toBeNull();
    expect(() => preservePartnerWork(store, partnerId, command)).toThrow();
    const receipt = {
      actorId,
      operationId,
      partnerId,
      kind: "project" as const,
      targetId: partnerId,
      replayed: true,
    };
    expect(() =>
      acknowledgePartnerWork(store, actorId, { ...receipt, operationId: partnerId }),
    ).toThrow();
    expect(store.map.size).toBe(1);
    acknowledgePartnerWork(store, actorId, receipt);
    expect(store.map.size).toBe(0);
  });
  it("mantiene i tentativi illeggibili senza cancellarli silenziosamente", () => {
    const store = storage();
    preservePartnerWork(store, actorId, command);
    const key = [...store.map.keys()][0];
    store.setItem(key, "not json");
    expect(() => readPendingPartnerWork(store, actorId)).toThrow();
    expect(store.getItem(key)).toBe("not json");
  });
});
