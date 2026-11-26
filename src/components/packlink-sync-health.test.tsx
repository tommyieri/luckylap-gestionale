import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only", () => ({}));
import { PacklinkSyncHealth } from "./packlink-sync-health";
import { packlinkSyncSnapshotFrom, type PacklinkSyncSnapshot } from "../lib/packlink/status-model";
const now = Date.parse("2030-02-03T11:05:00Z");
const base: PacklinkSyncSnapshot = {
  configured: true,
  enabled: true,
  lastAttemptAt: "2030-02-03T11:00:00Z",
  lastSuccessAt: "2030-02-03T11:00:00Z",
  outcome: "applied",
  reason: null,
  counts: { inserted: 2, replayed: 5, ignored: 0 },
};
const render = (changes: Partial<PacklinkSyncSnapshot> = {}) =>
  renderToStaticMarkup(
    <PacklinkSyncHealth
      status={{ status: "ready", snapshot: { ...base, ...changes } }}
      now={now}
    />,
  );
describe("Packlink automatic reading status", () => {
  it("shows a recent successful reading and the actual completed counts", () => {
    const html = render();
    expect(html).toContain("Attivo");
    expect(html).toContain("ogni 15 minuti");
    expect(html).toContain("Nuove voci nell’ultima lettura: 2");
  });
  it.each(["running", "retry", "review"] as const)(
    "does not label reset attempt counters as the previous completed reading (%s)",
    (outcome) => {
      const html = render({
        outcome,
        reason: outcome === "running" ? null : "unavailable",
        counts: { inserted: 0, replayed: 0, ignored: 0 },
      });
      expect(html).not.toContain("Nuove voci nell’ultima lettura");
      expect(html).toContain("Ultima lettura completata");
    },
  );
  it("does not claim a healthy connection before the first reading or after missed runs", () => {
    expect(render({ lastSuccessAt: null, outcome: null })).toContain(
      "In attesa della prima lettura",
    );
    const stale = render({ lastSuccessAt: "2030-02-03T09:00:00Z" });
    expect(stale).toContain("Richiede attenzione");
    expect(stale).toContain("45 minuti");
    expect(
      render({ lastSuccessAt: null, lastAttemptAt: "2030-02-03T09:00:00Z", outcome: "running" }),
    ).toContain("Richiede attenzione");
  });
  it("maps provider failures without printing their raw reason", () => {
    const html = render({ outcome: "review", reason: "synthetic_unmapped_failure" });
    expect(html).toContain("richiede una verifica");
    expect(html).not.toContain("synthetic_unmapped_failure");
  });
  it("keeps disabled and unavailable states explicit", () => {
    expect(render({ enabled: false })).toContain("In pausa");
    expect(
      renderToStaticMarkup(<PacklinkSyncHealth status={{ status: "unavailable" }} />),
    ).toContain("Stato non disponibile");
  });
  it("validates the RPC and respects the server runtime gate", () => {
    const raw = {
      configured: true,
      enabled: true,
      last_attempt_at: base.lastAttemptAt,
      last_success_at: base.lastSuccessAt,
      outcome: "applied",
      reason: null,
      counts: base.counts,
    };
    expect(packlinkSyncSnapshotFrom(raw, false)?.enabled).toBe(false);
    for (const bad of [
      { ...raw, last_success_at: "invalid" },
      { ...raw, configured: false },
      { ...raw, api_key: "forbidden" },
      { ...raw, counts: { ...raw.counts, inserted: -1 } },
    ])
      expect(packlinkSyncSnapshotFrom(bad, true)).toBeNull();
  });
});
