"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { previewSaleReturn, registerSaleReturn } from "@/app/sales/returns/actions";
import type { SaleReturnPreview, SaleReturnPreviewInput } from "@/lib/sales-returns/model";
import {
  clearSaleReturn,
  preserveSaleReturn,
  readPendingSaleReturn,
  type PendingSaleReturn,
} from "@/lib/sales-returns/pending";
import { money, romeInputToIso, romeTimeInput } from "@/lib/sales/model";
import styles from "./sale-return-form.module.css";

type State = {
  loaded: boolean;
  open: boolean;
  busy: boolean;
  blocked: boolean;
  available: SaleReturnPreview | null;
  quote: SaleReturnPreview | null;
  quoteInput: SaleReturnPreviewInput | null;
  quantities: Record<string, string>;
  boxes: string;
  stickers: string;
  account: string;
  time: string;
  reason: string;
  confirmed: boolean;
  attempt: PendingSaleReturn | null;
  notice: string;
  success: boolean;
};
const integer = (text: string, max: number) =>
  /^(0|[1-9]\d*)$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) <= max
    ? Number(text)
    : null;

export function SaleReturnForm({
  userId,
  orderId,
  enabled,
  now,
  alreadyCancelled = false,
}: {
  userId: string;
  orderId: string;
  enabled: boolean;
  now: string;
  alreadyCancelled?: boolean;
}) {
  const router = useRouter(),
    bodyId = useId(),
    accountListId = useId(),
    sending = useRef(false);
  const [state, setState] = useState<State>({
    loaded: false,
    open: false,
    busy: false,
    blocked: false,
    available: null,
    quote: null,
    quoteInput: null,
    quantities: {},
    boxes: "0",
    stickers: "0",
    account: "",
    time: romeTimeInput(now),
    reason: "",
    confirmed: false,
    attempt: null,
    notice: "",
    success: false,
  });
  useEffect(() => {
    try {
      const attempt = readPendingSaleReturn(sessionStorage, userId, orderId);
      setState((current) => ({
        ...current,
        loaded: true,
        attempt,
        open: attempt !== null,
        notice: attempt
          ? "Il reso precedente non ha un esito confermato. Verifica lo stesso invio."
          : "",
      }));
    } catch {
      setState((current) => ({
        ...current,
        loaded: true,
        blocked: true,
        notice:
          "Non posso leggere i tentativi conservati. Ripristina l’archiviazione del browser prima di registrare un reso.",
      }));
    }
  }, [userId, orderId]);
  function edit(patch: Partial<State>) {
    setState((current) => ({
      ...current,
      ...patch,
      quote: null,
      quoteInput: null,
      confirmed: false,
      notice: "",
      success: false,
    }));
  }
  async function load(input?: SaleReturnPreviewInput) {
    if (sending.current || !state.loaded || state.blocked || !enabled || alreadyCancelled) return;
    sending.current = true;
    try {
      const attempt = readPendingSaleReturn(sessionStorage, userId, orderId);
      if (attempt) {
        setState((current) => ({
          ...current,
          attempt,
          open: true,
          notice: "Verifica il reso già conservato prima di crearne un altro.",
        }));
        return;
      }
      setState((current) => ({
        ...current,
        busy: true,
        open: true,
        quote: null,
        quoteInput: null,
        notice: "",
        success: false,
        confirmed: false,
      }));
      const result = await previewSaleReturn(
        input ?? {
          userId,
          orderId,
          lines: [],
          reusableBoxes: 0,
          reusableStickers: 0,
          refundAccount: "",
        },
      );
      if (result.status === "rejected") {
        setState((current) => ({ ...current, notice: result.message }));
        return;
      }
      if (result.preview.orderId !== orderId) throw new Error("Anteprima non corrispondente");
      setState((current) => ({
        ...current,
        available: result.preview,
        quote: input ? result.preview : null,
        quoteInput: input ?? null,
      }));
    } catch {
      setState((current) => ({
        ...current,
        notice: "L’anteprima del reso non è disponibile. Rileggi la vendita prima di continuare.",
      }));
    } finally {
      sending.current = false;
      setState((current) => ({ ...current, busy: false }));
    }
  }
  function verify() {
    if (!state.available || state.attempt || state.busy) return;
    const lines: SaleReturnPreviewInput["lines"] = [];
    for (const line of state.available.lines) {
      const quantity = integer(state.quantities[line.orderLineId] ?? "0", line.availableQuantity);
      if (quantity === null) {
        setState((current) => ({
          ...current,
          notice: "Controlla le quantità: non possono superare i capi ancora restituibili.",
        }));
        return;
      }
      if (quantity > 0) lines.push({ orderLineId: line.orderLineId, quantity });
    }
    const boxes = integer(state.boxes, 5_000_000),
      stickers = integer(state.stickers, 5_000_000),
      account = state.account.trim();
    if (!lines.length || boxes === null || stickers === null || !account || account.length > 120) {
      setState((current) => ({
        ...current,
        notice:
          "Scegli almeno un capo, indica il conto del rimborso e controlla il packaging riutilizzabile.",
      }));
      return;
    }
    void load({
      userId,
      orderId,
      lines,
      reusableBoxes: boxes,
      reusableStickers: stickers,
      refundAccount: account,
    });
  }
  async function send(input: PendingSaleReturn, retry = false) {
    if (sending.current || state.blocked || !enabled) return;
    sending.current = true;
    let frozen: PendingSaleReturn;
    try {
      frozen = preserveSaleReturn(sessionStorage, input);
    } catch {
      sending.current = false;
      setState((current) => ({
        ...current,
        blocked: true,
        notice:
          "Non posso conservare il reso senza sovrascrivere un altro tentativo. Nessun invio eseguito: rileggi la pagina.",
      }));
      return;
    }
    setState((current) => ({
      ...current,
      attempt: frozen,
      busy: true,
      notice: "",
      success: false,
    }));
    try {
      const result = await registerSaleReturn({ ...frozen, ...(retry ? { retry: true } : {}) });
      if (result.status === "success" && result.orderId !== orderId)
        throw new Error("Esito non corrispondente");
      const success = result.status === "success",
        definitive =
          success || (result.status === "rejected" && result.code !== "idempotency_conflict");
      let cleared = false;
      if (definitive) {
        try {
          clearSaleReturn(sessionStorage, frozen);
          cleared = true;
        } catch {
          /* Si verifica nuovamente il tentativo conservato. */
        }
      }
      setState((current) => ({
        ...current,
        attempt: cleared ? null : frozen,
        success,
        notice: `${result.message}${definitive && !cleared ? " Il tentativo resta conservato: verifica lo stesso invio per chiuderlo." : ""}`,
        available: definitive ? null : current.available,
        quote: null,
        quoteInput: null,
        confirmed: false,
        quantities: success ? {} : current.quantities,
        boxes: success ? "0" : current.boxes,
        stickers: success ? "0" : current.stickers,
        open: true,
      }));
      if (success) {
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
          "Connessione interrotta: il reso potrebbe essere già registrato. Verifica lo stesso invio senza creare un nuovo reso.",
        success: false,
      }));
    } finally {
      sending.current = false;
      setState((current) => ({ ...current, busy: false }));
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      sending.current ||
      !state.loaded ||
      state.busy ||
      state.blocked ||
      state.attempt ||
      !state.quote ||
      !state.quoteInput ||
      !state.confirmed ||
      !enabled ||
      alreadyCancelled
    )
      return;
    const occurredAt = romeInputToIso(state.time),
      reason = state.reason.trim();
    if (
      !occurredAt ||
      Date.parse(occurredAt) > Date.now() ||
      reason.length < 3 ||
      reason.length > 500
    ) {
      setState((current) => ({
        ...current,
        notice:
          "Controlla la data del rimborso già effettuato e scrivi un motivo da 3 a 500 caratteri.",
      }));
      return;
    }
    void send({
      ...state.quoteInput,
      operationId: crypto.randomUUID(),
      expectedVersion: state.quote.expectedVersion,
      occurredAt,
      reason,
      refundCompletedConfirmed: true,
    });
  }
  if (alreadyCancelled && !state.attempt) return null;
  return (
    <section className={styles.root} aria-busy={state.busy}>
      {!state.open && (
        <button
          type="button"
          className="button button-secondary"
          disabled={!state.loaded || !enabled || state.blocked}
          aria-expanded={false}
          aria-controls={bodyId}
          onClick={() => void load()}
        >
          Registra reso
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
        <div id={bodyId} className={styles.body}>
          <h3>Registra reso</h3>
          {state.attempt ? (
            <div className={styles.pending}>
              <strong>Reso da verificare</strong>
              <p>
                Quantità, conto, data e motivo sono conservati. La verifica ripete lo stesso invio.
              </p>
              <p>
                {state.attempt.lines.reduce((total, line) => total + line.quantity, 0)} capi ·{" "}
                {state.attempt.reusableBoxes} scatole · {state.attempt.reusableStickers} adesivi
              </p>
              <p>
                Conto rimborso: {state.attempt.refundAccount} · Motivo: {state.attempt.reason}
              </p>
              <button
                type="button"
                className="button button-primary"
                disabled={state.busy || state.blocked || !enabled}
                onClick={() => void send(state.attempt!, true)}
              >
                {state.busy ? "Verifica in corso…" : "Verifica lo stesso invio"}
              </button>
              <details className={styles.assistance}>
                <summary>Codice per l’assistenza</summary>
                <span>{state.attempt.operationId}</span>
              </details>
            </div>
          ) : state.available ? (
            <form onSubmit={submit} className={styles.form}>
              <p>
                Registra insieme la merce rientrata e il rimborso già effettuato. Il gestionale
                aggiorna le scorte e Finance; non esegue pagamenti.
              </p>
              <fieldset disabled={state.busy || state.blocked || !enabled}>
                <div className={styles.lines}>
                  {state.available.lines
                    .filter((line) => line.availableQuantity > 0)
                    .map((line) => (
                      <label key={line.orderLineId} className={styles.line}>
                        <span>
                          <strong>{line.sku}</strong>
                          <small>{line.availableQuantity} capi ancora restituibili</small>
                        </span>
                        <span>
                          Quantità resa
                          <input
                            aria-label={`Quantità resa ${line.sku}`}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={line.availableQuantity}
                            step={1}
                            value={state.quantities[line.orderLineId] ?? "0"}
                            onChange={(event) =>
                              edit({
                                quantities: {
                                  ...state.quantities,
                                  [line.orderLineId]: event.target.value,
                                },
                              })
                            }
                          />
                        </span>
                      </label>
                    ))}
                </div>
                {!state.available.lines.some((line) => line.availableQuantity > 0) && (
                  <p>Non ci sono capi consegnati ancora restituibili.</p>
                )}
                <div className={styles.grid}>
                  <label>
                    Scatole rientrate e riutilizzabili
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={5_000_000}
                      step={1}
                      value={state.boxes}
                      onChange={(event) => edit({ boxes: event.target.value })}
                    />
                  </label>
                  <label>
                    Adesivi rientrati e riutilizzabili
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={5_000_000}
                      step={1}
                      value={state.stickers}
                      onChange={(event) => edit({ stickers: event.target.value })}
                    />
                  </label>
                </div>
                <p className={styles.help}>
                  Lascia zero per il packaging che non è rientrato o non è riutilizzabile.
                </p>
                <label>
                  Conto da cui è stato effettuato il rimborso
                  <input
                    list={accountListId}
                    maxLength={120}
                    required
                    value={state.account}
                    onChange={(event) => edit({ account: event.target.value })}
                  />
                  <datalist id={accountListId}>
                    <option value="Cash" />
                    <option value="Revolut Business" />
                  </datalist>
                </label>
                <div className={styles.grid}>
                  <label>
                    Data e ora rimborso · Europe/Rome
                    <input
                      type="datetime-local"
                      step="1"
                      required
                      value={state.time}
                      onChange={(event) =>
                        setState((current) => ({
                          ...current,
                          time: event.target.value,
                          confirmed: false,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Motivo del reso
                    <textarea
                      rows={2}
                      minLength={3}
                      maxLength={500}
                      required
                      value={state.reason}
                      onChange={(event) =>
                        setState((current) => ({
                          ...current,
                          reason: event.target.value,
                          confirmed: false,
                        }))
                      }
                    />
                  </label>
                </div>
                <button type="button" className="button button-secondary" onClick={verify}>
                  {state.busy ? "Verifica in corso…" : "Verifica reso"}
                </button>
                {state.quote && (
                  <div className={styles.quote}>
                    <dl>
                      <div>
                        <dt>Capi da ricaricare</dt>
                        <dd>{state.quote.productQuantity}</dd>
                      </div>
                      <div>
                        <dt>Scatole riutilizzabili</dt>
                        <dd>{state.quote.boxQuantity}</dd>
                      </div>
                      <div>
                        <dt>Adesivi riutilizzabili</dt>
                        <dd>{state.quote.stickerQuantity}</dd>
                      </div>
                      <div>
                        <dt>Rimborso da registrare</dt>
                        <dd>{money(state.quote.refundCents)}</dd>
                      </div>
                    </dl>
                    <p className={styles.help}>
                      Il rimborso usa il prezzo effettivo della vendita, inclusi gli sconti.
                    </p>
                    <label className={styles.confirmation}>
                      <input
                        type="checkbox"
                        checked={state.confirmed}
                        required
                        onChange={(event) =>
                          setState((current) => ({ ...current, confirmed: event.target.checked }))
                        }
                      />
                      <span>
                        Confermo che la merce è rientrata, il rimborso indicato è già stato
                        effettuato e il packaging dichiarato è riutilizzabile.
                      </span>
                    </label>
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={!state.confirmed || state.reason.trim().length < 3}
                    >
                      Registra rientro e rimborso
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      open: false,
                      quote: null,
                      quoteInput: null,
                      confirmed: false,
                      available: null,
                      notice: "",
                    }))
                  }
                >
                  Chiudi senza registrare
                </button>
              </fieldset>
            </form>
          ) : (
            <div>
              {state.busy ? (
                <p role="status">Rileggo la vendita…</p>
              ) : (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={state.blocked || !enabled}
                  onClick={() => void load()}
                >
                  {state.success ? "Registra un altro reso" : "Rileggi la vendita"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
