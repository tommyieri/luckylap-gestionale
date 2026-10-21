"use client";

import { useActionState } from "react";
import { enrollTotp, verifyTotp } from "@/app/auth/actions";
import styles from "./auth.module.css";

export function MfaForms({ factors }: { factors: { id: string; name: string }[] }) {
  const [enrollment, enrollAction, enrolling] = useActionState(enrollTotp, {});
  const [verification, verifyAction, verifying] = useActionState(verifyTotp, {});
  const factorId = enrollment.factorId;
  return <section className={styles.mfaSection}><h2>App di autenticazione</h2>{!factors.length && !factorId && <><p>Collega un’app di autenticazione per generare un codice temporaneo. Serve prima di accedere alle aree riservate.</p><form action={enrollAction} className={styles.form}><button className="button button-primary" disabled={enrolling}>{enrolling ? "Configurazione in corso…" : "Configura la verifica"}</button></form></>}{enrollment.error && <p role="alert" className={styles.error}>{enrollment.error}</p>}{factorId && <><p>Inquadra il codice con l’app di autenticazione e inserisci il primo codice a 6 cifre. Conserva la chiave in un luogo sicuro.</p><img className={styles.qr} src={enrollment.qrCode} alt="Codice QR per configurare l’app di autenticazione LuckyLap" width={210} height={210} /><p>Chiave per l’inserimento manuale:</p><code className={styles.secret}>{enrollment.secret}</code></>}{(factorId || factors.length > 0) && <form action={verifyAction} className={styles.form}>{factorId ? <input type="hidden" name="factorId" value={factorId} /> : <label htmlFor="factorId">App configurata<select id="factorId" name="factorId">{factors.map(factor => <option key={factor.id} value={factor.id}>{factor.name}</option>)}</select></label>}<label htmlFor="code">Codice temporaneo<input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label>{verification.error && <p role="alert" className={styles.error}>{verification.error}</p>}<button className="button button-primary" disabled={verifying}>{verifying ? "Verifica in corso…" : "Verifica la sessione"}</button></form>}</section>;
}
