"use client";

import {
  PARTNER_ASSISTANT_INACTIVE,
  PARTNER_ASSISTANT_REQUEST_LABELS,
  PARTNER_ASSISTANT_STATUS_LABELS,
  PARTNER_ASSISTANT_UNREADABLE,
  partnerAssistantReasonInline,
  type PartnerAssistantContactView,
  type PartnerAssistantInactive,
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
import { CommandFeedback, usePartnerCommand } from "./partner-command";
import { usePartnerContext } from "./partner-context";
import styles from "./partner.module.css";

/*
 * Il blocco «Assistente» nella scheda del contatto (specifica dell'assistente Partner,
 * «Interfaccia»): lo stato del lavoro, perché l'assistente non prende il contatto, la proposta
 * scelta con il motivo, l'indirizzo trovato dalla ricerca (solo una proposta), la ricerca con le
 * fonti, la bozza com'è salvata e l'interruttore «Assistente su questo contatto: attivo / fermo».
 * Dalla consegna 2a anche le prime email dell'assistente (data ed esito, mai indirizzi) e, per
 * Tommi, la precedenza d'invio («Manda per primo»). Mostra i dati del caricamento: dopo un comando
 * la scheda la rilegge la Server Action. Senza le migrazioni dell'assistente («non attivo») il
 * blocco non c'è.
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

/** Il motivo dello stato: dopo una prima email dell'assistente lo stato l'ha cambiato l'invio. */
const NOT_TO_CONTACT = `non è più «${PARTNER_STAGE_LABELS.da_contattare}»`;

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
  if (partner.stage !== "da_contattare") reasons.push(NOT_TO_CONTACT);
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

/** «il 29 ottobre alle 9:41»: ora di Roma, senza lo zero davanti all'ora. */
function sentOn(instant: string, today: string): string {
  const day = instantDay(instant);
  const time = instantTime(instant)?.replace(/^0(?=\d)/, "");
  return day && time ? `il ${longDay(day, today)} alle ${time}` : "in un momento non leggibile";
}

/** Le prime email dell'assistente a questo contatto, dalla più recente: data ed esito. */
function sendLine(send: PartnerAssistantContactView["sends"][number], today: string): string {
  const when = sentOn(send.at, today);
  switch (send.status) {
    case "inviato":
      return `Email inviata dall'assistente ${when}.`;
    case "incerto":
      return `Invio incerto ${when}: controlla in «Posta inviata».`;
    case "respinto":
      return `Email respinta dal server ${when}.`;
  }
}

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
  /**
   * `null`: stato non leggibile; PARTNER_ASSISTANT_INACTIVE: migrazioni non applicate, niente
   * blocco. La vista vuota (attivo, senza lavoro) è un contatto senza lavoro.
   */
  assistant: PartnerAssistantContactView | PartnerAssistantInactive | null;
  /** In «Non contattare», per sé o per il dominio. */
  blocked: boolean;
  contacts: readonly PartnerContact[];
  activities: readonly PartnerActivity[];
}) {
  const { members, founder, today } = usePartnerContext();
  const titleId = `assistente-${partner.co}`;
  if (assistant === PARTNER_ASSISTANT_INACTIVE) return null;
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
  const { choice, research, draft, job } = assistant;
  // Con la prima email partita lo stato l'ha cambiato l'invio stesso: accanto alla frase
  // dell'invio quel motivo non si dice. Gli altri restano.
  const shownSkip =
    job?.status === "inviata" ? skip.filter((reason) => reason !== NOT_TO_CONTACT) : skip;
  // Fermo sul contatto o non più idoneo: l'assistente non ci lavora, qualunque sia il lavoro.
  const held = [...(assistant.active ? [] : ["è fermato dal team"]), ...skip];
  // In coda per l'invio finché la prima email non è partita e il contatto non è di Tommi.
  const queued = job?.status !== "inviata" && job?.status !== "serve_tommaso";
  // In coda o in attesa, i motivi stanno nella frase del lavoro; altrimenti in una riga a sé.
  const waiting = job !== null && (job.status === "in_coda" || job.status === "attesa");
  // L'indirizzo trovato dalla ricerca resta una proposta: la bozza va all'email del gestionale.
  const target = draft !== null ? draft.toAddress : assistantAddress(contacts);
  const proposed = choice?.proposedEmail.trim() ?? "";
  const showProposed =
    proposed !== "" && proposed.toLowerCase() !== (target ?? "").trim().toLowerCase();
  return (
    <section className={styles.detailBlock} aria-labelledby={titleId}>
      <h4 id={titleId}>Assistente</h4>
      <JobState job={job} held={held} />
      {assistant.sends.map((send, index) => (
        <p key={index}>{sendLine(send, today)}</p>
      ))}
      {shownSkip.length > 0 && !waiting && (
        <p>L'assistente non lo prende: {sentenceList(shownSkip)}.</p>
      )}
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
          Indirizzo trovato dalla ricerca (proposta): {proposed}.
          {target !== null && " La bozza va all'email del gestionale."}
        </p>
      )}
      {research && <Research research={research} />}
      {draft && <Draft draft={draft} template={templateDraft(research)} job={job} />}
      {/* La precedenza si dà a un contatto in coda; una rimasta, come la elenca la pagina
          dell'assistente, si toglie anche dopo. */}
      {(queued || assistant.sendPriority > 0) && (
        <SendPriority
          partner={partner}
          priority={assistant.sendPriority}
          queued={queued}
          founder={founder}
        />
      )}
      <AssistantSwitch partner={partner} active={assistant.active} />
    </section>
  );
}

