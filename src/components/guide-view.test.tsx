import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GUIDE_PARTS,
  GuideView,
  OPERATIONS,
  SECTION_TEXT,
  TAB_TEXT,
  TODAY_TILES,
  type GuideAccess,
} from "./guide-view";
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
  it("ha le nove parti, nell'ordine dell'indice, ognuna con il suo titolo", () => {
    const markup = html(everyone);
    expect(GUIDE_PARTS.map((part) => part.title)).toEqual([
      "Entrare e uscire",
      "Oggi",
      "Il menu",
      "Le operazioni più comuni",
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
    expect(markup.match(/<section /g)).toHaveLength(9);
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

  it("spiega le parole con i nomi delle colonne di Giacenze e Rettifiche", () => {
    const markup = html(everyone);
    const words = text(
      markup.slice(
        markup.indexOf("Parole che trovi spesso"),
        markup.indexOf('id="guida-operazioni"'),
      ),
    );
    expect(words).toContain("Fisico I capi che ci sono davvero in magazzino.");
    expect(words).toContain("Riservato Già promesso a un ordine.");
    expect(words).toContain("Disponibile Fisico meno riservato");
    expect(words).not.toContain("Pronti");
  });

  it("parla la lingua del team: niente parole tecniche", () => {
    const all = text(html(founder, true));
    for (const word of ["RLS", "payload", "harness", "UUID", "Supabase"])
      expect(all).not.toContain(word);
    expect(all).toContain("Magadzino");
  });
});

describe("Oggi", () => {
  const part = (access: GuideAccess) => {
    const markup = html(access);
    return text(markup.slice(markup.indexOf('id="guida-oggi"'), markup.indexOf('id="guida-menu"')));
  };

  it("elenca i riquadri veri; il conto vendita solo a chi apre Finance", () => {
    const tiles = readFileSync(join(__dirname, "today", "today-tiles.tsx"), "utf8");
    for (const tile of TODAY_TILES) expect(tiles).toContain(`title: "${tile.title}"`);
    expect(TODAY_TILES.filter((tile) => tile.finance).map((tile) => tile.title)).toEqual([
      "Conto vendita da regolare",
    ]);
    for (const title of ["Agenda", "Contatti e solleciti", "Ordini da preparare", "Magazzino"])
      for (const access of [everyone, finance, founder]) expect(part(access)).toContain(title);
    expect(part(everyone)).not.toContain("Conto vendita da regolare");
    expect(part(finance)).toContain("Conto vendita da regolare");
    expect(part(founder)).toContain("Conto vendita da regolare");
  });

  it("spiega «Prima volta qui?» e «Ho capito»", () => {
    expect(part(everyone)).toContain("«Prima volta qui?», che porta a questa guida");
    expect(part(everyone)).toContain("Premi «Ho capito» e su questo browser non torna.");
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

describe("le operazioni più comuni", () => {
  const part = (access: GuideAccess) => {
    const markup = html(access);
    return markup.slice(
      markup.indexOf('id="guida-operazioni"'),
      markup.indexOf('id="guida-partner"'),
    );
  };

  it("una riga e un link per ogni operazione di 06, uguali per tutti", () => {
    expect(OPERATIONS.map((operation) => operation.title)).toEqual([
      "Registrare una vendita",
      "Segnare una consegna",
      "Segnare un incasso",
      "Segnare i capi prodotti",
      "Correggere una quantità in magazzino",
      "Aggiornare scatole e adesivi",
      "Conto vendita: resoconto del mese e nuovo ordine",
      "Aggiungere una call o un’attività",
      "Caricare una foto",
      "Aprire una scheda prodotto",
      "Seguire un prodotto nuovo",
      "Partner: cambiare lo stato e copiare il messaggio",
    ]);
    const markup = part(everyone);
    expect(markup.match(/<li>/g)).toHaveLength(OPERATIONS.length);
    expect(hrefs(markup)).toEqual(OPERATIONS.map((operation) => operation.href));
    for (const href of hrefs(markup)) expect(href).not.toMatch(/^\/(finance|audit|auth)/);
    expect(part(founder)).toBe(markup);
  });

  it("usa i nomi veri delle pagine e dei pulsanti", () => {
    const copy = text(part(everyone));
    for (const label of [
      "«Nuova vendita»",
      "«Registra vendita»",
      "«Registra una consegna»",
      "«Conferma uscita fisica»",
      "«Dichiara incasso ricevuto»",
      "«Produzione da completare»",
      "«Registra capi pronti»",
      "«Registra rettifica»",
      "«Modifica quantità»",
      "«Conferma quantità»",
      "«Aggiungi appuntamento»",
      "«Aggiungi attività»",
      "«Aggiungi un contenuto»",
      "«Carica originale»",
      "«Dettaglio prodotto»",
      "«Crea scheda prodotto»",
      "«Copia il testo»",
      "«Segna inviato»",
    ])
      expect(copy).toContain(label);
  });

  it("dice chi le fa di solito: ognuno trova il suo lavoro", () => {
    const copy = text(part(everyone));
    for (const name of ["Ettore", "Gabriele", "Luca", "Tommi"])
      expect(copy).toContain(`di solito ${name}`);
    expect(copy).toContain("Lo possono fare Tommi e Gabriele.");
  });
});

describe("Partner", () => {
  const part = (access: GuideAccess) => {
    const markup = html(access);
    return markup.slice(
      markup.indexOf('id="guida-partner"'),
      markup.indexOf('id="guida-conto-vendita"'),
    );
  };

  it("dice chi riceve il sollecito, quando scade e cosa lo chiude", () => {
    const copy = text(part(everyone));
    expect(copy).toContain("«Segna inviato» e «Segna sollecito inviato» creano per te");
    expect(copy).toContain("che scade dopo 7 giorni");
    expect(copy).toContain("«Contatti e solleciti»");
    for (const closing of ["«Ha risposto»", "«Accordo fatto»", "«Non interessato»"])
      expect(copy).toContain(closing);
    expect(copy).toContain("un «Contattato» del file crea il sollecito per chi carica il file");
    expect(copy).toContain("la conferma ti dice il giorno");
    expect(copy).toContain("«Ha risposto», qui o in Oggi");
    expect(copy).toContain("il riquadro «Esito»");
  });

  it("porta a «Partner nel Team» per tutti", () => {
    for (const access of [everyone, finance, founder]) {
      expect(hrefs(part(access))).toEqual(["/partner", "/team/partner"]);
      expect(text(part(access))).toContain("«Partner nel Team»");
    }
  });
});

describe("Finance e Controllo CEO", () => {
  it("dice a tutti cosa sono e chi li apre", () => {
    for (const access of [everyone, finance, founder]) {
      const all = text(html(access));
      expect(all).toContain("La aprono Tommi, Gabriele e Gherardo, con la password Finance.");
      expect(all).toContain("Lo apre solo Tommi, con la password CEO.");
      expect(all).toContain("per esempio «Luca ha aggiunto una call»");
      expect(all).toContain("Costi e margini dei prodotti invece sono nel Magazzino");
    }
  });

  it("spiega come si corregge e si ripristina un movimento solo a chi apre Finance", () => {
    expect(text(html(everyone))).not.toContain("«Modifica / storico»");
    for (const access of [finance, founder]) {
      const copy = text(html(access));
      expect(copy).toContain("ogni movimento ha «Modifica / storico»");
      expect(copy).toContain("«Salva correzione»");
      expect(copy).toContain("La motivazione è facoltativa");
      expect(copy).not.toContain("Serve sempre una motivazione");
      expect(copy).toContain("lo stato «Modificati» mostra i movimenti corretti");
      expect(copy).toContain("«Eliminati · recuperabili» e premi «Ripristina / storico»");
    }
  });

  it("dice che gli incassi delle vendite non si eliminano e dove si annulla una vendita", () => {
    expect(text(html(everyone))).not.toContain("non si eliminano da Finance");
    for (const access of [finance, founder]) {
      const copy = text(html(access));
      expect(copy).toContain(
        "Gli incassi delle vendite e i rimborsi Shopify non si eliminano da Finance",
      );
      expect(copy).toContain("annullala in Vendite con «Annulla registrazione»");
      expect(copy).toContain("«Registra reso»");
    }
  });

  it("i filtri del feed li legge solo chi apre Controllo CEO", () => {
    expect(text(html(founder))).toContain("i filtri Persona e Area");
    expect(text(html(founder))).toContain("Le tue compaiono solo se scegli il tuo nome.");
    expect(text(html(finance))).not.toContain("i filtri Persona e Area");
  });

  it("il riquadro per aprire e chiudere Finance compare solo a chi può entrarci", () => {
    expect(financeBox(html(everyone))).toBe(false);
    expect(text(html(everyone))).toContain("Il tuo account non apre Finance.");
    for (const access of [finance, founder]) {
      const markup = html(access);
      expect(financeBox(markup)).toBe(true);
      expect(hrefs(markup)).toContain("/auth/area/finance");
      expect(text(markup)).toContain("fino a 8 ore");
      expect(text(markup)).toContain("premi «Chiudi Finance» in cima alle pagine Finance");
    }
    expect(text(html(finance))).not.toContain("«Chiudi Controllo CEO»");
    expect(text(html(founder))).toContain("con la password CEO e «Chiudi Controllo CEO».");
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
    expect(all).toContain("«Scarta questo tentativo»");
    expect(all).toContain("«Riprova»");
    for (const name of ["Tommi", "Gabriele", "Ettore", "Gherardo", "Luca"])
      expect(all).toContain(name);
  });

  it("mostra l'avviso dell'anteprima locale solo in anteprima", () => {
    expect(text(html(founder, true))).toContain("Anteprima locale: la guida come la vede Tommi");
    expect(text(html(founder))).not.toContain("Anteprima locale");
  });
});

/**
 * La guida cita pulsanti e riquadri di altre pagine: se uno cambia nome, questo test lo dice
 * e la guida si aggiorna insieme (docs: workspace-layout.md, «La guida»).
 */
describe("i nomi citati esistono davvero", () => {
  const ROOT = join(__dirname, "..", "..");
  const source = (path: string) => readFileSync(join(ROOT, path), "utf8");
  const QUOTED: [string, string[]][] = [
    ["src/components/auth-sensitive-area-form.tsx", ["Chiudi Finance", "Chiudi Controllo CEO"]],
    ["src/components/today/guide-intro.tsx", ["Prima volta qui?", "Ho capito"]],
    ["src/components/today/today-tiles.tsx", ["Non riesco a leggere"]],
    ["src/components/refresh-button.tsx", ['"Riprova"']],
    ["src/components/finance-movement-actions.tsx", ["Modifica / storico", "Ripristina / storico"]],
    ["src/components/finance-revision-editor.tsx", ["Salva correzione"]],
    ["src/components/finance-shop-payment-editor.tsx", ["Salva correzione"]],
    ["src/components/finance-imports-view.tsx", ["Eliminati · recuperabili"]],
    ["src/components/audit-view.tsx", ["Apri elemento", "Persona", "Area"]],
    ["src/components/partner/partner-messages.tsx", ["Segna inviato", "Segna sollecito inviato"]],
    ["src/components/partner/partner-activity.tsx", ["Ha risposto"]],
    ["src/components/partner/partner-details.tsx", ["Metti tra i non contattare"]],
    ["src/components/partner/partner-outcome-panel.tsx", [">Esito<", "Apri in Partner nel Team"]],
    ["src/components/today/today-reply-button.tsx", ['"Ha risposto"']],
    ["src/components/partner-work-links.tsx", ["Collega l’evento"]],
    ["src/lib/partner/model.ts", ['"Accordo fatto"', '"Non interessato"']],
    ["src/components/team-workspace.tsx", ["Partner nel Team"]],
    ["src/components/partner-work-links.tsx", ["<h1>Partner nel Team</h1>"]],
  ];

  it("ogni pulsante, riquadro e stato citato è nel suo componente", () => {
    const missing = QUOTED.flatMap(([path, labels]) =>
      labels.filter((label) => !source(path).includes(label)).map((label) => `${path}: ${label}`),
    );
    expect(missing).toEqual([]);
  });

  it("la regola del sollecito è quella del database: invii del team e dei file, 7 giorni", () => {
    const sql = source("supabase/migrations/20261023140100_partner_oggi_fixes.sql");
    expect(sql).toContain("if new.origin not in('team','file')then return new;end if;");
    expect(sql).toContain("select d.imported_by into v_owner from public.partner_device_imports d");
    expect(sql).toContain("::date+7)");
    expect(sql).toContain("'Sollecito · '||v_partner.name");
    expect(sql).toMatch(/'todo',due,v_owner,v_owner\)/);
  });
});
