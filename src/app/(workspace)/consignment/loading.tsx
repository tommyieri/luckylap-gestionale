import roadbook from "../../../components/roadbook.module.css";
import styles from "../../../components/consignment-shop.module.css";

/** Righe vuote alte come quelle vere: nessun salto quando arrivano i dati. */
export default function ConsignmentLoading() {
  return (
    <div className={styles.loading} aria-busy="true">
      <p role="status" className={styles.loadingText}>
        Caricamento del conto vendita…
      </p>
      <ul className={roadbook.list} aria-hidden="true">
        {[0, 1, 2].map((row) => (
          <li key={row} className={`${roadbook.row} ${styles.shopRow}`}>
            <span className={roadbook.spine} />
            <span className={roadbook.body} />
          </li>
        ))}
      </ul>
    </div>
  );
}
