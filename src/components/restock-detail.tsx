"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Check, Pencil, Trash2, Undo2 } from "lucide-react";
import {
  cleanNote,
  cleanText,
  destinationLabel,
  parseRestockCommand,
  piecesLabel,
  restockDay,
  RESTOCK_HREF,
  RESTOCK_STATES,
  restockMoment,
  stateStep,
  STATE_LABEL,
  type OpenState,
  type RestockState,
} from "../lib/restock/model";
import { shopPart, type RestockOrder, type RestockPage } from "../lib/restock/read";
import { consignmentOrderHref, shopStockHref } from "../lib/consignment/links";
import { piecesBySize, RestockLinesEditor, RestockLinesView } from "./restock-grid";
import {
  FormMessage,
  RestockCommandsProvider,
  RestockPendingSlot,
  useRestockCommands,
  type FormNotice,
} from "./restock-pending";
import roadbook from "./roadbook.module.css";
import styles from "./restock.module.css";

/*
 * Pagina di un riordine (docs/riassortimento.md): i cinque passi, le quantità per destinazione,
 * l'arrivo in magazzino con la conferma, la consegna al negozio dal Conto vendita, note e storico.
 */

const revealOnMount = (element: HTMLElement | null) =>
  element?.scrollIntoView?.({ block: "nearest" });
/** «Il negozio di Milano: S, M, L, XL». */
const sizesText = (sizes: string[] | null) => (sizes ? sizes.join(", ") : "tutte le taglie");

