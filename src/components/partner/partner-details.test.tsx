import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/* La scheda gira con componenti e comandi reali: gli hook hanno uno stato minimo,
 * mentre le sole Server Action sono sostituite per non chiamare servizi esterni. */
const mocks = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  contexts: [] as { context: unknown; value: unknown }[],
  transitions: [] as Promise<unknown>[],
  setContact: vi.fn(),
  setState: vi.fn(),
  setPriority: vi.fn(),
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
vi.mock("next/link", () => ({
  default: ({ href, children, className }: Record<string, unknown>) => ({
    type: "a",
    props: { href, children, className },
  }),
}));
vi.mock("../../app/(workspace)/partner/actions", () => ({
  setPartnerState: mocks.setState,
  savePartner: mocks.other,
  recordPartnerActivity: mocks.other,
  savePartnerMessage: mocks.other,
  restorePartnerMessage: mocks.other,
  savePartnerContact: mocks.other,
  removePartnerContact: mocks.other,
  setPartnerDoNotContact: mocks.other,
  resolvePartnerDifference: mocks.other,
  setPartnerAssistantMode: mocks.other,
  setPartnerAssistantContact: mocks.setContact,
  savePartnerAssistantRules: mocks.other,
  startPartnerAssistantTest: mocks.other,
  confirmPartnerAssistantTest: mocks.other,
  setPartnerAssistantSendPriority: mocks.setPriority,
  resumePartnerAssistantSend: mocks.other,
  setPartnerAssistantSettings: mocks.other,
}));
vi.mock("../../app/(workspace)/partner/dati/actions", () => ({
  importPartnerDeviceFile: mocks.other,
  previewPartnerDeviceFile: mocks.other,
}));

import { PartnerDetails } from "./partner-details";
import { PartnerProvider } from "./partner-context";
import {
  PARTNER_FIXTURE_MEMBER_ID,
  partnerFixtureDetail,
  partnerFixtureWorkspace,
} from "../../lib/partner/fixtures";
import type { PartnerDetail } from "../../lib/partner/model";
import type { PartnerWorkReply } from "../../lib/partner/work";

type Element = ReactElement<Record<string, unknown>>;

const TODAY = "2026-10-22";
const OPERATION = "93000000-0000-4000-8000-000000000001";
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

/** La scheda completa conserva moduli e registro reali; sono sostituiti solo hook e server. */
function render(
  co: number,
  options: {
    change?: (detail: PartnerDetail) => PartnerDetail;
    latestReply?: PartnerWorkReply | null;
    preview?: boolean;
  } = {},
) {
  mocks.index = 0;
  mocks.contexts = [];
  const original = partnerFixtureDetail(co, TODAY)!;
  const detail = options.change ? options.change(original) : original;
  const summary = { ...workspace.partners.find((item) => item.co === co)!, ...detail.partner };
  const preview = options.preview ?? false;
  return expand(
    <PartnerProvider
      preview={preview}
      userId={preview ? null : PARTNER_FIXTURE_MEMBER_ID}
      founder={false}
      today={TODAY}
      members={workspace.members}
      partners={workspace.partners}
    >
      <PartnerDetails
        detail={detail}
        summary={summary}
        block={null}
        latestReply={options.latestReply}
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
beforeEach(() => {
  vi.clearAllMocks();
  mocks.states = [];
  mocks.transitions = [];
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => OPERATION) });
  for (const action of [mocks.setContact, mocks.setPriority, mocks.setState])
    action.mockResolvedValue({
      status: "uncertain",
      message: "Esito sintetico da verificare",
    });
});
afterEach(async () => {
  await Promise.all(mocks.transitions);
  vi.unstubAllGlobals();
});

// Esclude il contenuto chiuso dei details, conservando il summary raggiungibile.
function visible(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(visible);
  if (!node || typeof node !== "object" || !("props" in node)) return node;
  const element = node as Element;
  const children =
    element.type === "details" && !element.props.open
      ? descendants(element.props.children).find((child) => child.type === "summary")
      : element.props.children;
  return { ...element, props: { ...element.props, children: visible(children) } };
}

