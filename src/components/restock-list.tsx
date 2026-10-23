"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import {
  cleanNote,
  cleanText,
  destinationLabel,
  parseRestockCommand,
  restockHref,
  RESTOCK_STATES,
  stateSince,
  stateStep,
  STATE_LABEL,
} from "../lib/restock/model";
import { shopPart, type RestockData, type RestockOrder } from "../lib/restock/read";
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
 * Riassortimento (docs/riassortimento.md): l'elenco dei riordini come righe roadbook, con il
 * passo a cui sono, quanti pezzi per destinazione e da quando. «In corso» e «Arrivati».
 */

/** «Per noi 64 · Per LCM 17 · Per il cliente 4», senza le destinazioni vuote. */
export function totalsText(order: RestockOrder): string {
  const parts = (["warehouse", "shop", "customer"] as const)
    .filter((d) => order.totals[d] > 0)
    .map((d) => `${destinationLabel(d, order.shop?.name ?? null)} ${order.totals[d]}`);
  return parts.length ? parts.join(" · ") : "Nessuna quantità ancora";
}

/** I cinque passi in piccolo: pieni fino al passo attuale. */
export function StepTrack({ order }: { order: RestockOrder }) {
  const step = stateStep(order.state);
  return (
    <span
      className={styles.track}
      role="img"
      aria-label={`Passo ${step} di 5: ${STATE_LABEL[order.state]}`}
    >
      {RESTOCK_STATES.map((state, index) => (
        <span
          key={state}
          className={`${styles.trackStep} ${index + 1 < step ? styles.trackDone : index + 1 === step ? styles.trackNow : ""}`}
        />
      ))}
    </span>
  );
}

function OrderRow({ order }: { order: RestockOrder }) {
  const arrived = order.state === "in_hand";
  const shop = shopPart(order);
  return (
    <li className={roadbook.row}>
      <span className={roadbook.spine}>
        {arrived ? (
          <span className={`${roadbook.box} ${roadbook.isDone}`}>fatto</span>
        ) : (
          <>
            <span className={roadbook.spineValue}>{stateStep(order.state)}</span>
            <span className={styles.spineNote}>di 5</span>
          </>
        )}
      </span>
      <span className={roadbook.body}>
        <Link href={restockHref(order.id)} prefetch={false} className={roadbook.rowLink}>
          <span className={roadbook.title}>{order.title}</span>
        </Link>
        <span className={roadbook.meta}>{stateSince(order.state, order.stateChangedAt)}</span>
        <span className={`${roadbook.meta} num`}>{totalsText(order)}</span>
        {arrived && shop.pieces > 0 && (shop.status === "todo" || shop.status === "open") && (
          <span className={`${roadbook.meta} ${roadbook.late}`}>
            Da consegnare a {order.shop?.shortName ?? "negozio"}: {shop.pieces - shop.delivered}
          </span>
        )}
      </span>
      <span className={`${roadbook.side} ${styles.rowSide}`}>
        <StepTrack order={order} />
      </span>
    </li>
  );
}

