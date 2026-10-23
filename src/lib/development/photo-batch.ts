import {
  PHOTOS_PER_PROJECT,
  PHOTOS_PER_SEND,
  photoFileProblem,
  photoMime,
  type PhotoDescriptor,
  type PhotoSend,
  type PhotoSendResult,
  type PreparedPhotoUpload,
} from "./photos";

/*
 * Un invio di foto dal browser: controllo dei file, firma, trasferimento con avanzamento, poi una
 * sola registrazione per tutte le foto caricate. Le dipendenze arrivano da fuori: in produzione
 * le Server Actions e Storage, in anteprima locale una simulazione che non esce dalla pagina.
 */
export type PhotoJobStatus = "rejected" | "waiting" | "sending" | "checking" | "added" | "failed";
export type PhotoJob = {
  key: string;
  name: string;
  size: number;
  status: PhotoJobStatus;
  /** 0..1 durante il trasferimento. */
  progress: number;
  message?: string;
};

export type PhotoBatchDeps = {
  newId(): string;
  hash(file: File): Promise<string>;
  prepare(input: {
    projectId: string;
    photos: PhotoDescriptor[];
  }): Promise<{ error?: string; uploads?: PreparedPhotoUpload[] }>;
  upload(
    file: File,
    upload: PreparedPhotoUpload,
    onProgress: (fraction: number) => void,
  ): Promise<boolean>;
  finalize(send: PhotoSend): Promise<PhotoSendResult>;
  /** Conserva (o libera, con null) l'invio da confermare, senza file né token. */
  remember(send: PhotoSend | null): void;
};

export type PhotoBatchOutcome =
  | { kind: "added"; message: string; assetIds: string[]; files: Map<string, File> }
  | { kind: "pending"; message: string; send: PhotoSend; blocked: boolean }
  | { kind: "failed"; message: string }
  | { kind: "nothing" };

/** Esito della registrazione di un invio già caricato. */
export type PhotoSendOutcome =
  | { kind: "added"; message: string; assetIds: string[] }
  | Extract<PhotoBatchOutcome, { kind: "pending" | "failed" }>;

const INVALID_BYTES = "Non corrisponde al file scelto o non è un’immagine valida: non aggiunta.";

/** Il nome della foto per le righe dell'invio da verificare. */
export function sendSummary(send: PhotoSend): string {
  const names = send.photos.map((photo) => photo.originalName);
  return `${names.length} foto: ${names.join(", ")}`;
}

