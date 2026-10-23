import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  lockArea: vi.fn(),
  unlockArea: vi.fn(),
  state: {} as { error?: string },
  pending: false,
  bound: [] as unknown[],
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useActionState: (action: unknown) => {
    mocks.bound.push(action);
    return [mocks.state, action, mocks.pending];
  },
}));
vi.mock("@/app/auth/area/[area]/actions", () => ({
  lockArea: mocks.lockArea,
  unlockArea: mocks.unlockArea,
}));
import {
  AREA_LOCK_LABEL,
  SensitiveAreaLockForm,
  SensitiveAreaSessionBar,
} from "./auth-sensitive-area-form";

type Element = ReactElement<Record<string, unknown>>;
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = {};
  mocks.pending = false;
  mocks.bound = [];
});

describe("chiusura delle aree con password (06 R12)", () => {
  it("il pulsante ha lo stesso nome nella striscia e nel modulo di account e area", () => {
    expect(AREA_LOCK_LABEL).toEqual({
      finance: "Chiudi Finance",
      audit: "Chiudi Controllo CEO",
    });
    expect(text(button(SensitiveAreaLockForm({ area: "finance" })))).toBe("Chiudi Finance");
    expect(text(button(SensitiveAreaLockForm({ area: "audit" })))).toBe("Chiudi Controllo CEO");
    const all = text(SensitiveAreaLockForm({ area: "audit" }));
    expect(all).not.toContain("in questa sessione");
    expect(all).not.toContain("Chiudi CEO");
  });

  it.each([
    ["finance", "Finance aperta su questo dispositivo", "Chiudi Finance"],
    ["audit", "Controllo CEO aperto su questo dispositivo", "Chiudi Controllo CEO"],
  ] as const)("in %s la striscia dice che l'area è aperta e la chiude", (area, open, label) => {
    const tree = SensitiveAreaSessionBar({ area });
    expect(text(tree)).toContain(open);
    expect(text(tree)).toContain("fino a 8 ore dall’apertura");
    expect(text(button(tree))).toBe(label);
    expect(button(tree).props.disabled).toBe(false);
    expect((tree as Element).type).toBe("form");
    expect((tree as Element).props.action).toBe(mocks.bound[0]);
  });

  it("chiama la stessa azione di «Account e sicurezza», legata all'area giusta", async () => {
    SensitiveAreaSessionBar({ area: "audit" });
    await (mocks.bound[0] as (state: object) => Promise<unknown>)({});
    expect(mocks.lockArea).toHaveBeenCalledExactlyOnceWith("audit", {});
  });

  it("durante la chiusura il pulsante è spento e lo dice", () => {
    mocks.pending = true;
    const tree = SensitiveAreaSessionBar({ area: "finance" });
    expect(text(button(tree))).toBe("Chiusura in corso…");
    expect(button(tree).props.disabled).toBe(true);
  });

  it("un errore della chiusura compare come avviso, in italiano", () => {
    mocks.state = { error: "Chiusura temporaneamente non disponibile. Riprova tra poco." };
    const alert = descendants(SensitiveAreaSessionBar({ area: "finance" })).find(
      (node) => node.props.role === "alert",
    );
    expect(text(alert)).toBe("Chiusura temporaneamente non disponibile. Riprova tra poco.");
  });

  it("in anteprima locale il pulsante è spento e il testo non finge un'area aperta", () => {
    const tree = SensitiveAreaSessionBar({ area: "finance", preview: true });
    expect(button(tree).props.disabled).toBe(true);
    expect(text(button(tree))).toBe("Chiudi Finance");
    expect(text(tree)).toContain("Anteprima locale: la chiusura di Finance è disattivata.");
    expect(text(tree)).not.toContain("aperta su questo dispositivo");
  });
});
