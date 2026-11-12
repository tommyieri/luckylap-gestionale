"use client";

import Link from "next/link";
import { useState, type FormEvent, type MouseEventHandler, type ReactNode } from "react";
import { PARTNER_ASSISTANT_INACTIVE } from "../../lib/partner/assistant";
import { PARTNER_EMAIL_PATH } from "../../lib/partner/email-edit";
import { partnerActions, partnerDomain, hostLabel, routeText } from "../../lib/partner/contacts";
import { partnerDoNotContactPayload, partnerStatePayload } from "../../lib/partner/commands";
import { instantDay, longDay, monthLong } from "../../lib/partner/dates";
import {
  PARTNER_CHANNEL_LABELS,
  PARTNER_DIFFERENCE_FIELD_LABELS,
  PARTNER_IDEA_LABELS,
  PARTNER_PRIORITY_LABELS,
  PARTNER_SECTION_LABELS,
  PARTNER_STAGE_LABELS,
  isPartnerChannel,
  isPartnerPriority,
  isPartnerSection,
  isPartnerStage,
  isReviewableDifference,
  type PartnerBlock,
  type PartnerDetail,
  type PartnerDifference,
  type PartnerSummary,
} from "../../lib/partner/model";
import type { PartnerWorkReply } from "../../lib/partner/work";
import { PartnerActivityLog } from "./partner-activity";
import { PartnerAssistantBlock, partnerAssistantSkipReasons } from "./partner-assistant-block";
import { PartnerCardForm } from "./partner-card-form";
import { CommandFeedback, usePartnerCommand } from "./partner-command";
import { PartnerContacts } from "./partner-contacts";
import { CopyButton } from "./copy-button";
import { usePartnerContext } from "./partner-context";
import { PartnerOutcomePanel } from "./partner-outcome-panel";
import styles from "./partner.module.css";

/** Valore di una differenza in parole: etichette, mesi e giorni in italiano. */
export function differenceValue(difference: PartnerDifference, value: unknown): string {
  if (value === null || value === undefined || value === "") return "vuoto";
  switch (difference.field) {
    case "sections":
      return Array.isArray(value)
        ? value
            .filter(isPartnerSection)
            .map((section) => PARTNER_SECTION_LABELS[section])
            .join(", ") || "nessuna"
        : "non leggibile";
    case "priority":
      return isPartnerPriority(value) ? PARTNER_PRIORITY_LABELS[value] : "non leggibile";
    case "preferred_channel":
      return isPartnerChannel(value) ? PARTNER_CHANNEL_LABELS[value] : "non leggibile";
    case "stage":
      return isPartnerStage(value) ? PARTNER_STAGE_LABELS[value] : "non leggibile";
    case "contact_month":
      return typeof value === "string" && /^\d{4}-\d{2}-01$/.test(value)
        ? monthLong(value)
        : "non leggibile";
    case "event_starts_on":
    case "event_ends_on":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? longDay(value)
        : "non leggibile";
    case "contact": {
      const text =
        value && typeof value === "object" && "value" in value
          ? (value as { value: unknown }).value
          : value;
      return typeof text === "string" ? text : text === null ? "rimosso" : "non leggibile";
    }
    default:
      return typeof value === "string" ? value : JSON.stringify(value);
  }
}

function differenceSource(difference: PartnerDifference): string {
  if (difference.origin === "research") return "Dalla ricerca";
  const day = difference.fileExportedAt ? instantDay(difference.fileExportedAt) : null;
  return `Dal file del ${difference.device ?? "dispositivo"}${day ? ` del ${longDay(day)}` : ""}`;
}

