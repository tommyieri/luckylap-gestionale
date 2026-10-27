"use client";

import {
  PARTNER_ASSISTANT_REQUEST_LABELS,
  PARTNER_ASSISTANT_STATUS_LABELS,
  partnerAssistantReasonLabel,
  type PartnerAssistantContactView,
} from "../../lib/partner/assistant";
import { hostLabel } from "../../lib/partner/contacts";
import { addDays, instantDay, instantTime, longDay } from "../../lib/partner/dates";
import {
  PARTNER_STAGE_LABELS,
  type PartnerActivity,
  type PartnerActivityKind,
  type PartnerContact,
  type PartnerSummary,
} from "../../lib/partner/model";
import { PARTNER_ASSISTANT_UNREADABLE } from "./partner-assistant-strip";
import { CommandFeedback, usePartnerCommand } from "./partner-command";
import { usePartnerContext } from "./partner-context";
import styles from "./partner.module.css";

/*
 * Il blocco «Assistente» nella scheda del contatto (specifica dell'assistente Partner,
 * «Interfaccia»): lo stato del lavoro, perché l'assistente non prende il contatto, la proposta
 * scelta con il motivo, l'indirizzo trovato dalla ricerca (solo una proposta), la ricerca con le
 * fonti, la bozza com'è salvata e l'interruttore «Assistente su questo contatto: attivo / fermo».
 * Mostra i dati del caricamento: dopo l'interruttore la scheda la rilegge la Server Action.
 */

/** Le attività del team che tolgono il contatto all'assistente (partner_assistant_eligible). */
const TEAM_WORK: ReadonlySet<PartnerActivityKind> = new Set<PartnerActivityKind>([
  "inviato",
  "risposta",
  "chiamata",
  "incontro",
  "nota",
  "stato",
  "responsabile",
  "prossima_azione",
  "approccio",
]);

/** Un'email che l'assistente può usare: attiva e con l'indirizzo pulito. */
const usableEmail = (contact: PartnerContact) =>
  contact.kind === "email" && contact.active && contact.linkValue !== null;

