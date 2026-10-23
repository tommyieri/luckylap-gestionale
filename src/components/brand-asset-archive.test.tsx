import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  archive: vi.fn(),
  refresh: vi.fn(),
  refs: [] as { current: unknown }[],
  refIndex: 0,
  transitions: [] as Promise<unknown>[],
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (value: unknown) => [value, vi.fn()],
    // Gli stessi oggetti tra una chiamata e l'altra, come in un componente montato.
    useRef: (value: unknown) => (mocks.refs[mocks.refIndex++] ??= { current: value }),
    useTransition: () => [
      false,
      (callback: () => unknown) => {
        mocks.transitions.push(Promise.resolve(callback()));
      },
    ],
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../app/assets/actions", () => ({ setBrandAssetArchived: mocks.archive }));
import { BrandAssetArchive, archivedDate } from "./brand-asset-archive";

const assetId = "00000000-0000-4000-8000-000000000101";
const first = "00000000-0000-4000-8000-000000000201",
  second = "00000000-0000-4000-8000-000000000202";
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
function button(node: unknown): ReactElement<{ onClick: () => void; disabled?: boolean }> {
  const found = [node].flat(Infinity).flatMap(function walk(child: unknown): unknown[] {
    if (!child || typeof child !== "object" || !("props" in child)) return [];
    const element = child as ReactElement<{ children?: unknown }>;
    return element.type === "button"
      ? [element]
      : [element.props.children].flat(Infinity).flatMap(walk);
  });
  expect(found).toHaveLength(1);
  return found[0] as ReactElement<{ onClick: () => void; disabled?: boolean }>;
}
const render = (archivedAt: string | null, onDone = vi.fn()) => {
  mocks.refIndex = 0;
  return BrandAssetArchive({ assetId, assetName: "Foto sintetica", archivedAt, onDone });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refs = [];
  mocks.transitions = [];
  const ids = [first, second];
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => ids.shift()) });
});

describe("archivio di un contenuto", () => {
  it("su un contenuto attivo offre «Archivia» chiuso, con la spiegazione", () => {
    const html = renderToStaticMarkup(render(null));
    expect(html).toMatch(/^<details[^>]*><summary>/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(text(html)).toContain(
      "Il contenuto sparisce dalla libreria per tutti. Puoi ripristinarlo da «Mostra archiviati».",
    );
    expect(text(html)).toContain("Archivia il contenuto");
    expect(text(html)).not.toContain("Ripristina");
  });

  it("su un contenuto archiviato mostra la data italiana e «Ripristina»", () => {
    const html = text(renderToStaticMarkup(render("2026-10-22T23:30:00Z")));
    expect(html).toContain("Archiviato il 23 ottobre 2026.");
    expect(html).toContain("Ripristina");
    expect(html).not.toContain("2026-10-22T");
    expect(archivedDate("non una data")).toBeNull();
    expect(text(renderToStaticMarkup(render("illeggibile")))).toContain("Archiviato. Non compare");
  });

  it("due clic inviano un solo comando, poi ringrazia e rilegge", async () => {
    let done!: (value: unknown) => void;
    mocks.archive.mockReturnValue(new Promise((resolve) => (done = resolve)));
    const onDone = vi.fn();
    const send = button(render(null, onDone)).props.onClick;
    send();
    send();
    expect(mocks.archive).toHaveBeenCalledOnce();
    expect(mocks.archive).toHaveBeenCalledWith({ operationId: first, assetId, archived: true });
    done({ success: "Contenuto archiviato. Lo ritrovi in «Mostra archiviati»." });
    await Promise.all(mocks.transitions);
    expect(onDone).toHaveBeenCalledWith("Contenuto archiviato. Lo ritrovi in «Mostra archiviati».");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("dopo un errore riprova con lo stesso invio; dopo un esito chiaro ne usa uno nuovo", async () => {
    mocks.archive.mockResolvedValueOnce({ error: "Ripristino non riuscito. Ricarica e riprova." });
    button(render("2026-10-22T09:00:00Z")).props.onClick();
    await Promise.all(mocks.transitions);
    expect(mocks.refresh).not.toHaveBeenCalled();
    mocks.archive.mockResolvedValueOnce({ success: "Contenuto ripristinato nella libreria." });
    button(render("2026-10-22T09:00:00Z")).props.onClick();
    await Promise.all(mocks.transitions);
    mocks.archive.mockRejectedValueOnce(new Error("rete"));
    button(render("2026-10-22T09:00:00Z")).props.onClick();
    await Promise.all(mocks.transitions);
    expect(mocks.archive.mock.calls.map((call) => call[0].operationId)).toEqual([
      first,
      first,
      second,
    ]);
    expect(mocks.archive.mock.calls[0][0].archived).toBe(false);
  });
});
