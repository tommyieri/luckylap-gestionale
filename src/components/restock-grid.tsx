"use client";

import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import {
  bySize,
  destinationLabel,
  DESTINATIONS,
  MAX_QUANTITY,
  parseRestockCommand,
  piecesLabel,
  type Destination,
  type RestockLineInput,
} from "../lib/restock/model";
import {
  lineQuantity,
  proposedQuantities,
  restockGrid,
  totalsOf,
  type GridCell,
  type GridGroup,
  type GridRow,
  type RestockCatalog,
  type RestockLine,
  type RestockOrder,
} from "../lib/restock/read";
import { FormMessage, useRestockCommands, type FormNotice } from "./restock-pending";
import styles from "./restock.module.css";

/*
 * Quantità del riordine: in lettura una tabella per gruppo, con il modello e colore sopra e una
 * riga per destinazione; in modifica una destinazione alla volta («Per noi», «Per LCM», «Per il
 * cliente»), con le taglie in colonna. Sul telefono le sette colonne stanno nella larghezza.
 */

const KEY = (destination: Destination, productId: string, color: string, size: string) =>
  `${destination}|${productId}|${color}|${size}`;
const SHORT: Record<Destination, string> = { warehouse: "Noi", shop: "", customer: "Cliente" };
/** Nome corto della riga: «Noi», «LCM», «Cliente». */
const shortLabel = (destination: Destination, shopShort: string | null) =>
  destination === "shop" ? (shopShort ?? "Negozio") : SHORT[destination];

/** Le righe del riordine in un gruppo: solo modelli e colori con almeno un pezzo. */
function usedRows(group: GridGroup, lines: readonly RestockLine[]) {
  return group.rows.filter((row) =>
    lines.some((l) => l.productId === row.productId && l.color === row.color),
  );
}

