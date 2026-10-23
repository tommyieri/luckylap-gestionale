"use client";

import { useOptimistic, type ReactNode } from "react";
import { FileText, Globe, Mail, Phone } from "lucide-react";
import { partnerStatePayload } from "../../lib/partner/commands";
import {
  partnerActions,
  routeText,
  shortRoute,
  type PartnerAction,
} from "../../lib/partner/contacts";
import { upcomingEventStart, type PartnerViewSection } from "../../lib/partner/filters";
import {
  PARTNER_PRIORITY_LABELS,
  PARTNER_SECTION_LABELS,
  PARTNER_STAGES,
  PARTNER_STAGE_LABELS,
  formatCo,
  memberName,
  readyMessagesLabel,
  shortReason,
  type PartnerBlock,
  type PartnerContactLink,
  type PartnerDetail,
  type PartnerSection,
  type PartnerStage,
  type PartnerSummary,
} from "../../lib/partner/model";
import {
  eventTiming,
  monthBox,
  nextActionTiming,
  plannedMonth,
  type PartnerPeriodNumber,
} from "../../lib/partner/periods";
import { CopyButton } from "./copy-button";
import { CommandFeedback, usePartnerCommand } from "./partner-command";
import { usePartnerContext } from "./partner-context";
import { PartnerDetails } from "./partner-details";
import { InstagramIcon, TulipIcon } from "./partner-icons";
import styles from "./partner.module.css";

/** «Collab ed Eventi»: «ed» davanti a vocale, come joinIt del sito. */
export function joinItalian(words: readonly string[]): string {
  if (words.length < 2) return words.join("");
  const last = words[words.length - 1];
  return `${words.slice(0, -1).join(", ")}${/^[aeiou]/i.test(last) ? " ed " : " e "}${last}`;
}

/** Casella CO: «CO», numero a tre cifre, mese pianificato. Verde pieno per «adesso», ambra per l'evento vicino. */
export function PartnerCoBox({
  co,
  month,
  tone,
}: {
  co: number;
  month: string;
  tone: "now" | "soon" | null;
}) {
  return (
    <div className={styles.co} aria-hidden="true">
      <span className={styles.coLabel}>CO</span>
      <span className={styles.coNum}>{formatCo(co).slice(3)}</span>
      <span
        className={`${styles.coMonth} ${tone === "now" ? styles.coMonthNow : tone === "soon" ? styles.coMonthSoon : ""}`}
      >
        {month}
      </span>
    </div>
  );
}

const ACTION_ICONS: Record<PartnerAction["kind"], ReactNode> = {
  email: <Mail size={16} strokeWidth={1.8} aria-hidden />,
  copy: null,
  form: <FileText size={16} strokeWidth={1.8} aria-hidden />,
  instagram: <InstagramIcon />,
  phone: <Phone size={16} strokeWidth={1.8} aria-hidden />,
  web: <Globe size={16} strokeWidth={1.8} aria-hidden />,
};

