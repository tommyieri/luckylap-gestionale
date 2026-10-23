import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  /** «server»: lo snapshot del server (nessuno storage); «client»: quello del browser. */
  side: "client" as "client" | "server",
  closed: false,
  setClosed: vi.fn(),
  focus: vi.fn(),
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: () => [mocks.closed, mocks.setClosed],
  useSyncExternalStore: (_subscribe: unknown, client: () => unknown, server: () => unknown) =>
    mocks.side === "server" ? server() : client(),
}));
import { GuideIntro, guideIntroKey, guideIntroSeen, rememberGuideIntro } from "./guide-intro";

type Element = ReactElement<Record<string, unknown>>;
const userId = "00000000-0000-4000-8000-000000000001";
const key = `luckylap-guida-vista-v1:${userId}`;

const descendants = (node: unknown): Element[] => {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...[element.props.children].flat(Infinity).flatMap(descendants)];
};
const text = (node: unknown): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join(" ")
      : node && typeof node === "object" && "props" in node
        ? text((node as Element).props.children)
        : "";
const button = (tree: unknown) => descendants(tree).find((node) => node.type === "button")!;

let store: Map<string, string>;
const storage = () => ({
  getItem: vi.fn((name: string) => store.get(name) ?? null),
  setItem: vi.fn((name: string, value: string) => void store.set(name, value)),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.side = "client";
  mocks.closed = false;
  store = new Map();
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("document", { getElementById: () => ({ focus: mocks.focus }) });
});
afterEach(() => vi.unstubAllGlobals());

describe("«Prima volta qui?» su Oggi", () => {
  it("la chiave è per persona, come nella spec", () => {
    expect(guideIntroKey(userId)).toBe(key);
    expect(guideIntroKey("anteprima")).toBe("luckylap-guida-vista-v1:anteprima");
  });

  it("chi non l'ha chiuso vede l'invito alla guida, con il link e «Ho capito»", () => {
    const tree = GuideIntro({ userId });
    const copy = text(tree).replace(/\s+/g, " ");
    expect(copy).toContain("Prima volta qui?");
    expect(copy).toContain("Leggi «Come si usa»");
    expect(copy).toContain("Bastano due minuti.");
    expect(copy).toContain("Ho capito");
    const link = descendants(tree).find((node) => node.props.href === "/guida");
    expect(link?.props.prefetch).toBe(false);
    expect(text(link)).toBe("Apri «Come si usa»");
    expect(button(tree).props.type).toBe("button");
    expect(copy).not.toMatch(/localStorage|storage|chiave|RLS|UUID/i);
  });

  it("sul server non compare: chi l'ha già chiuso non lo vede lampeggiare", () => {
    mocks.side = "server";
    expect(GuideIntro({ userId })).toBeNull();
    expect(localStorage.getItem).not.toHaveBeenCalled();
  });

  it("dopo «Ho capito» non compare più per quella persona, ma sì per un'altra", () => {
    store.set(key, "1");
    expect(GuideIntro({ userId })).toBeNull();
    expect(GuideIntro({ userId: "00000000-0000-4000-8000-000000000002" })).not.toBeNull();
    mocks.closed = true;
    expect(GuideIntro({ userId: "00000000-0000-4000-8000-000000000002" })).toBeNull();
  });

  it("«Ho capito» lo ricorda nel browser, lo chiude e porta il focus al contenuto", () => {
    (button(GuideIntro({ userId })).props.onClick as () => void)();
    expect(localStorage.setItem).toHaveBeenCalledExactlyOnceWith(key, "1");
    expect(store.get(key)).toBe("1");
    expect(mocks.setClosed).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it("senza storage resta visibile e «Ho capito» lo chiude lo stesso", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    const tree = GuideIntro({ userId });
    expect(text(tree)).toContain("Prima volta qui?");
    expect(() => (button(tree).props.onClick as () => void)()).not.toThrow();
    expect(mocks.setClosed).toHaveBeenCalledWith(true);
  });

  it("legge e scrive con try/catch anche quando il browser nega lo storage", () => {
    expect(guideIntroSeen(key, null)).toBe(false);
    expect(() => rememberGuideIntro(key, null)).not.toThrow();
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      expect(guideIntroSeen(key)).toBe(false);
      expect(() => rememberGuideIntro(key)).not.toThrow();
      expect(text(GuideIntro({ userId }))).toContain("Prima volta qui?");
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
    const own = storage();
    rememberGuideIntro(key, own);
    expect(guideIntroSeen(key, own)).toBe(true);
    expect(guideIntroSeen(`${key}-altro`, own)).toBe(false);
  });
});
