// Partner: l'assistente visto dall'interfaccia (specifica dell'assistente Partner, «Interfaccia»).
// Tipi, parser ed etichette in italiano. Funzioni pure, come model.ts e read.ts.
//
// - Lo stato viene da read_partner_assistant_status (migrazione 20261028122704_assistente_partner):
//   le stesse chiavi, in camelCase. Una chiave in più o in meno, un numero negativo o una data non
//   valida danno PartnerReadError.
// - Il blocco della scheda viene dalle tabelle public.partner_assistant_*: interruttore, lavoro, le
//   note e la bozza citate dal lavoro. L'indirizzo della bozza è quello del recapito del gestionale.
// - Le regole: quella in vigore con il testo, la cronologia senza.
import type {
  PartnerAssistantJobStatus,
  PartnerAssistantLanguage,
  PartnerAssistantRequest,
  PartnerAssistantStep,
} from "../partner-assistant/types";
import { PARTNER_ASSISTANT_MODES } from "./commands";
import { isCalendarDay } from "./dates";
import {
  PARTNER_NAME_MAX,
  PartnerReadError,
  charCount,
  isPartnerCo,
  isPartnerId,
  type PartnerContact,
} from "./model";

export type PartnerAssistantMode = (typeof PARTNER_ASSISTANT_MODES)[number];
export type PartnerAssistantPausedReason = "credito" | "errore_claude";

export const PARTNER_ASSISTANT_JOB_STATUSES = [
  "in_coda",
  "attesa",
  "pronta",
  "serve_tommaso",
] as const satisfies readonly PartnerAssistantJobStatus[];
export const PARTNER_ASSISTANT_STEPS = [
  "ricerca",
  "estrazione",
  "scrittura",
  "controllo",
] as const satisfies readonly PartnerAssistantStep[];
/** Le proposte dell'elenco chiuso (Appendice A), come le salva la nota «scelta». */
export const PARTNER_ASSISTANT_REQUESTS = [
  "merch_cobranding",
  "collab_capsule",
  "stand_evento",
  "vendita_negozio",
] as const satisfies readonly PartnerAssistantRequest[];
const LANGUAGES = [
  "it",
  "en",
  "de",
  "fr",
  "es",
] as const satisfies readonly PartnerAssistantLanguage[];
const PAUSED_REASONS = ["credito", "errore_claude"] as const;

// ---------------------------------------------------------------------------
// Etichette
// ---------------------------------------------------------------------------

export const PARTNER_ASSISTANT_MODE_LABELS: Record<PartnerAssistantMode, string> = {
  spento: "Spento",
  prepara: "Prepara",
  prova: "Prova",
  invio: "Invio",
};

export const PARTNER_ASSISTANT_STATUS_LABELS: Record<PartnerAssistantJobStatus, string> = {
  in_coda: "In coda",
  attesa: "In attesa della data",
  pronta: "Bozza pronta",
  serve_tommaso: "Serve Tommi",
};

/** I conteggi della coda (read_partner_assistant_status), con le etichette della pagina. */
export const PARTNER_ASSISTANT_COUNT_LABELS: Record<
  keyof PartnerAssistantStatus["counts"],
  string
> = {
  inCoda: PARTNER_ASSISTANT_STATUS_LABELS.in_coda,
  attesa: PARTNER_ASSISTANT_STATUS_LABELS.attesa,
  pronta: PARTNER_ASSISTANT_STATUS_LABELS.pronta,
  serveTommaso: PARTNER_ASSISTANT_STATUS_LABELS.serve_tommaso,
  ferma: "Fermati dal team",
};

/** Stato non leggibile: la stessa frase nella striscia di /partner e nel blocco della scheda. */
export const PARTNER_ASSISTANT_UNREADABLE =
  "Stato dell'assistente non leggibile: ricarica la pagina tra poco.";

export const PARTNER_ASSISTANT_REQUEST_LABELS: Record<PartnerAssistantRequest, string> = {
  merch_cobranding: "Merch co-firmato",
  collab_capsule: "Capsule insieme",
  stand_evento: "Stand all'evento",
  vendita_negozio: "Vendita in negozio",
};

/**
 * Motivi scritti dalla SQL e dal worker: quelli dei lavori passati a Tommi
 * (partner_assistant_jobs.reason) e quelli dei passi non conclusi, che finiscono negli eventi
 * (fail_partner_assistant_step e contesto cambiato).
 */
