import {
  BriefcaseBusiness,
  ChartNoAxesCombined,
  CircleDollarSign,
  Landmark,
  Monitor,
  Package,
  PackageOpen,
  PartyPopper,
  Percent,
  Plane,
  Receipt,
  Shirt,
  Smartphone,
  Star,
  Tag,
  Truck,
  Users,
} from "lucide-react";
import { financeCategoryGroup } from "../../lib/finance/categories";
import styles from "./finance-workspace.module.css";

const icons = new Map([
  ["Collab", Users],
  ["Fund Raising", ChartNoAxesCombined],
  ["Others", Star],
  ["Vendite", Tag],
  ["Software", Monitor],
  ["Stipendi", BriefcaseBusiness],
  ["Tasse & Contributi", Percent],
  ["Attrezzatura", Package],
  ["Commissioni", Receipt],
  ["Eventi", PartyPopper],
  ["Marketing", Smartphone],
  ["Packaging", PackageOpen],
  ["Produzione", Shirt],
  ["Servizi e consulenze", Users],
  ["Spedizioni", Truck],
  ["Trasferte", Plane],
]);

export function FinanceCategoryIcon({ category }: { category: string }) {
  const Icon = icons.get(category) ?? Tag;
  return (
    <span
      aria-hidden="true"
      className={styles.categoryIcon}
      data-group={financeCategoryGroup(category)}
    >
      <Icon size={17} strokeWidth={1.8} />
    </span>
  );
}

export function FinanceAccountIcon({ name }: { name: string }) {
  const Icon = name === "Cash" ? CircleDollarSign : Landmark;
  return (
    <span
      aria-hidden="true"
      className={styles.categoryIcon}
      data-group={name === "Cash" ? "cash" : "bank"}
    >
      <Icon size={17} strokeWidth={1.8} />
    </span>
  );
}

export function financeTags(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean),
    ),
  ];
}
