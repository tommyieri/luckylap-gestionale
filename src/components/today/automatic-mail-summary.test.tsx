import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomaticMailDay } from "../../lib/today/automatic-mail-model";
import { AutomaticMailSummary } from "./automatic-mail-summary";
import { AgendaContent } from "./today-tiles";
import type { AgendaTask } from "../../lib/today/model";

vi.mock("../../lib/today/server", () => ({ loadAgendaTile: vi.fn(), loadStockTile: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const counts = (sent = 0, scheduled = 0, skipped = 0) => ({
  sent,
  scheduled,
  skipped,
  sending: 0,
  uncertain: 0,
});
function day(): AutomaticMailDay {
  return {
    day: "2026-11-10",
    generatedAt: "2026-11-10T08:00:00Z",
    state: "automatic",
    stateLabel: "Invio automatico secondo il calendario.",
    followupMode: "invio",
    totals: counts(1, 11),
    groups: [
      {
        key: "other",
        label: "Altri contatti",
        limit: 3,
        counts: counts(1, 2),
        rows: [
          {
            id: "prima-sintetica",
            partnerId: "partner-sintetico",
            co: 951,
            name: "Museo sintetico",
            href: "/partner?co=951#lead-951",
            kind: "primo",
            status: "sent",
            plannedAt: "2026-11-10T08:00:00Z",
            sentAt: "2026-11-10T08:00:10Z",
            localDay: "2026-11-10",
            localTime: "09:00",
            timezone: "Europe/Rome",
            reasonLabel: "",
          },
        ],
      },
      { key: "club", label: "Club", limit: 3, counts: counts(0, 3), rows: [] },
      { key: "followup", label: "Solleciti", limit: 6, counts: counts(0, 6), rows: [] },
    ],
  };
}

describe("Un’unica attività automatica in Oggi", () => {
  it("mostra il totale reale e i tre gruppi, con destinatari dietro un dettaglio chiuso", () => {
    const html = renderToStaticMarkup(<AutomaticMailSummary data={day()} />);
    const overview = html.slice(0, html.indexOf("<details"));
    expect(overview).toContain("12 email");
    expect(overview).toContain("1 inviata");
    for (const label of ["Altri contatti", "Club", "Solleciti", "Le invia il gestionale"])
      expect(overview).toContain(label);
    expect(overview).not.toContain("Museo sintetico");
    expect(html).toContain("Museo sintetico");
    expect(html).toContain("/partner?co=951#lead-951");
    expect(html).not.toMatch(/<details[^>]*\bopen(?:[ =>])/);
    expect(html).not.toContain("Ha risposto");
    expect(html).not.toContain('type="checkbox"');
  });

  it("i limiti non diventano dodici email promesse, né gli invii saltati entrano nel totale", () => {
    const data = day();
    data.totals = counts(2, 0, 10);
    data.groups = data.groups.map((group) => ({ ...group, counts: counts(), rows: [] }));
    data.groups[0]!.counts = counts(2, 0, 10);
    const html = renderToStaticMarkup(<AutomaticMailSummary data={data} />);
    expect(html).toContain("2 email");
    expect(html).not.toContain("12 email");
    expect(html).toContain("10 invii da verificare");
  });

  it("distingue attesa della posta e solleciti non leggibili da un invio automatico attivo", () => {
    const data = day();
    data.state = "paused";
    data.stateLabel = "Invii fermi: controlla lo stato della posta.";
    data.followupMode = "unknown";
    const html = renderToStaticMarkup(<AutomaticMailSummary data={data} />);
    expect(html).toContain(data.stateLabel);
    expect(html).toContain("Stato dei solleciti da verificare");
    expect(html).not.toContain("Le invia il gestionale");
  });

  it("conserva la data locale diversa dal giorno di Roma e non inventa un orario mancante", () => {
    const data = day();
    data.groups[0]!.rows[0]!.localDay = "2026-11-09";
    data.groups[0]!.rows[0]!.localTime = "15:00";
    data.groups[0]!.rows[0]!.timezone = "America/Los_Angeles";
    const html = renderToStaticMarkup(<AutomaticMailSummary data={data} />);
    expect(html).toContain("9 nov");
    expect(html).toContain("15:00");
    expect(html).toContain("America/Los_Angeles");
    data.groups[0]!.rows[0]!.localTime = null;
    expect(renderToStaticMarkup(<AutomaticMailSummary data={data} />)).toContain(
      "Orario locale non disponibile",
    );
  });
});

describe("Agenda compatta", () => {
  it("conserva tutti i compiti manuali, inclusi i controlli delle risposte, in un unico elenco chiuso", () => {
    const tasks = Array.from({ length: 12 }, (_, index): AgendaTask => ({
      task: {
        id: `attivita-${index}`,
        title: `Controllo sintetico ${index}`,
        description: "",
        status: "todo",
        dueAt: "2026-11-09T23:00:00Z",
        assignedTo: "membro-sintetico",
      } as AgendaTask["task"],
      dueDay: "2026-11-10",
      late: index < 2,
    }));
    const html = renderToStaticMarkup(<AgendaContent day="2026-11-10" events={[]} tasks={tasks} />);
    expect(html).toContain("12 attività da fare");
    expect(html).toContain("2 in ritardo");
    expect(html.match(/href="\/team#attivita-/g)).toHaveLength(12);
    expect(html).not.toMatch(/<details[^>]*\bopen(?:[ =>])/);
    expect(html).not.toContain("Nessun impegno");
  });
});
