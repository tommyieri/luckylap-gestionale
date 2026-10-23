"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  X,
} from "lucide-react";
import {
  photoFileUrl,
  photoSize,
  stepPhoto,
  type DevelopmentPhoto,
  type PhotoCommandResult,
} from "../lib/development/photos";
import { PendingAttempt } from "./pending-attempt";
import { PhotoImage } from "./development-photo-image";
import styles from "./development-photos.module.css";

export type PhotoViewerProps = {
  photos: DevelopmentPhoto[];
  currentId: string;
  projectName: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Toglie la foto; lo stesso operationId si ripete finché l'esito non è chiaro. */
  onRemove: (photo: DevelopmentPhoto, operationId: string) => Promise<PhotoCommandResult>;
  /** Sposta la foto al posto indicato (1 = prima). */
  onMove: (
    photo: DevelopmentPhoto,
    position: number,
    operationId: string,
  ) => Promise<PhotoCommandResult>;
  onReread?: () => void;
};

type Busy = "remove" | "move" | null;

/**
 * La foto in grande, in un `dialog` nativo: chiudi (anche con Esc o toccando lo sfondo),
 * precedente e successiva (anche con le frecce), scarica, sposta, rimuovi con conferma.
 */
export function PhotoViewer({
  photos,
  currentId,
  projectName,
  onSelect,
  onClose,
  onRemove,
  onMove,
  onReread,
}: PhotoViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const removeOp = useRef<{ assetId: string; id: string } | null>(null);
  const moveOp = useRef<{ key: string; id: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  const index = Math.max(
    0,
    photos.findIndex((photo) => photo.id === currentId),
  );
  const photo = photos[index];
  if (!photo) return null;
  const many = photos.length > 1;
  const go = (delta: number) => {
    if (busyRef.current || !many) return;
    setConfirming(false);
    setError("");
    setUncertain(false);
    onSelect(photos[stepPhoto(index, delta, photos.length)].id);
  };
  async function remove() {
    if (busyRef.current) return;
    busyRef.current = true;
    if (removeOp.current?.assetId !== photo.id)
      removeOp.current = { assetId: photo.id, id: crypto.randomUUID() };
    setBusy("remove");
    setError("");
    try {
      const result = await onRemove(photo, removeOp.current.id);
      if (result.success) {
        removeOp.current = null;
        setConfirming(false);
        setUncertain(false);
        return;
      }
      setError(result.error ?? "Rimozione non confermata.");
      setUncertain(Boolean(result.retry));
      if (!result.retry) removeOp.current = null;
    } catch {
      setError("Rimozione non confermata. «Verifica lo stesso invio» la ripete.");
      setUncertain(true);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }
  async function move(position: number) {
    if (busyRef.current) return;
    busyRef.current = true;
    const key = `${photo.id}:${position}`;
    if (moveOp.current?.key !== key) moveOp.current = { key, id: crypto.randomUUID() };
    setBusy("move");
    setError("");
    try {
      const result = await onMove(photo, position, moveOp.current.id);
      if (result.success || !result.retry) moveOp.current = null;
      if (result.error) setError(result.error);
    } catch {
      setError("Spostamento non confermato. Riprova: lo stesso invio non sposta due volte.");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }
  const title = `Foto ${index + 1} di ${photos.length}`;
  return (
    <dialog
      ref={dialogRef}
      className={styles.viewer}
      aria-labelledby="foto-viewer-title"
      aria-describedby="foto-viewer-name"
      onCancel={(event) => {
        event.preventDefault();
        if (!busyRef.current) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busyRef.current) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") go(-1);
        if (event.key === "ArrowRight") go(1);
      }}
    >
      <div className={styles.viewerInner}>
        <header className={styles.viewerHead}>
          <div>
            <h2 id="foto-viewer-title">{title}</h2>
            <p id="foto-viewer-name">
              {photo.originalName} · {photoSize(photo.size)} · «{projectName}»
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => !busyRef.current && onClose()}
            aria-label="Chiudi la foto"
            autoFocus
          >
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.stage}>
          <PhotoImage key={photo.id} photo={photo} large />
          {many && (
            <>
              <button
                type="button"
                className={`${styles.stageNav} ${styles.stagePrev}`}
                onClick={() => go(-1)}
                aria-label="Foto precedente"
              >
                <ChevronLeft size={26} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`${styles.stageNav} ${styles.stageNext}`}
                onClick={() => go(1)}
                aria-label="Foto successiva"
              >
                <ChevronRight size={26} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
        <div className={styles.viewerActions}>
          <a
            className="button button-secondary"
            href={photo.previewSrc ?? photoFileUrl(photo, false)}
            download={photo.previewSrc ? photo.originalName : undefined}
          >
            <Download size={15} aria-hidden="true" />
            Scarica originale
          </a>
          {many && (
            <div className={styles.moveGroup} role="group" aria-label="Ordine delle foto">
              <button
                type="button"
                className="button button-secondary"
                disabled={index === 0 || busy !== null}
                onClick={() => move(index)}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                {busy === "move" ? "Spostamento…" : "Sposta prima"}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={index === photos.length - 1 || busy !== null}
                onClick={() => move(index + 2)}
              >
                Sposta dopo
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          )}
          {!confirming && !uncertain && (
            <button
              type="button"
              className={`button button-secondary ${styles.remove}`}
              disabled={busy !== null}
              onClick={() => {
                setConfirming(true);
                setError("");
              }}
            >
              <Trash2 size={15} aria-hidden="true" />
              Rimuovi
            </button>
          )}
        </div>
        {confirming && !uncertain && (
          <div className={styles.confirm} role="group" aria-label="Conferma della rimozione">
            <p>
              Togli questa foto da «{projectName}»? Sparisce dal progetto per tutti; il file resta
              nell’archivio privato del team.
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className="button button-primary"
                disabled={busy !== null}
                onClick={remove}
              >
                {busy === "remove" ? "Rimozione…" : "Sì, rimuovi la foto"}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy !== null}
                onClick={() => setConfirming(false)}
              >
                Annulla
              </button>
            </div>
          </div>
        )}
        {uncertain && removeOp.current && (
          <div className={styles.viewerPending}>
            <PendingAttempt
              title="Rimozione da verificare"
              lines={[`Foto: ${photo.originalName}`, `Progetto: «${projectName}»`]}
              operationId={removeOp.current.id}
              pending={busy === "remove"}
              onRetry={remove}
              onReread={onReread}
              rereadLabel="Ricarica le foto"
            />
          </div>
        )}
        {error && (
          <p role="alert" className={styles.viewerError}>
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
