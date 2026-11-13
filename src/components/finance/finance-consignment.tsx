import Link from "next/link";
import { ArrowUpRight, FileText } from "lucide-react";
import { ConsignmentMonthlyFinance } from "../consignment-monthly-finance";
import { CONSIGNMENT_HREF } from "../../lib/consignment/links";
import { dayLabel, monthLabel, piecesLabel } from "../../lib/consignment/shop-model";
import type { ConsignmentFinanceSnapshot } from "../../lib/consignment/finance";
import type { MonthlyFinance } from "../../lib/consignment/shop-finance";
import type { RevisedMovement } from "../../lib/finance-revisions/projection";
import {
  archivedConsignmentReceipt,
  type ConsignmentArchive,
  type ConsignmentArchiveRow,
} from "../../lib/finance/consignment";
import { financeCentsLabel as money, type FinanceMovement } from "../../lib/finance/dashboard";
import { financeViewHref, parseFinanceView } from "../../lib/finance/workspace";
import styles from "./finance-consignment.module.css";

export type FinanceConsignmentProps = {
  snapshot: MonthlyFinance;
  legacy?: ConsignmentFinanceSnapshot | null;
  archive?: ConsignmentArchive | null;
  movements?: RevisedMovement<FinanceMovement>[];
};

function movementHref(movement: FinanceMovement) {
  return financeViewHref(
    parseFinanceView(
      { vista: "movements", periodo: "all", stato: "all", movimento: movement.id },
      movement.date,
    ),
  );
}

