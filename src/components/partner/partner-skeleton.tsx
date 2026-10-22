import styles from "./partner.module.css";

const CELLS = ["Adesso", "·", "·", "·", "·"];

/**
 * Caricamento di /partner (spec 02 §5.11): titolo, celle dei periodi con «·», barra degli
 * strumenti spenta, sei righe scheletro con la casella CO e due linee grigie.
 */
export function PartnerSkeleton() {
  return (
    <div className={styles.workspace} role="status" aria-live="polite">
      <span className="sr-only">Carico i contatti…</span>
      <header className={styles.heading}>
        <h1>Partner</h1>
        <p className={styles.totals} aria-hidden="true">
          ·
        </p>
      </header>
      <div className={styles.periodBar} aria-hidden="true">
        <div className={styles.periods}>
          {CELLS.map((cell, index) => (
            <span key={index} className={styles.period}>
              <span className={styles.periodLabel}>{cell}</span>
              <span className={styles.periodCount}>·</span>
            </span>
          ))}
        </div>
      </div>
      <div className={styles.toolbar} aria-hidden="true">
        <span className={`${styles.search} ${styles.skeletonField}`} />
        <span className={`${styles.filter} ${styles.skeletonField}`} />
        <span className={`${styles.filter} ${styles.skeletonField}`} />
      </div>
      <ol className={styles.list} aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className={`${styles.row} ${styles.skeletonRow}`}>
            <div className={styles.co}>
              <span className={styles.coLabel}>CO</span>
              <span className={styles.coNum}>·</span>
            </div>
            <div className={styles.leg}>
              <div className={styles.skeletonLines}>
                <span />
                <span />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Caricamento delle pagine secondarie: titolo e tre linee grigie. */
export function PartnerPageSkeleton({ title }: { title: string }) {
  return (
    <div className={styles.workspace} role="status" aria-live="polite">
      <span className="sr-only">Caricamento…</span>
      <header className={styles.heading}>
        <h1>{title}</h1>
      </header>
      <div className={styles.skeletonLines} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
