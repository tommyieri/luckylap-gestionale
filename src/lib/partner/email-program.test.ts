import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { PartnerReadError } from "./model";
import {
  forecastPartnerEmails,
  parsePartnerEmailProgram,
  type PartnerEmailProgramItem,
  type PartnerEmailProgramSnapshot,
  type PartnerEmailUnprepared,
} from "./email-program";

const TODAY = "2026-11-04";
const NOW = `${TODAY}T07:00:00Z`;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const window = (day = TODAY, start = "08:30:00", end = "09:58:30") => ({
  day,
  start: `${day}T${start}Z`,
  end: `${day}T${end}Z`,
});
function item(n: number, change: Partial<PartnerEmailProgramItem> = {}): PartnerEmailProgramItem {
  return {
    jobId: id(n),
    partnerId: id(n + 10_000),
    co: n,
    name: `Club sintetico ${n}`,
    sections: ["club"],
    flow: "club",
    status: "pronta",
    step: "controllo",
    reason: null,
    writeOn: null,
    eligible: true,
    rank: n,
    sendPriority: 0,
    country: "Italia",
    timezone: "Europe/Rome",
    choiceReason: "Proposta sintetica per il club.",
    request: "merch_cobranding",
    contactKind: "club",
    eventStartsOn: null,
    researchAt: "2026-11-03T06:00:00Z",
    partnerVersion: 1,
    draft: {
      id: id(n + 20_000),
      sha256: "a".repeat(64),
      subject: "Proposta sintetica",
      body: "Un progetto dedicato alla vostra comunità.",
      language: "it",
      rulesVersion: 1,
      createdAt: "2026-11-03T07:00:00Z",
    },
    hold: null,
    windows: [window()],
    ...change,
  };
}
function snapshot(
  items: PartnerEmailProgramItem[] = [],
  change: Partial<PartnerEmailProgramSnapshot> = {},
): PartnerEmailProgramSnapshot {
  return {
    generatedAt: NOW,
    from: TODAY,
    days: 2,
    config: {
      mode: "invio",
      pausedReason: "credito",
      backoffUntil: null,
      dailyFirstLimit: 10,
      firstRealOn: "2026-11-02",
      currentRulesVersion: 1,
    },
    mail: { stopReason: null, backoffUntil: null, dayStoppedOn: null, nextSendAfter: null },
    todaySent: { club: 0, altri: 0 },
    items,
    unprepared: [],
    sent: [],
    counts: {
      total: items.length,
      returned: items.length,
      unpreparedTotal: 0,
      unpreparedReturned: 0,
    },
    ...change,
  };
}
const plan = (value: PartnerEmailProgramSnapshot) =>
  forecastPartnerEmails(parsePartnerEmailProgram(value));
const prepared = (result: ReturnType<typeof plan>) =>
  result.items.filter((row) => row.estimatedDay !== null);
const unprepared = (n: number): PartnerEmailUnprepared => ({
  partnerId: id(n + 70_000),
  co: n,
  name: `Destinatario sintetico ${n}`,
  sections: ["collab"],
  flow: "altri",
  partnerVersion: 1,
});
const rows = (count: number, flow: "club" | "altri", start = 1) =>
  Array.from({ length: count }, (_, i) => item(start + i, { flow }));

