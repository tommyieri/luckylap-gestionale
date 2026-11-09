/** Shared suggestions, not a rewrite of the categories preserved in source documents. */
export const FINANCE_CATEGORY_GROUPS = [
  {
    id: "income",
    label: "Entrate",
    description: "Entrate",
    categories: ["Collab", "Fund Raising", "Others", "Vendite"],
  },
  {
    id: "fixed",
    label: "Costi fissi",
    description: "Costi fissi",
    categories: ["Software", "Stipendi", "Tasse & Contributi"],
  },
  {
    id: "variable",
    label: "Costi variabili",
    description: "Costi variabili",
    categories: [
      "Attrezzatura",
      "Commissioni",
      "Eventi",
      "Marketing",
      "Packaging",
      "Produzione",
      "Servizi e consulenze",
      "Spedizioni",
      "Trasferte",
    ],
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
