"use client";
import Link from "next/link";
import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import {
  formatCalendarDate,
  formatLocalTimestamp,
  type FinanceSnapshot,
} from "../../lib/finance/model";
import type { FinanceWorkSnapshot } from "../../lib/finance-work/model";
import { FinanceSourceObservations } from "./finance-source-observations";
import styles from "./finance-workspace.module.css";

export function FinanceSources({
  snapshot,
  work,
  openBatch,
  readOnly = false,
}: {
  snapshot: FinanceSnapshot;
  work?: FinanceWorkSnapshot;
  readOnly?: boolean;
  openBatch: (batchId: string) => void;
}) {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [limit, setLimit] = useState(25);
  const selected = snapshot.batches.find((b) => b.id === batchId);
  const originals = selected ? snapshot.transactions.filter((t) => t.batchId === selected.id) : [];
  return (
    <section className={styles.sources} aria-labelledby="sources-title">
      <header className={styles.sectionHeading}>
        <div>
          <h2 id="sources-title">Documenti e fonti</h2>
          <p>
            Le fonti originali rimangono conservate. Le correzioni si fanno dalla scheda del
            movimento.
          </p>
        </div>
      </header>
      <h3>Importazioni Budget Flow</h3>
      {snapshot.batches.length === 0 ? (
        <p className={styles.emptyText}>Nessun file importato.</p>
      ) : (
        <div className={styles.sourceRows}>
          {snapshot.batches.map((batch) => (
            <article key={batch.id} className={styles.sourceRow}>
              <FileSpreadsheet size={22} aria-hidden="true" />
              <div>
                <strong>{batch.sourceFileName}</strong>
                <p>
                  {batch.sourceRowCount} righe · riferimento{" "}
                  {formatCalendarDate(batch.referenceDate)}
                </p>
                <p>Importato il {formatLocalTimestamp(batch.importedAt)} · Da verificare</p>
              </div>
              <div className={styles.sourceActions}>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setBatchId(batchId === batch.id ? null : batch.id);
                    setLimit(25);
                  }}
                >
                  Dati originali
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => openBatch(batch.id)}
                >
                  Apri i movimenti
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {selected && (
        <section
          className={styles.originals}
          aria-label={`Dati originali di ${selected.sourceFileName}`}
        >
          <h3>{selected.sourceFileName}</h3>
          <p>
            Data di estrazione {formatLocalTimestamp(selected.extractedAt)}. Valori conservati dal
            file, prima delle correzioni.
          </p>
          {originals.slice(0, limit).map((row) => (
            <details key={row.id} className={styles.originalRow}>
              <summary>
                Riga {row.sourceRow} · {row.payee || row.category || "Movimento"} ·{" "}
                {row.formattedAmount}
              </summary>
              <dl>
                {[
                  ["Data originale", row.sourceDate],
                  ["Data e ora del file", row.sourceTimestamp],
                  ["Importo originale", row.sourceAmount],
                  ["Conto", row.account],
                  ["Conto di destinazione", row.targetAccount],
                  ["Categoria", row.category],
                  ["Beneficiario", row.payee],
                  ["Cartella", row.folder],
                  ["Tag", row.tags],
                  ["Note", row.notes],
                  ["In sospeso", row.pending ? "Sì" : "No"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || "Non indicato"}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
          {limit < originals.length && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setLimit((n) => n + 25)}
            >
              Mostra altre righe ({limit} di {originals.length})
            </button>
          )}
        </section>
      )}
      <details className={styles.advanced}>
        <summary>Come leggere le altre fonti</summary>
        <p>
          Un ordine, un pagamento e un accredito bancario sono fatti diversi. Qui non viene dedotto
          un conto dal metodo di pagamento e non viene aggiunta una seconda entrata per descrivere
          lo stesso incasso.
        </p>
        <p>
          Le voci manuali, i pagamenti, i rimborsi e gli incassi dei negozi sono consultabili dal
          registro, usando il filtro Fonte.
        </p>
        {work && (
          <p>
            {work.entries.length} voci manuali conservate · {work.payments.length} pagamenti degli
            ordini · {work.refunds.length} rimborsi osservati.
          </p>
        )}
        <Link href="/sales" prefetch={false}>
          Apri Vendite
        </Link>
      </details>
      {work && (
        <details className={styles.advanced}>
          <summary>Osservazioni commerciali e Shopify</summary>
          <p>
            Valori conservati dalla fonte. Sono distinti dai flussi revisionati e non si sommano ai
            saldi.
          </p>
          <FinanceSourceObservations snapshot={work} readOnly={readOnly} />
        </details>
      )}
      <Link href="/finance/documents" prefetch={false} className="button button-secondary">
        Documenti Finance
      </Link>
    </section>
  );
}
