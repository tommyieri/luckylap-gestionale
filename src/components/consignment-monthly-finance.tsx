import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { MonthlyFinance, MonthlyFinanceRow } from "../lib/consignment/shop-finance";
import type { ConsignmentFinanceSnapshot } from "../lib/consignment/finance";
import { consignmentMoney as money } from "../lib/consignment/model";
import { dayLabel, piecesLabel, PREVIEW_NOTICE } from "../lib/consignment/shop-model";
import { CONSIGNMENT_FINANCE_ANCHOR, CONSIGNMENT_HREF } from "../lib/consignment/links";
import roadbook from "./roadbook.module.css";
import styles from "./consignment-shop.module.css";

/*
 * Conto vendita in Finance (docs/finance-dashboard.md, decisioni 12 e 13). Una riga
 * per resoconto mensile: pezzi, incasso del negozio, da fatturare, fattura,
 * incassato, residuo e stato. Sono importi da incassare, non denaro: nei saldi
 * entra solo il pagamento del negozio, come movimento «Pagamento del negozio».
 * Componente senza stato: lo rendono le pagine Finance, sul server.
 */

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const monthShortFormat = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", month: "short" });
/** «set» da «2026-09». */
const monthAbbrev = (month: string) => {
  const [year, m] = month.split("-").map(Number);
  return monthShortFormat.format(new Date(Date.UTC(year, m - 1, 15))).replace(".", "");
};
const dateFormat = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** Avviso dell'anteprima locale nelle pagine Finance, senza codice del browser. */
export function FinancePreviewNotice() {
  return (
    <p className={`${styles.previewNotice} ${styles.financePreview}`} role="status">
      {PREVIEW_NOTICE}
    </p>
  );
}

/** Casella della colonna di controllo: verde chiaro per il fatto, ambra per ciò che va controllato. */
export function financeRowBox(row: MonthlyFinanceRow): { text: string; cls: string } | null {
  if (row.paymentState === "paid" || row.paymentState === "nothing_due")
    return { text: "fatto", cls: roadbook.isDone };
  if (row.paymentState === "overpaid") return { text: "controlla", cls: roadbook.isLate };
  return null;
}

function FinanceRow({ row }: { row: MonthlyFinanceRow }) {
  const box = financeRowBox(row);
  const toInvoice = row.invoice === null && row.brandCents > 0;
  return (
    <li className={`${roadbook.row} ${styles.wideRow}`}>
      <div className={roadbook.spine}>
        <span className={roadbook.spineValue}>{monthAbbrev(row.month)}</span>
        {box ? (
          <span className={`${roadbook.box} ${box.cls}`}>{box.text}</span>
        ) : (
          <span className={styles.spineUnit}>{row.month.slice(0, 4)}</span>
        )}
      </div>
      <div className={roadbook.body}>
        <Link href={row.href} prefetch={false} className={roadbook.rowLink}>
          <span className={roadbook.title}>{row.shopName}</span>
          <span className="sr-only">, resoconto di {row.monthLabel}</span>
        </Link>
        <p className={roadbook.meta}>
          {capitalized(row.monthLabel)} ·{" "}
          {row.pieces === 0 ? "nessuna vendita" : piecesLabel(row.pieces)} · Incasso del negozio{" "}
          <span className="num">{money(row.grossCents)}</span>
        </p>
        <p className={roadbook.meta}>
          Da fatturare <span className="num">{money(row.brandCents)}</span> ·{" "}
          {row.invoice ? (
            <>
              Fattura n. <span className="num">{row.invoice.number}</span> del{" "}
              {dayLabel(row.invoice.date)}
            </>
          ) : toInvoice ? (
            <span className={roadbook.late}>Fattura da emettere</span>
          ) : (
            "Niente da fatturare"
          )}{" "}
          · Incassato <span className="num">{money(row.paidCents)}</span>
        </p>
      </div>
      <div className={`${roadbook.side} ${styles.financeSide}`}>
        <span className={styles.financeAmount}>{money(row.remainingCents)}</span>
        <span className={styles.financeAmountLabel}>
          {row.overpaidCents > 0 ? (
            <span className={roadbook.late}>{money(row.overpaidCents)} in più</span>
          ) : (
            row.status
          )}
        </span>
      </div>
    </li>
  );
}

