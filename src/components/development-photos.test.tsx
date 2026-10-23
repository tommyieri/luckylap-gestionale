import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * Due modi di provare i componenti, senza DOM: `renderToStaticMarkup` con gli hook veri per
 * il markup; il componente chiamato come funzione, con hook finti, per i gestori (aggiunta,
 * scorrimento, rimozione). Gli hook finti tengono lo stato per posizione, come React.
 */
const mocks = vi.hoisted(() => ({
  real: true,
  states: [] as { value: unknown; set: (next: unknown) => void }[],
  stateIndex: 0,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  refresh: vi.fn(),
  prepare: vi.fn(),
  finalize: vi.fn(),
  remove: vi.fn(),
  move: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (mocks.real) return actual.useState(initial);
      const slot = (mocks.states[mocks.stateIndex++] ??= {
        value: typeof initial === "function" ? (initial as () => unknown)() : initial,
        set: vi.fn((next: unknown) => {
          slot.value =
            typeof next === "function" ? (next as (v: unknown) => unknown)(slot.value) : next;
        }),
      });
      return [slot.value, slot.set];
    },
    useRef: (initial: unknown) =>
      mocks.real ? actual.useRef(initial) : (mocks.refs[mocks.refIndex++] ??= { current: initial }),
    useEffect: (...args: Parameters<typeof actual.useEffect>) =>
      mocks.real ? actual.useEffect(...args) : undefined,
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../app/development/photo-actions", () => ({
  prepareDevelopmentPhotoUploads: mocks.prepare,
  finalizeDevelopmentPhotos: mocks.finalize,
  removeDevelopmentPhoto: mocks.remove,
  moveDevelopmentPhoto: mocks.move,
}));
vi.mock("../lib/development/photo-transfer", () => ({ uploadPhoto: mocks.upload }));

import { DevelopmentPhotos } from "./development-photos";
import { PhotoViewer, type PhotoViewerProps } from "./development-photo-viewer";
import { PhotoImage, PhotoTile } from "./development-photo-image";
import type { DevelopmentPhoto, PhotoCommandResult } from "../lib/development/photos";

const user = "00000000-0000-4000-8000-000000000001";
const project = "00000000-0000-4000-8000-000000000002";
const asset = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const photo = (n: number, overrides: Partial<DevelopmentPhoto> = {}): DevelopmentPhoto => ({
  id: asset(n),
  projectId: project,
  position: n,
  originalName: `IMG_${n}.jpg`,
  contentType: "image/jpeg",
  size: 2_400_000,
  createdAt: "2026-10-23T10:00:00Z",
  createdBy: user,
  ...overrides,
});
const config = { url: "https://example.supabase.co", publishableKey: "sb_publishable_sintetica" };
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
type Props = Record<string, unknown> & { children?: unknown };
/** Elementi dell'albero restituito, senza entrare nei componenti figli. */
function find(
  node: unknown,
  match: (element: ReactElement<Props>) => boolean,
): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, match));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [...(match(element) ? [element] : []), ...find(element.props.children, match)];
}
const byText = (node: unknown, label: string) =>
  find(
    node,
    (element) => element.type === "button" && text(renderToStaticMarkup(element)) === label,
  )[0];
