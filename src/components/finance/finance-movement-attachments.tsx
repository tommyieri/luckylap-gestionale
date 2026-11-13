"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Paperclip } from "lucide-react";
import type { FinanceMovement } from "../../lib/finance/dashboard";
import {
  attachmentSourceKind,
  financeAttachmentContentType,
  FINANCE_ATTACHMENT_MAX_BYTES,
  type FinanceAttachment,
} from "../../lib/finance/movement-attachments";
import styles from "./finance-movement-attachments.module.css";

const endpoint = "/finance/movement-attachments";

export function FinanceMovementAttachments({
  source,
  sourceId,
}: Pick<FinanceMovement, "source" | "sourceId">) {
  const sourceKind = attachmentSourceKind(source);
  const query = new URLSearchParams({ source: sourceKind, sourceId });
  const href = `${endpoint}?${query}`;
  const [attachments, setAttachments] = useState<FinanceAttachment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const request = new AbortController();
    fetch(href, { cache: "no-store", signal: request.signal })
      .then(async (result) => {
        const data = await result.json();
        if (request.signal.aborted) return;
        if (!result.ok) throw Error(data.message);
        const listed = data.attachments as FinanceAttachment[];
        setAttachments((current) => [
          ...listed,
          ...(current ?? []).filter(
            (attachment) => !listed.some((row) => row.id === attachment.id),
          ),
        ]);
      })
      .catch(() => {
        if (!request.signal.aborted) setError("Lettura degli allegati non riuscita.");
      });
    return () => request.abort();
  }, [href]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    setMessage("");
    setError("");
    if (!(file instanceof File) || !file.size || file.size > FINANCE_ATTACHMENT_MAX_BYTES) {
      setError("Scegli un file PDF fino a 4 MB.");
      return;
    }
    data.set("source", sourceKind);
    data.set("sourceId", sourceId);
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message || "Allegato temporaneamente non disponibile.");
        return;
      }
      const attachment = result.attachment as FinanceAttachment;
      setAttachments((current) => [
        ...(current ?? []).filter((row) => row.id !== attachment.id),
        attachment,
      ]);
      setMessage("Allegato salvato.");
      form.reset();
    } catch {
      setError("Caricamento da completare. Riprova con lo stesso file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.attachments} aria-labelledby="finance-movement-attachments">
      <h3 id="finance-movement-attachments">Allegati</h3>
      {attachments && attachments.length > 0 && (
        <ul>
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <a href={`${endpoint}?id=${attachment.id}`}>
                <Paperclip aria-hidden size={16} /> {attachment.fileName}
              </a>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={upload}>
        <label>
          <span>Fattura o ricevuta (PDF fino a 4 MB)</span>
          <input
            name="file"
            type="file"
            accept={financeAttachmentContentType}
            required
            disabled={busy}
          />
        </label>
        <button className="button button-secondary" type="submit" disabled={busy}>
          {busy ? "Caricamento…" : "Allega file"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
