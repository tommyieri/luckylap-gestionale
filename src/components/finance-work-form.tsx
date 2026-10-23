"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { runFinanceWork } from "@/app/finance/work/actions";
import {
  parseFinanceWorkCommand,
  type FinanceWorkCommand,
  type FinanceWorkKind,
} from "@/lib/finance-work/model";
import { financeWorkAttemptSummary } from "../lib/finance-work/attempt";
import {
  FINANCE_WORK_EVENT,
  financeWorkPrefix,
  readFinanceWorkPending,
} from "@/lib/finance-work/pending";
import { PendingAttempt } from "./pending-attempt";
import styles from "./finance-work.module.css";

const DISCARD_FAILED =
  "Non riesco a liberare il tentativo conservato in questa scheda. Chiudi la scheda e riaprila.";
import { FINANCE_ACCOUNT_SUGGESTIONS, FINANCE_CATEGORY_GROUPS } from "@/lib/finance/categories";

export function FinanceWorkForm({
  userId,
  scope,
  kind,
  build,
  label,
  disabled = false,
  children,
}: {
  userId: string;
  scope: string;
  kind: FinanceWorkKind;
  build: (form: FormData) => Record<string, unknown>;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const key = `${financeWorkPrefix(userId)}${scope}`,
    router = useRouter(),
    sending = useRef(false);
  const [command, setCommand] = useState<FinanceWorkCommand | null>(null),
    [notice, setNotice] = useState(""),
    [success, setSuccess] = useState(false),
    [blocked, setBlocked] = useState(false),
    [loaded, setLoaded] = useState(false),
    [epoch, setEpoch] = useState(0),
    // Tentativi che non potranno mai riuscire (06 R11): illeggibile o in conflitto.
    [unreadable, setUnreadable] = useState(false),
    [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) {
        let parsed: FinanceWorkCommand | null = null;
        try {
          parsed = parseFinanceWorkCommand(JSON.parse(saved));
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
        "La conservazione dei tentativi non è disponibile in questa scheda. Riattivala prima di registrare voci.",
      );
    }
    setLoaded(true);
  }, [key, kind]);
  function send(next: FinanceWorkCommand) {
    if (sending.current) return;
    sending.current = true;
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event(FINANCE_WORK_EVENT));
    } catch {
      sending.current = false;
      setNotice("Il tentativo non può essere conservato. Nessun nuovo invio eseguito.");
      return;
    }
    setCommand(next);
    setSuccess(false);
    startTransition(async () => {
      try {
        const result = await runFinanceWork(next);
        setNotice(result.message);
        if (result.status === "success") {
          setSuccess(true);
          try {
            sessionStorage.removeItem(key);
            window.dispatchEvent(new Event(FINANCE_WORK_EVENT));
            setCommand(null);
            setEpoch((value) => value + 1);
          } catch {
            setNotice(
              `${result.message} Verifica di nuovo questo tentativo prima di crearne un altro.`,
            );
          }
          router.refresh();
        } else if (result.status === "rejected" && result.code !== "idempotency_conflict") {
          try {
            sessionStorage.removeItem(key);
            window.dispatchEvent(new Event(FINANCE_WORK_EVENT));
            setCommand(null);
          } catch {
            /* Frozen payload remains available. */
          }
        } else if (result.status === "rejected") setConflict(true);
      } catch {
        setNotice(
          "Connessione interrotta: la voce potrebbe essere già registrata. Riprova lo stesso invio senza crearne uno nuovo.",
        );
      } finally {
        sending.current = false;
      }
    });
  }
  /** Libera il modulo da un tentativo che non potrà riuscire. Non cancella niente nel registro. */
  function discard() {
    try {
      sessionStorage.removeItem(key);
      window.dispatchEvent(new Event(FINANCE_WORK_EVENT));
    } catch {
      setNotice(DISCARD_FAILED);
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
    if (!loaded || pending || sending.current || blocked || command || disabled) return;
    try {
      const next = parseFinanceWorkCommand({
        operationId: crypto.randomUUID(),
        kind,
        payload: build(new FormData(event.currentTarget)),
      });
      if (!next) {
        setNotice("Controlla i dati e la conferma di verifica delle altre fonti.");
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
            title="Invio Finance non leggibile"
            lines={[
              "Il tentativo conservato in questa scheda non si può leggere. Controlla nel registro se la voce c’è già, poi scartalo.",
            ]}
            operationId="non leggibile"
            pending={false}
            blocked
            onRetry={() => {}}
            onReread={() => router.refresh()}
            rereadLabel="Rileggi il registro"
            onDiscard={discard}
          />
        </div>
      )}
      {command && (
        <div className={styles.pending}>
          <PendingAttempt
            {...financeWorkAttemptSummary(command)}
            operationId={command.operationId}
            pending={pending}
            blocked={conflict}
            onRetry={() => send({ ...command, retry: true })}
            onReread={() => router.refresh()}
            rereadLabel="Rileggi il registro"
            onDiscard={conflict ? discard : undefined}
          />
        </div>
      )}
      <fieldset
        key={epoch}
        disabled={!loaded || pending || blocked || command !== null || disabled}
      >
        {kind === "record_finance_entry" && (
          <p className={styles.help}>
            Gli incassi del conto vendita si registrano dal resoconto del negozio: non inserirli
            anche qui.
          </p>
        )}
        {children}
        <button type="submit" className="button button-primary">
          {pending ? "Registrazione in corso…" : label}
        </button>
      </fieldset>
    </form>
  );
}

