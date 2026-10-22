import type { CSSProperties, ReactNode } from "react";
import type { GridCell, StockGrid } from "../lib/consignment/shop-read";
import styles from "./consignment-shop.module.css";

/*
 * Griglia unica delle magliette (docs/consignment.md, «Griglia»): gruppi per
 * modello nell'ordine del Magazzino, una riga per colore, una cella per taglia.
 * «—» vuol dire da contare, «0» è zero. Modalità lettura o inserimento (conta,
 * ordine, magliette riportate). Nessun hook: la usano pagine server e moduli.
 */

const number = new Intl.NumberFormat("it-IT");

export type GridInput = {
  values: Record<string, string>;
  onChange: (itemId: string, value: string) => void;
  /** Parola dell'etichetta accessibile: «GT3RS Blu M, venduti». */
  verb: string;
  /** Celle con il campo; le altre restano in sola lettura. Predefinito: tutte. */
  editable?: (cell: GridCell) => boolean;
  /** Campi non validi o colpiti da un rifiuto. */
  invalid?: ReadonlySet<string>;
  disabled?: boolean;
};

export function quantityText(quantity: number | null): string {
  return quantity === null ? "—" : number.format(quantity);
}

function ReadValue({ cell }: { cell: GridCell }) {
  return (
    <span
      className={`${styles.cellValue} ${cell.quantity === null ? styles.cellUnknown : cell.quantity === 0 ? styles.cellZero : ""}`}
    >
      {quantityText(cell.quantity)}
      {cell.quantity === null && <span className="sr-only"> da contare</span>}
    </span>
  );
}

export function ConsignmentStockGrid({
  grid,
  label,
  input,
  note,
  highlight,
}: {
  grid: StockGrid;
  /** Nome accessibile della griglia. */
  label: string;
  input?: GridInput;
  /** Riga sotto il numero: «+2 in arrivo», «in negozio 3». */
  note?: (cell: GridCell) => ReactNode;
  /** Articolo da evidenziare (riga colpita da un rifiuto). */
  highlight?: string | null;
}) {
  if (!grid.groups.length)
    return <p className={styles.empty}>Nessuna T-shirt attiva nel gestionale.</p>;
  const columns = { "--sizes": grid.sizes.length } as CSSProperties;
  return (
    <div className={styles.grid} role="group" aria-label={label}>
      {grid.groups.map((group) => (
        <section key={group.model} className={styles.gridGroup} aria-label={group.model}>
          <h3 className={styles.gridModel}>{group.model}</h3>
          {group.rows.map((row, index) => (
            <div
              key={`${row.color}-${index}`}
              className={styles.gridRow}
              role="group"
              aria-label={`${group.model} ${row.color}`}
            >
              <p className={styles.gridColor}>{row.color}</p>
              <div className={styles.gridCells} style={columns}>
                {row.cells.map((cell) => {
                  const item = cell.item;
                  if (!item)
                    return <span key={cell.size} className={styles.cellEmpty} aria-hidden />;
                  const extra = note?.(cell);
                  const marked =
                    highlight === item.id || (input?.invalid?.has(item.id) ?? false)
                      ? styles.cellMarked
                      : "";
                  if (input && (input.editable?.(cell) ?? true))
                    return (
                      <label key={cell.size} className={`${styles.cell} ${marked}`}>
                        <span className={styles.cellSize}>{cell.size}</span>
                        <input
                          className={styles.cellInput}
                          type="text"
                          size={4}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={6}
                          autoComplete="off"
                          value={input.values[item.id] ?? ""}
                          disabled={input.disabled}
                          aria-invalid={input.invalid?.has(item.id) || undefined}
                          aria-label={`${item.label}, ${input.verb}`}
                          onChange={(event) => input.onChange(item.id, event.target.value)}
                        />
                        {extra && <span className={styles.cellNote}>{extra}</span>}
                      </label>
                    );
                  return (
                    <div key={cell.size} className={`${styles.cell} ${marked}`}>
                      <span className={styles.cellSize}>{cell.size}</span>
                      <ReadValue cell={cell} />
                      {extra && <span className={styles.cellNote}>{extra}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
