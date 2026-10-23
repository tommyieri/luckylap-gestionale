"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPartnerActivity } from "../../app/(workspace)/partner/actions";
import {
  PARTNER_UNCERTAIN_MESSAGE,
  type PartnerCommand,
  type PartnerCommandResult,
} from "../../lib/partner/commands";
import { clearPendingPartner, storePendingPartner } from "../../lib/partner/pending";
import styles from "./today.module.css";

export const TODAY_REPLY_DONE = "Risposta registrata. Sollecito chiuso.";

type ReplyState =
  | { status: "idle" }
  | { status: "done" }
  | { status: "rejected"; message: string }
  | { status: "uncertain" };

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * «Ha risposto» in Oggi (decisione 10, 05-7): registra la risposta con il comando di Partner
 * (`recordPartnerActivity`, tipo `risposta`), che chiude il sollecito. Un esito incerto resta in
 * sessionStorage con lo stesso operation_id: «Verifica lo stesso invio» lo ripete identico, e
 * /partner lo ritrova tra i tentativi da verificare.
 */
export function TodayReplyButton({
  partnerId,
  partnerLabel,
  userId,
}: {
  partnerId: string;
  /** «CO 42», per il nome accessibile del pulsante. */
  partnerLabel: string;
  userId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<ReplyState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const attempt = useRef<{ command: PartnerCommand; scope: string } | null>(null);

  function send(retry: boolean) {
    if (sending.current || state.status === "done") return;
    const previous = retry ? attempt.current : null;
    const command: PartnerCommand = previous
      ? { ...previous.command, retry: true }
      : {
          kind: "record_partner_activity",
          operationId: crypto.randomUUID(),
          payload: { schema_version: 1, partner_id: partnerId, kind: "risposta" },
          retry: false,
        };
    const scope = previous?.scope ?? `oggi-risposta-${partnerId}:${command.operationId}`;
    attempt.current = { command, scope };
    sending.current = true;
    storePendingPartner(sessionStore(), userId, scope, command);
    startTransition(async () => {
      let result: PartnerCommandResult;
      try {
        result = await recordPartnerActivity({
          kind: command.kind,
          operationId: command.operationId,
          payload: command.payload,
          retry: command.retry,
        });
      } catch {
        result = { status: "uncertain", message: PARTNER_UNCERTAIN_MESSAGE };
      }
      sending.current = false;
      if (result.status === "uncertain") {
        setState({ status: "uncertain" });
        return;
      }
      clearPendingPartner(sessionStore(), userId, scope);
      attempt.current = null;
      if (result.status === "success") {
        setState({ status: "done" });
        router.refresh();
      } else setState({ status: "rejected", message: result.message });
    });
  }

  if (state.status === "done")
    return (
      <p role="status" className={styles.replyDone}>
        {TODAY_REPLY_DONE}
      </p>
    );
  return (
    <div className={styles.reply}>
      {state.status === "uncertain" ? (
        <>
          <p role="alert" className={styles.replyProblem}>
            Risposta non confermata.
          </p>
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={() => send(true)}
          >
            {pending ? "Verifico…" : "Verifica lo stesso invio"}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={() => send(false)}
          >
            {pending ? "Registro…" : "Ha risposto"}
            <span className="sr-only"> · {partnerLabel}</span>
          </button>
          {state.status === "rejected" && (
            <p role="alert" className={styles.replyProblem}>
              {state.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