export const PARTNER_ASSISTANT_REASON_LABELS = {
  troppi_tentativi: "Tre tentativi falliti di fila su questo contatto.",
  controlli_falliti: "La bozza non ha passato i controlli nemmeno dopo la riscrittura.",
  seconda_lettura: "La seconda lettura ha trovato problemi anche nella bozza riscritta.",
  fatto_mancante: "La ricerca non ha trovato un fatto vero e recente da citare.",
  fuso_mancante: "La ricerca non ha trovato il fuso orario del destinatario.",
  risposta_non_valida: "Claude ha dato una risposta non valida, rifiutata o incompleta.",
  timeout: "Claude non ha risposto in tempo.",
  troppe_continuazioni: "Claude non ha finito la ricerca entro le riprese previste.",
  claude_attesa: "Claude non era disponibile: l'assistente riprova tra dieci minuti.",
  tempo_insufficiente: "Nel giro non restava abbastanza tempo per chiamare Claude.",
  contesto_cambiato: "Le email del contatto sono cambiate durante la scrittura: si riscrive.",
  spento: "L'assistente è stato spento durante il passo.",
  pausa: "L'assistente era in pausa: il passo si è fermato.",
  attesa: "L'assistente aspettava dopo un errore temporaneo di Claude.",
  lease_persa: "Il passo ha superato il tempo concesso.",
  non_idoneo: "Il contatto non è più tra quelli che l'assistente può seguire.",
  dato_cancellato:
    "Un dato del contatto è stato cancellato: ridallo all'assistente se vuoi rifare ricerca e bozza.",
} as const;
export type PartnerAssistantReason = keyof typeof PARTNER_ASSISTANT_REASON_LABELS;

/** Frase del motivo; un codice nuovo, che la SQL accetta, non rompe la pagina. */
export function partnerAssistantReasonLabel(reason: string): string {
  return Object.hasOwn(PARTNER_ASSISTANT_REASON_LABELS, reason)
    ? PARTNER_ASSISTANT_REASON_LABELS[reason as PartnerAssistantReason]
    : "Motivo non riconosciuto.";
}

/** Nomi propri che restano maiuscoli anche dopo i due punti. */
const PROPER_NAMES = ["Claude", "Tommi"];

/** La frase del motivo dopo i due punti («Serve Tommi: la ricerca…»): minuscola, tranne i nomi. */
export function partnerAssistantReasonInline(reason: string): string {
  const label = partnerAssistantReasonLabel(reason);
  return PROPER_NAMES.some((name) => label.startsWith(`${name} `))
    ? label
    : label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * Esiti degli ultimi eventi (migrazione 20261028122956_assistente_partner_worker), a parole. Per
 * passo: ricerca → salvata; estrazione → scrivi, attendi, fatto_mancante, fuso_mancante;
 * scrittura → controlli_superati, riscrittura, controlli_falliti, contesto_cambiato; controllo →
 * pronta, regole_superate, riscrittura, seconda_lettura. In ogni passo lease_scaduta, non_idoneo
 * e i motivi di fail_partner_assistant_step; senza passo le due pause.
 */
export const PARTNER_ASSISTANT_EVENT_LABELS = {
  salvata: "Ricerca salvata",
  scrivi: "Proposta scelta: scrive la bozza",
  attendi: "Proposta scelta: scriverà più avanti",
  fatto_mancante: "Nessun fatto recente da citare: passa a Tommi",
  fuso_mancante: "Fuso orario non trovato: passa a Tommi",
  controlli_superati: "Bozza scritta, controlli superati",
  riscrittura: "Riscrive la bozza",
  controlli_falliti: "Controlli non superati dopo la riscrittura: passa a Tommi",
  contesto_cambiato: "Email del contatto cambiate: riscrive la bozza",
  pronta: "Bozza pronta per Tommi",
  regole_superate: "Regole cambiate: riscrive la bozza",
  seconda_lettura: "Problemi anche nella bozza riscritta: passa a Tommi",
  lease_scaduta: "Passo scaduto: tentativo fallito",
  non_idoneo: "Contatto non più seguito dall'assistente",
  claude_attesa: "Claude non disponibile: riprova tra dieci minuti",
  timeout: "Claude non ha risposto in tempo: tentativo fallito",
  troppe_continuazioni: "Ricerca non finita entro le riprese: tentativo fallito",
  risposta_non_valida: "Risposta di Claude non valida: tentativo fallito",
  tempo_insufficiente: "Poco tempo rimasto nel giro: riprova dopo",
  troppi_tentativi: "Tre tentativi falliti: passa a Tommi",
  spento: "Passo fermato: assistente spento",
  pausa: "Passo fermato: assistente in pausa",
  attesa: "Passo fermato: assistente in attesa",
  lease_persa: "Passo oltre il tempo concesso",
  pausa_credito: "In pausa: credito finito",
  pausa_errore_claude: "In pausa: errore di Claude",
} as const;
export type PartnerAssistantEventOutcome = keyof typeof PARTNER_ASSISTANT_EVENT_LABELS;

/** Frase dell'esito; un esito sconosciuto si mostra con il suo codice, così com'è. */
export function partnerAssistantEventLabel(outcome: string): string {
  return Object.hasOwn(PARTNER_ASSISTANT_EVENT_LABELS, outcome)
    ? PARTNER_ASSISTANT_EVENT_LABELS[outcome as PartnerAssistantEventOutcome]
    : outcome;
}

const usdFormat = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
/** «1,37 USD». */
export const formatPartnerAssistantUsd = (value: number) => `${usdFormat.format(value)} USD`;

/**
 * Credito di partenza scritto nella pagina, con la virgola o il punto: da 0 a 10.000 dollari con
 * al massimo due decimali, come lo accetta set_partner_assistant_mode. `null` se non è valido.
 */
export function parsePartnerAssistantCredit(text: string): number | null {
  const value = text.trim().replace(",", ".");
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(value)) return null;
  const credit = Number(value);
  return credit <= 10000 ? credit : null;
}

