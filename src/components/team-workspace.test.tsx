import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { teamFixtureSnapshot } from "../lib/team/fixtures";
import type { TeamEvent, TeamSnapshot } from "../lib/team/model";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./team-workspace-forms", () => ({
  DeleteTeamForm: ({ title }: { title: string }) => <button>Elimina {title}</button>,
  EditEventForm: ({ event }: { event: TeamEvent }) => <button>Modifica {event.title}</button>,
  EditTaskForm: ({ task }: { task: { title: string } }) => <button>Modifica {task.title}</button>,
  NewEventForm: () => <form aria-label="Nuovo appuntamento" />,
  NewNoteForm: () => null,
  NewTaskForm: () => null,
  ToggleTaskForm: () => <button>Completa</button>,
}));
import { TeamWorkspace } from "./team-workspace";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const days = (html: string) =>
  [...html.matchAll(/<button[^>]*data-day="([^"]+)"[^>]*>(.*?)<\/button>/g)].map((match) => ({
    day: match[1],
    tag: match[0],
    dot: match[2].includes("dot"),
    label: /aria-label="([^"]+)"/.exec(match[0])?.[1] ?? "",
  }));
const event = (fields: Partial<TeamEvent> & Pick<TeamEvent, "startsAt" | "endsAt">): TeamEvent => ({
  id: "71000000-0000-4000-8000-000000000100",
  title: "Evento Partner sintetico",
  eventType: "other",
  details: { summary: "", participantIds: [], callUrl: null, allDay: true },
  createdBy: "71000000-0000-4000-8000-000000000901",
  ...fields,
});
const empty: TeamSnapshot = { members: [], events: [], tasks: [], notes: [] };
function render(snapshot: TeamSnapshot, loadedAt = "2026-10-23T08:00:00Z", preview = false) {
  return renderToStaticMarkup(
    <TeamWorkspace
      snapshot={snapshot}
      displayName="Membro"
      loadedAt={loadedAt}
      preview={preview}
    />,
  );
}

describe("calendario del team a mese", () => {
  it("mese di oggi, settimane da lunedì, giorno di oggi scelto, niente lista dei passati", () => {
    const html = render(teamFixtureSnapshot("2026-10-23"));
    expect(text(html)).toContain("Ottobre 2026");
    expect(text(html)).toContain("Lun Mar Mer Gio Ven Sab Dom");
    expect(html).not.toContain("Mostra anche passati");
    const grid = days(html);
    expect(grid).toHaveLength(31);
    // Il 1° ottobre 2026 è giovedì: tre celle vuote prima del primo giorno.
    const lead = html.slice(html.lastIndexOf("</abbr>"), html.indexOf('data-day="2026-10-01"'));
    expect(lead.match(/<span class="[^"]*" aria-hidden="true"><\/span>/g)).toHaveLength(3);
    const today = grid.find((item) => item.day === "2026-10-23")!;
    expect(today.tag).toContain('aria-pressed="true"');
    expect(today.tag).toContain('aria-current="date"');
    expect(today.tag).toContain('tabindex="0"');
    expect(today.label).toBe("23 ottobre, 2 impegni, oggi");
    expect(grid.filter((item) => item.tag.includes('aria-pressed="true"'))).toHaveLength(1);
    expect(grid.find((item) => item.day === "2026-10-22")!.tag).toContain('tabindex="-1"');
  });

  it("pallino sui giorni con eventi (ogni giorno coperto) e attività con scadenza", () => {
    const grid = days(render(teamFixtureSnapshot("2026-10-23")));
    const dotted = grid.filter((item) => item.dot).map((item) => item.day);
    // Shooting -3, sollecito -1, oggi (call e attività fatta), etichette +1, consegna +2,
    // evento partner di due giorni +5 e +6.
    expect(dotted).toEqual([
      "2026-10-20",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-28",
      "2026-10-29",
    ]);
    expect(grid.find((item) => item.day === "2026-10-28")!.label).toBe("28 ottobre, 1 impegno");
    expect(grid.find((item) => item.day === "2026-10-27")!.label).toBe(
      "27 ottobre, nessun impegno",
    );
  });

  it("il giorno scelto mostra orario, tipo e azioni; gli altri giorni no", () => {
    const html = render(teamFixtureSnapshot("2026-10-23"));
    const panel = text(
      html.slice(html.indexOf("Venerdì 23 ottobre"), html.indexOf('id="attivita"')),
    );
    expect(panel).toContain("Venerdì 23 ottobre · oggi");
    expect(panel).toContain("Call / riunione");
    expect(panel).toContain("10:00–10:45");
    expect(panel).toContain("Con Ada Prova, Bruno Prova");
    expect(panel).toContain("Apri il link della call");
    expect(panel).toContain("Elimina Call produzione");
    expect(panel).toContain("Modifica Call produzione");
    expect(panel).toContain("Attività · Completata");
    expect(panel).toContain("Contare le scatole in Magadzino");
    expect(panel).toContain("Modifica Contare le scatole in Magadzino");
    expect(panel).toContain("Completa");
    expect(panel).not.toContain("Consegna al negozio di prova");
    expect(html).toContain('id="evento-71000000-0000-4000-8000-000000000001"');
    expect(html).toContain('aria-label="Nuovo appuntamento"');
  });

  it("giornata intera senza mezzanotte, anche sui cambi d'ora", () => {
    for (const [startsAt, endsAt, loadedAt, label] of [
      ["2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z", "2026-03-29T10:00:00Z", "Giornata intera"],
      [
        "2026-10-24T22:00:00Z",
        "2026-10-26T23:00:00Z",
        "2026-10-26T10:00:00Z",
        "Giornata intera, 25 ott 2026 – 26 ott 2026",
      ],
    ]) {
      const html = render({ ...empty, events: [event({ startsAt, endsAt })] }, loadedAt);
      const panel = text(
        html.slice(html.indexOf('id="calendar-title"'), html.indexOf('id="attivita"')),
      );
      expect(panel).toContain(label);
      expect(panel).not.toContain("00:00");
      const dotted = days(html)
        .filter((item) => item.dot)
        .map((item) => item.day);
      expect(dotted).toEqual(
        startsAt.startsWith("2026-03") ? ["2026-03-29"] : ["2026-10-25", "2026-10-26"],
      );
    }
  });

  it("calendario vuoto: il messaggio di partenza, nessun pallino", () => {
    const html = render(empty);
    expect(text(html)).toContain("Il calendario è pronto.");
    expect(days(html).some((item) => item.dot)).toBe(false);
  });

  it("anteprima locale: avviso dei dati sintetici", () => {
    expect(text(render(empty, undefined, true))).toContain(
      "Anteprima locale: dati sintetici, salvataggio disattivato.",
    );
    expect(text(render(empty))).not.toContain("Anteprima locale");
  });

  it("attività e note restano in elenco, anche senza assegnatario o scadenza", () => {
    const html = text(render(teamFixtureSnapshot("2026-10-23")));
    expect(html).toContain("Idee per la grafica di primavera");
    expect(html).toContain("Colori del prossimo drop");
    expect(html).toContain("anche senza assegnatario");
  });
});
