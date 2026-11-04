import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
const mock = vi.hoisted(() => ({
  path: "",
  index: 0,
  hooks: new Map<string, unknown[]>(),
  effects: [] as (() => void)[],
  promises: [] as Promise<unknown>[],
  read: vi.fn(),
  mutate: vi.fn(),
  refresh: vi.fn(),
  uuid: 0,
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const path = mock.path,
        i = mock.index++,
        hooks = mock.hooks.get(path) ?? [];
      mock.hooks.set(path, hooks);
      if (!(i in hooks))
        hooks[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [
        hooks[i],
        (next: unknown) => {
          hooks[i] =
            typeof next === "function" ? (next as (v: unknown) => unknown)(hooks[i]) : next;
        },
      ];
    },
    useRef: (value: unknown) => {
      const i = mock.index++,
        hooks = mock.hooks.get(mock.path) ?? [];
      mock.hooks.set(mock.path, hooks);
      return hooks[i] ?? (hooks[i] = { current: value });
    },
    useMemo: (fn: () => unknown) => fn(),
    useId: () => "email-dialog",
    useEffect: (fn: () => void, deps: unknown[]) => {
      const i = mock.index++,
        hooks = mock.hooks.get(mock.path) ?? [];
      mock.hooks.set(mock.path, hooks);
      const old = hooks[i] as unknown[] | undefined;
      if (!old || deps.some((d, j) => d !== old[j])) {
        hooks[i] = deps;
        mock.effects.push(fn);
      }
    },
    useTransition: () => [
      false,
      (fn: () => unknown) => {
        mock.promises.push(Promise.resolve(fn()));
      },
    ],
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => ({
    type: "a",
    props: { ...props, children },
  }),
}));
vi.mock("../../app/(workspace)/partner/email/actions", () => ({
  readPartnerEmail: mock.read,
  mutatePartnerEmail: mock.mutate,
}));
import { PartnerEmailProgramView } from "./partner-email-program";
import {
  partnerEmailProgramFixture,
  partnerEmailFixtureDetail,
} from "../../lib/partner/email-program-fixtures";
import { forecastPartnerEmails } from "../../lib/partner/email-program";
const today = "2026-11-04";
const id = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type El = { type: unknown; props: Record<string, unknown> };
function expand(node: unknown, path = "root"): unknown {
  if (Array.isArray(node)) return node.map((n, i) => expand(n, `${path}.${i}`));
  if (!node || typeof node !== "object" || !("props" in node)) return node;
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === "function") {
    const previous = mock.path,
      previousIndex = mock.index;
    mock.path = `${path}:${el.type.name}`;
    mock.index = 0;
    const output = (el.type as (p: unknown) => unknown)(el.props);
    const expanded = expand(output, `${path}.fn`);
    mock.path = previous;
    mock.index = previousIndex;
    return expanded;
  }
  return {
    type: el.type,
    props: { ...el.props, children: expand(el.props.children, `${path}.child`) },
  };
}
function render(change: Partial<Parameters<typeof PartnerEmailProgramView>[0]> = {}) {
  const snapshot = partnerEmailProgramFixture(today);
  const tree = expand(
    <PartnerEmailProgramView
      snapshot={snapshot}
      forecast={forecastPartnerEmails(snapshot)}
      founder
      preview={false}
      {...change}
    />,
  );
  const effects = mock.effects.splice(0);
  for (const effect of effects) effect();
  return tree;
}
function descendants(node: unknown): El[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as El;
  return [el, ...descendants(el.props.children)];
}
function words(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(words).join("");
  if (node && typeof node === "object" && "props" in node)
    return words((node as El).props.children);
  return "";
}
const button = (tree: unknown, label: string) => {
  const result = descendants(tree).find((el) => el.type === "button" && words(el).includes(label));
  expect(result, label).toBeDefined();
  return result!;
};
async function click(el: El) {
  expect(el.props.disabled).not.toBe(true);
  await (el.props.onClick as () => unknown)();
  while (mock.promises.length) await Promise.all(mock.promises.splice(0));
}
const input = (tree: unknown, type: "input" | "textarea") =>
  descendants(tree).find((el) => el.type === type && (type === "textarea" || !el.props.type))!;
const type = (el: El, value: string) =>
  (el.props.onChange as (e: unknown) => void)({ target: { value } });
