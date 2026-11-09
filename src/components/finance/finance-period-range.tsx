"use client";
import { useEffect, useState } from "react";
import styles from "./finance-workspace.module.css";

/** La bozza permette di spostare entrambi gli estremi prima di applicare il filtro. */
export function FinancePeriodRange({
  from,
  to,
  apply,
}: {
  from: string;
  to: string;
  apply: (from: string, to: string) => void;
}) {
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  useEffect(() => {
    setStart(from);
    setEnd(to);
  }, [from, to]);
  const invalid = !start || !end || start > end;
  return (
    <form
      className={styles.periodRange}
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid) apply(start, end);
      }}
    >
      <label className={styles.field}>
        <span>Dal</span>
        <input
          type="date"
          required
          value={start}
          onChange={(event) => setStart(event.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span>Al</span>
        <input type="date" required value={end} onChange={(event) => setEnd(event.target.value)} />
      </label>
      <button className="button button-secondary" type="submit" disabled={invalid}>
        Applica intervallo
      </button>
      {start && end && start > end && (
        <p role="status">La data finale deve seguire quella iniziale.</p>
      )}
    </form>
  );
}
