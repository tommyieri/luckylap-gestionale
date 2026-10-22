import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import type { ShopList, ShopListRow } from "../lib/consignment/shop-read";
import {
  monthName,
  piecesLabel,
  shopTermsLabel,
  tshirtsLabel,
} from "../lib/consignment/shop-model";
import { NEW_SHOP_HREF } from "../lib/consignment/links";
import { PreviewNotice } from "./consignment-pending";
import roadbook from "./roadbook.module.css";
import styles from "./consignment-shop.module.css";

/*
 * Elenco dei negozi in conto vendita (docs/consignment.md, «Elenco»). Una riga
 * quadrata per negozio, tutta cliccabile: giacenza contata in Condensed, ultimo
 * resoconto, ordini aperti. Ambra per ciò che è da fare.
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

function ShopRow({ row }: { row: ShopListRow }) {
  const report = lastReportLabel(row);
  return (
    <li className={`${roadbook.row} ${styles.shopRow}`}>
      <div className={roadbook.spine}>
        {row.pieces === null ? (
          <>
            <span className={`${roadbook.spineValue} ${styles.spineUnknown}`} aria-hidden>
              —
            </span>
            <span className={`${roadbook.box} ${roadbook.isLate} ${styles.boxWrap}`}>
              da contare
            </span>
          </>
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
        <Link href={row.href} prefetch={false} className={roadbook.rowLink}>
          <span className={roadbook.title}>{row.name}</span>
          <span className="sr-only">
            {row.pieces === null ? ", da contare" : `, ${tshirtsLabel(row.pieces)} in negozio`}
          </span>
        </Link>
        <p className={roadbook.meta}>
          <span className="num">{row.code}</span> · {shopTermsLabel(row)}
        </p>
        {(report || row.openOrders > 0) && (
          <p className={roadbook.meta}>
            {report && (
              <span className={report.late ? roadbook.late : undefined}>{report.text}</span>
            )}
            {report && row.openOrders > 0 && " · "}
            {row.openOrders > 0 && (
              <span>
                {row.openOrders === 1 ? "1 ordine" : `${row.openOrders} ordini`} da consegnare
              </span>
            )}
          </p>
        )}
      </div>
    </li>
  );
}

export function ConsignmentShops({
  list,
  canFinance,
  preview = false,
}: {
  list: ShopList;
  canFinance: boolean;
  preview?: boolean;
}) {
  const empty = list.shops.length === 0 && list.closed.length === 0;
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Conto vendita</h1>
          <p className={styles.lead}>
            I negozi che vendono le nostre magliette e ci mandano il resoconto a fine mese.
          </p>
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
                <ShopRow key={row.locationId} row={row} />
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
                  <ShopRow key={row.locationId} row={row} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
