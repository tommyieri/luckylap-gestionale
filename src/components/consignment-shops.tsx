import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import type { ShopList, ShopListRow, ShopSide } from "../lib/consignment/shop-read";
import {
  monthName,
  ordersToDeliverLabel,
  paymentStateLabel,
  piecesLabel,
  shopTermsLabel,
  tshirtsLabel,
} from "../lib/consignment/shop-model";
import { NEW_SHOP_HREF, consignmentShopHref, shopStockHref } from "../lib/consignment/links";
import { PreviewNotice } from "./consignment-pending";
import { monthAbbrev } from "./consignment-shop";
import roadbook from "./roadbook.module.css";
import styles from "./consignment-shop.module.css";

/*
 * Elenco dei negozi in conto vendita (docs/consignment.md, «Elenco»), uno per lato. Una riga
 * quadrata per negozio, tutta cliccabile; ambra per ciò che è da fare.
 * - Magazzino › Conto vendita: magliette in negozio in Condensed (o «da contare») e ordini
 *   da consegnare; porta al magazzino del negozio.
 * - Vendite › Conto vendita: il mese da registrare o l'ultimo resoconto, condizioni e stato;
 *   porta alle vendite del negozio.
 */

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** «Ottobre · 12 pezzi · Pagata» oppure «Settembre da registrare». */
export function lastReportLabel(row: ShopListRow): { text: string; late: boolean } | null {
  if (row.missingMonths.length)
    return {
      text:
        row.missingMonths.length === 1
          ? `${capitalized(monthName(row.missingMonths[0]))} da registrare`
          : `${row.missingMonths.length} resoconti da registrare`,
      late: true,
    };
  if (!row.lastReport) return null;
  return {
    text: `${capitalized(monthName(row.lastReport.month))} · ${piecesLabel(row.lastReport.pieces)} · ${row.lastReport.status}`,
    late: false,
  };
}

/** Casella «da contare» e trattino: un negozio mai contato non è mai «0». */
function UncountedSpine() {
  return (
    <>
      <span className={`${roadbook.spineValue} ${styles.spineUnknown}`} aria-hidden>
        —
      </span>
      <span className={`${roadbook.box} ${roadbook.isLate} ${styles.boxWrap}`}>da contare</span>
    </>
  );
}

/** Magazzino: magliette in negozio e ordini da consegnare. */
function StockShopRow({ row }: { row: ShopListRow }) {
  return (
    <li className={`${roadbook.row} ${styles.shopRow}`}>
      <div className={roadbook.spine}>
        {row.pieces === null ? (
          <UncountedSpine />
        ) : (
          <>
            <span className={roadbook.spineValue}>
              {new Intl.NumberFormat("it-IT").format(row.pieces)}
            </span>
            <span className={styles.spineUnit}>{row.pieces === 1 ? "maglietta" : "magliette"}</span>
          </>
        )}
      </div>
      <div className={roadbook.body}>
        <Link href={shopStockHref(row.code)} prefetch={false} className={roadbook.rowLink}>
          <span className={roadbook.title}>{row.name}</span>
          <span className="sr-only">
            {row.pieces === null ? ", da contare" : `, ${tshirtsLabel(row.pieces)} in negozio`}
          </span>
        </Link>
        <p className={roadbook.meta}>
          <span className="num">{row.code}</span> ·{" "}
          {row.pieces === null ? (
            <span className={roadbook.late}>Da contare in negozio</span>
          ) : (
            `${tshirtsLabel(row.pieces)} in negozio`
          )}
        </p>
        <p className={roadbook.meta}>
          {row.openOrders > 0
            ? ordersToDeliverLabel(row.openOrders)
            : "Nessun ordine da consegnare"}
        </p>
      </div>
    </li>
  );
}

const DONE_STATUSES = new Set([paymentStateLabel.paid, "Niente da fatturare"]);

