"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  recordPartnerActivity,
  removePartnerContact,
  resolvePartnerDifference,
  restorePartnerMessage,
  savePartner,
  savePartnerContact,
  savePartnerMessage,
  setPartnerDoNotContact,
  setPartnerState,
} from "../../app/(workspace)/partner/actions";
import { importPartnerDeviceFile } from "../../app/(workspace)/partner/dati/actions";
import {
  PARTNER_UNCERTAIN_MESSAGE,
  type PartnerCommand,
  type PartnerCommandKind,
  type PartnerCommandResult,
  type PartnerCommandSuccess,
  type PartnerPayload,
} from "../../lib/partner/commands";
import {
  clearPendingPartner,
  pendingPartnerLines,
  recoverPendingPartner,
  storePendingPartner,
} from "../../lib/partner/pending";
import { PendingAttempt } from "../pending-attempt";
import { usePartnerContext } from "./partner-context";
import styles from "./partner.module.css";

/*
 * Invio dei comandi Partner dalla pagina (spec 02 §5.11). Ogni invio ha il suo operation_id e
 * resta in sessionStorage finché l'esito non è certo: «Verifica lo stesso invio» lo ripete
 * identico e la ricevuta del database restituisce l'esito di allora, senza doppioni.
 */

const ACTIONS: Record<PartnerCommandKind, (command: unknown) => Promise<PartnerCommandResult>> = {
  set_partner_state: setPartnerState,
  save_partner: savePartner,
  record_partner_activity: recordPartnerActivity,
  save_partner_message: savePartnerMessage,
  restore_partner_message: restorePartnerMessage,
  save_partner_contact: savePartnerContact,
  remove_partner_contact: removePartnerContact,
  set_partner_do_not_contact: setPartnerDoNotContact,
  resolve_partner_difference: resolvePartnerDifference,
  import_partner_device_file: importPartnerDeviceFile,
};

export const PARTNER_UNCERTAIN_TITLE = PARTNER_UNCERTAIN_MESSAGE;
const PREVIEW_MESSAGE = "Anteprima locale: salvataggio disattivato.";

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export type PartnerCommandState =
  | { status: "idle" }
  | { status: "success"; message: string; result: PartnerCommandSuccess }
  | { status: "rejected"; code: string; message: string; refresh: boolean }
  | { status: "uncertain"; command: PartnerCommand; scope: string };

/**
 * `run` invia un comando nuovo; `retry` ripete l'ultimo incerto con lo stesso operation_id.
 * `register: false` per i tentativi ripresi dal riquadro in alto, che si mostrano da soli.
 */