export function FinanceWorkRecovery({
  userId,
  activeScopes,
}: {
  userId: string;
  activeScopes: string[];
}) {
  const [saved, setSaved] = useState<ReturnType<typeof readFinanceWorkPending>>({
      entries: [],
      unreadable: false,
      unreadableKeys: [],
    }),
    [message, setMessage] = useState(""),
    [conflicts, setConflicts] = useState<string[]>([]);
  const [pending, startTransition] = useTransition(),
    router = useRouter(),
    sending = useRef(false),
    scopesKey = activeScopes.join("|");
  useEffect(() => {
    const read = () => {
      try {
        setSaved(readFinanceWorkPending(sessionStorage, userId, scopesKey.split("|")));
      } catch {
        setSaved({ entries: [], unreadable: true, unreadableKeys: [] });
      }
    };
    read();
    window.addEventListener(FINANCE_WORK_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(FINANCE_WORK_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, [userId, scopesKey]);
  function discard(keys: string[]) {
    try {
      for (const entryKey of keys) sessionStorage.removeItem(entryKey);
      window.dispatchEvent(new Event(FINANCE_WORK_EVENT));
      setConflicts((current) => current.filter((entryKey) => !keys.includes(entryKey)));
      setMessage("");
    } catch {
      setMessage(DISCARD_FAILED);
    }
  }
  if (!saved.entries.length && !saved.unreadable && !message) return null;
  return (
    <section className={styles.recovery} aria-label="Invii Finance da verificare">
      <strong>Invii Finance da verificare</strong>
      <p>
        Questi tentativi restano recuperabili anche quando la voce è stata eliminata o non compare
        nella pagina corrente.
      </p>
      {message && <p role="status">{message}</p>}
      {saved.unreadable && (
        <PendingAttempt
          title="Invio Finance non leggibile"
          lines={[
            saved.unreadableKeys.length
              ? "Un tentativo conservato in questa scheda non si può leggere. Controlla nel registro se la voce c’è già, poi scartalo."
              : "I tentativi conservati in questa scheda non si possono leggere. Verifica il registro con Tommi prima di reinserire la stessa voce.",
          ]}
          operationId="non leggibile"
          pending={false}
          blocked
          onRetry={() => {}}
          onReread={() => router.refresh()}
          rereadLabel="Rileggi il registro"
          onDiscard={saved.unreadableKeys.length ? () => discard(saved.unreadableKeys) : undefined}
        />
      )}
      {saved.entries.map((entry) => {
        const blocked = conflicts.includes(entry.key);
        return (
          <PendingAttempt
            key={entry.key}
            {...financeWorkAttemptSummary(entry.command)}
            operationId={entry.command.operationId}
            pending={pending}
            blocked={blocked}
            onRetry={() => {
              if (sending.current) return;
              sending.current = true;
              startTransition(async () => {
                try {
                  const result = await runFinanceWork({ ...entry.command, retry: true });
                  setMessage(result.message);
                  if (
                    result.status === "success" ||
                    (result.status === "rejected" && result.code !== "idempotency_conflict")
                  ) {
                    sessionStorage.removeItem(entry.key);
                    window.dispatchEvent(new Event(FINANCE_WORK_EVENT));
                    router.refresh();
                  } else if (result.status === "rejected")
                    setConflicts((current) => [...current, entry.key]);
                } catch {
                  setMessage(
                    "Esito non confermato. Il tentativo resta conservato: verifica lo stesso invio.",
                  );
                } finally {
                  sending.current = false;
                }
              });
            }}
            onReread={() => router.refresh()}
            rereadLabel="Rileggi il registro"
            onDiscard={blocked ? () => discard([entry.key]) : undefined}
          />
        );
      })}
    </section>
  );
}

/** Suggestions preserve the existing optional account/category payload contract. */
export function FinanceAccountCategoryFields({ accounts = [] }: { accounts?: string[] }) {
  const listId = useId(),
    [category, setCategory] = useState("");
  const names = [...new Set([...FINANCE_ACCOUNT_SUGGESTIONS, ...accounts.filter(Boolean)])];
  return (
    <>
      <label>
        Conto / cassa · facoltativo
        <input
          name="account"
          maxLength={120}
          list={listId}
          placeholder="Scegli o scrivi un conto"
        />
        <datalist id={listId}>
          {names.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      <label>
        Categoria · facoltativa
        <select
          name={category === "__custom" ? undefined : "category"}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">Da classificare</option>
          {FINANCE_CATEGORY_GROUPS.map((group) => (
            <optgroup key={group.id} label={group.label}>
              {group.categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </optgroup>
          ))}
          <option value="__custom">Altra categoria…</option>
        </select>
      </label>
      {category === "__custom" && (
        <label>
          Nome della categoria
          <input name="category" maxLength={120} required placeholder="Categoria usata dal team" />
        </label>
      )}
    </>
  );
}
