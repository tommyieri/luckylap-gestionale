import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/*
 * La striscia in cima a /partner (specifica dell'assistente Partner, «Interfaccia»), sul modello
 * di «Area aperta». Come in partner-assistant-view.test.tsx il componente gira senza DOM: gli
 * hook di React sono sostituiti da una versione minima e «Ferma l'assistente» arriva alla Server
 * Action vera di usePartnerCommand, sostituita da vi.fn().
 */
const mocks = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  contexts: [] as { context: unknown; value: unknown }[],
  transitions: [] as Promise<unknown>[],
  /** Comando in corso: useTransition lo dà come `pending`. */
  pending: false,
  setMode: vi.fn(),
  other: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = mocks.index++;
      if (!(index in mocks.states))
        mocks.states[index] =
          typeof initial === "function" ? (initial as () => unknown)() : initial;
      const set = (next: unknown) => {
        mocks.states[index] =
          typeof next === "function"
            ? (next as (value: unknown) => unknown)(mocks.states[index])
            : next;
      };
      return [mocks.states[index], set];
    },
    useEffect: () => {},
    useRef: (value: unknown) => ({ current: value }),
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useId: () => "campo",
    useTransition: () => [
      mocks.pending,
      (fn: () => unknown) => {
        mocks.transitions.push(Promise.resolve(fn()));
      },
    ],
    useContext: (context: unknown) =>
      mocks.contexts.findLast((entry) => entry.context === context)?.value,
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: Record<string, unknown>) => ({
    type: "a",
    props: { href, children, className },
  }),
}));
vi.mock("../../app/(workspace)/partner/actions", () => ({
  setPartnerState: mocks.other,
  savePartner: mocks.other,
  recordPartnerActivity: mocks.other,
  savePartnerMessage: mocks.other,
  restorePartnerMessage: mocks.other,
  savePartnerContact: mocks.other,
  removePartnerContact: mocks.other,
  setPartnerDoNotContact: mocks.other,
  resolvePartnerDifference: mocks.other,
  setPartnerAssistantMode: mocks.setMode,
  setPartnerAssistantContact: mocks.other,
  savePartnerAssistantRules: mocks.other,
}));
vi.mock("../../app/(workspace)/partner/dati/actions", () => ({
  importPartnerDeviceFile: mocks.other,
  previewPartnerDeviceFile: mocks.other,
}));

import { PartnerAssistantStrip } from "./partner-assistant-strip";
import { PartnerProvider } from "./partner-context";
import styles from "./partner.module.css";
import {
  PARTNER_ASSISTANT_INACTIVE,
  type PartnerAssistantStatus,
} from "../../lib/partner/assistant";
import { PARTNER_FIXTURE_MEMBER_ID, partnerAssistantFixture } from "../../lib/partner/fixtures";

type Element = ReactElement<Record<string, unknown>>;

const TODAY = "2026-10-22";
const OPERATION = "93000000-0000-4000-8000-000000000001";
const fixture = partnerAssistantFixture(TODAY).status;
const CONTEXT = Symbol.for("react.context");

function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !("props" in node)) return node;
  const element = node as Element;
  if (typeof element.type === "function")
    return expand((element.type as (props: unknown) => unknown)(element.props));
  const type = element.type as unknown as { $$typeof?: symbol; _context?: unknown } | null;
  const provider =
    typeof type === "object" &&
    type !== null &&
    (type.$$typeof === CONTEXT || type._context !== undefined);
  if (provider) mocks.contexts.push({ context: type._context ?? type, value: element.props.value });
  const children = expand(element.props.children);
  if (provider) mocks.contexts.pop();
  return { type: element.type, props: { ...element.props, children } };
}

/**
 * La striscia con lo stato sintetico cambiato; `null` è lo stato non leggibile,
 * PARTNER_ASSISTANT_INACTIVE l'assistente senza migrazioni.
 */
function render(
  status: Partial<PartnerAssistantStatus> | null | typeof PARTNER_ASSISTANT_INACTIVE = {},
  { preview = false }: { preview?: boolean } = {},
) {
  mocks.index = 0;
  mocks.contexts = [];
  return expand(
    <PartnerProvider
      preview={preview}
      userId={preview ? null : PARTNER_FIXTURE_MEMBER_ID}
      today={TODAY}
      members={[]}
      partners={[]}
    >
      <PartnerAssistantStrip
        status={
          status === null || status === PARTNER_ASSISTANT_INACTIVE
            ? status
            : { ...fixture, ...status }
        }
      />
    </PartnerProvider>,
  );
}

function descendants(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...descendants(element.props.children)];
}
const text = (node: unknown): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join("")
      : node && typeof node === "object" && "props" in node
        ? text((node as Element).props.children)
        : "";
const words = (node: unknown) => text(node).replace(/\s+/g, " ").trim();
const buttons = (tree: unknown) => descendants(tree).filter((node) => node.type === "button");
/** Il contenitore della striscia, con la sua classe del modulo CSS. */
const strip = (tree: unknown) => {
  const found = descendants(tree).filter((node) => node.props.className === styles.assistantStrip);
  expect(found).toHaveLength(1);
  return found[0];
};
/** La frase della striscia, senza il pulsante e il link. */
const sentence = (tree: unknown) =>
  words(descendants(strip(tree)).find((node) => node.type === "p"));
