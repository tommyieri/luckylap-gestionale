import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../app/consignment/actions", () => ({
  runShopCommand: vi.fn(),
  runConsignmentCommand: vi.fn(),
}));

import {
  createShopSender,
  legacyAttemptSummary,
  PREVIEW_NOTICE,
  readStoredAttempt,
  ShopCommandsProvider,
  ShopPendingSlot,
} from "./consignment-pending";
import { parseShopCommand, shopPendingKey, type ShopResult } from "../lib/consignment/shop-model";
import { consignmentPendingKey, parseConsignmentCommand } from "../lib/consignment/model";
import { shopCommands, sx } from "../lib/consignment/shop-fixtures";

const KEY = shopPendingKey(sx.user);
const command = () => parseShopCommand(shopCommands.count())!;
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    removeItem: vi.fn((k: string) => void data.delete(k)),
  };
}
const success: ShopResult = {
  status: "success",
  kind: "count_consignment_stock",
  operationId: sx.operation,
  replayed: false,
  message: "Conta salvata: 4 magliette contate.",
  target: { pieces: 4 },
};

describe("invio con blocco sincrono", () => {
  it("due invii prima della risposta: un solo UUID e una sola richiesta", async () => {
    const storage = memoryStorage();
    let resolve!: (r: ShopResult) => void;
    const run = vi.fn(() => new Promise<ShopResult>((done) => (resolve = done)));
    const sender = createShopSender(KEY, () => storage, run);
    const first = sender.send(command());
    const second = await sender.send({ ...command(), operationId: crypto.randomUUID() });
    expect(second).toBeNull();
    expect(sender.isBusy()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.data.get(KEY)!).operationId).toBe(sx.operation);
    resolve(success);
    expect(await first).toEqual({ result: success, kept: false });
    expect(storage.data.has(KEY)).toBe(false);
    expect(sender.isBusy()).toBe(false);
  });

  it("congela il comando prima della richiesta, senza il segno di verifica", async () => {
    const storage = memoryStorage();
    const run = vi.fn(async () => {
      expect(storage.setItem).toHaveBeenCalledTimes(1);
      return success;
    });
    await createShopSender(KEY, () => storage, run).send({ ...command(), retry: true });
    const frozen = JSON.parse(storage.setItem.mock.calls[0][1]);
    expect(frozen).not.toHaveProperty("retry");
    expect(parseShopCommand(frozen)).toEqual(command());
    expect(run).toHaveBeenCalledWith({ ...command(), retry: true });
  });

  it("esito incerto o in conflitto: il tentativo resta conservato", async () => {
    for (const result of [
      { status: "uncertain", message: "Esito non confermato." },
      { status: "rejected", code: "idempotency_conflict", message: "Conflitto." },
    ] as ShopResult[]) {
      const storage = memoryStorage();
      const outcome = await createShopSender(
        KEY,
        () => storage,
        async () => result,
      ).send(command());
      expect(outcome).toEqual({ result, kept: true });
      expect(storage.data.has(KEY)).toBe(true);
    }
  });

  it("una connessione interrotta diventa un esito incerto conservato", async () => {
    const storage = memoryStorage();
    const outcome = await createShopSender(
      KEY,
      () => storage,
      async () => {
        throw Error("rete");
      },
    ).send(command());
    expect(outcome?.result.status).toBe("uncertain");
    expect(outcome?.kept).toBe(true);
  });

  it("un rifiuto vero libera il modulo", async () => {
    const storage = memoryStorage();
    const result: ShopResult = {
      status: "rejected",
      code: "stock_changed",
      message: "Nel frattempo la giacenza è cambiata.",
    };
    const outcome = await createShopSender(
      KEY,
      () => storage,
      async () => result,
    ).send(command());
    expect(outcome).toEqual({ result, kept: false });
    expect(storage.data.has(KEY)).toBe(false);
  });

  it("senza sessionStorage nessun invio parte", async () => {
    const run = vi.fn();
    const outcome = await createShopSender(
      KEY,
      () => ({
        setItem: () => {
          throw Error("quota");
        },
        removeItem: () => {},
      }),
      run,
    ).send(command());
    expect(run).not.toHaveBeenCalled();
    expect(outcome?.result).toMatchObject({ status: "rejected", code: "storage" });
  });
});

describe("tentativo conservato", () => {
  const legacy = parseConsignmentCommand({
    operationId: sx.operation,
    kind: "transfer_consignment_stock",
    payload: {
      schema_version: 1,
      stock_item_id: sx.shop,
      from_location_id: sx.central,
      to_location_id: sx.shop2,
      quantity: 2,
      reason: "Spostamento sintetico",
      occurred_at: "2026-10-21T10:00:00.000Z",
    },
  })!;

  it("legge prima la chiave nuova, poi quella vecchia", () => {
    expect(readStoredAttempt(memoryStorage(), sx.user)).toBeNull();
    const both = memoryStorage({
      [KEY]: JSON.stringify(command()),
      [consignmentPendingKey(sx.user)]: JSON.stringify(legacy),
    });
    expect(readStoredAttempt(both, sx.user)).toEqual({
      kind: "shop",
      command: command(),
      blocked: false,
    });
    const old = memoryStorage({ [consignmentPendingKey(sx.user)]: JSON.stringify(legacy) });
    expect(readStoredAttempt(old, sx.user)).toEqual({
      kind: "legacy",
      command: legacy,
      blocked: false,
    });
  });

  it("un tentativo illeggibile blocca e si può solo scartare", () => {
    for (const storage of [
      memoryStorage({ [KEY]: "{non json" }),
      memoryStorage({ [consignmentPendingKey(sx.user)]: '{"kind":"altro"}' }),
    ])
      expect(readStoredAttempt(storage, sx.user)).toEqual({
        kind: "unreadable",
        keys: [KEY, consignmentPendingKey(sx.user)],
      });
  });

  it("riassume i comandi vecchi con le parole di oggi, senza codici", () => {
    const summary = legacyAttemptSummary(legacy, () => "GT3RS Blu M");
    expect(summary).toEqual({
      title: "Spostamento di magliette da verificare",
      lines: ["GT3RS Blu M · 2 magliette"],
      occurredAt: "2026-10-21T10:00:00.000Z",
    });
    const text = JSON.stringify(summary);
    expect(text).not.toContain(sx.operation);
    expect(text).not.toMatch(/affido|rientro|regolament/i);
  });
});

describe("cornice degli invii", () => {
  it("in anteprima mostra l'avviso e nessun tentativo", () => {
    const html = renderToStaticMarkup(
      <ShopCommandsProvider userId={sx.user} preview>
        <ShopPendingSlot />
      </ShopCommandsProvider>,
    );
    expect(html).toContain(PREVIEW_NOTICE);
    expect(html).toContain('role="status"');
  });

  it("fuori dall'anteprima, prima della lettura, non mostra niente", () => {
    const html = renderToStaticMarkup(
      <ShopCommandsProvider userId={sx.user}>
        <ShopPendingSlot />
      </ShopCommandsProvider>,
    );
    expect(html).toBe("");
  });
});