describe("lettura del programma email", () => {
  it("legge il contratto completo senza perdere testo, revisioni, sezioni o invii", () => {
    const original = snapshot([
      item(1, {
        sections: ["club", "eventi"],
        flow: "altri",
        contactKind: "evento",
        hold: { id: id(60), version: 2, createdAt: NOW },
      }),
    ]);
    original.sent = [
      {
        id: id(80),
        partnerId: id(81),
        co: 81,
        name: "Contatto sintetico",
        sections: ["club"],
        flow: "club",
        mode: "prova",
        status: "inviato",
        subject: "Prova sintetica",
        at: NOW,
        lookbookCode: "club",
      },
    ];
    expect(parsePartnerEmailProgram(original)).toEqual(original);
    expect(parsePartnerEmailProgram(snapshot()).items).toEqual([]);
  });
  it.each([
    (s: PartnerEmailProgramSnapshot) => ({ ...s, counts: { ...s.counts, total: 2, returned: 1 } }),
    (s: PartnerEmailProgramSnapshot) => ({ ...s, counts: { ...s.counts, total: 0, returned: 0 } }),
    (s: PartnerEmailProgramSnapshot) => ({
      ...s,
      counts: { ...s.counts, total: 2001, returned: 1 },
    }),
    (s: PartnerEmailProgramSnapshot) => ({ ...s, extra: true }),
    (s: PartnerEmailProgramSnapshot) => ({ ...s, days: 91 }),
    (s: PartnerEmailProgramSnapshot) => ({ ...s, days: 1.5 }),
    (s: PartnerEmailProgramSnapshot) => ({ ...s, from: "2026-02-30" }),
    (s: PartnerEmailProgramSnapshot) => ({ ...s, generatedAt: "2026-11-04" }),
    (s: PartnerEmailProgramSnapshot) => ({ ...s, items: [{ ...s.items[0], eligible: "true" }] }),
    (s: PartnerEmailProgramSnapshot) => ({ ...s, items: [{ ...s.items[0], flow: "eventi" }] }),
    (s: PartnerEmailProgramSnapshot) => ({
      ...s,
      items: [{ ...s.items[0], draft: { ...s.items[0].draft, sha256: "x".repeat(64) } }],
    }),
    (s: PartnerEmailProgramSnapshot) => ({
      ...s,
      items: [s.items[0], s.items[0]],
      counts: { ...s.counts, total: 2, returned: 2 },
    }),
  ])("rifiuta dati incompleti, troncati o non validi (%#)", (change) => {
    expect(() => parsePartnerEmailProgram(change(snapshot([item(1)])))).toThrow(PartnerReadError);
  });
  it.each([
    [window(TODAY, "09:00:00", "08:30:00")],
    [window("2026-11-03")],
    [window("2026-11-06")],
    [{ ...window(), day: "2026-11-05" }],
    [window(), window(TODAY, "09:00:00", "10:00:00")],
  ])(
    "rifiuta finestre invertite, fuori intervallo, in giorni diversi o sovrapposte (%#)",
    (...windows) => {
      expect(() => parsePartnerEmailProgram(snapshot([item(1, { windows })]))).toThrow(
        PartnerReadError,
      );
    },
  );
  it("legge null autentici per un lavoro senza scelta o bozza", () => {
    const source = item(1, {
      status: "in_coda",
      step: "ricerca",
      draft: null,
      rank: null,
      researchAt: null,
      request: null,
      contactKind: null,
      timezone: null,
      choiceReason: null,
      windows: [],
    });
    expect(parsePartnerEmailProgram(snapshot([source])).items[0]).toEqual(source);
  });
  it("mostra i destinatari senza lavoro senza inventare bozze o date, anche con credito fermo", () => {
    const s = snapshot();
    s.unprepared = [unprepared(50)];
    s.counts.unpreparedTotal = s.counts.unpreparedReturned = 1;
    const parsed = parsePartnerEmailProgram(s);
    expect(parsed.unprepared).toEqual(s.unprepared);
    expect(Object.keys(parsed.unprepared[0]).sort()).toEqual([
      "co",
      "flow",
      "name",
      "partnerId",
      "partnerVersion",
      "sections",
    ]);
    expect(forecastPartnerEmails(parsed).items).toEqual([]);
    expect(parsed.config.pausedReason).toBe("credito");
  });
  it.each([
    (s: PartnerEmailProgramSnapshot) => {
      s.counts.unpreparedTotal = 2;
    },
    (s: PartnerEmailProgramSnapshot) => {
      s.counts.unpreparedReturned = 0;
    },
    (s: PartnerEmailProgramSnapshot) => {
      s.unprepared.push(s.unprepared[0]);
      s.counts.unpreparedTotal = s.counts.unpreparedReturned = 2;
    },
    (s: PartnerEmailProgramSnapshot) => {
      s.unprepared[0].partnerId = s.items[0].partnerId;
    },
    (s: PartnerEmailProgramSnapshot) => {
      (s.unprepared[0] as unknown as Record<string, unknown>).jobId = id(80);
    },
    (s: PartnerEmailProgramSnapshot) => {
      (s.unprepared[0] as unknown as Record<string, unknown>).estimatedDay = NOW;
    },
  ])(
    "rifiuta destinatari senza lavoro troncati, duplicati o arricchiti di dati inventati (%#)",
    (change) => {
      const s = snapshot([item(1)]);
      s.unprepared = [unprepared(50)];
      s.counts.unpreparedTotal = s.counts.unpreparedReturned = 1;
      change(s);
      expect(() => parsePartnerEmailProgram(s)).toThrow(PartnerReadError);
    },
  );
  it("applica il tetto di 2000 alla somma di lavori e destinatari senza lavoro", () => {
    const s = snapshot(rows(1999, "club"));
    s.unprepared = [unprepared(5000)];
    s.counts.unpreparedTotal = s.counts.unpreparedReturned = 1;
    expect(parsePartnerEmailProgram(s).items).toHaveLength(1999);
    s.items.push(item(2000));
    s.counts.total = s.counts.returned = 2000;
    expect(() => parsePartnerEmailProgram(s)).toThrow(PartnerReadError);
  });
});

