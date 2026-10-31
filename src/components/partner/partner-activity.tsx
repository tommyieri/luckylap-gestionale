"use client";

import { useState, type FormEvent } from "react";
import { partnerActivityPayload, type PartnerActivityField } from "../../lib/partner/commands";
import { addDays } from "../../lib/partner/dates";
import {
  PARTNER_ACTIVITY_CHANNELS,
  partnerActivityLine,
  recentSentActivity,
  recentSentQuestion,
  type PartnerActivityChannel,
  type PartnerChannel,
  type PartnerDetail,
  type PartnerMessageKind,
  type PartnerRecordableKind,
} from "../../lib/partner/model";
import { CommandFeedback, usePartnerCommand } from "./partner-command";
import { usePartnerContext } from "./partner-context";
import styles from "./partner.module.css";

const LOG_PAGE = 20;
/**
 * Un pulsante del Registro. I due invii sono lo stesso `inviato` con `message_kind` diverso,
 * come facevano i pulsanti del vecchio blocco «Messaggi pronti».
 */
type LogButton = {
  id: string;
  kind: PartnerRecordableKind;
  messageKind?: PartnerMessageKind;
  label: string;
};
const BUTTONS: LogButton[] = [
  { id: "inviato", kind: "inviato", messageKind: "primo", label: "Segna inviato" },
  {
    id: "sollecito",
    kind: "inviato",
    messageKind: "sollecito",
    label: "Segna sollecito inviato",
  },
  { id: "risposta", kind: "risposta", label: "Ha risposto" },
  { id: "chiamata", kind: "chiamata", label: "Chiamata" },
  { id: "incontro", kind: "incontro", label: "Incontro" },
  { id: "nota", kind: "nota", label: "Nota" },
];
/** Con il contatto in «Non contattare» il database rifiuta invii, chiamate e incontri. */
const BLOCKED_KINDS: PartnerRecordableKind[] = ["inviato", "chiamata", "incontro"];

const CHANNEL_OPTION_LABELS: Record<PartnerActivityChannel, string> = {
  email: "Email",
  form: "Modulo del sito",
  dm: "Instagram",
  phone: "Telefono",
  whatsapp: "WhatsApp",
  visita: "Di persona",
};
const FROM_PREFERRED: Record<PartnerChannel, PartnerActivityChannel | ""> = {
  email: "email",
  form: "form",
  ig: "dm",
  phone: "phone",
  web: "",
};

function defaultChannel(kind: PartnerRecordableKind, preferred: PartnerChannel) {
  if (kind === "chiamata") return "phone";
  if (kind === "incontro") return "visita";
  if (kind === "nota") return "";
  if (kind === "risposta")
    return preferred === "form" || preferred === "web" ? "email" : FROM_PREFERRED[preferred];
  return FROM_PREFERRED[preferred];
}

