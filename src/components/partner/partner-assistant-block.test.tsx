import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/*
 * Il blocco «Assistente» nella scheda del contatto (specifica dell'assistente Partner,
 * «Interfaccia»). Come in partner-assistant-view.test.tsx il componente gira senza DOM: gli hook
 * di React sono sostituiti da una versione minima e l'interruttore arriva alla Server Action vera
 * di usePartnerCommand, sostituita da vi.fn(). I contatti sono quelli sintetici di fixtures.ts:
 * 1 passato a Tommi e seguito da Ada, 2 con la bozza pronta, 3 senza lavoro, 4 con l'assistente
 * fermo e in «Non contattare», 5 tolto dalla ricerca e senza email.
 */
const mocks = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  contexts: [] as { context: unknown; value: unknown }[],
  transitions: [] as Promise<unknown>[],
  setContact: vi.fn(),
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
  setPartnerState: mocks.other,
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
}));
vi.mock("../../app/(workspace)/partner/dati/actions", () => ({
  importPartnerDeviceFile: mocks.other,
  previewPartnerDeviceFile: mocks.other,
}));

import { PartnerAssistantBlock } from "./partner-assistant-block";
import { PartnerProvider } from "./partner-context";
import styles from "./partner.module.css";
import type { PartnerAssistantContactView } from "../../lib/partner/assistant";
import {
  PARTNER_FIXTURE_MEMBER_ID,
  partnerFixtureDetail,
  partnerFixtureId,
  partnerFixtureWorkspace,
} from "../../lib/partner/fixtures";
import type { PartnerSummary } from "../../lib/partner/model";

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

/** Il blocco del contatto `co` come lo passa la scheda; `assistant` cambia la vista letta. */
function render(
  co: number,
  options: {
    assistant?: (view: PartnerAssistantContactView) => PartnerAssistantContactView | null;
    partner?: Partial<PartnerSummary>;
    preview?: boolean;
  } = {},
) {
  mocks.index = 0;
  mocks.contexts = [];
  const detail = partnerFixtureDetail(co, TODAY)!;
  const partner = { ...workspace.partners.find((item) => item.co === co)!, ...options.partner };
  const assistant = options.assistant ? options.assistant(detail.assistant!) : detail.assistant;
  const preview = options.preview ?? false;
  return expand(
    <PartnerProvider
      preview={preview}
      userId={preview ? null : PARTNER_FIXTURE_MEMBER_ID}
      today={TODAY}
      members={workspace.members}
      partners={workspace.partners}
    >
      <PartnerAssistantBlock
        partner={partner}
        assistant={assistant}
        blocked={detail.blocks.length > 0}
        contacts={detail.contacts}
        activities={detail.activities}
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
const button = (tree: unknown, label: string) => {
  const found = buttons(tree).filter((node) => text(node).trim() === label);
  expect(found, label).toHaveLength(1);
  return found[0];
};
/** Il paragrafo che contiene questo testo. */
const paragraph = (tree: unknown, fragment: string) => {
  const found = descendants(tree).filter(
    (node) => node.type === "p" && words(node).includes(fragment),
  );
  expect(found, fragment).toHaveLength(1);
  return found[0];
};
const click = (node: Element) => (node.props.onClick as () => void)();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.states = [];
  mocks.transitions = [];
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => OPERATION) });
  mocks.setContact.mockResolvedValue({
    status: "uncertain",
    message: "Esito sintetico da verificare",
  });
});
afterEach(async () => {
  await Promise.all(mocks.transitions);
  vi.unstubAllGlobals();
});

