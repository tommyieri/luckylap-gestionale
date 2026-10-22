import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// La pagina /partner resa sul server con i dati sintetici (spec 02 §5, §7.1).
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../../app/(workspace)/partner/actions", () => {
  const action = vi.fn();
  return {
    setPartnerState: action,
    savePartner: action,
    recordPartnerActivity: action,
    savePartnerMessage: action,
    restorePartnerMessage: action,
    savePartnerContact: action,
    removePartnerContact: action,
    setPartnerDoNotContact: action,
    resolvePartnerDifference: action,
  };
});
vi.mock("../../app/(workspace)/partner/dati/actions", () => ({
  importPartnerDeviceFile: vi.fn(),
  previewPartnerDeviceFile: vi.fn(),
}));

import { PartnerWorkspace } from "./partner-workspace";
import {
  PARTNER_FIXTURE_MEMBER_ID,
  partnerFixtureDetail,
  partnerFixtureWorkspace,
} from "../../lib/partner/fixtures";
import type { PartnerWorkspace as PartnerWorkspaceData } from "../../lib/partner/model";

const TODAY = "2026-10-22";

function render(
  query: Record<string, string> = {},
  options: { workspace?: PartnerWorkspaceData; preview?: boolean } = {},
) {
  const co = Number(query.co);
  return renderToStaticMarkup(
    <PartnerWorkspace
      workspace={options.workspace ?? partnerFixtureWorkspace(TODAY)}
      detail={query.co ? partnerFixtureDetail(co, TODAY) : null}
      today={TODAY}
      memberId={PARTNER_FIXTURE_MEMBER_ID}
      preview={options.preview ?? false}
      query={query}
    />,
  );
}
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
/** La riga `lead-{co}` della lista, chiusa: niente liste annidate dentro. */
const row = (html: string, co: number) => {
  const start = html.indexOf(`<li id="lead-${co}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</li>", start) + 5);
};
const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => ({
    tag: match[0],
    text: text(match[1]).trim(),
  }));

describe("PartnerWorkspace", () => {
  it("titolo, totali per sezione e conteggi dei periodi con i filtri di default", () => {
    const html = render();
    expect(html).toContain("<h1>Partner</h1>");
    expect(text(html)).toContain(
      "6 contatti · 3 Vendita · 3 Eventi · 4 Collab. Lo stesso posto può stare in più sezioni.",
    );
    const sections = buttons(html)
      .filter((b) => /aria-pressed/.test(b.tag))
      .slice(0, 4);
    expect(sections.map((b) => b.text)).toEqual(["Tutti 6", "Vendita 3", "Eventi 3", "Collab 4"]);
    const periods = buttons(html).filter((b) => /^(Adesso|Dic|Feb|Apr|Da lug)/.test(b.text));
    expect(periods.map((b) => b.text)).toEqual([
      "Adesso 2 contatti",
      "Dic – Gen 1 contatto",
      "Feb – Mar 1 contatto",
      "Apr – Giu 1 contatto",
      "Da lug 2027 1 contatto",
    ]);
    expect(text(html)).toContain("Adesso, entro novembre");
    expect(text(html)).toContain("2 differenze dalla ricerca o dai file da controllare");
  });

  it("cella Adesso scelta in verde pieno; un altro periodo scelto in inchiostro", () => {
    const now = buttons(render()).find((b) => b.text.startsWith("Adesso"))!;
    expect(now.tag).toContain('data-now="true"');
    expect(now.tag).toContain('aria-pressed="true"');
    const later = buttons(render({ periodo: "2" }));
    expect(later.find((b) => b.text.startsWith("Adesso"))!.tag).toContain('aria-pressed="false"');
    expect(later.find((b) => b.text.startsWith("Dic"))!.tag).toContain('aria-pressed="true"');
  });

  it("righe con l'ancora lead-{co}, casella CO e pulsante principale del canale preferito", () => {
    const html = render();
    expect(html.match(/<li id="lead-\d+"/g)).toEqual(['<li id="lead-1"', '<li id="lead-2"']);
    const first = row(html, 1);
    expect(text(first)).toMatch(/CO 001 · Garage Sintetico Uno/);
    expect(first).toContain('href="mailto:info@garage-uno.example.test"');
    expect(text(first)).toContain("Copia");
    expect(text(first)).toContain("Dettagli");
    expect(first).toMatch(/<select id="stato-1"[^>]*>/);
    expect(first).not.toMatch(/<select id="stato-1"[^>]*disabled/);
  });

  it("contatto bloccato: niente pulsanti di contatto, solo il motivo breve", () => {
    const blocked = row(render({ periodo: "3" }), 4);
    expect(blocked).toContain('data-blocked="true"');
    expect(text(blocked)).toContain(
      "Non contattare: Ha chiesto di non ricevere proposte commerciali.",
    );
    expect(blocked).not.toMatch(/href="(mailto:|tel:|https:)/);
  });

  it("filtro senza risultati: messaggio del sito e «Togli i filtri»", () => {
    const html = render({ q: "nessunrisultato" });
    expect(html).not.toContain('<li id="lead-');
    expect(text(html)).toContain(
      "Nessun contatto qui con questi filtri. Prova un altro periodo, un’altra sezione o togli la ricerca.",
    );
    expect(text(html)).toContain("Togli i filtri");
  });

  it("ricerca non ancora importata: avviso con il link ai dati", () => {
    const empty = { ...partnerFixtureWorkspace(TODAY), partners: [], contacts: [], variants: [] };
    empty.differences = [];
    empty.blocks = [];
    const html = render({}, { workspace: empty });
    expect(text(html)).toContain("La ricerca Partner non è ancora stata importata.");
    expect(html).toContain('href="/partner/dati"');
  });

  it("dettagli aperti: messaggi, registro, recapiti, scheda e lista «non contattare»", () => {
    const html = render({ co: "1" });
    const t = text(html);
    expect(html).toContain('id="dettagli-1"');
    for (const part of [
      "Differenze da controllare",
      "Seguito da",
      "Prossima azione",
      "Messaggi pronti · 2 approcci",
      "Scelto",
      "Copia il testo",
      "Segna inviato",
      "Segna sollecito inviato",
      "Salva il testo",
      "Registro",
      "Ha risposto",
      "Perché è in lista",
      "Tutti i contatti",
      "Aggiungi un recapito",
      "Modifica la scheda",
      "Metti tra i non contattare",
    ])
      expect(t).toContain(part);
    // Lookbook allegato dalla route dei membri.
    expect(html).toContain('href="/partner/lookbook/negozi"');
  });

  it("anteprima locale: avviso in alto e stato non modificabile", () => {
    const html = render({}, { preview: true });
    expect(text(html)).toContain("Anteprima locale: dati sintetici, salvataggio disattivato.");
    expect(row(html, 1)).toMatch(/<select id="stato-1"[^>]*disabled/);
  });

  it("lookbook nel piede, dalla route dei membri", () => {
    const html = render();
    for (const code of ["negozi", "eventi", "collab", "porsche_club", "club"])
      expect(html).toContain(`href="/partner/lookbook/${code}"`);
    expect(text(html)).toContain("Ricerca del 20 ottobre 2026, importata il 21 ottobre");
  });
});
