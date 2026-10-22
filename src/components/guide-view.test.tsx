import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GUIDE_PARTS, GuideView, SECTION_TEXT, TAB_TEXT, type GuideAccess } from "./guide-view";
import { SECTIONS } from "../lib/navigation";

const everyone: GuideAccess = { finance: false, ceo: false };
const finance: GuideAccess = { finance: true, ceo: false };
const founder: GuideAccess = { finance: true, ceo: true };

const html = (access: GuideAccess, preview = false) =>
  renderToStaticMarkup(<GuideView access={access} preview={preview} />);
const text = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
/** Il riquadro per chi apre Finance. */
const financeBox = (markup: string) => markup.includes('data-guide="finance"');

describe("«Come si usa»: struttura", () => {
  it("ha le sette parti, nell'ordine dell'indice, ognuna con il suo titolo", () => {
    const markup = html(everyone);
    expect(GUIDE_PARTS.map((part) => part.title)).toEqual([
      "Entrare e uscire",
      "Il menu",
      "Partner",
      "Conto vendita e resoconto del mese",
      "Finance e Controllo CEO",
      "Sul telefono",
      "Se qualcosa non va",
    ]);
    let last = -1;
    for (const part of GUIDE_PARTS) {
      const at = markup.indexOf(`<section id="${part.id}"`);
      expect(at, part.id).toBeGreaterThan(last);
      last = at;
      expect(markup).toContain(`<h2 id="${part.id}-titolo"`);
      expect(markup).toContain(`aria-labelledby="${part.id}-titolo"`);
    }
    expect(markup.match(/<section /g)).toHaveLength(7);
  });

  it("apre con l'h1 «Come si usa» e l'indice che porta a ogni parte", () => {
    const markup = html(everyone);
    expect(markup.match(/<h1>/g)).toHaveLength(1);
    expect(markup).toContain("<h1>Come si usa</h1>");
    const index = markup.slice(markup.indexOf("<nav"), markup.indexOf("</nav>"));
    expect(index).toContain('aria-label="In questa guida"');
    expect(hrefs(index)).toEqual(GUIDE_PARTS.map((part) => `#${part.id}`));
  });

  it("descrive ogni sezione e ogni scheda della mappa del menu, senza voci in più", () => {
    expect(Object.keys(SECTION_TEXT).sort()).toEqual(SECTIONS.map((s) => s.id).sort());
    const tabs = SECTIONS.flatMap((section) => section.tabs.map((tab) => tab.href));
    expect(Object.keys(TAB_TEXT).sort()).toEqual([...tabs].sort());
    for (const value of [...Object.values(SECTION_TEXT), ...Object.values(TAB_TEXT)])
      expect(value.trim().length).toBeGreaterThan(10);
  });

  it("usa solo collegamenti interni: ancore della guida o pagine del gestionale", () => {
    for (const access of [everyone, finance, founder])
      for (const href of hrefs(html(access))) expect(href).toMatch(/^(#guida-[a-z-]+|\/(?!\/))/);
  });

  it("parla la lingua del team: niente parole tecniche", () => {
    const all = text(html(founder, true));
    for (const word of ["RLS", "payload", "harness", "UUID", "Supabase"])
      expect(all).not.toContain(word);
    expect(all).toContain("Magadzino");
  });
});

describe("il menu della persona", () => {
  it("Tommi vede le sette sezioni con i loro link e le schede", () => {
    const markup = html(founder);
    const menu = markup.slice(
      markup.indexOf('id="guida-menu"'),
      markup.indexOf('id="guida-partner"'),
    );
    for (const section of SECTIONS) {
      expect(hrefs(menu)).toContain(section.href);
      expect(text(menu)).toContain(SECTION_TEXT[section.id]);
      for (const tab of section.tabs) expect(hrefs(menu)).toContain(tab.href);
    }
    expect(text(menu).match(/con password/g)).toHaveLength(2);
  });

  it("chi non apre Finance non ha voci né link di Finance e Controllo CEO", () => {
    const markup = html(everyone);
    for (const href of hrefs(markup)) expect(href).not.toMatch(/^\/(finance|audit|auth\/area)/);
    const all = text(markup);
    expect(all).toContain(
      "Finance e Controllo CEO non sono nel tuo menu: il tuo account non li apre.",
    );
    expect(all).not.toContain("con password");
  });

  it("chi apre Finance ma non Controllo CEO vede solo Finance", () => {
    const markup = html(finance);
    expect(hrefs(markup)).toContain("/finance/work");
    expect(hrefs(markup)).not.toContain("/audit");
    expect(hrefs(markup)).not.toContain("/auth/area/audit");
    expect(text(markup)).toContain("Controllo CEO non è nel tuo menu: lo apre solo Tommi.");
  });
});

describe("Finance e Controllo CEO", () => {
  it("dice a tutti cosa sono e chi li apre", () => {
    for (const access of [everyone, finance, founder]) {
      const all = text(html(access));
      expect(all).toContain("La aprono Tommi, Gabriele e Gherardo, con la password Finance.");
      expect(all).toContain("Lo apre solo Tommi, con la password CEO.");
      expect(all).toContain("Costi e margini dei prodotti invece sono nel Magazzino");
    }
  });

  it("il riquadro per aprire e chiudere Finance compare solo a chi può entrarci", () => {
    expect(financeBox(html(everyone))).toBe(false);
    expect(text(html(everyone))).toContain("Il tuo account non apre Finance.");
    for (const access of [finance, founder]) {
      const markup = html(access);
      expect(financeBox(markup)).toBe(true);
      expect(hrefs(markup)).toContain("/auth/area/finance");
      expect(text(markup)).toContain("fino a 8 ore");
    }
    expect(hrefs(html(finance))).not.toContain("/auth/area/audit");
    expect(hrefs(html(founder))).toContain("/auth/area/audit");
  });
});

describe("telefono, conto vendita e aiuto", () => {
  it("elenca la barra in basso e «Altro» secondo il menu della persona", () => {
    expect(text(html(everyone))).toContain(
      "In basso trovi Oggi, Vendite, Magazzino e Partner. In «Altro» ci sono Team, questa guida, «Account e sicurezza» e «Esci».",
    );
    expect(text(html(founder))).toContain(
      "In «Altro» ci sono Team, Finance, Controllo CEO, questa guida, «Account e sicurezza» e «Esci».",
    );
  });

  it("spiega il resoconto del mese in cinque passi, con i pulsanti veri", () => {
    const markup = html(everyone);
    const part = text(
      markup.slice(
        markup.indexOf('id="guida-conto-vendita"'),
        markup.indexOf('id="guida-finance"'),
      ),
    );
    for (const label of [
      "Conta in negozio",
      "«Salva resoconto»",
      "«Segna fattura emessa»",
      "«Registra pagamento»",
      "«Consegnato»",
    ])
      expect(part).toContain(label);
    expect(part).toContain("non dalle Rettifiche");
  });

  it("dice cosa fare con un invio da verificare e a chi chiedere", () => {
    const all = text(html(everyone));
    expect(all).toContain("«Verifica lo stesso invio»");
    expect(all).toContain("«Riprova»");
    for (const name of ["Tommi", "Gabriele", "Ettore", "Gherardo", "Luca"])
      expect(all).toContain(name);
  });

  it("mostra l'avviso dell'anteprima locale solo in anteprima", () => {
    expect(text(html(founder, true))).toContain("Anteprima locale: la guida come la vede Tommi");
    expect(text(html(founder))).not.toContain("Anteprima locale");
  });
});