function Stepper({
  order,
  locked,
  onPick,
}: {
  order: RestockOrder;
  locked: boolean;
  onPick: (state: RestockState) => void;
}) {
  const current = stateStep(order.state);
  const arrived = order.state === "in_hand";
  return (
    <ol className={styles.steps} aria-label="Passi del riordine">
      {RESTOCK_STATES.map((state, index) => {
        const step = index + 1;
        const tone = step < current ? styles.stepDone : step === current ? styles.stepNow : "";
        const isCurrent = step === current;
        return (
          <li key={state} className={`${styles.step} ${tone}`}>
            <button
              type="button"
              className={styles.stepButton}
              aria-current={isCurrent ? "step" : undefined}
              disabled={isCurrent || arrived || locked}
              onClick={() => onPick(state)}
            >
              <span className={styles.stepNumber} aria-hidden="true">
                {step < current ? <Check size={14} /> : step}
              </span>
              <span className={styles.stepLabel}>
                {STATE_LABEL[state]}
                {isCurrent && (
                  <span className={styles.stepSince}>dal {restockDay(order.stateChangedAt)}</span>
                )}
                {!isCurrent && !arrived && !order.deleted && (
                  <span className="sr-only">: porta il riordine qui</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function MoveForm({
  order,
  target,
  onDone,
}: {
  order: RestockOrder;
  target: OpenState;
  onDone: () => void;
}) {
  const commands = useRestockCommands();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<FormNotice | null>(null);
  const back = stateStep(target) < stateStep(order.state);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = parseRestockCommand({
      operationId: crypto.randomUUID(),
      kind: "move_restock_order",
      payload: {
        schema_version: 1,
        order_id: order.id,
        expected_version: order.version,
        state: target,
        note,
      },
    });
    if (!command)
      return setMessage({ tone: "error", text: "La nota può avere al massimo 500 caratteri." });
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.announce(result.message);
      onDone();
    } else setMessage({ tone: "error", text: result.message });
  }
  return (
    <form
      ref={revealOnMount}
      className={styles.confirm}
      onSubmit={submit}
      noValidate
      aria-label="Cambio di stato"
    >
      <p className={styles.confirmText}>
        {back ? "Riportare" : "Portare"} il riordine a «{STATE_LABEL[target]}»?
      </p>
      <label className={`${styles.field} ${styles.fieldWide}`}>
        <span>Nota (facoltativa)</span>
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className={styles.actions}>
        <button type="submit" className="button button-primary" disabled={commands.locked}>
          {commands.sending ? "Salvataggio…" : `Sì, porta a «${STATE_LABEL[target]}»`}
        </button>
        <button type="button" className="button button-secondary" onClick={onDone}>
          Annulla
        </button>
      </div>
      <FormMessage message={message} />
    </form>
  );
}

function PiecesList({
  rows,
}: {
  rows: { label: string; sizes: { size: string; quantity: number }[]; total: number }[];
}) {
  return (
    <ul className={styles.pieces}>
      {rows.map((row) => (
        <li key={row.label} className={styles.piecesRow}>
          <span className={styles.piecesName}>{row.label}</span>
          <span className={styles.piecesSizes}>
            {row.sizes.map((s) => (
              <span key={s.size} className={styles.piecesSize}>
                <span className={styles.sizeTag}>{s.size}</span>{" "}
                <span className="num">{s.quantity}</span>
              </span>
            ))}
          </span>
          <span className={`${styles.piecesTotal} num`}>{row.total}</span>
        </li>
      ))}
    </ul>
  );
}

/** «In mano nostra»: cosa entra in magazzino, per taglia, con una sola conferma. */
export function ReceiveForm({ page, onDone }: { page: RestockPage; onDone: () => void }) {
  const { order, catalog } = page;
  const commands = useRestockCommands();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<FormNotice | null>(null);
  const warehouse = piecesBySize(order.lines, "warehouse", catalog);
  const shop = piecesBySize(order.lines, "shop", catalog);
  const loaded = order.totals.warehouse + order.totals.shop;
  const shopName = order.shop?.shortName ?? "il negozio";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = parseRestockCommand({
      operationId: crypto.randomUUID(),
      kind: "receive_restock_order",
      payload: {
        schema_version: 1,
        order_id: order.id,
        expected_version: order.version,
        expected_pieces: loaded,
        note,
      },
    });
    if (!command)
      return setMessage({ tone: "error", text: "La nota può avere al massimo 500 caratteri." });
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.announce(result.message);
      onDone();
    } else setMessage({ tone: "error", text: result.message });
  }
  return (
    <form
      ref={revealOnMount}
      className={styles.confirm}
      onSubmit={submit}
      noValidate
      aria-label="Arrivo in magazzino"
    >
      <p className={styles.confirmText}>
        In mano nostra: entrano nel {order.warehouse.name} {piecesLabel(loaded)}.
      </p>
      {warehouse.length > 0 && (
        <div className={styles.confirmBlock}>
          <h3 className={styles.blockTitle}>
            Per noi <span className="num">{order.totals.warehouse}</span>
          </h3>
          <PiecesList rows={warehouse} />
        </div>
      )}
      {shop.length > 0 && (
        <div className={styles.confirmBlock}>
          <h3 className={styles.blockTitle}>
            Per {shopName} <span className="num">{order.totals.shop}</span>
          </h3>
          <p className={styles.sectionNote}>
            Entrano anche loro nel {order.warehouse.name}, poi escono con la consegna a{" "}
            {order.shop?.name ?? "il negozio"} dal Conto vendita.
          </p>
          <PiecesList rows={shop} />
        </div>
      )}
      {order.totals.customer > 0 && (
        <p className={styles.sectionNote}>
          {piecesLabel(order.totals.customer)} per il cliente: non entrano in magazzino né su
          Shopify.
        </p>
      )}
      {!page.data.stockEnabled && (
        <p className={styles.warning}>
          Le modifiche al magazzino sono sospese: per ora non si carica niente.
        </p>
      )}
      <label className={`${styles.field} ${styles.fieldWide}`}>
        <span>Nota (facoltativa)</span>
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className={styles.actions}>
        <button
          type="submit"
          className="button button-primary"
          disabled={commands.locked || !page.data.stockEnabled}
        >
          {commands.sending
            ? "Caricamento…"
            : loaded
              ? `Conferma e carica ${piecesLabel(loaded)}`
              : "Conferma: in mano nostra"}
        </button>
        <button type="button" className="button button-secondary" onClick={onDone}>
          Annulla
        </button>
      </div>
      <FormMessage message={message} />
    </form>
  );
}

/** Arrivo in magazzino: cosa è entrato, «Annulla arrivo» con la conferma. */
export function ArrivalSection({ page }: { page: RestockPage }) {
  const { order } = page;
  const arrival = order.arrival!;
  const commands = useRestockCommands();
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<FormNotice | null>(null);
  async function undo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = parseRestockCommand({
      operationId: crypto.randomUUID(),
      kind: "undo_restock_arrival",
      payload: { schema_version: 1, order_id: order.id, expected_version: order.version, note },
    });
    if (!command)
      return setMessage({ tone: "error", text: "La nota può avere al massimo 500 caratteri." });
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.announce(result.message);
      setConfirming(false);
    } else setMessage({ tone: "error", text: result.message });
  }
  return (
    <section className={styles.section} aria-labelledby="restock-arrival">
      <div className={styles.sectionHead}>
        <h2 id="restock-arrival" className={styles.sectionTitle}>
          Arrivo in magazzino
        </h2>
      </div>
      <p className={styles.arrivalLine}>
        <span className={`${roadbook.box} ${roadbook.isDone}`}>fatto</span>{" "}
        {piecesLabel(arrival.pieces)} nel {order.warehouse.name} il {restockMoment(arrival.at)}, da{" "}
        {arrival.by}
        {arrival.pieces > 0 && (
          <>
            : <span className="num">{arrival.warehousePieces}</span> per noi
            {arrival.shopPieces > 0 && (
              <>
                {" "}
                e <span className="num">{arrival.shopPieces}</span> per{" "}
                {order.shop?.shortName ?? "il negozio"}
              </>
            )}
          </>
        )}
        .
      </p>
      <p className={styles.sectionNote}>
        Le quantità ricevute restano nello storico. Per correggere le scorte usa le{" "}
        <Link href="/stock/rettifiche" prefetch={false} className={styles.inlineLink}>
          rettifiche del magazzino
        </Link>
        . «Annulla arrivo» serve a stornare l’intero carico: i pezzi escono dal magazzino solo se
        sono ancora tutti liberi, e il riordine torna a «{STATE_LABEL[arrival.previousState]}».
      </p>
      {!confirming ? (
        <div className={styles.actions}>
          <button
            type="button"
            className="button button-secondary"
            disabled={!commands.canOpen}
            onClick={() => setConfirming(true)}
          >
            Annulla arrivo
          </button>
        </div>
      ) : (
        <form
          ref={revealOnMount}
          className={styles.confirm}
          onSubmit={undo}
          noValidate
          aria-label="Annulla arrivo"
        >
          <p className={styles.confirmText}>
            Togliere dal {order.warehouse.name} {piecesLabel(arrival.pieces)} e riportare il
            riordine a «{STATE_LABEL[arrival.previousState]}»?
          </p>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Perché? (facoltativo)</span>
            <textarea
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button type="submit" className="button button-primary" disabled={commands.locked}>
              {commands.sending ? "Annullo…" : "Sì, annulla l’arrivo"}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setConfirming(false)}
            >
              No, lascia così
            </button>
          </div>
          <FormMessage message={message} />
        </form>
      )}
    </section>
  );
}

/** «Da consegnare a LCM»: la consegna si conferma nel Conto vendita, come oggi. */
export function ShopSection({ page }: { page: RestockPage }) {
  const { order, catalog } = page;
  const commands = useRestockCommands();
  const part = shopPart(order);
  const shop = order.shop!;
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<FormNotice | null>(null);
  const openOrder = order.shopOrders.find((o) => o.status === "open");
  const remaining = Math.max(0, part.pieces - part.delivered);
  async function mark(done: boolean) {
    const command = parseRestockCommand({
      operationId: crypto.randomUUID(),
      kind: "set_restock_shop_done",
      payload: { schema_version: 1, order_id: order.id, expected_version: order.version, done },
    });
    if (!command) return;
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.announce(result.message);
      setConfirming(false);
    } else setMessage({ tone: "error", text: result.message });
  }
  const finished = part.status === "done" || part.status === "manual";
  return (
    <section className={styles.section} aria-labelledby="restock-shop">
      <div className={styles.sectionHead}>
        <h2 id="restock-shop" className={styles.sectionTitle}>
          {finished ? `Consegnate a ${shop.shortName}` : `Da consegnare a ${shop.shortName}`}
        </h2>
        {finished && <span className={`${roadbook.box} ${roadbook.isDone}`}>fatto</span>}
      </div>
      <PiecesList rows={piecesBySize(order.lines, "shop", catalog)} />
      {part.status === "manual" && order.shopDone && (
        <p className={styles.sectionNote}>
          Segnate come consegnate da {order.shopDone.by} il {restockMoment(order.shopDone.at)}.
        </p>
      )}
      {part.status === "done" && (
        <p className={styles.sectionNote}>
          Consegnate con{" "}
          {order.shopOrders.map((o, i) => (
            <span key={o.id}>
              {i > 0 ? ", " : ""}
              <Link
                href={consignmentOrderHref(o.shopCode, o.number)}
                prefetch={false}
                className={styles.inlineLink}
              >
                l’ordine n. {o.number}
              </Link>
            </span>
          ))}{" "}
          del Conto vendita.
        </p>
      )}
      {!finished && (
        <>
          <p className={styles.sectionNote}>
            {part.delivered > 0
              ? `Già consegnate ${part.delivered} di ${part.pieces}: ne mancano ${remaining}. `
              : ""}
            La consegna si registra nel Conto vendita, come sempre: «Prepara la consegna» apre
            l’ordine del negozio già compilato con queste magliette; lo salvi e si apre il modulo
            «Consegnato», anche lui già compilato. Così escono dal {order.warehouse.name} ed entrano
            in negozio.
          </p>
          <div className={styles.actions}>
            {openOrder ? (
              <Link
                href={`${consignmentOrderHref(openOrder.shopCode, openOrder.number)}?consegna=1`}
                prefetch={false}
                className="button button-primary"
              >
                Apri l’ordine n. {openOrder.number} e consegna
              </Link>
            ) : (
              <Link
                href={`${consignmentOrderHref(shop.code, "nuovo")}?riordine=${order.id}`}
                prefetch={false}
                className="button button-primary"
              >
                Prepara la consegna a {shop.shortName}
              </Link>
            )}
            {!confirming && (
              <button
                type="button"
                className="button button-secondary"
                disabled={!commands.canOpen}
                onClick={() => setConfirming(true)}
              >
                Segna come già consegnate
              </button>
            )}
          </div>
          {confirming && (
            <div
              ref={revealOnMount}
              className={styles.confirm}
              role="group"
              aria-label="Segna come consegnate"
            >
              <p className={styles.confirmText}>Le magliette sono già in negozio?</p>
              <p className={styles.sectionNote}>
                Usalo solo se la consegna è già registrata nel Conto vendita con un altro ordine: il
                segno non sposta nessuna maglietta.
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={commands.locked}
                  onClick={() => mark(true)}
                >
                  Sì, segna consegnate
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setConfirming(false)}
                >
                  Annulla
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {part.status === "manual" && (
        <div className={styles.actions}>
          <button
            type="button"
            className="button button-secondary"
            disabled={commands.locked}
            onClick={() => mark(false)}
          >
            Togli il segno
          </button>
        </div>
      )}
      <FormMessage message={message} />
      <p className={styles.muted}>
        <Link href={shopStockHref(shop.code)} prefetch={false} className={styles.inlineLink}>
          Apri il magazzino del negozio {shop.name}
        </Link>
      </p>
    </section>
  );
}

function DetailsForm({ page, onDone }: { page: RestockPage; onDone: () => void }) {
  const { order, data } = page;
  const commands = useRestockCommands();
  const [title, setTitle] = useState(order.title);
  const [notes, setNotes] = useState(order.notes);
  const [shop, setShop] = useState(order.shop?.locationId ?? "");
  const [message, setMessage] = useState<FormNotice | null>(null);
  const shopLocked = order.state === "in_hand" || order.totals.shop > 0;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cleanText(title, 3, 120) === null)
      return setMessage({ tone: "error", text: "Scrivi un titolo da 3 a 120 caratteri." });
    if (cleanNote(notes, 2000) === null)
      return setMessage({
        tone: "error",
        text: "Le note possono avere al massimo 2000 caratteri.",
      });
    const command = parseRestockCommand({
      operationId: crypto.randomUUID(),
      kind: "save_restock_order",
      payload: {
        schema_version: 1,
        order_id: order.id,
        expected_version: order.version,
        title,
        notes,
        shop_location_id: shop || null,
      },
    });
    if (!command) return setMessage({ tone: "error", text: "Controlla titolo e note." });
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.announce(result.message);
      onDone();
    } else setMessage({ tone: "error", text: result.message });
  }
  return (
    <form
      ref={revealOnMount}
      className={styles.subform}
      onSubmit={submit}
      noValidate
      aria-label="Titolo e note"
    >
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Titolo</span>
          <input
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>Negozio per «per il negozio»</span>
          <select value={shop} disabled={shopLocked} onChange={(e) => setShop(e.target.value)}>
            <option value="">Nessun negozio</option>
            {data.shops.map((s) => (
              <option key={s.locationId} value={s.locationId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Note</span>
          <textarea
            rows={4}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      {shopLocked && (
        <p className={styles.muted}>
          Il negozio si cambia solo prima dell’arrivo e senza magliette per il negozio.
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" className="button button-primary" disabled={commands.locked}>
          {commands.sending ? "Salvataggio…" : "Salva"}
        </button>
        <button type="button" className="button button-secondary" onClick={onDone}>
          Annulla
        </button>
      </div>
      <FormMessage message={message} />
    </form>
  );
}

/** Elimina dalla vista attiva, mantenendo storico e carichi; il ripristino usa lo stesso percorso. */
export function RestockDeletionForm({
  order,
  onDone,
}: {
  order: RestockOrder;
  onDone: () => void;
}) {
  const commands = useRestockCommands();
  const restoring = Boolean(order.deleted);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<FormNotice | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = cleanNote(note, 500);
    if (reason === null || Array.from(reason).length < 3)
      return setMessage({
        tone: "error",
        text: "Scrivi una motivazione da 3 a 500 caratteri.",
      });
    const command = parseRestockCommand({
      operationId: crypto.randomUUID(),
      kind: "set_restock_deleted",
      payload: {
        schema_version: 1,
        order_id: order.id,
        expected_version: order.version,
        deleted: !restoring,
        note: reason,
      },
    });
    if (!command) return setMessage({ tone: "error", text: "Controlla la motivazione e riprova." });
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.announce(result.message);
      onDone();
    } else setMessage({ tone: "error", text: result.message });
  }
  return (
    <form
      ref={revealOnMount}
      className={styles.confirm}
      onSubmit={submit}
      noValidate
      aria-label={restoring ? "Ripristina riassortimento" : "Elimina riassortimento"}
    >
      <p className={styles.confirmText}>
        {restoring ? "Ripristinare" : "Eliminare"} «{order.title}»?
      </p>
      <p className={styles.sectionNote}>
        {restoring
          ? `Il riassortimento torna in «${order.state === "in_hand" ? "Arrivati" : "In corso"}», con le sue quantità e il suo storico.`
          : "Il riassortimento sparisce da «In corso» e «Arrivati». Lo storico resta in «Eliminati» e puoi ripristinarlo."}{" "}
        Le scorte del Magadzino e del negozio restano invariate. Nessun carico o consegna viene
        annullato o ripetuto.
      </p>
      <label className={`${styles.field} ${styles.fieldWide}`}>
        <span>Motivazione {restoring ? "del ripristino" : "dell’eliminazione"}</span>
        <textarea
          rows={3}
          minLength={3}
          maxLength={500}
          required
          value={note}
          disabled={commands.sending}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className={styles.actions}>
        <button
          type="submit"
          className={
            restoring ? "button button-primary" : `button button-secondary ${styles.deleteButton}`
          }
          disabled={commands.locked}
        >
          {commands.sending
            ? restoring
              ? "Ripristino…"
              : "Eliminazione…"
            : restoring
              ? "Sì, ripristina riassortimento"
              : "Sì, elimina riassortimento"}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={commands.sending}
          onClick={onDone}
        >
          Annulla
        </button>
      </div>
      <FormMessage message={message} />
    </form>
  );
}

function History({ order }: { order: RestockOrder }) {
  const entries = [
    ...order.events.map((e) => ({
      key: `e-${e.id}`,
      at: e.at,
      text:
        e.from === null
          ? `Creato in «${STATE_LABEL[e.to]}»`
          : `Da «${STATE_LABEL[e.from]}» a «${STATE_LABEL[e.to]}»`,
      by: e.by,
      note: e.note,
    })),
    ...(order.deletionEvents ?? []).map((event) => ({
      key: `d-${event.id}`,
      at: event.at,
      text: event.deleted ? "Riassortimento eliminato" : "Riassortimento ripristinato",
      by: event.by,
      note: event.note,
    })),
    ...order.arrivals.flatMap((a) => [
      {
        key: `a-${a.id}`,
        at: a.at,
        text: `Caricati in magazzino ${piecesLabel(a.pieces)}`,
        by: a.by,
        note: "",
      },
      ...(a.undoneAt
        ? [
            {
              key: `u-${a.id}`,
              at: a.undoneAt,
              text: `Arrivo annullato: tolti ${piecesLabel(a.pieces)}`,
              by: a.undoneBy ?? "",
              note: "",
            },
          ]
        : []),
    ]),
  ].sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  return (
    <ol className={styles.history}>
      {entries.map((entry) => (
        <li key={entry.key} className={styles.historyItem}>
          <span className={styles.historyText}>{entry.text}</span>
          <span className={styles.historyWhen}>
            {entry.by} · {restockMoment(entry.at)}
          </span>
          {entry.note && <span className={styles.historyNote}>{entry.note}</span>}
        </li>
      ))}
    </ol>
  );
}

function Detail({ page }: { page: RestockPage }) {
  const { order, catalog, incoming } = page;
  const commands = useRestockCommands();
  const [moving, setMoving] = useState<RestockState | null>(null);
  const [editing, setEditing] = useState<"lines" | "details" | null>(null);
  const [deletionIntent, setDeletionIntent] = useState<{
    orderId: string;
    action: "delete" | "restore";
  } | null>(null);
  const arrived = order.state === "in_hand";
  const deleted = Boolean(order.deleted);
  // La conferma resta legata all'azione aperta: dopo un invio verificato non diventa l'azione inversa.
  const deletionOpen =
    deletionIntent?.orderId === order.id &&
    deletionIntent.action === (deleted ? "restore" : "delete");
  const shop = shopPart(order);
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <Link href={RESTOCK_HREF} prefetch={false} className={styles.backLink}>
            <ArrowLeft size={16} aria-hidden="true" /> Riassortimento
          </Link>
          <h1 className={styles.title}>{order.title}</h1>
          <p className={styles.lead}>
            Creato da {order.createdBy} il {restockDay(order.createdAt)}
            {order.shop
              ? ` · Per il negozio: ${order.shop.name} (${sizesText(order.shop.sizes)})`
              : " · Senza negozio"}
          </p>
        </div>
        <div className={styles.actions} aria-label="Azioni del riassortimento">
          {!deleted && (
            <button
              type="button"
              className="button button-secondary"
              disabled={!commands.canOpen}
              aria-expanded={editing === "details"}
              aria-controls="restock-notes"
              onClick={() => {
                setMoving(null);
                setDeletionIntent(null);
                setEditing("details");
              }}
            >
              <Pencil size={16} aria-hidden="true" /> Modifica
            </button>
          )}
          <button
            type="button"
            className={`button button-secondary ${deleted ? "" : styles.deleteButton}`}
            disabled={!commands.canOpen}
            aria-expanded={deletionOpen}
            onClick={() => {
              setMoving(null);
              setEditing(null);
              setDeletionIntent({ orderId: order.id, action: deleted ? "restore" : "delete" });
            }}
          >
            {deleted ? (
              <Undo2 size={16} aria-hidden="true" />
            ) : (
              <Trash2 size={16} aria-hidden="true" />
            )}
            {deleted ? "Ripristina" : "Elimina"}
          </button>
        </div>
      </div>
      <RestockPendingSlot />
      {order.deleted && (
        <div className={styles.deletedNotice} role="status">
          <p className={styles.confirmText}>Riassortimento eliminato · recuperabile</p>
          <p className={styles.sectionNote}>
            Eliminato da {order.deleted.by} il {restockMoment(order.deleted.at)}. Le scorte non sono
            cambiate. Per modificarlo o riprendere il lavoro, ripristinalo.
          </p>
          <p className={styles.notes}>{order.deleted.note}</p>
        </div>
      )}
      {deletionOpen && (
        <RestockDeletionForm key={order.id} order={order} onDone={() => setDeletionIntent(null)} />
      )}

      <section className={styles.section} aria-labelledby="restock-steps">
        <h2 id="restock-steps" className={styles.sectionTitle}>
          A che punto è
        </h2>
        <Stepper
          order={order}
          locked={deleted || !commands.canOpen}
          onPick={(state) => {
            setEditing(null);
            setMoving(state);
          }}
        />
        {deleted ? (
          <p className={styles.sectionNote}>Ultimo stato: {STATE_LABEL[order.state]}.</p>
        ) : arrived ? (
          <p className={styles.sectionNote}>
            Il riordine è in mano nostra. Per riportarlo a un passo precedente annulla l’arrivo.
          </p>
        ) : (
          !moving && (
            <p className={styles.sectionNote}>
              Tocca un passo per spostare il riordine, avanti o indietro. «In mano nostra» carica le
              magliette in magazzino, dopo una conferma.
            </p>
          )
        )}
        {!deleted && moving === "in_hand" && (
          <ReceiveForm page={page} onDone={() => setMoving(null)} />
        )}
        {!deleted && moving && moving !== "in_hand" && (
          <MoveForm order={order} target={moving} onDone={() => setMoving(null)} />
        )}
      </section>

      <dl className={styles.figures}>
        {(["warehouse", "shop", "customer"] as const)
          .filter((d) => d !== "shop" || order.shop)
          .map((d) => (
            <div key={d} className={styles.figure}>
              <dt>{destinationLabel(d, order.shop?.name ?? null)}</dt>
              <dd className={styles.figureValue}>{order.totals[d]}</dd>
            </div>
          ))}
        <div className={`${styles.figure} ${styles.figureMain}`}>
          <dt>Totale</dt>
          <dd className={styles.figureValue}>{order.totals.total}</dd>
        </div>
      </dl>

      {!deleted && arrived && order.arrival && <ArrivalSection page={page} />}
      {!deleted && arrived && order.shop && shop.pieces > 0 && <ShopSection page={page} />}

      <section className={styles.section} aria-labelledby="restock-lines">
        <div className={styles.sectionHead}>
          <h2 id="restock-lines" className={styles.sectionTitle}>
            Quantità
          </h2>
          {editing !== "lines" && !arrived && !deleted && (
            <button
              type="button"
              className="button button-secondary"
              disabled={!commands.canOpen}
              onClick={() => {
                setMoving(null);
                setDeletionIntent(null);
                setEditing("lines");
              }}
            >
              Modifica quantità
            </button>
          )}
        </div>
        {arrived && !deleted && (
          <p className={styles.sectionNote}>
            Le quantità ricevute restano nello storico. Le correzioni delle scorte si registrano
            nelle{" "}
            <Link href="/stock/rettifiche" prefetch={false} className={styles.inlineLink}>
              rettifiche del magazzino
            </Link>
            . Titolo e note si possono ancora modificare.
          </p>
        )}
        {deleted && (
          <p className={styles.sectionNote}>
            Le quantità sono conservate in sola lettura. Ripristina il riassortimento per riprendere
            le operazioni.
          </p>
        )}
        {!deleted && order.state === "discussion" && editing !== "lines" && (
          <p className={styles.sectionNote}>
            In «Modifica quantità» trovi per ogni taglia la giacenza del {order.warehouse.name} e
            l’obiettivo, le taglie sotto l’obiettivo e «Proponi quantità».
          </p>
        )}
        {editing === "lines" && !deleted && !arrived ? (
          <RestockLinesEditor
            catalog={catalog}
            order={order}
            incoming={incoming}
            onDone={() => setEditing(null)}
          />
        ) : (
          <RestockLinesView catalog={catalog} order={order} />
        )}
      </section>

      <section className={styles.section} aria-labelledby="restock-notes">
        <div className={styles.sectionHead}>
          <h2 id="restock-notes" className={styles.sectionTitle}>
            Note
          </h2>
          {editing !== "details" && !deleted && (
            <button
              type="button"
              className="button button-secondary"
              disabled={!commands.canOpen}
              onClick={() => {
                setMoving(null);
                setDeletionIntent(null);
                setEditing("details");
              }}
            >
              Modifica titolo e note
            </button>
          )}
        </div>
        {editing === "details" && !deleted ? (
          <DetailsForm page={page} onDone={() => setEditing(null)} />
        ) : order.notes ? (
          <p className={styles.notes}>{order.notes}</p>
        ) : (
          <p className={styles.muted}>Nessuna nota.</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="restock-history">
        <h2 id="restock-history" className={styles.sectionTitle}>
          Storico
        </h2>
        <History order={order} />
      </section>
    </div>
  );
}

export function RestockDetail({
  page,
  userId,
  preview = false,
}: {
  page: RestockPage;
  userId: string;
  preview?: boolean;
  now?: string;
}) {
  return (
    <RestockCommandsProvider
      userId={userId}
      preview={preview}
      titles={Object.fromEntries(page.data.orders.map((o) => [o.id, o.title]))}
    >
      <Detail page={page} />
    </RestockCommandsProvider>
  );
}
