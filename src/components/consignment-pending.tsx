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
import { runConsignmentCommand, runShopCommand } from "../app/consignment/actions";
import {
  consignmentMoney,
  consignmentPending,
  consignmentPendingKey,
  type ConsignmentCommand,
  type ConsignmentResult,
} from "../lib/consignment/model";
import {
  shopAttemptSummary,
  shopPending,
  shopPendingKey,
  tshirtsLabel,
  type AttemptSummary,
  type ShopCommand,
  type ShopResult,
} from "../lib/consignment/shop-model";
import { PendingAttempt } from "./pending-attempt";
import styles from "./consignment-shop.module.css";

/*
 * Invii del conto vendita (docs/consignment.md, «Invii incerti»). Ogni comando si
 * congela in sessionStorage prima dell'invio, con un blocco sincrono contro il
 * doppio clic. Un esito incerto resta in cima alla pagina e blocca ogni altra
 * scrittura finché «Verifica lo stesso invio» non lo chiarisce con lo stesso UUID.
 * La chiave vecchia del conto vendita si verifica ancora con `runConsignmentCommand`.
 */

const STORAGE_MESSAGE = "Il tentativo non può essere conservato. Nessun invio eseguito.";
const LOST_MESSAGE =
  "Connessione interrotta: l’operazione potrebbe essere già registrata. Verifica lo stesso invio senza crearne un altro.";
export const FLASH_KEY = "luckylap.consignment.shop.flash";
export const PREVIEW_NOTICE = "Anteprima locale: dati sintetici, salvataggio disattivato.";

type Storage2 = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type SendOutcome = { result: ShopResult; kept: boolean };

/**
 * Invio con blocco sincrono: un secondo invio prima della risposta non parte
 * (`null`). Il comando resta conservato (`kept`) se l'esito è incerto, in
 * conflitto o se non si riesce a liberare la chiave.
 */
