// Il piano salvato dal motore SQL: questo lettore non calcola orari né autorizza invii.
import { addDays, isCalendarDay, romeDay } from "./dates";
import { hasControlCharacters, isPartnerCo, isPartnerId } from "./model";

export type PartnerSendPlanSlot = {
  id: string;
  kind: "primo" | "sollecito";
  partnerId: string;
  co: number;
  name: string;
  timezone: string;
  localDay: string;
  plannedAt: string;
  expiresAt: string;
  status: "scheduled" | "sending" | "sent" | "uncertain" | "skipped" | "expired";
  reason: string | null;
};
export type PartnerSendPlan = {
  day: string;
  generatedAt: string;
  mode: "spento" | "prepara" | "prova" | "invio";
  slots: PartnerSendPlanSlot[];
};

export const PARTNER_SEND_PLAN_UNREADABLE =
  "Piano degli orari non leggibile: aggiorna la pagina. Non si possono confermare gli orari da questa lettura.";

/** Il parametro modifica solo la lettura del piano; non crea slot e non cambia la coda. */
export function partnerSendPlanDay(value: unknown, today: string): string {
  return isCalendarDay(value) && value >= addDays(today, -30) && value <= addDays(today, 2)
    ? value
    : today;
}

const object = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const instant = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    )
  )
    return false;
  return isCalendarDay(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
};
const SLOT_KEYS = [
  "id",
  "kind",
  "partner_id",
  "co",
  "name",
  "timezone",
  "local_day",
  "planned_at",
  "expires_at",
  "status",
  "reason",
];

/** DTO snake_case esatto. Qualunque campo estraneo, parziale o incoerente invalida il piano
 * intero; nessun indirizzo o messaggio della posta viene inoltrato al client. */
export function parsePartnerSendPlan(value: unknown): PartnerSendPlan | null {
  if (
    !object(value, ["day", "generated_at", "mode", "slots"]) ||
    !isCalendarDay(value.day) ||
    !instant(value.generated_at) ||
    typeof value.mode !== "string" ||
    !["spento", "prepara", "prova", "invio"].includes(value.mode) ||
    !Array.isArray(value.slots) ||
    value.slots.length > 2000
  )
    return null;
  const slots: PartnerSendPlanSlot[] = [];
  const ids = new Set<string>();
  for (const row of value.slots) {
    if (
      !object(row, SLOT_KEYS) ||
      !isPartnerId(row.id) ||
      ids.has(row.id) ||
      !(row.kind === "primo" || row.kind === "sollecito") ||
      !isPartnerId(row.partner_id) ||
      !isPartnerCo(row.co) ||
      typeof row.name !== "string" ||
      Array.from(row.name).length < 1 ||
      Array.from(row.name).length > 240 ||
      hasControlCharacters(row.name) ||
      typeof row.timezone !== "string" ||
      row.timezone.length > 100 ||
      !isCalendarDay(row.local_day) ||
      !instant(row.planned_at) ||
      !instant(row.expires_at) ||
      Date.parse(row.expires_at) <= Date.parse(row.planned_at) ||
      romeDay(new Date(row.planned_at)) !== value.day ||
      typeof row.status !== "string" ||
      !["scheduled", "sending", "sent", "uncertain", "skipped", "expired"].includes(row.status) ||
      !(
        row.reason === null ||
        (typeof row.reason === "string" && /^[a-z][a-z0-9_]{0,79}$/u.test(row.reason))
      )
    )
      return null;
    try {
      const local = new Intl.DateTimeFormat("en-CA", {
        timeZone: row.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(row.planned_at));
      if (local !== row.local_day) return null;
    } catch {
      return null;
    }
    ids.add(row.id);
    slots.push({
      id: row.id,
      kind: row.kind,
      partnerId: row.partner_id,
      co: row.co,
      name: row.name,
      timezone: row.timezone,
      localDay: row.local_day,
      plannedAt: row.planned_at,
      expiresAt: row.expires_at,
      status: row.status as PartnerSendPlanSlot["status"],
      reason: row.reason as string | null,
    });
  }
  return {
    day: value.day,
    generatedAt: value.generated_at,
    mode: value.mode as PartnerSendPlan["mode"],
    slots,
  };
}

const REASONS: Record<string, string> = {
  slot_scaduto: "Orario superato: nessun recupero a raffica.",
  expired: "Orario superato: nessun recupero a raffica.",
  limite: "Quota giornaliera raggiunta.",
  fuori_finestra: "Fuori dalla finestra del destinatario.",
  fuori_ufficio: "Fuori ufficio: attesa della data di rientro.",
  non_scaduto: "Il sollecito non è ancora dovuto.",
  controllo_scaduto: "La verifica della posta deve essere ripetuta.",
  contesto_cambiato: "Scheda o bozza cambiate: serve una nuova verifica.",
  controllo_incerto: "La verifica della posta è incompleta: nessun invio autorizzato.",
  risposta_possibile: "Possibile risposta: controlla la conversazione.",
  invio_rifiutato: "Il server di posta ha rifiutato il messaggio.",
  ripianificato: "Orario ripianificato: consulta il piano aggiornato.",
  invio_incerto: "Esito incerto: controlla la posta prima di proseguire.",
  fermo: "Invii fermi.",
  osserva: "Solleciti in osservazione: nessun invio automatico.",
};
export function partnerSendPlanReasonLabel(reason: string | null): string {
  return reason === null
    ? ""
    : Object.hasOwn(REASONS, reason)
      ? REASONS[reason]
      : "Invio da verificare: controlla lo stato del contatto.";
}