// ---------------------------------------------------------------------------
// Controlli dei valori letti
// ---------------------------------------------------------------------------

const fail = (what: string): never => {
  throw new PartnerReadError(what);
};
const record = (value: unknown, what: string): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(what);
/** Oggetto con esattamente queste chiavi. */
function exact(value: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  const r = record(value, what);
  const found = Object.keys(r);
  if (found.length !== keys.length || !keys.every((key) => Object.hasOwn(r, key))) fail(what);
  return r;
}
const oneOf = <T extends string>(list: readonly T[], value: unknown, what: string): T =>
  typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T)
    : fail(what);
const text = (value: unknown, min: number, max: number, what: string): string =>
  typeof value === "string" && charCount(value) >= min && charCount(value) <= max
    ? value
    : fail(what);
const bool = (value: unknown, what: string): boolean =>
  typeof value === "boolean" ? value : fail(what);
const integer = (value: unknown, min: number, what: string): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min ? value : fail(what);
/** Importo in dollari: numero finito, mai negativo. */
const usd = (value: unknown, what: string): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fail(what);
const id = (value: unknown, what: string): string => (isPartnerId(value) ? value : fail(what));
/** Codice come i check della SQL: `^[a-z][a-z0-9_]{0,79}$`. */
const code = (value: unknown, what: string): string =>
  typeof value === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(value) ? value : fail(what);
const nullable =
  <T>(parse: (value: unknown, what: string) => T) =>
  (value: unknown, what: string): T | null =>
    value === null ? null : parse(value, what);

