"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  FileSpreadsheet,
  Search,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import type { InventoryItem, InventorySourceMeta } from "../lib/types";
import { orderInventoryItems } from "../lib/inventory-order";
import {
  filterInventoryItems,
  stockModelHref,
  type StockFilter,
} from "../lib/inventory/model-filter";
import { tshirtLineForModel, type TshirtLineCount } from "../lib/inventory/tshirt-lines";
import { TshirtAvailability } from "./tshirt-availability";

/*
 * Giacenze (`/stock`), estratte dal vecchio monolite `management-app.tsx`
 * (docs: 01-layout §5). Con `shared` le quantità arrivano dal database con i
 * movimenti; senza (anteprima locale) dallo snapshot dell'inventario.
 */

const euro = (value: number | null) =>
  value === null
    ? "Non disponibile"
    : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);
const qty = (value: number | null) =>
  value === null ? "n.d." : new Intl.NumberFormat("it-IT").format(value);
/** «In negozio»: «—» finché nessun negozio è stato contato (03-4). */
const shopQty = (value: number | null) =>
  value === null ? "—" : new Intl.NumberFormat("it-IT").format(value);
const sumKnown = (values: (number | null)[]) =>
  values.length && values.every((value) => value !== null)
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;

function itemStatus(item: InventoryItem) {
  return !item.active
    ? "Inattivo"
    : item.centralQuantity === null
      ? "Da verificare"
      : item.centralQuantity === 0
        ? "Esaurito"
        : "Disponibile";
}
function Status({ item }: { item: InventoryItem }) {
  const status = itemStatus(item);
  return (
    <span
      className={`stock-status ${status === "Disponibile" ? "available" : status === "Esaurito" ? "empty" : "unknown"}`}
    >
      <span />
      {status}
    </span>
  );
}
function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={25} strokeWidth={1.6} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
/** Da dove vengono i numeri: niente link al file Drive, niente note tecniche (06 R3). */
function SourceInfo({ shared }: { shared: boolean }) {
  return (
    <details className="source-details">
      <summary>
        <FileSpreadsheet size={16} />
        <span>Da dove vengono i numeri</span>
        <ChevronDown size={15} />
      </summary>
      <div className="source-content">
        <p>
          Conta iniziale dal file inventario del 21 ottobre 2026. Poi contano solo i movimenti
          registrati qui. Shopify non cambia queste quantità.
        </p>
        {!shared && <p>Nell’anteprima locale si vedono solo le quantità del file.</p>}
      </div>
    </details>
  );
}

