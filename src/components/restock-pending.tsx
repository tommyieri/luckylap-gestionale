"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { runRestockCommand } from "../app/(workspace)/stock/riassortimento/actions";
import {
  PREVIEW_NOTICE,
  restockAttemptSummary,
  restockPending,
  restockPendingKey,
  type RestockCommand,
  type RestockResult,
} from "../lib/restock/model";
import { PendingAttempt } from "./pending-attempt";
import styles from "./restock.module.css";

/*
 * Invii del riassortimento (docs/riassortimento.md, «Invii incerti»), come il conto vendita:
 * ogni comando si congela in sessionStorage prima dell'invio, con un blocco sincrono contro il
 * doppio clic. Un esito incerto resta in cima alla pagina con «Verifica lo stesso invio» e
 * blocca ogni altra scrittura finché lo stesso UUID non lo chiarisce.
 */

const STORAGE_MESSAGE = "Il tentativo non può essere conservato. Nessun invio eseguito.";
const LOST_MESSAGE =
  "Connessione interrotta: l’operazione potrebbe essere già registrata. Verifica lo stesso invio senza crearne un altro.";
export const FLASH_KEY = "luckylap.restock.flash";

export type SendOutcome = { result: RestockResult; kept: boolean };
/** Invio con blocco sincrono: un secondo invio prima della risposta non parte (`null`). */
export function createRestockSender(
  key: string,
  storage: () => Pick<Storage, "setItem" | "removeItem">,
  run: (command: RestockCommand) => Promise<RestockResult>,
) {
  let busy = false;
  return {
    isBusy: () => busy,
    async send(command: RestockCommand): Promise<SendOutcome | null> {
      if (busy) return null;
      busy = true;
      try {
        const frozen = {
          operationId: command.operationId,
          kind: command.kind,
          payload: command.payload,
        };
        try {
          storage().setItem(key, JSON.stringify(frozen));
        } catch {
          return {
            result: { status: "rejected", code: "storage", message: STORAGE_MESSAGE },
            kept: false,
          };
        }
        let result: RestockResult;
        try {
          result = await run(command);
        } catch {
          result = { status: "uncertain", message: LOST_MESSAGE };
        }
        const settled =
          result.status === "success" ||
          (result.status === "rejected" && result.code !== "idempotency_conflict");
        if (!settled) return { result, kept: true };
        try {
          storage().removeItem(key);
          return { result, kept: false };
        } catch {
          return { result, kept: true };
        }
      } finally {
        busy = false;
      }
    },
  };
}

type Stored =
  { kind: "command"; command: RestockCommand; blocked: boolean } | { kind: "unreadable" };
type Notice = { tone: "success" | "error"; text: string };
type Commands = {
  ready: boolean;
  /** Nessuna scrittura: anteprima, tentativo da verificare, invio o rilettura in corso. */
  locked: boolean;
  /** Si può aprire un modulo (anche in anteprima). */
  canOpen: boolean;
  sending: boolean;
  preview: boolean;
  send: (command: RestockCommand) => Promise<RestockResult | null>;
  flash: (text: string) => void;
  announce: (text: string) => void;
};
const CommandsContext = createContext<Commands>({
  ready: false,
  locked: true,
  canOpen: false,
  sending: false,
  preview: false,
  send: async () => null,
  flash: () => {},
  announce: () => {},
});
const SlotContext = createContext<ReactNode>(null);
export const useRestockCommands = () => useContext(CommandsContext);

