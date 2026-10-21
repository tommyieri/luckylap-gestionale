"use client";

import { useActionState } from "react";
import { acceptInvitation } from "@/app/auth/confirm/actions";
import type { Invitation } from "@/lib/auth/invitation-model";
import styles from "./auth.module.css";

export function InvitationForm({ invitation }: { invitation: Invitation }) {
  const [state, action, pending] = useActionState(acceptInvitation, {});
  return <form action={action} className={styles.form}><input type="hidden" name="token_hash" value={invitation.token_hash} /><input type="hidden" name="type" value={invitation.type} />{state.error && <p role="alert" className={styles.error}>{state.error}</p>}<button className="button button-primary" disabled={pending}>{pending ? "Conferma in corso…" : invitation.type === "recovery" ? "Conferma recupero" : "Conferma invito"}</button></form>;
}