function ArchiveInvoice({
  row,
  payment,
}: {
  row: ConsignmentArchiveRow;
  payment?: RevisedMovement<FinanceMovement>;
}) {
  const receipt = archivedConsignmentReceipt(row, payment);
  const start = row.periodStartMonthOnly
    ? monthLabel(row.periodStart.slice(0, 7))
    : dayLabel(row.periodStart);
  const files = [
    { title: "Scarica fattura", file: row.invoice },
    { title: "Scarica riepilogo", file: row.statement },
  ];
  return (
    <article className={styles.invoice}>
      <header className={styles.invoiceHeader}>
        <div>
          <h4>
            {row.shopName} · Fattura {row.invoiceNumber}
          </h4>
          <p>
            {start} – {dayLabel(row.periodEnd)}
          </p>
          <p>Emessa il {dayLabel(row.invoiceDate)}</p>
        </div>
        <span
          className={receipt.remaining === 0n && receipt.excess === 0n ? styles.paid : styles.due}
        >
          {receipt.status}
        </span>
      </header>
      <dl className={styles.invoiceMetrics}>
        <div>
          <dt>Capi venduti</dt>
          <dd>{row.pieces}</dd>
        </div>
        <div>
          <dt>Vendite del negozio</dt>
          <dd>{money(BigInt(row.grossCents))}</dd>
        </div>
        <div>
          <dt>Quota LuckyLap</dt>
          <dd>{money(BigInt(row.brandCents))}</dd>
        </div>
        <div>
          <dt>Incassato</dt>
          <dd>{money(receipt.paid)}</dd>
        </div>
        <div>
          <dt>Da incassare</dt>
          <dd>{money(receipt.remaining)}</dd>
        </div>
      </dl>
      <div className={styles.actions}>
        {files.map(({ title, file }) => (
          <a key={file.id} href={`/finance/documents/${file.id}`}>
            <FileText aria-hidden size={16} /> {title}
          </a>
        ))}
        {payment && (
          <Link href={movementHref(payment)} prefetch={false}>
            <ArrowUpRight aria-hidden size={16} /> Apri movimento del {dayLabel(payment.date)}
          </Link>
        )}
      </div>
      {receipt.status === "Incasso da confermare" && (
        <p className={styles.paymentNote}>
          Incasso previsto il {dayLabel(row.paymentSourceDate)}. Apri il movimento per verificare e
          registrare l’incasso effettivo.
        </p>
      )}
      {row.paymentReferenceMismatch && (
        <p className={styles.paymentNote}>
          Riferimento da verificare. La nota BudgetFlow indica «{row.paymentSourceNote}».
        </p>
      )}
      <details className={styles.details}>
        <summary>Dettaglio vendite · {piecesLabel(row.pieces)}</summary>
        <div className={styles.tableWrap}>
          <table>
            <caption className="sr-only">
              Capi nella fattura {row.invoiceNumber} di {row.shopName}
            </caption>
            <thead>
              <tr>
                <th scope="col">Modello</th>
                <th scope="col">Taglia</th>
                <th scope="col">Qtà</th>
                <th scope="col">Prezzo unitario</th>
                <th scope="col">Totale</th>
                <th scope="col">Quota LuckyLap</th>
              </tr>
            </thead>
            <tbody>
              {row.lines.map((line, index) => (
                <tr key={index}>
                  <th scope="row">{line.model}</th>
                  <td>{line.size}</td>
                  <td>{line.quantity}</td>
                  <td>{money(BigInt(line.unitCents))}</td>
                  <td>{money(BigInt(line.grossCents))}</td>
                  <td>{money(BigInt(line.brandCents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}

export function FinanceConsignment({
  snapshot,
  legacy,
  archive,
  movements = [],
}: FinanceConsignmentProps) {
  const paymentById = new Map(
    movements
      .filter((movement) => movement.source === "budgetflow")
      .map((movement) => [movement.sourceId, movement]),
  );
  const shopNotes = new Map<string, ConsignmentArchiveRow>();
  for (const row of archive ?? []) {
    if (row.shopNote && !shopNotes.has(row.code)) shopNotes.set(row.code, row);
  }
  const summary = (archive ?? []).reduce(
    (result, row) => {
      const receipt = archivedConsignmentReceipt(row, paymentById.get(row.paymentTransactionId));
      return {
        pieces: result.pieces + row.pieces,
        billed: result.billed + BigInt(row.brandCents),
        received: result.received + receipt.paid,
        outstanding: result.outstanding + receipt.remaining,
      };
    },
    { pieces: 0, billed: 0n, received: 0n, outstanding: 0n },
  );
  return (
    <div className={styles.container}>
      <section aria-labelledby="fatture-storiche" className={styles.archive}>
        <div className={styles.sectionHeading}>
          <h2 id="fatture-storiche">Conto vendita</h2>
          <Link href={CONSIGNMENT_HREF} prefetch={false}>
            Apri vendite dei negozi <ArrowUpRight aria-hidden size={16} />
          </Link>
        </div>
        <h3>Fatture, vendite e incassi storici</h3>
        {archive?.length ? (
          <>
            {[...shopNotes.values()].map((row) => (
              <p key={row.code} className={styles.shopNote}>
                <strong>{row.shopName}</strong>
                {" · "}
                {row.shopNote}
              </p>
            ))}
            <dl className={styles.summary}>
              <div>
                <dt>Capi venduti</dt>
                <dd>{summary.pieces}</dd>
              </div>
              <div>
                <dt>Fatturato LuckyLap</dt>
                <dd>{money(summary.billed)}</dd>
              </div>
              <div>
                <dt>Incassato</dt>
                <dd>{money(summary.received)}</dd>
              </div>
              <div>
                <dt>Da incassare</dt>
                <dd>{money(summary.outstanding)}</dd>
              </div>
            </dl>
            {archive.map((row) => (
              <ArchiveInvoice
                key={row.id}
                row={row}
                payment={paymentById.get(row.paymentTransactionId)}
              />
            ))}
          </>
        ) : (
          <p role={archive === null ? "status" : undefined} className={styles.empty}>
            {archive === null
              ? "Lettura dell’archivio non riuscita. Riprova tra poco."
              : "Nessuna fattura storica archiviata."}
          </p>
        )}
      </section>
      <ConsignmentMonthlyFinance snapshot={snapshot} legacy={legacy} />
      {legacy === null && (
        <p className={styles.empty} role="status">
          Lettura delle vendite precedenti non riuscita.
        </p>
      )}
    </div>
  );
}
