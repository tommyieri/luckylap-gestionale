import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/*
 * Il Registro della scheda (spec 02 §5.7). Dal 31 ottobre 2026 «Segna inviato» e «Segna sollecito
 * inviato» stanno qui, per ogni contatto: il vecchio blocco «Messaggi pronti» non è più montato.
 * Come in partner-assistant-block.test.tsx il componente gira senza DOM: gli hook di React sono
 * sostituiti da una versione minima e «Registra» arriva alla Server Action vera di
 * usePartnerCommand, sostituita da vi.fn(). Solo i contatti sintetici di fixtures.ts.
 */
const mocks = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  contexts: [] as { context: unknown; value: unknown }[],
  transitions: [] as Promise<unknown>[],
  record: vi.fn(),
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
      false,
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
vi.mock("../../app/(workspace)/partner/actions", () => ({
  setPartnerState: mocks.other,
  savePartner: mocks.other,
  recordPartnerActivity: mocks.record,
  savePartnerMessage: mocks.other,
  restorePartnerMessage: mocks.other,
  savePartnerContact: mocks.other,
  removePartnerContact: mocks.other,
  setPartnerDoNotContact: mocks.other,
  resolvePartnerDifference: mocks.other,
  setPartnerAssistantMode: mocks.other,
  setPartnerAssistantContact: mocks.other,
  savePartnerAssistantRules: mocks.other,
  startPartnerAssistantTest: mocks.other,
  confirmPartnerAssistantTest: mocks.other,
  setPartnerAssistantSendPriority: mocks.other,
  resumePartnerAssistantSend: mocks.other,
  setPartnerAssistantSettings: mocks.other,
}));
vi.mock("../../app/(workspace)/partner/dati/actions", () => ({
  importPartnerDeviceFile: mocks.other,
  previewPartnerDeviceFile: mocks.other,
}));

import { PartnerActivityLog } from "./partner-activity";
import { PartnerProvider } from "./partner-context";
import {
  PARTNER_FIXTURE_MEMBER_ID,
  partnerFixtureDetail,
  partnerFixtureId,
  partnerFixtureWorkspace,
} from "../../lib/partner/fixtures";

type Element = ReactElement<Record<string, unknown>>;

const TODAY = "2026-10-22";
const OPERATION = "93000000-0000-4000-8000-000000000002";
const CONTEXT = Symbol.for("react.context");
const workspace = partnerFixtureWorkspace(TODAY);

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

/** Il Registro del contatto `co` come lo passa la scheda; lo stato resta tra una resa e l'altra. */
function render(co: number, blocked = false) {
  mocks.index = 0;
  mocks.contexts = [];
  const detail = partnerFixtureDetail(co, TODAY)!;
  return expand(
    <PartnerProvider
      preview={false}
      userId={PARTNER_FIXTURE_MEMBER_ID}
      today={TODAY}
      members={workspace.members}
      partners={workspace.partners}
    >
      <PartnerActivityLog detail={detail} blocked={blocked} />
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
const buttons = (tree: unknown) => descendants(tree).filter((node) => node.type === "button");
const button = (tree: unknown, label: string) => {
  const found = buttons(tree).filter((node) => text(node).trim() === label);
  expect(found, label).toHaveLength(1);
  return found[0];
};
const click = (node: Element) => (node.props.onClick as () => void)();
/** Apre il modulo del pulsante `label`, poi preme «Registra». */
function registra(co: number, label: string) {
  click(button(render(co), label));
  const forms = descendants(render(co)).filter((node) => node.type === "form");
  expect(forms, label).toHaveLength(1);
  (forms[0].props.onSubmit as (event: { preventDefault: () => void }) => void)({
    preventDefault: () => {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.states = [];
  mocks.transitions = [];
  // Dopo i giorni delle attività sintetiche: nessun invio «degli ultimi 10 minuti» da confermare.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T09:00:00Z"));
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => OPERATION) });
  mocks.record.mockResolvedValue({ status: "uncertain", message: "Esito sintetico da verificare" });
});
afterEach(async () => {
  await Promise.all(mocks.transitions);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PartnerActivityLog", () => {
  it("«Segna inviato» e «Segna sollecito inviato» per un contatto con varianti, in testa", () => {
    // CO 1 ha due varianti della vecchia ricerca: i pulsanti ci sono lo stesso.
    expect(partnerFixtureDetail(1, TODAY)!.variants.length).toBeGreaterThan(1);
    for (const co of [1, 3]) {
      const labels = buttons(render(co)).map((node) => text(node).trim());
      expect(labels, String(co)).toEqual([
        "Segna inviato",
        "Segna sollecito inviato",
        "Ha risposto",
        "Chiamata",
        "Incontro",
        "Nota",
      ]);
    }
  });

  it("«Segna sollecito inviato» registra un invio di tipo sollecito", () => {
    registra(1, "Segna sollecito inviato");
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith({
      kind: "record_partner_activity",
      operationId: OPERATION,
      payload: expect.objectContaining({
        schema_version: 1,
        partner_id: partnerFixtureId(1),
        kind: "inviato",
        message_kind: "sollecito",
      }),
      retry: false,
    });
    expect(mocks.other).not.toHaveBeenCalled();
  });

  it("«Segna inviato» registra il primo invio", () => {
    registra(1, "Segna inviato");
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: "record_partner_activity",
        payload: expect.objectContaining({
          partner_id: partnerFixtureId(1),
          kind: "inviato",
          message_kind: "primo",
        }),
      }),
    );
  });

  it("gli altri pulsanti non mandano un tipo di messaggio", () => {
    registra(1, "Chiamata");
    const [command] = mocks.record.mock.calls[0] as [{ payload: Record<string, unknown> }];
    expect(command.payload.kind).toBe("chiamata");
    expect(command.payload).not.toHaveProperty("message_kind");
  });

  it("«Non contattare»: i due invii sono spenti come «Chiamata» e «Incontro»", () => {
    const tree = render(4, true);
    for (const label of ["Segna inviato", "Segna sollecito inviato", "Chiamata", "Incontro"])
      expect(button(tree, label).props.disabled, label).toBe(true);
    for (const label of ["Ha risposto", "Nota"])
      expect(button(tree, label).props.disabled, label).toBe(false);
  });
});
