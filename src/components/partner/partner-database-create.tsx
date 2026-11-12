"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { PartnerCardForm } from "./partner-card-form";
import { usePartnerContext } from "./partner-context";
import styles from "./partner-database.module.css";

const scope = "nuovo-contatto-partner";

export function PartnerDatabaseCreate({
  onClose,
  onDone,
  guard: navigationGuard,
}: {
  onClose: () => void;
  guard?: string | null;
  onDone: (co: number | null) => void;
}) {
  const { preview, hasDirty, setDirty } = usePartnerContext();
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(false);
  const [guard, setGuard] = useState(false);
  useEffect(() => {
    const opener = document.activeElement;
    const modal = dialog.current;
    alive.current = true;
    if (modal && !modal.open) modal.showModal();
    return () => {
      alive.current = false;
      setDirty(scope, false);
      if (modal?.open) modal.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, [setDirty]);
  function cancel() {
    setDirty(scope, false);
    onClose();
  }
  function requestClose() {
    if (hasDirty()) setGuard(true);
    else cancel();
  }
  return (
    <dialog
      ref={dialog}
      className={styles.createDialog}
      aria-labelledby="nuovo-contatto-titolo"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        className={styles.createBody}
        onChangeCapture={() => {
          if (!preview) setDirty(scope, true);
        }}
      >
        <header className={styles.viewHeading}>
          <h2 id="nuovo-contatto-titolo">Aggiungi un contatto</h2>
          <button
            type="button"
            className={styles.closeCreate}
            aria-label="Chiudi nuovo contatto"
            onClick={requestClose}
          >
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        {(guard || navigationGuard) && (
          <p role="alert" className={styles.notice}>
            Salva il contatto o usa «Annulla» per scartare le modifiche.
          </p>
        )}
        <PartnerCardForm
          target={null}
          onCancel={cancel}
          onDone={(co) => {
            if (!alive.current) return;
            setDirty(scope, false);
            onDone(co);
          }}
        />
      </div>
    </dialog>
  );
}