export function hexDigest(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Registra un invio già caricato. Se alcune foto non superano la verifica dei byte, nessun
 * comando è partito: si tolgono e il resto si reinvia con un operation ID nuovo.
 */
export async function sendPhotos(
  send: PhotoSend,
  deps: Pick<PhotoBatchDeps, "newId" | "finalize" | "remember">,
  onInvalid: (assetIds: string[]) => void = () => {},
): Promise<PhotoSendOutcome> {
  let current = send;
  for (let round = 0; round <= PHOTOS_PER_SEND; round++) {
    deps.remember(current);
    let result: PhotoSendResult;
    try {
      result = await deps.finalize(current);
    } catch {
      result = {
        error:
          "Le foto possono essere già nel progetto, ma l’aggiunta non è confermata. Usa «Verifica lo stesso invio».",
        retry: true,
      };
    }
    if (result.assetIds && result.success) {
      deps.remember(null);
      return { kind: "added", message: result.success, assetIds: result.assetIds };
    }
    if (result.invalid?.length) {
      const invalid = new Set(result.invalid);
      onInvalid(result.invalid);
      const remaining = current.photos.filter((photo) => !invalid.has(photo.operationId));
      if (!remaining.length) {
        deps.remember(null);
        return { kind: "failed", message: result.error ?? INVALID_BYTES };
      }
      current = { operationId: deps.newId(), projectId: current.projectId, photos: remaining };
      continue;
    }
    if (result.retry || result.blocked)
      return {
        kind: "pending",
        message: result.error ?? "Aggiunta non confermata.",
        send: current,
        blocked: Boolean(result.blocked),
      };
    deps.remember(null);
    return { kind: "failed", message: result.error ?? "Foto non aggiunte." };
  }
  return { kind: "pending", message: "Aggiunta non confermata.", send: current, blocked: false };
}

/** Tutto l'invio di una scelta di file. `update` riceve ogni cambio delle righe. */
export async function runPhotoBatch(
  { files, projectId, existing }: { files: File[]; projectId: string; existing: number },
  deps: PhotoBatchDeps,
  update: (jobs: PhotoJob[]) => void,
): Promise<PhotoBatchOutcome> {
  let jobs: PhotoJob[] = files.map((file) => ({
    key: deps.newId(),
    name: file.name || "Foto senza nome",
    size: file.size,
    status: "waiting",
    progress: 0,
  }));
  const set = (key: string, change: Partial<PhotoJob>) => {
    jobs = jobs.map((job) => (job.key === key ? { ...job, ...change } : job));
    update(jobs);
  };
  const room = Math.max(0, PHOTOS_PER_PROJECT - existing);
  let accepted = 0;
  const chosen: { key: string; file: File }[] = [];
  files.forEach((file, index) => {
    const key = jobs[index].key;
    const problem = photoFileProblem(file);
    if (problem) jobs[index] = { ...jobs[index], status: "rejected", message: problem };
    else if (accepted >= Math.min(room, PHOTOS_PER_SEND))
      jobs[index] = {
        ...jobs[index],
        status: "rejected",
        message:
          accepted >= room
            ? `Il progetto arriva a ${PHOTOS_PER_PROJECT} foto: questa non entra.`
            : `Al massimo ${PHOTOS_PER_SEND} foto per volta: aggiungila con il prossimo invio.`,
      };
    else {
      accepted++;
      chosen.push({ key, file });
    }
  });
  update(jobs);
  if (!chosen.length) return { kind: "nothing" };

  const items: { key: string; file: File; photo: PhotoDescriptor }[] = [];
  for (const { key, file } of chosen) {
    try {
      const sha256 = await deps.hash(file);
      items.push({
        key,
        file,
        photo: {
          operationId: deps.newId(),
          originalName: file.name,
          mime: photoMime(file.name),
          size: file.size,
          sha256,
        },
      });
    } catch {
      set(key, { status: "failed", message: "Non riesco a leggere il file: sceglilo di nuovo." });
    }
  }
  if (!items.length) return { kind: "failed", message: "Nessuna foto letta." };

  let prepared: Awaited<ReturnType<PhotoBatchDeps["prepare"]>>;
  try {
    prepared = await deps.prepare({ projectId, photos: items.map((item) => item.photo) });
  } catch {
    prepared = {
      error: "Caricamento non disponibile. Nessuna foto è stata aggiunta: riprova tra poco.",
    };
  }
  const uploads = new Map((prepared.uploads ?? []).map((upload) => [upload.assetId, upload]));
  if (prepared.error || items.some((item) => !uploads.has(item.photo.operationId))) {
    const message = prepared.error ?? "Caricamento non disponibile. Riprova tra poco.";
    for (const item of items) set(item.key, { status: "failed", message });
    return { kind: "failed", message };
  }

  // Due trasferimenti alla volta: sul telefono la rete resta usabile.
  const sent: typeof items = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      set(item.key, { status: "sending", progress: 0 });
      let done = false;
      try {
        done = await deps.upload(item.file, uploads.get(item.photo.operationId)!, (fraction) =>
          set(item.key, { progress: Math.max(0, Math.min(1, fraction)) }),
        );
      } catch {
        done = false;
      }
      if (done) {
        sent.push(item);
        set(item.key, { status: "checking", progress: 1 });
      } else
        set(item.key, {
          status: "failed",
          message: "Invio non riuscito: controlla la connessione e scegli di nuovo la foto.",
        });
    }
  };
  await Promise.all([worker(), worker()]);
  if (!sent.length) return { kind: "failed", message: "Nessuna foto è arrivata nell’archivio." };

  const ordered = items.filter((item) => sent.includes(item));
  const byAsset = new Map(ordered.map((item) => [item.photo.operationId, item]));
  const outcome = await sendPhotos(
    { operationId: deps.newId(), projectId, photos: ordered.map((item) => item.photo) },
    deps,
    (invalid) => {
      for (const assetId of invalid) {
        const item = byAsset.get(assetId);
        if (item) set(item.key, { status: "failed", message: INVALID_BYTES });
      }
    },
  );
  if (outcome.kind === "added") {
    for (const assetId of outcome.assetIds) {
      const item = byAsset.get(assetId);
      if (item) set(item.key, { status: "added", progress: 1, message: undefined });
    }
    return {
      ...outcome,
      files: new Map(outcome.assetIds.map((assetId) => [assetId, byAsset.get(assetId)!.file])),
    };
  }
  if (outcome.kind === "failed")
    for (const item of ordered)
      if (jobs.find((job) => job.key === item.key)?.status === "checking")
        set(item.key, { status: "failed", message: outcome.message });
  return outcome;
}
