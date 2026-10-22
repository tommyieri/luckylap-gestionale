"use client";

import { useActionState } from "react";
import { signIn } from "@/app/auth/actions";
import styles from "./auth.module.css";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <form action={action} className={styles.form}>
      <label htmlFor="email">
        La tua email del team
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
        />
      </label>
      <label htmlFor="password">
        Password del workspace
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={6}
          maxLength={72}
        />
      </label>
      {state.error && (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
      <button className="button button-primary" disabled={pending}>
        {pending ? "Accesso in corso…" : "Accedi al workspace"}
      </button>
      <p className={styles.help}>
        Usa la tua email e la password del workspace condivisa dal team. Per le credenziali
        rivolgiti a Tommi.
      </p>
    </form>
  );
}
