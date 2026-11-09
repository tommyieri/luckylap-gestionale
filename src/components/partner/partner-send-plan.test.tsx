import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/link", () => ({
  default: ({ children, prefetch: _prefetch, ...props }: Record<string, unknown>) => (
    <a {...props}>{children as import("react").ReactNode}</a>
  ),
}));
import { PartnerSendPlanPanel } from "./partner-send-plan";
import type { PartnerSendPlan } from "../../lib/partner/send-plan";
const plan: PartnerSendPlan = {
  day: "2026-11-09",
  generatedAt: "2026-11-09T07:30:00Z",
  mode: "invio",
  slots: [
    {
      id: "82000000-0000-4000-8000-000000000001",
      kind: "sollecito",
      partnerId: "82000000-0000-4000-8000-000000000002",
      co: 951,
      name: "Club sintetico",
      timezone: "Pacific/Auckland",
      localDay: "2026-11-10",
      plannedAt: "2026-11-09T20:00:00Z",
      expiresAt: "2026-11-09T20:05:00Z",
      status: "scheduled",
      reason: null,
    },
  ],
};
const render = (value: PartnerSendPlan | null = plan) =>
  renderToStaticMarkup(<PartnerSendPlanPanel plan={value} today={plan.day} />);
describe("pannello degli orari", () => {
  it("mostra orario autorevole locale, data locale e Roma con accesso alla scheda", () => {
    const html = render();
    expect(html).toContain("09:00 locale");
    expect(html).toContain("10 novembre");
    expect(html).toContain("21:00 a Roma");
    expect(html).toContain("9 novembre");
    expect(html).toContain("Sollecito");
    expect(html).toContain("Programmato · ancora da controllare");
    expect(html).toContain("/partner?co=951#lead-951");
    expect(html).toContain("/partner/email?giorno=2026-11-09");
    expect(html).toContain("/partner/email?giorno=2026-11-10");
    expect(html).toContain("Orario utile fino alle");
    expect(html).toContain("09:05 locale");
    expect(html).toContain("Limiti giornalieri calcolati sull&#x27;ora di Roma");
    expect(html).toContain("Un invio saltato non fa accelerare quelli successivi");
    expect(html).not.toMatch(/\bslot\b|UTC|Pacific\/Auckland|giorno di quota|due minuti/);
    expect(html).not.toMatch(/mailto:|tel:|Modifica il testo|<button/);
  });
  it("un errore di lettura non dichiara il piano vuoto", () => {
    expect(render(null)).toContain("Piano degli orari non leggibile");
    expect(render(null)).not.toContain("Nessun invio programmato");
    expect(render({ ...plan, slots: [] })).toContain("Nessun invio programmato");
  });
  it("stato mancato e motivo sono leggibili, il codice sconosciuto non viene esposto", () => {
    expect(
      render({ ...plan, slots: [{ ...plan.slots[0], status: "expired", reason: "slot_scaduto" }] }),
    ).toContain("nessun recupero a raffica");
    const html = render({
      ...plan,
      mode: "prepara",
      slots: [{ ...plan.slots[0], reason: "codice_inatteso" }],
    });
    expect(html).toContain("Invio non attivo");
    expect(html).not.toContain("codice_inatteso");
    expect(html).toContain("Invio da verificare");
  });
});
