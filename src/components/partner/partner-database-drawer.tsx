"use client";

import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import {
  PARTNER_ASSISTANT_FORMAT_LABELS,
  PARTNER_ASSISTANT_INACTIVE,
  PARTNER_ASSISTANT_STATUS_LABELS,
} from "../../lib/partner/assistant";
import {
  PARTNER_DATABASE_GROUP_LABELS,
  PARTNER_DATABASE_STAGE_LABELS,
  type PartnerDatabaseRow,
} from "../../lib/partner/database";
import { longDay } from "../../lib/partner/dates";
import { partnerHref, partnerLeadAnchor, partnerTeamWorkHref } from "../../lib/partner/links";
import {
  formatCo,
  PARTNER_PRIORITY_LABELS,
  PARTNER_SECTION_LABELS,
  partnerActivityLine,
  type PartnerActivity,
  type PartnerDetail,
} from "../../lib/partner/model";
import { CopyButton } from "./copy-button";
import { usePartnerContext } from "./partner-context";
import { PartnerDatabaseStageControl } from "./partner-database-controls";
import { PartnerDetails, type PartnerDatabaseTab } from "./partner-details";
import styles from "./partner-database-drawer.module.css";
import partnerStyles from "./partner.module.css";

export type { PartnerDatabaseTab } from "./partner-details";

const TABS: readonly [PartnerDatabaseTab, string][] = [
  ["breve", "In breve"],
  ["email", "Email"],
  ["registro", "Registro"],
  ["ricerca", "Ricerca"],
  ["recapiti", "Recapiti"],
  ["dati", "Dati e tag"],
];
const UNSAVED = "Salva o annulla le modifiche del modulo prima di continuare.";

type Props = {
  targetCo: number;
  detail: (PartnerDetail & { latestReply?: PartnerActivity | null }) | null;
  row: PartnerDatabaseRow | null;
  loading?: boolean;
  missing?: boolean;
  readError?: boolean;
  onRetry?: () => void;
  onClose: () => void;
  guard?: string | null;
  initialTab?: PartnerDatabaseTab;
  defaultOwnerLabel?: string;
};

