import styles from "../components/workspace-shell.module.css";

/** Caricamento fuori dal guscio: due barre ferme, nessuna animazione. */
export default function RootLoading() {
  return (
    <div className={styles.rootLoading} aria-busy="true">
      <p role="status" className={styles.loadingText}>
        Caricamento…
      </p>
      <div className={styles.bar} aria-hidden="true" />
      <div className={styles.bar} aria-hidden="true" />
    </div>
  );
}
