"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runSalesCommand } from "@/app/sales/actions";
import { PENDING_SALES_EVENT, recoverPendingSales } from "@/lib/sales/pending";
import styles from "./sales-workspace.module.css";

const labels: Record<string, string> = { register_manual_sale: "Vendita", fulfill_order_lines: "Consegna", cancel_unfulfilled_lines: "Annullo", complete_production: "Ricevimento produzione", record_manual_payment: "Incasso" };
type Recovery = ReturnType<typeof recoverPendingSales>;
export function SalesPendingRecovery({ userId, activeScopes }: { userId: string; activeScopes: string[] }) {
  const [saved, setSaved] = useState<Recovery>({ entries: [], unreadable: false }), [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter(), scopesKey = activeScopes.join("|");
  useEffect(() => {
    const read = () => { try { setSaved(recoverPendingSales(sessionStorage, userId, scopesKey.split("|"))); } catch { setSaved({ entries: [], unreadable: true }); } };
    read(); window.addEventListener(PENDING_SALES_EVENT, read); window.addEventListener("storage", read);
    return () => { window.removeEventListener(PENDING_SALES_EVENT, read); window.removeEventListener("storage", read); };
  }, [userId, scopesKey]);
  if (!saved.entries.length && !saved.unreadable && !message) return null;
  return <section className={styles.notice} aria-label="Recupero degli invii sospesi"><strong>Invii da verificare</strong><p>Un’operazione può risultare già completata dopo un’interruzione. Questi tentativi restano recuperabili anche se il modulo originale non compare più.</p>{saved.unreadable && <p role="alert">Un tentativo conservato non è leggibile. Verifica con Tommi prima di registrare nuovamente la stessa operazione.</p>}{message && <p role="status">{message}</p>}{saved.entries.map(entry => <div key={entry.key} className={styles.pending}><strong>{labels[entry.command.kind]}</strong><p>Invio {entry.command.operationId} · Data dichiarata {String(entry.command.payload.occurred_at)}</p><button type="button" className="button button-primary" disabled={pending} onClick={() => startTransition(async () => {
    try {
      const result = await runSalesCommand({ ...entry.command, retry: true }); setMessage(result.message);
      if (result.status === "success" || result.status === "rejected" && result.code !== "idempotency_conflict") {
        sessionStorage.removeItem(entry.key); window.dispatchEvent(new Event(PENDING_SALES_EVENT)); router.refresh();
      }
    } catch { setMessage("L’esito non è confermato. Il tentativo resta conservato: verifica di nuovo senza creare una nuova operazione."); }
  })}>{pending ? "Verifica in corso…" : "Verifica lo stesso invio"}</button></div>)}</section>;
}
