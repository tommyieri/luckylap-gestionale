import { hasControlCharacters, isPartnerId, type PartnerSection } from "./model";

export const PARTNER_EMAIL_PATH = "/partner/email";
export type PartnerEmailReadKind = "draft" | "sent" | "job";
export type PartnerEmailDetail = {
  kind: PartnerEmailReadKind;
  id: string;
  jobId: string | null;
  draftId: string | null;
  partnerId: string;
  co: number;
  name: string;
  sections: PartnerSection[];
  subject: string | null;
  body: string | null;
  signature: string | null;
  language: string | null;
  register: string | null;
  address: string | null;
  lookbookCode: string | null;
  sha256: string | null;
  rulesVersion: number | null;
  createdAt: string | null;
  sentAt: string | null;
  choiceReason: string | null;
  researchSources: { title: string; url: string }[];
  hold: { id: string; version: number; createdAt: string } | null;
  editable: boolean;
  whyNotEditable: string | null;
  status?: string | null;
  step?: string | null;
  reason?: string | null;
  optOut?: string;
};

export type PartnerEmailEditCommand = {
  kind: "begin" | "save" | "cancel";
  operationId: string;
  payload: Record<string, unknown> & { schema_version: 1 };
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const version = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

export function parsePartnerEmailEdit(value: unknown): PartnerEmailEditCommand | null {
  if (
    !object(value) ||
    !["begin", "save", "cancel"].includes(String(value.kind)) ||
    !isPartnerId(value.operationId) ||
    !object(value.payload)
  )
    return null;
  if (Object.keys(value).sort().join(",") !== "kind,operationId,payload") return null;
  const p = value.payload;
  const keys =
    value.kind === "begin"
      ? ["schema_version", "job_id", "expected_draft_id", "expected_sha256"]
      : value.kind === "save"
        ? [
            "schema_version",
            "hold_id",
            "expected_hold_version",
            "expected_draft_id",
            "expected_sha256",
            "subject",
            "body",
          ]
        : ["schema_version", "hold_id", "expected_hold_version", "expected_draft_id"];
  if (
    Object.keys(p).sort().join(",") !== keys.sort().join(",") ||
    p.schema_version !== 1 ||
    !isPartnerId(p.expected_draft_id)
  )
    return null;
  if (value.kind === "begin") {
    if (!isPartnerId(p.job_id) || !hash(p.expected_sha256)) return null;
  } else if (!isPartnerId(p.hold_id) || !version(p.expected_hold_version)) return null;
  if (value.kind === "save") {
    if (!hash(p.expected_sha256)) return null;
    if (
      typeof p.subject !== "string" ||
      !p.subject.trim() ||
      [...p.subject].length > 300 ||
      /[\r\n]/.test(p.subject) ||
      hasControlCharacters(p.subject)
    )
      return null;
    if (
      typeof p.body !== "string" ||
      !p.body.trim() ||
      [...p.body].length > 8_000 ||
      hasControlCharacters(p.body)
    )
      return null;
  }
  return value as PartnerEmailEditCommand;
}

export type PartnerEmailActionResult =
  { status: "success"; message: string } | { status: "rejected" | "uncertain"; message: string };

/** Nessun testo del database entra nei messaggi d'errore. */
export function partnerEmailEditError(error: unknown): PartnerEmailActionResult {
  const e = object(error) ? error : {};
  if (e.code === "40001")
    return {
      status: "rejected",
      message: "La bozza o la scheda sono cambiate. Ricarica l'email prima di modificarla.",
    };
  if (e.code === "42501")
    return { status: "rejected", message: "Questa modifica è riservata a Tommi." };
  if (e.code === "22023")
    return {
      status: "rejected",
      message: "Controlla oggetto e testo: ci sono dati mancanti o non validi.",
    };
  if (e.code === "55000")
    return {
      status: "rejected",
      message:
        "L'email non può essere modificata in questo stato. Ricarica per vedere il motivo e il testo effettivo.",
    };
  return {
    status: "uncertain",
    message:
      "Il salvataggio non è confermato. Verifica la stessa operazione o ricarica l'email prima di continuare.",
  };
}

export function partnerEmailDetailFrom(value: unknown): PartnerEmailDetail {
  if (
    !object(value) ||
    !["draft", "sent", "job"].includes(String(value.kind)) ||
    !isPartnerId(value.id) ||
    !isPartnerId(value.partnerId) ||
    !Number.isInteger(value.co) ||
    typeof value.name !== "string" ||
    !Array.isArray(value.sections) ||
    !value.sections.every((v) => ["club", "eventi", "collab", "vendita"].includes(v)) ||
    typeof value.editable !== "boolean"
  )
    throw new Error("Email non disponibile.");
  for (const key of [
    "subject",
    "body",
    "signature",
    "language",
    "register",
    "address",
    "lookbookCode",
    "sha256",
    "createdAt",
    "sentAt",
    "choiceReason",
    "whyNotEditable",
  ])
    if (!(value[key] === null || typeof value[key] === "string"))
      throw new Error("Email non disponibile.");
  if (
    !(value.jobId === null || isPartnerId(value.jobId)) ||
    !(value.draftId === null || isPartnerId(value.draftId)) ||
    !(value.rulesVersion === null || version(value.rulesVersion))
  )
    throw new Error("Email non disponibile.");
  if (value.sha256 !== null && !hash(value.sha256)) throw new Error("Email non disponibile.");
  if (
    value.hold !== null &&
    (!object(value.hold) ||
      !isPartnerId(value.hold.id) ||
      !version(value.hold.version) ||
      typeof value.hold.createdAt !== "string")
  )
    throw new Error("Email non disponibile.");
  if (!Array.isArray(value.researchSources)) throw new Error("Email non disponibile.");
  const sources = value.researchSources.flatMap((source) => {
    const item = typeof source === "string" ? { url: source } : source;
    if (!object(item) || typeof item.url !== "string") return [];
    try {
      const url = new URL(item.url);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return [];
    } catch {
      return [];
    }
    return [{ url: item.url, title: typeof item.title === "string" ? item.title : item.url }];
  });
  const allowed = [
    "kind",
    "id",
    "jobId",
    "draftId",
    "partnerId",
    "co",
    "name",
    "sections",
    "subject",
    "body",
    "signature",
    "language",
    "register",
    "address",
    "lookbookCode",
    "sha256",
    "rulesVersion",
    "createdAt",
    "sentAt",
    "choiceReason",
    "hold",
    "editable",
    "whyNotEditable",
    "status",
    "step",
    "reason",
  ];
  return {
    ...Object.fromEntries(
      allowed.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]),
    ),
    researchSources: sources,
  } as PartnerEmailDetail;
}

export const PARTNER_EMAIL_EDIT_BLOCKS: Record<string, string> = {
  inviata: "Questa email è già stata inviata: qui leggi il testo effettivo.",
  invio_in_corso: "Il server sta inviando questa email. Non è più possibile sostituirne il testo.",
  incerto: "L'invio ha un esito incerto: controlla prima la casella.",
  invio_incerto: "L'invio ha un esito incerto: controlla prima la casella.",
  solo_founder: "Il testo da inviare lo approva Tommi.",
  non_pronta: "Il testo non è ancora pronto per l'invio.",
  contesto_cambiato: "La scheda o il recapito sono cambiati: serve una nuova revisione.",
  ricerca_scaduta: "La ricerca va aggiornata prima di approvare un nuovo testo.",
  non_idoneo: "L'assistente non può contattare questa scheda nello stato attuale.",
  prova_in_corso: "Questa bozza è utilizzata da una prova ancora in corso.",
};
