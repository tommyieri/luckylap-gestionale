// Tipi del passo d'invio dell'assistente Partner: le chiavi delle RPC d'invio
// (supabase/migrations/20261030114722_assistente_partner_invio.sql, sezione 2) in camelCase. Lo
// store d'invio converte da e verso le chiavi SQL e controlla ogni valore che legge.
import type { PartnerAssistantRecheckChoice } from "./send-recheck";
import type { PartnerAssistantLanguage, PartnerAssistantRegister } from "./types";

export type PartnerAssistantSendMode = "prova" | "invio";
/** I motivi di claim_partner_assistant_send quando non c'è niente da fare. */
export type PartnerAssistantSendIdleReason =
  | "spento"
  | "prepara"
  | "non_configurato"
  | "occupato"
  | "fermo"
  | "fermo_oggi"
  | "attesa"
  | "intervallo"
  | "limite"
  | "fuori_finestra"
  | "vuota";

export type PartnerAssistantSendCandidate = {
  jobId: string;
  partnerId: string;
  co: number;
  name: string;
  mode: PartnerAssistantSendMode;
  draft: {
    draftId: string;
    language: PartnerAssistantLanguage;
    subject: string;
    body: string;
    signature: string;
    sha256: string;
    rulesVersion: number;
    createdAt: string;
  };
  choice: PartnerAssistantRecheckChoice;
  register: PartnerAssistantRegister;
  /** L'indirizzo della scheda in minuscolo, già passato dalla regex stretta; in invio mai null. */
  address: string | null;
  testRunId: string | null;
  testIndex: number | null;
};

/** Una copia arretrata in «Posta inviata»: un messaggio inviato e non ancora copiato. */
export type PartnerAssistantPendingAppend = {
  messageRowId: string;
  messageId: string;
  raw: string;
  sentAt: string;
};

export type PartnerAssistantSendClaim =
  | { status: "idle"; reason: PartnerAssistantSendIdleReason }
  | {
      status: "claimed";
      leaseToken: string;
      mode: PartnerAssistantSendMode;
      appends: PartnerAssistantPendingAppend[];
      candidate: PartnerAssistantSendCandidate | null;
    };

/** Il controllo dei 12 mesi: nessuna corrispondenza, una trovata, «non so». */
export type PartnerAssistantMailboxCheck = "vuota" | "trovata" | "incerta";

export type PartnerAssistantPrepareInput = {
  jobId: string;
  draftId: string;
  mode: PartnerAssistantSendMode;
  testRunId: string | null;
  testIndex: number | null;
  messageId: string;
  toAddress: string;
  subject: string;
  text: string;
  optOut: string;
  raw: string;
  mailboxCheck: PartnerAssistantMailboxCheck;
};
export type PartnerAssistantPrepared =
  { status: "pronto"; messageRowId: string } | { status: "rifiutato"; reason: string };

export type PartnerAssistantStart = { status: "in_invio" } | { status: "stop"; reason: string };

export type PartnerAssistantFinishInput = {
  messageRowId: string;
  outcome: "inviato" | "incerto" | "respinto" | "scartato";
  smtpCode: number | null;
  enhancedCode: string | null;
  spam: boolean;
  reason: string | null;
};

export type PartnerAssistantSendSkipReason =
  "conversazione_esistente" | "bozza_scaduta" | "casella_incerta";

/** L'esito del giro e gli accessi: "ok" o un codice; null se l'accesso non è stato provato. */
export type PartnerAssistantReleaseInput = {
  outcome: string;
  smtpLogin: string | null;
  imapLogin: string | null;
};
export type PartnerAssistantEnvironmentInput = {
  mailboxOk: boolean;
  testOk: boolean;
  testCount: number;
};