export function PartnerDatabaseDrawer({
  targetCo,
  detail,
  row,
  loading = false,
  missing = false,
  readError = false,
  onRetry,
  onClose,
  guard,
  initialTab = "breve",
  defaultOwnerLabel,
}: Props) {
  const { today, members, preview, hasDirty, setDirty } = usePartnerContext();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const focusTab = useRef(false);
  const forms = useRef(new Map<HTMLFormElement, Element | null>());
  const dirtyKey = `partner-database-drawer-${targetCo}`;
  const id = useId();
  const [tab, setTab] = useState(initialTab);
  const [localGuard, setLocalGuard] = useState(false);
  const [edition, setEdition] = useState(0);

  const currentDetail = detail?.partner.co === targetCo ? detail : null;
  const currentRow = row?.partner.co === targetCo ? row : null;
  const partner =
    currentDetail && (!currentRow || currentDetail.partner.version >= currentRow.partner.version)
      ? currentDetail.partner
      : currentRow?.partner;
  const blocked = Boolean(currentRow?.blocked || currentDetail?.blocks.length);
  const status = readError
    ? "error"
    : missing
      ? "missing"
      : loading || !currentDetail
        ? "loading"
        : "ready";
  const title = partner?.name ?? formatCo(targetCo);
  const stage = currentRow?.stage ?? (partner?.stage === "no" ? "chiuso" : partner?.stage);
  const group = currentRow?.group ? PARTNER_DATABASE_GROUP_LABELS[currentRow.group] : null;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = dialog.current;
    if (modal && !modal.open) {
      modal.showModal();
      closeButton.current?.focus({ preventScroll: true });
    }
    return () => {
      if (modal?.open) modal.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else {
        document
          .getElementById(partnerLeadAnchor(targetCo))
          ?.querySelector<HTMLElement>("button, a[href]")
          ?.focus({ preventScroll: true });
      }
    };
  }, [targetCo]);

  useEffect(() => {
    setTab(initialTab);
    setLocalGuard(false);
  }, [targetCo, initialTab]);

  useEffect(() => {
    if (!focusTab.current) return;
    focusTab.current = false;
    dialog.current?.scrollTo({ top: 0 });
    dialog.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [tab]);

  // Le form esistenti restano intatte. Una cancellazione che smonta il modulo o
  // la conferma visualizzata dal comando libera il controllo di navigazione.
  useEffect(() => {
    const panel = content.current;
    if (!panel || preview) return;
    const observer = new MutationObserver((mutations) => {
      for (const [form, previous] of forms.current) {
        const success = form.querySelector(`.${partnerStyles.feedbackOk}`);
        const newReceipt =
          success &&
          (success !== previous || mutations.some((mutation) => success.contains(mutation.target)));
        if (!panel.contains(form) || newReceipt) forms.current.delete(form);
      }
      setDirty(dirtyKey, forms.current.size > 0);
    });
    observer.observe(panel, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      forms.current.clear();
      setDirty(dirtyKey, false);
    };
  }, [dirtyKey, preview, setDirty]);

  function clearForm(form: HTMLFormElement) {
    forms.current.delete(form);
    setDirty(dirtyKey, forms.current.size > 0);
  }

  function select(next: PartnerDatabaseTab) {
    if (tab === next) return;
    if (hasDirty()) {
      setLocalGuard(true);
      return;
    }
    setLocalGuard(false);
    focusTab.current = true;
    setTab(next);
  }

  function guardLink(event: MouseEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      !hasDirty()
    )
      return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    const href = anchor?.getAttribute("href");
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      anchor?.getAttribute("target") === "_blank" ||
      anchor?.hasAttribute("download")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    setLocalGuard(true);
  }

  function clearDrafts() {
    forms.current.clear();
    setDirty(dirtyKey, false);
    setLocalGuard(false);
    setEdition((value) => value + 1);
  }

  const link = partnerHref({ co: targetCo });
  const copyLink = () => new URL(link, window.location.origin).href;
  const firstAction = blocked
    ? "recapiti"
    : partner?.stage === "da_contattare"
      ? "email"
      : "registro";
  const assistant = currentDetail?.assistant;
  const hasDraft = assistant && assistant !== PARTNER_ASSISTANT_INACTIVE && assistant.draft;
  const actionLabel = {
    email: hasDraft ? "Leggi l’email" : "Stato email",
    recapiti: "Gestisci il blocco",
    registro: "Apri il Registro",
  }[firstAction];
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-titolo`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.sheet}
        onClickCapture={guardLink}
        onChangeCapture={(event) => {
          if (preview || !(event.target instanceof HTMLElement)) return;
          const form = event.target.closest("form");
          if (!form) return;
          if (!forms.current.has(form))
            forms.current.set(form, form.querySelector(`.${partnerStyles.feedbackOk}`));
          setDirty(dirtyKey, true);
        }}
      >
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <div>
              {partner && (
                <p className={styles.kicker}>
                  {formatCo(targetCo)}
                  {partner.sections.length > 0 &&
                    ` · ${partner.sections.map((section) => PARTNER_SECTION_LABELS[section]).join(" · ")}`}
                </p>
              )}
              <h2 id={`${id}-titolo`}>{title}</h2>
              {partner && (
                <p className={styles.meta}>
                  {[partner.city, partner.country, partner.typeLabel].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <button
              ref={closeButton}
              type="button"
              className={styles.close}
              aria-label="Chiudi scheda Partner"
              onClick={onClose}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {stage && (
            <ol className={styles.stages} aria-label="Fasi del contatto">
              {Object.entries(PARTNER_DATABASE_STAGE_LABELS).map(([key, label]) => (
                <li key={key} aria-current={stage === key ? "step" : undefined}>
                  {label}
                </li>
              ))}
            </ol>
          )}
          {(blocked || group) && (
            <p className={styles.phase} data-blocked={blocked || undefined}>
              {blocked ? "Non contattare" : group}
            </p>
          )}
          {status === "ready" && (
            <div className={styles.tabs} role="tablist" aria-label="Scheda Partner">
              {TABS.map(([key, label], index) => (
                <button
                  key={key}
                  id={`${id}-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  aria-controls={`${id}-panel`}
                  tabIndex={tab === key ? 0 : -1}
                  onClick={() => select(key)}
                  onKeyDown={(event) => {
                    const last = TABS.length - 1;
                    const destination =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? last
                          : event.key === "ArrowLeft"
                            ? (index + last) % TABS.length
                            : event.key === "ArrowRight"
                              ? (index + 1) % TABS.length
                              : null;
                    if (destination === null) return;
                    event.preventDefault();
                    event.currentTarget.parentElement
                      ?.querySelectorAll("button")
                      [destination]?.focus();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </header>
        <div ref={content} className={styles.body}>
          {(guard || localGuard) && (
            <div className={styles.warning}>
              <p role="alert">{guard || UNSAVED}</p>
              {hasDirty() && (
                <button type="button" className="button button-secondary" onClick={clearDrafts}>
                  Annulla le modifiche del modulo
                </button>
              )}
            </div>
          )}
          {status === "error" ? (
            <div className={styles.warning}>
              <p role="alert">Non riesco a leggere la scheda. Riprova tra poco.</p>
              {onRetry && (
                <button type="button" className="button button-secondary" onClick={onRetry}>
                  Riprova
                </button>
              )}
            </div>
          ) : status === "missing" ? (
            <p role="alert">Questo contatto non è più disponibile.</p>
          ) : status === "loading" || !currentDetail || !partner ? (
            <p role="status">Caricamento scheda…</p>
          ) : (
            <div
              id={`${id}-panel`}
              role="tabpanel"
              aria-labelledby={`${id}-tab-${tab}`}
              tabIndex={0}
            >
              <PartnerDetails
                key={`${partner.id}:${tab}:${edition}`}
                tab={tab}
                detail={currentDetail}
                summary={partner}
                block={currentDetail.blocks[0] ?? null}
                blockedOverride={blocked}
                defaultOwnerLabel={defaultOwnerLabel}
                classification={
                  currentRow && (
                    <dl className={styles.brief}>
                      <div>
                        <dt>Origine</dt>
                        <dd>{partner.origin === "research" ? "Ricerca importata" : "Team"}</dd>
                      </div>
                      {currentRow.format && (
                        <div>
                          <dt>Formato email</dt>
                          <dd>{formatLabel(currentRow.format)}</dd>
                        </div>
                      )}
                      {currentRow.subtype && (
                        <div>
                          <dt>Sottotipo</dt>
                          <dd>{currentRow.subtype.replaceAll("_", " ")}</dd>
                        </div>
                      )}
                    </dl>
                  )
                }
                latestReply={currentDetail.latestReply}
                onCleared={clearForm}
                onOpenRegister={(event) => {
                  event.preventDefault();
                  select("registro");
                }}
                briefActions={
                  <>
                    <div className={styles.quick}>
                      {partner.stage === "chiuso" && (
                        <Link
                          href={partnerTeamWorkHref(partner)}
                          prefetch={false}
                          className="button button-primary"
                        >
                          Apri in Partner nel Team <ArrowUpRight size={16} aria-hidden="true" />
                        </Link>
                      )}
                      <button
                        type="button"
                        className={
                          partner.stage === "chiuso"
                            ? "button button-secondary"
                            : "button button-primary"
                        }
                        onClick={() => select(firstAction)}
                      >
                        {actionLabel}
                      </button>
                      {firstAction !== "email" && !blocked && (
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => select("email")}
                        >
                          Stato email
                        </button>
                      )}
                      {firstAction === "email" && (
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => select("recapiti")}
                        >
                          Recapiti
                        </button>
                      )}
                    </div>
                    <details className={styles.moreActions}>
                      <summary>Altre azioni</summary>
                      <div className={styles.quick}>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => select("dati")}
                        >
                          Modifica dati e tag
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => select("ricerca")}
                        >
                          Ricerca e fonti
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => select("recapiti")}
                        >
                          Recapiti e blocco
                        </button>
                        <CopyButton
                          text={copyLink}
                          label="Copia il link alla scheda"
                          className="button button-secondary"
                        />
                      </div>
                    </details>
                  </>
                }
                briefWork={
                  <>
                    {currentRow?.work.warning && (
                      <p className={styles.warning}>{currentRow.work.warning}</p>
                    )}
                    <dl className={styles.brief}>
                      <div>
                        <dt>Prossimo passo</dt>
                        <dd>{currentRow?.next.label ?? partner.nextAction ?? "Da definire"}</dd>
                        {currentRow?.next.day && (
                          <dd>
                            {currentRow.next.estimated ? "Stima: " : ""}
                            {longDay(currentRow.next.day, today)}
                          </dd>
                        )}
                        {currentRow?.next.who && <dd>{currentRow.next.who}</dd>}
                        {currentRow?.work.turn && <dd>Turno: {currentRow.work.turn}</dd>}
                      </div>
                      <div>
                        <dt>Prima email</dt>
                        <dd>
                          {emailState(currentDetail, blocked, currentRow?.work.phase === "held")}
                        </dd>
                      </div>
                      <div>
                        <dt>Priorità</dt>
                        <dd>{PARTNER_PRIORITY_LABELS[partner.priority]}</dd>
                      </div>
                    </dl>
                    {currentRow?.proposal && (
                      <p>
                        <strong>Proposta</strong> · {currentRow.proposal}
                      </p>
                    )}
                    <PartnerDatabaseStageControl partner={partner} />
                    {currentDetail.activities.length > 0 && (
                      <details className={styles.moreActions}>
                        <summary>Ultime attività</summary>
                        <ul className={styles.recent}>
                          {currentDetail.activities.slice(0, 3).map((activity) => (
                            <li key={activity.id}>{partnerActivityLine(activity, members)}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => select("registro")}
                        >
                          Vedi il Registro
                        </button>
                      </details>
                    )}
                  </>
                }
              />
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

function emailState(detail: PartnerDetail, blocked: boolean, held: boolean): string {
  if (blocked) return "Contatto nella lista Non contattare";
  const assistant = detail.assistant;
  if (assistant === null) return "Stato non leggibile";
  if (assistant === PARTNER_ASSISTANT_INACTIVE) return "Assistente non attivo";
  if (assistant.job?.reason === "invio_incerto") return "Invio da verificare in Posta inviata";
  if (
    assistant.job?.status === "inviata" ||
    assistant.sends.some((send) => send.status === "inviato")
  )
    return "Prima email inviata";
  if (!assistant.active || held) return "Assistente fermo su questo contatto";
  return assistant.job ? PARTNER_ASSISTANT_STATUS_LABELS[assistant.job.status] : "Nessuna bozza";
}

function formatLabel(format: string): string {
  if (format === "club") return "Club";
  return Object.hasOwn(PARTNER_ASSISTANT_FORMAT_LABELS, format)
    ? PARTNER_ASSISTANT_FORMAT_LABELS[format as keyof typeof PARTNER_ASSISTANT_FORMAT_LABELS]
    : "Da verificare";
}
