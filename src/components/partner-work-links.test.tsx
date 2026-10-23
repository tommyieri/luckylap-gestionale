import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { PartnerWorkCommand, PartnerWorkSnapshot } from "../lib/work-links/model";
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  refresh: vi.fn(),
  states: [] as unknown[],
  index: 0,
  transitions: [] as Promise<unknown>[],
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [
    mocks.index in mocks.states ? mocks.states[mocks.index++] : (mocks.index++, value),
    vi.fn(),
  ],
  useTransition: () => [
    false,
    (fn: () => unknown) => {
      mocks.transitions.push(Promise.resolve(fn()));
    },
  ],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../app/team/partner/actions", () => ({ createPartnerWork: mocks.execute }));
import { PartnerWorkLinks } from "./partner-work-links";
import { PendingAttempt } from "./pending-attempt";
const actorId = "10000000-0000-4000-8000-000000000001",
  partnerId = "20000000-0000-4000-8000-000000000001",
  operationId = "30000000-0000-4000-8000-000000000001",
  linkId = "40000000-0000-4000-8000-000000000001",
  orderId = "50000000-0000-4000-8000-000000000001";
const member = {
  userId: actorId,
  displayName: "Membro sintetico",
  role: "consultant" as const,
  financeAccess: false,
};
const snapshot: PartnerWorkSnapshot = {
  partners: [
    {
      id: partnerId,
      co: 42,
      name: "Partner sintetico",
      sections: ["eventi", "collab"],
      eventStartsOn: "2028-03-26",
      eventEndsOn: "2028-03-27",
      applicationDeadline: null,
      stage: "trattativa",
    },
  ],
  links: [
    {
      id: linkId,
      partnerId,
      kind: "event",
      taskId: null,
      calendarEventId: linkId,
      projectId: null,
      version: 9,
      needsReview: true,
      detached: false,
    },
  ],
  orders: [
    {
      id: orderId,
      reference: "RIF-SINTETICO",
      occurredAt: "2028-03-26T12:00:00Z",
      channel: "direct",
    },
  ],
  eventSales: [],
};
const descendants = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...[element.props.children].flat(Infinity).flatMap(descendants)];
};
const text = (node: unknown): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join(" ")
      : node && typeof node === "object" && "props" in node
        ? text((node as ReactElement<Record<string, unknown>>).props.children)
        : "";
