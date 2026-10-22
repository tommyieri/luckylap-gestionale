"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runSalesCommand } from "@/app/sales/actions";
import { salesAttemptSummary, type SalesAttemptNames } from "@/lib/sales/attempt";
import { PENDING_SALES_EVENT, recoverPendingSales } from "@/lib/sales/pending";
import { PendingAttempt } from "./pending-attempt";
import styles from "./sales-workspace.module.css";

type Recovery = ReturnType<typeof recoverPendingSales>;

/**
 * Invii delle Vendite rimasti da verificare quando il loro modulo non è più nella pagina
 * (docs: 06 R4 e R11). Ogni invio si verifica con lo stesso operation_id; «Scarta» compare
 * solo per i tentativi illeggibili o in conflitto, che non potranno mai riuscire.
 */
export function SalesPendingRecovery({
  userId,
  activeScopes,
  names,
}: {
  userId: string;
  activeScopes: string[];
  /** Nomi di articoli, ordini e righe per il riepilogo. */
  names?: SalesAttemptNames;
}) {
  const [saved, setSaved] = useState<Recovery>({
      entries: [],
      unreadable: false,
      unreadableKeys: [],
    }),
    [message, setMessage] = useState(""),
    [conflicts, setConflicts] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const router = useRouter(),
    scopesKey = activeScopes.join("|");
  useEffect(() => {
    const read = () => {
      try {
        setSaved(recoverPendingSales(sessionStorage, userId, scopesKey.split("|")));
      } catch {
        setSaved({ entries: [], unreadable: true, unreadableKeys: [] });
      }
    };
    read();
    window.addEventListener(PENDING_SALES_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(PENDING_SALES_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, [userId, scopesKey]);
  function discard(keys: string[]) {
    try {
      for (const key of keys) sessionStorage.removeItem(key);
      window.dispatchEvent(new Event(PENDING_SALES_EVENT));
      setConflicts((current) => current.filter((key) => !keys.includes(key)));
      setMessage("");
    } catch {
      setMessage(
        "Non riesco a liberare il tentativo conservato in questa scheda. Chiudi la scheda e riaprila.",
      );
    }
  }
  if (!saved.entries.length && !saved.unreadable && !message) return null;
  return (
    <section className={styles.recovery} aria-label="Recupero degli invii sospesi">
      <strong>Invii da verificare</strong>
      <p>
        Un’operazione può risultare già completata dopo un’interruzione. Questi tentativi restano
        recuperabili anche se il modulo originale non compare più.
      </p>
      {message && <p role="status">{message}</p>}
      {saved.unreadable && (
        <PendingAttempt
          title="Invio da verificare non leggibile"
          lines={[
            saved.unreadableKeys.length
              ? "Un tentativo conservato in questa scheda non si può leggere. Controlla negli ordini se l’operazione c’è già, poi scartalo."
              : "I tentativi conservati in questa scheda non si possono leggere. Verifica gli ordini con Tommi prima di registrare di nuovo la stessa operazione.",
          ]}
          operationId="non leggibile"
          pending={false}
          blocked
          onRetry={() => {}}
          onReread={() => router.refresh()}
          rereadLabel="Rileggi gli ordini"
          onDiscard={saved.unreadableKeys.length ? () => discard(saved.unreadableKeys) : undefined}
        />
      )}
      {saved.entries.map((entry) => {
        const blocked = conflicts.includes(entry.key);
        return (
          <PendingAttempt
            key={entry.key}
            {...salesAttemptSummary(entry.command, names)}
            operationId={entry.command.operationId}
            pending={pending}
            blocked={blocked}
            onRetry={() => {
              if (sending.current) return;
              sending.current = true;
              startTransition(async () => {
                try {
                  const result = await runSalesCommand({ ...entry.command, retry: true });
                  setMessage(result.message);
                  if (
                    result.status === "success" ||
                    (result.status === "rejected" && result.code !== "idempotency_conflict")
                  ) {
                    sessionStorage.removeItem(entry.key);
                    window.dispatchEvent(new Event(PENDING_SALES_EVENT));
                    router.refresh();
                  } else if (result.status === "rejected")
                    setConflicts((current) => [...current, entry.key]);
                } catch {
                  setMessage(
                    "L’esito non è confermato. Il tentativo resta conservato: verifica di nuovo senza creare una nuova operazione.",
                  );
                } finally {
                  sending.current = false;
                }
              });
            }}
            onReread={() => router.refresh()}
            rereadLabel="Rileggi gli ordini"
            onDiscard={blocked ? () => discard([entry.key]) : undefined}
          />
        );
      })}
    </section>
  );
}
