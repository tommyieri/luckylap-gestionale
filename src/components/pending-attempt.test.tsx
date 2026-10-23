import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Stato della conferma controllato dal test: il componente usa un solo useState.
let confirming = false;
const setConfirming = vi.fn();
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useState: () => [confirming, setConfirming] };
});

import { PendingAttempt, attemptDate, type PendingAttemptProps } from "./pending-attempt";

const OPERATION = "6f1c2a8e-3b4d-4e5f-9a0b-1c2d3e4f5a6b";
const props = (overrides: Partial<PendingAttemptProps> = {}): PendingAttemptProps => ({
  title: "Vendita da verificare",
  lines: ["Canale: Vendita diretta", "2 capi"],
  occurredAt: "2026-10-22T08:00:00.000Z",
  operationId: OPERATION,
  pending: false,
  onRetry: vi.fn(),
  ...overrides,
});
const render = (overrides: Partial<PendingAttemptProps> = {}) =>
  renderToStaticMarkup(<PendingAttempt {...props(overrides)} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

type Clickable = ReactElement<{ onClick?: () => void; disabled?: boolean; children?: unknown }>;
/** Pulsanti dell'albero restituito dal componente, con la loro etichetta. */
function buttons(node: unknown): { label: string; element: Clickable }[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Clickable;
  if (element.type === "button")
    return [{ label: text(renderToStaticMarkup(element)).trim(), element }];
  return buttons(element.props.children);
}
const button = (overrides: Partial<PendingAttemptProps>, label: string) =>
  buttons(PendingAttempt(props(overrides))).find((candidate) => candidate.label === label)?.element;

beforeEach(() => {
  confirming = false;
  setConfirming.mockClear();
});

describe("invio da verificare", () => {
  it("mostra la data in italiano all'ora di Roma, mai la stringa ISO", () => {
    const html = render();
    expect(text(html)).toContain("Data: 22 ott 2026, 10:00");
    expect(html).not.toMatch(/2026-10-22|T08:00|\.000Z/);
    expect(attemptDate("2026-01-15T23:30:00Z")).toBe("16 gen 2026, 00:30");
    expect(attemptDate("non una data")).toBeNull();
    expect(text(render({ occurredAt: "illeggibile" }))).toContain("Data: non leggibile");
  });

  it("tiene l'identificativo solo dentro «Codice per l’assistenza»", () => {
    const html = render();
    const details = html.slice(html.indexOf("<details"));
    expect(html.slice(0, html.indexOf("<details"))).not.toContain(OPERATION);
    expect(details).toMatch(/^<details[^>]*><summary>Codice per l’assistenza<\/summary>/);
    expect(details).not.toMatch(/<details[^>]*open/);
    expect(html.split(OPERATION)).toHaveLength(2);
    expect(text(html)).toContain("Canale: Vendita diretta");
  });

  it("non offre «Scarta» senza onDiscard", () => {
    const html = render({ onReread: vi.fn() });
    expect(html).not.toContain("Scarta");
    expect(html).not.toContain("Hai controllato");
  });

  it("chiede conferma prima di scartare, e solo dopo chiama onDiscard", () => {
    const onDiscard = vi.fn();
    button({ onDiscard }, "Scarta questo tentativo")!.props.onClick!();
    expect(setConfirming).toHaveBeenCalledWith(true);
    expect(onDiscard).not.toHaveBeenCalled();
    confirming = true;
    const html = render({ onDiscard });
    expect(text(html)).toContain(
      "Hai controllato che l’operazione non sia già nell’elenco? Scartare non cancella niente nel gestionale: libera solo questo modulo.",
    );
    expect(html).not.toContain("Scarta questo tentativo");
    button({ onDiscard }, "Annulla")!.props.onClick!();
    expect(onDiscard).not.toHaveBeenCalled();
    button({ onDiscard }, "Sì, scarta il tentativo")!.props.onClick!();
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("ripete lo stesso invio, rilegge e si ferma durante la verifica", () => {
    const onRetry = vi.fn(),
      onReread = vi.fn();
    button({ onRetry, onReread }, "Verifica lo stesso invio")!.props.onClick!();
    button({ onRetry, onReread, rereadLabel: "Rileggi gli ordini" }, "Rileggi gli ordini")!.props
      .onClick!();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onReread).toHaveBeenCalledTimes(1);
    const pending = button({ pending: true, onReread }, "Verifica in corso…")!;
    expect(pending.props.disabled).toBe(true);
    expect(button({ pending: true, onReread }, "Rileggi")!.props.disabled).toBe(true);
    expect(button({}, "Verifica lo stesso invio")!.props.disabled).toBe(false);
  });

  it("un tentativo bloccato non offre la verifica: dice che non si ripete e «Scarta» è l'azione principale", () => {
    const onDiscard = vi.fn(),
      onReread = vi.fn();
    const html = render({ blocked: true, onDiscard, onReread });
    expect(text(html)).toContain(
      "Questo tentativo non può più andare a buon fine, quindi non si ripete.",
    );
    expect(html).not.toContain("Verifica lo stesso invio");
    expect(
      button({ blocked: true, onDiscard, onReread }, "Verifica lo stesso invio"),
    ).toBeUndefined();
    expect(
      button({ blocked: true, onDiscard, onReread }, "Scarta questo tentativo")!.props,
    ).toMatchObject({ className: "button button-primary" });
    expect(button({ blocked: true, onDiscard, onReread }, "Rileggi")!.props).toMatchObject({
      className: "button button-secondary",
    });
    expect(button({ onDiscard }, "Scarta questo tentativo")!.props).toMatchObject({
      className: "button button-secondary",
    });
    expect(text(render())).toContain("«Verifica lo stesso invio» ripete lo stesso tentativo");
  });

  it("bloccato e senza «Scarta» lascia solo la rilettura", () => {
    const labels = buttons(PendingAttempt(props({ blocked: true, onReread: vi.fn() }))).map(
      (candidate) => candidate.label,
    );
    expect(labels).toEqual(["Rileggi"]);
  });
});