let store: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.index = 0;
  mocks.states = [];
  mocks.states[3] = true;
  mocks.transitions = [];
  store = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => operationId) });
  mocks.execute.mockResolvedValue({
    status: "uncertain",
    message: "Esito sintetico da verificare",
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("Partner collegati al lavoro del team", () => {
  it("mostra scelte esplicite, giornate intere e verifica del commercialista senza importi", () => {
    const tree = PartnerWorkLinks({ snapshot, member }),
      copy = text(tree);
    expect(copy).toContain("Mantieni modifiche manuali");
    expect(copy).toContain("Usa date Partner");
    expect(copy).toContain("giornata intera");
    expect(copy).toContain("commercialista");
    expect(copy).toContain("RIF-SINTETICO");
    expect(copy).not.toMatch(/€|amount_cents|stock_balances|source_snapshot/);
    expect(descendants(tree).some((node) => node.props.href === "/partner?co=42#lead-42")).toBe(
      true,
    );
    expect(descendants(tree).some((node) => node.type === "main" || node.type === "aside")).toBe(
      false,
    );
  });
  it("due pressioni nello stesso istante conservano e inviano una sola operazione", async () => {
    mocks.execute.mockImplementation(async () => {
      expect(store.size).toBe(1);
      return { status: "uncertain", message: "Da verificare" };
    });
    const tree = PartnerWorkLinks({ snapshot, member });
    const button = descendants(tree).find(
      (node) => node.type === "button" && text(node) === "Crea progetto per Produzione",
    )!;
    (button.props.onClick as () => void)();
    (button.props.onClick as () => void)();
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({
      operationId,
      actorId,
      payload: { schema_version: 1, kind: "project", partner_id: partnerId },
    });
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    await Promise.all(mocks.transitions);
  });
  it("recupera UUID e versione originali anche se il collegamento corrente è cambiato", async () => {
    const frozen: PartnerWorkCommand = {
      operationId,
      actorId,
      payload: {
        schema_version: 1,
        kind: "resolve",
        link_id: linkId,
        expected_version: 2,
        keep_manual: false,
      },
    };
    mocks.states[2] = frozen;
    const tree = PartnerWorkLinks({ snapshot, member });
    const attempt = descendants(tree).find((node) => node.type === PendingAttempt)!;
    (attempt.props.onRetry as () => void)();
    (attempt.props.onRetry as () => void)();
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({ ...frozen, retry: true });
    expect(crypto.randomUUID).not.toHaveBeenCalled();
    await Promise.all(mocks.transitions);
    expect([...store.values()][0]).toContain('"expected_version":2');
  });
  it("conserva scelta, evento e ordine per l’associazione facoltativa di una vendita", async () => {
    vi.stubGlobal(
      "FormData",
      class {
        get() {
          return orderId;
        }
      },
    );
    const tree = PartnerWorkLinks({ snapshot, member });
    const form = descendants(tree).find((node) => node.type === "form")!;
    (form.props.onSubmit as (event: unknown) => void)({
      preventDefault: vi.fn(),
      currentTarget: {},
    });
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({
      operationId,
      actorId,
      payload: {
        schema_version: 1,
        kind: "link_sale",
        partner_id: partnerId,
        event_id: linkId,
        order_id: orderId,
      },
    });
    await Promise.all(mocks.transitions);
  });
  it("mantiene disabilitati gli invii durante un tentativo da verificare", () => {
    mocks.states[2] = {
      operationId,
      actorId,
      payload: { schema_version: 1, kind: "project", partner_id: partnerId },
    };
    const tree = PartnerWorkLinks({ snapshot, member });
    const actions = descendants(tree).filter(
      (node) =>
        node.type === "button" &&
        ["Mantieni modifiche manuali", "Usa date Partner", "Crea progetto per Produzione"].includes(
          text(node),
        ),
    );
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((button) => button.props.disabled)).toBe(true);
  });
  it("mostra i collegamenti esistenti senza presentare una seconda creazione", () => {
    const current = {
      ...snapshot,
      links: [
        ...snapshot.links,
        {
          ...snapshot.links[0],
          id: orderId,
          kind: "project" as const,
          calendarEventId: null,
          projectId: orderId,
          needsReview: false,
        },
      ],
      eventSales: [{ eventId: linkId, orderId, partnerId }],
    };
    const tree = PartnerWorkLinks({ snapshot: current, member });
    expect(text(tree)).toContain("Apri progetto");
    expect(text(tree)).toContain("Apri vendita");
    expect(text(tree)).not.toContain("Crea progetto per Produzione");
    expect(
      descendants(tree).some((node) => node.props.href === `/development#progetto-${orderId}`),
    ).toBe(true);
  });

  const second = {
    id: orderId,
    co: 43,
    name: "Raduno sintetico con accordo",
    sections: ["eventi"],
    eventStartsOn: "2026-05-02",
    eventEndsOn: "2026-05-03",
    applicationDeadline: null,
    stage: "chiuso",
  };
  const two = { ...snapshot, partners: [...snapshot.partners, second], links: [] };
  const eventButton = (tree: unknown) =>
    descendants(tree).find((node) => node.type === "button" && text(node) === "Collega l’evento")!;
  it("con ?co=43 apre il contatto scelto dal blocco «Esito»", () => {
    const tree = PartnerWorkLinks({ snapshot: two, member, initialCo: 43 });
    expect(descendants(tree).find((node) => node.type === "h2")?.props.children).toBe(
      "Raduno sintetico con accordo",
    );
    expect(
      descendants(tree).find((node) => node.type === "select" && node.props.value !== undefined)
        ?.props.value,
    ).toBe(orderId);
    expect(text(PartnerWorkLinks({ snapshot: two, member, initialCo: 999 }))).toContain(
      "Partner sintetico",
    );
  });
  it("accordo fatto con l’evento passato: «Collega l’evento» attivo e spiegato", () => {
    const tree = PartnerWorkLinks({ snapshot: two, member, initialCo: 43 });
    expect(eventButton(tree).props.disabled).toBe(false);
    expect(text(tree)).toContain("L’evento è già passato: entra lo stesso nel calendario");
    (eventButton(tree).props.onClick as () => void)();
    expect(mocks.execute).toHaveBeenCalledWith({
      operationId,
      actorId,
      payload: { schema_version: 1, kind: "event", partner_id: orderId },
    });
  });
  it("senza accordo o senza date dice cosa manca", () => {
    const tree = PartnerWorkLinks({ snapshot: { ...snapshot, links: [] }, member });
    expect(eventButton(tree).props.disabled).toBe(true);
    expect(text(tree)).toContain("Prima segna l’accordo fatto nella scheda Partner");
    const undated = {
      ...two,
      partners: [{ ...second, eventStartsOn: null, eventEndsOn: null }],
    };
    const empty = PartnerWorkLinks({ snapshot: undated, member, initialCo: 43 });
    expect(eventButton(empty).props.disabled).toBe(true);
    expect(text(empty)).toContain("Mancano le date dell’evento");
  });
  it("anteprima locale: dati sintetici e nessun invio", () => {
    const tree = PartnerWorkLinks({ snapshot: two, member, initialCo: 43, preview: true });
    expect(text(tree)).toContain("Anteprima locale: dati sintetici, nessun salvataggio.");
    expect(eventButton(tree).props.disabled).toBe(true);
    expect(text(tree)).toContain("dai file «Esporta» dei dispositivi");
  });
});
