// This helper describes product permissions. Database RLS enforces real access.
export const TEAM = [
  { id: "founder", name: "Tommi", role: "founder", title: "Founder e CEO" },
  { id: "gabriele", name: "Gabriele", role: "production", title: "Socio · Produzione" },
  { id: "ettore", name: "Ettore", role: "logistics", title: "Logistica" },
  { id: "gherardo", name: "Gherardo", role: "finance", title: "Finance" },
  { id: "luca", name: "Luca", role: "consultant", title: "Consulente · Ciago Agency" },
] as const;

const financeMembers = new Set(["founder", "gabriele", "gherardo"]);
const sharedAreas = new Set([
  "inventory",
  "packaging",
  "costs",
  "margins",
  "discounts",
  "stock-adjustments",
  "calendar",
  "tasks",
  "notes",
  "assets",
  "products",
  "partners",
  "consignment",
]);

export function canAccessModule(memberId: string, module: string): boolean {
  if (!TEAM.some((member) => member.id === memberId)) return false;
  if (module === "finance") return financeMembers.has(memberId);
  if (module === "control") return memberId === "founder";
  return sharedAreas.has(module);
}