function DifferenceItem({
  difference,
  detail,
  protectDraft = false,
}: {
  difference: PartnerDifference;
  detail: PartnerDetail;
  protectDraft?: boolean;
}) {
  const { preview, hasDirty } = usePartnerContext();
  const [guard, setGuard] = useState(false);
  const command = usePartnerCommand(`differenza-${difference.id}`);
  // Le differenze sui testi dei vecchi «Messaggi pronti» (`message`) non arrivano qui.
  const version =
    difference.field === "contact"
      ? detail.contacts.find((contact) => contact.id === difference.contactId)?.version
      : detail.partner.version;
  const resolve = (choice: "kept_team" | "used_incoming") => {
    if (version === undefined) return;
    if (protectDraft && hasDirty()) {
      setGuard(true);
      return;
    }
    setGuard(false);
    command.run("resolve_partner_difference", {
      schema_version: 1,
      difference_id: difference.id,
      choice,
      expected_version: version,
    });
  };
  return (
    <li className={styles.differenceItem}>
      <p>
        <b>{PARTNER_DIFFERENCE_FIELD_LABELS[difference.field]}.</b> Nel gestionale:{" "}
        {differenceValue(difference, difference.teamValue)} · {differenceSource(difference)}:{" "}
        {differenceValue(difference, difference.incomingValue)}
      </p>
      <div className={styles.inlineActions}>
        <button
          type="button"
          className={`${styles.act} ${styles.actMini}`}
          disabled={preview || command.busy || version === undefined}
          onClick={() => resolve("kept_team")}
        >
          Tieni il nostro
        </button>
        <button
          type="button"
          className={`${styles.act} ${styles.actMini}`}
          disabled={preview || command.busy || version === undefined}
          onClick={() => resolve("used_incoming")}
        >
          Usa il nuovo
        </button>
      </div>
      {guard && (
        <p role="alert" className={styles.noteAmber}>
          Salva o annulla i dati della scheda prima di risolvere la differenza.
        </p>
      )}
      <CommandFeedback command={command} compact />
    </li>
  );
}

