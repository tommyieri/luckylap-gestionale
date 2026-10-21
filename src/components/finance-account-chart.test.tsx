import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
// Inspect the component's actual SVG children without a browser or a DOM package.
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useId: () => "synthetic-chart",
  useEffect: () => undefined,
  useRef: () => ({ current: null }),
  useState: (value: unknown) => [value, () => undefined],
}));
vi.mock("@/lib/finance/dashboard", () => import("../lib/finance/dashboard"));
import { FinanceAccountChart } from "./finance-account-chart";
import type { FinanceSeries } from "../lib/finance/dashboard";

function svgLabels(node: ReactNode): ReactElement<{ children?: ReactNode }>[] {
  if (Array.isArray(node)) return node.flatMap(svgLabels);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === "title" || node.type === "desc" ? [node] : []), ...svgLabels(node.props.children)];
}
const series: FinanceSeries[] = [{ name: "Synthetic account", months: Array.from({ length: 12 }, (_, index) => ({ month: `2026-${String(index + 1).padStart(2, "0")}`, date: "2026-01-15", posted: index === 0 ? 1234n : null, planned: index > 0 ? 2000n : null, incoming: 0n, outgoing: 0n, net: 0n, count: 0 })) }];

describe("Finance SVG text hydration", () => {
  it.each([false, true])("renders every SVG title/description as one string, planned=%s", showPlanned => {
    const element = FinanceAccountChart({ series, year: 2026, reportDate: "2026-01-15", showPlanned });
    const labels = svgLabels(element);
    expect(labels).toHaveLength(3);
    for (const label of labels) expect(typeof label.props.children).toBe("string");
    const html = renderToString(element);
    expect(html).toContain("Andamento dei conti, 2026");
    expect(html).toContain("Synthetic account · Gen 2026: 12,34 €");
    for (const label of html.matchAll(/<(?:title|desc)\b[^>]*>([\s\S]*?)<\/(?:title|desc)>/g)) expect(label[1]).not.toContain("<!--");
  });
});
