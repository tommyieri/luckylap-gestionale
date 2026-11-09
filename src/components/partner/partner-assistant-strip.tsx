"use client";

import Link from "next/link";
import { Bot, BotOff } from "lucide-react";
import {
  PARTNER_ASSISTANT_FOLLOWUP_DAILY_LIMIT,
  PARTNER_ASSISTANT_INACTIVE,
  PARTNER_ASSISTANT_MODE_LABELS,
  PARTNER_ASSISTANT_SEND_UNREADABLE,
  PARTNER_ASSISTANT_STOP_LABELS,
  PARTNER_ASSISTANT_UNREADABLE,
  type PartnerAssistantInactive,
  type PartnerAssistantSendStatus,
  type PartnerAssistantStatus,
} from "../../lib/partner/assistant";
import { PARTNER_ASSISTANT_PATH } from "../../lib/partner/links";
import { CommandFeedback, usePartnerCommand } from "./partner-command";
import { usePartnerContext } from "./partner-context";
import styles from "./partner.module.css";

/*
 * La striscia in cima a /partner (specifica dell'assistente Partner, «Interfaccia»), sul modello
 * di «Area aperta» (SensitiveAreaSessionBar): invio e preparazione distinti, con «Ferma
 * l'assistente». Spento, in pausa, non configurato o non leggibile: fondo ambra con la parola
 * scritta. In «Prova» e «Invio» (consegna 2a) la riga conta le email di oggi, e il fondo è ambra
 * anche con gli invii fermi, la posta dell'assistente non configurata o lo stato degli invii non
 * leggibile. Mai indirizzi. Mostra i dati del caricamento: dopo «Ferma» la pagina la rilegge la
 * Server Action. Senza le migrazioni dell'assistente («non attivo») la striscia non c'è.
 */

/** Gli avvisi dell'invio, solo in «Prova» e «Invio»: lì il worker manda davvero. */
function sendWarnings(
  status: PartnerAssistantStatus,
  send: PartnerAssistantSendStatus | null,
  mailConfigured: boolean,
  today: string,
): string[] {
  if (status.mode !== "prova" && status.mode !== "invio") return [];
  if (send === null)
    return [PARTNER_ASSISTANT_SEND_UNREADABLE].concat(
      mailConfigured ? [] : ["Posta dell'assistente non configurata: niente invii."],
    );
  return [
    ...(send.stopReason === null
      ? []
      : [
          `Invii fermi: ${PARTNER_ASSISTANT_STOP_LABELS[send.stopReason]} Tommi li riprende dalla pagina dell'assistente.`,
        ]),
    ...(send.dayStoppedOn === today
      ? ["Invii fermi per oggi: errori temporanei del server di posta. Riprendono domani."]
      : []),
    ...(mailConfigured ? [] : ["Posta dell'assistente non configurata: niente invii."]),
  ];
}

export function PartnerAssistantStrip({
  status,
  send,
  mailConfigured,
}: {
  status: PartnerAssistantStatus | PartnerAssistantInactive | null;
  /** Lo stato dell'invio (read_partner_assistant_send); `null` se non è leggibile. */
  send: PartnerAssistantSendStatus | null;
  /** La posta dell'assistente è configurata sul server (mai i suoi valori). */
  mailConfigured: boolean;
}) {
  const { preview, today } = usePartnerContext();
  const command = usePartnerCommand("assistente-striscia");
  if (status === PARTNER_ASSISTANT_INACTIVE) return null;
  const warnings = status === null ? [] : sendWarnings(status, send, mailConfigured, today);
  const attention =
    status === null ||
    status.mode === "spento" ||
    status.pausedReason !== null ||
    !status.configured ||
    warnings.length > 0;
  const Icon = attention ? BotOff : Bot;
  return (
    <section
      className={styles.assistantStrip}
      data-attention={attention || undefined}
      aria-label="Assistente Partner"
    >
      <p className={styles.assistantStripText}>
        <Icon size={16} aria-hidden="true" />
        <span>
          {status === null ? (
            PARTNER_ASSISTANT_UNREADABLE
          ) : (
            <>
              <StatusLine
                status={status}
                send={send}
                mailConfigured={mailConfigured}
                today={today}
              />
              {warnings.length > 0 && `. ${warnings.join(" ")}`}
            </>
          )}
        </span>
      </p>
      <div className={styles.assistantStripActions}>
        <Link href={PARTNER_ASSISTANT_PATH} prefetch={false} className="text-button">
          Apri l'assistente
        </Link>
        {/* Con lo stato non leggibile non c'è una versione da mandare: niente comando. */}
        {status !== null && status.mode !== "spento" && (
          <button
            type="button"
            className="button button-secondary"
            disabled={preview || command.busy}
            onClick={() =>
              command.run("set_partner_assistant_mode", {
                schema_version: 1,
                mode: "spento",
                expected_version: status.version,
              })
            }
          >
            {command.pending ? "Fermo…" : "Ferma l'assistente"}
          </button>
        )}
      </div>
      <div className={styles.assistantStripFeedback}>
        {/* «Ferma l'assistente» sparisce con lo spegnimento: il focus va sull'esito. */}
        <CommandFeedback command={command} compact focus />
      </div>
    </section>
  );
}

/**
 * Gli invii pronti possono proseguire mentre la preparazione è in pausa per credito.
 * Senza una lettura certa della posta non dichiara invii attivi. La spesa è nella pagina Assistente.
 */
function StatusLine({
  status,
  send,
  mailConfigured,
  today,
}: {
  status: PartnerAssistantStatus;
  send: PartnerAssistantSendStatus | null;
  mailConfigured: boolean;
  today: string;
}) {
  const active =
    status.mode === "invio" &&
    status.configured &&
    mailConfigured &&
    send !== null &&
    send.stopReason === null &&
    send.dayStoppedOn !== today;
  const delivery = active
    ? "Email automatiche attive"
    : status.mode === "prova"
      ? "Invii di prova"
      : status.mode === "invio"
        ? "Email automatiche da verificare"
        : `Email automatiche ferme · ${PARTNER_ASSISTANT_MODE_LABELS[status.mode]}`;
  const preparation =
    status.pausedReason === "credito"
      ? "Preparazione in pausa: credito finito"
      : status.pausedReason === "errore_claude"
        ? "Preparazione in pausa: errore di Claude"
        : !status.configured
          ? "Preparazione non ancora configurata"
          : status.mode === "spento"
            ? "Preparazione ferma"
            : `${status.counts.pronta} ${status.counts.pronta === 1 ? "bozza pronta" : "bozze pronte"}`;
  const counter =
    status.mode === "invio" && send
      ? `Prime email oggi: ${send.firstSentToday} su ${send.firstLimitToday} · solleciti: fino a ${PARTNER_ASSISTANT_FOLLOWUP_DAILY_LIMIT} aggiuntivi al giorno, se attivati`
      : status.mode === "prova" && send
        ? `${send.testSentToday} email di prova oggi`
        : null;
  return <>{[delivery, counter, preparation].filter(Boolean).join(" · ")}</>;
}