const fake = () => {
  mocks.real = false;
  mocks.stateIndex = 0;
  mocks.refIndex = 0;
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.real = true;
  mocks.states = [];
  mocks.refs = [];
  let n = 0;
  vi.stubGlobal("crypto", {
    ...globalThis.crypto,
    randomUUID: vi.fn(() => `00000000-0000-4000-8000-${String(900 + ++n).padStart(12, "0")}`),
    subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
});

describe("striscia delle foto", () => {
  it("miniature quadrate dalla route privata, pigre, con etichetta e «Aggiungi foto»", () => {
    const html = renderToStaticMarkup(
      <DevelopmentPhotos
        projectId={project}
        projectName="Collab sintetica"
        photos={[photo(1), photo(2, { originalName: "retro.png", contentType: "image/png" })]}
        userId={user}
        config={config}
      />,
    );
    expect(text(html)).toMatch(/^Foto 2 Aggiungi foto/);
    expect(html).toContain(`src="/assets/files/${asset(1)}?preview=1"`);
    expect(html.match(/loading="lazy"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Apri la foto 2 di 2: retro.png"');
    expect(html).toMatch(
      /<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*multiple=""[^>]*hidden=""/,
    );
    expect(html).not.toMatch(/capture=/);
    expect(text(html)).toContain("JPEG, PNG, WebP o HEIC fino a 25 MB, al massimo 10 per volta.");
    expect(html).not.toContain("<dialog");
  });
  it("senza foto lo dice; in anteprima usa le immagini sintetiche", () => {
    const empty = renderToStaticMarkup(
      <DevelopmentPhotos
        projectId={project}
        projectName="Vuoto"
        photos={[]}
        userId={user}
        config={config}
      />,
    );
    expect(text(empty)).toContain("Ancora nessuna foto per questo progetto.");
    const preview = renderToStaticMarkup(
      <DevelopmentPhotos
        projectId={project}
        projectName="Anteprima"
        photos={[photo(1, { previewSrc: "/anteprima/nuovi-prodotti/fronte-sintetico.png" })]}
        userId={user}
        config={config}
        preview
      />,
    );
    expect(preview).toContain('src="/anteprima/nuovi-prodotti/fronte-sintetico.png"');
    expect(preview).not.toContain("/assets/files/");
  });
  it("HEIC che il browser non mostra: riquadro con il nome, mai un'immagine rotta", () => {
    const heic = photo(3, { originalName: "IMG_3.HEIC", contentType: "image/heic" });
    const tile = renderToStaticMarkup(<PhotoTile photo={heic} large />);
    expect(text(tile)).toBe(
      "IMG_3.HEIC Foto HEIC: questo browser non la mostra. Scarica l’originale per vederla.",
    );
    expect(tile).not.toContain("<img");
    fake();
    mocks.states = [{ value: true, set: vi.fn() }];
    const failed = PhotoImage({ photo: heic }) as ReactElement<Props>;
    expect(failed.type).toBe(PhotoTile);
    fake();
    mocks.states = [];
    const image = PhotoImage({ photo: heic }) as ReactElement<Props>;
    expect(image.type).toBe("img");
    (image.props.onError as () => void)();
    expect(mocks.states[0].value).toBe(true);
  });
});

describe("aggiunta", () => {
  const render = (photos = [photo(1)]) => {
    fake();
    return DevelopmentPhotos({
      projectId: project,
      projectName: "Collab sintetica",
      photos,
      userId: user,
      config,
    });
  };
  // Ordine degli useState di DevelopmentPhotos.
  const state = { jobs: 2, busy: 3, notice: 4, pending: 5, viewer: 7 };
  const value = (index: number) => mocks.states[index].value;

  it("rifiuta con un messaggio chiaro i file troppo grandi o di un altro tipo, carica gli altri", async () => {
    mocks.prepare.mockImplementation(
      async ({ photos }: { photos: { operationId: string; mime: string }[] }) => ({
        uploads: photos.map((p) => ({
          assetId: p.operationId,
          path: `${user}/${p.operationId}/f.jpg`,
          token: "t",
          contentType: p.mime,
        })),
      }),
    );
    mocks.upload.mockImplementation(
      async (_config, _upload, _file, onProgress: (n: number) => void) => {
        onProgress(0.4);
        return true;
      },
    );
    mocks.finalize.mockImplementation(async (send: { photos: { operationId: string }[] }) => ({
      assetIds: send.photos.map((p) => p.operationId),
      success: "Foto aggiunta al progetto.",
    }));
    const tree = render();
    const input = find(tree, (element) => element.type === "input")[0];
    (input.props.onChange as (event: unknown) => void)({
      currentTarget: {
        files: [
          new File([new Uint8Array(4)], "IMG_9.jpg", { type: "image/jpeg" }),
          new File([new Uint8Array(4)], "listino.pdf", { type: "application/pdf" }),
          Object.defineProperty(new File([], "enorme.HEIC", { type: "" }), "size", {
            value: 26 * 1024 * 1024,
          }),
        ],
      },
    });
    await vi.waitFor(() => expect(mocks.finalize).toHaveBeenCalledOnce());
    await flush();
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(
      mocks.finalize.mock.calls[0][0].photos.map((p: { originalName: string }) => p.originalName),
    ).toEqual(["IMG_9.jpg"]);
    const jobs = value(state.jobs) as { name: string; message?: string }[];
    expect(jobs.map((job) => [job.name, job.message])).toEqual([
      [
        "listino.pdf",
        "«listino.pdf» non è una foto in un formato accettato: usa JPEG, PNG, WebP o HEIC.",
      ],
      [
        "enorme.HEIC",
        "«enorme.HEIC» supera 25 MB: scegli una foto più leggera o riducila prima di caricarla.",
      ],
    ]);
    expect(value(state.notice)).toEqual({ kind: "success", text: "Foto aggiunta al progetto." });
    expect(value(state.busy)).toBe(false);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    const html = renderToStaticMarkup(render());
    expect(text(html)).toContain("«enorme.HEIC» supera 25 MB");
    expect(html).toContain('role="alert"');
  });

  it("dopo una risposta incerta mostra «Foto da verificare» e ripete lo stesso invio", async () => {
    mocks.prepare.mockImplementation(
      async ({ photos }: { photos: { operationId: string; mime: string }[] }) => ({
        uploads: photos.map((p) => ({
          assetId: p.operationId,
          path: "x",
          token: "t",
          contentType: p.mime,
        })),
      }),
    );
    mocks.upload.mockResolvedValue(true);
    mocks.finalize.mockResolvedValueOnce({ error: "Aggiunta non confermata.", retry: true });
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    const input = find(render(), (element) => element.type === "input")[0];
    (input.props.onChange as (event: unknown) => void)({
      currentTarget: {
        files: [new File([new Uint8Array(4)], "IMG_9.jpg", { type: "image/jpeg" })],
      },
    });
    await vi.waitFor(() => expect(value(state.pending)).not.toBeNull());
    const pending = value(state.pending) as { send: { operationId: string } };
    expect(storage.get(`luckylap-development-photos-v1:${user}:${project}`)).toContain(
      pending.send.operationId,
    );
    const html = renderToStaticMarkup(render());
    expect(text(html)).toContain("Foto da verificare");
    expect(text(html)).toContain("Progetto: «Collab sintetica»");
    expect(text(html)).toContain("1 foto: IMG_9.jpg");
    mocks.finalize.mockResolvedValueOnce({
      assetIds: ["a"],
      success: "Foto aggiunta al progetto.",
    });
    const retry = find(render(), (element) => typeof element.props.onRetry === "function")[0];
    (retry.props.onRetry as () => void)();
    await vi.waitFor(() => expect(value(state.pending)).toBeNull());
    expect(mocks.finalize.mock.calls[1][0].operationId).toBe(pending.send.operationId);
    expect(storage.size).toBe(0);
  });

  it("toccando una miniatura si apre la foto in grande", () => {
    const tree = render([photo(1), photo(2)]);
    const thumb = find(tree, (element) => element.props.id === `miniatura-${asset(2)}`)[0];
    (thumb.props.onClick as () => void)();
    expect(value(state.viewer)).toBe(asset(2));
    const viewer = find(render([photo(1), photo(2)]), (element) => element.type === PhotoViewer)[0];
    expect(viewer.props.currentId).toBe(asset(2));
  });
});

describe("foto in grande", () => {
  const props = (overrides: Partial<PhotoViewerProps> = {}): PhotoViewerProps => ({
    photos: [
      photo(1),
      photo(2),
      photo(3, { originalName: "IMG_3.HEIC", contentType: "image/heic" }),
    ],
    currentId: asset(2),
    projectName: "Collab sintetica",
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onRemove: vi.fn(),
    onMove: vi.fn(),
    ...overrides,
  });
  // Ordine degli useState di PhotoViewer.
  const viewerState = (
    confirming = false,
    busy: string | null = null,
    error = "",
    uncertain = false,
  ) => {
    fake();
    for (const [index, value] of [confirming, busy, error, uncertain].entries())
      mocks.states[index] = { value, set: vi.fn((next) => (mocks.states[index].value = next)) };
  };
  const view = (overrides: Partial<PhotoViewerProps> = {}) => {
    mocks.stateIndex = 0;
    mocks.refIndex = 0;
    return PhotoViewer(props(overrides));
  };

  it("dialog accessibile: titolo, chiudi, precedente e successiva, scarica, sposta, rimuovi", () => {
    const html = renderToStaticMarkup(<PhotoViewer {...props()} />);
    expect(html).toMatch(/<dialog[^>]*aria-labelledby="foto-viewer-title"/);
    expect(text(html)).toContain("Foto 2 di 3 IMG_2.jpg · 2,3 MB · «Collab sintetica»");
    for (const label of ["Chiudi la foto", "Foto precedente", "Foto successiva"])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain(`href="/assets/files/${asset(2)}"`);
    expect(html).toContain(`src="/assets/files/${asset(2)}?preview=1"`);
    expect(html).toMatch(/loading="eager"/);
    for (const label of ["Scarica originale", "Sposta prima", "Sposta dopo", "Rimuovi"])
      expect(text(html)).toContain(label);
    const single = renderToStaticMarkup(
      <PhotoViewer {...props({ photos: [photo(1)], currentId: asset(1) })} />,
    );
    expect(single).not.toContain("Foto successiva");
    expect(text(single)).not.toContain("Sposta");
  });

  it("frecce e pulsanti scorrono in giro; Esc e lo sfondo chiudono", () => {
    viewerState();
    const onSelect = vi.fn(),
      onClose = vi.fn();
    const tree = view({ onSelect, onClose }) as ReactElement<Props>;
    (tree.props.onKeyDown as (event: { key: string }) => void)({ key: "ArrowRight" });
    (tree.props.onKeyDown as (event: { key: string }) => void)({ key: "ArrowLeft" });
    expect(onSelect.mock.calls).toEqual([[asset(3)], [asset(1)]]);
    const next = find(tree, (element) => element.props["aria-label"] === "Foto successiva")[0];
    (next.props.onClick as () => void)();
    expect(onSelect).toHaveBeenLastCalledWith(asset(3));
    (tree.props.onCancel as (event: { preventDefault: () => void }) => void)({
      preventDefault: vi.fn(),
    });
    const backdrop = { target: 1, currentTarget: 1 };
    (tree.props.onClick as (event: unknown) => void)(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
    viewerState();
    const last = view({ onSelect, currentId: asset(3) }) as ReactElement<Props>;
    (
      find(last, (element) => element.props["aria-label"] === "Foto successiva")[0].props
        .onClick as () => void
    )();
    expect(onSelect).toHaveBeenLastCalledWith(asset(1));
  });

  it("«Rimuovi» chiede conferma; due tocchi inviano un solo comando", async () => {
    viewerState();
    const first = view();
    expect(text(renderToStaticMarkup(first as ReactElement))).not.toContain("Sì, rimuovi la foto");
    (byText(first, "Rimuovi").props.onClick as () => void)();
    expect(mocks.states[0].value).toBe(true);
    let done!: (value: PhotoCommandResult) => void;
    const onRemove = vi.fn(() => new Promise<PhotoCommandResult>((resolve) => (done = resolve)));
    const confirm = view({ onRemove });
    expect(text(renderToStaticMarkup(confirm as ReactElement))).toContain(
      "Togli questa foto da «Collab sintetica»? Sparisce dal progetto per tutti; il file resta nell’archivio privato del team.",
    );
    const yes = byText(confirm, "Sì, rimuovi la foto");
    (yes.props.onClick as () => void)();
    (yes.props.onClick as () => void)();
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledWith(photo(2), expect.stringMatching(/^00000000-/));
    done({ success: "Foto tolta dal progetto." });
    await flush();
    expect(mocks.states[0].value).toBe(false);
  });

  it("una rimozione incerta mostra «Rimozione da verificare» e ripete lo stesso invio", async () => {
    viewerState(true);
    const onRemove = vi.fn().mockResolvedValue({ error: "Rimozione non confermata.", retry: true });
    (byText(view({ onRemove }), "Sì, rimuovi la foto").props.onClick as () => void)();
    await flush();
    expect(mocks.states[3].value).toBe(true);
    const pending = view({ onRemove });
    const html = text(renderToStaticMarkup(pending as ReactElement));
    expect(html).toContain("Rimozione da verificare");
    expect(html).toContain("Foto: IMG_2.jpg");
    expect(html).toContain("Rimozione non confermata.");
    const attempt = find(pending, (element) => typeof element.props.onRetry === "function")[0];
    (attempt.props.onRetry as () => void)();
    await flush();
    expect(onRemove.mock.calls[1][1]).toBe(onRemove.mock.calls[0][1]);
  });

  it("sposta prima e dopo con il posto da 1", async () => {
    viewerState();
    const onMove = vi.fn().mockResolvedValue({ success: "Ordine delle foto aggiornato." });
    const tree = view({ onMove });
    (byText(tree, "Sposta prima").props.onClick as () => void)();
    await flush();
    (byText(view({ onMove }), "Sposta dopo").props.onClick as () => void)();
    await flush();
    expect(onMove.mock.calls.map((call) => [call[0].id, call[1]])).toEqual([
      [asset(2), 1],
      [asset(2), 3],
    ]);
  });
});
