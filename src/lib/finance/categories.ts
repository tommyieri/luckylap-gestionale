/** Shared suggestions, not a rewrite of the categories preserved in source documents. */
export const FINANCE_CATEGORY_GROUPS = [
  {
    id: "income",
    label: "Income",
    description: "Entrate",
    categories: ["Collab", "Fund Raising", "Others", "Vendite"],
  },
  {
    id: "fixed",
    label: "Fixed Cost",
    description: "Costi fissi",
    categories: ["Software", "Stipendi", "Tasse & Contributi"],
  },
  {
    id: "variable",
    label: "Variable Cost",
    description: "Costi variabili",
    categories: ["Attrezzatura", "Eventi", "Marketing", "Produzione", "Spedizioni", "Trasferte"],
  },
] as const;
export const FINANCE_ACCOUNT_SUGGESTIONS = ["Revolut Business", "Cash"] as const;

export function financeCategoryGroup(category: string) {
  return (
    FINANCE_CATEGORY_GROUPS.find((group) =>
      (group.categories as readonly string[]).includes(category),
    )?.id ?? "unclassified"
  );
}