function NewOrderForm({ data, onCancel }: { data: RestockData; onCancel: () => void }) {
  const router = useRouter();
  const commands = useRestockCommands();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [shop, setShop] = useState(data.shops.length === 1 ? data.shops[0].locationId : "");
  const [message, setMessage] = useState<FormNotice | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cleanText(title, 3, 120) === null)
      return setMessage({ tone: "error", text: "Scrivi un titolo da 3 a 120 caratteri." });
    if (
      data.orders.some(
        (o) => o.title.toLocaleLowerCase("it") === title.trim().toLocaleLowerCase("it"),
      )
    )
      return setMessage({
        tone: "error",
        text: "C’è già un riordine con questo titolo. Scegline un altro.",
      });
    if (cleanNote(notes, 2000) === null)
      return setMessage({ tone: "error", text: "La nota può avere al massimo 2000 caratteri." });
    const command = parseRestockCommand({
      operationId: crypto.randomUUID(),
      kind: "save_restock_order",
      payload: {
        schema_version: 1,
        order_id: null,
        expected_version: null,
        title,
        notes,
        shop_location_id: shop || null,
      },
    });
    if (!command) return setMessage({ tone: "error", text: "Controlla titolo e note." });
    setMessage(null);
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.flash(result.message);
      router.push(restockHref(result.target.orderId));
      return;
    }
    setMessage({ tone: "error", text: result.message });
  }
  return (
    <form className={styles.subform} onSubmit={submit} noValidate aria-label="Nuovo riordine">
      <p className={styles.sectionNote}>
        Il riordine parte da «{STATE_LABEL.discussion}». Le quantità si scrivono dopo, nella sua
        pagina.
      </p>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Titolo</span>
          <input
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Es. Riordine di novembre"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>Negozio per «per il negozio»</span>
          <select value={shop} onChange={(e) => setShop(e.target.value)}>
            <option value="">Nessun negozio</option>
            {data.shops.map((s) => (
              <option key={s.locationId} value={s.locationId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Note (facoltative)</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      <div className={styles.actions}>
        <button type="submit" className="button button-primary" disabled={commands.locked}>
          {commands.sending ? "Creazione…" : "Crea riordine"}
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Annulla
        </button>
      </div>
      <FormMessage message={message} />
    </form>
  );
}

function ListBody({ data }: { data: RestockData }) {
  const commands = useRestockCommands();
  const [view, setView] = useState<"open" | "arrived">("open");
  const [creating, setCreating] = useState(false);
  const open = data.orders.filter((o) => o.state !== "in_hand"),
    arrived = data.orders.filter((o) => o.state === "in_hand");
  const shown = view === "open" ? open : arrived;
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Riassortimento</h1>
          <p className={styles.lead}>
            I riordini di magliette: cosa riordinare, a che punto sono e cosa entra in magazzino
            quando arrivano.
          </p>
        </div>
        {!creating && (
          <button
            type="button"
            className="button button-primary"
            disabled={!commands.canOpen}
            onClick={() => setCreating(true)}
          >
            <Plus size={16} aria-hidden="true" />
            Nuovo riordine
          </button>
        )}
      </div>
      <RestockPendingSlot />
      {creating && <NewOrderForm data={data} onCancel={() => setCreating(false)} />}
      <section className={styles.section} aria-labelledby="restock-list-heading">
        <h2 id="restock-list-heading" className="sr-only">
          Riordini
        </h2>
        <div className={styles.filters} role="group" aria-label="Quali riordini">
          <button
            type="button"
            className={`${styles.filter} ${view === "open" ? styles.filterOn : ""}`}
            aria-pressed={view === "open"}
            onClick={() => setView("open")}
          >
            In corso <span className="num">{open.length}</span>
          </button>
          <button
            type="button"
            className={`${styles.filter} ${view === "arrived" ? styles.filterOn : ""}`}
            aria-pressed={view === "arrived"}
            onClick={() => setView("arrived")}
          >
            Arrivati <span className="num">{arrived.length}</span>
          </button>
        </div>
        {shown.length ? (
          <ul className={roadbook.list}>
            {shown.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </ul>
        ) : (
          <div className={styles.emptyState}>
            <p className={styles.emptyTitle}>
              {view === "open" ? "Nessun riordine in corso." : "Nessun riordine arrivato."}
            </p>
            <p className={styles.sectionNote}>
              {view === "open"
                ? "Con «Nuovo riordine» si parte da «Discussione su cosa riordinare»: la pagina mostra le giacenze del Magadzino e l’obiettivo per taglia."
                : "Quando un riordine è «In mano nostra» e le magliette sono in magazzino, lo trovi qui."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export function RestockList({
  data,
  userId,
  preview = false,
}: {
  data: RestockData;
  userId: string;
  preview?: boolean;
  now?: string;
}) {
  return (
    <RestockCommandsProvider
      userId={userId}
      preview={preview}
      titles={Object.fromEntries(data.orders.map((o) => [o.id, o.title]))}
    >
      <ListBody data={data} />
    </RestockCommandsProvider>
  );
}
