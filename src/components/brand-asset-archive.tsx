"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { setBrandAssetArchived } from "../app/assets/actions";
import { TEAM_TIME_ZONE } from "../lib/team/model";
import styles from "./brand-assets.module.css";

const archivedDay = new Intl.DateTimeFormat("it-IT", {
  timeZone: TEAM_TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** «22 ottobre 2026» (Roma); `null` se la data non è leggibile. */
export function archivedDate(value: string): string | null {
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? archivedDay.format(instant) : null;
}

/**
 * Archivia o ripristina un contenuto della libreria (docs/assets-development.md, «Archivio dei
 * contenuti»). Non cancella niente: il contenuto esce dalla libreria per tutti e torna con
 * «Ripristina». Un solo invio alla volta; dopo un esito incerto «Riprova» ripete lo stesso
 * operation_id, così il database restituisce l'esito di allora.
 */
export function BrandAssetArchive({
  assetId,
  assetName,
  archivedAt,
  disabled = false,
  onDone,
}: {
  assetId: string;
  assetName: string;
  archivedAt: string | null;
  /** Anteprima locale: nessun invio. */
  disabled?: boolean;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const operation = useRef<string | null>(null);
  const archive = archivedAt === null;

  function send() {
    if (sending.current || disabled) return;
    sending.current = true;
    operation.current ??= crypto.randomUUID();
    const operationId = operation.current;
    setError("");
    startTransition(async () => {
      try {
        const result = await setBrandAssetArchived({ operationId, assetId, archived: archive });
        if (result.error) {
          setError(result.error);
          return;
        }
        operation.current = null;
        onDone(result.success ?? "Fatto.");
        router.refresh();
      } catch {
        setError(
          archive
            ? "Archiviazione non riuscita. Ricarica e riprova."
            : "Ripristino non riuscito. Ricarica e riprova.",
        );
      } finally {
        sending.current = false;
      }
    });
  }

  if (!archive) {
    const day = archivedDate(archivedAt);
    return (
      <div className={styles.archive}>
        <p className={styles.archivedNote}>
          {day ? `Archiviato il ${day}.` : "Archiviato."} Non compare nella libreria.
        </p>
        <button
          type="button"
          className="button button-secondary"
          disabled={pending || disabled}
          onClick={send}
        >
          <ArchiveRestore size={15} aria-hidden="true" />
          {pending ? "Ripristino…" : "Ripristina"}
          <span className="sr-only"> {assetName}</span>
        </button>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
    );
  }
  return (
    <details className={styles.archive}>
      <summary>
        <Archive size={15} aria-hidden="true" />
        Archivia
        <span className="sr-only"> {assetName}</span>
      </summary>
      <p>
        Il contenuto sparisce dalla libreria per tutti. Puoi ripristinarlo da «Mostra archiviati».
        Il file resta nell’archivio privato del team.
      </p>
      <button
        type="button"
        className="button button-secondary"
        disabled={pending || disabled}
        onClick={send}
      >
        {pending ? "Archiviazione…" : "Archivia il contenuto"}
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </details>
  );
}
