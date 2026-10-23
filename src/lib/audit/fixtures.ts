import type { ActivityActor, ActivityFeedPage, ActivityItem, ActivityQuery } from "./feed-model";

/*
 * Anteprima locale di «Controllo CEO» (00-sequenza §1.5): soli dati sintetici, mai Supabase.
 * Nomi inventati, nessun importo Finance: solo il «da fatturare» del resoconto, come nel feed vero.
 * Gli orari sono relativi a `now`, così le righe cadono sempre nelle ultime 24 ore.
 */
const id = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const people = {
  founder: { id: "00000000-0000-4000-8000-0000000003a1", name: "Founder (anteprima)" },
  alessia: { id: "00000000-0000-4000-8000-0000000003a2", name: "Alessia" },
  bruno: { id: "00000000-0000-4000-8000-0000000003a3", name: "Bruno" },
  carla: { id: "00000000-0000-4000-8000-0000000003a4", name: "Carla" },
  dario: { id: "00000000-0000-4000-8000-0000000003a5", name: "Dario" },
} as const;
type Person = keyof typeof people | null;
const rows: [number, Person, ActivityItem["area"], string, string | null][] = [
  [12, "bruno", "sales", "ha registrato una vendita (2 unità · diretta).", `/sales#order-${id(1)}`],
  [35, "alessia", "team", "ha aggiunto una call: Intervista sintetica.", `/team#evento-${id(2)}`],
  [70, null, "partner", "ha importato 207 contatti in Partner.", "/partner"],
  [
    120,
    "carla",
    "consignment",
    "ha registrato il resoconto di ottobre 2026 di Negozio sintetico: 12 pezzi, 134,99 € da fatturare.",
    "/consignment/NEG01/resoconto/2026-10",
  ],
  [
    180,
    "dario",
    "finance",
    "ha corretto un movimento Finance.",
    `/finance#movimento-manual-${id(3)}`,
  ],
  [240, "bruno", "finance", "ha registrato un incasso.", `/sales#order-${id(1)}`],
  [
    300,
    "alessia",
    "assets",
    "ha archiviato un contenuto: Logo sintetico.",
    `/assets#contenuto-${id(4)}`,
  ],
  [360, "founder", "stock", "ha rettificato il magazzino.", "/stock/rettifiche"],
  [
    480,
    "carla",
    "partner",
    "ha registrato un invio Partner: Contatto sintetico (CO 12).",
    "/partner?co=12#lead-12",
  ],
  [660, null, "team", "ha tolto 54 appuntamenti dal calendario.", "/team"],
  [840, "dario", "sales", "ha registrato un reso.", `/sales#order-${id(5)}`],
  [
    1080,
    "bruno",
    "sales",
    "ha annullato la registrazione di una vendita.",
    `/sales#order-${id(6)}`,
  ],
  [
    1380,
    "alessia",
    "development",
    "ha avviato un progetto: Cappellino sintetico.",
    `/development#progetto-${id(7)}`,
  ],
];

export function previewActivityFeed(now: Date, query: ActivityQuery): ActivityFeedPage {
  const items: ActivityItem[] = rows.map(([minutes, person, area, sentence, href], index) => {
    const actor = person ? people[person] : null;
    return {
      id: id(20 + index),
      occurredAt: new Date(now.getTime() - minutes * 60_000).toISOString(),
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? "Automazioni",
      area,
      message: `${actor?.name ?? "Il sistema"} ${sentence}`,
      href,
    };
  });
  const actors: ActivityActor[] = [
    ...Object.values(people).map((person) => ({ id: person.id, name: person.name })),
    { id: "system", name: "Automazioni" },
  ];
  return {
    items: items.filter(
      (item) =>
        (query.actor === null ||
          (query.actor === "system" ? item.actorId === null : item.actorId === query.actor)) &&
        (query.area === null || item.area === query.area),
    ),
    actors,
    nextCursor: null,
    hasCursor: false,
  };
}
