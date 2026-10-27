import { describe, expect, it } from "vitest";
import { buildPartnerIndex, filterPartners, DEFAULT_PARTNER_VIEW, periodCounts } from "./filters";
import { partnerActions } from "./contacts";
import {
  PARTNER_FIXTURE_MEMBER_ID,
  PARTNER_PREVIEW_NOTICE,
  partnerAssistantFixtureRows,
  partnerFixtureData,
  partnerFixtureDetail,
  partnerFixtureId,
  partnerFixtureRows,
  partnerFixtureRules,
  partnerFixtureWorkspace,
  partnerLocalPreview,
} from "./fixtures";
import {
  PARTNER_ASSISTANT_INACTIVE,
  type PartnerAssistantContactView,
  type PartnerAssistantRows,
} from "./assistant";
import { PartnerReadError } from "./model";
import { partnerDetailFromRows, partnerWorkspaceFromRows } from "./read";

// Righe → modello della pagina (read.ts) con i dati sintetici dell'anteprima (00-sequenza §1.5).
const TODAY = "2026-10-22";
const rows = () => partnerFixtureRows(TODAY);
/** Il blocco dell'assistente letto, quando c'è: né «non attivo» né `null`. */
const view = (detail: { assistant: unknown } | null | undefined) =>
  detail?.assistant as PartnerAssistantContactView | undefined;
const workspaceRows = (change: (r: ReturnType<typeof rows>) => void = () => {}) => {
  const r = rows();
  change(r);
  return {
    partners: r.partners,
    contacts: r.contacts,
    variants: r.variants,
    differences: r.differences,
    blocks: r.blocks,
    profiles: r.profiles,
    memberships: r.memberships,
    lastImport: r.imports[0],
  };
};

