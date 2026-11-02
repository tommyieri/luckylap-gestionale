// Lettura operativa di Partner: nessuna nuova fase commerciale e nessuna autorizzazione d'invio.
import type { PartnerAssistantJobStatus, PartnerAssistantStep } from "../partner-assistant/types";
import { partnerAssistantReasonLabel } from "./assistant";
import { instantDay, longDay, monthLong } from "./dates";
import {
  PARTNER_APPROACH_LABELS,
  PARTNER_STAGE_LABELS,
  type PartnerActivityChannel,
  type PartnerActivityKind,
  type PartnerBlock,
  type PartnerContactLink,
  type PartnerMember,
  type PartnerSummary,
} from "./model";

export type PartnerWorkActivity = {
  id: string;
  partnerId: string;
  kind: PartnerActivityKind;
  occurredAt: string;
  createdBy: string;
  origin: "team" | "file" | "assistente";
  channel: PartnerActivityChannel | null;
};
export type PartnerWorkReply = PartnerWorkActivity & { kind: "risposta"; body: string };
export type PartnerWorkData = {
  assistantStatus: "ready" | "inactive" | "error";
  jobs: {
    partnerId: string;
    status: PartnerAssistantJobStatus;
    step: PartnerAssistantStep;
    reason: string | null;
    writeOn: string | null;
    updatedAt: string;
    draftId: string | null;
  }[];
  toggles: { partnerId: string; active: boolean }[];
  /** Tutte le attività, senza testi: solo inviato/risposta decidono a chi tocca. */
  activities: PartnerWorkActivity[];
  /** Solo le attività di tipo risposta hanno il testo. Non sono messaggi importati dalla posta. */
  replies: PartnerWorkReply[];
  /** Solleciti realmente aperti, collegati a task esistenti; mai scadenze ricostruite. */
  followUps: { id: string; partnerId: string; dueAt: string | null; assignedTo: string | null }[];
};
export type PartnerWorkView = {
  phase: string;
  label: string;
  reason: string | null;
  turn: string;
  dueOn: string | null;
  dueLabel: string;
  motivation: string;
  warning: string | null;
  needsAction: boolean;
  sortPriority: number;
};

