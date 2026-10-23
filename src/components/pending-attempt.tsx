"use client";

import { useState } from "react";
import { TEAM_TIME_ZONE } from "../lib/team/model";
import styles from "./pending-attempt.module.css";

/*
 * Invio da verificare (docs: 06-revisione-pre-invio R4 e R11). Riepilogo leggibile
 * di un tentativo il cui esito non è confermato: data italiana a Roma, righe già
 * scritte per le persone, codice tecnico nascosto in «Codice per l’assistenza».
 * «Scarta» c'è solo nei casi che non potranno mai riuscire (tentativo illeggibile
 * o in conflitto) e chiede conferma prima di liberare il modulo. In quei casi la verifica
 * non compare: il riquadro dice che il tentativo non si ripete e «Scarta» è l'azione principale.
 */

const attemptTime = new Intl.DateTimeFormat("it-IT", {
  timeZone: TEAM_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** «22 ott 2026, 10:00» (ora di Roma); `null` se la data non è leggibile. Mai la stringa ISO. */
export function attemptDate(value: string): string | null {
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? attemptTime.format(instant) : null;
}

export type PendingAttemptProps = {
  title: string;
  /** Righe già leggibili: canale con la sua etichetta, ordine con il suo nome, quantità. */
  lines: string[];
  /** Istante dichiarato nell'invio (ISO). */
  occurredAt?: string;
  /** Chiave dell'invio: si vede solo dentro «Codice per l’assistenza». */
  operationId: string;
  /** Verifica in corso. */
  pending: boolean;
  /** Il tentativo non potrà riuscire (illeggibile o in conflitto): niente verifica. */
  blocked?: boolean;
  onRetry: () => void;
  onReread?: () => void;
  rereadLabel?: string;
  /** Solo per i tentativi bloccati: libera il modulo, non cancella niente nel gestionale. */
  onDiscard?: () => void;
};

export function PendingAttempt({
  title,
  lines,
  occurredAt,
  operationId,
  pending,
  blocked = false,
  onRetry,
  onReread,
  rereadLabel = "Rileggi",
  onDiscard,
}: PendingAttemptProps) {
  const [confirming, setConfirming] = useState(false);
  const date = occurredAt === undefined ? undefined : attemptDate(occurredAt);
  return (
    <section className={styles.attempt} aria-label={title}>
      <p className={styles.title}>{title}</p>
      <p className={styles.explain}>
        {blocked
          ? "Questo tentativo non può più andare a buon fine, quindi non si ripete."
          : "I dati restano fermi finché l’esito non è chiaro. «Verifica lo stesso invio» ripete lo stesso tentativo: non crea un secondo invio."}
      </p>
      {(date !== undefined || lines.length > 0) && (
        <ul className={styles.lines}>
          {date !== undefined && <li>Data: {date ?? "non leggibile"}</li>}
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        {!blocked && (
          <button
            type="button"
            className="button button-primary"
            disabled={pending}
            onClick={() => onRetry()}
          >
            {pending ? "Verifica in corso…" : "Verifica lo stesso invio"}
          </button>
        )}
        {onReread && (
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={() => onReread()}
          >
            {rereadLabel}
          </button>
        )}
        {onDiscard && !confirming && (
          <button
            type="button"
            className={blocked ? "button button-primary" : "button button-secondary"}
            disabled={pending}
            onClick={() => setConfirming(true)}
          >
            Scarta questo tentativo
          </button>
        )}
      </div>
      {onDiscard && confirming && (
        <div className={styles.confirm} role="group" aria-label="Conferma dello scarto">
          <p>
            Hai controllato che l’operazione non sia già nell’elenco? Scartare non cancella niente
            nel gestionale: libera solo questo modulo.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setConfirming(false);
                onDiscard();
              }}
            >
              Sì, scarta il tentativo
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setConfirming(false)}
            >
              Annulla
            </button>
          </div>
        </div>
      )}
      <details className={styles.code}>
        <summary>Codice per l’assistenza</summary>
        <code>{operationId}</code>
      </details>
    </section>
  );
}
