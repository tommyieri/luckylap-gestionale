"use client";

import Link from "next/link";
import { startTransition, useEffect, useRef, useState } from "react";
import { loadFinanceEditor, type FinanceEditorResult } from "../../app/finance/editor-actions";
import type { FinanceMovement } from "../../lib/finance/dashboard";
import { financeCentsLabel } from "../../lib/finance/dashboard";
import { formatRomeDate } from "../../lib/team/model";
import { FinanceRevisionEditor } from "../finance-revision-editor";
import { FinanceShopPaymentEditor } from "../finance-shop-payment-editor";
import styles from "./finance-movement-panel.module.css";

export function FinanceMovementPanel({
  movement,
  actorId,
  readOnly,
  onClose,
  onDirtyChange,
}: {
  movement: FinanceMovement;
  actorId: string;
  names: Record<string, string>;
  readOnly: boolean;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState<{ key: string; result: FinanceEditorResult } | null>(null);
  const [request, setRequest] = useState(0);
  const { source, sourceId } = movement;
  const key = `${actorId}:${source}:${sourceId}:${readOnly}`;
  const scope = useRef({ key, mounted: true });
  scope.current.key = key;
  // A new key hides the old editor during render, before effects or network responses.
  const result = loaded?.key === key ? loaded.result : null;
  useEffect(() => {
    scope.current.mounted = true;
    const opener = document.activeElement as HTMLElement | null;
    const modal = dialog.current;
    if (modal && !modal.open) modal.showModal();
    return () => {
      scope.current.mounted = false;
      modal?.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoaded(null);
    if (!readOnly) {
      startTransition(() => {
        void loadFinanceEditor(actorId, source, sourceId).then(
          (value) => {
            if (active) setLoaded({ key, result: value });
          },
          () => {
            if (active)
              setLoaded({
                key,
                result: {
                  kind: "unavailable",
                  message: "Non riesco a leggere la scheda completa. Riprova.",
                },
              });
          },
        );
      });
    }
    return () => {
      active = false;
    };
  }, [actorId, source, sourceId, readOnly, key, request]);
  function reload() {
    if (!scope.current.mounted || scope.current.key !== key) return;
    setLoaded(null);
    setRequest((value) => value + 1);
  }
  function reportDirty(dirty: boolean) {
    if (scope.current.mounted && scope.current.key === key) onDirtyChange(dirty);
  }
  const showSummary = readOnly || !result || result.kind === "unavailable";
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="finance-movement-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.sheet}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Scheda movimento</p>
            <h2 id="finance-movement-title">
              {source === "shop_payment" ? "Incasso conto vendita" : "Movimento Finance"}
            </h2>
          </div>
          <button
            type="button"
            className="button button-secondary"
            aria-label="Chiudi scheda movimento"
            onClick={onClose}
          >
            Chiudi
          </button>
        </header>
        <div className={styles.body}>
          {showSummary && (
            <section className={styles.summary} aria-label="Riepilogo del movimento">
              <strong className={styles.amount}>{financeCentsLabel(movement.cents)}</strong>
              <h3>{movement.description || "Movimento senza descrizione"}</h3>
              <p>
                {formatRomeDate(`${movement.date}T12:00Z`)} ·{" "}
                {movement.account ?? "Conto da attribuire"}
                {movement.targetAccount && ` → ${movement.targetAccount}`}
              </p>
              <p>
                {movement.category || "Da classificare"}
                {movement.pending && " · In sospeso"}
                {movement.future && " · Futuro"}
                {movement.transfer && " · Trasferimento"}
              </p>
            </section>
          )}
          {readOnly ? (
            <p className={styles.notice}>
              Anteprima in sola lettura. Le modifiche e lo storico completo richiedono il workspace
              condiviso e la sessione Finance.
            </p>
          ) : !result ? (
            <p role="status">Caricamento dello storico e dei dati correnti…</p>
          ) : result.kind === "unavailable" ? (
            <div className={styles.notice}>
              <p role="status">{result.message}</p>
              <button type="button" className="button button-secondary" onClick={reload}>
                Riprova
              </button>
            </div>
          ) : result.kind === "shop_payment" ? (
            <FinanceShopPaymentEditor
              key={key}
              history={result.history}
              actorId={actorId}
              names={result.names}
              embedded
              onDirtyChange={reportDirty}
              onSaved={reload}
            />
          ) : (
            <FinanceRevisionEditor
              key={key}
              history={result.history}
              actorId={actorId}
              names={result.names}
              embedded
              onDirtyChange={reportDirty}
              onSaved={reload}
            />
          )}
          <details className={styles.source}>
            <summary>Fonte del movimento</summary>
            <p>{sourceLabel[source]}</p>
            {movement.allocationNote && <p>{movement.allocationNote}</p>}
            {movement.href && (
              <p>
                <Link href={movement.href} prefetch={false}>
                  Apri la fonte
                </Link>
              </p>
            )}
          </details>
        </div>
      </div>
    </dialog>
  );
}
const sourceLabel: Record<FinanceMovement["source"], string> = {
  budgetflow: "Importazione BudgetFlow",
  manual: "Registrazione manuale",
  payment: "Incasso di una vendita",
  refund: "Rimborso Shopify",
  consignment: "Pagamento conto vendita",
  shop_payment: "Pagamento del resoconto conto vendita",
};