const INSTANT =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
/** Istante come lo scrive PostgreSQL in JSON (o le fixture, con «Z»), con un giorno reale. */
function instant(value: unknown, what: string): string {
  const match = typeof value === "string" ? INSTANT.exec(value) : null;
  return match && isCalendarDay(match[1]) && Number.isFinite(Date.parse(value as string))
    ? (value as string)
    : fail(what);
}
const day = (value: unknown, what: string): string => (isCalendarDay(value) ? value : fail(what));
/** Link delle fonti come li accetta complete_partner_assistant_research. */
const source = (value: unknown, what: string): string =>
  typeof value === "string" &&
  charCount(value) <= 2048 &&
  /^https:\/\/[^\s/?#@]+([/?#]\S*)?$/.test(value)
    ? value
    : fail(what);

// ---------------------------------------------------------------------------
// Migrazioni non ancora applicate
// ---------------------------------------------------------------------------

/**
 * L'assistente senza le sue migrazioni (per esempio un deploy prima dell'avvio): non è un errore.
 * Striscia e blocco della scheda non si mostrano; l'ambra resta per gli errori veri.
 */
export const PARTNER_ASSISTANT_INACTIVE = "non_attivo";
export type PartnerAssistantInactive = typeof PARTNER_ASSISTANT_INACTIVE;

/**
 * Codici di una funzione o di una tabella che non c'è, nel campo `code` dell'errore di Supabase:
 * PostgREST (PGRST202 funzione, PGRST205 tabella, fuori dalla cache dello schema) e PostgreSQL
 * (42883 undefined_function, 42P01 undefined_table).
 */
const MISSING_CODES: readonly string[] = ["PGRST202", "PGRST205", "42883", "42P01"];
/**
 * Funzioni e tabelle dell'assistente hanno tutte questo pezzo nel nome. 42883 e 42P01 nascono anche
 * da un bug (un operatore che manca, un alias sbagliato): senza un oggetto dell'assistente nel
 * messaggio l'errore resta un errore.
 */
const ASSISTANT_OBJECT = /partner_assistant/;

/** L'errore dice che la funzione o la tabella dell'assistente non c'è ancora. */
export function isPartnerAssistantMissing(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    typeof code === "string" &&
    MISSING_CODES.includes(code) &&
    typeof message === "string" &&
    ASSISTANT_OBJECT.test(message)
  );
}

// ---------------------------------------------------------------------------
// Stato: read_partner_assistant_status
// ---------------------------------------------------------------------------

export type PartnerAssistantStatus = {
  mode: PartnerAssistantMode;
  /** Profilo dell'assistente e founder dei passaggi impostati. */
  configured: boolean;
  pausedReason: PartnerAssistantPausedReason | null;
  /** Attesa di tutto l'assistente dopo un 429, 529 o 5xx di Claude. */
  backoffUntil: string | null;
  lastTickAt: string | null;
  version: number;
  startingCreditUsd: number | null;
  spentUsd: number;
  /** Spesa del giorno di Roma. */
  spentTodayUsd: number;
  counts: { inCoda: number; attesa: number; pronta: number; serveTommaso: number; ferma: number };
  /** Lavori passati a Tommi, chi aspetta da più tempo per primo (al massimo 50). */
  toReview: { co: number; name: string; reason: string; updatedAt: string }[];
  /** Ultimi dieci eventi, dal più recente: passo ed esito come codici. */
  lastEvents: {
    createdAt: string;
    co: number | null;
    step: PartnerAssistantStep | null;
    outcome: string;
  }[];
};

const STATUS_KEYS = [
  "mode",
  "configured",
  "paused_reason",
  "backoff_until",
  "last_tick_at",
  "version",
  "starting_credit_usd",
  "spent_usd",
  "spent_today_usd",
  "counts",
  "to_review",
  "last_events",
] as const;
const COUNT_KEYS = ["in_coda", "attesa", "pronta", "serve_tommaso", "ferma"] as const;

function list(value: unknown, max: number, what: string): unknown[] {
  return Array.isArray(value) && value.length <= max ? value : fail(what);
}