function disclosure(tree: unknown, label: string) {
  return descendants(tree).find(
    (node) =>
      node.type === "details" &&
      descendants(node).some((child) => child.type === "summary" && words(child) === label),
  );
}

function field(tree: unknown, label: string) {
  const wrapper = descendants(tree).find(
    (node) =>
      node.type === "label" &&
      descendants(node).some((child) => child.type === "span" && words(child) === label),
  );
  return descendants(wrapper).find((node) => node.type === "input" || node.type === "select")!;
}
const change = (node: Element, value: string) =>
  (node.props.onChange as (event: unknown) => void)({ target: { value } });

// Riportare la bozza sotto lo storico o chiuderla impedirebbe il lavoro corrente.
it("apre il contesto e la bozza prima del registro, lasciando i dati estesi consultabili", () => {
  const tree = render(2);
  const initial = words(visible(tree));
  const order = [
    "Raduno Sintetico Due",
    "Evento in circuito",
    "Raduno sintetico di prova",
    "Seguito da",
    "Bozza dell'email",
    "Registro",
  ].map((part) => initial.indexOf(part));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(initial).toContain("info@raduno-due.example.test");
  expect(initial).not.toContain("Iscrizioni espositori aperte");
  for (const label of ["Ricerca importata", "Recapiti", "Attenzione e fonti"]) {
    const item = disclosure(tree, label);
    expect(item, label).toBeDefined();
    expect(item!.props.open).toBeUndefined();
  }
  expect(words(disclosure(tree, "Ricerca importata"))).toContain("Iscrizioni espositori aperte");
  expect(words(disclosure(tree, "Recapiti"))).toContain("stampa@raduno-due.example.test");
  expect(words(disclosure(tree, "Attenzione e fonti"))).toContain(
    "raduno-due.example.test/programma",
  );
  expect(disclosure(tree, "Modifica la scheda")).toBeDefined();
  expect(disclosure(tree, "Metti tra i non contattare")).toBeDefined();
});

// Un'attività precedente importata dopo non deve coprire la risposta più recente.
it("mostra l'ultima risposta registrata prima della bozza e conserva il testo intero nel registro", () => {
  const source = partnerFixtureDetail(3, TODAY)!.activities.find(
    (activity) => activity.kind === "risposta",
  )!;
  const body = "Possiamo parlarne la prossima settimana. " + "Contesto sintetico. ".repeat(30);
  const tree = render(2, {
    latestReply: {
      ...source,
      partnerId: "70000000-0000-4000-8000-000000000002",
      kind: "risposta",
      occurredAt: "2026-10-19T10:00:00Z",
      body: "Risposta meno recente.",
    },
    change: (detail) => ({
      ...detail,
      activities: [
        {
          ...source,
          id: "risposta-precedente",
          partnerId: detail.partner.id,
          occurredAt: "2026-10-20T10:00:00Z",
          createdAt: "2026-10-22T10:00:00Z",
          body: "Risposta precedente.",
        },
        {
          ...source,
          id: "risposta-recente",
          partnerId: detail.partner.id,
          occurredAt: "2026-10-21T10:00:00Z",
          body,
        },
      ],
      activityCount: 2,
    }),
  });
  const latest = descendants(tree).find(
    (node) => node.props["aria-label"] === "Ultima risposta registrata",
  );
  expect(latest).toBeDefined();
  expect(words(latest)).toContain("21 ottobre");
  expect(words(latest)).toContain("Possiamo parlarne la prossima settimana.");
  expect(words(latest)).not.toContain("Risposta precedente");
  expect(words(visible(latest))).not.toContain(body.trim());
  expect(words(visible(tree)).indexOf("Ultima risposta registrata")).toBeLessThan(
    words(visible(tree)).indexOf("Bozza dell'email"),
  );
  expect(descendants(latest).find((node) => node.type === "a")?.props.href).toBe("#registro-2");
  expect(
    descendants(tree).filter((node) => node.type === "span" && text(node) === body),
  ).toHaveLength(1);
  expect(words(tree)).toContain("Risposta precedente.");
});

