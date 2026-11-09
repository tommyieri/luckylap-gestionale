// Programma delle prime email: lettura severa e simulazione pura. Le finestre arrivano dal
// calendario SQL del mittente; questo modulo non inventa feste, fusi o nuove bozze.
import { partnerAssistantSendRecheck } from "../partner-assistant/send-recheck";
import type {
  PartnerAssistantContactKind,
  PartnerAssistantJobStatus,
  PartnerAssistantLanguage,
  PartnerAssistantRequest,
  PartnerAssistantStep,
} from "../partner-assistant/types";
import { addDays, daysBetween, isCalendarDay, romeDay } from "./dates";
import {
  PARTNER_SECTIONS,
  PartnerReadError,
  isPartnerCo,
  isPartnerId,
  type PartnerSection,
} from "./model";

export type PartnerEmailFlow = "club" | "altri";
export type PartnerEmailProgramItem = {
  jobId: string;
  partnerId: string;
  co: number;
  name: string;
  sections: PartnerSection[];
  flow: PartnerEmailFlow;
  status: PartnerAssistantJobStatus;
  step: PartnerAssistantStep;
  reason: string | null;
  writeOn: string | null;
  eligible: boolean;
  rank: number | null;
  sendPriority: number;
  country: string;
  timezone: string | null;
  choiceReason: string | null;
  request: PartnerAssistantRequest | null;
  contactKind: PartnerAssistantContactKind | null;
  eventStartsOn: string | null;
  researchAt: string | null;
  partnerVersion: number;
  draft: null | {
    id: string;
    sha256: string;
    subject: string;
    body: string;
    language: PartnerAssistantLanguage;
    rulesVersion: number;
    createdAt: string;
  };
  hold: null | { id: string; version: number; createdAt: string };
  /** Intervalli [start, end): end comprende già il margine SQL di 90 secondi. */
  windows: { day: string; start: string; end: string }[];
};

/** Destinatario idoneo che la preparazione non ha ancora trasformato in un lavoro. */
export type PartnerEmailUnprepared = Pick<
  PartnerEmailProgramItem,
  "partnerId" | "co" | "name" | "sections" | "flow" | "partnerVersion"
>;

export type PartnerEmailProgramSnapshot = {
  generatedAt: string;
  from: string;
  days: number;
  config: {
    mode: "spento" | "prepara" | "prova" | "invio";
    pausedReason: "credito" | "errore_claude" | null;
    backoffUntil: string | null;
    dailyFirstLimit: number;
    firstRealOn: string | null;
    currentRulesVersion: number;
  };
  mail: {
    stopReason: string | null;
    backoffUntil: string | null;
    dayStoppedOn: string | null;
    nextSendAfter: string | null;
  };
  todaySent: { club: number; altri: number };
  items: PartnerEmailProgramItem[];
  unprepared: PartnerEmailUnprepared[];
  sent: {
    id: string;
    partnerId: string;
    co: number;
    name: string;
    sections: PartnerSection[];
    flow: PartnerEmailFlow;
    mode: "prova" | "invio";
    status: "pronto" | "in_invio" | "inviato" | "incerto" | "respinto" | "scartato";
    subject: string;
    at: string;
    lookbookCode: "porsche_club" | "club" | null;
  }[];
  counts: { total: number; returned: number; unpreparedTotal: number; unpreparedReturned: number };
};

export type PartnerEmailProgramState =
  "prevista" | "sospesa" | "da_preparare" | "attesa" | "da_rivedere" | "non_prevista";
export type PartnerEmailProgramForecast = {
  items: (PartnerEmailProgramItem & {
    plannedAt: string | null;
    state: PartnerEmailProgramState;
    explanation: string;
  })[];
  assumption: string;
  /** Nuovi invii previsti; gli invii già fatti consumano quota ma non si contano qui. */
  days: { day: string; limit: number; club: number; altri: number }[];
};

const MODES = ["spento", "prepara", "prova", "invio"] as const;
const STATUSES = ["in_coda", "attesa", "pronta", "serve_tommaso", "inviata"] as const;
const STEPS = ["ricerca", "estrazione", "scrittura", "controllo"] as const;
const REQUESTS = ["merch_cobranding", "collab_capsule", "stand_evento", "vendita_negozio"] as const;
const KINDS = ["club", "brand", "media", "evento", "negozio"] as const;
const LANGUAGES = ["it", "en", "de", "fr", "es"] as const;
const FLOWS = ["club", "altri"] as const;
const MAX_ROWS = 2000;
const MINUTE = 60_000;
const TTL = 21 * 24 * 60 * MINUTE;
const STEP = 8 * MINUTE;
const fail = (): never => {
  throw new PartnerReadError("Programma email");
};
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
    return fail();
  return row;
}
const text = (value: unknown, max: number, min = 0): string =>
  typeof value === "string" && Array.from(value).length >= min && Array.from(value).length <= max
    ? value
    : fail();
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : fail();
const bool = (value: unknown): boolean => (typeof value === "boolean" ? value : fail());
const nullable = <T>(value: unknown, parse: (value: unknown) => T): T | null =>
  value === null ? null : parse(value);