export function InventoryWorkspace({
  items,
  shared,
  model = null,
  tshirts,
}: {
  items: InventoryItem[];
  /** Provenienza dell'inventario: resta nel contratto della pagina, non si mostra (06 R3). */
  sourceMeta: InventorySourceMeta;
  shared: boolean;
  /** Filtro `?modello=` letto dal server. */
  model?: string | null;
  /** «Magliette disponibili»: `lines` è `null` se la lettura del Magadzino non è riuscita. */
  tshirts?: { lines: TshirtLineCount[] | null; preview: boolean };
}) {
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <>
      <InventoryView
        items={items}
        onSelect={setSelected}
        shared={shared}
        notify={setToast}
        initialModel={model}
        tshirts={tshirts}
      />
      {selected && (
        <ProductDetail
          item={selected}
          shared={shared}
          onClose={() => setSelected(null)}
          notify={setToast}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </>
  );
}

function InventoryView({
  items,
  onSelect,
  notify,
  shared,
  initialModel,
  tshirts,
}: {
  items: InventoryItem[];
  onSelect: (item: InventoryItem) => void;
  notify: (text: string) => void;
  shared: boolean;
  initialModel: string | null;
  tshirts?: { lines: TshirtLineCount[] | null; preview: boolean };
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [stock, setStock] = useState<StockFilter>("all");
  const [grouped, setGrouped] = useState(true);
  const [model, setModel] = useState(initialModel);
  // Una navigazione verso un altro `?modello=` porta un nuovo filtro dal server.
  const [modelFromServer, setModelFromServer] = useState(initialModel);
  if (initialModel !== modelFromServer) {
    setModelFromServer(initialModel);
    setModel(initialModel);
  }
  const panelRef = useRef<HTMLElement>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  const filtered = useMemo(
    () => filterInventoryItems(orderInventoryItems(items), { search, category, stock, model }),
    [items, search, category, stock, model],
  );
  const modelName = model ? (tshirtLineForModel(model)?.name ?? model) : null;
  /** Un riquadro delle magliette: solo quel modello, con l'indirizzo aggiornato. */
  function chooseModel(next: string | null) {
    setModel(next);
    if (next) {
      setSearch("");
      setCategory("all");
      setStock("all");
    }
    try {
      window.history.replaceState(null, "", stockModelHref(next));
    } catch {
      // Indirizzo non aggiornabile: il filtro resta valido in questa pagina.
    }
    if (next) setScrollRequest((count) => count + 1);
  }
  // Sul telefono la tabella sta sotto i riquadri: dopo il filtro la porta in vista se è fuori
  // schermo. Aspetta il ridisegno, che altrimenti interrompe lo scorrimento.
  useEffect(() => {
    if (!scrollRequest) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.getBoundingClientRect().top <= window.innerHeight * 0.7) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      panel.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollRequest]);
  function resetFilters() {
    setSearch("");
    setCategory("all");
    setStock("all");
    if (model) chooseModel(null);
  }
  const groups = useMemo(() => {
    const result: [string, InventoryItem[]][] = [];
    if (!grouped) return [["", filtered]] as [string, InventoryItem[]][];
    for (const item of filtered) {
      const group = result.find(([name]) => name === item.model);
      if (group) group[1].push(item);
      else result.push([item.model, [item]]);
    }
    return result;
  }, [filtered, grouped]);
  const central = sumKnown(items.map((item) => item.centralQuantity));
  const inConsignment = sumKnown(items.map((item) => item.consignmentQuantity));
  function exportCsv() {
    const columns = [
      "SKU",
      "Modello",
      "Categoria",
      "Colore",
      "Taglia",
      "Magadzino",
      "In negozio",
      "Costo unitario EUR",
      "Prezzo web EUR",
    ];
    const rows = filtered.map((item) => [
      item.sku,
      item.model,
      item.category,
      item.color,
      item.size,
      item.centralQuantity,
      item.consignmentQuantity,
      item.unitCost,
      item.webPrice,
    ]);
    const safeCell = (value: string | number | null) => {
      let text = String(value ?? "");
      if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const csv = [columns, ...rows].map((row) => row.map(safeCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "luckylap-inventario.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify(`${filtered.length} varianti esportate`);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Magazzino</h1>
          <p>Tutti i prodotti, con le quantità del magazzino centrale.</p>
        </div>
        <button className="button button-secondary" onClick={exportCsv} disabled={!filtered.length}>
          <ArrowDownToLine size={16} />
          Esporta CSV
        </button>
      </div>
      {tshirts && (
        <TshirtAvailability
          lines={tshirts.lines}
          preview={tshirts.preview}
          activeModel={model}
          onSelect={chooseModel}
        />
      )}
      <div className="inventory-summary">
        <div className="summary-cell">
          <span>Catalogo</span>
          <strong>
            {items.length}
            <small>varianti</small>
          </strong>
        </div>
        <div className="summary-cell">
          <span>Modelli</span>
          <strong>
            {new Set(items.map((item) => item.model)).size}
            <small>in anagrafica</small>
          </strong>
        </div>
        <div className="summary-cell">
          <span>Magadzino</span>
          <strong className={central === null ? "value-unavailable" : ""}>
            {qty(central)}
            <small>{central === null ? "dato incompleto" : "pezzi"}</small>
          </strong>
        </div>
        <div className="summary-cell">
          <span>In negozio</span>
          <strong className={inConsignment === null ? "value-unavailable" : ""}>
            {shopQty(inConsignment)}
            <small>{inConsignment === null ? "da contare" : "pezzi"}</small>
          </strong>
        </div>
        <div className="summary-source">
          <span className="source-icon">
            <FileSpreadsheet size={22} strokeWidth={1.6} />
          </span>
          <div>
            <strong>{shared ? "Inventario condiviso" : "Snapshot Excel"}</strong>
            <span>{shared ? "Aggiornato dai movimenti" : "Sola lettura · nessun ricalcolo"}</span>
          </div>
        </div>
      </div>
      <div className="inventory-note">
        <AlertCircle size={16} />
        <p>
          Le quantità mancanti sono indicate con <strong>n.d.</strong> e non vengono considerate
          zero. «In negozio» somma i negozi già contati in Conto vendita: <strong>—</strong> finché
          nessun negozio è stato contato. Le scorte Shopify non sono incluse.
        </p>
      </div>
      <section className="inventory-panel" aria-label="Inventario prodotti" ref={panelRef}>
        <div className="inventory-toolbar">
          <div className="search-input">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cerca prodotto, SKU o colore…"
              aria-label="Cerca prodotto, SKU o colore"
            />
            {search && (
              <button aria-label="Cancella ricerca" onClick={() => setSearch("")}>
                <X size={15} />
              </button>
            )}
          </div>
          <div className="inventory-filters">
            <label className="select-wrap">
              <span className="sr-only">Categoria</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="all">Tutte le categorie</option>
                {[...new Set(items.map((item) => item.category))].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
            <label className="select-wrap">
              <span className="sr-only">Disponibilità Magadzino</span>
              <select
                value={stock}
                onChange={(event) => setStock(event.target.value as StockFilter)}
              >
                <option value="all">Tutte le disponibilità</option>
                <option value="available">Disponibili</option>
                <option value="empty">Esauriti</option>
                <option value="unknown">Da verificare</option>
              </select>
              <ChevronDown size={14} />
            </label>
            {model && modelName && (
              <button
                type="button"
                className="group-button is-active"
                onClick={() => chooseModel(null)}
                aria-pressed="true"
                aria-label={`Togli il filtro ${modelName}: mostra tutti i prodotti`}
              >
                <span>{modelName}</span>
                <X size={15} />
              </button>
            )}
            <button
              className={`group-button ${grouped ? "is-active" : ""}`}
              onClick={() => setGrouped((value) => !value)}
              aria-pressed={grouped}
            >
              <SlidersHorizontal size={15} />
              <span>Per modello</span>
            </button>
          </div>
        </div>
        <div className="table-caption">
          <span>
            <strong>{filtered.length}</strong> {filtered.length === 1 ? "variante" : "varianti"}
            {filtered.length !== items.length ? ` su ${items.length}` : " a catalogo"}
          </span>
          <span>
            Seleziona un prodotto per i dettagli <ArrowUpRight size={13} />
          </span>
        </div>
        <div className="table-scroll">
          <table className="inventory-table">
            <thead>
              <tr>
                <th scope="col">Prodotto / SKU</th>
                <th scope="col">Colore</th>
                <th scope="col" className="size-column">
                  Taglia
                </th>
                <th scope="col" className="numeric">
                  Magadzino
                </th>
                <th scope="col" className="numeric">
                  In negozio
                </th>
                <th scope="col" className="numeric">
                  Prezzo web
                </th>
                <th scope="col">Stato</th>
                <th scope="col">
                  <span className="sr-only">Dettaglio</span>
                </th>
              </tr>
            </thead>
            {groups.map(([model, group]) => (
              <tbody key={model || "all"}>
                {grouped && (
                  <tr className="model-row">
                    <th colSpan={8} scope="rowgroup">
                      <span>{model}</span>
                      <span className="model-count">
                        {group.length} {group.length === 1 ? "variante" : "varianti"}
                      </span>
                    </th>
                  </tr>
                )}
                {group.map((item) => (
                  <tr key={item.id} className="product-row" onClick={() => onSelect(item)}>
                    <td>
                      <button
                        className="product-name"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(item);
                        }}
                        aria-label={`Dettagli ${item.model}, ${item.sku}`}
                      >
                        <strong>{item.model}</strong>
                        <span>{item.sku}</span>
                      </button>
                    </td>
                    <td>
                      <span className="color-label">
                        <span
                          className={`color-swatch ${item.color.toLowerCase().includes("nero") || item.color.toLowerCase().includes("black") ? "black" : item.color.toLowerCase().includes("bianco") || item.color.toLowerCase().includes("white") ? "white" : "neutral"}`}
                        />
                        {item.color || "—"}
                      </span>
                    </td>
                    <td className="size-column">
                      <span className="size-tag">{item.size || "—"}</span>
                    </td>
                    <td
                      className={`numeric quantity ${item.centralQuantity === null ? "muted" : item.centralQuantity === 0 ? "zero-quantity" : ""}`}
                    >
                      {qty(item.centralQuantity)}
                    </td>
                    <td
                      className={`numeric quantity ${item.consignmentQuantity === null ? "muted" : ""}`}
                    >
                      {shopQty(item.consignmentQuantity)}
                    </td>
                    <td className="numeric price">{euro(item.webPrice)}</td>
                    <td>
                      <Status item={item} />
                    </td>
                    <td className="row-arrow">
                      <ChevronRight size={16} />
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        {!filtered.length && (
          <EmptyState
            icon={Search}
            title="Nessuna variante trovata"
            action={
              <button className="button button-secondary" onClick={resetFilters}>
                Azzera i filtri
              </button>
            }
          >
            Prova un altro SKU, modello o colore, oppure rimuovi i filtri.
          </EmptyState>
        )}
        <div className="table-footer">
          <span>Magadzino e negozi restano separati.</span>
          <span>
            {filtered.length} / {items.length} varianti
          </span>
        </div>
      </section>
      <SourceInfo shared={shared} />
    </>
  );
}

function ProductDetail({
  item,
  onClose,
  notify,
  shared,
}: {
  item: InventoryItem;
  onClose: () => void;
  notify: (text: string) => void;
  shared: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const margin =
    item.webPrice !== null && item.unitCost !== null ? item.webPrice - item.unitCost : null;
  async function copySku() {
    try {
      await navigator.clipboard.writeText(item.sku);
      notify("SKU copiato");
    } catch {
      notify("Copia non disponibile: seleziona lo SKU nel dettaglio");
    }
  }
  return (
    <dialog
      className="product-dialog"
      ref={dialogRef}
      onCancel={onClose}
      aria-labelledby="product-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="detail-inner">
        <div className="detail-topline">
          <span>Dettaglio prodotto</span>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Chiudi dettaglio prodotto"
            autoFocus
          >
            <X size={21} />
          </button>
        </div>
        <div className="product-detail-heading">
          <span className="subtle-label">{item.category}</span>
          <h2 id="product-title">{item.model}</h2>
          <div className="detail-sku">
            <span>{item.sku}</span>
            <button className="icon-button" onClick={copySku} aria-label="Copia SKU">
              <Copy size={15} />
            </button>
          </div>
          <Status item={item} />
        </div>
        <dl className="variant-details">
          <div>
            <dt>Colore</dt>
            <dd>{item.color || "Non disponibile"}</dd>
          </div>
          <div>
            <dt>Taglia</dt>
            <dd>{item.size || "Non disponibile"}</dd>
          </div>
        </dl>
        <section className="detail-section">
          <h3>{shared ? "Giacenze attuali" : "Giacenze dalla fonte Excel"}</h3>
          <div className="detail-quantities">
            <div>
              <span>Magadzino</span>
              <strong>
                {qty(item.centralQuantity)}
                <small>{item.centralQuantity === null ? "da verificare" : "pezzi"}</small>
              </strong>
            </div>
            <div>
              <span>In negozio</span>
              <strong>
                {shopQty(item.consignmentQuantity)}
                <small>{item.consignmentQuantity === null ? "da contare" : "pezzi"}</small>
              </strong>
            </div>
          </div>
          {item.targetQuantity !== null && (
            <p className="detail-footnote">
              Assortimento obiettivo: {qty(item.targetQuantity)} pezzi
            </p>
          )}
        </section>
        <section className="detail-section">
          <h3>Costi e listini</h3>
          <dl className="price-list">
            <div>
              <dt>Costo unitario</dt>
              <dd>{euro(item.unitCost)}</dd>
            </div>
            <div>
              <dt>Prezzo web</dt>
              <dd>{euro(item.webPrice)}</dd>
            </div>
            <div>
              <dt>Differenza prezzo / costo</dt>
              <dd>{euro(margin)}</dd>
            </div>
            <div>
              <dt>Listino conto vendita</dt>
              <dd>{euro(item.webPrice !== null ? item.webPrice + 10 : null)}</dd>
            </div>
          </dl>
          <p className="detail-footnote">
            Differenza indicativa tra prezzo web e costo fornitore. Packaging, commissioni e altri
            costi non sono inclusi; trattamento IVA da verificare. Listino conto vendita: web + 10
            €.
          </p>
        </section>
        <div className="read-only-note">
          <Database size={18} />
          <div>
            <strong>{shared ? "Rettifiche tracciate" : "Scorte in sola lettura"}</strong>
            {shared ? (
              <p>
                Le quantità cambiano con vendite, consegne e movimenti. Per una correzione usa le{" "}
                <Link href="/stock/rettifiche" prefetch={false}>
                  rettifiche di magazzino
                </Link>
                , indicando la causale.
              </p>
            ) : (
              <p>Questa anteprima non modifica le giacenze condivise.</p>
            )}
          </div>
        </div>
        <button className="button button-secondary full-width" onClick={copySku}>
          <Copy size={15} />
          Copia SKU
        </button>
      </div>
    </dialog>
  );
}
