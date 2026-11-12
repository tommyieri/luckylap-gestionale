import { describe, expect, it } from "vitest";
import { buildPartnerDatabaseRows } from "./database";
import {
  filterPartnerDatabase,
  parsePartnerDatabaseView,
  partnerDatabaseHref,
  type PartnerDatabaseView,
} from "./database-view";
import { PARTNER_FIXTURE_MEMBER_ID, partnerFixtureWorkspace } from "./fixtures";

const today = "2026-10-22";
const workspace = partnerFixtureWorkspace(today);
const ids = workspace.members.map((member) => member.id);
const rows = buildPartnerDatabaseRows(workspace, today, [], PARTNER_FIXTURE_MEMBER_ID);
const view = (params: Record<string, string | string[] | undefined> = {}) =>
  parsePartnerDatabaseView(params, today, ids);
const selected = (filters: PartnerDatabaseView, differences = new Set<string>()) =>
  filterPartnerDatabase(rows, filters, today, PARTNER_FIXTURE_MEMBER_ID, differences);

describe("indirizzi del database Partner", () => {
  it("apre l’elenco su tutti i periodi e rifiuta parametri non validi", () => {
    expect(view()).toMatchObject({
      screen: "elenco",
      section: "tutti",
      phase: "tutti",
      work: "tutti",
      period: null,
      owner: "tutti",
      month: "2026-10",
      co: null,
    });
    expect(
      view({
        vista: "sconosciuta",
        sezione: "sconosciuta",
        fase: "altro",
        periodo: "6",
        chi: "altro",
        mese: "2026-13",
        co: "0",
        paese: "Europa",
      }),
    ).toEqual(view());
  });

  it("conserva vista, calendario, filtri e scheda nel collegamento canonico", () => {
    const initial = view({
      vista: "calendario",
      sezione: ["eventi", "club"],
      fase: "programmato",
      lavoro: "risposte",
      periodo: "2",
      chi: PARTNER_FIXTURE_MEMBER_ID,
      paese: "nl",
      priorita: "alta",
      formato: "evento_vicino",
      sottotipo: "raduno",
      q: "Raduno & Sintetico",
      ordine: "attivita",
      mese: "2027-02",
      calendario: "lista",
      storico: "tutto",
      co: "2",
    });
    const href = partnerDatabaseHref(initial);
    const url = new URL(href, "https://synthetic.invalid");
    expect(url.pathname).toBe("/partner");
    expect(url.searchParams.get("paese")).toBe("NL");
    expect(url.searchParams.get("sezione")).toBe("eventi");
    expect(url.searchParams.get("co")).toBe("2");
    const restored = parsePartnerDatabaseView(url.searchParams, today, ids);
    expect(restored).toEqual(initial);
    expect(partnerDatabaseHref(restored)).toBe(href);
  });

  it("rispetta il periodo del vecchio elenco e lo ignora nelle viste trasversali", () => {
    expect(view({ vista: "tutti", periodo: "2" }).period).toBe(2);
    expect(view({ periodo: "2" }).period).toBe(2);
    expect(view({ vista: "pipeline", periodo: "2" }).period).toBe(2);
    expect(view({ vista: "da_seguire", periodo: "2" })).toMatchObject({
      work: "da_seguire",
      period: null,
    });
    expect(view({ vista: "ci_siamo", periodo: "2", stato: "no" })).toMatchObject({
      phase: "accordo",
      period: null,
    });
    expect(view({ vista: "risposte", periodo: "2", stato: "da_contattare" })).toMatchObject({
      phase: "tutti",
      work: "risposte",
      period: null,
    });
    expect(view({ vista: "elenco", lavoro: "risposte", fase: "da_contattare" })).toMatchObject({
      phase: "da_contattare",
      work: "risposte",
    });
  });

  it("conserva gli spazi digitati e trova le parole senza distinzione di maiuscole", () => {
    const query = "  GARAGE   Sintetico ";
    const filters = view({ q: query });
    expect(filters.query).toBe(query);
    expect(
      new URL(partnerDatabaseHref(filters), "https://synthetic.invalid").searchParams.get("q"),
    ).toBe(query);
    expect(selected(filters).map(({ partner }) => partner.co)).toEqual([1]);
    expect([...view({ q: "📍".repeat(100) }).query]).toHaveLength(80);
  });
});

describe("filtri condivisi da elenco, pipeline e calendario", () => {
  it("combina sezione, paese e fase e mantiene il blocco come filtro a sé", () => {
    const blocked = rows.find((row) => row.blocked)!;
    expect(selected(view({ fase: "non_contattare" })).map(({ partner }) => partner.id)).toEqual([
      blocked.partner.id,
    ]);
    const match = rows.find(
      (row) => !row.blocked && row.countryCode && row.partner.sections.length,
    )!;
    expect(
      selected(
        view({ sezione: match.partner.sections[0], fase: match.stage, paese: match.countryCode! }),
      ).map(({ partner }) => partner.id),
    ).toContain(match.partner.id);
    expect(
      selected(view({ sezione: match.partner.sections[0], fase: match.stage, paese: "JP" })).map(
        ({ partner }) => partner.id,
      ),
    ).not.toContain(match.partner.id);
  });

  it("distingue responsabile effettivo e assegnazione esplicita", () => {
    const unassigned = selected(view({ chi: "nessuno" }));
    expect(unassigned.length).toBeGreaterThan(0);
    expect(unassigned.every(({ partner }) => partner.ownerId === null)).toBe(true);
    expect(selected(view({ chi: "io" }))).toEqual(
      selected(view({ chi: PARTNER_FIXTURE_MEMBER_ID })),
    );
    expect(selected(view({ chi: "io" })).map(({ partner }) => partner.id)).toEqual(
      expect.arrayContaining(unassigned.map(({ partner }) => partner.id)),
    );
  });

  it("mantiene i link alle differenze distinti dalla coda operativa", () => {
    const match = rows.find((row) => !row.work.needsAction)!;
    expect(
      selected(view({ vista: "da_seguire", stato: "da_controllare" }), new Set([match.partner.id])),
    ).toEqual([match]);
    expect(selected(view({ vista: "da_seguire" })).map(({ partner }) => partner.id)).not.toContain(
      match.partner.id,
    );
  });
});
