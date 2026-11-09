import { describe, expect, it } from "vitest";
import { FINANCE_CATEGORY_GROUPS, financeCategoryGroup } from "./categories";

describe("suggerimenti categorie Finance", () => {
  it("usa etichette italiane e aggiunge packaging, commissioni e servizi", () => {
    expect(FINANCE_CATEGORY_GROUPS.map((group) => group.label)).toEqual([
      "Entrate",
      "Costi fissi",
      "Costi variabili",
    ]);
    const categories = FINANCE_CATEGORY_GROUPS.flatMap((group) => [...group.categories]);
    expect(categories).toEqual(
      expect.arrayContaining(["Packaging", "Commissioni", "Servizi e consulenze"]),
    );
    expect(new Set(categories).size).toBe(categories.length);
  });

  it("preserva i valori storici e non riclassifica le categorie personalizzate", () => {
    expect(financeCategoryGroup("Fund Raising")).toBe("income");
    expect(financeCategoryGroup("Others")).toBe("income");
    expect(financeCategoryGroup("Stipendi")).toBe("fixed");
    expect(financeCategoryGroup("Tasse & Contributi")).toBe("fixed");
    expect(financeCategoryGroup("Categoria personalizzata sintetica")).toBe("unclassified");
  });
});
