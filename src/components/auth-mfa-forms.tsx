"use client";

import { useActionState } from "react";
import { verifyTotp } from "@/app/auth/actions";
import styles from "./auth.module.css";

export function ExistingTotpForm({ factors }: { factors: { id: string; name: string }[] }) {
  const [verification, verifyAction, verifying] = useActionState(verifyTotp, {});
  return <form action={verifyAction} className={styles.form}><label htmlFor="factorId">Verifica già configurata<select id="factorId" name="factorId">{factors.map(factor => <option key={factor.id} value={factor.id}>{factor.name}</option>)}</select></label><label htmlFor="code">Codice temporaneo<input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label>{verification.error && <p role="alert" className={styles.error}>{verification.error}</p>}<button className="button button-primary" disabled={verifying}>{verifying ? "Verifica in corso…" : "Verifica questo account"}</button></form>;
}
