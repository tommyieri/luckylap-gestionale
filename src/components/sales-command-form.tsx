"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { runSalesCommand } from "@/app/sales/actions";
import {
  money,
  parseSalesCommand,
  record,
  type CommandKind,
  type SalesCommand,
} from "@/lib/sales/model";
import { PENDING_SALES_EVENT, pendingSalesPrefix } from "@/lib/sales/pending";
import styles from "./sales-workspace.module.css";

export function SalesCommandForm({
  userId,
  scope,
  kind,
  enabled,
  build,
  label,
  children,
}: {
  userId: string;
  scope: string;
  kind: CommandKind;
  enabled: boolean;
  build: (form: FormData) => Record<string, unknown>;
  label: string;
  children: ReactNode;
}) {
  const key = `${pendingSalesPrefix(userId)}${scope}`;
  const router = useRouter();
  const [command, setCommand] = useState<SalesCommand | null>(null),
    [notice, setNotice] = useState(""),
    [success, setSuccess] = useState(false),
    [blocked, setBlocked] = useState(false),
    [loaded, setLoaded] = useState(false),
    [epoch, setEpoch] = useState(0);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) {
        const parsed = parseSalesCommand(JSON.parse(saved));
        if (!parsed || parsed.kind !== kind) {
          setBlocked(true);
          setNotice(
            "Il tentativo salvato non è leggibile. Verifica gli ordini con Tommi prima di continuare.",
          );
        } else {
          setCommand(parsed);
          setNotice(
            "C’è un invio senza esito confermato. Verifica lo stesso tentativo prima di iniziare un’altra operazione.",
          );
        }
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
        }
      } catch {
        setNotice(
          "Connessione interrotta: l’esito potrebbe essere già registrato. Riprova lo stesso invio, senza creare una nuova operazione.",
        );
      } finally {
        sending.current = false;
      }
    });
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
      {command && (
        <div className={styles.pending}>
          <strong>Invio da verificare</strong>
          <p>
            I dati sono congelati fino all’esito. Il pulsante ripete lo stesso tentativo e non crea
            un secondo ordine.
          </p>
          <details>
            <summary>Dati conservati nell’invio</summary>
            <p>
              Data: {String(command.payload.occurred_at)}
              {typeof command.payload.channel === "string" && (
                <> · Canale: {command.payload.channel}</>
              )}
              {typeof command.payload.order_id === "string" && (
                <> · Ordine: {command.payload.order_id.slice(0, 8)}</>
              )}
            </p>
            {Array.isArray(command.payload.lines) && (
              <ul>
                {command.payload.lines.map((raw, index) => {
                  const line = record(raw);
                  return (
                    <li key={index}>
                      Riga {index + 1}: {String(line?.quantity)} capi
                      {typeof line?.unit_price_cents === "number" && (
                        <>
                          {" "}
                          · Prezzo {money(line.unit_price_cents)} · Sconto riga{" "}
                          {money(
                            typeof line.discount_cents === "number" ? line.discount_cents : null,
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {typeof command.payload.quantity === "number" && (
              <p>Quantità: {command.payload.quantity}</p>
            )}
            {typeof command.payload.amount_cents === "number" && (
              <p>Incasso dichiarato: {money(command.payload.amount_cents)}</p>
            )}
            {typeof command.payload.reason === "string" && (
              <p>Motivazione: {command.payload.reason}</p>
            )}
          </details>
          <button
            type="button"
            className="button button-primary"
            disabled={pending || blocked}
            onClick={() => send({ ...command, retry: true })}
          >
            {pending ? "Verifica in corso…" : "Verifica lo stesso invio"}
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={() => router.refresh()}
          >
            Rileggi gli ordini
          </button>
          <small>Riferimento: {command.operationId}</small>
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
