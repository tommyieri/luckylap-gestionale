// Solo metadati della conversazione. Nessun indirizzo, testo della posta, prova o autorizzazione
// SMTP attraversa questo parser verso la scheda contatto.
import { isCalendarDay } from "./dates";
import { isPartnerId } from "./model";

export type PartnerFollowupStatus = {
  id: string;
  status: "active" | "held" | "replied" | "complete";
  reason: string | null;
  version: number;
  followupsSent: number;
  nextDueOn: string | null;
  lastCheckedAt: string | null;
  nextCheckAt: string;
  mode: "spento" | "osserva" | "invio";
};

export const PARTNER_FOLLOWUP_UNREADABLE =
  "Verifica dei solleciti non leggibile: ricarica la scheda prima di considerarli automatici.";

const KEYS = [
  "id",
  "status",
  "reason",
  "version",
  "followups_sent",
  "next_due_on",
  "last_checked_at",
  "next_check_at",
  "mode",
];
const INSTANT =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;
function instant(value: unknown): value is string {
  const match = typeof value === "string" ? INSTANT.exec(value) : null;
  return match !== null && isCalendarDay(match[1]) && Number.isFinite(Date.parse(value as string));
}

/** RPC read_partner_followup: chiavi snake_case esatte; null, errori e DTO superati non
 * attestano che l'invio sia attivo. Un motivo è soltanto un codice, mai un testo libero. */
export function parsePartnerFollowupStatus(value: unknown): PartnerFollowupStatus | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== KEYS.length ||
    !KEYS.every((key) => Object.hasOwn(row, key)) ||
    !isPartnerId(row.id) ||
    typeof row.status !== "string" ||
    !["active", "held", "replied", "complete"].includes(row.status) ||
    typeof row.mode !== "string" ||
    !["spento", "osserva", "invio"].includes(row.mode) ||
    !(
      row.reason === null ||
      (typeof row.reason === "string" && /^[a-z][a-z0-9_]{0,79}$/u.test(row.reason))
    ) ||
    typeof row.version !== "number" ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    typeof row.followups_sent !== "number" ||
    !Number.isSafeInteger(row.followups_sent) ||
    row.followups_sent < 0 ||
    row.followups_sent > 4 ||
    !(row.next_due_on === null || isCalendarDay(row.next_due_on)) ||
    !(row.last_checked_at === null || instant(row.last_checked_at)) ||
    !instant(row.next_check_at) ||
    (row.status === "active" && (row.followups_sent === 4 || row.next_due_on === null)) ||
    (row.status === "complete" && (row.followups_sent !== 4 || row.next_due_on !== null))
  )
    return null;
  return {
    id: row.id,
    status: row.status as PartnerFollowupStatus["status"],
    reason: row.reason as string | null,
    version: row.version,
    followupsSent: row.followups_sent,
    nextDueOn: row.next_due_on as string | null,
    lastCheckedAt: row.last_checked_at as string | null,
    nextCheckAt: row.next_check_at,
    mode: row.mode as PartnerFollowupStatus["mode"],
  };
}

const POSSIBLE_REPLY =
  "Possibile risposta nella posta: Tommi controlla la conversazione. Il controllo non ha registrato una risposta.";
const REASONS: Record<string, string> = {
  fuori_ufficio: "Fuori ufficio: la data di rientro richiede una verifica di Tommi.",
  reply: POSSIBLE_REPLY,
  manual: "Possibile invio manuale nella conversazione: Tommi controlla la posta.",
  ambiguous: "Un messaggio non è attribuibile con certezza: Tommi controlla la conversazione.",
  risposta_trovata: POSSIBLE_REPLY,
  risposta_possibile: POSSIBLE_REPLY,
  risposta_registrata: "Una risposta è stata registrata nel gestionale.",
  attivita_team: "Il team ha preso in carico o lavorato questo contatto.",
  non_contattare: "Il contatto non è più contattabile automaticamente.",
  assistente_fermo: "L'assistente è fermato su questo contatto.",
  recapito_cambiato: "Il recapito è cambiato: serve una verifica.",
  invio_incerto: "Invio incerto: l'assistente non lo ritenta. Controlla la posta.",
  invio_rifiutato: "Il server di posta ha rifiutato il sollecito.",
  modifica_in_corso: "È in corso una modifica del testo.",
  primo_non_valido: "I dati della prima email non consentono di proseguire.",
  solleciti_finiti: "Il ciclo di quattro solleciti è concluso.",
  bozza_da_preparare: "La bozza richiede una nuova preparazione editoriale.",
};
/** Un codice sconosciuto resta una verifica da fare; non si espone il valore ricevuto. */
export function partnerFollowupReasonLabel(reason: string | null): string {
  return reason === null
    ? ""
    : Object.hasOwn(REASONS, reason)
      ? REASONS[reason]
      : "Verifica necessaria: Tommi controlla la conversazione nella posta.";
}
