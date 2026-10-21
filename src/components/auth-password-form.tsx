"use client";

import Link from "next/link";
import { useActionState } from "react";
import { savePassword } from "@/app/auth/password/actions";
import { signOut } from "@/app/auth/actions";
import styles from "./auth.module.css";

export function PasswordForm() {
  const [state, action, pending] = useActionState(savePassword, {});
  if (state.passwordUpdated) return <div className={styles.status}><strong>Password aggiornata</strong><p role="status">{state.error}</p><form action={signOut} className={styles.form}><button className="button button-primary">Completa l’uscita</button></form></div>;
  if (state.mfaRequired) return <div className={styles.status}><p role="alert">Questo account ha già una verifica aggiuntiva configurata. Completa la verifica prima di modificare la password.</p><Link href="/auth/verify" className="button button-primary">Verifica questo account</Link></div>;
  return <form action={action} className={styles.form}><label htmlFor="new-password">Password del tuo account<input id="new-password" name="password" type="password" autoComplete="new-password" minLength={6} maxLength={72} required aria-describedby="password-help" /></label><label htmlFor="confirm-password">Ripeti la password<input id="confirm-password" name="confirmation" type="password" autoComplete="new-password" minLength={6} maxLength={72} required /></label><p id="password-help" className={styles.help}>Almeno 6 caratteri, entro 72 byte. Usa la password del workspace concordata con Tommi. Questa operazione riguarda solo il tuo account.</p>{state.error && <p role="alert" className={styles.error}>{state.error}</p>}<button className="button button-primary" disabled={pending}>{pending ? "Salvataggio in corso…" : "Salva password e accedi di nuovo"}</button></form>;
}
