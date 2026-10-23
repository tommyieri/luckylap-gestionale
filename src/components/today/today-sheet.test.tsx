import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerifiedMember } from "../../lib/auth/model";

vi.mock("./today-tiles", () => ({
  AgendaTile: () => null,
  PreviewTile: () => null,
  StockTile: () => null,
  TileFallback: () => null,
}));
vi.mock("./work-tiles", () => ({ PartnerWorkTile: () => null, PreparationTile: () => null }));
vi.mock("./consignment-tile", () => ({ ConsignmentTile: () => null }));
import { TodaySheet } from "./today-sheet";
import { GuideIntro } from "./guide-intro";

type Element = ReactElement<Record<string, unknown>>;
const descendants = (node: unknown): Element[] => {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...[element.props.children].flat(Infinity).flatMap(descendants)];
};
const text = (node: unknown): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join(" ")
      : node && typeof node === "object" && "props" in node
        ? text((node as Element).props.children)
        : "";
const now = new Date("2026-10-23T08:00:00Z");
const member: VerifiedMember = {
  userId: "00000000-0000-4000-8000-000000000001",
  displayName: "Membro sintetico",
  role: "consultant",
  financeAccess: false,
};

describe("Oggi e il riquadro «Prima volta qui?»", () => {
  it("per un membro: il riquadro sta sopra i riquadri del giorno, con la sua chiave", () => {
    const tree = TodaySheet({
      access: { status: "member", member, supabase: {} as SupabaseClient },
      now,
    });
    const nodes = descendants(tree);
    const intro = nodes.filter((node) => node.type === GuideIntro);
    expect(intro).toHaveLength(1);
    expect(intro[0]!.props.userId).toBe(member.userId);
    const order = nodes.map((node) => node.type);
    expect(order.indexOf(GuideIntro)).toBeLessThan(
      nodes.findIndex((node) => String(node.props.className ?? "").includes("grid")),
    );
  });

  it("in anteprima locale c'è anche lui, con la chiave dell'anteprima e l'avviso", () => {
    const tree = TodaySheet({ access: { status: "preview" }, now });
    const intro = descendants(tree).filter((node) => node.type === GuideIntro);
    expect(intro).toHaveLength(1);
    expect(intro[0]!.props.userId).toBe("anteprima");
    expect(text(tree)).toContain("Anteprima locale: Oggi legge solo dal database.");
  });
});