/** Quantità in sola lettura, per gruppo: una riga per destinazione sotto ogni modello e colore. */
export function RestockLinesView({
  catalog,
  order,
}: {
  catalog: RestockCatalog;
  order: RestockOrder;
}) {
  const groups = restockGrid(catalog, order.lines);
  const shopShort = order.shop?.shortName ?? null;
  if (!order.lines.length)
    return (
      <p className={styles.empty}>
        Ancora nessuna quantità. Con «Modifica quantità» scrivi per taglia quante magliette servono
        per noi, per il negozio e per il cliente.
      </p>
    );
  return (
    <div className={styles.viewGroups}>
      {groups.map((group) => {
        const rows = usedRows(group, order.lines);
        if (!rows.length) return null;
        const sizes = group.sizes.filter((size) =>
          order.lines.some(
            (l) =>
              l.size === size &&
              rows.some((r) => r.productId === l.productId && r.color === l.color),
          ),
        );
        return (
          <div key={group.key} className={styles.tableScroll}>
            <table className={styles.viewTable}>
              <caption className={styles.tableCaption}>{group.label}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Modello, colore e destinazione</span>
                  </th>
                  {sizes.map((size) => (
                    <th key={size} scope="col">
                      {size}
                    </th>
                  ))}
                  <th scope="col">Tot.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ViewRows
                    key={row.key}
                    row={row}
                    sizes={sizes}
                    lines={order.lines}
                    shopShort={shopShort}
                  />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className={styles.legend}>
        Noi = per il {order.warehouse.name}
        {order.shop && order.shop.shortName !== order.shop.name
          ? ` · ${order.shop.shortName} = per ${order.shop.name}`
          : ""}{" "}
        · Cliente = ordine speciale, non entra in magazzino.
      </p>
    </div>
  );
}

function ViewRows({
  row,
  sizes,
  lines,
  shopShort,
}: {
  row: GridRow;
  sizes: string[];
  lines: readonly RestockLine[];
  shopShort: string | null;
}) {
  const destinations = DESTINATIONS.filter((d) =>
    sizes.some((size) => lineQuantity(lines, d, row.productId, row.color, size) > 0),
  );
  return (
    <>
      <tr className={styles.modelRow}>
        <th scope="rowgroup" colSpan={sizes.length + 2}>
          {row.model} {row.color}
        </th>
      </tr>
      {destinations.map((d) => {
        const quantities = sizes.map((size) =>
          lineQuantity(lines, d, row.productId, row.color, size),
        );
        return (
          <tr key={d}>
            <th scope="row">{shortLabel(d, shopShort)}</th>
            {quantities.map((q, i) => (
              <td key={sizes[i]} className={q === 0 ? styles.zero : undefined}>
                {q}
              </td>
            ))}
            <td className={styles.rowTotal}>{quantities.reduce((s, q) => s + q, 0)}</td>
          </tr>
        );
      })}
    </>
  );
}

type Values = Record<string, string>;
const parseQuantity = (value: string) =>
  value.trim() === "" ? 0 : /^[0-9]{1,6}$/.test(value.trim()) ? Number(value.trim()) : null;

/** Righe del comando dai campi: solo le celle con almeno un pezzo, `null` se un campo non è valido. */
export function linesFromValues(values: Values): { lines: RestockLineInput[]; invalid: string[] } {
  const lines: RestockLineInput[] = [];
  const invalid: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const quantity = parseQuantity(value);
    if (quantity === null || quantity > MAX_QUANTITY) invalid.push(key);
    else if (quantity > 0) {
      const [destination, product_id, color, size] = key.split("|");
      lines.push({ destination: destination as Destination, product_id, color, size, quantity });
    }
  }
  return { lines, invalid };
}

/** Celle modificabili per una destinazione. */
export function editableCell(
  destination: Destination,
  row: GridRow,
  cell: GridCell,
  shopSizes: string[] | null | undefined,
): boolean {
  if (destination === "customer") return row.tshirt || cell.variant !== null;
  if (!cell.variant?.active) return false;
  if (destination === "shop")
    return row.tshirt && (shopSizes == null || shopSizes.includes(cell.size));
  return true;
}

/** Sotto l'obiettivo nel Magadzino, contando i pezzi già in arrivo con altri riordini. */
export const underTarget = (cell: GridCell, incoming: Record<string, number>) =>
  cell.variant !== null &&
  cell.variant.active &&
  cell.variant.target !== null &&
  cell.variant.onHand !== null &&
  cell.variant.onHand + (incoming[cell.variant.itemId] ?? 0) < cell.variant.target;

/** Modifica delle quantità, una destinazione alla volta, con la barra «Salva quantità» in basso. */
export function RestockLinesEditor({
  catalog,
  order,
  incoming,
  onDone,
}: {
  catalog: RestockCatalog;
  order: RestockOrder;
  incoming: Record<string, number>;
  onDone: () => void;
}) {
  const commands = useRestockCommands();
  const discussion = order.state === "discussion";
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(
      order.lines.map((l) => [
        KEY(l.destination, l.productId, l.color, l.size),
        String(l.quantity),
      ]),
    ),
  );
  const [destination, setDestination] = useState<Destination>("warehouse");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<FormNotice | null>(null);
  const groups = useMemo(() => restockGrid(catalog, order.lines), [catalog, order.lines]);
  const parsed = linesFromValues(values);
  const totals = totalsOf(
    parsed.lines.map((l) => ({ destination: l.destination, quantity: l.quantity })),
  );
  const shopSizes = order.shop?.sizes;
  const destinations = DESTINATIONS.filter((d) => d !== "shop" || order.shop);
  const visibleGroups = groups.filter((g) => destination !== "shop" || g.key === "tshirt");

  function propose() {
    const proposal = proposedQuantities(catalog, incoming);
    let filled = 0;
    const next = { ...values };
    for (const group of groups)
      for (const row of group.rows)
        for (const cell of row.cells) {
          const amount = cell.variant ? proposal[cell.variant.itemId] : undefined;
          if (amount) {
            next[KEY("warehouse", row.productId, row.color, cell.size)] = String(amount);
            filled++;
          }
        }
    setValues(next);
    setDestination("warehouse");
    setMessage({
      tone: "success",
      text: filled
        ? `Proposte ${filled} taglie per noi: obiettivo meno giacenza e meno i pezzi già in arrivo. Controlla e salva.`
        : "Nessuna taglia sotto l’obiettivo: niente da proporre.",
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (parsed.invalid.length) {
      setInvalid(new Set(parsed.invalid));
      return setMessage({ tone: "error", text: "Scrivi numeri interi nelle caselle evidenziate." });
    }
    // Solo celle modificabili: una taglia che il negozio non tiene non parte mai.
    const allowed = new Set<string>();
    for (const group of groups)
      for (const row of group.rows)
        for (const cell of row.cells)
          for (const d of DESTINATIONS)
            if (editableCell(d, row, cell, shopSizes))
              allowed.add(KEY(d, row.productId, row.color, cell.size));
    const blocked = parsed.lines.filter(
      (l) => !allowed.has(KEY(l.destination, l.product_id, l.color, l.size)),
    );
    if (blocked.length) {
      setInvalid(new Set(blocked.map((l) => KEY(l.destination, l.product_id, l.color, l.size))));
      return setMessage({
        tone: "error",
        text: "Alcune caselle non si possono usare per quella destinazione: togli i pezzi evidenziati.",
      });
    }
    setInvalid(new Set());
    const command = parseRestockCommand({
      operationId: crypto.randomUUID(),
      kind: "set_restock_lines",
      payload: {
        schema_version: 1,
        order_id: order.id,
        expected_version: order.version,
        lines: parsed.lines,
      },
    });
    if (!command)
      return setMessage({
        tone: "error",
        text: "Troppe righe o quantità non valide. Controlla i numeri.",
      });
    setMessage(null);
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.announce(result.message);
      onDone();
      return;
    }
    setMessage({ tone: "error", text: result.message });
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate aria-label="Quantità del riordine">
      <div
        className={styles.switch}
        style={{ "--choices": destinations.length } as CSSProperties}
        role="group"
        aria-label="Destinazione"
      >
        {destinations.map((d) => (
          <button
            key={d}
            type="button"
            className={`${styles.switchButton} ${destination === d ? styles.switchOn : ""}`}
            aria-pressed={destination === d}
            onClick={() => setDestination(d)}
          >
            {destinationLabel(d, order.shop?.name ?? null)} <span className="num">{totals[d]}</span>
          </button>
        ))}
      </div>
      <p className={styles.sectionNote}>
        {destination === "warehouse"
          ? `Pezzi che entrano nel ${order.warehouse.name}. Sotto ogni casella: quante ce ne sono ora e l’obiettivo; in ambra le taglie sotto l’obiettivo.`
          : destination === "shop"
            ? `Pezzi per ${order.shop?.name ?? "il negozio"}: entrano in magazzino all’arrivo ed escono con la consegna del Conto vendita. ${shopSizes ? `Solo le taglie del negozio: ${shopSizes.join(", ")}.` : ""}`
            : "Ordini speciali dei clienti, anche in taglie che non sono a catalogo (XXXL): non entrano mai in magazzino né su Shopify."}
      </p>
      {discussion && destination === "warehouse" && (
        <div className={styles.proposeBar}>
          <button type="button" className="button button-secondary" onClick={propose}>
            Proponi quantità
          </button>
          <span className={styles.muted}>Obiettivo meno giacenza e pezzi già in arrivo.</span>
        </div>
      )}
      <fieldset className={styles.fieldset} disabled={commands.sending}>
        <legend className="sr-only">
          {destinationLabel(destination, order.shop?.name ?? null)}: pezzi per taglia
        </legend>
        {visibleGroups.map((group) => (
          <section key={group.key} className={styles.editGroup} aria-label={group.label}>
            <h3 className={styles.editGroupTitle}>{group.label}</h3>
            {group.rows.map((row) => (
              <div
                key={row.key}
                className={styles.editRow}
                role="group"
                aria-label={`${row.model} ${row.color}`}
              >
                <p className={styles.editName}>
                  {row.model} <span>{row.color}</span>
                </p>
                <div
                  className={styles.editCells}
                  style={{ "--sizes": group.sizes.length } as CSSProperties}
                >
                  {row.cells.map((cell) => (
                    <EditCell
                      key={cell.size}
                      row={row}
                      cell={cell}
                      destination={destination}
                      shopSizes={shopSizes}
                      incoming={incoming}
                      value={values[KEY(destination, row.productId, row.color, cell.size)] ?? ""}
                      invalid={invalid.has(KEY(destination, row.productId, row.color, cell.size))}
                      onChange={(value) =>
                        setValues((v) => ({
                          ...v,
                          [KEY(destination, row.productId, row.color, cell.size)]: value,
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
      </fieldset>
      <div className={styles.actionBar}>
        {message && (
          <div className={styles.barMessage}>
            <FormMessage message={message} />
          </div>
        )}
        <p className={styles.barSummary}>
          <span className="num">{piecesLabel(totals.total)}</span>
          <span className={styles.barDetail}>
            Noi <span className="num">{totals.warehouse}</span>
            {order.shop && (
              <>
                {" "}
                · {order.shop.shortName} <span className="num">{totals.shop}</span>
              </>
            )}{" "}
            · Cliente <span className="num">{totals.customer}</span>
          </span>
        </p>
        <div className={styles.barActions}>
          <button type="button" className="button button-secondary" onClick={onDone}>
            Annulla
          </button>
          <button type="submit" className="button button-primary" disabled={commands.locked}>
            {commands.sending ? "Salvataggio…" : "Salva quantità"}
          </button>
        </div>
      </div>
    </form>
  );
}

function EditCell({
  row,
  cell,
  destination,
  shopSizes,
  incoming,
  value,
  invalid,
  onChange,
}: {
  row: GridRow;
  cell: GridCell;
  destination: Destination;
  shopSizes: string[] | null | undefined;
  incoming: Record<string, number>;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const editable = editableCell(destination, row, cell, shopSizes);
  const variant = cell.variant;
  const low = destination === "warehouse" && underTarget(cell, incoming);
  if (!editable && !value)
    return (
      <span className={styles.cellOff} title="Taglia non disponibile per questa destinazione">
        <span className={styles.cellSize}>{cell.size}</span>
        <span aria-hidden="true">—</span>
        <span className="sr-only">
          {cell.size}: non disponibile {destination === "shop" ? "per il negozio" : "a catalogo"}
        </span>
      </span>
    );
  const label = `${row.model} ${row.color} ${cell.size}, ${destinationLabel(destination, null).toLocaleLowerCase("it")}`;
  return (
    <label
      className={`${styles.cell} ${low ? styles.cellLow : ""} ${invalid ? styles.cellMarked : ""}`}
    >
      <span className={styles.cellSize}>{cell.size}</span>
      <input
        className={styles.cellInput}
        type="text"
        size={4}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="off"
        value={value}
        aria-invalid={invalid || undefined}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
      {destination === "warehouse" && variant && (
        <span className={styles.cellHint}>
          <span title="Nel magazzino ora / obiettivo">
            <span className="num">{variant.onHand ?? "—"}</span>
            {variant.target !== null && (
              <>
                /<span className="num">{variant.target}</span>
              </>
            )}
          </span>
          {(incoming[variant.itemId] ?? 0) > 0 && (
            <span className={styles.cellExtra}>+{incoming[variant.itemId]} in arrivo</span>
          )}
          {variant.toProduce > 0 && (
            <span className={styles.cellExtra}>{variant.toProduce} da produrre</span>
          )}
          {low && <span className="sr-only">, sotto l’obiettivo</span>}
        </span>
      )}
    </label>
  );
}

/** Pezzi per destinazione e taglia, in testo: «GT3RS Blu: S 3 · M 4». Per l'arrivo e il negozio. */
export function piecesBySize(
  lines: readonly RestockLine[],
  destination: Destination,
  catalog: RestockCatalog,
): { label: string; sizes: { size: string; quantity: number }[]; total: number }[] {
  const groups = restockGrid(catalog, lines);
  const result: { label: string; sizes: { size: string; quantity: number }[]; total: number }[] =
    [];
  for (const group of groups)
    for (const row of group.rows) {
      const sizes = lines
        .filter(
          (l) =>
            l.destination === destination && l.productId === row.productId && l.color === row.color,
        )
        .map((l) => ({ size: l.size, quantity: l.quantity }))
        .sort((a, b) => bySize(a.size, b.size));
      if (sizes.length)
        result.push({
          label: `${row.model} ${row.color}`,
          sizes,
          total: sizes.reduce((s, x) => s + x.quantity, 0),
        });
    }
  return result;
}