/** «Seguito da», «Prossima azione» con il giorno, «Salva». */
function OwnerStrip({
  partner,
  assistantEligible,
  defaultOwnerLabel = "Nessuno",
  canCancel = false,
  onCleared,
}: {
  partner: PartnerSummary;
  assistantEligible: boolean;
  defaultOwnerLabel?: string;
  canCancel?: boolean;
  onCleared?: (form: HTMLFormElement) => void;
}) {
  const { preview, members } = usePartnerContext();
  const command = usePartnerCommand(`responsabile-${partner.id}`);
  const [owner, setOwner] = useState(partner.ownerId ?? "");
  const [nextText, setNextText] = useState(partner.nextAction ?? "");
  const [nextOn, setNextOn] = useState(partner.nextActionOn ?? "");
  const [errors, setErrors] = useState<{ nextAction?: string; nextActionOn?: string }>({});
  const ownerChanged = owner !== (partner.ownerId ?? "");
  const nextChanged =
    nextText.trim() !== (partner.nextAction ?? "") || nextOn !== (partner.nextActionOn ?? "");
  const choices = members.filter((member) => member.active || member.id === partner.ownerId);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || command.busy || (!ownerChanged && !nextChanged)) return;
    const result = partnerStatePayload({
      partnerId: partner.id,
      expectedVersion: partner.version,
      ...(ownerChanged ? { ownerId: owner === "" ? null : owner } : {}),
      ...(nextChanged ? { nextAction: { text: nextText, on: nextOn } } : {}),
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    const form = event.currentTarget;
    command.run("set_partner_state", result.payload, () => onCleared?.(form));
  }

  return (
    <form
      className={styles.strip}
      data-drawer={canCancel || undefined}
      onSubmit={submit}
      noValidate
    >
      {assistantEligible &&
        ((ownerChanged && owner !== "") || (nextChanged && nextText.trim() !== "")) && (
          <p className={`${styles.stripFeedback} ${styles.noteAmber}`}>
            Salvare un responsabile o una prossima azione esclude questo contatto dalle prime email
            automatiche dell'assistente.
          </p>
        )}
      <label className={styles.field}>
        <span>Seguito da</span>
        <select value={owner} onChange={(event) => setOwner(event.target.value)}>
          <option value="">{defaultOwnerLabel}</option>
          {choices.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label className={`${styles.field} ${styles.stripGrow}`}>
        <span>Prossima azione</span>
        <input
          value={nextText}
          maxLength={240}
          placeholder="Sollecito, chiamata, campioni…"
          aria-invalid={errors.nextAction ? true : undefined}
          onChange={(event) => setNextText(event.target.value)}
        />
        {errors.nextAction && <span className={styles.fieldError}>{errors.nextAction}</span>}
      </label>
      <label className={styles.field}>
        <span>Giorno</span>
        <input
          type="date"
          value={nextOn}
          aria-invalid={errors.nextActionOn ? true : undefined}
          onChange={(event) => setNextOn(event.target.value)}
        />
        {errors.nextActionOn && <span className={styles.fieldError}>{errors.nextActionOn}</span>}
      </label>
      <div className={styles.stripActions}>
        <button
          type="submit"
          className="button button-primary"
          disabled={preview || command.busy || (!ownerChanged && !nextChanged)}
        >
          {command.pending
            ? "Salvo…"
            : canCancel && ownerChanged
              ? "Conferma responsabile"
              : "Salva"}
        </button>
        {canCancel && (ownerChanged || nextChanged) && (
          <button
            type="button"
            className={styles.act}
            disabled={command.pending}
            onClick={(event) => {
              setOwner(partner.ownerId ?? "");
              setNextText(partner.nextAction ?? "");
              setNextOn(partner.nextActionOn ?? "");
              setErrors({});
              const form = event.currentTarget.form;
              if (form) onCleared?.(form);
            }}
          >
            Annulla
          </button>
        )}
      </div>
      <div className={styles.stripFeedback}>
        <CommandFeedback command={command} compact />
      </div>
    </form>
  );
}

/** «Non contattare»: motivo e dominio, oppure «Togli dalla lista». */
function DoNotContact({
  detail,
  block,
  onCleared,
}: {
  detail: PartnerDetail;
  block: PartnerBlock | null;
  onCleared?: (form: HTMLFormElement) => void;
}) {
  const { preview } = usePartnerContext();
  const partner = detail.partner;
  const command = usePartnerCommand(`non-contattare-${partner.id}`);
  const [reason, setReason] = useState("");
  const [includeDomain, setIncludeDomain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = detail.blocks.find((item) => item.partnerId === partner.id) ?? null;
  const byDomain = own ? null : (detail.blocks[0] ?? block);
  const web = detail.contacts.find(
    (contact) => contact.kind === "web" && contact.linkValue !== null && contact.erasedAt === null,
  );
  const domain = web ? partnerDomain(web.linkValue) : null;

  if (own)
    return (
      <section className={styles.detailBlock}>
        <h4>Non contattare</h4>
        <p>
          Nella lista dal {longDay(instantDay(own.createdAt) ?? own.createdAt.slice(0, 10))}:{" "}
          {own.reason}
          {own.domain ? ` Bloccato anche il dominio ${own.domain}.` : ""}
        </p>
        <div className={styles.inlineActions}>
          <button
            type="button"
            className={styles.act}
            disabled={preview || command.busy}
            onClick={() => {
              const lift = partnerDoNotContactPayload({
                partnerId: partner.id,
                active: false,
                reason: "",
                includeDomain: false,
              });
              if (lift.ok) command.run("set_partner_do_not_contact", lift.payload);
            }}
          >
            {command.pending ? "Salvo…" : "Togli dalla lista"}
          </button>
        </div>
        <CommandFeedback command={command} />
      </section>
    );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || command.busy) return;
    const result = partnerDoNotContactPayload({
      partnerId: partner.id,
      active: true,
      reason,
      includeDomain: includeDomain && domain !== null,
    });
    if (!result.ok) {
      setError(result.errors.reason ?? null);
      return;
    }
    setError(null);
    const form = event.currentTarget;
    command.run("set_partner_do_not_contact", result.payload, () => {
      setReason("");
      setIncludeDomain(false);
      onCleared?.(form);
    });
  }

  return (
    <section className={styles.detailBlock}>
      {byDomain?.domain && (
        <p className={styles.noteAmber}>
          Bloccato per il dominio {byDomain.domain}: {byDomain.reason}
        </p>
      )}
      <details className={styles.disclosure}>
        <summary>Metti tra i non contattare</summary>
        <form className={styles.blockForm} onSubmit={submit} noValidate>
          <label className={styles.field}>
            <span>Motivo</span>
            <textarea
              value={reason}
              rows={2}
              maxLength={500}
              placeholder="Per esempio: ha chiesto di non ricevere proposte."
              aria-invalid={error ? true : undefined}
              onChange={(event) => setReason(event.target.value)}
            />
            {error && <span className={styles.fieldError}>{error}</span>}
          </label>
          {domain && (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={includeDomain}
                onChange={(event) => setIncludeDomain(event.target.checked)}
              />
              Blocca anche il dominio {domain}
            </label>
          )}
          <div className={styles.inlineActions}>
            <button type="submit" className={styles.act} disabled={preview || command.busy}>
              {command.pending ? "Salvo…" : "Metti tra i non contattare"}
            </button>
            {onCleared && (
              <button
                type="button"
                className={styles.act}
                disabled={command.pending}
                onClick={(event) => {
                  setReason("");
                  setIncludeDomain(false);
                  setError(null);
                  const form = event.currentTarget.form;
                  if (form) onCleared(form);
                }}
              >
                Annulla
              </button>
            )}
          </div>
          <CommandFeedback command={command} />
        </form>
      </details>
    </section>
  );
}

