"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { updatePackaging } from "@/app/packaging/actions";
import type { VerifiedMember } from "@/lib/auth/model";
import { stockQuantity } from "@/lib/stock/model";
import {
  parseSimplePackagingCommand,
  simpleQuantityInput,
  type SimplePackagingCommand,
  type SimplePackagingItem,
  type SimplePackagingSnapshot,
} from "@/lib/packaging/simple";
import { PendingAttempt } from "./pending-attempt";
import stock from "./stock-workspace.module.css";
import styles from "./packaging-workspace.module.css";

export function PackagingWorkspace({
  snapshot,
  member,
}: {
  snapshot: SimplePackagingSnapshot;
  member: VerifiedMember;
}) {
  const router = useRouter(),
    storageKey = `luckylap.packaging.simple.pending:${member.userId}`;
  const [editing, setEditing] = useState<string | null>(null),
    [command, setCommand] = useState<SimplePackagingCommand | null>(null);
  const [loaded, setLoaded] = useState(false),
    [blocked, setBlocked] = useState(false),
    [notice, setNotice] = useState(""),
    [success, setSuccess] = useState(false),
    // Tentativi che non potranno mai riuscire (06 R11): illeggibile o in conflitto.
    [unreadable, setUnreadable] = useState(false),
    [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition(),
    [refreshing, refreshTransition] = useTransition();
  const sending = useRef(false);
  const locked = !loaded || blocked || pending || command !== null;
  const deficit = snapshot.items.reduce((sum, item) => sum + item.deficit, 0),
    reconcilable = snapshot.items.reduce((sum, item) => sum + item.reconcilable, 0);
  const historical = snapshot.items.reduce((sum, item) => sum + item.historicalReview, 0);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        let saved: SimplePackagingCommand | null = null;
        try {
          saved = parseSimplePackagingCommand(JSON.parse(raw));
        } catch {
          saved = null;
        }
        if (saved) setCommand(saved);
        else {
          setBlocked(true);
          setUnreadable(true);
        }
      }
    } catch {
      setBlocked(true);
      setNotice(
        "Il browser non conserva i riferimenti degli invii. Riattiva l’archiviazione della sessione prima di modificare quantità.",
      );
    }
    setLoaded(true);
  }, [storageKey]);
  function send(next: SimplePackagingCommand) {
    if (sending.current) return;
    sending.current = true;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      sending.current = false;
      setSuccess(false);
      setNotice("Invio non eseguito: il browser non conserva il riferimento dell’operazione.");
      return;
    }
    setCommand(next);
    setSuccess(false);
    startTransition(async () => {
      try {
        const result = await updatePackaging(next);
        setNotice(result.message);
        if (result.status === "success") {
          setSuccess(true);
          try {
            sessionStorage.removeItem(storageKey);
            setCommand(null);
            setEditing(null);
          } catch {
            setNotice(`${result.message} Verifica il riferimento conservato prima di continuare.`);
          }
          router.refresh();
        } else if (result.status === "rejected" && result.code !== "idempotency_conflict") {
          try {
            sessionStorage.removeItem(storageKey);
            setCommand(null);
          } catch {
            /* Preserve the unresolved reference. */
          }
          if (result.code === "packaging_quantity_changed") router.refresh();
        } else if (result.status === "rejected") setConflict(true);
      } catch {
        setNotice(
          "Connessione interrotta. Verifica lo stesso invio: l’operazione potrebbe essere già registrata.",
        );
      } finally {
        sending.current = false;
      }
    });
  }
  /** Libera la pagina da un invio che non potrà riuscire. Non cancella niente nel registro. */
  function discard() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      setSuccess(false);
      setNotice(
        "Non riesco a liberare il tentativo conservato in questa scheda. Chiudi la scheda e riaprila.",
      );
      return;
    }
    setCommand(null);
    setConflict(false);
    setUnreadable(false);
    setBlocked(false);
    setNotice("");
  }
  function adjust(event: FormEvent<HTMLFormElement>, item: SimplePackagingItem) {
    event.preventDefault();
    if (sending.current || locked || !snapshot.enabled) return;
    const form = new FormData(event.currentTarget),
      quantity = simpleQuantityInput(form.get("quantity"));
    const next = parseSimplePackagingCommand({
      operationId: crypto.randomUUID(),
      kind: "adjust",
      payload: {
        schema_version: 1,
        stock_item_id: item.id,
        expected_quantity: item.onHand,
        quantity,
        reason: form.get("reason"),
      },
    });
    if (!next) {
      setSuccess(false);
      setNotice("Indica una quantità intera e una causale da 3 a 500 caratteri.");
      return;
    }
    send(next);
  }
  function reconcile() {
    if (sending.current || locked || !snapshot.enabled) return;
    send({ operationId: crypto.randomUUID(), kind: "reconcile", payload: { schema_version: 1 } });
  }
  return (
    <div className={`${stock.main} ${styles.main}`}>
      <div className={stock.heading}>
        <div>
          <h1>Packaging</h1>
          <p>Scatole e adesivi. Una scatola e un adesivo per ogni T-shirt consegnata.</p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          disabled={refreshing || pending}
          onClick={() => refreshTransition(() => router.refresh())}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {refreshing ? "Rilettura…" : "Rileggi quantità"}
        </button>
      </div>
      <p className={styles.explanation}>
        Gli ordini da preparare riservano il materiale. La consegna registra il consumo; cappellini
        e sticker in vendita non lo utilizzano.
      </p>
      {!snapshot.enabled && (
        <p className={stock.disabledNotice}>
          Le rettifiche manuali sono sospese. Puoi consultare le quantità.
        </p>
      )}
      {unreadable && (
        <div className={stock.pending}>
          <PendingAttempt
            title="Invio da verificare non leggibile"
            lines={[
              "L’invio conservato in questa scheda non si può leggere. Controlla le quantità qui sotto, poi scartalo.",
            ]}
            operationId="non leggibile"
            pending={false}
            blocked
            onRetry={() => {}}
            onReread={() => refreshTransition(() => router.refresh())}
            rereadLabel="Rileggi quantità"
            onDiscard={discard}
          />
        </div>
      )}
      {command && (
        <div className={stock.pending}>
          <PendingAttempt
            title={
              command.kind === "adjust" ? "Quantità da verificare" : "Registrazione da verificare"
            }
            lines={
              command.kind === "adjust"
                ? [
                    snapshot.items.find((item) => item.id === command.payload.stock_item_id)
                      ?.name ?? "Materiale non più nell’elenco",
                    `Nuova quantità: ${stockQuantity(command.payload.quantity)}`,
                    `Causale: ${command.payload.reason}`,
                  ]
                : ["Scatole e adesivi da scalare per le consegne già registrate"]
            }
            operationId={command.operationId}
            pending={pending}
            blocked={conflict}
            onRetry={() => send({ ...command, retry: true })}
            onReread={() => refreshTransition(() => router.refresh())}
            rereadLabel="Rileggi quantità"
            onDiscard={conflict ? discard : undefined}
          />
        </div>
      )}
      {notice && (
        <p role={success ? "status" : "alert"} className={success ? stock.success : stock.feedback}>
          {notice}
        </p>
      )}
      {(deficit > 0 || snapshot.failures > 0) && (
        <section className={styles.review} aria-labelledby="packaging-review">
          <h2 id="packaging-review">Scatole e adesivi da scalare: {stockQuantity(deficit)}</h2>
          <p>
            Le quantità registrate sono provvisorie finché queste scatole e questi adesivi non sono
            scalati. Se serve, aggiorna prima la conta, poi registrali.
          </p>
          {historical > 0 && (
            <p>
              {stockQuantity(historical)} unità riguardano consegne precedenti all’avvio: verifica
              con Tommi prima di scalarle.
            </p>
          )}
          {snapshot.failures > 0 && (
            <p>
              {stockQuantity(snapshot.failures)} consegne richiedono una nuova verifica del
              packaging.
            </p>
          )}
          <button
            type="button"
            className="button button-secondary"
            disabled={
              locked || !snapshot.enabled || (reconcilable === 0 && snapshot.failures === 0)
            }
            onClick={reconcile}
          >
            {pending ? "Registrazione…" : "Registra consumi mancanti"}
          </button>
        </section>
      )}
      <section className={styles.materials} aria-labelledby="packaging-materials">
        <div className={styles.listHeading}>
          <h2 id="packaging-materials">Materiali in magazzino</h2>
          <span>{snapshot.locationName ?? "Attivazione in corso"}</span>
        </div>
        {snapshot.items.length ? (
          snapshot.items.map((item) => (
            <article
              key={item.id}
              className={styles.material}
              aria-labelledby={`material-${item.id}`}
            >
              <div className={styles.materialName}>
                <h3 id={`material-${item.id}`}>{item.name}</h3>
                {item.specifications && <p>{item.specifications}</p>}
                {item.deficit > 0 && (
                  <p className={styles.attention}>{stockQuantity(item.deficit)} da scalare</p>
                )}
              </div>
              <dl className={styles.quantities}>
                <div>
                  <dt>Fisico registrato</dt>
                  <dd>{stockQuantity(item.onHand)}</dd>
                </div>
                <div>
                  <dt>Riservati</dt>
                  <dd>{stockQuantity(item.reserved)}</dd>
                </div>
                <div>
                  <dt>Disponibili</dt>
                  <dd>
                    {item.unreserved !== null && item.unreserved < 0
                      ? `Mancano ${stockQuantity(-item.unreserved)}`
                      : stockQuantity(item.unreserved)}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className={`button button-secondary ${styles.editButton}`}
                disabled={locked || !snapshot.enabled}
                aria-expanded={editing === item.id}
                onClick={() => setEditing(editing === item.id ? null : item.id)}
              >
                {editing === item.id ? "Chiudi rettifica" : "Modifica quantità"}
              </button>
              {editing === item.id && (
                <form className={styles.editForm} onSubmit={(event) => adjust(event, item)}>
                  <fieldset disabled={locked || !snapshot.enabled}>
                    <legend className="sr-only">Rettifica {item.name}</legend>
                    <label htmlFor={`quantity-${item.id}`}>
                      Quantità fisica verificata
                      <input
                        id={`quantity-${item.id}`}
                        name="quantity"
                        inputMode="numeric"
                        type="text"
                        required
                        maxLength={10}
                        defaultValue={item.onHand ?? ""}
                      />
                    </label>
                    <label htmlFor={`reason-${item.id}`}>
                      Causale
                      <input
                        id={`reason-${item.id}`}
                        name="reason"
                        type="text"
                        required
                        minLength={3}
                        maxLength={500}
                        placeholder="Es. nuove scatole ricevute"
                      />
                    </label>
                    <button type="submit" className="button button-primary">
                      {pending ? "Salvataggio…" : "Conferma quantità"}
                    </button>
                  </fieldset>
                </form>
              )}
            </article>
          ))
        ) : (
          <div className={styles.empty}>
            <h3>Scatola T-shirt e adesivo per scatola</h3>
            <p>
              I due materiali sono in attivazione. Le quantità compariranno dopo la registrazione
              della conta iniziale autorizzata.
            </p>
          </div>
        )}
      </section>
      <p className={styles.footnote}>
        Le rettifiche conservano autore e causale. Cancellazioni e rimborsi non ripristinano il
        packaging già consumato.
      </p>
    </div>
  );
}
