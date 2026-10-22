"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from "react";
import Link from "next/link";
import { History, Mail, RotateCcw } from "lucide-react";
import {
  partnerActivityPayload,
  partnerMessagePayload,
  type PartnerMessageFormField,
} from "../../lib/partner/commands";
import { messageMailto } from "../../lib/partner/contacts";
import { instantDay, longDay } from "../../lib/partner/dates";
import {
  PARTNER_DATA_PATH,
  PARTNER_RULES_PATH,
  partnerLookbookHref,
} from "../../lib/partner/links";
import { partnerLookbookTitle } from "../../lib/partner/lookbook";
import {
  PARTNER_APPROACHES,
  PARTNER_APPROACH_LABELS,
  PARTNER_LANGUAGES,
  PARTNER_LANGUAGE_LABELS,
  PARTNER_MESSAGE_FIELDS,
  PARTNER_MESSAGE_LIMITS,
  PARTNER_VARIANT_CHANNELS,
  PARTNER_VARIANT_CHANNEL_LABELS,
  isVisibleVariant,
  memberName,
  recentSentActivity,
  recentSentQuestion,
  type PartnerActivityChannel,
  type PartnerApproach,
  type PartnerDetail,
  type PartnerLanguage,
  type PartnerMessageField,
  type PartnerMessageKind,
  type PartnerMessageTexts,
  type PartnerRevision,
  type PartnerVariantChannel,
  type PartnerVariantDetail,
} from "../../lib/partner/model";
import { CopyButton } from "./copy-button";
import { CommandFeedback, usePartnerCommand } from "./partner-command";
import { usePartnerContext } from "./partner-context";
import styles from "./partner.module.css";

const EMPTY_TEXTS: PartnerMessageTexts = {
  subject: "",
  body: "",
  follow_up: "",
  confirm_email: "",
};
const sameTexts = (a: PartnerMessageTexts, b: PartnerMessageTexts) =>
  PARTNER_MESSAGE_FIELDS.every((field) => a[field] === b[field]);

/** Canale della variante → canale del registro («Segna inviato»). */
export const ACTIVITY_CHANNEL_OF: Record<PartnerVariantChannel, PartnerActivityChannel> = {
  email: "email",
  form: "form",
  dm: "dm",
  phone: "phone",
};

const FIELD_TITLES = (channel: PartnerVariantChannel): Record<PartnerMessageField, string> => ({
  subject: "Oggetto",
  body: channel === "phone" ? "Cosa dire" : "Testo",
  confirm_email: "Email di conferma dopo la chiamata",
  follow_up: "Sollecito dopo 7-10 giorni",
});

/** Textarea che cresce con il testo. */
function GrowingTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} {...props} />;
}

function recipientLabel(channel: PartnerVariantChannel) {
  return channel === "form"
    ? "Modulo"
    : channel === "dm"
      ? "Profilo"
      : channel === "phone"
        ? "Numero"
        : "A";
}

/** «Modificato da Ettore il 3 novembre.», «Testo dal file del telefono del 20 ottobre.» */
function revisionLine(
  revision: PartnerRevision,
  members: Parameters<typeof memberName>[0],
  today: string,
) {
  const day = instantDay(revision.createdAt);
  const when = day ? ` il ${longDay(day, today)}` : "";
  if (revision.kind === "file") {
    const exported = revision.fileExportedAt ? instantDay(revision.fileExportedAt) : null;
    return `Testo dal file di un dispositivo${exported ? ` esportato il ${longDay(exported, today)}` : ""}, importato da ${memberName(members, revision.createdBy)}.`;
  }
  if (revision.kind === "restore")
    return `Ripristinato l’originale da ${memberName(members, revision.createdBy)}${when}.`;
  return `Modificato da ${memberName(members, revision.createdBy)}${when}.`;
}