/** Detto dopo lo stato quando l'assistente non segue più il contatto (pronta, Serve Tommi). */
const NOT_FOLLOWED = "Il contatto non è più seguito dall'assistente.";

/**
 * Lo stato del lavoro, vero anche quando l'assistente non lo prende: con `held` non vuoto (fermo
 * sul contatto o non idoneo) non promette i prossimi giri.
 */
function JobState({
  job,
  held,
}: {
  job: PartnerAssistantContactView["job"];
  /** Perché l'assistente non lo prende: «è fermato dal team», «è seguito da Ada»… */
  held: readonly string[];
}) {
  const { today } = usePartnerContext();
  if (job === null) return <p>Nessun lavoro dell'assistente su questo contatto.</p>;
  const label = PARTNER_ASSISTANT_STATUS_LABELS[job.status];
  const stopped = held.length > 0;
  const after = stopped ? ` ${NOT_FOLLOWED}` : "";
  switch (job.status) {
    case "serve_tommaso":
      return (
        <p className={styles.noteAmber}>
          {job.reason === null
            ? `${label}.${after}`
            : `${label}: ${partnerAssistantReasonInline(job.reason)}${after}`}
        </p>
      );
    case "pronta":
      return (
        <p>
          {label}: la trovi qui sotto.{after}
        </p>
      );
    case "inviata":
      return <p>Prima email inviata dall'assistente: il sollecito dopo 7 giorni lo manda Tommi.</p>;
    case "attesa":
    case "in_coda":
      if (stopped)
        return (
          <p>
            {label}, ma l'assistente non lo prende finché resta così: {sentenceList(held)}.
          </p>
        );
      return job.status === "in_coda" ? (
        <p>{label}: l'assistente ci lavora nei prossimi giri.</p>
      ) : (
        <p>
          {job.writeOn === null
            ? `${label}.`
            : `${label}: scrive dal ${longDay(job.writeOn, today)}.`}
        </p>
      );
  }
}

/** La nota di ricerca sostitutiva delle bozze del testo per i club, scritta da
 * complete_partner_assistant_template: non c'è una ricerca da mostrare come tale. */
const TEMPLATE_RESEARCH = /^Nessuna ricerca: bozza dal testo fisso per i club/u;
const templateDraft = (research: PartnerAssistantContactView["research"]) =>
  research !== null && TEMPLATE_RESEARCH.test(research.text);

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
        {templateDraft(research)
          ? "Testo per i club"
          : day === null
            ? "Ricerca"
            : `Ricerca del ${longDay(day, today)}`}
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

/** Dove è arrivata la bozza del modello: Claude l'ha letta solo se è pronta o inviata. */
function templateReading(job: PartnerAssistantContactView["job"]): string {
  if (job?.status === "pronta" || job?.status === "inviata") return "controllata da Claude";
  if (job?.reason === "modello_bocciato") return "bocciata nella seconda lettura";
  if (job?.reason === "modello_controlli")
    return "non ha passato i controlli del codice e Claude non l'ha letta";
  return "in attesa della seconda lettura";
}

function Draft({
  draft,
  template,
  job,
}: {
  draft: NonNullable<PartnerAssistantContactView["draft"]>;
  template: boolean;
  job: PartnerAssistantContactView["job"];
}) {
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
          {template
            ? `Composta ${moment(draft.createdAt, today)} dal testo per i club; ${templateReading(job)}, con le regole in versione ${draft.rulesVersion}.`
            : `Scritta ${moment(draft.createdAt, today)} con le regole in versione ${draft.rulesVersion}.`}
        </p>
      </div>
    </details>
  );
}

/**
 * «Manda per primo»: la precedenza d'invio (9) o niente (0), solo di Tommi. Con la precedenza la
 * frase la leggono tutti. Fuori dalla coda (prima email partita, contatto di Tommi) si può solo
 * togliere quella rimasta.
 */
function SendPriority({
  partner,
  priority,
  queued,
  founder,
}: {
  partner: PartnerSummary;
  priority: number;
  queued: boolean;
  founder: boolean;
}) {
  const { preview } = usePartnerContext();
  const command = usePartnerCommand(`assistente-precedenza-${partner.id}`);
  if (!founder && priority === 0) return null;
  const set = (value: number) =>
    command.run("set_partner_assistant_send_priority", {
      schema_version: 1,
      partner_id: partner.id,
      send_priority: value,
    });
  return (
    <div className={styles.draftBlock}>
      <div className={styles.inlineActions}>
        {priority > 0 && (
          <p>
            {queued
              ? "Questo contatto parte per primo appena la bozza è pronta."
              : "Ha ancora la precedenza d'invio, ma non è più in coda."}
          </p>
        )}
        {founder && (
          <button
            type="button"
            className={`${styles.act} ${styles.actMini}`}
            disabled={preview || command.busy}
            onClick={() => set(priority > 0 ? 0 : 9)}
          >
            {command.pending ? "Salvo…" : priority > 0 ? "Togli la precedenza" : "Manda per primo"}
          </button>
        )}
      </div>
      <CommandFeedback command={command} />
    </div>
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
