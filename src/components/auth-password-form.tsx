"use client";

import Link from "next/link";
import { useActionState } from "react";
import { savePassword } from "@/app/auth/password/actions";
import { signOut } from "@/app/auth/actions";
import styles from "./auth.module.css";

export function PasswordForm() {
  const [state, action, pending] = useActionState(savePassword, {});
  if (state.passwordUpdated) return <div className={styles.status}><strong>Password aggiornata</strong><p role="status">{state.error}</p><form action={signOut} className={styles.form}><button className="button button-primary">Completa l’uscita</button></form></div>;
  if (state.mfaRequired) return <div className={styles.status}><p role="alert">Verifica la sessione con l’app di autenticazione prima di modificare la password.</p><Link href="/auth/account" className="button button-primary">Verifica la sessione</Link></div>;
  return <form action={action} className={styles.form}><label htmlFor="new-password">Nuova password<input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required aria-describedby="password-help" /></label><label htmlFor="confirm-password">Ripeti la nuova password<input id="confirm-password" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label><p id="password-help" className={styles.help}>Usa fra 12 e 128 caratteri. Puoi scegliere una frase lunga; evita password già usate per altri servizi.</p>{state.error && <p role="alert" className={styles.error}>{state.error}</p>}<button className="button button-primary" disabled={pending}>{pending ? "Salvataggio in corso…" : "Salva password e accedi di nuovo"}</button></form>;
}