function SentButton({
  detail,
  variant,
  messageKind,
  blocked,
}: {
  detail: PartnerDetail;
  variant: PartnerVariantDetail;
  messageKind: PartnerMessageKind;
  blocked: boolean;
}) {
  const { preview, today, members } = usePartnerContext();
  const command = usePartnerCommand(`inviato-${variant.id}-${messageKind}`);
  const [question, setQuestion] = useState<string | null>(null);
  const label = messageKind === "sollecito" ? "Segna sollecito inviato" : "Segna inviato";
  function send(confirmed: boolean) {
    const recent = recentSentActivity(detail.activities, new Date(), messageKind);
    if (recent && !confirmed) {
      setQuestion(recentSentQuestion(recent, members));
      return;
    }
    setQuestion(null);
    const payload = partnerActivityPayload(
      {
        partnerId: detail.partner.id,
        kind: "inviato",
        occurredOn: "",
        channel: ACTIVITY_CHANNEL_OF[variant.channel],
        approach: variant.approach,
        messageKind,
        body: "",
      },
      today,
    );
    if (payload.ok) command.run("record_partner_activity", payload.payload);
  }
  return (
    <div className={styles.sentBox}>
      <button
        type="button"
        className={`${styles.act} ${styles.actMini}`}
        disabled={preview || blocked || command.busy}
        onClick={() => send(false)}
      >
        {command.pending ? "Salvo…" : label}
      </button>
      {question && (
        <div className={styles.confirm} role="group" aria-label="Conferma">
          <p>{question}</p>
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={`${styles.act} ${styles.actMini}`}
              onClick={() => send(true)}
            >
              Sì, segna di nuovo
            </button>
            <button
              type="button"
              className={`${styles.act} ${styles.actMini}`}
              onClick={() => setQuestion(null)}
            >
              Annulla
            </button>
          </div>
        </div>
      )}
      <CommandFeedback command={command} compact />
    </div>
  );
}