/** Nome, tipo, motivo e proposta restano davanti al lavoro corrente. */
function ContactContext({ detail, brief = false }: { detail: PartnerDetail; brief?: boolean }) {
  const { partner } = detail;
  const research = partner.research;
  const why = [research.description, research.why].filter(Boolean);
  const ideas = partner.sections
    .filter((section) => research.idea[section])
    .map((section) => ({ label: PARTNER_IDEA_LABELS[section], text: research.idea[section]! }));
  if (research.pitch)
    ideas.push({
      label: partner.sections.includes("vendita")
        ? "Modelli e argomenti"
        : "Hanno già lavorato con",
      text: research.pitch,
    });
  if (brief)
    return (
      <dl className={styles.detailBlock}>
        <dt>Chi sono</dt>
        <dd>{research.description || partner.typeLabel || "Descrizione da completare."}</dd>
        <dt>Perché li contattiamo</dt>
        <dd>{research.why || "Motivo da completare."}</dd>
        {ideas.length > 0 && (
          <>
            <dt>Cosa proponiamo</dt>
            <dd>
              {ideas.map((idea) => (
                <p key={idea.label}>
                  <b>{idea.label}.</b> {idea.text}
                </p>
              ))}
            </dd>
          </>
        )}
      </dl>
    );
  return (
    <section className={styles.detailBlock} aria-labelledby={`contesto-${partner.co}`}>
      <h4 id={`contesto-${partner.co}`}>{partner.name}</h4>
      <p>
        {partner.typeLabel || "Tipo da completare"} ·{" "}
        {partner.sections.map((section) => PARTNER_SECTION_LABELS[section]).join(" · ")}
      </p>
      {why.length > 0 ? (
        why.map((text, index) => <p key={index}>{text}</p>)
      ) : (
        <p>Motivo da completare.</p>
      )}
      {ideas.map((idea) => (
        <p key={idea.label}>
          <b className={styles.ideaLabel}>{idea.label}.</b> {idea.text}
        </p>
      ))}
    </section>
  );
}

/** La risposta resta leggibile anche quando è uscita dalla pagina del registro. */
function LatestResponse({
  response,
  co,
  onOpenRegister,
}: {
  response: Pick<PartnerWorkReply, "occurredAt" | "body"> | null;
  co: number;
  onOpenRegister?: MouseEventHandler<HTMLAnchorElement>;
}) {
  const { today } = usePartnerContext();
  if (response === null) return null;
  const day = instantDay(response.occurredAt);
  const text = response.body?.trim() ?? "";
  return (
    <section className={styles.detailBlock} aria-label="Ultima risposta registrata">
      <h4>Ultima risposta registrata</h4>
      {day && <p>{longDay(day, today)}</p>}
      {text && (
        <p className={styles.preText}>
          {text.length > 240 ? `${text.slice(0, 240).trimEnd()}…` : text}
        </p>
      )}
      {text.length > 240 && (
        <details className={styles.disclosure}>
          <summary>Leggi risposta completa</summary>
          <p className={styles.preText}>{response.body}</p>
        </details>
      )}
      <a className={styles.act} href={`#registro-${co}`} onClick={onOpenRegister}>
        Leggi nel registro
      </a>
    </section>
  );
}

