"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { Upload } from "lucide-react";
import { finalizeBrandUpload, prepareBrandUpload, registerBrandLink } from "../app/assets/actions";
import {
  ASSET_BUCKET,
  ASSET_TYPES,
  MAX_ASSET_BYTES,
  assetStoragePath,
  assetTypeLabels,
  parseAssetFields,
  parseUploadDescriptor,
  type AssetFields,
} from "../lib/assets/model";
import {
  parsePendingAssetOperation,
  runRememberedAssetOperation,
  type PendingAssetOperation,
} from "../lib/assets/pending-operation";
import type { SupabasePublicConfig } from "../lib/supabase/config";
import styles from "./brand-assets.module.css";

const emptyFields: AssetFields = { name: "", assetType: "photo", description: "" };

export function BrandAssetUpload({
  config,
  userId,
  initialOperationId,
  disabled = false,
}: {
  config: SupabasePublicConfig;
  userId: string;
  initialOperationId: string;
  /** Anteprima locale: il modulo si vede, ma non invia niente. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"file" | "link">("file");
  const [fields, setFields] = useState<AssetFields>(emptyFields);
  const [url, setUrl] = useState("");
  const [operationId, setOperationId] = useState(initialOperationId);
  const [pending, setPending] = useState<PendingAssetOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const busyRef = useRef(false);
  const storageKey = `luckylap-brand-upload-v1:${userId}`;
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (!saved) return;
      const data = parsePendingAssetOperation(JSON.parse(saved), userId);
      setPending(data);
      setFields(data.fields);
      setMode(data.kind);
      setOperationId(data.kind === "file" ? data.descriptor.operationId : data.operationId);
      if (data.kind === "link") setUrl(data.url);
    } catch {
      setStorageWarning(true);
    }
  }, [storageKey, userId]);
  function remember(value: PendingAssetOperation | null) {
    setPending(value);
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {
      setStorageWarning(true);
    }
  }
  function reset() {
    remember(null);
    setFields(emptyFields);
    setUrl("");
    setOperationId(crypto.randomUUID());
  }
  async function finish(value: PendingAssetOperation) {
    const result =
      value.kind === "file"
        ? await finalizeBrandUpload({ descriptor: value.descriptor, fields: value.fields })
        : await registerBrandLink({
            operationId: value.operationId,
            fields: value.fields,
            url: value.url,
          });
    if (result.error) {
      setError(result.error);
      return;
    }
    if (!result.id) {
      setError("La voce non è ancora confermata. Usa Verifica e completa.");
      return;
    }
    setMessage(result.success ?? "Contenuto aggiunto.");
    reset();
    router.refresh();
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || disabled) return;
    busyRef.current = true;
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const validFields = parseAssetFields(fields);
      if (mode === "link") {
        await runRememberedAssetOperation(
          { kind: "link", operationId, fields: validFields, url },
          userId,
          remember,
          finish,
        );
        return;
      }
      const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
      if (!file || file.size < 1 || file.size > MAX_ASSET_BYTES)
        throw new Error("Scegli un file fino a 25 MB.");
      const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha256 = [...new Uint8Array(hash)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const descriptor = parseUploadDescriptor({
        operationId,
        originalName: file.name,
        mime: file.type,
        size: file.size,
        sha256,
      });
      const value: PendingAssetOperation = {
        kind: "file",
        descriptor,
        fields: validFields,
        path: assetStoragePath(userId, descriptor),
      };
      remember(value);
      const prepared = await prepareBrandUpload(descriptor);
      if (prepared.error || !prepared.upload) {
        setError(prepared.error ?? "Caricamento non disponibile. Il file non è ancora confermato.");
        return;
      }
      // No Auth session, browser tokens or local Auth persistence. This client
      // can only send bytes through the single-path signed upload capability.
      const storage = createClient(config.url, config.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const upload = await storage.storage
        .from(ASSET_BUCKET)
        .uploadToSignedUrl(prepared.upload.path, prepared.upload.token, file, {
          contentType: prepared.upload.contentType,
          upsert: false,
          cacheControl: "0",
        });
      if (upload.error) {
        setError(
          "Trasferimento non confermato. Il file può essere già nell’archivio privato del team: usa Verifica e completa prima di riprovare.",
        );
        return;
      }
      await finish(value);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Salvataggio non confermato. Usa Verifica e completa.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function retry() {
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await finish(pending);
    } catch {
      setError("Verifica non confermata. Mantieni questa pagina e riprova tra poco.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <div className={styles.uploadPanel}>
      <h2>Aggiungi un contenuto</h2>
      {pending ? (
        <div className={styles.pending}>
          <strong>
            {pending.kind === "file" ? "Caricamento da verificare" : "Link da verificare"}
          </strong>
          <p>{pending.kind === "file" ? pending.descriptor.originalName : pending.fields.name}</p>
          {pending.kind === "link" && <p className={styles.help}>{pending.url}</p>}
          <p>
            {pending.kind === "file"
              ? "Il file può essere già nell’archivio privato del team. La voce compare in libreria solo dopo la verifica e il salvataggio confermati."
              : "Il link può essere già salvato. Verifica e completa ripete lo stesso tentativo con gli stessi dati, anche dopo aver ricaricato la pagina."}
          </p>
          <div className={styles.actions}>
            <button className="button button-primary" onClick={retry} disabled={busy}>
              {busy ? "Verifica…" : "Verifica e completa"}
            </button>
            {pending.kind === "file" && (
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => {
                  if (busyRef.current) return;
                  reset();
                  setError("");
                  setMessage(
                    "Puoi iniziare un nuovo caricamento. Un eventuale file incompleto precedente resta nell’archivio privato. Avvisa Tommi se va tolto.",
                  );
                }}
              >
                Nuovo caricamento
              </button>
            )}
          </div>
        </div>
      ) : (
        <form key={operationId} onSubmit={submit} className={styles.form}>
          <fieldset disabled={busy || disabled}>
            <legend className="sr-only">Nuovo contenuto</legend>
            <div className={styles.fieldPair}>
              <label>
                Origine
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as "file" | "link")}
                >
                  <option value="file">Carica file</option>
                  <option value="link">Link</option>
                </select>
              </label>
              <label>
                Tipo
                <select
                  value={fields.assetType}
                  onChange={(event) =>
                    setFields({
                      ...fields,
                      assetType: event.target.value as AssetFields["assetType"],
                    })
                  }
                >
                  {ASSET_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {assetTypeLabels[type]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Nome
              <input
                required
                maxLength={240}
                value={fields.name}
                onChange={(event) => setFields({ ...fields, name: event.target.value })}
              />
            </label>
            {mode === "file" ? (
              <label>
                File
                <input
                  type="file"
                  name="file"
                  accept=".png,.jpg,.jpeg,.webp,.mp4,.webm,.svg"
                  required
                />
                <span className={styles.help}>
                  Fino a 25 MB. PNG, JPEG, WebP, MP4, WebM o SVG. Gli SVG si scaricano soltanto.
                </span>
              </label>
            ) : (
              <label>
                Link
                <input
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  required
                  maxLength={2048}
                  placeholder="https://drive.google.com/…"
                />
              </label>
            )}
            <label>
              Descrizione <span>facoltativa</span>
              <textarea
                rows={3}
                maxLength={8000}
                value={fields.description}
                onChange={(event) => setFields({ ...fields, description: event.target.value })}
              />
            </label>
            <button type="submit" className="button button-primary">
              <Upload size={15} aria-hidden="true" />
              {busy ? "Caricamento…" : mode === "file" ? "Carica originale" : "Aggiungi link"}
            </button>
          </fieldset>
        </form>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" className={styles.success}>
          {message}
        </p>
      )}
      {storageWarning && (
        <p className={styles.help}>
          Il browser non conserva il tentativo in sospeso. Mantieni aperta questa pagina finché la
          voce non è confermata.
        </p>
      )}
    </div>
  );
}