export function usePartnerCommand(
  scopeName: string,
  options: { initial?: { command: PartnerCommand; scope: string }; register?: boolean } = {},
) {
  const { preview, userId, setLiveScope } = usePartnerContext();
  const router = useRouter();
  const [state, setState] = useState<PartnerCommandState>(
    options.initial
      ? { status: "uncertain", command: options.initial.command, scope: options.initial.scope }
      : { status: "idle" },
  );
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const register = options.register !== false;
  // Il tentativo in corso o incerto è «vivo» in questo modulo: il riquadro in alto non lo ripete.
  const held = useRef<string | null>(null);
  const hold = useCallback(
    (scope: string | null) => {
      if (!register) return;
      if (held.current && held.current !== scope) setLiveScope(held.current, false);
      held.current = scope;
      if (scope) setLiveScope(scope, true);
    },
    [register, setLiveScope],
  );
  useEffect(
    () => () => {
      if (held.current) setLiveScope(held.current, false);
    },
    [setLiveScope],
  );

  const send = useCallback(
    (
      command: PartnerCommand,
      scope: string,
      onSuccess?: (result: PartnerCommandSuccess) => void,
      before?: () => void,
    ) => {
      if (sending.current) return;
      if (preview || !userId) {
        setState({ status: "rejected", code: "preview", message: PREVIEW_MESSAGE, refresh: false });
        return;
      }
      sending.current = true;
      hold(scope);
      storePendingPartner(sessionStore(), userId, scope, command);
      startTransition(async () => {
        // Valori ottimistici (useOptimistic): restano finché la risposta non arriva.
        before?.();
        let result: PartnerCommandResult;
        try {
          result = await ACTIONS[command.kind]({
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
          setState({ status: "uncertain", command: { ...command, retry: true }, scope });
          return;
        }
        clearPendingPartner(sessionStore(), userId, scope);
        hold(null);
        if (result.status === "success") {
          setState({ status: "success", message: result.message, result });
          onSuccess?.(result);
        } else {
          setState({
            status: "rejected",
            code: result.code,
            message: result.message,
            refresh: result.refresh,
          });
          // L'azione ha già riletto la pagina; il refresh copre anche un errore di rete del primo.
          if (result.refresh) router.refresh();
        }
      });
    },
    [preview, userId, router, hold],
  );

  const run = useCallback(
    (
      kind: PartnerCommandKind,
      payload: PartnerPayload,
      onSuccess?: (result: PartnerCommandSuccess) => void,
      before?: () => void,
    ) => {
      const command: PartnerCommand = {
        kind,
        operationId: crypto.randomUUID(),
        payload,
        retry: false,
      };
      send(command, `${scopeName}:${command.operationId}`, onSuccess, before);
    },
    [scopeName, send],
  );

  const retry = useCallback(
    (onSuccess?: (result: PartnerCommandSuccess) => void) => {
      if (state.status !== "uncertain") return;
      send({ ...state.command, retry: true }, state.scope, onSuccess);
    },
    [state, send],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { run, retry, reset, pending, state, busy: pending || state.status === "uncertain" };
}

/** Esito vicino al controllo: conferma, errore (`role="alert"`) o tentativo da verificare. */
export function CommandFeedback({
  command,
  onRetry,
  compact = false,
}: {
  command: ReturnType<typeof usePartnerCommand>;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { partnersById } = usePartnerContext();
  const { state } = command;
  if (state.status === "idle") return null;
  if (state.status === "success")
    return (
      <p role="status" className={styles.feedbackOk}>
        {state.message}
      </p>
    );
  if (state.status === "rejected")
    return (
      <p role="alert" className={styles.feedbackError}>
        {state.message}
      </p>
    );
  const partnerId = state.command.payload.partner_id;
  const partner = typeof partnerId === "string" ? (partnersById.get(partnerId) ?? null) : null;
  return (
    <div className={compact ? styles.feedbackAttemptCompact : styles.feedbackAttempt}>
      <PendingAttempt
        title={PARTNER_UNCERTAIN_TITLE}
        lines={pendingPartnerLines(state.command, partner)}
        operationId={state.command.operationId}
        pending={command.pending}
        onRetry={() => (onRetry ? onRetry() : command.retry())}
      />
    </div>
  );
}

function RecoveredAttempt({ command, scope }: { command: PartnerCommand; scope: string }) {
  const recovered = usePartnerCommand("ripresa", {
    initial: { command, scope },
    register: false,
  });
  return <CommandFeedback command={recovered} />;
}

/**
 * Tentativi rimasti in sospeso in questa scheda (per esempio dopo un ricaricamento), tranne
 * quelli che un modulo aperto mostra già. Si aggiungono, non spariscono da soli: l'esito della
 * verifica resta visibile.
 */
export function PartnerPendingRecovery({ only }: { only?: readonly PartnerCommandKind[] } = {}) {
  const { userId, liveScopes, preview } = usePartnerContext();
  const [entries, setEntries] = useState<{ scope: string; command: PartnerCommand }[]>([]);
  const [unreadable, setUnreadable] = useState(false);
  useEffect(() => {
    if (preview || !userId) return;
    const read = () => {
      // I moduli tengono «vivi» i loro tentativi; quando li lasciano incerti, arrivano qui.
      const found = recoverPendingPartner(sessionStore(), userId, liveScopes);
      setUnreadable(found.unreadable);
      setEntries((list) => {
        const known = new Set(list.map((item) => item.scope));
        const fresh = found.entries.filter(
          (item) => !known.has(item.scope) && (!only || only.includes(item.command.kind)),
        );
        return fresh.length ? [...list, ...fresh] : list;
      });
    };
    read();
  }, [preview, userId, liveScopes, only]);
  if (!entries.length && !unreadable) return null;
  return (
    <section className={styles.recovery} aria-label="Salvataggi da verificare">
      {unreadable && (
        <p role="alert" className={styles.feedbackError}>
          Un salvataggio rimasto in questa scheda non è leggibile. Controlla il contatto prima di
          ripetere l’operazione.
        </p>
      )}
      {entries.map((entry) => (
        <RecoveredAttempt key={entry.scope} command={entry.command} scope={entry.scope} />
      ))}
    </section>
  );
}