const oneOf = <T extends string>(value: unknown, values: readonly T[]): T =>
  typeof value === "string" && values.includes(value as T) ? (value as T) : fail();
const day = (value: unknown): string => (isCalendarDay(value) ? value : fail());
const id = (value: unknown): string => (isPartnerId(value) ? value : fail());
const instant = (value: unknown): string => {
  const s = text(value, 40, 20);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(s) ||
    !isCalendarDay(s.slice(0, 10)) ||
    Number(s.slice(11, 13)) > 23 ||
    Number(s.slice(14, 16)) > 59 ||
    Number(s.slice(17, 19)) > 59 ||
    !Number.isFinite(Date.parse(s))
  )
    return fail();
  return s;
};
const array = (value: unknown, max = MAX_ROWS): unknown[] =>
  Array.isArray(value) && value.length <= max ? value : fail();
const sections = (value: unknown): PartnerSection[] => {
  const values = array(value, PARTNER_SECTIONS.length).map((v) => oneOf(v, PARTNER_SECTIONS));
  if (new Set(values).size !== values.length) return fail();
  return values;
};

/** Un payload incompleto, troncato o diverso dal contratto non diventa una previsione parziale. */
export function parsePartnerEmailProgram(value: unknown): PartnerEmailProgramSnapshot {
  const root = record(value, [
    "generatedAt",
    "from",
    "days",
    "config",
    "mail",
    "todaySent",
    "items",
    "unprepared",
    "sent",
    "counts",
  ]);
  const generatedAt = instant(root.generatedAt);
  const from = day(root.from);
  const days = integer(root.days, 1, 90);
  const until = addDays(from, days);
  if (!isCalendarDay(addDays(from, days - 1))) return fail();
  const c = record(root.config, [
    "mode",
    "pausedReason",
    "backoffUntil",
    "dailyFirstLimit",
    "firstRealOn",
    "currentRulesVersion",
  ]);
  const m = record(root.mail, ["stopReason", "backoffUntil", "dayStoppedOn", "nextSendAfter"]);
  const t = record(root.todaySent, ["club", "altri"]);
  const counts = record(root.counts, [
    "total",
    "returned",
    "unpreparedTotal",
    "unpreparedReturned",
  ]);
  const items = array(root.items).map((value): PartnerEmailProgramItem => {
    const r = record(value, [
      "jobId",
      "partnerId",
      "co",
      "name",
      "sections",
      "flow",
      "status",
      "step",
      "reason",
      "writeOn",
      "eligible",
      "rank",
      "sendPriority",
      "country",
      "timezone",
      "choiceReason",
      "request",
      "contactKind",
      "eventStartsOn",
      "researchAt",
      "partnerVersion",
      "draft",
      "hold",
      "windows",
    ]);
    const draft = nullable(r.draft, (value) => {
      const d = record(value, [
        "id",
        "sha256",
        "subject",
        "body",
        "language",
        "rulesVersion",
        "createdAt",
      ]);
      const sha256 = text(d.sha256, 64, 64);
      if (!/^[0-9a-f]{64}$/.test(sha256)) return fail();
      return {
        id: id(d.id),
        sha256,
        subject: text(d.subject, 300, 1),
        body: text(d.body, 8000, 1),
        language: oneOf(d.language, LANGUAGES),
        rulesVersion: integer(d.rulesVersion, 1),
        createdAt: instant(d.createdAt),
      };
    });
    const hold = nullable(r.hold, (value) => {
      const h = record(value, ["id", "version", "createdAt"]);
      return { id: id(h.id), version: integer(h.version, 1), createdAt: instant(h.createdAt) };
    });
    const windows = array(r.windows, 180)
      .map((value) => {
        const w = record(value, ["day", "start", "end"]);
        const window = { day: day(w.day), start: instant(w.start), end: instant(w.end) };
        const start = Date.parse(window.start),
          end = Date.parse(window.end);
        if (
          window.day < from ||
          window.day >= until ||
          start >= end ||
          romeDay(new Date(start)) !== window.day ||
          romeDay(new Date(end - 1)) !== window.day
        )
          return fail();
        return window;
      })
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    if (windows.some((w, i) => i > 0 && Date.parse(w.start) < Date.parse(windows[i - 1].end)))
      return fail();
    return {
      jobId: id(r.jobId),
      partnerId: id(r.partnerId),
      co: isPartnerCo(r.co) ? r.co : fail(),
      name: text(r.name, 240, 1),
      sections: sections(r.sections),
      flow: oneOf(r.flow, FLOWS),
      status: oneOf(r.status, STATUSES),
      step: oneOf(r.step, STEPS),
      reason: nullable(r.reason, (v) => text(v, 240, 1)),
      writeOn: nullable(r.writeOn, day),
      eligible: bool(r.eligible),
      rank: nullable(r.rank, (v) => integer(v, 1)),
      sendPriority: integer(r.sendPriority, 0, 9),
      country: text(r.country, 240),
      timezone: nullable(r.timezone, (v) => text(v, 100)),
      choiceReason: nullable(r.choiceReason, (v) => text(v, 2000)),
      request: nullable(r.request, (v) => oneOf(v, REQUESTS)),
      contactKind: nullable(r.contactKind, (v) => oneOf(v, KINDS)),
      eventStartsOn: nullable(r.eventStartsOn, day),
      researchAt: nullable(r.researchAt, instant),
      partnerVersion: integer(r.partnerVersion, 1),
      draft,
      hold,
      windows,
    };
  });
  if (
    new Set(items.map((item) => item.jobId)).size !== items.length ||
    new Set(items.map((item) => item.partnerId)).size !== items.length
  )
    return fail();
  const unprepared = array(root.unprepared).map((value): PartnerEmailUnprepared => {
    const r = record(value, ["partnerId", "co", "name", "sections", "flow", "partnerVersion"]);
    return {
      partnerId: id(r.partnerId),
      co: isPartnerCo(r.co) ? r.co : fail(),
      name: text(r.name, 240, 1),
      sections: sections(r.sections),
      flow: oneOf(r.flow, FLOWS),
      partnerVersion: integer(r.partnerVersion, 1),
    };
  });
  const partners = [...items, ...unprepared].map((row) => row.partnerId);
  if (new Set(partners).size !== partners.length) return fail();
  const total = integer(counts.total, 0, MAX_ROWS),
    returned = integer(counts.returned, 0, MAX_ROWS),
    unpreparedTotal = integer(counts.unpreparedTotal, 0, MAX_ROWS),
    unpreparedReturned = integer(counts.unpreparedReturned, 0, MAX_ROWS);
  if (
    total !== returned ||
    returned !== items.length ||
    unpreparedTotal !== unpreparedReturned ||
    unpreparedReturned !== unprepared.length ||
    total + unpreparedTotal > MAX_ROWS
  )
    return fail();
  const sent = array(root.sent).map((value): PartnerEmailProgramSnapshot["sent"][number] => {
    const s = record(value, [
      "id",
      "partnerId",
      "co",
      "name",
      "sections",
      "flow",
      "mode",
      "status",
      "subject",
      "at",
      "lookbookCode",
    ]);
    return {
      id: id(s.id),
      partnerId: id(s.partnerId),
      co: isPartnerCo(s.co) ? s.co : fail(),
      name: text(s.name, 240, 1),
      sections: sections(s.sections),
      flow: oneOf(s.flow, FLOWS),
      mode: oneOf(s.mode, ["prova", "invio"]),
      status: oneOf(s.status, ["pronto", "in_invio", "inviato", "incerto", "respinto", "scartato"]),
      subject: text(s.subject, 300),
      at: instant(s.at),
      lookbookCode: nullable(s.lookbookCode, (v) => oneOf(v, ["porsche_club", "club"])),
    };
  });
  if (new Set(sent.map((item) => item.id)).size !== sent.length) return fail();
  return {
    generatedAt,
    from,
    days,
    config: {
      mode: oneOf(c.mode, MODES),
      pausedReason: nullable(c.pausedReason, (v) => oneOf(v, ["credito", "errore_claude"])),
      backoffUntil: nullable(c.backoffUntil, instant),
      dailyFirstLimit: integer(c.dailyFirstLimit, 1, 15),
      firstRealOn: nullable(c.firstRealOn, day),
      currentRulesVersion: integer(c.currentRulesVersion, 1),
    },
    mail: {
      stopReason: nullable(m.stopReason, (v) => text(v, 80, 1)),
      backoffUntil: nullable(m.backoffUntil, instant),
      dayStoppedOn: nullable(m.dayStoppedOn, day),
      nextSendAfter: nullable(m.nextSendAfter, instant),
    },
    todaySent: { club: integer(t.club, 0), altri: integer(t.altri, 0) },
    items,
    unprepared,
    sent,
    counts: { total, returned, unpreparedTotal, unpreparedReturned },
  };
}

