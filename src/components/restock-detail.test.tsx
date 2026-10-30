import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../app/(workspace)/stock/riassortimento/actions", () => ({ runRestockCommand: vi.fn() }));

import {
  ArrivalSection,
  ReceiveForm,
  RestockDeletionForm,
  RestockDetail,
  ShopSection,
} from "./restock-detail";
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
    expect(html).toContain('aria-label="Azioni del riassortimento"');
    expect(t).toContain("Modifica Elimina");
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
    expect(t).toContain("Le quantità ricevute restano nello storico.");
    expect(t).toContain("Le correzioni delle scorte si registrano nelle rettifiche del magazzino");
    expect(t).toContain("Titolo e note si possono ancora modificare.");
    expect(t).not.toContain("Modifica quantità");
    expect(text(renderToStaticMarkup(<ArrivalSection page={arrived} />))).toContain(
      "8 pezzi nel Magazzino sintetico",
    );
    const shop = renderToStaticMarkup(<ShopSection page={arrived} />);
    expect(text(shop)).toContain("Da consegnare a Negozio sintetico");
    expect(shop).toContain(`href="/stock/conto-vendita/NEG01/ordini/nuovo?riordine=${rx.arrived}"`);
    expect(shop).toContain('href="/stock/conto-vendita/NEG01"');
    expect(text(shop)).toContain("Apri il magazzino del negozio Negozio sintetico");
    expect(text(shop)).toContain("Prepara la consegna a Negozio sintetico");
    expect(text(shop)).toContain("Segna come già consegnate");
    const delivered = text(renderToStaticMarkup(<ShopSection page={page(rx.delivered)} />));
    expect(delivered).toContain("Consegnate a Negozio sintetico");
    expect(delivered).toContain("l’ordine n. 2");
    expect(delivered).not.toContain("Prepara la consegna");
  });

  it("eliminato: resta leggibile con storico e ripristino, senza operazioni su arrivo o negozio", () => {
    const deleted = {
      ...page(rx.arrived),
      order: {
        ...page(rx.arrived).order,
        deleted: {
          at: "2026-10-25T10:00:00Z",
          by: "Collega sintetico",
          note: "Riassortimento duplicato per prova",
        },
        deletionEvents: [
          {
            id: "00000000-0000-4000-8000-000000000101",
            deleted: true,
            note: "Riassortimento duplicato per prova",
            at: "2026-10-25T10:00:00Z",
            by: "Collega sintetico",
          },
        ],
      },
    };
    const html = renderToStaticMarkup(<RestockDetail page={deleted} userId="u" />);
    const t = text(html);
    expect(t).toContain("Riassortimento eliminato · recuperabile");
    expect(t).toContain("Eliminato da Collega sintetico");
    expect(t).toContain("Riassortimento duplicato per prova");
    expect(t).toContain("Ripristina");
    expect(t).toContain("Le quantità sono conservate in sola lettura");
    expect(t).toContain("Caricati in magazzino 8 pezzi");
    expect(t).not.toContain("Modifica quantità");
    expect(t).not.toContain("Modifica titolo e note");
    expect(t).not.toContain("Annulla arrivo");
    expect(t).not.toContain("Prepara la consegna");
    expect(t).not.toContain("Segna come già consegnate");
    expect(html).not.toContain('href="/stock/rettifiche"');
    expect(html.match(/disabled=""/g)).toHaveLength(6);
  });

  it("conferma eliminazione e ripristino: motivazione obbligatoria ed effetti sulle scorte espliciti", () => {
    const active = page(rx.quality).order;
    const deletion = renderToStaticMarkup(<RestockDeletionForm order={active} onDone={() => {}} />);
    expect(text(deletion)).toContain("Eliminare «Riordine sintetico di ottobre»?");
    expect(text(deletion)).toContain("Lo storico resta in «Eliminati» e puoi ripristinarlo");
    expect(text(deletion)).toContain("Le scorte del Magadzino e del negozio restano invariate");
    expect(deletion).toContain('aria-label="Elimina riassortimento"');
    expect(deletion).toContain('minLength="3"');
    expect(deletion).toContain('maxLength="500"');
    expect(deletion).toContain('required=""');
    const restoration = renderToStaticMarkup(
      <RestockDeletionForm
        order={{
          ...active,
          deleted: { at: "2026-10-25T10:00:00Z", by: "Collega sintetico", note: "Prova sintetica" },
        }}
        onDone={() => {}}
      />,
    );
    expect(restoration).toContain('aria-label="Ripristina riassortimento"');
    expect(text(restoration)).toContain("Il riassortimento torna in «In corso»");
    expect(text(restoration)).toContain("Sì, ripristina riassortimento");
    expect(text(restoration)).toContain("Nessun carico o consegna viene annullato o ripetuto");
  });
});
