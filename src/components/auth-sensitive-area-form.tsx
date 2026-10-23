"use client";
import { useActionState, useEffect, useRef } from "react";
import { LockOpen } from "lucide-react";
import { lockArea, unlockArea } from "@/app/auth/area/[area]/actions";
import type { SensitiveArea } from "@/lib/auth/model";
import styles from "./auth.module.css";

/** Il pulsante di chiusura ha lo stesso nome ovunque: area, account e pagine dell'area. */
export const AREA_LOCK_LABEL: Record<SensitiveArea, string> = {
  finance: "Chiudi Finance",
  audit: "Chiudi Controllo CEO",
};
const AREA_OPEN_TEXT: Record<SensitiveArea, string> = {
  finance: "Finance aperta su questo dispositivo, fino a 8 ore dall’apertura.",
  audit: "Controllo CEO aperto su questo dispositivo, fino a 8 ore dall’apertura.",
};
const AREA_PREVIEW_TEXT: Record<SensitiveArea, string> = {
  finance: "Anteprima locale: la chiusura di Finance è disattivata.",
  audit: "Anteprima locale: la chiusura di Controllo CEO è disattivata.",
};

export function SensitiveAreaForm({ area }: { area: SensitiveArea }) {
  const [state, action, pending] = useActionState(unlockArea.bind(null, area), {});
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.value = "";
  }, [state]);
  return (
    <form action={action} className={styles.form}>
      <label htmlFor="area-password">
        Password {area === "finance" ? "Finance" : "CEO"}
        <input
          ref={input}
          id="area-password"
          name="password"
          type="password"
          autoComplete="off"
          minLength={6}
          maxLength={72}
          required
          aria-describedby={area === "audit" ? "area-help" : undefined}
        />
      </label>
      {area === "audit" && (
        <p id="area-help" className={styles.help}>
          Usa la password CEO scelta da Tommi. L’apertura vale per questa sessione, fino a 8 ore.
        </p>
      )}
      {state.error && (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      <button className="button button-primary" disabled={pending}>
        {pending ? "Verifica in corso…" : "Apri l’area"}
      </button>
    </form>
  );
}

export function SensitiveAreaLockForm({ area }: { area: SensitiveArea }) {
  const [state, action, pending] = useActionState(lockArea.bind(null, area), {});
  return (
    <form action={action} className={styles.form}>
      {state.error && (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      <button className="button button-secondary" disabled={pending}>
        {pending ? "Chiusura in corso…" : AREA_LOCK_LABEL[area]}
      </button>
    </form>
  );
}

/**
 * Striscia in cima alle pagine di un'area con password (06 R12): dice che l'area è aperta
 * e la chiude subito, con la stessa azione di «Account e sicurezza». La pagina la mostra
 * solo dopo aver verificato l'area aperta. In anteprima locale il pulsante è spento.
 */
export function SensitiveAreaSessionBar({
  area,
  preview = false,
}: {
  area: SensitiveArea;
  preview?: boolean;
}) {
  const [state, action, pending] = useActionState(lockArea.bind(null, area), {});
  return (
    <form action={action} className={styles.sessionBar}>
      <p className={styles.sessionText}>
        <LockOpen size={16} aria-hidden="true" />
        {preview ? AREA_PREVIEW_TEXT[area] : AREA_OPEN_TEXT[area]}
      </p>
      <button className="button button-secondary" disabled={pending || preview}>
        {pending ? "Chiusura in corso…" : AREA_LOCK_LABEL[area]}
      </button>
      {state.error && (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
    </form>
  );
}
