"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { cancelSaleRegistration, previewSaleCancellation } from "@/app/sales/cancellation/actions";
import type { SaleCancellationPreview } from "@/lib/sales-cancellation/model";
import {
  clearSaleCancellation,
  preserveSaleCancellation,
  readPendingSaleCancellation,
  type PendingSaleCancellation,
} from "@/lib/sales-cancellation/pending";
import { money } from "@/lib/sales/model";
import styles from "./sale-registration-cancellation.module.css";

type State = {
  loaded: boolean;
  open: boolean;
  busy: "preview" | "send" | null;
  preview: SaleCancellationPreview | null;
  attempt: PendingSaleCancellation | null;
  reason: string;
  confirmStock: boolean;
  blocked: boolean;
  finished: boolean;
  notice: string;
  success: boolean;
};

export function SaleRegistrationCancellation({
  userId,
  orderId,
  enabled,
  alreadyCancelled = false,
}: {
  userId: string;
  orderId: string;
  enabled: boolean;
  alreadyCancelled?: boolean;
}) {
  const router = useRouter();
  const headingId = useId();
  const bodyId = useId();
  const reasonId = useId();
  const sending = useRef(false);
  const [state, setState] = useState<State>({
    loaded: false,
    open: false,
    busy: null,
    preview: null,
    attempt: null,
    reason: "",
    confirmStock: false,
    blocked: false,
    finished: alreadyCancelled,
    notice: "",
    success: false,
  });

  useEffect(() => {
    try {
      const attempt = readPendingSaleCancellation(sessionStorage, userId, orderId);
      setState((current) => ({
        ...current,
        loaded: true,
        attempt,
        open: attempt !== null,
        finished: alreadyCancelled,
        notice: attempt
          ? "L’annullamento precedente non ha un esito confermato. Verifica lo stesso invio."
          : "",
      }));
    } catch {
      setState((current) => ({
        ...current,
        loaded: true,
        blocked: true,
        notice:
          "Non riesco a leggere i tentativi conservati in questa scheda. Ripristina l’archiviazione del browser prima di annullare la registrazione.",
      }));
    }
  }, [userId, orderId, alreadyCancelled]);

  async function loadPreview() {
    if (sending.current || !state.loaded || !enabled || state.blocked || state.finished) return;
    sending.current = true;
    try {
      const attempt = readPendingSaleCancellation(sessionStorage, userId, orderId);
      if (attempt) {
        setState((current) => ({
          ...current,
          attempt,
          open: true,
          preview: null,
          notice: "Verifica il tentativo già conservato prima di iniziarne un altro.",
          success: false,
        }));
        return;
      }
      setState((current) => ({
        ...current,
        open: true,
        busy: "preview",
        preview: null,
        confirmStock: false,
        notice: "",
        success: false,
      }));
      const result = await previewSaleCancellation({ userId, orderId });
      if (result.status === "rejected") {
        setState((current) => ({ ...current, notice: result.message }));
        return;
      }
      if (result.preview.orderId !== orderId) {
        setState((current) => ({
          ...current,
          notice: "L’anteprima non corrisponde alla vendita. Rileggi i dati prima di continuare.",
        }));
        return;
      }
      setState((current) => ({
        ...current,
        preview: result.preview,
        finished: result.preview.alreadyCancelled,
        success: result.preview.alreadyCancelled,
        notice: result.preview.alreadyCancelled ? "La registrazione è già annullata." : "",
      }));
    } catch {
      setState((current) => ({
        ...current,
        notice: "L’anteprima non è disponibile. Riprova a rileggere i dati della vendita.",
      }));
    } finally {
      sending.current = false;
      setState((current) => ({ ...current, busy: null }));
    }
  }

  async function send(attempt: PendingSaleCancellation, retry = false) {
    if (sending.current || !enabled || state.blocked) return;
    sending.current = true;
    let frozen: PendingSaleCancellation;
    try {
      frozen = preserveSaleCancellation(sessionStorage, attempt);
    } catch {
      setState((current) => ({
        ...current,
        blocked: true,
        notice:
          "Non posso conservare questo tentativo senza sovrascriverne un altro. Nessun invio eseguito: rileggi la pagina prima di continuare.",
        success: false,
      }));
      sending.current = false;
      return;
    }
    setState((current) => ({
      ...current,
      attempt: frozen,
      busy: "send",
      notice: "",
      success: false,
    }));
    try {
      const result = await cancelSaleRegistration({ ...frozen, ...(retry ? { retry: true } : {}) });
      if (result.status === "success" && result.orderId !== orderId)
        throw new Error("Esito non corrispondente alla vendita");
      const successful = result.status === "success";
      const definitive =
        successful || (result.status === "rejected" && result.code !== "idempotency_conflict");
      let cleared = false;
      if (definitive) {
        try {
          clearSaleCancellation(sessionStorage, frozen);
          cleared = true;
        } catch {
          /* L’esito resta certo; il tentativo conservato si può solo verificare di nuovo. */
        }
      }
      setState((current) => ({
        ...current,
        attempt: cleared ? null : frozen,
        preview: definitive ? null : current.preview,
        confirmStock: definitive ? false : current.confirmStock,
        finished: successful || current.finished,
        notice: `${result.message}${definitive && !cleared ? " Il tentativo è ancora conservato nel browser: verifica lo stesso invio per chiuderlo." : ""}`,
        success: successful,
      }));
      if (successful) {
        try {
          router.refresh();
        } catch {
          setState((current) => ({
            ...current,
            notice: `${result.message} Ricarica la pagina per vedere i dati aggiornati.`,
          }));
        }
      }
    } catch {
      setState((current) => ({
        ...current,
        notice:
          "La connessione si è interrotta: l’annullamento potrebbe essere già registrato. Verifica lo stesso invio senza crearne un altro.",
        success: false,
      }));
    } finally {
      sending.current = false;
      setState((current) => ({ ...current, busy: null }));
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !state.loaded ||
      sending.current ||
      state.busy ||
      state.blocked ||
      state.attempt ||
      state.finished ||
      !state.preview ||
      !state.confirmStock ||
      !enabled
    )
      return;
    const reason = state.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      setState((current) => ({ ...current, notice: "Scrivi un motivo da 3 a 500 caratteri." }));
      return;
    }
    void send({
      operationId: crypto.randomUUID(),
      userId,
      orderId,
      expectedVersion: state.preview.expectedVersion,
      reason,
      confirmStock: true,
    });
  }

  if (state.finished && !state.attempt)
    return (
      <div className={styles.root}>
        <p role="status" className={styles.success}>
          {state.notice || "Registrazione annullata. Lo storico resta consultabile."}
        </p>
      </div>
    );

  return (
    <section className={styles.root} aria-busy={state.busy !== null}>
      {!state.open && (
        <button
          type="button"
          className="button button-secondary"
          aria-expanded={false}
          aria-controls={bodyId}
          disabled={!state.loaded || !enabled || state.blocked}
          onClick={() => void loadPreview()}
        >
          Annulla registrazione
        </button>
      )}
      {state.notice && (
        <p
          role={state.success ? "status" : "alert"}
          className={state.success ? styles.success : styles.feedback}
        >
          {state.notice}
        </p>
      )}
      {state.open && (
        <div id={bodyId} aria-labelledby={headingId} className={styles.body}>
          <h3 id={headingId}>Annulla registrazione</h3>
          {state.busy === "preview" && <p role="status">Rileggo la vendita…</p>}
          {state.attempt ? (
            <div className={styles.pending}>
              <strong>Annullamento da verificare</strong>
              <p>Il motivo e i dati sono conservati. La verifica ripete lo stesso invio.</p>
              <p>Motivo: {state.attempt.reason}</p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={state.busy !== null || state.blocked || !enabled}
                  onClick={() => void send(state.attempt!, true)}
                >
                  {state.busy === "send" ? "Verifica in corso…" : "Verifica lo stesso invio"}
                </button>
              </div>
              <details className={styles.assistance}>
                <summary>Codice per l’assistenza</summary>
                <span>{state.attempt.operationId}</span>
              </details>
            </div>
          ) : state.preview ? (
            <form onSubmit={submit} className={styles.form}>
              <p>
                Per una vendita di prova o registrata per errore: annulli la registrazione,
                ripristini le scorte e storni l’incasso in Finance.
              </p>
              <dl className={styles.quantities}>
                <div>
                  <dt>Capi da ripristinare</dt>
                  <dd>{state.preview.productQuantity}</dd>
                </div>
                <div>
                  <dt>Scatole da ripristinare</dt>
                  <dd>{state.preview.boxQuantity}</dd>
                </div>
                <div>
                  <dt>Adesivi da ripristinare</dt>
                  <dd>{state.preview.stickerQuantity}</dd>
                </div>
                <div>
                  <dt>Effetto Finance da escludere</dt>
                  <dd>{money(state.preview.paymentCents)}</dd>
                </div>
              </dl>
              <p className={styles.help}>
                L’operazione aggiorna insieme vendita, magazzino, packaging e Finance. Lo storico
                viene conservato. Per merce realmente venduta e restituita serve un reso.
              </p>
              <fieldset disabled={state.busy !== null || state.blocked || !enabled}>
                <label htmlFor={reasonId}>Motivo dell’annullamento</label>
                <textarea
                  id={reasonId}
                  name="reason"
                  rows={2}
                  minLength={3}
                  maxLength={500}
                  required
                  value={state.reason}
                  onChange={(event) =>
                    setState((current) => ({ ...current, reason: event.target.value }))
                  }
                />
                <label className={styles.confirmation}>
                  <input
                    type="checkbox"
                    required
                    checked={state.confirmStock}
                    onChange={(event) =>
                      setState((current) => ({ ...current, confirmStock: event.target.checked }))
                    }
                  />
                  <span>
                    Confermo che la merce e il packaging non sono realmente usciti dal magazzino e
                    che l’eventuale incasso è stato registrato per errore.
                  </span>
                </label>
                <div className={styles.actions}>
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={!state.confirmStock || state.reason.trim().length < 3}
                  >
                    Conferma annullamento
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() =>
                      setState((current) => ({
                        ...current,
                        open: false,
                        preview: null,
                        confirmStock: false,
                        notice: "",
                      }))
                    }
                  >
                    Mantieni la vendita
                  </button>
                </div>
              </fieldset>
            </form>
          ) : (
            state.busy === null && (
              <button
                type="button"
                className="button button-secondary"
                disabled={state.blocked || !enabled}
                onClick={() => void loadPreview()}
              >
                Rileggi l’anteprima
              </button>
            )
          )}
        </div>
      )}
    </section>
  );
}