export function partnerAssistantStatusFrom(value: unknown): PartnerAssistantStatus {
  const what = "Stato dell'assistente";
  const r = exact(value, STATUS_KEYS, what);
  const counts = exact(r.counts, COUNT_KEYS, what);
  const count = (key: (typeof COUNT_KEYS)[number]) => integer(counts[key], 0, what);
  return {
    mode: oneOf(PARTNER_ASSISTANT_MODES, r.mode, what),
    configured: bool(r.configured, what),
    pausedReason: nullable((v, w) => oneOf(PAUSED_REASONS, v, w))(r.paused_reason, what),
    backoffUntil: nullable(instant)(r.backoff_until, what),
    lastTickAt: nullable(instant)(r.last_tick_at, what),
    version: integer(r.version, 1, what),
    startingCreditUsd: nullable(usd)(r.starting_credit_usd, what),
    spentUsd: usd(r.spent_usd, what),
    spentTodayUsd: usd(r.spent_today_usd, what),
    counts: {
      inCoda: count("in_coda"),
      attesa: count("attesa"),
      pronta: count("pronta"),
      serveTommaso: count("serve_tommaso"),
      ferma: count("ferma"),
    },
    toReview: list(r.to_review, 50, what).map((item) => {
      const job = exact(item, ["co", "name", "reason", "updated_at"], what);
      return {
        co: isPartnerCo(job.co) ? job.co : fail(what),
        name: text(job.name, 1, PARTNER_NAME_MAX, what),
        reason: code(job.reason, what),
        updatedAt: instant(job.updated_at, what),
      };
    }),
    lastEvents: list(r.last_events, 10, what).map((item) => {
      const event = exact(item, ["created_at", "co", "step", "outcome"], what);
      return {
        createdAt: instant(event.created_at, what),
        co: event.co === null ? null : isPartnerCo(event.co) ? event.co : fail(what),
        step: nullable((v, w) => oneOf(PARTNER_ASSISTANT_STEPS, v, w))(event.step, what),
        outcome: code(event.outcome, what),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Blocco della scheda: public.partner_assistant_*
// ---------------------------------------------------------------------------

/**
 * Il blocco «Assistente» della scheda. Senza righe (né lavoro né interruttore) è vuoto: attivo,
 * `switchVersion`, `job`, `research`, `choice` e `draft` a `null`. Lo «stato non leggibile» non è
 * questa vista: è `PartnerDetail.assistant === null`; senza migrazioni è
 * `PARTNER_ASSISTANT_INACTIVE`.
 */
export type PartnerAssistantContactView = {
  /** Interruttore «Assistente su questo contatto»: senza riga è attivo. */
  active: boolean;
  /** Versione della riga dell'interruttore; `null` se non c'è. */
  switchVersion: number | null;
  job: {
    status: PartnerAssistantJobStatus;
    step: PartnerAssistantStep;
    reason: string | null;
    writeOn: string | null;
    updatedAt: string;
  } | null;
  /** La ricerca del lavoro in corso, con le fonti. */
  research: { createdAt: string; text: string; sources: string[] } | null;
  /** La proposta scelta, il motivo e l'indirizzo trovato dalla ricerca (solo una proposta). */
  choice: {
    request: PartnerAssistantRequest;
    reasonIt: string;
    language: PartnerAssistantLanguage;
    proposedEmail: string;
  } | null;
  /** La bozza com'è salvata, firma compresa; il destinatario viene dal recapito. */
  draft: {
    subject: string;
    body: string;
    signature: string;
    /** Indirizzo del recapito; `null` se cancellato. */
    toAddress: string | null;
    createdAt: string;
    rulesVersion: number;
  } | null;
};

/** Righe lette per un contatto: interruttore, lavoro, note e bozza citate dal lavoro. */
export type PartnerAssistantRows = {
  switch: unknown;
  job: unknown;
  notes: readonly unknown[];
  draft: unknown;
};
export type PartnerAssistantContactRows = PartnerAssistantRows & {
  partnerId: string;
  /** Recapiti del contatto, già letti con la scheda. */
  contacts: readonly PartnerContact[];
};

const present = (value: unknown) => value !== null && value !== undefined;

/** Dalla nota «scelta»: la proposta deve essere dell'elenco chiuso, la lingua una delle cinque. */
const choiceOf = (content: Record<string, unknown>, what: string) => ({
  request: oneOf(PARTNER_ASSISTANT_REQUESTS, content.request, what),
  reasonIt: text(content.reason_it, 0, 2000, what),
  language: oneOf(LANGUAGES, content.language, what),
  proposedEmail: text(content.recipient_email, 0, 2000, what),
});

export function partnerAssistantContactFrom(
  rows: PartnerAssistantContactRows,
): PartnerAssistantContactView {
  const what = "Assistente";
  const own = (value: unknown) => {
    const r = record(value, what);
    if (r.partner_id !== rows.partnerId) fail(what);
    return r;
  };
  const toggle = present(rows.switch) ? own(rows.switch) : null;
  const job = present(rows.job) ? own(rows.job) : null;
  const notes = rows.notes.map(own);
  if (new Set(notes.map((note) => id(note.id, what))).size !== notes.length) fail(what);
  const note = (noteId: unknown, kind: "ricerca" | "scelta") => {
    if (noteId === null) return null;
    const found = notes.find((item) => item.id === id(noteId, what));
    if (!found || found.kind !== kind) fail(what);
    return found!;
  };
  const draftId = job === null ? null : nullable(id)(job.draft_id, what);
  if (job === null && (notes.length > 0 || present(rows.draft))) fail(what);
  if (draftId === null && present(rows.draft)) fail(what);

  const research = job === null ? null : note(job.research_note_id, "ricerca");
  const choice = job === null ? null : note(job.choice_note_id, "scelta");
  const draft = draftId === null ? null : own(rows.draft);
  if (draft !== null && draft.id !== draftId) fail(what);
  const contact =
    draft === null ? null : rows.contacts.find((item) => item.id === id(draft.contact_id, what));
  if (draft !== null && contact?.partnerId !== rows.partnerId) fail(what);

  return {
    active: toggle === null ? true : bool(toggle.active, what),
    switchVersion: toggle === null ? null : integer(toggle.version, 1, what),
    job:
      job === null
        ? null
        : {
            status: oneOf(PARTNER_ASSISTANT_JOB_STATUSES, job.status, what),
            step: oneOf(PARTNER_ASSISTANT_STEPS, job.step, what),
            reason: nullable(code)(job.reason, what),
            writeOn: nullable(day)(job.write_on, what),
            updatedAt: instant(job.updated_at, what),
          },
    research:
      research === null
        ? null
        : {
            createdAt: instant(research.created_at, what),
            text: text(record(research.content, what).text, 1, 60000, what),
            sources: list(research.sources, 40, what).map((item) => source(item, what)),
          },
    choice: choice === null ? null : choiceOf(record(choice.content, what), what),
    draft:
      draft === null
        ? null
        : {
            subject: text(draft.subject, 1, 300, what),
            body: text(draft.body, 1, 8000, what),
            signature: text(draft.signature, 1, 300, what),
            // L'indirizzo pulito del recapito, se è ancora un'email e non è stato cancellato.
            toAddress:
              contact!.erasedAt === null && contact!.kind === "email" ? contact!.linkValue : null,
            createdAt: instant(draft.created_at, what),
            rulesVersion: integer(draft.rules_version, 1, what),
          },
  };
}

// ---------------------------------------------------------------------------
// Regole: public.partner_assistant_rules
// ---------------------------------------------------------------------------

export type PartnerAssistantRulesView = {
  current: { version: number; body: string; createdAt: string; author: string };
  /** Tutte le versioni, dalla più recente, senza il testo. */
  history: { version: number; createdAt: string; author: string }[];
};

/** Autore della versione 1, nata con la migrazione senza autore. */
export const PARTNER_ASSISTANT_RULES_FIRST_AUTHOR = "Regole iniziali";

export function partnerAssistantRulesFrom(rows: {
  /** L'ultima versione, con `body`. */
  current: unknown;
  history: readonly unknown[];
  profiles: readonly unknown[];
}): PartnerAssistantRulesView {
  const what = "Regole dell'assistente";
  const names = new Map<string, string>();
  for (const value of rows.profiles) {
    const profile = record(value, what);
    names.set(
      id(profile.user_id, what),
      text(profile.display_name, 1, PARTNER_NAME_MAX, what).trim() || fail(what),
    );
  }
  const entry = (value: unknown) => {
    const r = record(value, what);
    const version = integer(r.version, 1, what);
    // Come il check della tabella: solo la versione 1 è senza autore.
    const author =
      r.created_by === null && version === 1
        ? PARTNER_ASSISTANT_RULES_FIRST_AUTHOR
        : (names.get(id(r.created_by, what)) ?? fail(what));
    return { id: id(r.id, what), version, createdAt: instant(r.created_at, what), author };
  };
  const history = rows.history.map(entry).sort((a, b) => b.version - a.version);
  if (history.length === 0 || new Set(history.map((item) => item.version)).size !== history.length)
    fail(what);
  const current = entry(rows.current);
  if (current.id !== history[0].id || current.version !== history[0].version) fail(what);
  return {
    current: {
      version: current.version,
      body: text(record(rows.current, what).body, 1, 100000, what),
      createdAt: current.createdAt,
      author: current.author,
    },
    history: history.map(({ version, createdAt, author }) => ({ version, createdAt, author })),
  };
}