describe("PartnerAssistantBlock", () => {
  it("una sezione «Assistente» della scheda, con il suo titolo h4", () => {
    const tree = render(2);
    const sections = descendants(tree).filter((node) => node.type === "section");
    expect(sections).toHaveLength(1);
    expect(sections[0].props.className).toBe(styles.detailBlock);
    const titles = descendants(tree).filter((node) => /^h[1-6]$/.test(String(node.type)));
    expect(titles.map((node) => `${String(node.type)} ${text(node)}`)).toEqual(["h4 Assistente"]);
  });

  it("bozza pronta: stato, proposta e motivo, indirizzo proposto, ricerca e bozza, in ordine", () => {
    const tree = render(2);
    const all = words(tree);
    expect(all).toContain("Bozza pronta");
    expect(words(paragraph(tree, "Merch co-firmato"))).toBe(
      "Proposta: Merch co-firmato. Il raduno è nei Paesi Bassi, fuori portata per uno stand: " +
        "proponiamo magliette co-firmate dell'evento.",
    );
    expect(words(paragraph(tree, "Indirizzo trovato dalla ricerca"))).toBe(
      "Indirizzo trovato dalla ricerca (proposta): booking@raduno-due.example.test. " +
        "La bozza va all'email del gestionale.",
    );
    expect(all).toContain("Ricerca del 22 ottobre");
    expect(all).toContain("nuova area espositori vicino ai box");
    const order = [
      "Bozza pronta",
      "Proposta: Merch co-firmato",
      "Indirizzo trovato dalla ricerca",
      "Ricerca del 22 ottobre",
      "Bozza dell'email",
      "Assistente su questo contatto: attivo",
    ].map((part) => all.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Il contatto può essere preso: nessuna riga «non lo prende».
    expect(all).not.toContain("non lo prende");
  });

  it("le fonti della ricerca sono link esterni che si aprono in una nuova scheda", () => {
    const links = descendants(render(2)).filter((node) => node.type === "a");
    expect(
      links.map((node) => [node.props.href, node.props.target, node.props.rel, words(node)]),
    ).toEqual([
      [
        "https://raduno-due.example.test/espositori",
        "_blank",
        "noopener noreferrer",
        "raduno-due.example.test/espositori (si apre in una nuova scheda)",
      ],
    ]);
  });

  it("la bozza in una sezione apribile: destinatario, oggetto, corpo e firma come salvati", () => {
    const tree = render(2);
    const details = descendants(tree).filter((node) => node.type === "details");
    expect(details).toHaveLength(1);
    const draft = details[0];
    expect(draft.props.open).toBeUndefined();
    const summary = descendants(draft).find((node) => node.type === "summary")!;
    expect(words(summary)).toBe("Bozza dell'email");
    const fields = descendants(draft)
      .filter((node) => node.type === "dt" || node.type === "dd")
      .map(words);
    expect(fields).toEqual([
      "A",
      "info@raduno-due.example.test",
      "Oggetto",
      "Raduno Sintetico Due and LuckyLap",
    ]);
    const saved = partnerFixtureDetail(2, TODAY)!.assistant!.draft!;
    const texts = descendants(draft)
      .filter((node) => node.type === "p")
      .map((node) => text(node));
    expect(texts).toContain(saved.body);
    expect(texts).toContain(saved.signature);
    expect(saved.signature).toContain("+39 000 000 0000");
    expect(words(draft)).toContain("Scritta oggi alle 10:48 con le regole in versione 2.");
  });

  it("la bozza senza recapito lo dice invece dell'indirizzo", () => {
    const tree = render(2, {
      assistant: (view) => ({ ...view, draft: { ...view.draft!, toAddress: null } }),
    });
    const fields = descendants(tree)
      .filter((node) => node.type === "dd")
      .map(words);
    expect(fields[0]).toBe("Il recapito della bozza non c'è più.");
  });

  it("l'indirizzo della ricerca uguale a quello del gestionale non si ripete", () => {
    const tree = render(2, {
      assistant: (view) => ({
        ...view,
        choice: { ...view.choice!, proposedEmail: "INFO@raduno-due.example.test" },
      }),
    });
    expect(words(tree)).not.toContain("Indirizzo trovato dalla ricerca");
  });

  it("«Serve Tommi»: il motivo in ambra, e perché l'assistente non lo prende più", () => {
    const tree = render(1);
    const serve = paragraph(tree, "Serve Tommi");
    expect(words(serve)).toBe(
      "Serve Tommi: La ricerca non ha trovato un fatto vero e recente da citare.",
    );
    expect(serve.props.className).toBe(styles.noteAmber);
    expect(words(paragraph(tree, "non lo prende"))).toBe(
      "L'assistente non lo prende: è seguito da Ada Prova, non è più «Da contattare», ha una " +
        "prossima azione e il team ci ha già lavorato.",
    );
    // Anche con l'interruttore attivo.
    expect(words(tree)).toContain("Assistente su questo contatto: attivo");
    // Senza bozza: niente sezione apribile.
    expect(descendants(tree).some((node) => node.type === "details")).toBe(false);
  });

  it("in attesa: la data da cui scriverà", () => {
    const tree = render(2, {
      assistant: (view) => ({
        ...view,
        job: { ...view.job!, status: "attesa", writeOn: "2026-12-03" },
        draft: null,
      }),
    });
    expect(words(paragraph(tree, "In attesa della data"))).toBe(
      "In attesa della data: scrive dal 3 dicembre.",
    );
  });

  it("in coda: lo dice", () => {
    const tree = render(2, {
      assistant: (view) => ({ ...view, job: { ...view.job!, status: "in_coda" } }),
    });
    expect(words(paragraph(tree, "In coda"))).toBe(
      "In coda: l'assistente ci lavora nei prossimi giri.",
    );
  });

  it("nessun lavoro: lo dice e mostra l'interruttore; spiega perché non lo prende", () => {
    const tree = render(3);
    expect(words(tree)).toContain("Nessun lavoro dell'assistente su questo contatto.");
    expect(words(paragraph(tree, "non lo prende"))).toBe(
      "L'assistente non lo prende: è seguito da Bruno Prova, non è più «Da contattare», non ha " +
        "un'email attiva e il team ci ha già lavorato.",
    );
    expect(button(tree, "Ferma su questo contatto").props.disabled).toBe(false);
    expect(words(paragraph(render(5), "non lo prende"))).toBe(
      "L'assistente non lo prende: non ha un'email attiva e la ricerca non lo propone più.",
    );
  });

  it("«Non contattare» e assistente fermo: le due cose scritte, «Riattiva» lo ridà", () => {
    const tree = render(4);
    expect(words(paragraph(tree, "non lo prende"))).toBe(
      "L'assistente non lo prende: è in «Non contattare».",
    );
    expect(words(tree)).toContain("Assistente su questo contatto: fermo");
    expect(buttons(tree).map((node) => text(node).trim())).toEqual(["Riattiva su questo contatto"]);
    click(button(tree, "Riattiva su questo contatto"));
    expect(mocks.setContact).toHaveBeenCalledExactlyOnceWith({
      kind: "set_partner_assistant_contact",
      operationId: OPERATION,
      payload: { schema_version: 1, partner_id: partnerFixtureId(4), active: true },
      retry: false,
    });
  });

  it("l'interruttore attivo ferma l'assistente su questo contatto", () => {
    click(button(render(2), "Ferma su questo contatto"));
    expect(mocks.setContact).toHaveBeenCalledExactlyOnceWith({
      kind: "set_partner_assistant_contact",
      operationId: OPERATION,
      payload: { schema_version: 1, partner_id: partnerFixtureId(2), active: false },
      retry: false,
    });
    expect(mocks.other).not.toHaveBeenCalled();
  });

  it("dopo la rilettura l'interruttore segue la vista nuova", () => {
    expect(words(render(2))).toContain("Assistente su questo contatto: attivo");
    const tree = render(2, { assistant: (view) => ({ ...view, active: false, switchVersion: 1 }) });
    expect(words(tree)).toContain("Assistente su questo contatto: fermo");
    click(button(tree, "Riattiva su questo contatto"));
    expect(mocks.setContact).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { schema_version: 1, partner_id: partnerFixtureId(2), active: true },
      }),
    );
  });

  it("stato non leggibile: fondo ambra con la frase scritta, senza interruttore", () => {
    const tree = render(2, { assistant: () => null });
    const note = paragraph(tree, "non leggibile");
    expect(words(note)).toBe("Stato dell'assistente non leggibile: ricarica la pagina tra poco.");
    expect(note.props.className).toBe(styles.noteAmber);
    expect(buttons(tree)).toEqual([]);
    expect(words(tree)).not.toContain("Assistente su questo contatto");
    expect(words(tree)).not.toContain("Nessun lavoro");
  });

  it("in anteprima l'interruttore è spento e niente arriva al server", () => {
    const tree = render(2, { preview: true });
    const toggle = button(tree, "Ferma su questo contatto");
    expect(toggle.props.disabled).toBe(true);
    click(toggle);
    expect(mocks.setContact).not.toHaveBeenCalled();
  });

  it("niente <main>, niente link per scrivere, chiamare o tornare indietro", () => {
    for (const co of [1, 2, 3, 4, 5]) {
      const tree = render(co);
      expect(descendants(tree).some((node) => node.type === "main")).toBe(false);
      const hrefs = descendants(tree)
        .filter((node) => node.type === "a")
        .map((node) => String(node.props.href));
      expect(hrefs.every((href) => href.startsWith("https://"))).toBe(true);
      expect(words(tree)).not.toMatch(/Torna|mailto:|tel:/);
    }
  });
});