describe("previsione globale delle prime email", () => {
  it("i destinatari ancora senza lavoro non consumano posti nella quota del loro flusso", () => {
    const s = snapshot(rows(5, "club"));
    s.unprepared = [unprepared(50)];
    s.counts.unpreparedTotal = s.counts.unpreparedReturned = 1;
    const result = plan(s);
    expect(result.items).toHaveLength(5);
    expect(prepared(result).map((row) => row.co)).toEqual([1, 2]);
    expect(result.days[0]).toEqual({ day: TODAY, limit: 5, club: 2, altri: 0 });
    expect(result.items.some((row) => row.partnerId === s.unprepared[0].partnerId)).toBe(false);
  });
  it("riserva 3 posti agli altri e 2 ai Club, con precedenza globale e soltanto il giorno stimato", () => {
    const source = snapshot([...rows(5, "altri"), ...rows(4, "club", 20)]);
    const original = structuredClone(source);
    const result = plan(source);
    expect(prepared(result).map((row) => [row.co, row.estimatedDay])).toEqual([
      [1, "2026-11-04"],
      [2, "2026-11-04"],
      [3, "2026-11-04"],
      [20, "2026-11-04"],
      [21, "2026-11-04"],
    ]);
    expect(result.days[0]).toEqual({ day: TODAY, limit: 5, club: 2, altri: 3 });
    expect(result.assumption).toContain("Queste righe non assegnano un orario");
    expect(result.assumption).toContain("Piano d’invio del giorno");
    expect(result.assumption).not.toMatch(/8 minuti|4–11 minuti/);
    expect(source).toEqual(original);
  });
  it.each(["club", "altri"] as const)(
    "distribuisce venti bozze %s a tre al giorno anche quando l'altra coda è vuota",
    (flow) => {
      const days = Array.from({ length: 9 }, (_, offset) => addDays(TODAY, offset));
      const workingDays = days.filter((on) => {
        const weekday = new Date(`${on}T12:00:00Z`).getUTCDay();
        return weekday !== 0 && weekday !== 6;
      });
      const s = snapshot(
        rows(20, flow).map((row) => ({
          ...row,
          windows: workingDays.map((on) => window(on)),
        })),
        { days: days.length },
      );
      s.config.firstRealOn = "2026-10-20";
      s.config.dailyFirstLimit = 6;
      const original = structuredClone(s);
      const result = plan(s);
      const expectedCounts = [3, 3, 3, 0, 0, 3, 3, 3, 2];
      expect(result.days).toEqual(
        days.map((on, index) => ({
          day: on,
          limit: 6,
          club: flow === "club" ? expectedCounts[index] : 0,
          altri: flow === "altri" ? expectedCounts[index] : 0,
        })),
      );
      expect(prepared(result).map((row) => row.co)).toEqual(
        Array.from({ length: 20 }, (_, index) => index + 1),
      );
      expect(new Set(prepared(result).map((row) => row.jobId)).size).toBe(20);
      expect(s).toEqual(original);
    },
  );
  it("con limite sei pianifica tre Club e tre altri nell'ordine globale della coda", () => {
    const s = snapshot([...rows(4, "altri"), ...rows(4, "club", 20)]);
    s.config.firstRealOn = "2026-10-20";
    s.config.dailyFirstLimit = 6;
    const result = plan(s);
    expect(prepared(result).map((row) => [row.co, row.estimatedDay])).toEqual([
      [1, "2026-11-04"],
      [2, "2026-11-04"],
      [3, "2026-11-04"],
      [20, "2026-11-04"],
      [21, "2026-11-04"],
      [22, "2026-11-04"],
    ]);
    expect(result.days[0]).toEqual({ day: TODAY, limit: 6, club: 3, altri: 3 });
    expect(result.items.filter((row) => row.estimatedDay === null).map((row) => row.co)).toEqual([
      4, 23,
    ]);
  });
  it("dopo otto invii con il limite ridotto a sei riprende dalle quote del giorno successivo", () => {
    const tomorrow = addDays(TODAY, 1);
    const s = snapshot(
      [...rows(4, "altri"), ...rows(4, "club", 20)].map((row) => ({
        ...row,
        windows: [window(), window(tomorrow)],
      })),
      { todaySent: { club: 4, altri: 4 } },
    );
    s.config.firstRealOn = "2026-10-20";
    s.config.dailyFirstLimit = 6;
    const result = plan(s);
    expect(result.days).toEqual([
      { day: TODAY, limit: 6, club: 0, altri: 0 },
      { day: tomorrow, limit: 6, club: 3, altri: 3 },
    ]);
    expect(prepared(result).every((row) => row.estimatedDay === tomorrow)).toBe(true);
  });
  it("consuma gli invii già fatti, compresi gli incerti nei conteggi SQL, senza ricontarli come previsti", () => {
    const result = plan(
      snapshot([...rows(3, "altri"), ...rows(3, "club", 20)], { todaySent: { club: 1, altri: 3 } }),
    );
    expect(prepared(result).map((row) => row.co)).toEqual([20]);
    expect(result.days[0]).toEqual({ day: TODAY, limit: 5, club: 1, altri: 0 });
  });
  it.each(["in_invio", "inviato", "incerto"] as const)(
    "non riproietta una prima email %s quando il lavoro risulta ancora pronto",
    (status) => {
      const s = snapshot([item(1), ...rows(5, "altri", 20)], {
        todaySent: { club: 1, altri: 0 },
      });
      s.sent = [
        {
          id: id(90),
          partnerId: s.items[0].partnerId,
          co: 1,
          name: s.items[0].name,
          sections: ["club"],
          flow: "club",
          mode: "invio",
          status,
          subject: "Oggetto sintetico",
          at: NOW,
          lookbookCode: "club",
        },
      ];
      const original = structuredClone(s);
      const result = plan(s);
      expect(result.items[0]).toMatchObject({
        estimatedDay: null,
        state: status === "incerto" ? "da_rivedere" : "non_prevista",
        draft: s.items[0].draft,
      });
      expect(result.items[0].explanation).toContain(
        status === "incerto" ? "incerto" : status === "in_invio" ? "in corso" : "già inviata",
      );
      expect(prepared(result).map((row) => row.co)).toEqual([20, 21, 22]);
      expect(result.days[0]).toEqual({ day: TODAY, limit: 5, club: 0, altri: 3 });
      expect(s).toEqual(original);
    },
  );
  it.each([
    ["prova", "inviato"],
    ["prova", "in_invio"],
    ["prova", "incerto"],
    ["invio", "pronto"],
    ["invio", "respinto"],
    ["invio", "scartato"],
  ] as const)("il messaggio %s/%s non sopprime una prima email reale pronta", (mode, status) => {
    const s = snapshot([item(1)]);
    s.sent = [
      {
        id: id(90),
        partnerId: s.items[0].partnerId,
        co: 1,
        name: s.items[0].name,
        sections: ["club"],
        flow: "club",
        mode,
        status,
        subject: "Oggetto sintetico",
        at: NOW,
        lookbookCode: null,
      },
    ];
    expect(plan(s).items[0].state).toBe("prevista");
  });
  it("conserva la quota dei Club fuori finestra e la usa nel loro pomeriggio romano", () => {
    const result = plan(
      snapshot([
        ...rows(5, "altri"),
        ...rows(2, "club", 20).map((row) => ({
          ...row,
          timezone: "America/New_York",
          country: "Paese sintetico",
          windows: [window(TODAY, "14:30:00", "15:58:30")],
        })),
      ]),
    );
    expect(prepared(result).map((row) => row.co)).toEqual([1, 2, 3, 20, 21]);
    expect(result.items.find((row) => row.co === 20)?.estimatedDay).toBe("2026-11-04");
  });
  it("non presta i posti di una coda pronta che oggi non ha alcuna finestra", () => {
    const result = plan(snapshot([...rows(5, "altri"), item(20, { windows: [] })]));
    expect(prepared(result).map((row) => row.co)).toEqual([1, 2, 3]);
    expect(result.items.find((row) => row.co === 20)?.state).toBe("non_prevista");
  });
  it("conserva i posti inutilizzati dopo l'esaurimento dell'altro flusso", () => {
    const result = plan(snapshot([...rows(5, "altri"), item(20)]));
    expect(prepared(result).map((row) => row.co)).toEqual([1, 2, 3, 20]);
    expect(result.items.find((row) => row.co === 4)?.estimatedDay).toBeNull();
  });
  it("esclude le bozze sospese senza trasferire i loro posti all'altro flusso", () => {
    const held = item(20, { hold: { id: id(90), version: 1, createdAt: NOW } });
    const result = plan(snapshot([...rows(5, "altri"), held]));
    expect(prepared(result).length).toBe(3);
    expect(result.items.find((row) => row.co === 20)).toMatchObject({
      state: "sospesa",
      estimatedDay: null,
    });
  });
  it("non pianifica una revisione manuale fuori contesto e conserva la quota degli altri", () => {
    const stale = item(1, { reason: "bozza_manuale_da_rivedere" });
    const result = plan(snapshot([stale, ...rows(5, "altri", 20)]));
    expect(result.items[0]).toMatchObject({
      state: "da_rivedere",
      estimatedDay: null,
      draft: stale.draft,
    });
    expect(prepared(result).map((row) => row.co)).toEqual([20, 21, 22]);
    expect(result.days[0]).toEqual({ day: TODAY, limit: 5, club: 0, altri: 3 });
  });
  it("rispetta il rank ricevuto e il flusso SQL per i Club che sono anche eventi", () => {
    const result = plan(
      snapshot([
        item(1, { rank: 2 }),
        item(2, { sections: ["club", "eventi"], flow: "altri", rank: 1, sendPriority: 9 }),
        item(3, { rank: 3 }),
      ]),
    );
    expect(result.items.find((row) => row.co === 2)?.estimatedDay).toBe("2026-11-04");
    expect(result.days[0]).toMatchObject({ club: 2, altri: 1 });
  });
  it("mantiene gli invii delle pronte durante la pausa credito ma non inventa bozze future", () => {
    const result = plan(
      snapshot([
        item(1),
        item(2, { status: "in_coda", draft: null, windows: [] }),
        item(3, { status: "attesa", draft: null, writeOn: "2026-11-05", windows: [] }),
      ]),
    );
    expect(result.items.map((row) => [row.state, row.estimatedDay !== null])).toEqual([
      ["prevista", true],
      ["da_preparare", false],
      ["attesa", false],
    ]);
    expect(result.items[1].explanation).toContain("credito");
    expect(result.items[2].explanation).toContain("non è una data d'invio");
  });
  it.each(["spento", "prepara", "prova"] as const)(
    "non promette invii reali in modalità %s",
    (mode) => {
      const s = snapshot([item(1)]);
      s.config.mode = mode;
      expect(plan(s).items[0]).toMatchObject({ state: "sospesa", estimatedDay: null });
    },
  );
  it("fermo persistente, contatto non idoneo e lavoro già inviato non ricevono altre partenze", () => {
    const s = snapshot([
      item(1),
      item(2, { eligible: false }),
      item(3, { status: "inviata" }),
      item(4, { status: "serve_tommaso", reason: "controlli_falliti" }),
    ]);
    s.mail.stopReason = "casella";
    expect(plan(s).items.map((row) => row.state)).toEqual([
      "sospesa",
      "non_prevista",
      "non_prevista",
      "da_rivedere",
    ]);
  });
  it("tiene distinti attesa della preparazione e attesa della casella", () => {
    const s = snapshot([item(1), item(2)]);
    s.config.backoffUntil = "2026-11-04T12:00:00Z";
    s.mail.backoffUntil = "2026-11-04T08:35:00Z";
    s.mail.nextSendAfter = "2026-11-04T08:40:00Z";
    expect(prepared(plan(s)).map((row) => row.estimatedDay)).toEqual(["2026-11-04", "2026-11-04"]);
  });
  it("un fermo del giorno rinvia a domani senza fingere un fermo permanente", () => {
    const s = snapshot([item(1, { windows: [window(), window("2026-11-05")] })]);
    s.mail.dayStoppedOn = TODAY;
    expect(plan(s).items[0].estimatedDay).toBe("2026-11-05");
  });
  it("usa esclusivamente le finestre SQL, compresa la festa francese dell'11 novembre", () => {
    const s = snapshot(
      [
        item(1, { country: "Francia", timezone: "Europe/Paris", windows: [window("2026-11-12")] }),
        item(2, { windows: [window("2026-11-11")] }),
      ],
      { from: "2026-11-11", days: 2 },
    );
    expect(plan(s).items.map((row) => row.estimatedDay)).toEqual(["2026-11-12", "2026-11-11"]);
  });
  it("non sottrae due volte il margine e tratta end come esclusivo", () => {
    const s = snapshot([item(1, { windows: [window(TODAY, "09:58:29", "09:58:30")] })]);
    s.mail.nextSendAfter = "2026-11-04T09:58:29Z";
    expect(prepared(plan(s)).map((row) => row.co)).toEqual([1]);
    s.mail.nextSendAfter = "2026-11-04T09:58:30Z";
    expect(prepared(plan(s))).toHaveLength(0);
  });
  it("riconosce una ricerca a 21 giorni esatti e le regole superate", () => {
    const a = item(1, { researchAt: "2026-10-14T07:00:00Z" });
    const b = item(2);
    b.draft!.rulesVersion = 2;
    expect(plan(snapshot([a, b])).items.map((row) => [row.state, row.estimatedDay])).toEqual([
      ["da_rivedere", null],
      ["da_rivedere", null],
    ]);
  });
  it("ricontrolla la validità alla data futura invece di assegnare slot oltre il TTL", () => {
    const s = snapshot(
      [item(1, { researchAt: "2026-10-15T07:00:00Z", windows: [window("2026-11-06")] })],
      { days: 3 },
    );
    expect(plan(s).items[0]).toMatchObject({ state: "da_rivedere", estimatedDay: null });
  });
  it("una ricerca che scade a metà giornata non libera posti per l'altro flusso", () => {
    const s = snapshot(
      [
        item(1, { windows: [window(TODAY, "14:30:00", "15:58:30")], flow: "altri" }),
        item(20, { researchAt: "2026-10-14T10:00:00Z", windows: [] }),
      ],
      { todaySent: { club: 0, altri: 3 } },
    );
    const result = plan(s);
    expect(result.items[0]).toMatchObject({ state: "non_prevista", estimatedDay: null });
    expect(result.items[1]).toMatchObject({ state: "da_rivedere", estimatedDay: null });
  });
  it("riusa il controllo reale delle date nel corpo e del cambio proposta degli eventi", () => {
    const date = item(1, { windows: [window("2026-11-05")] });
    date.draft!.body = "Vi scrivo per il raduno del 5 novembre 2026.";
    const event = item(2, {
      contactKind: "evento",
      request: "stand_evento",
      eventStartsOn: "2026-12-05",
      windows: [window("2026-11-04")],
    });
    // Il 3 novembre il margine era 32 giorni; il 4 è 31 e la proposta va riscritta.
    const result = plan(snapshot([date, event]));
    expect(result.items.map((row) => [row.state, row.estimatedDay])).toEqual([
      ["da_rivedere", null],
      ["da_rivedere", null],
    ]);
  });
  it("applica il limite maggiore dal giorno 8 di calendario del primo invio ipotetico", () => {
    const days = Array.from({ length: 9 }, (_, i) => addDays(TODAY, i)).filter((on) => {
      const weekday = new Date(`${on}T12:00:00Z`).getUTCDay();
      return weekday !== 0 && weekday !== 6;
    });
    const s = snapshot(
      rows(50, "club").map((row) => ({ ...row, windows: days.map((on) => window(on)) })),
      { days: 9 },
    );
    s.config.firstRealOn = null;
    const result = plan(s);
    expect(result.days.map((day) => day.limit)).toEqual([5, 5, 5, 5, 5, 5, 5, 10, 10]);
    expect(result.days[7].club).toBe(5);
  });
  it("salta i giorni passati senza consumare quota e non usa l'orologio del processo", () => {
    const s = snapshot([item(1, { windows: [window("2026-11-03"), window()] })], {
      from: "2026-11-03",
      days: 2,
    });
    expect(plan(s).days[0]).toEqual({ day: "2026-11-03", limit: 5, club: 0, altri: 0 });
    expect(plan(s).items[0].estimatedDay).toBe("2026-11-04");
    expect(plan(s)).toEqual(plan(s));
  });
  it("conta sulla domenica di Roma una finestra del lunedì in Nuova Zelanda", () => {
    const nz = { day: "2026-11-08", start: "2026-11-08T20:30:00Z", end: "2026-11-08T21:58:30Z" };
    const s = snapshot([item(1, { timezone: "Pacific/Auckland", windows: [nz] })], {
      from: "2026-11-08",
      days: 1,
    });
    const result = plan(s);
    expect(result.items[0].estimatedDay).toBe("2026-11-08");
    expect(result.days[0].club).toBe(1);
  });
  it("azzera la quota al cambio di giorno a Roma anche quando UTC è ancora al giorno precedente", () => {
    const tomorrow = addDays(TODAY, 1);
    const s = snapshot(
      rows(4, "club").map((row) => ({
        ...row,
        timezone: "Pacific/Guam",
        country: "Paese sintetico",
        windows: [
          { day: TODAY, start: "2026-11-03T23:30:00Z", end: "2026-11-04T00:58:30Z" },
          { day: tomorrow, start: "2026-11-04T23:30:00Z", end: "2026-11-05T00:58:30Z" },
        ],
      })),
      { generatedAt: "2026-11-03T23:15:00Z", todaySent: { club: 3, altri: 0 } },
    );
    s.config.firstRealOn = "2026-10-20";
    s.config.dailyFirstLimit = 6;
    const result = plan(s);
    expect(result.days).toEqual([
      { day: TODAY, limit: 6, club: 0, altri: 0 },
      { day: tomorrow, limit: 6, club: 3, altri: 0 },
    ]);
    expect(result.items.map((row) => row.estimatedDay)).toEqual([
      "2026-11-05",
      "2026-11-05",
      "2026-11-05",
      null,
    ]);
    expect(prepared(result).every((row) => row.estimatedDay === tomorrow)).toBe(true);
  });
  it("accetta finestre SQL con offset diversi dopo il cambio dell'ora", () => {
    const s = snapshot(
      [
        item(1, {
          researchAt: "2026-10-22T06:00:00Z",
          windows: [window("2026-10-23", "07:30:00", "08:58:30")],
        }),
        item(2, { researchAt: "2026-10-22T06:00:00Z", windows: [window("2026-10-26")] }),
      ],
      { generatedAt: "2026-10-23T06:00:00Z", from: "2026-10-23", days: 4 },
    );
    s.items.forEach((row) => {
      row.draft!.createdAt = "2026-10-22T07:00:00Z";
    });
    s.config.firstRealOn = "2026-10-20";
    expect(plan(s).items.map((row) => row.estimatedDay)).toEqual(["2026-10-23", "2026-10-26"]);
  });
  it("non duplica il programma quando la UI filtra le sezioni dopo la previsione", () => {
    const result = plan(
      snapshot([
        ...rows(5, "altri").map((row) => ({ ...row, sections: ["collab"] as ["collab"] })),
        ...rows(3, "club", 20),
      ]),
    );
    expect(prepared(result).filter((row) => row.sections.includes("club"))).toHaveLength(2);
  });
});