/** L'email a cui andrebbe la bozza, nell'ordine di private.partner_assistant_email. */
function assistantAddress(contacts: readonly PartnerContact[]): string | null {
  const [first] = contacts
    .filter(usableEmail)
    .sort(
      (a, b) =>
        Number(b.verified) - Number(a.verified) ||
        a.position - b.position ||
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  return first?.linkValue ?? null;
}

/**
 * Perché l'assistente non prende questo contatto, con i dati già nella scheda e le regole di
 * private.partner_assistant_eligible. Vuoto se lo può prendere (l'interruttore è a parte).
 */
export function partnerAssistantSkipReasons({
  partner,
  ownerName,
  blocked,
  contacts,
  activities,
}: {
  partner: Pick<PartnerSummary, "ownerId" | "stage" | "nextAction" | "researchRemovedAt">;
  ownerName: string | null;
  blocked: boolean;
  contacts: readonly PartnerContact[];
  activities: readonly PartnerActivity[];
}): string[] {
  const reasons: string[] = [];
  if (partner.ownerId !== null) reasons.push(`è seguito da ${ownerName ?? "una persona del team"}`);
  if (blocked) reasons.push("è in «Non contattare»");
  if (partner.stage !== "da_contattare")
    reasons.push(`non è più «${PARTNER_STAGE_LABELS.da_contattare}»`);
  if (!contacts.some(usableEmail)) reasons.push("non ha un'email attiva");
  if (partner.nextAction !== null) reasons.push("ha una prossima azione");
  if (partner.researchRemovedAt !== null) reasons.push("la ricerca non lo propone più");
  if (
    activities.some(
      (activity) =>
        (activity.origin === "team" || activity.origin === "file") && TEAM_WORK.has(activity.kind),
    )
  )
    reasons.push("il team ci ha già lavorato");
  return reasons;
}

/** «a, b e c». */
const sentenceList = (items: readonly string[]) =>
  items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;

/** «oggi alle 10:48», «ieri alle 10:00», «16 ottobre alle 10:00»: ora di Roma. */
function moment(instant: string, today: string): string {
  const day = instantDay(instant);
  const time = instantTime(instant);
  if (!day || !time) return "in un momento non leggibile";
  const name = day === today ? "oggi" : day === addDays(today, -1) ? "ieri" : longDay(day, today);
  return `${name} alle ${time}`;
}

export function PartnerAssistantBlock({
  partner,
  assistant,
  blocked,
  contacts,
  activities,
}: {
  partner: PartnerSummary;
  /** `null`: stato non leggibile. La vista vuota (attivo, senza lavoro) è un contatto senza lavoro. */
  assistant: PartnerAssistantContactView | null;
  /** In «Non contattare», per sé o per il dominio. */
  blocked: boolean;
  contacts: readonly PartnerContact[];
  activities: readonly PartnerActivity[];
}) {
  const { members } = usePartnerContext();
  const titleId = `assistente-${partner.co}`;
  if (assistant === null)
    return (
      <section className={styles.detailBlock} aria-labelledby={titleId}>
        <h4 id={titleId}>Assistente</h4>
        <p className={styles.noteAmber}>{PARTNER_ASSISTANT_UNREADABLE}</p>
      </section>
    );
  const owner = members.find((member) => member.id === partner.ownerId)?.name ?? null;
  const skip = partnerAssistantSkipReasons({
    partner,
    ownerName: owner,
    blocked,
    contacts,
    activities,
  });
  const { choice, research, draft } = assistant;
  // L'indirizzo trovato dalla ricerca resta una proposta: la bozza va all'email del gestionale.
  const target = draft !== null ? draft.toAddress : assistantAddress(contacts);
  const proposed = choice?.proposedEmail.trim() ?? "";
  const showProposed =
    proposed !== "" && proposed.toLowerCase() !== (target ?? "").trim().toLowerCase();
  return (
    <section className={styles.detailBlock} aria-labelledby={titleId}>
      <h4 id={titleId}>Assistente</h4>
      <JobState job={assistant.job} />
      {skip.length > 0 && <p>L'assistente non lo prende: {sentenceList(skip)}.</p>}
      {choice && (
        <p>
          <b className={styles.ideaLabel}>
            Proposta: {PARTNER_ASSISTANT_REQUEST_LABELS[choice.request]}.
          </b>
          {choice.reasonIt.trim() && ` ${choice.reasonIt.trim()}`}
        </p>
      )}
      {showProposed && (
        <p>
          Indirizzo trovato dalla ricerca (proposta): {proposed}. La bozza va all'email del
          gestionale.
        </p>
      )}
      {research && <Research research={research} />}
      {draft && <Draft draft={draft} />}
      <AssistantSwitch partner={partner} active={assistant.active} />
    </section>
  );
}

function JobState({ job }: { job: PartnerAssistantContactView["job"] }) {
  const { today } = usePartnerContext();
  if (job === null) return <p>Nessun lavoro dell'assistente su questo contatto.</p>;
  const label = PARTNER_ASSISTANT_STATUS_LABELS[job.status];
  switch (job.status) {
    case "serve_tommaso":
      return (
        <p className={styles.noteAmber}>
          {job.reason === null
            ? `${label}.`
            : `${label}: ${partnerAssistantReasonLabel(job.reason)}`}
        </p>
      );
    case "attesa":
      return (
        <p>
          {job.writeOn === null
            ? `${label}.`
            : `${label}: scrive dal ${longDay(job.writeOn, today)}.`}
        </p>
      );
    case "pronta":
      return <p>{label}: la trovi qui sotto. Per ora l'assistente non manda niente.</p>;
    case "in_coda":
      return <p>{label}: l'assistente ci lavora nei prossimi giri.</p>;
  }
}

function Research({
  research,
}: {
  research: NonNullable<PartnerAssistantContactView["research"]>;
}) {
  const { today } = usePartnerContext();
  const day = instantDay(research.createdAt);
  return (
    <div className={styles.draftBlock}>
      <p className={styles.miniTitle}>
        {day === null ? "Ricerca" : `Ricerca del ${longDay(day, today)}`}
      </p>
      <p className={styles.preText}>{research.text}</p>
      {research.sources.length > 0 && (
        <ul className={styles.sources}>
          {research.sources.map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {hostLabel(url)}
                <span className="sr-only"> (si apre in una nuova scheda)</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Draft({ draft }: { draft: NonNullable<PartnerAssistantContactView["draft"]> }) {
  const { today } = usePartnerContext();
  return (
    <details className={styles.disclosure}>
      <summary>Bozza dell'email</summary>
      <div className={styles.draftBlock}>
        <dl className={styles.recipients}>
          <dt>A</dt>
          <dd>
            <span className={styles.recipient}>
              {draft.toAddress ?? "Il recapito della bozza non c'è più."}
            </span>
          </dd>
          <dt>Oggetto</dt>
          <dd>{draft.subject}</dd>
        </dl>
        <p className={styles.preText}>{draft.body}</p>
        <p className={styles.preText}>{draft.signature}</p>
        <p className={styles.hint}>
          Scritta {moment(draft.createdAt, today)} con le regole in versione {draft.rulesVersion}.
        </p>
      </div>
    </details>
  );
}

/** «Assistente su questo contatto: attivo / fermo», diverso da «Non contattare». */
function AssistantSwitch({ partner, active }: { partner: PartnerSummary; active: boolean }) {
  const { preview } = usePartnerContext();
  const command = usePartnerCommand(`assistente-contatto-${partner.id}`);
  return (
    <div className={styles.draftBlock}>
      <div className={styles.inlineActions}>
        <p>
          Assistente su questo contatto: <b>{active ? "attivo" : "fermo"}</b>
        </p>
        <button
          type="button"
          className={`${styles.act} ${styles.actMini}`}
          disabled={preview || command.busy}
          onClick={() =>
            command.run("set_partner_assistant_contact", {
              schema_version: 1,
              partner_id: partner.id,
              active: !active,
            })
          }
        >
          {command.pending
            ? "Salvo…"
            : active
              ? "Ferma su questo contatto"
              : "Riattiva su questo contatto"}
        </button>
      </div>
      {!active && (
        <p className={styles.hint}>L'assistente non lo tocca finché qualcuno non lo riattiva.</p>
      )}
      <CommandFeedback command={command} />
    </div>
  );
}
