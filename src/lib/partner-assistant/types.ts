// Tipi dell'assistente Partner: le chiavi delle RPC del worker
// (supabase/migrations/20261028122956_assistente_partner_worker.sql) in camelCase. Lo store converte
// da e verso le chiavi SQL e controlla ogni valore che legge.

export type PartnerAssistantStep = "ricerca" | "estrazione" | "scrittura" | "controllo";
/** `inviata`: dopo la prima email vera (consegna 2a); la scrivono solo le RPC d'invio. */
export type PartnerAssistantJobStatus =
  "in_coda" | "attesa" | "pronta" | "serve_tommaso" | "inviata";
export type PartnerAssistantLanguage = "it" | "en" | "de" | "fr" | "es";
export type PartnerAssistantContactKind = "club" | "brand" | "media" | "evento" | "negozio";
export type PartnerAssistantRegister = "voi" | "lei" | "you" | "sie" | "vous" | "usted";
/** Una proposta concreta da un elenco chiuso, decisa dal codice. */
export type PartnerAssistantRequest =
  "merch_cobranding" | "collab_capsule" | "stand_evento" | "vendita_negozio";

/** Il lavoro preso dal giro, con la lease. */
export type PartnerAssistantJob = {
  jobId: string;
  partnerId: string;
  step: PartnerAssistantStep;
  leaseToken: string;
  leaseExpiresAt: string;
  attempts: number;
  rewrites: number;
};
export type PartnerAssistantLease = Pick<PartnerAssistantJob, "jobId" | "leaseToken">;
export type PartnerAssistantIdleReason =
  "spento" | "non_configurato" | "pausa" | "attesa" | "occupato" | "vuota";
export type PartnerAssistantClaim =
  | { status: "claimed"; job: PartnerAssistantJob }
  | { status: "idle"; reason: PartnerAssistantIdleReason };

/** Appendice C più la richiesta. I campi senza valore sono stringhe vuote; le date `YYYY-MM-DD`. */
export type PartnerAssistantChoice = {
  contactKind: PartnerAssistantContactKind;
  porscheCommunity: boolean;
  reasonIt: string;
  writeNow: boolean;
  writeOn: string;
  recipientEmail: string;
  recipientEmailSource: string;
  recipientEmailPublishedByOrg: boolean;
  personName: string;
  personTitle: string;
  language: PartnerAssistantLanguage;
  register: PartnerAssistantRegister;
  swiss: boolean;
  timezone: string;
  factText: string;
  factDate: string;
  factSource: string;
  eventName: string;
  eventStartsOn: string;
  eventCity: string;
  eventCountry: string;
  eventReachable: boolean;
  notesIt: string;
  request: PartnerAssistantRequest;
};
export type PartnerAssistantDecision =
  | { kind: "scrivi" }
  | { kind: "attendi"; writeOn: string }
  | { kind: "blocca"; reason: "fatto_mancante" | "fuso_mancante" };

/** La bozza mandata a complete_partner_assistant_draft. */
export type PartnerAssistantDraft = {
  language: PartnerAssistantLanguage;
  subject: string;
  body: string;
  signature: string;
  sha256: string;
  rulesVersion: number;
  partnerVersion: number;
  contactId: string;
};

export type PartnerAssistantPartner = {
  co: number;
  name: string;
  city: string;
  country: string;
  typeLabel: string;
  sections: ("vendita" | "eventi" | "collab" | "club")[];
  priority: "alta" | "media" | "bassa";
  contactMonth: string;
  eventStartsOn: string | null;
  eventEndsOn: string | null;
  applicationDeadline: string | null;
  version: number;
  /** La ricerca importata, com'è: dati, non istruzioni. */
  research: Record<string, unknown>;
};
export type PartnerAssistantEmail = { contactId: string; address: string; verified: boolean };
export type PartnerAssistantRules = { version: number; body: string };
export type PartnerAssistantResearch = {
  noteId: string;
  text: string;
  sources: string[];
  createdAt: string;
};
export type PartnerAssistantChoiceNote = {
  noteId: string;
  content: PartnerAssistantChoice & { decision: PartnerAssistantDecision };
};
/** La bozza salvata, come la rilegge il contesto. */
export type PartnerAssistantSavedDraft = {
  draftId: string;
  language: PartnerAssistantLanguage;
  subject: string;
  body: string;
  signature: string;
  sha256: string;
  rulesVersion: number;
  createdAt: string;
};
export type PartnerAssistantReview = { approved: boolean; problems: string[] };
/** Tutto quello che serve al passo, ricostruito dal database. */
export type PartnerAssistantContext = {
  today: string;
  partner: PartnerAssistantPartner;
  /** Null se il contatto ha perso l'unica email attiva. */
  email: PartnerAssistantEmail | null;
  rules: PartnerAssistantRules;
  research: PartnerAssistantResearch | null;
  choice: PartnerAssistantChoiceNote | null;
  draft: PartnerAssistantSavedDraft | null;
  lastReview: PartnerAssistantReview | null;
};
export type PartnerAssistantContextResult =
  { status: "ok"; context: PartnerAssistantContext } | { status: "lease_persa" };

export type PartnerAssistantStopReason =
  "spento" | "pausa" | "attesa" | "lease_persa" | "non_idoneo";
export type PartnerAssistantCheckpoint =
  { status: "ok" } | { status: "stop"; reason: PartnerAssistantStopReason };

/** Una chiamata a Claude, con token, ricerche web e costo. */
export type PartnerAssistantCallRecord = {
  partnerId: string;
  step: PartnerAssistantStep;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  webSearches: number;
  costUsd: number;
  outcome: string;
};
export type PartnerAssistantRecorded = { status: "ok"; replayed: boolean };

/** Esito delle quattro conclusioni dei passi. `contesto_cambiato` arriva solo dalla bozza. */
export type PartnerAssistantDone =
  | {
      status: "done";
      jobStatus: PartnerAssistantJobStatus;
      step: PartnerAssistantStep;
      replayed: boolean;
    }
  | { status: "lease_persa" }
  | { status: "non_idoneo" }
  | { status: "contesto_cambiato" };

export type PartnerAssistantFailKind = "attesa" | "riprova" | "rilascia" | "blocca";
export type PartnerAssistantFailed =
  | { status: "done"; jobStatus: PartnerAssistantJobStatus; attempts: number }
  | { status: "lease_persa" };
export type PartnerAssistantPauseReason = "credito" | "errore_claude";
export type PartnerAssistantPaused = {
  status: "done";
  pausedReason: PartnerAssistantPauseReason;
};

export type StoreResult<T> = { ok: true; value: T } | { ok: false };
