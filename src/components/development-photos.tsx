"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import {
  finalizeDevelopmentPhotos,
  moveDevelopmentPhoto,
  prepareDevelopmentPhotoUploads,
  removeDevelopmentPhoto,
} from "../app/development/photo-actions";
import {
  PHOTOS_PER_PROJECT,
  PHOTOS_PER_SEND,
  PHOTO_ACCEPT,
  parsePhotoSend,
  photoMime,
  photoSize,
  photoUploadContentType,
  type DevelopmentPhoto,
  type PhotoCommandResult,
  type PhotoSend,
} from "../lib/development/photos";
import {
  hexDigest,
  runPhotoBatch,
  sendPhotos,
  sendSummary,
  type PhotoBatchDeps,
  type PhotoJob,
} from "../lib/development/photo-batch";
import { uploadPhoto } from "../lib/development/photo-transfer";
import type { SupabasePublicConfig } from "../lib/supabase/config";
import { PendingAttempt } from "./pending-attempt";
import { PhotoImage } from "./development-photo-image";
import { PhotoViewer } from "./development-photo-viewer";
import styles from "./development-photos.module.css";

type Notice = { kind: "success" | "error"; text: string } | null;
type Pending = { send: PhotoSend; blocked: boolean; message: string } | null;

const STATUS: Record<PhotoJob["status"], string> = {
  rejected: "Non caricata",
  waiting: "In attesa",
  sending: "Invio",
  checking: "Controllo",
  added: "Aggiunta",
  failed: "Non aggiunta",
};

/** Anteprima locale: nessuna rete, l'avanzamento è simulato e le foto restano nella pagina. */
function previewDeps(): PhotoBatchDeps {
  return {
    newId: () => crypto.randomUUID(),
    hash: async () => "0".repeat(64),
    prepare: async ({ photos }) => ({
      uploads: photos.map((photo) => ({
        assetId: photo.operationId,
        path: `anteprima/${photo.operationId}`,
        token: "anteprima",
        contentType: photoUploadContentType(photo.mime),
      })),
    }),
    upload: (_file, _upload, onProgress) =>
      new Promise((resolve) => {
        let step = 0;
        const timer = setInterval(() => {
          step++;
          onProgress(step / 6);
          if (step >= 6) {
            clearInterval(timer);
            resolve(true);
          }
        }, 140);
      }),
    finalize: async (send) => ({
      assetIds: send.photos.map((photo) => photo.operationId),
      success:
        send.photos.length === 1
          ? "Foto aggiunta, solo in questa anteprima."
          : `${send.photos.length} foto aggiunte, solo in questa anteprima.`,
    }),
    remember: () => {},
  };
}

