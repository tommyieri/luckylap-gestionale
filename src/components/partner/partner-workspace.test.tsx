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
    setPartnerAssistantMode: action,
    setPartnerAssistantContact: action,
    savePartnerAssistantRules: action,
  };
});
vi.mock("../../app/(workspace)/partner/dati/actions", () => ({
  importPartnerDeviceFile: vi.fn(),
  previewPartnerDeviceFile: vi.fn(),
}));

import { PartnerDataView } from "./partner-data-view";
import { PartnerWorkspace, partnerDetailGone } from "./partner-workspace";
import styles from "./partner.module.css";
import {
  PARTNER_FIXTURE_MEMBER_ID,
  partnerAssistantFixture,
  partnerFixtureData,
  partnerFixtureDetail,
  partnerFixtureWorkspace,
} from "../../lib/partner/fixtures";
import type { PartnerAssistantStatus } from "../../lib/partner/assistant";
import type { PartnerWorkspace as PartnerWorkspaceData } from "../../lib/partner/model";

const TODAY = "2026-10-22";

function render(
  query: Record<string, string> = {},
  options: {
    workspace?: PartnerWorkspaceData;
    preview?: boolean;
    assistant?: PartnerAssistantStatus | null;
  } = {},
) {
  const co = Number(query.co);
  return renderToStaticMarkup(
    <PartnerWorkspace
      workspace={options.workspace ?? partnerFixtureWorkspace(TODAY)}
      detail={query.co ? partnerFixtureDetail(co, TODAY) : null}
      assistant={
        options.assistant === undefined ? partnerAssistantFixture(TODAY).status : options.assistant
      }
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
      "Da lug 2027 0 contatti",
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
    expect(text(blocked)).not.toContain("Come.");
  });

  it("contatto bloccato aperto: niente link per scrivere o chiamare, niente messaggi nuovi", () => {
    const html = render({ periodo: "3", stato: "tutti", co: "4" });
    const start = html.indexOf('id="dettagli-4"');
    expect(start).toBeGreaterThan(0);
    const details = html.slice(start);
    expect(details).not.toMatch(/href="(mailto:|tel:|https:\/\/wa\.me)/);
    expect(text(details)).not.toContain("Scrivi un messaggio");
    expect(text(details)).toContain("niente messaggi nuovi");
    expect(text(details)).toContain("niente link per scrivere o chiamare");
  });

  it("«Copia» sta accanto all'email che copia, anche quando il canale preferito è un altro", () => {
    const second = row(render(), 2);
    expect(second).toMatch(
      /<span[^>]*><a href="mailto:info@raduno-due\.example\.test"[^>]*>.*?<\/a><button[^>]*aria-label="Copia l’indirizzo email"/,
    );
  });

  it("telefono nella riga leggibile, link compatto", () => {
    const third = row(render({ periodo: "2" }), 3);
    expect(third).toContain('href="tel:+390000000003"');
    expect(text(third)).toContain("+39 000 000 0003");
    expect(text(third)).not.toContain("+390000000003");
  });

  it("«Ci siamo»: gli accordi fatti di ogni periodo, con le date nel calendario del team", () => {
    const html = render({ vista: "ci_siamo" });
    const agreed = buttons(html).find((b) => b.text.startsWith("Ci siamo"))!;
    expect(agreed.text).toBe("Ci siamo 1");
    expect(agreed.tag).toContain('aria-pressed="true"');
    const pressed = buttons(html).filter((b) => b.tag.includes('aria-pressed="true"'));
    expect(pressed.map((b) => b.text)).toEqual(["Ci siamo 1"]);
    expect(html.match(/<li id="lead-\d+"/g)).toEqual(['<li id="lead-6"']);
    expect(text(html)).toContain("Ci siamo Accordi fatti");
    expect(text(html)).toContain("Apri il calendario del team");
    const periods = buttons(html).filter((b) => /^(Adesso|Dic|Feb|Apr|Da lug)/.test(b.text));
    expect(periods.map((b) => b.text)[4]).toBe("Da lug 2027 0 contatti");
    expect(html).toContain('href="/team#calendario"');
    const sixth = row(html, 6);
    expect(text(sixth)).toContain("Nel calendario del team");
    expect(sixth).toMatch(/<option value="chiuso" selected="">Accordo fatto<\/option>/);
    // Fuori da «Ci siamo» la stessa scheda non dice «Nel calendario» se non ha l'accordo.
    const second = row(render(), 2);
    expect(text(second)).toContain("Raduno Sintetico Due");
    expect(text(second)).not.toContain("Nel calendario del team");
    const off = buttons(render()).find((b) => b.text.startsWith("Ci siamo"))!;
    expect(off.tag).toContain('aria-pressed="false"');
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

  it("piede: «Assistente» accanto a «Regole per scrivere i messaggi»", () => {
    const html = render();
    const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
    const links = [...footer.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)]
      .map((match) => [match[1], text(match[2]).trim()])
      .filter(([href]) => !href.includes("/lookbook/"));
    expect(links).toEqual([
      ["/partner/dati", "Dati, import e lookbook"],
      ["/partner/regole", "Regole per scrivere i messaggi"],
      ["/partner/assistente", "Assistente"],
    ]);
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
    // «Copia» del destinatario con un nome che si capisce anche senza vedere la riga.
    expect(html).toContain('aria-label="Copia l’indirizzo del destinatario"');
    expect(html).not.toContain('aria-label="Copia: A"');
  });

  it("«Esito» con l'accordo fatto: porta a «Partner nel Team» con il contatto già scelto", () => {
    const agreed = render({ co: "6" });
    expect(text(agreed)).toContain("Esito");
    expect(text(agreed)).toContain("Accordo fatto. Portalo nel lavoro del team");
    expect(agreed).toContain('href="/team/partner?co=6"');
    expect(agreed).toContain(">Apri in Partner nel Team</a>");
    const open = render({ co: "3" });
    expect(open).not.toContain("/team/partner?co=");
    expect(text(open)).not.toContain("Accordo fatto. Portalo");
  });

  it("Indietro dopo i dettagli: nessun avviso «Questo contatto non c'è più»", () => {
    // Indietro: l'indirizzo non chiede più il contatto aperto, il server risponde senza dettaglio.
    expect(partnerDetailGone({ navigating: false, viewCo: 1, queryCo: null, detailCo: null })).toBe(
      false,
    );
    // Indietro verso un altro contatto: risposta per un altro indirizzo.
    expect(partnerDetailGone({ navigating: false, viewCo: 1, queryCo: 2, detailCo: 2 })).toBe(
      false,
    );
    // Dettagli chiesti e non ancora arrivati.
    expect(partnerDetailGone({ navigating: true, viewCo: 3, queryCo: null, detailCo: null })).toBe(
      false,
    );
    expect(partnerDetailGone({ navigating: false, viewCo: 3, queryCo: 3, detailCo: 3 })).toBe(
      false,
    );
    // Il server ha risposto per quel contatto senza dettaglio: non c'è più.
    expect(partnerDetailGone({ navigating: false, viewCo: 3, queryCo: 3, detailCo: null })).toBe(
      true,
    );
    expect(
      partnerDetailGone({ navigating: false, viewCo: null, queryCo: null, detailCo: null }),
    ).toBe(false);
    // Prima resa dopo Indietro: nessun avviso nella pagina.
    expect(render({})).not.toContain("Questo contatto non c");
  });

  it("anteprima locale: avviso in alto e stato non modificabile", () => {
    const html = render({}, { preview: true });
    expect(text(html)).toContain("Anteprima locale: dati sintetici, salvataggio disattivato.");
    expect(row(html, 1)).toMatch(/<select id="stato-1"[^>]*disabled/);
  });

  it("striscia dell'assistente: il primo elemento della pagina, prima del titolo", () => {
    const html = render();
    const strip = `<section class="${styles.assistantStrip}"`;
    expect(html.startsWith(`<div class="${styles.workspace}">${strip}`)).toBe(true);
    expect(html.indexOf(strip)).toBeLessThan(html.indexOf("<h1>Partner</h1>"));
    expect(text(html)).toContain("Assistente: prepara · 1 bozza pronta · 1,37 USD spesi");
    expect(buttons(html).map((b) => b.text)).toContain("Ferma l'assistente");
  });

  it("stato dell'assistente non leggibile: la pagina Partner si vede lo stesso", () => {
    const html = render({ co: "2" }, { assistant: null });
    expect(html).toContain("<h1>Partner</h1>");
    expect(html.match(/<li id="lead-\d+"/g)).toEqual(['<li id="lead-1"', '<li id="lead-2"']);
    expect(html).toContain('id="dettagli-2"');
    expect(html).toContain(`<section class="${styles.assistantStrip}" data-attention="true"`);
    expect(text(html)).toContain("Stato dell'assistente non leggibile");
    expect(buttons(html).map((b) => b.text)).not.toContain("Ferma l'assistente");
  });

  it("scheda aperta: il blocco «Assistente» tra «Esito» e i messaggi", () => {
    for (const co of ["2", "6"]) {
      const html = render({ co });
      const details = html.slice(html.indexOf(`id="dettagli-${co}"`));
      const block = details.indexOf(">Assistente</h4>");
      expect(block, co).toBeGreaterThan(0);
      expect(block, co).toBeLessThan(details.indexOf(`id="messaggi-${co}"`));
      expect(block, co).toBeGreaterThan(details.indexOf("Prossima azione"));
    }
    const agreed = render({ co: "6" });
    expect(agreed.indexOf(">Esito</h4>")).toBeLessThan(agreed.indexOf(">Assistente</h4>"));
    const ready = text(render({ co: "2" }));
    expect(ready).toContain("Bozza pronta");
    expect(ready).toContain("Assistente su questo contatto: attivo");
  });

  it("lookbook nel piede, dalla route dei membri", () => {
    const html = render();
    for (const code of ["negozi", "eventi", "collab", "porsche_club", "club"])
      expect(html).toContain(`href="/partner/lookbook/${code}"`);
    expect(text(html)).toContain("Ricerca del 20 ottobre 2026, importata il 21 ottobre");
  });
});

describe("PartnerDataView", () => {
  it("file del vecchio sito: campo con un'etichetta sua e storico con un titolo visibile", () => {
    const html = renderToStaticMarkup(
      <PartnerDataView data={partnerFixtureData(TODAY)} today={TODAY} preview userId={null} />,
    );
    const t = text(html);
    expect(t).toContain("File del vecchio sito");
    expect(t).toContain("File esportato (.json)");
    expect(html).toMatch(/<h3[^>]*id="dati-file-importati"[^>]*>File già importati<\/h3>/);
    expect(html).toContain('aria-labelledby="dati-file-importati"');
  });
});
