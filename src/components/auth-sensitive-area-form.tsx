"use client";
import { useActionState, useEffect, useRef } from "react";
import { lockArea, unlockArea } from "@/app/auth/area/[area]/actions";
import type { SensitiveArea } from "@/lib/auth/model";
import styles from "./auth.module.css";

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
        {pending
          ? "Chiusura in corso…"
          : `Chiudi ${area === "finance" ? "Finance" : "CEO"} in questa sessione`}
      </button>
    </form>
  );
}