export function RestockCommandsProvider({
  userId,
  titles,
  preview = false,
  children,
}: {
  userId: string;
  /** Titoli dei riordini per il riepilogo del tentativo. */
  titles: Record<string, string>;
  preview?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const key = restockPendingKey(userId);
  const sender = useRef(createRestockSender(key, () => sessionStorage, runRestockCommand));
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState<Stored | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let attempt: Stored | null = null;
    try {
      const command = restockPending(sessionStorage, userId);
      if (command) attempt = { kind: "command", command, blocked: false };
      const flashed = sessionStorage.getItem(FLASH_KEY);
      if (flashed) {
        sessionStorage.removeItem(FLASH_KEY);
        setNotice({ tone: "success", text: flashed.slice(0, 300) });
      }
    } catch {
      attempt = { kind: "unreadable" };
    }
    setStored(attempt);
    setReady(true);
  }, [userId]);

  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);
  const canOpen = ready && stored === null && !sending && !verifying && !refreshing;
  const locked = preview || !canOpen;

  const send = useCallback(
    async (command: RestockCommand) => {
      if (locked || sender.current.isBusy()) return null;
      setSending(true);
      setNotice(null);
      try {
        const outcome = await sender.current.send(command);
        if (!outcome) return null;
        if (outcome.kept)
          setStored({
            kind: "command",
            command,
            blocked:
              outcome.result.status === "rejected" &&
              outcome.result.code === "idempotency_conflict",
          });
        if (outcome.result.status === "success") refresh();
        return outcome.result;
      } finally {
        setSending(false);
      }
    },
    [locked, refresh],
  );
  const announce = useCallback((text: string) => setNotice({ tone: "success", text }), []);
  const flash = useCallback((text: string) => {
    try {
      sessionStorage.setItem(FLASH_KEY, text);
    } catch {
      /* Il messaggio è solo una cortesia: i dati sono già salvati. */
    }
  }, []);

  async function verify() {
    if (!stored || stored.kind === "unreadable" || stored.blocked) return;
    setVerifying(true);
    setNotice(null);
    try {
      const outcome = await sender.current.send({ ...stored.command, retry: true });
      if (!outcome) return;
      setNotice({
        tone: outcome.result.status === "success" ? "success" : "error",
        text: outcome.result.message,
      });
      if (outcome.kept)
        setStored({
          ...stored,
          blocked:
            outcome.result.status === "rejected" && outcome.result.code === "idempotency_conflict",
        });
      else setStored(null);
      if (outcome.result.status === "success") refresh();
    } finally {
      setVerifying(false);
    }
  }
  function discard() {
    try {
      sessionStorage.removeItem(key);
      setStored(null);
      setNotice(null);
    } catch {
      setNotice({
        tone: "error",
        text: "Non riesco a liberare il tentativo conservato in questo browser. Chiudi la scheda e riaprila.",
      });
    }
  }

  let attempt: ReactNode = null;
  if (stored?.kind === "unreadable")
    attempt = (
      <PendingAttempt
        title="Invio da verificare non leggibile"
        lines={[
          "Il tentativo conservato in questo browser non si può leggere. Controlla nella pagina se l’operazione c’è già, poi scartalo.",
        ]}
        operationId="non leggibile"
        pending={false}
        blocked
        onRetry={() => {}}
        onReread={refresh}
        onDiscard={discard}
      />
    );
  else if (stored) {
    const summary = restockAttemptSummary(stored.command, (id) => titles[id] ?? null);
    attempt = (
      <PendingAttempt
        title={summary.title}
        lines={summary.lines}
        operationId={stored.command.operationId}
        pending={verifying}
        blocked={stored.blocked}
        onRetry={verify}
        onReread={refresh}
        onDiscard={stored.blocked ? discard : undefined}
      />
    );
  }
  const slot =
    attempt || notice || preview ? (
      <div className={styles.pendingSlot}>
        {preview && (
          <p className={styles.previewNotice} role="status">
            {PREVIEW_NOTICE}
          </p>
        )}
        {attempt}
        {notice && (
          <p
            className={notice.tone === "success" ? styles.success : styles.error}
            role={notice.tone === "success" ? "status" : "alert"}
          >
            {notice.text}
          </p>
        )}
      </div>
    ) : null;
  const value = useMemo(
    () => ({ ready, locked, canOpen, sending, preview, send, flash, announce }),
    [ready, locked, canOpen, sending, preview, send, flash, announce],
  );
  return (
    <CommandsContext.Provider value={value}>
      <SlotContext.Provider value={slot}>{children}</SlotContext.Provider>
    </CommandsContext.Provider>
  );
}

/** Dove la pagina mostra anteprima, tentativo da verificare ed esito. */
export function RestockPendingSlot() {
  return <>{useContext(SlotContext)}</>;
}

/** Esito di un modulo, vicino al suo pulsante. */
export function FormMessage({ message }: { message: Notice | null }) {
  if (!message) return null;
  return (
    <p
      className={message.tone === "success" ? styles.success : styles.error}
      role={message.tone === "success" ? "status" : "alert"}
    >
      {message.text}
    </p>
  );
}
export type { Notice as FormNotice };