describe("anteprima locale di Partner", () => {
  it("non si attiva su Vercel né con NODE_ENV=production, anche con il flag", () => {
    const now = new Date("2026-10-22T10:00:00Z");
    expect(partnerLocalPreview(now, { LUCKYLAP_LOCAL_PREVIEW: "true", VERCEL: "1" })).toBeNull();
    expect(
      partnerLocalPreview(now, { LUCKYLAP_LOCAL_PREVIEW: "true", NODE_ENV: "production" }),
    ).toBeNull();
    expect(partnerLocalPreview(now, {})).toBeNull();
    const preview = partnerLocalPreview(now, {
      LUCKYLAP_LOCAL_PREVIEW: "true",
      NODE_ENV: "development",
    });
    expect(preview?.today).toBe(TODAY);
    expect(preview?.memberId).toBe(PARTNER_FIXTURE_MEMBER_ID);
    expect(preview?.workspace.partners).toHaveLength(6);
    expect(preview?.assistant).toMatchObject({ mode: "prepara", configured: true });
    expect(preview?.assistant.toReview.map((item) => item.co)).toEqual([1]);
    expect(PARTNER_PREVIEW_NOTICE).toBe(
      "Anteprima locale: dati sintetici, salvataggio disattivato.",
    );
  });

  it("solo dati sintetici: email example.test e numeri +39 000 000 00xx", () => {
    const text = JSON.stringify(rows());
    const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) expect(email).toMatch(/\.example\.test$/);
    for (const phone of text.match(/\+\d[\d ]{6,}\d/g) ?? [])
      expect(phone.replace(/\s/g, "")).toMatch(/^\+3900000000\d\d$/);
    // Unica eccezione: il link Instagram di un profilo inventato, come nell'harness.
    for (const url of text.match(/https?:\/\/[^\s"]+/g) ?? [])
      expect(new URL(url).hostname).toMatch(/(^|\.)example\.test$|^www\.instagram\.com$/);
  });

  it("sei contatti in tutti e cinque i periodi, qualunque sia oggi", () => {
    for (const today of [TODAY, "2026-12-31", "2027-03-01"]) {
      const workspace = partnerFixtureWorkspace(today);
      const context = {
        index: buildPartnerIndex(workspace),
        today,
        memberId: PARTNER_FIXTURE_MEMBER_ID,
      };
      const counts = periodCounts(
        workspace.partners,
        { ...DEFAULT_PARTNER_VIEW, stato: "tutti" },
        context,
      );
      expect(
        Object.values(counts).every((n) => n >= 1),
        today,
      ).toBe(true);
    }
  });

  it("un contatto bloccato senza pulsanti, uno con differenze, uno fuori dalla ricerca", () => {
    const workspace = partnerFixtureWorkspace(TODAY);
    const index = buildPartnerIndex(workspace);
    const blocked = workspace.partners.find((partner) => index.blocks.has(partner.id))!;
    expect(blocked.co).toBe(4);
    expect(partnerActions(blocked, index.contacts.get(blocked.id) ?? [], true)).toEqual([]);
    expect([...index.differences.keys()]).toEqual([partnerFixtureId(1), partnerFixtureId(3)]);
    expect(workspace.partners.find((partner) => partner.researchRemovedAt)?.co).toBe(5);
    expect(index.variants.get(partnerFixtureId(6))?.map((v) => v.approach)).toEqual([
      "vendita",
      "evento",
      "su_misura",
      "media",
    ]);
    const context = { index, today: TODAY, memberId: PARTNER_FIXTURE_MEMBER_ID };
    expect(
      filterPartners(workspace.partners, DEFAULT_PARTNER_VIEW, context).map((p) => p.co),
    ).toEqual([1, 2]);
    expect(workspace.lastImport?.sourceCommit).toBe("0a1b2c3d");
  });

  it("dettaglio completo: testo in uso del team, revisioni, registro con il dispositivo", () => {
    const detail = partnerFixtureDetail(1, TODAY)!;
    expect(detail.partner.research.route).toBe(
      "Email al titolare. Poi una telefonata dopo una settimana.",
    );
    const collab = detail.variants.find((variant) => variant.approach === "collab")!;
    expect(collab.currentRevision?.revisionNo).toBe(2);
    expect(collab.current.body).toContain("edited twice");
    expect(collab.original.body).toContain("synthetic test message");
    expect(collab.revisions.map((revision) => revision.revisionNo)).toEqual([2, 1]);
    expect(detail.variants.map((variant) => variant.approach)).toEqual(["vendita", "collab"]);
    expect(detail.differences).toMatchObject([{ field: "message", origin: "research" }]);
    expect(detail.activities[0].kind).toBe("messaggio");
    const club = partnerFixtureDetail(3, TODAY)!;
    expect(club.activities.find((activity) => activity.origin === "file")?.device).toBe("telefono");
    expect(club.differences[0]).toMatchObject({ device: "telefono", teamValue: "risposto" });
    expect(partnerFixtureDetail(4, TODAY)?.blocks).toHaveLength(1);
    expect(partnerFixtureDetail(2, TODAY)?.partner.research.sources).toEqual([
      "https://raduno-due.example.test/programma",
    ]);
    expect(partnerFixtureDetail(99, TODAY)).toBeNull();
  });

  it("blocco dell'assistente: bozza pronta, Serve Tommi, interruttore fermo, vuoto senza lavoro", () => {
    const ready = view(partnerFixtureDetail(2, TODAY))!;
    expect(ready.job?.status).toBe("pronta");
    expect(ready.draft?.toAddress).toBe("info@raduno-due.example.test");
    expect(ready.choice?.proposedEmail).toBe("booking@raduno-due.example.test");
    expect(view(partnerFixtureDetail(1, TODAY))?.job).toMatchObject({
      status: "serve_tommaso",
      reason: "fatto_mancante",
    });
    expect(partnerFixtureDetail(4, TODAY)?.assistant).toMatchObject({ active: false, job: null });
    // Contatti senza lavoro né interruttore: il blocco c'è, con l'interruttore attivo e senza
    // lavoro. `null` vuol dire solo «stato non leggibile».
    for (const co of [3, 5, 6])
      expect(partnerFixtureDetail(co, TODAY)?.assistant, `${co}`).toEqual({
        active: true,
        switchVersion: null,
        job: null,
        research: null,
        choice: null,
        draft: null,
      });
  });

  it("dati e regole dell'ultimo import", () => {
    const data = partnerFixtureData(TODAY);
    expect(data.openDifferences).toBe(2);
    expect(data.deviceImports[0].device).toBe("telefono");
    expect(data.members.map((member) => member.name)).toEqual([
      "Ada Prova",
      "Bruno Prova",
      "Carla Prova",
      "Dario Prova",
      "Elena Prova",
    ]);
    expect(partnerFixtureRules(TODAY)?.contextMd).toContain("# Regole sintetiche");
  });
});

describe("controlli di coerenza della lettura", () => {
  it("righe che citano contatti assenti o doppioni: nessun dato parziale", () => {
    expect(() =>
      partnerWorkspaceFromRows(
        workspaceRows((r) => {
          r.contacts[0].partner_id = partnerFixtureId(999);
        }),
      ),
    ).toThrow(PartnerReadError);
    expect(() =>
      partnerWorkspaceFromRows(
        workspaceRows((r) => {
          r.partners[1].co = r.partners[0].co;
        }),
      ),
    ).toThrow(PartnerReadError);
    expect(() =>
      partnerWorkspaceFromRows(
        workspaceRows((r) => {
          r.variants[1].approach = r.variants[0].approach;
        }),
      ),
    ).toThrow(PartnerReadError);
    expect(() =>
      partnerWorkspaceFromRows(
        workspaceRows((r) => {
          r.memberships.push({ user_id: partnerFixtureId(999), active: true });
        }),
      ),
    ).toThrow(PartnerReadError);
    expect(
      partnerWorkspaceFromRows(workspaceRows((r) => r.imports.splice(0))).lastImport,
    ).toBeNull();
  });

  it("revisione corrente mancante o dispositivo sconosciuto: errore", () => {
    const r = rows();
    const partner = r.partners[0];
    const variants = r.variants.filter((variant) => variant.partner_id === partner.id);
    const detailRows = {
      partner,
      contacts: r.contacts.filter((contact) => contact.partner_id === partner.id),
      variants,
      revisions: variants.map((variant) => ({ variantId: variant.id, rows: [], count: 0 })),
      currentRevisions: [],
      activities: [],
      activityCount: 0,
      differences: [],
      blocks: [],
      deviceImports: [],
      assistant: null,
    };
    expect(() => partnerDetailFromRows(1, detailRows)).toThrow(PartnerReadError);
    const withOld = {
      ...detailRows,
      revisions: variants.map((variant) => ({ variantId: variant.id, rows: [], count: 12 })),
      currentRevisions: r.revisions.filter((revision) => revision.id === partnerFixtureId(302)),
    };
    expect(partnerDetailFromRows(1, withOld).variants[1].revisionCount).toBe(12);
    expect(() => partnerDetailFromRows(2, withOld)).toThrow(PartnerReadError);
    const club = r.partners[2];
    expect(() =>
      partnerDetailFromRows(3, {
        ...detailRows,
        partner: club,
        contacts: [],
        variants: [],
        revisions: [],
        activities: r.activities.filter((a) => a.partner_id === club.id),
        activityCount: 3,
      }),
    ).toThrow(PartnerReadError);
  });

  it("righe dell'assistente non leggibili o non valide: assistant null, la scheda resta leggibile", () => {
    const r = rows();
    const partner = r.partners[1];
    const mine = <T extends { partner_id: string | null }>(items: T[]) =>
      items.filter((item) => item.partner_id === partner.id);
    const assistantRows = () => {
      const a = partnerAssistantFixtureRows(TODAY);
      return {
        switch: null,
        job: mine(a.jobs)[0] ?? null,
        notes: mine(a.notes),
        draft: mine(a.drafts)[0] ?? null,
      };
    };
    const detailRows = (
      assistant: PartnerAssistantRows | typeof PARTNER_ASSISTANT_INACTIVE | null,
    ) => ({
      partner,
      contacts: mine(r.contacts),
      variants: mine(r.variants),
      revisions: mine(r.variants).map((variant) => ({ variantId: variant.id, rows: [], count: 0 })),
      currentRevisions: [],
      activities: [],
      activityCount: 0,
      differences: [],
      blocks: [],
      deviceImports: [],
      assistant,
    });
    expect(view(partnerDetailFromRows(2, detailRows(assistantRows())))?.job?.status).toBe("pronta");
    // Tabelle non leggibili (per esempio prima delle migrazioni): il server passa null.
    const unreadable = partnerDetailFromRows(2, detailRows(null));
    expect(unreadable.assistant).toBeNull();
    expect(unreadable.contacts).toHaveLength(4);
    expect(unreadable.variants.map((variant) => variant.approach)).toEqual(["evento"]);
    // Una proposta sconosciuta o uno stato fuori elenco annullano solo il blocco.
    const unknownRequest = assistantRows();
    const choice = unknownRequest.notes.find((note) => note.kind === "scelta")!;
    choice.content = { ...(choice.content as object), request: "conto_vendita" };
    const wrongStatus = assistantRows();
    wrongStatus.job!.status = "inviata";
    for (const assistant of [unknownRequest, wrongStatus]) {
      const detail = partnerDetailFromRows(2, detailRows(assistant));
      expect(detail.assistant).toBeNull();
      expect(detail.partner.co).toBe(2);
      expect(detail.contacts).toHaveLength(4);
    }
    // Nessun lavoro e nessun interruttore: righe lette, quindi un blocco vuoto e attivo, distinto
    // dal `null` delle righe non lette o non valide.
    expect(
      partnerDetailFromRows(2, detailRows({ switch: null, job: null, notes: [], draft: null }))
        .assistant,
    ).toEqual({
      active: true,
      switchVersion: null,
      job: null,
      research: null,
      choice: null,
      draft: null,
    });
    // Senza lavoro, note o bozza orfane sono righe non valide: null.
    const orphan = assistantRows();
    expect(
      partnerDetailFromRows(2, detailRows({ ...orphan, job: null, switch: null })).assistant,
    ).toBeNull();
    // Migrazioni non ancora applicate: il blocco non c'è, senza avviso; la scheda resta.
    const inactive = partnerDetailFromRows(2, detailRows(PARTNER_ASSISTANT_INACTIVE));
    expect(inactive.assistant).toBe(PARTNER_ASSISTANT_INACTIVE);
    expect(inactive.contacts).toHaveLength(4);
    // Solo le righe non valide (PartnerReadError) annullano il blocco: un altro errore è un bug
    // e risale, come ogni errore della scheda.
    expect(() =>
      partnerDetailFromRows(
        2,
        detailRows({ ...assistantRows(), notes: null as unknown as readonly unknown[] }),
      ),
    ).toThrow(TypeError);
  });
});
