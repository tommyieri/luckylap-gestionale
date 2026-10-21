export type InventoryItem = {
  id: string;
  sku: string;
  model: string;
  category: string;
  color: string;
  size: string;
  centralQuantity: number | null;
  consignmentQuantity: number | null;
  totalQuantity: number | null;
  targetQuantity: number | null;
  unitCost: number | null;
  webPrice: number | null;
  active: boolean;
  sourceCell: string;
};

export type InventorySourceMeta = {
  title: string;
  url: string;
  importedAt: string;
  quantityStatus: "cached" | "unavailable";
  notes: string[];
};
