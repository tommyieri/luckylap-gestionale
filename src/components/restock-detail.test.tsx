import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../app/(workspace)/stock/riassortimento/actions", () => ({ runRestockCommand: vi.fn() }));

import { ArrivalSection, ReceiveForm, RestockDetail, ShopSection } from "./restock-detail";
import { previewRestockPage, rx } from "../lib/restock/fixtures";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const page = (id: string) => previewRestockPage(id)!;

describe("pagina di un riordine", () => {
  it("i cinque passi, quello di adesso segnato; si tocca un passo per spostarlo", () => {
    const html = renderToStaticMarkup(<RestockDetail page={page(rx.quality)} userId="u" preview />);
    const t = text(html);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    for (const label of [
      "Discussione su cosa riordinare",
      "Ordine magliette a Marco",
      "Dal ricamatore",
      "Da Antonella",
      "In mano nostra",
    ])
      expect(t).toContain(label);
    expect(t).toContain("dal 21 ottobre");
    expect(t).toContain("Tocca un passo per spostare il riordine, avanti o indietro.");
    expect(t).toContain("Per Negozio sintetico 9");
    expect(t).toContain("Totale 33");
    expect(t).toContain("Modifica quantità");
    expect(t).toContain("Per il negozio: Negozio sintetico (S, M, L, XL)");
    // Storico dal più recente, con chi e la nota.
    expect(t).toContain("Da «Dal ricamatore» a «Da Antonella»");
    expect(t).toContain("Etichette e cartellini da Antonella");
    expect(html).toContain('href="/stock/riassortimento"');
  });

  it("in «Discussione» rimanda alla giacenza, all'obiettivo e a «Proponi quantità»", () => {
    const t = text(renderToStaticMarkup(<RestockDetail page={page(rx.discussion)} userId="u" />));
    expect(t).toContain("la giacenza del Magazzino sintetico e l’obiettivo");
    expect(t).toContain("«Proponi quantità»");
  });

  it("conferma dell'arrivo: per noi e per il negozio per taglia; il cliente non entra", () => {
    const t = text(renderToStaticMarkup(<ReceiveForm page={page(rx.quality)} onDone={() => {}} />));
    expect(t).toContain("In mano nostra: entrano nel Magazzino sintetico 31 pezzi.");
    expect(t).toContain("Per noi 22");
    expect(t).toContain("Per Negozio sintetico 9");
    expect(t).toContain("GT3RS Blu S 3 M 4 L 4 11");
    expect(t).toContain("GT3RS Bianco S 2 M 2 L 2 XL 2 8");
    expect(t).toContain("escono con la consegna a Negozio sintetico dal Conto vendita");
    expect(t).toContain("2 pezzi per il cliente: non entrano in magazzino né su Shopify.");
    expect(t).toContain("Conferma e carica 31 pezzi");
  });

  it("dopo l'arrivo: quantità ferme, «Annulla arrivo», consegna al negozio già compilata", () => {
    const arrived = page(rx.arrived);
    const t = text(renderToStaticMarkup(<RestockDetail page={arrived} userId="u" />));
    expect(t).toContain("per cambiare le quantità annulla prima l’arrivo");
    expect(t).not.toContain("Modifica quantità");
    expect(text(renderToStaticMarkup(<ArrivalSection page={arrived} />))).toContain(
      "8 pezzi nel Magazzino sintetico",
    );
    const shop = renderToStaticMarkup(<ShopSection page={arrived} />);
    expect(text(shop)).toContain("Da consegnare a Negozio sintetico");
    expect(shop).toContain(`href="/consignment/NEG01/ordini/nuovo?riordine=${rx.arrived}"`);
    expect(text(shop)).toContain("Prepara la consegna a Negozio sintetico");
    expect(text(shop)).toContain("Segna come già consegnate");
    const delivered = text(renderToStaticMarkup(<ShopSection page={page(rx.delivered)} />));
    expect(delivered).toContain("Consegnate a Negozio sintetico");
    expect(delivered).toContain("l’ordine n. 2");
    expect(delivered).not.toContain("Prepara la consegna");
  });
});