beforeEach(() => {
  vi.clearAllMocks();
  mock.hooks.clear();
  mock.effects = [];
  mock.promises = [];
  mock.uuid = 0;
  vi.stubGlobal("crypto", { randomUUID: () => id(700 + mock.uuid++) });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("document", { activeElement: null, body: { style: { overflow: "" } } });
  mock.read.mockImplementation(async ({ kind, id: key }) => ({
    status: "success",
    detail: partnerEmailFixtureDetail(today, kind, key),
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("calendario email", () => {
  it("mantiene visibile in revisione anche una riga non pronta diventata non idonea", async () => {
    const snapshot = partnerEmailProgramFixture(today);
    snapshot.items[3].eligible = false;
    const props = { snapshot, forecast: forecastPartnerEmails(snapshot) };
    await click(button(render(props), "Da rivedere"));
    const tree = render(props);
    expect(words(tree)).toContain("Club Esempio 4");
    expect(words(tree)).toContain("non è attualmente idoneo");
  });
  it("distingue gli invii confermati dai posti occupati nella quota", () => {
    const snapshot = partnerEmailProgramFixture(today);
    snapshot.todaySent.club = 1;
    const tree = render({ snapshot, forecast: forecastPartnerEmails(snapshot) });
    expect(words(tree)).toContain("0 email inviate oggi");
    expect(words(tree)).toContain("Posti occupati nella quota: 1");
  });
  it("rende visibile il fermo della casella anche in modalità invio", () => {
    const snapshot = partnerEmailProgramFixture(today);
    snapshot.mail.stopReason = "casella";
    const tree = render({ snapshot, forecast: forecastPartnerEmails(snapshot) });
    expect(words(tree)).toContain("Invii fermi");
    expect(words(tree)).not.toContain("Invii attivi");
  });
  it("mostra anche giorno locale e fuso quando differiscono dal giorno di Roma", () => {
    const snapshot = partnerEmailProgramFixture(today);
    snapshot.items[0].timezone = "Pacific/Auckland";
    const forecast = forecastPartnerEmails(snapshot);
    forecast.items[0].plannedAt = `${today}T20:30:00Z`;
    const tree = render({ snapshot, forecast });
    expect(words(tree)).toContain("5 novembre · Pacific/Auckland");
    expect(words(tree)).toContain("4 novembre · Roma");
  });
  it("mostra anche chi è in coda senza un lavoro o un testo ancora preparato", async () => {
    await click(button(render(), "Da preparare"));
    const tree = render();
    expect(words(tree)).toContain("Club Nuovo Esempio");
    expect(words(tree)).toContain("La preparazione è in pausa per credito");
    expect(
      descendants(tree).find((el) => el.type === "a" && words(el).includes("Club Nuovo Esempio"))
        ?.props.href,
    ).toBe("/partner?co=958");
    expect(mock.read).not.toHaveBeenCalled();
  });
  it("mantiene le sezioni e le viste delle email da preparare e già inviate", () => {
    const tree = render();
    for (const label of [
      "Vendita",
      "Eventi",
      "Collab",
      "Club",
      "Da preparare",
      "Da rivedere",
      "Inviate",
    ])
      expect(words(tree)).toContain(label);
    expect(words(tree)).toContain("Le prossime bozze presenteranno brand");
  });
  it("leggere una bozza non la sospende né la modifica", async () => {
    await click(button(render(), "Porsche Club Esempio"));
    const tree = render();
    expect(mock.read).toHaveBeenCalledWith({ kind: "job", id: id(1) });
    expect(mock.mutate).not.toHaveBeenCalled();
    expect(words(tree)).toContain("Sospendi e modifica");
    expect(descendants(tree).filter((el) => el.type === "textarea")).toHaveLength(0);
  });
  it("prende il hold prima dell'editor e invia il nuovo testo con CAS", async () => {
    let detail = partnerEmailFixtureDetail(today, "job", id(1))!;
    mock.read.mockImplementation(async () => ({ status: "success", detail }));
    mock.mutate.mockImplementation(async (command) => {
      if (command.kind === "begin")
        detail = { ...detail, hold: { id: id(401), version: 1, createdAt: `${today}T08:00:00Z` } };
      else if (command.kind === "save")
        detail = {
          ...detail,
          subject: command.payload.subject,
          body: command.payload.body,
          sha256: "d".repeat(64),
          hold: null,
        };
      return { status: "success", message: "Salvato" };
    });
    await click(button(render(), "Porsche Club Esempio"));
    render();
    await click(button(render(), "Sospendi e modifica"));
    render();
    let tree = render();
    expect(words(tree)).toContain("Solo questa email è sospesa");
    const area = input(tree, "textarea");
    type(area, "Buongiorno,\n\nIl nostro nuovo testo sul brand.\n\nUn saluto,");
    tree = render();
    render();
    const form = descendants(tree).find((el) => el.type === "form")!;
    (form.props.onSubmit as (e: unknown) => void)({ preventDefault: vi.fn() });
    while (mock.promises.length) await Promise.all(mock.promises.splice(0));
    render();
    tree = render();
    const command = mock.mutate.mock.calls.at(-1)![0];
    expect(command.kind).toBe("save");
    expect(command.payload).toMatchObject({
      hold_id: id(401),
      expected_draft_id: id(201),
      expected_sha256: "c".repeat(64),
      body: "Buongiorno,\n\nIl nostro nuovo testo sul brand.\n\nUn saluto,",
    });
    expect(command.payload).not.toHaveProperty("signature");
    expect(words(tree)).toContain("Il nostro nuovo testo sul brand");
  });
  it("un salvataggio incerto ripete la stessa operazione", async () => {
    const detail = partnerEmailFixtureDetail(today, "job", id(3))!;
    mock.read.mockResolvedValue({ status: "success", detail });
    mock.mutate.mockResolvedValue({ status: "uncertain", message: "Esito da verificare" });
    await click(button(render(), "Da rivedere"));
    await click(button(render(), "Club Esempio 3"));
    render();
    let tree = render();
    const form = descendants(tree).find((el) => el.type === "form")!;
    (form.props.onSubmit as (e: unknown) => void)({ preventDefault: vi.fn() });
    while (mock.promises.length) await Promise.all(mock.promises.splice(0));
    tree = render();
    await click(button(tree, "Verifica la stessa operazione"));
    expect(mock.mutate.mock.calls[1][0]).toEqual(mock.mutate.mock.calls[0][0]);
  });
  it("lo storico non diventa un editor anche se arriva un hold corrente", async () => {
    const detail = {
      ...partnerEmailFixtureDetail(today, "sent", id(501))!,
      hold: { id: id(401), version: 1, createdAt: `${today}T08:00:00Z` },
    };
    mock.read.mockResolvedValue({ status: "success", detail });
    await click(button(render(), "Inviate e tentativi"));
    await click(button(render(), "Negozio Esempio"));
    const tree = render();
    expect(words(tree)).toContain("Questa email è già stata inviata");
    expect(descendants(tree).filter((el) => el.type === "textarea")).toHaveLength(0);
  });
  it("dopo un conflitto può scartare il testo locale e rileggere senza annullare un hold superato", async () => {
    let detail = partnerEmailFixtureDetail(today, "job", id(3))!;
    mock.read.mockImplementation(async () => ({ status: "success", detail }));
    mock.mutate.mockResolvedValue({
      status: "rejected",
      message: "La bozza è cambiata. Rileggi il testo salvato.",
    });
    await click(button(render(), "Da rivedere"));
    await click(button(render(), "Club Esempio 3"));
    render();
    let tree = render();
    type(input(tree, "textarea"), "Testo locale da scartare");
    render();
    tree = render();
    const form = descendants(tree).find((el) => el.type === "form")!;
    (form.props.onSubmit as (e: unknown) => void)({ preventDefault: vi.fn() });
    while (mock.promises.length) await Promise.all(mock.promises.splice(0));
    detail = {
      ...detail,
      body: "Versione salvata da un'altra scheda",
      sha256: "f".repeat(64),
      hold: { ...detail.hold!, version: 2 },
    };
    await click(button(render(), "Scarta le modifiche locali e rileggi"));
    render();
    tree = render();
    expect(input(tree, "textarea").props.value).toBe("Versione salvata da un'altra scheda");
    expect(mock.mutate).toHaveBeenCalledTimes(1);
    expect(mock.mutate.mock.calls[0][0].kind).toBe("save");
  });
  it("non chiude il dettaglio mentre la sospensione è ancora in corso", async () => {
    let resolve!: (value: unknown) => void;
    const detail = partnerEmailFixtureDetail(today, "job", id(1))!;
    mock.read.mockResolvedValue({ status: "success", detail });
    mock.mutate.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await click(button(render(), "Porsche Club Esempio"));
    render();
    let tree = render();
    (button(tree, "Sospendi e modifica").props.onClick as () => void)();
    tree = render();
    const close = descendants(tree).find(
      (el) => el.type === "button" && el.props["aria-label"] === "Chiudi email",
    )!;
    (close.props.onClick as () => void)();
    tree = render();
    expect(words(tree)).toContain("Attendi la conferma dell'operazione in corso");
    expect(descendants(tree).some((el) => el.props.role === "dialog")).toBe(true);
    mock.read.mockResolvedValue({
      status: "success",
      detail: { ...detail, hold: { id: id(401), version: 1, createdAt: `${today}T08:00:00Z` } },
    });
    resolve({ status: "success", message: "Email sospesa" });
    while (mock.promises.length) await Promise.all(mock.promises.splice(0));
    render();
    tree = render();
    expect(words(tree)).toContain("Solo questa email è sospesa");
  });
});