export function DevelopmentPhotos({
  projectId,
  projectName,
  photos,
  userId,
  config,
  preview = false,
}: {
  projectId: string;
  projectName: string;
  photos: DevelopmentPhoto[];
  userId: string;
  config: SupabasePublicConfig;
  /** Anteprima locale: dati sintetici, niente rete. */
  preview?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const [localPhotos, setLocalPhotos] = useState<DevelopmentPhoto[]>(photos);
  const [removed, setRemoved] = useState<string[]>([]);
  const [jobs, setJobs] = useState<PhotoJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const storageKey = `luckylap-development-photos-v1:${userId}:${projectId}`;
  const list = (preview ? localPhotos : photos).filter((photo) => !removed.includes(photo.id));

  useEffect(() => {
    if (preview) return;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (!saved) return;
      const send = parsePhotoSend(JSON.parse(saved));
      setPending({
        send,
        blocked: false,
        message: "L’ultimo invio di foto non ha un esito confermato.",
      });
    } catch {
      setStorageWarning(true);
    }
  }, [preview, storageKey]);

  function remember(send: PhotoSend | null) {
    if (preview) return;
    try {
      if (send) sessionStorage.setItem(storageKey, JSON.stringify(send));
      else sessionStorage.removeItem(storageKey);
    } catch {
      setStorageWarning(true);
    }
  }
  const deps: PhotoBatchDeps = preview
    ? previewDeps()
    : {
        newId: () => crypto.randomUUID(),
        hash: async (file) =>
          hexDigest(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
        prepare: prepareDevelopmentPhotoUploads,
        upload: (file, upload, onProgress) => uploadPhoto(config, upload, file, onProgress),
        finalize: finalizeDevelopmentPhotos,
        remember,
      };

  async function choose(files: File[]) {
    if (busyRef.current || pending || !files.length) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await runPhotoBatch(
        { files, projectId, existing: list.length },
        deps,
        setJobs,
      );
      if (outcome.kind === "added") {
        setJobs((current) => current.filter((job) => job.status !== "added"));
        setNotice({ kind: "success", text: outcome.message });
        if (preview)
          setLocalPhotos((current) => [
            ...current,
            ...outcome.assetIds.map((assetId, index) => {
              const file = outcome.files.get(assetId)!;
              return {
                id: assetId,
                projectId,
                position: current.length + index + 1,
                originalName: file.name,
                contentType: photoMime(file.name),
                size: file.size,
                createdAt: new Date().toISOString(),
                createdBy: userId,
                previewSrc: URL.createObjectURL(file),
              };
            }),
          ]);
        else router.refresh();
      } else if (outcome.kind === "pending") {
        setPending({ send: outcome.send, blocked: outcome.blocked, message: outcome.message });
      } else if (outcome.kind === "failed") {
        setNotice({ kind: "error", text: outcome.message });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function verify() {
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await sendPhotos(pending.send, deps);
      if (outcome.kind === "added") {
        setPending(null);
        setJobs([]);
        setNotice({ kind: "success", text: outcome.message });
        router.refresh();
      } else if (outcome.kind === "pending")
        setPending({ send: outcome.send, blocked: outcome.blocked, message: outcome.message });
      else {
        setPending(null);
        setNotice({ kind: "error", text: outcome.message });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function removePhoto(
    photo: DevelopmentPhoto,
    operationId: string,
  ): Promise<PhotoCommandResult> {
    const result = preview
      ? { success: "Foto tolta, solo in questa anteprima." }
      : await removeDevelopmentPhoto({ operationId, projectId, assetId: photo.id });
    if (result.success) {
      const index = list.findIndex((item) => item.id === photo.id);
      const rest = list.filter((item) => item.id !== photo.id);
      setRemoved((current) => [...current, photo.id]);
      setNotice({ kind: "success", text: result.success });
      setViewerId(rest.length ? rest[Math.min(index, rest.length - 1)].id : null);
      // Senza più foto il dialog si chiude da solo: il focus torna su «Aggiungi foto».
      if (!rest.length) requestAnimationFrame(() => addRef.current?.focus());
      if (!preview) router.refresh();
    }
    return result;
  }

  async function movePhoto(
    photo: DevelopmentPhoto,
    position: number,
    operationId: string,
  ): Promise<PhotoCommandResult> {
    if (preview) {
      setLocalPhotos((current) => {
        const rest = current.filter((item) => item.id !== photo.id && !removed.includes(item.id));
        rest.splice(position - 1, 0, photo);
        return rest.map((item, index) => ({ ...item, position: index + 1 }));
      });
      return { success: "Ordine aggiornato, solo in questa anteprima." };
    }
    const result = await moveDevelopmentPhoto({
      operationId,
      projectId,
      assetId: photo.id,
      position,
    });
    if (result.success) router.refresh();
    return result;
  }

  const visibleJobs = jobs.filter((job) => job.status !== "added");
  return (
    <section className={styles.photos} aria-labelledby={`foto-${projectId}`}>
      <div className={styles.photosHead}>
        <h4 id={`foto-${projectId}`}>
          Foto <span>{list.length}</span>
        </h4>
        <button
          ref={addRef}
          type="button"
          className="button button-secondary"
          disabled={busy || Boolean(pending) || list.length >= PHOTOS_PER_PROJECT}
          onClick={() => inputRef.current?.click()}
          aria-describedby={`foto-aiuto-${projectId}`}
        >
          <ImagePlus size={15} aria-hidden="true" />
          {busy ? "Caricamento…" : "Aggiungi foto"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={PHOTO_ACCEPT}
          multiple
          hidden
          aria-label={`Scegli le foto per «${projectName}»`}
          onChange={(event) => choose(Array.from(event.currentTarget.files ?? []))}
        />
      </div>
      {list.length > 0 ? (
        <ul className={styles.strip} aria-label={`Foto di «${projectName}»`}>
          {list.map((photo, index) => (
            <li key={photo.id}>
              <button
                type="button"
                id={`miniatura-${photo.id}`}
                className={styles.thumb}
                aria-label={`Apri la foto ${index + 1} di ${list.length}: ${photo.originalName}`}
                onClick={() => setViewerId(photo.id)}
              >
                <PhotoImage photo={photo} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>Ancora nessuna foto per questo progetto.</p>
      )}
      <p id={`foto-aiuto-${projectId}`} className={styles.help}>
        JPEG, PNG, WebP o HEIC fino a 25 MB, al massimo {PHOTOS_PER_SEND} per volta. Dal telefono
        puoi scattare o scegliere dalla galleria.
      </p>
      {visibleJobs.length > 0 && (
        <ul className={styles.jobs} aria-label="Foto in caricamento" aria-live="polite">
          {visibleJobs.map((job) => (
            <li key={job.key} className={styles.job} data-status={job.status}>
              <span className={styles.jobName}>{job.name}</span>
              <span className={styles.jobStatus}>
                {job.status === "sending"
                  ? `${STATUS.sending} ${Math.round(job.progress * 100)}%`
                  : job.status === "checking"
                    ? `${STATUS.checking}…`
                    : STATUS[job.status]}
                {" · "}
                {photoSize(job.size)}
              </span>
              {(job.status === "sending" || job.status === "checking") && (
                <progress
                  className={styles.progress}
                  max={1}
                  value={job.status === "checking" ? 1 : job.progress}
                  aria-label={`Avanzamento di ${job.name}`}
                />
              )}
              {job.message && (
                <span className={styles.jobMessage} role="alert">
                  {job.message}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {pending && (
        <PendingAttempt
          title="Foto da verificare"
          lines={[`Progetto: «${projectName}»`, sendSummary(pending.send), pending.message]}
          operationId={pending.send.operationId}
          pending={busy}
          blocked={pending.blocked}
          onRetry={verify}
          onReread={() => router.refresh()}
          rereadLabel="Ricarica le foto"
          onDiscard={() => {
            remember(null);
            setPending(null);
            setJobs([]);
            setNotice({
              kind: "success",
              text: "Tentativo scartato. I file già inviati restano privati nell’archivio del team.",
            });
          }}
        />
      )}
      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={notice.kind === "error" ? styles.error : styles.success}
        >
          {notice.text}
        </p>
      )}
      {storageWarning && (
        <p className={styles.help}>
          Il browser non conserva l’invio in sospeso: tieni aperta la pagina finché le foto non sono
          confermate.
        </p>
      )}
      {viewerId && list.some((photo) => photo.id === viewerId) && (
        <PhotoViewer
          photos={list}
          currentId={viewerId}
          projectName={projectName}
          onSelect={setViewerId}
          onClose={() => {
            // Il focus torna sulla miniatura della foto vista per ultima.
            // Dopo la chiusura del dialog, che rimette il focus dove era prima di aprirlo.
            const last = document.getElementById(`miniatura-${viewerId}`);
            setViewerId(null);
            requestAnimationFrame(() => last?.focus());
          }}
          onRemove={removePhoto}
          onMove={movePhoto}
          onReread={() => router.refresh()}
        />
      )}
    </section>
  );
}
