import { partnerAssistantOptOutLine } from "../partner-assistant/opt-out";
import { addDays } from "./dates";
import { parsePartnerEmailProgram } from "./email-program";
import type { PartnerEmailDetail, PartnerEmailReadKind } from "./email-edit";

const id = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const signature = "Autore esempio\nFondatore, LuckyLap\n+39 000 000 0000\nhttps://luckylap.com";
const body =
  "Buongiorno,\n\nLuckyLap unisce la passione per le automobili a t-shirt in cotone biologico, con la silhouette dell'auto ricamata sul petto. Un dettaglio essenziale, pensato per accompagnare la passione anche lontano da un raduno.\n\nPer i soci possiamo sviluppare una maglietta dedicata, scegliendo insieme grafica, colori e posizione del logo del club.\n\nUn cordiale saluto,";
const optOut = partnerAssistantOptOutLine();

/** Anteprima locale: solo contatti e indirizzi inventati, nessuna lettura della produzione. */
export function partnerEmailProgramFixture(today: string) {
  const generatedAt = `${today}T07:00:00Z`;
  const from = addDays(today, -30);
  const windows = Array.from({ length: 90 }, (_, i) => addDays(from, i))
    .filter((day) => ![0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay()))
    .map((day) => ({ day, start: `${day}T08:30:00Z`, end: `${day}T09:58:30Z` }));
  const item = (n: number, change: Record<string, unknown> = {}) => ({
    jobId: id(n),
    partnerId: id(100 + n),
    co: 950 + n,
    name: n === 1 ? "Porsche Club Esempio" : n === 2 ? "Evento Esempio" : `Club Esempio ${n}`,
    sections: n === 2 ? ["eventi", "collab"] : ["club"],
    flow: n === 2 ? "altri" : "club",
    status: "pronta",
    step: "controllo",
    reason: null,
    writeOn: null,
    eligible: true,
    rank: n,
    sendPriority: 0,
    country: "Italia",
    timezone: "Europe/Rome",
    choiceReason:
      n === 2
        ? "La manifestazione riunisce un pubblico interessato al prodotto."
        : "Una proposta di magliette dedicate ai soci è coerente con le attività del club.",
    request: n === 2 ? "stand_evento" : "merch_cobranding",
    contactKind: n === 2 ? "evento" : "club",
    eventStartsOn: null,
    researchAt: `${addDays(today, -2)}T08:00:00Z`,
    partnerVersion: 1,
    draft: {
      id: id(200 + n),
      sha256: "c".repeat(64),
      subject: n === 2 ? "LuckyLap e l'Evento Esempio" : "Una maglietta dedicata ai soci",
      body,
      language: "it",
      rulesVersion: 3,
      createdAt: `${addDays(today, -1)}T08:00:00Z`,
    },
    hold: null,
    windows,
    ...change,
  });
  return parsePartnerEmailProgram({
    generatedAt,
    from,
    days: 90,
    config: {
      mode: "invio",
      pausedReason: "credito",
      backoffUntil: null,
      dailyFirstLimit: 10,
      firstRealOn: addDays(today, -2),
      currentRulesVersion: 3,
    },
    mail: { stopReason: null, backoffUntil: null, dayStoppedOn: null, nextSendAfter: null },
    todaySent: { club: 0, altri: 0 },
    items: [
      item(1),
      item(2),
      item(3, { hold: { id: id(403), version: 1, createdAt: generatedAt } }),
      item(4, {
        status: "in_coda",
        step: "ricerca",
        draft: null,
        rank: null,
        researchAt: null,
        choiceReason: null,
        request: null,
        contactKind: null,
        windows: [],
      }),
      item(5, {
        status: "attesa",
        writeOn: addDays(today, 14),
        draft: null,
        rank: null,
        windows: [],
      }),
      item(6, {
        status: "serve_tommaso",
        reason: "fatto_mancante",
        draft: null,
        rank: null,
        windows: [],
      }),
    ],
    sent: [
      {
        id: id(501),
        partnerId: id(107),
        co: 957,
        name: "Negozio Esempio",
        sections: ["vendita"],
        flow: "altri",
        mode: "invio",
        status: "inviato",
        subject: "Le magliette LuckyLap",
        at: `${addDays(today, -1)}T09:40:00Z`,
        lookbookCode: null,
      },
    ],
    unprepared: [
      {
        partnerId: id(108),
        co: 958,
        name: "Club Nuovo Esempio",
        sections: ["club"],
        flow: "club",
        partnerVersion: 1,
      },
    ],
    counts: { total: 6, returned: 6, unpreparedTotal: 1, unpreparedReturned: 1 },
  });
}

export function partnerEmailFixtureDetail(
  today: string,
  kind: PartnerEmailReadKind,
  key: string,
): PartnerEmailDetail | null {
  const snapshot = partnerEmailProgramFixture(today);
  if (kind === "sent") {
    const row = snapshot.sent.find((s) => s.id === key);
    if (!row) return null;
    return {
      kind,
      id: key,
      jobId: null,
      draftId: null,
      partnerId: row.partnerId,
      co: row.co,
      name: row.name,
      sections: row.sections,
      subject: row.subject,
      body: `${body}\n\n${signature}\n\n${optOut}`,
      signature: null,
      language: "it",
      register: "voi",
      address: "negozio@example.test",
      lookbookCode: null,
      sha256: "c".repeat(64),
      rulesVersion: 3,
      createdAt: row.at,
      sentAt: row.at,
      choiceReason: "Presentazione del brand al negozio.",
      researchSources: [],
      hold: null,
      editable: false,
      whyNotEditable: "inviata",
    };
  }
  const row = snapshot.items.find((s) => (kind === "job" ? s.jobId === key : s.draft?.id === key));
  if (!row) return null;
  return {
    kind,
    id: key,
    jobId: row.jobId,
    draftId: row.draft?.id ?? null,
    partnerId: row.partnerId,
    co: row.co,
    name: row.name,
    sections: row.sections,
    subject: row.draft?.subject ?? null,
    body: row.draft?.body ?? null,
    signature: row.draft ? signature : null,
    optOut: row.draft ? optOut : undefined,
    language: row.draft?.language ?? null,
    register: "voi",
    address: "contatti@club.example.test",
    lookbookCode: row.flow === "club" ? (row.co === 951 ? "porsche_club" : "club") : null,
    sha256: row.draft?.sha256 ?? null,
    rulesVersion: row.draft?.rulesVersion ?? null,
    createdAt: row.draft?.createdAt ?? null,
    sentAt: null,
    choiceReason: row.choiceReason,
    researchSources: [{ title: "Sito del club di esempio", url: "https://club.example.test" }],
    hold: row.hold,
    editable: !!row.draft,
    whyNotEditable: row.draft ? null : "non_pronta",
    status: row.status,
    step: row.step,
    reason: row.reason,
  };
}
