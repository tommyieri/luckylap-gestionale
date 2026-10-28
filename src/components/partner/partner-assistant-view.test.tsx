import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/*
 * /partner/assistente (specifica dell'assistente Partner, «Interfaccia»). Il componente gira
 * senza DOM: gli hook di React sono sostituiti da una versione minima, lo stato resta tra un
 * render e l'altro nell'ordine delle chiamate, i contesti seguono l'albero. Così i clic e i
 * moduli arrivano alle Server Action vere di usePartnerCommand, sostituite da vi.fn().
 */
const mocks = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  contexts: [] as { context: unknown; value: unknown }[],
  transitions: [] as Promise<unknown>[],
  refresh: vi.fn(),
  setMode: vi.fn(),
  setContact: vi.fn(),
  saveRules: vi.fn(),
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
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
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
  setPartnerAssistantContact: mocks.setContact,
  savePartnerAssistantRules: mocks.saveRules,
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

import { PartnerAssistantView } from "./partner-assistant-view";
import type { PartnerAssistantStatus } from "../../lib/partner/assistant";
import {
  PARTNER_FIXTURE_MEMBER_ID,
  partnerAssistantFixture,
  partnerFixtureId,
} from "../../lib/partner/fixtures";

type Element = ReactElement<Record<string, unknown>>;
type Props = Parameters<typeof PartnerAssistantView>[0];

const TODAY = "2026-10-22";
const NOW = "2026-10-22T09:00:00Z";
const OPERATION = "93000000-0000-4000-8000-000000000001";
const fixture = partnerAssistantFixture(TODAY);
const CONTEXT = Symbol.for("react.context");

/** Rende l'albero chiamando i componenti funzione; i provider di contesto valgono per i figli. */
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

function render(overrides: Partial<Props> = {}, status: Partial<PartnerAssistantStatus> = {}) {
  mocks.index = 0;
  mocks.contexts = [];
  const props: Props = {
    status: { ...fixture.status, ...status },
    rules: fixture.rules,
    partnerIds: { 1: partnerFixtureId(1) },
    today: TODAY,
    now: NOW,
    preview: false,
    userId: PARTNER_FIXTURE_MEMBER_ID,
    ...overrides,
  };
  return expand(<PartnerAssistantView {...props} />);
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
const words = (node: unknown) => text(node).replace(/\s+/g, " ");
const buttons = (tree: unknown) => descendants(tree).filter((node) => node.type === "button");
const button = (tree: unknown, label: string) => {
  const found = buttons(tree).filter((node) => text(node).trim() === label);
  expect(found, label).toHaveLength(1);
  return found[0];
};
/** La sezione con questo titolo h2. */
const sectionOf = (tree: unknown, title: string) => {
  const found = descendants(tree).filter(
    (node) =>
      node.type === "section" &&
      descendants(node).some((item) => item.type === "h2" && text(item) === title),
  );
  expect(found, title).toHaveLength(1);
  return found[0];
};
const click = (node: Element) => (node.props.onClick as () => void)();
const submit = (form: Element) =>
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
/** Il modulo che contiene il pulsante con questa etichetta. */
const formOf = (tree: unknown, label: string) => {
  const found = descendants(tree).filter(
    (node) => node.type === "form" && buttons(node).some((b) => text(b).trim() === label),
  );
  expect(found, label).toHaveLength(1);
  return found[0];
};
/** Le regole dopo il salvataggio di un collega: versione nuova in vigore, in cima alla cronologia. */
const rulesAt = (version: number, body: string) => ({
  current: { version, body, createdAt: "2026-10-22T08:30:00Z", author: "Bruno Prova" },
  history: [
    { version, createdAt: "2026-10-22T08:30:00Z", author: "Bruno Prova" },
    ...fixture.rules.history,
  ],
});
const rulesArea = (tree: unknown) =>
  descendants(tree).find((node) => node.type === "textarea" && node.props.name === "regole")!;
const typeRules = (tree: unknown, value: string) =>
  (rulesArea(tree).props.onChange as (event: unknown) => void)({ target: { value } });
const creditInput = (tree: unknown) =>
  descendants(tree).find((node) => node.type === "input" && node.props.name === "credito")!;
const typeCredit = (tree: unknown, value: string) =>
  (creditInput(tree).props.onChange as (event: unknown) => void)({ target: { value } });
const command = (kind: string, payload: Record<string, unknown>) => ({
  kind,
  operationId: OPERATION,
  payload: { schema_version: 1, ...payload },
  retry: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.states = [];
  mocks.transitions = [];
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => OPERATION) });
  for (const action of [mocks.setMode, mocks.setContact, mocks.saveRules])
    action.mockResolvedValue({ status: "uncertain", message: "Esito sintetico da verificare" });
});
afterEach(async () => {
  await Promise.all(mocks.transitions);
  vi.unstubAllGlobals();
});