function ActivityForm({
  detail,
  button,
  onClose,
}: {
  detail: PartnerDetail;
  button: LogButton;
  onClose: () => void;
}) {
  const { kind, messageKind } = button;
  const { preview, today, members } = usePartnerContext();
  const command = usePartnerCommand(`registro-${detail.partner.id}-${button.id}`);
  const [day, setDay] = useState(today);
  const [channel, setChannel] = useState<PartnerActivityChannel | "">(
    defaultChannel(kind, detail.partner.preferredChannel),
  );
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Partial<Record<PartnerActivityField, string>>>({});
  const [question, setQuestion] = useState<string | null>(null);

  function send(confirmed: boolean) {
    if (preview || command.busy) return;
    const recent =
      kind === "inviato" ? recentSentActivity(detail.activities, new Date(), messageKind) : null;
    if (recent && !confirmed) {
      setQuestion(recentSentQuestion(recent, members));
      return;
    }
    setQuestion(null);
    const result = partnerActivityPayload(
      {
        partnerId: detail.partner.id,
        kind,
        occurredOn: day,
        channel,
        approach: kind === "inviato" ? detail.partner.chosenApproach : null,
        ...(kind === "inviato" ? { messageKind } : {}),
        body,
      },
      today,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    command.run("record_partner_activity", result.payload, () => {
      setBody("");
      setDay(today);
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(false);
  }

  const done = command.state.status === "success";
  return (
    <form className={styles.activityForm} onSubmit={submit} noValidate>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Giorno</span>
          <input
            type="date"
            value={day}
            max={today}
            min={addDays(today, -365)}
            aria-invalid={errors.occurredOn ? true : undefined}
            onChange={(event) => setDay(event.target.value)}
          />
          {errors.occurredOn && <span className={styles.fieldError}>{errors.occurredOn}</span>}
        </label>
        <label className={styles.field}>
          <span>Canale</span>
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value as PartnerActivityChannel | "")}
          >
            <option value="">Non indicato</option>
            {PARTNER_ACTIVITY_CHANNELS.map((item) => (
              <option key={item} value={item}>
                {CHANNEL_OPTION_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>{kind === "nota" ? "Nota" : "Note (facoltative)"}</span>
          <textarea
            value={body}
            rows={3}
            maxLength={4000}
            aria-invalid={errors.body ? true : undefined}
            onChange={(event) => setBody(event.target.value)}
          />
          {errors.body && <span className={styles.fieldError}>{errors.body}</span>}
        </label>
      </div>
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
      <div className={styles.formActions}>
        <button type="submit" className="button button-primary" disabled={preview || command.busy}>
          {command.pending ? "Salvo…" : "Registra"}
        </button>
        <button type="button" className={styles.act} onClick={onClose}>
          {done ? "Chiudi" : "Annulla"}
        </button>
      </div>
      <CommandFeedback command={command} />
    </form>
  );
}

/** Registro (spec 02 §5.7): pulsanti, piccolo modulo nella pagina, elenco dal più recente. */
export function PartnerActivityLog({
  detail,
  blocked,
}: {
  detail: PartnerDetail;
  blocked: boolean;
}) {
  const { members } = usePartnerContext();
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const chosen = BUTTONS.find((button) => button.id === open) ?? null;
  const shown = all ? detail.activities : detail.activities.slice(0, LOG_PAGE);
  return (
    <section className={styles.detailBlock} aria-labelledby={`registro-${detail.partner.co}`}>
      <h4 id={`registro-${detail.partner.co}`}>Registro</h4>
      <div className={styles.inlineActions} role="group" aria-label="Registra">
        {BUTTONS.map((button) => (
          <button
            key={button.id}
            type="button"
            className={styles.act}
            aria-pressed={open === button.id}
            disabled={blocked && BLOCKED_KINDS.includes(button.kind)}
            onClick={() => setOpen((current) => (current === button.id ? null : button.id))}
          >
            {button.label}
          </button>
        ))}
      </div>
      {blocked && (
        <p className={styles.hint}>
          Contatto nella lista «Non contattare»: si registrano solo risposte e note.
        </p>
      )}
      {chosen && (
        <ActivityForm
          key={chosen.id}
          detail={detail}
          button={chosen}
          onClose={() => setOpen(null)}
        />
      )}
      {detail.activities.length === 0 ? (
        <p className={styles.hint}>Nessun contatto registrato.</p>
      ) : (
        <ol className={styles.log}>
          {shown.map((activity) => (
            <li key={activity.id}>
              <span>{partnerActivityLine(activity, members)}</span>
              {activity.body && <span className={styles.logBody}>{activity.body}</span>}
            </li>
          ))}
        </ol>
      )}
      {!all && detail.activities.length > LOG_PAGE && (
        <button type="button" className="text-button" onClick={() => setAll(true)}>
          Mostra tutte ({detail.activities.length})
        </button>
      )}
      {all && detail.activityCount > detail.activities.length && (
        <p className={styles.hint}>
          Qui ci sono le ultime {detail.activities.length} attività su {detail.activityCount}.
        </p>
      )}
    </section>
  );
}