/** Dati della ricerca importata, in sola lettura. */
function Research({ detail }: { detail: PartnerDetail }) {
  const { today } = usePartnerContext();
  const { partner } = detail;
  const research = partner.research;
  const when = [research.when, research.dateNote, research.application].filter(Boolean);
  const extra = research.extra.filter((item) => item.route || item.application);
  return (
    <div className={styles.researchGrid}>
      <section className={styles.detailBlock}>
        <h4>Come contattarli</h4>
        <p>
          {routeText(
            research.route,
            detail.contacts.filter((contact) => contact.active),
          )}
        </p>
        {research.lang && <p>Lingua: {research.lang}</p>}
      </section>
      {(when.length > 0 || partner.applicationDeadline) && (
        <section className={styles.detailBlock}>
          <h4>Quando</h4>
          {when.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
          {partner.applicationDeadline && (
            <p>Scadenza candidatura: {longDay(partner.applicationDeadline, today)}.</p>
          )}
        </section>
      )}
      {extra.length > 0 && (
        <section className={styles.detailBlock}>
          <h4>Collegati a questa scheda</h4>
          {extra.map((item, index) => (
            <p key={index}>
              <b className={styles.ideaLabel}>{item.name}.</b>{" "}
              {[item.route, item.application].filter(Boolean).join(" ")}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}

/**
 * Dettagli di un contatto: contesto, avvisi, responsabile e prossima azione, ultima risposta,
 * bozza dell'assistente e registro. Ricerca, recapiti e fonti restano in sezioni apribili;
 * modifica della scheda e blocco restano disponibili. Dal 31 ottobre 2026 niente «Messaggi pronti» (vedi
 * partner-messages.tsx): l'email la scrive l'assistente, «Segna inviato» e «Segna sollecito
 * inviato» sono nel Registro e le differenze sui testi vecchi non si mostrano.
 */
export type PartnerDatabaseTab = "breve" | "email" | "registro" | "ricerca" | "recapiti" | "dati";

export function PartnerDetails({
  detail,
  summary,
  block,
  latestReply,
  tab,
  briefActions,
  briefWork,
  classification,
  onOpenRegister,
  onCleared,
  defaultOwnerLabel,
  blockedOverride = false,
}: {
  detail: PartnerDetail;
  summary: PartnerSummary;
  block: PartnerBlock | null;
  /** Ultima risposta dalla vista completa; senza questa proprietà vale il registro caricato. */
  latestReply?: Pick<PartnerWorkReply, "occurredAt" | "body"> | null;
  tab?: PartnerDatabaseTab;
  briefActions?: ReactNode;
  briefWork?: ReactNode;
  classification?: ReactNode;
  onOpenRegister?: MouseEventHandler<HTMLAnchorElement>;
  onCleared?: (form: HTMLFormElement) => void;
  defaultOwnerLabel?: string;
  blockedOverride?: boolean;
}) {
  const { today, members } = usePartnerContext();
  const { partner, research } = { partner: detail.partner, research: detail.partner.research };
  const removedDay = partner.researchRemovedAt ? instantDay(partner.researchRemovedAt) : null;
  const blocked = blockedOverride || detail.blocks.length > 0 || block !== null;
  const differences = detail.differences.filter(isReviewableDifference);
  const loadedResponse =
    detail.activities
      .filter((activity) => activity.kind === "risposta")
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0] ?? null;
  // A parità d'istante conserviamo la fonte completa, senza dedurre un ordine dagli UUID.
  const latestResponse =
    latestReply &&
    (!loadedResponse || Date.parse(latestReply.occurredAt) >= Date.parse(loadedResponse.occurredAt))
      ? latestReply
      : loadedResponse;
  const assistantEligible =
    detail.assistant !== null &&
    detail.assistant !== PARTNER_ASSISTANT_INACTIVE &&
    detail.assistant.active &&
    partnerAssistantSkipReasons({
      partner: summary,
      ownerName: members.find((member) => member.id === summary.ownerId)?.name ?? null,
      blocked,
      contacts: detail.contacts,
      activities: detail.activities,
    }).length === 0;
  const compare = differences.length > 0 && (
    <section className={`${styles.detailBlock} ${styles.flag}`}>
      <h4>Differenze da controllare</h4>
      <ul className={styles.differences}>
        {differences.map((difference) => (
          <DifferenceItem
            key={difference.id}
            difference={difference}
            detail={detail}
            protectDraft={tab === "dati"}
          />
        ))}
      </ul>
    </section>
  );
  const removed = partner.researchRemovedAt && (
    <p className={styles.noteAmber}>
      La ricerca{removedDay ? ` del ${longDay(removedDay, today)}` : ""} non propone più questo
      contatto. Lo storico resta.
    </p>
  );
  const assistant = (
    <PartnerAssistantBlock
      partner={summary}
      assistant={detail.assistant}
      blocked={blocked}
      contacts={detail.contacts}
      activities={detail.activities}
    />
  );
  const researchSources = (research.flags || research.sources.length > 0) && (
    <details className={styles.disclosure}>
      <summary>Attenzione e fonti</summary>
      <div className={styles.researchGrid}>
        {research.flags && (
          <section className={`${styles.detailBlock} ${styles.flag}`}>
            <h4>Attenzione</h4>
            <p>{research.flags}</p>
          </section>
        )}
        {research.sources.length > 0 && (
          <section className={styles.detailBlock}>
            <h4>Fonti</h4>
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
          </section>
        )}
      </div>
    </details>
  );
  if (tab) {
    let content: ReactNode;
    switch (tab) {
      case "breve":
        content = (
          <>
            {briefActions}
            <OwnerStrip
              key={`${summary.id}-${summary.version}`}
              partner={summary}
              assistantEligible={assistantEligible}
              defaultOwnerLabel={defaultOwnerLabel}
              onCleared={onCleared}
              canCancel
            />
            {briefWork}
            <ContactContext detail={detail} brief />
            {removed}
            <LatestResponse
              response={latestResponse}
              co={partner.co}
              onOpenRegister={onOpenRegister}
            />
          </>
        );
        break;
      case "email":
        content = (
          <>
            {assistant}
            <Link href={PARTNER_EMAIL_PATH} prefetch={false} className={styles.act}>
              Apri il Calendario email
            </Link>
          </>
        );
        break;
      case "registro":
        content = <PartnerActivityLog detail={detail} blocked={blocked} />;
        break;
      case "ricerca":
        content = (
          <>
            <Research detail={detail} />
            {researchSources}
          </>
        );
        break;
      case "recapiti":
        content = (
          <>
            <PartnerContactLinks partner={summary} detail={detail} blocked={blocked} />
            <PartnerContacts detail={detail} blocked={blocked} />
            <DoNotContact detail={detail} block={block} onCleared={onCleared} />
          </>
        );
        break;
      case "dati":
        content = (
          <>
            {compare}
            {classification}
            <PartnerDatabaseCardForm partner={summary} />
          </>
        );
        break;
    }
    return <div className={styles.details}>{content}</div>;
  }
  return (
    <div className={styles.details}>
      <ContactContext detail={detail} />
      {compare}
      {removed}
      <OwnerStrip
        key={`${summary.id}-${summary.version}`}
        partner={summary}
        assistantEligible={assistantEligible}
      />
      <PartnerOutcomePanel partner={summary} />
      <LatestResponse response={latestResponse} co={partner.co} />
      {assistant}
      <PartnerActivityLog detail={detail} blocked={blocked} />
      <details className={styles.disclosure}>
        <summary>Ricerca importata</summary>
        <Research detail={detail} />
      </details>
      <details className={styles.disclosure}>
        <summary>Recapiti</summary>
        <PartnerContacts detail={detail} blocked={blocked} />
      </details>
      {researchSources}
      <details className={styles.disclosure}>
        <summary>Modifica la scheda</summary>
        <PartnerCardForm target={summary} />
      </details>
      <DoNotContact detail={detail} block={block} />
    </div>
  );
}

function PartnerDatabaseCardForm({ partner }: { partner: PartnerSummary }) {
  const [edition, setEdition] = useState(0);
  const [draftBase, setDraftBase] = useState<PartnerSummary | null>(null);
  const base = draftBase ?? partner;
  const stale = base.version !== partner.version;
  const reset = () => {
    setDraftBase(null);
    setEdition((value) => value + 1);
  };
  return (
    <div
      onChangeCapture={() => setDraftBase((current) => current ?? partner)}
      onSubmitCapture={(event) => {
        if (!stale) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {stale && (
        <p role="alert" className={styles.noteAmber}>
          La scheda è cambiata. Puoi copiare i dati che hai scritto e scegliere Annulla per
          ripartire dalla versione aggiornata.
        </p>
      )}
      <PartnerCardForm
        key={`${base.id}:${base.version}:${edition}`}
        target={base}
        onDone={reset}
        onCancel={reset}
      />
    </div>
  );
}

function PartnerContactLinks({
  partner,
  detail,
  blocked,
}: {
  partner: PartnerSummary;
  detail: PartnerDetail;
  blocked: boolean;
}) {
  const actions = partnerActions(partner, detail.contacts, blocked);
  const primary = actions.find((action) => action.primary);
  const copy = actions.find((action) => action.kind === "copy");
  if (!primary && !copy) return null;
  return (
    <div className={styles.inlineActions}>
      {primary?.href && (
        <a
          href={primary.href}
          className={styles.act}
          aria-label={primary.ariaLabel ?? undefined}
          target={primary.external ? "_blank" : undefined}
          rel={primary.external ? "noopener noreferrer" : undefined}
        >
          {primary.label}
        </a>
      )}
      {copy?.copyText && <CopyButton text={copy.copyText} label="Copia l’indirizzo email" />}
    </div>
  );
}
