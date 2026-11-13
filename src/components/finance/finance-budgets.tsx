"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  financeBudgetActuals,
  financeBudgetMonthRange,
  maximumBudgetCents,
  type FinanceBudget,
} from "../../lib/finance/budgets";
import { financeCentsLabel, type FinanceDashboard } from "../../lib/finance/dashboard";
import { euroCents, moneyInput } from "../../lib/sales/model";
import { loadFinanceBudgets, saveFinanceBudget } from "../../app/finance/budget-actions";
import { FinanceCategoryIcon } from "./finance-category-icon";
import styles from "./finance-budgets.module.css";

type Props = {
  dashboard: FinanceDashboard;
  categories: readonly string[];
  month: string;
  actorId?: string;
  readOnly?: boolean;
  onMonthChange: (month: string) => void;
};
type BudgetRow = { category: string; used: bigint; limit: number | null };

export function FinanceBudgets({ month, onMonthChange, ...props }: Props) {
  return (
    <section aria-labelledby="finance-budget-title" className={styles.budgets}>
      <header className={styles.heading}>
        <h1 id="finance-budget-title">Budget</h1>
        <label>
          <span className="sr-only">Mese del budget</span>
          <input
            type="month"
            value={month}
            min="0001-01"
            max="9999-12"
            onChange={(event) => {
              if (financeBudgetMonthRange(event.target.value)) onMonthChange(event.target.value);
            }}
          />
        </label>
      </header>
      <MonthBudget key={`${props.actorId ?? ""}:${month}`} month={month} {...props} />
    </section>
  );
}

function MonthBudget({
  dashboard,
  categories,
  month,
  actorId,
  readOnly,
}: Omit<Props, "onMonthChange">) {
  const editable = !readOnly && !!actorId;
  const [budgets, setBudgets] = useState<FinanceBudget[] | null>(editable ? null : []);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(editable);
  const [saving, setSaving] = useState(false);
  const [loadCount, setLoadCount] = useState(0);
  const actual = useMemo(
    () => financeBudgetActuals(dashboard.movements, month),
    [dashboard, month],
  );

  useEffect(() => {
    if (!editable || !actorId) return;
    let active = true;
    loadFinanceBudgets(month, actorId)
      .then((result) => {
        if (!active) return;
        if (result.ok) setBudgets(result.budgets);
        else setError(result.message);
      })
      .catch(() => {
        if (active) setError("Budget non disponibili. Riprova tra poco.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [editable, actorId, month, loadCount]);

  const byCategory = new Map((budgets ?? []).map((budget) => [budget.category, budget]));
  const current = byCategory.get(category);
  const availableCategories = [
    ...new Set([...categories, ...actual.byCategory.keys(), ...byCategory.keys()]),
  ]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "it"));
  const totals = {
    category: "",
    used: actual.total,
    limit: byCategory.get("")?.limitCents ?? null,
  };
  const details: BudgetRow[] = availableCategories
    .filter((name) => actual.byCategory.has(name) || byCategory.has(name))
    .map((name) => ({
      category: name,
      used: actual.byCategory.get(name) ?? 0n,
      limit: byCategory.get(name)?.limitCents ?? null,
    }));

  function reload() {
    setError("");
    setBudgets(null);
    setNotice("");
    setAmount(null);
    setLoading(true);
    setLoadCount((count) => count + 1);
  }
  async function save(limitCents: number | null) {
    if (!editable || !actorId || saving || loading || !budgets) return;
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const result = await saveFinanceBudget({
        month,
        actorId,
        category,
        limitCents,
        revision: current?.revision ?? null,
      });
      if (!result.ok) {
        setError(result.message);
        if ("changed" in result) setBudgets(null);
        return;
      }
      setBudgets(result.budgets);
      setAmount(null);
      setNotice(limitCents === null ? "Limite rimosso." : "Limite salvato.");
    } catch {
      setError("Esito del salvataggio da verificare. Riprova o ricarica il budget.");
    } finally {
      setSaving(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = euroCents(amount ?? moneyInput(current?.limitCents ?? null), maximumBudgetCents);
    if (cents === null) {
      setError("Inserisci un limite in euro con al massimo due decimali.");
      return;
    }
    void save(cents);
  }

  return (
    <>
      {loading && (
        <p role="status" className={styles.message}>
          Caricamento dei limiti…
        </p>
      )}
      {error && (
        <div className={styles.message} role="alert">
          <span>{error}</span>
          {editable && !saving && (
            <button type="button" className={styles.link} onClick={reload}>
              Ricarica budget
            </button>
          )}
        </div>
      )}
      {notice && (
        <p className={styles.message} role="status">
          {notice}
        </p>
      )}
      {budgets && (
        <>
          <section className={styles.overall} aria-label="Budget complessivo">
            <BudgetUsage row={totals} />
          </section>
          {editable && (
            <form
              onSubmit={submit}
              className={styles.editor}
              aria-label="Imposta un limite di spesa"
            >
              <label>
                <span>Budget da modificare</span>
                <select
                  value={category}
                  disabled={saving}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    setAmount(null);
                    setNotice("");
                    setError("");
                  }}
                >
                  <option value="">Budget complessivo</option>
                  {availableCategories.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Limite in euro</span>
                <input
                  inputMode="decimal"
                  value={amount ?? moneyInput(current?.limitCents ?? null)}
                  onChange={(event) => setAmount(event.currentTarget.value)}
                  placeholder="0,00"
                  disabled={saving}
                />
              </label>
              <button type="submit" className={styles.primary} disabled={saving}>
                {saving ? "Salvataggio…" : "Salva limite"}
              </button>
              {current && (
                <button
                  type="button"
                  className={styles.remove}
                  disabled={saving}
                  onClick={() => void save(null)}
                >
                  Rimuovi limite
                </button>
              )}
            </form>
          )}
          {!editable && (
            <p className={styles.message}>Anteprima: puoi consultare le spese del mese.</p>
          )}
          <section className={styles.categories} aria-labelledby="finance-budget-categories">
            <h2 id="finance-budget-categories">Per categoria</h2>
            {details.length ? (
              <ul>
                {details.map((row) => (
                  <li key={row.category}>
                    <BudgetUsage row={row} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.message}>Nessuna spesa o limite per questo mese.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}

function BudgetUsage({ row }: { row: BudgetRow }) {
  const limit = row.limit === null ? null : BigInt(row.limit);
  const remaining = limit === null ? null : limit - row.used;
  const progress =
    limit === null
      ? 0
      : row.used >= limit
        ? row.used > 0n
          ? 100
          : 0
        : Number((row.used * 1000n) / limit) / 10;
  const status =
    remaining === null
      ? "Nessun limite"
      : remaining < 0n
        ? `Superato di ${financeCentsLabel(-remaining)}`
        : `Disponibile ${financeCentsLabel(remaining)}`;
  return (
    <div className={styles.usage}>
      <div className={styles.usageTitle}>
        {row.category && <FinanceCategoryIcon category={row.category} />}
        <strong>{row.category || "Budget complessivo"}</strong>
      </div>
      <p className={styles.spent}>
        <strong>{financeCentsLabel(row.used)}</strong>{" "}
        {limit === null ? "spesi" : `su ${financeCentsLabel(limit)}`}
      </p>
      {limit !== null && (
        <div className={styles.progress} aria-hidden="true">
          <span data-over={remaining! < 0n} style={{ width: `${progress}%` }} />
        </div>
      )}
      <p className={styles.status} data-over={remaining !== null && remaining < 0n}>
        {status}
      </p>
    </div>
  );
}