/** Le date sono giorni di Roma; «oggi» viene passato dalla pagina, non dall'orologio del browser. */
export function partnerWorkView(
  partner: PartnerSummary,
  ctx: {
    today: string;
    work: PartnerWorkData | null | undefined;
    contacts: readonly PartnerContactLink[];
    block: PartnerBlock | null;
    members: readonly PartnerMember[];
  },
): PartnerWorkView {
  const { work, today } = ctx;
  const job = work?.jobs.find((item) => item.partnerId === partner.id);
  const toggle = work?.toggles.find((item) => item.partnerId === partner.id);
  const communications = (work?.activities ?? [])
    .filter(
      (item) =>
        item.partnerId === partner.id && (item.kind === "inviato" || item.kind === "risposta"),
    )
    .sort(
      (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || b.id.localeCompare(a.id),
    );
  const latest = communications[0];
  // Le attività retrodatate condividono mezzogiorno di Roma: l'UUID e la data di
  // registrazione non stabiliscono quale comunicazione sia avvenuta per ultima.
  const orderUncertain =
    latest !== undefined &&
    communications.some(
      (item) =>
        Date.parse(item.occurredAt) === Date.parse(latest.occurredAt) && item.kind !== latest.kind,
    );
  const turn = orderUncertain
    ? "Da verificare"
    : latest?.kind === "risposta"
      ? "A noi"
      : latest?.kind === "inviato"
        ? "A loro"
        : partner.stage === "da_contattare"
          ? "A noi"
          : "Da verificare";
  const followUp = (work?.followUps ?? [])
    .filter((item) => item.partnerId === partner.id && item.dueAt !== null)
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!) || a.id.localeCompare(b.id))[0];
  const followDay = followUp?.dueAt ? instantDay(followUp.dueAt) : null;
  const dueOn = partner.nextActionOn ?? followDay ?? job?.writeOn ?? partner.contactMonth;
  const dueLabel = partner.nextActionOn
    ? `${longDay(partner.nextActionOn, today)} · ${partner.nextAction}`
    : followDay
      ? `${longDay(followDay, today)} · sollecito`
      : job?.writeOn
        ? `${longDay(job.writeOn, today)} · prima email`
        : `${monthLong(partner.contactMonth)} · periodo di contatto`;
  const uncertain = job?.reason === "invio_incerto";
  const teamKinds: readonly PartnerActivityKind[] = [
    "inviato",
    "risposta",
    "chiamata",
    "incontro",
    "nota",
    "stato",
    "responsabile",
    "prossima_azione",
    "approccio",
  ];
  const heldReasons: string[] = [];
  if (toggle?.active === false) heldReasons.push("Fermato dal team su questo contatto.");
  if (partner.ownerId !== null)
    heldReasons.push(
      `Seguito da ${ctx.members.find((m) => m.id === partner.ownerId)?.name ?? "una persona del team"}.`,
    );
  if (partner.nextAction !== null) heldReasons.push("Ha una prossima azione registrata dal team.");
  if (
    !ctx.contacts.some(
      (c) => c.partnerId === partner.id && c.kind === "email" && c.active && c.linkValue !== null,
    )
  )
    heldReasons.push("Non ha un’email attiva.");
  if (partner.researchRemovedAt !== null) heldReasons.push("Contatto rimosso dalla ricerca.");
  if (
    (work?.activities ?? []).some(
      (a) =>
        a.partnerId === partner.id &&
        (a.origin === "team" || a.origin === "file") &&
        teamKinds.includes(a.kind),
    )
  )
    heldReasons.push("Il team ci ha già lavorato.");
  if (job?.reason === "non_idoneo" && heldReasons.length === 0)
    heldReasons.push(partnerAssistantReasonLabel("non_idoneo"));
  const warnings: string[] = [];
  if (orderUncertain)
    warnings.push(
      "Ordine delle comunicazioni da verificare: invio e risposta hanno lo stesso istante registrato.",
    );
  if (uncertain)
    warnings.push("Invio da verificare: controlla in Posta inviata. Non ripetere l’invio.");
  if (!work) warnings.push("Dati operativi non disponibili: ricarica la pagina.");
  else if (work.assistantStatus === "error")
    warnings.push("Stato dell’assistente non leggibile: ricarica la pagina.");
  let phase = "to_write";
  let label = "Da scrivere";
  let reason: string | null = null;
  if (ctx.block) {
    phase = "blocked";
    label = "Non contattare";
    reason = ctx.block.reason;
  } else if (partner.stage !== "da_contattare") {
    phase = {
      chiuso: "closed",
      no: "no",
      trattativa: "dialogue",
      risposto: "replied",
      contattato: "written",
    }[partner.stage];
    label = PARTNER_STAGE_LABELS[partner.stage];
  } else if (
    orderUncertain ||
    uncertain ||
    job?.status === "inviata" ||
    (job?.status === "pronta" && !job.draftId)
  ) {
    phase = "verify";
    label = "Da verificare";
    reason = orderUncertain
      ? "Ordine delle comunicazioni da verificare."
      : uncertain
        ? partnerAssistantReasonLabel("invio_incerto")
        : "Lo stato del contatto e il lavoro dell’assistente vanno verificati nella scheda.";
  } else if (heldReasons.length > 0) {
    phase = "held";
    label = "Fermo";
    reason = heldReasons.join(" ");
  } else if (job?.status === "serve_tommaso") {
    phase = "needs_tommi";
    label = "Serve Tommi";
    reason = job.reason
      ? partnerAssistantReasonLabel(job.reason)
      : "Il lavoro richiede una verifica nella scheda.";
  } else if (job?.status === "pronta") {
    phase = "ready";
    label = "Pronta";
    reason =
      "Bozza preparata dall’assistente. I controlli finali restano quelli dell’invio automatico.";
  } else if (job?.status === "in_coda") {
    phase = "preparing";
    label = "In preparazione";
  } else if (job?.status === "attesa" && job.writeOn) {
    phase = "scheduled";
    label = `Da scrivere il ${longDay(job.writeOn, today)}`;
  } else if (!work || work.assistantStatus === "error") {
    phase = "verify";
    label = "Da verificare";
    reason = "Il lavoro dell’assistente non è leggibile.";
  }
  const explicitDue = partner.nextActionOn ?? followDay;
  const overdue = explicitDue !== null && explicitDue <= today;
  const incoming = !orderUncertain && latest?.kind === "risposta";
  const needsAction =
    orderUncertain ||
    uncertain ||
    phase === "verify" ||
    (!ctx.block &&
      (phase === "needs_tommi" ||
        incoming ||
        overdue ||
        phase === "ready" ||
        (phase === "to_write" && partner.contactMonth <= today)));
  const sortPriority =
    orderUncertain || uncertain || phase === "verify"
      ? 0
      : incoming
        ? 1
        : phase === "needs_tommi"
          ? 2
          : overdue
            ? 3
            : phase === "ready"
              ? 4
              : needsAction
                ? 5
                : 9;
  return {
    phase,
    label,
    reason,
    turn,
    dueOn,
    dueLabel,
    motivation: partner.chosenApproach
      ? PARTNER_APPROACH_LABELS[partner.chosenApproach]
      : partner.why?.trim() || partner.route.trim().slice(0, 180) || "Proposta da completare",
    warning: warnings.length ? warnings.join(" ") : null,
    needsAction,
    sortPriority,
  };
}

/** A parità di urgenza precede la scadenza; il chiamante usa il CO come ultimo spareggio. */
export function comparePartnerWork(a: PartnerWorkView, b: PartnerWorkView): number {
  return a.sortPriority - b.sortPriority || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999");
}
