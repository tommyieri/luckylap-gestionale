import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PartnerCalendarItem } from "../../lib/partner/database-activity";
import { PartnerDatabaseCalendar } from "./partner-database-calendar";
import { PartnerDatabaseInsights } from "./partner-database-insights";

const today = "2026-11-12";
const historic: PartnerCalendarItem = {
  id: "attivita:demo",
  co: 9801,
  partnerId: "contatto-sintetico",
  name: "Contatto sintetico storico",
  day: "2024-03-01",
  endDay: null,
  kind: "inviata",
  label: "Prima email registrata · vecchio sito",
  origin: "file",
  occurredAt: "2024-03-01T11:00:00Z",
  messageKind: "primo",
  channel: "email",
};
const props = {
  today,
  month: "2026-11",
  items: [historic],
  onOpen: () => {},
  onChange: () => {},
  estimatesAvailable: true,
};

describe("viste di calendario e andamento", () => {
  it("indica le voci fuori anno e le mostra nello storico completo", () => {
    const week = renderToStaticMarkup(
      <PartnerDatabaseCalendar {...props} mode="settimana" allHistory={false} />,
    );
    expect(week).toContain("Apri lo storico");
    expect(week).not.toContain(historic.name);
    const history = renderToStaticMarkup(
      <PartnerDatabaseCalendar {...props} mode="lista" allHistory />,
    );
    expect(history).toContain("Tutto lo storico");
    expect(history).toContain(historic.name);
    expect(history).toContain("1 marzo 2024");
  });

  it("apre lo storico a blocchi e segnala quante voci restano", () => {
    const items = Array.from({ length: 201 }, (_, index) => ({
      ...historic,
      id: `voce-${index}`,
      name: `Voce sintetica ${index + 1}`,
    }));
    const history = renderToStaticMarkup(
      <PartnerDatabaseCalendar {...props} items={items} mode="lista" allHistory />,
    );
    expect(history).toContain("Voce sintetica 200");
    expect(history).not.toContain("Voce sintetica 201");
    expect(history).toContain("Mostra l’ultima voce");
  });

  it("distingue registro e stime non disponibili e rende la mappa passata dal workspace", () => {
    const html = renderToStaticMarkup(
      <PartnerDatabaseInsights
        rows={[]}
        items={[]}
        today={today}
        workAvailable={false}
        estimatesAvailable={false}
        heatMap={<p>Mappa sintetica</p>}
        onBreakdown={() => {}}
      />,
    );
    expect(html).toContain("Registro invii e risposte non disponibile");
    expect(html).toContain("Stime delle prime email non disponibili");
    expect(html).toContain("Mappa sintetica");
    expect(html).not.toContain("Invii e risposte per periodo");
  });
});
