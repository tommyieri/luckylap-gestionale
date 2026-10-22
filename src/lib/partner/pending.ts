// Partner: invii dall'esito incerto (spec 02 §5.11), sul modello di src/lib/sales/pending.ts.
//
// Un comando senza risposta certa resta in sessionStorage con il suo operation_id: «Verifica»
// lo ripete identico e la ricevuta del database restituisce l'esito di allora, senza doppioni.
// La chiave contiene l'utente, così un altro account sullo stesso browser non lo vede.
// Ogni accesso allo storage è protetto: in navigazione privata il tentativo resta in memoria.
import { parsePartnerCommand, type PartnerCommand } from "./commands";
import {
  PARTNER_APPROACH_LABELS,
  PARTNER_RECORDABLE_KINDS,
  PARTNER_ACTIVITY_KIND_LABELS,
  PARTNER_STAGE_LABELS,
  formatCo,
  isPartnerApproach,
  isPartnerStage,
} from "./model";

export const PENDING_PARTNER_EVENT = "luckylap-partner-pending";
export const pendingPartnerPrefix = (userId: string) => `luckylap.partner.pending:${userId}:`;
const MAX_LENGTH = 1_100_000;

type Reader = Pick<Storage, "length" | "key" | "getItem">;

/** Salva il tentativo; `false` se lo storage non è disponibile. */
export function storePendingPartner(
  storage: Pick<Storage, "setItem"> | null | undefined,
  userId: string,
  scope: string,
  command: PartnerCommand,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(
      `${pendingPartnerPrefix(userId)}${scope}`,
      JSON.stringify({
        kind: command.kind,
        operationId: command.operationId,
        payload: command.payload,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearPendingPartner(
  storage: Pick<Storage, "removeItem"> | null | undefined,
  userId: string,
  scope: string,
): void {
  try {
    storage?.removeItem(`${pendingPartnerPrefix(userId)}${scope}`);
  } catch {
    // Storage non disponibile: non c'era niente da togliere.
  }
}

/**
 * Tentativi rimasti in sospeso per l'utente, tranne quelli dei moduli già aperti
 * (`activeScopes`). `unreadable` segnala voci illeggibili, da mostrare come bloccate.
 * Un invio di ieri resta ripetibile: il giorno dichiarato è nel passato, non nel futuro.
 */
export function recoverPendingPartner(
  storage: Reader | null | undefined,
  userId: string,
  activeScopes: readonly string[] = [],
  now: Date = new Date(),
): { entries: { key: string; scope: string; command: PartnerCommand }[]; unreadable: boolean } {
  const prefix = pendingPartnerPrefix(userId);
  const entries: { key: string; scope: string; command: PartnerCommand }[] = [];
  let unreadable = false;
  try {
    if (!storage) return { entries, unreadable };
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const scope = key.slice(prefix.length);
      if (activeScopes.includes(scope)) continue;
      try {
        const raw = storage.getItem(key);
        const value: unknown = raw && raw.length <= MAX_LENGTH ? JSON.parse(raw) : null;
        const command = parsePartnerCommand(
          value && typeof value === "object" ? { ...value, retry: true } : null,
          now,
        );
        if (command) entries.push({ key, scope, command });
        else unreadable = true;
      } catch {
        unreadable = true;
      }
    }
  } catch {
    unreadable = true;
  }
  return { entries, unreadable };
}

/**
 * Righe leggibili per PendingAttempt: contatto e cosa si stava salvando. Mai id o codici:
 * l'operation_id resta nel «Codice per l'assistenza».
 */
export function pendingPartnerLines(
  command: PartnerCommand,
  partner: { co: number; name: string } | null,
): string[] {
  const lines: string[] = [];
  if (partner) lines.push(`Contatto: ${formatCo(partner.co)} · ${partner.name}`);
  const p = command.payload;
  switch (command.kind) {
    case "set_partner_state":
      if (isPartnerStage(p.stage)) lines.push(`Stato: ${PARTNER_STAGE_LABELS[p.stage]}`);
      if ("owner_id" in p) lines.push("Cambio di «Seguito da»");
      if ("next_action" in p) lines.push("Prossima azione");
      if (isPartnerApproach(p.chosen_approach))
        lines.push(`Approccio: ${PARTNER_APPROACH_LABELS[p.chosen_approach]}`);
      break;
    case "record_partner_activity": {
      const kind = PARTNER_RECORDABLE_KINDS.find((item) => item === p.kind);
      if (kind)
        lines.push(
          `Registro: ${kind === "inviato" && p.message_kind === "sollecito" ? "Sollecito inviato" : PARTNER_ACTIVITY_KIND_LABELS[kind]}`,
        );
      if (typeof p.occurred_on === "string")
        lines.push(`Giorno: ${p.occurred_on.split("-").reverse().join("/")}`);
      break;
    }
    case "save_partner":
      lines.push(p.partner_id === null ? "Nuovo contatto" : "Modifica della scheda");
      if (typeof p.name === "string" && !partner) lines.push(`Nome: ${p.name}`);
      break;
    case "save_partner_message":
      if (isPartnerApproach(p.approach))
        lines.push(`Messaggio ${PARTNER_APPROACH_LABELS[p.approach]}`);
      break;
    case "restore_partner_message":
      lines.push("Ripristino del testo originale");
      break;
    case "save_partner_contact":
      lines.push(p.contact_id === null ? "Nuovo recapito" : "Modifica di un recapito");
      break;
    case "remove_partner_contact":
      lines.push(p.erase === true ? "Cancellazione di un recapito" : "Rimozione di un recapito");
      break;
    case "set_partner_do_not_contact":
      lines.push(
        p.active === true ? "Lista «Non contattare»: aggiunta" : "Lista «Non contattare»: tolto",
      );
      break;
    case "resolve_partner_difference":
      lines.push(
        p.choice === "kept_team" ? "Differenza: tieni il nostro" : "Differenza: usa il nuovo",
      );
      break;
    case "import_partner_device_file":
      lines.push(`Import del file del ${p.device === "computer" ? "computer" : "telefono"}`);
      break;
  }
  return lines;
}
