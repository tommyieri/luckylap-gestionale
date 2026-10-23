import roadbook from "../../../../components/roadbook.module.css";
import styles from "../../../../components/restock.module.css";

/** Righe vuote alte come quelle vere: nessun salto quando arrivano i dati. */
export default function RestockLoading() {
  return (
    <div className={styles.page} aria-busy="true">
      <p role="status" className={styles.lead}>
        Caricamento dei riordini…
      </p>
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