/** Vendite singole del modulo precedente, con i loro incassi: solo se esistono. */
function EarlierSales({ legacy }: { legacy: ConsignmentFinanceSnapshot }) {
  return (
    <details className={styles.fold}>
      <summary>
        <ChevronRight size={18} strokeWidth={2} className={styles.foldIcon} aria-hidden />
        Vendite registrate prima del resoconto mensile{" "}
        <span className="num">{legacy.rows.length}</span>
      </summary>
      <p className={styles.footnote}>
        Registrate una per una con il modulo precedente. I loro incassi restano tra i movimenti come
        «Incasso conto vendita».
      </p>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Vendita</th>
              <th scope="col">Pezzi</th>
              <th scope="col">Incasso del negozio</th>
              <th scope="col">Quota LuckyLap</th>
              <th scope="col">Incassato</th>
              <th scope="col">Residuo</th>
            </tr>
          </thead>
          <tbody>
            {legacy.rows.map((r) => (
              <tr key={r.saleId}>
                <th scope="row">
                  {r.sku}
                  <span className={styles.financeCellNote}>
                    {r.shopLabel} · {dateFormat.format(new Date(r.occurredAt))}
                  </span>
                </th>
                <td data-label="Pezzi">{r.quantity}</td>
                <td data-label="Incasso del negozio">{money(r.grossCents)}</td>
                <td data-label="Quota LuckyLap">{money(r.brandClaimCents)}</td>
                <td data-label="Incassato">{money(r.settledCents)}</td>
                <td data-label="Residuo">{money(r.remainingCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Pannello «Conto vendita · da incassare». In alto un solo totale: la somma dei
 * residui. Con `legacy` (solo in Registrazioni) anche le vendite del modulo
 * precedente, se ce ne sono.
 */
export function ConsignmentMonthlyFinance({
  snapshot,
  legacy = null,
}: {
  snapshot: MonthlyFinance;
  legacy?: ConsignmentFinanceSnapshot | null;
}) {
  const open = snapshot.rows.filter((r) => r.remainingCents > 0).length;
  return (
    <section
      id={CONSIGNMENT_FINANCE_ANCHOR}
      className={styles.financePanel}
      aria-labelledby={`${CONSIGNMENT_FINANCE_ANCHOR}-titolo`}
    >
      <div className={styles.financeHead}>
        <div>
          <h2 id={`${CONSIGNMENT_FINANCE_ANCHOR}-titolo`} className={styles.financeTitle}>
            Conto vendita · da incassare
          </h2>
          <p className={styles.financeLead}>
            Resoconti mensili dei negozi. Sono importi ancora da ricevere: nei conti entra solo il
            pagamento del negozio.
          </p>
        </div>
        <p className={styles.financeTotal}>
          <span>Da incassare</span>
          <strong className={styles.financeTotalValue}>{money(snapshot.toCollectCents)}</strong>
          <span>
            {open === 0
              ? "Nessun resoconto aperto"
              : open === 1
                ? "1 resoconto aperto"
                : `${open} resoconti aperti`}
          </span>
        </p>
      </div>
      <div className={styles.financeBody}>
        {snapshot.rows.length ? (
          <ul className={roadbook.list} aria-label="Resoconti mensili">
            {snapshot.rows.map((row) => (
              <FinanceRow key={row.reportId} row={row} />
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>
            Nessun resoconto registrato. I resoconti si registrano dalla pagina del negozio.
          </p>
        )}
        {legacy && legacy.rows.length > 0 && <EarlierSales legacy={legacy} />}
        <div className={styles.financeFoot}>
          <p className={styles.footnote}>
            Importi commerciali. Il trattamento IVA va verificato a parte.
          </p>
          <Link href={CONSIGNMENT_HREF} prefetch={false} className={styles.inlineLink}>
            Apri conto vendita
          </Link>
        </div>
      </div>
    </section>
  );
}
