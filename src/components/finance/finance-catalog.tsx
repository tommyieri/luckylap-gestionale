import { ChevronRight } from "lucide-react";
import { FINANCE_CATEGORY_GROUPS } from "../../lib/finance/categories";
import type { FinanceMovement } from "../../lib/finance/dashboard";
import { FinanceCategoryIcon } from "./finance-category-icon";
import styles from "./finance-workspace.module.css";

export function FinanceCatalog({
  movements,
  categories,
  select,
}: {
  movements: readonly FinanceMovement[];
  categories: readonly string[];
  select: (category: string) => void;
}) {
  const usage = new Map<string, number>();
  for (const row of movements) {
    if (row.category && !row.transfer) usage.set(row.category, (usage.get(row.category) ?? 0) + 1);
  }
  const popular = [...usage]
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b, "it"))
    .slice(0, 5)
    .map(([category]) => category);
  const extra = categories.filter(
    (category) =>
      !FINANCE_CATEGORY_GROUPS.some((group) =>
        (group.categories as readonly string[]).includes(category),
      ),
  );
  const groups = [
    { id: "popular", label: "Più usate", categories: popular },
    ...FINANCE_CATEGORY_GROUPS,
    { id: "extra", label: "Altre categorie", categories: extra },
  ];
  return (
    <section aria-labelledby="finance-categories-title" className={styles.catalog}>
      <h1 id="finance-categories-title" className={styles.screenHeading}>
        Categorie
      </h1>
      {groups
        .filter((group) => group.categories.length)
        .map((group) => (
          <section key={group.id} className={styles.catalogGroup}>
            <h2>{group.label}</h2>
            <div className={styles.surface}>
              {group.categories.map((category) => (
                <button
                  type="button"
                  key={category}
                  className={styles.catalogRow}
                  onClick={() => select(category)}
                >
                  <FinanceCategoryIcon category={category} />
                  <span>{category}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ))}
    </section>
  );
}