function VariantEditor({
  detail,
  variant,
  blocked,
  draft,
  onDraft,
  onConflict,
}: {
  detail: PartnerDetail;
  variant: PartnerVariantDetail;
  blocked: boolean;
  draft: PartnerMessageTexts | null;
  onDraft: (texts: PartnerMessageTexts | null) => void;
  onConflict: (texts: PartnerMessageTexts) => void;
}) {
  const { preview, members, today } = usePartnerContext();
  const id = useId();
  const save = usePartnerCommand(`messaggio-${variant.id}`);
  const restore = usePartnerCommand(`ripristino-${variant.id}`);
  const keep = usePartnerCommand(`tieni-${variant.id}`);
  const [errors, setErrors] = useState<Partial<Record<PartnerMessageFormField, string>>>({});
  const [showVersions, setShowVersions] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const texts = draft ?? variant.current;
  const dirty = draft !== null && !sameTexts(draft, variant.current);
  const titles = FIELD_TITLES(variant.channel);
  const hasOriginal = PARTNER_MESSAGE_FIELDS.some((field) => variant.original[field] !== "");
  const shown = (field: PartnerMessageField) =>
    field === "body" ||
    variant.origin === "team" ||
    variant.original[field] !== "" ||
    variant.current[field] !== "" ||
    texts[field] !== "" ||
    (field === "subject" && variant.channel !== "phone");
  const difference = detail.differences.find(
    (item) => item.field === "message" && item.variantId === variant.id,
  );

  // 40001: il testo del collega arriva con la pagina riletta; il tuo resta nel riquadro sotto.
  useEffect(() => {
    if (save.state.status === "rejected" && save.state.code === "partner_changed" && draft) {
      onConflict(draft);
      onDraft(null);
    }
  }, [save.state, draft, onConflict, onDraft]);

  function change(field: PartnerMessageField, value: string) {
    const next = { ...texts, [field]: value };
    onDraft(sameTexts(next, variant.current) ? null : next);
  }

  function submit() {
    if (preview || save.busy || !dirty) return;
    const result = partnerMessagePayload({
      partnerId: detail.partner.id,
      approach: variant.approach,
      texts,
      existing: { expectedVersion: variant.version },
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    save.run("save_partner_message", result.payload, () => onDraft(null));
  }

  const mailto =
    variant.channel === "email"
      ? messageMailto({ to: variant.to, cc: variant.cc, subject: texts.subject, body: texts.body })
      : null;
  const fieldId = (field: PartnerMessageField) => `${id}-${field}`;
  const lookbook = variant.lookbookCode;

  return (
    <div className={styles.variant}>
      <p className={styles.variantHead}>
        {PARTNER_VARIANT_CHANNEL_LABELS[variant.channel]}{" "}
        {PARTNER_LANGUAGE_LABELS[variant.language]}
        {lookbook && (
          <>
            {" · allega il lookbook "}
            <a href={partnerLookbookHref(lookbook)} download>
              {partnerLookbookTitle(lookbook)}
            </a>
          </>
        )}
      </p>
      {variant.gist && <p className={styles.gist}>{variant.gist}</p>}
      {(variant.to || variant.cc) && (
        <dl className={styles.recipients}>
          {variant.to && (
            <>
              <dt>{recipientLabel(variant.channel)}</dt>
              <dd>
                <span className={styles.recipient}>{variant.to}</span>
                <CopyButton
                  text={variant.to}
                  ariaLabel={`Copia: ${recipientLabel(variant.channel)}`}
                />
              </dd>
            </>
          )}
          {variant.cc && (
            <>
              <dt>Cc</dt>
              <dd>
                <span className={styles.recipient}>{variant.cc}</span>
                <CopyButton text={variant.cc} ariaLabel="Copia: Cc" />
              </dd>
            </>
          )}
        </dl>
      )}

      {variant.originalChangedAt && (
        <div className={styles.noteAmber}>
          <p>
            La ricerca ha aggiornato il testo originale
            {instantDay(variant.originalChangedAt)
              ? ` il ${longDay(instantDay(variant.originalChangedAt)!, today)}`
              : ""}
            . Resta in uso il testo del team.
          </p>
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={`${styles.act} ${styles.actMini}`}
              aria-expanded={showOriginal}
              onClick={() => setShowOriginal((value) => !value)}
            >
              {showOriginal ? "Nascondi il nuovo originale" : "Vedi il nuovo originale"}
            </button>
            <button
              type="button"
              className={`${styles.act} ${styles.actMini}`}
              disabled={preview || restore.busy || dirty}
              onClick={() =>
                restore.run("restore_partner_message", {
                  schema_version: 1,
                  variant_id: variant.id,
                  expected_version: variant.version,
                })
              }
            >
              Usa il nuovo originale
            </button>
            {difference && (
              <button
                type="button"
                className={`${styles.act} ${styles.actMini}`}
                disabled={preview || keep.busy}
                onClick={() =>
                  keep.run("resolve_partner_difference", {
                    schema_version: 1,
                    difference_id: difference.id,
                    choice: "kept_team",
                    expected_version: variant.version,
                  })
                }
              >
                Tieni il nostro
              </button>
            )}
          </div>
          {showOriginal && (
            <div className={styles.originalPreview}>
              {PARTNER_MESSAGE_FIELDS.filter((field) => variant.original[field] !== "").map(
                (field) => (
                  <div key={field}>
                    <p className={styles.miniTitle}>{titles[field]}</p>
                    <p className={styles.preText}>{variant.original[field]}</p>
                  </div>
                ),
              )}
            </div>
          )}
          <CommandFeedback command={keep} compact />
        </div>
      )}

      {PARTNER_MESSAGE_FIELDS.filter(shown).map((field) => (
        <div key={field} className={styles.draftBlock}>
          <div className={styles.draftHead}>
            <label htmlFor={fieldId(field)} className={styles.miniTitle}>
              {titles[field]}
            </label>
            <CopyButton
              text={() => texts[field]}
              label="Copia il testo"
              ariaLabel={`Copia il testo: ${titles[field]}`}
              source={() =>
                document.getElementById(fieldId(field)) as
                  HTMLInputElement | HTMLTextAreaElement | null
              }
            />
          </div>
          {field === "subject" ? (
            <input
              id={fieldId(field)}
              className={styles.subjectInput}
              value={texts.subject}
              maxLength={PARTNER_MESSAGE_LIMITS.subject}
              readOnly={preview}
              aria-invalid={errors.subject ? true : undefined}
              onChange={(event) => change("subject", event.target.value)}
            />
          ) : (
            <GrowingTextarea
              id={fieldId(field)}
              className={styles.draftText}
              value={texts[field]}
              rows={4}
              maxLength={PARTNER_MESSAGE_LIMITS[field]}
              spellCheck
              readOnly={preview}
              aria-invalid={errors[field] ? true : undefined}
              onChange={(event) => change(field, event.target.value)}
            />
          )}
          {errors[field] && <span className={styles.fieldError}>{errors[field]}</span>}
          {field === "body" && (
            <SentButton detail={detail} variant={variant} messageKind="primo" blocked={blocked} />
          )}
          {field === "follow_up" && (
            <SentButton
              detail={detail}
              variant={variant}
              messageKind="sollecito"
              blocked={blocked}
            />
          )}
        </div>
      ))}
      {errors.texts && <p className={styles.fieldError}>{errors.texts}</p>}

      {(variant.formFields || variant.notes) && (
        <div className={styles.draftNotes}>
          {variant.formFields && (
            <p>
              <b>Campi del modulo.</b> {variant.formFields}
            </p>
          )}
          {variant.notes && (
            <p>
              <b>Prima di inviare.</b> {variant.notes}
            </p>
          )}
        </div>
      )}

      <div className={styles.formActions}>
        <button
          type="button"
          className="button button-primary"
          disabled={preview || !dirty || save.busy}
          onClick={submit}
        >
          {save.pending ? "Salvo…" : "Salva il testo"}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={!dirty || save.pending}
          onClick={() => {
            setErrors({});
            onDraft(null);
          }}
        >
          Annulla le modifiche
        </button>
        {mailto && !blocked && (
          <a href={mailto.href} className="button button-secondary">
            <Mail size={16} strokeWidth={1.8} aria-hidden />
            Apri l’email con il testo
          </a>
        )}
      </div>
      {mailto && !blocked && !mailto.bodyIncluded && (
        <p className={styles.hint}>
          Il testo è lungo: l’email si apre con destinatario e oggetto. Copia il testo e incollalo.
        </p>
      )}
      {dirty && <p className={styles.hint}>Modifiche non salvate.</p>}
      <CommandFeedback command={save} />

      <div className={styles.editLine}>
        <span>
          {variant.currentRevision
            ? revisionLine(variant.currentRevision, members, today)
            : variant.origin === "team"
              ? "Messaggio scritto dal team."
              : "Testo originale della ricerca."}
        </span>
        {variant.currentRevision && hasOriginal && (
          <button
            type="button"
            className={`${styles.act} ${styles.actMini}`}
            disabled={preview || restore.busy || dirty}
            onClick={() =>
              restore.run("restore_partner_message", {
                schema_version: 1,
                variant_id: variant.id,
                expected_version: variant.version,
              })
            }
          >
            <RotateCcw size={16} strokeWidth={1.8} aria-hidden />
            Ripristina l’originale
          </button>
        )}
        {variant.revisionCount > 0 && (
          <button
            type="button"
            className={`${styles.act} ${styles.actMini}`}
            aria-expanded={showVersions}
            onClick={() => setShowVersions((value) => !value)}
          >
            <History size={16} strokeWidth={1.8} aria-hidden />
            Versioni ({variant.revisionCount})
          </button>
        )}
      </div>
      <CommandFeedback command={restore} compact />
      {showVersions && (
        <ol className={styles.versions}>
          {variant.revisions.map((revision) => (
            <li key={revision.id}>
              <span className="num">{revision.revisionNo}</span>
              <span>{revisionLine(revision, members, today)}</span>
              {revision.texts && (
                <button
                  type="button"
                  className={`${styles.act} ${styles.actMini}`}
                  disabled={preview}
                  onClick={() => {
                    const next = revision.texts!;
                    onDraft(sameTexts(next, variant.current) ? null : next);
                  }}
                >
                  Riprendi questo testo
                </button>
              )}
            </li>
          ))}
          {variant.revisionCount > variant.revisions.length && (
            <li className={styles.hint}>
              Le versioni più vecchie restano nello storico del gestionale.
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

/** «Scrivi un messaggio»: approccio, canale e lingua, poi i campi vuoti. */
function NewMessage({ detail, onCancel }: { detail: PartnerDetail; onCancel: () => void }) {
  const { preview } = usePartnerContext();
  const id = useId();
  const used = new Set(detail.variants.map((variant) => variant.approach));
  const free = PARTNER_APPROACHES.filter((approach) => !used.has(approach));
  const command = usePartnerCommand(`nuovo-messaggio-${detail.partner.id}`);
  const [approach, setApproach] = useState<PartnerApproach>(free[0] ?? "vendita");
  const [channel, setChannel] = useState<PartnerVariantChannel>("email");
  const [language, setLanguage] = useState<PartnerLanguage>("en");
  const [texts, setTexts] = useState<PartnerMessageTexts>(EMPTY_TEXTS);
  const [error, setError] = useState<string | null>(null);
  const titles = FIELD_TITLES(channel);
  function submit() {
    if (preview || command.busy) return;
    const result = partnerMessagePayload({
      partnerId: detail.partner.id,
      approach,
      texts,
      existing: null,
      channel,
      language,
    });
    if (!result.ok) {
      setError(Object.values(result.errors)[0] ?? "Controlla i testi.");
      return;
    }
    setError(null);
    command.run("save_partner_message", result.payload, onCancel);
  }
  if (free.length === 0) return null;
  return (
    <div className={styles.variant}>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Approccio</span>
          <select
            value={approach}
            onChange={(event) => setApproach(event.target.value as PartnerApproach)}
          >
            {free.map((item) => (
              <option key={item} value={item}>
                {PARTNER_APPROACH_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Canale</span>
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value as PartnerVariantChannel)}
          >
            {PARTNER_VARIANT_CHANNELS.map((item) => (
              <option key={item} value={item}>
                {PARTNER_VARIANT_CHANNEL_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Lingua</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as PartnerLanguage)}
          >
            {PARTNER_LANGUAGES.map((item) => (
              <option key={item} value={item}>
                {PARTNER_LANGUAGE_LABELS[item].replace(/^in /, "")}
              </option>
            ))}
          </select>
        </label>
      </div>
      {PARTNER_MESSAGE_FIELDS.map((field) => (
        <label key={field} className={styles.draftBlock} htmlFor={`${id}-${field}`}>
          <span className={styles.miniTitle}>{titles[field]}</span>
          {field === "subject" ? (
            <input
              id={`${id}-${field}`}
              className={styles.subjectInput}
              value={texts.subject}
              maxLength={PARTNER_MESSAGE_LIMITS.subject}
              onChange={(event) => setTexts({ ...texts, subject: event.target.value })}
            />
          ) : (
            <GrowingTextarea
              id={`${id}-${field}`}
              className={styles.draftText}
              value={texts[field]}
              rows={field === "body" ? 6 : 3}
              maxLength={PARTNER_MESSAGE_LIMITS[field]}
              onChange={(event) => setTexts({ ...texts, [field]: event.target.value })}
            />
          )}
        </label>
      ))}
      {error && (
        <p role="alert" className={styles.feedbackError}>
          {error}
        </p>
      )}
      <div className={styles.formActions}>
        <button
          type="button"
          className="button button-primary"
          disabled={preview || command.busy}
          onClick={submit}
        >
          {command.pending ? "Salvo…" : "Salva il messaggio"}
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Annulla
        </button>
      </div>
      <CommandFeedback command={command} />
    </div>
  );
}

/** Messaggi pronti (spec 02 §5.6): approcci, testi modificabili con storico, invio segnato. */
export function PartnerMessages({ detail, blocked }: { detail: PartnerDetail; blocked: boolean }) {
  const { setDirty } = usePartnerContext();
  const variants = detail.variants.filter((variant) => isVisibleVariant(variant));
  const chosen = detail.partner.chosenApproach;
  const [approach, setApproach] = useState<PartnerApproach | null>(
    () =>
      (variants.find((variant) => variant.approach === chosen) ?? variants[0])?.approach ?? null,
  );
  const [drafts, setDrafts] = useState<Record<string, PartnerMessageTexts>>({});
  const [conflicts, setConflicts] = useState<Record<string, PartnerMessageTexts>>({});
  const [writing, setWriting] = useState(false);
  const variant = variants.find((item) => item.approach === approach) ?? variants[0] ?? null;
  const dirtyIds = Object.keys(drafts);

  useEffect(() => {
    for (const item of variants) setDirty(`messaggio-${item.id}`, dirtyIds.includes(item.id));
    return () => {
      for (const item of variants) setDirty(`messaggio-${item.id}`, false);
    };
  });

  const skipped = detail.partner.research.skippedIt;
  if (!variant)
    return (
      <section className={styles.draft} aria-labelledby={`messaggi-${detail.partner.co}`}>
        <h4 id={`messaggi-${detail.partner.co}`}>Messaggi</h4>
        <p>Nessun messaggio pronto per questo contatto.</p>
        {writing ? (
          <NewMessage detail={detail} onCancel={() => setWriting(false)} />
        ) : (
          <div className={styles.inlineActions}>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setWriting(true)}
            >
              Scrivi un messaggio
            </button>
          </div>
        )}
        <p className={styles.hint}>
          Per un testo che rispetta le regole di CONTESTO.md, chiedilo a Claude con il comando
          messaggi nel repository Partner.
        </p>
        {skipped && <p className={styles.hint}>Approcci scartati: {skipped}</p>}
        <p>
          <Link href={PARTNER_RULES_PATH} prefetch={false} className="text-button">
            Regole per scrivere
          </Link>
        </p>
      </section>
    );

  const conflict = conflicts[variant.id];
  return (
    <section className={styles.draft} aria-labelledby={`messaggi-${detail.partner.co}`}>
      <h4 id={`messaggi-${detail.partner.co}`}>
        {variants.length > 1
          ? `Messaggi pronti · ${variants.length} approcci`
          : `Messaggio pronto · ${PARTNER_APPROACH_LABELS[variant.approach]}`}
      </h4>
      {variants.length > 1 && (
        <div className={styles.approachTabs} role="group" aria-label="Approccio">
          {variants.map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.approachTab}
              aria-pressed={item.id === variant.id}
              onClick={() => setApproach(item.approach)}
            >
              {PARTNER_APPROACH_LABELS[item.approach]}
              {item.approach === chosen && <span className={styles.chosen}>Scelto</span>}
              {drafts[item.id] && <span className="sr-only"> (modifiche non salvate)</span>}
            </button>
          ))}
        </div>
      )}
      {variants.length === 1 && variant.approach === chosen && (
        <p className={styles.hint}>Approccio scelto.</p>
      )}
      <VariantEditor
        key={variant.id}
        detail={detail}
        variant={variant}
        blocked={blocked}
        draft={drafts[variant.id] ?? null}
        onDraft={(texts) =>
          setDrafts((current) => {
            const next = { ...current };
            if (texts) next[variant.id] = texts;
            else delete next[variant.id];
            return next;
          })
        }
        onConflict={(texts) => setConflicts((current) => ({ ...current, [variant.id]: texts }))}
      />
      {conflict && (
        <div className={styles.yourText}>
          <p className={styles.miniTitle}>Il tuo testo</p>
          <p className={styles.hint}>
            Un collega ha cambiato questo messaggio. Il tuo testo non salvato è qui: copialo e
            riportalo nei campi se serve.
          </p>
          {PARTNER_MESSAGE_FIELDS.filter((field) => conflict[field] !== "").map((field) => (
            <div key={field} className={styles.draftBlock}>
              <div className={styles.draftHead}>
                <span className={styles.miniTitle}>{FIELD_TITLES(variant.channel)[field]}</span>
                <CopyButton text={conflict[field]} label="Copia" />
              </div>
              <p className={styles.preText}>{conflict[field]}</p>
            </div>
          ))}
          <button
            type="button"
            className={`${styles.act} ${styles.actMini}`}
            onClick={() =>
              setConflicts((current) => {
                const next = { ...current };
                delete next[variant.id];
                return next;
              })
            }
          >
            Fatto, chiudi
          </button>
        </div>
      )}
      <p className={styles.rulesLink}>
        <Link href={PARTNER_RULES_PATH} prefetch={false} className="text-button">
          Regole per scrivere
        </Link>
        {variant.lookbookCode === null && (
          <Link href={PARTNER_DATA_PATH} prefetch={false} className="text-button">
            Lookbook da allegare
          </Link>
        )}
      </p>
    </section>
  );
}