const stop = (tree: unknown) =>
  buttons(tree).filter((node) => text(node).trim() === "Ferma l'assistente");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.states = [];
  mocks.transitions = [];
  mocks.pending = false;
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => OPERATION) });
  mocks.setMode.mockResolvedValue({
    status: "uncertain",
    message: "Esito sintetico da verificare",
  });
});
afterEach(async () => {
  await Promise.all(mocks.transitions);
  vi.unstubAllGlobals();
});

describe("PartnerAssistantStrip", () => {
  it("in «Prepara»: modalità, bozze pronte e spesa in una riga, fondo normale", () => {
    const tree = render({ spentUsd: 21.4, counts: { ...fixture.counts, pronta: 12 } });
    expect(sentence(tree)).toBe("Assistente: prepara · 12 bozze pronte · 21,40 USD spesi");
    expect(strip(tree).props["data-attention"]).toBeUndefined();
    expect(stop(tree)).toHaveLength(1);
    expect(stop(tree)[0].props.disabled).toBe(false);
    // Una bozza sola si legge al singolare.
    expect(sentence(render({ counts: { ...fixture.counts, pronta: 1 } }))).toContain(
      "1 bozza pronta ·",
    );
  });

  it("«Ferma l'assistente» manda «spento» con la versione letta", () => {
    const [button] = stop(render({ version: 7 }));
    (button.props.onClick as () => void)();
    expect(mocks.setMode).toHaveBeenCalledExactlyOnceWith({
      kind: "set_partner_assistant_mode",
      operationId: OPERATION,
      payload: { schema_version: 1, mode: "spento", expected_version: 7 },
      retry: false,
    });
    expect(mocks.other).not.toHaveBeenCalled();
  });

  it("mentre «Ferma l'assistente» è in corso il pulsante dice «Fermo…» ed è spento", () => {
    mocks.pending = true;
    const tree = render();
    const waiting = buttons(tree).filter((node) => text(node).trim() === "Fermo…");
    expect(waiting).toHaveLength(1);
    expect(waiting[0].props.disabled).toBe(true);
    expect(stop(tree)).toEqual([]);
  });

  it("migrazioni non ancora applicate: nessuna striscia, nessun avviso", () => {
    const tree = render(PARTNER_ASSISTANT_INACTIVE);
    expect(descendants(tree).some((node) => typeof node.type === "string")).toBe(false);
    expect(words(tree)).toBe("");
  });

  it("«Spento»: fondo ambra con la parola scritta e nessun pulsante per fermarlo", () => {
    const tree = render({ mode: "spento" });
    expect(sentence(tree)).toMatch(/^Assistente: spento · /);
    expect(strip(tree).props["data-attention"]).toBe(true);
    expect(stop(tree)).toEqual([]);
  });

  it("in pausa: fondo ambra con il motivo scritto, «Ferma l'assistente» resta", () => {
    const credit = render({ pausedReason: "credito" });
    expect(sentence(credit)).toBe(
      "Assistente: prepara · in pausa per credito finito · 1 bozza pronta · 1,37 USD spesi",
    );
    expect(strip(credit).props["data-attention"]).toBe(true);
    expect(stop(credit)).toHaveLength(1);
    const claude = render({ pausedReason: "errore_claude" });
    expect(sentence(claude)).toContain("in pausa per un errore di Claude");
    expect(strip(claude).props["data-attention"]).toBe(true);
  });

  it("non configurato: lo dice, sul fondo ambra", () => {
    const tree = render({ mode: "spento", configured: false });
    expect(sentence(tree)).toContain("non ancora configurato");
    expect(strip(tree).props["data-attention"]).toBe(true);
  });

  it("stato non leggibile: fondo ambra, la frase scritta e nessun comando", () => {
    const tree = render(null);
    expect(sentence(tree)).toBe(
      "Stato dell'assistente non leggibile: ricarica la pagina tra poco.",
    );
    expect(strip(tree).props["data-attention"]).toBe(true);
    expect(buttons(tree)).toEqual([]);
  });

  it("il fondo ambra viene dal modulo CSS, con amber-wash", () => {
    const css = readFileSync(join(__dirname, "partner.module.css"), "utf8");
    const rule = /\.assistantStrip\[data-attention\]\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toContain("background: var(--amber-wash)");
  });

  it("link alla pagina dell'assistente; niente <main>, niente link per scrivere o indietro", () => {
    for (const tree of [render(), render(null), render({ mode: "spento" })]) {
      const links = descendants(tree).filter((node) => node.type === "a");
      expect(links.map((node) => [node.props.href, words(node)])).toEqual([
        ["/partner/assistente", "Apri l'assistente"],
      ]);
      expect(descendants(tree).some((node) => node.type === "main")).toBe(false);
      expect(words(tree)).not.toMatch(/Torna|mailto:|tel:/);
    }
  });

  it("in anteprima il pulsante è spento e niente arriva al server", () => {
    const options = { preview: true };
    const [button] = stop(render({}, options));
    expect(button.props.disabled).toBe(true);
    (button.props.onClick as () => void)();
    expect(mocks.setMode).not.toHaveBeenCalled();
  });
});
