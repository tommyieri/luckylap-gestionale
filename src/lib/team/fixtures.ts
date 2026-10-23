// Team: dati sintetici per l'anteprima locale e per i test. Persone e appuntamenti inventati,
// date calcolate da oggi (giorno di Roma), così il mese corrente ha sempre qualcosa.
// Nessuna chiamata a Supabase.
import { isLocalPreviewEnabled } from "../runtime";
import { addDays, monthOf, romeDayOf, shiftMonth } from "./calendar";
import { resolveRomeLocalTime, type TeamSnapshot } from "./model";

export const teamFixtureId = (n: number) =>
  `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export { TEAM_PREVIEW_NOTICE, TEAM_PREVIEW_WRITE_MESSAGE } from "./model";

const MEMBERS = ["Ada Prova", "Bruno Prova", "Carla Prova", "Dario Prova", "Elena Prova"];
const at = (day: string, time: string) => resolveRomeLocalTime(`${day}T${time}`);
const member = (n: number) => teamFixtureId(900 + n);

/** Calendario, attività e note sintetici intorno a `today`. */
export function teamFixtureSnapshot(today: string): TeamSnapshot {
  const allDay = (day: string, days: number) => ({
    startsAt: at(day, "00:00"),
    endsAt: at(addDays(day, days), "00:00"),
  });
  const nextMonth = `${shiftMonth(monthOf(today), 1)}-03`;
  return {
    members: MEMBERS.map((name, index) => ({ id: member(index + 1), name, active: index < 5 })),
    events: [
      {
        id: teamFixtureId(1),
        title: "Call produzione",
        startsAt: at(today, "10:00"),
        endsAt: at(today, "10:45"),
        eventType: "meeting" as const,
        details: {
          summary: "Punto sulle stampe della settimana.",
          participantIds: [member(1), member(2)],
          callUrl: "https://meet.example.test/call-produzione",
        },
        createdBy: member(1),
      },
      {
        id: teamFixtureId(2),
        title: "Evento · Raduno Sintetico Sei",
        ...allDay(addDays(today, 5), 2),
        eventType: "other" as const,
        details: {
          summary: "Partner CO 6 · /partner?co=6#lead-6",
          participantIds: [],
          callUrl: null,
          typeLabel: "Evento partner",
          allDay: true,
        },
        createdBy: member(1),
      },
      {
        id: teamFixtureId(3),
        title: "Consegna al negozio di prova",
        startsAt: at(addDays(today, 2), "15:00"),
        endsAt: at(addDays(today, 2), "16:00"),
        eventType: "delivery" as const,
        details: { summary: "", participantIds: [member(3)], callUrl: null },
        createdBy: member(3),
      },
      {
        id: teamFixtureId(4),
        title: "Shooting nuova collezione",
        startsAt: at(addDays(today, -3), "09:30"),
        endsAt: at(addDays(today, -3), "13:00"),
        eventType: "other" as const,
        details: { summary: "", participantIds: [], callUrl: null, typeLabel: "Shooting" },
        createdBy: member(2),
      },
      {
        id: teamFixtureId(5),
        title: "Lancio della maglietta di prova",
        ...allDay(nextMonth, 1),
        eventType: "launch" as const,
        details: { summary: "", participantIds: [], callUrl: null, allDay: true },
        createdBy: member(1),
      },
    ],
    tasks: [
      {
        id: teamFixtureId(11),
        title: "Ordinare le etichette",
        description: "",
        status: "todo",
        dueAt: at(addDays(today, 1), "12:00"),
        assignedTo: member(1),
        createdBy: member(2),
      },
      {
        id: teamFixtureId(12),
        title: "Sollecito · Garage di prova",
        description: "Partner CO 1 · /partner?co=1#lead-1",
        status: "todo",
        dueAt: at(addDays(today, -1), "12:00"),
        assignedTo: member(4),
        createdBy: member(4),
      },
      {
        id: teamFixtureId(13),
        title: "Contare le scatole in Magadzino",
        description: "",
        status: "done",
        dueAt: at(today, "12:00"),
        assignedTo: null,
        createdBy: member(5),
      },
      {
        id: teamFixtureId(14),
        title: "Idee per la grafica di primavera",
        description: "",
        status: "todo",
        dueAt: null,
        assignedTo: null,
        createdBy: member(2),
      },
    ],
    notes: [
      {
        id: teamFixtureId(21),
        title: "Colori del prossimo drop",
        body: "Verde e crema, da provare su due taglie.",
        taskId: teamFixtureId(14),
        createdAt: at(addDays(today, -2), "18:00"),
        createdBy: member(2),
      },
    ],
  };
}

type PreviewEnvironment = Parameters<typeof isLocalPreviewEnabled>[0];

/**
 * Anteprima locale di /team: dati sintetici solo con `isLocalPreviewEnabled()`, mai su Vercel
 * né con NODE_ENV=production. `null` vuol dire: leggi dal database come sempre.
 */
export function teamLocalPreview(
  now: Date = new Date(),
  environment?: PreviewEnvironment,
): { snapshot: TeamSnapshot; loadedAt: string } | null {
  if (!isLocalPreviewEnabled(environment)) return null;
  const loadedAt = now.toISOString();
  return { snapshot: teamFixtureSnapshot(romeDayOf(loadedAt)), loadedAt };
}