describe("PartnerAssistantView", () => {
  it("titolo «Assistente» e le sei sezioni nell'ordine della specifica", () => {
    const tree = render();
    const h1 = descendants(tree).filter((node) => node.type === "h1");
    expect(h1.map(text)).toEqual(["Assistente"]);
    expect(
      descendants(tree)
        .filter((node) => node.type === "h2")
        .map(text)
        .slice(0, 6),
    ).toEqual(["Stato", "Modalità", "Coda", "Spesa", "Da vedere", "Regole"]);
    expect(descendants(tree).some((node) => node.type === "main")).toBe(false);
  });

  it("«Prova» e «Invio» disabilitati, con la nota; la modalità in vigore è premuta", () => {
    const tree = render();
    expect(button(tree, "Prova").props.disabled).toBe(true);
    expect(button(tree, "Invio").props.disabled).toBe(true);
    expect(words(tree)).toContain("Arrivano con la seconda consegna");
    expect(button(tree, "Prepara").props["aria-pressed"]).toBe(true);
    expect(button(tree, "Spento").props["aria-pressed"]).toBe(false);
    expect(button(tree, "Spento").props.disabled).toBe(false);
    // Già in «Prepara», senza pausa né attesa: niente da rimettere in moto. Il pulsante resta
    // pieno (non disabilitato, non sbiadito) e il clic non fa niente.
    expect(button(tree, "Prepara").props.disabled).toBe(false);
    click(button(tree, "Prepara"));
    expect(mocks.setMode).not.toHaveBeenCalled();
  });

  it("la modalità in vigore resta piena anche quando i pulsanti sono spenti", () => {
    const css = readFileSync(join(__dirname, "partner.module.css"), "utf8");
    const rule = /\.act\[aria-pressed="true"\]:disabled[^{]*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toContain("opacity: 1");
    expect(rule?.[1]).toContain("background: var(--ink)");
    expect(rule?.[1]).toContain("color: var(--paper)");
  });

  it("«Prepara» chiama setPartnerAssistantMode con expected_version", () => {
    const tree = render({}, { mode: "spento", version: 7 });
    // «Spento» è già in vigore: premuto, non disabilitato, il clic non manda niente.
    expect(button(tree, "Spento").props["aria-pressed"]).toBe(true);
    expect(button(tree, "Spento").props.disabled).toBe(false);
    click(button(tree, "Spento"));
    expect(mocks.setMode).not.toHaveBeenCalled();
    click(button(tree, "Prepara"));
    expect(mocks.setMode).toHaveBeenCalledExactlyOnceWith(
      command("set_partner_assistant_mode", { mode: "prepara", expected_version: 7 }),
    );
    expect(mocks.setContact).not.toHaveBeenCalled();
    expect(mocks.saveRules).not.toHaveBeenCalled();
  });

  it("«Spento» ferma l'assistente con la versione letta", () => {
    click(button(render(), "Spento"));
    expect(mocks.setMode).toHaveBeenCalledExactlyOnceWith(
      command("set_partner_assistant_mode", { mode: "spento", expected_version: 2 }),
    );
  });

  it("la pausa per credito si legge «Credito finito: l'assistente è in pausa»", () => {
    const tree = render({}, { pausedReason: "credito" });
    expect(words(tree)).toContain("Credito finito: l'assistente è in pausa");
    // In pausa «Prepara» lo fa ripartire, anche se la modalità è già quella.
    expect(button(tree, "Prepara").props.disabled).toBe(false);
    click(button(tree, "Prepara"));
    expect(mocks.setMode).toHaveBeenCalledWith(
      command("set_partner_assistant_mode", { mode: "prepara", expected_version: 2 }),
    );
    const claude = words(render({}, { pausedReason: "errore_claude" }));
    expect(claude).toContain("Errore di Claude: l'assistente è in pausa");
    expect(claude).not.toContain("Credito finito");
  });

  it("ultimo giro, attesa e configurazione scritti a parole", () => {
    const tree = words(render());
    expect(tree).toContain("Prepara: l'assistente cerca notizie sui contatti e scrive le bozze");
    expect(tree).toContain("Ultimo giro: oggi alle 10:58.");
    const waiting = render({}, { backoffUntil: "2026-10-22T09:08:00Z", lastTickAt: null });
    expect(words(waiting)).toContain("l'assistente riprende dopo le 11:08");
    expect(words(waiting)).toContain("Nessun giro finora.");
    expect(button(waiting, "Prepara").props.disabled).toBe(false);
    // Un'attesa già finita non si mostra.
    expect(words(render({}, { backoffUntil: "2026-10-22T08:00:00Z" }))).not.toContain("riprende");
    const unconfigured = render({}, { configured: false, mode: "spento" });
    expect(words(unconfigured)).toContain("serve il passo di avvio con Tommi");
    expect(button(unconfigured, "Prepara").props.disabled).toBe(true);
  });

  it("gli ultimi eventi a parole, un esito sconosciuto con il suo codice", () => {
    const tree = render(
      {},
      {
        lastEvents: [
          ...fixture.status.lastEvents.slice(0, 2),
          { createdAt: "2026-10-21T08:00:00Z", co: null, step: null, outcome: "pausa_credito" },
          { createdAt: "2026-10-16T08:00:00Z", co: 3, step: "ricerca", outcome: "esito_nuovo" },
        ],
      },
    );
    const events = descendants(sectionOf(tree, "Stato")).find((node) => node.type === "ol")!;
    expect(
      descendants(events)
        .filter((node) => node.type === "li")
        .map(words),
    ).toEqual([
      "oggi alle 10:50 · CO 002 · Bozza pronta per Tommi",
      "oggi alle 10:48 · CO 002 · Bozza scritta, controlli superati",
      "ieri alle 10:00 · In pausa: credito finito",
      "16 ottobre alle 10:00 · CO 003 · esito_nuovo",
    ]);
    expect(
      descendants(events).find((node) => node.type === "a" && text(node) === "CO 002")?.props.href,
    ).toBe("/partner?co=2#lead-2");
  });

  it("coda: i cinque conteggi", () => {
    const tree = render(
      {},
      { counts: { inCoda: 4, attesa: 3, pronta: 12, serveTommaso: 2, ferma: 1 } },
    );
    const queue = sectionOf(tree, "Coda");
    const pairs = descendants(queue)
      .filter((node) => node.type === "div")
      .map((node) => [
        text(descendants(node).find((item) => item.type === "dt")),
        text(descendants(node).find((item) => item.type === "dd")),
      ]);
    expect(pairs).toEqual([
      ["In coda", "4"],
      ["In attesa della data", "3"],
      ["Bozza pronta", "12"],
      ["Serve Tommi", "2"],
      ["Fermati dal team", "1"],
    ]);
  });

  it("spesa: totale, oggi, credito meno spesa e la Console come numero esatto", () => {
    const spend = words(render());
    expect(spend).toContain("Spesa totale1,37 USD");
    expect(spend).toContain("Spesa di oggi0,85 USD");
    expect(spend).toContain("Credito rimasto, stimato23,63 USD");
    expect(spend).toContain("25,00 USD di partenza, ricariche comprese, meno la spesa registrata");
    expect(spend).toContain("Il numero esatto è nella Console Anthropic");
    const noCredit = words(render({}, { startingCreditUsd: null }));
    expect(noCredit).toContain("Inserisci il credito di partenza in «Modalità»");
    expect(noCredit).toContain("Il numero esatto è nella Console Anthropic");
    expect(words(render({}, { startingCreditUsd: 1, spentUsd: 1.5 }))).toContain(
      "La spesa registrata supera il credito di partenza di 0,50 USD",
    );
  });

  it("credito: si scrive il totale caricato dall'inizio, così la stima regge dopo una ricarica", () => {
    // Partenza 25 USD, tutti spesi, poi una ricarica di 50: si scrive 75, e restano 50.
    const tree = render({}, { startingCreditUsd: 75, spentUsd: 25, pausedReason: "credito" });
    expect(words(sectionOf(tree, "Spesa"))).toContain("Credito rimasto, stimato50,00 USD");
    const mode = sectionOf(tree, "Modalità");
    const hint = descendants(mode).find(
      (node) => node.type === "p" && words(node).includes("più le ricariche"),
    )!;
    expect(words(hint)).toBe(
      "Il credito che la Console Anthropic mostrava prima del primo giro, più le ricariche fatte " +
        "da allora: la pagina toglie tutta la spesa registrata dall'inizio.",
    );
    const input = descendants(mode).find((node) => node.props.name === "credito")!;
    expect(String(input.props["aria-describedby"]).split(" ")).toContain(hint.props.id);
    const pause = words(sectionOf(tree, "Stato"));
    expect(pause).toContain(
      "Dopo la ricarica aggiungi l'importo ricaricato al credito di partenza in «Modalità» e salva",
    );
    // Il vecchio invito a scrivere il credito della Console darebbe 25 USD rimasti invece di 50.
    expect(words(tree)).not.toContain("quando lo scrivi qui");
    expect(words(tree)).not.toContain("salva il credito nuovo");
  });

  it("credito di partenza: campo di testo con la tastiera dei decimali, salvato con la modalità e la versione", () => {
    let tree = render();
    const input = descendants(tree).find(
      (node) => node.type === "input" && node.props.name === "credito",
    )!;
    // Testo, non number: la virgola funziona anche in un browser inglese.
    expect(input.props).toMatchObject({ type: "text", inputMode: "decimal" });
    for (const key of ["min", "max", "step"]) expect(input.props[key], key).toBeUndefined();
    expect(input.props.value).toBe("25");
    (input.props.onChange as (event: unknown) => void)({ target: { value: "40,5" } });
    tree = render();
    submit(formOf(tree, "Salva il credito"));
    expect(mocks.setMode).toHaveBeenCalledExactlyOnceWith(
      command("set_partner_assistant_mode", {
        mode: "prepara",
        expected_version: 2,
        starting_credit_usd: 40.5,
      }),
    );
  });

  it("credito non valido: nessun invio e l'errore vicino al campo", () => {
    render();
    const input = () =>
      descendants(render()).find((node) => node.type === "input" && node.props.name === "credito")!;
    (input().props.onChange as (event: unknown) => void)({ target: { value: "-3" } });
    submit(formOf(render(), "Salva il credito"));
    expect(mocks.setMode).not.toHaveBeenCalled();
    const tree = render();
    expect(words(tree)).toContain("Scrivi un importo da 0 a 10000 USD");
    expect(input().props["aria-invalid"]).toBe(true);
  });

  it("in pausa il credito si salva e l'assistente riparte, detto sul pulsante", () => {
    const tree = render({}, { pausedReason: "credito" });
    expect(formOf(tree, "Salva il credito e riparti")).toBeTruthy();
  });

  it("anche in attesa dopo un errore di Claude il credito fa ripartire, detto sul pulsante", () => {
    const tree = render({}, { backoffUntil: "2026-10-22T09:08:00Z" });
    expect(formOf(tree, "Salva il credito e riparti")).toBeTruthy();
    // Attesa già finita: niente da far ripartire.
    expect(
      formOf(render({}, { backoffUntil: "2026-10-22T08:00:00Z" }), "Salva il credito"),
    ).toBeTruthy();
  });

  it("credito: un collega lo cambia, il campo si riallinea e il tuo valore resta a parte", () => {
    typeCredit(render(), "40");
    // Bruno salva 75 USD (versione 3); un comando qualunque della pagina la rilegge. Lo stato si
    // aggiorna durante il render e React rifà subito il render.
    const v3 = { version: 3, startingCreditUsd: 75 };
    render({}, v3);
    let tree = render({}, v3);
    expect(creditInput(tree).props.value).toBe("75");
    const mode = words(sectionOf(tree, "Modalità"));
    expect(mode).toContain("Il tuo valore, non salvato: 40");
    expect(mode).toContain("nel campo ora c'è il credito salvato");
    // Riscritto, parte dalla versione 3: niente sovrascrive il credito di Bruno con la versione 2.
    typeCredit(tree, "115");
    tree = render({}, v3);
    expect(words(sectionOf(tree, "Modalità"))).not.toContain("Il tuo valore");
    submit(formOf(tree, "Salva il credito"));
    expect(mocks.setMode).toHaveBeenCalledExactlyOnceWith(
      command("set_partner_assistant_mode", {
        mode: "prepara",
        expected_version: 3,
        starting_credit_usd: 115,
      }),
    );
  });

  it("credito: la versione mandata è quella da cui è partita la bozza", () => {
    typeCredit(render(), "40");
    submit(formOf(render(), "Salva il credito"));
    expect(mocks.setMode).toHaveBeenCalledExactlyOnceWith(
      command("set_partner_assistant_mode", {
        mode: "prepara",
        expected_version: 2,
        starting_credit_usd: 40,
      }),
    );
  });

  it("credito: il proprio salvataggio riuscito non diventa un conflitto", async () => {
    mocks.setMode.mockResolvedValue({
      status: "success",
      kind: "set_partner_assistant_mode",
      operationId: OPERATION,
      id: "93000000-0000-4000-8000-000000000004",
      partnerId: null,
      version: 3,
      stage: null,
      co: null,
      message: "Modalità dell'assistente salvata.",
    });
    typeCredit(render(), "40,5");
    submit(formOf(render(), "Salva il credito"));
    await Promise.all(mocks.transitions);
    const v3 = { version: 3, startingCreditUsd: 40.5 };
    render({}, v3);
    const tree = render({}, v3);
    expect(creditInput(tree).props.value).toBe("40,5");
    expect(words(tree)).not.toContain("Il tuo valore");
  });

  it("da vedere: motivo, link alla scheda e «Ridai all'assistente»", () => {
    const tree = render();
    const review = sectionOf(tree, "Da vedere");
    const item = descendants(review).filter((node) => node.type === "li");
    expect(item).toHaveLength(1);
    expect(words(item[0])).toContain("CO 001 · Garage Sintetico Uno");
    expect(words(item[0])).toContain(
      "La ricerca non ha trovato un fatto vero e recente da citare.",
    );
    expect(words(item[0])).toContain("Passato a Tommi il 16 ottobre");
    expect(descendants(item[0]).find((node) => node.type === "a")?.props.href).toBe(
      "/partner?co=1#lead-1",
    );
  });

  it("«Ridai all'assistente» dice il contatto a chi usa un lettore di schermo", () => {
    const ridai = button(render(), "Ridai all'assistente");
    expect(ridai.props["aria-label"]).toBe("Ridai all'assistente CO 001 · Garage Sintetico Uno");
  });

  it("«Ridai all'assistente»: la conferma resta nella sezione quando la riga sparisce, con il focus", async () => {
    mocks.setContact.mockResolvedValue({
      status: "success",
      kind: "set_partner_assistant_contact",
      operationId: OPERATION,
      id: "93000000-0000-4000-8000-000000000005",
      partnerId: partnerFixtureId(1),
      version: 2,
      stage: null,
      co: null,
      message: "Assistente aggiornato su questo contatto.",
    });
    click(button(render(), "Ridai all'assistente"));
    await Promise.all(mocks.transitions);
    // La pagina riletta non ha più il contatto in «Da vedere».
    const tree = render({}, { toReview: [] });
    const review = sectionOf(tree, "Da vedere");
    expect(words(review)).toContain("Nessun contatto da vedere");
    const outcome = descendants(review).find((node) => node.props.role === "status")!;
    expect(words(outcome)).toBe(
      "CO 001 · Garage Sintetico Uno: di nuovo all'assistente, riparte dalla ricerca.",
    );
    expect(outcome.props.tabIndex).toBe(-1);
    const focus = vi.fn();
    (outcome.props.ref as (node: unknown) => void)({ focus });
    expect(focus).toHaveBeenCalledOnce();
  });

  it("«Ridai all'assistente» su un secondo contatto: nessuna conferma con il suo nome prima dell'esito", async () => {
    const [first] = fixture.status.toReview;
    const toReview = [first, { ...first, co: 2, name: "Garage Sintetico Due" }];
    const partnerIds = { 1: partnerFixtureId(1), 2: partnerFixtureId(2) };
    const view = () => sectionOf(render({ partnerIds }, { toReview }), "Da vedere");
    const ridai = (n: number) =>
      buttons(view()).filter((node) => text(node).trim() === "Ridai all'assistente")[n];
    const success = (co: number) => ({
      status: "success",
      kind: "set_partner_assistant_contact",
      operationId: OPERATION,
      id: "93000000-0000-4000-8000-000000000005",
      partnerId: partnerFixtureId(co),
      version: 2,
      stage: null,
      co: null,
      message: "Assistente aggiornato su questo contatto.",
    });
    let answer!: (result: unknown) => void;
    mocks.setContact
      .mockResolvedValueOnce(success(1))
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    click(ridai(0));
    await Promise.all(mocks.transitions);
    expect(words(view())).toContain(
      "CO 001 · Garage Sintetico Uno: di nuovo all'assistente, riparte dalla ricerca.",
    );
    // Il secondo invio è ancora aperto: né la conferma di prima né quella del contatto nuovo.
    click(ridai(1));
    expect(mocks.setContact).toHaveBeenCalledTimes(2);
    const waiting = words(view());
    answer(success(2));
    await Promise.all(mocks.transitions);
    expect(waiting).not.toContain("di nuovo all'assistente");
    expect(waiting).not.toContain("Assistente aggiornato su questo contatto.");
    expect(words(view())).toContain(
      "CO 002 · Garage Sintetico Due: di nuovo all'assistente, riparte dalla ricerca.",
    );
    expect(words(view())).not.toContain("Garage Sintetico Uno: di nuovo");
  });

  it("«Ridai all'assistente»: la conferma con il contatto solo se l'esito è di quel contatto", async () => {
    mocks.setContact.mockResolvedValue({
      status: "success",
      kind: "set_partner_assistant_contact",
      operationId: OPERATION,
      id: "93000000-0000-4000-8000-000000000005",
      partnerId: partnerFixtureId(2),
      version: 2,
      stage: null,
      co: null,
      message: "Assistente aggiornato su questo contatto.",
    });
    click(button(render(), "Ridai all'assistente"));
    await Promise.all(mocks.transitions);
    const review = sectionOf(render(), "Da vedere");
    expect(words(review)).not.toContain("di nuovo all'assistente");
    expect(words(review)).toContain("Assistente aggiornato su questo contatto.");
  });

  it("i contatti di «Da vedere» arrivano al contesto: un invio incerto si legge con CO e nome", () => {
    const provider = descendants(render()).find(
      (node) => (node.props.value as { partnersById?: unknown } | undefined)?.partnersById,
    )!;
    const byId = (provider.props.value as { partnersById: ReadonlyMap<string, unknown> })
      .partnersById;
    expect(byId.get(partnerFixtureId(1))).toEqual({
      id: partnerFixtureId(1),
      co: 1,
      name: "Garage Sintetico Uno",
    });
  });

  it("«Ridai all'assistente» chiama setPartnerAssistantContact con active: true", () => {
    click(button(render(), "Ridai all'assistente"));
    expect(mocks.setContact).toHaveBeenCalledExactlyOnceWith(
      command("set_partner_assistant_contact", { partner_id: partnerFixtureId(1), active: true }),
    );
    // Senza l'id della scheda il pulsante non c'è: niente comando sbagliato.
    const tree = render({ partnerIds: {} });
    expect(buttons(tree).filter((node) => text(node) === "Ridai all'assistente")).toEqual([]);
    expect(words(tree)).toContain("CO 001 · Garage Sintetico Uno");
  });

  it("nessun contatto da vedere: lo dice", () => {
    expect(words(render({}, { toReview: [] }))).toContain("Nessun contatto da vedere");
  });

  it("regole: il testo in vigore, la cronologia e che le regole della ricerca sono superate", () => {
    const tree = render();
    const article = descendants(tree).find((node) => node.type === "article")!;
    expect(
      descendants(article)
        .filter((node) => /^h[2-6]$/.test(String(node.type)))
        .map((node) => `${String(node.type)} ${text(node)}`),
    ).toEqual(["h3 Regole sintetiche dell'assistente", "h4 Tono", "h4 Mai"]);
    expect(words(article)).toContain("Una sola domanda gentile.");
    expect(words(article)).not.toContain("#");
    expect(words(tree)).toContain("In vigore: versione 2, di Ada Prova, ieri alle 18:30.");
    expect(words(tree)).toContain("sono superate su più punti");
    const history = descendants(sectionOf(tree, "Regole")).find((node) => node.type === "ol")!;
    expect(
      descendants(history)
        .filter((node) => node.type === "li")
        .map(words),
    ).toEqual([
      "Versione 2 · Ada Prova · ieri alle 18:30 · in vigore",
      "Versione 1 · Regole iniziali · 15 ottobre alle 09:00",
    ]);
  });

  it("il salvataggio delle regole manda la versione attuale", () => {
    let tree = render();
    const area = () =>
      descendants(tree).find((node) => node.type === "textarea" && node.props.name === "regole")!;
    expect(area().props.value).toBe(fixture.rules.current.body);
    // Senza modifiche non c'è niente da salvare.
    expect(button(tree, "Salva come versione 3").props.disabled).toBe(true);
    (area().props.onChange as (event: unknown) => void)({
      target: { value: "Regole sintetiche, versione nuova." },
    });
    tree = render();
    expect(button(tree, "Salva come versione 3").props.disabled).toBe(false);
    submit(formOf(tree, "Salva come versione 3"));
    expect(mocks.saveRules).toHaveBeenCalledExactlyOnceWith(
      command("save_partner_assistant_rules", {
        body: "Regole sintetiche, versione nuova.",
        expected_version: 2,
      }),
    );
  });

  it("regole: la versione di un collega arriva con la pagina riletta, il tuo testo resta da parte", () => {
    typeRules(render(), "Regole di Ada, partite dalla versione 2.");
    // Bruno salva la versione 3; un comando qualunque della pagina (per esempio «Spento») la
    // rilegge. Lo stato si aggiorna durante il render e React rifà subito il render.
    const v3 = rulesAt(3, "Regole di Bruno, versione 3.");
    render({ rules: v3 });
    let tree = render({ rules: v3 });
    expect(rulesArea(tree).props.value).toBe("Regole di Bruno, versione 3.");
    // Niente da salvare: il campo ha il testo in vigore, non quello partito dalla versione 2.
    expect(button(tree, "Salva come versione 4").props.disabled).toBe(true);
    submit(formOf(tree, "Salva come versione 4"));
    expect(mocks.saveRules).not.toHaveBeenCalled();
    const rules = words(sectionOf(tree, "Regole"));
    expect(rules).toContain("Il tuo testo");
    expect(rules).toContain("Mentre scrivevi è arrivata la versione 3 delle regole");
    expect(rules).toContain("Regole di Ada, partite dalla versione 2.");
    // Riportato nel campo, il testo parte dalla versione 3 e si salva con quella.
    typeRules(tree, "Regole di Ada, riportate sulla versione 3.");
    tree = render({ rules: v3 });
    submit(formOf(tree, "Salva come versione 4"));
    expect(mocks.saveRules).toHaveBeenCalledExactlyOnceWith(
      command("save_partner_assistant_rules", {
        body: "Regole di Ada, riportate sulla versione 3.",
        expected_version: 3,
      }),
    );
    click(button(tree, "Fatto, chiudi"));
    expect(words(render({ rules: v3 }))).not.toContain("Il tuo testo");
  });

  it("regole non modificate: la versione nuova arrivata si vede nel campo", () => {
    expect(rulesArea(render()).props.value).toBe(fixture.rules.current.body);
    const tree = render({ rules: rulesAt(3, "Regole di Bruno, versione 3.") });
    expect(rulesArea(tree).props.value).toBe("Regole di Bruno, versione 3.");
    expect(button(tree, "Salva come versione 4").props.disabled).toBe(true);
    expect(words(tree)).not.toContain("Il tuo testo");
  });

  it("regole rifiutate con partner_changed: nessun secondo clic sovrascrive la versione nuova", async () => {
    mocks.saveRules.mockResolvedValue({
      status: "rejected",
      code: "partner_changed",
      message:
        "Un collega ha appena salvato una nuova versione delle regole. Ricarico i dati: controlla e riprova.",
      refresh: true,
    });
    typeRules(render(), "Regole di Ada.");
    const sent = command("save_partner_assistant_rules", {
      body: "Regole di Ada.",
      expected_version: 2,
    });
    submit(formOf(render(), "Salva come versione 3"));
    await Promise.all(mocks.transitions);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    // Prima che la pagina riletta arrivi, il secondo clic parte ancora dalla versione 2.
    submit(formOf(render(), "Salva come versione 3"));
    await Promise.all(mocks.transitions);
    expect(mocks.saveRules.mock.calls).toEqual([[sent], [sent]]);
    // Con la versione 3 nella pagina il tuo testo va da parte e non c'è niente da salvare.
    const v3 = rulesAt(3, "Regole di Bruno, versione 3.");
    render({ rules: v3 });
    const tree = render({ rules: v3 });
    expect(rulesArea(tree).props.value).toBe("Regole di Bruno, versione 3.");
    expect(words(sectionOf(tree, "Regole"))).toContain("Regole di Ada.");
    expect(button(tree, "Salva come versione 4").props.disabled).toBe(true);
    submit(formOf(tree, "Salva come versione 4"));
    expect(mocks.saveRules).toHaveBeenCalledTimes(2);
  });

  it("regole: il proprio salvataggio riuscito non diventa un conflitto", async () => {
    mocks.saveRules.mockResolvedValue({
      status: "success",
      kind: "save_partner_assistant_rules",
      operationId: OPERATION,
      id: "93000000-0000-4000-8000-000000000003",
      partnerId: null,
      version: 3,
      stage: null,
      co: null,
      message: "Regole salvate: versione 3.",
    });
    typeRules(render(), "Regole di Ada, versione 3.");
    submit(formOf(render(), "Salva come versione 3"));
    await Promise.all(mocks.transitions);
    // La pagina riletta porta la versione 3 con il testo appena salvato.
    const v3 = rulesAt(3, "Regole di Ada, versione 3.");
    render({ rules: v3 });
    let tree = render({ rules: v3 });
    expect(rulesArea(tree).props.value).toBe("Regole di Ada, versione 3.");
    expect(button(tree, "Salva come versione 4").props.disabled).toBe(true);
    expect(words(tree)).not.toContain("Il tuo testo");
    // Quello che scrivi mentre il salvataggio è in corso non si perde: resta da parte.
    typeRules(tree, "Regole di Ada, versione 4.");
    submit(formOf(render({ rules: v3 }), "Salva come versione 4"));
    typeRules(render({ rules: v3 }), "Regole di Ada, versione 4, con una riga in più.");
    // L'esito arriva prima della pagina riletta.
    await Promise.all(mocks.transitions);
    const v4 = rulesAt(4, "Regole di Ada, versione 4.");
    render({ rules: v4 });
    tree = render({ rules: v4 });
    expect(rulesArea(tree).props.value).toBe("Regole di Ada, versione 4.");
    expect(words(sectionOf(tree, "Regole"))).toContain(
      "Regole di Ada, versione 4, con una riga in più.",
    );
  });

  it("regole vuote: nessun invio", () => {
    const area = () =>
      descendants(render()).find(
        (node) => node.type === "textarea" && node.props.name === "regole",
      )!;
    (area().props.onChange as (event: unknown) => void)({ target: { value: "   " } });
    const tree = render();
    expect(button(tree, "Salva come versione 3").props.disabled).toBe(true);
    submit(formOf(tree, "Salva come versione 3"));
    expect(mocks.saveRules).not.toHaveBeenCalled();
  });

  it("regole con un carattere di controllo: nessun invio e l'errore vicino al campo", () => {
    const area = () =>
      descendants(render()).find(
        (node) => node.type === "textarea" && node.props.name === "regole",
      )!;
    (area().props.onChange as (event: unknown) => void)({ target: { value: "Regole\u0007" } });
    submit(formOf(render(), "Salva come versione 3"));
    expect(mocks.saveRules).not.toHaveBeenCalled();
    expect(words(render())).toContain("caratteri invisibili non ammessi");
    expect(area().props["aria-invalid"]).toBe(true);
  });

  it("in anteprima nessun comando: pulsanti spenti e nessuna Server Action", () => {
    const options = { preview: true, userId: null };
    const tree = render(options, { pausedReason: "credito" });
    expect(words(tree)).toContain("Anteprima locale: dati sintetici, salvataggio disattivato.");
    const commands = [
      "Spento",
      "Prepara",
      "Prova",
      "Invio",
      "Salva il credito e riparti",
      "Ridai all'assistente",
      "Salva come versione 3",
    ];
    for (const label of commands) expect(button(tree, label).props.disabled, label).toBe(true);
    // Anche premuti o inviati comunque, non arrivano al server.
    for (const label of ["Spento", "Prepara", "Ridai all'assistente"])
      click(button(render(options, { pausedReason: "credito" }), label));
    const area = descendants(render(options)).find((node) => node.type === "textarea")!;
    (area.props.onChange as (event: unknown) => void)({ target: { value: "Testo nuovo." } });
    // Anche con il testo cambiato il salvataggio resta spento.
    expect(button(render(options), "Salva come versione 3").props.disabled).toBe(true);
    submit(formOf(render(options), "Salva come versione 3"));
    submit(formOf(render(options), "Salva il credito"));
    expect(mocks.setMode).not.toHaveBeenCalled();
    expect(mocks.setContact).not.toHaveBeenCalled();
    expect(mocks.saveRules).not.toHaveBeenCalled();
    expect(mocks.other).not.toHaveBeenCalled();
  });
});
