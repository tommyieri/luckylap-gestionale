import roadbook from "../../components/roadbook.module.css";
import styles from "../../components/workspace-shell.module.css";

/** Riscontro immediato al tocco: tre righe vuote alte come quelle vere, nessuna animazione. */
export default function WorkspaceLoading() {
  return (
    <div className={styles.loading} aria-busy="true">
      <p role="status" className={styles.loadingText}>
        Caricamento…
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