// Le ultime cento attività possono essere tutte note: il testo della risposta viene dal workspace.
it("conserva nella scheda la risposta completa anche quando è fuori dalla pagina del registro", () => {
  const body =
    "<strong>Risposta sintetica</strong> " +
    "Contesto sintetico. ".repeat(30) +
    "Parte finale conservata.";
  const tree = render(2, {
    latestReply: {
      id: "risposta-fuori-pagina",
      partnerId: "70000000-0000-4000-8000-000000000002",
      kind: "risposta",
      occurredAt: "2026-10-18T10:00:00Z",
      createdBy: PARTNER_FIXTURE_MEMBER_ID,
      origin: "team",
      channel: "email",
      body,
    },
    change: (detail) => ({ ...detail, activities: [], activityCount: 101 }),
  });
  const latest = descendants(tree).find(
    (node) => node.props["aria-label"] === "Ultima risposta registrata",
  );
  expect(latest).toBeDefined();
  expect(words(visible(latest))).toContain("18 ottobre");
  expect(words(visible(latest))).toContain("<strong>Risposta sintetica</strong>");
  expect(words(visible(latest))).not.toContain("Parte finale conservata.");
  const full = disclosure(latest, "Leggi risposta completa");
  expect(full).toBeDefined();
  expect(full!.props.open).toBeUndefined();
  const savedText = descendants(full).find((node) => node.type === "p" && text(node) === body);
  expect(savedText).toBeDefined();
  expect(savedText!.props.dangerouslySetInnerHTML).toBeUndefined();
  expect(descendants(full).some((node) => node.type === "strong")).toBe(false);
});

// Il salvataggio continua a usare lo stesso comando, rendendo visibile l'effetto prima del click.
it.each(["Seguito da", "Prossima azione"])(
  "avvisa prima di salvare %s su un contatto ancora seguito dall'assistente",
  (label) => {
    let tree = render(2);
    expect(words(visible(tree))).not.toContain(
      "esclude questo contatto dalle prime email automatiche",
    );
    change(
      field(tree, label),
      label === "Seguito da" ? PARTNER_FIXTURE_MEMBER_ID : "Richiamare il referente",
    );
    if (label === "Prossima azione") change(field(tree, "Giorno"), "2026-11-03");
    tree = render(2);
    const warning =
      "Salvare un responsabile o una prossima azione esclude questo contatto dalle prime email automatiche dell'assistente.";
    expect(words(visible(tree))).toContain(warning);
    const ownerForm = descendants(tree).find(
      (node) => node.type === "form" && words(node).includes("Seguito da"),
    )!;
    expect(words(ownerForm).indexOf(warning)).toBeLessThan(words(ownerForm).lastIndexOf("Salva"));
    (ownerForm.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    expect(mocks.setState).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "set_partner_state",
        payload: expect.objectContaining({ partner_id: "70000000-0000-4000-8000-000000000002" }),
      }),
    );
  },
);

it("non mostra l'avviso di esclusione per un assistente già fermo", () => {
  const options = {
    change: (detail: PartnerDetail) => ({
      ...detail,
      assistant:
        detail.assistant && typeof detail.assistant === "object"
          ? { ...detail.assistant, active: false }
          : detail.assistant,
    }),
  };
  let tree = render(2, options);
  change(field(tree, "Prossima azione"), "Richiamare il referente");
  tree = render(2, options);
  expect(words(visible(tree))).not.toContain(
    "esclude questo contatto dalle prime email automatiche",
  );
});

it("mantiene registro, modifica e blocco anche se lo stato dell'assistente non è leggibile", () => {
  const tree = render(2, { change: (detail) => ({ ...detail, assistant: null }) });
  expect(words(visible(tree))).toContain("Stato dell'assistente non leggibile");
  expect(words(visible(tree))).toContain("Registro");
  expect(disclosure(tree, "Modifica la scheda")).toBeDefined();
  expect(disclosure(tree, "Metti tra i non contattare")).toBeDefined();
});