export function createShopSender(
  key: string,
  storage: () => Pick<Storage, "setItem" | "removeItem">,
  run: (command: ShopCommand) => Promise<ShopResult>,
) {
  let busy = false;
  return {
    isBusy: () => busy,
    async send(command: ShopCommand): Promise<SendOutcome | null> {
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
        let result: ShopResult;
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

/** Tentativo conservato in questo browser. */
export type StoredAttempt =
  | { kind: "shop"; command: ShopCommand; blocked: boolean }
  | { kind: "legacy"; command: ConsignmentCommand; blocked: boolean }
  | { kind: "unreadable"; keys: string[] };

/** Legge prima la chiave nuova, poi quella vecchia del conto vendita. */
export function readStoredAttempt(storage: Storage2, userId: string): StoredAttempt | null {
  const keys = [shopPendingKey(userId), consignmentPendingKey(userId)];
  try {
    const command = shopPending(storage, userId);
    if (command) return { kind: "shop", command, blocked: false };
  } catch {
    return { kind: "unreadable", keys };
  }
  try {
    const legacy = consignmentPending(storage, userId);
    if (legacy) return { kind: "legacy", command: legacy, blocked: false };
  } catch {
    return { kind: "unreadable", keys };
  }
  return null;
}

/** Riepilogo dei comandi precedenti, con le parole di oggi. Mai UUID, gid o centesimi. */
export function legacyAttemptSummary(
  command: ConsignmentCommand,
  itemLabel: (itemId: string) => string | null,
): AttemptSummary {
  switch (command.kind) {
    case "transfer_consignment_stock":
      return {
        title: "Spostamento di magliette da verificare",
        lines: [
          `${itemLabel(command.payload.stock_item_id) ?? "Maglietta"} · ${tshirtsLabel(command.payload.quantity)}`,
        ],
        occurredAt: command.payload.occurred_at,
      };
    case "register_consignment_sale":
      return {
        title: "Vendita in negozio da verificare",
        lines: [
          `${itemLabel(command.payload.stock_item_id) ?? "Maglietta"} · ${tshirtsLabel(command.payload.quantity)}`,
        ],
        occurredAt: command.payload.occurred_at,
      };
    case "record_consignment_settlement":
      return {
        title: "Pagamento ricevuto da verificare",
        lines: [consignmentMoney(command.payload.amount_cents)],
        occurredAt: command.payload.occurred_at,
      };
  }
}

type Notice = { tone: "success" | "error"; text: string };
type Commands = {
  /** Lettura del tentativo conservato terminata. */
  ready: boolean;
  /** Nessuna scrittura: anteprima, tentativo da verificare, invio o verifica in corso. */
  locked: boolean;
  /** Si può aprire un modulo (anche in anteprima): nessun tentativo da verificare né invio in corso. */
  canOpen: boolean;
  sending: boolean;
  preview: boolean;
  /** `null` se un altro invio è già partito o le scritture sono bloccate. */
  send: (command: ShopCommand) => Promise<ShopResult | null>;
  /** Messaggio da mostrare sulla pagina dopo un cambio di indirizzo. */
  flash: (text: string) => void;
  /** Esito in cima alla pagina, per i moduli che si chiudono dopo il salvataggio. */
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
const PendingContext = createContext<ReactNode>(null);

/** Scritture della pagina: un solo invio alla volta, bloccate da un tentativo in sospeso. */
export const useShopCommands = () => useContext(CommandsContext);

export function ShopCommandsProvider({
  userId,
  labels = {},
  preview = false,
  children,
}: {
  userId: string;
  /** Nomi delle magliette («GT3RS Blu M») per il riepilogo del tentativo. */
  labels?: Record<string, string>;
  preview?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  // Dopo un invio confermato le scritture restano ferme finché la pagina non rilegge i dati:
  // un secondo clic sullo stesso modulo non parte con dati vecchi.
  const [refreshing, startRefresh] = useTransition();
  const key = shopPendingKey(userId);
  const sender = useRef(createShopSender(key, () => sessionStorage, runShopCommand));
  const legacyBusy = useRef(false);
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState<StoredAttempt | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let attempt: StoredAttempt | null = null;
    try {
      attempt = readStoredAttempt(sessionStorage, userId);
      const flashed = sessionStorage.getItem(FLASH_KEY);
      if (flashed) {
        sessionStorage.removeItem(FLASH_KEY);
        setNotice({ tone: "success", text: flashed.slice(0, 300) });
      }
    } catch {
      attempt = { kind: "unreadable", keys: [key, consignmentPendingKey(userId)] };
    }
    setStored(attempt);
    setReady(true);
  }, [key, userId]);

  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);
  const canOpen = ready && stored === null && !sending && !verifying && !refreshing;
  const locked = preview || !canOpen;

  const send = useCallback(
    async (command: ShopCommand) => {
      if (locked || sender.current.isBusy()) return null;
      setSending(true);
      setNotice(null);
      try {
        const outcome = await sender.current.send(command);
        if (!outcome) return null;
        if (outcome.kept)
          setStored({
            kind: "shop",
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
      if (stored.kind === "shop") {
        const outcome = await sender.current.send({ ...stored.command, retry: true });
        if (!outcome) return;
        setNotice({
          tone: outcome.result.status === "success" ? "success" : "error",
          text: outcome.result.message,
        });
        if (outcome.kept) {
          setStored({
            ...stored,
            blocked:
              outcome.result.status === "rejected" &&
              outcome.result.code === "idempotency_conflict",
          });
        } else setStored(null);
        if (outcome.result.status === "success") refresh();
        return;
      }
      if (legacyBusy.current) return;
      legacyBusy.current = true;
      let result: ConsignmentResult;
      try {
        result = await runConsignmentCommand({ ...stored.command, retry: true });
      } catch {
        result = { status: "uncertain", message: LOST_MESSAGE };
      } finally {
        legacyBusy.current = false;
      }
      setNotice({ tone: result.status === "success" ? "success" : "error", text: result.message });
      const settled =
        result.status === "success" ||
        (result.status === "rejected" && result.code !== "idempotency_conflict");
      if (settled) {
        try {
          sessionStorage.removeItem(consignmentPendingKey(userId));
          setStored(null);
        } catch {
          /* Il tentativo resta conservato: si verifica di nuovo. */
        }
      } else if (result.status === "rejected") setStored({ ...stored, blocked: true });
      if (result.status === "success") refresh();
    } finally {
      setVerifying(false);
    }
  }

  function discard() {
    if (!stored) return;
    const keys =
      stored.kind === "unreadable"
        ? stored.keys
        : [stored.kind === "shop" ? key : consignmentPendingKey(userId)];
    try {
      for (const k of keys) sessionStorage.removeItem(k);
      setStored(null);
      setNotice(null);
    } catch {
      setNotice({
        tone: "error",
        text: "Non riesco a liberare il tentativo conservato in questo browser. Chiudi la scheda e riaprila.",
      });
    }
  }

  const label = (itemId: string) => labels[itemId] ?? null;
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
    const summary =
      stored.kind === "shop"
        ? shopAttemptSummary(stored.command, label)
        : legacyAttemptSummary(stored.command, label);
    attempt = (
      <PendingAttempt
        title={summary.title}
        lines={summary.lines}
        occurredAt={summary.occurredAt}
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
      <PendingContext.Provider value={slot}>{children}</PendingContext.Provider>
    </CommandsContext.Provider>
  );
}

/** Dove la pagina mostra anteprima, tentativo da verificare ed esito della verifica. */
export function ShopPendingSlot() {
  return <>{useContext(PendingContext)}</>;
}

/** Avviso dell'anteprima locale per le pagine senza scritture. */
export function PreviewNotice() {
  return (
    <p className={styles.previewNotice} role="status">
      {PREVIEW_NOTICE}
    </p>
  );
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
