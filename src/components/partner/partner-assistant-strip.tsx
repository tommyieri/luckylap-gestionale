"use client";

import Link from "next/link";
import { Bot, BotOff } from "lucide-react";
import {
  PARTNER_ASSISTANT_INACTIVE,
  PARTNER_ASSISTANT_MODE_LABELS,
  PARTNER_ASSISTANT_UNREADABLE,
  formatPartnerAssistantUsd,
  type PartnerAssistantInactive,
  type PartnerAssistantPausedReason,
  type PartnerAssistantStatus,
} from "../../lib/partner/assistant";
import { PARTNER_ASSISTANT_PATH } from "../../lib/partner/links";
import { CommandFeedback, usePartnerCommand } from "./partner-command";
import { usePartnerContext } from "./partner-context";
import styles from "./partner.module.css";

/*
 * La striscia in cima a /partner (specifica dell'assistente Partner, «Interfaccia»), sul modello
 * di «Area aperta» (SensitiveAreaSessionBar): modalità, bozze pronte e spesa, con «Ferma
 * l'assistente». Spento, in pausa, non configurato o non leggibile: fondo ambra con la parola
 * scritta. Mostra i dati del caricamento: dopo «Ferma» la pagina la rilegge la Server Action.
 * Senza le migrazioni dell'assistente («non attivo») la striscia non c'è.
 */

const PAUSED: Record<PartnerAssistantPausedReason, string> = {
  credito: "in pausa per credito finito",
  errore_claude: "in pausa per un errore di Claude",
};

export function PartnerAssistantStrip({
  status,
}: {
  status: PartnerAssistantStatus | PartnerAssistantInactive | null;
}) {
  const { preview } = usePartnerContext();
  const command = usePartnerCommand("assistente-striscia");
  if (status === PARTNER_ASSISTANT_INACTIVE) return null;
  const attention =
    status === null ||
    status.mode === "spento" ||
    status.pausedReason !== null ||
    !status.configured;
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
          {status === null ? PARTNER_ASSISTANT_UNREADABLE : <StatusLine status={status} />}
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

/** «Assistente: prepara · 12 bozze pronte · 21,40 USD spesi», con la pausa se c'è. */
function StatusLine({ status }: { status: PartnerAssistantStatus }) {
  const ready = status.counts.pronta;
  const parts = [
    `Assistente: ${PARTNER_ASSISTANT_MODE_LABELS[status.mode].toLowerCase()}`,
    ...(status.configured ? [] : ["non ancora configurato"]),
    ...(status.pausedReason === null ? [] : [PAUSED[status.pausedReason]]),
  ];
  return (
    <>
      {parts.join(" · ")} · <span className="num">{ready}</span>{" "}
      {ready === 1 ? "bozza pronta" : "bozze pronte"} ·{" "}
      <span className="num">{formatPartnerAssistantUsd(status.spentUsd)}</span> spesi
    </>
  );
}
