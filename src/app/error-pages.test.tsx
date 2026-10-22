import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RootError from "./error";
import GlobalError from "./global-error";
import RootLoading from "./loading";
import NotFound from "./not-found";
import WorkspaceError from "./(workspace)/error";
import WorkspaceLoading from "./(workspace)/loading";
import WorkspaceNotFound from "./(workspace)/not-found";

type ErrorPage = (props: { error: unknown; retry: () => void }) => ReactNode;
const ERROR_PAGES: [string, ErrorPage][] = [
  ["radice", RootError],
  ["gruppo", WorkspaceError],
  ["globale", GlobalError],
];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const withDigest = (message: string, digest?: string) =>
  Object.assign(new Error(message), digest === undefined ? {} : { digest });

/** Cerca nel albero degli elementi (senza renderizzare) il pulsante con quell'etichetta. */
function findButton(node: unknown, label: string): ReactElement<{ onClick?: () => void }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const element = node as ReactElement<{ children?: unknown; onClick?: () => void }>;
  if (element.type === "button" && text(renderToStaticMarkup(element)).trim() === label)
    return element;
  return findButton(element.props.children, label);
}

describe("pagine inesistenti", () => {
  it("dicono «Pagina non trovata.» in italiano e portano a Oggi", () => {
    for (const html of [
      renderToStaticMarkup(<NotFound />),
      renderToStaticMarkup(<WorkspaceNotFound />),
    ]) {
      expect(text(html)).toContain("Pagina non trovata.");
      expect(text(html)).toContain("L’indirizzo non esiste o è cambiato.");
      expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Vai a Oggi<\/a>/);
      expect(html).not.toMatch(/not found|404/i);
    }
  });
});

describe("pagine di errore", () => {
  it.each(ERROR_PAGES)("%s: «Riprova» chiama retry", (_, Page) => {
    const retry = vi.fn();
    const button = findButton(Page({ error: withDigest("x"), retry }), "Riprova");
    expect(button).not.toBeNull();
    expect(retry).not.toHaveBeenCalled();
    button!.props.onClick!();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each(ERROR_PAGES)("%s: «Vai a Oggi» porta a /", (_, Page) => {
    const html = renderToStaticMarkup(<Page error={withDigest("x")} retry={() => {}} />);
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Vai a Oggi<\/a>/);
  });

  it.each(ERROR_PAGES)("%s: testo italiano, mai error.message", (_, Page) => {
    const error = withDigest("Dettaglio interno con password e query SQL", "4012345678");
    const html = renderToStaticMarkup(<Page error={error} retry={() => {}} />);
    expect(text(html)).toContain("Qualcosa non ha funzionato.");
    expect(text(html)).toContain("controlla prima che non sia già presente, poi riprova.");
    expect(html).not.toContain("Dettaglio interno");
    expect(html).not.toMatch(/password e query|SQL/);
    expect(text(html)).toContain("Codice per Tommi: 4012345678");
  });

  it.each(ERROR_PAGES)("%s: il codice per Tommi compare solo con il digest", (_, Page) => {
    for (const error of [
      new Error("senza digest"),
      "testo lanciato",
      { digest: "non-un-errore" },
      null,
      withDigest("digest strano", "<script>"),
    ]) {
      const html = renderToStaticMarkup(<Page error={error} retry={() => {}} />);
      expect(html).not.toContain("Codice per Tommi");
      expect(html).not.toContain("senza digest");
      expect(html).not.toContain("<script>");
    }
  });

  it("la pagina globale ha il suo documento in italiano e il suo titolo", () => {
    const html = renderToStaticMarkup(<GlobalError error={withDigest("x")} retry={() => {}} />);
    expect(html).toMatch(/^<html lang="it">/);
    expect(html).toContain("<title>Errore · LuckyLap</title>");
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Vai a Oggi<\/a>/);
  });
});

describe("caricamento", () => {
  it("annuncia «Caricamento…» senza animazioni, dentro e fuori dal guscio", () => {
    for (const html of [
      renderToStaticMarkup(<RootLoading />),
      renderToStaticMarkup(<WorkspaceLoading />),
    ]) {
      expect(html).toMatch(/role="status"[^>]*>Caricamento…</);
      expect(html).toContain('aria-busy="true"');
      expect(html).not.toMatch(/animation|spinner/i);
    }
  });
});