/** Mezzanotte di Roma usando lo stesso helper dei giorni, anche al cambio dell'ora. */
function romeStart(day: string): number {
  const midnight = Date.parse(`${day}T00:00:00Z`);
  let lo = midnight - 4 * 60 * MINUTE,
    hi = midnight + 4 * 60 * MINUTE;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (romeDay(new Date(mid)) < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Nessun filtro qui: quote e prestiti si calcolano sull'intera coda. */
export function forecastPartnerEmails(
  snapshot: PartnerEmailProgramSnapshot,
): PartnerEmailProgramForecast {
  const now = Date.parse(snapshot.generatedAt),
    today = romeDay(new Date(now));
  const result: PartnerEmailProgramForecast = {
    items: snapshot.items.map((item) => ({
      ...item,
      plannedAt: null,
      state: "non_prevista",
      explanation: "Nessuna finestra utile nel periodo, con la coda e le quote attuali.",
    })),
    assumption:
      "Stime sulle bozze attuali con un passo di 8 minuti tra gli invii. L'intervallo reale varia da 4 a 11 minuti; nuove bozze, controlli della casella, modifiche e fermi possono cambiare giorno e ordine. Nessuna data è una prenotazione.",
    days: [],
  };
  type Row = PartnerEmailProgramForecast["items"][number];
  let pool: Row[] = [];
  const reviewCache = new Map<string, boolean>();
  const validAt = (row: Row, at: number, on: string): string | null => {
    if (!row.draft || !row.researchAt || row.rank === null || !row.request || !row.contactKind)
      return "I dati della bozza o della scelta sono incompleti: serve una verifica.";
    if (row.draft.rulesVersion !== snapshot.config.currentRulesVersion)
      return "La bozza usa regole diverse da quelle attuali e deve essere ricontrollata.";
    if (Date.parse(row.researchAt) + TTL <= at)
      return "La ricerca ha raggiunto 21 giorni: occorre ripreparare la bozza prima dell'invio.";
    const key = `${row.jobId}/${on}`;
    let valid = reviewCache.get(key);
    if (valid === undefined) {
      valid = partnerAssistantSendRecheck(
        {
          choice: {
            contactKind: row.contactKind,
            request: row.request,
            eventStartsOn: row.eventStartsOn ?? "",
          },
          body: row.draft.body,
          draftCreatedAt: row.draft.createdAt,
        },
        on,
      ).ok;
      reviewCache.set(key, valid);
    }
    return valid
      ? null
      : "Le date o la proposta della bozza non sono più valide nel giorno previsto: serve una revisione.";
  };
  const set = (row: Row, state: PartnerEmailProgramState, explanation: string) => {
    row.state = state;
    row.explanation = explanation;
  };
  // Durante l'SMTP il lavoro è ancora pronta, ma il messaggio ha già consumato la quota.
  // Una prima email partita o forse partita non riceve un altro posto nella simulazione.
  const handled = new Map(
    snapshot.sent
      .filter(
        (message) =>
          message.mode === "invio" && ["in_invio", "inviato", "incerto"].includes(message.status),
      )
      .map((message) => [message.partnerId, message.status]),
  );
  for (const row of result.items) {
    if (row.status === "inviata" || handled.get(row.partnerId) === "inviato")
      set(
        row,
        "non_prevista",
        "La prima email risulta già inviata; non è previsto un altro primo contatto.",
      );
    else if (handled.get(row.partnerId) === "in_invio")
      set(row, "non_prevista", "L'invio è già in corso; non è previsto un secondo primo contatto.");
    else if (handled.get(row.partnerId) === "incerto")
      set(
        row,
        "da_rivedere",
        "L'esito dell'invio è incerto: serve Tommi, senza un nuovo tentativo automatico.",
      );
    else if (row.reason === "bozza_manuale_da_rivedere")
      set(row, "da_rivedere", "La bozza modificata da Tommi va rivista prima dell'invio.");
    else if (!row.eligible)
      set(row, "non_prevista", "Il contatto non è attualmente idoneo all'invio automatico.");
    else if (row.status === "serve_tommaso")
      set(row, "da_rivedere", "Il lavoro richiede una verifica di Tommi.");
    else if (row.status === "attesa")
      set(
        row,
        "attesa",
        row.writeOn
          ? `La preparazione riprende dal ${row.writeOn}; questa non è una data d'invio.`
          : "Il lavoro attende una data di ripresa della preparazione.",
      );
    else if (row.status !== "pronta")
      set(
        row,
        "da_preparare",
        snapshot.config.pausedReason === "credito"
          ? "La bozza è da preparare; la preparazione è ferma per credito esaurito."
          : snapshot.config.pausedReason
            ? "La bozza è da preparare; la preparazione è in pausa per un errore di Claude."
            : snapshot.config.backoffUntil && Date.parse(snapshot.config.backoffUntil) > now
              ? "La bozza è da preparare; la preparazione è temporaneamente in attesa."
              : "La bozza deve ancora completare preparazione e controllo prima di avere una stima d'invio.",
      );
    else {
      const invalid = validAt(row, now, today);
      if (invalid) set(row, "da_rivedere", invalid);
      else if (row.hold)
        set(
          row,
          "sospesa",
          "L'email è sospesa per la revisione del testo; riprende solo quando la revisione viene conclusa.",
        );
      else if (snapshot.config.mode !== "invio")
        set(
          row,
          "sospesa",
          "L'assistente non è in modalità Invio: nessuna partenza è programmata.",
        );
      else if (snapshot.mail.stopReason !== null)
        set(
          row,
          "sospesa",
          "Gli invii della casella sono fermi e richiedono una ripresa esplicita.",
        );
      else pool.push(row);
    }
  }
  pool.sort((a, b) => a.rank! - b.rank! || a.co - b.co);
  let firstRealOn = snapshot.config.firstRealOn;
  let nextAt = Math.max(
    now,
    ...[snapshot.mail.backoffUntil, snapshot.mail.nextSendAfter].map((at) =>
      at === null ? now : Date.parse(at),
    ),
  );
  for (let offset = 0; offset < snapshot.days; offset++) {
    const on = addDays(snapshot.from, offset);
    const limit =
      firstRealOn === null || daysBetween(firstRealOn, on) <= 6
        ? 5
        : snapshot.config.dailyFirstLimit;
    const dayResult = { day: on, limit, club: 0, altri: 0 };
    result.days.push(dayResult);
    if (on < today || pool.length === 0) continue;
    const end = romeStart(addDays(on, 1));
    let cursor = Math.max(romeStart(on), nextAt);
    if (cursor >= end) continue;
    const used = on === today ? { ...snapshot.todaySent } : { club: 0, altri: 0 };
    while (cursor < end) {
      pool = pool.filter((row) => {
        const invalid = validAt(row, cursor, on);
        if (invalid) set(row, "da_rivedere", invalid);
        return invalid === null;
      });
      if (snapshot.mail.dayStoppedOn === on || used.club + used.altri >= limit || pool.length === 0)
        break;
      const allowed = (flow: PartnerEmailFlow) =>
        flow === "club"
          ? used.club < Math.floor(limit / 2)
          : used.altri < limit - Math.floor(limit / 2);
      const open = (row: Row) =>
        row.windows.some(
          (window) =>
            window.day === on &&
            Date.parse(window.start) <= cursor &&
            cursor < Date.parse(window.end),
        );
      const chosen = pool.find((row) => allowed(row.flow) && open(row));
      if (chosen) {
        chosen.plannedAt = new Date(cursor).toISOString();
        set(
          chosen,
          "prevista",
          "Stima secondo la coda globale, la finestra del destinatario e la quota del suo lavoro. Il testo e la casella saranno ricontrollati all'invio.",
        );
        used[chosen.flow]++;
        dayResult[chosen.flow]++;
        firstRealOn ??= on;
        pool = pool.filter((row) => row !== chosen);
        cursor += STEP;
        nextAt = cursor;
      } else {
        let next = end;
        for (const row of pool) {
          // Anche una ricerca senza finestre oggi può scadere prima del giorno successivo.
          const expiry = Date.parse(row.researchAt!) + TTL;
          if (expiry > cursor) next = Math.min(next, expiry);
          if (allowed(row.flow))
            for (const window of row.windows) {
              const start = Date.parse(window.start);
              if (window.day === on && start > cursor) next = Math.min(next, start);
            }
        }
        cursor = next;
      }
    }
  }
  return result;
}