function ActionLink({ action, now }: { action: PartnerAction; now: boolean }) {
  return (
    <a
      href={action.href ?? undefined}
      className={`${styles.act} ${action.primary ? (now ? styles.actNow : styles.actPrimary) : ""}`}
      aria-label={action.ariaLabel ?? undefined}
      {...(action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {ACTION_ICONS[action.kind]}
      <span className={styles.actText}>{action.label}</span>
      {action.external && <span className="sr-only">(si apre in una nuova scheda)</span>}
    </a>
  );
}

/** Pulsanti della riga. «Copia» resta attaccato all'email che copia, anche quando la riga va a capo. */
function RowActions({ actions, now }: { actions: PartnerAction[]; now: boolean }) {
  return (
    <div className={styles.actions}>
      {actions.map((action, index) => {
        if (action.kind === "copy") return null;
        const copy = actions[index + 1]?.kind === "copy" ? actions[index + 1] : null;
        if (!copy) return <ActionLink key={action.kind} action={action} now={now} />;
        return (
          <span key={action.kind} className={styles.actPair}>
            <ActionLink action={action} now={now} />
            <CopyButton
              text={copy.copyText ?? ""}
              ariaLabel={copy.ariaLabel ?? undefined}
              className={styles.actCopy}
            />
          </span>
        );
      })}
    </div>
  );
}

export type PartnerRowProps = {
  partner: PartnerSummary;
  contacts: readonly PartnerContactLink[];
  /** Messaggi da mostrare (varianti visibili). */
  messages: number;
  /** Differenze aperte. */
  differences: number;
  block: PartnerBlock | null;
  period: PartnerPeriodNumber;
  section: PartnerViewSection;
  open: boolean;
  /** Un'altra riga è aperta: questa si attenua. */
  dimmed: boolean;
  /** Dettaglio del contatto, quando è arrivato dal server. */
  detail: PartnerDetail | null;
  onToggle: () => void;
  guard: string | null;
};

export function PartnerRow({
  partner,
  contacts,
  messages,
  differences,
  block,
  period,
  section,
  open,
  dimmed,
  detail,
  onToggle,
  guard,
}: PartnerRowProps) {
  const { preview, today, members } = usePartnerContext();
  const command = usePartnerCommand(`stato-${partner.id}`);
  const [stage, setOptimisticStage] = useOptimistic<PartnerStage>(partner.stage);
  const now = period === 1;
  const timing = eventTiming(partner, today);
  const next = nextActionTiming(partner, today);
  const blocked = block !== null;
  const loading = open && detail === null;
  const sectionTags: ReactNode[] =
    section === "tutti"
      ? partner.sections.map((item) => (
          <span key={item} className={`${styles.tag} ${styles.tagCurrent}`}>
            {PARTNER_SECTION_LABELS[item]}
          </span>
        ))
      : [
          <span key="current" className={`${styles.tag} ${styles.tagCurrent}`}>
            {PARTNER_SECTION_LABELS[section as PartnerSection]}
          </span>,
          ...(partner.sections.length > 1
            ? [
                <span key="others" className={styles.tag}>
                  anche in{" "}
                  {joinItalian(
                    partner.sections
                      .filter((item) => item !== section)
                      .map((item) => PARTNER_SECTION_LABELS[item]),
                  )}
                </span>,
              ]
            : []),
        ];
  const ready = readyMessagesLabel(messages);
  // Accordo fatto con date in arrivo: l'appuntamento è nel calendario del team.
  const inCalendar =
    stage === "chiuso" &&
    (upcomingEventStart(partner, today) !== null ||
      (partner.applicationDeadline !== null && partner.applicationDeadline >= today));

  function changeStage(value: string) {
    const nextStage = PARTNER_STAGES.find((item) => item === value);
    if (!nextStage || nextStage === partner.stage) return;
    const payload = partnerStatePayload({
      partnerId: partner.id,
      expectedVersion: partner.version,
      stage: nextStage,
    });
    if (!payload.ok) return;
    command.run("set_partner_state", payload.payload, undefined, () =>
      setOptimisticStage(nextStage),
    );
  }

  return (
    <li
      id={`lead-${partner.co}`}
      className={styles.row}
      data-stage={stage}
      data-open={open || undefined}
      data-dimmed={dimmed || undefined}
      data-blocked={blocked || undefined}
    >
      <PartnerCoBox
        co={partner.co}
        month={monthBox(plannedMonth(partner))}
        tone={now ? "now" : timing?.soon ? "soon" : null}
      />
      <div className={styles.leg}>
        <div className={styles.titleLine}>
          <h3 className={styles.name}>
            <span className="sr-only">{formatCo(partner.co)} · </span>
            {partner.name}
          </h3>
          <span className={styles.prio} data-priority={partner.priority}>
            {PARTNER_PRIORITY_LABELS[partner.priority]}
          </span>
        </div>
        {(partner.typeLabel || partner.city || partner.country) && (
          <p className={styles.meta}>
            {[partner.typeLabel, [partner.city, partner.country].filter(Boolean).join(", ")]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        <p className={styles.tags}>
          {sectionTags}
          {timing && (
            <span
              className={`${styles.tag} ${styles.tagDate} ${timing.soon || timing.ongoing ? styles.tagSoon : ""}`}
            >
              {timing.label}
            </span>
          )}
          {partner.followers && <span className={styles.tag}>{partner.followers}</span>}
          {inCalendar && (
            <span className={`${styles.tag} ${styles.tagAgreed}`}>Nel calendario del team</span>
          )}
          {ready && <span className={`${styles.tag} ${styles.tagReady}`}>{ready}</span>}
          {partner.ownerId && (
            <span className={styles.tag}>Seguito da {memberName(members, partner.ownerId)}</span>
          )}
          {next && (
            <span className={`${styles.tag} ${next.overdue ? styles.tagSoon : ""}`}>
              {next.label}
            </span>
          )}
          {blocked && <span className={`${styles.tag} ${styles.tagBlocked}`}>Non contattare</span>}
          {differences > 0 && (
            <span className={`${styles.tag} ${styles.tagSoon}`}>Da controllare</span>
          )}
          {partner.researchRemovedAt && <span className={styles.tag}>Fuori dalla ricerca</span>}
        </p>
      </div>
      <div className={styles.channel}>
        {blocked ? (
          <p className={styles.blockedNote}>Non contattare: {shortReason(block.reason)}</p>
        ) : (
          <>
            <p className={styles.route}>
              <b>Come.</b> {shortRoute(routeText(partner.route, contacts))}
            </p>
            <RowActions actions={partnerActions(partner, contacts, false)} now={now} />
          </>
        )}
      </div>
      <div className={styles.state}>
        <label className="sr-only" htmlFor={`stato-${partner.co}`}>
          Stato di {partner.name}
        </label>
        <select
          id={`stato-${partner.co}`}
          className={styles.stageSelect}
          value={stage}
          disabled={preview || command.busy}
          onChange={(event) => changeStage(event.target.value)}
        >
          {PARTNER_STAGES.map((item) => (
            <option key={item} value={item}>
              {PARTNER_STAGE_LABELS[item]}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className={styles.open}
        aria-expanded={open}
        aria-controls={`dettagli-${partner.co}`}
        aria-busy={loading || undefined}
        onClick={onToggle}
      >
        <TulipIcon />
        <span>{loading ? "Apro…" : open ? "Chiudi" : "Dettagli"}</span>
      </button>
      {(command.state.status !== "idle" && command.state.status !== "success") || guard ? (
        <div className={styles.rowFeedback}>
          {guard && (
            <p role="alert" className={styles.feedbackError}>
              {guard}
            </p>
          )}
          <CommandFeedback command={command} compact />
        </div>
      ) : null}
      {open && (
        <div
          id={`dettagli-${partner.co}`}
          className={styles.more}
          role="region"
          aria-label={`Dettagli di ${partner.name}`}
          aria-busy={loading || undefined}
        >
          {detail ? (
            <PartnerDetails detail={detail} summary={partner} block={block} />
          ) : (
            <div className={styles.skeletonLines} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      )}
    </li>
  );
}