/** Vendite: mese da registrare o ultimo resoconto, condizioni e stato della fattura. */
function SalesShopRow({ row }: { row: ShopListRow }) {
  const report = lastReportLabel(row);
  const late = row.missingMonths[0] ?? null;
  const last = row.lastReport;
  return (
    <li className={`${roadbook.row} ${styles.shopRow}`}>
      <div className={roadbook.spine}>
        {row.pieces === null ? (
          <UncountedSpine />
        ) : late ? (
          <>
            <span className={roadbook.spineValue}>{monthAbbrev(late)}</span>
            <span className={`${roadbook.box} ${roadbook.isLate}`}>da fare</span>
          </>
        ) : last ? (
          <>
            <span className={roadbook.spineValue}>{monthAbbrev(last.month)}</span>
            {DONE_STATUSES.has(last.status) && (
              <span className={`${roadbook.box} ${roadbook.isDone}`}>fatto</span>
            )}
          </>
        ) : (
          <span className={`${roadbook.spineValue} ${styles.spineUnknown}`} aria-hidden>
            —
          </span>
        )}
      </div>
      <div className={roadbook.body}>
        <Link href={consignmentShopHref(row.code)} prefetch={false} className={roadbook.rowLink}>
          <span className={roadbook.title}>{row.name}</span>
          {row.pieces === null && <span className="sr-only">, da contare</span>}
        </Link>
        <p className={roadbook.meta}>
          <span className="num">{row.code}</span> · {shopTermsLabel(row)}
        </p>
        <p className={roadbook.meta}>
          {row.pieces === null ? (
            <span className={roadbook.late}>Prima la conta in Magazzino › Conto vendita</span>
          ) : report ? (
            <span className={report.late ? roadbook.late : undefined}>{report.text}</span>
          ) : (
            "Nessun resoconto ancora"
          )}
        </p>
      </div>
    </li>
  );
}

const LEAD: Record<ShopSide, string> = {
  stock:
    "Le magliette nei negozi in conto vendita: quante ce ne sono, la conta e le consegne dal Magadzino.",
  sales: "Le vendite dei negozi: il resoconto di fine mese, la fattura e il pagamento.",
};

export function ConsignmentShops({
  list,
  side,
  canFinance,
  preview = false,
}: {
  list: ShopList;
  side: ShopSide;
  canFinance: boolean;
  preview?: boolean;
}) {
  const empty = list.shops.length === 0 && list.closed.length === 0;
  const Row = side === "stock" ? StockShopRow : SalesShopRow;
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Conto vendita</h1>
          <p className={styles.lead}>{LEAD[side]}</p>
        </div>
        {canFinance && !empty && (
          <Link href={NEW_SHOP_HREF} prefetch={false} className="button button-secondary">
            <Plus size={16} strokeWidth={1.8} aria-hidden />
            Nuovo negozio
          </Link>
        )}
      </header>
      {preview && <PreviewNotice />}
      {empty ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>Nessun negozio in conto vendita.</p>
          {canFinance ? (
            <Link href={NEW_SHOP_HREF} prefetch={false} className="button button-primary">
              <Plus size={16} strokeWidth={1.8} aria-hidden />
              Nuovo negozio
            </Link>
          ) : (
            <p className={styles.muted}>
              Per aggiungere un negozio <Link href="/auth/area/finance">apri Finance</Link>.
            </p>
          )}
        </div>
      ) : (
        <>
          {list.shops.length ? (
            <ul className={roadbook.list} aria-label="Negozi attivi">
              {list.shops.map((row) => (
                <Row key={row.locationId} row={row} />
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>Nessun negozio attivo.</p>
          )}
          {!canFinance && (
            <p className={styles.muted}>
              Per aggiungere un negozio <Link href="/auth/area/finance">apri Finance</Link>.
            </p>
          )}
          {list.closed.length > 0 && (
            <details className={styles.fold}>
              <summary>
                <ChevronRight size={18} strokeWidth={2} className={styles.foldIcon} aria-hidden />
                Negozi chiusi <span className="num">{list.closed.length}</span>
              </summary>
              <ul className={roadbook.list} aria-label="Negozi chiusi">
                {list.closed.map((row) => (
                  <Row key={row.locationId} row={row} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
