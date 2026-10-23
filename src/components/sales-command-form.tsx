"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { runSalesCommand } from "@/app/sales/actions";
import { parseSalesCommand, type CommandKind, type SalesCommand } from "@/lib/sales/model";
import { salesAttemptSummary, type SalesAttemptNames } from "@/lib/sales/attempt";
import { PENDING_SALES_EVENT, pendingSalesPrefix } from "@/lib/sales/pending";
import { PendingAttempt } from "./pending-attempt";
import styles from "./sales-workspace.module.css";

const UNREADABLE_LINE =
  "Il tentativo conservato in questa scheda non si può leggere. Controlla negli ordini se l’operazione c’è già, poi scartalo.";

export function SalesCommandForm({
  userId,
  scope,
  kind,
  enabled,
  build,
  label,
  names,
  children,
}: {
  userId: string;
  scope: string;
  kind: CommandKind;
  enabled: boolean;
  build: (form: FormData) => Record<string, unknown>;
  label: string;
  /** Nomi di articoli, ordini e righe per il riepilogo dell’invio da verificare. */
  names?: SalesAttemptNames;
  children: ReactNode;
}) {
  const key = `${pendingSalesPrefix(userId)}${scope}`;
  const router = useRouter();
  const [command, setCommand] = useState<SalesCommand | null>(null),
    [notice, setNotice] = useState(""),
    [success, setSuccess] = useState(false),
    [blocked, setBlocked] = useState(false),
    [loaded, setLoaded] = useState(false),
    [epoch, setEpoch] = useState(0),
    // Tentativi che non potranno mai riuscire (06 R11): illeggibile o in conflitto.
    [unreadable, setUnreadable] = useState(false),
    [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) {
        let parsed: SalesCommand | null = null;
        try {
          parsed = parseSalesCommand(JSON.parse(saved));
        } catch {
          parsed = null;
        }
        if (!parsed || parsed.kind !== kind) {
          setBlocked(true);
          setUnreadable(true);
        } else setCommand(parsed);
      }
    } catch {
      setBlocked(true);
      setNotice(
        "La conservazione dei tentativi in questa scheda non è disponibile. Riattivala prima di registrare operazioni.",
      );
    }
    setLoaded(true);
  }, [key, kind]);
  function send(next: SalesCommand) {
    if (sending.current) return;
    sending.current = true;
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event(PENDING_SALES_EVENT));
    } catch {
      sending.current = false;
      setNotice("Il tentativo non può essere conservato. Nessun nuovo invio è stato eseguito.");
      return;
    }
    setCommand(next);
    setSuccess(false);
    startTransition(async () => {
      try {
        const result = await runSalesCommand(next);
        setNotice(result.message);
        if (result.status === "success") {
          setSuccess(true);
          try {
            sessionStorage.removeItem(key);
            window.dispatchEvent(new Event(PENDING_SALES_EVENT));
            setCommand(null);
            setEpoch((value) => value + 1);
          } catch {
            setNotice(
              `${result.message} Il tentativo resta conservato: verifica di nuovo prima di iniziarne un altro.`,
            );
          }
          router.refresh();
        } else if (result.status === "rejected" && result.code !== "idempotency_conflict") {
          try {
            sessionStorage.removeItem(key);
            window.dispatchEvent(new Event(PENDING_SALES_EVENT));
            setCommand(null);
          } catch {
            /* Keep the frozen attempt if storage cannot be changed. */
          }
        } else if (result.status === "rejected") setConflict(true);
      } catch {
        setNotice(
          "Connessione interrotta: l’esito potrebbe essere già registrato. Riprova lo stesso invio, senza creare una nuova operazione.",
        );
      } finally {
        sending.current = false;
      }
    });
  }
  /** Libera il modulo da un tentativo che non potrà riuscire. Non cancella niente negli ordini. */
  function discard() {
    try {
      sessionStorage.removeItem(key);
      window.dispatchEvent(new Event(PENDING_SALES_EVENT));
    } catch {
      setNotice(
        "Non riesco a liberare il tentativo conservato in questa scheda. Chiudi la scheda e riaprila.",
      );
      return;
    }
    setCommand(null);
    setConflict(false);
    setUnreadable(false);
    setBlocked(false);
    setNotice("");
    setEpoch((value) => value + 1);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded || pending || blocked || command || !enabled) return;
    try {
      const next = parseSalesCommand({
        operationId: crypto.randomUUID(),
        kind,
        payload: build(new FormData(event.currentTarget)),
      });
      if (!next) {
        setNotice("Controlla quantità, date, importi e motivazione prima di continuare.");
        return;
      }
      send(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Controlla i dati del modulo.");
    }
  }
  return (
    <form onSubmit={submit} className={styles.form}>
      {notice && (
        <p
          role={success ? "status" : "alert"}
          className={success ? styles.success : styles.feedback}
        >
          {notice}
        </p>
      )}
      {unreadable && (
        <div className={styles.pending}>
          <PendingAttempt
            title="Invio da verificare non leggibile"
            lines={[UNREADABLE_LINE]}
            operationId="non leggibile"
            pending={false}
            blocked
            onRetry={() => {}}
            onReread={() => router.refresh()}
            rereadLabel="Rileggi gli ordini"
            onDiscard={discard}
          />
        </div>
      )}
      {command && (
        <div className={styles.pending}>
          <PendingAttempt
            {...salesAttemptSummary(command, names)}
            operationId={command.operationId}
            pending={pending}
            blocked={conflict}
            onRetry={() => send({ ...command, retry: true })}
            onReread={() => router.refresh()}
            rereadLabel="Rileggi gli ordini"
            onDiscard={conflict ? discard : undefined}
          />
        </div>
      )}
      <fieldset key={epoch} disabled={!loaded || pending || blocked || command !== null}>
        {children}
        <button type="submit" className="button button-primary" disabled={!enabled}>
          {pending ? "Registrazione in corso…" : label}
        </button>
      </fieldset>
    </form>
  );
}
