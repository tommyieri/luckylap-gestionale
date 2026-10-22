import roadbook from "../../../../components/roadbook.module.css";
import styles from "../../../../components/consignment-shop.module.css";

/** Testata e righe vuote, alte come quelle vere. */
export default function ShopLoading() {
  return (
    <div className={styles.loading} aria-busy="true">
      <p role="status" className={styles.loadingText}>
        Caricamento del conto vendita…
      </p>
      <span className={styles.skeletonBlock} aria-hidden="true" />
      <ul className={roadbook.list} aria-hidden="true">
        {[0, 1, 2].map((row) => (
          <li key={row} className={roadbook.row}>
            <span className={roadbook.spine} />
            <span className={roadbook.body} />
          </li>
        ))}
      </ul>
    </div>
  );
}
